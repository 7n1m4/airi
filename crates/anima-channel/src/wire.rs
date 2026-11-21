// SPDX-License-Identifier: GPL-3.0-or-later

//! Rust-canonical wire types for the `airi-channel` gateway protocol
//! (D2: Rust owns the schema; TS imports the generated definitions).
//!
//! These types describe every frame the channel server speaks today. They
//! are load-bearing — [`crate::session`] serializes these instead of
//! hand-built `json!` values — and they are exported to TypeScript by the
//! `export-wire-types` example (`cargo run -p airi-channel --example export-wire-types`),
//! which writes `packages/server-shared/src/types/generated/airi-channel.ts`.
//! The generated file is checked in; CI fails if it drifts from these types
//! (`--check`).
//!
//! ## Scope
//!
//! This is the **Rust-spoken** slice of the protocol: the auth handshake,
//! ping/pong, heartbeat mirror, and the `rpc` request/reply family with the
//! stable `rpc_*` error codes. The plugin-protocol envelope
//! (`WebSocketBaseEvent` + `metadata`) used by module-protocol traffic is
//! **not** modelled here yet; when the gateway serves module-protocol events
//! the envelope becomes canonical in a follow-up slice and the generated
//! file grows with it.
//!
//! ## Field naming
//!
//! Wire names match the existing Electron/Bun gateway exactly (e.g.
//! `authToken`, `uptimeSeconds`, `sessionStartedMs`). Optional fields use
//! `skip_serializing_if = "Option::is_none"` so `None` omits the key rather
//! than emitting `null`, matching the hand-built frames this module
//! replaces.
//!
//! ## Wave 0 — server-initiated event lane (ADR-in-code: beads airi-22i.1/.2)
//!
//! The protocol gains ONE additive, server→client frame family. No existing
//! frame, RPC action, auth rule or error code changes, so the version string
//! stays `airi-channel/1` (see [`crate::dispatch::PROTOCOL`]). This section is
//! the recorded spike decision; implementation detail lives in
//! [`crate::event_bus`].
//!
//! - **Frame shape.** `{"type":"event","topic":"lip_sync.rms","data":{…},"id"?:…}`.
//!   `topic` is one of the stable dotted names in [`EventTopic`]; `data` is a
//!   typed, untagged [`EventPayload`] selected by `topic`; `id` is an optional
//!   publisher-supplied correlation token echoed verbatim (same rule as
//!   `rpc.id`). Clients never send `event` frames — the lane is one-way
//!   daemon→client (design contract invariant 3).
//! - **Subscription & correlation.** Clients opt in with the `event.subscribe`
//!   / `event.unsubscribe` RPC actions, payload `{"topics":["…","…"]}`. The
//!   default is NO subscriptions, so existing Vue/Electrobun clients see no
//!   new frames. The reply carries the resulting topic set. Per-event `id`
//!   correlates an event to a producer-side request (e.g. a chat turn); the
//!   gateway never invents one.
//! - **Ordering.** Each connection lane is FIFO in bus-publication order; the
//!   bus serializes publishers behind one lock. Event frames may interleave
//!   with RPC replies on the socket (each is a complete WS text frame), so the
//!   only promise is per-lane publication order — no cross-topic or
//!   cross-connection ordering guarantee.
//! - **Backpressure.** Every connection owns a bounded lane
//!   ([`crate::event_bus::DEFAULT_LANE_CAPACITY`]); overflow drops the oldest
//!   buffered event, preferring to evict high-rate `lip_sync.rms` /
//!   `token.delta` samples so low-rate control events survive. Publishing only
//!   touches in-memory queues and never blocks on a client socket; the
//!   connection thread drains its own lane. Memory is bounded by
//!   `lanes × capacity`.
//! - **Close / error.** Event frames are post-auth only: a lane is drained
//!   only after the handshake, and anything queued before auth is discarded on
//!   success. Unknown subscribe topics get `rpc_bad_topic`; a malformed
//!   `topics` field gets `rpc_bad_topics`. Events never close a connection —
//!   the existing close codes (1008 auth, 1001 dead peer, 1002/1003/1009
//!   frame errors) are unchanged.
//! - **Emotion cues are renderer-neutral.** `emotion.tag` carries `kind`
//!   (`emotion | motion | vfx`) and an optional `duration_ms`, plus a
//!   normalized `tag` (raw model-specific pass-through is allowed). No morph
//!   names, `.exp3` paths, blend modes or DSL opcodes cross the wire — each
//!   renderer derives those from card/model metadata. This also fixes the TS
//!   host bug where a motion cue was treated as a facial morph.
//! - **Why JSON / reuse.** MessagePack and UDS are parked (design decision 9):
//!   a second codec would force new bindings for three languages with no
//!   measurement to justify it. Reusing `anima-channel` keeps auth, TLS, the
//!   D-Bus control plane and the specta→TS drift check in one place — the
//!   event lane is simply another typed frame on the same WS connection.

use serde::{Deserialize, Serialize};
use serde_json::Value;

/// Wire kind of a heartbeat frame's `data.kind` field.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "lowercase")]
pub enum HeartbeatKind {
    /// Client heartbeats with kind `ping`; mirrored back as `pong`.
    Ping,
    /// Server reply to a `ping` heartbeat.
    Pong,
}

/// `data` payload of a `transport:connection:heartbeat` frame.
///
/// Client→server heartbeats carry only `kind`; server→client pongs carry
/// `kind`, `message` (the 💛 mirror) and `at` (unix millis). The fields are
/// optional so the one type covers both directions.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, specta::Type)]
pub struct HeartbeatData {
    /// `ping` or `pong`.
    pub kind: HeartbeatKind,
    /// Present on server→client pongs only: the 💛 mirror marker.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub message: Option<String>,
    /// Present on server→client pongs only: unix epoch milliseconds.
    #[serde(skip_serializing_if = "Option::is_none")]
    #[specta(type = specta_typescript::Number)]
    pub at: Option<u64>,
}

/// `data` payload of the `module:authenticate` handshake frame
/// (server-runtime mirror shape).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, specta::Type)]
pub struct ModuleAuthData {
    /// The shared gateway auth token.
    pub token: String,
}

/// `data` payload of the `module:authenticated` reply frame.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, specta::Type)]
pub struct AuthenticatedData {
    /// Always `true` on success; only success is ever sent.
    pub authenticated: bool,
}

/// The `error` object carried by `error` frames and failing `rpc` replies.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, specta::Type)]
pub struct RpcErrorObject {
    /// Stable machine-readable code (e.g. `rpc_unknown_method`,
    /// `invalid_token`). Never carries user or handler internals.
    pub code: String,
    /// Human-readable detail. For RPC failures this is a fixed or
    /// sanitized message; never stack data.
    pub message: String,
}

/// `data` payload of a `runtime.ping` reply.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, specta::Type)]
pub struct RuntimePingReply {
    /// Always `true`.
    pub pong: bool,
    /// Server unix epoch seconds at ping time.
    #[specta(type = specta_typescript::Number)]
    pub time: u64,
    /// Seconds since the gateway server started.
    #[serde(rename = "uptimeSeconds")]
    #[specta(type = specta_typescript::Number)]
    pub uptime_seconds: u64,
}

/// `data` payload of a `runtime.status` reply.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, specta::Type)]
pub struct RuntimeStatusReply {
    /// Application name (e.g. `airi-slint`).
    pub app: String,
    /// Crate version the gateway was built from.
    pub version: String,
    /// OS process id of the gateway server.
    pub pid: u32,
    /// Seconds since the gateway server started.
    #[serde(rename = "uptimeSeconds")]
    #[specta(type = specta_typescript::Number)]
    pub uptime_seconds: u64,
    /// Protocol identifier ([`crate::dispatch::PROTOCOL`]).
    pub protocol: String,
}

/// `data` payload of a `core.status` reply (read-only, additive).
///
/// Carries only coarse, secret-free health information. It MUST NOT contain
/// auth tokens, D-Bus tokens, provider configs, API keys, secrets, prompts,
/// secret-revealing paths, or raw memory.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, specta::Type)]
pub struct CoreStatusReply {
    /// Application name (e.g. `airi-daemon`).
    pub app: String,
    /// Crate version the daemon was built from.
    pub version: String,
    /// Whether the core service is available.
    #[serde(rename = "coreAvailable")]
    pub core_available: bool,
    /// Whether the underlying store is available.
    #[serde(rename = "storeAvailable")]
    pub store_available: bool,
    /// Coarse store health (`"ok"` or `"unavailable"`).
    #[serde(rename = "storeHealth")]
    pub store_health: String,
    /// Protocol identifier.
    pub protocol: String,
    /// Coarse count of persisted sessions.
    #[serde(rename = "sessionCount")]
    #[specta(type = specta_typescript::Number)]
    pub session_count: u64,
    /// Coarse count of persisted messages.
    #[serde(rename = "messageCount")]
    #[specta(type = specta_typescript::Number)]
    pub message_count: u64,
}

/// `data` payload of a `providers.list` reply.
///
/// Lists configured LLM providers (metadata only, no secrets). The `apiKey`
/// field is NEVER included in this reply — it is write-only via `providers.set`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct ProvidersListReply {
    /// List of provider metadata (no secrets).
    pub providers: Vec<ProviderInfo>,
}

/// Provider metadata (no secrets).
///
/// This type NEVER contains `apiKey`, `secret`, `token`, or `config` fields.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct ProviderInfo {
    /// Provider identifier (e.g. `openai`, `llama-cpp-local`).
    pub id: String,
    /// Provider kind tag (`openai`, `llama-cpp`, etc.).
    pub kind: String,
    /// Model name (empty string if not configured).
    pub model: String,
    /// Base URL (empty string if using default).
    pub base_url: String,
    /// Whether this provider is active.
    pub enabled: bool,
    /// Unix milliseconds of last update.
    pub updated_at: i32,
}

/// `data` payload of a `settings.get` reply.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct SettingsGetReply {
    /// Settings section name.
    pub section: String,
    /// Settings data as JSON string.
    pub settings: String,
}

/// `data` payload of a `settings.set` reply.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, specta::Type)]
pub struct SettingsSetReply {
    /// Whether the save succeeded.
    pub ok: bool,
}

/// `data` payload of a `vault.status` reply.
///
/// Vault statistics (counts and byte sizes only, no secret material).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct VaultStatusReply {
    /// Whether the vault is available.
    pub available: bool,
    /// Vault statistics.
    pub stats: Option<VaultStatsData>,
}

/// Vault statistics data.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct VaultStatsData {
    /// Chat domain statistics.
    pub chats: DomainStatsData,
    /// Memory domain statistics.
    pub memory: MemoryStatsData,
    /// Provider domain statistics.
    pub providers: ProviderStatsData,
    /// Character domain statistics.
    pub characters: CharacterStatsData,
}

/// Chat domain statistics.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct DomainStatsData {
    /// Number of sessions.
    pub sessions: u32,
    /// Number of messages.
    pub messages: u32,
    /// Total bytes.
    pub bytes: u32,
}

/// Memory domain statistics.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct MemoryStatsData {
    /// Number of summaries.
    pub summaries: u32,
    /// Number of journal entries.
    pub journal_entries: u32,
    /// Total bytes.
    pub bytes: u32,
}

/// Provider domain statistics.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct ProviderStatsData {
    /// Number of providers.
    pub count: u32,
    /// Total bytes.
    pub bytes: u32,
}

/// Character domain statistics.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct CharacterStatsData {
    /// Number of characters.
    pub count: u32,
    /// Total bytes.
    pub bytes: u32,
}


/// `data` payload of a `gateway.config` reply.
///
/// Never includes the auth token — the token stays server-side.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, specta::Type)]
pub struct GatewayConfigReply {
    /// Hostname or address the gateway is bound to.
    pub hostname: String,
    /// Port the gateway is listening on.
    pub port: u16,
}

/// `data` payload of a `gateway.auth` reply.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, specta::Type)]
pub struct GatewayAuthReply {
    /// Always `true` (only authenticated sessions can ask).
    pub authenticated: bool,
    /// Session start time, unix epoch milliseconds.
    #[serde(rename = "sessionStartedMs")]
    #[specta(type = specta_typescript::Number)]
    pub session_started_ms: u64,
}

/// Stable topic name carried by a server-initiated `event` frame.
///
/// The dotted wire names are fixed in protocol version 1; adding a variant is
/// additive. Subscribe/unsubscribe RPC actions send these strings verbatim.
#[derive(
    Debug, Clone, Copy, PartialEq, Eq, Hash, PartialOrd, Ord, Serialize, Deserialize, specta::Type,
)]
pub enum EventTopic {
    /// One RMS amplitude sample for a speaking actor (~15–40 Hz in-tree).
    #[serde(rename = "lip_sync.rms")]
    LipSyncRms,
    /// A discrete emotion label for an actor.
    #[serde(rename = "emotion.tag")]
    EmotionTag,
    /// One streamed assistant token (or the final marker) for a chat turn.
    #[serde(rename = "token.delta")]
    TokenDelta,
    /// A presence/connectivity transition.
    #[serde(rename = "presence.changed")]
    PresenceChanged,
    /// Coarse, secret-free core health change.
    #[serde(rename = "status.changed")]
    StatusChanged,
}

impl EventTopic {
    /// Every topic in the initial vocabulary, in wire order.
    pub const ALL: &'static [EventTopic] = &[
        EventTopic::LipSyncRms,
        EventTopic::EmotionTag,
        EventTopic::TokenDelta,
        EventTopic::PresenceChanged,
        EventTopic::StatusChanged,
    ];

    /// Stable dotted wire name.
    pub fn as_str(self) -> &'static str {
        match self {
            EventTopic::LipSyncRms => "lip_sync.rms",
            EventTopic::EmotionTag => "emotion.tag",
            EventTopic::TokenDelta => "token.delta",
            EventTopic::PresenceChanged => "presence.changed",
            EventTopic::StatusChanged => "status.changed",
        }
    }

    /// True for high-rate sample topics that may be coalesced/dropped first.
    pub fn is_realtime(self) -> bool {
        matches!(self, EventTopic::LipSyncRms | EventTopic::TokenDelta)
    }

    /// True for low-rate control topics that are queued in preference to
    /// realtime samples when a bounded lane fills up.
    pub fn is_control(self) -> bool {
        !self.is_realtime()
    }
}

impl std::fmt::Display for EventTopic {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(self.as_str())
    }
}

impl std::str::FromStr for EventTopic {
    type Err = ();

    fn from_str(s: &str) -> Result<Self, Self::Err> {
        match s {
            "lip_sync.rms" => Ok(EventTopic::LipSyncRms),
            "emotion.tag" => Ok(EventTopic::EmotionTag),
            "token.delta" => Ok(EventTopic::TokenDelta),
            "presence.changed" => Ok(EventTopic::PresenceChanged),
            "status.changed" => Ok(EventTopic::StatusChanged),
            _ => Err(()),
        }
    }
}

/// Broad class of an `emotion.tag` cue.
///
/// The TS host historically mis-routed a *motion* cue into a facial morph.
/// Carrying the class on the wire lets every renderer (Godot, Vue, Flutter)
/// dispatch correctly without embedding morph names, `.exp3` paths, blend
/// modes or DSL opcodes in the daemon protocol — those stay in card/model
/// metadata. `motion` and `vfx` MUST NOT be treated as facial expressions.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "lowercase")]
pub enum CueKind {
    /// Facial expression / emotion key (the common case).
    Emotion,
    /// Body motion cue — not a facial morph.
    Motion,
    /// Visual effect cue — not a facial morph.
    Vfx,
}

/// Normalized emotion keys used by `emotion.tag` when `kind` is
/// [`CueKind::Emotion`]. Renderers share the first nine; `cool` is in the
/// canonical union but is not implemented by every renderer. Raw,
/// model-specific pass-through tags are allowed for card-specific cues.
pub const CANONICAL_EMOTION_KEYS: &'static [&'static str] = &[
    "happy",
    "sad",
    "angry",
    "surprised",
    "think",
    "awkward",
    "question",
    "curious",
    "neutral",
    "cool",
];

/// Payload of a `lip_sync.rms` event: one amplitude sample in `[0, 1]`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, specta::Type)]
pub struct LipSyncRmsData {
    /// Character/actor id the sample belongs to.
    pub actor_id: String,
    /// RMS level, clamped to `[0, 1]` by the producer.
    #[specta(type = specta_typescript::Number)]
    pub level: f32,
    /// Monotonic publication sequence (stamped by the bus).
    #[specta(type = specta_typescript::Number)]
    pub seq: u64,
    /// Producer timestamp, unix epoch milliseconds (stamped by the bus).
    #[specta(type = specta_typescript::Number)]
    pub ts_ms: u64,
}

/// Payload of an `emotion.tag` event: a discrete emotion for an actor.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, specta::Type)]
pub struct EmotionTagData {
    /// Character/actor id the tag belongs to.
    pub actor_id: String,
    /// Normalized emotion key (see [`CANONICAL_EMOTION_KEYS`]) or a raw,
    /// model-specific pass-through tag. Never a morph name or DSL command.
    pub tag: String,
    /// Broad cue class; `motion`/`vfx` must not be mapped to facial morphs.
    pub kind: CueKind,
    /// Strength of the cue in `[0, 1]`.
    #[specta(type = specta_typescript::Number)]
    pub intensity: f32,
    /// Optional return-to-neutral duration in milliseconds; `None` lets the
    /// renderer use its own default decay.
    #[serde(skip_serializing_if = "Option::is_none")]
    #[specta(type = specta_typescript::Number)]
    pub duration_ms: Option<u64>,
    /// Monotonic publication sequence (stamped by the bus).
    #[specta(type = specta_typescript::Number)]
    pub seq: u64,
    /// Producer timestamp, unix epoch milliseconds (stamped by the bus).
    #[specta(type = specta_typescript::Number)]
    pub ts_ms: u64,
}

/// Payload of a `token.delta` event: one streamed LLM token.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, specta::Type)]
pub struct TokenDeltaData {
    /// Chat session id the turn belongs to.
    pub session_id: String,
    /// Message id the token stream belongs to.
    pub message_id: String,
    /// Raw token text (may be empty only on the terminal event).
    pub delta: String,
    /// Zero-based token index within the turn.
    #[specta(type = specta_typescript::Number)]
    pub index: u64,
    /// `true` on the final token of the turn. Wire name is `final`; Rust
    /// cannot use the reserved keyword as a field name.
    #[serde(rename = "final")]
    pub final_: bool,
    /// Monotonic publication sequence (stamped by the bus).
    #[specta(type = specta_typescript::Number)]
    pub seq: u64,
    /// Producer timestamp, unix epoch milliseconds (stamped by the bus).
    #[specta(type = specta_typescript::Number)]
    pub ts_ms: u64,
}

/// Payload of a `presence.changed` event: a connectivity/availability change.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, specta::Type)]
pub struct PresenceChangedData {
    /// Subject whose presence changed (actor id, service name, …).
    pub subject: String,
    /// New coarse state (e.g. `online`, `away`, `offline`).
    pub state: String,
    /// Monotonic publication sequence (stamped by the bus).
    #[specta(type = specta_typescript::Number)]
    pub seq: u64,
    /// Producer timestamp, unix epoch milliseconds (stamped by the bus).
    #[specta(type = specta_typescript::Number)]
    pub ts_ms: u64,
}

/// Payload of a `status.changed` event: coarse, secret-free core health.
///
/// Mirrors the [`CoreStatusReply`] discipline: it MUST NOT carry auth tokens,
/// D-Bus tokens, provider configs, API keys, prompts, secret-revealing paths or
/// raw memory.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, specta::Type)]
pub struct StatusChangedData {
    /// Whether the core service is available.
    pub core_available: bool,
    /// Whether the underlying store is available.
    pub store_available: bool,
    /// Coarse store health (`"ok"` or `"unavailable"`).
    pub store_health: String,
    /// Monotonic publication sequence (stamped by the bus).
    #[specta(type = specta_typescript::Number)]
    pub seq: u64,
    /// Producer timestamp, unix epoch milliseconds (stamped by the bus).
    #[specta(type = specta_typescript::Number)]
    pub ts_ms: u64,
}

/// Typed payload of a `event` frame. Variants are `serde(untagged)` so the
/// payload serializes as a flat JSON object; each payload struct has at least
/// one unique required field, making deserialization unambiguous by shape.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, specta::Type)]
#[serde(untagged)]
pub enum EventPayload {
    /// A `lip_sync.rms` sample.
    LipSyncRms(LipSyncRmsData),
    /// An `emotion.tag` label.
    EmotionTag(EmotionTagData),
    /// A `token.delta` stream token.
    TokenDelta(TokenDeltaData),
    /// A `presence.changed` transition.
    PresenceChanged(PresenceChangedData),
    /// A `status.changed` health update.
    StatusChanged(StatusChangedData),
}

impl EventPayload {
    /// Topic this payload belongs to.
    pub fn topic(&self) -> EventTopic {
        match self {
            EventPayload::LipSyncRms(_) => EventTopic::LipSyncRms,
            EventPayload::EmotionTag(_) => EventTopic::EmotionTag,
            EventPayload::TokenDelta(_) => EventTopic::TokenDelta,
            EventPayload::PresenceChanged(_) => EventTopic::PresenceChanged,
            EventPayload::StatusChanged(_) => EventTopic::StatusChanged,
        }
    }

    /// Overwrite the payload's monotonic sequence (used by the bus).
    pub fn set_seq(&mut self, seq: u64) {
        match self {
            EventPayload::LipSyncRms(d) => d.seq = seq,
            EventPayload::EmotionTag(d) => d.seq = seq,
            EventPayload::TokenDelta(d) => d.seq = seq,
            EventPayload::PresenceChanged(d) => d.seq = seq,
            EventPayload::StatusChanged(d) => d.seq = seq,
        }
    }

    /// Overwrite the payload's source timestamp (used by the bus).
    pub fn set_ts_ms(&mut self, ts_ms: u64) {
        match self {
            EventPayload::LipSyncRms(d) => d.ts_ms = ts_ms,
            EventPayload::EmotionTag(d) => d.ts_ms = ts_ms,
            EventPayload::TokenDelta(d) => d.ts_ms = ts_ms,
            EventPayload::PresenceChanged(d) => d.ts_ms = ts_ms,
            EventPayload::StatusChanged(d) => d.ts_ms = ts_ms,
        }
    }
}

/// A server-initiated event value: topic, typed payload and optional
/// correlation id. The bus stamps `seq`/`ts_ms` into the payload on publish.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, specta::Type)]
pub struct GatewayEvent {
    /// Stable topic selecting the payload shape.
    pub topic: EventTopic,
    /// Typed payload matching `topic`.
    pub data: EventPayload,
    /// Optional producer correlation id, echoed verbatim to clients.
    #[serde(skip_serializing_if = "Option::is_none")]
    #[specta(type = specta_typescript::Unknown)]
    pub id: Option<Value>,
}

impl GatewayEvent {
    /// Build an event from a topic and matching payload (no correlation id).
    pub fn new(topic: EventTopic, data: EventPayload) -> Self {
        Self {
            topic,
            data,
            id: None,
        }
    }

    /// Attach a producer correlation id, echoed verbatim to clients.
    pub fn with_id(mut self, id: Value) -> Self {
        self.id = Some(id);
        self
    }
}

/// Reply of `event.subscribe` / `event.unsubscribe`: the resulting topic set.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, specta::Type)]
pub struct EventSubscriptionReply {
    /// Topics the session is subscribed to after the action, in wire order.
    pub topics: Vec<EventTopic>,
}

/// A client→server text frame. Internally tagged on `type`, exactly as the
/// gateway has always spoken.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, specta::Type)]
#[serde(tag = "type")]
pub enum GatewayClientFrame {
    /// Simple auth shape: `{ "type": "auth", "authToken": "…" }`.
    #[serde(rename = "auth")]
    Auth {
        /// The shared gateway auth token.
        #[serde(rename = "authToken")]
        auth_token: String,
    },
    /// Server-runtime mirror shape:
    /// `{ "type": "module:authenticate", "data": { "token": "…" } }`.
    #[serde(rename = "module:authenticate")]
    ModuleAuthenticate {
        /// Handshake payload carrying the token.
        data: ModuleAuthData,
    },
    /// Liveness probe: `{ "type": "ping" }` → server replies `pong`.
    #[serde(rename = "ping")]
    Ping,
    /// Gateway heartbeat mirror. Only kind `ping` receives a reply.
    #[serde(rename = "transport:connection:heartbeat")]
    Heartbeat {
        /// Heartbeat payload; kind is `ping` on the wire from clients.
        data: HeartbeatData,
    },
    /// Typed RPC request. `id`, when present, is echoed verbatim in the
    /// reply; `payload`, when absent, is treated as `{}` by dispatch.
    #[serde(rename = "rpc")]
    Rpc {
        /// RPC method, e.g. `runtime.status` or `renderer.info`.
        action: String,
        /// Arbitrary JSON payload; must be an object (or absent) to pass
        /// dispatch validation.
        #[serde(skip_serializing_if = "Option::is_none")]
        #[specta(type = specta_typescript::Unknown)]
        payload: Option<Value>,
        /// Client-chosen echo identifier; any JSON value, verbatim.
        #[serde(skip_serializing_if = "Option::is_none")]
        #[specta(type = specta_typescript::Unknown)]
        id: Option<Value>,
    },
}

/// A server→client text frame. Internally tagged on `type`, exactly as the
/// gateway has always spoken.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, specta::Type)]
#[serde(tag = "type")]
pub enum GatewayServerFrame {
    /// Reply to the simple auth shape: `{ "type": "auth", "ok": true }`.
    /// Only success is ever sent.
    #[serde(rename = "auth")]
    Auth {
        /// Always `true` on success.
        ok: bool,
    },
    /// Reply to the server-runtime mirror auth shape.
    #[serde(rename = "module:authenticated")]
    Authenticated {
        /// Always `authenticated: true` on success.
        data: AuthenticatedData,
    },
    /// Reply to `ping`.
    #[serde(rename = "pong")]
    Pong,
    /// Heartbeat pong mirror: kind `pong`, `message` 💛, `at` unix ms.
    #[serde(rename = "transport:connection:heartbeat")]
    Heartbeat {
        /// Pong payload.
        data: HeartbeatData,
    },
    /// RPC reply frame. `ok: true` + `data` (and no `error`) on success;
    /// `ok: false` + `error` (and no `data`) on failure. A client-supplied
    /// `id` from the request is echoed verbatim.
    #[serde(rename = "rpc")]
    Rpc {
        /// RPC method this reply answers.
        action: String,
        /// `true` on success, `false` on failure.
        ok: bool,
        /// Handler result, present on success only.
        #[serde(skip_serializing_if = "Option::is_none")]
        #[specta(type = specta_typescript::Unknown)]
        data: Option<Value>,
        /// Stable code + sanitized message, present on failure only.
        #[serde(skip_serializing_if = "Option::is_none")]
        error: Option<RpcErrorObject>,
        /// Echoed from the request when the client sent one.
        #[serde(skip_serializing_if = "Option::is_none")]
        #[specta(type = specta_typescript::Unknown)]
        id: Option<Value>,
    },
    /// Typed error frame; the connection stays open (post-auth) or closes
    /// with 1008 (pre-auth).
    #[serde(rename = "error")]
    Error {
        /// Stable code + message.
        error: RpcErrorObject,
    },
    /// Server-initiated event frame — the Wave 0 event lane. Post-auth only;
    /// delivered without a preceding client frame. See the module-level ADR.
    #[serde(rename = "event")]
    Event {
        /// Stable topic selecting the payload shape.
        topic: EventTopic,
        /// Typed payload matching `topic`.
        data: EventPayload,
        /// Optional producer correlation id, echoed verbatim.
        #[serde(skip_serializing_if = "Option::is_none")]
        #[specta(type = specta_typescript::Unknown)]
        id: Option<Value>,
    },
}

impl GatewayServerFrame {
    /// Wrap a [`GatewayEvent`] in the server `event` frame. Centralizes the
    /// mapping so the bus and direct senders cannot drift on field names.
    pub fn event(event: GatewayEvent) -> Self {
        GatewayServerFrame::Event {
            topic: event.topic,
            data: event.data,
            id: event.id,
        }
    }
}

/// Types collected for the TypeScript export. Extracted into a function so
/// the exporter example and any future drift test agree on the schema
/// without duplicating the list. `specta::Types` auto-registers transitive
/// named dependencies, so the frame roots plus the gateway control-plane
/// DTOs (`control.rs`, `config.rs`) are needed here.
pub fn type_collection() -> specta::Types {
    specta::Types::default()
        .register::<GatewayClientFrame>()
        .register::<GatewayServerFrame>()
        .register::<EventTopic>()
        .register::<CueKind>()
        .register::<EventPayload>()
        .register::<GatewayEvent>()
        .register::<EventSubscriptionReply>()
        .register::<LipSyncRmsData>()
        .register::<EmotionTagData>()
        .register::<TokenDeltaData>()
        .register::<PresenceChangedData>()
        .register::<StatusChangedData>()
        .register::<RuntimePingReply>()
        .register::<RuntimeStatusReply>()
        .register::<CoreStatusReply>()
        .register::<GatewayConfigReply>()
        .register::<GatewayAuthReply>()
        .register::<ProvidersListReply>()
        .register::<ProviderInfo>()
        .register::<SettingsGetReply>()
        .register::<SettingsSetReply>()
        .register::<VaultStatusReply>()
        .register::<VaultStatsData>()
        .register::<DomainStatsData>()
        .register::<MemoryStatsData>()
        .register::<ProviderStatsData>()
        .register::<CharacterStatsData>()
        .register::<crate::config::ChannelConfig>()
        .register::<crate::control::GatewayControlStatus>()
        .register::<crate::control::GatewayControlApply>()
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn to_value(frame: &GatewayServerFrame) -> Value {
        serde_json::to_value(frame).unwrap()
    }

    #[test]
    fn server_frames_serialize_to_expected_wire_shapes() {
        assert_eq!(
            to_value(&GatewayServerFrame::Auth { ok: true }),
            json!({ "type": "auth", "ok": true })
        );
        assert_eq!(
            to_value(&GatewayServerFrame::Authenticated {
                data: AuthenticatedData {
                    authenticated: true
                },
            }),
            json!({ "type": "module:authenticated", "data": { "authenticated": true } })
        );
        assert_eq!(
            to_value(&GatewayServerFrame::Pong),
            json!({ "type": "pong" })
        );
        assert_eq!(
            to_value(&GatewayServerFrame::Heartbeat {
                data: HeartbeatData {
                    kind: HeartbeatKind::Pong,
                    message: Some("💛".to_string()),
                    at: Some(42),
                },
            }),
            json!({ "type": "transport:connection:heartbeat", "data": { "kind": "pong", "message": "💛", "at": 42 } })
        );
        assert_eq!(
            to_value(&GatewayServerFrame::Rpc {
                action: "runtime.ping".to_string(),
                ok: true,
                data: Some(json!({ "pong": true })),
                error: None,
                id: Some(json!("abc")),
            }),
            json!({ "type": "rpc", "action": "runtime.ping", "ok": true, "data": { "pong": true }, "id": "abc" })
        );
        assert_eq!(
            to_value(&GatewayServerFrame::Rpc {
                action: "renderer.nope".to_string(),
                ok: false,
                data: None,
                error: Some(RpcErrorObject {
                    code: "rpc_not_implemented".to_string(),
                    message: "no handler".to_string(),
                }),
                id: None,
            }),
            json!({ "type": "rpc", "action": "renderer.nope", "ok": false,
                    "error": { "code": "rpc_not_implemented", "message": "no handler" } })
        );
        assert_eq!(
            to_value(&GatewayServerFrame::Error {
                error: RpcErrorObject {
                    code: "invalid_token".to_string(),
                    message: "invalid token".to_string(),
                },
            }),
            json!({ "type": "error", "error": { "code": "invalid_token", "message": "invalid token" } })
        );
    }

    #[test]
    fn client_frames_deserialize_from_expected_wire_shapes() {
        let auth: GatewayClientFrame =
            serde_json::from_str(r#"{"type":"auth","authToken":"tok"}"#).unwrap();
        assert!(matches!(auth, GatewayClientFrame::Auth { ref auth_token } if auth_token == "tok"));

        let module_auth: GatewayClientFrame =
            serde_json::from_str(r#"{"type":"module:authenticate","data":{"token":"tok"}}"#)
                .unwrap();
        assert!(matches!(
            module_auth,
            GatewayClientFrame::ModuleAuthenticate { ref data } if data.token == "tok"
        ));

        let ping: GatewayClientFrame = serde_json::from_str(r#"{"type":"ping"}"#).unwrap();
        assert!(matches!(ping, GatewayClientFrame::Ping));

        let heartbeat: GatewayClientFrame = serde_json::from_str(
            r#"{"type":"transport:connection:heartbeat","data":{"kind":"ping"}}"#,
        )
        .unwrap();
        assert!(matches!(
            heartbeat,
            GatewayClientFrame::Heartbeat { ref data } if data.kind == HeartbeatKind::Ping
        ));

        let rpc: GatewayClientFrame =
            serde_json::from_str(r#"{"type":"rpc","action":"runtime.ping","payload":{},"id":7}"#)
                .unwrap();
        assert!(matches!(
            rpc,
            GatewayClientFrame::Rpc { ref action, ref id, .. }
                if action == "runtime.ping" && id.as_ref() == Some(&json!(7))
        ));
    }

    #[test]
    fn optional_fields_omit_when_none() {
        let value = serde_json::to_value(GatewayServerFrame::Rpc {
            action: "a".to_string(),
            ok: false,
            data: None,
            error: Some(RpcErrorObject {
                code: "c".to_string(),
                message: "m".to_string(),
            }),
            id: None,
        })
        .unwrap();
        assert!(value.get("id").is_none());
        assert!(value.get("data").is_none());

        let value = serde_json::to_value(HeartbeatData {
            kind: HeartbeatKind::Ping,
            message: None,
            at: None,
        })
        .unwrap();
        assert_eq!(value, json!({ "kind": "ping" }));
    }

    #[test]
    fn rpc_reply_payloads_match_dispatch() {
        assert_eq!(
            serde_json::to_value(RuntimePingReply {
                pong: true,
                time: 1,
                uptime_seconds: 2
            })
            .unwrap(),
            json!({ "pong": true, "time": 1, "uptimeSeconds": 2 })
        );
        assert_eq!(
            serde_json::to_value(RuntimeStatusReply {
                app: "airi-slint".to_string(),
                version: "0.1.0".to_string(),
                pid: 99,
                uptime_seconds: 7,
                protocol: "airi-channel/1".to_string(),
            })
            .unwrap(),
            json!({ "app": "airi-slint", "version": "0.1.0", "pid": 99, "uptimeSeconds": 7, "protocol": "airi-channel/1" })
        );
        assert_eq!(
            serde_json::to_value(GatewayConfigReply {
                hostname: "127.0.0.1".to_string(),
                port: 6121
            })
            .unwrap(),
            json!({ "hostname": "127.0.0.1", "port": 6121 })
        );
        assert_eq!(
            serde_json::to_value(GatewayAuthReply {
                authenticated: true,
                session_started_ms: 5
            })
            .unwrap(),
            json!({ "authenticated": true, "sessionStartedMs": 5 })
        );
    }

    fn sample_events() -> Vec<GatewayEvent> {
        vec![
            GatewayEvent::new(
                EventTopic::LipSyncRms,
                EventPayload::LipSyncRms(LipSyncRmsData {
                    actor_id: "actor-1".to_string(),
                    level: 0.42,
                    seq: 1,
                    ts_ms: 100,
                }),
            ),
            GatewayEvent::new(
                EventTopic::EmotionTag,
                EventPayload::EmotionTag(EmotionTagData {
                    actor_id: "actor-1".to_string(),
                    tag: "happy".to_string(),
                    kind: CueKind::Emotion,
                    intensity: 0.9,
                    duration_ms: Some(700),
                    seq: 2,
                    ts_ms: 200,
                }),
            ),
            GatewayEvent::new(
                EventTopic::TokenDelta,
                EventPayload::TokenDelta(TokenDeltaData {
                    session_id: "s-1".to_string(),
                    message_id: "m-1".to_string(),
                    delta: "hel".to_string(),
                    index: 0,
                    final_: false,
                    seq: 3,
                    ts_ms: 300,
                }),
            ),
            GatewayEvent::new(
                EventTopic::PresenceChanged,
                EventPayload::PresenceChanged(PresenceChangedData {
                    subject: "actor-1".to_string(),
                    state: "online".to_string(),
                    seq: 4,
                    ts_ms: 400,
                }),
            ),
            GatewayEvent::new(
                EventTopic::StatusChanged,
                EventPayload::StatusChanged(StatusChangedData {
                    core_available: true,
                    store_available: true,
                    store_health: "ok".to_string(),
                    seq: 5,
                    ts_ms: 500,
                }),
            ),
        ]
    }

    #[test]
    fn event_frames_round_trip_for_every_topic() {
        for event in sample_events() {
            let frame = GatewayServerFrame::event(event.clone());
            let value = serde_json::to_value(&frame).unwrap();
            assert_eq!(value["type"], "event");
            assert_eq!(value["topic"], serde_json::json!(event.topic.as_str()));

            let json = serde_json::to_string(&frame).unwrap();
            let decoded: GatewayServerFrame = serde_json::from_str(&json).unwrap();
            assert_eq!(decoded, frame, "round trip failed for {}", event.topic);
        }
    }

    #[test]
    fn event_frame_shape_matches_wire_contract() {
        let frame = GatewayServerFrame::event(GatewayEvent::new(
            EventTopic::LipSyncRms,
            EventPayload::LipSyncRms(LipSyncRmsData {
                actor_id: "a".to_string(),
                level: 0.5,
                seq: 7,
                ts_ms: 9,
            }),
        ));
        assert_eq!(
            to_value(&frame),
            json!({
                "type": "event",
                "topic": "lip_sync.rms",
                "data": { "actor_id": "a", "level": 0.5, "seq": 7, "ts_ms": 9 }
            })
        );
        // Optional `id` is omitted when absent and echoed verbatim when present.
        let with_id = GatewayServerFrame::event(
            GatewayEvent::new(
                EventTopic::StatusChanged,
                EventPayload::StatusChanged(StatusChangedData {
                    core_available: true,
                    store_available: false,
                    store_health: "unavailable".to_string(),
                    seq: 1,
                    ts_ms: 2,
                }),
            )
            .with_id(json!("turn-42")),
        );
        assert_eq!(to_value(&with_id)["id"], json!("turn-42"));
    }

    #[test]
    fn emotion_tag_carries_kind_and_optional_duration() {
        for (kind, wire) in [
            (CueKind::Emotion, "emotion"),
            (CueKind::Motion, "motion"),
            (CueKind::Vfx, "vfx"),
        ] {
            let payload = EventPayload::EmotionTag(EmotionTagData {
                actor_id: "a".to_string(),
                tag: "wave".to_string(),
                kind,
                intensity: 0.6,
                duration_ms: None,
                seq: 1,
                ts_ms: 2,
            });
            let value = serde_json::to_value(&payload).unwrap();
            assert_eq!(value["kind"], json!(wire));
            assert!(value.get("duration_ms").is_none(), "None must be omitted");
            let decoded: EventPayload = serde_json::from_value(value).unwrap();
            assert_eq!(decoded, payload);
        }
        // Normalized keys are documented for renderers; `cool` is in the
        // union but not shared by all renderers.
        assert!(CANONICAL_EMOTION_KEYS.contains(&"think"));
        assert!(CANONICAL_EMOTION_KEYS.contains(&"cool"));
        assert_eq!(CANONICAL_EMOTION_KEYS.len(), 10);
    }

    #[test]
    fn event_topic_parses_and_displays_dotted_names() {
        for topic in EventTopic::ALL {
            assert_eq!(topic.as_str().parse::<EventTopic>(), Ok(*topic));
        }
        assert!("noise".parse::<EventTopic>().is_err());
    }

    #[test]
    fn status_changed_payload_has_no_secret_bearing_fields() {
        let payload = EventPayload::StatusChanged(StatusChangedData {
            core_available: true,
            store_available: true,
            store_health: "ok".to_string(),
            seq: 1,
            ts_ms: 2,
        });
        let obj = serde_json::to_value(&payload).unwrap();
        let obj = obj.as_object().unwrap();
        for forbidden in [
            "authToken",
            "auth_token",
            "dbusToken",
            "dbus_token",
            "apiKey",
            "api_key",
            "secret",
            "prompt",
            "config",
            "token",
            "path",
        ] {
            assert!(
                !obj.contains_key(forbidden),
                "forbidden field present: {forbidden}"
            );
        }
    }

    #[test]
    fn specta_type_collection_includes_event_types() {
        let types = type_collection();
        let ts = specta_typescript::Typescript::default()
            .export(&types, specta_serde::Format)
            .unwrap();
        for name in [
            "EventTopic",
            "CueKind",
            "EventPayload",
            "GatewayEvent",
            "EventSubscriptionReply",
            "LipSyncRmsData",
            "EmotionTagData",
            "TokenDeltaData",
            "PresenceChangedData",
            "StatusChangedData",
        ] {
            assert!(
                ts.contains(&format!("export type {name}")),
                "{name} not exported"
            );
        }
    }

    #[test]
    fn core_status_reply_has_no_secret_bearing_fields() {
        let value = serde_json::to_value(CoreStatusReply {
            app: "airi-daemon".to_string(),
            version: "0.1.0".to_string(),
            core_available: true,
            store_available: true,
            store_health: "ok".to_string(),
            protocol: "airi-channel/1".to_string(),
            session_count: 0,
            message_count: 0,
        })
        .unwrap();
        let obj = value.as_object().unwrap();
        for forbidden in [
            "authToken",
            "auth_token",
            "dbusToken",
            "dbus_token",
            "apiKey",
            "api_key",
            "secret",
            "prompt",
            "config",
            "token",
            "path",
        ] {
            assert!(
                !obj.contains_key(forbidden),
                "forbidden field present: {forbidden}"
            );
        }
    }

    #[test]
    fn providers_list_reply_has_no_secret_bearing_fields() {
        let reply = ProvidersListReply {
            providers: vec![ProviderInfo {
                id: "openai".to_string(),
                kind: "openai".to_string(),
                model: "gpt-4o".to_string(),
                base_url: "https://api.openai.com/v1".to_string(),
                enabled: true,
                updated_at: 1234567890,
            }],
        };
        let value = serde_json::to_value(&reply).unwrap();
        let obj = value.as_object().unwrap();
        let providers = obj.get("providers").unwrap().as_array().unwrap();
        let provider = providers[0].as_object().unwrap();
        for forbidden in [
            "apiKey",
            "api_key",
            "secret",
            "token",
            "authToken",
            "config",
        ] {
            assert!(
                !provider.contains_key(forbidden),
                "forbidden field present in provider: {forbidden}"
            );
        }
    }

    #[test]
    fn vault_status_reply_has_no_secret_bearing_fields() {
        let reply = VaultStatusReply {
            available: true,
            stats: Some(VaultStatsData {
                chats: DomainStatsData {
                    sessions: 10,
                    messages: 42,
                    bytes: 123456,
                },
                memory: MemoryStatsData {
                    summaries: 5,
                    journal_entries: 12,
                    bytes: 67890,
                },
                providers: ProviderStatsData {
                    count: 3,
                    bytes: 1024,
                },
                characters: CharacterStatsData {
                    count: 8,
                    bytes: 2048000,
                },
            }),
        };
        let value = serde_json::to_value(&reply).unwrap();
        let obj = value.as_object().unwrap();
        for forbidden in [
            "apiKey",
            "api_key",
            "secret",
            "token",
            "authToken",
            "config",
            "keys",
            "ciphertext",
        ] {
            assert!(
                !obj.contains_key(forbidden),
                "forbidden field present: {forbidden}"
            );
        }
        // Stats contain only counts and byte sizes
        let stats = obj.get("stats").unwrap().as_object().unwrap();
        let providers = stats.get("providers").unwrap().as_object().unwrap();
        assert!(providers.contains_key("count"));
        assert!(providers.contains_key("bytes"));
        assert!(!providers.contains_key("config"));
        assert!(!providers.contains_key("keys"));
    }
}
