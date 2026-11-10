// SPDX-License-Identifier: GPL-3.0-or-later

//! JSON-RPC 2.0 envelope helpers.
//!
//! Kept deliberately small: the stdio transport is newline-delimited JSON, so
//! each message is a single `serde_json::to_string` pass with no embedded
//! newlines.

use serde::Serialize;
use serde_json::{Map, Value};

use crate::error::McpError;

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
pub(crate) fn encode_line(value: &impl Serialize) -> Result<String, McpError> {
    let mut line = serde_json::to_string(value)
        .map_err(|e| McpError::Protocol(format!("failed to encode JSON-RPC message: {e}")))?;
    line.push('\n');
    Ok(line)
}

/// Normalises an incoming JSON-RPC id to the numeric key this client uses
/// internally for the pending-request map.
///
/// MCP allows string or numeric ids; this client only ever *sends* numeric
/// ids, but a spec-compliant server echoes them back verbatim, so both
/// numeric and numeric-looking string ids are matched.
pub(crate) fn normalize_response_id(id: &Value) -> Option<u64> {
    match id {
        Value::Number(n) => n.as_u64(),
        Value::String(s) => s.trim().parse::<u64>().ok(),
        _ => None,
    }
}

/// Maps a raw response object to either its `result` or a typed
/// [`McpError::JsonRpc`] built from the `error` member.
///
/// * `{"result": X}` → `Ok(X)` (missing `result` yields `Value::Null`).
/// * `{"error": {"code": C, "message": M, "data": D?}}` → [`McpError::JsonRpc`].
/// * Anything else → [`McpError::Protocol`].
pub(crate) fn response_to_result(response: &Value) -> Result<Value, McpError> {
    let object = response
        .as_object()
        .ok_or_else(|| McpError::Protocol("response is not a JSON object".into()))?;

    if let Some(error) = object.get("error") {
        return Err(jsonrpc_error_from(error));
    }

    Ok(object.get("result").cloned().unwrap_or(Value::Null))
}

/// Builds [`McpError::JsonRpc`] from the `error` member of a response.
pub(crate) fn jsonrpc_error_from(error: &Value) -> McpError {
    let code = error.get("code").and_then(Value::as_i64).unwrap_or(0);
    let message = error
        .get("message")
        .and_then(Value::as_str)
        .unwrap_or("unknown error")
        .to_string();
    let data = error.get("data").cloned();
    McpError::JsonRpc {
        code,
        message,
        data,
    }
}

/// Parses a `tools/list` result object. Accepts both `inputSchema` (spec,
/// camelCase) and `input_schema` as aliases, mirroring the renderer bridge
/// which consumes `inputSchema` while some servers emit snake_case.
pub(crate) fn parse_tools_list(result: &Value) -> Vec<crate::types::McpToolDescriptor> {
    let tools = result
        .get("tools")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    tools.into_iter().filter_map(parse_tool).collect()
}

fn parse_tool(tool: Value) -> Option<crate::types::McpToolDescriptor> {
    let name = tool.get("name")?.as_str()?.to_string();
    let description = tool
        .get("description")
        .and_then(Value::as_str)
        .map(str::to_string);
    let schema_value = tool
        .get("inputSchema")
        .or_else(|| tool.get("input_schema"))
        .cloned();
    let input_schema = match schema_value {
        Some(Value::Object(map)) => map,
        Some(_) => Map::new(),
        None => Map::new(),
    };
    Some(crate::types::McpToolDescriptor {
        name,
        description,
        input_schema,
    })
}

/// Parses a `tools/call` result object into an [`crate::types::McpToolResult`].
pub(crate) fn parse_tool_result(result: &Value) -> crate::types::McpToolResult {
    use crate::types::{McpToolContent, McpToolResult};

    let content = result
        .get("content")
        .and_then(Value::as_array)
        .map(|blocks| {
            blocks
                .iter()
                .map(|block| {
                    let block_type = block
                        .get("type")
                        .and_then(Value::as_str)
                        .unwrap_or("unknown");
                    if block_type == "text" {
                        McpToolContent::Text(
                            block
                                .get("text")
                                .and_then(Value::as_str)
                                .unwrap_or_default()
                                .to_string(),
                        )
                    } else {
                        McpToolContent::Other {
                            content_type: block_type.to_string(),
                            raw: block.clone(),
                        }
                    }
                })
                .collect()
        })
        .unwrap_or_default();

    let structured_content = result
        .get("structuredContent")
        .or_else(|| result.get("structured_content"))
        .filter(|v| v.is_object())
        .cloned();

    let is_error = result
        .get("isError")
        .or_else(|| result.get("is_error"))
        .and_then(Value::as_bool)
        .unwrap_or(false);

    McpToolResult {
        content,
        structured_content,
        is_error,
    }
}

/// Builds the `params` object for the `initialize` request.
pub(crate) fn initialize_params(client_name: &str, client_version: &str) -> Value {
    serde_json::json!({
        "protocolVersion": crate::types::MCP_PROTOCOL_VERSION,
        "capabilities": {},
        "clientInfo": {
            "name": client_name,
            "version": client_version,
        },
    })
}

/// Parses the `result` object of the `initialize` response.
pub(crate) fn parse_initialize_result(result: &Value) -> crate::types::McpInitializeResult {
    use crate::types::{McpInitializeResult, McpServerInfo};

    let protocol_version = result
        .get("protocolVersion")
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_string();
    let capabilities = result.get("capabilities").cloned().unwrap_or(Value::Null);
    let server_info = result.get("serverInfo").and_then(|info| {
        let name = info.get("name").and_then(Value::as_str)?;
        let version = info
            .get("version")
            .and_then(Value::as_str)
            .unwrap_or_default();
        Some(McpServerInfo {
            name: name.to_string(),
            version: version.to_string(),
        })
    });

    McpInitializeResult {
        protocol_version,
        capabilities,
        server_info,
        raw: result.clone(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn request_envelope_encodes_expected_shape() {
        let request = JsonRpcRequest::new(7, "tools/list", json!({}));
        let mut value = serde_json::to_value(&request).unwrap();
        assert_eq!(value["jsonrpc"], "2.0");
        assert_eq!(value["id"], 7);
        assert_eq!(value["method"], "tools/list");
        assert_eq!(value["params"], json!({}));
        value.as_object_mut().unwrap().clear();
        assert_eq!(value, json!({}));
    }

    #[test]
    fn notification_envelope_has_no_id() {
        let notification = JsonRpcNotification::new("notifications/initialized", json!({}));
        let value = serde_json::to_value(&notification).unwrap();
        assert_eq!(value["jsonrpc"], "2.0");
        assert_eq!(value["method"], "notifications/initialized");
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
            McpError::JsonRpc {
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
            McpError::JsonRpc {
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

    #[test]
    fn initialize_params_shape_matches_spec() {
        let params = initialize_params("airi-mcp", "0.1.0");
        assert_eq!(params["protocolVersion"], "2024-11-05");
        assert_eq!(params["capabilities"], json!({}));
        assert_eq!(params["clientInfo"]["name"], "airi-mcp");
        assert_eq!(params["clientInfo"]["version"], "0.1.0");
    }

    #[test]
    fn parse_initialize_result_extracts_fields() {
        let result = json!({
            "protocolVersion": "2024-11-05",
            "capabilities": {"tools": {"listChanged": false}},
            "serverInfo": {"name": "mock", "version": "1.2.3"}
        });
        let parsed = parse_initialize_result(&result);
        assert_eq!(parsed.protocol_version, "2024-11-05");
        assert_eq!(parsed.server_info.as_ref().unwrap().name, "mock");
        assert_eq!(parsed.server_info.unwrap().version, "1.2.3");
        assert_eq!(parsed.capabilities["tools"]["listChanged"], false);
    }

    #[test]
    fn parse_tools_list_accepts_input_schema_alias() {
        let result = json!({
            "tools": [
                {
                    "name": "echo",
                    "description": "Echoes text",
                    "inputSchema": {"type": "object", "properties": {"text": {"type": "string"}}}
                },
                {
                    "name": "sum",
                    "input_schema": {"type": "object", "properties": {}}
                },
                {
                    "name": "noschema"
                },
                {
                    "name": "badschema",
                    "inputSchema": "not-an-object"
                }
            ]
        });
        let tools = parse_tools_list(&result);
        assert_eq!(tools.len(), 4);
        assert_eq!(tools[0].name, "echo");
        assert_eq!(tools[0].description.as_deref(), Some("Echoes text"));
        assert_eq!(
            tools[0].input_schema["properties"]["text"]["type"],
            "string"
        );
        assert_eq!(tools[1].input_schema["type"], "object");
        assert_eq!(tools[1].description, None);
        assert_eq!(tools[2].input_schema, Map::new());
        assert_eq!(tools[3].input_schema, Map::new());
    }

    #[test]
    fn parse_tools_list_skips_entries_without_names() {
        let result = json!({"tools": [{"description": "no name"}, {"name": "ok"}]});
        let tools = parse_tools_list(&result);
        assert_eq!(tools.len(), 1);
        assert_eq!(tools[0].name, "ok");
    }

    #[test]
    fn parse_tools_list_defaults_to_empty() {
        assert_eq!(parse_tools_list(&json!({})), vec![]);
        assert_eq!(parse_tools_list(&json!({"tools": "nope"})), vec![]);
    }

    #[test]
    fn parse_tool_result_maps_text_blocks_and_flags() {
        let result = json!({
            "content": [
                {"type": "text", "text": "hello"},
                {"type": "image", "data": "base64=="},
                {"type": "text", "text": "world"}
            ],
            "structuredContent": {"answer": 42},
            "isError": true
        });
        let parsed = parse_tool_result(&result);
        assert_eq!(parsed.text(), "hello\nworld");
        assert_eq!(parsed.structured_content, Some(json!({"answer": 42})));
        assert!(parsed.is_error);
        assert_eq!(parsed.content.len(), 3);
    }

    #[test]
    fn parse_tool_result_defaults_for_minimal_response() {
        let parsed = parse_tool_result(&json!({}));
        assert!(parsed.content.is_empty());
        assert!(parsed.structured_content.is_none());
        assert!(!parsed.is_error);
        assert_eq!(parsed.text(), "");
    }
}
