<!-- SPDX-License-Identifier: GPL-3.0-or-later -->
# P9 Lane I5 — `airi-discord`: blocking Discord REST client (gateway blocked)

Wave ⑦ lane I5. Scope: `apps/airi-qt/crates/airi-discord/**` only. The Qt Discord settings page was a read-only scaffold (see `p9-lane-discord.md`); this lane delivers the first honest half of a backend behind it: a **blocking REST client** with bot-token auth. The live-message half (Discord **Gateway WebSocket**) is **not** delivered — it is blocked on a user dependency decision, written up below as the explicit blocker.

No websocket code, no TLS, no framing was hand-rolled. Nothing targets `discord.gg`. The base URL is injectable (`with_base_url`) for tests and for self-hosted proxies of the Discord API (e.g. Discohook-style reverse proxies).

## What landed, per file

All under `crates/airi-discord/`:

- **`Cargo.toml`** — dropped the unused `tokio` and `tempfile` entries (the client is blocking; tests use mockito only). No new external crates; `serde`/`serde_json`/`thiserror`/`tracing`/`reqwest` (workspace, with `blocking` + `rustls-tls`) + dev-dep `mockito`.
- **`src/lib.rs`** — crate docs (scope, gateway blocker, proxy/test injection, token posture, rate-limit semantics, human-in-the-loop), `#![deny(missing_docs)]`, re-exports. SPDX header.
- **`src/types.rs`** — `GatewayBot` + `SessionStartLimit` (`reset_after` kept as raw integer **milliseconds**, exactly as Discord sends it), `BotUser` (`discriminator`/`display_name`/`avatar`/`bot`, optional fields tolerated), `Message` (`id`, `channel_id`, `content`, `timestamp` — ISO-8601 kept as opaque `String`, no chrono dep), `Channel` (`id`, `channel_type: u8`, `name?`/`topic?`/`position?` — raw byte, deliberately **not** a 30+-variant enum). Unknown JSON keys are ignored everywhere.
- **`src/error.rs`** — `DiscordError::{Transport(reqwest::Error), Http { status: u16, message: String }, RateLimited { retry_after: Duration, global: bool }, Decode(String), Unauthorized}`. `thiserror`. 401 → `Unauthorized`; `Http.message` is truncated to 512 chars (UTF-8 safe). No variant carries the token.
- **`src/client.rs`** — `DiscordRestClient { base_url, token, http, last_rate_limit }`:
  - `DiscordRestClient::new(token)` → `DEFAULT_BASE_URL` (`https://discord.com/api/v10`), 10 s timeout, fixed `AIRI airi-discord/<version>` User-Agent; `with_base_url(token, base_url)` for mockito/proxies (trailing slash trimmed). Construction returns `Result` (reqwest client build can fail; never panics).
  - `get_gateway_url()` — `GET /gateway/bot`.
  - `get_current_bot_user()` — `GET /users/@me`.
  - `send_message(channel_id, content)` — `POST /channels/{id}/messages`, body `{"content": ...}`, returns minimal typed `Message`.
  - `get_channel(channel_id)` — `GET /channels/{id}`.
  - Every request sends `Authorization: Bot <token>`. URL path segments are percent-encoded (`encode_path_segment`, unreserved set `A-Za-z0-9-_.~`) so a channel id can never smuggle `/`, `?`, or `#` into the path or query.
  - Methods take `&mut self`: each response's `X-RateLimit-Remaining` / `X-RateLimit-Reset-After` are captured into `last_rate_limit: Option<RateLimit>` (last-seen wins; unparseable/absent headers leave the field `None`). This is **observational only** — no client-side throttling, queuing, or retry.
  - 429 → typed `RateLimited`, parsed from the documented body `{ message, retry_after (seconds, float), global (bool) }`; falls back to the `X-RateLimit-Reset-After` header, then to 1 s. `secs_f64_to_duration` rejects NaN/negative/overflow instead of panicking (`Duration::from_secs_f64` panics on those).
  - Success bodies are read as text then decoded with `serde_json`, so a decode failure maps to `Decode`, never misreported as `Transport`.
  - `tracing::debug!` lines carry method, path, status, body length — never headers, never the token.
- **`tests/rest.rs`** — 14 integration tests, all against a local mockito server. No live network.

## API summary

```rust
pub const DEFAULT_BASE_URL: &str = "https://discord.com/api/v10";
pub const DEFAULT_TIMEOUT: Duration /* 10 s */;

impl DiscordRestClient {
    pub fn new(token: impl Into<String>) -> Result<Self, DiscordError>;
    pub fn with_base_url(token: impl Into<String>, base_url: impl Into<String>)
        -> Result<Self, DiscordError>;
    pub fn base_url(&self) -> &str;                       // never contains the token
    pub fn last_rate_limit(&self) -> Option<RateLimit>;   // { remaining: Option<u64>, reset_after: Option<Duration> }
    pub fn get_gateway_url(&mut self) -> Result<GatewayBot, DiscordError>;
    pub fn get_current_bot_user(&mut self) -> Result<BotUser, DiscordError>;
    pub fn send_message(&mut self, channel_id: &str, content: &str)
        -> Result<Message, DiscordError>;
    pub fn get_channel(&mut self, channel_id: &str)
        -> Result<Channel, DiscordError>;
}
```

## Rate-limit semantics

- Headers are read from **every** response that carries them, success or error. `X-RateLimit-Reset-After` is fractional **seconds** and is stored as `Duration`; `X-RateLimit-Remaining` as `u64`. A response with neither header leaves `last_rate_limit` untouched (a proxy that strips headers must not look like a reset).
- The client does not wait out a limit. On 429 the caller receives `RateLimited { retry_after, global }` and decides whether to back off; `global: true` means the whole bot is limited, `false` means one bucket/route.
- Discord's per-bucket model is out of scope here: no bucket hashing, no per-route accounting. What is reported is the last window the request actually touched.

## Security posture (token handling), exactly

- Token stored as `String`, moved in at construction, never returned by any method (there is deliberately no accessor).
- `Debug` is implemented by hand: prints `base_url`, `last_rate_limit`, and `token: "***"`. Test `debug_output_redacts_the_token` asserts the marker appears and the token does not.
- No logging of the token: `tracing::debug!` logs method/path/status/body length only.
- Errors never carry the token: 401 is a bare `Unauthorized` variant (body discarded); `Http.message` is a truncated Discord error body (Discord never echoes the token); `Transport` wraps `reqwest::Error`, whose URL component cannot contain the token (it travels in the `Authorization` header, not the URL).
- `error_display_never_contains_the_token` feeds a hostile 401 body containing the token and asserts `Display` of the error is clean.
- Token at rest (page field → bridge → client) is **not** solved by this crate — see "What a real Qt wiring needs next". This crate only guarantees the token is not leaked via Debug/logs/errors while in use.
- `Authorization` header uses the `Bot ` scheme (not `Bearer`), per Discord's bot-token auth.

## Test evidence

All via mockito (`Server::new()` + drop-time mock assertions); no live network:

```
cargo test -p airi-discord
  14 passed (tests/rest.rs):
    get_gateway_url_parses_canned_response   (also asserts rate-limit capture: remaining=4, reset_after=1.5s)
    get_current_bot_user_parses              (id/username/discriminator/display_name/avatar/bot)
    get_current_bot_user_tolerates_missing_optional_fields
    send_message_posts_correct_body_and_bot_auth_header  (match_header authorization = "Bot <token>", PartialJson body match)
    send_message_percent_encodes_channel_id  ("a/b?c" → a%2Fb%3Fc)
    get_channel_parses_typed_channel         (type byte, name, topic, position)
    get_channel_tolerates_dm_shape_without_name
    unauthorized_maps_to_unauthorized_variant (401 → Unauthorized)
    rate_limit_body_maps_to_typed_rate_limited  (429 {retry_after: 2.5, global: true} → RateLimited{2.5s, true})
    rate_limit_falls_back_to_header_when_body_has_no_retry_after (header 3.25s fallback)
    server_error_maps_to_http_500               (500 → Http{status: 500, ..})
    malformed_json_maps_to_decode               ("this is not json" → Decode)
    debug_output_redacts_the_token
    error_display_never_contains_the_token
```

`cargo clippy -p airi-discord --all-targets -- -D warnings` — clean. `cargo fmt -p airi-discord -- --check` — clean. Clippy/fmt/test were run on 2026-11-11 against the tree as it stands; other lanes' uncommitted work elsewhere in the workspace does not intersect this crate. `#![deny(missing_docs)]`; SPDX header on every file; no `unwrap`/`expect` in non-test code.

Not verified: any interaction with the real Discord API (deliberately; tests are hermetic) and the Qt page wiring (out of lane scope).

## THE BLOCKER — Gateway WebSocket (requires a user decision)

Live message receipt from Discord requires the **Gateway**: a persistent WebSocket with this handshake:

1. `GET /gateway/bot` (implemented here) → `url`, `session_start_limit`.
2. Connect WebSocket to `url` → server sends **op 10 (HELLO)** with `heartbeat_interval`.
3. Client responds with **op 2 (IDENTIFY)**: `{ token, intents, properties: { os, browser, device } }`. Intents are a privileged-gateway decision (e.g. `GUILD_MESSAGES | DIRECT_MESSAGES | MESSAGE_CONTENT` — the last is a *privileged intent* that must be enabled in the Discord developer portal).
4. Server begins sending dispatch events; client must **op 1 (HEARTBEAT)** every `heartbeat_interval`, and handle **op 11 (HEARTBEAT_ACK)**, op 7 (RECONNECT), op 9 (INVALID SESSION, with `d: true/false` resumability), and sequence-number tracking for resume (op 6).
5. Bot payloads of interest to AIRI arrive as **`MESSAGE_CREATE`** dispatches (op 0).

**There is no WebSocket client crate anywhere in the workspace dependency set.** Adding one (`tokio-tungstenite` is the natural candidate — the workspace already depends on tokio with `rt-multi-thread`/`time`/`sync`/`macros`) is a **user dependency decision**, not a lane decision, and is explicitly out of this lane's scope. Hand-rolling TLS + WebSocket framing was ruled out. Until that decision is made and a lane is opened for it, AIRI cannot receive Discord messages live; this crate can only *send* (human-initiated) and do plain REST lookups/token validation.

Gateway work also carries non-code prerequisites a lane cannot supply: a bot application with intents enabled in the developer portal, a token store with file permissions, and lifecycle management (connect/reconnect/backoff/resume) inside the Qt app.

## What a real Qt wiring needs next (not started, in order)

1. **Token field → bridge.** The Discord settings page's disabled `ATextField` (echoMode Password) gains a Rust-side token store: file under the AIRI data dir, `0600`, written only on explicit save. The QML page must never see the token back (write-only field; show "configured ✓" via a boolean, not the value).
2. **Bridge → client.** A cxx-qt bridge object (like the other lanes' backends) holds a `DiscordRestClient`, exposes `validateToken()` (maps to `get_current_bot_user`/`get_gateway_url`), `sendMessage(channelId, content)`, `channelInfo(channelId)` — all synchronous, all human-initiated, results emitted as signals.
3. **Validation UX.** Connect button enabled only after a successful `get_current_bot_user()` against the user's token. 401 → inline "token rejected" error. 429 → show `retry_after`, disable Send until it elapses.
4. **Never send automatically.** No timers, no "reply when mentioned", no background sends. Every outbound message is a direct consequence of a user action (a Send button with channel + content visible). Command dispatch (e.g. `!airi …`) stays **human-in-the-loop**: AIRI may draft a reply and present it, but a human presses Send. No auto-responder, no unprompted DMs, ever.
5. **Rate-limit honesty.** Surface `last_rate_limit()` as "X requests left this window" if desired; never pretend the limit doesn't exist.
6. **Gateway, if/when the dependency decision lands:** a separate lane adds `tokio-tungstenite`, a `DiscordGateway` actor (HELLO → IDENTIFY → heartbeat with jitter, resume via session id + seq, exponential backoff, intents narrowed to what AIRI needs), and an inbound pipeline whose every action is gated by human approval before any outbound side effect. `MESSAGE_CREATE` → suggestion → human approves → `send_message`. That is the full shape; none of it exists yet.
7. **Docs/i18n:** new strings for the validation and send flow need `I18n.tr` entries; wire the page only after the bridge lane lands (the page's disabled controls/tooltips are the honest state until then).

## Verification summary

| Gate | Result |
| --- | --- |
| `cargo test -p airi-discord` | 14/14 pass (mockito, no network) |
| `cargo clippy -p airi-discord --all-targets -- -D warnings` | clean |
| `cargo fmt -p airi-discord -- --check` | clean |
| SPDX / `#![deny(missing_docs)]` / no token in Debug-logs-errors | in place, test-witnessed |
| Gateway WebSocket | **NOT implemented — blocked on user dependency decision (tokio-tungstenite)** |

Lane rules respected: only `crates/airi-discord/**` (+ the pre-existing workspace `members` entry and the lockfile's airi-discord dep set) were touched; no git writes; nothing else in the tree was modified by this lane.
