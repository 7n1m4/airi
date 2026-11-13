// SPDX-License-Identifier: GPL-3.0-or-later
//! airi-daemon — AIRI user-session awareness daemon.
//!
//! Owns `org.moeru.airi.Daemon1` on the session bus, watches six T0 sources
//! (logind sleep, screensaver lock, MPRIS playback, NetworkManager state,
//! UPower on-battery, systemd1 unit failure watch via `units`) plus one
//! strictly opt-in AT-SPI screen source (`screen`, focus metadata only,
//! digest on demand), keeps an in-memory
//! ring (cap 200), appends to a redacted audit JSONL (7-day retention,
//! pruned at startup), and answers control RPCs on `org.moeru.airi.Daemon1`.
//!
//! Modes:
//!   (no args) | --foreground   run the daemon (default)
//!   --selftest                 probe buses + match rules, print capabilities, exit 0
//!   --version                  print version, exit 0
//!   --help                     print usage, exit 0
//!
//! Rails: no network, no root, no eBPF, no secrets, append-only audit,
//! kill switch drops everything pre-audit, user flag wins over lockdown.

mod audit;
mod control;
mod gateway;
mod observe;
mod redact;
mod ring;
mod screen;
mod state;
mod wake_facts;

use std::collections::HashMap;
use std::process::exit;
use std::time::{Duration, Instant};

use airi_a11y::{A11yClient, FocusCache};
use dbus::blocking::Connection;
use dbus::channel::Sender;
use dbus::MessageType;

use audit::{default_audit_path, now_ms, AuditLog};
use control::{
    get_status_json, handle_method_call, StatusContext, BUS_NAME, INTERFACE, PROTOCOL, VERSION,
};
use observe::{Bus, LockdownChange};
use ring::{Ring, RingEvent};
use state::{Awareness, LockdownReason, Source};
use wake_facts::WakeFacts;

const RATE_LIMIT_WINDOW_MS: u64 = 250;
const RATE_LIMIT_AUDIT_PERIOD: Duration = Duration::from_secs(60);

#[derive(Debug, PartialEq, Eq)]
enum Mode {
    /// Run with the gateway hosted (default).
    Run,
    /// Run without the gateway (dev machines where the desktop app hosts it).
    RunNoGateway,
    SelfTest,
    Version,
    Help,
}

fn parse_args(args: &[String]) -> Result<Mode, String> {
    match args {
        [] => Ok(Mode::Run),
        [one] => match one.as_str() {
            "--foreground" => Ok(Mode::Run),
            "--no-gateway" => Ok(Mode::RunNoGateway),
            "--selftest" => Ok(Mode::SelfTest),
            "--version" | "-V" | "-v" => Ok(Mode::Version),
            "--help" | "-h" | "-?" => Ok(Mode::Help),
            other => Err(format!("unknown argument '{other}'")),
        },
        many => Err(format!("unexpected arguments: {}", many.join(" "))),
    }
}

fn usage() {
    eprintln!(
        "airi-daemon {VERSION} (protocol {PROTOCOL}) — AIRI user-session awareness daemon\n\
         usage:\n\
         \x20 airi-daemon              run (same as --foreground)\n\
         \x20 airi-daemon --foreground run in foreground\n\
         \x20 airi-daemon --selftest   print buses/match-rule capabilities, exit 0\n\
         \x20 airi-daemon --version    print version, exit 0\n\
         \x20 airi-daemon --help       print this help, exit 0"
    );
}

fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    match parse_args(&args) {
        Ok(Mode::Run) => run(true),
        Ok(Mode::RunNoGateway) => run(false),
        Ok(Mode::SelfTest) => selftest(),
        Ok(Mode::Version) => println!("airi-daemon {VERSION} (protocol {PROTOCOL})"),
        Ok(Mode::Help) => usage(),
        Err(e) => {
            eprintln!("airi-daemon: {e}");
            usage();
            exit(2);
        }
    }
}

fn run(gateway_enabled: bool) {
    eprintln!("airi-daemon: starting (protocol {PROTOCOL}, version {VERSION})");

    // Audit first: prune-on-start must happen before any append.
    let audit_path = default_audit_path();
    let (audit, audit_path_str, audit_pruned) = match &audit_path {
        Some(p) => {
            let log = AuditLog::open(p.clone());
            let pruned = log.prune_on_start(now_ms());
            eprintln!(
                "airi-daemon: audit log at {} (pruned {pruned} line(s) older than 7 days)",
                p.display()
            );
            (log, p.display().to_string(), pruned)
        }
        None => {
            eprintln!("airi-daemon: cannot resolve a data dir; audit log disabled for this run");
            let log = AuditLog::open(std::path::PathBuf::from(
                "/nonexistent/airi-daemon-disabled.jsonl",
            ));
            (log, String::new(), 0)
        }
    };

    // Session bus is mandatory (own name). System bus is optional (read-only
    // eyes) and degrades honestly when absent.
    let session = match Connection::new_session() {
        Ok(c) => c,
        Err(e) => {
            eprintln!("airi-daemon: cannot connect to the session bus: {e}");
            eprintln!("airi-daemon: org.moeru.airi.Daemon1 cannot be owned; exiting (systemd Restart=on-failure will retry, bounded)");
            exit(1);
        }
    };
    match session.request_name(BUS_NAME, false, false, true) {
        Ok(dbus::blocking::stdintf::org_freedesktop_dbus::RequestNameReply::PrimaryOwner)
        | Ok(dbus::blocking::stdintf::org_freedesktop_dbus::RequestNameReply::AlreadyOwner) => {
            eprintln!("airi-daemon: owns {BUS_NAME} on the session bus");
        }
        Ok(other) => {
            eprintln!("airi-daemon: could not own {BUS_NAME} (reply: {other:?}); another instance is running. Exiting.");
            exit(1);
        }
        Err(e) => {
            eprintln!("airi-daemon: failed to request name {BUS_NAME}: {e}. Exiting.");
            exit(1);
        }
    }

    let mut system: Option<Connection> = match Connection::new_system() {
        Ok(c) => {
            eprintln!("airi-daemon: connected to the system bus (read-only eyes: logind, NetworkManager, UPower, systemd1)");
            Some(c)
        }
        Err(e) => {
            eprintln!(
                "airi-daemon: no system bus ({e}); sleep/network/power/units sources stay unavailable"
            );
            None
        }
    };

    let mut awareness = Awareness::new();
    let mut wake = WakeFacts::new();
    let mut ring = Ring::with_default_cap();
    let mut session_ok = true;
    let mut system_ok = system.is_some();
    let mut availability: HashMap<Source, bool> = Source::ALL.iter().map(|s| (*s, true)).collect();

    // --- Screen awareness (AT-SPI). Strictly opt-in; degrades honestly. ---
    let mut a11y_client = init_screen_awareness(&session);
    availability.insert(Source::Screen, a11y_client.is_some());
    let mut focus_cache = FocusCache::default();
    let mut exclusions = match screen::exclusions_path() {
        Some(path) => screen::Exclusions::load(path),
        None => {
            eprintln!("airi-daemon: no data dir; exclusions are in-memory only for this run");
            screen::Exclusions::in_memory()
        }
    };

    // Install match rules. A rule that fails to install means the source is
    // best-effort unavailable on this bus — noted, never fatal.
    for (source, bus, rule) in observe::MATCH_RULES {
        let target = match bus {
            Bus::Session => Some(&session),
            Bus::System => system.as_ref(),
        };
        match target {
            Some(conn) => match conn.add_match_no_cb(rule) {
                Ok(()) => {}
                Err(e) => {
                    eprintln!("airi-daemon: match rule rejected for {:?} ({bus:?}): {e}; source best-effort unavailable", source.name());
                    availability.insert(*source, false);
                }
            },
            None => {
                availability.insert(*source, false);
            }
        }
    }

    // Startup availability summary — honest about what is and is not armed.
    let mut avail: Vec<&str> = availability
        .iter()
        .filter(|(_, &ok)| ok)
        .map(|(s, _)| s.name())
        .collect();
    let mut unavail: Vec<&str> = availability
        .iter()
        .filter(|(_, &ok)| !ok)
        .map(|(s, _)| s.name())
        .collect();
    avail.sort_unstable();
    unavail.sort_unstable();
    eprintln!(
        "airi-daemon: sources armed: {}; unavailable: {}",
        avail.join(","),
        if unavail.is_empty() {
            "none".into()
        } else {
            unavail.join(",")
        }
    );

    // Gateway (WS on 6121, optional TLS). Always created so D-Bus callers
    // get an honest answer; failure is captured in `bound: false` +
    // `last_error`, never fatal to awareness.
    let gateway = if gateway_enabled {
        eprintln!("airi-daemon: hosting the gateway (port from SERVER_CHANNEL_PORT, else 6121)");
        gateway::Gateway::start()
    } else {
        eprintln!("airi-daemon: gateway disabled (--no-gateway); awareness continues");
        gateway::Gateway::start_disabled("disabled (--no-gateway)")
    };

    let mut debounce: HashMap<(String, String), u64> = HashMap::new();
    let mut rate_limited_drops: u64 = 0;
    let mut last_rate_limit_audit = Instant::now();

    loop {
        // Recover the gateway bind if the port was busy at startup (e.g. the
        // desktop app still hosts its own server). Internally rate-limited;
        // a no-op when bound.
        gateway.maybe_retry();

        // --- Session bus ---
        match session
            .channel()
            .blocking_pop_message(Duration::from_millis(20))
        {
            Ok(Some(msg)) => {
                session_ok = true;
                let digest_fn = |excl: &screen::Exclusions| {
                    screen::digest_json(a11y_client.as_ref(), &focus_cache, excl)
                };
                let mut ctx = LoopCtx {
                    awareness: &mut awareness,
                    ring: &mut ring,
                    audit: &audit,
                    debounce: &mut debounce,
                    rate_limited_drops: &mut rate_limited_drops,
                    session_ok,
                    system_ok,
                    audit_path: &audit_path_str,
                    audit_pruned,
                    digest: &digest_fn,
                    exclusions: &mut exclusions,
                    wake: &mut wake,
                    gateway: &gateway,
                };
                handle_message(Bus::Session, msg, &session, &mut ctx);
            }
            Ok(None) => {}
            Err(e) => {
                // No automatic in-process reconnect: if the session bus dies,
                // the Type=dbus semantics say systemd should restart us. We
                // stay alive (never panic), mark session eyes unavailable, and
                // keep serving the system bus; journal shows the truth.
                if session_ok {
                    eprintln!("airi-daemon: session bus error: {e}; session sources unavailable until restart (systemd Restart=on-failure is the retry story); no panic");
                    session_ok = false;
                    for (source, bus, _) in observe::MATCH_RULES {
                        if *bus == Bus::Session {
                            availability.insert(*source, false);
                        }
                    }
                }
                // Avoid a 100% CPU spin on a dead fd.
                std::thread::sleep(Duration::from_millis(500));
            }
        }

        // --- System bus ---
        if let Some(sys) = &system {
            match sys.channel().blocking_pop_message(Duration::from_millis(0)) {
                Ok(Some(msg)) => {
                    system_ok = true;
                    let digest_fn = |excl: &screen::Exclusions| {
                        screen::digest_json(a11y_client.as_ref(), &focus_cache, excl)
                    };
                    let mut ctx = LoopCtx {
                        awareness: &mut awareness,
                        ring: &mut ring,
                        audit: &audit,
                        debounce: &mut debounce,
                        rate_limited_drops: &mut rate_limited_drops,
                        session_ok,
                        system_ok,
                        audit_path: &audit_path_str,
                        audit_pruned,
                        digest: &digest_fn,
                        exclusions: &mut exclusions,
                        wake: &mut wake,
                        gateway: &gateway,
                    };
                    handle_message(Bus::System, msg, sys, &mut ctx);
                }
                Ok(None) => {}
                Err(e) => {
                    if system_ok {
                        eprintln!("airi-daemon: system bus error: {e}; system sources marked unavailable (no panic)");
                        system_ok = false;
                        for (source, bus, _) in observe::MATCH_RULES {
                            if *bus == Bus::System {
                                availability.insert(*source, false);
                            }
                        }
                    }
                    // Drop the dead connection; system eyes degrade to absent.
                    system = None;
                }
            }
        } else if system_ok {
            // Was connected, now gone.
            system_ok = false;
        }

        // --- a11y bus (screen awareness) — zero-wait poll in the same loop ---
        if let Some(client) = &a11y_client {
            match client.poll_focus() {
                Ok(Some(update)) => {
                    if awareness.effective_armed(Source::Screen) {
                        if let Some(meta) = screen::resolve_focus_event(
                            client,
                            &update,
                            &mut focus_cache,
                            &exclusions,
                        ) {
                            screen::record_focus_event(&meta, &mut ring, &audit);
                        }
                    } else {
                        // Paused/locked/disarmed: observe nothing, remember nothing.
                        focus_cache = FocusCache::default();
                    }
                }
                Ok(None) => {}
                Err(e) => {
                    eprintln!("airi-daemon: a11y bus error: {e}; screen source disarmed for the rest of this run (no panic)");
                    a11y_client = None;
                    availability.insert(Source::Screen, false);
                    audit.append(
                        "screen",
                        "screen unavailable",
                        "a11y bus read error; screen source disarmed for the rest of this run",
                    );
                }
            }
        }

        // --- Rate-limit drop counter, at most once per minute ---
        if rate_limited_drops > 0 && last_rate_limit_audit.elapsed() >= RATE_LIMIT_AUDIT_PERIOD {
            audit.append(
                "system",
                "rate-limited",
                &format!("dropped {rate_limited_drops} debounced change signals"),
            );
            rate_limited_drops = 0;
            last_rate_limit_audit = Instant::now();
        }
    }
}

/// Screen awareness (AT-SPI) startup negotiation. Never fails hard: on any
/// step the `screen` source stays disarmed with an honest status line, and
/// the daemon keeps running. Returns `None` when the a11y bus is unusable.
fn init_screen_awareness(session: &Connection) -> Option<A11yClient> {
    let probe = airi_a11y::probe(session);
    eprintln!("airi-daemon: a11y (session bus): {}", probe.summary_line());
    let address = probe.address.clone()?;
    match A11yClient::connect(&address) {
        Ok(client) => {
            let mut any_ok = false;
            for (rule, result) in client.add_focus_match_rules() {
                match result {
                    Ok(()) => {
                        any_ok = true;
                        eprintln!("airi-daemon: a11y focus match rule armed (screen): {rule}");
                    }
                    Err(e) => {
                        eprintln!("airi-daemon: a11y focus match rule rejected (screen): {e}; rule: {rule}");
                    }
                }
            }
            if any_ok {
                Some(client)
            } else {
                eprintln!(
                    "airi-daemon: both a11y focus match rules rejected; screen source unavailable"
                );
                None
            }
        }
        Err(e) => {
            eprintln!("airi-daemon: {e}; screen source unavailable (the desktop may not ship an a11y bus — GNOME/KDE do, minimal WMs may not)");
            None
        }
    }
}

struct LoopCtx<'a> {
    awareness: &'a mut Awareness,
    ring: &'a mut Ring,
    audit: &'a AuditLog,
    debounce: &'a mut HashMap<(String, String), u64>,
    rate_limited_drops: &'a mut u64,
    session_ok: bool,
    system_ok: bool,
    audit_path: &'a str,
    audit_pruned: u64,
    digest: &'a dyn Fn(&screen::Exclusions) -> String,
    exclusions: &'a mut screen::Exclusions,
    /// Wake/suspend facts for the morning briefing (in-memory only).
    wake: &'a mut WakeFacts,
    /// Gateway hosting state (WS on 6121). Shared, immutable to the handler.
    gateway: &'a gateway::Gateway,
}

fn handle_message(bus: Bus, msg: dbus::Message, conn: &Connection, ctx: &mut LoopCtx<'_>) {
    match msg.msg_type() {
        MessageType::MethodCall => {
            if bus != Bus::Session {
                return; // method calls are answered where we own the name
            }
            // Snapshot the wake facts for the status closure (small owned copy).
            let wake_snapshot = ctx.wake.clone();
            let gw = ctx.gateway;
            let audit = ctx.audit;
            let gateway_fn = |req: gateway::GatewayRequest| {
                let reply = gw.handle(&req);
                let mutated = match &req {
                    gateway::GatewayRequest::Apply(_) => {
                        serde_json::from_str::<serde_json::Value>(&reply)
                            .map(|v| v.get("ok") != Some(&serde_json::Value::Bool(false)))
                            .unwrap_or(false)
                    }
                    gateway::GatewayRequest::RegenerateToken => {
                        serde_json::from_str::<serde_json::Value>(&reply)
                            .map(|v| v.get("authToken").is_some())
                            .unwrap_or(false)
                    }
                    gateway::GatewayRequest::Get => false,
                };
                if mutated {
                    match &req {
                        gateway::GatewayRequest::Apply(_) => audit.append(
                            "gateway",
                            "gateway: config applied",
                            "hostname/TLS/token updated via D-Bus",
                        ),
                        gateway::GatewayRequest::RegenerateToken => audit.append(
                            "gateway",
                            "gateway: auth token regenerated",
                            "token rotated via D-Bus; new connections must re-authenticate",
                        ),
                        _ => {}
                    }
                }
                reply
            };
            let reply = handle_method_call(
                &msg,
                ctx.awareness,
                ctx.audit,
                ctx.ring,
                &|aware, count| {
                    get_status_json(&StatusContext {
                        awareness: aware,
                        ring_count: count,
                        audit_path: ctx.audit_path,
                        session_bus: ctx.session_ok,
                        system_bus: ctx.system_ok,
                        audit_pruned: ctx.audit_pruned,
                        wake: &wake_snapshot,
                    })
                },
                ctx.digest,
                ctx.exclusions,
                &gateway_fn,
            );
            if let Some(reply) = reply {
                // Best-effort reply; a dead peer is not our problem.
                let _ = conn.send(reply);
            }
        }
        MessageType::Signal => {
            let now = now_ms();

            // systemd1 `JobRemoved` is outcome-bearing (done vs. failure) and
            // bypasses the generic parser entirely — see `handle_unit_job`.
            if bus == Bus::System {
                if let Some(job) = observe::systemd1::parse(&msg) {
                    handle_unit_job(job, ctx);
                    return;
                }
            }

            let Some(observed) = observe::parse_signal(bus, &msg) else {
                return;
            };

            // Debounce property-bag signals per (path, interface) — 250 ms.
            if matches!(
                observed.source,
                Source::Media | Source::Network | Source::Power
            ) {
                let key = (
                    msg.path().map(|p| p.to_string()).unwrap_or_default(),
                    observed.source.name().to_string(),
                );
                match ctx.debounce.get(&key) {
                    Some(&last) if now.saturating_sub(last) < RATE_LIMIT_WINDOW_MS => {
                        *ctx.rate_limited_drops += 1;
                        return;
                    }
                    _ => {
                        ctx.debounce.insert(key, now);
                    }
                }
            }

            // Lock/sleep state-change signals always drive the lockdown rail,
            // even while paused/locked — they are the re-arm hinge.
            let lockdown_transition = observed.lockdown;

            // Record wake/suspend facts for the morning briefing regardless
            // of the lockdown outcome — they are facts about the machine,
            // not about the lock state (a user-paused wake is still a wake).
            match lockdown_transition {
                Some(LockdownChange::Sleep) => ctx.wake.on_suspend(now),
                Some(LockdownChange::Wake) => ctx.wake.on_wake(now),
                _ => {}
            }

            // Trigger events for the lockdown rail are always recorded:
            // they are the audit evidence for the disarm itself.
            if lockdown_transition.is_some() || ctx.awareness.effective_armed(observed.source) {
                let ev = RingEvent {
                    ts_ms: now,
                    source: observed.source.name().to_string(),
                    event: observed.text.clone(),
                };
                ctx.ring.push(ev);
                ctx.audit
                    .append(observed.source.name(), &observed.text, &observed.text);
            }

            match lockdown_transition {
                Some(LockdownChange::Lock) => {
                    if ctx.awareness.lockdown_begin(LockdownReason::Locked) {
                        ctx.ring.clear();
                        ctx.audit.append(
                            "system",
                            "awareness: lockdown (locked)",
                            "screen locked: all observers disarmed for the duration; ring purged",
                        );
                    }
                }
                Some(LockdownChange::Unlock) if ctx.awareness.lockdown_end() => {
                    if ctx.awareness.user_paused() {
                        ctx.audit.append(
                            "system",
                            "awareness: unlocked (user pause kept)",
                            "screen unlocked but the user pause flag wins: sensors stay disarmed",
                        );
                    } else {
                        ctx.audit.append(
                            "system",
                            "awareness: re-armed (unlock)",
                            "screen unlocked: T0 sources re-armed automatically (no user pause)",
                        );
                    }
                }
                Some(LockdownChange::Sleep) => {
                    if ctx.awareness.lockdown_begin(LockdownReason::Sleep) {
                        ctx.ring.clear();
                        ctx.audit.append(
                            "system",
                            "awareness: lockdown (sleep)",
                            "PrepareForSleep(true): all observers disarmed for the duration; ring purged",
                        );
                    }
                }
                Some(LockdownChange::Wake) if ctx.awareness.lockdown_end() => {
                    if ctx.awareness.user_paused() {
                        ctx.audit.append(
                            "system",
                            "awareness: wake (user pause kept)",
                            "PrepareForSleep(false) but the user pause flag wins: sensors stay disarmed",
                        );
                    } else {
                        ctx.audit.append(
                            "system",
                            "awareness: re-armed (wake)",
                            "PrepareForSleep(false): T0 sources re-armed automatically (no user pause)",
                        );
                    }
                }
                // Guard-false (unlock/wake while not locked) and None both
                // mean: nothing to do — leave awareness state alone.
                _ => {}
            }
        }
        _ => {}
    }
}

/// systemd1 `JobRemoved` — outcome-bearing, handled before the generic
/// parser. **All** jobs feed a per-unit debounce (250 ms, shared map);
/// successful jobs (`result == "done"`) are counted and never audited;
/// failures always land in ring + audit and are never debounced away.
/// The arm/pause/lockdown gates apply exactly as they do to every source.
fn handle_unit_job(job: observe::systemd1::UnitJob, ctx: &mut LoopCtx<'_>) {
    let now = now_ms();
    let text = job.event_text(); // Some only for failures

    // Every job feeds the per-unit debounce window.
    let key = (job.unit().to_string(), Source::Units.name().to_string());
    let within_window = ctx
        .debounce
        .get(&key)
        .copied()
        .map(|last| now.saturating_sub(last) < RATE_LIMIT_WINDOW_MS)
        .unwrap_or(false);
    ctx.debounce.insert(key, now);

    match job {
        observe::systemd1::UnitJob::Done { .. } => {
            // Counted-but-not-audited: storms of successful jobs count as
            // debounced drops (aggregate-audited once a minute); a lone `done`
            // in the window is silently seen and nothing more.
            if within_window {
                *ctx.rate_limited_drops += 1;
            }
        }
        observe::systemd1::UnitJob::Failed { unit, .. } => {
            if !ctx.awareness.effective_armed(Source::Units) {
                // Disarmed / paused / locked: observe nothing, remember nothing.
                return;
            }
            let text = text.unwrap_or_else(|| format!("unit: {unit} failed"));
            let ev = RingEvent {
                ts_ms: now,
                source: Source::Units.name().to_string(),
                event: text.clone(),
            };
            ctx.ring.push(ev);
            ctx.audit.append(Source::Units.name(), &text, &text);
            ctx.wake.on_unit_failure(unit);
        }
    }
}

fn selftest() {
    println!(
        "airi-daemon {VERSION} (protocol {PROTOCOL}) — selftest (claims no bus name; exits 0)"
    );
    println!();

    // --- Session bus ---
    match Connection::new_session() {
        Ok(conn) => {
            println!("session bus: present");
            for (source, bus, rule) in observe::MATCH_RULES {
                if *bus != Bus::Session {
                    continue;
                }
                match conn.add_match_no_cb(rule) {
                    Ok(()) => {
                        println!("  [ok] match rule ({}): {}", source.name(), rule);
                        // Probe then remove — leave the bus as we found it.
                        if let Err(e) = conn.remove_match_no_cb(rule) {
                            println!("       (note: could not remove probe rule: {e})");
                        }
                    }
                    Err(e) => println!(
                        "  [FAIL] match rule ({}): {e}\n       rule: {rule}",
                        source.name()
                    ),
                }
            }
            // Which screen-saver is actually on this bus?
            for name in [
                "org.freedesktop.ScreenSaver",
                "org.gnome.ScreenSaver",
                "org.kde.ScreenSaver",
            ] {
                match name_has_owner(&conn, name) {
                    Some(true) => {
                        println!("  [info] screen-saver name owned on session bus: {name}")
                    }
                    Some(false) => println!("  [info] screen-saver name not owned: {name}"),
                    None => println!("  [info] screen-saver probe failed for {name}"),
                }
            }
            // --- Screen awareness (AT-SPI) ---
            let probe = airi_a11y::probe(&conn);
            println!("  [info] a11y: {}", probe.summary_line());
            match &probe.address {
                Some(address) => match A11yClient::connect(address) {
                    Ok(client) => {
                        println!("  [ok] connected to the a11y bus at {address}");
                        for (rule, result) in client.add_focus_match_rules() {
                            match result {
                                Ok(()) => println!("  [ok] focus match rule (screen): {rule}"),
                                Err(e) => println!(
                                    "  [FAIL] focus match rule (screen): {e}\n       rule: {rule}"
                                ),
                            }
                        }
                        // Leave the bus as we found it: probe rules go away.
                        if let Err(e) = client.remove_focus_match_rules() {
                            println!("       (note: could not remove probe rules: {e})");
                        }
                    }
                    Err(e) => println!("  [info] a11y bus connect failed: {e}"),
                },
                None => {
                    println!("  [info] a11y unavailable; screen source would stay disarmed on this desktop")
                }
            }
        }
        Err(e) => {
            println!("session bus: ABSENT ({e})");
            println!("  the daemon cannot run standalone on this machine: exiting 1 would follow in run mode");
            println!("  a11y: skipped (no session bus)");
        }
    }
    println!();

    // --- System bus ---
    match Connection::new_system() {
        Ok(conn) => {
            println!("system bus: present");
            for (source, bus, rule) in observe::MATCH_RULES {
                if *bus != Bus::System {
                    continue;
                }
                match conn.add_match_no_cb(rule) {
                    Ok(()) => {
                        println!("  [ok] match rule ({}): {}", source.name(), rule);
                        if let Err(e) = conn.remove_match_no_cb(rule) {
                            println!("       (note: could not remove probe rule: {e})");
                        }
                    }
                    Err(e) => println!(
                        "  [FAIL] match rule ({}): {e}\n       rule: {rule}",
                        source.name()
                    ),
                }
            }
            for name in [
                "org.freedesktop.login1",
                "org.freedesktop.NetworkManager",
                "org.freedesktop.UPower",
                "org.freedesktop.systemd1",
            ] {
                match name_has_owner(&conn, name) {
                    Some(true) => println!("  [info] system name owned: {name}"),
                    Some(false) => println!("  [info] system name not owned: {name}"),
                    None => println!("  [info] probe failed for {name}"),
                }
            }
        }
        Err(e) => {
            println!("system bus: ABSENT ({e})");
            println!("  sleep/network/power/units sources would stay unavailable; session-bus sources still arm");
        }
    }
    println!();

    // --- Audit path resolution ---
    match default_audit_path() {
        Some(p) => println!("audit path: {}", p.display()),
        None => println!("audit path: unresolvable (no data dir) — audit would be disabled"),
    }
    println!("interface: {INTERFACE}");
    println!("selftest done (no name claimed, no state changed)");
}

fn name_has_owner(conn: &Connection, name: &str) -> Option<bool> {
    let msg = dbus::Message::call_with_args(
        "org.freedesktop.DBus",
        "/org/freedesktop/DBus",
        "org.freedesktop.DBus",
        "NameHasOwner",
        (name.to_string(),),
    );
    let reply = conn
        .channel()
        .send_with_reply_and_block(msg, Duration::from_millis(500))
        .ok()?;
    let mut it = reply.iter_init();
    it.read::<bool>().ok()
}
