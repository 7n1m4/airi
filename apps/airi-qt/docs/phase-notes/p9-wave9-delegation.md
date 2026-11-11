<!-- SPDX-License-Identifier: GPL-3.0-or-later -->
# P9 Wave ⑨ batch — P10 M1, Discord receive, cutover groundwork (user decision 2026-11-11: "1 2 3 go")

Approved: (1) P10 MMD M1, (2) Discord gateway receive lane, (3) cutover groundwork.

## Lane J2 — P10 MMD M1 (`p10-lane-mmd-m1.md`)

Rest-pose render through the existing `AiriVrmGeometryShell` path: `airi-mmd::RestPoseEngine` builds the shared 64-byte interleaved VRM-layout buffer (pos/normal/uv0/joints/u32x4/weights/f32x4), per-material primitive splits (PMX face material ranges), BDEF1/2/4 → 4-slot expansion, SDEF→BDEF2 approximation (approved; `sdef_approximated` counter), sibling-of-`.pmx` texture resolution (no .zip/PMD/toons), pure tick counter. `MmdController` bridge mirrors the VRM `StageSceneController` QML API exactly (`loadModel`/`loadFromSettings` filtered to .pmx/.pmd, QColor material params, `skinAndMorph` tick). 9 new rest_pose tests (40 total in airi-mmd). **Verified headless**: seeded synthetic-PMX smoke profile → exit 0, `mmd scene ticks ok`, 2 primitives created through the real QML path, `skinAndMorph ticks: 30`.

Not visible = unverifiable: orientation (Y-up vs the shared modelRoot's 180°) and any real-model behavior are unverified; no real .pmx has ever been parsed; rest pose = identity skinning (nothing moves); two-step toon ramp only; M2 (VMD animation, IK, CPU skinning, PMD, .zip) explicitly next.

## Lane B — Discord gateway receive (`p9-lane-discord-gateway-wire.md`)

Strictly opt-in, human-driven receive: `DiscordGatewayController` bridge — worker `std::thread` spawned only by `start()` (or `--discord-gateway`, which is gated off under smoke); `MESSAGE_CREATE` → in-memory queue (cap 100, newest-first, ≤400 chars, cleared on Stop/Clear, never persisted); caller-driven bounded reconnect (1/2/4/8/16 s ×5, resume-when-READY, 4004 fatal). Discord page gains a "Gateway events (opt-in)" card (Start/Stop, status badge, event rows, Bot badge, 1 s poll). `--discord-gateway` flag wired in main.rs with the same rails as the Start button. 12 new i18n keys (`shell.discord.live.gateway.*`) translated ×10 + stale `banner`/`gatewayDisplayOnly` values updated ×10. **MESSAGE_CONTENT intent must be enabled in the Discord dev portal or events arrive without content** — documented. Not done: command parsing/dispatch of any kind (inbox, not a processor), persistence, auto-connect, chat dispatch.

## Cutover groundwork (`p12-cutover-plan.md`) — docs only

Decision document (no execution): cutover meaning vs Electron/web par-lock; four product calls on your plate (card-AI suite ~55 rows / knowledge-graph 8 / artistry-vision-consciousness-agentic-os / default persistence — already fixed); packaging/release gaps (nothing for airi-qt exists; `release-linux-desktop.yml` ships Electron with a fork-name `PRODUCT_NAME` to scrub; update check points at the Electron release feed and must be re-pointed at the first qt tag; check+notify only, never unsigned self-update); proposed squash-land PR → `v0.1.0-qt-preview` tag; ordered pre-v1 checklist.

## Fixes applied centrally this wave

- **Default profile**: plain launches used to land in a throwaway temp dir — settings/cards/providers evaporated on every restart. Now: `--profile` wins; `--smoke` stays throwaway; plain launches use the platform data dir (`dirs::data_dir()/airi-qt`), consistent with the single-instance lock and crashlog paths.
- **StageWindow third mode**: `.pmx`/`.pmd` routes to `MmdController` alongside VRM and Spine (same `StageScene`/`View3D`/`AiriVrmGeometryShell`); VRM path untouched. `main.rs` smoke leg counts MMD ticks so smoke exits 0 on an MMD-seeded profile.
- **Registration**: `mmd.rs`/`discord_gateway.rs` bridges registered (build.rs + `pub mod mmd; pub mod discord_gateway;` + console slot); `airi-mmd` path dep; `--discord-gateway` CLI flag (refuses cleanly without token).
- **Clippy catch**: my worker refactor initially appended free fns after the test module — fixed (start_worker/start_from_main now sit before `mod tests`).
- Transient regression found & fixed during integration: DiscordSettingsPage instantiates `DiscordGatewayController`, which wasn't registered yet — SettingsWindow failed to load and the smoke tour silently lost `settings`. Registered; `pages visited: splash, control-strip, chat, settings, about, stage` restored.

## Verification (after integration)

- `cargo fmt --all --check` clean · clippy `--workspace --all-targets -- -D warnings` clean.
- `cargo test --workspace` — **48 suites green, 0 failures, 598 tests**.
- `QT_QPA_PLATFORM=offscreen --smoke` — exit 0 (settings in tour).
- MMD-seeded profile smoke — exit 0 (mmd scene ticks ok, 2 primitives, ticks 30).
- `--discord-gateway` boot — clean refusal (no token), no socket, no crash.
- i18n parity 4/4; yaml-manager audit clean ×10.

## Honest limits / pending

- M1 rest-pose only — MMD identity-skins; no real `.pmx` parsed; desk check required before calling M1 visually accepted.
- Discord receive is opt-in and in-memory; no GUI smoke of the events card was possible headlessly beyond instantiation; no live Discord traffic ever exchanged.
- LIVE-GATEWAY e2e (auth→renderer.info) passed earlier for `--gateway`; the discord receive path has no such live test (requires a real bot token).
- MMD M2 is the next milestone; P12 lists the packaging/release work that blocks any Qt preview.
