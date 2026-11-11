// SPDX-License-Identifier: GPL-3.0-or-later

//! Typed RPC dispatch for the `rpc` message family.
//!
//! This is a deliberately small, fully local slice of the AIRI gateway
//! protocol — no network calls, no filesystem, no GUI bridge. It replaces
//! the old `rpc` payload-echo placeholder with a real registry of handlers,
//! while keeping the wire envelope the channel server has always spoken:
//!
//! ```text
//! client → { "type": "rpc", "action": "<method>", "payload": {…}, "id": "<optional client id>" }
//! server → { "type": "rpc", "action": "<method>", "ok": true,  "data": …,                     "id": "<echoed>" }
//! server → { "type": "rpc", "action": "<method>", "ok": false, "error": { "code": "…", … },   "id": "<echoed>" }
//! ```
//!
//! `id` is echoed verbatim when the client sent one and omitted otherwise.
//! Success replies carry `data`; failure replies carry `error` with a
//! stable `code` string (see [`RpcError::code`]).
//!
//! ## Handler table
//!
//! | Method             | Result `data` shape                                                              | Notes |
//! |--------------------|----------------------------------------------------------------------------------|-------|
//! | `runtime.ping`     | `{ "pong": true, "time": <unix secs>, "uptimeSeconds": <secs> }`                 | Liveness probe |
//! | `runtime.status`   | `{ "app": "airi-qt", "version": <CARGO_PKG_VERSION>, "pid": <u32>, … }`           | Build/process info |
//! | `gateway.config`   | `{ "hostname": <str>, "port": <number> }`                                        | **Never** includes `authToken` |
//! | `gateway.auth`     | `{ "authenticated": true, "sessionStartedMs": <ms> }`                            | Relies on the prior handshake |
//! | `renderer.*`       | —                                                                                | Always `rpc_not_implemented` |
//! | anything else      | —                                                                                | `rpc_unknown_method` |
//!
//! ## Payload rules
//!
//! A missing payload is treated as an empty object (`{}`). A present payload
//! must be a JSON object; anything else (number, string, boolean, array) is
//! rejected with `rpc_bad_payload` before a handler runs.
//!
//! ## Error codes (stable)
//!
//! - `rpc_unknown_method` — no handler is registered for the top-level method.
//! - `rpc_not_implemented` — `renderer.*` methods; the renderer bridge is not
//!   wired in the Qt build yet.
//! - `rpc_bad_payload` — the `payload` field is not a JSON object.
//!
//! `gateway.config` never serializes the auth token into its reply; the
//! config token is the session's only authenticator and stays server-side.

use std::time::{Instant, SystemTime, UNIX_EPOCH};

use serde_json::{Map, Value};

/// Protocol identifier reported by `runtime.status`.
pub const PROTOCOL: &str = "airi-channel/1";

/// Application name reported by `runtime.status`.
pub const APP_NAME: &str = "airi-qt";

/// A JSON payload as it arrived on the wire (or an empty object when absent).
pub type Payload = Value;
/// A handler's successful result, serialized into the reply's `data` field.
pub type RpcValue = Value;

/// Per-server / per-session context handed to RPC handlers.
///
/// `RpcContext::new` captures the server start instant; clones handed to
/// individual sessions via [`RpcContext::for_session`] keep the shared
/// server-start instant (so `uptimeSeconds` is server uptime) while stamping
/// their own `session_started_ms`.
#[derive(Debug, Clone)]
pub struct RpcContext {
    hostname: String,
    port: u16,
    server_started: Instant,
    session_started_ms: u64,
}

impl RpcContext {
    /// Capture a fresh context: server uptime starts now.
    pub fn new(hostname: impl Into<String>, port: u16) -> Self {
        Self {
            hostname: hostname.into(),
            port,
            server_started: Instant::now(),
            session_started_ms: now_ms(),
        }
    }

    /// Clone this context for a new session, keeping the server-start instant
    /// and stamping a fresh `session_started_ms`.
    pub(crate) fn for_session(&self) -> Self {
        Self {
            hostname: self.hostname.clone(),
            port: self.port,
            server_started: self.server_started,
            session_started_ms: now_ms(),
        }
    }

    /// Hostname the server is bound to.
    pub fn hostname(&self) -> &str {
        &self.hostname
    }

    /// Port the server is bound to (or the port the OS assigned for `0`).
    pub fn port(&self) -> u16 {
        self.port
    }

    /// Whole seconds since the server context was created.
    pub fn uptime_seconds(&self) -> u64 {
        self.server_started.elapsed().as_secs()
    }

    /// Milliseconds since the Unix epoch when this session's context was created.
    pub fn session_started_ms(&self) -> u64 {
        self.session_started_ms
    }
}

/// A typed RPC failure. `code` is a stable string clients may match on.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RpcError {
    code: &'static str,
    message: String,
}

impl RpcError {
    /// `rpc_unknown_method` — no handler registered for `action`.
    pub fn unknown_method(action: &str) -> Self {
        Self {
            code: "rpc_unknown_method",
            message: format!("unknown rpc method: '{action}'"),
        }
    }

    /// `rpc_not_implemented` — reserved for `renderer.*` until the Qt
    /// renderer bridge (GUI-thread dispatch target) lands.
    pub fn renderer_not_implemented() -> Self {
        Self {
            code: "rpc_not_implemented",
            message: "renderer-bound RPC is not wired in the Qt build yet — see docs/phase-notes/p9-lane-channel-rpc.md".to_string(),
        }
    }

    /// `rpc_bad_payload` — `payload` was present but not a JSON object.
    pub fn bad_payload(message: &str) -> Self {
        Self {
            code: "rpc_bad_payload",
            message: message.to_string(),
        }
    }

    /// Stable machine-readable error code.
    pub fn code(&self) -> &'static str {
        self.code
    }

    /// Human-readable error message.
    pub fn message(&self) -> &str {
        &self.message
    }
}

impl std::fmt::Display for RpcError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}: {}", self.code, self.message)
    }
}

impl std::error::Error for RpcError {}

/// The dispatch registry. Stateless — handlers are pure functions over
/// [`RpcContext`] and the payload; dispatch is a plain `match`.
pub struct RpcRegistry;

impl RpcRegistry {
    /// Every method this registry implements, for docs and tests.
    pub const METHODS: &'static [&'static str] = &[
        "runtime.ping",
        "runtime.status",
        "gateway.config",
        "gateway.auth",
    ];

    /// Dispatch `action` with `payload` to its handler.
    ///
    /// `renderer.*` is always `rpc_not_implemented`; any other unrecognized
    /// top-level method is `rpc_unknown_method`. The caller has already
    /// authenticated the session by this point — handlers rely on that and
    /// perform no further authentication.
    pub fn dispatch(
        ctx: &RpcContext,
        action: &str,
        payload: &Payload,
    ) -> Result<RpcValue, RpcError> {
        match action {
            "runtime.ping" => runtime_ping(ctx, payload),
            "runtime.status" => runtime_status(ctx, payload),
            "gateway.config" => gateway_config(ctx, payload),
            "gateway.auth" => gateway_auth(ctx, payload),
            _ if action.starts_with("renderer.") => Err(RpcError::renderer_not_implemented()),
            _ => Err(RpcError::unknown_method(action)),
        }
    }
}

/// Reject a present-but-not-object payload. Missing (`null`) is accepted.
fn require_object_payload(payload: &Payload) -> Result<(), RpcError> {
    match payload {
        Value::Null | Value::Object(_) => Ok(()),
        _ => Err(RpcError::bad_payload("rpc payload must be a JSON object")),
    }
}

fn runtime_ping(ctx: &RpcContext, payload: &Payload) -> Result<RpcValue, RpcError> {
    require_object_payload(payload)?;
    Ok(serde_json::json!({
        "pong": true,
        "time": unix_secs(),
        "uptimeSeconds": ctx.uptime_seconds(),
    }))
}

fn runtime_status(ctx: &RpcContext, payload: &Payload) -> Result<RpcValue, RpcError> {
    require_object_payload(payload)?;
    Ok(serde_json::json!({
        "app": APP_NAME,
        "version": env!("CARGO_PKG_VERSION"),
        "pid": std::process::id(),
        "uptimeSeconds": ctx.uptime_seconds(),
        "protocol": PROTOCOL,
    }))
}

fn gateway_config(ctx: &RpcContext, payload: &Payload) -> Result<RpcValue, RpcError> {
    require_object_payload(payload)?;
    // NOTICE: Never include `authToken` (or any credential) here. The token
    // stays server-side; clients that need it read the config file or the
    // pairing UX, never this reply.
    let mut obj = Map::new();
    obj.insert(
        "hostname".to_string(),
        Value::String(ctx.hostname().to_string()),
    );
    obj.insert("port".to_string(), Value::from(ctx.port()));
    Ok(Value::Object(obj))
}

fn gateway_auth(ctx: &RpcContext, payload: &Payload) -> Result<RpcValue, RpcError> {
    require_object_payload(payload)?;
    Ok(serde_json::json!({
        "authenticated": true,
        "sessionStartedMs": ctx.session_started_ms(),
    }))
}

fn unix_secs() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn ctx() -> RpcContext {
        RpcContext::new("127.0.0.1", 6121)
    }

    #[test]
    fn runtime_ping_shape() {
        let out = RpcRegistry::dispatch(&ctx(), "runtime.ping", &Value::Null).unwrap();
        assert_eq!(out["pong"], json!(true));
        assert!(out["time"].as_u64().unwrap() > 0);
        assert!(out["uptimeSeconds"].as_u64().unwrap() < 60);
    }

    #[test]
    fn runtime_status_shape() {
        let out = RpcRegistry::dispatch(&ctx(), "runtime.status", &json!({})).unwrap();
        assert_eq!(out["app"], json!("airi-qt"));
        assert_eq!(out["version"], json!(env!("CARGO_PKG_VERSION")));
        assert!(out["pid"].as_u64().unwrap() > 0);
        assert!(out["uptimeSeconds"].as_u64().is_some());
        assert_eq!(out["protocol"], json!("airi-channel/1"));
    }

    #[test]
    fn gateway_config_never_leaks_token() {
        let out = RpcRegistry::dispatch(&ctx(), "gateway.config", &Value::Null).unwrap();
        assert_eq!(out["hostname"], json!("127.0.0.1"));
        assert_eq!(out["port"], json!(6121));
        let obj = out.as_object().unwrap();
        assert!(!obj.contains_key("authToken"));
        assert!(!obj.contains_key("auth_token"));
        assert_eq!(obj.len(), 2);
    }

    #[test]
    fn gateway_auth_shape() {
        let out = RpcRegistry::dispatch(&ctx(), "gateway.auth", &Value::Null).unwrap();
        assert_eq!(out["authenticated"], json!(true));
        assert!(out["sessionStartedMs"].as_u64().unwrap() > 0);
    }

    #[test]
    fn unknown_method_is_typed_error() {
        let err = RpcRegistry::dispatch(&ctx(), "stage.move", &json!({})).unwrap_err();
        assert_eq!(err.code(), "rpc_unknown_method");
        assert!(err.message().contains("stage.move"));
    }

    #[test]
    fn renderer_namespace_is_not_implemented() {
        for action in ["renderer.getModels", "renderer.dispatch", "renderer.x"] {
            let err = RpcRegistry::dispatch(&ctx(), action, &json!({})).unwrap_err();
            assert_eq!(err.code(), "rpc_not_implemented", "action {action}");
            assert!(err
                .message()
                .contains("docs/phase-notes/p9-lane-channel-rpc.md"));
        }
    }

    #[test]
    fn bare_renderer_prefix_is_unknown_method() {
        let err = RpcRegistry::dispatch(&ctx(), "renderer", &json!({})).unwrap_err();
        assert_eq!(err.code(), "rpc_unknown_method");
    }

    #[test]
    fn non_object_payloads_are_bad_payload() {
        for payload in [json!(5), json!("text"), json!(true), json!([1, 2])] {
            let err = RpcRegistry::dispatch(&ctx(), "runtime.ping", &payload).unwrap_err();
            assert_eq!(err.code(), "rpc_bad_payload", "payload {payload}");
        }
    }

    #[test]
    fn null_and_object_payloads_are_accepted() {
        for payload in [Value::Null, json!({}), json!({"verbose": true})] {
            assert!(RpcRegistry::dispatch(&ctx(), "runtime.ping", &payload).is_ok());
        }
    }

    #[test]
    fn registry_methods_are_documented_table() {
        assert_eq!(
            RpcRegistry::METHODS,
            &[
                "runtime.ping",
                "runtime.status",
                "gateway.config",
                "gateway.auth"
            ]
        );
    }
}
