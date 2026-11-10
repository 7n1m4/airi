// SPDX-License-Identifier: GPL-3.0-or-later

//! JSON-RPC 2.0 envelope helpers.
//!
//! Kept deliberately small: the stdio transport is newline-delimited JSON, so
//! each message is a single `serde_json::to_string` pass with no embedded
//! newlines.

use serde::Serialize;
use serde_json::Value;

use crate::error::AcpError;

/// A JSON-RPC 2.0 request with an id. Serialises as
/// `{"jsonrpc":"2.0","id":N,"method":M,"params":P}`.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub(crate) struct JsonRpcRequest<'a> {
    pub(crate) jsonrpc: &'a str,
    pub(crate) id: u64,
    pub(crate) method: &'a str,
    pub(crate) params: Value,
}

impl<'a> JsonRpcRequest<'a> {
    pub(crate) fn new(id: u64, method: &'a str, params: Value) -> Self {
        Self {
            jsonrpc: "2.0",
            id,
            method,
            params,
        }
    }
}

/// A JSON-RPC 2.0 notification (no id, no response expected). Serialises as
/// `{"jsonrpc":"2.0","method":M,"params":P}`.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub(crate) struct JsonRpcNotification<'a> {
    pub(crate) jsonrpc: &'a str,
    pub(crate) method: &'a str,
    pub(crate) params: Value,
}

impl<'a> JsonRpcNotification<'a> {
    pub(crate) fn new(method: &'a str, params: Value) -> Self {
        Self {
            jsonrpc: "2.0",
            method,
            params,
        }
    }
}

/// Serialises a JSON-RPC message to a single newline-terminated line.
pub(crate) fn encode_line(value: &impl Serialize) -> Result<String, AcpError> {
    let mut line = serde_json::to_string(value)
        .map_err(|e| AcpError::Protocol(format!("failed to encode JSON-RPC message: {e}")))?;
    line.push('\n');
    Ok(line)
}

/// Normalises an incoming JSON-RPC id to the numeric key this client uses
/// internally for the pending-request map.
///
/// ACP allows string or numeric ids; this client only ever *sends* numeric
/// ids, but a spec-compliant agent echoes them back verbatim, so both
/// numeric and numeric-looking string ids are matched.
pub(crate) fn normalize_response_id(id: &Value) -> Option<u64> {
    match id {
        Value::Number(n) => n.as_u64(),
        Value::String(s) => s.trim().parse::<u64>().ok(),
        _ => None,
    }
}

/// Maps a raw response object to either its `result` or a typed
/// [`AcpError::JsonRpc`] built from the `error` member.
pub(crate) fn response_to_result(response: &Value) -> Result<Value, AcpError> {
    let object = response
        .as_object()
        .ok_or_else(|| AcpError::Protocol("response is not a JSON object".into()))?;

    if let Some(error) = object.get("error") {
        return Err(jsonrpc_error_from(error));
    }

    Ok(object.get("result").cloned().unwrap_or(Value::Null))
}

/// Builds [`AcpError::JsonRpc`] from the `error` member of a response.
pub(crate) fn jsonrpc_error_from(error: &Value) -> AcpError {
    let code = error.get("code").and_then(Value::as_i64).unwrap_or(0);
    let message = error
        .get("message")
        .and_then(Value::as_str)
        .unwrap_or("unknown error")
        .to_string();
    let data = error.get("data").cloned();
    AcpError::JsonRpc {
        code,
        message,
        data,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn request_envelope_encodes_expected_shape() {
        let request = JsonRpcRequest::new(7, "session/new", json!({"cwd": "/tmp"}));
        let value = serde_json::to_value(&request).unwrap();
        assert_eq!(value["jsonrpc"], "2.0");
        assert_eq!(value["id"], 7);
        assert_eq!(value["method"], "session/new");
        assert_eq!(value["params"]["cwd"], "/tmp");
    }

    #[test]
    fn notification_envelope_has_no_id() {
        let notification = JsonRpcNotification::new("session/cancel", json!({"sessionId": "s"}));
        let value = serde_json::to_value(&notification).unwrap();
        assert_eq!(value["jsonrpc"], "2.0");
        assert_eq!(value["method"], "session/cancel");
        assert!(value.get("id").is_none());
    }

    #[test]
    fn encode_line_terminates_with_newline_and_is_single_line() {
        let line = encode_line(&JsonRpcRequest::new(1, "ping", json!({"x": "a\nb"}))).unwrap();
        assert!(line.ends_with('\n'));
        assert_eq!(line.matches('\n').count(), 1);
    }

    #[test]
    fn response_id_normalization_accepts_numbers_and_numeric_strings() {
        assert_eq!(normalize_response_id(&json!(42)), Some(42));
        assert_eq!(normalize_response_id(&json!("42")), Some(42));
        assert_eq!(normalize_response_id(&json!(" 42 ")), Some(42));
        assert_eq!(normalize_response_id(&json!("abc")), None);
        assert_eq!(normalize_response_id(&json!(true)), None);
    }

    #[test]
    fn response_to_result_returns_result_payload() {
        let response = json!({"jsonrpc": "2.0", "id": 1, "result": {"ok": true}});
        assert_eq!(response_to_result(&response).unwrap(), json!({"ok": true}));
    }

    #[test]
    fn response_to_result_defaults_missing_result_to_null() {
        let response = json!({"jsonrpc": "2.0", "id": 1});
        assert_eq!(response_to_result(&response).unwrap(), Value::Null);
    }

    #[test]
    fn response_to_result_maps_error_object() {
        let response = json!({
            "jsonrpc": "2.0",
            "id": 9,
            "error": {"code": -32601, "message": "Method not found", "data": {"detail": "nope"}}
        });
        match response_to_result(&response).unwrap_err() {
            AcpError::JsonRpc {
                code,
                message,
                data,
            } => {
                assert_eq!(code, -32601);
                assert_eq!(message, "Method not found");
                assert_eq!(data, Some(json!({"detail": "nope"})));
            }
            other => panic!("expected JsonRpc error, got {other:?}"),
        }
    }

    #[test]
    fn jsonrpc_error_from_tolerates_missing_fields() {
        match jsonrpc_error_from(&json!({})) {
            AcpError::JsonRpc {
                code,
                message,
                data,
            } => {
                assert_eq!(code, 0);
                assert_eq!(message, "unknown error");
                assert!(data.is_none());
            }
            other => panic!("expected JsonRpc error, got {other:?}"),
        }
    }
}
