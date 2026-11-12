# P11 — Manifest-driven parity audit + cutover prep

Status: **design only**. This note defines what the audit *is*, why the current 229-unchecked count is inflated, and what cutover would actually mean. No files are regenerated, ticked, or edited by this note, and no cutover decision is taken here — that is the user's call.

## 1. Regenerating the manifest deterministically

```
node apps/airi-qt/scripts/gen-manifest/gen-manifest.mjs
```

The generator walks `apps/stage-tamagotchi/src/renderer/pages/**` and `packages/stage-pages/src/pages/**` (extensions `.vue|.ts|.js`, skipping `node_modules/.git/target/dist/build/.nuxt/.output/.cache/out`), derives route names mechanically, and emits **everything as `- [ ]`**. Facts that matter for an audit:

1. **Ticks are not generator state.** The 5 `[x]` in `features.md` are manual edits applied after generation; re-running the script wipes them. Any regeneration run must be preceded by a tick-preservation mechanism — proposed: (a) a sidecar `docs/port-manifest/ticks.txt` (one route per line), re-applied by the generator, or (b) read-modify-write of the existing manifest. Until then, "regenerate" means "regenerate then hand-re-tick the 5".
2. **The route denominator is inflated.** Measured against `electron.vite.config.ts`, whose `unplugin-vue-router` `routesFolder` config excludes `**/components/**` and four explicit paths, and counts only actual routes:
   - 74 of 229 unchecked entries (~32%) are **not routes at all** — colocated `.ts` modules, `.test.ts` files (3 known), `composables/`, `tabs/`, and `components/` under `pages/` (e.g. `/devtools/context-flow/components/*`, `/knowledge-graph/components/*`). `electron.vite.config.ts` excludes `**/components/**` from the router globally; the manifest generator does not.
   - 14 unchecked entries are plain `.ts`, 3 are `.test.ts` (routes like `/settings/airi-card/components/tabs/generation-thinking-presets.test` — a test file is not a page).
   - The four explicit route exclusions (`settings/connection/index.vue`, `settings/system/general.vue`, `settings/modules/mcp.vue`, `settings/system/connection.vue`) still appear as entries (stage-pages copies — 6 rows).
   - Non-route siblings like `generation-thinking-presets.ts` / `foundry-presets.ts` / `context-flow-types.ts` are counted as routes.

   So the honest "route" unit count is materially below 234. Before auditing, the generator should: apply the same `exclude: ['**/components/**']` + explicit-exclude list, skip `*.test.ts`/`*.d.ts`, and skip non-renderable `.ts` (or split manifests into `routes` vs `colocated-modules`). Then the audit unit is real pages.
3. **`features.md` is only one of nine manifests** — audit scope should include `ipc-channels.md` (203), `stores.md` (188), `electron-services.md` (118), `settings-panels.md` (70), `providers.md` (44), `speech.md` (25), `i18n-keys.md` (10), `windows.md` (9). The same inflation applies (mechanical extraction, no semantic filter).

**What the audit means** (in order of automation):

1. **Registry/parity cross-checks (scripted, cheap)** — e.g. assert `airi_llm::PROVIDER_DEFS` ⊇ `providers.md` registry ids (45 LLM rows verified in-code this session); assert `airi-speech` TTS registry covers 26/26 ids (verified; README table matches); STT providers similarly; i18n key parity across the 10 locales (vitest covers this today); settings-section coverage of `settings-panels.md`.
2. **Manifest-item → evidence mapping** — for every manifest line, grep `apps/airi-qt` for a bridge/QML/crate implementing it (`bridges/*.rs`, `qml/**`, `crates/*`) and classify (a)–(d) below with a pointer. Mechanical pre-pass + human confirmation.
3. **Vue tests** — `vitest` colocated tests cannot run against Qt; they serve as behavior inventories. Where a Qt port exists, targeted Rust tests should be derived from the Vue test's cases (precedent: provider registry tests assert 45 rows; PNG card tests; Polly determinism). Walking every Vue test is not the audit; walking every manifest item is.
4. **Manual checklist sign-off** — final per-item tick/classification with evidence, committed as the manifest itself (then ticks are the audit record).

**Audit output format.** Each manifest item becomes one line of the audit record:

```
- [x] /settings/system/general — (b) done — evidence: qml/pages/settings/system/GeneralSettingsPage.qml + bridges/settings_general.rs
- [ ] /settings/memory — (a) real gap (UI) — backend: airi-core/src/memory/*; QML page missing
```

The record lives in the manifest file itself (the only place ticks have ever lived) or in a sibling `audit-2026-11.md` that is merged and then discarded. Either is fine; a third parallel tracking doc is not.

**Manifest-by-manifest scope** (all nine, same (a)–(d) scheme):

| Manifest | Lines | Notes |
|---|---|---|
| `features.md` | 229 unchecked / 5 ticked | the headline number; see §1 inflation |
| `ipc-channels.md` | 203 | mostly N/A by design — Qt has no Electron IPC; items map to cxx-qt invokables or are (c) "no IPC exists"; audit = confirm each ipc channel's *semantic* has an equivalent bridge call |
| `stores.md` | 188 | Pinia stores with no Qt counterpart map to (a)/(c); several map to `airi-store` tables (sessions, summaries, embeddings, settings) — spot-check those |
| `electron-services.md` | 118 | main-process services: tray, shortcuts, updater, windows — mostly ported (P8) or explicitly not; many are compositor-specific and become (c) |
| `settings-panels.md` | 70 | Vue settings components, not routes — high false-positive rate; same `/components/` inflation as features |
| `providers.md` | 44 | cross-check against `airi_llm::PROVIDER_DEFS` (scriptable) |
| `speech.md` | 25 | cross-check against `airi-speech` registry (26 TTS defs, verified this session) |
| `windows.md` | 9 | Qt `WindowManager` covers most; Electron-only options (vibrancy, `skipTaskbar`) become (c) |
| `i18n-keys.md` | 10 | key-count parity; vitest already gates locale parity — mark (b) after spot-check |

## 2. Classification scheme

| Class | Meaning | Resolution |
|---|---|---|
| (a) real gap | Genuinely missing in Qt (often: UI surface missing though backend exists) | Schedule or explicitly waive |
| (b) done, never ticked | Implemented in `apps/airi-qt`; evidence pointer required | Tick manifest |
| (c) out of scope, with reason | e.g. Live2D (Cubism license), per-Vue-page ports collapsed into a generic Qt page, devtools waived | Record reason in manifest |
| (d) blocked on other waves | e.g. card-AI wizard suite (`p9-card-wave2` deferred), MMD P10 | Link blocking wave |

## 3. Sampling plan — 10 unchecked items (every 23rd line, offset 8)

| # | Item | Evidence in `apps/airi-qt` | Class |
|---|---|---|---|
| 1 | `/devtools/live2d` | `Live2dSettingsPage.qml` is an explicit deferred-renderer placeholder; Live2D blocked on Cubism license | (c) out of scope |
| 2 | `/settings/system/general` | `qml/pages/settings/system/GeneralSettingsPage.qml` + `bridges/settings_general.rs` | (b) done, unticked |
| 3 | `/devtools/websocket-inspector` (stage-pages devtools) | No evidence anywhere in `apps/airi-qt` | (a) real gap (devtools; likely waive as (c)) |
| 4 | `ImageTagExtractorModal` (airi-card) | No evidence; part of the card-AI wizard suite explicitly deferred in `p9-card-wave2.md` | (d) blocked on card-AI wave |
| 5 | `CognitionSubTabRouting` (airi-card) | `airi-core` cards schema has cognition trigger/affect structures (`AiriCognitionTriggerOverride`…) but no routing UI; suite deferred in `p9-card-wave2.md` | (d) blocked on card-AI wave |
| 6 | `/settings/memory` | Backend landed (`airi-core/src/memory/{short_term,retrieval,embedding}.rs`, `p7-*` notes); **no QML memory settings page exists** | (a) gap (UI only) |
| 7 | `/settings/modules/memory-short-term` | Same: `short_term.rs` + summaries table exist; no Qt settings surface | (a) gap (UI only) |
| 8 | `/settings/providers/chat/qwen-portal` | Vue page hardcodes `qwen-portal`; Qt deliberately replaced per-provider pages with a generic `ProvidersPage.qml` driven by `airi_llm::PROVIDER_DEFS`, and `qwen-portal` is **not** in the Rust registry (45 ids checked) | (c) out of scope by architecture (porting = add a registry row + decide qwen-portal's API contract; not a page port) |
| 9 | `/settings/providers/speech/microsoft-speech` | TTS backend **ported**: `airi-speech` unspeech proxy `microsoft/{model}`, status Ported; no dedicated Qt settings page (speech configuration UI not landed at all) | (b) backend done; (a) for the settings surface — split item |
| 10 | `/settings/stage` | `StageControlEditor.vue` is the control-strip customizer (`@proj-airi/stage-ui/components`) — **not** yet ported in Qt (StageSettingsPage covers stage window/model/captions, not the strip customizer) | (a) real gap |

**Calibration.** Of 10 arbitrary unchecked items: 2 are (b) outright (2, 9-backend), 2 are (c) (1, 8), 2 are (d) (4, 5), 4 are (a) with 2 of those being "backend done, UI missing" (6, 7), 1 a devtools page (3) and item 10 the control-strip customizer gap (StageControlEditor, not the Qt StageSettingsPage). Note the sample over-represents stage-pages (194/229 entries), which is where the inflation lives. The honest audited-unit count could still end up roughly half of 229 or less being actionable gaps, but n=10 with a fixed stride is indicative — redo the sample after the generator fix before quoting numbers.

## 4. Cutover: what "Electron deprecation" would mean concretely

Nothing below happens without an explicit user decision. Lane C prepares; the user disposes.

1. **Freeze, don't delete.** `apps/stage-tamagotchi` stays in-repo, marked frozen/archived (README banner + `apps/stage-tamagotchi/README.md` header + CODEOWNERS-ish note). `stage-web` and `stage-pages` remain live (web target still consumes them; the Qt app does not). Post-cutover bugfixes to stage-tamagotchi: none, except security fixes at the maintainers' discretion. Forks/reports referencing `packages/stage-ui*` stay valid — those packages are not deleted, just no longer shipped on desktop.
2. **Update-mechanism parity is currently not parity.**
   - Electron: `electron-updater` full lifecycle — `checking-for-update` → `update-available` → `download-progress` → `update-downloaded` → `quitAndInstall`, driven over GitHub Releases; `MockAutoUpdater` in dev; wired through eventa (`shared/eventa` `autoUpdater`), About/settings surfaces send `checkForUpdates`.
   - Qt: `airi_core::update::check_for_update` — **check + notify only** (single unauthenticated `GET /repos/anlmalabs/airi/releases/latest`, 8 s cap, `User-Agent airi-qt/<ver>`); the `UpdateController` bridge exposes it on demand from the About page; `self_update` was evaluated and **deliberately rejected** for P8. There is no download, verify, or replace path, and no CI/release pipeline emits an `airi-qt` artifact to check against.
   - Concrete deltas to close or explicitly accept: (i) a signed-download + verify + replace flow (or a documented "download from releases page" UX), (ii) release workflow changes so GitHub Releases actually carry Qt binaries (see 4), (iii) channel/prerelease semantics parity with electron-updater's (`allowPrerelease`), (iv) macOS/Windows notarization/signing story if those platforms ship. Until (i)–(iv) exist, the honest claim is "Qt has a release-check notifier, not an updater", and the About page copy must not imply otherwise.

   | Concern | Electron (`electron-updater`) | Qt (`airi-qt`) |
   |---|---|---|
   | Check cadence | on demand + on launch (eventa), periodic | on demand only (About page invokes) |
   | Download | yes, with progress events | none (rejected for P8) |
   | Install/replace | `quitAndInstall`, staged | none |
   | Dev behavior | `MockAutoUpdater` | real GitHub call (never in tests; mock server in unit tests) |
   | Release artifacts | deb/rpm/flatpak/AppImage via electron-builder | **none emitted** — the check endpoint has no Qt asset to find |
   | Signing/notarization | electron-builder config (e.g. NSIS, snap) | unimplemented |
3. **Data migration is explicitly out of scope** (locked decision, do not revisit): no IndexedDB→SQLite migration. Users of the Electron app start fresh — cards re-import through the existing PNG/JSON card import (`CardLibraryPage`), settings revert to defaults, localforage data stays in the old profile. The installer/README must say this in one sentence before cutover.
4. **Packaging / CI delta** (all currently absent for airi-qt — verified: no reference in `.github/workflows`):
   - CI: a `ci-qt.yml`-style job — `cargo test --workspace`, `clippy`, Qt6 system deps (Quick3D), `--smoke` under offscreen QPA or xvfb, plus the vendored-spine line note (one runtime per binary) and optional `AIRI_TEST_*` live tests skipped in CI.
   - Release: extend `release-linux-desktop.yml` (today: electron-builder deb/rpm/flatpak + `flatpak-builder` for stage-tamagotchi) or add a parallel lane for Qt: cargo build `--release`, package as deb/rpm/AppImage (nfpm/cargo-deb/flatpak), artifacts uploaded to the same GitHub Release so the check endpoint in §2 has something to find. macOS/Windows: icns/ico, `/proc` pid-probe replacement (named mutex), hotkey permissions — documented in `apps/airi-qt/README.md`, not yet solved.
   - Repo hygiene: `apps/airi-qt/target/**` already excluded from pnpm/npm workspaces; keep it that way.
5. **Final README / rosetta-stone entries** (user sign-off required; rosetta-stone is canonical and currently has **zero** `apps/airi-qt` mentions):
   - Root README "apps" table gains: `apps/airi-qt — native Qt Quick desktop app (Rust + cxx-qt), canonical desktop target after cutover; see apps/airi-qt/README.md`.
   - `docs/rosetta-stone.md` gains a **Desktop App (Qt canonical)** row under §1 (Concept / Canonical path): `apps/airi-qt` (Qt Quick + cxx-qt + Qt Quick 3D; VRM/Spine/MMD renderers), with stage-tamagotchi marked *frozen/Electron legacy*, mirroring how the rosetta-stone already marks `control-island` DEPRECATED. Renderer ordering row: VRM → Spine → MMD (P10). Keep `stage-web` listed as the web target.
   - `apps/airi-qt/README.md` gains the cutover note + one-line migration stance ("no data import from the Electron profile; import cards manually").
6. **Order of operations** (checklist):
   - [ ] §1 generator fix + tick sidecar land; manifest regenerated; counts restated honestly.
   - [ ] Full (a)–(d) classification of the reduced set with evidence; (a) items scheduled or waived in writing.
   - [ ] Update story decision (§2): check-only forever, or download+replace; copy and code follow the decision.
   - [ ] Release pipeline emits Qt artifacts (§4) and one real GitHub Release is cut from it.
   - [ ] README + rosetta-stone edits (§5) merged; stage-tamagotchi marked frozen.
   - [ ] User posts cutover notice; stage-tamagotchi final tag; frozen banner PR.
   - [ ] Reactive: electron-services/ipc-channels manifests archived with a note "frozen reference, not a port target".

**How to run the audit, concretely** (checklist for the executing lane):

- [ ] Branch; fix generator (§1 items 2–3: component/test/exclude handling; keep the output byte-deterministic — same input → same markdown).
- [ ] Add tick sidecar; regenerate all nine manifests; commit restated counts in the audit note, not in this one.
- [ ] Pre-pass classification by regex (`live2d` → (c); `settings/airi-card/*` wizard files → (d) cite `p9-card-wave2.md`; `ProviderRow`-generatable paths → (b) pending human check).
- [ ] Human pass on survivors: assign (a)/(b)/(c)/(d) + evidence pointer; zero "unclassified" rows allowed at sign-off.
- [ ] Cross-check the three registries (§1.1) with a small script; record pass/fail per manifest.
- [ ] Re-sample 30 unchecked items post-fix (not 10, and not a fixed stride) and report the new (b) rate — that number calibrates how trustworthy the residual "gaps" are.
- [ ] Tick (b) rows in the regenerated manifest in one dedicated commit.
- [ ] File (a) rows as issues (`wayfinder:task`) or explicit waivers with reasons; (c) rows get the reason inline; (d) rows link the blocking wave.
- [ ] Freeze note lands on stage-tamagotchi only after §4.6 steps through the user, not before.

**False-positive traps seen in the sample** (assume these dominate the remainder):

- "Backend ported, UI missing" reads as (a) but is usually a settings-surface decision, not an engine gap — record the backend pointer so the next auditor doesn't re-derive it.
- Dedicated per-provider Vue pages collapse into one generic Qt page + registry row — a page-level manifest row is not a port requirement.
- Devtools pages are the largest unchecked block; decide once, globally ("devtools waived for Qt v1"), instead of classifying them 60 times.
- `.test.ts` / `.ts` / `components/` rows inflate every manifest — fix the generator before quoting any percentage.

## 5. What was actually verified this session (and what wasn't)

Verified by reading, not by running: `features.md` counts (229/5, every-23rd-line sample), generator source, `electron.vite.config.ts` route excludes, `.github/workflows/*` (no airi-qt reference), `airi-llm` registry contents, `airi-speech` TTS table, absence of `.pmx/.pmd` anywhere, presence of 14 VMDs, `airi-qt` page/bridge inventory. Not run: cargo, pnpm, tests, builds — nothing in this note is compile-verified. Crates.io claims are unverified by design. Numbers marked "in-code this session" are reads of the working tree as of 2026-11-10, not a clean audit.

## 6. What this lane does NOT decide

Whether to cut over at all; the target date; the update mechanism; platform support order; whether devtools pages (the largest single block of unchecked entries) are ported or waived. All user decisions.
