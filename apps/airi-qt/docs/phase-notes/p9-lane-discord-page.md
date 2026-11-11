<!-- SPDX-License-Identifier: GPL-3.0-or-later -->
# P9 Lane I9 — Discord page: send-only REST slice wired to `DiscordController`

Wave ⑧ lane I9. Scope (owned exclusively):

- `apps/airi-qt/crates/airi-qt/src/bridges/discord.rs` (new bridge)
- `apps/airi-qt/qml/pages/settings/modules/discord/DiscordSettingsPage.qml` (edited in place)
- `apps/airi-qt/docs/phase-notes/p9-lane-discord-page.md` (this note)

Scope (untouched, by lane rule): `build.rs`, `bridges/mod.rs`, `Cargo.toml`, locales, components, `SettingsWindow.qml`. Nothing else in the tree was modified by this lane — the repo is under active multi-lane edit right now (see "Mid-flight discovery" below), so re-verify the snippets against the tree before applying.

## What "wired" means here, exactly

**Send-only REST slice.** The page can now (1) persist a bot token + channel id, (2) verify the bot against `GET /users/@me`, (3) fetch `GET /gateway/bot` for display only, and (4) send exactly the message the human typed to the configured channel, once, on an explicit Send click. Receiving messages and running bot commands are **not** wired and never happen automatically. The `airi-discord` gateway WebSocket exists on disk (another lane landed it mid-flight; see below) but this app never auto-connects to it — receiving is opt-in only, by design. No message is ever sent by any code path here other than the Send button's click handler.

## The bridge — `bridges/discord.rs` (`DiscordController`, JSON boundary)

Config file: `<profile>/airi/discord.json`, or the platform data dir (`<data>/airi-qt/discord.json`) when `--profile` is not set — same convention as the Electron app and as `mcp.rs`.

Schema: `{"token": "...", "channel_id": "...", "bot_name": "...", "bot_id": "..."}` — nothing else ever lands in the file. `bot_name`/`bot_id` are the cached **last-verified** values, written back by `verifyBot` only.

### qproperties (namespace `airi_qt`)

| QML name | Type | Meaning |
| --- | --- | --- |
| `configured` | bool | File exists, parses, and holds a non-empty token |
| `botName` | QString | Cached last-verified bot username (`""` until first successful verify) |
| `botId` | QString | Cached last-verified bot user id |
| `channelId` | QString | Channel id from the config file |
| `lastStatus` | QString | `"unconfigured"` \| `"verified"` \| `"error"` |
| `lastError` | QString | Last human-readable, token-free error (`""` when clean) |
| `working` | bool | True while a network call is in flight |
| `configDir` | QString | Directory holding `discord.json` (display) |

`lastStatus` derivation: on reload/construction, `configured && bot_name` cached in the file ⇒ `verified`; configured without a cached name ⇒ `unconfigured`; unreadable/unparseable file ⇒ `error` (and `configured=false`). A failed `verifyBot` sets it to `error` in memory; saving a fresh token wipes the cached verification (new token ⇒ old `bot_name`/`bot_id` are cleared up front).

QML never sees the token: no qproperty exposes it and nothing is logged. The field in the UI is write-only (`echoMode: TextInput.Password`, always cleared after save).

### qinvokables (all JSON-document returns except `clearConfig`)

| Method | Behavior | Returns |
| --- | --- | --- |
| `saveConfig(token, channelId)` | Empty token ⇒ error, disk untouched. Persists atomically (tmp + fsync + rename, **0600** on unix, re-asserted after rename), clears cached verification, reloads qproperties, then calls `verifyBot` once. | `{"ok":true,"username","id"}` or `{"error":"..."}` (the verifyBot result) |
| `clearConfig()` | Deletes **only** `discord.json` (never the profile). Resets all qproperties. Idempotent (missing file ⇒ `true`). | `true` / `false` |
| `verifyBot()` | `GET /users/@me`. On success persists `username`/`id` as `bot_name`/`bot_id`, sets `lastStatus="verified"`. On failure keeps `configured=true`, sets `lastStatus="error"`. | `{"ok":true,"username","id"}` or `{"error":"..."}` |
| `sendTestMessage(content)` | Empty/whitespace content ⇒ error *before* any network call. Requires stored token and non-empty `channel_id`. Sends verbatim `content` (returned id echoed). Never called internally. | `{"ok":true,"id"}` or `{"error":"..."}` |
| `gatewayInfo()` | `GET /gateway/bot` for **display only**. The app does not connect. | `{"ok":true,"url","shards","remaining"}` or `{"error":"..."}` |

Signal: `configChanged` — emitted after save (reload), after clear, and after a successful verify cache update. The page's handler is idempotent, so the double emission in the save flow (reload + verify cache update) is harmless.

### Error mapping (token-free, human-readable)

`Unauthorized` ⇒ "Discord rejected the bot token (401 Unauthorized) — check the token and try again." · `RateLimited{retry_after, global}` ⇒ "Discord rate limit (global=…) — retry after N.Ns." (no automatic retry; 429 is surfaced inline) · `Http{status,message}` ⇒ "Discord returned HTTP {status}: {message}" · `Transport` ⇒ "could not reach Discord: …" (no token — the token travels in the `Authorization` header, never the URL) · `Decode` ⇒ "failed to decode Discord's response: …" · `GatewayTransport`/`InvalidSession` ⇒ mapped honestly though unreachable from the REST paths used here.

`#[cxx_qt::bridge]` with `#[namespace = "airi_qt"]`, `DiscordControllerRust` storage type, `Default` reads the disk once so qproperties are correct before the page touches the bridge (no round-trip needed at startup). Mirrors the `McpController` idiom (config-path resolution, atomic tmp+rename write, `set_error`-style helpers, `qstring_to_string`, `json_qstring`).

### saveConfig semantics — one deliberate consequence

Saving **requires** re-pasting the token every time (empty token ⇒ error, per the lane spec). Changing only the Channel ID still needs the token re-pasted. This is the spec's choice, kept deliberately: it makes "paste token to replace" literally true and keeps the saved token from silently coupling to an unrelated edit. Noted for the main agent to reconsider if UX complaints arrive.

## The page — `DiscordSettingsPage.qml` (edited in place)

Tabs unchanged (Bot Connection / Access & Routing). Structure per tab 1:

1. **Header** — badge now `live.badge` ("Send-only (REST)"), `warning` variant; the old `notWiredBadge` copy is gone from this page.
2. **Persistent banner** — same warning `ACard` idiom, new copy `live.banner`: REST send + verify are wired; receiving/bot commands are not; receiving is opt-in only, by design; nothing is ever sent automatically.
3. **Status row** (inside Connectivity card) — dot + label + badge now derive from `lastStatus`: grey/`unconfigured`, green/`verified`, red/`error`. The em-dash "ping" placeholder is gone (a ping cannot exist without a gateway).
4. **Bot Token** card:
   - `ATextField` password-echo, **enabled**, write-only; placeholder is `live.tokenPlaceholderReplace` ("Paste token to replace") when configured, else the existing `connectivity.tokenPlaceholder`.
   - **Channel ID** field, enabled, plain echo (not secret).
   - Config-location row (`configPathLabel` + `configPathHint` — shows the folder, never the token; notes 0600 + never shown).
   - **Save & Verify** (accent) — runs `saveConfig`, then shows the result inline: success ⇒ `live.verifyOk` ("Verified as %1 (id %2)") in green; failure ⇒ the bridge's error string in red.
   - When `configured`: small row `live.configuredAs` ("Configured as %1 (id %2)") — or `live.configuredUnverified` when the token was saved but never verified — plus a **Clear token** danger button opening an `AModal` (`live.clearConfirm*`) which calls `clearConfig`.
5. **Verify connection** (own caption + card) — copy `live.gatewayDisplayOnly` states plainly that receiving is not enabled and the app never opens a gateway connection; a **Fetch gateway info** button calls `gatewayInfo()`; after a fetch, the card shows the gateway URL, recommended shard count and remaining IDENTIFY budget — or the error in red. Display-only; nothing else is implied by fetching.
6. **Send a test message** (own caption + card) — states it sends exactly what you type, once, on click; `ATextField` (empty blocked both by the button's `enabled` and by the bridge), **Send** button (enabled only when `configured` and non-empty), result inline: ok ⇒ `live.sentOk` ("Sent (id %1)"), error in red. Nothing is ever pre-filled or auto-sent.
7. **Unchanged**: owner resolution row (disabled + tooltip), Connect/Disconnect (disabled), Controls & Modalities (disabled switch rows), Active Presence, Debug Actions, Developer Console, and the whole Access & Routing tab — all remain rendered-but-disabled with tooltips.

`Component.onCompleted` + a `Connections { onConfigChanged }` handler keep `channelField`/`tokenField` in sync with the bridge; `verifyStatus`/`sendResult`/gateway results are local page state, never persisted.

## Security posture, exactly

- **Token at rest**: `<profile>/airi/discord.json` — written atomically (sibling tmp, fsync, rename), created with **0600** on unix and re-asserted after rename; existing broader-permission tmp files are corrected by the post-rename `set_permissions`. Never the profile dir; `clearConfig` deletes only `discord.json`.
- **Token in the app**: never returned to QML (no qproperty), never logged, never shown (write-only UI), and the `airi-discord` client has no accessor back out of itself; its `Debug` prints `token: "***"`; errors never carry the token.
- **Human in the loop, always**: every network call originates from a click (Save & Verify, Fetch gateway info, Send). No timers, no background polling, no auto-send, no gateway connection, no intents. Receiving is opt-in only by design and this app never opts in.
- **Rate limiting**: observed, surfaced inline (429 ⇒ retry-after shown); never retried automatically.
- **At-rest plaintext**: the token is plaintext in a 0600 file — same posture as other app-local secrets in this build (the Electron original kept it in localStorage, which is worse). Moving to a platform credential store is a separate, user-level dependency decision, not something this lane may do unilaterally.
- **Untested posture**: Save & Verify / Send were not exercised against the real Discord API (hermetic, `rand`-free; consistent with `airi-discord`'s mockito-only stance). First real-token feedback will come from the user.

## Verification evidence

Environment note: the repo tree is being edited by other lanes **during** this lane (e.g. `airi-discord/error.rs` gained `GatewayTransport`/`InvalidSession` mid-flight — the bridge maps those variants and compiles against the current crate). All checks below were run against the tree as of 2026-11-11.

1. **qmllint 6.12.0** (Qt 6.12.0, `/usr/lib/qt6/bin/qmllint`) on the page, in a module sandbox at `/tmp/opencode/qmllint-discord/com/airi/airiqt/` — copy of the current `qml/` sources plus the **cxx-qt-generated** `qmldir` (lists `DiscordSettingsPage 1.0`) and `plugin.qmltypes` (generated by the scratch build's `airi-qt` — declares `airi_qt::DiscordController` with all eight qproperties, `configChanged`, and every qinvokable) — **0 errors, 0 warnings**. (The sandbox's page copy is current; sandbox left in `/tmp`, not committed.) One initial warning (`botName.length`) was fixed by comparing against `""`.
2. **`cargo check -p airi-qt`** in a scratch copy (`/tmp/opencode/airi-qt-discord-check`, `tar` of `apps/airi-qt` minus its 50 GB `target/`; integration applied **in the copy only**: `crates/airi-qt/build.rs` `files` += `discord.rs`, `bridges/mod.rs` += `pub mod discord;`) — **clean** (`Finished dev profile`; run twice, incl. after the final rustfmt pass).
3. **`rustfmt --check`** on `discord.rs` — clean (edition 2024 rules).
4. **Functional (scratch-only, no network)** — a temporary `#[cfg(test)]` module was appended to the scratch copy's `discord.rs` and `cargo test -p airi-qt bridges::discord` run: `config_roundtrip_atomic_and_0600` **passed** — covers tmp+rename+0600 on create and rewrite, `XDG_DATA_HOME` redirected to a throwaway dir (the real `~/.local/share/airi-qt/` was not touched), snapshot derivation (`configured`, `bot_name`, `channel_id`), verification-cache wipe on token rotation, and `configured=false` after clear. **The test module is NOT in the repo file** (scratch only); the repo file stays minimal per lane rules.
5. **Not run**: `cargo build` / full link / smoke (lane rules — the main agent gates after registration); locales; SettingsWindow; repo `cargo check` in the repo itself (bridge is not in the module tree until the main agent applies the snippets).
6. Brace/paren/bracket balance and i18n-namespace scans: all UI strings are `shell.discord.*`/`shell.discord.live.*` keys or glyphs; no hardcoded hex; colors are `Theme.*`.

## Integration snippets for the main agent (do NOT apply — this lane may not)

### 1. `apps/airi-qt/crates/airi-qt/build.rs` — add to the `files` list right after the `mcp.rs` line:

```rust
        manifest_dir.join("src/bridges/discord.rs"),
```

### 2. `apps/airi-qt/crates/airi-qt/src/bridges/mod.rs` — add (alphabetical position, between `data` and `desktop`):

```rust
pub mod discord;
```

### 3. Page registration in `build.rs` — **already present** (`module = module.qml_file("qml/pages/settings/modules/discord/DiscordSettingsPage.qml");` — landed with the scaffold lane). No QML-module changes required. `emit_rerun_if_changed` already covers the tree.

### 4. SettingsWindow nav/StackLayout — already registered by the scaffold lane (Discord page visible in the settings list). No changes from this lane.

### 5. i18n — add these keys to `packages/i18n/src/locales/<lang>/shell.yaml` under the existing top-level `discord:` section as a nested `live:` group (flatten to `shell.discord.live.*`). English source strings (this lane edits **no** locale files). Keys whose value contains `:`, a leading `⚠`-ish glyph, an apostrophe or a `%` follow the existing single-quote pattern shown:

```yaml
live:
  badge: 'Send-only (REST)'
  banner: 'The Discord module is wired for sending only: Save & Verify checks your bot token, and sending the message you type goes through the Discord REST API. Receiving messages and running bot commands are not wired — the gateway WebSocket exists in airi-discord, but the app never auto-connects to it; receiving is opt-in only, by design. Nothing is ever sent automatically.'
  statusUnconfigured: 'Not configured'
  statusVerified: 'Verified'
  statusError: 'Error'
  tokenPlaceholderReplace: 'Paste token to replace'
  channelIdLabel: 'Channel ID'
  channelIdDescription: 'The Discord channel your test message is sent to. Enable Developer Mode in Discord, right-click the channel, and choose Copy Channel ID.'
  channelIdPlaceholder: 'e.g. 123456789012345678'
  configPathLabel: 'Config location'
  configPathHint: 'Token stored in discord.json in this folder with owner-only permissions (0600). The token is never shown in the app.'
  saveAndVerify: 'Save & Verify'
  configuredAs: 'Configured as %1 (id %2)'
  configuredUnverified: 'Configured — not verified yet'
  clearToken: 'Clear token'
  clearConfirmTitle: 'Clear the stored token?'
  clearConfirmBody: 'This deletes discord.json from your profile (token and cached bot info). Your other settings stay untouched. You can paste a new token at any time.'
  clearConfirmCancel: 'Cancel'
  clearConfirmConfirm: 'Clear token'
  verifyOk: 'Verified as %1 (id %2)'
  verifySectionTitle: 'Verify connection'
  gatewayDisplayOnly: 'Display only — receiving is not enabled. This calls GET /gateway/bot to show the gateway URL and the bot’s remaining IDENTIFY budget. The app never opens a gateway connection.'
  fetchGatewayInfo: 'Fetch gateway info'
  gatewayUrlLabel: 'Gateway URL'
  gatewayShardsLabel: 'Recommended shards'
  gatewayRemainingLabel: 'IDENTIFY budget remaining'
  sendTitle: 'Send a test message'
  sendDescription: 'Sends exactly what you type, once, to the channel above — only when you press Send. Nothing is ever sent automatically.'
  sendPlaceholder: 'Type a message to send…'
  send: 'Send'
  sentOk: 'Sent (id %1)'
```

Notes for the locale editor: `banner`, `gatewayDisplayOnly`, `sendDescription` contain an apostrophe or a Unicode apostrophe/em-dash and are safe inside single quotes as shown; `gatewayDisplayOnly` uses a curly apostrophe in `bot’s` (switch to straight + double-quoting if crowdin prefers — value is otherwise verbatim). `%1`/`%2` are literal replacement placeholders (the page does `.replace("%1", …)` on the translated string) — they must survive translation.

Old keys left in place but **no longer used by this page**: `shell.discord.connectivity.notWiredState`, `shell.discord.connectivity.notWiredBadge`, `shell.discord.deferredNotice`. They remain valid for other pages/back-compat; pruning is a locale-owner decision, not this lane's.

## Mid-flight discovery (affects the main agent)

`airi-discord` is **actively being modified by another lane** right now: `error.rs` gained `GatewayTransport(String)` and `InvalidSession { resumable }`, `lib.rs` exports a `GatewayClient`, and `gateway.rs` / gateway tests exist (uncommitted). The bridge here compiles against the **current** crate (those two variants are mapped). If the gateway lane changes `DiscordError` again or the REST client API, re-run the scratch check before registering. This lane did not read `gateway.rs` in depth and wires none of it.

## Known limitations / explicit non-goals

- No gateway connection, no intents, no `MESSAGE_CREATE` handling, no slash commands, no owner resolution (username → id), no presence/guild lists, no moderation, no dev console, no ACL routing — all stay disabled exactly as scaffolded.
- `lastStatus` is in-memory-plus-disk-derived, not persisted; a fresh process shows `verified` iff a cached `bot_name` exists in the file.
- `saveConfig` requires a token re-paste even for a channel-id-only change (see above).
- Token at rest is plaintext 0600; not a credential store.
- The page reacts to `configChanged` idempotently; the save flow emits it twice (reload + verify cache update) — intentional, documented.
- Gateway info is display-only and makes a real REST call per click; it is not a connectivity latch and does not enable receiving.

## Lane rules respected

Only the three owned paths were touched. No `build.rs`/`mod.rs`/`Cargo.toml`/locales/components/`SettingsWindow.qml` edits in the repo (integration was applied exclusively inside `/tmp/opencode/airi-qt-discord-check` to validate). No git operations performed. `target/` untouched in the repo; scratch copy and qmllint sandbox live under `/tmp/opencode/`.
