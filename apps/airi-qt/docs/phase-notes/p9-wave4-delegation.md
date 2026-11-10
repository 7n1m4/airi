<!-- SPDX-License-Identifier: GPL-3.0-or-later -->
# P9 Wave ④ delegation batch — MCP client/page, Discord page, MMD M0 + integration

Five delegated lanes, integrated centrally. All under `apps/airi-qt/`; nothing committed as of this note.

## Lanes

- **Lane D1 — `airi-mcp`** (`docs/phase-notes/p9-lane-mcp-client.md`): native MCP client over stdio — JSON-RPC 2.0 handshake (`initialize` → `notifications/initialized`), `tools/list`, `tools/call`, typed errors (`McpError`), background reader with request-id routing, 5 s configurable timeout, drop-kill lifecycle. 17/17 tests green incl. python3-mock-server round trip; clippy `-D warnings` clean. **Not implemented (documented):** streamable HTTP (typed `UnsupportedTransport`), `mcp.json` persistence/`cwd`/registry, one-client-per-server is the model; tool qualification at the bridge.
- **Lane D2 — MCP settings page** (`docs/phase-notes/p9-lane-mcp-page.md`): `qml/pages/settings/modules/mcp/McpSettingsPage.qml` — Manage/Discover/Test tabs, documented `open-websearch` default as example, everything disabled + banner until the bridge lands.
- **Lane E — Discord page** (`docs/phase-notes/p9-lane-discord.md`): `qml/pages/settings/modules/discord/DiscordSettingsPage.qml` — two tabs (Bot Connection / Access & Routing), honest scaffold: password-echo token field, "Not wired" status, disabled connect/vision/DM/force-sync/restart/clear, no `discord.gg` link.
- **Lane F — `airi-mmd` M0** (`docs/phase-notes/p10-lane-mmd.md`): PMX 2.0 parser (header→names→vertices BDEF1/2/4/SDEF→faces→textures→materials→bones with IK; stops at morphs with typed `UnsupportedFeature`). Bounds-checked, allocation-capped; byte-built fixtures; **all** tests green (14 + doctest); clippy `-D warnings` clean. Format facts from the design note corrected against the in-repo three-stdlib mmdparser (version f32, bones have no quaternion, additional UVs are vec4). No real .pmx anywhere yet (none in-repo; license review required before adding one).
- **Lane P11 — manifest audit** (`docs/phase-notes/p11-audit.md`): all 224 unchecked items classified — **86 (a)** real gaps (25 = devtools family, 8 = knowledge-graph, ~53 others), **43 (b)** backend-only ports, **44 (c)** out-of-scope, **51 (d)** blocked on lanes. 6 duplicate manifest rows flagged.

## Integration applied (main agent)

- `Cargo.toml` workspace members: `airi-mcp`, `airi-mmd` registered (both compiled as empty stubs before lanes filled them).
- `build.rs`: `airi-qt` registers `McpSettingsPage.qml`, `DiscordSettingsPage.qml`.
- `SettingsWindow.qml`: nav **21 🔌 MCP**, **22 💬 Discord** (appended after Widgets 🧩 20; StackLayout indices match).
- `packages/i18n/*/shell.yaml` ×10 locales: new top-level `mcp:` (63) and `discord:` (53) sections — translated, not stubbed — plus `settings.nav.{mcp, discord}`. `locales.test.ts` 4/4 green; `yaml-manager.js audit` clean on all 10.
- `features.ticks.json`: **10 new ticks applied** (settings landing, chat redirect, 3 card-suite components, release-checker, 4 vault rows) with per-row rationale; `features.md` regenerated (20 checked / 214 unchecked). The audit's remaining 33 (b) suggestions were **held** — inspection showed they are not (b) at this port stage (see the p11-audit note §3).
- Deferred explicitly (user calls flagged in p11-audit): devtools family waiver/-adoption (25 rows), knowledge-graph (8), card-AI suite scheduling (37 d-rows), cloud-sync/libp2p/cloud providers (5–6), update-mechanism parity, cutover.

## Verification (after integration)

- `cargo fmt --all --check` clean; `cargo clippy --workspace --all-targets -- -D warnings` clean; `cargo test --workspace` — **29 suites green, 0 failures** (includes airi-mcp's python-mock stdio round trip and airi-mmd's parser suites).
- Offscreen `--smoke` exit 0 — settings window loads MCP + Discord pages without QML errors.
- i18n parity: 4/4 tests on `locales.test.ts`; `yaml-manager.js audit` clean ×10 locales.

## Honest limits / open items

- Neither new page has been visually verified; both are presentational scaffolds (all actions disabled).
- MCP page's "Apply & Restart"/config path are illustrative; the Electron default config is shown as documentation only — no `mcp.json` is read.
- Discord page: no gateway, no token store; the two upstream badges are copied honestly, and `discord.gg` is a disabled button (no outbound link).
- `airi-mcp` has no Qt bridge yet; tool calls happen nowhere in the app; `airi-mmd` parses nothing on screen.
- Manifest: 214 unchecked remain; caveats in p11-audit §3 list exactly which rows were held and why.
- Nothing committed yet — this batch sits in the working tree on `wip/airi-qt-rewrite` awaiting your review (per the earlier WIP commit).
