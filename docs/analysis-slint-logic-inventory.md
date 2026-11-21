<!-- SPDX-License-Identifier: GPL-3.0-or-later -->
# Analysis: Slint business-logic inventory for the big-bang cutover

**Status:** survey · **Date:** 2026-11-21 · **Scope:** `crates/anima-slint/src/**` at HEAD `bad8fc69`
**Owner:** E1-T1 / bead `airi-wxp.1` · **Read-only source survey** (this file is the only write)

This document makes [`design-flutter-godot-pivot.md`](./design-flutter-godot-pivot.md) §4 (move/delete
tables) and §7 Wave 6 **actionable**: one row per source item, with a classification, a proposed
daemon home, an API sketch, and an ordering constraint. It does not re-decide the pivot. Cross-links
instead of copies: [`design-daemon-gateway.md`](./design-daemon-gateway.md) (transport/auth/D-Bus),
[`design-daemon-client.md`](./design-daemon-client.md) (single writer, event lane, sequencing),
[`rosetta-stone.md`](./rosetta-stone.md) (concept→code map, §1b for the already-migrated Slice B),
[`decision-audit-archive-retention.md`](./decision-audit-archive-retention.md) (no GUI delete path).

**Legend.** **DAEMON** = business logic/state that must land in `anima-daemon` *before* the crate is
deleted. **CLIENT-LOCAL** = belongs in Flutter/Godot; the daemon must not own it. **DROP** =
Slint-only UI or test scaffold with no replacement, deleted in one cutover. "⚠" marks a
second-writer hazard if the item is moved without also retiring its Slint owner.

**Verification premise.** `airi-uyz`/Slice B already moved `AppCore` + `core.status` into the daemon
(`crates/anima-daemon/src/core.rs:31-117`, `crates/anima-daemon/src/gateway.rs:444-453`,
[`rosetta-stone.md §1b`](./rosetta-stone.md)); `airi-wes.8/.9` equivalents are still open in Slint.

## 0. Source-vs-design discrepancies found (feed back to the owning doc; do not edit it here)

| # | Finding | Evidence |
|---|---|---|
| 1 | Pivot §4.1 groups `capture.rs` with "audio/voice intent", but the bridge is **screen** capture (PNG, Wayland portal, X11 unimplemented). It is classified CLIENT-LOCAL below, not folded into the audio pipeline. | `bridges/capture.rs:2-7`, `bridges/capture.rs:873-879` vs `design-flutter-godot-pivot.md:162` |
| 2 | `daemon_mode.rs` is a **dead seam**: declared in `lib.rs:7`, referenced nowhere in `main.rs` or any bridge; default is `Disabled → Local`. No fallback survives the cutover; do not port it. | `lib.rs:7`, `daemon_mode.rs:21-26,41-64`, `design-daemon-client.md:35` |
| 3 | Module docs advertise `--import-card`, `--import-model`, `--discord-gateway` CLI flags that **do not exist** in `parse_cli`. Treat those docs as aspirational, not features to migrate. | `bridges/chat.rs:15`, `bridges/settings_stage.rs:22`, `bridges/discord_gateway.rs:14`, `main.rs:294-307` |
| 4 | `anima-daemon` currently has a **dev-dependency on `anima-slint`**; the deletion wave must remove it. | `crates/anima-daemon/Cargo.toml:27-29` |
| 5 | Daemon `lib.rs` exports only `core`; gateway/control are binary-private modules. New services must be **library modules** (re-exported from `lib.rs`) so they are testable and usable by other crates. | `crates/anima-daemon/src/lib.rs:1-2`, `crates/anima-daemon/src/main.rs:20-29` |

## 1. Global roots, bootstrap and mode seam

| ID | Item (file:line) | Class | What it owns | Target daemon module + public API | Order / writer risk |
|---|---|---|---|---|---|
| R1 | `bridges/mod.rs:46-154` | **DAEMON** | Process statics `SMOKE`, `SETTINGS`, `PROFILE`, `PROFILE_EXPLICIT`, `PROVIDERS`, `DATABASE`, `RUNTIME` plus accessors; `load_section`/`save_section` (`:84-99`). | `services.rs` (extend `core.rs`): `struct Services { core: CoreService, settings: SettingsService, providers: ProviderService, cards: CardService, chat: ChatService, … }`, `Services::open(profile)`, one injected handle per task. `SMOKE` does **not** move. | M1. ⚠ Replacing statics with per-client mirrors recreates seven writers; inject one `Services` into every RPC handler. |
| R2 | `main.rs:54-75` | **DAEMON** | Profile resolution, `Database::open("airi.sqlite")`, `SettingsStore`, `ProviderRepo`, Tokio runtime registration. | `services.rs::Services::open`: reuse `CoreService::open` path rules (`crates/anima-daemon/src/core.rs:44-55`) and register all repos on the same `Database`. | M1, depends R1. Preserve `<data>/airi-slint/airi.sqlite` path (`crates/anima-daemon/src/core.rs:44-55`); do not mint a second config path. |
| R3 | `main.rs:34-52, 267-307` | **DROP** | CLI parse, `--smoke` tour, usage text. | — | Wave 6. Replace smoke checks with daemon WS probes (§10). |
| R4 | `main.rs:100-241`, `main.rs:243-265` | **DROP** | `run_ui()` window wiring and `sync_chat_view` snapshot push. | — | Wave 6. Flutter/Godot own their view model (C5). |
| R5 | `lib.rs:1-11` | **DROP** | Module declarations + `slint::include_modules!()`. | — | Wave 6. |
| R6 | `daemon_mode.rs:9-64` (tests `:66-123`) | **DROP** | `DaemonMode`/`SelectedMode`/`select_mode`; pure, default `Disabled`, never called. | — | Wave 6. Big-bang cutover has no `Local`/`Unavailable` branch to preserve. |
| R7 | `bridges/shell.rs:6-41` | **DROP** | `ShellState` status/title/subtitle strings, `ready()`. | — | Window chrome; no client replacement beyond a status field fed by `status.changed` events. |
| R8 | `bridges/windows.rs:12-84` | **DROP** | Open-window registry, geometry, smoke visit log. | — | Pure Slint window bookkeeping. |

## 2. Chat, cards and memory

| ID | Item (file:line) | Class | What it owns | Target daemon module + public API | Order / writer risk |
|---|---|---|---|---|---|
| C1 | `bridges/chat.rs:63-92` | **DAEMON** | `ChatContext { service: ChatService, db }`, `CHAT` OnceLock, `set_chat_context`. | `chat.rs` daemon service wrapping `AppCore::chat` (`anima-core/src/lib.rs:98-121`): `ChatRuntime::new(context)`, injected into RPC handlers. | M6, depends R1/R2. ⚠ Owns the only `ChatService` instance. |
| C2 | `bridges/chat.rs:275-457` | **DAEMON** | Card dirs, CCv2/CCv3 scan, import, system-prompt composition. | `cards.rs::CardService::{scan, import_file, compose_system_prompt}` (shared with V1). | M4. ⚠ Duplicate of `cards.rs::import_card` (`:269`) and `card_gui_import_dir` (`:298`) — consolidate into **one** card writer before deleting Slint. |
| C3 | `bridges/chat.rs:484-634` | **DAEMON** | Completed-turn journal note (`User:… / AI:…`, 800-scalar truncation) + retrieval injection before card system prompt; best-effort one-shot embedding. | `memory.rs::MemoryService::{on_message_done, inject_retrieval, index_entry_best_effort}`; hook called from daemon chat completion. | M5, depends M2/M3. ⚠ If chat moves but `memory.rs` bridge stays, two memory writers. |
| C4 | `bridges/chat.rs:721-815, 972-1624` | **DAEMON** | `ChatState` state machine: sessions, transcript, streaming placeholder binding, deltas, `send`/`stop`/`new_session`/`select_session`/`delete_session`/`activate_card`; broadcast→unbounded drain (`:844-863, 1241-1273`). | `chat.rs` RPC surface: `send(session_id, text)`, `stop(session_id)`, `new_session(title, card?)`, `select_session(id) -> ChatDto`, `delete_session(id)`, `set_active_card(id)`, `subscribe(session_id)`; emit Wave-0 `token.delta` / `status.changed`. | M6, depends M0 (event lane), M2, M3, M4, M5. Known limit to preserve: mid-stream switch loses unpersisted delta (`:25-27`). |
| C5 | `bridges/chat.rs:738-767, 978-994, 1241-1273` | **CLIENT-LOCAL** | `ChatView` snapshot, `view()`, `drain_events()` 33 ms pump — pure UI projection. | Flutter chat view state; consume `token.delta` events instead of polling a channel. | M10. No state writer; view only. |
| C6 | `bridges/chat.rs:110-269` | **DROP** | Smoke counters and local SSE mock provider (`smoke_register_mock_provider`). | — | Replaced by daemon WS replay probe (§10). |
| C7 | `bridges/chat.rs:1626-2032` | **DAEMON** (tests) | UI-independent memory tests (mock `Embedder`, journal pairing, backfill failure). | Rehome verbatim into `anima-daemon/src/memory.rs` + `chat.rs` test modules. | M5. Golden for parity (§10). |
| C8 | `bridges/memory.rs:69-433` | **DAEMON** | `settings/memory` blob (`enabled`, `topK`), journal read/live count, retrieval-provider label, `index_missing` backfill; deliberately no `clearJournal` (`:43-53`). | `memory.rs::MemoryService::{preferences, apply_enabled, apply_top_k, recent_journal, index_missing, retrieval_provider_label}`. | M5. ⚠ Single memory writer; immutable journal rule is mandatory. |

## 3. Settings and provider domains

| ID | Item (file:line) | Class | What it owns | Target daemon module + public API | Order / writer risk |
|---|---|---|---|---|---|
| S1 | `bridges/settings_general.rs:14-106` | **DAEMON** | `settings/general` mirror: language, transitions, remote-sync, WSS, `autostart` mirror. | `settings.rs`: `SettingsService::load::<GeneralSettings>() / save::<GeneralSettings>(...)`. | M2. ⚠ Mirror+persist pairs must become one RPC write. |
| S2 | `bridges/settings_chat.rs:48-153` | **DAEMON** | `settings/chat` mirror; kebab-case wire modes, timeout clamp to ≥0, default 600_000. | `settings.rs` typed section + validation kept at the daemon boundary. | M2. |
| S3 | `bridges/settings_sections.rs:62-601` | **DAEMON** | Six sections: `spine`, `mmd`, `live2d`, `positioning`, `audio-device`, `user-profile`; including `PositioningSettingsState::scale_for/save_scale/reset_all` (`:357-445`). | `settings.rs`: one `load/save/reset` triple per section; JSON-safe DTOs. | M2. Renderer never reads these directly in the new clients; Godot maps them locally. |
| S4 | `bridges/settings_stage.rs:42-229, 274-300` | **DAEMON** | Persisted `stage-model` (`modelId`), `captions`, `stage-window` bounds/visibility, `control-strip` button flags; validation/clamps (`:35-39, 302-340`). | `settings.rs` typed sections; `settings.stage_model_id()` RPC for Godot to pick a model. | M2. Model *file* handling is S5. |
| S5 | `bridges/settings_stage.rs:230-271, 342-418` | **CLIENT-LOCAL** | VRM discovery/import into `<profile>/models`, resolve path, dedupe copy helper. | Godot asset picker/import; daemon stores only the chosen id/path (S4). | M10. Keep the validated `import_model` helper (`:374`) as reference; do not write model files from the daemon. |
| S6 | `bridges/providers.rs:49-539` | **DAEMON** | 44-row registry merge, credential CRUD in `ProviderRepo`, `test_connection`, `list_models`, `drain_events`; secrets cross the Slint boundary today (`:10-23`). | `providers.rs::ProviderService::{rows, config_json, save_config, set_enabled, delete, test_connection, list_models, resolve_for_chat}`. | M3. ⚠ **Highest secret risk**: keys must never be returned over WS; replace "secrets cross as-is" with redacted DTOs. |
| S7 | `bridges/speech.rs:56-515` | **DAEMON** | `settings/speech` blob, TTS provider catalog/defs JSON, sample synthesis writing one file under the profile; API key read from `ProviderRepo` (`:18-27, 216-221`). | `speech.rs::SpeechService::{settings, defs, select_provider, apply_voice/speed, synthesize_sample}`; keys stay daemon-side. | M3, depends S6. Kokoro download refusal (`:212-215`) preserved. In-app playback is not wired (`:41-44`) — that is pipeline work (M9). |
| S8 | `bridges/hearing.rs:46-312` | **DAEMON** | `settings/hearing` blob (enabled, pttMode, hotkey string, deviceName); no capture/device enumeration (`:17-38, 256-282`). | `hearing.rs::HearingService::{settings, apply_enabled, apply_ptt_mode, apply_hotkey, apply_device, base_status}`; intent only until M9. | M2. ⚠ Global hotkey registration is CLIENT-LOCAL; only the stored string persists. Do not link `anima-stt` into the GUI — duplicate ggml symbols (`hearing.rs:256-262`). |
| S9 | `bridges/theme.rs:13-89` | **DAEMON** | `settings/theme` hue/chroma/dark, corrupt-blob never-overwrite rule (`:71-88`). | `settings.rs` `ThemeSettings` section + `apply_*` RPC. Mirror fields are client-local view state. | M2. |
| S10 | `bridges/i18n.rs:40-72` | **DAEMON** | Locale persistence into `settings/general.language`, validation via `anima_i18n::Locale`. | `settings.rs` (existing `GeneralSettings.language`); no new key. | M2. |
| S11 | `bridges/i18n.rs:29-30, 53-57` | **CLIENT-LOCAL** | `CYCLE_LOCALES` and `tr(locale,key)` lookup; Slint `I18n` global. | Flutter/Godot localization bundles; daemon does not serve translations. | M10. |
| S12 | `bridges/settings_tests.rs:1-589` | **DROP** (rehome) | 14 round-trip tests (named at `:90,129,158,189,218,245,305,347,372,404,444,493,520`). | Copy assertions into `anima-daemon/src/settings.rs` tests against a temp `Database`. | M2. Golden for parity (§10). |

## 4. Cards, data vault and local sync

| ID | Item (file:line) | Class | What it owns | Target daemon module + public API | Order / writer risk |
|---|---|---|---|---|---|
| V1 | `bridges/cards.rs:29-464` | **DAEMON** | Card library scan, editor load/save (PNG payload rewrite), import/export/delete, active-card selection (`:248-423`). | `cards.rs::CardService::{list, load, save, import, export, delete, set_active}`. | M4, depends M2. ⚠ Merge with C2 — one card writer, one cards directory convention. |
| V2 | `bridges/data.rs:16-253` | **DAEMON** | Vault stats, ZIP export, inspect, chats+memory-only restore, media scrub and scrub-run log; destructive resets deliberately absent (`:16-23`). | `vault.rs::VaultService::{stats, export, inspect, commit_import, scrub, list_scrub_runs}` reusing `anima_core::vault`. | M7. ⚠ Restore is a store writer: keep explicit-intent gating and audit it. |
| V3 | `bridges/sync.rs:41-521` | **DAEMON** | Local-FS snapshot engine config (`airi/sync.json`), probe, create/verify/dry-run/restore/prune; `require_clean` default, "Overwrite anyway" only on explicit confirm (`:10-27, 458-484`). | `sync.rs::SyncService::{config, probe, snapshot, verify, dry_run, restore{allow_dirty}, prune}`; never S3/network. | M7. ⚠ Restore overwrites the live SQLite file (plain-copy caveat `:22-27`) — privileged RPC, no client-side path. |

## 5. Integrations, awareness/audit and update

| ID | Item (file:line) | Class | What it owns | Target daemon module + public API | Order / writer risk |
|---|---|---|---|---|---|
| E1 | `bridges/daemon.rs:194-384, 492-562, 564-623` | **DAEMON** (pure logic) | Wake-briefing composer, duration/clock math, wake-edge step; digest reply classification; audit JSONL tail shaping. | Fold into existing `wake_facts.rs`, `screen.rs`, `audit.rs`: `compose_briefing`, `wake_edge_step`, `classify_digest`, `audit_tail_json`, `archive_audit`. | M8. State already daemon-owned — **port logic only**, never a second awareness state. |
| E2 | `bridges/daemon.rs:125-139, 861-897` | **DAEMON** (privileged verb) | `clear_audit()` archive-by-rename (`.cleared-<ts>`), 64 KiB tail cap; no truncation. | `audit.rs::archive_audit()` exposed via D-Bus/privileged RPC; **no Flutter/Godot delete button** (retention policy). | M8. ⚠ Must not gain a GUI deletion path. Preserve `airi-slint/audit` path (`anima-channel/src/audit.rs:14-27`). |
| E3 | `bridges/daemon.rs:77-102, 899-955` | **DAEMON** | Wake-briefing opt-in blob (`settings/awareness`), edge detector, notify-rust session-bus notification, first-observation priming. | `wake_facts.rs::{enabled, check_tick, notify}`; opt-in flag moves to `settings.rs`. | M8, depends M2/E1. Master pause switch wins (`:101-102`). |
| E4 | `bridges/daemon.rs:109-150, 625-664, 664-994` | **DROP** | D-Bus client proxy, 1 s polling mirror, `DaemonState` fields, 800 ms timeouts. | Flutter/Godot call daemon over WS `rpc`/events; no D-Bus from clients. | M8/M10. Slint-only transport; logic survives in E1–E3. |
| E5 | `bridges/mcp.rs:41-686` | **DAEMON** | `airi/mcp.json` config, stdio/remote server CRUD, probe + tool calls; bearer token and sensitive headers redacted (`:23-28, 49-105`). | `integrations/mcp.rs::McpService::{servers, add, remove, set_enabled, probe, call_tool}`. | M8. ⚠ `REDACTED` sentinel round-trip (`:86-103`) must survive; never return tokens over WS. |
| E6 | `bridges/acp.rs:43-812` | **DAEMON** | `airi/acp.json` config, agent spawn/stop, one-turn prompts, streaming transcript, permission queue and `Prompt` default policy (`:14-24, 400, 619-654`). | `integrations/acp.rs::AcpService::{agents, add_stdio, remove, start, stop, prompt, cancel, answer_permission, pump}`. | M8. ⚠ Permission answers are privileged; keep `fs/*` and `terminal/*` denied-by-policy contract. |
| E7 | `bridges/discord.rs:37-497` | **DAEMON** | `discord.json` (0600, atomic), token verification, human-typed REST sends, gateway info display; token never returned (`:12-24`). | `integrations/discord.rs::DiscordService::{save_config, clear_config, verify_bot, send_test_message, gateway_info}`. | M8. ⚠ Token stays daemon-side; no auto-send, no token in status lines. |
| E8 | `bridges/discord_gateway.rs:61-776` | **DAEMON** | Opt-in receive thread, 100-entry in-memory queue, bounded 5× backoff reconnect, `MESSAGE_CREATE` inbox; personal data, never persisted (`:11-36`). | `integrations/discord.rs::DiscordGatewayService::{start, stop, refresh, clear_events}`; surface events via Wave-0 vocabulary rather than a polled queue. | M8, depends E7. Strictly human-opt-in; no auto-connect. |
| E9 | `bridges/update.rs:12-82` | **DAEMON** | `anima_core::update::check_for_update` with 8 s timeout; check+notify only, no self-replacement. | `update.rs::UpdateService::check() -> UpdateStatusDto`; About-window UI is dropped. | M8. One poller for all clients rather than three. |

## 6. Capture and realtime audio intent

| ID | Item (file:line) | Class | What it owns | Target daemon module + public API | Order / writer risk |
|---|---|---|---|---|---|
| A1 | `bridges/capture.rs:36-890` | **CLIENT-LOCAL** | Captures directory (`<profile>/captures`), list/clear of `capture-<digits>.png`, Wayland portal `Screenshot` D-Bus worker with consent dialog, X11 grab unimplemented. | Flutter/Godot capture UI owns the portal call (user consent requires a GUI process). Daemon gains an optional ingest RPC (`vision/ingest.rs`) only if the realtime pipeline consumes the PNG; no daemon-side portal code. | M10 (+ M9 for ingest). ⚠ Corrects pivot §4.1's "audio" grouping; do not move the portal worker into a headless daemon. |

**Audio wiring gap (no Slint logic to port).** `hearing.rs` and `speech.rs` store **intent only**
(`hearing.rs:17-38, 265-282`; `speech.rs:41-44, 185-196`). The real pipeline is net-new: `anima-daemon`'s
Cargo.toml links **none** of `anima-stt`/`anima-llm`/`anima-speech` (`crates/anima-daemon/Cargo.toml:17-25`).
It belongs in M9, not in a mechanical bridge port.

## 7. Stage, render adapters and UI markup

| ID | Item (file:line) | Class | What it owns | Target daemon module + public API | Order / writer risk |
|---|---|---|---|---|---|
| U1 | `bridges/stage.rs:2-411` | **DROP** | VRM `StageState`, skin/vertex buffers, expression/lip-sync/gaze hooks, smoke tick counter. | Godot 4 renderer (decision A: Live2D GDCubism + 3D VRM/MMD); reusable algorithms stay in `crates/anima-render` (`vrm/engine.rs`, `vrm/lipsync.rs`). | Wave 6. No daemon state. |
| U2 | `bridges/mmd.rs:2-351` | **DROP** | MMD rest-pose engine, buffers/materials/textures. | Godot MMD plugin; `anima_mmd` engine knowledge only. | Wave 6. |
| U3 | `bridges/spine.rs:2-129` | **DROP** | `SpineControllerState` UI-facing model/skin/play/poke calls. | Godot plugin; `anima-render/src/spine/*` is the reusable core. | Wave 6. |
| U4 | `spine_rt.rs:2-239` | **DROP** | Process-wide spine session, bundle load, tracks, smoke check. | Same as U3. | Wave 6. |
| U5 | `spine_render.rs:2-372` | **DROP** | CPU rasterizer + `slint::Image::from_rgba8` adapter (`:326-334`). | Slint-specific; **not** the reusable renderer. | Wave 6. |
| U6 | `ui/**/*.slint` — **1,728 lines** total | **DROP** | `bootstrap.slint` (54), `main.slint` (37), `I18n.slint` (22), `Theme.slint` (42), `SpineStage.slint` (34), `shell/{MainShell 188, ChatWindow 215, SettingsWindow 112, AboutWindow 163, Splash 78}`, `components/*` (16 files, 783). | Flutter widgets + Godot scenes; Vue web app (`apps/stage-web`) is the behaviour reference, not this markup. | Wave 6. |
| U7 | `bridges/desktop.rs:2-424` | **CLIENT-LOCAL** | Tray (ksni), global hotkeys (x11rb), autostart (XDG/LaunchAgent/registry, `:281-320`), notifications, action pump. | Net-new tray/launcher drives Flutter/Godot **process lifecycle only** (pivot decision 8); daemon owns state. | M10. ⚠ Must not become a second privileged data path. |

## 8. Migration order (dependency-ordered; big-bang cutover)

| Step | Items | Lands when / why |
|---|---|---|
| M0 | Prerequisite, not Slint code | Wave-0 server→client event lane + `token.delta`/`status.changed` vocabulary (pivot §7). Blocks C4 and all realtime work. |
| M1 | R1, R2 | `Services` in daemon library (`core.rs`/`services.rs`); adopt existing `airi.sqlite` and audit paths unchanged. |
| M2 | S1–S4, S8–S12, R1 accessors | One `SettingsService` writes every typed section and blob; rehome S12 tests. Foundation for all other services. |
| M3 | S6, S7 | `ProviderService`/`SpeechService`; secret-safe DTOs. Chat resolution depends on this. |
| M4 | C2, V1 | Single `CardService` (retire the duplicate import paths). |
| M5 | C3, C7, C8 | `MemoryService` + completed-turn hook and rehomed tests; must precede chat streaming. |
| M6 | C1, C4, C5 | Daemon chat service + Wave-0 token events; Flutter view state replaces C5. ⚠ Delete Slint's `ChatState` in the same change that exposes daemon chat. |
| M7 | V2, V3 | Vault + local-FS sync; privileged restore gating. |
| M8 | E1–E3, E5–E9 | Awareness logic folded into existing daemon modules; integrations + update as library services. |
| M9 | Net-new audio pipeline | Link `anima-stt`/`anima-llm`/`anima-speech` into the daemon; intent settings from M2/M3, events from M0. No Slint bridge survives. |
| M10 | A1, C5, S5, S11, U7 + Flutter/Godot clients | Thin clients consume RPC + events; Vue web reference reconciliation (pivot Wave 5). |
| M11 | R3–R8, C6, S12, E4, U1–U6 + crate removal | **Big-bang delete**: `crates/anima-slint` from workspace, remove `anima-slint` dev-dep (`anima-daemon/Cargo.toml:29`), preserve audit archives, converge docs (pivot Wave 6). |

## 9. Risk list

- **Secrets and permissions.** Provider API keys cross the Slint boundary today (`providers.rs:10-23`);
  MCP bearer tokens/sensitive headers require redaction round-trips (`mcp.rs:23-28, 49-105`); Discord
  tokens are file-only and never returned (`discord.rs:12-24`); ACP permission answers are policy-gated
  (`acp.rs:14-24, 619-654`); focus digests are personal data (`daemon.rs:47-57`). Every new WS DTO must
  be secret-free — mirror the `core.status` discipline (`crates/anima-daemon/src/gateway.rs:908-914`).
- **Audit archives are not deletable content.** `clear_audit()` renames to `.cleared-<ts>` and never
  truncates (`daemon.rs:861-897`); path/retention contract is `anima-channel/src/audit.rs:14-27` and
  `decision-audit-archive-retention.md`. Wave 6 deletes the app, not the history.
- **Platform-only services.** Wayland portal capture with consent dialog, X11 grab unimplemented
  (`capture.rs:20-24, 475-495, 873-879`); tray via ksni + x11rb hotkeys + autostart per OS
  (`desktop.rs:5-34, 281-320`); notify-rust session-bus notifications (`daemon.rs:445-470`). None can
  be assumed to work headlessly; keep them in clients or behind explicit daemon RPCs.
- **Audio/ggml wiring.** Linking `anima-stt` into a GUI previously caused duplicate ggml symbols
  (`hearing.rs:256-262`); pipeline belongs in the daemon. Live lip-sync is currently a TS
  BroadcastChannel, not a Rust event; the daemon link is absent (pivot §6/§7).
- **Single-writer hazards.** C2/V1 (cards), C3/C8 (memory), S6/S7 (credentials), V2/V3 (store
  writers), R1 (service roots) — each needs its Slint counterpart removed in the same change that
  adds the daemon service. No client-side store writer may survive (client doc decision 1).
- **Path compatibility.** `airi.sqlite` under `<data>/airi-slint` (`crates/anima-daemon/src/core.rs:44-55`) and audit under
  `<data>/airi-slint/audit` (`crates/anima-channel/src/audit.rs:16-27`) must keep their names after the crate is deleted.
- **Daemon library surface.** Services must be added to `lib.rs`, not just `main.rs` (§0 item 5), or
  they cannot be integration-tested independently.

## 10. Verification plan (prove parity before deleting the crate)

1. **Rehomed unit tests (must pass in `anima-daemon`).** Chat/memory: `chat.rs:1762` (retrieval before
   card system prompt), `:1797` (disabled = byte-identical), `:1818`, `:1855`, `:1895-2030` (journal
   and one-embed-per-turn); memory backfill tests at `memory.rs:435-643`; audit/wake tests at
   `daemon.rs:1028-1129` (tail reader, cap, event→verb), wake-edge and composer tests at `daemon.rs:1224-1495`;
   settings tests from `settings_tests.rs:90-520`. No UI toolkit, HTTP or event loop required.
2. **Golden transcripts.** Replay the `--smoke` canned SSE stream (`chat.rs:230-241`) as a daemon WS
   probe: assert session creation, greeting persistence, per-delta `token.delta`, `MessageDone`
   journal/embed, and the known mid-stream-switch limit (`chat.rs:25-27`). Keep one golden JSONL of
   the assistant deltas and session list as a checked-in fixture.
3. **Headless WS round-trips (no GUI).** settings/providers (redacted)/cards/sessions: read-write-read
   through the gateway; `core.status` still green with no secrets (`crates/anima-daemon/src/gateway.rs:908-914`). Audit archive
   test must show a `.cleared-*` rename and no truncation.
4. **Secret-leak assertions.** For every new DTO: no token, api key, bearer token, prompt, or absolute
   path (extend the `core.status` test pattern). MCP `REDACTED` sentinel must never persist.
5. **Commands.** `cargo test --workspace --locked` (after removing the Slint dev-dep);
   `pnpm check:wire-types` for the generated schema; `pnpm -F @proj-anima/stage-ui typecheck`. Note
   `stage-tamagotchi typecheck:node` is environment-red for pre-existing reasons — check whether
   changed files appear in its errors rather than treating it as a regression gate.
6. **Deletion exit checks.** `find crates/anima-slint` empty; no workspace member or manifest reference
   to it; 1,728 `.slint` lines gone; archive files untouched (§9); no doc describes Slint as shipping.

## 11. Counts

| Classification | Rows | Items |
|---|---:|---|
| DAEMON | 28 | R1, R2, C1–C4, C7, C8, S1–S4, S6–S10, V1–V3, E1–E3, E5–E9 |
| CLIENT-LOCAL | 5 | C5, S5, S11, A1, U7 |
| DROP | 15 | R3–R8, C6, S12, E4, U1–U6 |
| **Total** | **48** | Rows by section: 8 + 8 + 12 + 3 + 9 + 1 + 7 |
