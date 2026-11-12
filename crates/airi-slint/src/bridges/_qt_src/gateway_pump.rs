// SPDX-License-Identifier: GPL-3.0-or-later
//! GUI-thread gateway dispatch (`GatewayPumpController`): the sanctioned path
//! for `--gateway` channel clients (agents on the loopback channel) to act on
//! the user's session — strictly opt-in, off by default.
//!
//! # Why this exists
//!
//! Today `renderer.*` handlers run on channel connection threads, are
//! read-only, and never touch Qt (see `airi-channel` `RendererHandler`
//! contract in `dispatch.rs`: `Send + Sync + 'static`, never blocks the GUI
//! loop). That is the safe default and stays the default. This module adds
//! three typed, allowlisted verbs that act on the session through the Qt
//! thread, gated by an explicit config flag that defaults to **off**.
//!
//! # Thread model
//!
//! ```text
//! gateway client (websocket)
//!   │  rpc renderer.notify {title, body}
//!   ▼
//! channel connection reader thread  (airi-channel dispatch_renderer)
//!   │  registry handler → gateway_handlers::build closure
//!   │  dispatch_request()                       ◄── this module, re-reads the flag
//!   ▼
//! GuiDispatch (process-wide static, plain Rust)
//!   │  enqueue PendingAction { id, method, payload }
//!   │  store oneshot Sender under id in `slots`
//!   │  block on recv_timeout(2s)                ◄── reader thread parks here
//!   ▼
//! Qt thread  ◄── 50 ms Timer in Main.qml calls pumpRequests()
//!   │  drain ≤16 pending actions
//!   ├─ renderer.notify           → notify_rust::Notification (session bus only)
//!   ├─ renderer.window.raise     → emits requestWindowAction(id, "renderer.window.raise", payloadJson)
//!   └─ renderer.stage.visibility → emits requestWindowAction(id, "renderer.stage.visibility", payloadJson)
//!   ▼
//! QML Connections  → WindowManager (openChat/openSettings/openAbout/openStage, toggleStage)
//!   │
//!   ▼
//! gatewayPump.completeWindowAction(id, ok, JSON.stringify(result))
//!   │  looks up the oneshot under `id`, completes it
//!   ▼
//! reader thread unblocks → rpc reply { ok: true, data: { ... } }
//! ```
//!
//! Window verbs never run QML directly from Rust; they round-trip through the
//! `requestWindowAction` signal and the QML `Connections` handler, which owns
//! the WindowManager calls. `renderer.notify` is handled entirely in Rust on
//! the Qt thread (notify-rust talks to the session bus, not to QML).
//!
//! # Security contract — read this before adding a verb
//!
//! - **Off by default.** Every request re-reads `<profile>/server-channel/
//!   config.json` (tiny file) and requires `"allowActions": true`. Anything
//!   else — missing key, non-boolean value, unreadable file, wrong types —
//!   fails closed. Flipping the flag takes effect on the next request; no app
//!   restart needed.
//! - **Typed allowlist, exactly three verbs** (`renderer.notify`,
//!   `renderer.window.raise`, `renderer.stage.visibility`). Unknown methods
//!   are rejected in `dispatch_request` before enqueueing. There is **no**
//!   eval, no dynamic QML/JS execution, no arbitrary property write, no
//!   screen-content access, no input injection. Adding a verb is a new-wave
//!   change with its own review, not a config toggle.
//! - **Payload validation at dispatch time** (fail fast, before enqueueing):
//!   unknown keys are rejected; notify title/body are length-capped
//!   (200/400 Unicode scalar values); `which` is one of
//!   `chat|settings|about|stage`; `visible` must be a boolean.
//! - **Timeout bounds.** A request parks at most
//!   [`DISPATCH_TIMEOUT`] waiting for the pump/QML. Window verbs that never
//!   complete reply `handler timed out` and the pending entry is retired, so a
//!   wedged GUI cannot wedge connection threads beyond the 2 s bound.
//! - **Queue bound.** At most [`MAX_PENDING`] actions may wait; overflow is
//!   refused with `actions-queue-full`. Each pump tick drains at most
//!   [`PUMP_BATCH`].
//! - **Notification goes to this session's D-Bus only**, with the fixed
//!   `appname` "AIRI". The notification title/body are never logged.
//! - **The flag is re-read per request** — cached nothing — so removing
//!   `allowActions` from the config disarms the gateway on the very next
//!   call, without a restart.
//!
//! # Fail-closed notes
//!
//! - The channel server itself is opt-in (`--gateway`); this flag layers on
//!   top of it. Both are required for any GUI-affecting verb to run.
//! - If `server-channel/config.json` is *healed* (token regenerated because
//!   the file was missing/invalid), the healer rewrites only
//!   `hostname` + `authToken` — a previously added `allowActions` key is
//!   dropped, i.e. healing turns actions off. Fail-closed by construction.
//!   Adding `allowActions: true` to a *valid* config sticks.
//! - Unit tests never touch D-Bus, Qt, or the real profile dir.

use cxx_qt::CxxQtType;
use cxx_qt_lib::QString;
use serde_json::Value;
use std::collections::{HashMap, VecDeque};
use std::pin::Pin;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{mpsc, Arc, Mutex, OnceLock};
use std::time::Duration;

use crate::bridges::qstring_to_string;

/// Hard cap on actions waiting to be pumped. Overflow is refused with
/// `actions-queue-full` (maps to `rpc_handler_error` on the wire).
const MAX_PENDING: usize = 16;

/// How many actions one `pumpRequests()` tick drains. Matches the design
/// (33–50 ms timer; the default Main.qml timer is 50 ms).
const PUMP_BATCH: usize = 16;

/// How long a requesting connection thread parks waiting for the Qt thread.
const DISPATCH_TIMEOUT: Duration = Duration::from_secs(2);

/// Title cap for `renderer.notify` (Unicode scalar values, not bytes).
const TITLE_MAX_CHARS: usize = 200;
/// Body cap for `renderer.notify` (Unicode scalar values, not bytes).
const BODY_MAX_CHARS: usize = 400;
/// Cap applied to error text crossing the wire/threads. Mirrors the
/// `rpc_handler_error` truncation in airi-channel.
const ERROR_MAX_CHARS: usize = 512;

/// One typed verb accepted by this lane. `method` is the full wire method.
#[derive(Debug, Clone)]
struct PendingAction {
    /// Monotonic id used to correlate the oneshot completion.
    id: u64,
    /// Full method name, e.g. `renderer.notify`.
    method: String,
    /// Verbatim JSON object payload from the client.
    payload: Value,
}

/// The dispatch core. Plain Rust, no Qt — unit-testable without a GUI.
///
/// All methods are callable from any thread; `Mutex` guards are only held
/// for short, allocation-only critical sections. Lock order is always
/// `pending` → `slots` to avoid inversion.
struct GuiDispatch {
    /// FIFO of actions waiting to be pumped to the Qt thread.
    pending: Mutex<VecDeque<PendingAction>>,
    /// In-flight oneshots: `id` → sender used to complete the requester.
    slots: Mutex<HashMap<u64, mpsc::Sender<Result<Value, String>>>>,
    /// Id sequence for pending actions (starts at 1).
    seq: AtomicU64,
    /// How long `request` parks before reporting `handler timed out`.
    timeout: Duration,
}

impl GuiDispatch {
    fn new(timeout: Duration) -> Self {
        Self {
            pending: Mutex::new(VecDeque::new()),
            slots: Mutex::new(HashMap::new()),
            seq: AtomicU64::new(1),
            timeout,
        }
    }

    /// Actions received but not yet completed (waiting + in flight).
    fn outstanding(&self) -> usize {
        let waiting = self.pending.lock().map(|p| p.len()).unwrap_or(0);
        let in_flight = self.slots.lock().map(|s| s.len()).unwrap_or(0);
        waiting + in_flight
    }

    /// Validate, then enqueue an action and hand back the oneshot receiver.
    /// Fails fast (before enqueueing) on unknown verbs / bad payloads.
    fn enqueue(
        &self,
        method: &str,
        payload: &Value,
    ) -> Result<(u64, mpsc::Receiver<Result<Value, String>>), String> {
        validate_verb(method, payload)?;
        let id = self.seq.fetch_add(1, Ordering::SeqCst);
        let (tx, rx) = mpsc::channel();
        {
            let mut pending = self
                .pending
                .lock()
                .map_err(|_| "dispatch queue unavailable (poisoned)".to_string())?;
            if pending.len() >= MAX_PENDING {
                return Err(format!(
                    "actions-queue-full: at most {MAX_PENDING} gateway actions may wait for the GUI"
                ));
            }
            pending.push_back(PendingAction {
                id,
                method: method.to_string(),
                payload: payload.clone(),
            });
            let mut slots = self
                .slots
                .lock()
                .map_err(|_| "dispatch slots unavailable (poisoned)".to_string())?;
            slots.insert(id, tx);
        }
        Ok((id, rx))
    }

    /// Validate + enqueue + park until the Qt thread completes the action.
    fn request(&self, method: &str, payload: &Value) -> Result<Value, String> {
        let (id, rx) = self.enqueue(method, payload)?;
        match rx.recv_timeout(self.timeout) {
            Ok(result) => result,
            Err(mpsc::RecvTimeoutError::Timeout) => {
                self.retire(id);
                Err("handler timed out".to_string())
            }
            Err(mpsc::RecvTimeoutError::Disconnected) => Err("handler went away".to_string()),
        }
    }

    /// Pop up to `limit` waiting actions, preserving FIFO order.
    fn drain(&self, limit: usize) -> Vec<PendingAction> {
        let mut out = Vec::new();
        if let Ok(mut pending) = self.pending.lock() {
            for _ in 0..limit {
                match pending.pop_front() {
                    Some(action) => out.push(action),
                    None => break,
                }
            }
        }
        out
    }

    /// Complete the in-flight action `id` with `result`. Returns `false`
    /// when no slot is open for `id` (already timed out, already completed,
    /// or unknown id) — the caller may safely ignore the payload.
    fn complete(&self, id: u64, result: Result<Value, String>) -> bool {
        let sender = self
            .slots
            .lock()
            .ok()
            .and_then(|mut slots| slots.remove(&id));
        match sender {
            Some(tx) => tx.send(result).is_ok(),
            None => false,
        }
    }

    /// Drop the pending action (if still waiting) and its oneshot slot.
    /// Lock order matches `enqueue` (pending → slots).
    fn retire(&self, id: u64) {
        if let Ok(mut pending) = self.pending.lock() {
            pending.retain(|a| a.id != id);
        }
        if let Ok(mut slots) = self.slots.lock() {
            slots.remove(&id);
        }
    }
}

/// Process-wide dispatch core, created lazily on first use.
static DISPATCH: OnceLock<Arc<GuiDispatch>> = OnceLock::new();

fn dispatch() -> Arc<GuiDispatch> {
    DISPATCH
        .get_or_init(|| Arc::new(GuiDispatch::new(DISPATCH_TIMEOUT)))
        .clone()
}

/// Path to the channel server config. Mirrors the app's
/// `server-channel/config.json` resolution: `<profile>/server-channel/
/// config.json` when a profile dir is registered (always the case from
/// `main`), else `dirs::data_dir()/airi-slint/server-channel/config.json` —
/// identical to `airi_channel::default_config_path()` for default launches.
fn server_channel_config_path() -> Option<std::path::PathBuf> {
    // Unit tests never resolve the real profile/data dir — allow_actions()
    // fails closed there instead of reading the user's actual config.
    #[cfg(test)]
    {
        None
    }
    #[cfg(not(test))]
    {
        crate::bridges::profile_dir()
            .map(|p| p.join("server-channel").join("config.json"))
            .or_else(airi_channel::default_config_path)
    }
}

/// Whether `"allowActions": true` is present at `path`. Any failure —
/// missing file, unreadable file, invalid JSON, non-`true` boolean, absent
/// key — returns `false` (fail closed). Reads the file fresh; no caching.
fn allow_actions_at(path: &std::path::Path) -> bool {
    let Ok(raw) = std::fs::read_to_string(path) else {
        return false;
    };
    let Ok(value) = serde_json::from_str::<Value>(&raw) else {
        return false;
    };
    value
        .get("allowActions")
        .and_then(|v| v.as_bool())
        .unwrap_or(false)
}

/// Re-read the flag from the config file. Called per request.
fn allow_actions() -> bool {
    server_channel_config_path()
        .map(|path| allow_actions_at(&path))
        .unwrap_or(false)
}

fn actions_disabled_message() -> String {
    let path = server_channel_config_path()
        .map(|p| p.display().to_string())
        .unwrap_or_else(|| "<profile>/server-channel/config.json".to_string());
    format!("actions-disabled: gateway actions are off; set \"allowActions\": true in {path}")
}

/// Cap an error message at [`ERROR_MAX_CHARS`] Unicode scalar values.
fn truncate_error(message: &str) -> String {
    message.chars().take(ERROR_MAX_CHARS).collect()
}

/// Reject any key in the payload object that is not in `allowed`. `null`
/// payloads pass (treated as empty); non-objects are the caller's concern.
fn reject_unknown_keys(payload: &Value, allowed: &[&str]) -> Result<(), String> {
    if let Some(obj) = payload.as_object() {
        for key in obj.keys() {
            if !allowed.contains(&key.as_str()) {
                return Err(format!("unexpected key '{key}'"));
            }
        }
    }
    Ok(())
}

/// `{title, body}` with both required, length-capped, Unicode-aware.
fn validate_notify(payload: &Value) -> Result<(String, String), String> {
    reject_unknown_keys(payload, &["title", "body"])?;
    let title = payload
        .get("title")
        .and_then(Value::as_str)
        .ok_or_else(|| "renderer.notify: 'title' must be a string".to_string())?
        .trim();
    if title.is_empty() {
        return Err("renderer.notify: 'title' must not be empty".to_string());
    }
    if title.chars().count() > TITLE_MAX_CHARS {
        return Err(format!(
            "renderer.notify: 'title' exceeds {TITLE_MAX_CHARS} characters"
        ));
    }
    let body = payload
        .get("body")
        .and_then(Value::as_str)
        .ok_or_else(|| "renderer.notify: 'body' must be a string".to_string())?;
    if body.chars().count() > BODY_MAX_CHARS {
        return Err(format!(
            "renderer.notify: 'body' exceeds {BODY_MAX_CHARS} characters"
        ));
    }
    Ok((title.to_string(), body.to_string()))
}

/// `{which}` where `which ∈ {chat, settings, about, stage}`.
fn validate_raise(payload: &Value) -> Result<&'static str, String> {
    reject_unknown_keys(payload, &["which"])?;
    match payload.get("which").and_then(Value::as_str) {
        Some("chat") => Ok("chat"),
        Some("settings") => Ok("settings"),
        Some("about") => Ok("about"),
        Some("stage") => Ok("stage"),
        Some(other) => Err(format!(
            "renderer.window.raise: 'which' must be one of chat|settings|about|stage (got '{other}')"
        )),
        None => Err("renderer.window.raise: 'which' must be a string".to_string()),
    }
}

/// `{}` or `{visible?: bool}` — anything else is rejected. `null` is
/// tolerated upstream (treated as an absent optional).
fn validate_visibility(payload: &Value) -> Result<Option<bool>, String> {
    reject_unknown_keys(payload, &["visible"])?;
    match payload.get("visible") {
        None | Some(Value::Null) => Ok(None),
        Some(v) => v
            .as_bool()
            .map(Some)
            .ok_or_else(|| "renderer.stage.visibility: 'visible' must be a boolean".to_string()),
    }
}

/// Fail-fast validation for dispatch time. Keeps the typed allowlist honest:
/// unknown methods never reach the queue.
fn validate_verb(method: &str, payload: &Value) -> Result<(), String> {
    if !matches!(payload, Value::Null | Value::Object(_)) {
        return Err("payload must be a JSON object".to_string());
    }
    match method {
        "renderer.notify" => validate_notify(payload).map(|_| ()),
        "renderer.window.raise" => validate_raise(payload).map(|_| ()),
        "renderer.stage.visibility" => validate_visibility(payload).map(|_| ()),
        other => Err(format!("unknown gateway verb: {other}")),
    }
}

/// Called from the channel connection threads (via the handlers registered
/// for `renderer.notify` / `renderer.window.raise` / `renderer.stage.visibility`).
///
/// The flag is re-read here, on every call: `"allowActions": true` must be
/// present in `<profile>/server-channel/config.json` or anything else is
/// refused with an `actions-disabled:` error (mapped to `rpc_actions_disabled`
/// by airi-channel). When enabled, the action is enqueued, a oneshot is
/// stored, and this thread parks up to [`DISPATCH_TIMEOUT`].
pub(crate) fn dispatch_request(method: &str, payload: &Value) -> Result<Value, String> {
    if !allow_actions() {
        return Err(actions_disabled_message());
    }
    dispatch().request(method, payload)
}

/// Rust-side executor for `renderer.notify`, run on the Qt thread.
fn execute_notify(payload: &Value) -> Result<Value, String> {
    let (title, body) = validate_notify(payload)?;
    if crate::bridges::smoke() {
        eprintln!("[airi-slint] smoke: gateway notification suppressed");
        return Err("notification suppressed under --smoke".to_string());
    }
    match notify_rust::Notification::new()
        .appname("AIRI")
        .summary(&title)
        .body(&body)
        .show()
    {
        // NOTICE: never log the title/body — they are untrusted client input.
        Ok(_) => Ok(serde_json::json!({ "notified": true })),
        Err(e) => {
            eprintln!("[airi-slint] gateway: notification failed to show ({e})");
            Err(truncate_error(&format!("notify failed: {e}")))
        }
    }
}

/// Parse the completion payload QML sends after a GUI verb ran.
///
/// `ok == true`: `payload_json` must be a JSON value (e.g. `{"raised":"chat"}`);
/// it crosses back to the client verbatim. `ok == false`: `payload_json` is
/// either a plain message or `{"error": "..."}`; the message is extracted and
/// truncated. Anything else becomes a generic parse error.
fn parse_completion(ok: bool, payload_json: &str) -> Result<Value, String> {
    if ok {
        return serde_json::from_str::<Value>(payload_json)
            .map_err(|e| format!("window action returned invalid result JSON: {e}"));
    }
    let message = serde_json::from_str::<Value>(payload_json)
        .ok()
        .and_then(|v| v.get("error").and_then(Value::as_str).map(str::to_owned))
        .unwrap_or_else(|| payload_json.to_string());
    Err(truncate_error(&message))
}

/// cxx-qt bridge definitions for the GUI-thread gateway pump.
#[cxx_qt::bridge]
pub mod qobject {
    unsafe extern "C++" {
        include!("cxx-qt-lib/qstring.h");
        /// QString from cxx-qt-lib.
        type QString = cxx_qt_lib::QString;
    }

    extern "RustQt" {
        /// GUI-thread dispatch for `renderer.*` gateway actions. Owns the
        /// 50 ms QML Timer and emits `requestWindowAction` for verbs that
        /// need QML; `renderer.notify` is handled in Rust on the Qt thread.
        /// Create one instance per app (Main.qml); the dispatch core itself
        /// is a process-wide static.
        #[qobject]
        #[qml_element]
        #[namespace = "airi_qt"]
        #[qproperty(i32, pending_count, cxx_name = "pendingCount", READ, NOTIFY)]
        #[qproperty(bool, enabled, READ, NOTIFY)]
        type GatewayPumpController = super::GatewayPumpControllerRust;
    }

    extern "RustQt" {
        /// Emitted for GUI (QML) verbs; `Connections { target: gatewayPump }`
        /// in Main.qml executes the verb via `WindowManager` and calls
        /// `completeWindowAction(id, ok, payloadJson)`. `payloadJson` is the
        /// verbatim client payload.
        #[qsignal]
        #[cxx_name = "requestWindowAction"]
        fn request_window_action(
            self: Pin<&mut GatewayPumpController>,
            id: u64,
            method: QString,
            payload_json: QString,
        );
    }

    extern "RustQt" {
        /// Drain up to 16 pending actions on the Qt thread and execute them.
        /// Called by the always-on 50 ms QML Timer in Main.qml. Every action
        /// is answered: Rust verbs complete inline, GUI verbs complete when
        /// QML calls `completeWindowAction` (or time out after 2 s).
        #[qinvokable]
        #[cxx_name = "pumpRequests"]
        fn pump_requests(self: Pin<&mut GatewayPumpController>);

        /// Complete the pending oneshot `id` with the QML-executed result.
        /// `payloadJson` is a JSON value when `ok` is `true`, otherwise a
        /// message or `{"error": "..."}`. Returns `true` when a pending
        /// oneshot was found (and completed); `false` when the id was
        /// unknown (already completed or timed out).
        #[qinvokable]
        #[cxx_name = "completeWindowAction"]
        fn complete_window_action(
            self: Pin<&mut GatewayPumpController>,
            id: u64,
            ok: bool,
            payload_json: QString,
        ) -> bool;
    }
}

/// Rust storage for `GatewayPumpController`. All dispatch state lives in the
/// process-wide [`DISPATCH`] static; this struct only mirrors what QML reads.
#[derive(Default)]
pub struct GatewayPumpControllerRust {
    pending_count: i32,
    enabled: bool,
}

impl qobject::GatewayPumpController {
    /// Drain and execute pending actions; see the `qobject` docs.
    pub fn pump_requests(mut self: Pin<&mut Self>) {
        let actions = dispatch().drain(PUMP_BATCH);
        for action in actions {
            match action.method.as_str() {
                "renderer.notify" => {
                    let result = execute_notify(&action.payload);
                    let _ = dispatch().complete(action.id, result);
                }
                "renderer.window.raise" | "renderer.stage.visibility" => {
                    let payload_json =
                        serde_json::to_string(&action.payload).unwrap_or_else(|_| "{}".to_string());
                    qobject::GatewayPumpController::request_window_action(
                        self.as_mut(),
                        action.id,
                        QString::from(action.method.as_str()),
                        QString::from(payload_json.as_str()),
                    );
                }
                other => {
                    // Unreachable: `enqueue` validates the verb set. Kept so a
                    // future verb added without a pump arm answers with an
                    // error instead of leaking a parked connection thread.
                    let _ = dispatch()
                        .complete(action.id, Err(format!("unknown gateway verb: {other}")));
                }
            }
        }
        {
            let mut inner = self.as_mut().rust_mut();
            inner.pending_count = dispatch().outstanding() as i32;
            inner.enabled = allow_actions();
        }
        self.as_mut().pending_count_changed();
        self.as_mut().enabled_changed();
    }

    /// Complete the pending oneshot for a GUI verb executed by QML.
    pub fn complete_window_action(
        mut self: Pin<&mut Self>,
        id: u64,
        ok: bool,
        payload_json: QString,
    ) -> bool {
        let payload = qstring_to_string(&payload_json);
        let completed = dispatch().complete(id, parse_completion(ok, &payload));
        {
            let mut inner = self.as_mut().rust_mut();
            inner.pending_count = dispatch().outstanding() as i32;
        }
        self.as_mut().pending_count_changed();
        completed
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use std::sync::atomic::{AtomicU64, Ordering as TestOrdering};

    static COUNTER: AtomicU64 = AtomicU64::new(0);

    fn temp_config_path(tag: &str) -> std::path::PathBuf {
        let n = COUNTER.fetch_add(1, TestOrdering::SeqCst);
        std::env::temp_dir().join(format!(
            "airi-gateway-pump-test-{tag}-{}-{n}",
            std::process::id()
        ))
    }

    fn write_temp(tag: &str, contents: &str) -> std::path::PathBuf {
        let dir = temp_config_path(tag).with_extension("dir");
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("config.json");
        std::fs::write(&path, contents).unwrap();
        path
    }

    fn cleanup(path: &std::path::Path) {
        if let Some(dir) = path.parent() {
            let _ = std::fs::remove_dir_all(dir);
        }
    }

    fn test_dispatch() -> GuiDispatch {
        GuiDispatch::new(DISPATCH_TIMEOUT)
    }

    // ---- flag parsing (temp dirs; never the real profile) ----

    #[test]
    fn allow_actions_missing_file_is_false() {
        let path = temp_config_path("missing").with_extension("json");
        assert!(!allow_actions_at(&path));
    }

    #[test]
    fn allow_actions_true_is_true() {
        let path = write_temp(
            "true",
            r#"{ "hostname": "127.0.0.1", "authToken": "tok", "allowActions": true }"#,
        );
        assert!(allow_actions_at(&path));
        cleanup(&path);
    }

    #[test]
    fn allow_actions_false_is_false() {
        let path = write_temp("false", r#"{ "authToken": "tok", "allowActions": false }"#);
        assert!(!allow_actions_at(&path));
        cleanup(&path);
    }

    #[test]
    fn allow_actions_non_boolean_is_false() {
        for value in [r#""true""#, "1", "null", r#"{"x":true}"#] {
            let path = write_temp("type", &format!(r#"{{ "allowActions": {value} }}"#));
            assert!(!allow_actions_at(&path), "value {value} must fail closed");
            cleanup(&path);
        }
    }

    #[test]
    fn allow_actions_garbage_json_is_false() {
        let path = write_temp("garbage", "{ not json !");
        assert!(!allow_actions_at(&path));
        cleanup(&path);
    }

    #[test]
    fn allow_actions_absent_key_is_false() {
        let path = write_temp(
            "absent",
            r#"{ "authToken": "tok", "hostname": "127.0.0.1" }"#,
        );
        assert!(!allow_actions_at(&path));
        cleanup(&path);
    }

    // ---- enabled-path roundtrip with a stub executor (no dbus, no Qt) ----

    /// Drive a full request → pump → completion roundtrip. The requester
    /// parks on a worker thread; the test thread plays the pump with a stub
    /// executor and completes the oneshot.
    #[test]
    fn full_roundtrip_with_test_executor() {
        let disp = Arc::new(GuiDispatch::new(Duration::from_secs(2)));
        let requester = {
            let disp = Arc::clone(&disp);
            std::thread::spawn(move || {
                disp.request(
                    "renderer.notify",
                    &json!({ "title": "Deploy done", "body": "v0.1.0 is live" }),
                )
            })
        };
        let mut actions = Vec::new();
        for _ in 0..100 {
            actions = disp.drain(PUMP_BATCH);
            if !actions.is_empty() {
                break;
            }
            std::thread::sleep(Duration::from_millis(5));
        }
        assert_eq!(actions.len(), 1, "pump must observe the pending action");
        let action = &actions[0];
        assert_eq!(action.method, "renderer.notify");
        assert_eq!(
            action.payload,
            json!({ "title": "Deploy done", "body": "v0.1.0 is live" })
        );
        // Stub executor stands in for the Qt-thread pump: complete inline.
        assert!(disp.complete(action.id, Ok(json!({ "notified": true }))));
        let reply = requester.join().expect("requester must not panic");
        assert_eq!(reply.unwrap(), json!({ "notified": true }));
        assert_eq!(disp.outstanding(), 0);
    }

    #[test]
    fn gui_verb_roundtrip_completes_from_complete_window_action_path() {
        let disp = Arc::new(GuiDispatch::new(Duration::from_secs(2)));
        let requester = {
            let disp = Arc::clone(&disp);
            std::thread::spawn(move || {
                disp.request("renderer.stage.visibility", &json!({ "visible": true }))
            })
        };
        let mut actions = Vec::new();
        for _ in 0..100 {
            actions = disp.drain(PUMP_BATCH);
            if !actions.is_empty() {
                break;
            }
            std::thread::sleep(Duration::from_millis(5));
        }
        assert_eq!(actions.len(), 1);
        // Simulate QML: parse then complete exactly like completeWindowAction.
        let completion = parse_completion(true, r#"{"visible":true}"#);
        assert!(disp.complete(actions[0].id, completion));
        let reply = requester.join().expect("requester must not panic");
        assert_eq!(reply.unwrap(), json!({ "visible": true }));
    }

    // ---- disabled path (production entry point fails closed in tests) ----

    #[test]
    fn dispatch_request_fails_closed_when_flag_absent() {
        // Unit tests never resolve the real profile/data dir (cfg(test)
        // branch in server_channel_config_path), so allow_actions() fails
        // closed and the request is refused before enqueueing.
        let err =
            dispatch_request("renderer.notify", &json!({ "title": "t", "body": "b" })).unwrap_err();
        assert!(
            err.starts_with("actions-disabled:"),
            "expected actions-disabled refusal, got: {err}"
        );
        assert!(err.contains("allowActions"));
    }

    // ---- timeout ----

    #[test]
    fn request_times_out_and_retires() {
        let disp = GuiDispatch::new(Duration::from_millis(80));
        let err = disp
            .request("renderer.notify", &json!({ "title": "t", "body": "b" }))
            .unwrap_err();
        assert_eq!(err, "handler timed out");
        // The pending slot must be retired: nothing outstanding, late
        // completion finds no oneshot.
        assert_eq!(disp.outstanding(), 0);
        assert!(!disp.complete(1, Ok(json!({}))));
        // And the action itself must not be executed later.
        assert!(disp.drain(PUMP_BATCH).is_empty());
    }

    // ---- ordering and the pending cap ----

    /// A distinguishable, always-valid `renderer.notify` payload for
    /// ordering/cap tests (title carries `n`).
    fn numbered_payload(n: u64) -> Value {
        json!({ "title": format!("t{n}"), "body": "b" })
    }

    #[test]
    fn enqueue_and_drain_are_fifo_and_respect_limit() {
        let disp = test_dispatch();
        for n in 1..=3u64 {
            let (id, _rx) = disp
                .enqueue("renderer.notify", &numbered_payload(n))
                .expect("enqueue must succeed");
            assert_eq!(id, n);
        }
        let first = disp.drain(2);
        assert_eq!(
            first
                .iter()
                .map(|a| a.payload["title"].as_str().unwrap().to_string())
                .collect::<Vec<_>>(),
            vec!["t1", "t2"]
        );
        let rest = disp.drain(PUMP_BATCH);
        assert_eq!(
            rest.iter()
                .map(|a| a.payload["title"].as_str().unwrap().to_string())
                .collect::<Vec<_>>(),
            vec!["t3"]
        );
        assert_eq!(
            disp.outstanding(),
            3,
            "drained-but-uncompleted actions stay outstanding"
        );
    }

    #[test]
    fn pending_cap_refuses_overflow() {
        let disp = test_dispatch();
        for _ in 0..MAX_PENDING {
            disp.enqueue("renderer.notify", &json!({ "title": "t", "body": "b" }))
                .expect("queue must accept up to MAX_PENDING");
        }
        let err = disp
            .enqueue(
                "renderer.notify",
                &json!({ "title": "overflow", "body": "b" }),
            )
            .unwrap_err();
        assert!(err.starts_with("actions-queue-full:"), "got: {err}");
    }

    #[test]
    fn payload_crosses_enqueue_verbatim_multibyte() {
        let disp = test_dispatch();
        let payload = json!({ "title": "Héllo 🦀", "body": "line1\nline2 🦀🦀" });
        let (id, _rx) = disp.enqueue("renderer.notify", &payload).unwrap();
        let drained = disp.drain(PUMP_BATCH);
        assert_eq!(drained[0].id, id);
        assert_eq!(drained[0].payload, payload);
    }

    #[test]
    fn payload_untouched_for_all_verbs() {
        // Visibility payload with both allowed shapes must survive enqueue→drain verbatim.
        let disp = test_dispatch();
        let (id, _rx) = disp
            .enqueue("renderer.stage.visibility", &json!({}))
            .unwrap();
        let (id2, _rx2) = disp
            .enqueue("renderer.stage.visibility", &json!({ "visible": false }))
            .unwrap();
        let drained = disp.drain(PUMP_BATCH);
        assert_eq!(drained[0].id, id);
        assert_eq!(drained[0].payload, json!({}));
        assert_eq!(drained[1].id, id2);
        assert_eq!(drained[1].payload, json!({ "visible": false }));
    }

    // ---- verb validation ----

    #[test]
    fn notify_validation() {
        // Missing/empty/oversize title, missing/oversize body, unknown keys.
        assert!(validate_verb("renderer.notify", &json!({ "body": "b" })).is_err());
        assert!(validate_verb("renderer.notify", &json!({ "title": "", "body": "b" })).is_err());
        assert!(validate_verb("renderer.notify", &json!({ "title": "   ", "body": "b" })).is_err());
        assert!(validate_verb(
            "renderer.notify",
            &json!({ "title": "x".repeat(201), "body": "b" })
        )
        .is_err());
        assert!(validate_verb("renderer.notify", &json!({ "title": "t" })).is_err());
        assert!(validate_verb(
            "renderer.notify",
            &json!({ "title": "t", "body": "x".repeat(401) })
        )
        .is_err());
        assert!(validate_verb(
            "renderer.notify",
            &json!({ "title": "t", "body": "b", "priority": 5 })
        )
        .is_err());
        // Unicode-aware cap: 200 scalar values are fine even if multi-byte.
        let ok_title = "🦀".repeat(TITLE_MAX_CHARS);
        assert!(validate_verb(
            "renderer.notify",
            &json!({ "title": ok_title, "body": "b" })
        )
        .is_ok());
        assert!(validate_verb("renderer.notify", &json!({ "title": "t", "body": "b" })).is_ok());
        // Non-string fields are rejected.
        assert!(validate_verb("renderer.notify", &json!({ "title": 3, "body": "b" })).is_err());
    }

    #[test]
    fn raise_validation() {
        assert!(validate_verb("renderer.window.raise", &json!({ "which": "chat" })).is_ok());
        assert!(validate_verb("renderer.window.raise", &json!({ "which": "settings" })).is_ok());
        assert!(validate_verb("renderer.window.raise", &json!({ "which": "about" })).is_ok());
        assert!(validate_verb("renderer.window.raise", &json!({ "which": "stage" })).is_ok());
        assert!(validate_verb("renderer.window.raise", &json!({ "which": "terminal" })).is_err());
        assert!(validate_verb("renderer.window.raise", &json!({})).is_err());
        assert!(validate_verb("renderer.window.raise", &json!({ "which": 1 })).is_err());
        assert!(
            validate_verb("renderer.window.raise", &json!({ "which": "chat", "x": 1 })).is_err()
        );
    }

    #[test]
    fn visibility_validation() {
        assert!(validate_verb("renderer.stage.visibility", &json!({})).is_ok());
        assert!(validate_verb("renderer.stage.visibility", &json!({ "visible": true })).is_ok());
        assert!(validate_verb("renderer.stage.visibility", &json!({ "visible": false })).is_ok());
        assert!(validate_verb("renderer.stage.visibility", &Value::Null).is_ok());
        assert!(validate_verb("renderer.stage.visibility", &json!({ "visible": "yes" })).is_err());
        assert!(validate_verb("renderer.stage.visibility", &json!({ "visible": 1 })).is_err());
        assert!(validate_verb("renderer.stage.visibility", &json!({ "other": true })).is_err());
    }

    #[test]
    fn unknown_verb_is_refused_before_enqueue() {
        let err = validate_verb("renderer.eval", &json!({ "code": "x" })).unwrap_err();
        assert!(err.contains("unknown gateway verb"));
        let disp = test_dispatch();
        assert!(disp
            .request("renderer.eval", &json!({}))
            .unwrap_err()
            .contains("unknown gateway verb"));
        assert_eq!(disp.outstanding(), 0);
    }

    // ---- completion parsing ----

    #[test]
    fn parse_completion_roundtrip() {
        // ok path: JSON crosses verbatim
        let ok = parse_completion(true, r#"{"raised":"chat"}"#).unwrap();
        assert_eq!(ok, json!({ "raised": "chat" }));
        assert!(parse_completion(true, "{ not json").is_err());
        // failure path: {"error": "..."} is unwrapped; plain text passes through
        let err = parse_completion(false, r#"{"error":"stage window failed"}"#).unwrap_err();
        assert_eq!(err, "stage window failed");
        let err = parse_completion(false, "WindowManager not ready").unwrap_err();
        assert_eq!(err, "WindowManager not ready");
        // long messages are truncated
        let err = parse_completion(false, &"x".repeat(1000)).unwrap_err();
        assert_eq!(err.chars().count(), ERROR_MAX_CHARS);
    }
}
