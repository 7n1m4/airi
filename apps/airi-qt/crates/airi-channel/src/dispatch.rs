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
//! | `renderer.*`       | handler-defined | Embedder-registered read-only handlers; unregistered methods are `rpc_not_implemented` |
//! | anything else      | —                                                                                | `rpc_unknown_method` |
//!
//! ## Payload rules
//!
//! A missing payload is treated as an empty object (`{}`). A present payload
//! must be a JSON object; anything else (number, string, boolean, array) is
//! rejected with `rpc_bad_payload` before a handler runs — including for
//! `renderer.*`.
//!
//! ## Error codes (stable)
//!
//! - `rpc_unknown_method` — no handler is registered for the top-level method.
//! - `rpc_not_implemented` — a `renderer.<method>` with no embedder-registered
//!   handler for `<method>`.
//! - `rpc_bad_payload` — the `payload` field is not a JSON object.
//! - `rpc_handler_error` — a registered renderer handler returned `Err(msg)`
//!   (message truncated to 512 chars).
//! - `rpc_handler_panic` — a registered renderer handler panicked; the client
//!   gets a generic message, the payload is logged server-side only.
//! - `rpc_actions_disabled` — a registered renderer handler refused because
//!   the gateway GUI-dispatch actions flag (`allowActions` in
//!   `server-channel/config.json`) is off. Off by default; opt-in only.
//!
//! `gateway.config` never serializes the auth token into its reply; the
//! config token is the session's only authenticator and stays server-side.
//!
//! ## Renderer handlers
//!
//! Embedders register read-only handlers for `renderer.*` methods via
//! [`RendererHandlers`]; the map travels behind an `Arc` and is consulted
//! only under the `renderer.` prefix. Handlers receive the sub-method name
//! (e.g. `info` for `renderer.info`) and the already-validated JSON object
//! payload. They run on the connection's reader thread, receive and return
//! plain JSON (never the token or the config), and must not block for long.
//! A panicking handler does not take the connection down — see
//! [`RpcError::renderer_handler_panic`].

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

/// A renderer-bridge handler: maps the `renderer.<method>` sub-method and
/// validated JSON object payload to a JSON value (sent verbatim as `data`)
/// or a plain error message.
///
/// Handlers never receive the auth token, the config, or any credential —
/// only the method name and the payload object. They run on the connection
/// thread, so they must be quick, must never block the GUI event loop, and
/// must not touch Qt `QObject`s directly. Return plain JSON in, plain JSON
/// out.
///
/// NOTE (deliberate deviation from the initial lane brief, which asked for
/// `Send + 'static` only): the registry is shared by reference across all
/// connection threads behind an `Arc`, which also requires `Sync` on the
/// boxed trait object — so the bound is `Send + Sync + 'static`. Callers
/// implementing handlers with non-`Sync` captures will not compile, which
/// is the desired property here.
pub type RendererHandler =
    dyn Fn(&str, &serde_json::Value) -> Result<serde_json::Value, String> + Send + Sync + 'static;
/// The renderer handler registry: `renderer.<method>` → handler.
///
/// An empty map is the default — `renderer.*` then replies with
/// `rpc_not_implemented`, exactly as before the registry existed.
pub type RendererHandlers = std::collections::HashMap<String, Box<RendererHandler>>;

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

    /// `rpc_not_implemented` — no embedder-registered handler exists for
    /// `renderer.<method>`.
    pub fn renderer_not_implemented(method: &str) -> Self {
        Self {
            code: "rpc_not_implemented",
            message: format!(
                "renderer.{method} is not wired in this build — see docs/phase-notes/p9-lane-channel-rpc.md"
            ),
        }
    }

    /// `rpc_actions_disabled` — a registered renderer handler refused because
    /// the gateway GUI-dispatch actions flag (`allowActions` in
    /// `server-channel/config.json`) is off. Off by default; opt-in only.
    /// The message never includes the config contents.
    pub fn actions_disabled() -> Self {
        Self {
            code: "rpc_actions_disabled",
            message: "gateway actions are disabled (set allowActions=true to enable)".to_string(),
        }
    }

    /// `rpc_handler_error` — a registered renderer handler returned `Err`.
    /// The message is truncated to 512 chars.
    pub fn renderer_handler_error(message: &str) -> Self {
        Self {
            code: "rpc_handler_error",
            message: message.chars().take(512).collect(),
        }
    }

    /// `rpc_handler_panic` — a registered renderer handler panicked. The
    /// client gets a fixed generic message; the panic payload is logged
    /// server-side and never reaches the wire.
    pub fn renderer_handler_panic() -> Self {
        Self {
            code: "rpc_handler_panic",
            message: "renderer handler panicked — see server log".to_string(),
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
    /// `renderer.<method>` is looked up in `renderer_handlers` (the map is
    /// consulted only under the `renderer.` prefix); anything else is the
    /// built-in `match` above. The caller has already authenticated the
    /// session by this point — handlers rely on that and perform no further
    /// authentication.
    ///
    /// Renderer handler failures surface as typed errors: `Err(msg)` from a
    /// handler becomes `rpc_handler_error` (truncated), a panic becomes
    /// `rpc_handler_panic` (generic message; the panic is logged server-side).
    pub fn dispatch(
        ctx: &RpcContext,
        action: &str,
        payload: &Payload,
        renderer_handlers: &RendererHandlers,
    ) -> Result<RpcValue, RpcError> {
        match action {
            "runtime.ping" => runtime_ping(ctx, payload),
            "runtime.status" => runtime_status(ctx, payload),
            "gateway.config" => gateway_config(ctx, payload),
            "gateway.auth" => gateway_auth(ctx, payload),
            _ => match action.strip_prefix("renderer.") {
                Some(method) => dispatch_renderer(renderer_handlers, method, payload),
                None => Err(RpcError::unknown_method(action)),
            },
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

/// Map a renderer handler's `Err(msg)` onto the typed error for the reply.
///
/// Messages starting with `actions-disabled` (the GUI-dispatch core's
/// opt-in refusal, produced when `allowActions` is not enabled in
/// `server-channel/config.json`) map to `rpc_actions_disabled` so clients can
/// match on the stable code. Everything else keeps the historical
/// `rpc_handler_error` mapping — the prefix check is the only special case.
fn renderer_handler_error_from(message: &str) -> RpcError {
    if message.starts_with("actions-disabled") {
        RpcError::actions_disabled()
    } else {
        RpcError::renderer_handler_error(message)
    }
}

/// Dispatch a `renderer.<method>` action. The map is consulted only under
/// the `renderer.` prefix; built-in methods are never shadowed by it.
/// The payload is validated (object or null) before any handler runs, and
/// handlers are invoked behind `catch_unwind` so a panicking renderer
/// handler cannot take the connection — or the server — down with it.
fn dispatch_renderer(
    renderer_handlers: &RendererHandlers,
    method: &str,
    payload: &Payload,
) -> Result<RpcValue, RpcError> {
    require_object_payload(payload)?;
    let Some(handler) = renderer_handlers.get(method) else {
        return Err(RpcError::renderer_not_implemented(method));
    };
    match std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| handler(method, payload))) {
        Ok(Ok(value)) => Ok(value),
        Ok(Err(message)) => Err(renderer_handler_error_from(&message)),
        Err(panic) => {
            // NOTICE: log the payload server-side; never serialize it into
            // the client reply (it can hold arbitrary handler internals).
            let detail = panic
                .downcast_ref::<&str>()
                .map(|s| (*s).to_string())
                .or_else(|| panic.downcast_ref::<String>().cloned())
                .unwrap_or_else(|| "<non-string panic payload>".to_string());
            tracing::warn!(%detail, %method, "renderer handler panicked");
            Err(RpcError::renderer_handler_panic())
        }
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

    fn empty_handlers() -> RendererHandlers {
        RendererHandlers::new()
    }

    /// Dispatch with the default (empty) renderer registry.
    fn dispatch_no_renderers(
        ctx: &RpcContext,
        action: &str,
        payload: &Value,
    ) -> Result<RpcValue, RpcError> {
        RpcRegistry::dispatch(ctx, action, payload, &empty_handlers())
    }

    #[test]
    fn runtime_ping_shape() {
        let out = dispatch_no_renderers(&ctx(), "runtime.ping", &Value::Null).unwrap();
        assert_eq!(out["pong"], json!(true));
        assert!(out["time"].as_u64().unwrap() > 0);
        assert!(out["uptimeSeconds"].as_u64().unwrap() < 60);
    }

    #[test]
    fn runtime_status_shape() {
        let out = dispatch_no_renderers(&ctx(), "runtime.status", &json!({})).unwrap();
        assert_eq!(out["app"], json!("airi-qt"));
        assert_eq!(out["version"], json!(env!("CARGO_PKG_VERSION")));
        assert!(out["pid"].as_u64().unwrap() > 0);
        assert!(out["uptimeSeconds"].as_u64().is_some());
        assert_eq!(out["protocol"], json!("airi-channel/1"));
    }

    #[test]
    fn gateway_config_never_leaks_token() {
        let out = dispatch_no_renderers(&ctx(), "gateway.config", &Value::Null).unwrap();
        assert_eq!(out["hostname"], json!("127.0.0.1"));
        assert_eq!(out["port"], json!(6121));
        let obj = out.as_object().unwrap();
        assert!(!obj.contains_key("authToken"));
        assert!(!obj.contains_key("auth_token"));
        assert_eq!(obj.len(), 2);
    }

    #[test]
    fn gateway_auth_shape() {
        let out = dispatch_no_renderers(&ctx(), "gateway.auth", &Value::Null).unwrap();
        assert_eq!(out["authenticated"], json!(true));
        assert!(out["sessionStartedMs"].as_u64().unwrap() > 0);
    }

    #[test]
    fn unknown_method_is_typed_error() {
        let err = dispatch_no_renderers(&ctx(), "stage.move", &json!({})).unwrap_err();
        assert_eq!(err.code(), "rpc_unknown_method");
        assert!(err.message().contains("stage.move"));
    }

    #[test]
    fn renderer_namespace_is_not_implemented() {
        for action in ["renderer.getModels", "renderer.dispatch", "renderer.x"] {
            let err = dispatch_no_renderers(&ctx(), action, &json!({})).unwrap_err();
            assert_eq!(err.code(), "rpc_not_implemented", "action {action}");
            assert!(err
                .message()
                .contains("docs/phase-notes/p9-lane-channel-rpc.md"));
        }
    }

    #[test]
    fn bare_renderer_prefix_is_unknown_method() {
        let err = dispatch_no_renderers(&ctx(), "renderer", &json!({})).unwrap_err();
        assert_eq!(err.code(), "rpc_unknown_method");
    }

    fn info_handlers() -> RendererHandlers {
        let mut handlers = RendererHandlers::new();
        handlers.insert(
            "info".to_string(),
            Box::new(|method: &str, payload: &Value| {
                assert_eq!(method, "info");
                Ok(json!({ "echoMethod": method, "echoPayload": payload }))
            }),
        );
        handlers
    }

    #[test]
    fn registered_renderer_handler_returns_data_verbatim() {
        let out = RpcRegistry::dispatch(
            &ctx(),
            "renderer.info",
            &json!({ "q": "status" }),
            &info_handlers(),
        )
        .unwrap();
        assert_eq!(
            out,
            json!({ "echoMethod": "info", "echoPayload": { "q": "status" } })
        );
    }

    #[test]
    fn renderer_handler_receives_method_and_payload() {
        use std::sync::{Arc, Mutex};
        let seen = Arc::new(Mutex::new(Vec::new()));
        let seen_in_handler = Arc::clone(&seen);
        let mut handlers = RendererHandlers::new();
        handlers.insert(
            "getModels".to_string(),
            Box::new(move |method: &str, payload: &Value| {
                seen_in_handler
                    .lock()
                    .unwrap()
                    .push((method.to_string(), payload.clone()));
                Ok(json!({ "ok": true }))
            }),
        );
        let out = RpcRegistry::dispatch(
            &ctx(),
            "renderer.getModels",
            &json!({ "limit": 3 }),
            &handlers,
        )
        .unwrap();
        assert_eq!(out, json!({ "ok": true }));
        let seen = seen.lock().unwrap();
        assert_eq!(
            seen.as_slice(),
            [("getModels".to_string(), json!({ "limit": 3 }))]
        );
    }

    #[test]
    fn renderer_handler_error_is_typed_and_truncated() {
        let mut handlers = RendererHandlers::new();
        handlers.insert(
            "explode".to_string(),
            Box::new(|_method: &str, _payload: &Value| Err("boom".repeat(200))),
        );
        let err =
            RpcRegistry::dispatch(&ctx(), "renderer.explode", &Value::Null, &handlers).unwrap_err();
        assert_eq!(err.code(), "rpc_handler_error");
        assert_eq!(err.message().len(), 512);
        assert!(err.message().starts_with("boomboom"));
    }

    #[test]
    fn renderer_handler_short_error_is_not_truncated() {
        let mut handlers = RendererHandlers::new();
        handlers.insert(
            "explode".to_string(),
            Box::new(|_method: &str, _payload: &Value| Err("nope".to_string())),
        );
        let err =
            RpcRegistry::dispatch(&ctx(), "renderer.explode", &Value::Null, &handlers).unwrap_err();
        assert_eq!(err.code(), "rpc_handler_error");
        assert_eq!(err.message(), "nope");
    }

    #[test]
    fn renderer_handler_actions_disabled_maps_to_actions_disabled() {
        let mut handlers = RendererHandlers::new();
        handlers.insert(
            "notify".to_string(),
            Box::new(|_method: &str, _payload: &Value| {
                Err("actions-disabled: gateway actions are off; set \"allowActions\": true in /tmp/example/server-channel/config.json".to_string())
            }),
        );
        let err =
            RpcRegistry::dispatch(&ctx(), "renderer.notify", &json!({}), &handlers).unwrap_err();
        assert_eq!(err.code(), "rpc_actions_disabled");
        assert_eq!(
            err.message(),
            "gateway actions are disabled (set allowActions=true to enable)"
        );
        // Other handler errors keep the historical mapping.
        let mut handlers = RendererHandlers::new();
        handlers.insert(
            "explode".to_string(),
            Box::new(|_method: &str, _payload: &Value| {
                Err("boom actions-disabled (not a prefix)".to_string())
            }),
        );
        let err =
            RpcRegistry::dispatch(&ctx(), "renderer.explode", &json!({}), &handlers).unwrap_err();
        assert_eq!(err.code(), "rpc_handler_error");
    }

    #[test]
    fn renderer_handler_panic_is_caught_and_generic() {
        let mut handlers = RendererHandlers::new();
        handlers.insert(
            "boom".to_string(),
            Box::new(|_method: &str, _payload: &Value| -> Result<Value, String> { panic!("boom") }),
        );
        let err =
            RpcRegistry::dispatch(&ctx(), "renderer.boom", &Value::Null, &handlers).unwrap_err();
        assert_eq!(err.code(), "rpc_handler_panic");
        assert_eq!(err.message(), "renderer handler panicked — see server log");
        // The test itself survives; the connection would stay open.
    }

    #[test]
    fn unregistered_renderer_method_is_not_implemented_with_docs_path() {
        let err = dispatch_no_renderers(&ctx(), "renderer.whatever", &json!({})).unwrap_err();
        assert_eq!(err.code(), "rpc_not_implemented");
        assert!(err.message().contains("renderer.whatever"));
        assert!(err
            .message()
            .contains("docs/phase-notes/p9-lane-channel-rpc.md"));
    }

    #[test]
    fn renderer_registry_cannot_shadow_builtin_methods() {
        let mut handlers = RendererHandlers::new();
        for key in [
            "runtime.ping",
            "gateway.config",
            "gateway.auth",
            "runtime.status",
        ] {
            handlers.insert(
                key.to_string(),
                Box::new(|_method: &str, _payload: &Value| Ok(json!({ "shadowed": true }))),
            );
        }
        let out = dispatch_no_renderers(&ctx(), "runtime.ping", &Value::Null).unwrap();
        assert_eq!(out["pong"], json!(true));
        let out = dispatch_no_renderers(&ctx(), "gateway.auth", &Value::Null).unwrap();
        assert_eq!(out["authenticated"], json!(true));
        // And the same map is consulted (only) under the renderer. prefix —
        // "renderer.runtime.ping" looks up the sub-method "runtime.ping".
        let out = RpcRegistry::dispatch(&ctx(), "renderer.runtime.ping", &Value::Null, &handlers)
            .unwrap();
        assert_eq!(out, json!({ "shadowed": true }));
    }

    #[test]
    fn renderer_handler_rejects_non_object_payload() {
        let err = RpcRegistry::dispatch(&ctx(), "renderer.info", &json!([1, 2]), &info_handlers())
            .unwrap_err();
        assert_eq!(err.code(), "rpc_bad_payload");
    }

    #[test]
    fn bare_renderer_dot_is_not_implemented() {
        // "renderer." with an empty sub-method has no registered handler.
        let err = dispatch_no_renderers(&ctx(), "renderer.", &json!({})).unwrap_err();
        assert_eq!(err.code(), "rpc_not_implemented");
    }

    #[test]
    fn non_object_payloads_are_bad_payload() {
        for payload in [json!(5), json!("text"), json!(true), json!([1, 2])] {
            let err = dispatch_no_renderers(&ctx(), "runtime.ping", &payload).unwrap_err();
            assert_eq!(err.code(), "rpc_bad_payload", "payload {payload}");
        }
    }

    #[test]
    fn null_and_object_payloads_are_accepted() {
        for payload in [Value::Null, json!({}), json!({"verbose": true})] {
            assert!(dispatch_no_renderers(&ctx(), "runtime.ping", &payload).is_ok());
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
