// SPDX-License-Identifier: GPL-3.0-or-later

//! Rust-canonical wire types for the `airi-channel` gateway protocol
//! (D2: Rust owns the schema; TS imports the generated definitions).
//!
//! These types describe every frame the channel server speaks today. They
//! are load-bearing — [`crate::session`] serializes these instead of
//! hand-built `json!` values — and they are exported to TypeScript by the
//! `export-wire-types` example (`cargo run -p airi-channel --example export-wire-types`),
//! which writes `packages/server-shared/src/types/generated/airi-channel.ts`.
//! The generated file is checked in; CI fails if it drifts from these types
//! (`--check`).
//!
//! ## Scope
//!
//! This is the **Rust-spoken** slice of the protocol: the auth handshake,
//! ping/pong, heartbeat mirror, and the `rpc` request/reply family with the
//! stable `rpc_*` error codes. The plugin-protocol envelope
//! (`WebSocketBaseEvent` + `metadata`) used by module-protocol traffic is
//! **not** modelled here yet; when the gateway serves module-protocol events
//! the envelope becomes canonical in a follow-up slice and the generated
//! file grows with it.
//!
//! ## Field naming
//!
//! Wire names match the existing Electron/Bun gateway exactly (e.g.
//! `authToken`, `uptimeSeconds`, `sessionStartedMs`). Optional fields use
//! `skip_serializing_if = "Option::is_none"` so `None` omits the key rather
//! than emitting `null`, matching the hand-built frames this module
//! replaces.

use serde::{Deserialize, Serialize};
use serde_json::Value;

/// Wire kind of a heartbeat frame's `data.kind` field.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "lowercase")]
pub enum HeartbeatKind {
    /// Client heartbeats with kind `ping`; mirrored back as `pong`.
    Ping,
    /// Server reply to a `ping` heartbeat.
    Pong,
}

/// `data` payload of a `transport:connection:heartbeat` frame.
///
/// Client→server heartbeats carry only `kind`; server→client pongs carry
/// `kind`, `message` (the 💛 mirror) and `at` (unix millis). The fields are
/// optional so the one type covers both directions.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, specta::Type)]
pub struct HeartbeatData {
    /// `ping` or `pong`.
    pub kind: HeartbeatKind,
    /// Present on server→client pongs only: the 💛 mirror marker.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub message: Option<String>,
    /// Present on server→client pongs only: unix epoch milliseconds.
    #[serde(skip_serializing_if = "Option::is_none")]
    #[specta(type = specta_typescript::Number)]
    pub at: Option<u64>,
}

/// `data` payload of the `module:authenticate` handshake frame
/// (server-runtime mirror shape).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, specta::Type)]
pub struct ModuleAuthData {
    /// The shared gateway auth token.
    pub token: String,
}

/// `data` payload of the `module:authenticated` reply frame.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, specta::Type)]
pub struct AuthenticatedData {
    /// Always `true` on success; only success is ever sent.
    pub authenticated: bool,
}

/// The `error` object carried by `error` frames and failing `rpc` replies.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, specta::Type)]
pub struct RpcErrorObject {
    /// Stable machine-readable code (e.g. `rpc_unknown_method`,
    /// `invalid_token`). Never carries user or handler internals.
    pub code: String,
    /// Human-readable detail. For RPC failures this is a fixed or
    /// sanitized message; never stack data.
    pub message: String,
}

/// `data` payload of a `runtime.ping` reply.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, specta::Type)]
pub struct RuntimePingReply {
    /// Always `true`.
    pub pong: bool,
    /// Server unix epoch seconds at ping time.
    #[specta(type = specta_typescript::Number)]
    pub time: u64,
    /// Seconds since the gateway server started.
    #[serde(rename = "uptimeSeconds")]
    #[specta(type = specta_typescript::Number)]
    pub uptime_seconds: u64,
}

/// `data` payload of a `runtime.status` reply.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, specta::Type)]
pub struct RuntimeStatusReply {
    /// Application name (e.g. `airi-slint`).
    pub app: String,
    /// Crate version the gateway was built from.
    pub version: String,
    /// OS process id of the gateway server.
    pub pid: u32,
    /// Seconds since the gateway server started.
    #[serde(rename = "uptimeSeconds")]
    #[specta(type = specta_typescript::Number)]
    pub uptime_seconds: u64,
    /// Protocol identifier ([`crate::dispatch::PROTOCOL`]).
    pub protocol: String,
}

/// `data` payload of a `gateway.config` reply.
///
/// Never includes the auth token — the token stays server-side.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, specta::Type)]
pub struct GatewayConfigReply {
    /// Hostname or address the gateway is bound to.
    pub hostname: String,
    /// Port the gateway is listening on.
    pub port: u16,
}

/// `data` payload of a `gateway.auth` reply.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, specta::Type)]
pub struct GatewayAuthReply {
    /// Always `true` (only authenticated sessions can ask).
    pub authenticated: bool,
    /// Session start time, unix epoch milliseconds.
    #[serde(rename = "sessionStartedMs")]
    #[specta(type = specta_typescript::Number)]
    pub session_started_ms: u64,
}

/// A client→server text frame. Internally tagged on `type`, exactly as the
/// gateway has always spoken.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, specta::Type)]
#[serde(tag = "type")]
pub enum GatewayClientFrame {
    /// Simple auth shape: `{ "type": "auth", "authToken": "…" }`.
    #[serde(rename = "auth")]
    Auth {
        /// The shared gateway auth token.
        #[serde(rename = "authToken")]
        auth_token: String,
    },
    /// Server-runtime mirror shape:
    /// `{ "type": "module:authenticate", "data": { "token": "…" } }`.
    #[serde(rename = "module:authenticate")]
    ModuleAuthenticate {
        /// Handshake payload carrying the token.
        data: ModuleAuthData,
    },
    /// Liveness probe: `{ "type": "ping" }` → server replies `pong`.
    #[serde(rename = "ping")]
    Ping,
    /// Gateway heartbeat mirror. Only kind `ping` receives a reply.
    #[serde(rename = "transport:connection:heartbeat")]
    Heartbeat {
        /// Heartbeat payload; kind is `ping` on the wire from clients.
        data: HeartbeatData,
    },
    /// Typed RPC request. `id`, when present, is echoed verbatim in the
    /// reply; `payload`, when absent, is treated as `{}` by dispatch.
    #[serde(rename = "rpc")]
    Rpc {
        /// RPC method, e.g. `runtime.status` or `renderer.info`.
        action: String,
        /// Arbitrary JSON payload; must be an object (or absent) to pass
        /// dispatch validation.
        #[serde(skip_serializing_if = "Option::is_none")]
        #[specta(type = specta_typescript::Unknown)]
        payload: Option<Value>,
        /// Client-chosen echo identifier; any JSON value, verbatim.
        #[serde(skip_serializing_if = "Option::is_none")]
        #[specta(type = specta_typescript::Unknown)]
        id: Option<Value>,
    },
}

/// A server→client text frame. Internally tagged on `type`, exactly as the
/// gateway has always spoken.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, specta::Type)]
#[serde(tag = "type")]
pub enum GatewayServerFrame {
    /// Reply to the simple auth shape: `{ "type": "auth", "ok": true }`.
    /// Only success is ever sent.
    #[serde(rename = "auth")]
    Auth {
        /// Always `true` on success.
        ok: bool,
    },
    /// Reply to the server-runtime mirror auth shape.
    #[serde(rename = "module:authenticated")]
    Authenticated {
        /// Always `authenticated: true` on success.
        data: AuthenticatedData,
    },
    /// Reply to `ping`.
    #[serde(rename = "pong")]
    Pong,
    /// Heartbeat pong mirror: kind `pong`, `message` 💛, `at` unix ms.
    #[serde(rename = "transport:connection:heartbeat")]
    Heartbeat {
        /// Pong payload.
        data: HeartbeatData,
    },
    /// RPC reply frame. `ok: true` + `data` (and no `error`) on success;
    /// `ok: false` + `error` (and no `data`) on failure. A client-supplied
    /// `id` from the request is echoed verbatim.
    #[serde(rename = "rpc")]
    Rpc {
        /// RPC method this reply answers.
        action: String,
        /// `true` on success, `false` on failure.
        ok: bool,
        /// Handler result, present on success only.
        #[serde(skip_serializing_if = "Option::is_none")]
        #[specta(type = specta_typescript::Unknown)]
        data: Option<Value>,
        /// Stable code + sanitized message, present on failure only.
        #[serde(skip_serializing_if = "Option::is_none")]
        error: Option<RpcErrorObject>,
        /// Echoed from the request when the client sent one.
        #[serde(skip_serializing_if = "Option::is_none")]
        #[specta(type = specta_typescript::Unknown)]
        id: Option<Value>,
    },
    /// Typed error frame; the connection stays open (post-auth) or closes
    /// with 1008 (pre-auth).
    #[serde(rename = "error")]
    Error {
        /// Stable code + message.
        error: RpcErrorObject,
    },
}

/// Types collected for the TypeScript export. Extracted into a function so
/// the exporter example and any future drift test agree on the schema
/// without duplicating the list. `specta::Types` auto-registers transitive
/// named dependencies, so the frame roots plus the gateway control-plane
/// DTOs (`control.rs`, `config.rs`) are needed here.
pub fn type_collection() -> specta::Types {
    specta::Types::default()
        .register::<GatewayClientFrame>()
        .register::<GatewayServerFrame>()
        .register::<RuntimePingReply>()
        .register::<RuntimeStatusReply>()
        .register::<GatewayConfigReply>()
        .register::<GatewayAuthReply>()
        .register::<crate::config::ChannelConfig>()
        .register::<crate::control::GatewayControlStatus>()
        .register::<crate::control::GatewayControlApply>()
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn to_value(frame: &GatewayServerFrame) -> Value {
        serde_json::to_value(frame).unwrap()
    }

    #[test]
    fn server_frames_serialize_to_expected_wire_shapes() {
        assert_eq!(
            to_value(&GatewayServerFrame::Auth { ok: true }),
            json!({ "type": "auth", "ok": true })
        );
        assert_eq!(
            to_value(&GatewayServerFrame::Authenticated {
                data: AuthenticatedData {
                    authenticated: true
                },
            }),
            json!({ "type": "module:authenticated", "data": { "authenticated": true } })
        );
        assert_eq!(
            to_value(&GatewayServerFrame::Pong),
            json!({ "type": "pong" })
        );
        assert_eq!(
            to_value(&GatewayServerFrame::Heartbeat {
                data: HeartbeatData {
                    kind: HeartbeatKind::Pong,
                    message: Some("💛".to_string()),
                    at: Some(42),
                },
            }),
            json!({ "type": "transport:connection:heartbeat", "data": { "kind": "pong", "message": "💛", "at": 42 } })
        );
        assert_eq!(
            to_value(&GatewayServerFrame::Rpc {
                action: "runtime.ping".to_string(),
                ok: true,
                data: Some(json!({ "pong": true })),
                error: None,
                id: Some(json!("abc")),
            }),
            json!({ "type": "rpc", "action": "runtime.ping", "ok": true, "data": { "pong": true }, "id": "abc" })
        );
        assert_eq!(
            to_value(&GatewayServerFrame::Rpc {
                action: "renderer.nope".to_string(),
                ok: false,
                data: None,
                error: Some(RpcErrorObject {
                    code: "rpc_not_implemented".to_string(),
                    message: "no handler".to_string(),
                }),
                id: None,
            }),
            json!({ "type": "rpc", "action": "renderer.nope", "ok": false,
                    "error": { "code": "rpc_not_implemented", "message": "no handler" } })
        );
        assert_eq!(
            to_value(&GatewayServerFrame::Error {
                error: RpcErrorObject {
                    code: "invalid_token".to_string(),
                    message: "invalid token".to_string(),
                },
            }),
            json!({ "type": "error", "error": { "code": "invalid_token", "message": "invalid token" } })
        );
    }

    #[test]
    fn client_frames_deserialize_from_expected_wire_shapes() {
        let auth: GatewayClientFrame =
            serde_json::from_str(r#"{"type":"auth","authToken":"tok"}"#).unwrap();
        assert!(matches!(auth, GatewayClientFrame::Auth { ref auth_token } if auth_token == "tok"));

        let module_auth: GatewayClientFrame =
            serde_json::from_str(r#"{"type":"module:authenticate","data":{"token":"tok"}}"#)
                .unwrap();
        assert!(matches!(
            module_auth,
            GatewayClientFrame::ModuleAuthenticate { ref data } if data.token == "tok"
        ));

        let ping: GatewayClientFrame = serde_json::from_str(r#"{"type":"ping"}"#).unwrap();
        assert!(matches!(ping, GatewayClientFrame::Ping));

        let heartbeat: GatewayClientFrame = serde_json::from_str(
            r#"{"type":"transport:connection:heartbeat","data":{"kind":"ping"}}"#,
        )
        .unwrap();
        assert!(matches!(
            heartbeat,
            GatewayClientFrame::Heartbeat { ref data } if data.kind == HeartbeatKind::Ping
        ));

        let rpc: GatewayClientFrame =
            serde_json::from_str(r#"{"type":"rpc","action":"runtime.ping","payload":{},"id":7}"#)
                .unwrap();
        assert!(matches!(
            rpc,
            GatewayClientFrame::Rpc { ref action, ref id, .. }
                if action == "runtime.ping" && id.as_ref() == Some(&json!(7))
        ));
    }

    #[test]
    fn optional_fields_omit_when_none() {
        let value = serde_json::to_value(GatewayServerFrame::Rpc {
            action: "a".to_string(),
            ok: false,
            data: None,
            error: Some(RpcErrorObject {
                code: "c".to_string(),
                message: "m".to_string(),
            }),
            id: None,
        })
        .unwrap();
        assert!(value.get("id").is_none());
        assert!(value.get("data").is_none());

        let value = serde_json::to_value(HeartbeatData {
            kind: HeartbeatKind::Ping,
            message: None,
            at: None,
        })
        .unwrap();
        assert_eq!(value, json!({ "kind": "ping" }));
    }

    #[test]
    fn rpc_reply_payloads_match_dispatch() {
        assert_eq!(
            serde_json::to_value(RuntimePingReply {
                pong: true,
                time: 1,
                uptime_seconds: 2
            })
            .unwrap(),
            json!({ "pong": true, "time": 1, "uptimeSeconds": 2 })
        );
        assert_eq!(
            serde_json::to_value(RuntimeStatusReply {
                app: "airi-slint".to_string(),
                version: "0.1.0".to_string(),
                pid: 99,
                uptime_seconds: 7,
                protocol: "airi-channel/1".to_string(),
            })
            .unwrap(),
            json!({ "app": "airi-slint", "version": "0.1.0", "pid": 99, "uptimeSeconds": 7, "protocol": "airi-channel/1" })
        );
        assert_eq!(
            serde_json::to_value(GatewayConfigReply {
                hostname: "127.0.0.1".to_string(),
                port: 6121
            })
            .unwrap(),
            json!({ "hostname": "127.0.0.1", "port": 6121 })
        );
        assert_eq!(
            serde_json::to_value(GatewayAuthReply {
                authenticated: true,
                session_started_ms: 5
            })
            .unwrap(),
            json!({ "authenticated": true, "sessionStartedMs": 5 })
        );
    }
}
