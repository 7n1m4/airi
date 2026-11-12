<!-- SPDX-License-Identifier: GPL-3.0-or-later -->
# P9 Wave ⑧ batch — wiring wave (backends → Qt UI), per user decision 2026-11-11

User decisions applied: `tokio-tungstenite` approved (Discord gateway WebSocket); MMD
verification via synthetic fixtures (no real `.pmx`); SDEF→BDEF2 approximation accepted;
"wire everything up" — this wave.

## Lanes

- **Lane I6 — `airi-discord` gateway WebSocket** (`p9-lane-discord-gateway-ws.md`): blocking `GatewayClient` on tungstenite 0.24 (HELLO → IDENTIFY → heartbeat op 1 with seq tracking inside `next_event`'s read loop; op 11 ack; `READY`/`RESUMED`/`MESSAGE_CREATE` parsed; `INVALID SESSION` typed; close 4004 → `Unauthorized`). `DEFAULT_INTENTS = GUILD_MESSAGES|DIRECT_MESSAGES|MESSAGE_CONTENT` (privileged — bot must enable in dev portal). Caller-driven reconnect/resume contract (no threads; app never auto-connects). 28/28 tests incl. a loopback tungstenite mock. Note for future lanes: tungstenite 0.24's `write()` does not flush — always `send()`.
- **Lane I7 — `airi-channel` renderer handler registry** (`p9-lane-channel-renderer.md`): `bind_with_renderer` with a `HashMap<String, Box<dyn Fn(&str, &Value) -> Result<Value, String> + Send + Sync>>`; `renderer.<method>` dispatched under the prefix only, behind `catch_unwind`; `rpc_handler_error` (512-char cap) on error, `rpc_handler_panic` (no payload leak) on panic, `rpc_not_implemented` when unregistered. `bind` unchanged semantics (empty registry). 77/77 tests. Deviation: `Send + Sync` bound (map cloned across connection threads).
- **Lane I8 — Cloud Sync page wired to `airi-sync`** (`p9-lane-sync-page.md`): `SyncController` bridge (`saveTargetPath` — renamed from the spec's `setTargetPath`, which collided with cxx-qt's generated property slot; the property keeps its name) + page wiring: local-folder target (path field, Save), **Test Connection** (probe snapshot, kept), **Sync Now** (whole-tree snapshot incl. `airi.sqlite*`), live **Saved Snapshots** list with per-row **Verify** (re-hash) and **Restore…** (dry-run plan → confirm → `require_clean` restore, DirtyTarget → inline refusal → explicit "Overwrite anyway" second confirm). S3/interval/selective/mesh/prune/restore-settings all stay disabled + "not wired".
- **Lane I9 — Discord page wired to REST** (`p9-lane-discord-page.md`): `DiscordController` bridge + page: bot token field (**write-only**), Save & Verify (real `GET /users/@me`), "Configured as …" row with Clear token (AModal confirm), **Fetch gateway info** (display-only — `GET /gateway/bot`; app never opens a gateway connection), **Send a test message** card (exactly what you type, once, per click). Token at rest `<profile>/airi/discord.json` mode **0600** (atomic tmp+rename+fsync). Human-in-the-loop everywhere; nothing auto-sends, ever.
- **Central — MCP streamable HTTP**: `bridges/mcp.rs` routes remote (`url`-configured) servers through `McpHttpClient` for probe and tool calls (stdio path unchanged). No auth headers (client doesn't send them) — token-protected remotes unreachable, documented.
- **Central — gateway `renderer.*`**: new `gateway_handlers.rs` registers `renderer.info` (app/version + store counts: sessions/messages/summaries/journal/providers-enabled) over the shared `Database`; `--gateway` binds `bind_with_renderer`. **Verified live** (offscreen, isolated profile): WS upgrade → auth → `renderer.info` returns real counts; `gateway.config` hostname/port only (no token); `runtime.status` pid/uptime; unregistered `renderer.*` → `rpc_not_implemented`. Startup bug fixed en route: `server-channel/config.json` path was resolved before the profile dir was registered in bridges; now uses the local `profile_dir` directly.

## Integration applied (central)

- build.rs `files`: `sync.rs`, `discord.rs`; `bridges/mod.rs`: `pub mod sync; pub mod discord;` (+ `pub mod capture;` placement corrected).
- Workspace deps: `tungstenite 0.24` (blocking, rustls-webpki-roots) in workspace + `airi-discord`; `rusqlite` (workspace) in `airi-qt` for the gateway handler queries; `airi-sync`/`airi-discord` path deps in `airi-qt`.
- i18n ×10 locales: new `shell.cloudSync.live.*` (34 keys, nested under `cloudSync:`) and `shell.discord.live.*` (32 keys, nested under `discord:`) — parity 4/4; `yaml-manager.js audit` clean ×10. New strings follow the `%1`-placeholder convention.
- `Cargo.lock` records the new deps. No features.md / ticks changes (new functionality, not ports).

## Verification (after integration)

- `cargo fmt --all --check` clean · clippy `--workspace --all-targets -- -D warnings` clean.
- `cargo test --workspace` — **47 suites green, 0 failures, 586 tests** (lane crates: airi-mcp 42, airi-acp 62, airi-channel 77, airi-sync 13, airi-discord 28, airi-mmd 31).
- Offscreen `--smoke` — exit 0 (splash → control-strip → chat → settings → about → stage); both wired pages instantiate with zero QML errors.
- Live gateway e2e (above) — pass.
- i18n parity 4/4; audit clean ×10.

## Honest limits / not done

- No real Discord API call ever made (hermetic tests only). Save & Verify / Send will first run against the real API when the user pastes a token.
- SQLite snapshot-of-live-copy caveat applies to Sync Now (whole-tree copy including `airi.sqlite*`); a restore can leave a torn page if done while the app is running — restore is human-gated (dry-run + double confirm) but the UI should say "close the app first" in a later pass.
- Cloud Sync default profile is the throwaway temp dir (`main.rs` non-persistent default) — Sync Now is harmless-but-useless until default persistence is settled (existing caveat, not new).
- MCP remote servers still can't carry auth headers; registry discovery exists only as `airi-mcp` API (no page wiring, no live network calls).
- Discord gateway receive is implemented in `airi-discord` but the app never connects; a Qt wiring (opt-in flag + GUI-thread pump + dispatch into chat) is its own lane; MESSAGE_CREATE would require the privileged MESSAGE_CONTENT intent enabled by the user.
- `renderer.*` handler is read-only counts only; mutating handlers need per-action auth scoping (future).
- Nothing visually verified (offscreen smoke only). SSE/resume/OAuth for MCP; S3 for sync; scheduling; selective sync; conflict UI — all deferred, all signposted.
