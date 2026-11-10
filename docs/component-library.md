# AIRI — Qt QML Component Library (P2 Wave A)

`apps/airi-qt/qml/components/` — thin, themed wrappers around Qt Quick
Controls (Controls-style API) or plain primitives. Registered in the
`com.airi.airiqt` QML module (see `crates/airi-qt/build.rs`); pages import
`com.airi.airiqt 1.0` for everything below.

## Token rules (hard)

- **No hex literals in pages or components.** Every color comes from the
  `Theme` singleton (`qml/Theme.qml`).
- **Radius/spacing/typography only from Theme**: `radiusS/M/L`, `spacingS/M/L`,
  `fontBody`, `fontTitle`. No ad-hoc pixel values.
- `Theme` derives `accent`/`accentHover`/`accentPressed` from the writable
  `hue` + `chromaMultiplier` (OKLCH-inspired, `Qt.hsla`); `dark` switches the
  whole palette between the dark and light sets. `bg`/`surface` stay stable per
  mode (accent-only hue adoption is a deliberate P2 tradeoff). Mutate only via
  `setDark` / `setHue` / `setChromaMultiplier`.
- States used consistently: idle, hover, pressed/down, activeFocus (2px accent
  ring where interactive), disabled (uniform opacity falloff).

## Component inventory

| Component | Base | Notes |
|---|---|---|
| AButton | Controls `Button` | `variant: Default \| Accent \| Ghost \| Danger`; focus ring |
| ATextField | Controls `TextField` | placeholder/selection themed |
| ATextArea | Controls `TextArea` | multiline, same shell as ATextField |
| ASwitch | Controls `Switch` | track+knob, animated |
| ASelect | Controls `ComboBox` | themed popup; `model` = list of strings |
| ASlider | Controls `Slider` | accent progress track |
| ACard | `Rectangle` | default slot for content; implicit size propagates from first sized child |
| AModal | Controls `Popup` | `modal`, `dim`, Escape/outside-click close; header + default slot |
| ATooltip | Controls `ToolTip` | use as child: `ATooltip { text: ...; visible: control.hovered }` |
| AListItem | `Item` + `RowLayout` | `icon`/`title`/`subtitle`/`showChevron`/`active`; `clicked()` |
| AToggleGroup | `Item` + `ButtonGroup` | exclusive row of AButtons; `model` (labels), `currentIndex`, `toggled(int)` |
| AInputNumber | Controls `SpinBox` | themed integer spin box |
| ABadge | `Rectangle` | `variant: default \| accent \| success \| warning \| error \| info` |
| AProgress | Controls `ProgressBar` | value-based; animated fill |
| ASeparator | `Rectangle` | `orientation: horizontal \| vertical` hairline |
| AEmptyState | `Item` + `Column` | centered `icon`/`title`/`subtitle` + optional default action slot |

## Layering
`crates/airi-qt/src/bridges/` (`ShellApp`, `I18nBridge`, `ThemeBridge`,
`Windows`). Shell singletons live in `qml/I18n.qml` / `qml/WindowManager.qml`
(registered with `.singleton(true)`).

## Startup flow

`qml/Main.qml` (invisible bootstrap, 1×1 transparent — it must be visible so
the sibling top-level windows can map on Wayland) → `Splash` (frameless,
stays-on-top, ~1.2s milestones, auto-dismiss) → `MainShell` (Control Strip;
frameless, stays-on-top, 56px, themed) → windows via `WindowManager.open*()`.

## i18n & smoke

- All user-visible strings via `I18n.tr(key)` (`qml/I18n.qml` singleton →
  `I18nBridge` → `airi_i18n`, embedded `shell.*` locale keys in
  `packages/i18n/src/locales/*/shell.yaml`).
- `--smoke` walks splash → strip → chat/settings/about and logs
  `smoke: pages visited: …` (via `Windows.visited`, no-op outside `--smoke`).

## Notes for Wave B (chat + provider pages)

- Reuse ACard/AListItem/AEmptyState/AButton/ATextField as-is.
- The Chat window (`qml/shell/ChatWindow.qml`) is a placeholder shell only —
  replace the `AEmptyState` content; keep the window chrome and
  `airi_i18n` keys.
- The providers page lands inside `qml/shell/SettingsWindow.qml`’s content
  StackLayout (index 0, currently the placeholder).
- Bridge method names are exposed to QML in camelCase via `#[cxx_name = …]`
  (e.g. `shell.isSmoke()`, `themeCtrl.applyHue(v)`, `i18nBridge.persistLocale()`).
  If you add bridge invokables with snake_case Rust names, either add
  `#[cxx_name = "…"]` or call the snake_case name from QML.
- The Qt message handler installed in `apps/airi-qt/src/cpp/airi_qt_bridge.cpp`
  is what makes QML/engine errors visible (stock handler output is discarded
  on some Linux Qt builds).
- `stage-qt` (apps/stage-qt) has the same missing-`cxx_qt::init_qml_module!`
  class of bug — fixes belong there if the module is ever loaded.
