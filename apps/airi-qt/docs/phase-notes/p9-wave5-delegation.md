<!-- SPDX-License-Identifier: GPL-3.0-or-later -->
# P9 Wave ④/⑤ delegation batch 2 — ACP agents, channel server, Cloud Sync, Plugin Host + MCP bridge wiring

Third delegated batch (4 lanes), plus the MCP bridge wired by the main agent. All work is in the working tree on `wip/airi-qt-rewrite` as of this note.

## Lanes

- **Lane G1 — `airi-acp`** (`docs/phase-notes/p9-lane-acp-agents.md`): ACP (Agent Client Protocol) agent client over stdio NDJSON — `initialize`, `new_session`, `prompt` (collects `session/update` stream), `cancel`, `close_session`; background reader with id routing; permission-policy handling (prompt→reject-closed, auto-read→read-only, auto-all→allow). 38/38 tests green incl. python mock agent round-trips (2 dense update chunks + stop reason, per-policy permission). No new deps. Not ported: fs/terminal/session-load/list/delete/resume, auth, Elicitation, MCP servers in session/new, Qt bridges.
- **Lane G2 — `airi-channel`** (`docs/phase-notes/p9-lane-channel-server.md`): AIRI gateway channel server on 127.0.0.1:6121 — hand-rolled WebSocket framing + HTTP Upgrade (inline SHA-1/Base64), auto-healing `<data>/airi-qt/server-channel/config.json` (UUIDv4 authToken, loopback default), mandatory first-message auth (`authToken`), then `ping`→`pong` + `rpc` passthrough placeholder. 51/51 tests green (5 integration tests self-serialized). Not ported: TLS/mkcert, LAN binding, real RPC dispatch, origin validation.
- **Lane G3 — Cloud Sync settings page** (`docs/phase-notes/p9-lane-cloud-sync.md`): `qml/pages/settings/modules/cloud-sync/CloudSyncSettingsPage.qml` — Storage Target (S3/local-FS), Synchronization (interval slider, conflict strategy), What Gets Synced rows, Local Mesh Sync (libp2p), Manual Actions, Sync Conflicts empty state. Every control disabled + tooltip; no fabricated sync state.
- **Lane G4 — Plugin Host devtools page** (`docs/phase-notes/p9-lane-plugin-host.md`): `qml/pages/devtools/plugin-host/PluginHostPage.qml` — Plugin Host Status ("Not wired", **6121 is the channel server, not the plugin host** — in-process, no TCP port; page states this explicitly), Installed Plugins empty state + clearly-labelled documentation examples (repo integration packages), Actions/Capabilities disabled, host settings preview.

## MCP bridge (main agent), making the MCP page real

- New `crates/airi-qt/src/bridges/mcp.rs` — `McpController` qobject: `serversJson`/`configPath`/`configLoaded`/`lastError`/`working` qproperties; `refreshServers`, `saveServers`, `addStdioServer`, `removeServer`, `setServerEnabled`, `probeServer` (real spawn→initialize→tools/list via `airi-mcp`), `callTool`. Persists the app's own `<profile>/airi/mcp.json` atomically (same schema as the Electron `mcp.json`). Remote (streamable HTTP) servers are parsed but probe/call returns a typed error explaining they are not ported yet.
- Rewrote `qml/pages/settings/modules/mcp/McpSettingsPage.qml` wiring: config path shows the real resolved path; badge = "Loaded from disk"/"Not configured"; server list is driven by the bridge (enable/disable switch, delete, per-row "Test Connection" jump); empty state offers the documented open-websearch default with an explicit "Add" action; **Add Stdio Server** parses whitespace args or a JSON array (accepted, saved via bridge); **Apply & Restart** saves the real server list; Test tab: target select lists configured servers, **Run Probe** shows live probe results (tools + duration), each tool has a "Use" button filling the call form, **Call Tool** executes for real and shows raw JSON output with ok/error line.
- Deliberately NOT done (honest, by design): streamable HTTP probing (typed error, not a fake), registry discovery (Discover tab stays deferred), Add Remote Server button (silent no-op would be a lie — stays disabled).

## Integration applied (main agent)

- `Cargo.toml` workspace members: `airi-acp`, `airi-channel` registered (stubbed first by the orchestrator so lanes kept building).
- `build.rs`: registers `CloudSyncSettingsPage.qml`, `PluginHostPage.qml`, `McpSettingsPage.qml` (+ `mcp.rs` bridge).
- `SettingsWindow.qml`: nav **23 ☁️ Cloud Sync**, **24 🛠️ Plugin Host** (after Widgets 20/MCP 21/Discord 22; StackLayout indices match). Plugin Host ships in Settings as this app has no devtools host window yet — flagged, revisit if a devtools window lands.
- `packages/i18n/*/shell.yaml` ×10 locales: new top-level `cloudSync:` (80 keys) and `pluginHost:` (50) — translated in all 10 locales; plus nav keys `shell.settings.nav.{cloudSync, pluginHost}` and `shell.mcp.manage.*` (7 keys for the bridge-wired Manage tab) earlier in the batch. `locales.test.ts` 4/4 green; `yaml-manager.js audit` clean ×10.
- No features.ticks.json/features.md changes (all new pages are scaffolds/crates, not ports).

## Verification (after integration)

- `cargo fmt --all --check` clean · `cargo clippy --workspace --all-targets -- -D warnings` clean · `cargo test --workspace` — **35 suites green, 0 failures** (incl. airi-acp 38, airi-channel 51, airi-mcp 17, airi-mmd 15).
- Offscreen `--smoke` exit 0; settings window loads both new pages without QML errors.
- i18n parity 4/4; yaml-manager audit clean ×10.

## Honest limits / not done

- MCP page now performs real stdio calls (npx spawn, 5s timeout) — verified by unit tests via the python mock; not click-tested in a GUI. Streamable HTTP is unimplemented; remote servers are stored but inert.
- Cloud Sync / Plugin Host / Discord pages remain honest scaffolds (all actions disabled); MCP is the only module page wired to a live backend this batch.
- Channel server crate has no Qt wiring yet — binding lifecycle (start/stop, profile flag) is a user-facing decision (see lane note §Qt asks).
- `airi-acp` is also unwired in the app; the ACP permission UX question (prompt/auto-read fail-closed) needs a product answer before AIRI ships agents that request permissions.
- No visual/GUI verification of the two new pages; offscreen module-load only.
- Commit: this batch is snapshotted as a WIP commit on `wip/airi-qt-rewrite`.
