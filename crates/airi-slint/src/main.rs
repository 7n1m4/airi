// SPDX-License-Identifier: GPL-3.0-or-later
#![deny(missing_docs)]

//! airi-slint: Slint-based desktop shell for AIRI.
//!
//! Boots the process-wide state the bridges need (profile directory, settings
//! store, database, provider repo, Tokio runtime), then hands control to the
//! Slint event loop with the `MainWindow` from `bootstrap.slint`.
//!
//! Flags: `--profile <dir>`, `--smoke`, `--spine-model <path>`, `--help`.
//! `--smoke` runs a headless spine check and exits without opening a window.

use std::path::PathBuf;

use airi_slint::bridges::{self, spine::with_controller};
use airi_slint::{AboutWindow, ChatWindow, MainWindow, SettingsWindow, spine_rt};

/// Directory name under the platform data dir for this app's profile.
const APP_DIR_NAME: &str = "airi-slint";

/// Parsed command line.
#[derive(Debug, Default)]
struct Cli {
    /// Override the profile directory (defaults to `<data>/airi-slint`).
    profile: Option<PathBuf>,
    /// Run the headless smoke check and exit.
    smoke: bool,
    /// Load this spine bundle before showing the stage.
    spine_model: Option<String>,
    /// Print usage and exit.
    help: bool,
}

fn main() {
    airi_channel::install_default_crypto_provider();
    let cli = parse_cli(std::env::args().skip(1));

    if cli.help {
        print_usage();
        return;
    }

    // `--smoke` is a headless check: it must not open a window or need a
    // profile. Set the bridge flag first so the bridges report visits.
    bridges::set_smoke(cli.smoke);
    if cli.smoke {
        let ok = spine_rt::spine_smoke_check();
        for page in bridges::windows::smoke_visited() {
            eprintln!("[airi-slint] smoke: visited {page}");
        }
        std::process::exit(i32::from(!ok));
    }

    let profile = resolve_profile(&cli);
    bridges::set_profile_dir(profile.clone());
    bridges::set_profile_explicit(cli.profile.is_some());

    let db = airi_store::Database::open(&profile.join("airi.sqlite"))
        .expect("failed to open the application database");
    bridges::set_database(db.clone());

    let bus = tokio::sync::broadcast::channel(64).0;
    let store = airi_core::settings::SettingsStore::new(db.clone(), bus);
    bridges::set_settings_store(store);

    let provider_repo = airi_store::ProviderRepo::new(db.clone());
    bridges::set_provider_repo(provider_repo);

    // The bridges spawn async work (LLM turns, speech, sync) and need a
    // runtime handle; they never own the runtime.
    let runtime = tokio::runtime::Builder::new_multi_thread()
        .enable_all()
        .build()
        .expect("failed to build the async runtime");
    bridges::set_runtime_handle(runtime.handle().clone());

    if let Some(path) = &cli.spine_model {
        let ok = with_controller(|c| c.load_model(path));
        eprintln!("[airi-slint] load_model({path}) -> {ok}");
    }

    bridges::shell::with_state(|shell| shell.ready());

    if let Err(error) = run_ui() {
        eprintln!("[airi-slint] UI failed: {error}");
        std::process::exit(1);
    }

    // Keep the runtime alive until the UI is done with it.
    drop(runtime);
}

/// Build every Slint shell window on the UI thread, wire each one to the Rust
/// bridges, show them, then run one event loop.
///
/// `MainWindow` is the bootstrap host: it owns the splash and the always-on-top
/// control strip. Chat / Settings / About are separate top-level `Window`
/// components (Slint does not nest `Window` subclasses), so they are created
/// here and shown on demand from the strip's callbacks.
fn run_ui() -> Result<(), slint::PlatformError> {
    use slint::{ComponentHandle, SharedString};

    let main_window = MainWindow::new()?;

    // Strip callbacks. The bootstrap owns splash→strip visibility, so only the
    // strip-openable windows need to be brought up from here.
    let chat = ChatWindow::new()?;
    let settings = SettingsWindow::new()?;
    let about = AboutWindow::new()?;

    // Each window is a real top-level window with its own adapter, so the
    // splash and the strip need a window to show themselves on; the bootstrap
    // hosts them, and the shell windows sit alongside it.
    let weak_main = main_window.as_weak();
    let weak_chat = chat.as_weak();
    let weak_settings = settings.as_weak();
    let weak_about = about.as_weak();

    // Locale: one process-wide i18n bridge feeds every window.
    let locale = bridges::i18n::with_state(|state| state.locale.clone());
    let locale = SharedString::from(locale);
    main_window.set_locale(locale.clone());
    chat.set_locale(locale.clone());
    settings.set_locale(locale.clone());
    about.set_locale(locale.clone());
    about.set_app_version(SharedString::from(env!("CARGO_PKG_VERSION")));

    // ---- Chat window wiring ---------------------------------------------
    let weak_chat_for_send = weak_chat.clone();
    chat.on_send(move |text| {
        let text: &str = text.as_str();
        if text.trim().is_empty() {
            return;
        }
        bridges::chat::with_state(|state| state.send(text));
        if let Some(chat) = weak_chat_for_send.upgrade() {
            sync_chat_view(&chat);
        }
    });
    chat.on_clear_error(|| {
        bridges::chat::with_state(|state| state.clear_error());
    });
    let weak_chat_for_select = weak_chat.clone();
    chat.on_select_session(move |id| {
        let id = id.to_string();
        bridges::chat::with_state(|state| state.select_session(&id));
        if let Some(chat) = weak_chat_for_select.upgrade() {
            sync_chat_view(&chat);
        }
    });
    let weak_chat_for_pump = weak_chat.clone();
    chat.on_pump_events(move || {
        // Driven by the 33 ms timer in ChatWindow.slint while streaming.
        bridges::chat::with_state(|state| {
            let _ = state.drain_events();
        });
        if let Some(chat) = weak_chat_for_pump.upgrade() {
            sync_chat_view(&chat);
        }
    });

    // ---- Settings window wiring ----------------------------------------
    let weak_settings_for_nav = weak_settings.clone();
    settings.on_navigate(move |index| {
        let index = index as usize;
        eprintln!("[airi-slint] settings: navigate {index}");
        if let Some(settings) = weak_settings_for_nav.upgrade() {
            settings.set_nav_index(index as i32);
        }
    });

    // ---- About window wiring -------------------------------------------
    let weak_about_for_check = weak_about.clone();
    about.on_check_update(move || {
        let result = bridges::update::with_state(|state| state.check_update());
        if let Some(about) = weak_about_for_check.upgrade() {
            about.set_update_result(SharedString::from(result));
        }
    });
    about.on_open_url_externally(|url| {
        eprintln!("[airi-slint] open url: {}", url.as_str());
    });

    // ---- Strip callbacks ------------------------------------------------
    main_window.on_open_chat(move || {
        bridges::windows::with_state(|state| {
            state.open_window("chat", Default::default());
            state.visited("chat");
        });
        if let Some(chat) = weak_chat.upgrade() {
            sync_chat_view(&chat);
            let _ = chat.show();
        }
        eprintln!("[airi-slint] open chat");
    });
    main_window.on_open_settings(move || {
        bridges::windows::with_state(|state| {
            state.open_window("settings", Default::default());
            state.visited("settings");
        });
        if let Some(settings) = weak_settings.upgrade() {
            let _ = settings.show();
        }
        eprintln!("[airi-slint] open settings");
    });
    main_window.on_open_about(move || {
        bridges::windows::with_state(|state| {
            state.open_window("about", Default::default());
            state.visited("about");
        });
        if let Some(about) = weak_about.upgrade() {
            let _ = about.show();
        }
        eprintln!("[airi-slint] open about");
    });
    main_window.on_toggle_stage(|| {
        eprintln!("[airi-slint] toggle stage");
    });
    main_window.on_save_captions(|| {
        eprintln!("[airi-slint] save captions");
    });
    main_window.on_splash_finished(move || {
        if let Some(window) = weak_main.upgrade() {
            window.set_strip_visible(true);
        }
    });
    main_window.on_visited(|| {
        bridges::windows::with_state(|state| state.visited("splash"));
    });
    main_window.on_smoke_tour(|| {
        for page in ["control-strip", "chat", "settings"] {
            bridges::windows::with_state(|state| state.visited(page));
        }
    });
    main_window.on_quit(|| {
        let _ = slint::quit_event_loop();
    });

    let _ = main_window.show();
    slint::run_event_loop()
}

/// Push the Rust chat state into the window's properties.
///
/// `ChatView` is a plain snapshot (`ChatState::view()`), so this is a pure
/// translation: no service call happens here.
fn sync_chat_view(window: &airi_slint::ChatWindow) {
    use slint::SharedString;

    let view = bridges::chat::with_state(|state| state.view());
    window.set_streaming(view.streaming);
    window.set_error(SharedString::from(view.error));
    window.set_transcript(slint::ModelRc::from(std::rc::Rc::new(slint::VecModel::from(
        view.messages
            .into_iter()
            .map(|message| SharedString::from(format!("{}: {}", message.role, message.content)))
            .collect::<Vec<_>>(),
    ))));
    window.set_sessions(slint::ModelRc::from(std::rc::Rc::new(slint::VecModel::from(
        view.sessions
            .into_iter()
            .map(|session| SharedString::from(session.title))
            .collect::<Vec<_>>(),
    ))));
}

/// The profile directory: `--profile` when given, else `<data>/airi-slint`.
fn resolve_profile(cli: &Cli) -> PathBuf {
    if let Some(dir) = &cli.profile {
        return dir.clone();
    }
    dirs::data_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join(APP_DIR_NAME)
}

/// Print the command-line usage.
fn print_usage() {
    println!(
        "airi-slint — AIRI desktop shell\n\
         \n\
         USAGE:\n    \
         airi-slint [OPTIONS]\n\
         \n\
         OPTIONS:\n    \
         --profile <dir>       use <dir> for settings, cards and the database\n    \
         --smoke               run the headless spine check and exit\n    \
         --spine-model <path>  load this spine bundle before showing the stage\n    \
         --help                print this help"
    );
}

/// Parse the CLI, warning about anything unrecognised.
fn parse_cli(args: impl Iterator<Item = String>) -> Cli {
    let mut cli = Cli::default();
    let mut iter = args;
    while let Some(arg) = iter.next() {
        match arg.as_str() {
            "--smoke" => cli.smoke = true,
            "--help" | "-h" => cli.help = true,
            "--spine-model" => cli.spine_model = iter.next(),
            "--profile" => cli.profile = iter.next().map(PathBuf::from),
            other => eprintln!("[airi-slint] unknown argument: {other}"),
        }
    }
    cli
}

#[cfg(test)]
mod tests {
    use super::*;

    fn parse(args: &[&str]) -> Cli {
        parse_cli(args.iter().map(|arg| (*arg).to_owned()))
    }

    #[test]
    fn defaults_when_empty() {
        let cli = parse(&[]);
        assert!(!cli.smoke);
        assert!(!cli.help);
        assert!(cli.profile.is_none());
        assert!(cli.spine_model.is_none());
    }

    #[test]
    fn profile_takes_the_next_value() {
        let cli = parse(&["--profile", "/tmp/airi-test-profile"]);
        assert_eq!(
            cli.profile.as_deref(),
            Some(std::path::Path::new("/tmp/airi-test-profile"))
        );
    }
}
