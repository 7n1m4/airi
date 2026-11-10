// SPDX-License-Identifier: GPL-3.0-or-later
#![deny(missing_docs)]

//! `airi-mcp` — native Rust MCP (Model Context Protocol) client for AIRI.
//!
//! Ports the stdio transport of the Electron main-process implementation
//! (`apps/stage-tamagotchi/src/main/services/airi/mcp-servers/index.ts`, which
//! drives `@modelcontextprotocol/sdk`) to a std-only, synchronous client:
//!
//! * [`McpStdioClient::spawn`] launches the server as a child process and
//!   wires its stdin/stdout; a background reader thread parses the
//!   newline-delimited JSON-RPC 2.0 stream and routes responses to the
//!   waiting caller by request id.
//! * [`McpStdioClient::initialize`] sends `initialize` with protocol version
//!   `"2024-11-05"`, empty capabilities and this crate as `clientInfo`, then
//!   sends `notifications/initialized`.
//! * [`McpStdioClient::tools_list`] maps a `tools/list` response onto
//!   [`McpToolDescriptor`]s (accepting both `inputSchema` and `input_schema`).
//! * [`McpStdioClient::tools_call`] maps a `tools/call` response onto
//!   [`McpToolResult`] (typed content blocks, `structuredContent`, `isError`).
//! * Default per-request timeout is 5 s ([`DEFAULT_REQUEST_TIMEOUT`]);
//!   [`McpError`] is a typed error enum covering spawn failure, transport
//!   loss, JSON-RPC error objects, timeouts and protocol violations.
//!
//! # Not implemented (out of scope)
//!
//! * Streamable HTTP transport — requesting it yields
//!   [`McpError::UnsupportedTransport`]. It has not been ported yet.
//! * MCP config file discovery/persistence (`mcp.json`) and the
//!   `server::tool` qualification/rewriting logic from the Electron bridge —
//!   this crate deliberately handles exactly one server per client and the
//!   bare wire tool name.
//! * Qt bridges — wiring this crate into the Qt UI is a separate lane.

mod client;
mod error;
mod jsonrpc;
mod types;

pub use client::McpStdioClient;
pub use error::McpError;
pub use types::{
    McpInitializeResult, McpServerInfo, McpToolContent, McpToolDescriptor, McpToolResult,
    CLIENT_NAME, DEFAULT_REQUEST_TIMEOUT, MCP_PROTOCOL_VERSION, TOOL_NAME_SEPARATOR,
};
