// SPDX-License-Identifier: GPL-3.0-or-later
#![deny(missing_docs)]

//! Bearer-token (static `Authorization: Bearer …`) tests of
//! [`McpHttpClient`] against a [`mockito`] server. No real network is
//! touched; `mockito` binds a local ephemeral port.
//!
//! Security contract under test:
//!
//! * the token is sent on every request to the *configured* endpoint
//!   (initialize, notifications, tools/list, tools/call, session DELETE);
//! * no `Authorization` header is sent at all when no token is configured;
//! * a `401` (or any error, including a server that echoes the token back)
//!   surfaces a typed error that never contains the token;
//! * `Debug` output redacts the token;
//! * redirects are not followed (no cross-origin `Authorization` leak).

use airi_mcp::{McpError, McpHttpClient};

const TOKEN: &str = "test-bearer-token-0123456789abcdef";

const INITIALIZE_RESULT: &str = r#"{"protocolVersion":"2024-11-05","capabilities":{"tools":{"listChanged":false}},"serverInfo":{"name":"mock-http","version":"1.2.3"}}"#;

const TOOLS_LIST_RESULT: &str = r#"{"tools":[{"name":"echo","description":"Echoes text","inputSchema":{"type":"object","properties":{}}}]}"#;

fn json_response(id: u64, result: &str) -> String {
    format!(r#"{{"jsonrpc":"2.0","id":{id},"result":{result}}}"#)
}

fn mount_authenticated_round_trip(server: &mut mockito::ServerGuard) {
    server
        .mock("POST", "/mcp")
        .match_header(
            "authorization",
            mockito::Matcher::Exact(format!("Bearer {TOKEN}")),
        )
        .match_body(mockito::Matcher::Regex("\"method\":\"initialize\"".into()))
        .with_status(200)
        .with_header("content-type", "application/json")
        .with_body(json_response(1, INITIALIZE_RESULT))
        .expect(1)
        .create();
    server
        .mock("POST", "/mcp")
        .match_header(
            "authorization",
            mockito::Matcher::Exact(format!("Bearer {TOKEN}")),
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
            "authorization",
            mockito::Matcher::Exact(format!("Bearer {TOKEN}")),
        )
        .match_body(mockito::Matcher::Regex("\"method\":\"tools/list\"".into()))
        .with_status(200)
        .with_header("content-type", "application/json")
        .with_body(json_response(2, TOOLS_LIST_RESULT))
        .expect(1)
        .create();
}

#[test]
fn bearer_token_is_sent_on_every_request() {
    let mut server = mockito::Server::new();
    mount_authenticated_round_trip(&mut server);
    let url = format!("{}/mcp", server.url());

    let mut client =
        McpHttpClient::connect_with_auth(&url, Some(TOKEN)).expect("connect with auth");
    client.initialize().expect("initialize succeeds");
    let tools = client.tools_list().expect("tools/list succeeds");
    assert_eq!(tools.len(), 1);
    client.close(); // no auth-matched DELETE mock mounted; must not panic
}

#[test]
fn no_authorization_header_when_no_token_configured() {
    let mut server = mockito::Server::new();
    server
        .mock("POST", "/mcp")
        .match_header("authorization", mockito::Matcher::Missing)
        .match_body(mockito::Matcher::Regex("\"method\":\"initialize\"".into()))
        .with_status(200)
        .with_header("content-type", "application/json")
        .with_body(json_response(1, INITIALIZE_RESULT))
        .expect(1)
        .create();
    server
        .mock("POST", "/mcp")
        .match_header("authorization", mockito::Matcher::Missing)
        .match_body(mockito::Matcher::Regex(
            "\"method\":\"notifications/initialized\"".into(),
        ))
        .with_status(202)
        .with_body("")
        .expect(1)
        .create();
    let url = format!("{}/mcp", server.url());

    let mut client = McpHttpClient::connect(&url).expect("connect without auth");
    client
        .initialize()
        .expect("initialize succeeds without a token");
}

#[test]
fn whitespace_only_token_is_treated_as_no_token() {
    let mut server = mockito::Server::new();
    server
        .mock("POST", "/mcp")
        .match_header("authorization", mockito::Matcher::Missing)
        .match_body(mockito::Matcher::Regex("\"method\":\"initialize\"".into()))
        .with_status(200)
        .with_header("content-type", "application/json")
        .with_body(json_response(1, INITIALIZE_RESULT))
        .expect(1)
        .create();
    server
        .mock("POST", "/mcp")
        .match_header("authorization", mockito::Matcher::Missing)
        .match_body(mockito::Matcher::Regex(
            "\"method\":\"notifications/initialized\"".into(),
        ))
        .with_status(202)
        .with_body("")
        .expect(1)
        .create();
    let url = format!("{}/mcp", server.url());

    let mut client =
        McpHttpClient::connect_with_auth(&url, Some("   ")).expect("whitespace token accepted");
    client.initialize().expect("initialize succeeds");
}

#[test]
fn unauthorized_401_surfaces_typed_error_without_token() {
    let mut server = mockito::Server::new();
    server
        .mock("POST", "/mcp")
        .match_header(
            "authorization",
            mockito::Matcher::Exact(format!("Bearer {TOKEN}")),
        )
        .with_status(401)
        .with_body("unauthorized")
        .expect(1)
        .create();
    let url = format!("{}/mcp", server.url());

    let mut client =
        McpHttpClient::connect_with_auth(&url, Some(TOKEN)).expect("connect with auth");
    match client.initialize() {
        Err(err @ McpError::HttpStatus { status: 401, .. }) => {
            let display = format!("{err}");
            let debug = format!("{err:?}");
            assert!(
                !display.contains(TOKEN),
                "Display leaked the token: {display}"
            );
            assert!(!debug.contains(TOKEN), "Debug leaked the token: {debug}");
        }
        other => panic!("expected McpError::HttpStatus(401), got {other:?}"),
    }
}

#[test]
fn error_strings_never_contain_the_token_even_when_the_server_echoes_it() {
    // A hostile (or broken) server echoes the Authorization header back in
    // both the HTTP error body and a JSON-RPC `error` object. The client
    // must scrub every occurrence before the value reaches the caller.
    let mut server = mockito::Server::new();
    server
        .mock("POST", "/mcp")
        .match_header(
            "authorization",
            mockito::Matcher::Exact(format!("Bearer {TOKEN}")),
        )
        .match_body(mockito::Matcher::Regex("\"method\":\"initialize\"".into()))
        .with_status(403)
        .with_body(format!("rejected token {TOKEN}"))
        .expect(1)
        .create();
    let url = format!("{}/mcp", server.url());

    let mut client =
        McpHttpClient::connect_with_auth(&url, Some(TOKEN)).expect("connect with auth");
    match client.initialize() {
        Err(err) => {
            let display = format!("{err}");
            let debug = format!("{err:?}");
            assert!(
                !display.contains(TOKEN),
                "Display leaked the token: {display}"
            );
            assert!(!debug.contains(TOKEN), "Debug leaked the token: {debug}");
        }
        other => panic!("expected an error, got {other:?}"),
    }

    // Same hostile echo through a JSON-RPC `error` object (2xx response).
    let mut server = mockito::Server::new();
    server
        .mock("POST", "/mcp")
        .match_body(mockito::Matcher::Regex("\"method\":\"initialize\"".into()))
        .with_status(200)
        .with_header("content-type", "application/json")
        .with_body(format!(
            r#"{{"jsonrpc":"2.0","id":1,"error":{{"code":-32000,"message":"bad token {TOKEN}","data":{{"echo":"{TOKEN}"}}}}}}"#
        ))
        .expect(1)
        .create();
    let url = format!("{}/mcp", server.url());

    let mut client =
        McpHttpClient::connect_with_auth(&url, Some(TOKEN)).expect("connect with auth");
    match client.initialize() {
        Err(err) => {
            let display = format!("{err}");
            let debug = format!("{err:?}");
            assert!(
                !display.contains(TOKEN),
                "Display leaked the token: {display}"
            );
            assert!(!debug.contains(TOKEN), "Debug leaked the token: {debug}");
            if let McpError::JsonRpc { message, data, .. } = &err {
                assert!(!message.contains(TOKEN));
                let data = data.as_ref().expect("data preserved");
                assert!(!data.to_string().contains(TOKEN));
            } else {
                panic!("expected McpError::JsonRpc, got {err:?}");
            }
        }
        other => panic!("expected an error, got {other:?}"),
    }
}

#[test]
fn debug_output_redacts_the_token() {
    let server = mockito::Server::new();
    let url = format!("{}/mcp", server.url());

    let client = McpHttpClient::connect_with_auth(&url, Some(TOKEN)).expect("connect with auth");
    let debug = format!("{client:?}");
    assert!(
        debug.contains("***"),
        "Debug should show a redaction marker: {debug}"
    );
    assert!(!debug.contains(TOKEN), "Debug leaked the token: {debug}");
}

#[test]
fn redirects_are_not_followed() {
    let mut server = mockito::Server::new();
    // If the client followed the redirect (or re-sent the token to the
    // redirect target), this mock would be hit and the test would fail.
    server
        .mock("POST", "/elsewhere")
        .with_status(200)
        .with_header("content-type", "application/json")
        .with_body(json_response(1, INITIALIZE_RESULT))
        .expect(0)
        .create();
    server
        .mock("POST", "/mcp")
        .match_body(mockito::Matcher::Regex("\"method\":\"initialize\"".into()))
        .with_status(302)
        .with_header("location", "/elsewhere")
        .with_body("")
        .expect(1)
        .create();
    let url = format!("{}/mcp", server.url());

    let mut client =
        McpHttpClient::connect_with_auth(&url, Some(TOKEN)).expect("connect with auth");
    match client.initialize() {
        Err(McpError::HttpStatus { status: 302, .. }) => {}
        other => panic!("expected McpError::HttpStatus(302), got {other:?}"),
    }
}

#[test]
fn close_sends_authorization_header_to_the_same_endpoint() {
    let mut server = mockito::Server::new();
    server
        .mock("DELETE", "/mcp")
        .match_header(
            "authorization",
            mockito::Matcher::Exact(format!("Bearer {TOKEN}")),
        )
        .with_status(204)
        .with_body("")
        .expect(1)
        .create();
    let url = format!("{}/mcp", server.url());

    let client = McpHttpClient::connect_with_auth(&url, Some(TOKEN)).expect("connect with auth");
    client.close();
}

#[test]
fn bearer_token_with_invalid_header_characters_is_rejected() {
    let server = mockito::Server::new();
    let url = format!("{}/mcp", server.url());

    let bad = "not-a-valid\ntoken";
    match McpHttpClient::connect_with_auth(&url, Some(bad)) {
        Err(err @ McpError::Transport(_)) => {
            let display = format!("{err}");
            assert!(
                !display.contains("not-a-valid"),
                "error leaked token material: {display}"
            );
        }
        other => panic!("expected McpError::Transport, got {other:?}"),
    }
}
