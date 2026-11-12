// SPDX-License-Identifier: GPL-3.0-or-later

//! Error type for the MCP client.

use std::time::Duration;

use thiserror::Error;

/// Errors returned by [`crate::McpStdioClient`] and [`crate::McpHttpClient`].
#[derive(Debug, Error)]
pub enum McpError {
    /// The MCP server process could not be spawned (missing binary, permission
    /// denied, …). The inner error is the OS spawn failure.
    #[error("failed to spawn MCP stdio server: {0}")]
    Spawn(#[source] std::io::Error),

    /// An I/O failure while writing to the server's stdin or while the
    /// background reader thread was draining the server's stdout/stderr
    /// (stdio transport), or an HTTP request-level failure before a response
    /// was received (streamable-HTTP transport, e.g. connect refused, TLS
    /// failure, request timeout).
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

    /// The HTTP transport received a non-success status code (anything
    /// outside 2xx, except the `202 Accepted` "no body" notification
    /// response, which is treated as success). The response body is
    /// preserved verbatim (lossy UTF-8) for diagnostics, except that on the
    /// streamable-HTTP path occurrences of a configured bearer token are
    /// replaced with `***`.
    #[error("HTTP {status} from MCP endpoint: {body}")]
    HttpStatus {
        /// The HTTP status code returned by the server.
        status: u16,
        /// Response body, lossily decoded; may be empty.
        body: String,
    },

    /// The `text/event-stream` body could not be parsed or did not contain a
    /// JSON-RPC response for the request id this client was waiting for.
    /// Examples: a `data:` frame whose payload is not valid JSON, or a
    /// stream that ended (or errored) before the response frame arrived.
    #[error("SSE stream error: {0}")]
    Sse(String),

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

    /// A transport this crate does not implement was requested. Kept for
    /// backwards compatibility: the streamable-HTTP transport has since been
    /// implemented as [`crate::McpHttpClient`], so the HTTP client never
    /// returns this variant anymore. It remains so existing callers that
    /// match on it keep compiling.
    #[error("unsupported MCP transport: {0}")]
    UnsupportedTransport(String),
}

impl McpError {
    /// Returns `true` for a JSON-RPC `-32601` (method not found) error.
    pub fn is_method_not_found(&self) -> bool {
        matches!(self, McpError::JsonRpc { code: -32601, .. })
    }
}
