// SPDX-License-Identifier: GPL-3.0-or-later
//! Control interface `org.moeru.airi.Daemon1` (session bus, object path
//! `/org/moeru/airi/Daemon1`).
//!
//! Methods:
//!   GetStatus() -> s   JSON: {protocol, version, paused, sources{sleep,lock,media,network,power,screen},
//!                      ring_count, audit_path, session_bus, system_bus, audit_pruned, paused_by}
//!   SetSource(source: s, enabled: b) -> s   JSON: {ok: bool, error?: string}
//!   Pause(p: b)                             no output; flips the global kill switch
//!   GetFocusDigest() -> s                    JSON: {ok:true, app, title, lines, text_length,
//!                      skipped_password_nodes} | {ok:false, error}
//!                      On-demand only — computed fresh per call, never cached to disk.
//!   SetExcludedApps(json: s) -> s            JSON: {ok: bool, error?: string}
//!                      `json` is a JSON string array of app-name substrings
//!                      (case-insensitive). Stored in memory + persisted to
//!                      `<data_dir>/airi-qt/awareness-exclusions.json`.
//!
//! Every arm/disarm is audited (source tag = "system" for kill switch,
//! per-source tag for SetSource). Unknown sources and malformed calls are
//! reported, never executed.

use dbus::{Message, MessageType};

use crate::audit::AuditLog;
use crate::ring::Ring;
use crate::screen::Exclusions;
use crate::state::{Awareness, Source};

pub const BUS_NAME: &str = "org.moeru.airi.Daemon1";
pub const INTERFACE: &str = "org.moeru.airi.Daemon1";
pub const OBJECT_PATH: &str = "/org/moeru/airi/Daemon1";

pub const PROTOCOL: u32 = 1;
pub const VERSION: &str = "0.1.0";

/// Everything GetStatus needs, passed in so the pure JSON builder is testable.
pub struct StatusContext<'a> {
    pub awareness: &'a Awareness,
    pub ring_count: u64,
    pub audit_path: &'a str,
    pub session_bus: bool,
    pub system_bus: bool,
    pub audit_pruned: u64,
}

pub fn get_status_json(ctx: &StatusContext) -> String {
    let v = serde_json::json!({
        "protocol": PROTOCOL,
        "version": VERSION,
        "paused": ctx.awareness.paused(),
        "sources": ctx.awareness.sources_json(),
        "ring_count": ctx.ring_count,
        "audit_path": ctx.audit_path,
        "session_bus": ctx.session_bus,
        "system_bus": ctx.system_bus,
        "audit_pruned": ctx.audit_pruned,
        "paused_by": ctx.awareness.paused_by(),
    });
    v.to_string()
}

pub fn set_source_json(
    source: &str,
    enabled: bool,
    awareness: &mut Awareness,
    audit: &AuditLog,
) -> String {
    match Source::from_name(source) {
        Some(src) => {
            awareness.set_source(src, enabled);
            audit.append(
                src.name(),
                if enabled { "armed" } else { "disarmed" },
                if enabled {
                    "source armed via SetSource"
                } else {
                    "source disarmed via SetSource"
                },
            );
            serde_json::json!({ "ok": true }).to_string()
        }
        None => serde_json::json!({
            "ok": false,
            "error": format!("unknown source '{source}' (expected one of: sleep, lock, media, network, power, screen)"),
        })
        .to_string(),
    }
}

/// With `p = true` this is the kill switch: disarms all observers, purges
/// the in-memory ring, and audits `awareness: paused (kill switch)`.
pub fn pause(p: bool, awareness: &mut Awareness, audit: &AuditLog, ring: &mut Ring) {
    if awareness.pause(p) {
        if p {
            // Kill switch also purges the in-memory ring — "observe nothing"
            // means nothing stays in memory either (§F rail 2).
            ring.clear();
            audit.append(
                "system",
                "awareness: paused (kill switch)",
                "user paused all observers (kill switch); awareness ring purged",
            );
        } else {
            audit.append("system", "awareness: resumed", "user resumed awareness");
        }
    }
}

/// What the control interface decided to say. Pure — no Message construction
/// — so tests can exercise every branch without a bus reply serial.
#[derive(Debug, PartialEq, Eq)]
pub enum ControlOutcome {
    /// One string argument (GetStatus / SetSource JSON).
    ReplyString(String),
    /// No output arguments (Pause).
    ReplyEmpty,
    /// org.freedesktop.DBus.Error.UnknownMethod.
    UnknownMethod(String),
}

/// Pure dispatch of a method call addressed to our interface. `None` = not
/// addressed to us; drop silently. `digest` is the live-computation hook for
/// GetFocusDigest (the daemon wires it to `screen::digest_json`; tests wire a
/// canned closure) — dispatch itself never touches a bus.
pub fn dispatch(
    msg: &Message,
    awareness: &mut Awareness,
    audit: &AuditLog,
    ring: &mut Ring,
    status: &dyn Fn(&Awareness, u64) -> String,
    digest: &dyn Fn(&Exclusions) -> String,
    exclusions: &mut Exclusions,
) -> Option<ControlOutcome> {
    if msg.msg_type() != MessageType::MethodCall {
        return None;
    }
    if msg.path().as_deref() != Some(OBJECT_PATH) {
        return None;
    }
    if msg.interface().as_deref() != Some(INTERFACE) {
        return None;
    }
    match msg.member().as_deref()? {
        "GetStatus" => Some(ControlOutcome::ReplyString(status(awareness, ring.len()))),
        "SetSource" => {
            let mut it = msg.iter_init();
            let source: Result<String, _> = it.read();
            let enabled: Result<bool, _> = it.read();
            match (source, enabled) {
                (Ok(source), Ok(enabled)) => Some(ControlOutcome::ReplyString(set_source_json(
                    &source, enabled, awareness, audit,
                ))),
                _ => Some(ControlOutcome::UnknownMethod(
                    "expected SetSource(source: s, enabled: b)".to_string(),
                )),
            }
        }
        "Pause" => {
            let mut it = msg.iter_init();
            let p: Result<bool, _> = it.read();
            match p {
                Ok(p) => {
                    pause(p, awareness, audit, ring);
                    Some(ControlOutcome::ReplyEmpty)
                }
                Err(_) => Some(ControlOutcome::UnknownMethod(
                    "expected Pause(p: b)".to_string(),
                )),
            }
        }
        "GetFocusDigest" => Some(ControlOutcome::ReplyString(digest(exclusions))),
        "SetExcludedApps" => {
            let mut it = msg.iter_init();
            let json: Result<String, _> = it.read();
            match json {
                Ok(argument) => {
                    let reply = crate::screen::set_excluded_apps_json(&argument, exclusions);
                    // Persist + audit only when the set succeeded.
                    if serde_json::from_str::<serde_json::Value>(&reply)
                        .map(|v| v["ok"] == true)
                        .unwrap_or(false)
                    {
                        audit.append(
                            "screen",
                            "screen: excluded apps updated",
                            &format!(
                                "{} user exclusion(s) + {} built-in (case-insensitive substring of app name)",
                                exclusions.user_len(),
                                exclusions.builtin_len()
                            ),
                        );
                    }
                    Some(ControlOutcome::ReplyString(reply))
                }
                Err(_) => Some(ControlOutcome::UnknownMethod(
                    "expected SetExcludedApps(json: s)".to_string(),
                )),
            }
        }
        other => Some(ControlOutcome::UnknownMethod(format!(
            "unknown method '{other}'"
        ))),
    }
}

/// Bus-side wrapper: turn the pure outcome into a reply message.
pub fn handle_method_call(
    msg: &Message,
    awareness: &mut Awareness,
    audit: &AuditLog,
    ring: &mut Ring,
    status: &dyn Fn(&Awareness, u64) -> String,
    digest: &dyn Fn(&Exclusions) -> String,
    exclusions: &mut Exclusions,
) -> Option<Message> {
    match dispatch(msg, awareness, audit, ring, status, digest, exclusions)? {
        ControlOutcome::ReplyString(s) => Some(msg.return_with_args((s,))),
        ControlOutcome::ReplyEmpty => Message::new_method_return(msg),
        ControlOutcome::UnknownMethod(why) => Some(unknown_method_error(msg, &why)),
    }
}

fn unknown_method_error(msg: &Message, why: &str) -> Message {
    use dbus::strings::ErrorName;
    let name = ErrorName::new("org.freedesktop.DBus.Error.UnknownMethod")
        .expect("static error name is valid");
    let cstr = std::ffi::CString::new(why)
        .unwrap_or_else(|_| std::ffi::CString::new("unknown method").expect("static fallback"));
    msg.error(&name, &cstr)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::state::LockdownReason;

    fn audit() -> (AuditLog, std::path::PathBuf) {
        let path = std::env::temp_dir().join(format!(
            "airi-daemon-ctl-test-{}-{}.jsonl",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map(|d| d.as_nanos())
                .unwrap_or(0)
        ));
        (AuditLog::open(path.clone()), path)
    }

    fn ring() -> Ring {
        let mut r = Ring::with_default_cap();
        for _ in 0..7 {
            r.push(crate::ring::RingEvent {
                ts_ms: 1,
                source: "media".to_string(),
                event: "media: Playing".to_string(),
            });
        }
        r
    }

    fn digest_canned(_: &Exclusions) -> String {
        r#"{"ok":true,"app":"test-app","title":"t","lines":["label: hi"],"text_length":10,"skipped_password_nodes":0}"#.to_string()
    }

    fn ctx<'a>(awareness: &'a Awareness) -> StatusContext<'a> {
        StatusContext {
            awareness,
            ring_count: 7,
            audit_path: "/tmp/example/awareness-audit.jsonl",
            session_bus: true,
            system_bus: false,
            audit_pruned: 3,
        }
    }

    #[test]
    fn get_status_json_has_exact_spec_keys() {
        let a = Awareness::new();
        let v: serde_json::Value =
            serde_json::from_str(&get_status_json(&ctx(&a))).expect("valid JSON");
        assert_eq!(v["protocol"], 1);
        assert_eq!(v["version"], "0.1.0");
        assert_eq!(v["paused"], false);
        assert_eq!(v["sources"]["sleep"], true);
        assert_eq!(v["sources"]["lock"], true);
        assert_eq!(v["sources"]["media"], true);
        assert_eq!(v["sources"]["network"], true);
        assert_eq!(v["sources"]["power"], true);
        assert_eq!(v["sources"]["screen"], true);
        assert_eq!(v["ring_count"], 7);
        assert_eq!(v["audit_path"], "/tmp/example/awareness-audit.jsonl");
        assert_eq!(v["session_bus"], true);
        assert_eq!(v["system_bus"], false);
        assert_eq!(v["audit_pruned"], 3);
        assert_eq!(v["paused_by"], "");
    }

    #[test]
    fn paused_status_reports_lockdown_and_user() {
        let mut a = Awareness::new();
        a.lockdown_begin(LockdownReason::Locked);
        let v: serde_json::Value = serde_json::from_str(&get_status_json(&ctx(&a))).unwrap();
        assert_eq!(v["paused"], true);
        assert_eq!(v["paused_by"], "lockdown");
        a.pause(true); // user wins the label
        let v: serde_json::Value = serde_json::from_str(&get_status_json(&ctx(&a))).unwrap();
        assert_eq!(v["paused_by"], "user");
    }

    #[test]
    fn set_source_known_and_unknown() {
        let mut a = Awareness::new();
        let (log, path) = audit();
        let ok = set_source_json("media", false, &mut a, &log);
        assert_eq!(
            serde_json::from_str::<serde_json::Value>(&ok).unwrap()["ok"],
            true
        );
        assert!(!a.effective_armed(Source::Media));
        let bad = set_source_json("teleport", false, &mut a, &log);
        let v: serde_json::Value = serde_json::from_str(&bad).unwrap();
        assert_eq!(v["ok"], false);
        assert!(v["error"].as_str().unwrap().contains("teleport"));
        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn method_call_roundtrip_get_status() {
        let a = Awareness::new();
        let (log, path) = audit();
        let msg = Message::method_call(
            &dbus::strings::BusName::new("org.example.Caller").unwrap(),
            &dbus::strings::Path::new(OBJECT_PATH).unwrap(),
            &dbus::strings::Interface::new(INTERFACE).unwrap(),
            &dbus::strings::Member::new("GetStatus").unwrap(),
        );
        let status = |awareness: &Awareness, ring_count: u64| {
            get_status_json(&StatusContext {
                awareness,
                ring_count,
                audit_path: "/tmp/example/audit.jsonl",
                session_bus: true,
                system_bus: true,
                audit_pruned: 0,
            })
        };
        let mut a = a;
        let mut r = ring(); // 7 events
        let mut excl = Exclusions::in_memory();
        let outcome = dispatch(
            &msg,
            &mut a,
            &log,
            &mut r,
            &status,
            &digest_canned,
            &mut excl,
        )
        .expect("dispatch");
        let ControlOutcome::ReplyString(s) = outcome else {
            panic!("expected ReplyString, got {outcome:?}");
        };
        let v: serde_json::Value = serde_json::from_str(&s).unwrap();
        assert_eq!(v["ring_count"], 7);
        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn method_call_pause_and_unknown_source_and_unknown_method() {
        let mut a = Awareness::new();
        let (log, path) = audit();
        let status = |awareness: &Awareness, ring_count: u64| {
            get_status_json(&StatusContext {
                awareness,
                ring_count,
                audit_path: "/tmp/example/audit.jsonl",
                session_bus: true,
                system_bus: true,
                audit_pruned: 0,
            })
        };
        let call = |member: &str| {
            Message::method_call(
                &dbus::strings::BusName::new("org.example.Caller").unwrap(),
                &dbus::strings::Path::new(OBJECT_PATH).unwrap(),
                &dbus::strings::Interface::new(INTERFACE).unwrap(),
                &dbus::strings::Member::new(member).unwrap(),
            )
        };
        // Pause(true) → empty reply, kill switch engages.
        let mut msg = call("Pause");
        msg.append_all((true,));
        let mut excl = Exclusions::in_memory();
        let outcome = dispatch(
            &msg,
            &mut a,
            &log,
            &mut Ring::with_default_cap(),
            &status,
            &digest_canned,
            &mut excl,
        )
        .expect("dispatch");
        assert_eq!(outcome, ControlOutcome::ReplyEmpty);
        assert!(a.paused());
        // SetSource with a nonsense source → ok:false, no panic.
        let mut msg = call("SetSource");
        msg.append_all(("teleport".to_string(), true));
        let mut excl = Exclusions::in_memory();
        let outcome = dispatch(
            &msg,
            &mut a,
            &log,
            &mut Ring::with_default_cap(),
            &status,
            &digest_canned,
            &mut excl,
        )
        .expect("dispatch");
        let ControlOutcome::ReplyString(s) = outcome else {
            panic!("expected ReplyString, got {outcome:?}");
        };
        assert_eq!(
            serde_json::from_str::<serde_json::Value>(&s).unwrap()["ok"],
            false
        );
        // Unknown method → error outcome.
        let msg = call("Detonate");
        let mut excl = Exclusions::in_memory();
        let outcome = dispatch(
            &msg,
            &mut a,
            &log,
            &mut Ring::with_default_cap(),
            &status,
            &digest_canned,
            &mut excl,
        )
        .expect("dispatch");
        assert!(matches!(outcome, ControlOutcome::UnknownMethod(_)));
        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn set_source_screen_is_accepted_and_toggles() {
        let mut a = Awareness::new();
        let (log, path) = audit();
        let ok = set_source_json("screen", false, &mut a, &log);
        assert_eq!(
            serde_json::from_str::<serde_json::Value>(&ok).unwrap()["ok"],
            true
        );
        assert!(!a.effective_armed(Source::Screen));
        // Other sources are untouched.
        assert!(a.effective_armed(Source::Media));
        let ok = set_source_json("screen", true, &mut a, &log);
        assert_eq!(
            serde_json::from_str::<serde_json::Value>(&ok).unwrap()["ok"],
            true
        );
        assert!(a.effective_armed(Source::Screen));
        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn get_focus_digest_roundtrip_via_dispatch() {
        let mut a = Awareness::new();
        let (log, path) = audit();
        let status = |awareness: &Awareness, ring_count: u64| {
            get_status_json(&StatusContext {
                awareness,
                ring_count,
                audit_path: "/tmp/example/audit.jsonl",
                session_bus: true,
                system_bus: true,
                audit_pruned: 0,
            })
        };
        let call = |member: &str| {
            Message::method_call(
                &dbus::strings::BusName::new("org.example.Caller").unwrap(),
                &dbus::strings::Path::new(OBJECT_PATH).unwrap(),
                &dbus::strings::Interface::new(INTERFACE).unwrap(),
                &dbus::strings::Member::new(member).unwrap(),
            )
        };
        let mut excl = Exclusions::in_memory();
        let msg = call("GetFocusDigest");
        let outcome = dispatch(
            &msg,
            &mut a,
            &log,
            &mut Ring::with_default_cap(),
            &status,
            &digest_canned,
            &mut excl,
        )
        .expect("dispatch");
        let ControlOutcome::ReplyString(s) = outcome else {
            panic!("expected ReplyString, got {outcome:?}");
        };
        let v: serde_json::Value = serde_json::from_str(&s).unwrap();
        assert_eq!(v["ok"], true);
        assert_eq!(v["app"], "test-app");
        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn set_excluded_apps_roundtrip_via_dispatch() {
        let tmpdir =
            std::env::temp_dir().join(format!("airi-daemon-setexcl-test-{}", std::process::id()));
        let excl_path = tmpdir.join("awareness-exclusions.json");
        let mut a = Awareness::new();
        let (log, audit_path) = audit();
        let status = |awareness: &Awareness, ring_count: u64| {
            get_status_json(&StatusContext {
                awareness,
                ring_count,
                audit_path: "/tmp/example/audit.jsonl",
                session_bus: true,
                system_bus: true,
                audit_pruned: 0,
            })
        };
        let call = |member: &str| {
            Message::method_call(
                &dbus::strings::BusName::new("org.example.Caller").unwrap(),
                &dbus::strings::Path::new(OBJECT_PATH).unwrap(),
                &dbus::strings::Interface::new(INTERFACE).unwrap(),
                &dbus::strings::Member::new(member).unwrap(),
            )
        };
        let mut excl = Exclusions::load(excl_path.clone());
        // Valid list → ok:true, persisted.
        let mut msg = call("SetExcludedApps");
        msg.append_all((r#"["my bank", "secret app"]"#.to_string(),));
        let outcome = dispatch(
            &msg,
            &mut a,
            &log,
            &mut Ring::with_default_cap(),
            &status,
            &digest_canned,
            &mut excl,
        )
        .expect("dispatch");
        let ControlOutcome::ReplyString(s) = outcome else {
            panic!("expected ReplyString, got {outcome:?}");
        };
        assert_eq!(
            serde_json::from_str::<serde_json::Value>(&s).unwrap()["ok"],
            true
        );
        let persisted = std::fs::read_to_string(&excl_path).expect("exclusion file written");
        assert!(persisted.contains("my bank"));
        assert!(excl.is_excluded("My Bank Portal"));
        // Invalid JSON → ok:false, list unchanged.
        let mut msg = call("SetExcludedApps");
        msg.append_all(("not json".to_string(),));
        let outcome = dispatch(
            &msg,
            &mut a,
            &log,
            &mut Ring::with_default_cap(),
            &status,
            &digest_canned,
            &mut excl,
        )
        .expect("dispatch");
        let ControlOutcome::ReplyString(s) = outcome else {
            panic!("expected ReplyString, got {outcome:?}");
        };
        let v: serde_json::Value = serde_json::from_str(&s).unwrap();
        assert_eq!(v["ok"], false);
        assert!(
            excl.is_excluded("my bank"),
            "list must survive a failed set"
        );
        let _ = std::fs::remove_file(&audit_path);
        let _ = std::fs::remove_dir_all(&tmpdir);
    }

    #[test]
    fn pause_writes_kill_switch_audit_line() {
        let mut a = Awareness::new();
        let dir =
            std::env::temp_dir().join(format!("airi-daemon-pause-test-{}", std::process::id()));
        let path = dir.join("audit.jsonl");
        let log = AuditLog::open(path.clone());
        let mut r = Ring::with_default_cap();
        pause(true, &mut a, &log, &mut r);
        let contents = std::fs::read_to_string(&path).expect("audit written");
        assert!(contents.contains("awareness: paused (kill switch)"));
        assert!(contents.contains("\"source\":\"system\""));
        assert!(a.paused());
        let _ = std::fs::remove_dir_all(&dir);
    }
}
