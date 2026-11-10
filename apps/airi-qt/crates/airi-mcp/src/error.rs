// SPDX-License-Identifier: GPL-3.0-or-later

//! Error type for the MCP client.

use std::time::Duration;

use thiserror::Error;

/// Errors returned by [`crate::McpStdioClient`].
#[derive(Debug, Error)]
pub enum McpError {
    /// The MCP server process could not be spawned (missing binary, permission
    /// denied, …). The inner error is the OS spawn failure.
    #[error("failed to spawn MCP stdio server: {0}")]
    Spawn(#[source] std::io::Error),

    /// An I/O failure while writing to the server's stdin or while the
    /// background reader thread was draining the server's stdout/stderr.
    #[error("MCP transport error: {0}")]
    Transport(String),

    /// The server closed the connection (stdout hit EOF) or died while a
    /// request was in flight. All pending requests are resolved with this
    /// error instead of blocking until the timeout.
    #[error("MCP transport closed: the server closed its output stream or exited")]
    Closed,

    /// The server answered a request with a JSON-RPC 2.0 error object.
    #[error("JSON-RPC error {code}: {message}")]
    JsonRpc {
        /// Server-supplied error code (e.g. `-32601` method not found).
        code: i64,
        /// Server-supplied error message.
        message: String,
        /// Optional server-supplied error data, preserved verbatim.
        data: Option<serde_json::Value>,
    },

    /// No response arrived within the configured timeout (5 s by default).
    #[error("timed out after {timeout:?} waiting for response to `{method}`")]
    Timeout {
        /// The JSON-RPC method that timed out.
        method: String,
        /// The timeout that was exceeded.
        timeout: Duration,
    },

    /// The peer sent something that is valid JSON but not valid for the
    /// JSON-RPC 2.0 / MCP protocol as used by this client (e.g. an error
    /// response whose `error` object is missing `code`).
    #[error("MCP protocol violation: {0}")]
    Protocol(String),

    /// A transport this crate does not implement was requested. The stdio
    /// transport never returns this; it exists so callers can surface a
    /// typed error for the not-yet-ported streamable-HTTP transport instead
    /// of a generic failure.
    #[error("unsupported MCP transport: {0}")]
    UnsupportedTransport(String),
}

impl McpError {
    /// Returns `true` for a JSON-RPC `-32601` (method not found) error.
    pub fn is_method_not_found(&self) -> bool {
        matches!(self, McpError::JsonRpc { code: -32601, .. })
    }
}
