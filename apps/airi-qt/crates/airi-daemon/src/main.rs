// SPDX-License-Identifier: GPL-3.0-or-later
//! airi-daemon — AIRI user-session awareness daemon.
//!
//! Owns `org.moeru.airi.Daemon1` on the session bus, watches five T0 sources
//! (logind sleep, screensaver lock, MPRIS playback, NetworkManager state,
//! UPower on-battery), keeps an in-memory ring (cap 200), appends to a
//! redacted audit JSONL (7-day retention, pruned at startup), and answers
//! control RPCs on `org.moeru.airi.Daemon1`.
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
mod observe;
mod redact;
mod ring;
mod state;

use std::collections::HashMap;
use std::process::exit;
use std::time::{Duration, Instant};

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

const RATE_LIMIT_WINDOW_MS: u64 = 250;
const RATE_LIMIT_AUDIT_PERIOD: Duration = Duration::from_secs(60);

#[derive(Debug, PartialEq, Eq)]
enum Mode {
    Run,
    SelfTest,
    Version,
    Help,
}

fn parse_args(args: &[String]) -> Result<Mode, String> {
    match args {
        [] => Ok(Mode::Run),
        [one] => match one.as_str() {
            "--foreground" => Ok(Mode::Run),
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
        Ok(Mode::Run) => run(),
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

fn run() {
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
            eprintln!("airi-daemon: connected to the system bus (read-only eyes: logind, NetworkManager, UPower)");
            Some(c)
        }
        Err(e) => {
            eprintln!(
                "airi-daemon: no system bus ({e}); sleep/network/power sources stay unavailable"
            );
            None
        }
    };

    let mut awareness = Awareness::new();
    let mut ring = Ring::with_default_cap();
    let mut session_ok = true;
    let mut system_ok = system.is_some();
    let mut availability: HashMap<Source, bool> = Source::ALL.iter().map(|s| (*s, true)).collect();

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

    let mut debounce: HashMap<(String, String), u64> = HashMap::new();
    let mut rate_limited_drops: u64 = 0;
    let mut last_rate_limit_audit = Instant::now();

    loop {
        // --- Session bus ---
        match session
            .channel()
            .blocking_pop_message(Duration::from_millis(20))
        {
            Ok(Some(msg)) => {
                session_ok = true;
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

        // --- Rate-limit drop counter, at most once per minute ---
        if rate_limited_drops > 0 && last_rate_limit_audit.elapsed() >= RATE_LIMIT_AUDIT_PERIOD {
            audit.append(
                "system",
                "rate-limited",
                &format!("dropped {rate_limited_drops} debounced property-change signals"),
            );
            rate_limited_drops = 0;
            last_rate_limit_audit = Instant::now();
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
}

fn handle_message(bus: Bus, msg: dbus::Message, conn: &Connection, ctx: &mut LoopCtx<'_>) {
    match msg.msg_type() {
        MessageType::MethodCall => {
            if bus != Bus::Session {
                return; // method calls are answered where we own the name
            }
            let reply =
                handle_method_call(&msg, ctx.awareness, ctx.audit, ctx.ring, &|aware, count| {
                    get_status_json(&StatusContext {
                        awareness: aware,
                        ring_count: count,
                        audit_path: ctx.audit_path,
                        session_bus: ctx.session_ok,
                        system_bus: ctx.system_ok,
                        audit_pruned: ctx.audit_pruned,
                    })
                });
            if let Some(reply) = reply {
                // Best-effort reply; a dead peer is not our problem.
                let _ = conn.send(reply);
            }
        }
        MessageType::Signal => {
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
                let now = now_ms();
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

            // Trigger events for the lockdown rail are always recorded:
            // they are the audit evidence for the disarm itself.
            if lockdown_transition.is_some() || ctx.awareness.effective_armed(observed.source) {
                let ev = RingEvent {
                    ts_ms: now_ms(),
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
        }
        Err(e) => {
            println!("session bus: ABSENT ({e})");
            println!("  the daemon cannot run standalone on this machine: exiting 1 would follow in run mode");
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
            println!("  sleep/network/power sources would stay unavailable; session-bus sources still arm");
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
