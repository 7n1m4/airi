# P6 — Render pages (Spine / MMD / Live2D)

## Pages (qml/pages/settings/, registered in build.rs after StageSettingsPage)
- `spine/SpineSettingsPage.qml` — `SpineSettingsController` (`airi_qt`).
  Card "Renderer": maxFps ASelect (0 = unlimited + 30/60/120; off-list persisted
  values are appended into the model so the control never misrepresents storage),
  renderScale ASlider 0.5–2.0 step 0.25, mixDuration ASlider 0.1–0.6 step 0.05,
  animationSpeed ASlider 0.2–2.0 step 0.1, idleAnimationEnabled ASwitch.
  Card "Model placement": scalePos x/y as AInputNumber (-2000..2000, step 1) and
  scale as AInputNumber (0.1..4.0, step 0.05, decimals 2).
  All controls apply immediately (slider `onMoved`, select `onActivated`, switch
  `onToggled`, spin `onValueModified`) via `SpineSettingsController.save(...)`;
  error text shown on failure. `load()` on `Component.onCompleted`.
- `mmd/MmdSettingsPage.qml` — `MmdSettingsController`. Idle ASwitch, renderScale
  ASlider 0.5–2.0 step 0.25 + accent ABadge, hint text "physics is disabled until
  P10" (i18n `shell.settings.mmd.physicsNote`). Immediate save; `load()` on completed.
- `live2d/Live2dSettingsPage.qml` — `Live2dSettingsController`. Deferred-renderer
  warning banner (ACard with `borderColor: Theme.warning`, ⚠ glyph, i18n
  `shell.settings.live2d.deferredNotice`). One ACard per behavior: disableFocus,
  idleAnimation, autoBlink, forceAutoBlink, shadow switches; followSpeed ASlider
  0.0–1.0 step 0.05 + badge; maxFps ASelect (0 = unlimited + 30/60/120, off-list
  values appended) with `maxFpsHint`. Controls stay editable — the Live2D section
  persists independently of the deferred renderer. Immediate save; `load()` on completed.

No raw Controls beyond the shared A* components; no hex literals (warning
amber via `Theme.warning`); all labels via `I18n.tr("shell.settings.*")`.

## Shared component change (deviation, additive)
`qml/components/AInputNumber.qml` — now wraps `DoubleSpinBox` (Qt 6.11+) instead
of `SpinBox`. Rationale: in the installed Qt 6.12 QML, `SpinBox` is int-only
(`stepSize: 0.05` → "Invalid property assignment: int expected", which made the
whole SettingsWindow fail to instantiate); fractional spin values require
`DoubleSpinBox`. `decimals` defaults to 0, so the existing integer use
(ChatSettingsPage) renders identically. The component's Controls import is now
unversioned — `DoubleSpinBox` is only exported as version 6.11 and is invisible
under `import QtQuick.Controls 2.15`.

## i18n
Added `settings.spine.*` (13 leaves), `settings.mmd.*` (6), `settings.live2d.*`
(12) under the existing `settings:` block in all 10 `shell.yaml` locales —
inserted between `theme-page:` and `providers:`. Leaf parity: 203 leaves in all
10 locales (unchanged for pre-existing keys; +31 each). `npx vitest run
src/locales.test.ts`: 3/3 pass. Did not touch `settings.nav.*` (p6a-owned).

## Files touched
- NEW `qml/pages/settings/spine/SpineSettingsPage.qml`
- NEW `qml/pages/settings/mmd/MmdSettingsPage.qml`
- NEW `qml/pages/settings/live2d/Live2dSettingsPage.qml`
- `qml/components/AInputNumber.qml` (SpinBox → DoubleSpinBox, decimals default 0)
- `crates/airi-qt/build.rs` (3 additive `qml_file` registrations)
- `packages/i18n/src/locales/{en,es,fr,id,ja,ko,ru,vi,zh-Hans,zh-Hant}/shell.yaml`

## Verification
- `cargo build -p airi-qt` — green.
- `cargo fmt --check` (apps/airi-qt workspace) — clean.
- `QT_QPA_PLATFORM=offscreen cargo run -p airi-qt -- --smoke` — exit 0;
  `smoke: visited settings` with SettingsWindow instantiating all three new
  pages (StackLayout eager creation — a broken page would fail the window).
  No QML warnings referencing the new pages.
- `npx vitest run src/locales.test.ts` (packages/i18n) — 3/3 green.
- Leaf-key parity across 10 locales — 203/203.

## Deviations
- Controller signature mismatches: none. Pages adapt to the bridges as specified.
  Note: `SpineSettingsController::save` takes positional `max_fps, render_scale,
  mix_duration, animation_speed, idle_animation_enabled, scale_pos_x,
  scale_pos_y, scale_pos_scale`; scalePos x/y are f64 in the section but are
  edited as integers via AInputNumber (decimals 0); the persisted scale is f64.
  `onValueModified` (Qt 6 DoubleSpinBox) is used instead of `onValueChanged` so
  programmatic rebinds don't trigger saves.
- maxFps select shows a bare number (0/30/60/120) with a separate
  "0 = unlimited" hint line rather than per-item labels, to keep the model
  numeric and reusable for both pages.
- SettingsWindow.qml and nav deliberately untouched (p6a-nav-system-pages).
