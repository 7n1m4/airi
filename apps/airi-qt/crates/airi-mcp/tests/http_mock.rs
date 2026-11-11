// SPDX-License-Identifier: GPL-3.0-or-later
#![deny(missing_docs)]

//! End-to-end round-trip tests of [`McpHttpClient`] against a [`mockito`]
//! server. No real network is touched; `mockito` binds a local ephemeral
//! port.

use airi_mcp::{McpError, McpHttpClient, McpToolContent};

const INITIALIZE_RESULT: &str = r#"{"protocolVersion":"2024-11-05","capabilities":{"tools":{"listChanged":false}},"serverInfo":{"name":"mock-http","version":"1.2.3"}}"#;

const TOOLS_LIST_RESULT: &str = r#"{"tools":[{"name":"echo","description":"Echoes text","inputSchema":{"type":"object","properties":{"text":{"type":"string"}}}}]}"#;

const TOOLS_CALL_RESULT: &str = r#"{"content":[{"type":"text","text":"echo:hi"}],"structuredContent":{"echo":"hi"},"isError":false}"#;

fn json_response(id: u64, result: &str) -> String {
    format!(r#"{{"jsonrpc":"2.0","id":{id},"result":{result}}}"#)
}

fn sse_body(payloads: &[&str]) -> String {
    let mut out = String::new();
    for payload in payloads {
        out.push_str("data: ");
        out.push_str(payload);
        out.push_str("\n\n");
    }
    out
}

fn mount_json_round_trip(server: &mut mockito::ServerGuard) {
    server
        .mock("POST", "/mcp")
        .match_header(
            "content-type",
            mockito::Matcher::Exact("application/json".into()),
        )
        .match_header(
            "accept",
            mockito::Matcher::Exact("application/json, text/event-stream".into()),
        )
        .match_body(mockito::Matcher::Regex("\"method\":\"initialize\"".into()))
        .with_status(200)
        .with_header("content-type", "application/json")
        .with_header("mcp-session-id", "session-abc-123")
        .with_body(json_response(1, INITIALIZE_RESULT))
        .expect(1)
        .create();
    server
        .mock("POST", "/mcp")
        .match_header(
            "mcp-session-id",
            mockito::Matcher::Exact("session-abc-123".into()),
        )
        .match_body(mockito::Matcher::Regex(
            "\"method\":\"notifications/initialized\"".into(),
        ))
        .with_status(202)
        .with_body("")
        .expect(1)
        .create();
    server
        .mock("POST", "/mcp")
        .match_header(
            "mcp-session-id",
            mockito::Matcher::Exact("session-abc-123".into()),
        )
        .match_body(mockito::Matcher::Regex("\"method\":\"tools/list\"".into()))
        .with_status(200)
        .with_header("content-type", "application/json")
        .with_body(json_response(2, TOOLS_LIST_RESULT))
        .expect(1)
        .create();
    server
        .mock("POST", "/mcp")
        .match_header(
            "mcp-session-id",
            mockito::Matcher::Exact("session-abc-123".into()),
        )
        .match_body(mockito::Matcher::Regex("\"method\":\"tools/call\"".into()))
        .with_status(200)
        .with_header("content-type", "application/json")
        .with_body(json_response(3, TOOLS_CALL_RESULT))
        .expect(1)
        .create();
}

#[test]
fn json_round_trip_initializes_lists_and_calls_tools() {
    let mut server = mockito::Server::new();
    mount_json_round_trip(&mut server);
    let url = format!("{}/mcp", server.url());

    let mut client = McpHttpClient::connect(&url).expect("connect builds client");
    assert_eq!(client.session_id(), None);

    let init = client.initialize().expect("initialize succeeds");
    assert_eq!(init.protocol_version, "2024-11-05");
    assert_eq!(init.server_info.as_ref().unwrap().name, "mock-http");
    assert_eq!(client.session_id().as_deref(), Some("session-abc-123"));

    let tools = client.tools_list().expect("tools/list succeeds");
    assert_eq!(tools.len(), 1);
    assert_eq!(tools[0].name, "echo");
    assert_eq!(
        tools[0].input_schema["properties"]["text"]["type"],
        "string"
    );

    let result = client
        .tools_call("echo", serde_json::json!({"text": "hi"}))
        .expect("tools/call succeeds");
    assert!(!result.is_error);
    assert_eq!(result.text(), "echo:hi");
    assert_eq!(
        result.structured_content,
        Some(serde_json::json!({"echo": "hi"}))
    );

    client.close(); // best-effort DELETE; no mock mounted, any status tolerated
}

fn mount_sse_round_trip(server: &mut mockito::ServerGuard) {
    let initialize_frame = format!(r#"{{"jsonrpc":"2.0","id":1,"result":{INITIALIZE_RESULT}}}"#);
    server
        .mock("POST", "/mcp")
        .match_body(mockito::Matcher::Regex("\"method\":\"initialize\"".into()))
        .with_status(200)
        .with_header("content-type", "text/event-stream")
        .with_header("mcp-session-id", "sse-session-9")
        .with_body(format!(
            ": keep-alive\n\n{body}",
            body = sse_body(&[&initialize_frame])
        ))
        .expect(1)
        .create();
    server
        .mock("POST", "/mcp")
        .match_body(mockito::Matcher::Regex(
            "\"method\":\"notifications/initialized\"".into(),
        ))
        .with_status(202)
        .with_body("")
        .expect(1)
        .create();
    let list_frame = format!(r#"{{"jsonrpc":"2.0","id":2,"result":{TOOLS_LIST_RESULT}}}"#);
    server
        .mock("POST", "/mcp")
        .match_header("mcp-session-id", mockito::Matcher::Exact("sse-session-9".into()))
        .match_body(mockito::Matcher::Regex("\"method\":\"tools/list\"".into()))
        .with_status(200)
        .with_header("content-type", "text/event-stream")
        .with_body(sse_body(&[
            r#"{"jsonrpc":"2.0","method":"notifications/progress","params":{"progress":50,"total":100}}"#,
            &list_frame,
        ]))
        .expect(1)
        .create();
    // tools/call response split across two `data:` lines to exercise the
    // multi-line data accumulation rule (joined with '\n', valid JSON).
    let call_frame_part1 = r#"{"jsonrpc":"2.0","id":3,"result":"#;
    let call_frame_part2 = format!(r#"{TOOLS_CALL_RESULT}}}"#);
    server
        .mock("POST", "/mcp")
        .match_header(
            "mcp-session-id",
            mockito::Matcher::Exact("sse-session-9".into()),
        )
        .match_body(mockito::Matcher::Regex("\"method\":\"tools/call\"".into()))
        .with_status(200)
        .with_header("content-type", "text/event-stream")
        .with_body(format!(
            "event: message\ndata: {call_frame_part1}\ndata: {call_frame_part2}\n\n"
        ))
        .expect(1)
        .create();
}

#[test]
fn sse_round_trip_initializes_lists_and_calls_tools() {
    let mut server = mockito::Server::new();
    mount_sse_round_trip(&mut server);
    let url = format!("{}/mcp", server.url());

    let mut client = McpHttpClient::connect(&url).expect("connect builds client");

    let init = client.initialize().expect("initialize succeeds over SSE");
    assert_eq!(init.protocol_version, "2024-11-05");
    assert_eq!(init.server_info.as_ref().unwrap().name, "mock-http");
    assert_eq!(client.session_id().as_deref(), Some("sse-session-9"));

    let tools = client.tools_list().expect("tools/list succeeds over SSE");
    assert_eq!(tools.len(), 1);
    assert_eq!(tools[0].name, "echo");

    let result = client
        .tools_call("echo", serde_json::json!({"text": "hi"}))
        .expect("tools/call succeeds over SSE (multi-line data)");
    assert!(!result.is_error);
    assert_eq!(result.text(), "echo:hi");

    client.close();
}

#[test]
fn initialize_missing_session_id_proceeds_without_header() {
    let mut server = mockito::Server::new();
    server
        .mock("POST", "/mcp")
        .match_body(mockito::Matcher::Regex("\"method\":\"initialize\"".into()))
        .with_status(200)
        .with_header("content-type", "application/json")
        // deliberately no mcp-session-id header
        .with_body(json_response(1, INITIALIZE_RESULT))
        .expect(1)
        .create();
    server
        .mock("POST", "/mcp")
        .match_body(mockito::Matcher::Regex(
            "\"method\":\"notifications/initialized\"".into(),
        ))
        .match_header("mcp-session-id", mockito::Matcher::Missing)
        .with_status(202)
        .with_body("")
        .expect(1)
        .create();
    server
        .mock("POST", "/mcp")
        .match_body(mockito::Matcher::Regex("\"method\":\"tools/list\"".into()))
        .match_header("mcp-session-id", mockito::Matcher::Missing)
        .with_status(200)
        .with_header("content-type", "application/json")
        .with_body(json_response(2, TOOLS_LIST_RESULT))
        .expect(1)
        .create();
    let url = format!("{}/mcp", server.url());

    let mut client = McpHttpClient::connect(&url).expect("connect builds client");
    client.initialize().expect("initialize succeeds");
    assert_eq!(client.session_id(), None);

    let tools = client
        .tools_list()
        .expect("tools/list proceeds without session header");
    assert_eq!(tools.len(), 1);
}

#[test]
fn http_500_surfaces_typed_error() {
    let mut server = mockito::Server::new();
    server
        .mock("POST", "/mcp")
        .match_body(mockito::Matcher::Regex("\"method\":\"initialize\"".into()))
        .with_status(500)
        .with_body("upstream exploded")
        .expect(1)
        .create();
    let url = format!("{}/mcp", server.url());

    let mut client = McpHttpClient::connect(&url).expect("connect builds client");
    match client.initialize() {
        Err(McpError::HttpStatus { status, body }) => {
            assert_eq!(status, 500);
            assert_eq!(body, "upstream exploded");
        }
        other => panic!("expected McpError::HttpStatus, got {other:?}"),
    }
}

#[test]
fn malformed_sse_surfaces_typed_error() {
    let mut server = mockito::Server::new();
    server
        .mock("POST", "/mcp")
        .match_body(mockito::Matcher::Regex("\"method\":\"initialize\"".into()))
        .with_status(200)
        .with_header("content-type", "text/event-stream")
        .with_body("data: {not valid json\n\n")
        .expect(1)
        .create();
    let url = format!("{}/mcp", server.url());

    let mut client = McpHttpClient::connect(&url).expect("connect builds client");
    match client.initialize() {
        Err(McpError::Sse(message)) => {
            assert!(
                message.contains("not valid JSON"),
                "unexpected message: {message}"
            );
        }
        other => panic!("expected McpError::Sse, got {other:?}"),
    }
}

#[test]
fn sse_stream_without_response_frame_surfaces_typed_error() {
    let mut server = mockito::Server::new();
    server
        .mock("POST", "/mcp")
        .match_body(mockito::Matcher::Regex("\"method\":\"initialize\"".into()))
        .with_status(200)
        .with_header("content-type", "text/event-stream")
        .with_body(sse_body(&[
            r#"{"jsonrpc":"2.0","method":"notifications/progress","params":{"progress":1}}"#,
        ]))
        .expect(1)
        .create();
    let url = format!("{}/mcp", server.url());

    let mut client = McpHttpClient::connect(&url).expect("connect builds client");
    assert!(matches!(client.initialize(), Err(McpError::Sse(_))));
}

#[test]
fn tools_call_is_error_surfaces_via_result_semantics() {
    let mut server = mockito::Server::new();
    server
        .mock("POST", "/mcp")
        .match_body(mockito::Matcher::Regex("\"method\":\"initialize\"".into()))
        .with_status(200)
        .with_header("content-type", "application/json")
        .with_body(json_response(1, INITIALIZE_RESULT))
        .expect(1)
        .create();
    server
        .mock("POST", "/mcp")
        .with_status(202)
        .with_body("")
        .match_body(mockito::Matcher::Regex(
            "\"method\":\"notifications/initialized\"".into(),
        ))
        .expect(1)
        .create();
    server
        .mock("POST", "/mcp")
        .match_body(mockito::Matcher::Regex("\"method\":\"tools/call\"".into()))
        .with_status(200)
        .with_header("content-type", "application/json")
        .with_body(json_response(
            2,
            r#"{"content":[{"type":"text","text":"tool exploded"}],"isError":true}"#,
        ))
        .expect(1)
        .create();
    let url = format!("{}/mcp", server.url());

    let mut client = McpHttpClient::connect(&url).expect("connect builds client");
    client.initialize().expect("initialize succeeds");

    let result = client
        .tools_call("__boom__", serde_json::json!({}))
        .expect("isError is not a transport failure");
    assert!(result.is_error);
    assert_eq!(
        result.content,
        vec![McpToolContent::Text("tool exploded".to_string())]
    );
}

#[test]
fn non_success_on_tools_call_surfaces_typed_error() {
    let mut server = mockito::Server::new();
    server
        .mock("POST", "/mcp")
        .match_body(mockito::Matcher::Regex("\"method\":\"initialize\"".into()))
        .with_status(200)
        .with_header("content-type", "application/json")
        .with_body(json_response(1, INITIALIZE_RESULT))
        .expect(1)
        .create();
    server
        .mock("POST", "/mcp")
        .match_body(mockito::Matcher::Regex(
            "\"method\":\"notifications/initialized\"".into(),
        ))
        .with_status(202)
        .with_body("")
        .expect(1)
        .create();
    server
        .mock("POST", "/mcp")
        .match_body(mockito::Matcher::Regex("\"method\":\"tools/call\"".into()))
        .with_status(404)
        .with_body("session expired")
        .expect(1)
        .create();
    let url = format!("{}/mcp", server.url());

    let mut client = McpHttpClient::connect(&url).expect("connect builds client");
    client.initialize().expect("initialize succeeds");

    match client.tools_call("echo", serde_json::json!({})) {
        Err(McpError::HttpStatus { status: 404, .. }) => {}
        other => panic!("expected McpError::HttpStatus(404), got {other:?}"),
    }
}

#[test]
fn connect_rejects_invalid_urls() {
    assert!(matches!(
        McpHttpClient::connect("not a url"),
        Err(McpError::Transport(_))
    ));
    assert!(matches!(
        McpHttpClient::connect("ftp://example.com/mcp"),
        Err(McpError::Transport(_))
    ));
}
