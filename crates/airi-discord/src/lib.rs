// SPDX-License-Identifier: GPL-3.0-or-later
#![deny(missing_docs)]

//! `airi-discord` — Discord bot for the Slint build: a blocking REST slice
//! **plus a blocking Gateway (WebSocket) client**.
//!
//! The REST half is a synchronous (`reqwest::blocking`) client for the
//! Discord HTTP API, authenticated with a bot token, covering exactly the
//! calls AIRI's Slint settings page needs to go
//! from "disabled scaffold" to "can talk to Discord on demand":
//!
//! * [`DiscordRestClient::get_gateway_url`] — `GET /gateway/bot` (the gateway
//!   WebSocket URL [`GatewayClient::connect`] dials, and how many session
//!   starts remain).
//! * [`DiscordRestClient::get_current_bot_user`] — `GET /users/@me`.
//! * [`DiscordRestClient::send_message`] — `POST /channels/{channel_id}/messages`.
//! * [`DiscordRestClient::get_channel`] — `GET /channels/{channel_id}`.
//!
//! The gateway half ([`GatewayClient`], added wave ⑧) is a blocking
//! `tungstenite` WebSocket client implementing the HELLO → IDENTIFY →
//! heartbeat handshake, dispatch decoding (`READY`, `RESUMED`,
//! `MESSAGE_CREATE`), caller-driven resume (op 6) and reconnect. It never
//! spawns threads; automatic reconnect/backoff is the caller's loop. See
//! `docs/phase-notes/p9-lane-discord-gateway-ws.md`.
//!
//! **The the Slint app must never auto-connect to the gateway** — receiving is
//! opt-in (e.g. behind a `--gateway` flag), and every outbound action stays
//! human-in-the-loop.
//!
//! # Self-hosted proxies and tests
//!
//! [`DiscordRestClient::with_base_url`] injects the base URL. It defaults to
//! `https://discord.com/api/v10` ([`DEFAULT_BASE_URL`]) and exists so tests can
//! point the client at a local mock (mockito), and so self-hosted reverse
//! proxies / Discohook-style proxies of the Discord API can be used instead of
//! `discord.com`. Nothing in this crate ever targets `discord.gg`.
//!
//! # Token handling (security posture)
//!
//! * The bot token is stored as a plain [`String`] inside the client and sent
//!   as `Authorization: Bot <token>` on every request. It is **never** logged,
//!   never included in error values, and [`DiscordRestClient`]'s [`Debug`]
//!   implementation prints `token: "***"` instead of the token.
//! * Errors from the HTTP layer carry status codes and truncated response
//!   bodies only (Discord error bodies do not contain the token).
//! * There is deliberately no way to extract the token back out of the client
//!   (no accessor); moving it out means moving the whole client.
//! * The gateway client ([`GatewayClient`]) likewise stores the token as a
//!   plain [`String`]; it travels only inside IDENTIFY/RESUME JSON payloads,
//!   never in the URL or headers, is covered by the same redacted [`Debug`]
//!   pattern, and is never echoed into any error value.
//!
//! # Rate limiting
//!
//! Every response (success or error) has its `X-RateLimit-Remaining` and
//! `X-RateLimit-Reset-After` headers captured into
//! [`DiscordRestClient::last_rate_limit`] (last-seen wins). Note that Discord's
//! rate-limit headers describe the bucket the request touched; this crate does
//! **not** retry automatically, does **not** queue, and does **not** enforce
//! the limit client-side — it reports, the caller decides. A `429` response is
//! surfaced as [`DiscordError::RateLimited`] with the `retry_after` duration
//! and `global` flag parsed from the documented JSON body
//! (`{ "message", "retry_after", "global" }`), falling back to the
//! `X-RateLimit-Reset-After` header if the body cannot be parsed.
//!
//! # Human in the loop
//!
//! This client is a dumb pipe. It never sends a message on its own, never
//! polls, and has no background thread. Wiring it to AIRI (page token field →
//! bridge → client, command dispatch, inbound relay) must keep sending
//! human-initiated: AIRI may act on a Discord message only when the user has
//! explicitly asked for it, per the project's human-in-the-loop posture.

mod client;
mod error;
mod gateway;
mod types;

pub use client::{DiscordRestClient, RateLimit, DEFAULT_BASE_URL, DEFAULT_TIMEOUT};
pub use error::DiscordError;
pub use gateway::{GatewayClient, GatewayEvent, MessageAuthor, ReadyUser, DEFAULT_INTENTS};
pub use types::{BotUser, Channel, GatewayBot, Message, SessionStartLimit};
