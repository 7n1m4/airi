// SPDX-License-Identifier: GPL-3.0-or-later
#![deny(missing_docs)]

//! Registry discovery tests for [`list_registry_servers`] against a
//! [`mockito`] server. The official registry is never contacted; the
//! `base_url` parameter always points at the mock.

use airi_mcp::{list_registry_servers, McpError};

const CANNED_REGISTRY: &str = r#"{
    "servers": [
        {
            "server": {
                "name": "io.github.acme/widgets-mcp",
                "description": "Widgets for everything",
                "websiteUrl": "https://widgets.example.com",
                "version": "1.2.3",
                "repository": {"url": "https://github.com/acme/widgets-mcp"},
                "remotes": [{"type": "streamable-http", "url": "https://mcp.widgets.example.com"}]
            },
            "_meta": {"published": true}
        },
        {
            "server": {
                "name": "com.example/search-mcp",
                "description": "Search things",
                "version": "0.4.0",
                "packages": [{"registryType": "npm", "identifier": "@example/search-mcp"}]
            }
        }
    ],
    "metadata": {"nextCursor": null, "count": 2}
}"#;

#[test]
fn canned_registry_json_is_parsed_into_entries() {
    let mut server = mockito::Server::new();
    let mock = server
        .mock("GET", "/v0.1/servers")
        .match_query(mockito::Matcher::AllOf(vec![
            mockito::Matcher::UrlEncoded("version".into(), "latest".into()),
            mockito::Matcher::UrlEncoded("limit".into(), "30".into()),
            mockito::Matcher::UrlEncoded("search".into(), "widgets".into()),
        ]))
        .with_status(200)
        .with_header("content-type", "application/json")
        .with_body(CANNED_REGISTRY)
        .expect(1)
        .create();

    let entries = list_registry_servers(&format!("{}/v0.1/servers", server.url()), "widgets", 30)
        .expect("registry response parses");

    assert_eq!(entries.len(), 2);

    assert_eq!(entries[0].name, "io.github.acme/widgets-mcp");
    assert_eq!(entries[0].description, "Widgets for everything");
    assert_eq!(entries[0].url, "https://widgets.example.com");
    assert_eq!(entries[0].version.as_deref(), Some("1.2.3"));

    assert_eq!(entries[1].name, "com.example/search-mcp");
    assert_eq!(entries[1].description, "Search things");
    // No websiteUrl / repository / remotes → falls back to empty string.
    assert_eq!(entries[1].url, "");
    assert_eq!(entries[1].version.as_deref(), Some("0.4.0"));

    mock.assert();
}

#[test]
fn empty_registry_result_yields_empty_vec() {
    let mut server = mockito::Server::new();
    server
        .mock("GET", "/v0.1/servers")
        .match_query(mockito::Matcher::AllOf(vec![
            mockito::Matcher::UrlEncoded("version".into(), "latest".into()),
            mockito::Matcher::UrlEncoded("limit".into(), "5".into()),
        ]))
        .with_status(200)
        .with_header("content-type", "application/json")
        .with_body(r#"{"servers": [], "metadata": {"count": 0}}"#)
        .expect(1)
        .create();

    let entries = list_registry_servers(&format!("{}/v0.1/servers", server.url()), "", 5)
        .expect("empty registry is not an error");
    assert!(entries.is_empty());
}

#[test]
fn registry_http_error_surfaces_typed_error() {
    let mut server = mockito::Server::new();
    server
        .mock("GET", "/v0.1/servers")
        .match_query(mockito::Matcher::Any)
        .with_status(503)
        .with_body("registry unavailable")
        .expect(1)
        .create();

    match list_registry_servers(&format!("{}/v0.1/servers", server.url()), "", 10) {
        Err(McpError::HttpStatus { status, body }) => {
            assert_eq!(status, 503);
            assert_eq!(body, "registry unavailable");
        }
        other => panic!("expected McpError::HttpStatus, got {other:?}"),
    }
}

#[test]
fn registry_response_without_servers_array_surfaces_protocol_error() {
    let mut server = mockito::Server::new();
    server
        .mock("GET", "/v0.1/servers")
        .match_query(mockito::Matcher::Any)
        .with_status(200)
        .with_header("content-type", "application/json")
        .with_body(r#"{"unexpected": true}"#)
        .expect(1)
        .create();

    match list_registry_servers(&format!("{}/v0.1/servers", server.url()), "", 10) {
        Err(McpError::Protocol(message)) => {
            assert!(message.contains("servers"), "unexpected message: {message}");
        }
        other => panic!("expected McpError::Protocol, got {other:?}"),
    }
}
