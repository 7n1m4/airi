<!-- SPDX-License-Identifier: GPL-3.0-or-later -->
# P9 Lane B — Discord gateway bridge: opt-in, in-memory MESSAGE_CREATE receive path wired into the app

Wave ⑨ lane B. Scope (owned exclusively):

- `apps/airi-qt/crates/airi-qt/src/bridges/discord_gateway.rs` (new bridge)
- `apps/airi-qt/qml/pages/settings/modules/discord/DiscordSettingsPage.qml` (edited in place)
- `apps/airi-qt/docs/phase-notes/p9-lane-discord-gateway-wire.md` (this note)

Lane rules respected: no `build.rs`/`bridges/mod.rs`/`main.rs`/`airi-discord`/locales edits in the repo; no git writes; nothing outside the three owned paths was modified by this lane. Scratch integration (applying the `build.rs`/`mod.rs` registrations) was done **in a `/tmp` copy only** — the repo still has the bridge unregistered, so the repo's `cargo check` does not yet see this file (see "Integration snippets").

## What "wired" means here, exactly

A receive path for `<token>@<channel>` messages: the user presses **Start** on the new **Gateway events (opt-in)** card, a background thread resolves the token from the same `discord.json` the REST slice uses, opens a gateway WebSocket, and pushes received `MESSAGE_CREATE` dispatches into a capped in-memory queue that the page renders. The human stays in the loop at every step:

* The gateway thread starts **only** from the Start button (or, after the main agent wires it, an explicit `--discord-gateway` flag). No timer, no auto-connect, no resume-on-launch, no background reconnect before the human asked for one.
* The queue is an **inbox, not a command processor**: nothing parses, dispatches, or reacts to incoming messages. No reply is ever sent automatically. Reacting (e.g. the human pressing Send on the REST card) is out of scope.
* Message content is personal data: kept in memory only, capped at 100 entries, truncated to 400 chars, cleared on **Stop** and on **Clear**, never persisted, never logged, never forwarded anywhere.

## The bridge — `bridges/discord_gateway.rs` (`DiscordGatewayController`, JSON boundary)

### qproperties (namespace `airi_qt`)

| QML name | Type | Meaning |
| --- | --- | --- |
| `running` | bool | Worker thread alive |
| `statusLine` | QString | `"stopped"` \| `"running"` \| `"listening as <username>"` \| `"error: …"` |
| `eventsJson` | QString | JSON array of events, **newest-first**, capped at 100 |
| `error` | QString | Last human-readable, token-free error (`""` when clean) |

### qinvokables / signals

| Method | Behavior | Returns |
| --- | --- | --- |
| `start()` | Spawns the worker thread (the ONLY way the gateway connects). `false` + `error` when already running or when no token is configured (synchronous pre-flight check). | `bool` |
| `stop()` | Sets the stop flag, **clears the events queue** (personal data), waits up to **2 s** for the worker, then returns `true` regardless. If the worker is blocked in a socket read (read timeout = the server's heartbeat interval, typically ~41 s), the Qt thread is NOT blocked: the stop flag is set and the worker exits at the next read boundary / when the socket errors. The page observes `running → false` on its next 1 s poll. | `bool` (always `true`) |
| `refresh()` | No-op re-sync — the qproperties ARE the refresh. Copies shared state into qproperties, emits `stateChanged`. The page calls it on a 1 s `Timer` while `running`. | `void` |
| `clearEvents()` | Drops every queued event. | `bool` (always `true`) |

Signal: `stateChanged()` — emitted after every mutation is copied into qproperties (from `start`/`stop`/`refresh`/`clearEvents`). The page's `Connections` handler re-parses `eventsJson` (idempotent).

### Event shape (JSON objects in `eventsJson`)

```json
{
  "id": "…",
  "channelId": "123…",
  "authorName": "alice",
  "authorBot": false,
  "content": "≤400 chars",
  "timestamp": "<opaque ISO string from Discord>",
  "receivedMs": 1762761600000
}
```

Content is truncated to **400 Unicode chars** (not bytes). `receivedMs` is local epoch milliseconds at receipt (Discord's `timestamp` is passed through verbatim — opaque, not parsed). Queue cap: **100**, oldest dropped.

### Thread model

* `start()` spawns one `std::thread` (`discord-gateway`). The thread never touches a QObject; it mutates the shared `Arc<Mutex<GatewayShared>>` from a process-lifetime `OnceLock`.
* `GatewayShared { running, status, events: VecDeque<Value>, last_error, stop, thread: Option<JoinHandle<()>> }` — the `thread` field is a private extension beyond the spec's schematic field list (needed so `stop()` can join within the 2 s grace); everything else matches the requested shape.
* Every worker exit path funnels through one epilogue that flips `running → false`, so `stop()`'s grace poll and the page's 1 s timer always observe the worker's death — including runs that failed before the event loop (no token, gateway URL fetch failed, IDENTIFY rejected).
* `stop()` cannot join a read-blocked socket thread with a std timeout, so the grace poll checks `running` every 10 ms; on expiry the handle is detached (dropped) and the worker exits at the next read boundary. Documented in the bridge module docs and on `stop()`'s docs.
* Reconnect backoff sleeps are sliced into 100 ms so a `stop()` request is observed within ~100 ms even mid-backoff (the spec's 1/2/4/8/16 s delays would otherwise keep the worker alive for up to 16 s past a Stop).
* Poison-tolerant locking throughout (`unwrap_or_else(|e| e.into_inner())`) — a panicking worker cannot wedge the UI.

### Worker loop and bounded reconnect policy (caller-driven, as the crate contract requires)

The `airi-discord` gateway crate deliberately never reconnects on its own — backoff/lifecycle is the caller's loop, and this worker **is** the caller. Policy:

1. Resolve `<profile>/airi/discord.json` (same resolution as `bridges::discord` — `<profile>/airi/discord.json`, or `<platform-data>/airi-qt/discord.json`, mirrored, not shared). Missing/unreadable/empty token ⇒ `status = "error: …"`, thread exits (and `running` flips to false).
2. `DiscordRestClient::get_gateway_url()` (`GET /gateway/bot`) → url. Blocking reqwest on the worker thread — never the Qt thread.
3. `GatewayClient::connect(url, token, DEFAULT_INTENTS)` (`512 | 4096 | 32768` = `GUILD_MESSAGES | DIRECT_MESSAGES | MESSAGE_CONTENT`) → HELLO → IDENTIFY. The READY dispatch arrives as the first `next_event()` and is stored as the status line `"listening as <username>"`.
4. Loop until stop: `next_event()`. `MESSAGE_CREATE` ⇒ pushed into the queue (cap 100). `HeartbeatAck`/`Resumed` ⇒ status bookkeeping only. Any transport/protocol error, **or a server `Closed` frame** ⇒ bounded reconnect:
   * **5 attempts** with **1s / 2s / 4s / 8s / 16s** backoff (before the attempt, the status shows `error: <reason> — reconnecting in Ns (attempt k/5)`).
   * Per attempt: if a session id is known (READY reached) → `client.reconnect()` (socket + HELLO, session/seq preserved) followed by `client.resume()` (op 6). Otherwise → fresh `GatewayClient::connect()` (a fresh IDENTIFY is required; `reconnect()` alone would leave the server waiting for an IDENTIFY that never comes).
   * If RESUME is rejected with `InvalidSession`, the session is dead: subsequent attempts fall back to a fresh IDENTIFY (`resume_broken`).
   * `Unauthorized` (4004) is **fatal — never retried**; status goes to `error: …` immediately.
   * `Closed{code}` frames are treated the same as transport errors and enter the same bounded loop (4004 never reaches this path — the crate maps it to `Unauthorized`). Note: this deliberately means close **4013/4014** (invalid/disallowed intents — a Developer Portal problem) also burn 5 attempts (~31 s total) before giving up and parking in `error: …`; they are not specially exempted (see "Decisions").
   * After the 5th failed attempt ⇒ `status = "error: gateway connection lost after 5 reconnect attempts (…)"`, `stop` is set, the worker exits. The human presses Start again to retry.
5. Epilogue: `running = false`; status stays `error: …` if the run gave up, else `"stopped"`. Events are **not** touched here — `stop()` owns the clear.

This caller-driven, bounded reconnect is a deliberate choice (the crate contract explicitly leaves backoff to the caller) and is documented in the bridge module docs. It is **not** a watchdog: heartbeat ACK latency is not monitored, and there is no jitter (single session — see the crate's own notes).

### Token posture

* Reuses the REST slice's `discord.json` (schema `{token, channel_id, bot_name, bot_id}`, 0600 on unix, atomic tmp+rename written by the REST lane). The gateway bridge only reads it.
* The token never crosses the boundary, never appears in a qproperty, never in a status line, never in an event, never in `last_error`/`error`. The `Debug` impl of the bridge's `GatewayConfigFile` prints `token: "***"`; the crate's `GatewayClient` also redacts its own `Debug`. Error strings are built exclusively from `DiscordError` variants, which never carry the token.
* The token lives in memory inside the worker's `GatewayClient` for the duration of the session only; `stop()` drops the client and the queue.

### Event lifecycle (honesty contract)

`MESSAGE_CREATE` → JSON (shape above, content ≤ 400 chars) → in-memory `VecDeque` (cap 100, oldest dropped) → `eventsJson` (newest-first) → page renders → wiped on Stop / Clear. **Nothing is ever written to disk, the database, the config, or the network. No event is logged. Participant names/content never leave the machine.** The card is explicitly labeled an inbox; no code path anywhere parses content.

### Privileged intent requirement (deployment prerequisite)

`DEFAULT_INTENTS` includes **`MESSAGE_CONTENT` (1 << 15 = 32768), a privileged intent**. The bot must have it enabled in the Discord Developer Portal (Bot → Privileged Gateway Intents → Message Content) or:

* verified applications: IDENTIFY is rejected (close 4014 / op 9 INVALID SESSION) — the card lands in `error: …`;
* unverified applications: the connection succeeds, READY arrives, but **`MESSAGE_CREATE` dispatches arrive with empty `content`** — the card shows rows with `@author` and `(#channel)` but a blank body.

What the user sees without the intent: rows render with empty content; nothing about the failure is ambiguous in `airi-discord`'s docs. This bridge cannot enable the intent — it is a portal-side toggle.

## The page — `DiscordSettingsPage.qml` (edited in place; everything else kept identical)

New card **"Gateway events (opt-in)"** (caption + `ACard`) right after the **Send a test message** card (before the Controls section), containing:

* **Status row** — `ABadge` (`success`/`error`/`default` → Running/Stopped/Error) + `statusLine` text (error-colored when it starts with `error`) + **Start** (accent) / **Stop** (default) buttons. Start is visible when stopped, Stop when running.
* **Start enablement**: `enabled: controller.configured` — the page **reuses the REST bridge's `DiscordController.configured`** (the token-configured state lives there; no duplicated pre-flight). The gateway bridge *also* re-checks at `start()` and fails fast with a synchronous error if the token vanished between the two reads. When not configured and not running, a hint row shows `needToken`.
* **Events list** — `ListView` over `page.gatewayEvents` (from `eventsJson`), per row: `@authorName` (bold, elided) + `(#channelId)` + `Bot` badge (only when `authorBot`) + absolute local time (`Qt.formatDateTime(new Date(receivedMs), "yyyy-MM-dd HH:mm")`, falling back to the raw `timestamp` verbatim if unparseable); below: wrapped content **elided at 3 lines**. Implicit height `min(360, count*88)`; `clip: true`.
* **Empty state** — `AEmptyState` (📭): "Listening stopped / no events yet" — shown when the queue is empty.
* **Clear** — `AButton.Danger`, enabled when events exist, calls `gatewayController.clearEvents()` **directly with no AModal**, mirroring the MCP page's destructive idiom (`shell.mcp.manage.delete` → direct danger button, no confirm) — clearing an in-memory inbox is materially less destructive than deleting an MCP server, which is the repo's existing no-confirm bar. Token clearing (persisted data) still uses the AModal; untouched.
* **Polling** — a 1 s `Timer` (`running: page.gatewayRunning`) calls `gatewayController.refresh()` (qinvokable that re-emits `stateChanged`); the `Connections` handler re-parses and repaints. The timer stops itself when `running` flips false (after Stop / after give-up / after a fatal error).
* **`doClearConfig()`** now also calls `gatewayController.stop()` + `gatewayController.clearEvents()` before clearing the token — otherwise clearing the token would leave a live session listening. Documented behaviour change; syncHelper untouched.
* **Header comment** updated to reflect that receiving is now wired as strictly opt-in, in-memory; everything else (tabs, disabled cards, tooltips, Access & Routing demo tab) is byte-identical.

## Decisions made (and why)

* **Reused `DiscordController.configured` for Start enablement** — the token-configured bit already lives in the REST bridge's qproperty on this page; duplicating it in the gateway bridge would risk the two drifting. The gateway bridge still re-checks at `start()` (defense in depth; the page check is advisory).
* **Direct Danger button for Clear, no AModal** — mirrors the MCP destructive idiom (the only destructive-action precedent in the module's sibling pages); events are in-memory and reconstructible only by listening again, so a confirm step is cargo cult, not safety.
* **`stop()` clears the queue unconditionally** — the honesty rail ("cleared on Stop") outranks the convenience of inspecting what arrived before you pressed Stop. "Events disappear on Stop + Clear".
* **Close frames `Closed{code}` are reconnectable, not fatal** — the spec's bounded-reconnect rule is applied uniformly; only `Unauthorized` (4004) is fatal. 4013/4014 (intent misconfig) therefore take the full 5-attempt path before giving up. Alternative considered and rejected: special-casing 4013/4014 as fatal. Rejected because the spec enumerates the reconnect policy and only flags 4004-class auth failure as the fatal case, and because portal mistakes should surface once as a final error, not as an instant give-up with no path to recovery after a portal fix.
* **`thread: Option<JoinHandle<()>>` private field** added to the shared state beyond the schematic spec — required for join-with-grace in `stop()`. Not exposed to QML.
* **Fresh IDENTIFY fallback when no session id** (instead of literal `reconnect()`-only) — `reconnect()` preserves session state but sends neither IDENTIFY nor RESUME; without a session id the gateway would wait forever for an IDENTIFY that never comes. Documented in code and here.
* **The page's stale persistent banner (`shell.discord.live.banner`) was NOT edited** — it still describes receiving as "not wired", which is now untrue. Locales are central's; see the i18n section for the requested value update.

## i18n keys (English source strings; central adds ×10) — namespace `shell.discord.live.gateway.*`

```yaml
gateway:
  title: 'Gateway events (opt-in)'
  description: 'Receive messages your bot can see — strictly opt-in and human-driven. Pressing Start opens a read-only connection to the Discord gateway; received messages stay in memory only (max 100, newest first), are never persisted, logged, or forwarded anywhere, and are wiped when you press Stop or Clear. This card is an inbox, not a command processor: no command is ever parsed or run, and no reply is ever sent automatically. Requires the privileged MESSAGE_CONTENT intent (Discord Developer Portal → Bot → Privileged Gateway Intents → Message Content). Without it, events still arrive but with an empty content field.'
  statusRunning: 'Running'
  statusStopped: 'Stopped'
  statusError: 'Error'
  start: 'Start'
  stop: 'Stop'
  clearEvents: 'Clear events'
  emptyTitle: 'No events yet'
  emptySubtitle: 'Listening is stopped, or no message has arrived yet. Press Start to listen — received messages appear here and never leave this machine.'
  botBadge: 'Bot'
  needToken: 'Save a bot token first (Bot Connection tab) to enable listening.'
```

That is **12 keys** (noted as ×10 in the hand-off; two extras — `needToken` and `botBadge` — were unavoidable if the card is to be honest about its preconditions and to render the Bot badge). `%1`/`%2` placeholders are not used by these keys.

**Requested value change to an existing key** (central owns locales): `shell.discord.live.banner` — the current copy says receiving/bot commands are "not wired", which is now stale. Suggested replacement value:

> 'The Discord module can send and (strictly opt-in) receive: Save & Verify checks your bot token; sending the message you type goes through the REST API; receiving lives in the "Gateway events (opt-in)" card and only ever starts when you press Start — nothing is ever sent automatically, and received messages stay in memory only.'

`shell.discord.live.gatewayDisplayOnly` (existing value: "Display only — receiving is not enabled …") is **also now stale** — it was written when fetching gateway info was receive-free. Suggested trim: drop the "receiving is not enabled" clause and keep the display-only fetch semantics, e.g.:

> 'Display only. This calls GET /gateway/bot to show the gateway URL and the bot’s remaining IDENTIFY budget. It does not connect to the gateway; use the "Gateway events (opt-in)" card to receive messages.'

No other existing keys reference receiving.

## Integration snippets for the main agent (do NOT apply from this lane)

### 1. `apps/airi-qt/crates/airi-qt/build.rs` — add to the `files` list, right after the `discord.rs` line (line 41):

```rust
        manifest_dir.join("src/bridges/discord_gateway.rs"),
```

### 2. `apps/airi-qt/crates/airi-qt/src/bridges/mod.rs` — add (alphabetical position, between `discord` and `i18n`):

```rust
pub mod discord_gateway;
```

### 3. `apps/airi-qt/crates/airi-qt/Cargo.toml` — **no change needed**: `airi-discord = { path = "../airi-discord" }` is already present (verified in HEAD). The brief's assumption that the main agent must add it is stale — it is already a dependency (the REST lane uses it). Nothing else to declare; no new external crates.

### 4. Page registration in `build.rs` — **already present** (`module.qml_file("qml/pages/settings/modules/discord/DiscordSettingsPage.qml")`). No QML module changes required; `DiscordGatewayController` is a cxx-qt `#[qml_element]` typed `airi_qt::DiscordGatewayController` and resolves through the generated plugin (verified in the scratch qmllint sandbox).

### 5. `main.rs` `--discord-gateway` autostart wiring (sketch; NOT applied by this lane)

The flag must start the same worker the Start button starts — nothing about the worker is QML-specific (`gateway_run`/`start` logic lives behind the `QObject`, but the spawn logic can be shared). Minimal-touch sketch:

```rust
// main.rs — Cli
/// Start the Discord gateway receive worker after boot (opt-in).
pub discord_gateway: bool,
// parse: "--discord-gateway" => discord_gateway = true,

// main.rs — after the QML engine is set up (or before exiting smoke path):
if cli.discord_gateway {
    // New free fn in bridges::discord_gateway (main agent adds it, ~10 lines):
    //   pub(crate) fn start_from_main() -> bool {
    //       // identical pre-flight + spawn as qobject::DiscordGatewayController::start,
    //       // minus the Pin<&mut Self>; sets the same shared GatewayShared state,
    //       // status flows to the page via the 1 s timer like a button-press start.
    //   }
    if !crate::bridges::discord_gateway::start_from_main() {
        eprintln!("[airi-qt] discord-gateway: autostart requested but not started (see discord settings page)");
    }
}
```

Notes for the wiring:
* The autostart path must obey the same rails: it may still refuse (no token ⇒ logs one line, does not start). It must never spawn "because it's convenient".
* `start_from_main()` needs the shared pre-flight factored out of the qinvokable (small refactor, still ≤ ~30 lines) — or the main agent can duplicate the ~15-line spawn block and own the duplication explicitly. Either way the worker body (`gateway_run`) is reused untouched.
* The flag should probably also be honoured under `--smoke`? Recommend **not** — smoke mode must not open sockets. If wired, gate it out under `cli.smoke`.
* Do **not** make `--discord-gateway` part of any default or packaging template.
* Alternative considered and rejected: setting a static `AUTOSTART: AtomicBool` in `bridges::discord_gateway` that the page honours on `Component.onCompleted` — it couples boot to QML construction order and hides a socket from headless/smoke runs; the free-fn call in `main` is explicit and greppable.

### 6. SettingsWindow / nav — **no changes** (Discord page already registered by the scaffold lane).

## Verification evidence

All against a scratch copy (`/tmp/opencode/airi-qt-gateway-check`; `tar` of `apps/airi-qt` minus `target/`/`node_modules`; registrations `build.rs` `files` += `discord_gateway.rs` and `bridges/mod.rs` += `pub mod discord_gateway;` applied **there only**):

1. **`cargo check -p airi-qt`** — clean (`Finished dev profile`, 41 s after two rounds of doc-comment fixes for `#![deny(missing_docs)]`).
2. **`cargo clippy -p airi-qt -- -D warnings`** — clean (after fixing 3 `needless_borrow` lints flagged by `clippy::needless-borrow`).
3. **`cargo test -p airi-qt discord_gateway`** — build finished (2m09s), **3 passed**: `truncates_to_char_boundary_not_bytes`, `events_json_is_newest_first`, `events_queue_caps_at_max` (cap 100, oldest evicted, keeps `"25"` as oldest after 125 pushes).
4. **`rustfmt --edition 2021 --check`** on the bridge — clean. (Crate `edition = 2021`.)
5. **qmllint 6.12.0** (`/usr/lib/qt6/bin/qmllint`) in a module sandbox (`/tmp/opencode/qmllint-gateway/com/airi/airiqt/{qml/**, qmldir, plugin.qmltypes}` where the qmldir/plugin.qmltypes come from the scratch build's `target/cxxqt/qml_modules` — declares `airi_qt::DiscordGatewayController` with all qproperties + `stateChanged`): **0 errors, 0 warnings**. An earlier iteration had 2 `unqualified` warnings (delegate touching outer ids) which were fixed by `ListView.view.width` and an inline binding; final run is completely silent. Baseline sanity check of the **original** page in a correct sandbox layout: the same 2-warning class existed pre-change (not re-measured line-by-line; recorded as class-equal).
6. **Full repo build / link / smoke** — NOT run (lane rules; registration not applied in repo). The bridge's first compile in-repo happens when the main agent applies snippets 1–2.
7. **No live network test** — no real token was used; the worker path against `gateway.discord.gg` is unverified by this lane (hermetic only; consistent with `airi-discord`'s stance). First real-token feedback comes from the user.
8. Bracket/brace balance and string scan of the QML: all UI strings are `shell.discord.live.gateway.*` keys or glyphs; no hardcoded hex; colors are `Theme.*`.

## Explicit not-done list

* **No command parsing / chat dispatch / interactions** — the card is an unread, unmoderated inbox; nothing interprets content.
* **No persistence** — events never touch disk/DB/config; the queue is per-process, capped, and wiped on Stop/Clear.
* **No auto-start** — the worker starts only via the Start button (and, pending the main agent's wiring, `--discord-gateway`). No `--smoke` autostart either.
* **No resume-across-restart** — `session_id`/seq are in-memory; a restart means a fresh IDENTIFY and one consumed session start.
* **`--discord-gateway` flag, bridge registration (`build.rs`/`mod.rs`), i18n keys, banner/`gatewayDisplayOnly` value updates, main.rs autostart** — all pending the central session (snippets above).
* **4013/4014 not special-cased** — intent misconfiguration burns the full bounded backoff (≈31 s) before `error: …` (decision documented above).
* **No heartbeat-ACK watchdog, no jitter, no sharding, no compression, no presence/guild dispatches, no slash commands** — all out of scope; see `p9-lane-discord-gateway-ws.md` for the crate-level list.
* **No live-network verification, no GUI smoke run.**
* **Banner copy (`shell.discord.live.banner`) and `shell.discord.live.gatewayDisplayOnly` are now stale** — locale edits requested from central (values above); not edited here.
* **`doClearConfig()` behaviour change** — clearing the token now also stops the gateway worker and clears its queue. Flagged for central; trivial to revert if the delegation disagrees.

## Lane rules respected

Only the three owned paths were touched (`crates/airi-qt/src/bridges/discord_gateway.rs` new, `qml/.../DiscordSettingsPage.qml` edited, this note new). No `build.rs`/`mod.rs`/`Cargo.toml`/`main.rs`/locales/components edits in the repo; no git operations; `target/` untouched in the repo; scratch copies and qmllint sandboxes live under `/tmp/opencode/` and are disposable. The pre-existing working-tree modifications in `apps/airi-qt/**` (MMD lane: `build.rs`, `mod.rs`, `Cargo.toml`, `main.rs`, `bridges/mmd.rs`, `crates/airi-mmd/**`, `p10-lane-mmd-m1.md`, `p12-cutover-plan.md`) are **not mine** and were not touched.
