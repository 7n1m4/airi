// SPDX-License-Identifier: GPL-3.0-or-later
//! Awareness daemon bridge (`DaemonController`): the Qt face of the
//! opt-in user-session awareness daemon (`airi-daemon`, lane P1a).
//!
//! The daemon is **not** part of this application and is **not** auto-
//! installed: it is an opt-in `systemd --user` service, started on demand
//! (D-Bus activation) under the well-known name `org.moeru.airi.Daemon1`
//! on the **session** bus. This bridge talks D-Bus — never Rust types from
//! `crates/airi-daemon` — so the two sides only agree on the wire contract:
//!
//! - Well-known name / interface: `org.moeru.airi.Daemon1`
//! - Object path: `/org/moeru/airi/Daemon1` (matches the daemon's
//!   `OBJECT_PATH` in `control.rs`, and the research-doc convention)
//! - `GetStatus() -> s` — JSON string: `{protocol, version, paused, sources
//!   {sleep, lock, media, network, power}, ring_count, audit_path,
//!   session_bus, system_bus, audit_pruned, paused_by}`
//! - `SetSource(source: s, enabled: b) -> s` — JSON `{ok, error?}`;
//!   `source ∈ {sleep, lock, media, network, power}`
//! - `Pause(p: b)` — arm/disarm ALL observers
//!
//! # What this bridge deliberately does not do
//!
//! - No autonomous actions, no agent dispatch, no chat wiring. It toggles
//!   and views only.
//! - No D-Bus activation *guarantee*: when the daemon is absent every
//!   qinvokable degrades gracefully (`running=false`, a human status line).
//!   `refresh()` never throws and no call panics on a missing bus/daemon.
//!
//! # Threading / cost model
//!
//! All qinvokables run on the Qt thread. Each D-Bus call opens and closes
//! its own blocking connection with an 800 ms timeout — at the page's
//! polling cadence (1 s Timer) this is cheap and keeps failure isolation
//! trivial (a hung daemon cannot wedge the UI; worst case one 800 ms stall
//! per poll, bounded and visible as `running=false` if it times out).
//!
//! # Audit viewer
//!
//! `recentAudit()`/`clearAudit()` operate on the shared audit file at
//! `dirs::data_dir()/airi-qt/audit/awareness-audit.jsonl` — the same path the
//! daemon resolves in `audit.rs` (`AUDIT_FILE_NAME = "awareness-audit.jsonl"`)
//! and the same one `GetStatus` reports in its `audit_path` field. (Note: an
//! earlier draft of the lane brief called the file `awareness.jsonl`; the
//! daemon source of truth wins and this bridge matches it.)
//! `clearAudit()` truncates the file to zero bytes; it does **not** delete
//! the file, and it does **not** clear the daemon's in-memory ring buffer
//! (the ring may re-serve events the page stops showing). The file is
//! 7-day-retention, redacted JSONL; nothing leaves the machine.

use cxx_qt::CxxQtType;
use cxx_qt_lib::QString;
use serde_json::{json, Value};
use std::fs::{read_to_string, OpenOptions};
use std::io::Write as _;
use std::pin::Pin;
use std::time::Duration;

/// Well-known session-bus name owned by `airi-daemon`.
const DAEMON_NAME: &str = "org.moeru.airi.Daemon1";
/// Object path exported by the daemon (matches `OBJECT_PATH` in the
/// daemon's `control.rs`).
const DAEMON_PATH: &str = "/org/moeru/airi/Daemon1";
/// Interface carrying the callable methods.
const DAEMON_INTERFACE: &str = "org.moeru.airi.Daemon1";
/// Must stay byte-identical to `AUDIT_FILE_NAME` in the daemon's `audit.rs`.
const AUDIT_FILE_NAME: &str = "awareness-audit.jsonl";
/// Every D-Bus call is bounded by this timeout.
const DBUS_TIMEOUT: Duration = Duration::from_millis(800);
/// Hard cap on audit rows returned by `recentAudit()` (and shown by the page).
const AUDIT_CAP: usize = 50;
/// `statusLine` shown when the daemon cannot be reached at all.
const DAEMON_DOWN_STATUS: &str =
    "airi-daemon is not running — see packaging/README.md (dev-run section)";

/// Resolve the shared audit file path exactly the way the daemon does:
/// `dirs::data_dir()/airi-qt/audit/awareness-audit.jsonl`.
fn audit_file_path() -> Option<std::path::PathBuf> {
    dirs::data_dir().map(|d| d.join("airi-qt").join("audit").join(AUDIT_FILE_NAME))
}

/// Path used for display + file operations, with a relative fallback when
/// the platform has no data dir (display-only; operations will fail and
/// report `false` honestly).
fn audit_file_path_display() -> String {
    audit_file_path()
        .map(|p| p.to_string_lossy().into_owned())
        .unwrap_or_else(|| format!("airi-qt/audit/{AUDIT_FILE_NAME}"))
}

/// One GetStatus round-trip. `Ok(body)` is the raw JSON string the daemon
/// returned; any D-Bus/parse failure is `Err` and must be handled by
/// callers as "daemon down".
fn call_get_status() -> Result<String, dbus::Error> {
    use dbus::blocking::Connection;
    let conn = Connection::new_session()?;
    let proxy = conn.with_proxy(DAEMON_NAME, DAEMON_PATH, DBUS_TIMEOUT);
    let (body,): (String,) = proxy.method_call(DAEMON_INTERFACE, "GetStatus", ())?;
    Ok(body)
}

/// Human, token-free status line derived from a GetStatus JSON body.
fn status_line_from(status: &Value) -> String {
    let version = status.get("version").and_then(Value::as_str).unwrap_or("?");
    let protocol = status.get("protocol").and_then(Value::as_u64).unwrap_or(0);
    let paused = status
        .get("paused")
        .and_then(Value::as_bool)
        .unwrap_or(false);
    let paused_by = status
        .get("paused_by")
        .and_then(Value::as_str)
        .unwrap_or("");
    if paused {
        if paused_by.is_empty() {
            format!("airi-daemon {version} · protocol {protocol} · paused")
        } else {
            format!("airi-daemon {version} · protocol {protocol} · paused by {paused_by}")
        }
    } else {
        format!("airi-daemon {version} · protocol {protocol} · running")
    }
}

/// Passthrough for the `sources` object (or `{}` when absent/malformed).
fn sources_json_from(status: &Value) -> String {
    status
        .get("sources")
        .filter(|v| v.is_object())
        .map(ToString::to_string)
        .unwrap_or_else(|| "{}".to_string())
}

/// Parse the audit JSONL payload and return at most `cap` entries,
/// newest last (callers reverse for newest-first). Malformed lines are
/// skipped, never fatal.
fn parse_jsonl_tail(contents: &str, cap: usize) -> Vec<Value> {
    let mut rows: Vec<Value> = contents
        .lines()
        .filter_map(|line| {
            let trimmed = line.trim();
            if trimmed.is_empty() {
                return None;
            }
            serde_json::from_str::<Value>(trimmed).ok()
        })
        .collect();
    if rows.len() > cap {
        rows.drain(..rows.len() - cap);
    }
    rows
}

/// Shape one audit JSONL row into the public entry shape
/// `{ts_ms, source, verb, detail}` with tolerant coercions. The daemon's
/// writer uses the field name `event` (see `AuditLog::append`); an explicit
/// `verb` wins if a future writer emits one, otherwise `event` is mapped.
fn audit_entry_json(row: &Value) -> Value {
    let ts_ms = row
        .get("ts_ms")
        .and_then(|v| {
            v.as_u64()
                .or_else(|| v.as_i64().map(|i| i.max(0) as u64))
                .or_else(|| v.as_f64().map(|f| f.max(0.0) as u64))
        })
        .unwrap_or(0);
    let str_field = |key: &str| -> String {
        row.get(key)
            .and_then(Value::as_str)
            .unwrap_or("")
            .to_string()
    };
    let verb = row
        .get("verb")
        .and_then(Value::as_str)
        .or_else(|| row.get("event").and_then(Value::as_str))
        .unwrap_or("")
        .to_string();
    json!({
        "ts_ms": ts_ms,
        "source": str_field("source"),
        "verb": verb,
        "detail": str_field("detail"),
    })
}

/// Build the newest-first JSON array returned by `recentAudit()`.
/// Pure — split out for unit tests.
fn recent_audit_json(contents: &str, count: i32) -> String {
    let cap = count.clamp(0, AUDIT_CAP as i32) as usize;
    if cap == 0 {
        return "[]".to_string();
    }
    let mut rows = parse_jsonl_tail(contents, cap);
    rows.reverse();
    let entries: Vec<Value> = rows.iter().map(audit_entry_json).collect();
    Value::Array(entries).to_string()
}

/// cxx-qt bridge definitions for the awareness daemon bridge.
#[cxx_qt::bridge]
pub mod qobject {
    unsafe extern "C++" {
        include!("cxx-qt-lib/qstring.h");
        /// QString from cxx-qt-lib.
        type QString = cxx_qt_lib::QString;
    }

    extern "RustQt" {
        /// Awareness daemon client. One instance per page is fine; every
        /// invocation opens its own short-lived D-Bus connection.
        #[qobject]
        #[qml_element]
        #[namespace = "airi_qt"]
        #[qproperty(bool, running, READ, NOTIFY)]
        #[qproperty(bool, paused, READ, NOTIFY)]
        #[qproperty(QString, sources_json, cxx_name = "sourcesJson", READ, NOTIFY)]
        #[qproperty(QString, audit_path, cxx_name = "auditPath", READ, NOTIFY)]
        #[qproperty(QString, status_line, cxx_name = "statusLine", READ, NOTIFY)]
        type DaemonController = super::DaemonControllerRust;
    }

    extern "RustQt" {
        /// `true` once a `GetStatus` call succeeded within the timeout.
        /// Every refresh path emits `runningChanged`.
        #[qinvokable]
        fn refresh(self: Pin<&mut DaemonController>);

        /// Enable/disable one observer source (`sleep`, `lock`, `media`,
        /// `network`, `power`). Returns the value read back from the daemon
        /// after the change — **not** the requested one (a refused toggle
        /// reports honestly). `false` when the daemon is unreachable.
        #[qinvokable]
        #[cxx_name = "toggleSource"]
        fn toggle_source(self: Pin<&mut DaemonController>, source: QString, enabled: bool) -> bool;

        /// Pause/resume ALL observers. Returns the paused state read back
        /// after the change. `false` when the daemon is unreachable.
        #[qinvokable]
        #[cxx_name = "togglePause"]
        fn toggle_pause(self: Pin<&mut DaemonController>) -> bool;

        /// Read the shared audit JSONL file and return at most `count`
        /// (clamped to 50) newest-first entries shaped
        /// `{ts_ms, source, verb, detail}`. Malformed lines are skipped.
        /// Never throws; a missing/unreadable file yields `[]`.
        #[qinvokable]
        #[cxx_name = "recentAudit"]
        fn recent_audit(self: &DaemonController, count: i32) -> QString;

        /// Truncate the shared audit file to zero bytes. The daemon is
        /// not involved: appends use `O_APPEND`, so truncation is safe.
        /// The file itself is kept (never deleted); the daemon's in-memory
        /// ring buffer is **not** cleared. Returns `true` on success;
        /// creates the file when missing.
        #[qinvokable]
        #[cxx_name = "clearAudit"]
        fn clear_audit(self: Pin<&mut DaemonController>) -> bool;
    }
}

/// Rust storage for `DaemonController`.
pub struct DaemonControllerRust {
    running: bool,
    paused: bool,
    sources_json: QString,
    audit_path: QString,
    status_line: QString,
}

impl Default for DaemonControllerRust {
    fn default() -> Self {
        Self {
            running: false,
            paused: false,
            sources_json: QString::from("{}"),
            audit_path: QString::from(audit_file_path_display().as_str()),
            status_line: QString::from(""),
        }
    }
}

impl qobject::DaemonController {
    /// Snapshot mirror used to update the qproperty storage + notify.
    fn write_mirror(
        mut self: Pin<&mut Self>,
        running: bool,
        paused: bool,
        sources_json: String,
        audit_path: String,
        status_line: String,
    ) {
        let mut inner = self.as_mut().rust_mut();
        inner.running = running;
        inner.paused = paused;
        inner.sources_json = QString::from(sources_json.as_str());
        inner.audit_path = QString::from(audit_path.as_str());
        inner.status_line = QString::from(status_line.as_str());
        self.as_mut().running_changed();
        self.as_mut().paused_changed();
        self.as_mut().sources_json_changed();
        self.as_mut().audit_path_changed();
        self.as_mut().status_line_changed();
    }

    /// Apply a `GetStatus` JSON body to the mirror (or the daemon-down
    /// state on `Err`). Shared by `refresh` and the mutating qinvokables.
    fn apply_status(self: Pin<&mut Self>, outcome: Result<String, dbus::Error>) {
        match outcome {
            Ok(body) => match serde_json::from_str::<Value>(&body) {
                Ok(status) => {
                    let audit_path = status
                        .get("audit_path")
                        .and_then(Value::as_str)
                        .filter(|s| !s.is_empty())
                        .map(str::to_string)
                        .unwrap_or_else(audit_file_path_display);
                    let status_line = status_line_from(&status);
                    let sources_json = sources_json_from(&status);
                    let paused = status
                        .get("paused")
                        .and_then(Value::as_bool)
                        .unwrap_or(false);
                    self.write_mirror(true, paused, sources_json, audit_path, status_line);
                }
                Err(e) => {
                    eprintln!("[airi-qt] daemon: GetStatus returned invalid JSON: {e}");
                    self.write_mirror(
                        false,
                        false,
                        "{}".to_string(),
                        audit_file_path_display(),
                        DAEMON_DOWN_STATUS.to_string(),
                    );
                }
            },
            Err(e) => {
                eprintln!("[airi-qt] daemon: GetStatus failed ({e}); treating daemon as down");
                self.write_mirror(
                    false,
                    false,
                    "{}".to_string(),
                    audit_file_path_display(),
                    DAEMON_DOWN_STATUS.to_string(),
                );
            }
        }
    }

    /// Re-read the daemon status into the mirror. Never throws.
    pub fn refresh(mut self: Pin<&mut Self>) {
        let outcome = call_get_status();
        self.as_mut().apply_status(outcome);
    }

    /// Enable/disable one source; returns the read-back value.
    pub fn toggle_source(mut self: Pin<&mut Self>, source: QString, enabled: bool) -> bool {
        let source = crate::bridges::qstring_to_string(&source);
        let set_result = (|| -> Result<String, dbus::Error> {
            use dbus::blocking::Connection;
            let conn = Connection::new_session()?;
            let proxy = conn.with_proxy(DAEMON_NAME, DAEMON_PATH, DBUS_TIMEOUT);
            let (body,): (String,) =
                proxy.method_call(DAEMON_INTERFACE, "SetSource", (source.as_str(), enabled))?;
            Ok(body)
        })();
        match &set_result {
            Ok(body) => {
                // The daemon answers with {ok, error?}; surface refusals so
                // the read-back below is not mistaken for a silent success.
                if let Ok(parsed) = serde_json::from_str::<Value>(body) {
                    if parsed.get("ok").and_then(Value::as_bool) == Some(false) {
                        let err = parsed
                            .get("error")
                            .and_then(Value::as_str)
                            .unwrap_or("unknown error");
                        eprintln!("[airi-qt] daemon: SetSource({source}) refused: {err}");
                    }
                }
            }
            Err(e) => eprintln!("[airi-qt] daemon: SetSource({source}) failed: {e}"),
        }
        self.as_mut().refresh();
        if !self.running {
            return false;
        }
        let sources_json = crate::bridges::qstring_to_string(&self.sources_json);
        serde_json::from_str::<Value>(&sources_json)
            .ok()
            .and_then(|s| s.get(source.as_str()).and_then(Value::as_bool))
            .unwrap_or(false)
    }

    /// Pause/resume all observers; returns the paused state read back.
    pub fn toggle_pause(mut self: Pin<&mut Self>) -> bool {
        let target = !self.paused;
        let pause_result = (|| -> Result<(), dbus::Error> {
            use dbus::blocking::Connection;
            let conn = Connection::new_session()?;
            let proxy = conn.with_proxy(DAEMON_NAME, DAEMON_PATH, DBUS_TIMEOUT);
            proxy.method_call(DAEMON_INTERFACE, "Pause", (target,))
        })();
        if let Err(e) = &pause_result {
            eprintln!("[airi-qt] daemon: Pause({target}) failed: {e}");
        }
        self.as_mut().refresh();
        self.paused
    }

    /// Read the shared audit file, newest-first, shaped
    /// `{ts_ms, source, verb, detail}`. Never throws.
    pub fn recent_audit(&self, count: i32) -> QString {
        let Some(path) = audit_file_path() else {
            return QString::from("[]");
        };
        match read_to_string(&path) {
            Ok(contents) => QString::from(recent_audit_json(&contents, count).as_str()),
            Err(e) => {
                if e.kind() != std::io::ErrorKind::NotFound {
                    eprintln!(
                        "[airi-qt] daemon: failed to read audit file {}: {e}",
                        path.display()
                    );
                }
                QString::from("[]")
            }
        }
    }

    /// Truncate the shared audit file to zero bytes. Never deletes the
    /// file; never touches the daemon's in-memory ring buffer.
    pub fn clear_audit(self: Pin<&mut Self>) -> bool {
        let Some(path) = audit_file_path() else {
            eprintln!("[airi-qt] daemon: no data dir; cannot clear the audit log");
            return false;
        };
        if let Some(parent) = path.parent() {
            if let Err(e) = std::fs::create_dir_all(parent) {
                eprintln!(
                    "[airi-qt] daemon: failed to create audit dir {}: {e}",
                    parent.display()
                );
                return false;
            }
        }
        let result = OpenOptions::new()
            .write(true)
            .create(true)
            .truncate(true)
            .open(&path);
        match result {
            Ok(mut file) => match file.flush() {
                Ok(()) => true,
                Err(e) => {
                    eprintln!("[airi-qt] daemon: failed to flush truncated audit file: {e}");
                    false
                }
            },
            Err(e) => {
                eprintln!(
                    "[airi-qt] daemon: failed to truncate audit file {}: {e}",
                    path.display()
                );
                false
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const JSONL: &str = concat!(
        r#"{"ts_ms": 1000, "source": "sleep", "verb": "wake", "detail": "resumed"}"#,
        "\n",
        "not json at all\n",
        r#"{"ts_ms": 2000, "source": "lock", "verb": "locked", "detail": "screen locked"}"#,
        "\n",
        r#"{"ts_ms": 3000, "source": "power", "verb": "ac", "detail": "on AC"}"#,
        "\n",
    );

    #[test]
    fn recent_audit_json_is_newest_first_and_skips_malformed() {
        let out = recent_audit_json(JSONL, 50);
        let parsed: Value = serde_json::from_str(&out).expect("valid JSON");
        let arr = parsed.as_array().expect("array");
        assert_eq!(arr.len(), 3);
        assert_eq!(arr[0]["ts_ms"], 3000);
        assert_eq!(arr[1]["ts_ms"], 2000);
        assert_eq!(arr[2]["ts_ms"], 1000);
        assert_eq!(arr[0]["source"], "power");
        assert_eq!(arr[0]["verb"], "ac");
        assert_eq!(arr[0]["detail"], "on AC");
    }

    #[test]
    fn recent_audit_json_clamps_count_to_cap_and_handles_zero() {
        let out = recent_audit_json(JSONL, 2);
        let parsed: Value = serde_json::from_str(&out).unwrap();
        assert_eq!(parsed.as_array().unwrap().len(), 2);
        assert_eq!(parsed[0]["ts_ms"], 3000);
        assert_eq!(recent_audit_json(JSONL, 0), "[]");
        assert_eq!(recent_audit_json(JSONL, -5), "[]");
        // Cap is 50 even when the caller asks for more.
        let big = (0..80)
            .map(|i| format!(r#"{{"ts_ms": {i}, "source": "system", "verb": "v", "detail": "d"}}"#))
            .collect::<Vec<_>>()
            .join("\n");
        let parsed: Value = serde_json::from_str(&recent_audit_json(&big, 1000)).unwrap();
        assert_eq!(parsed.as_array().unwrap().len(), AUDIT_CAP);
    }

    #[test]
    fn recent_audit_json_tolerates_missing_fields_and_empty_input() {
        let out = recent_audit_json("", 10);
        assert_eq!(out, "[]");
        let out = recent_audit_json("{}\n", 10);
        let parsed: Value = serde_json::from_str(&out).unwrap();
        assert_eq!(parsed[0]["ts_ms"], 0);
        assert_eq!(parsed[0]["source"], "");
    }

    #[test]
    fn recent_audit_json_maps_daemon_event_field_to_verb() {
        // The daemon writes `{ts_ms, source, event, detail}`; an explicit
        // `verb` field wins when both are present.
        let out = recent_audit_json(
            r#"{"ts_ms": 100, "source": "lock", "event": "locked", "detail": "d"}"#,
            10,
        );
        let parsed: Value = serde_json::from_str(&out).unwrap();
        assert_eq!(parsed[0]["verb"], "locked");
        let out = recent_audit_json(
            r#"{"ts_ms": 100, "source": "lock", "event": "locked", "verb": "screen-lock", "detail": "d"}"#,
            10,
        );
        let parsed: Value = serde_json::from_str(&out).unwrap();
        assert_eq!(parsed[0]["verb"], "screen-lock");
    }

    #[test]
    fn status_line_reflects_paused_state_and_paused_by() {
        let running =
            status_line_from(&json!({"protocol": 1, "version": "0.1.0", "paused": false}));
        assert!(running.contains("running"));
        assert!(running.contains("0.1.0"));
        let paused = status_line_from(
            &json!({"protocol": 1, "version": "0.1.0", "paused": true, "paused_by": "user"}),
        );
        assert!(paused.contains("paused by user"));
        let paused_plain =
            status_line_from(&json!({"protocol": 1, "version": "0.1.0", "paused": true}));
        assert!(paused_plain.contains("paused"));
        assert!(!paused_plain.contains("by"));
    }

    #[test]
    fn sources_json_passthrough_or_empty_object() {
        let s = sources_json_from(&json!({"sources": {"sleep": true, "power": false}}));
        let parsed: Value = serde_json::from_str(&s).unwrap();
        assert_eq!(parsed["sleep"], true);
        assert_eq!(parsed["power"], false);
        assert_eq!(sources_json_from(&json!({})), "{}");
        assert_eq!(sources_json_from(&json!({"sources": 42})), "{}");
    }
}
