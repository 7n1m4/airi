<!-- SPDX-License-Identifier: GPL-3.0-or-later -->
# P9 Wave ③ (delegated) — Onboarding / Notices / Widgets / Data vault shells

Three delegated lanes (background subagents, isolated directories), main-agent
integration after review. No feature logic was fabricated: every action with no
Rust backing is visible-but-disabled or raises a persistent "not wired" banner.
Nothing is committed; everything is in the working tree for user review.

## Lanes

- **Lane A** (`docs/phase-notes/p9-laneA-onboarding.md`): `qml/pages/onboarding/OnboardingPage.qml` (v2 wizard, presentational), `OnboardingV3Page.qml` (hero), `qml/pages/notice/{NoticePage,GeminiNoticePage,FadeOnHoverNoticePage}.qml`, `qml/pages/widgets/WidgetsPage.qml`.
- **Lane B** (`docs/phase-notes/p9-laneB-data.md`): `qml/pages/settings/data/{DataSettingsPage,DataExportDialog,DataImportDialog,ScrubHistoryDialog}.qml` — UI-only; the Vue inspect/align/commit step machine was deliberately not ported.
- **Lane C** (`docs/phase-notes/p10-mmd-design.md`, `p11-parity-design.md`): design notes only, no code; summary in this note's "P10/P11" section.

## Integration applied (main agent)

- `build.rs`: 10 QML files registered (`qml_file` entries for data/onboarding/notice/widgets pages).
- `qml/shell/SettingsWindow.qml`: seven new nav entries + StackLayout entries — nav indices **14 Data 🗄️, 15 Onboarding 🪄, 16 Onboarding V3 ✨, 17 Notice 📣, 18 Gemini 🤖, 19 Fade on Hover 👁️, 20 Widgets 🧩** (Data/Onboarding/V3/Notice/Gemini/Fade on Hover/Widgets). All are instantiated eagerly by the StackLayout, so the offscreen smoke tour covers module load for every new page.
- `packages/i18n/.../shell.yaml` ×10 locales: new top-level `onboarding:` (37 keys), `notice:` (33), `widgets:` (21), `data:` (112) sections plus `settings.nav.{data,onboarding,notice,widgets,onboardingV3,gemini,fadeOnHover}` — 203 new leaf keys per locale, translated (not stubbed) for all 10 locales. `npx vitest run src/locales.test.ts` 4/4 green; `scripts/yaml-manager.js audit` — no duplicate keys in any locale file.
- The `settings.nav.onboardingV3` / `gemini` / `fadeOnHover` keys exist in all locales; `onboardingV3`/`gemini`/`fadeOnHover` reuse the same product names in every locale by design.

## Verification

- `cargo build -p airi-qt` — clean.
- `QT_QPA_PLATFORM=offscreen cargo run -p airi-qt -- --smoke` — exit 0; `pages visited: splash, control-strip, chat, settings, about, stage` (settings loads the 11 new pages without QML errors).
- `cargo fmt --all --check` — clean. `cargo clippy --workspace --all-targets -- -D warnings` — clean. `cargo test --workspace` — 23 suites green, 0 failures.
- Lanes A/B both ran `qmllint` with zero errors (A: "only the codebase-idiomatic unqualified-access warnings"; B: fully clean).

## Not done / deliberately not ticked in features.md

- `/onboarding`, `/onboarding-v3`, `/notice*`, `/widgets`, `/settings/data*` manifest items stay **unchecked** — the pages are presentational shells; the first-run onboarding store, notice-window host, widgets bridge and the vault/scrub Rust backend do not exist yet. A scaffold is not a completed port.
- No new Rust bridges were created in this wave. Wave ④ scope (vault backend shape) is written in `p9-laneB-data.md` §4.
- Settings nav growth from 12 to 20 entries is functional but visually unverified — no GUI/desk check was possible offscreen; if it looks cramped, group the notice/onboarding entries or move these to dedicated windows later.
- Lane requests deferred (all optional, none blocking): `Theme.fontMono`, `ACheckbox`, gradient theme tokens, `AButton.loading`, shared `ADeferredButton`, `AToast`, fixed `ASwitchRow`, `qt_module("Multimedia")` + video asset registration.

## P10 / P11 status (Lane C)

- P10 MMD design complete as a document; zero MMD models exist in-repo, so implementation is gated on fixtures (in-test constructed PMX/PMD/VMD + env-gated `AIRI_TEST_MMD_MODEL`). Physics defaults off behind a cargo feature unless the user wants the ammo.js-parity behavior.
- P11 parity plan complete as a document; the unchecked count (229) overstates gaps materially (~32% not routes; sampled items found implemented-but-unticked). Re-running the manifest generator wipes manual ticks — a tick-sidecar or generator fix is required before trusting any future count.

## Open questions for the user

1. Ship the wave-3 pages as-is (names/labels confirmed above), or wire dedicated windows instead of Settings nav entries 14–20?
2. Should the onboarding/notice/widgets scaffolds be hidden behind an `--experimental` flag in the next iteration, or stay visible?
3. P10 physics: off-by-default (documented deviation) or port bullet-rs for ammo.js parity?
4. P11: ok to attempt generator fix + sidecar tick mapping as the first cutover task?
