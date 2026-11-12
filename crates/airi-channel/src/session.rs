// SPDX-License-Identifier: GPL-3.0-or-later

//! Protocol session: a pure, testable state machine for the connection
//! lifecycle after the WebSocket upgrade completes.
//!
//! ```text
//!   connect ──► AwaitingAuth ──auth ok──► Authenticated ──► …messages…
//!                  │                          │
//!                  └─ any failure ──► close 1008 (policy violation)
//! ```
//!
//! The machine never touches sockets — [`Session::handle_text`] maps an
//! inbound text payload to a [`SessionOutcome`] (reply frames + optional
//! close), which makes the handshake and message handling unit-testable with
//! raw strings.
//!
//! ## Accepted auth shapes (first message only)
//!
//! 1. Simple: `{"type": "auth", "authToken": "<token>"}` → replies
//!    `{"type": "auth", "ok": true}`.
//! 2. Server-runtime mirror (`packages/server-runtime`):
//!    `{"type": "module:authenticate", "data": {"token": "<token>"}}` → replies
//!    `{"type": "module:authenticated", "data": {"authenticated": true}}`.
//!
//! Any other first message, a missing token field, or a token mismatch →
//! typed `error` frame followed by a close frame (code 1008). Nothing else is
//! ever sent to an unauthenticated peer.
//!
//! ## Authenticated messages
//!
//! - `{"type": "ping"}` → `{"type": "pong"}`.
//! - `{"type": "transport:connection:heartbeat", "data": {"kind": "ping", …}}`
//!   → mirrors the server-runtime:
//!   `{"type": "transport:connection:heartbeat", "data": {"kind": "pong", "message": "💛", "at": <ms>}}`.
//!   A heartbeat with a non-`ping` kind is acknowledged silently (as in the
//!   server-runtime, only pings get pongs).
//! - `{"type": "rpc", "action": "…", "payload": …, "id": "<optional>"}` →
//!   dispatched through the typed [`crate::dispatch`] registry. Success
//!   replies: `{"type":"rpc","action":"…","ok":true,"data":…}`; failure
//!   replies: `{"type":"rpc","action":"…","ok":false,"error":{"code":"…","message":"…"}}`.
//!   A client-supplied `id` is echoed verbatim. `renderer.*` methods are
//!   dispatched to embedder-registered renderer handlers (`rpc_not_implemented`
//!   when unregistered; `rpc_handler_error` / `rpc_handler_panic` when a
//!   registered handler fails); unknown methods get `rpc_unknown_method`;
//!   non-object payloads get `rpc_bad_payload`.
//! - Anything else → typed `error` frame with code `unsupported_type`;
//!   the connection stays open.
//!
//! ## Error frame shape
//!
//! `{"type": "error", "error": {"code": "<code>", "message": "<message>"}}`
//!
//! Codes: `auth_required`, `bad_message`, `bad_auth_message`, `invalid_token`,
//! `invalid_rpc`, `unsupported_type`. RPC failures inside `rpc` replies use
//! the stable `rpc_*` codes documented in [`crate::dispatch`].

use std::sync::Arc;

use serde_json::{json, Value};

use crate::dispatch::{RendererHandlers, RpcContext, RpcRegistry};

/// Close code used when the policy (auth handshake) is violated: 1008.
pub const CLOSE_POLICY_VIOLATION: u16 = 1008;
/// Close code for malformed frames: 1002.
pub const CLOSE_PROTOCOL_ERROR: u16 = 1002;
/// Close code for wrong-opcode binary frames: 1003.
pub const CLOSE_UNSUPPORTED_DATA: u16 = 1003;
/// Close code when the 1 MiB message cap is exceeded: 1009.
pub const CLOSE_MESSAGE_TOO_BIG: u16 = 1009;

/// Instruction to send a WebSocket close frame after queued replies.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CloseInfo {
    /// RFC 6455 close status code.
    pub code: u16,
    /// Human-readable reason, sent inside the close payload.
    pub reason: String,
}

/// What the transport should do with an inbound text message.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SessionOutcome {
    /// JSON text payloads to send back, in order.
    pub replies: Vec<String>,
    /// When set, send a close frame after `replies` and drop the connection.
    pub close: Option<CloseInfo>,
}

impl SessionOutcome {
    fn replies_only(replies: Vec<String>) -> Self {
        Self {
            replies,
            close: None,
        }
    }
}

/// Authentication state of the session.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SessionState {
    /// No valid auth message received yet; nothing else is accepted.
    AwaitingAuth,
    /// Handshake completed; normal message handling applies.
    Authenticated,
}

/// One WebSocket connection's protocol state.
pub struct Session {
    expected_token: String,
    state: SessionState,
    rpc_ctx: RpcContext,
    renderer_handlers: Arc<RendererHandlers>,
}

impl Session {
    /// Create a session expecting `expected_token` for the handshake.
    ///
    /// The RPC context defaults to loopback/`DEFAULT_PORT` with the uptime
    /// clock starting now; servers should prefer [`Session::with_context`]
    /// so handlers observe the real bind address and shared server uptime.
    /// No renderer handlers are registered; `renderer.*` replies with
    /// `rpc_not_implemented`.
    pub fn new(expected_token: String) -> Self {
        Self::with_context(
            expected_token,
            RpcContext::new(crate::config::DEFAULT_HOSTNAME, crate::DEFAULT_PORT),
        )
    }

    /// Create a session with an explicit RPC context (server bind address,
    /// uptime origin shared with other connections). No renderer handlers
    /// are registered.
    pub fn with_context(expected_token: String, rpc_ctx: RpcContext) -> Self {
        Self::with_renderer(expected_token, rpc_ctx, Arc::new(RendererHandlers::new()))
    }

    /// Create a session with an explicit RPC context and a shared renderer
    /// handler registry (as built by
    /// [`crate::ChannelServer::bind_with_renderer`]). The map travels
    /// behind an `Arc`; sessions (and connections) all see the same
    /// registrations.
    pub fn with_renderer(
        expected_token: String,
        rpc_ctx: RpcContext,
        renderer_handlers: Arc<RendererHandlers>,
    ) -> Self {
        Self {
            expected_token,
            state: SessionState::AwaitingAuth,
            rpc_ctx,
            renderer_handlers,
        }
    }

    /// Current authentication state.
    pub fn state(&self) -> SessionState {
        self.state
    }

    /// True once the handshake has completed.
    pub fn is_authenticated(&self) -> bool {
        self.state == SessionState::Authenticated
    }

    /// Handle one inbound text message.
    pub fn handle_text(&mut self, raw: &str) -> SessionOutcome {
        let value: Value = match serde_json::from_str(raw) {
            Ok(v) => v,
            Err(e) => {
                return self.bad_message(&format!("invalid JSON: {e}"));
            }
        };
        if !value.is_object() {
            return self.bad_message("expected a JSON object");
        }

        match self.state {
            SessionState::AwaitingAuth => self.handle_auth(&value),
            SessionState::Authenticated => self.handle_authenticated(&value),
        }
    }

    /// JSON-level failure: closes the connection before auth, typed error otherwise.
    fn bad_message(&self, message: &str) -> SessionOutcome {
        let frame = error_frame("bad_message", message);
        match self.state {
            SessionState::AwaitingAuth => self.fail(&frame),
            SessionState::Authenticated => SessionOutcome::replies_only(vec![frame]),
        }
    }

    /// Pre-auth path: only the auth handshake is accepted.
    fn handle_auth(&mut self, value: &Value) -> SessionOutcome {
        let msg_type = value.get("type").and_then(Value::as_str);

        enum AuthShape {
            Simple,
            ServerRuntime,
        }

        let (token, shape) = match msg_type {
            Some("auth") => (
                value.get("authToken").and_then(Value::as_str),
                AuthShape::Simple,
            ),
            Some("module:authenticate") => (
                value
                    .get("data")
                    .and_then(|d| d.get("token"))
                    .and_then(Value::as_str),
                AuthShape::ServerRuntime,
            ),
            Some(other) => {
                return self.fail(&error_frame(
                    "auth_required",
                    &format!("first message must authenticate, got type '{other}'"),
                ));
            }
            None => {
                return self.fail(&error_frame(
                    "bad_auth_message",
                    "missing 'type' field; expected an auth message",
                ));
            }
        };

        let Some(token) = token else {
            return self.fail(&error_frame(
                "bad_auth_message",
                "missing or non-string token field",
            ));
        };

        if !tokens_equal(token, &self.expected_token) {
            return self.fail(&error_frame("invalid_token", "invalid token"));
        }

        self.state = SessionState::Authenticated;
        let reply = match shape {
            AuthShape::Simple => json!({ "type": "auth", "ok": true }),
            AuthShape::ServerRuntime => {
                json!({ "type": "module:authenticated", "data": { "authenticated": true } })
            }
        };
        SessionOutcome::replies_only(vec![reply.to_string()])
    }

    /// Post-auth path: ping/pong, typed RPC dispatch, typed errors.
    fn handle_authenticated(&mut self, value: &Value) -> SessionOutcome {
        match value.get("type").and_then(Value::as_str) {
            Some("ping") => {
                SessionOutcome::replies_only(vec![json!({ "type": "pong" }).to_string()])
            }

            Some("transport:connection:heartbeat") => {
                let kind = value
                    .get("data")
                    .and_then(|d| d.get("kind"))
                    .and_then(Value::as_str)
                    .unwrap_or("");
                if kind == "ping" {
                    let pong = json!({
                        "type": "transport:connection:heartbeat",
                        "data": { "kind": "pong", "message": "💛", "at": now_ms() },
                    });
                    SessionOutcome::replies_only(vec![pong.to_string()])
                } else {
                    // Mirror the server-runtime: only ping heartbeats get pongs.
                    SessionOutcome::replies_only(Vec::new())
                }
            }

            Some("rpc") => {
                let action = value.get("action").and_then(Value::as_str);
                match action {
                    Some(action) if !action.trim().is_empty() => {
                        let payload = value.get("payload").cloned().unwrap_or(Value::Null);
                        let result = RpcRegistry::dispatch(
                            &self.rpc_ctx,
                            action,
                            &payload,
                            &self.renderer_handlers,
                        );
                        let mut reply = serde_json::Map::new();
                        reply.insert("type".to_string(), json!("rpc"));
                        reply.insert("action".to_string(), json!(action));
                        match result {
                            Ok(data) => {
                                reply.insert("ok".to_string(), json!(true));
                                reply.insert("data".to_string(), data);
                            }
                            Err(err) => {
                                reply.insert("ok".to_string(), json!(false));
                                reply.insert(
                                    "error".to_string(),
                                    json!({ "code": err.code(), "message": err.message() }),
                                );
                            }
                        }
                        // Echo the client-supplied id verbatim, if any.
                        if let Some(id) = value.get("id") {
                            reply.insert("id".to_string(), id.clone());
                        }
                        SessionOutcome::replies_only(vec![Value::Object(reply).to_string()])
                    }
                    _ => SessionOutcome::replies_only(vec![error_frame(
                        "invalid_rpc",
                        "rpc message requires a non-empty string 'action'",
                    )]),
                }
            }

            Some(other) => SessionOutcome::replies_only(vec![error_frame(
                "unsupported_type",
                &format!("unsupported message type: '{other}'"),
            )]),

            None => SessionOutcome::replies_only(vec![error_frame(
                "bad_message",
                "missing 'type' field",
            )]),
        }
    }

    /// Pre-auth failure: error frame + close 1008.
    fn fail(&self, reply: &str) -> SessionOutcome {
        SessionOutcome {
            replies: vec![reply.to_string()],
            close: Some(CloseInfo {
                code: CLOSE_POLICY_VIOLATION,
                reason: "authentication failed".to_string(),
            }),
        }
    }
}

impl std::fmt::Debug for Session {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        // The expected token is deliberately never printed.
        f.debug_struct("Session")
            .field("state", &self.state)
            .field("rpc_ctx", &self.rpc_ctx)
            .field("renderer_handlers_len", &self.renderer_handlers.len())
            .finish_non_exhaustive()
    }
}

/// Typed error frame as a JSON string.
fn error_frame(code: &str, message: &str) -> String {
    json!({
        "type": "error",
        "error": { "code": code, "message": message },
    })
    .to_string()
}

/// Constant-time-ish token comparison.
///
/// Lengths are compared first (this leaks token length, which is acceptable —
/// tokens are UUIDs of known shape). Contents are compared without early
/// exit so matching prefixes don't short-circuit the scan.
fn tokens_equal(a: &str, b: &str) -> bool {
    let (a, b) = (a.as_bytes(), b.as_bytes());
    if a.len() != b.len() {
        return false;
    }
    a.iter()
        .zip(b.iter())
        .fold(0u8, |acc, (x, y)| acc | (x ^ y))
        == 0
}

fn now_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

#[cfg(test)]
mod tests {
    use super::*;

    const TOKEN: &str = "test-token-123";

    fn session() -> Session {
        Session::new(TOKEN.to_string())
    }

    fn outcome_replies(outcome: &SessionOutcome) -> Vec<serde_json::Value> {
        outcome
            .replies
            .iter()
            .map(|r| serde_json::from_str(r).unwrap())
            .collect()
    }

    #[test]
    fn simple_auth_accepts_and_replies() {
        let mut s = session();
        let out = s.handle_text(r#"{"type":"auth","authToken":"test-token-123"}"#);
        assert!(s.is_authenticated());
        assert!(out.close.is_none());
        let replies = outcome_replies(&out);
        assert_eq!(replies, vec![json!({"type":"auth","ok":true})]);
    }

    #[test]
    fn server_runtime_auth_shape_accepts() {
        let mut s = session();
        let out = s.handle_text(
            r#"{"type":"module:authenticate","data":{"token":"test-token-123","caller":"test","purpose":"test"}}"#,
        );
        assert!(s.is_authenticated());
        assert!(out.close.is_none());
        let replies = outcome_replies(&out);
        assert_eq!(
            replies,
            vec![json!({"type":"module:authenticated","data":{"authenticated":true}})]
        );
    }

    #[test]
    fn wrong_token_closes_connection() {
        let mut s = session();
        let out = s.handle_text(r#"{"type":"auth","authToken":"nope"}"#);
        assert!(!s.is_authenticated());
        assert_eq!(
            out.close,
            Some(CloseInfo {
                code: CLOSE_POLICY_VIOLATION,
                reason: "authentication failed".to_string(),
            })
        );
        let replies = outcome_replies(&out);
        assert_eq!(replies[0]["error"]["code"], "invalid_token");
    }

    #[test]
    fn non_auth_first_message_closes_connection() {
        let mut s = session();
        let out = s.handle_text(r#"{"type":"ping"}"#);
        assert_eq!(
            out.close.as_ref().map(|c| c.code),
            Some(CLOSE_POLICY_VIOLATION)
        );
        let replies = outcome_replies(&out);
        assert_eq!(replies[0]["error"]["code"], "auth_required");
    }

    #[test]
    fn invalid_json_first_message_closes_connection() {
        let mut s = session();
        let out = s.handle_text("not json at all");
        assert_eq!(
            out.close.as_ref().map(|c| c.code),
            Some(CLOSE_POLICY_VIOLATION)
        );
        assert_eq!(outcome_replies(&out)[0]["error"]["code"], "bad_message");
    }

    #[test]
    fn missing_token_field_closes_connection() {
        let mut s = session();
        let out = s.handle_text(r#"{"type":"auth"}"#);
        assert_eq!(
            out.close.as_ref().map(|c| c.code),
            Some(CLOSE_POLICY_VIOLATION)
        );
        assert_eq!(
            outcome_replies(&out)[0]["error"]["code"],
            "bad_auth_message"
        );
    }

    #[test]
    fn unauthenticated_socket_receives_nothing_else() {
        // Every pre-auth failure path must produce exactly one reply (the
        // error frame) and a close — no state, no leaks.
        let mut s = session();
        for raw in [
            r#"{"type":"rpc","action":"x"}"#,
            r#"{"type":"module:announce"}"#,
            r#"{"type":"transport:connection:heartbeat","data":{"kind":"ping"}}"#,
        ] {
            let out = s.handle_text(raw);
            assert_eq!(out.replies.len(), 1);
            assert!(out.close.is_some());
            assert!(!s.is_authenticated());
        }
    }

    #[test]
    fn ping_pong_after_auth() {
        let mut s = session();
        s.handle_text(r#"{"type":"auth","authToken":"test-token-123"}"#);
        let out = s.handle_text(r#"{"type":"ping"}"#);
        assert_eq!(out.replies, vec![r#"{"type":"pong"}"#]);
        assert!(out.close.is_none());
    }

    #[test]
    fn heartbeat_ping_echoes_pong() {
        let mut s = session();
        s.handle_text(r#"{"type":"auth","authToken":"test-token-123"}"#);
        let out = s.handle_text(
            r#"{"type":"transport:connection:heartbeat","data":{"kind":"ping","message":"🩵"}}"#,
        );
        let replies = outcome_replies(&out);
        assert_eq!(replies.len(), 1);
        assert_eq!(replies[0]["type"], "transport:connection:heartbeat");
        assert_eq!(replies[0]["data"]["kind"], "pong");
        assert_eq!(replies[0]["data"]["message"], "💛");
        assert!(replies[0]["data"]["at"].as_u64().unwrap() > 0);
    }

    #[test]
    fn heartbeat_non_ping_is_silent() {
        let mut s = session();
        s.handle_text(r#"{"type":"auth","authToken":"test-token-123"}"#);
        let out = s.handle_text(
            r#"{"type":"transport:connection:heartbeat","data":{"kind":"pong","message":"💛"}}"#,
        );
        assert!(out.replies.is_empty());
        assert!(out.close.is_none());
    }

    #[test]
    fn rpc_runtime_ping_is_dispatched_and_echoes_id() {
        let mut s = session();
        s.handle_text(r#"{"type":"auth","authToken":"test-token-123"}"#);
        let out =
            s.handle_text(r#"{"type":"rpc","action":"runtime.ping","payload":{},"id":"req-42"}"#);
        let replies = outcome_replies(&out);
        assert_eq!(replies.len(), 1);
        assert_eq!(replies[0]["type"], "rpc");
        assert_eq!(replies[0]["action"], "runtime.ping");
        assert_eq!(replies[0]["ok"], true);
        assert_eq!(replies[0]["data"]["pong"], true);
        assert_eq!(replies[0]["id"], "req-42");
        assert!(out.close.is_none());
    }

    #[test]
    fn rpc_unknown_method_is_typed_error_with_id_echo() {
        let mut s = session();
        s.handle_text(r#"{"type":"auth","authToken":"test-token-123"}"#);
        let out = s.handle_text(r#"{"type":"rpc","action":"stage.move","payload":{"x":1},"id":7}"#);
        let replies = outcome_replies(&out);
        assert_eq!(replies[0]["ok"], false);
        assert_eq!(replies[0]["error"]["code"], "rpc_unknown_method");
        assert_eq!(replies[0]["id"], 7);
        assert!(out.close.is_none());
    }

    #[test]
    fn rpc_renderer_namespace_is_not_implemented() {
        let mut s = session();
        s.handle_text(r#"{"type":"auth","authToken":"test-token-123"}"#);
        let out = s.handle_text(r#"{"type":"rpc","action":"renderer.getModels","payload":{}}"#);
        let replies = outcome_replies(&out);
        assert_eq!(replies[0]["ok"], false);
        assert_eq!(replies[0]["error"]["code"], "rpc_not_implemented");
        assert!(replies[0].get("id").is_none());
    }

    #[test]
    fn rpc_renderer_registered_handler_round_trips() {
        use crate::dispatch::RendererHandlers;
        use std::sync::Arc;
        let mut handlers = RendererHandlers::new();
        handlers.insert(
            "info".to_string(),
            Box::new(|_method: &str, _payload: &serde_json::Value| {
                Ok(serde_json::json!({ "app": "test", "n": 42 }))
            }),
        );
        let mut s = Session::with_renderer(
            TOKEN.to_string(),
            RpcContext::new("127.0.0.1", 6121),
            Arc::new(handlers),
        );
        s.handle_text(r#"{"type":"auth","authToken":"test-token-123"}"#);
        let out =
            s.handle_text(r#"{"type":"rpc","action":"renderer.info","payload":{},"id":"ri-1"}"#);
        let replies = outcome_replies(&out);
        assert_eq!(replies[0]["ok"], true);
        assert_eq!(
            replies[0]["data"],
            serde_json::json!({ "app": "test", "n": 42 })
        );
        assert_eq!(replies[0]["id"], "ri-1");
    }

    #[test]
    fn rpc_non_object_payload_is_bad_payload() {
        let mut s = session();
        s.handle_text(r#"{"type":"auth","authToken":"test-token-123"}"#);
        let out = s.handle_text(r#"{"type":"rpc","action":"runtime.ping","payload":[1,2]}"#);
        let replies = outcome_replies(&out);
        assert_eq!(replies[0]["ok"], false);
        assert_eq!(replies[0]["error"]["code"], "rpc_bad_payload");
    }

    #[test]
    fn rpc_runtime_status_reports_build_info() {
        let mut s = session();
        s.handle_text(r#"{"type":"auth","authToken":"test-token-123"}"#);
        let out = s.handle_text(r#"{"type":"rpc","action":"runtime.status"}"#);
        let replies = outcome_replies(&out);
        assert_eq!(replies[0]["ok"], true);
        assert_eq!(replies[0]["data"]["app"], "airi-slint");
        assert_eq!(replies[0]["data"]["version"], env!("CARGO_PKG_VERSION"));
        assert_eq!(replies[0]["data"]["protocol"], "airi-channel/1");
    }

    #[test]
    fn rpc_without_action_is_typed_error() {
        let mut s = session();
        s.handle_text(r#"{"type":"auth","authToken":"test-token-123"}"#);
        let out = s.handle_text(r#"{"type":"rpc","payload":null}"#);
        assert_eq!(outcome_replies(&out)[0]["error"]["code"], "invalid_rpc");
        assert!(out.close.is_none());
    }

    #[test]
    fn unknown_type_is_typed_error_and_stays_open() {
        let mut s = session();
        s.handle_text(r#"{"type":"auth","authToken":"test-token-123"}"#);
        let out = s.handle_text(r#"{"type":"spark:command","data":{}}"#);
        let replies = outcome_replies(&out);
        assert_eq!(replies[0]["error"]["code"], "unsupported_type");
        assert!(out.close.is_none());
        // Session stays usable afterwards.
        let out = s.handle_text(r#"{"type":"ping"}"#);
        assert_eq!(out.replies, vec![r#"{"type":"pong"}"#]);
    }

    #[test]
    fn malformed_json_after_auth_is_typed_error_and_stays_open() {
        let mut s = session();
        s.handle_text(r#"{"type":"auth","authToken":"test-token-123"}"#);
        let out = s.handle_text("{ broken");
        assert_eq!(outcome_replies(&out)[0]["error"]["code"], "bad_message");
        assert!(out.close.is_none());
    }

    #[test]
    fn tokens_equal_constant_time_shape() {
        assert!(tokens_equal("abc", "abc"));
        assert!(!tokens_equal("abc", "abd"));
        assert!(!tokens_equal("abc", "abcd"));
        assert!(!tokens_equal("", "a"));
    }
}
