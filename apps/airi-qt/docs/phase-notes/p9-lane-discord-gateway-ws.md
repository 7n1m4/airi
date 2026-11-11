<!-- SPDX-License-Identifier: GPL-3.0-or-later -->
# P9 Lane I6 — `airi-discord`: blocking Gateway WebSocket client (the unblocked half)

Wave ⑧ lane I6. Scope: `apps/airi-qt/crates/airi-discord/**` only. The user approved adding `tungstenite` (2026-11-11) specifically to unblock the Discord gateway; this lane delivers it. `tungstenite 0.24` (with the `rustls-tls-webpki-roots` feature) was already added to the workspace and to this crate's `Cargo.toml` (that edit was pre-existing, not this lane's). No new external crates were added. REST (wave ⑦, lane I5) is untouched and its 14 tests still pass.

## What landed, per file

All under `crates/airi-discord/`:

- **`Cargo.toml`** — crate description updated to "blocking REST + Gateway WebSocket slice". `tungstenite = { workspace = true }` was already present. SPDX unchanged.
- **`src/gateway.rs`** (new) — `GatewayClient` + `GatewayEvent`, see below.
- **`src/error.rs`** — two new variants (no existing variant changed):
  - `GatewayTransport(String)` — TCP/TLS/WebSocket/frame failures; wraps tungstenite's description. Never carries the token (the token travels in JSON payloads only).
  - `InvalidSession { resumable: bool }` — op 9 INVALID SESSION; `resumable` carries the `d` boolean verbatim (`true` → op 6 RESUME may work, `false` → fresh IDENTIFY).
  - `Unauthorized` is reused for **close code 4004** (Authentication failed), per the lane contract.
- **`src/lib.rs`** — crate docs updated (gateway in scope, never auto-connect, token posture), `mod gateway`, re-exports `GatewayClient`, `GatewayEvent`, `ReadyUser`, `MessageAuthor`, `DEFAULT_INTENTS`.
- **`tests/gateway.rs`** (new) — 9 integration tests + 4 unit tests (`gateway_ws_url`), all offline against a loopback mock (`tungstenite::accept` on `127.0.0.1:0`).

## API summary

```rust
pub const DEFAULT_INTENTS: u32 = 512 | 4096 | 32768; // GUILD_MESSAGES | DIRECT_MESSAGES | MESSAGE_CONTENT

pub struct GatewayClient;  // Debug prints token: "***"
impl GatewayClient {
    pub fn connect(gateway_url: &str, token: &str, intents: u32) -> Result<Self, DiscordError>;
    pub fn next_event(&mut self) -> Result<GatewayEvent, DiscordError>;
    pub fn reconnect(&mut self) -> Result<(), DiscordError>;
    pub fn resume(&mut self) -> Result<(), DiscordError>;
    pub fn session_id(&self) -> Option<&str>;
    pub fn resume_gateway_url(&self) -> Option<&str>;
    pub fn seq(&self) -> Option<u64>;
    pub fn heartbeat_interval(&self) -> Duration;
    pub fn intents(&self) -> u32;
}

pub enum GatewayEvent {
    Ready { session_id: String, resume_gateway_url: String, user: ReadyUser }, // ReadyUser { id, username }
    Resumed,
    MessageCreate { id: String, channel_id: String, guild_id: Option<String>,
                    author: MessageAuthor, content: String, timestamp: String }, // MessageAuthor { id, username, bot: bool }
    HeartbeatAck,
    Closed { code: Option<u16> },
}
```

`GatewayEvent` derives `Serialize`/`Deserialize`. Unknown op codes and unknown dispatch `t` names are **not** surfaced — logged at `tracing::debug!` and skipped internally.

## Wire flow

```
client                                    Discord gateway
  | ---- WebSocket handshake ----------->  |  (wss://…/?v=10&encoding=json)
  | <--- op 10 HELLO { heartbeat_interval } ---
  | ---- op 2 IDENTIFY { token, intents, ----> |
  |       properties: { os: "linux",
  |         browser: "airi-qt",
  |         device: "airi-qt" } }
  | <--- op 0 DISPATCH t=READY (s=N) -------- |   session_id, resume_gateway_url, user, guilds…
  |      (usually followed by GUILD_CREATE
  |       etc.; unknown dispatches are ignored)
loop:
  | --- op 1 HEARTBEAT { d: <last seq|null> } ->|   every heartbeat_interval
  | <--- op 11 HEARTBEAT_ACK ------------------ |   → GatewayEvent::HeartbeatAck
  | <--- op 0 DISPATCH t=MESSAGE_CREATE ------- |   → seq tracks s; → GatewayEvent::MessageCreate
  | ---- op 6 RESUME { token, session_id, seq } →|  (only via resume(), after reconnect())
  | <--- op 0 DISPATCH t=RESUMED -------------- |   → GatewayEvent::Resumed
  | <--- op 9 INVALID SESSION { d: bool } ----- |   → DiscordError::InvalidSession { resumable }
  | <--- close frame (4004) ------------------- |   → DiscordError::Unauthorized
  | <--- close frame (other) ------------------ |   → GatewayEvent::Closed { code }
```

Exact URL handling (`gateway_ws_url`): if `gateway_url` already has a query string it is used verbatim (a `/` is inserted before the query when the URL has no path, e.g. `ws://host?q=1` → `ws://host/?q=1`, otherwise the request line is invalid HTTP). Otherwise `/?v=10&encoding=json` is appended (or `?v=10&encoding=json` after a trailing slash). Discord's `GET /gateway/bot` today returns a bare host, so the append path is the expected one; the "already carries the query" path exists so a proxy/hand-rolled URL is never double-appended. Unit-tested in `gateway.rs::tests`.

HELLO wait: `DEFAULT_TIMEOUT` (10 s, reused from the REST client) bounds the HELLO read after the WS handshake; on timeout the call fails with `GatewayTransport` (surfaced as `IO error …os error 11` on Linux — i.e. WouldBlock under `SO_RCVTIMEO`, mapped via tungstenite's error). The socket read timeout is then set to `heartbeat_interval`, which is what drives the heartbeat loop. The initial TCP connect itself is not bounded by us (tungstenite `connect` blocks on the resolver/connect; OS defaults apply) — noted, not worked around.

Heartbeat: sent from inside `next_event`'s loop — there is no timer thread. The socket read timeout equals `heartbeat_interval`, so a silent connection wakes exactly when a heartbeat is due; on `WouldBlock` the loop re-checks and sends op 1 `{ d: seq }` if due. Consecutive heartbeats pace themselves one interval apart. op 11 is returned as an event, not swallowed.

Identify failure: op 9 before or after READY → `InvalidSession { resumable }`. Close code 4004 → `Unauthorized`. Close codes 4000–4999 are **not** individually parsed; `Closed { code }` carries them verbatim. Known ones (from `discord-api-types/gateway` and the docs): 4000 Unknown error (resumable), 4001 Unknown opcode, 4002 Decode error, 4003 Not authenticated (payload before identify), **4004 Authentication failed (token bad — we map to Unauthorized)**, 4005 Already authenticated, 4007 Invalid seq (resume with a bad sequence → reconnect fresh), 4008 Rate limited, 4009 Session timed out (resume may help), 4010 Invalid shard, 4011 Sharding required, 4012 Invalid API version, 4013 Invalid intents, 4014 Disallowed intents (privileged intent not enabled). Rule of thumb for the caller: 4007/4009 → resume; 4004/4013/4014 → fix config/token/portal, do **not** retry blindly; everything else → resume if you have a session, else fresh identify.

## Intents — and the privileged-intent requirement

`DEFAULT_INTENTS = GUILD_MESSAGES (512 = 1<<9) | DIRECT_MESSAGES (4096 = 1<<12) | MESSAGE_CONTENT (32768 = 1<<15)`.

`MESSAGE_CONTENT` is a **privileged intent**. The bot must have it enabled in the Discord Developer Portal (Bot → Privileged Gateway Intents → Message Content) or:

- verified applications are rejected at IDENTIFY (close 4014 / op 9), and
- unverified applications connect but receive **empty `content`** in MESSAGE_CREATE — which defeats AIRI's entire receive path.

This crate does not (and cannot) enable it; it is a deployment prerequisite alongside the token itself. Narrow the intents at the call site if AIRI ever wants content-less receipt (e.g. trigger words only). GuildPresences/Members are deliberately **not** requested.

## discord.js reference deltas

Cross-checked against `node_modules/discord.js` and `@discordjs/ws` (v0.24-era API shapes, `node_modules/discord-api-types/gateway/v10.d.ts`):

- discord.js shards per-bot with a `WebSocketManager` + worker threads and a pluggable strategy; this crate connects **one** session, explicitly, caller-driven. No sharding, no workers (4011 is surfaced, not solved).
- discord.js (`@discordjs/ws`) sends the **first** heartbeat after `heartbeat_interval * Math.random()` jitter; this crate sends on the fixed cadence measured from HELLO. For a single-process, human-in-the-loop bot the difference is negligible; if AIRI ever runs many sessions, add jitter (one-line: `last_heartbeat = Instant::now() - interval + jitter`).
- discord.js requests `zlib-stream` transport compression (`CompressionMethod.ZlibStream`) when zlib is available and handles payload decompression; this crate uses **no compression** (plain `encoding=json`). Discord payloads arrive uncompressed and are parsed as-is.
- discord.js tracks heartbeat acks to compute latency and detects broken connections (missed acks → reconnect); this crate surfaces `HeartbeatAck` and leaves liveness policy to the caller — a missing ack is observable as "no HeartbeatAck events between MESSAGE_CREATEs", nothing more.
- discord.js resumes automatically via `strategy.retrieveSessionInfo()`; this crate requires the caller to call `resume()` explicitly after `reconnect()`.
- discord.js exposes a typed event-name map (`MESSAGE_CREATE` etc.) and hundreds of dispatch handlers; this crate decodes exactly READY / RESUMED / MESSAGE_CREATE and ignores the rest (debug log).
- Tolerated payloads: `guild_id` absent (DMs), `author.bot` absent (defaults false), `timestamp` opaque string (no chrono in workspace), unknown JSON keys ignored everywhere.

## Reconnect contract (caller-driven — no threads, no backoff magic)

Automatic reconnect/backoff is deliberately the **caller's loop**, matching the Electron gateway manager. This crate never spawns a thread and never reconnects on its own. Intended caller loop:

```text
loop {
    match client.next_event() {
        Ok(event) => handle(event),
        Err(_)    => { /* backoff is your policy */
            client.reconnect()?;             // socket + HELLO only; session_id/resume_gateway_url/seq preserved
            if client.session_id().is_some() { client.resume()?; }  // op 6
            // else: drop the client, build a fresh one with connect()
        }
    }
}
```

- `reconnect()` = TCP + WS + HELLO. It does **not** send IDENTIFY or RESUME; it preserves `session_id`/`resume_gateway_url`/`seq`.
- `resume()` = op 6 `{ token, session_id, seq }`; no-op (Ok) if no session. Server answers RESUMED → `GatewayEvent::Resumed`, or op 9 → `InvalidSession { resumable }`.
- If `session_id()` is `None` (never reached READY), discard the client and `connect()` again.
- Backoff/jitter/give-up policy, shard management, and lifecycle are **not** in this crate.
- **The Qt app must never auto-connect.** Receiving is opt-in (e.g. behind a `--gateway` flag), and any outbound reaction to a MESSAGE_CREATE stays human-in-the-loop (draft → user presses Send → REST `send_message`).

## What is NOT done

- **Sharding** (incl. the 4011 required-sharding path) — one session only.
- **zlib-stream** transport compression — plain JSON only.
- **Resume across process restarts** — session_id/seq are in-memory; nothing persists them (a restart always means a fresh IDENTIFY and a session-start consumed).
- **Slash commands / interactions** (op 0 `t=INTERACTION_CREATE`), presence/voice dispatches, and all unmapped dispatch types — parsed as unknown and ignored.
- **Automatic app wiring** — nothing in the Qt app calls this yet; no auto-connect anywhere; no bridge; no GUI.
- **Heartbeat-ack watchdog** (missed-ack detection) — the caller must implement if wanted.
- **`GET /gateway/bot` session-start budget enforcement** — not consumed or tracked here.
- **Resume-gateway-url preference** — `resume_gateway_url` is captured and exposed but `reconnect()` reuses the original URL (they are normally identical; if not, a caller wanting the resume URL must build a new client via `connect(resume_url, ...)` + `resume()` — deliberately not hidden inside `reconnect()` so the semantics stay explicit).

## Test evidence

All offline (loopback mock; no network, no gateway.discord.gg):

```
cargo test -p airi-discord
  4 unit tests (gateway_ws_url URL building)                     … ok
  9 integration tests (tests/gateway.rs)                         … ok
    hello_identify_ready_message_create_then_heartbeat_observed  (server asserts IDENTIFY op2/token/intents/properties; READY s=1; MSG_CREATE s=2; heartbeat w/ interval=100 ms observed as op 1 {d: 2} inside 2 s; then a follow-up dispatch releases the client)
    invalid_session_maps_to_typed_error                          (op 9 d=false → InvalidSession{ resumable: false })
    invalid_session_resumable_true_is_preserved                  (op 9 d=true  → InvalidSession{ resumable: true })
    resume_after_reconnect_sends_op6_and_yields_resumed          (two-phase mock: READY+MSG s=2, drop socket; reconnect()+resume() → server asserts op 6 token/session_id/seq==2, replies RESUMED → GatewayEvent::Resumed)
    heartbeat_ack_yields_event_not_panic                         (op 11 → HeartbeatAck)
    close_4004_maps_to_unauthorized                              (close Library(4004) → Unauthorized)
    close_other_code_yields_closed_event                         (close Library(1000) → Closed{ Some(1000) })
    url_without_query_gets_v10_encoding_appended                 (uri observed by mock == "/?v=10&encoding=json")
    url_with_query_is_not_double_appended                        (pathless query URL → "/?v=10&encoding=json", exactly once)
  14 pre-existing REST tests (tests/rest.rs)                     … still pass

cargo clippy -p airi-discord --all-targets -- -D warnings        … clean
cargo fmt -p airi-discord -- --check                             … clean
```

Note for future lanes: tungstenite 0.24's `WebSocket::write` **buffers** Text frames without flushing — send paths in this crate use `send()` (write+flush). Any new write path must do the same or frames sit in the write buffer indefinitely (this cost the first test run).

Not verified: the real gateway (deliberately; hermetic tests only), `wss://` against a real TLS endpoint (the TLS stream variant is coded but only `ws://` is exercised — plain ws is what the mock speaks), and GUI wiring.

## Integration asks (central session / user decisions)

1. **Auto-connect policy** — central session decides whether/how the Qt app may connect (opt-in flag only? never by default?). This lane ships a client, not a lifecycle.
2. **GUI bridge for MESSAGE_CREATE** — a future lane should dispatch `GatewayEvent::MessageCreate` into the chat bridge (likely behind `--gateway`), with all outbound reactions human-initiated via the existing REST `send_message` path.
3. **Token store** — unchanged from wave ⑦'s asks (0600 file under the AIRI data dir, write-only page field). The gateway needs the same store.
4. **Privileged intent enablement** — someone with Dev Portal access must enable MESSAGE_CONTENT for the bot application before the receive path can carry real content; document in the deployment checklist.
5. **Backoff/resume policy** — owner wanted explicit: suggest `min(2^n s + jitter, 60 s)`, resume on 4007/4009-class failures, fresh IDENTIFY otherwise — but the crate intentionally does not encode this.
6. **Session persistence (if ever)** — persisting session_id/seq would save session starts across restarts; out of scope here, needs a decision on where session cache lives.

Lane rules respected: only `crates/airi-discord/**` and this note were touched; no git writes; no new external crates (the `tungstenite` workspace/Cargo.toml edit pre-existed this lane); nothing else in the tree was modified by this lane.
