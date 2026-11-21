// SPDX-License-Identifier: GPL-3.0-or-later

//! Error type for the ACP client.

use std::time::Duration;

use thiserror::Error;

/// JSON-RPC 2.0 error code for "method not found".
pub const JSONRPC_METHOD_NOT_FOUND: i64 = -32601;

/// ACP-specific error code for "resource not found" (see `ErrorCode` in the
/// SDK schema). ACP has no session-specific not-found code; session-scoped
/// RPCs treat this as [`AcpError::SessionNotFound`].
pub const JSONRPC_RESOURCE_NOT_FOUND: i64 = -32002;

/// Errors returned by [`crate::AcpAgentClient`].
#[derive(Debug, Error)]
pub enum AcpError {
    /// The agent process could not be spawned (missing binary, permission
    /// denied, …). The inner error is the OS spawn failure.
    #[error("failed to spawn ACP agent: {0}")]
    Spawn(#[source] std::io::Error),

    /// An I/O failure while writing to the agent's stdin or while the
    /// background reader thread was draining the agent's stdout/stderr.
    #[error("ACP transport error: {0}")]
    Transport(String),

    /// The agent closed the connection (stdout hit EOF) or died while a
    /// request was in flight. All pending requests are resolved with this
    /// error instead of blocking until the timeout.
    #[error("ACP transport closed: the agent closed its output stream or exited")]
    Closed,

    /// The agent answered with a JSON-RPC error for a method it does not
    /// implement (`-32601` method not found). Distinct from
    /// [`AcpError::JsonRpc`] so callers can feature-detect agent support
    /// without string matching.
    #[error("ACP agent does not support `{method}` (method not found, JSON-RPC -32601)")]
    Unsupported {
        /// The method the agent did not implement.
        method: String,
    },

    /// The agent reported that the session does not exist — ACP has no
    /// session-specific not-found code, so session-scoped RPCs map the
    /// documented `-32002` "resource not found" (`ErrorCode` in the SDK
    /// schema) onto this variant. The inner string is the session id the
    /// caller asked about.
    #[error("session not found: {0}")]
    SessionNotFound(String),

    /// The agent answered a request with a JSON-RPC 2.0 error object.
    #[error("JSON-RPC error {code}: {message}")]
    JsonRpc {
        /// Agent-supplied error code (e.g. `-32601` method not found).
        code: i64,
        /// Agent-supplied error message.
        message: String,
        /// Optional agent-supplied error data, preserved verbatim.
        data: Option<serde_json::Value>,
    },

    /// No response arrived within the configured timeout.
    #[error("timed out after {timeout:?} waiting for response to `{method}`")]
    Timeout {
        /// The JSON-RPC method that timed out.
        method: String,
        /// The timeout that was exceeded.
        timeout: Duration,
    },

    /// The peer sent something that is valid JSON but not valid for the
    /// JSON-RPC 2.0 / ACP protocol as used by this client (e.g. a `session/new`
    /// response without a string `sessionId`).
    #[error("ACP protocol violation: {0}")]
    Protocol(String),

    /// A prompt was requested for a session that already has a prompt turn in
    /// flight. Only one outstanding `session/prompt` per session is supported;
    /// wait for the current turn to finish (or [`crate::AcpAgentClient::cancel`]
    /// it) before sending the next.
    #[error("a prompt is already in progress for session `{0}`")]
    PromptInProgress(String),

    /// No pending permission request with the given id — either it was never
    /// enqueued, it was already answered, or the enqueue queue was full and
    /// the request was rejected without reaching the user.
    #[error("no pending permission request with id `{0}`")]
    UnknownPermissionRequest(String),
}

impl AcpError {
    /// Returns `true` for a JSON-RPC `-32601` (method not found) error.
    /// Recognises both the raw [`AcpError::JsonRpc`] form and the mapped
    /// [`AcpError::Unsupported`] form.
    pub fn is_method_not_found(&self) -> bool {
        matches!(
            self,
            AcpError::JsonRpc {
                code: JSONRPC_METHOD_NOT_FOUND,
                ..
            } | AcpError::Unsupported { .. }
        )
    }
}
