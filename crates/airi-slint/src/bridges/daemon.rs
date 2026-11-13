// SPDX-License-Identifier: GPL-3.0-or-later
//! Awareness daemon bridge (`DaemonState`): the UI face of the
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
//!   {sleep, lock, media, network, power[, screen]}, ring_count, audit_path,
//!   session_bus, system_bus, audit_pruned, paused_by}`
//! - `SetSource(source: s, enabled: b) -> s` — JSON `{ok, error?}`;
//!   `source ∈ {sleep, lock, media, network, power}` (plus `screen` once the
//!   parallel P2a daemon lane lands — this bridge never whitelists, it
//!   passes the name through and reports the daemon's read-back honestly)
//! - `Pause(p: b)` — arm/disarm ALL observers
//! - `GetFocusDigest() -> s` — JSON `{ok: true, app, title, lines,
//!   text_length, skipped_password_nodes}` | `{ok: false, error}` — added by
//!   the P2a daemon lane in parallel with this bridge; when that daemon is
//!   absent the D-Bus call fails and `fetchFocusDigest()` degrades to
//!   `false` with an honest status line.
//! - `SetExcludedApps(json string) -> s` — JSON `{ok, error?}`; argument is a
//!   JSON array of app-name strings (matched case-insensitively by the
//!   daemon, exclusions applied BEFORE any digest content is displayed).
//!
//! # What this bridge deliberately does not do
//!
//! - No autonomous actions, no agent dispatch, no chat wiring. It toggles
//!   and views only.
//! - No D-Bus activation *guarantee*: when the daemon is absent every
//!   method call degrades gracefully (`running=false`, a human status line).
//!   `refresh()` never throws and no call panics on a missing bus/daemon.
//!
//! # Threading / cost model
//!
//! All methods run on the UI thread. Each D-Bus call opens and closes
//! its own blocking connection with an 800 ms timeout — at the page's
//! polling cadence (1 s Timer) this is cheap and keeps failure isolation
//! trivial (a hung daemon cannot wedge the UI; worst case one 800 ms stall
//! per poll, bounded and visible as `running=false` if it times out).
//!
//! # Screen awareness (P2) additions
//!
//! `focus_digest_json` holds the last digest `fetch_focus_digest()` returned
//! (`""` until the first successful preview; only ever set on `{ok: true}`).
//! `screen_enabled` mirrors `sources.screen` when the daemon reports it
//! (P2a); it is `false` when the key is absent — never fabricated.
//! `fetch_focus_digest()` performs exactly one D-Bus round-trip on demand
//! (never on a timer); the fetched digest is handed to the UI untouched and is
//! the only place screen content appears. `setExcludedApps()` validates the
//! payload as a JSON array of non-empty strings before it hits the bus.
//! Neither call throws; both degrade to `false` + a token-free status line.
//!
//! # Audit viewer
//!
//! `recent_audit()`/`clear_audit()` operate on the shared audit file at
//! `dirs::data_dir()/airi-slint/audit/awareness-audit.jsonl` — the same path the
//! daemon resolves in `audit.rs` (`AUDIT_FILE_NAME = "awareness-audit.jsonl"`)
//! and the same one `GetStatus` reports in its `audit_path` field. (Note: an
//! earlier draft of the lane brief called the file `awareness.jsonl`; the
//! daemon source of truth wins and this bridge matches it.)
//! `clear_audit()` never deletes or truncates history: it renames the file
//! to `awareness-audit.jsonl.cleared-<unix-ts>` (same dir, atomic on the same
//! fs) so the forensic trail survives; a same-ts collision gets a
//! `-<counter>` suffix. It does **not** clear the daemon's in-memory ring
//! buffer (the ring may re-serve events the page stops showing). The file is
//! 7-day-retention, redacted JSONL; nothing leaves the machine.
//! `recent_audit()` reads only the last 64 KiB of that file (enough for the 50
//! rows it shows) because the page polls it every second and the log grows
//! unbounded up to its 7-day retention.
//!
//! # Wake briefing (P4a)
//!
//! When the machine wakes from sleep, AIRI can show a short, deterministic
//! fact sheet as a desktop notification — opt-in (`settings/awareness`
//! blob, `wakeBriefing`, default **off**), fully offline, no LLM. The facts
//! are arithmetic over `GetStatus`; nothing leaves the machine and no
//! network/LLM/token call is made.
//!
//! Protocol-1 contract additions consumed here (additive; peers that
//! predate them simply report nothing): `last_suspend_ms`, `last_wake_ms`,
//! `units_failed_since_wake` (u64) and `recent_failed_units` (string array,
//! newest first, capped at 3 by this bridge). `sources.power == true`
//! means *on battery*. A missing/undecodable field reads as "not reported"
//! and its segment is **omitted** from the line — never fabricated.
//!
//! `wake_briefing()` returns the one-liner (`""` = quiet). `notify_wake_briefing()`
//! renders it via notify-rust on the **session** bus (title "AIRI", urgency
//! Normal, timeout = server default, no explicit icon) and reports honestly
//! whether the notification was actually requested. `check_wake_briefing_tick()`
//! is a 5 s edge detector driven by the shell's separate Repeat Timer:
//! it fires the notify **exactly once per wake edge**, only when the user
//! opted in and awareness is not paused. The first-ever observation primes
//! silently (a wake that happened before this app/daemon started never
//! produces a brief). A suspend edge (`last_suspend_ms` advancing) re-arms
//! the detector. The master kill switch wins over everything here: paused ⇒
//! the line is empty and no notification is ever built.

use chrono::{Local, TimeZone};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::fs::File;
use std::io::{Read as _, Seek as _, SeekFrom};
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
/// Hard cap on audit rows returned by `recent_audit()` (and shown by the page).
const AUDIT_CAP: usize = 50;
/// Tail window read for `recent_audit()`: comfortably holds `AUDIT_CAP` typical
/// rows (~200 B each) while keeping the 1 s poll off the full file.
const AUDIT_TAIL_BYTES: usize = 64 * 1024;
/// `status_line` shown when the daemon cannot be reached at all.
const DAEMON_DOWN_STATUS: &str =
    "airi-daemon is not running — see packaging/README.md (dev-run section)";

/// Resolve the shared audit file path exactly the way the daemon does:
/// `dirs::data_dir()/airi-slint/audit/awareness-audit.jsonl`.
fn audit_file_path() -> Option<std::path::PathBuf> {
    dirs::data_dir().map(|d| d.join("airi-slint").join("audit").join(AUDIT_FILE_NAME))
}

/// Path used for display + file operations, with a relative fallback when
/// the platform has no data dir (display-only; operations will fail and
/// report `false` honestly).
fn audit_file_path_display() -> String {
    audit_file_path()
        .map(|p| p.to_string_lossy().into_owned())
        .unwrap_or_else(|| format!("airi-slint/audit/{AUDIT_FILE_NAME}"))
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

/// `sources.screen` when the daemon reports it (P2a). Anything else —
/// absent key, non-bool, daemon predates the screen source — reads as
/// `false`. Never fabricated.
fn screen_enabled_from_sources_json(sources_json: &str) -> bool {
    serde_json::from_str::<Value>(sources_json)
        .ok()
        .and_then(|v| v.get("screen").and_then(Value::as_bool))
        .unwrap_or(false)
}

// ── Wake briefing (P4a) ──────────────────────────────────────────────────

/// Storage key for the awareness settings blob (`{ wakeBriefing: bool }`).
const AWARENESS_KEY: &str = "settings/awareness";

/// The wake-briefing facts, straight off a `GetStatus` body. Everything the
/// composer needs and nothing it does not. `units_failed_since_wake` is
/// `None` when the daemon cannot report it (pre-P4a1) — the composer then
/// omits the segment instead of claiming "no failures".
#[derive(Debug, Clone, PartialEq, Eq)]
struct WakeSnapshot {
    /// `PrepareForSleep(true)` observed at (ms since epoch), or 0.
    last_suspend_ms: u64,
    /// `PrepareForSleep(false)` observed at (ms since epoch), or 0 = never
    /// since this daemon started ⇒ no brief.
    last_wake_ms: u64,
    /// Units observed in failed state since the last wake edge. `None` =
    /// the daemon does not report it (pre-P4a1).
    units_failed_since_wake: Option<u64>,
    /// Up to 3 failed unit names, newest first (the daemon caps this too).
    recent_failed_units: Vec<String>,
    /// `sources.power == true` ⇒ on battery. `None` = not reported.
    on_battery: Option<bool>,
}

/// Extract the wake-briefing facts from a `GetStatus` body. Tolerant by
/// design: absent/undecodable fields read as "not reported" rather than as
/// fabricated values.
fn wake_snapshot_from(status: &Value) -> WakeSnapshot {
    let u64_field = |key: &str| status.get(key).and_then(Value::as_u64);
    WakeSnapshot {
        last_suspend_ms: u64_field("last_suspend_ms").unwrap_or(0),
        last_wake_ms: u64_field("last_wake_ms").unwrap_or(0),
        units_failed_since_wake: u64_field("units_failed_since_wake"),
        recent_failed_units: status
            .get("recent_failed_units")
            .and_then(Value::as_array)
            .map(|arr| {
                arr.iter()
                    .filter_map(Value::as_str)
                    .take(3)
                    .map(str::to_string)
                    .collect()
            })
            .unwrap_or_default(),
        on_battery: status
            .get("sources")
            .and_then(|s| s.get("power"))
            .and_then(Value::as_bool),
    }
}

/// Rust-side state of the wake-edge detector. Not a UI-facing field; lives
/// on the state struct, so each UI instance primes independently.
#[derive(Debug, Default, Clone, PartialEq, Eq)]
struct WakeEdge {
    /// False until the first observation; the first tick primes silently.
    primed: bool,
    /// `last_wake_ms` as of the last tick.
    last_wake_ms: u64,
    /// `last_suspend_ms` as of the last tick; an advance re-arms the edge.
    last_suspend_ms: u64,
    /// Consumed by the wake edge this suspend cycle; reset on suspend.
    fired: bool,
}

/// One tick of the edge detector. Pure — split out for unit tests.
///
/// Returns `true` iff the caller should fire the notification now. Consumes
/// the wake edge in all cases (enabled or not, paused or not) so a brief is
/// never delivered stale on a later tick.
fn wake_edge_step(
    state: &mut WakeEdge,
    last_wake_ms: u64,
    last_suspend_ms: u64,
    enabled: bool,
    paused: bool,
) -> bool {
    if !state.primed {
        // First-ever observation: prime silently. A wake that happened
        // before this app/daemon started never produces a brief.
        state.primed = true;
        state.last_wake_ms = last_wake_ms;
        state.last_suspend_ms = last_suspend_ms;
        state.fired = false;
        return false;
    }
    if last_suspend_ms != state.last_suspend_ms {
        // A suspend cycle re-arms the detector (PrepareForSleep(true)).
        state.last_suspend_ms = last_suspend_ms;
        state.fired = false;
    }
    if last_wake_ms != state.last_wake_ms {
        state.last_wake_ms = last_wake_ms;
        if state.fired {
            return false;
        }
        state.fired = true;
        return enabled && !paused;
    }
    false
}

/// Elapsed-away duration, human and deterministic: `<1m`, `~45m`, `~7h`,
/// `~7h05m`, `~31h` (hours are not capped at 24 — a week away is `~168h`,
/// which is honest, if blunt).
fn format_duration_ms(ms: u64) -> String {
    let total_minutes = ms / 60_000;
    if total_minutes == 0 {
        return "<1m".to_string();
    }
    let hours = total_minutes / 60;
    let minutes = total_minutes % 60;
    if hours == 0 {
        format!("~{minutes}m")
    } else if minutes == 0 {
        format!("~{hours}h")
    } else {
        format!("~{hours}h{minutes:02}m")
    }
}

/// `HH:MM` for `unix_ms` shifted by `utc_offset_seconds`. Dependency-free;
/// no calendar math needed for a bare wall-clock pair.
fn clock_hhmm(unix_ms: u64, utc_offset_seconds: i32) -> String {
    let secs = (unix_ms / 1000) as i128 + i128::from(utc_offset_seconds);
    let secs = secs.max(0);
    let day_secs = secs % 86_400;
    format!("{:02}:{:02}", day_secs / 3600, (day_secs % 3600) / 60)
}

/// Local UTC offset (seconds) at `unix_ms`, resolved via the system time
/// zone so DST is handled. Falls back to 0 (UTC) when the system zone
/// cannot be resolved — the line then carries UTC wall times, which is
/// honest, just not local.
fn local_utc_offset_seconds(unix_ms: u64) -> i32 {
    let utc = match chrono::DateTime::from_timestamp_millis(i64::try_from(unix_ms).unwrap_or(0)) {
        Some(dt) => dt,
        None => return 0,
    };
    Local
        .offset_from_utc_datetime(&utc.naive_utc())
        .local_minus_utc()
}

/// Compose the deterministic wake fact sheet. Returns `""` when there is
/// nothing honest to say (awareness paused, or no wake observed since the
/// daemon started). Pure — split out for unit tests.
///
/// Shape, when everything is reported:
///   `AIRI: you were away ~7h (23:41 → 06:54). Since then: 2 unit failures (nginx.service, docker.service). Battery on AC.`
/// Segments the daemon cannot report are omitted entirely; the phrase never
/// invents a fact. Names list at most 3 units (newest first, as the daemon
/// sends them).
fn compose_wake_briefing(snapshot: &WakeSnapshot, paused: bool, utc_offset_seconds: i32) -> String {
    if paused || snapshot.last_wake_ms == 0 {
        return String::new();
    }
    let wake_clock = clock_hhmm(snapshot.last_wake_ms, utc_offset_seconds);
    let mut parts: Vec<String> = Vec::with_capacity(3);
    if snapshot.last_suspend_ms > 0 && snapshot.last_wake_ms >= snapshot.last_suspend_ms {
        let away = format_duration_ms(snapshot.last_wake_ms - snapshot.last_suspend_ms);
        let suspend_clock = clock_hhmm(snapshot.last_suspend_ms, utc_offset_seconds);
        parts.push(format!(
            "you were away {away} ({suspend_clock} → {wake_clock})"
        ));
    } else {
        parts.push(format!("you woke at {wake_clock}"));
    }
    match snapshot.units_failed_since_wake {
        None => {} // daemon cannot report → say nothing
        Some(0) => parts.push("Since then: no unit failures".to_string()),
        Some(n) => {
            let noun = if n == 1 { "failure" } else { "failures" };
            if snapshot.recent_failed_units.is_empty() {
                parts.push(format!("Since then: {n} unit {noun}"));
            } else {
                parts.push(format!(
                    "Since then: {n} unit {noun} ({})",
                    snapshot.recent_failed_units.join(", ")
                ));
            }
        }
    }
    match snapshot.on_battery {
        Some(true) => parts.push("On battery".to_string()),
        Some(false) => parts.push("Battery on AC".to_string()),
        None => {}
    }
    format!("AIRI: {}.", parts.join(". "))
}

/// Outcome of reading `settings/awareness`. `Corrupt` carries the error
/// text for the status line; `Loaded`/`Missing` map to normal operation.
/// Same never-overwrite-a-corrupt-blob rule as `settings/hearing`.
enum AwarenessBlobLoad {
    /// A blob was read and parsed successfully.
    Loaded(AwarenessSettingsBlob),
    /// No row exists (fresh install, or the store is not registered).
    Missing,
    /// A row exists but could not be read/parsed; never overwrite it.
    Corrupt(String),
}

/// The `settings/awareness` blob. Unknown fields are ignored on load;
/// missing fields fall back to defaults. Persisted camelCase next to the
/// Electron settings style.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
struct AwarenessSettingsBlob {
    /// Opt-in: show the one-line fact sheet after a wake. Default `false`.
    wake_briefing: bool,
}

fn load_awareness_blob() -> AwarenessBlobLoad {
    let Some(store) = crate::bridges::settings_store() else {
        return AwarenessBlobLoad::Missing;
    };
    match store.load_opt::<AwarenessSettingsBlob>(AWARENESS_KEY) {
        Ok(Some(blob)) => AwarenessBlobLoad::Loaded(blob),
        Ok(None) => AwarenessBlobLoad::Missing,
        Err(e) => AwarenessBlobLoad::Corrupt(e.to_string()),
    }
}

fn save_awareness_blob(blob: &AwarenessSettingsBlob) -> anyhow::Result<()> {
    let Some(store) = crate::bridges::settings_store() else {
        anyhow::bail!("settings store not registered");
    };
    store.save(AWARENESS_KEY, blob)
}

/// Persisted opt-in flag, re-read fresh on every call (one small SQLite row
/// — the same cost the page pays on its 1 s poll). Reading fresh instead of
/// caching in the state keeps the main shell and the settings page in
/// agreement across windows; a stale cache would
/// silently never fire after the user flips the toggle. A corrupt blob
/// reads as off.
fn wake_briefing_enabled_persisted() -> bool {
    match load_awareness_blob() {
        AwarenessBlobLoad::Loaded(blob) => blob.wake_briefing,
        AwarenessBlobLoad::Missing => false,
        AwarenessBlobLoad::Corrupt(e) => {
            eprintln!(
                "[airi-slint] awareness: {AWARENESS_KEY} unreadable ({e}); wake briefing stays off"
            );
            false
        }
    }
}

/// Render a wake briefing as a desktop notification on the **session** bus.
/// Returns `false` in smoke mode (never fires), when the notification daemon
/// is unreachable, or on any other failure. Title is `AIRI`; the body is
/// the composed line. Urgency is Normal (Low is the other acceptable value
/// — this is a passive fact sheet, not an alert); timeout is the server
/// default; no explicit icon is set.
fn render_wake_notification(line: &str) -> bool {
    if crate::bridges::smoke() {
        eprintln!("[airi-slint] smoke: wake briefing notification suppressed");
        return false;
    }
    match notify_rust::Notification::new()
        .appname("AIRI")
        .summary("AIRI")
        .body(line)
        .urgency(notify_rust::Urgency::Normal)
        .timeout(notify_rust::Timeout::Default)
        .show()
    {
        Ok(_) => true,
        Err(e) => {
            eprintln!("[airi-slint] notify: wake briefing failed to show: {e}");
            false
        }
    }
}

/// One GetFocusDigest round-trip. `Ok(body)` is the raw JSON string; any
/// D-Bus failure is `Err`.
fn call_get_focus_digest() -> Result<String, dbus::Error> {
    use dbus::blocking::Connection;
    let conn = Connection::new_session()?;
    let proxy = conn.with_proxy(DAEMON_NAME, DAEMON_PATH, DBUS_TIMEOUT);
    let (body,): (String,) = proxy.method_call(DAEMON_INTERFACE, "GetFocusDigest", ())?;
    Ok(body)
}

/// One SetExcludedApps round-trip. `Ok(body)` is the raw JSON string.
fn call_set_excluded_apps(list_json: &str) -> Result<String, dbus::Error> {
    use dbus::blocking::Connection;
    let conn = Connection::new_session()?;
    let proxy = conn.with_proxy(DAEMON_NAME, DAEMON_PATH, DBUS_TIMEOUT);
    let (body,): (String,) =
        proxy.method_call(DAEMON_INTERFACE, "SetExcludedApps", (list_json,))?;
    Ok(body)
}

/// Classification of a `GetFocusDigest` reply body. Pure — split out for
/// unit tests.
#[derive(Debug, PartialEq, Eq)]
enum DigestOutcome {
    /// `{ok: true, ...}` — the digest may be shown.
    Ok,
    /// `{ok: false, error: "excluded"}` — the focused app is on the
    /// exclusion list; the daemon sent no content.
    Excluded,
    /// Anything else `{ok: false, error}` — carries the daemon's raw,
    /// spec'd error string (token-free by spec).
    Error(String),
}

fn classify_digest_body(body: &str) -> DigestOutcome {
    match serde_json::from_str::<Value>(body) {
        Ok(v) => {
            if v.get("ok").and_then(Value::as_bool) == Some(true) {
                DigestOutcome::Ok
            } else {
                let err = v
                    .get("error")
                    .and_then(Value::as_str)
                    .unwrap_or("unknown error")
                    .to_string();
                if err == "excluded" {
                    DigestOutcome::Excluded
                } else {
                    DigestOutcome::Error(err)
                }
            }
        }
        Err(_) => DigestOutcome::Error("malformed reply from airi-daemon".to_string()),
    }
}

/// Validate the exclusion-list payload: a JSON array of non-empty strings.
/// Returns the trimmed-of-nothing, order-preserving entries (names are the
/// daemon's to match, case-insensitively). Pure — split out for unit tests.
fn validate_excluded_apps(list_json: &str) -> Result<Vec<String>, String> {
    let v: Value = serde_json::from_str(list_json).map_err(|e| format!("invalid JSON: {e}"))?;
    let arr = v
        .as_array()
        .ok_or_else(|| "expected a JSON array of app-name strings".to_string())?;
    let mut out = Vec::with_capacity(arr.len());
    for item in arr {
        match item.as_str() {
            Some(s) if !s.trim().is_empty() => out.push(s.to_string()),
            _ => {
                return Err("expected a JSON array of non-empty app-name strings".to_string());
            }
        }
    }
    Ok(out)
}

/// `{ok}` classification for a `SetExcludedApps` reply body. Pure.
fn set_excluded_apps_ok(body: &str) -> Result<(), String> {
    match serde_json::from_str::<Value>(body) {
        Ok(v) => match v.get("ok").and_then(Value::as_bool) {
            Some(true) => Ok(()),
            Some(false) => Err(v
                .get("error")
                .and_then(Value::as_str)
                .unwrap_or("unknown error")
                .to_string()),
            None => Err("malformed reply from airi-daemon".to_string()),
        },
        Err(_) => Err("malformed reply from airi-daemon".to_string()),
    }
}

/// Parse the tail of the audit JSONL `path` and return at most `cap` entries,
/// newest last (callers reverse for newest-first). Malformed lines are
/// skipped, never fatal.
///
/// Reads only the last [`AUDIT_TAIL_BYTES`] — the file is 7-day-retention with
/// no size cap and `recentAudit()` is polled every second, so the cost has to
/// stay bounded no matter how large the log has grown. A missing/unreadable
/// file yields an empty vec.
fn parse_jsonl_tail(path: &std::path::Path, cap: usize) -> Vec<Value> {
    let read_tail = || -> std::io::Result<Vec<Value>> {
        let mut file = File::open(path)?;
        let len = file.seek(SeekFrom::End(0))?;
        file.seek(SeekFrom::Start(len.saturating_sub(AUDIT_TAIL_BYTES as u64)))?;
        let mut buf = String::new();
        file.read_to_string(&mut buf)?;
        // A fragment cut mid-line by the seek is not valid JSON.
        let start = len as usize - buf.len();
        let lines: Vec<&str> = if start == 0 {
            buf.lines().collect()
        } else {
            match buf.find('\n') {
                Some(i) => buf[i + 1..].lines().collect(),
                None => Vec::new(),
            }
        };
        let mut rows: Vec<Value> = lines
            .into_iter()
            .rev()
            .filter_map(|line| {
                let trimmed = line.trim();
                if trimmed.is_empty() {
                    return None;
                }
                serde_json::from_str::<Value>(trimmed).ok()
            })
            .take(cap)
            .collect();
        rows.reverse();
        Ok(rows)
    };
    read_tail().unwrap_or_else(|e| {
        if e.kind() != std::io::ErrorKind::NotFound {
            eprintln!(
                "[airi-slint] daemon: failed to read audit file {}: {e}",
                path.display()
            );
        }
        Vec::new()
    })
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

/// Shape the tail of the audit JSONL `path` into the newest-first JSON array
/// returned by `recentAudit()`.
fn recent_audit_file_json(path: &std::path::Path, count: i32) -> String {
    let cap = count.clamp(0, AUDIT_CAP as i32) as usize;
    if cap == 0 {
        return "[]".to_string();
    }
    let mut rows = parse_jsonl_tail(path, cap);
    rows.reverse();
    let entries: Vec<Value> = rows.iter().map(audit_entry_json).collect();
    Value::Array(entries).to_string()
}

/// Awareness-daemon view-model (one process-wide instance).
pub struct DaemonState {
    /// `true` once a `GetStatus` call succeeded within the timeout.
    pub running: bool,
    /// `true` when every observer is paused (kill switch).
    pub paused: bool,
    /// Passthrough of the `sources` object (`{}` when absent/malformed).
    pub sources_json: String,
    /// Audit log path as the daemon reports it.
    pub audit_path: String,
    /// Human status line.
    pub status_line: String,
    /// Last successful `GetFocusDigest` body (`""` until the first hit).
    pub focus_digest_json: String,
    /// Mirrors `sources.screen` when the daemon reports it.
    pub screen_enabled: bool,
    /// Wake-briefing facts from the last successful `GetStatus`
    /// (`None` = daemon down / never observed).
    sleep_snapshot: Option<WakeSnapshot>,
    /// Wake-edge detector state; see [`WakeEdge`].
    wake_edge: WakeEdge,
}

impl Default for DaemonState {
    fn default() -> Self {
        Self {
            running: false,
            paused: false,
            sources_json: "{}".to_string(),
            audit_path: audit_file_path_display(),
            status_line: String::new(),
            focus_digest_json: String::new(),
            screen_enabled: false,
            sleep_snapshot: None,
            wake_edge: WakeEdge::default(),
        }
    }
}

impl DaemonState {
    /// Write the status mirror (the former property write + notify hop).
    fn write_mirror(
        &mut self,
        running: bool,
        paused: bool,
        sources_json: String,
        audit_path: String,
        status_line: String,
    ) {
        self.running = running;
        self.paused = paused;
        self.sources_json = sources_json;
        self.audit_path = audit_path;
        self.status_line = status_line;
        self.screen_enabled = screen_enabled_from_sources_json(&self.sources_json);
    }

    /// Set only the status line (leaves the rest of the mirror untouched).
    /// Used by the screen-awareness methods.
    fn set_status_line(&mut self, line: String) {
        self.status_line = line;
    }

    /// Apply a `GetStatus` JSON body to the mirror (or the daemon-down
    /// state on `Err`). Shared by `refresh` and the mutating methods.
    fn apply_status(&mut self, outcome: Result<String, dbus::Error>) {
        match outcome {
            Ok(body) => match serde_json::from_str::<Value>(&body) {
                Ok(status) => {
                    self.sleep_snapshot = Some(wake_snapshot_from(&status));
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
                    eprintln!("[airi-slint] daemon: GetStatus returned invalid JSON: {e}");
                    self.sleep_snapshot = None;
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
                eprintln!("[airi-slint] daemon: GetStatus failed ({e}); treating daemon as down");
                self.sleep_snapshot = None;
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
    pub fn refresh(&mut self) {
        let outcome = call_get_status();
        self.apply_status(outcome);
    }

    /// Enable/disable one source; returns the read-back value.
    pub fn toggle_source(&mut self, source: &str, enabled: bool) -> bool {
        let set_result = (|| -> Result<String, dbus::Error> {
            use dbus::blocking::Connection;
            let conn = Connection::new_session()?;
            let proxy = conn.with_proxy(DAEMON_NAME, DAEMON_PATH, DBUS_TIMEOUT);
            let (body,): (String,) =
                proxy.method_call(DAEMON_INTERFACE, "SetSource", (source, enabled))?;
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
                        eprintln!("[airi-slint] daemon: SetSource({source}) refused: {err}");
                    }
                }
            }
            Err(e) => eprintln!("[airi-slint] daemon: SetSource({source}) failed: {e}"),
        }
        self.refresh();
        if !self.running {
            return false;
        }
        serde_json::from_str::<Value>(&self.sources_json)
            .ok()
            .and_then(|s| s.get(source).and_then(Value::as_bool))
            .unwrap_or(false)
    }

    /// Pause/resume all observers; returns the paused state read back.
    pub fn toggle_pause(&mut self) -> bool {
        let target = !self.paused;
        let pause_result = (|| -> Result<(), dbus::Error> {
            use dbus::blocking::Connection;
            let conn = Connection::new_session()?;
            let proxy = conn.with_proxy(DAEMON_NAME, DAEMON_PATH, DBUS_TIMEOUT);
            proxy.method_call(DAEMON_INTERFACE, "Pause", (target,))
        })();
        if let Err(e) = &pause_result {
            eprintln!("[airi-slint] daemon: Pause({target}) failed: {e}");
        }
        self.refresh();
        self.paused
    }

    /// Read the tail of the shared audit file, newest-first, shaped
    /// `{ts_ms, source, verb, detail}`. Never throws.
    pub fn recent_audit(&self, count: i32) -> String {
        let Some(path) = audit_file_path() else {
            return "[]".to_string();
        };
        recent_audit_file_json(&path, count)
    }

    /// Fetch the current AT-SPI focus digest. Never throws; on any failure
    /// the stored digest is left untouched and `false` is returned with an
    /// honest status line.
    pub fn fetch_focus_digest(&mut self) -> bool {
        match call_get_focus_digest() {
            Ok(body) => match classify_digest_body(&body) {
                DigestOutcome::Ok => {
                    self.focus_digest_json = body;
                    true
                }
                DigestOutcome::Excluded => {
                    self.set_status_line("App is excluded from screen awareness.".to_string());
                    false
                }
                DigestOutcome::Error(err) => {
                    // The daemon's error strings are our own spec'd,
                    // token-free strings — safe to surface raw.
                    self.set_status_line(err);
                    false
                }
            },
            Err(e) => {
                eprintln!("[airi-slint] daemon: GetFocusDigest failed: {e}");
                self.set_status_line(format!("screen digest unavailable: {e}"));
                false
            }
        }
    }

    /// Validate the exclusion-list JSON and push it to the daemon. Returns
    /// the daemon's `ok` (or `false` on validation/transport failure).
    /// Never throws.
    pub fn set_excluded_apps(&mut self, list_json: &str) -> bool {
        let apps = match validate_excluded_apps(list_json) {
            Ok(apps) => apps,
            Err(msg) => {
                eprintln!("[airi-slint] daemon: SetExcludedApps rejected locally: {msg}");
                self.set_status_line(format!("exclusions not saved: {msg}"));
                return false;
            }
        };
        let normalized = Value::Array(apps.into_iter().map(Value::String).collect()).to_string();
        match call_set_excluded_apps(&normalized) {
            Ok(body) => match set_excluded_apps_ok(&body) {
                Ok(()) => true,
                Err(err) => {
                    eprintln!("[airi-slint] daemon: SetExcludedApps refused: {err}");
                    self.set_status_line(format!("exclusions not saved: {err}"));
                    false
                }
            },
            Err(e) => {
                eprintln!("[airi-slint] daemon: SetExcludedApps failed: {e}");
                self.set_status_line(format!("exclusions not saved: {e}"));
                false
            }
        }
    }

    /// Archive the shared audit file by renaming it to
    /// `<name>.cleared-<unix-ts>[-<counter>]` in the same directory. Never
    /// truncates, never deletes; never touches the daemon's in-memory ring
    /// buffer. A missing file is a no-op success.
    pub fn clear_audit(&mut self) -> bool {
        let Some(path) = audit_file_path() else {
            eprintln!("[airi-slint] daemon: no data dir; cannot archive the audit log");
            return false;
        };
        if !path.exists() {
            eprintln!(
                "[airi-slint] daemon: audit file {} does not exist; nothing to archive",
                path.display()
            );
            return true;
        }
        let ts = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_secs())
            .unwrap_or(0);
        let file_name = path
            .file_name()
            .map(|n| n.to_string_lossy().into_owned())
            .unwrap_or_else(|| AUDIT_FILE_NAME.to_string());
        let mut archive = path.with_file_name(format!("{file_name}.cleared-{ts}"));
        let mut counter = 1_u32;
        while archive.exists() {
            archive = path.with_file_name(format!("{file_name}.cleared-{ts}-{counter}"));
            counter += 1;
        }
        match std::fs::rename(&path, &archive) {
            Ok(()) => {
                eprintln!(
                    "[airi-slint] daemon: audit log archived to {}",
                    archive.display()
                );
                true
            }
            Err(e) => {
                eprintln!(
                    "[airi-slint] daemon: failed to archive audit file {} -> {}: {e}",
                    path.display(),
                    archive.display()
                );
                false
            }
        }
    }

    /// One-shot composer for the wake fact sheet. Refreshes the mirror from
    /// the daemon first (never throws), then renders deterministically from
    /// the observed snapshot. `""` = quiet.
    pub fn wake_briefing(&mut self) -> String {
        self.refresh();
        let paused = self.paused;
        let snapshot = self.sleep_snapshot.clone();
        let Some(snapshot) = snapshot else {
            return String::new();
        };
        let offset = local_utc_offset_seconds(snapshot.last_wake_ms);
        compose_wake_briefing(&snapshot, paused, offset)
    }

    /// Render `wake_briefing()` via notify-rust on the **session** bus.
    /// `false` when the line is empty or the notification failed.
    pub fn notify_wake_briefing(&mut self) -> bool {
        let line = self.wake_briefing();
        if line.is_empty() {
            return false;
        }
        render_wake_notification(&line)
    }

    /// 5 s edge detector for the shell's Repeat Timer. See the
    /// method doc for semantics. Composes and (when fired) renders the
    /// line from the snapshot this tick just observed instead of
    /// round-tripping `wake_briefing()` a second time — same facts, same
    /// session bus.
    pub fn check_wake_briefing_tick(&mut self) -> bool {
        self.refresh();
        let Some(snapshot) = self.sleep_snapshot.clone() else {
            // Daemon down: nothing to detect. Leave the edge state alone
            // so a flap does not consume a wake.
            return false;
        };
        let enabled = wake_briefing_enabled_persisted();
        let paused = self.paused;
        let fired = {
            wake_edge_step(
                &mut self.wake_edge,
                snapshot.last_wake_ms,
                snapshot.last_suspend_ms,
                enabled,
                paused,
            )
        };
        if !fired {
            return false;
        }
        let offset = local_utc_offset_seconds(snapshot.last_wake_ms);
        let line = compose_wake_briefing(&snapshot, paused, offset);
        if line.is_empty() {
            return false;
        }
        render_wake_notification(&line)
    }

    /// The persisted opt-in flag, re-read fresh. Never throws.
    pub fn wake_briefing_enabled(&self) -> bool {
        wake_briefing_enabled_persisted()
    }

    /// Persist the opt-in flag. `enabled` is a plain `bool` — there is no
    /// other input shape to validate. Refuses to overwrite a corrupt blob.
    pub fn set_wake_briefing(&mut self, enabled: bool) -> bool {
        let mut blob = match load_awareness_blob() {
            AwarenessBlobLoad::Loaded(blob) => blob,
            AwarenessBlobLoad::Missing => AwarenessSettingsBlob::default(),
            AwarenessBlobLoad::Corrupt(e) => {
                eprintln!("[airi-slint] awareness: refusing to overwrite {AWARENESS_KEY}: {e}");
                self.set_status_line(format!(
                    "wake briefing not saved: {AWARENESS_KEY} unreadable ({e})"
                ));
                return false;
            }
        };
        blob.wake_briefing = enabled;
        match save_awareness_blob(&blob) {
            Ok(()) => true,
            Err(e) => {
                eprintln!("[airi-slint] awareness: failed to persist {AWARENESS_KEY}: {e}");
                self.set_status_line(format!("wake briefing not saved: {e}"));
                false
            }
        }
    }
}

/// Process-wide state guarded by a mutex (a poisoned lock is recovered so a
/// hung D-Bus call cannot wedge the UI).
static STATE: std::sync::Mutex<Option<DaemonState>> = std::sync::Mutex::new(None);

/// Lock the process-wide daemon state for a UI-thread operation, creating it
/// on first use.
pub fn with_state<R>(f: impl FnOnce(&mut DaemonState) -> R) -> R {
    let mut guard = STATE.lock().unwrap_or_else(|e| e.into_inner());
    let state = guard.get_or_insert_with(DaemonState::default);
    f(state)
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

    /// Write `contents` to a throwaway audit file and return its path.
    fn audit_tmp(contents: &str) -> std::path::PathBuf {
        let path = std::env::temp_dir().join(format!(
            "airi-slint-audit-test-{}-{}.jsonl",
            std::process::id(),
            COUNTER.fetch_add(1, std::sync::atomic::Ordering::Relaxed)
        ));
        std::fs::write(&path, contents).expect("write temp audit file");
        path
    }

    static COUNTER: std::sync::atomic::AtomicUsize = std::sync::atomic::AtomicUsize::new(0);

    #[test]
    fn recent_audit_file_json_is_newest_first_and_skips_malformed() {
        let path = audit_tmp(JSONL);
        let out = recent_audit_file_json(&path, 50);
        let parsed: Value = serde_json::from_str(&out).expect("valid JSON");
        let arr = parsed.as_array().expect("array");
        assert_eq!(arr.len(), 3);
        assert_eq!(arr[0]["ts_ms"], 3000);
        assert_eq!(arr[1]["ts_ms"], 2000);
        assert_eq!(arr[2]["ts_ms"], 1000);
        assert_eq!(arr[0]["source"], "power");
        assert_eq!(arr[0]["verb"], "ac");
        assert_eq!(arr[0]["detail"], "on AC");
        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn recent_audit_file_json_clamps_count_to_cap_and_handles_zero() {
        let path = audit_tmp(JSONL);
        let out = recent_audit_file_json(&path, 2);
        let parsed: Value = serde_json::from_str(&out).unwrap();
        assert_eq!(parsed.as_array().unwrap().len(), 2);
        assert_eq!(parsed[0]["ts_ms"], 3000);
        assert_eq!(recent_audit_file_json(&path, 0), "[]");
        assert_eq!(recent_audit_file_json(&path, -5), "[]");
        // Cap is 50 even when the caller asks for more.
        let big = (0..80)
            .map(|i| format!(r#"{{"ts_ms": {i}, "source": "system", "verb": "v", "detail": "d"}}"#))
            .collect::<Vec<_>>()
            .join("\n");
        let big_path = audit_tmp(&big);
        let parsed: Value = serde_json::from_str(&recent_audit_file_json(&big_path, 1000)).unwrap();
        assert_eq!(parsed.as_array().unwrap().len(), AUDIT_CAP);
        let _ = std::fs::remove_file(&path);
        let _ = std::fs::remove_file(&big_path);
    }

    #[test]
    fn recent_audit_file_json_tolerates_missing_fields_and_empty_input() {
        let path = audit_tmp("");
        assert_eq!(recent_audit_file_json(&path, 10), "[]");
        let path = audit_tmp("{}\n");
        let out = recent_audit_file_json(&path, 10);
        let parsed: Value = serde_json::from_str(&out).unwrap();
        assert_eq!(parsed[0]["ts_ms"], 0);
        assert_eq!(parsed[0]["source"], "");
        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn recent_audit_file_json_maps_daemon_event_field_to_verb() {
        // The daemon writes `{ts_ms, source, event, detail}`; an explicit
        // `verb` field wins when both are present.
        let path =
            audit_tmp(r#"{"ts_ms": 100, "source": "lock", "event": "locked", "detail": "d"}"#);
        let out = recent_audit_file_json(&path, 10);
        let parsed: Value = serde_json::from_str(&out).unwrap();
        assert_eq!(parsed[0]["verb"], "locked");
        let path = audit_tmp(
            r#"{"ts_ms": 100, "source": "lock", "event": "locked", "verb": "screen-lock", "detail": "d"}"#,
        );
        let out = recent_audit_file_json(&path, 10);
        let parsed: Value = serde_json::from_str(&out).unwrap();
        assert_eq!(parsed[0]["verb"], "screen-lock");
        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn parse_jsonl_tail_reads_only_the_window_and_never_tears_a_line() {
        let row =
            |i: usize| format!(r#"{{"ts_ms": {i}, "source": "s", "event": "e", "detail": "d"}}"#);
        // Two windows of rows: the seek lands mid-line, so the torn fragment is
        // dropped and only whole lines survive.
        let text = (0..4000).map(row).collect::<Vec<_>>().join("\n");
        assert!(text.len() > AUDIT_TAIL_BYTES * 2);
        let path = audit_tmp(&text);

        let rows = parse_jsonl_tail(&path, AUDIT_CAP);
        assert_eq!(rows.len(), AUDIT_CAP);
        assert_eq!(rows[AUDIT_CAP - 1]["ts_ms"], 3999);
        assert_eq!(rows[0]["ts_ms"], 3999 - AUDIT_CAP + 1);

        let out = recent_audit_file_json(&path, 50);
        let parsed: Value = serde_json::from_str(&out).unwrap();
        let arr = parsed.as_array().unwrap();
        assert_eq!(arr[0]["ts_ms"], 3999);
        assert_eq!(arr[AUDIT_CAP - 1]["ts_ms"], 3999 - AUDIT_CAP + 1);
        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn parse_jsonl_tail_handles_a_small_file_and_a_missing_one() {
        let path = audit_tmp("{\"ts_ms\": 1}\n");
        let rows = parse_jsonl_tail(&path, AUDIT_CAP);
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0]["ts_ms"], 1);
        let _ = std::fs::remove_file(&path);

        let missing = std::env::temp_dir().join("airi-slint-audit-test-does-not-exist.jsonl");
        let _ = std::fs::remove_file(&missing);
        assert!(parse_jsonl_tail(&missing, AUDIT_CAP).is_empty());
        assert_eq!(recent_audit_file_json(&missing, 10), "[]");
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

    #[test]
    fn screen_enabled_only_from_a_reported_bool_source() {
        assert!(screen_enabled_from_sources_json(r#"{"screen": true}"#));
        assert!(!screen_enabled_from_sources_json(r#"{"screen": false}"#));
        assert!(!screen_enabled_from_sources_json(r#"{"sleep": true}"#));
        assert!(!screen_enabled_from_sources_json(r#"{"screen": "yes"}"#));
        assert!(!screen_enabled_from_sources_json("not json"));
        assert!(!screen_enabled_from_sources_json("{}"));
    }

    #[test]
    fn classify_digest_body_covers_ok_excluded_and_other_errors() {
        assert_eq!(
            classify_digest_body(
                r#"{"ok": true, "app": "firefox", "title": "t", "lines": [], "text_length": 0, "skipped_password_nodes": 0}"#
            ),
            DigestOutcome::Ok
        );
        assert_eq!(
            classify_digest_body(r#"{"ok": false, "error": "excluded"}"#),
            DigestOutcome::Excluded
        );
        assert_eq!(
            classify_digest_body(
                r#"{"ok": false, "error": "no focus captured yet — click into a window once"}"#
            ),
            DigestOutcome::Error("no focus captured yet — click into a window once".to_string())
        );
        assert_eq!(
            classify_digest_body("not json"),
            DigestOutcome::Error("malformed reply from airi-daemon".to_string())
        );
        assert_eq!(
            classify_digest_body(r#"{"ok": false}"#),
            DigestOutcome::Error("unknown error".to_string())
        );
    }

    #[test]
    fn validate_excluded_apps_accepts_arrays_of_non_empty_strings() {
        let apps = validate_excluded_apps(r#"["Firefox", "KeePassXC"]"#).unwrap();
        assert_eq!(apps, vec!["Firefox".to_string(), "KeePassXC".to_string()]);
        assert_eq!(validate_excluded_apps("[]").unwrap(), Vec::<String>::new());
        assert!(validate_excluded_apps(r#"{"a": 1}"#).is_err());
        assert!(validate_excluded_apps(r#"["ok", 42]"#).is_err());
        assert!(validate_excluded_apps(r#"[""]"#).is_err());
        assert!(validate_excluded_apps(r#"["   "]"#).is_err());
        assert!(validate_excluded_apps("not json").is_err());
    }

    #[test]
    fn set_excluded_apps_ok_parses_daemon_reply() {
        assert_eq!(set_excluded_apps_ok(r#"{"ok": true}"#), Ok(()));
        assert_eq!(
            set_excluded_apps_ok(r#"{"ok": false, "error": "nope"}"#),
            Err("nope".to_string())
        );
        assert_eq!(
            set_excluded_apps_ok("not json"),
            Err("malformed reply from airi-daemon".to_string())
        );
        assert_eq!(
            set_excluded_apps_ok(r#"{"ok": false}"#),
            Err("unknown error".to_string())
        );
    }

    // ── Wake briefing (P4a) ──────────────────────────────────────────

    fn snapshot(
        suspend: u64,
        wake: u64,
        failed: Option<u64>,
        names: &[&str],
        power: Option<bool>,
    ) -> WakeSnapshot {
        WakeSnapshot {
            last_suspend_ms: suspend,
            last_wake_ms: wake,
            units_failed_since_wake: failed,
            recent_failed_units: names.iter().map(|s| s.to_string()).collect(),
            on_battery: power,
        }
    }

    #[test]
    fn wake_snapshot_parses_p4a_fields_and_tolerates_older_daemons() {
        // Pre-P4a1 daemon: none of the new keys — everything reads as
        // "not reported", nothing fabricated.
        let old = wake_snapshot_from(&json!({"protocol": 1, "sources": {"power": true}}));
        assert_eq!(old.last_suspend_ms, 0);
        assert_eq!(old.last_wake_ms, 0);
        assert_eq!(old.units_failed_since_wake, None);
        assert_eq!(old.recent_failed_units, Vec::<String>::new());
        assert_eq!(old.on_battery, Some(true));

        // Post-P4a1 daemon: full fact sheet payload.
        let new = wake_snapshot_from(&json!({
            "protocol": 1,
            "last_suspend_ms": 1_000u64,
            "last_wake_ms": 2_000u64,
            "units_failed_since_wake": 7u64,
            "recent_failed_units": ["nginx.service", "docker.service", "fail2ban.service", "extra.service"],
            "sources": {"power": false}
        }));
        assert_eq!(new.last_suspend_ms, 1_000);
        assert_eq!(new.last_wake_ms, 2_000);
        assert_eq!(new.units_failed_since_wake, Some(7));
        // Capped at 3, newest first, order preserved.
        assert_eq!(
            new.recent_failed_units,
            vec![
                "nginx.service".to_string(),
                "docker.service".to_string(),
                "fail2ban.service".to_string()
            ]
        );
        assert_eq!(new.on_battery, Some(false));

        // Malformed entries are dropped; an empty/non-array payload is fine.
        let messy = wake_snapshot_from(&json!({
            "recent_failed_units": [42, "ok.service", null, ""],
            "sources": {"power": "yes"}
        }));
        assert_eq!(
            messy.recent_failed_units,
            vec!["ok.service".to_string(), String::new()]
        );
        assert_eq!(messy.on_battery, None);
        let arr = wake_snapshot_from(&json!({"recent_failed_units": "nope"}));
        assert_eq!(arr.recent_failed_units, Vec::<String>::new());
    }

    #[test]
    fn wake_briefing_composes_duration_failures_and_power() {
        // 2026-11-11 23:41:00 UTC → 2026-11-12 06:54:00 UTC = 7h13m away.
        let suspend = 1_794_440_460_000u64;
        let wake = suspend + 7 * 3_600_000 + 13 * 60_000;
        let line = compose_wake_briefing(
            &snapshot(
                suspend,
                wake,
                Some(2),
                &["nginx.service", "docker.service"],
                Some(false),
            ),
            false,
            0,
        );
        assert_eq!(
            line,
            "AIRI: you were away ~7h13m (23:41 → 06:54). Since then: 2 unit failures (nginx.service, docker.service). Battery on AC."
        );

        // Same values fed twice → identical output (no clock, no randomness).
        let again = compose_wake_briefing(
            &snapshot(
                suspend,
                wake,
                Some(2),
                &["nginx.service", "docker.service"],
                Some(false),
            ),
            false,
            0,
        );
        assert_eq!(line, again);

        // Singular failure, on battery, exact-hour duration.
        let line = compose_wake_briefing(
            &snapshot(
                suspend,
                suspend + 7 * 3_600_000,
                Some(1),
                &["nginx.service"],
                Some(true),
            ),
            false,
            0,
        );
        assert_eq!(
            line,
            "AIRI: you were away ~7h (23:41 → 06:41). Since then: 1 unit failure (nginx.service). On battery."
        );

        // Zero failures reported → the zero is stated, not implied.
        let line = compose_wake_briefing(
            &snapshot(suspend, wake, Some(0), &[], Some(false)),
            false,
            0,
        );
        assert!(line.contains("Since then: no unit failures"));

        // Failures without names → count only, no invented names.
        let line = compose_wake_briefing(
            &snapshot(suspend, wake, Some(4), &[], Some(false)),
            false,
            0,
        );
        assert_eq!(
            line,
            "AIRI: you were away ~7h13m (23:41 → 06:54). Since then: 4 unit failures. Battery on AC."
        );
    }

    #[test]
    fn wake_briefing_suspend_unknown_and_power_missing() {
        // Daemon woke, never saw a suspend: duration omitted, wake shown.
        let line = compose_wake_briefing(
            &snapshot(0, 1_794_466_800_000, Some(0), &[], None),
            false,
            0,
        );
        assert_eq!(
            line,
            "AIRI: you woke at 07:00. Since then: no unit failures."
        );
        // Wake before suspend (clock skew) degrades the same way.
        let line = compose_wake_briefing(&snapshot(9_999_999, 1_000, Some(0), &[], None), false, 0);
        assert!(line.starts_with("AIRI: you woke at "));
        // Daemon pre-P4a1 (failures field absent): segment omitted entirely.
        let line = compose_wake_briefing(&snapshot(100, 200, None, &[], None), false, 0);
        assert_eq!(line, "AIRI: you were away <1m (00:00 → 00:00).");
        assert!(!line.contains("unit failure"));
    }

    #[test]
    fn wake_briefing_paused_or_no_wake_is_empty() {
        let snap = snapshot(100, 200, Some(3), &["nginx.service"], Some(true));
        assert_eq!(compose_wake_briefing(&snap, true, 0), "");
        assert_eq!(
            compose_wake_briefing(&snapshot(100, 0, Some(3), &[], None), false, 0),
            ""
        );
        assert_eq!(
            compose_wake_briefing(&snapshot(0, 0, None, &[], None), false, 0),
            ""
        );
    }

    #[test]
    fn format_duration_ms_and_clock_hhmm() {
        assert_eq!(format_duration_ms(0), "<1m");
        assert_eq!(format_duration_ms(59_999), "<1m");
        assert_eq!(format_duration_ms(60_000), "~1m");
        assert_eq!(format_duration_ms(45 * 60_000), "~45m");
        assert_eq!(format_duration_ms(7 * 3_600_000), "~7h");
        assert_eq!(format_duration_ms(7 * 3_600_000 + 5 * 60_000), "~7h05m");
        assert_eq!(format_duration_ms(31 * 3_600_000), "~31h");

        assert_eq!(clock_hhmm(0, 0), "00:00");
        assert_eq!(clock_hhmm(1_794_440_460_000, 0), "23:41");
        assert_eq!(clock_hhmm(1_794_440_460_000, 3600), "00:41");
        assert_eq!(clock_hhmm(1_794_440_460_000, -3600), "22:41");
        // Pre-1970 timestamps saturate instead of wrapping.
        assert_eq!(clock_hhmm(0, -7200), "00:00");
    }

    #[test]
    fn wake_edge_primes_silently() {
        let mut edge = WakeEdge::default();
        assert!(!wake_edge_step(&mut edge, 3_000, 1_000, true, false));
        assert_eq!(
            edge,
            WakeEdge {
                primed: true,
                last_wake_ms: 3_000,
                last_suspend_ms: 1_000,
                fired: false
            }
        );
    }

    #[test]
    fn wake_edge_fires_exactly_once_per_wake() {
        // Succession from the lane brief: prime at 3000, wake to 4000.
        let mut edge = WakeEdge::default();
        assert!(!wake_edge_step(&mut edge, 3_000, 1_000, true, false)); // prime, silent
        assert!(wake_edge_step(&mut edge, 4_000, 1_000, true, false)); // exactly one notify
        assert!(!wake_edge_step(&mut edge, 4_000, 1_000, true, false)); // equal → never re-fire
        assert!(!wake_edge_step(&mut edge, 4_000, 1_000, true, false));
    }

    #[test]
    fn wake_edge_suspend_rearms_for_the_next_cycle() {
        let mut edge = WakeEdge::default();
        assert!(!wake_edge_step(&mut edge, 3_000, 1_000, true, false));
        assert!(wake_edge_step(&mut edge, 4_000, 1_000, true, false));
        // Another suspend cycle (last_suspend_ms advances) re-arms the edge.
        assert!(!wake_edge_step(&mut edge, 4_000, 2_000, true, false));
        // Equal wake value does not fire just because we re-armed.
        assert!(!wake_edge_step(&mut edge, 4_000, 2_000, true, false));
        // The next wake fires once.
        assert!(wake_edge_step(&mut edge, 5_000, 2_000, true, false));
        assert!(!wake_edge_step(&mut edge, 5_000, 2_000, true, false));
    }

    #[test]
    fn wake_edge_suspend_and_wake_on_the_same_tick_fires_once() {
        let mut edge = WakeEdge::default();
        assert!(!wake_edge_step(&mut edge, 3_000, 1_000, true, false));
        // Daemon applies the whole cycle in one tick: suspend advanced,
        // wake advanced. Suspend re-arms, wake fires — still once.
        assert!(wake_edge_step(&mut edge, 4_000, 2_000, true, false));
        assert!(!wake_edge_step(&mut edge, 4_000, 2_000, true, false));
    }

    #[test]
    fn wake_edge_disabled_or_paused_consumes_silently() {
        // Not opted in: the wake edge is consumed, nothing fires.
        let mut edge = WakeEdge::default();
        assert!(!wake_edge_step(&mut edge, 3_000, 1_000, true, false));
        assert!(!wake_edge_step(&mut edge, 4_000, 1_000, false, false));
        // Enabling afterwards does NOT deliver the stale wake.
        assert!(!wake_edge_step(&mut edge, 4_000, 1_000, true, false));
        // Paused (kill switch): same, even with the toggle enabled.
        let mut edge = WakeEdge::default();
        assert!(!wake_edge_step(&mut edge, 3_000, 1_000, true, false));
        assert!(!wake_edge_step(&mut edge, 4_000, 1_000, true, true));
        assert!(!wake_edge_step(&mut edge, 4_000, 1_000, true, false));
        // But the next cycle still fires.
        assert!(!wake_edge_step(&mut edge, 4_000, 2_000, true, false));
        assert!(wake_edge_step(&mut edge, 5_000, 2_000, true, false));
    }

    #[test]
    fn awareness_blob_defaults_off_and_round_trips_camel_case() {
        let default_blob = AwarenessSettingsBlob::default();
        assert!(!default_blob.wake_briefing);
        let json_str = serde_json::to_string(&default_blob).unwrap();
        assert_eq!(json_str, r#"{"wakeBriefing":false}"#);
        let parsed: AwarenessSettingsBlob =
            serde_json::from_str(r#"{"wakeBriefing":true}"#).unwrap();
        assert!(parsed.wake_briefing);
        // Missing fields fall back to defaults; unknown fields are ignored.
        let parsed: AwarenessSettingsBlob = serde_json::from_str(r#"{"futureField": 1}"#).unwrap();
        assert!(!parsed.wake_briefing);
    }
}
