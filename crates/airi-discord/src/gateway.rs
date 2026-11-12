// SPDX-License-Identifier: GPL-3.0-or-later

//! Blocking Discord **Gateway** (WebSocket) client for the v10 gateway.
//!
//! This is the live half of the integration: it connects to the URL returned
//! by `GET /gateway/bot` (see [`crate::DiscordRestClient::get_gateway_url`])
//! and speaks the gateway op codes (`op 0` dispatch, `op 1` heartbeat,
//! `op 2` identify, `op 6` resume, `op 9` invalid session, `op 10` hello,
//! `op 11` heartbeat ack).
//!
//! # Handshake
//!
//! 1. [`GatewayClient::connect`] opens the WebSocket. If `gateway_url`
//!    already carries a query string it is used verbatim (a `/` is inserted
//!    before the query if the URL has no path); otherwise
//!    `/?v=10&encoding=json` is appended (see [`gateway_ws_url`]). Discord's
//!    `GET /gateway/bot` today returns a bare host (`wss://gateway.discord.gg`),
//!    so the append path is the expected one.
//! 2. The server must send **op 10 (HELLO)** with `heartbeat_interval`
//!    (milliseconds) within ~10 s ([`crate::DEFAULT_TIMEOUT`]), or the
//!    handshake fails.
//! 3. The client sends **op 2 (IDENTIFY)**: `{ token, intents, properties:
//!    { os: "linux", browser: "airi-qt", device: "airi-qt" } }`.
//! 4. The server eventually dispatches `READY` (op 0, `t = "READY"`), which
//!    carries `session_id` and `resume_gateway_url`. Until then
//!    [`GatewayClient::session_id`] is `None`.
//!
//! # Heartbeats
//!
//! The client sends **op 1 (HEARTBEAT)** `{ d: <last dispatch sequence or
//! null> }` every `heartbeat_interval`. The interval is checked inside
//! [`GatewayClient::next_event`]'s read loop (the socket read timeout is set
//! to `heartbeat_interval`, so a quiet connection wakes exactly when a
//! heartbeat is due). **op 11 (HEARTBEAT_ACK)** is surfaced as
//! [`GatewayEvent::HeartbeatAck`]; it is not an error.
//!
//! # Reconnect contract (caller-driven — no threads, no backoff magic)
//!
//! Automatic reconnect/backoff is deliberately **the caller's loop**, matching
//! Electron's gateway manager: this crate never spawns a thread and never
//! reconnects on its own. The intended loop is:
//!
//! ```no_run
//! # use airi_discord::{GatewayClient, GatewayEvent, DiscordError, DEFAULT_INTENTS};
//! # fn caller_supplied() -> Result<GatewayClient, DiscordError> {
//! // ... after connect() and a first event stream:
//! #   let mut client = GatewayClient::connect("wss://gateway.discord.gg", "token", DEFAULT_INTENTS)?;
//! loop {
//!     match client.next_event() {
//!         Ok(event) => { /* handle event */ }
//!         Err(e) => {
//!             eprintln!("gateway error: {e}; reconnecting");
//!             client.reconnect()?;              // socket + HELLO only, keeps session state
//!             if client.session_id().is_some() {
//!                 client.resume()?;             // op 6 RESUME with token+session_id+seq
//!             }                                 // else: build a fresh client with connect()
//!         }
//!     }
//! #   break Ok(client);
//! }
//! # }
//! ```
//!
//! * [`GatewayClient::reconnect`] re-opens the TCP/WebSocket/HELLO handshake and
//!   **preserves** `session_id` / `resume_gateway_url` / `seq`. It does **not**
//!   send IDENTIFY or RESUME itself.
//! * If a `session_id` is present, the caller follows with [`GatewayClient::resume`]
//!   (op 6). The server answers with a `RESUMED` dispatch (→ [`GatewayEvent::Resumed`])
//!   or op 9 INVALID SESSION (→ [`DiscordError::InvalidSession`]).
//! * If there is no `session_id` (never reached READY), discard the client and
//!   call [`GatewayClient::connect`] again — a fresh IDENTIFY is required.
//! * Backoff, jitter, resume-vs-fresh decisions, and lifecycle (connect on Qt
//!   start? never? opt-in only?) are entirely the caller's policy. **The Qt
//!   app must never auto-connect**; receiving is opt-in (e.g. behind a
//!   `--gateway` flag), mirroring the human-in-the-loop posture of the REST
//!   slice.
//!
//! # Intents
//!
//! [`DEFAULT_INTENTS`] is `GUILD_MESSAGES | DIRECT_MESSAGES | MESSAGE_CONTENT`
//! (`512 | 4096 | 32768`). **`MESSAGE_CONTENT` is a _privileged_ intent**: the
//! bot must have it enabled in the Discord developer portal, or identify will
//! be rejected for verified applications (and message `content` arrives empty
//! for unverified ones). It is included because AIRI's whole point is reading
//! the *content* of messages; narrow it at the call site if that is not wanted.
//!
//! # Security posture
//!
//! The bot token is stored verbatim and never logged: [`fmt::Debug`] prints
//! `token: "***"`, no method returns it, and no error value carries it.
//! [`DiscordError::Unauthorized`] is returned on a close code of 4004.

use std::fmt;
use std::io;
use std::net::TcpStream;
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};
use serde_json::json;
use tungstenite::stream::MaybeTlsStream;
use tungstenite::{Message, WebSocket};

use crate::client::DEFAULT_TIMEOUT;
use crate::error::DiscordError;

/// `GUILD_MESSAGES | DIRECT_MESSAGES | MESSAGE_CONTENT` (`512 | 4096 | 32768`).
///
/// Chosen so the bot can see message creation events in guilds and DMs and can
/// read their **content**. `MESSAGE_CONTENT` (`1 << 15` = `32768`) is a
/// *privileged* intent: it must be enabled for the application in the Discord
/// developer portal, otherwise verified applications are rejected at IDENTIFY
/// time and unverified applications receive empty `content`. Without content,
/// `MESSAGE_CREATE` dispatches are still received but useless to AIRI.
pub const DEFAULT_INTENTS: u32 = 512 | 4096 | 32768;

// Gateway op codes (Discord v10).
const OP_DISPATCH: u8 = 0;
const OP_HEARTBEAT: u8 = 1;
const OP_IDENTIFY: u8 = 2;
const OP_RESUME: u8 = 6;
const OP_INVALID_SESSION: u8 = 9;
const OP_HELLO: u8 = 10;
const OP_HEARTBEAT_ACK: u8 = 11;
const OP_RECONNECT: u8 = 7;

/// Close code sent by Discord when the token is rejected ("Authentication failed").
const CLOSE_AUTHENTICATION_FAILED: u16 = 4004;

/// The user object embedded in `READY` (`{ id, username }` — the only fields
/// AIRI consumes; everything else is ignored).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ReadyUser {
    /// The user id (snowflake).
    pub id: String,
    /// The user's username.
    pub username: String,
}

/// The author object embedded in `MESSAGE_CREATE`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct MessageAuthor {
    /// The author's user id (snowflake).
    pub id: String,
    /// The author's username.
    pub username: String,
    /// `true` if the author is a bot. Absent in the payload means `false`.
    #[serde(default)]
    pub bot: bool,
}

/// A decoded gateway event surfaced by [`GatewayClient::next_event`].
///
/// Unknown op codes and unknown dispatch `t` names are **not** represented
/// here; they are logged at `tracing::debug!` and skipped internally.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub enum GatewayEvent {
    /// op 0, `t = "READY"` — the session is established. Carries the
    /// `session_id` and `resume_gateway_url` needed for a later op 6 RESUME.
    Ready {
        /// The session id issued by Discord.
        session_id: String,
        /// The gateway URL to reconnect to when resuming.
        resume_gateway_url: String,
        /// The bot user Discord authenticated.
        user: ReadyUser,
    },
    /// op 0, `t = "RESUMED"` — the session was resumed after a reconnect.
    Resumed,
    /// op 0, `t = "MESSAGE_CREATE"` — a new message in a channel the bot can
    /// see (and, if `MESSAGE_CONTENT` is enabled, its content).
    MessageCreate {
        /// The message id (snowflake).
        id: String,
        /// The channel the message was sent in (snowflake).
        channel_id: String,
        /// The guild the message was sent in, or `None` for DMs.
        guild_id: Option<String>,
        /// The author of the message.
        author: MessageAuthor,
        /// The message content (empty unless the privileged `MESSAGE_CONTENT`
        /// intent is enabled).
        content: String,
        /// ISO-8601 timestamp as sent by Discord (opaque string).
        timestamp: String,
    },
    /// op 11 — heartbeat acknowledged by the server.
    HeartbeatAck,
    /// The server sent a WebSocket close frame. `code` is the close code, if
    /// one was present. A 4004 close is surfaced as
    /// [`DiscordError::Unauthorized`] instead of this variant.
    Closed {
        /// The WebSocket close code (e.g. 1000, 4000–4999), if present.
        code: Option<u16>,
    },
}

/// Resolve the URL to dial. If `gateway_url` already has a query string it is
/// used verbatim (a proxy may carry its own), with a `/` inserted before the
/// query if the URL has no path (`ws://host?q=1` → `ws://host/?q=1`) —
/// otherwise the request line would be invalid. Without a query string,
/// `/?v=10&encoding=json` (or `?v=10&encoding=json` after a trailing slash) is
/// appended — Discord's `/gateway/bot` returns a bare host, so this is the
/// normal path.
fn gateway_ws_url(gateway_url: &str) -> String {
    if let Some(query_at) = gateway_url.find('?') {
        let before = &gateway_url[..query_at];
        let scheme_end = before.find("://").map_or(0, |i| i + 3);
        if before[scheme_end..].contains('/') {
            gateway_url.to_string()
        } else {
            format!("{before}/{}", &gateway_url[query_at..])
        }
    } else if let Some(base) = gateway_url.strip_suffix('/') {
        format!("{base}/?v=10&encoding=json")
    } else {
        format!("{gateway_url}/?v=10&encoding=json")
    }
}

/// Set a read timeout on the socket inside a [`WebSocket`], handling both the
/// plain (ws://) and TLS (wss://) stream variants.
fn set_read_timeout(socket: &mut WebSocket<MaybeTlsStream<TcpStream>>, timeout: Duration) {
    match socket.get_mut() {
        MaybeTlsStream::Plain(stream) => {
            let _ = stream.set_read_timeout(Some(timeout));
        }
        MaybeTlsStream::Rustls(stream) => {
            let _ = stream.sock.set_read_timeout(Some(timeout));
        }
        #[allow(unreachable_patterns)]
        _ => {}
    }
}

/// Set a write timeout on the socket (see [`set_read_timeout`]).
fn set_write_timeout(socket: &mut WebSocket<MaybeTlsStream<TcpStream>>, timeout: Duration) {
    match socket.get_mut() {
        MaybeTlsStream::Plain(stream) => {
            let _ = stream.set_write_timeout(Some(timeout));
        }
        MaybeTlsStream::Rustls(stream) => {
            let _ = stream.sock.set_write_timeout(Some(timeout));
        }
        #[allow(unreachable_patterns)]
        _ => {}
    }
}

/// Map a tungstenite error to [`DiscordError::GatewayTransport`].
fn ws_err(error: tungstenite::Error) -> DiscordError {
    DiscordError::GatewayTransport(error.to_string())
}

/// Wire frame as received from the gateway.
#[derive(Deserialize)]
struct Frame {
    op: u8,
    #[serde(default)]
    d: serde_json::Value,
    #[serde(default)]
    s: Option<u64>,
    #[serde(default)]
    t: Option<String>,
}

/// `d` payload of a `READY` dispatch.
#[derive(Deserialize)]
struct ReadyDispatch {
    session_id: String,
    resume_gateway_url: String,
    user: ReadyUser,
}

/// `d` payload of a `MESSAGE_CREATE` dispatch.
#[derive(Deserialize)]
struct MessageCreateDispatch {
    id: String,
    channel_id: String,
    #[serde(default)]
    guild_id: Option<String>,
    author: MessageAuthor,
    #[serde(default)]
    content: String,
    #[serde(default)]
    timestamp: String,
}

/// Blocking Discord Gateway client.
///
/// Construct with [`GatewayClient::connect`]; then drive events with
/// [`GatewayClient::next_event`]. Heartbeats are sent automatically inside
/// `next_event`'s loop when `heartbeat_interval` elapses — there is no
/// background thread and no timer thread.
///
/// `&mut self` is required for event reads (the socket and sequence number
/// mutate). The token is never logged: [`fmt::Debug`] prints `token: "***"`.
pub struct GatewayClient {
    socket: WebSocket<MaybeTlsStream<TcpStream>>,
    gateway_url: String,
    token: String,
    intents: u32,
    session_id: Option<String>,
    resume_gateway_url: Option<String>,
    seq: Option<u64>,
    heartbeat_interval: Duration,
    last_heartbeat: Instant,
}

impl fmt::Debug for GatewayClient {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("GatewayClient")
            .field("gateway_url", &self.gateway_url)
            .field("token", &"***")
            .field("intents", &self.intents)
            .field("session_id", &self.session_id)
            .field("resume_gateway_url", &self.resume_gateway_url)
            .field("seq", &self.seq)
            .field("heartbeat_interval", &self.heartbeat_interval)
            .finish()
    }
}

impl GatewayClient {
    /// Connect to the gateway and complete the HELLO → IDENTIFY handshake.
    ///
    /// `gateway_url` is the `url` from `GET /gateway/bot` (it may or may not
    /// carry the query string — see module docs). `intents` is typically
    /// [`DEFAULT_INTENTS`].
    ///
    /// Waits up to [`crate::DEFAULT_TIMEOUT`] (~10 s) for op 10 HELLO after
    /// the WebSocket handshake. Sends op 2 IDENTIFY with
    /// `{ os: "linux", browser: "airi-qt", device: "airi-qt" }` properties.
    /// Returns once IDENTIFY has been sent; the READY dispatch is the first
    /// thing [`GatewayClient::next_event`] yields.
    ///
    /// # Errors
    ///
    /// * [`DiscordError::GatewayTransport`] — TCP/TLS/WebSocket failure or a
    ///   handshake that did not produce HELLO.
    /// * [`DiscordError::Decode`] — malformed HELLO frame, or an unexpected
    ///   first frame.
    /// * [`DiscordError::InvalidSession`] — op 9 before READY (the gateway
    ///   rejected the identify, e.g. disallowed intents).
    /// * [`DiscordError::Unauthorized`] — close code 4004 during handshake.
    pub fn connect(gateway_url: &str, token: &str, intents: u32) -> Result<Self, DiscordError> {
        let url = gateway_ws_url(gateway_url);
        let (socket, heartbeat_interval) = Self::handshake(&url)?;
        let mut client = Self {
            socket,
            gateway_url: url,
            token: token.to_string(),
            intents,
            session_id: None,
            resume_gateway_url: None,
            seq: None,
            heartbeat_interval,
            last_heartbeat: Instant::now(),
        };
        client.send_identify()?;
        Ok(client)
    }

    /// Re-establish the WebSocket against the URL used at [`GatewayClient::connect`]
    /// and wait for HELLO. **Preserves** `session_id` / `resume_gateway_url` /
    /// `seq` so a subsequent [`GatewayClient::resume`] can op 6 RESUME.
    ///
    /// Sends neither IDENTIFY nor RESUME — those are separate calls so the
    /// reconnect policy (backoff, jitter, give-up) stays with the caller.
    /// After `reconnect()`, either call [`GatewayClient::resume`] (if
    /// [`GatewayClient::session_id`] is `Some`) or discard the client and
    /// [`GatewayClient::connect`] afresh.
    ///
    /// # Errors
    ///
    /// Same as [`GatewayClient::connect`], minus the IDENTIFY step.
    pub fn reconnect(&mut self) -> Result<(), DiscordError> {
        let url = self.gateway_url.clone();
        let (socket, heartbeat_interval) = Self::handshake(&url)?;
        self.socket = socket;
        self.heartbeat_interval = heartbeat_interval;
        self.last_heartbeat = Instant::now();
        Ok(())
    }

    /// Send op 6 RESUME (`{ token, session_id, seq }`) to resume the session
    /// after a [`GatewayClient::reconnect`].
    ///
    /// If no `session_id` is stored (never reached READY), this is a no-op
    /// and the caller should build a fresh client with [`GatewayClient::connect`].
    /// The server answers with a `RESUMED` dispatch (surfaced by
    /// [`GatewayClient::next_event`] as [`GatewayEvent::Resumed`]) or op 9
    /// INVALID SESSION (surfaced as [`DiscordError::InvalidSession`]).
    ///
    /// # Errors
    ///
    /// [`DiscordError::GatewayTransport`] if the frame cannot be written.
    pub fn resume(&mut self) -> Result<(), DiscordError> {
        let Some(session_id) = self.session_id.clone() else {
            return Ok(());
        };
        let payload = json!({
            "op": OP_RESUME,
            "d": {
                "token": self.token,
                "session_id": session_id,
                "seq": self.seq,
            }
        });
        self.socket
            .send(Message::Text(payload.to_string()))
            .map_err(ws_err)?;
        Ok(())
    }

    /// Read the next gateway event, sending op 1 HEARTBEAT first if
    /// `heartbeat_interval` has elapsed since the last heartbeat.
    ///
    /// The socket read timeout is `heartbeat_interval`, so a silent connection
    /// wakes exactly when a heartbeat is due; unknown frames are logged at
    /// `debug` and skipped. op 11 HEARTBEAT_ACK is returned as
    /// [`GatewayEvent::HeartbeatAck`]. op 9 INVALID SESSION aborts with
    /// [`DiscordError::InvalidSession`]. A close code of 4004 maps to
    /// [`DiscordError::Unauthorized`]; any other close frame yields
    /// [`GatewayEvent::Closed`].
    ///
    /// # Errors
    ///
    /// * [`DiscordError::GatewayTransport`] — transport/frame failure.
    /// * [`DiscordError::Decode`] — a dispatch whose `d` does not match the
    ///   expected shape.
    /// * [`DiscordError::InvalidSession`] — op 9; `resumable` carries the
    ///   `d` boolean (`true` → op 6 RESUME may work, `false` → fresh IDENTIFY).
    /// * [`DiscordError::Unauthorized`] — close code 4004.
    pub fn next_event(&mut self) -> Result<GatewayEvent, DiscordError> {
        loop {
            self.maybe_heartbeat()?;

            let message = match self.socket.read() {
                Ok(message) => message,
                Err(tungstenite::Error::Io(io_err))
                    if matches!(
                        io_err.kind(),
                        io::ErrorKind::WouldBlock | io::ErrorKind::TimedOut
                    ) =>
                {
                    // Read timed out — the heartbeat is due (or was just sent); loop.
                    continue;
                }
                Err(error) => return Err(ws_err(error)),
            };

            match message {
                Message::Text(text) => {
                    let frame: Frame = serde_json::from_str(&text)
                        .map_err(|e| DiscordError::Decode(e.to_string()))?;
                    if let Some(event) = self.handle_frame(frame)? {
                        return Ok(event);
                    }
                }
                Message::Close(frame) => {
                    let code = frame.map(|f| u16::from(f.code));
                    if code == Some(CLOSE_AUTHENTICATION_FAILED) {
                        return Err(DiscordError::Unauthorized);
                    }
                    return Ok(GatewayEvent::Closed { code });
                }
                Message::Ping(payload) => {
                    // Discord does not normally ping, but answer anyway so the
                    // server never times us out for protocol reasons.
                    self.socket.send(Message::Pong(payload)).map_err(ws_err)?;
                }
                Message::Pong(_) => {}
                Message::Binary(_) => {
                    tracing::debug!("ignoring binary gateway frame");
                }
                Message::Frame(_) => {}
            }
        }
    }

    /// The session id issued in READY, or `None` before READY arrives.
    #[must_use]
    pub fn session_id(&self) -> Option<&str> {
        self.session_id.as_deref()
    }

    /// The `resume_gateway_url` issued in READY, or `None` before READY arrives.
    #[must_use]
    pub fn resume_gateway_url(&self) -> Option<&str> {
        self.resume_gateway_url.as_deref()
    }

    /// The sequence number of the last op 0 dispatch received, or `None` if
    /// none has been received yet. Used as `seq` in op 1 HEARTBEAT and op 6 RESUME.
    #[must_use]
    pub fn seq(&self) -> Option<u64> {
        self.seq
    }

    /// The heartbeat interval reported by the server in HELLO.
    #[must_use]
    pub fn heartbeat_interval(&self) -> Duration {
        self.heartbeat_interval
    }

    /// The intents this client identified with.
    #[must_use]
    pub fn intents(&self) -> u32 {
        self.intents
    }

    /// Open the socket, wait for HELLO, and return the socket + interval.
    fn handshake(
        url: &str,
    ) -> Result<(WebSocket<MaybeTlsStream<TcpStream>>, Duration), DiscordError> {
        let (mut socket, _response) = tungstenite::connect(url).map_err(ws_err)?;
        set_read_timeout(&mut socket, DEFAULT_TIMEOUT);
        set_write_timeout(&mut socket, DEFAULT_TIMEOUT);

        let message = socket.read().map_err(ws_err)?;
        match message {
            Message::Text(text) => {
                let frame: Frame =
                    serde_json::from_str(&text).map_err(|e| DiscordError::Decode(e.to_string()))?;
                match frame.op {
                    OP_HELLO => {
                        let interval_ms = frame
                            .d
                            .get("heartbeat_interval")
                            .and_then(serde_json::Value::as_u64)
                            .ok_or_else(|| {
                                DiscordError::Decode(
                                    "HELLO frame missing integer heartbeat_interval".to_string(),
                                )
                            })?;
                        let interval = Duration::from_millis(interval_ms);
                        set_read_timeout(&mut socket, interval);
                        Ok((socket, interval))
                    }
                    OP_INVALID_SESSION => Err(DiscordError::InvalidSession {
                        resumable: frame.d.as_bool().unwrap_or(false),
                    }),
                    other => Err(DiscordError::Decode(format!(
                        "expected HELLO (op 10), got op {other}"
                    ))),
                }
            }
            Message::Close(frame) => {
                let code = frame.map(|f| u16::from(f.code));
                if code == Some(CLOSE_AUTHENTICATION_FAILED) {
                    return Err(DiscordError::Unauthorized);
                }
                Err(DiscordError::GatewayTransport(format!(
                    "gateway closed during handshake (code {code:?})"
                )))
            }
            _ => Err(DiscordError::Decode(
                "expected a text HELLO frame from the gateway".to_string(),
            )),
        }
    }

    /// Send op 2 IDENTIFY.
    fn send_identify(&mut self) -> Result<(), DiscordError> {
        let payload = json!({
            "op": OP_IDENTIFY,
            "d": {
                "token": self.token,
                "intents": self.intents,
                "properties": {
                    "os": "linux",
                    "browser": "airi-qt",
                    "device": "airi-qt",
                },
            }
        });
        self.socket
            .send(Message::Text(payload.to_string()))
            .map_err(ws_err)?;
        Ok(())
    }

    /// Send a heartbeat if the interval has elapsed.
    fn maybe_heartbeat(&mut self) -> Result<(), DiscordError> {
        if self.heartbeat_interval.is_zero() {
            return Ok(());
        }
        if self.last_heartbeat.elapsed() >= self.heartbeat_interval {
            self.send_heartbeat()?;
        }
        Ok(())
    }

    /// Send op 1 HEARTBEAT with the last dispatch sequence number (or null).
    fn send_heartbeat(&mut self) -> Result<(), DiscordError> {
        let payload = json!({ "op": OP_HEARTBEAT, "d": self.seq });
        self.socket
            .send(Message::Text(payload.to_string()))
            .map_err(ws_err)?;
        self.last_heartbeat = Instant::now();
        Ok(())
    }

    /// Handle one parsed frame. Returns `Some(event)` if the caller should
    /// return the event, or `None` to keep looping (unknown frames).
    fn handle_frame(&mut self, frame: Frame) -> Result<Option<GatewayEvent>, DiscordError> {
        match frame.op {
            OP_DISPATCH => {
                if let Some(seq) = frame.s {
                    self.seq = Some(seq);
                }
                match frame.t.as_deref() {
                    Some("READY") => {
                        let ready: ReadyDispatch =
                            serde_json::from_value(frame.d).map_err(|e| {
                                DiscordError::Decode(format!("malformed READY dispatch: {e}"))
                            })?;
                        self.session_id = Some(ready.session_id.clone());
                        self.resume_gateway_url = Some(ready.resume_gateway_url.clone());
                        Ok(Some(GatewayEvent::Ready {
                            session_id: ready.session_id,
                            resume_gateway_url: ready.resume_gateway_url,
                            user: ready.user,
                        }))
                    }
                    Some("RESUMED") => Ok(Some(GatewayEvent::Resumed)),
                    Some("MESSAGE_CREATE") => {
                        let msg: MessageCreateDispatch =
                            serde_json::from_value(frame.d).map_err(|e| {
                                DiscordError::Decode(format!(
                                    "malformed MESSAGE_CREATE dispatch: {e}"
                                ))
                            })?;
                        Ok(Some(GatewayEvent::MessageCreate {
                            id: msg.id,
                            channel_id: msg.channel_id,
                            guild_id: msg.guild_id,
                            author: msg.author,
                            content: msg.content,
                            timestamp: msg.timestamp,
                        }))
                    }
                    Some(other) => {
                        tracing::debug!(t = %other, "ignoring unknown gateway dispatch");
                        Ok(None)
                    }
                    None => {
                        tracing::debug!("ignoring gateway dispatch without t");
                        Ok(None)
                    }
                }
            }
            OP_HEARTBEAT => {
                // Discord requests an immediate heartbeat.
                self.send_heartbeat()?;
                Ok(None)
            }
            OP_INVALID_SESSION => Err(DiscordError::InvalidSession {
                resumable: frame.d.as_bool().unwrap_or(false),
            }),
            OP_HELLO => {
                // A second HELLO mid-session: adopt the new interval if valid.
                if let Some(ms) = frame
                    .d
                    .get("heartbeat_interval")
                    .and_then(serde_json::Value::as_u64)
                {
                    self.heartbeat_interval = Duration::from_millis(ms);
                    set_read_timeout(&mut self.socket, self.heartbeat_interval);
                }
                tracing::debug!("received HELLO mid-session");
                Ok(None)
            }
            OP_HEARTBEAT_ACK => Ok(Some(GatewayEvent::HeartbeatAck)),
            OP_RECONNECT => {
                // op 7 — Discord asks us to reconnect. Reported via debug log;
                // the caller decides when/how to reconnect.
                tracing::debug!("gateway requested reconnect (op 7)");
                Ok(None)
            }
            other => {
                tracing::debug!(op = other, "ignoring unknown gateway op");
                Ok(None)
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::gateway_ws_url;

    #[test]
    fn appends_query_to_bare_host() {
        assert_eq!(
            gateway_ws_url("wss://gateway.discord.gg"),
            "wss://gateway.discord.gg/?v=10&encoding=json"
        );
    }

    #[test]
    fn appends_query_after_trailing_slash() {
        assert_eq!(
            gateway_ws_url("wss://gateway.discord.gg/"),
            "wss://gateway.discord.gg/?v=10&encoding=json"
        );
    }

    #[test]
    fn keeps_existing_query_verbatim() {
        assert_eq!(
            gateway_ws_url("wss://gateway.discord.gg/?v=10&encoding=json"),
            "wss://gateway.discord.gg/?v=10&encoding=json"
        );
    }

    #[test]
    fn inserts_slash_for_pathless_query_url() {
        assert_eq!(
            gateway_ws_url("ws://127.0.0.1:8080?v=10&encoding=json"),
            "ws://127.0.0.1:8080/?v=10&encoding=json"
        );
    }
}
