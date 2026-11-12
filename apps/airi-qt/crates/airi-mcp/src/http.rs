// SPDX-License-Identifier: GPL-3.0-or-later

//! The streamable-HTTP MCP client: single HTTP POST endpoint, JSON-RPC 2.0
//! bodies, responses either `application/json` or `text/event-stream`.
//!
//! This implements the MCP streamable-HTTP transport (MCP specification
//! 2024-11-05 / 2025-03-26) as a blocking (synchronous) client built on
//! `reqwest`'s blocking API. For each request the client sends
//!
//! ```text
//! POST <endpoint> HTTP/1.1
//! Content-Type: application/json
//! Accept: application/json, text/event-stream
//! Mcp-Session-Id: <session id, only when the server assigned one>
//! ```
//!
//! and reads the response as follows:
//!
//! * `2xx` + `Content-Type: application/json` — the body is a single
//!   JSON-RPC response object.
//! * `2xx` + `Content-Type: text/event-stream` — the body is an SSE stream;
//!   frames are parsed incrementally and the first JSON-RPC response whose
//!   `id` matches this client's request id is used. Frames carrying
//!   JSON-RPC *notifications* (server-initiated progress
//!   notifications, …) are parsed and traced but otherwise ignored. The
//!   stream is consumed frame-by-frame, so a server that keeps the stream
//!   open after delivering the response frame no longer blocks this client.
//! * `202 Accepted` — treated as a successful notification response with no
//!   body (per the spec, servers answer POSTs carrying only notifications
//!   with `202 Accepted`). Any other non-2xx status is
//!   [`McpError::HttpStatus`].
//!
//! Authorization: a *static* bearer token can be supplied per endpoint via
//! [`McpHttpClient::connect_with_auth`]. When set, every request to the
//! endpoint — the JSON-RPC POSTs, the `notifications/initialized`
//! notification and the best-effort `DELETE` in [`McpHttpClient::close`] —
//! carries `Authorization: Bearer <token>`. The token is stored privately,
//! redacted in [`fmt::Debug`] output, never exposed through an accessor,
//! and **scrubbed out of every [`McpError`] value this client produces** on
//! the request path (server-supplied response bodies, transport errors and
//! JSON-RPC error fields all have occurrences of the token replaced with
//! `***`). There is no OAuth flow, no token refresh and no `WWW-Authenticate`
//! handling — see the not-implemented list below.
//!
//! Redirects are not followed: the underlying `reqwest` client is built with
//! [`reqwest::redirect::Policy::none`]. MCP streamable-HTTP endpoints are
//! expected to answer requests directly; following a redirect could forward
//! the `Authorization` header to a different origin. A `3xx` response is
//! therefore surfaced as [`McpError::HttpStatus`] (an error), never chased.
//! This applies whether or not a token is configured.
//!
//! Session management: the `Mcp-Session-Id` response header on the
//! `initialize` response is captured and re-sent as the `Mcp-Session-Id`
//! request header on every subsequent request, per the spec. When the
//! server does not assign one, no header is sent. Header names used by this
//! client are exactly `Accept`, `Content-Type`, `Mcp-Session-Id` and (only
//! when a bearer token is configured) `Authorization` — no
//! `MCP-Protocol-Version` header is sent (the in-repo documentation does
//! not carry the spec text that defines it, and this crate does not invent
//! header names). `DELETE <endpoint>` is sent by [`McpHttpClient::close`]
//! as a best-effort session termination signal, with the same session
//! header when present; failures are ignored, as the spec allows servers
//! to answer `405 Method Not Allowed` / `501 Not Implemented` for
//! unsupported session termination.
//!
//! What is intentionally **not** implemented: OAuth (only a static bearer
//! token is supported), token refresh, SSE resume via
//! `Last-Event-ID`, reconnect/backoff (the SSE `retry:` field is parsed
//! and ignored), server-initiated requests over SSE (they are ignored), and
//! any form of automatic re-initialization when a server answers `404` for
//! an unknown session (surfaced as [`McpError::HttpStatus`]).

use std::fmt;
use std::io::Read;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex;
use std::time::Duration;

use reqwest::header::{HeaderValue, AUTHORIZATION};
use serde_json::Value;

use crate::error::McpError;
use crate::jsonrpc::{
    self, normalize_response_id, parse_initialize_result, parse_tool_result, parse_tools_list,
    response_to_result, JsonRpcNotification, JsonRpcRequest,
};
use crate::sse::{SseFrame, SseParser};
use crate::types::{
    McpInitializeResult, McpToolDescriptor, McpToolResult, CLIENT_NAME, DEFAULT_REQUEST_TIMEOUT,
};

/// Name of the header used for MCP session management, in both directions.
///
/// The server MAY return it on the `initialize` response to assign a
/// session id; the client re-sends it on subsequent requests and on the
/// `close()` `DELETE`.
pub const SESSION_ID_HEADER: &str = "Mcp-Session-Id";

/// Value of the `Accept` request header. The streamable-HTTP spec requires
/// the client to advertise both response content types.
pub const ACCEPT_HEADER_VALUE: &str = "application/json, text/event-stream";

const JSON_CONTENT_TYPE: &str = "application/json";
const SSE_CONTENT_TYPE: &str = "text/event-stream";

/// A JSON-RPC client for a single MCP server reached over the
/// streamable-HTTP transport.
///
/// One client handles exactly one server (one endpoint URL). The wire
/// behaviour matches [`McpStdioClient`](crate::McpStdioClient): numeric
/// request ids, typed errors, 5 s default per-request timeout raisable via
/// [`McpHttpClient::set_timeout`].
///
/// Construct with [`McpHttpClient::connect`]; nothing touches the network
/// until the first request is issued. Call
/// [`McpHttpClient::initialize`] before listing or calling tools.
pub struct McpHttpClient {
    endpoint: String,
    client: reqwest::blocking::Client,
    session_id: Mutex<Option<String>>,
    next_id: AtomicU64,
    timeout: Duration,
    /// Static bearer token sent as `Authorization: Bearer <token>` on every
    /// request to the configured endpoint. Never logged, never returned by
    /// any accessor, redacted in `Debug`, scrubbed from all errors.
    bearer_token: Option<String>,
}

impl fmt::Debug for McpHttpClient {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("McpHttpClient")
            .field("endpoint", &self.endpoint)
            .field("bearer_token", &self.bearer_token.as_ref().map(|_| "***"))
            .field("timeout", &self.timeout)
            .finish()
    }
}

impl McpHttpClient {
    /// Creates a client for `endpoint` (e.g. `"http://localhost:3000/mcp"`).
    ///
    /// This performs **no network I/O**; it only validates the URL (must be
    /// absolute with an `http`/`https` scheme) and builds the underlying
    /// HTTP client. The MCP handshake happens in
    /// [`McpHttpClient::initialize`].
    ///
    /// Equivalent to [`McpHttpClient::connect_with_auth`] with no token; a
    /// client created this way sends exactly the same requests as before
    /// the `Authorization` support landed.
    pub fn connect(url: &str) -> Result<Self, McpError> {
        Self::connect_with_auth(url, None)
    }

    /// Creates a client for `endpoint` with an optional static bearer token.
    ///
    /// When `bearer_token` is `Some` (a non-empty token; leading/trailing HTTP
    /// whitespace is rejected, not trimmed), every request to `endpoint` — including
    /// `notifications/initialized` and the `close()` `DELETE` — carries
    /// `Authorization: Bearer <token>`. The token is used **only** for the
    /// configured endpoint; it is never sent anywhere else (redirects are
    /// not followed at all; see the module docs), never logged, never
    /// returned by an accessor, redacted in `Debug` and scrubbed out of
    /// every [`McpError`] this client produces.
    ///
    /// A token containing bytes outside the RFC 7230 token charset, or one
    /// with leading/trailing HTTP whitespace (e.g. a tab-padded secret,
    /// which cannot be sent verbatim), is rejected with
    /// [`McpError::Transport`] without echoing the token. A token that is
    /// empty or whitespace-only is treated as no token.
    ///
    /// This performs **no network I/O**.
    pub fn connect_with_auth(url: &str, bearer_token: Option<&str>) -> Result<Self, McpError> {
        let parsed = reqwest::Url::parse(url)
            .map_err(|e| McpError::Transport(format!("invalid MCP endpoint URL `{url}`: {e}")))?;
        match parsed.scheme() {
            "http" | "https" => {}
            other => {
                return Err(McpError::Transport(format!(
                    "unsupported MCP endpoint scheme `{other}` (expected http or https)"
                )));
            }
        }

        let bearer_token = match bearer_token.map(normalize_bearer_token).transpose() {
            Ok(token) => token.flatten(),
            Err(()) => {
                return Err(McpError::Transport(
                    "bearer token contains bytes outside the RFC 7230 token charset".to_string(),
                ));
            }
        };

        // NOTICE: redirects are disabled entirely. MCP endpoints answer
        // requests directly, and reqwest forwards header values on redirect;
        // a cross-origin redirect would leak `Authorization`. Surfacing 3xx
        // as `McpError::HttpStatus` is the honest failure mode.
        let client = reqwest::blocking::Client::builder()
            .connect_timeout(DEFAULT_REQUEST_TIMEOUT)
            .redirect(reqwest::redirect::Policy::none())
            .build()
            .map_err(|e| McpError::Transport(format!("failed to build HTTP client: {e}")))?;

        Ok(Self {
            endpoint: url.to_string(),
            client,
            session_id: Mutex::new(None),
            next_id: AtomicU64::new(1),
            timeout: DEFAULT_REQUEST_TIMEOUT,
            bearer_token,
        })
    }

    /// Overrides the per-request timeout. Defaults to 5 s (see
    /// [`DEFAULT_REQUEST_TIMEOUT`]).
    pub fn set_timeout(&mut self, timeout: Duration) {
        self.timeout = timeout;
    }

    /// Returns the current per-request timeout.
    pub fn timeout(&self) -> Duration {
        self.timeout
    }

    /// Returns the session id assigned by the server on `initialize`, if
    /// any. `None` until `initialize` has completed, or when the server
    /// does not use sessions.
    pub fn session_id(&self) -> Option<String> {
        self.session_id.lock().ok().and_then(|guard| guard.clone())
    }

    /// The endpoint URL this client talks to.
    pub fn endpoint(&self) -> &str {
        &self.endpoint
    }

    /// Performs the MCP `initialize` handshake and then sends the
    /// `notifications/initialized` notification.
    ///
    /// Negotiates protocol version `"2024-11-05"` with empty client
    /// capabilities and clientInfo `{ name: "airi-mcp", version: <crate
    /// version> }`. If the response carries an `Mcp-Session-Id` header it is
    /// captured and re-sent on subsequent requests; if absent, the client
    /// proceeds without a session header. The server's reported protocol
    /// version is surfaced in [`McpInitializeResult::protocol_version`] but
    /// is not validated.
    pub fn initialize(&mut self) -> Result<McpInitializeResult, McpError> {
        let params = jsonrpc::initialize_params(CLIENT_NAME, env!("CARGO_PKG_VERSION"));
        let id = self.next_request_id();
        let request = JsonRpcRequest::new(id, "initialize", params);
        let response = self
            .send_request(id, "initialize", &request)
            .map_err(|e| self.scrub_error(e))?;

        // Capture the session id, if the server assigned one.
        if let Some(value) = response.headers().get(SESSION_ID_HEADER) {
            if let Ok(value) = value.to_str() {
                let trimmed = value.trim();
                if !trimmed.is_empty() {
                    if let Ok(mut guard) = self.session_id.lock() {
                        *guard = Some(trimmed.to_string());
                    }
                }
            }
        }

        let result = self
            .finish_response(id, response, "initialize")
            .map_err(|e| self.scrub_error(e))?;
        let parsed = parse_initialize_result(&result);
        self.send_notification(
            "notifications/initialized",
            Value::Object(Default::default()),
        )
        .map_err(|e| self.scrub_error(e))?;
        Ok(parsed)
    }

    /// Lists the tools the server exposes via `tools/list`.
    ///
    /// Entries without a string `name` are skipped. `inputSchema` (spec) and
    /// `input_schema` (non-standard alias) are both accepted.
    pub fn tools_list(&self) -> Result<Vec<McpToolDescriptor>, McpError> {
        let params = Value::Object(Default::default());
        let result = self.call("tools/list", params)?;
        Ok(parse_tools_list(&result))
    }

    /// Calls `tools/call` and returns the structured result.
    ///
    /// `arguments` is sent verbatim as the `arguments` member (the MCP spec
    /// requires an object; servers may reject non-object arguments with a
    /// JSON-RPC error, which surfaces as [`McpError::JsonRpc`]). A
    /// tool-level failure is surfaced via [`McpToolResult::is_error`], not
    /// via `Err`.
    pub fn tools_call(
        &self,
        name: &str,
        arguments: serde_json::Value,
    ) -> Result<McpToolResult, McpError> {
        let params = serde_json::json!({
            "name": name,
            "arguments": arguments,
        });
        let result = self.call("tools/call", params)?;
        Ok(parse_tool_result(&result))
    }

    /// Terminates the MCP session with a best-effort `DELETE` to the
    /// endpoint, carrying the `Mcp-Session-Id` header when one was assigned.
    ///
    /// All errors are ignored by design: the spec allows servers to answer
    /// `405 Method Not Allowed` or `501 Not Implemented` when session
    /// termination is unsupported, and there is nothing meaningful to
    /// recover here. The underlying transport connection is dropped with the
    /// client.
    pub fn close(self) {
        let mut request = self
            .client
            .delete(&self.endpoint)
            .header("Accept", ACCEPT_HEADER_VALUE);
        request = self.with_auth(request);
        if let Some(session_id) = self.session_id() {
            request = request.header(SESSION_ID_HEADER, session_id);
        }
        match request.timeout(self.timeout).send() {
            Ok(response) => {
                tracing::debug!(
                    target: "airi-mcp",
                    status = %response.status().as_u16(),
                    "MCP session DELETE sent (best effort)"
                );
            }
            Err(e) => {
                let message = self.scrub(&e.to_string());
                tracing::debug!(target: "airi-mcp", "MCP session DELETE failed (ignored): {message}");
            }
        }
    }

    /// Sends a request and decodes the response to its `result` member.
    fn call(&self, method: &str, params: Value) -> Result<Value, McpError> {
        let id = self.next_request_id();
        let request = JsonRpcRequest::new(id, method, params);
        let response = self
            .send_request(id, method, &request)
            .map_err(|e| self.scrub_error(e))?;
        self.finish_response(id, response, method)
            .map_err(|e| self.scrub_error(e))
    }

    fn next_request_id(&self) -> u64 {
        self.next_id.fetch_add(1, Ordering::SeqCst)
    }

    /// Adds the `Authorization: Bearer <token>` header when a token is
    /// configured; otherwise returns the builder unchanged.
    fn with_auth(
        &self,
        builder: reqwest::blocking::RequestBuilder,
    ) -> reqwest::blocking::RequestBuilder {
        match &self.bearer_token {
            Some(token) => builder.header(AUTHORIZATION, bearer_header_value(token)),
            None => builder,
        }
    }

    /// Replaces occurrences of the configured bearer token with `***`.
    fn scrub(&self, text: &str) -> String {
        match &self.bearer_token {
            Some(token) if !token.is_empty() => text.replace(token.as_str(), "***"),
            _ => text.to_string(),
        }
    }

    /// Recursively replaces occurrences of the bearer token in a JSON value.
    fn scrub_value(&self, value: &mut Value) {
        match value {
            Value::String(s) => *s = self.scrub(s),
            Value::Array(items) => {
                for item in items {
                    self.scrub_value(item);
                }
            }
            Value::Object(map) => {
                for (_, item) in map.iter_mut() {
                    self.scrub_value(item);
                }
            }
            _ => {}
        }
    }

    /// Scrubs the bearer token out of every server- or transport-supplied
    /// string inside an [`McpError`]. A server that echoes the
    /// `Authorization` header back in an error body, a JSON-RPC `error`
    /// object or a transport failure message must not be able to smuggle
    /// the token into AIRI's logs or UI.
    fn scrub_error(&self, err: McpError) -> McpError {
        match err {
            McpError::Transport(s) => McpError::Transport(self.scrub(&s)),
            McpError::Sse(s) => McpError::Sse(self.scrub(&s)),
            McpError::Protocol(s) => McpError::Protocol(self.scrub(&s)),
            McpError::UnsupportedTransport(s) => McpError::UnsupportedTransport(self.scrub(&s)),
            McpError::HttpStatus { status, body } => McpError::HttpStatus {
                status,
                body: self.scrub(&body),
            },
            McpError::JsonRpc {
                code,
                message,
                data,
            } => McpError::JsonRpc {
                code,
                message: self.scrub(&message),
                data: data.map(|mut value| {
                    self.scrub_value(&mut value);
                    value
                }),
            },
            other => other,
        }
    }

    fn send_request(
        &self,
        id: u64,
        method: &str,
        request: &JsonRpcRequest<'_>,
    ) -> Result<reqwest::blocking::Response, McpError> {
        let body = serde_json::to_string(request)
            .map_err(|e| McpError::Protocol(format!("failed to encode JSON-RPC message: {e}")))?;

        let mut builder = self
            .client
            .post(&self.endpoint)
            .header("Content-Type", JSON_CONTENT_TYPE)
            .header("Accept", ACCEPT_HEADER_VALUE)
            .body(body)
            .timeout(self.timeout);
        builder = self.with_auth(builder);
        if let Some(session_id) = self.session_id() {
            builder = builder.header(SESSION_ID_HEADER, session_id);
        }

        match builder.send() {
            Ok(response) => Ok(response),
            Err(e) if e.is_timeout() => Err(McpError::Timeout {
                method: method.to_string(),
                timeout: self.timeout,
            }),
            Err(e) => Err(McpError::Transport(format!(
                "HTTP request to `{}` for `{method}` (id {id}) failed: {e}",
                self.endpoint,
            ))),
        }
    }

    /// Validates the HTTP status and dispatches on the response
    /// `Content-Type` to produce the JSON-RPC `result` value.
    fn finish_response(
        &self,
        id: u64,
        response: reqwest::blocking::Response,
        method: &str,
    ) -> Result<Value, McpError> {
        let status = response.status();
        if !status.is_success() {
            let body = response.text().unwrap_or_default();
            return Err(McpError::HttpStatus {
                status: status.as_u16(),
                body,
            });
        }

        let content_type = response
            .headers()
            .get(reqwest::header::CONTENT_TYPE)
            .and_then(|value| value.to_str().ok())
            .unwrap_or("")
            .to_string();

        if content_type.contains(SSE_CONTENT_TYPE) {
            return self.read_sse_response(id, method, response);
        }

        if status == reqwest::StatusCode::ACCEPTED {
            // 202 with no body: legal for notifications only, but tolerate
            // an empty body here rather than choke on a spec-compliant peer.
            let body = response.text().unwrap_or_default();
            if body.trim().is_empty() {
                return Ok(Value::Null);
            }
            return self.parse_json_response(&body);
        }

        if content_type.contains(JSON_CONTENT_TYPE) {
            let body = response.text().map_err(|e| {
                McpError::Transport(format!("failed to read response body for `{method}`: {e}"))
            })?;
            return self.parse_json_response(&body);
        }

        Err(McpError::Protocol(format!(
            "unexpected Content-Type `{content_type}` for response to `{method}` (expected application/json or text/event-stream)"
        )))
    }

    fn parse_json_response(&self, body: &str) -> Result<Value, McpError> {
        let trimmed = body.trim();
        if trimmed.is_empty() {
            return Ok(Value::Null);
        }
        let response: Value = serde_json::from_str(trimmed)
            .map_err(|e| McpError::Protocol(format!("response body is not valid JSON: {e}")))?;
        response_to_result(&response)
    }

    /// Reads the SSE stream incrementally until the JSON-RPC response for
    /// `id` arrives (or the stream ends), and returns its `result` member.
    ///
    /// Server-initiated requests inside the stream are ignored (they are
    /// neither answered nor surfaced — the stdio client answers them with
    /// -32601, but answering over SSE requires a follow-up POST and is out
    /// of scope here; see the phase note).
    fn read_sse_response(
        &self,
        id: u64,
        method: &str,
        response: reqwest::blocking::Response,
    ) -> Result<Value, McpError> {
        let mut reader = response;
        let mut parser = SseParser::new();
        let mut buffer = [0u8; 8192];

        loop {
            match reader.read(&mut buffer) {
                Ok(0) => break, // EOF
                Ok(n) => {
                    for frame in parser.feed(&buffer[..n]) {
                        if let Some(result) = self.handle_sse_frame(&frame, id)? {
                            return Ok(result);
                        }
                    }
                }
                Err(e)
                    if e.kind() == std::io::ErrorKind::TimedOut
                        || e.kind() == std::io::ErrorKind::WouldBlock =>
                {
                    return Err(McpError::Timeout {
                        method: method.to_string(),
                        timeout: self.timeout,
                    });
                }
                Err(e) => {
                    return Err(McpError::Transport(format!(
                        "failed to read SSE stream for `{method}`: {e}"
                    )));
                }
            }
        }

        for frame in parser.finish() {
            if let Some(result) = self.handle_sse_frame(&frame, id)? {
                return Ok(result);
            }
        }

        Err(McpError::Sse(format!(
            "SSE stream ended without a JSON-RPC response for request id {id} (`{method}`)"
        )))
    }

    /// Classifies one SSE frame. Returns `Ok(Some(result))` when the frame
    /// is the response for `id`, `Ok(None)` for notifications/other frames.
    fn handle_sse_frame(&self, frame: &SseFrame, id: u64) -> Result<Option<Value>, McpError> {
        let message: Value = serde_json::from_str(&frame.data).map_err(|e| {
            McpError::Sse(format!("SSE frame `data:` payload is not valid JSON: {e}"))
        })?;

        if message.get("method").is_some() {
            // Server-initiated request or notification. Ignored; see the
            // module docs.
            tracing::trace!(
                target: "airi-mcp",
                method = ?message.get("method"),
                "ignoring server-initiated message inside SSE stream"
            );
            return Ok(None);
        }

        match message.get("id").and_then(normalize_response_id) {
            Some(frame_id) if frame_id == id => Ok(Some(response_to_result(&message)?)),
            Some(_) => {
                tracing::debug!(target: "airi-mcp", "ignoring SSE frame for a different request id");
                Ok(None)
            }
            None => {
                tracing::debug!(target: "airi-mcp", "ignoring SSE frame with no usable id");
                Ok(None)
            }
        }
    }

    /// Sends a notification (no id, no response expected). 202 or any 2xx
    /// is accepted; an empty body is fine.
    fn send_notification(&self, method: &str, params: Value) -> Result<(), McpError> {
        let notification = JsonRpcNotification::new(method, params);
        let body = serde_json::to_string(&notification)
            .map_err(|e| McpError::Protocol(format!("failed to encode JSON-RPC message: {e}")))?;

        let mut builder = self
            .client
            .post(&self.endpoint)
            .header("Content-Type", JSON_CONTENT_TYPE)
            .header("Accept", ACCEPT_HEADER_VALUE)
            .body(body)
            .timeout(self.timeout);
        builder = self.with_auth(builder);
        if let Some(session_id) = self.session_id() {
            builder = builder.header(SESSION_ID_HEADER, session_id);
        }

        let response = builder.send().map_err(|e| {
            if e.is_timeout() {
                McpError::Timeout {
                    method: method.to_string(),
                    timeout: self.timeout,
                }
            } else {
                McpError::Transport(format!(
                    "HTTP notification `{method}` to `{}` failed: {e}",
                    self.endpoint,
                ))
            }
        })?;

        let status = response.status();
        if !status.is_success() {
            let body = response.text().unwrap_or_default();
            return Err(McpError::HttpStatus {
                status: status.as_u16(),
                body,
            });
        }
        Ok(())
    }
}

/// The bytes RFC 7230 allows in an HTTP *token* (`tchar`): visible ASCII
/// minus the separators `()<>@,;:\"/[]?={}` and space.
fn is_rfc7230_token(bytes: &[u8]) -> bool {
    bytes.iter().copied().all(is_tchar)
}

fn is_tchar(byte: u8) -> bool {
    matches!(byte,
        b'!' | b'#' | b'$' | b'%' | b'&' | b'\'' | b'*' | b'+' | b'-' | b'.'
        | b'^' | b'_' | b'`' | b'|' | b'~'
        | b'0'..=b'9' | b'A'..=b'Z' | b'a'..=b'z')
}

/// Validates a configured bearer token for use as an `Authorization` header.
/// `Ok(None)` means no usable token; `Err(())` means the token cannot be sent
/// verbatim (the caller reports it without echoing the token).
///
/// Only the token charset is accepted, so a token with interior HTTP
/// whitespace (a tab, which `HeaderValue::from_str` would happily take) or any
/// control byte is rejected. A token that is empty or all-whitespace is "no
/// token"; a token with leading/trailing whitespace is rejected rather than
/// trimmed, because the trimmed value would silently differ from what the
/// caller configured (e.g. `"\tsecret"` and `"secret"` reaching a peer as the
/// same value).
fn normalize_bearer_token(token: &str) -> Result<Option<String>, ()> {
    let trimmed = token.trim_matches(|c: char| c.is_ascii_whitespace());
    if trimmed.is_empty() {
        return Ok(None);
    }
    if !is_rfc7230_token(trimmed.as_bytes()) {
        return Err(());
    }
    if trimmed.len() != token.len() {
        return Err(());
    }
    Ok(Some(trimmed.to_string()))
}

/// Builds the `Authorization: Bearer <token>` header value.
///
/// `connect_with_auth` only stores charset-valid, unpadded tokens, so this is
/// unreachable by construction; if the invariant ever breaks, it panics instead
/// of sending an empty credential on the wire.
fn bearer_header_value(token: &str) -> HeaderValue {
    // `connect_with_auth` only stores charset-valid, unpadded tokens, so this is
    // unreachable by construction. If the invariant ever breaks, fail loudly at
    // the call site rather than sending an empty credential on the wire.
    let value = HeaderValue::from_str(&format!("Bearer {token}"))
        .expect("stored bearer token is always a valid header value");
    debug_assert!(is_rfc7230_token(token.as_bytes()));
    value
}

#[cfg(test)]
mod tests {
    use super::*;

    fn client_with_token(token: &str) -> Result<McpHttpClient, McpError> {
        McpHttpClient::connect_with_auth("http://127.0.0.1:1/mcp", Some(token))
    }

    #[test]
    fn token_with_control_bytes_is_rejected_without_echo() {
        for bad in [
            "abc\tdef",
            "abc\u{1f}def",
            "abc\ndef",
            "abc\u{7f}def",
            "\tabc\t",
        ] {
            let err = client_with_token(bad).expect_err("token must be rejected");
            let McpError::Transport(message) = err else {
                panic!("expected McpError::Transport for {bad:?}, got {err:?}");
            };
            assert!(
                !message.contains("abc") && !message.contains("def"),
                "error echoed token material: {message}"
            );
        }
    }

    #[test]
    fn token_charset_is_exactly_tchar() {
        for byte in 0u8..=0xFF {
            let token = format!("a{}a", byte as char);
            assert_eq!(
                normalize_bearer_token(&token).is_ok(),
                is_tchar(byte),
                "charset and normalization disagree on byte {byte:#04x}"
            );
        }
        assert!(is_rfc7230_token(b"s3cr3t.tok-1"));
    }

    #[test]
    fn bearer_header_value_is_well_formed_for_valid_tokens() {
        assert_eq!(
            bearer_header_value("s3cr3t.tok-1").as_bytes(),
            b"Bearer s3cr3t.tok-1"
        );
    }

    #[test]
    fn normalize_bearer_token_trims_and_rejects() {
        assert_eq!(
            normalize_bearer_token("s3cr3t").unwrap().as_deref(),
            Some("s3cr3t")
        );
        assert_eq!(normalize_bearer_token("   ").unwrap(), None);
        assert_eq!(normalize_bearer_token("").unwrap(), None);
        for bad in [
            "abc\tdef",
            "\tabc\t",
            "\tabc",
            "abc\t",
            "abc\u{1f}def",
            "abc\ndef",
            "abc\u{7f}def",
            "abc def",
        ] {
            assert_eq!(
                normalize_bearer_token(bad),
                Err(()),
                "token {bad:?} must be rejected"
            );
        }
    }
}
