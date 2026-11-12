// SPDX-License-Identifier: GPL-3.0-or-later
#![deny(missing_docs)]

//! `airi-mcp` — native Rust MCP (Model Context Protocol) client for AIRI.
//!
//! Speaks JSON-RPC 2.0 to a single MCP server over two transports:
//!
//! * **stdio** ([`McpStdioClient::spawn`]) — launches the server as a child
//!   process and wires its stdin/stdout; a background reader thread parses
//!   the newline-delimited JSON-RPC 2.0 stream and routes responses to the
//!   waiting caller by request id.
//! * **streamable HTTP** ([`McpHttpClient::connect`]) — single HTTP POST
//!   endpoint; the response is either `application/json` (one JSON-RPC
//!   response) or `text/event-stream` (SSE frames; the first JSON-RPC
//!   response whose `id` matches this client's request is used). Session
//!   management via the `Mcp-Session-Id` header on `initialize`. An optional
//!   *static* bearer token can be supplied via
//!   [`McpHttpClient::connect_with_auth`] and is then sent as
//!   `Authorization: Bearer <token>` on every request to the endpoint; the
//!   token is never logged, redacted in `Debug` and scrubbed from errors.
//!   Blocking `reqwest`, no tokio. See the module docs for the exact wire
//!   semantics, header names and scope limits (static bearer only — no
//!   OAuth, no SSE resume/reconnect, no redirects).
//!
//! Both transports share the same behaviour: `initialize()` negotiates
//! protocol version `"2024-11-05"` with empty capabilities and this crate as
//! `clientInfo`, then sends `notifications/initialized`;
//! `tools_list()` maps a `tools/list` response onto [`McpToolDescriptor`]s
//! (accepting both `inputSchema` and `input_schema`); `tools_call()` maps a
//! `tools/call` response onto [`McpToolResult`] (typed content blocks,
//! `structuredContent`, `isError`). Default per-request timeout is 5 s
//! ([`DEFAULT_REQUEST_TIMEOUT`]); [`McpError`] is a typed error enum covering
//! transport loss, HTTP status failures, SSE/protocol violations, JSON-RPC
//! error objects and timeouts.
//!
//! The crate also exposes [`list_registry_servers`], a blocking reader for
//! the official MCP Registry server list (best-effort; see the module docs
//! for the unverified response schema).
//!
//! # Not implemented
//!
//! * OAuth for HTTP MCP servers (a *static* bearer token is supported via
//!   [`McpHttpClient::connect_with_auth`]; there is no OAuth flow, no
//!   `WWW-Authenticate` handling and no token refresh).
//! * SSE resume (`Last-Event-ID`) and automatic reconnection (the SSE
//!   `retry:` field is parsed and ignored).
//! * Server-initiated requests over the HTTP transport (they are ignored).
//!   The stdio client answers them with -32601.
//! * MCP config file discovery/persistence (`mcp.json`) and the
//!   `server::tool` qualification/rewriting logic from the Electron bridge —
//!   this crate deliberately handles exactly one server per client and the
//!   bare wire tool name.
//! * Qt bridges — wiring this crate into the Qt UI is a separate lane.

mod client;
mod error;
mod http;
mod jsonrpc;
mod registry;
mod sse;
mod types;

pub use client::McpStdioClient;
pub use error::McpError;
pub use http::{McpHttpClient, ACCEPT_HEADER_VALUE, SESSION_ID_HEADER};
pub use registry::{list_registry_servers, RegistryEntry, DEFAULT_REGISTRY_BASE_URL};
pub use types::{
    McpInitializeResult, McpServerInfo, McpToolContent, McpToolDescriptor, McpToolResult,
    CLIENT_NAME, DEFAULT_REQUEST_TIMEOUT, MCP_PROTOCOL_VERSION, TOOL_NAME_SEPARATOR,
};
