// SPDX-License-Identifier: GPL-3.0-or-later
# P3 lane ② — Stage settings page + captions overlay + pet geometry persistence

## What shipped

- **Settings page** `qml/pages/settings/stage/StageSettingsPage.qml` (new), nav item "🎭 Stage" (`shell.settings.nav.stage`) at index 3 in the Settings window (after Providers / Theme / About), `StackLayout` index 3. Chrome untouched. The page has:
  - **Stage window** card: show/hide toggle (`stage-window.visible`), "Reset position" button (clears persisted `x`/`y` → compositor re-places on next open), inline success notice.
  - **Model** card: `AEmptyState` when no `.vrm` is discovered, `ASelect` of discovered models, current model path (or "no model selected"), manual absolute-path field + Save, and an import row (path field + Import button). Fully functional with an empty model dir.
  - **Captions** card: enable switch, font-size slider (50–200 %), opacity slider (0–100 %), docking combo (top / bottom / head / none — `head` is the spec's alias of `bottom`, real head-tethering would need the stage avatar transform), and an **embedded live preview** (`CaptionOverlay` inside a fixed 220 px stand-in rect) driven by a Preview button with a 4 s auto-clear.
  - **Control strip** card: checkboxes (ASwitch list) for the `stage` and `caption` strip buttons, persisted to `settings/control-strip` → `enabledButtons`.
  - All saves surface through a single localized `saveError` line; nothing is silent.
- **Caption overlay** `qml/CaptionOverlay.qml` (new; `Caption.qml` deliberately left alone): themed (Theme **surface with alpha** via `Qt.rgba(Theme.surface.r, …, 0.78)`), full-width, bottom- or top-docked, `head`→bottom alias, `none`→hidden. Exposed properties: `captionText`, `speaker`, `fontSizeFactor`, `dock` — plus the **inherited `Item.opacity`** (0.0–1.0) as the opacity contract (QQuickItem.opacity is FINAL; redeclaring it fails at load — verified with `qmlscene`: "Cannot override FINAL property"). Auto-hides on empty text (inner wrapper fades to 0 over 200 ms). `fontSizeFactor` multiplies the 18 px base. No literal hex. Purely embeddable; registered as a module file.
- **Bridge** `crates/airi-qt/src/bridges/settings_stage.rs` (new): `StageSettingsController` (`airi_qt::StageSettingsController`), distinct from the stage-window lane's scene controller.
- **Core settings sections** (`airi-core/src/settings.rs`): additive `StageModelSettings` (`settings/stage-model`, `modelId` — absolute path or empty; lane ① uses the same key/semantics), `CaptionsSettings` (`settings/captions`, `enabled` true / `fontSize` 100 / `opacity` 70 / `docking` `none`), `StageWindowSettings` (`settings/stage-window`, `x`/`y` nullable, `width` 450, `height` 600, `visible` true). `ControlStripSettings` gained an additive `enabledButtons: HashMap<String,bool>` (serde default `{stage: true, caption: true}`); only ids `stage`/`caption` are tracked — the 22-button Electron catalog is not ported.
- **Control strip** `MainShell.qml`: stage button now persists/toggles `settings/stage-window.visible` via the bridge and routes to `WindowManager.openStage()` when it exists (it does **not** at time of writing — the toggle flips the persisted bool and logs instead); closing clears `WindowManager.stageWindow.visible` if that handle exists (guarded), else logs. New **CC captions toggle** (after the stage button) wired to `settings/captions.enabled` (active state = enabled; flips via `saveCaptions`). Both buttons respect the persisted `enabledButtons` map (hidden when disabled). Mic/chat/settings/etc. unchanged.
- **i18n**: `shell.settings.nav.stage`, `shell.strip.tooltips.caption`, and a new `shell.stage.*` namespace (description, openStageWindow, windowTitle, resetPosition, boundsResetNotice, modelSection.{title,hint}, modelListEmpty, modelNone, modelPathPlaceholder, importPathPlaceholder, saveModel, importModel, captions.{title,enabled,fontSize,opacity,docking,top,bottom,head,none,preview,previewSample}, stripSection.{title,hint,stage,caption}, saveError) — 31 new leaves per locale, applied to all 10 locales with full key parity (83 → 114 leaves each). `shell.strip.tooltips.stage` text updated (it claimed "lands in a later wave"). `vitest run src/locales.test.ts` ✅ 3/3.
- **CLI**: additive `--import-model <path>` in `airi-qt/main.rs` (copies a `.vrm` into `<profile>/models`, or `<XDG_DATA_HOME|~/.local/share>/airi-qt/models` without `--profile`; no GUI boot). Shares `import_model` with the bridge invokable.

## Contracts introduced

### Settings keys (SQLite `settings` table, camelCase JSON blobs — Electron-style section keys)

| Key | Shape |
| --- | --- |
| `settings/stage-model` | `{ "modelId": string }` — absolute VRM path or `""` (none). Consumed by lane ①. |
| `settings/captions` | `{ "enabled": bool, "fontSize": f64, "opacity": f64, "docking": "top"\|"bottom"\|"head"\|"none" }` — fontSize/opacity are percentages (100 = 100 %); QML divides by 100 for the overlay. Defaults `true/100/70/"none"`. |
| `settings/stage-window` | `{ "x": number\|null, "y": number\|null, "width": f64, "height": f64, "visible": bool }` — defaults `null,null,450,600,true`. Width/height clamp ≥ 200, x/y clamp to ±10 000 on save. |
| `settings/control-strip` | additive `enabledButtons: { "stage": bool, "caption": bool }` (was: no such field; unknown ids ignored). |

### Bridge API — `StageSettingsController` (namespace `airi_qt`)

Properties (camelCase in QML): `modelId: QString`, `captionsEnabled: bool`, `captionsFontSize: f64` (`qreal` in Qt terms), `captionsOpacity: f64`, `captionsDocking: QString`, `stageVisible: bool`.

Invokables: `loadAll()`, `saveModel(QString id) -> bool`, `saveCaptions(bool enabled, double fontSize, double opacity, QString docking) -> bool` (rejects unknown docking; clamps fontSize 10–400 / opacity 0–100), `loadBounds() -> QString` (JSON `{x,y,width,height,visible}`, nulls for unset), `saveBounds(QString json) -> bool` (validates, clamps width/height ≥ 200 ≤ 10000, x/y to ±10000; false on invalid JSON), `resetBounds() -> bool` (clears x/y only), `saveWindowVisible(bool) -> bool`, `listModels() -> QStringList` (filenames, not paths; profile dir first, deduped), `resolveModelPath(QString filename) -> QString` (absolute path or `""`), `importModel(QString srcPath) -> QString` (copies into `<profile>/models`, dedupes name on collision, returns absolute dest or `""`), `stripButtonEnabled(QString id) -> bool` (defaults true), `saveStripButtonEnabled(QString id, bool enabled) -> bool` (`stage`/`caption` only).

Not a bridge: `WindowManager.openStage()` — stage window lane's job, called from QML only (page + strip), never from the bridge.

**Partially verified — final state at report time:**
- `cargo build -p airi-qt` ✅ built green at ~08:49 after the p4-spine drop landed fixed. (The workspace was broken again at ~08:55 by the stage lane's fresh `bridges/stage.rs` `path`-move borrow error — reported to them ~08:50; they fixed it at ~08:56, build green again.)
- `cargo test --workspace` ✅ all green (airi-core 33 incl. new stage sections, airi-i18n 4, airi-llm 11+12, airi-qt 5, airi-render 41).
- `cargo clippy --workspace --all-targets -- -D warnings` ❌ only `airi-render` (8 stage-lane lints). `airi-core`, `airi-i18n`, `airi-store`, `airi-llm` clippy ✅; `cargo clippy -p airi-qt` (warn profile) shows **zero** warnings referencing my files.
- `--smoke` runs the full tour; `settings` is visited with zero QML errors (my Stage page + overlay parse/instantiate cleanly); the gate fails only on the stage lane's `skinAndMorph` tick count while their window is being fixed (unversioned `import QtQuick3D`; `farPlane`→`clipFar`). Final smoke green will come from their lane.
- Visual state of the pet cannot be checked here; leave all visual sign-off to the desk.

**Stage-lane status (their files, after their fixes at ~09:00):** `cargo build -p airi-qt` ✅; `cargo test --workspace` ✅ all green (incl. airi-render 41); clippy `-D warnings` workspace ❌ only `airi-render` (8 lints: `add`/`mul`/`sub` vs `std::ops`, loop-index lint, manual char comparison, dead fields `bone`/`attachment`/`parent`) — stage-lane; fmt diff only `airi-render/build.rs` — stage-lane. Smoke: tour completes (splash, control-strip, chat, settings, about — all visited, **zero QML errors from my settings page or overlay**), but the smoke gate added by the stage lane (`skinAndMorph` ≥ 30 ticks) fails while their `StageWindow.qml`/`StageScene.qml` are being fixed for Qt 6.12 (unversioned `import QtQuick3D`, `farPlane`→`clipFar`); they are iterating and report green/red themselves.
- `cargo fmt` on all touched Rust files ✅ (own files clean).
- `vitest run src/locales.test.ts` ✅ 3/3; 10-locale shell.yaml leaf parity ✅ (all exactly 114 leaves; script checked missing/extra keys).
- `qmllint` on all new/modified QML ✅ only import-resolution noise (module isn't installed as a system plugin; expected) + no syntax errors; one real warning (block-scope `var`) fixed.
- QQuickItem.opacity FINAL shadowing question settled empirically (`qmlscene`: "Cannot override FINAL property") — CaptionOverlay exposes the inherited opacity instead of redeclaring it.


## Deferred / notes for Main

- `WindowManager.openStage()` **did not exist at my completion**. The strip stage button and the page's show/hide toggle persist `settings/stage-window.visible` and log "not available yet (pre-merge)"; once the stage-window lane lands `openStage()` (and ideally a `stageWindow` handle), both call sites light up unchanged. If the lane prefers a different contract (e.g. `toggleStage()` only), the two call sites are the only edits needed.
- Strip toggles do not live-sync with the Settings page's strip checkboxes (separate bridge instances; sync happens on window reopen / app restart). A shared signal or singleton would be the fix; deliberately out of scope.
- Captions `docking: 'head'` is the spec's alias of `bottom`; true head-tethering needs the stage scene's avatar transform and was not attempted.
- `opacity` is persisted as a percentage (70) and consumed as a fraction by dividing by 100; `fontSize` likewise (100 → `fontSizeFactor` 1.0). The overlay itself takes plain 0.0–1.0 opacity.
- `SettingsChanged` events fire on every persist (same bus as the other sections); the stage scene can observe them instead of polling.

## Files touched

`crates/airi-core/src/settings.rs`; `crates/airi-qt/src/bridges/settings_stage.rs` (new), `bridges/mod.rs`, `main.rs`, `build.rs`; `qml/CaptionOverlay.qml` (new), `qml/pages/settings/stage/StageSettingsPage.qml` (new), `qml/shell/SettingsWindow.qml`, `qml/shell/MainShell.qml`; `packages/i18n/src/locales/*/shell.yaml` ×10; `docs/phase-notes/p3-stage-settings.md` (this file).
