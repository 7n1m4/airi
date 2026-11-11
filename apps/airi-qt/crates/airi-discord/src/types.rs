// SPDX-License-Identifier: GPL-3.0-or-later

//! Typed (de)serialization structs for the Discord v10 REST API.
//!
//! These are deliberately minimal — only the fields AIRI consumes — and
//! ignore unknown fields, so Discord adding new keys never breaks decoding.

use serde::Deserialize;

/// Session start limit reported by `GET /gateway/bot`.
///
/// Discord meters how often a bot may identify to the gateway; this is the
/// budget for that. Relevant once (if) the gateway WebSocket lands — a REST
/// client never consumes session starts, but the call is the cheapest way to
/// validate a token end-to-end.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
pub struct SessionStartLimit {
    /// Maximum session starts per `reset_after` window.
    pub total: u32,
    /// Session starts remaining in the current window.
    pub remaining: u32,
    /// Milliseconds until the limit resets (Discord sends an integer).
    pub reset_after: u64,
    /// Maximum concurrent gateway identify calls (shards to identify at once).
    pub max_concurrency: u32,
}

/// Response of `GET /gateway/bot`.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
pub struct GatewayBot {
    /// The gateway WebSocket URL to connect to, e.g. `wss://gateway.discord.gg`.
    /// Recorded for completeness; this crate does not open the connection.
    pub url: String,
    /// Recommended number of shards for this bot.
    pub shards: u32,
    /// The session start budget for this bot.
    pub session_start_limit: SessionStartLimit,
}

/// The bot user as returned by `GET /users/@me`.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
pub struct BotUser {
    /// The bot's user id (snowflake).
    pub id: String,
    /// The bot's username.
    pub username: String,
    /// Legacy discriminator; `"0"` for migrated accounts. Defaults to empty
    /// if Discord omits it.
    #[serde(default)]
    pub discriminator: String,
    /// The bot's display name, if set.
    #[serde(default)]
    pub display_name: Option<String>,
    /// Avatar hash, if the bot has a custom avatar.
    #[serde(default)]
    pub avatar: Option<String>,
    /// Always `true` for bot tokens; kept for clarity at call sites.
    #[serde(default)]
    pub bot: bool,
}

/// Minimal message shape returned by `POST /channels/{id}/messages`.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
pub struct Message {
    /// The message id (snowflake).
    pub id: String,
    /// The channel the message was posted to.
    pub channel_id: String,
    /// The content that was sent (echoed by Discord).
    pub content: String,
    /// ISO-8601 timestamp as sent by Discord. Kept as an opaque string —
    /// the workspace has no chrono dependency and none is needed here.
    pub timestamp: String,
}

/// Minimal channel shape returned by `GET /channels/{id}`.
///
/// `channel_type` is the raw Discord channel type byte (0 = GUILD_TEXT,
/// 1 = DM, 2 = GUILD_VOICE, 3 = GROUP_DM, 4 = GUILD_CATEGORY, 5 = GUILD_ANNOUNCEMENT,
/// 10/11/12 = thread types, 13 = GUILD_STAGE_VOICE, 15 = GUILD_FORUM, …).
/// It is intentionally **not** an enum — the full set has 30+ values and
/// grows; unknown types must decode fine, so a raw `u8` is used.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
pub struct Channel {
    /// The channel id (snowflake).
    pub id: String,
    /// Raw Discord channel type byte (see struct docs).
    #[serde(rename = "type")]
    pub channel_type: u8,
    /// Channel name. Absent for DM channels and some group DMs.
    #[serde(default)]
    pub name: Option<String>,
    /// Channel topic, if set (text/forum channels).
    #[serde(default)]
    pub topic: Option<String>,
    /// Channel position within its category/guild, if applicable.
    #[serde(default)]
    pub position: Option<u32>,
}
