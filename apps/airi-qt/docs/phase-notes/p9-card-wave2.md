<!-- SPDX-License-Identifier: GPL-3.0-or-later -->
# P9 Wave ② — Character cards: library, editor, models/explore

Direct-port of the card-facing settings surfaces into the Qt app, scoped to the slice the user approved: **card library page**, **card editor page with save-back**, **models/explore page**. Everything else in the Vue card suite is explicitly deferred (see "Deferred" below).

## Deliverables

**Card library** — `qml/pages/cards/CardLibraryPage.qml`, wired into Settings → Cards (nav index 11).
Searchable list over `<profile>/cards/*.png|*.json` scanned by the same code the chat lane's `CardPicker` uses (`bridges::chat::scan_cards`). Per row: avatar thumbnail (PNG cards, loaded via `Image { asynchronous: true }`), name, first line of the greeting, `kind` badge (`png`/`json` via file path). Buttons per row: **Use in chat** (persists via new `settings/cards` section: `CardsSettings { activeCardId }`, file stem; shared with the chat lane's consumers), **Edit** (hands off to the editor page with the card id), **Delete** (AModal confirmation; also clears `settings/cards.activeCardId` when it pointed at the deleted card). Header row: search, Import (FileDialog `*.png|*.json` → GUI import dir, profile dir with `--profile` / platform dir otherwise), New card (opens editor empty), Refresh. Empty state shows an explanatory text.

**Card editor** — `qml/pages/cards/CardEditorPage.qml` (Settings → Cards → edit, nav index 12; not in nav, reached via the library's Edit/New actions).
Working form for the CCv2/CCv3 + AIRI card envelope: name, creator, version, description, personality, scenario, first_mes, alternate greetings (one per line), mes_example, system_prompt, post_history_instructions, tags (comma separated), creator notes. Saves via a new `CardController` bridge (`crates/airi-qt/src/bridges/cards.rs`):
- `loadCard(id)` → typed JSON view of the card (preserves the on-disk file's spec and unknown keys).
- `saveCard(fieldsJson)` → for `.png` cards rewrites only the embedded `tEXt` payload chunk (`chara`/`ccv3` keyword, drops any existing payload chunk of either keyword) leaving IHDR/IDAT/everything else **byte-identical**; for `.json` cards re-serializes pretty JSON. Writes are **atomic** (temp file + rename). New cards save as `<slug>.json` in the GUI import dir.
- Unknown keys and the whole AIRI extension object (`extensions.airi.*`) survive a round trip because the merge is field-level on the typed struct, not a JSON overwrite of the whole document.
- Editor sections and field hints are localized (`shell.cards.*`, 10 locales).

**PNG save machinery** — `crates/airi-core/src/cards.rs` (`write_card_png`, `save_card_file`, `card_to_json_bytes`, own table-driven CRC-32):
Parses the chunk walk manually (no `png` re-encode), validates every chunk's CRC-32, then drops the `chara`/`ccv3` `tEXt`/`iTXt`/`zTXt` chunk(s) and prepends a fresh `tEXt` chunk **before the first IDAT** (the `png` crate's `read_info` only parses text metadata preceding image data — inserting after IDAT names the chunk invisible to the existing P1 extractor *and* to SillyTavern). The new keyword is `ccv3` for v3 cards, `chara` for v2.

**Models/explore** — `qml/pages/models/ExploreModelsPage.qml`, wired into Settings → Explore (nav index 13).
Port of `packages/stage-pages/src/pages/settings/models/explore.vue`: hero header + format filter (`All Formats`/`VRM`/`Live2D`/`Spine`/`MMD`, AToggleGroup with ButtonGroup attached-property exclusivity), the 44 spotlight models (preview images loaded from their remote URLs, async, `Image.PreserveAspectCrop`), 51 marketplaces split into Free Community Archives vs Creator Marketplaces (badge pricing/format/origin/languages) — all cards open externally via `Qt.openUrlExternally`. Data ported **verbatim** into `qml/pages/models/exploreData.js` (`MODEL_MARKETPLACES` / `SPOTLIGHT_MODELS` from `packages/stage-ui/src/constants/marketplaces.ts`, MIT), embedded into qrc via a new `CxxQtBuilder::qrc_resources(["qml/pages/models/exploreData.js"])` entry.

**Chat lane integration** — no code changes needed: the new cards share `<profile>/cards/` and `scan_cards()` with the chat `CardPicker`, so imported cards are immediately available as personas.

## Deferred (explicit)

- `models/emotions` — the Vue Emotion Calibration Studio (a ~2.5k-line component tied to the Vue display-models store and per-engine expression capabilties); the Qt app has no expression-calibration infrastructure. Stayed unticked in `features.md`.
- `guided` / `foundry` / `import-hub` wizards + `CardDetailDialog` / `CardImportWizard` / AI field generation / artistry / acting tabs / stickers / Proactivity tab (the `airi-card/*` Vue suite, ~40k lines) — LLM-driven flows that require the full wizard orchestration; out of scope for this wave.
- `DiscoverCarousel` (3D coverflow) — replaced by a horizontal list in Qt.
- `CardEditorForm`'s per-field AI rewrite, voice creator, AutoVoiceConfigModal.
- `Character book` / `lorebook` editing UI (schema support exists; no page exposes it).
- Deep equality of the full AIRI extension in the editor (all extension fields preserved verbatim on save, not all editable).
- Cross-window navigation from the chat card picker into the library.

## Verification

- `cargo build -p airi-qt` — clean.
- `cargo clippy --workspace --all-targets -- -D warnings` — clean.
- `cargo fmt --all --check` — clean.
- `cargo test --workspace` — 23 suites green, 0 failures (incl. 6 new `png_write_tests`: CRC vector, payload swap on rewrite, stale keyword replacement, IDAT byte-preservation, JSON/PNG file round trips, malformed PNG rejection; `airi-core` cards suite at 23/23).
- `QT_QPA_PLATFORM=offscreen cargo run -p airi-qt -- --smoke` — exit 0, `pages visited: splash, control-strip, chat, settings, about, stage` (settings window now instantiates both new pages; offscreen QPA can't rasterize, visual quality unverified here — desk check required).
- i18n parity — `npx vitest run src/locales.test.ts` (packages/i18n) — 4/4 green (10 locales, all new `shell.cards.*`/`shell.models.explore.*` keys registered in every locale).
- The new Settings nav rows and both pages load over qrc without error strings; the latent Wave A `AToggleGroup` bug (`group:` instead of `ButtonGroup.group:` and an undeclared `group` on `AButton`) was found and fixed in this wave; `AButton` was otherwise unchanged.
- Manifest ticks: `features.md` `/settings/airi-card`, `/settings/airi-card/edit`, `/settings/models/explore` → `[x]` (components of the suites stay unticked).

## Deviations & fixes outside the lanes

- **`pnpm-workspace.yaml`** — added `!apps/airi-qt/target/**` so the Rust `target/` tree (whisper-rs-sys' JS bindings package `whisper.cpp` ×2) stops colliding inside pnpm's package scan (broke `pnpm`/`npx vitest` repo-wide). **`package.json`** — same exclusion on the npm `workspaces` list (npm's `@npmcli/map-workspaces` failed on the same leak).
- PNG payload insertion point: **before IDAT** (not before IEND) — see above.
- New JNI-free `qrc_resources` entry in `crates/airi-qt/build.rs` for `exploreData.js`; `.js` cannot ride the `qml_files` list.
- `cards.rs` bridge registered in `build.rs` `files:` list (its absence was why `CardController` didn't resolve at first).
- `settings/cards` section (`CardsSettings`) added to `airi-core` (camelCase `activeCardId`).
- `chat.rs` card helpers flipped to `pub(crate)` for reuse; `CardEntryData` fields became `pub(crate)`.
- `AToggleGroup` latent bug fixed (unblocked format-filter chips).
- `.qrc` fetch of remote preview images may be slow/blocked offline; cache is enabled.

## Honest limits

- No visual/GUI verification of the three pages was possible offscreen; binding and module-load correctness is established (smoke + targeted error-chain walking), rendering is not.
- PNG card imports with `zTXt` compressed payloads are supported by the extractor but only `tEXt`/`iTXt` are *written*.
- `write_card_png` refuses malformed PNGs with a clear error; cards with intentionally non-standard chunk CRCs can't round trip.
- Active card is consumed by the chat picker on the next chat only; no mid-conversation swap.
- Spotlight/marketplace lists are a static snapshot of upstream curation; suggest-a-site flows to GitHub issues.
