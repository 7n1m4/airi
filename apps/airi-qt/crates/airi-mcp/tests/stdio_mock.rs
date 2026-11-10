// SPDX-License-Identifier: GPL-3.0-or-later
#![deny(missing_docs)]

//! End-to-end round-trip test of [`McpStdioClient`] against a mock MCP stdio
//! server implemented in python3 (`python3 -c '<script>'`).
//!
//! If python3 is not available the test prints a note and returns without
//! failing the suite.

use std::process::Command;

use airi_mcp::{McpError, McpStdioClient, McpToolContent};

const MOCK_SERVER: &str = r#"
import json, os, sys

def send(obj):
    sys.stdout.write(json.dumps(obj) + "\n")
    sys.stdout.flush()

for raw in sys.stdin:
    line = raw.strip()
    if not line:
        continue
    try:
        msg = json.loads(line)
    except Exception:
        continue
    method = msg.get("method")
    if method == "initialize":
        send({"jsonrpc": "2.0", "id": msg["id"], "result": {
            "protocolVersion": "2024-11-05",
            "capabilities": {"tools": {"listChanged": False}},
            "serverInfo": {"name": "airi-mock", "version": "0.1.0"},
        }})
    elif method == "notifications/initialized":
        pass
    elif method == "tools/list":
        send({"jsonrpc": "2.0", "id": msg["id"], "result": {"tools": [
            {"name": "echo", "description": "Echoes arguments",
             "inputSchema": {"type": "object", "properties": {"text": {"type": "string"}}, "required": ["text"]}},
            {"name": "sum", "description": "Adds numbers",
             "input_schema": {"type": "object", "properties": {"a": {"type": "number"}, "b": {"type": "number"}}}},
        ]}})
    elif method == "tools/call":
        params = msg.get("params") or {}
        name = params.get("name")
        args = params.get("arguments") or {}
        if name == "__boom__":
            send({"jsonrpc": "2.0", "id": msg["id"], "error": {"code": -32000, "message": "boom", "data": {"why": "testing"}}})
        elif name == "env_report":
            send({"jsonrpc": "2.0", "id": msg["id"], "result": {
                "content": [{"type": "text", "text": "env:" + os.environ.get("AIRI_MCP_TEST", "unset")}],
                "isError": False,
            }})
        else:
            send({"jsonrpc": "2.0", "id": msg["id"], "result": {
                "content": [{"type": "text", "text": "echo:" + json.dumps(args, sort_keys=True)}],
                "structuredContent": {"echo": args},
                "isError": False,
            }})
    elif "id" in msg:
        send({"jsonrpc": "2.0", "id": msg["id"], "error": {"code": -32601, "message": "Method not found"}})
"#;

fn python3_available() -> bool {
    Command::new("python3")
        .arg("--version")
        .output()
        .map(|o| o.status.success())
        .unwrap_or(false)
}

#[test]
fn handshake_tools_list_and_call_roundtrip() {
    if !python3_available() {
        eprintln!("python3 not available; skipping MCP stdio round-trip test");
        return;
    }

    let env = [(String::from("AIRI_MCP_TEST"), String::from("1"))];
    let mut client = McpStdioClient::spawn("python3", &["-c", MOCK_SERVER], Some(&env))
        .expect("spawn mock server");

    // Handshake completes.
    let init = client.initialize().expect("initialize");
    assert_eq!(init.protocol_version, "2024-11-05");
    let server_info = init.server_info.expect("serverInfo present");
    assert_eq!(server_info.name, "airi-mock");
    assert_eq!(init.capabilities["tools"]["listChanged"], false);

    // tools/list parses both inputSchema (echo) and input_schema (sum).
    let tools = client.tools_list().expect("tools/list");
    assert_eq!(tools.len(), 2);
    assert_eq!(tools[0].name, "echo");
    assert_eq!(tools[0].description.as_deref(), Some("Echoes arguments"));
    assert_eq!(
        tools[0].input_schema["properties"]["text"]["type"],
        "string"
    );
    assert_eq!(tools[0].input_schema["required"][0], "text");
    assert_eq!(tools[1].name, "sum");
    assert_eq!(tools[1].input_schema["properties"]["a"]["type"], "number");

    // tools/call round-trips arguments and returns structured content.
    let result = client
        .tools_call("echo", serde_json::json!({"text": "hello"}))
        .expect("tools/call");
    assert_eq!(result.text(), r#"echo:{"text": "hello"}"#);
    assert!(matches!(&result.content[0], McpToolContent::Text(t) if t.contains("hello")));
    assert_eq!(
        result.structured_content.as_ref().unwrap()["echo"]["text"],
        "hello"
    );
    assert!(!result.is_error);

    // Environment passed through to the child.
    let env_result = client
        .tools_call("env_report", serde_json::json!({}))
        .expect("tools/call env_report");
    assert_eq!(env_result.text(), "env:1");

    // A JSON-RPC error object from the server maps to a typed error.
    match client.tools_call("__boom__", serde_json::json!({})) {
        Err(McpError::JsonRpc {
            code,
            message,
            data,
        }) => {
            assert_eq!(code, -32000);
            assert_eq!(message, "boom");
            assert_eq!(data.unwrap()["why"], "testing");
        }
        other => panic!("expected JsonRpc error, got {other:?}"),
    }

    // close() kills the child; the client reports itself closed.
    let pid = client.pid();
    assert!(pid.is_some());
    client.close();
}

#[test]
fn spawn_failure_is_a_typed_error() {
    // Use a command that almost certainly does not exist.
    let err = McpStdioClient::spawn("airi-mcp-definitely-not-a-real-binary-7f3a9d", &[], None)
        .err()
        .expect("spawn must fail");
    assert!(
        matches!(err, McpError::Spawn(_)),
        "expected Spawn, got {err:?}"
    );
}
