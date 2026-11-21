// SPDX-License-Identifier: GPL-3.0-or-later

//! Typed errors for the Discord REST client.

use std::time::Duration;

/// Errors returned by [`crate::DiscordRestClient`].
///
/// No variant ever carries the bot token. HTTP error bodies are truncated
/// (see `MAX_ERROR_BODY` in `client.rs`) so a hostile or buggy upstream
/// cannot flood logs through this type.
#[derive(Debug, thiserror::Error)]
pub enum DiscordError {
    /// Transport-level failure from the HTTP stack: DNS, TLS handshake,
    /// connection reset, body read, or client construction. The wrapped
    /// `reqwest::Error` may contain the request URL (never the token — the
    /// token travels in a header, not the URL).
    #[error("transport error: {0}")]
    Transport(#[from] reqwest::Error),
    /// Non-success HTTP status other than 401 and 429. `message` holds the
    /// (truncated) response body, which Discord populates with a JSON error
    /// object (`{ "message", "code", "errors"? }`).
    #[error("http {status}: {message}")]
    Http {
        /// The HTTP status code.
        status: u16,
        /// Truncated response body (UTF-8, at most 512 chars).
        message: String,
    },
    /// Discord rate limit (`429 Too Many Requests`). `retry_after` is the
    /// duration the server asked us to wait (parsed from the JSON body's
    /// `retry_after` seconds, falling back to the `X-RateLimit-Reset-After`
    /// header, then to 1 second). `global` is true when the limit is global
    /// rather than per-bucket.
    #[error("rate limited (global={global}), retry after {retry_after:?}")]
    RateLimited {
        /// How long to wait before retrying, as reported by Discord.
        retry_after: Duration,
        /// True if the rate limit is global (whole bot), false for per-route.
        global: bool,
    },
    /// The response had a success status but the body was not the expected
    /// JSON shape (or was not valid UTF-8 JSON at all).
    #[error("failed to decode discord response: {0}")]
    Decode(String),
    /// `401 Unauthorized` — the bot token is missing, malformed, or
    /// revoked. Surface this as "check the token in settings", never as a
    /// generic failure, and never retry it automatically. Also produced when
    /// the gateway closes with code 4004 (authentication failed).
    #[error("unauthorized: bot token rejected (401)")]
    Unauthorized,
    /// Gateway WebSocket transport-level failure: TCP connect, TLS handshake,
    /// frame read/write, or an unclean close during handshake. The wrapped
    /// string is a tungstenite error description; it never contains the token
    /// (the token travels in a JSON payload, never in the URL or headers).
    #[error("gateway transport error: {0}")]
    GatewayTransport(String),
    /// op 9 INVALID SESSION — the gateway rejected the session. `resumable`
    /// carries the `d` boolean: `true` means op 6 RESUME may succeed,
    /// `false` means a fresh IDENTIFY (new [`crate::GatewayClient::connect`])
    /// is required.
    #[error("invalid session (resumable={resumable})")]
    InvalidSession {
        /// Whether the session may be resumed with op 6.
        resumable: bool,
    },
}
