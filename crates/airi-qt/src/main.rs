// SPDX-License-Identifier: GPL-3.0-or-later
#![deny(missing_docs)]

//! airi-qt: native Qt Quick desktop shell for AIRI (Rust + cxx-qt).
//!
//! `--profile <dir>` isolates the data directory; plain launches persist to the
//! platform data dir; `--smoke` boots a temporary
//! profile, walks the Splash milestones into the Control Strip, opens the
//! Chat/Settings/About windows via the smoke tour, prints the visited pages,
//! and exits 0. `--import-card <file>` / `--import-model <file>` copy a
//! character card / `.vrm` model into their respective directories and exit.
//! GUI launches take a single-instance lock (`airi-qt.lock` in the data dir),
//! acquired before the SQLite store is opened, and install a panic hook writing
//! JSON crash logs to `<data>/logs/`. The guard is held for the whole session, so
//! a second process on the same profile exits 0 instead of racing the first
//! one's settings writes.

use cxx_qt::casting::Upcast;
use cxx_qt_lib::{QGuiApplication, QQmlApplicationEngine, QQmlEngine, QUrl};
use std::path::PathBuf;
use std::pin::Pin;
use std::process::ExitCode;
use std::time::{Duration, Instant};

/// Qt/cxx-qt bridge objects exposed to QML.
pub mod bridges;
/// Read-only `renderer.*` RPC handlers for the `--gateway` channel server.
mod gateway_handlers;
/// Shared spine runtime state and C ABI for the C++ scene-graph item.
pub mod spine_rt;

// Qt messages print through the app handler (see airi_qt_bridge.cpp).
unsafe extern "C" {
    fn airi_install_message_handler();
}

/// CLI config.
#[derive(Debug, Default)]
pub struct Cli {
    /// Isolated data directory (created if missing).
    pub profile: Option<PathBuf>,
    /// Smoke test: open the window, pump the event loop briefly, exit 0.
    pub smoke: bool,
    /// Import a character card (CCv2/CCv3 `.png` or `.json`) into the cards
    /// dir and exit, without booting the GUI.
    pub import_card: Option<PathBuf>,
    /// Import a `.vrm` model into the models dir and exit, without booting
    /// the GUI.
    pub import_model: Option<PathBuf>,
    /// Start the Discord gateway receive worker after boot (opt-in; needs the
    /// token saved on the Discord settings page; never under --smoke).
    pub discord_gateway: bool,
    /// Start the AIRI gateway channel server on loopback (opt-in).
    ///
    /// Lives on `127.0.0.1` by default (set `SERVER_CHANNEL_PORT` to change
    /// the port, default 6121). The auth token lives in
    /// `<profile>/server-channel/config.json` (profiled launches) or the
    /// platform data dir otherwise (plain launches).
    pub gateway: bool,
}

impl Cli {
    /// Parse `--profile <dir>`, `--smoke`, `--import-card <file>`, `--import-model <file>`, `--gateway`, `--discord-gateway`.
    pub fn parse(args: impl Iterator<Item = String>) -> Self {
        let mut profile = None;
        let mut smoke = false;
        let mut import_card = None;
        let mut import_model = None;
        let mut gateway = false;
        let mut discord_gateway = false;
        let mut it = args.peekable();
        while let Some(arg) = it.next() {
            match arg.as_str() {
                "--profile" => {
                    if let Some(v) = it.next() {
                        profile = Some(PathBuf::from(v));
                    }
                }
                "--smoke" => smoke = true,
                "--gateway" => gateway = true,
                "--discord-gateway" => discord_gateway = true,
                "--import-card" => {
                    if let Some(v) = it.next() {
                        import_card = Some(PathBuf::from(v));
                    }
                }
                "--import-model" => {
                    if let Some(v) = it.next() {
                        import_model = Some(PathBuf::from(v));
                    }
                }
                _ if arg.starts_with("--profile=") => {
                    profile = Some(PathBuf::from(&arg["--profile=".len()..]));
                }
                _ if arg.starts_with("--import-card=") => {
                    import_card = Some(PathBuf::from(&arg["--import-card=".len()..]));
                }
                _ if arg.starts_with("--import-model=") => {
                    import_model = Some(PathBuf::from(&arg["--import-model=".len()..]));
                }
                _ => {}
            }
        }
        Self {
            profile,
            smoke,
            import_card,
            import_model,
            gateway,
            discord_gateway,
        }
    }
}

/// Import a character card into the cards dir and exit without booting the GUI.
///
/// With `--profile`, imports into `<profile>/cards`; otherwise into the
/// platform data dir (`<XDG_DATA_HOME|~/.local/share>/airi-qt/cards`) so the
/// default launch finds it. PNG (CCv2/v3) and JSON cards are supported; the
/// file is copied under a `<slug>-<nanos>.<ext>` name.
fn import_card_and_exit(
    profile_dir: &std::path::Path,
    profile_explicit: bool,
    card_file: &std::path::Path,
) -> ExitCode {
    let cards_dir = if profile_explicit {
        profile_dir.join("cards")
    } else {
        bridges::chat::card_import_dir().unwrap_or_else(|| profile_dir.join("cards"))
    };
    match bridges::chat::import_card_file(card_file, &cards_dir) {
        Ok((dest, name)) => {
            eprintln!(
                "[airi-qt] import-card: imported card {name:?} to {}",
                dest.display()
            );
            if profile_explicit {
                eprintln!(
                    "[airi-qt] import-card: launch with --profile {} to use it",
                    profile_dir.display()
                );
            }
            ExitCode::SUCCESS
        }
        Err(e) => {
            eprintln!("[airi-qt] import-card: {e}");
            ExitCode::FAILURE
        }
    }
}

/// Import a `.vrm` model into the models dir and exit without booting the
/// GUI.
///
/// With `--profile`, imports into `<profile>/models`; otherwise into the
/// platform data dir (`<XDG_DATA_HOME|~/.local/share>/airi-qt/models`) so the
/// default launch finds it. The stage settings page performs the same copy
/// through the `StageSettingsController.importModel` bridge invokable.
fn import_model_and_exit(
    profile_dir: &std::path::Path,
    profile_explicit: bool,
    model_file: &std::path::Path,
) -> ExitCode {
    let models_dir = if profile_explicit {
        profile_dir.join("models")
    } else {
        bridges::settings_stage::default_models_dir().unwrap_or_else(|| profile_dir.join("models"))
    };
    match bridges::settings_stage::import_model(model_file, &models_dir) {
        Ok(dest) => {
            eprintln!(
                "[airi-qt] import-model: imported {} to {}",
                model_file.display(),
                dest.display()
            );
            if profile_explicit {
                eprintln!(
                    "[airi-qt] import-model: launch with --profile {} to use it",
                    profile_dir.display()
                );
            }
            ExitCode::SUCCESS
        }
        Err(e) => {
            eprintln!("[airi-qt] import-model: {e}");
            ExitCode::FAILURE
        }
    }
}

fn main() -> ExitCode {
    // Force the static QML module (com.airi.airiqt) to link and run its
    // initializer so the engine can import it from the embedded resource.
    cxx_qt::init_qml_module!("com.airi.airiqt");
    let cli = Cli::parse(std::env::args().skip(1));
    let explicit_profile = cli.profile.is_some();
    unsafe { airi_install_message_handler() };

    let profile_dir = cli.profile.clone().unwrap_or_else(|| {
        if cli.smoke {
            std::env::temp_dir().join(format!("airi-qt-{}", std::process::id()))
        } else {
            // Default launches persist to the platform data dir — settings,
            // cards, models and mcp.json must survive restarts. `--smoke`
            // stays throwaway so the gate never touches user data.
            dirs::data_dir()
                .map(|d| d.join("airi-qt"))
                .unwrap_or_else(|| {
                    std::env::temp_dir().join(format!("airi-qt-{}", std::process::id()))
                })
        }
    });
    // Crash log capture (before any Qt/C++ calls). Logs land in the
    // effective data dir's `logs/` subdir: `<profile>/logs` for explicit
    // `--profile` and for `--smoke` (smoke isolates everything in a temp
    // profile), the platform data dir (`<XDG_DATA_HOME|~/.local/share>/airi-qt/logs`)
    // for default launches. Rust panics only — see airi_core::crashlog for limits.
    let log_dir = if explicit_profile || cli.smoke {
        profile_dir.join("logs")
    } else {
        airi_core::crashlog::PanicLogConfig::default_dir()
    };
    airi_core::crashlog::install_panic_hook(airi_core::crashlog::PanicLogConfig::with_dir(log_dir));
    if let Err(e) = std::fs::create_dir_all(&profile_dir) {
        eprintln!(
            "[airi-qt] failed to create profile dir {}: {e}",
            profile_dir.display()
        );
        return ExitCode::FAILURE;
    }
    if let Some(card_file) = &cli.import_card {
        return import_card_and_exit(&profile_dir, cli.profile.is_some(), card_file);
    }
    if let Some(model_file) = &cli.import_model {
        return import_model_and_exit(&profile_dir, cli.profile.is_some(), model_file);
    }
    // Single-instance lock (GUI path only; the one-shot `--import-*` commands
    // intentionally bypass it). Lock dir: explicit `--profile` → the profile,
    // `--smoke` without `--profile` → the throwaway temp profile (fresh lock),
    // otherwise the platform data dir (`dirs::data_dir()/airi-qt`). A stale
    // lock from a dead pid is reclaimed automatically; see airi_core::single_instance.
    let lock_dir = if explicit_profile || cli.smoke {
        profile_dir.clone()
    } else {
        airi_core::single_instance::default_lock_dir()
    };
    let _lock_guard = match airi_core::single_instance::acquire(&lock_dir) {
        Ok(guard) => guard,
        Err(airi_core::single_instance::SingleInstanceError::AlreadyRunning { pid, lock_path }) => {
            eprintln!(
                "[airi-qt] another instance running (pid {pid}); lock {}; exiting",
                lock_path.display()
            );
            return ExitCode::SUCCESS;
        }
        Err(e) => {
            eprintln!("[airi-qt] single-instance lock error: {e}");
            return ExitCode::FAILURE;
        }
    };

    let db_path = profile_dir.join("airi.sqlite");

    let _ = tracing_subscriber::fmt()
        .with_env_filter(tracing_subscriber::EnvFilter::from_default_env())
        .try_init();

    // Tokio runtime (P1 services will live here); kept alive for the process lifetime.
    let rt = match tokio::runtime::Builder::new_multi_thread()
        .enable_all()
        .build()
    {
        Ok(rt) => rt,
        Err(e) => {
            eprintln!("[airi-qt] failed to build tokio runtime: {e}");
            return ExitCode::FAILURE;
        }
    };
    let _rt_guard = rt.enter();
    bridges::set_runtime_handle(rt.handle().clone());

    eprintln!(
        "[airi-qt] starting v{}, profile={} smoke={}",
        env!("CARGO_PKG_VERSION"),
        profile_dir.display(),
        cli.smoke
    );

    // Open the store against the profile dir (isolated when --profile is passed),
    // then register a SettingsStore for the QML bridges (theme/locale persistence).
    // `_lock_guard` (acquired above) is still alive here, so no second process can
    // reach this `airi.sqlite` until this one exits.
    let mut gateway_db: Option<airi_store::Database> = None;

    let store_path = db_path.to_string_lossy().into_owned();
    match airi_store::Database::open(&db_path) {
        Ok(db) => {
            eprintln!("[airi-qt] store ready at {store_path}");
            gateway_db = Some(db.clone());
            let (bus, _rx) = tokio::sync::broadcast::channel(8);
            bridges::set_provider_repo(airi_store::ProviderRepo::new(db.clone()));
            bridges::chat::set_chat_context(airi_core::ChatService::new(db.clone()), db.clone());
            bridges::set_database(db.clone());
            bridges::set_settings_store(airi_core::settings::SettingsStore::new(db, bus));
        }
        Err(e) => eprintln!("[airi-qt] store warning: {e}"),
    }
    // The guard is never dropped explicitly — it stays alive to the end of `main`
    // so the lock outlives every DB clone handed to the bridges and services
    // above; dropping it here would reopen the two-process write race.

    bridges::set_smoke(cli.smoke);

    // Opt-in AIRI gateway channel server (loopback-first; plaintext token
    // file — same posture as the Electron main service). Off by default.
    let gateway_handle: Option<airi_channel::ServerHandle> = cli
        .gateway
        .then(|| {
            let config_path = if explicit_profile || cli.smoke {
                Some(profile_dir.join("server-channel").join("config.json"))
            } else {
                airi_channel::default_config_path()
            };
            let Some(config_path) = config_path else {
                eprintln!("[airi-qt] gateway: no config path available; not starting");
                return None;
            };
            let config = match airi_channel::load_or_heal(&config_path) {
                Ok(c) => c,
                Err(e) => {
                    eprintln!("[airi-qt] gateway: failed to load config: {e}");
                    return None;
                }
            };
            let port = airi_channel::server_channel_port();
            let server = match &gateway_db {
                Some(db) => airi_channel::ChannelServer::bind_with_renderer(
                    &config.hostname,
                    port,
                    &config,
                    gateway_handlers::build(db.clone()),
                ),
                None => airi_channel::ChannelServer::bind(&config.hostname, port, &config),
            };
            match server.and_then(|s| s.spawn()) {
                Ok(handle) => {
                    eprintln!(
                        "[airi-qt] gateway: listening on {}:{} (token at {})",
                        config.hostname,
                        handle.port(),
                        config_path.display()
                    );
                    Some(handle)
                }
                Err(e) => {
                    eprintln!(
                        "[airi-qt] gateway: failed to start on {}:{}: {e}",
                        config.hostname, port
                    );
                    None
                }
            }
        })
        .flatten();
    // Held for the app lifetime; the accept loop stops on process exit.
    let _gateway_handle = gateway_handle;

    // Opt-in Discord gateway receive worker (off unless --discord-gateway is
    // passed; never under --smoke). Same rails as the Start button on the
    // Discord settings page — refuses cleanly when no token is configured.
    if cli.discord_gateway && !cli.smoke && !crate::bridges::discord_gateway::start_from_main() {
        eprintln!("[airi-qt] discord-gateway: autostart requested but not started (see the Discord settings page)");
    }

    if cli.smoke {
        crate::spine_rt::spine_smoke_check();
    }
    bridges::set_profile_dir(profile_dir.clone());
    // Desktop integration (tray + global hotkeys). No-op under --smoke.
    bridges::desktop::init();
    bridges::set_profile_explicit(explicit_profile);
    if cli.smoke {
        bridges::chat::smoke_register_mock_provider();
    }

    eprintln!(
        "[airi-qt] i18n embedded: {} locales, {} keys",
        airi_i18n::locale_count(),
        airi_i18n::key_count()
    );

    let mut app = QGuiApplication::new();
    let mut engine = QQmlApplicationEngine::new();

    // Wire load-failure diagnostics before loading so a bad QML module can
    // never exit silently.
    if let Some(engine) = engine.as_mut() {
        engine
            .on_object_creation_failed(|_, url| {
                eprintln!("[airi-qt] QML object creation FAILED: {url}");
            })
            .release();
    }

    if let Some(engine) = engine.as_mut() {
        engine.load(&QUrl::from("qrc:/qt/qml/com/airi/airiqt/qml/Main.qml"));
    }

    if let Some(engine) = engine.as_mut() {
        let engine: Pin<&mut QQmlEngine> = engine.upcast_pin();
        engine
            .on_quit(|_| {
                eprintln!("[airi-qt] QML quit");
            })
            .release();
    }

    if cli.smoke {
        // Pump the event loop so the Splash can walk its milestones, open the
        // Control Strip, and open the Chat/Settings/About/Stage windows.
        // Wait until the tour reaches About AND the chat smoke ping streamed
        // to completion AND the stage scene ticked (or the deadline hits).
        // The chat leg is real: the smoke ChatWindow sends a message through
        // `ChatController` into a local OpenAI-compatible SSE mock, so a
        // broken chat path fails the smoke. The stage leg pumps
        // `skinAndMorph` ~30 times; a missing bundled default model is NOT
        // an error (ticks still run).
        let deadline = Instant::now() + Duration::from_secs(10);
        loop {
            if let Some(app) = app.as_mut() {
                app.process_events();
            }
            let visited = bridges::windows::smoke_visited();
            let chat_done = bridges::chat::smoke_chat_outcome().is_some();
            let stage_done =
                bridges::stage::smoke_skin_ticks() >= 30 || bridges::mmd::smoke_skin_ticks() >= 30;
            if visited.iter().any(|page| page == "about") && chat_done && stage_done {
                break;
            }
            if Instant::now() >= deadline {
                eprintln!(
                    "[airi-qt] smoke: deadline reached (chat outcome: {})",
                    bridges::chat::smoke_chat_outcome().unwrap_or("missing")
                );
                break;
            }
            std::thread::sleep(Duration::from_millis(50));
        }
        let visited = bridges::windows::smoke_visited();
        let outcome = bridges::chat::smoke_chat_outcome().unwrap_or("missing");
        let deltas = bridges::chat::smoke_delta_count();
        let stage_ticks = bridges::stage::smoke_skin_ticks() + bridges::mmd::smoke_skin_ticks();
        eprintln!("[airi-qt] smoke: pages visited: {}", visited.join(", "));
        eprintln!("[airi-qt] smoke: chat outcome: {outcome} ({deltas} deltas applied)");
        eprintln!("[airi-qt] smoke: stage skinAndMorph ticks: {stage_ticks}");
        if outcome != "done" || deltas == 0 {
            eprintln!("[airi-qt] smoke: FAIL — chat stream did not complete");
            return ExitCode::FAILURE;
        }
        if stage_ticks < 30 {
            eprintln!("[airi-qt] smoke: FAIL — stage scene did not tick (model load is non-fatal; ticks must still run)");
            return ExitCode::FAILURE;
        }
        return ExitCode::SUCCESS;
    }

    if let Some(app) = app.as_mut() {
        app.exec();
    }
    eprintln!("[airi-qt] exiting 0");
    ExitCode::SUCCESS
}

#[cfg(test)]
mod tests {
    /// Spike record: cxx-qt 0.10 cannot subclass QAbstractListModel from Rust,
    /// so the chat list-model uses the documented fallback (see docs/bridge-pattern.md).
    #[test]
    fn bridge_pattern_spike_is_recorded() {
        let manifest_dir = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"));
        let doc = manifest_dir.join("../../docs/bridge-pattern.md");
        let content = std::fs::read_to_string(&doc).expect("read docs/bridge-pattern.md");
        assert!(content.contains("QAbstractListModel"));
        assert!(content.contains("QList<QObject*>"));
        assert!(content.contains("chunkAppended"));
    }
}
