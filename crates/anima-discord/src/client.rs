// SPDX-License-Identifier: GPL-3.0-or-later

//! The blocking Discord REST client.

use std::fmt;
use std::time::Duration;

use reqwest::blocking::Client;
use reqwest::header::{self, HeaderMap};
use reqwest::{Method, StatusCode};
use serde::de::DeserializeOwned;
use serde::Deserialize;
use serde_json::json;

use crate::error::DiscordError;
use crate::types::{BotUser, Channel, GatewayBot, Message};

/// Default Discord API base URL (v10). Override with
/// [`DiscordRestClient::with_base_url`] for tests or self-hosted proxies.
pub const DEFAULT_BASE_URL: &str = "https://discord.com/api/v10";

/// Default per-request timeout (10 seconds).
pub const DEFAULT_TIMEOUT: Duration = Duration::from_secs(10);

/// Upper bound on how much of an error response body is kept in
/// [`DiscordError::Http`].
const MAX_ERROR_BODY: usize = 512;

/// User-Agent sent with every request.
const USER_AGENT: &str = concat!("AIRI airi-discord/", env!("CARGO_PKG_VERSION"));

/// Last-seen rate-limit headers from a Discord response.
///
/// Captured on every response that carries them (success or error). This is
/// observational only: the client does not throttle, queue, or retry on its
/// own. Fields are `Option` because a proxy may strip the headers.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct RateLimit {
    /// `X-RateLimit-Remaining` — requests left in the current bucket window.
    pub remaining: Option<u64>,
    /// `X-RateLimit-Reset-After` — seconds (fractional) until the bucket
    /// resets, as a [`Duration`].
    pub reset_after: Option<Duration>,
}

/// Blocking REST client for the Discord API (v10).
///
/// Methods take `&mut self` because each response's rate-limit headers are
/// stored back into the client (see [`DiscordRestClient::last_rate_limit`]).
///
/// The token is stored verbatim (Discord needs the exact string) but is never
/// logged: the [`fmt::Debug`] implementation prints `token: "***"`, no method
/// returns it, and no error value carries it.
pub struct DiscordRestClient {
    base_url: String,
    token: String,
    http: Client,
    last_rate_limit: Option<RateLimit>,
}

impl fmt::Debug for DiscordRestClient {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("DiscordRestClient")
            .field("base_url", &self.base_url)
            .field("token", &"***")
            .field("last_rate_limit", &self.last_rate_limit)
            .finish()
    }
}

impl DiscordRestClient {
    /// Build a client targeting [`DEFAULT_BASE_URL`] with [`DEFAULT_TIMEOUT`].
    ///
    /// # Errors
    ///
    /// Returns [`DiscordError::Transport`] if the underlying HTTP client
    /// cannot be constructed (e.g. TLS backend initialization failure).
    pub fn new(token: impl Into<String>) -> Result<Self, DiscordError> {
        Self::with_base_url(token, DEFAULT_BASE_URL)
    }

    /// Build a client targeting a custom base URL — used by tests (mockito)
    /// and by self-hosted proxies of the Discord API (e.g. Discohook-style
    /// reverse proxies). The trailing slash is trimmed; paths are appended
    /// verbatim.
    ///
    /// # Errors
    ///
    /// Returns [`DiscordError::Transport`] if the underlying HTTP client
    /// cannot be constructed.
    pub fn with_base_url(
        token: impl Into<String>,
        base_url: impl Into<String>,
    ) -> Result<Self, DiscordError> {
        let http = Client::builder()
            .user_agent(USER_AGENT)
            .timeout(DEFAULT_TIMEOUT)
            .build()?;
        Ok(Self {
            base_url: base_url.into().trim_end_matches('/').to_string(),
            token: token.into(),
            http,
            last_rate_limit: None,
        })
    }

    /// The base URL this client talks to (e.g. for diagnostics/display).
    /// Never contains the token.
    #[must_use]
    pub fn base_url(&self) -> &str {
        &self.base_url
    }

    /// The rate-limit headers captured from the most recent response, if any.
    #[must_use]
    pub fn last_rate_limit(&self) -> Option<RateLimit> {
        self.last_rate_limit
    }

    /// `GET /gateway/bot` — the gateway WebSocket URL, recommended shard
    /// count, and this bot's session start budget.
    ///
    /// # Errors
    ///
    /// See [`DiscordError`]: `Transport` on network failure, `Unauthorized`
    /// on 401, `RateLimited` on 429, `Http` on other non-success statuses,
    /// `Decode` on a malformed body.
    pub fn get_gateway_url(&mut self) -> Result<GatewayBot, DiscordError> {
        let body = self.execute(Method::GET, "/gateway/bot", None)?;
        decode_body(&body)
    }

    /// `GET /users/@me` — the bot user the token belongs to. The cheapest
    /// end-to-end token check available.
    ///
    /// # Errors
    ///
    /// See [`DiscordError`].
    pub fn get_current_bot_user(&mut self) -> Result<BotUser, DiscordError> {
        let body = self.execute(Method::GET, "/users/@me", None)?;
        decode_body(&body)
    }

    /// `POST /channels/{channel_id}/messages` with `{ "content": ... }`.
    ///
    /// The caller decides when to send. This method performs no validation
    /// of its own beyond what Discord enforces server-side (empty content and
    /// >2000-char content come back as `Http { status: 400, .. }`).
    ///
    /// # Errors
    ///
    /// See [`DiscordError`].
    pub fn send_message(
        &mut self,
        channel_id: &str,
        content: &str,
    ) -> Result<Message, DiscordError> {
        let path = format!("/channels/{}/messages", encode_path_segment(channel_id));
        let body = self.execute(Method::POST, &path, Some(json!({ "content": content })))?;
        decode_body(&body)
    }

    /// `GET /channels/{channel_id}` — id, raw type byte, name, topic, position.
    ///
    /// # Errors
    ///
    /// See [`DiscordError`].
    pub fn get_channel(&mut self, channel_id: &str) -> Result<Channel, DiscordError> {
        let path = format!("/channels/{}", encode_path_segment(channel_id));
        let body = self.execute(Method::GET, &path, None)?;
        decode_body(&body)
    }

    /// Execute a request and return the body text, handling auth, rate-limit
    /// capture, and status-to-error mapping.
    fn execute(
        &mut self,
        method: Method,
        path: &str,
        body: Option<serde_json::Value>,
    ) -> Result<String, DiscordError> {
        let url = format!("{}{}", self.base_url, path);
        tracing::debug!(method = %method, path = %path, "discord rest request");

        let mut request = self
            .http
            .request(method, &url)
            .header(header::AUTHORIZATION, format!("Bot {}", self.token));
        if let Some(body) = body {
            request = request.json(&body);
        }

        let response = request.send()?;
        let status = response.status();
        let headers = response.headers().clone();
        capture_rate_limit(&headers, &mut self.last_rate_limit);

        let text = response.text()?;
        tracing::debug!(status = %status, body_len = text.len(), "discord rest response");

        if status == StatusCode::UNAUTHORIZED {
            return Err(DiscordError::Unauthorized);
        }
        if status == StatusCode::TOO_MANY_REQUESTS {
            return Err(rate_limited(&text, self.last_rate_limit));
        }
        if !status.is_success() {
            return Err(DiscordError::Http {
                status: status.as_u16(),
                message: truncate_chars(&text, MAX_ERROR_BODY),
            });
        }
        Ok(text)
    }
}

/// Parse the JSON body of a 429, per Discord's documented shape
/// `{ "message": ..., "retry_after": <seconds, float>, "global": <bool> }`.
fn rate_limited(body: &str, last_rate_limit: Option<RateLimit>) -> DiscordError {
    #[derive(Deserialize)]
    struct RateLimitBody {
        #[serde(default)]
        retry_after: Option<f64>,
        #[serde(default)]
        global: bool,
    }

    let parsed: Option<RateLimitBody> = serde_json::from_str(body).ok();
    let retry_after = parsed
        .as_ref()
        .and_then(|b| b.retry_after)
        .and_then(secs_f64_to_duration)
        .or_else(|| last_rate_limit.and_then(|rl| rl.reset_after))
        .unwrap_or(Duration::from_secs(1));
    let global = parsed.map(|b| b.global).unwrap_or(false);
    DiscordError::RateLimited {
        retry_after,
        global,
    }
}

/// Capture `X-RateLimit-Remaining` / `X-RateLimit-Reset-After` into the
/// client. Unparseable or absent headers leave the field as `None`.
fn capture_rate_limit(headers: &HeaderMap, slot: &mut Option<RateLimit>) {
    let remaining = headers
        .get("x-ratelimit-remaining")
        .and_then(|v| v.to_str().ok())
        .and_then(|s| s.trim().parse::<u64>().ok());
    let reset_after = headers
        .get("x-ratelimit-reset-after")
        .and_then(|v| v.to_str().ok())
        .and_then(|s| s.trim().parse::<f64>().ok())
        .and_then(secs_f64_to_duration);

    if remaining.is_some() || reset_after.is_some() {
        *slot = Some(RateLimit {
            remaining,
            reset_after,
        });
    }
}

/// Losslessly convert a non-negative, finite, in-range seconds value to a
/// [`Duration`]. Returns `None` instead of panicking on NaN/negative/overflow.
fn secs_f64_to_duration(secs: f64) -> Option<Duration> {
    if secs.is_finite() && secs >= 0.0 && secs <= u64::MAX as f64 {
        Some(Duration::from_secs_f64(secs))
    } else {
        None
    }
}

/// Truncate to at most `max` chars (UTF-8 safe).
fn truncate_chars(s: &str, max: usize) -> String {
    s.chars().take(max).collect()
}

/// Percent-encode a path segment (Discord snowflakes are digits, but the URL
/// is assembled by string formatting — never let a segment smuggle slashes,
/// query strings, or fragments into the path).
fn encode_path_segment(segment: &str) -> String {
    let mut out = String::with_capacity(segment.len());
    for byte in segment.as_bytes() {
        match byte {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                out.push(char::from(*byte));
            }
            _ => {
                use std::fmt::Write as _;
                let _ = write!(out, "%{byte:02X}");
            }
        }
    }
    out
}

/// Decode a success body as JSON, mapping failures to [`DiscordError::Decode`].
fn decode_body<T: DeserializeOwned>(body: &str) -> Result<T, DiscordError> {
    serde_json::from_str(body).map_err(|e| DiscordError::Decode(e.to_string()))
}
