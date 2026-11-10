<!-- SPDX-License-Identifier: GPL-3.0-or-later -->
# P9 Wave ⑥ batch — ACP human-in-the-loop, channel gateway wiring, screen capture (vision slice)

Fourth delegated batch (2 lanes + main-agent wiring), per the recommended wave-⑥ order:
(1) channel-server Qt wiring, (2) ACP bridge + HITL permission UX, (3) vision/screen-capture.

## Lane H1 — ACP agents, end-to-end (`docs/phase-notes/p9-lane-acp-hitl.md`)

- **`airi-acp`**: `PermissionRequest`/`PromptDecision` public types; bounded `sync_channel(8)` permission queue; `permission_requests()` / `answer_permission()` / `prompt_stream()`; `PermissionPolicy::Prompt` now enqueues for the human (fail-closed only on full/poisoned queue); `AllowSession` = client-side allowlist approximation. 54/54 tests green (42 unit + 12 integration).
- **Bridge** `crates/airi-qt/src/bridges/acp.rs` — `AcpController`: `agentsJson`, `activeAgent`, `sessionId`, `agentState`, `lastError`, `working`, `transcriptJson`, `pendingPermissionJson`; invokables `refreshAgents/addStdioAgent/removeAgent/setAgentEnabled/setAgentPermissionPolicy/startAgent/stopAgent/promptAgent/cancelPrompt/answerPermission/pumpUpdates`. Config `<profile>/airi/acp.json` (schema mirrors Electron `acp.json`).
- **Page** `AcpAgentsPage.qml` — configured agents (start/stop/delete/policy), add-stdio-agent card, session card with live permission bar + inline Allow-once/Allow-for-session/Reject, streaming transcript via 100 ms pump timer, and an `AModal` permission dialog on `permissionRequested`. `pragma ComponentBehavior: Bound` (qmllint zero warnings).

## Lane H2 — screen capture (`docs/phase-notes/p9-lane-screen-capture.md`)

- C++ shim `src/cpp/capture_item.{cpp,h}`: `QString airi_capture_primary_screen(const QString&)` — primary `QScreen::grabWindow(0)` → `capture-<millis>.png` under `<profile>/captures/` (or platform data dir). No Quick3D, no moc.
- Bridge `bridges/capture.rs` — `CaptureController`: `capturesJson`/`lastError`/`working`; `captureNow` (suppressed under `--smoke`), `refreshCaptures`, `clearCaptures` (strict `capture-<digits>.png`, regular files only).
- Devtools page `ScreenCapturePage.qml` — wired Capture Screen, thumbnail grid (open via system viewer), Clear All behind a count-showing destructive confirm. Honest limits: single primary screen; **native Wayland denies `grabWindow(0)`** (validated: X11 OK / Wayland fails clean with banner); no clipboard/OCR; in-app success path validated up to QML instantiation + link, not a live click.

## Main agent — channel-server Qt wiring (1 of the recommended order)

`--gateway` flag on `airi-qt` (loopback-first, `SERVER_CHANNEL_PORT` override, default 6121). On start, binds the `airi-channel` server and auto-heals `<profile>/server-channel/config.json` (or platform data dir) — plaintext `authToken`, same posture as the Electron main service. Opt-in; off by default; `--smoke --gateway` passes (exit 0). Side effect to be aware of: a `config.json` (plaintext token) now exists at `~/.local/share/airi-qt/server-channel/config.json` from smoke testing.

## Integration applied (central)

- `Cargo.toml`: `airi-acp`, `airi-channel` path deps for `airi-qt`.
- `bridges/mod.rs`: `pub mod acp; pub mod capture;` (H1's revert had clobbered the earlier `capture` registration — re-added both).
- `build.rs`: `acp.rs` + `capture.rs` bridge files; C++ shim pair `capture_item.{cpp,h}`; QML registration for `AcpAgentsPage.qml` + `ScreenCapturePage.qml`.
- `SettingsWindow.qml`: nav **25 📷 Screen Capture**, **26 🤵 ACP Agents** (StackLayout indices match). Eager instantiation means the offscreen smoke run creates both pages.
- i18n ×10 locales: `capture:` (15 keys), `acp:` (41 keys, `%1` placeholders preserved), nav `screenCapture` / `acpAgents`. Parity 4/4; `yaml-manager.js audit` clean ×10.
- No `features.ticks.json`/`features.md` changes (all new surfaces are new code, not Electron-parity ports).

## Verification (after integration)

- `cargo fmt --all --check` clean · clippy `--workspace --all-targets -- -D warnings` clean · `cargo test --workspace` — **35 suites green, 0 failures** (incl. airi-acp 54, airi-channel 51, airi-mcp 17).
- `QT_QPA_PLATFORM=offscreen --smoke` — exit 0, zero QML errors (settings instantiates Screen Capture and ACP Agents pages eagerly).
- i18n parity 4/4; yaml-manager audit clean ×10 locales.
- GUI end-to-end of the agent flow (spawn → prompt → permission modal) not performed — python3 mock agent covers client-level tests; a real agent (e.g. an ACP-capable npx package) was not spawned.

## Honest limits / not done

- ACP page is wired end-to-end but **never exercised against a real agent binary**; ACP `fs/*`/`terminal/*` are unimplemented, so file/exec-capable agents will ask (HITL) or be denied by policy.
- `AllowSession` is a client-side approximation (no protocol-level grant).
- Channel gateway: loopback only, no TLS/mkcert/LAN binding, `rpc` is a documented echo placeholder; binding errors are logged and non-fatal at startup.
- Screen capture: see H2 note (Wayland fails clean; primary screen only).
- Both pages are new functionality, not parity closures — the devtools waiver decision (~25 rows) is still pending the user's call.
- Nothing is visually verified (offscreen); desk check pending.
