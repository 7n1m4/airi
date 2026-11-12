<!-- SPDX-License-Identifier: GPL-3.0-or-later -->
# P11 Wave ⑪ — module services (user direction 2026-11-12: "continue porting other features from electron")

Five lanes in parallel (exclusive scopes), integrated centrally 2026-11-12.

## What landed

- **D1 memory** (`bridges/memory.rs` `MemoryController` + `modules/memory/MemorySettingsPage.qml`): enable toggle + retrieval top-k persisted to `settings/memory` blob; live journal browser (newest-first, cap 20, 400-char truncation) via `TextJournalService`; retrieval-provider badge (provider id · model from the resolved chat pipeline, never keys). `clearJournal()` deliberately omitted — `JournalRepo` exposes no delete (append-only). Honest: chat pipeline does not consume the flag; retrieval not called in this build. 3 bridge unit tests (JSON shaping/truncation/label).
- **D2 speech** (`bridges/speech.rs` `SpeechController` + `SpeechSettingsPage.qml`): the airi-speech catalog as a provider picker on the page — all 26 `TTS_PROVIDER_DEFS` with honest Ported/Partial/Unsupported badges (unsupported rows unselectable); voice/speed persist to `settings/speech`; `synthesizeSample(text)` writes a WAV under the profile dir via `airi-speech` (never autoplays — no Qt Multimedia in this stack); in-app playback not wired (flagged); STT is a placeholder pointing at the hearing surface. 5 bridge unit tests. One deviation honestly flagged by the lane and accepted at integration: `futures-util` added as a workspace-internal dep (already in the lockfile) to drain the `AudioStream`.
- **D3 hearing** (`bridges/hearing.rs` + `HearingSettingsPage.qml`): enable/PTT/hotkey/device persist to `settings/hearing`; device list honestly empty (airi-stt has no enumeration yet); capture pipeline + Silero VAD explicitly not wired — page says so. **Critical finding (accepted, enforced): `airi-stt` is NOT added as a dependency** — `whisper-rs-sys` and `llama-cpp-sys-2` (via `airi-local-llm`) both vendor ggml and `rust-lld` reports duplicate symbols; linking the app with airi-stt referenced fails. Bridge carries no airi-stt reference; dep stays OUT until a real consumer lands (device enumerator), and central must re-verify the app link then.
- **D4 modules overview** (`ModulesSettingsPage.qml`): static honest catalog of the module family (4 sections, 17 entries, status badges + hover reasons, deferred rows disabled, no toggles/nav plumbing).
- **D5 card export** (`bridges/cards.rs` +`exportCardToFile`, `CardExportDialog.qml`, `CardLibraryPage.qml`): SaveFile → byte-copy of the card (PNG keeps embedded `tEXt`), destination via `FileDialog.SaveFile`; refuses directories / self-copy / empty destinations; no reserialization, no settings writes. 8 i18n keys embedded.

## Central integration (applied)

`cargo check` caught one own-goal: `futures-util` first inserted above `[package]` — fixed into `[dependencies]`. `build.rs` registers memory/speech/hearing (bridges) + all 4 QML pages + CardExportDialog; `bridges/mod.rs` adds `pub mod {hearing,memory,speech};`; `airi-speech` path dep added; `SettingsWindow.qml` nav + stack renumbered 0–28 (29 children: … 24 ACP Agents, 25 Modules 📦, 26 Memory 🧠, 27 Speech 🗣️, 28 Hearing 👂); 71 i18n keys fanned out ×10 locales (memory 22+hearing 20+nav 2, modules 45+nav 1, speech 24+nav 1 — parity 4/4, audit ×10); 11 manifest ticks applied and 2 rows **unwaived** (CardExportDialog + use-card-export — they landed despite the v1 card-AI waiver; the rest of the airi-card suite stays waived); `features.waivers.json` 87→85; `features.ticks.json` 20→33; manifest regenerated: **unchecked 116, waived 85, checked 33**; `p11-audit.md` reclassification note added.

## Verification

fmt clean · clippy `-D warnings` clean · **622 tests green (49 suites)** · offscreen `--smoke` exit 0 (`pages visited: splash, control-strip, chat, settings, about, stage` — all 29 pages instantiate; settings in tour) · i18n parity 4/4 · yaml audit ×10 · smoke stage ticks 30.
MMD-seeded profile smoke not re-run (MMD path untouched this wave).

## Not done / honest limits

- No mic capture, no VAD, no live input level meter; hearing persists intent only.
- No in-app sample playback; speech samples are files only.
- Retrieval/fusion not wired into chat; memory enable is a persisted preference, not a feature switch.
- `clearJournal()` omitted (backend has no delete).
- Lifetime-memory / memory-signals / system-one (Laya) surfaces still absent (wave ⑫ candidates).
- MCP registry Discover not wired (registry shape verified live but no page work started).
- eBPF/sudo-mode system embedding: research landed (`p12-system-embedding-research.md`, untracked at lane time → committed here); zero implementation; decisions pending in §I.
