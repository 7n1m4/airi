# P6a — Settings nav integration + System pages

## Nav (qml/shell/SettingsWindow.qml)
Additive only; existing Providers/Theme/About/Stage untouched.
- 0 Providers (🔌), 1 Theme (🎨), 2 About (ℹ️), 3 Stage (🎭) — unchanged
- 4 Spine 🌀 → pages/settings/spine/SpineSettingsPage.qml
- 5 MMD 🔩 → pages/settings/mmd/MmdSettingsPage.qml
- 6 Live2D 🖌️ → pages/settings/live2d/Live2dSettingsPage.qml
- 7 General 🧩 → pages/settings/system/GeneralSettingsPage.qml
- 8 Chat 🖊️ → pages/settings/system/ChatSettingsPage.qml
- 9 Voice 🔊 → pages/settings/system/AudioDeviceSettingsPage.qml
- 10 Profile 👤 → pages/settings/system/UserProfileSettingsPage.qml

## New bridges (additive)
- `bridges/settings_general.rs` — `GeneralSettingsController` (qml_element, namespace airi_qt).
  QML API: props `language` (string), `disableTransitions`, `usePageSpecificTransitions`,
  `remoteSyncEnabled`, `websocketSecureEnabled` (bool); invokables `load()`,
  `save(language, disableTransitions, usePageSpecificTransitions, remoteSyncEnabled, websocketSecureEnabled) -> bool`,
  `reloadFromStore()`. Mirrors `airi_core::settings::GeneralSettings` (settings/general).
- `bridges/settings_chat.rs` — `ChatSettingsController`.
  QML API: props `sendMode` (string wire: enter|ctrl-enter|double-enter),
  `suggestMode` (string wire: enter|ctrl-enter|double-enter|disabled),
  `streamIdleTimeoutMs` (f64; u64 ms clamped ≥ 0, rounded), `showDirectorNotes`,
  `combineSystemMessages` (bool); invokables `load()`,
  `save(sendMode, suggestMode, streamIdleTimeoutMs, showDirectorNotes, combineSystemMessages) -> bool` (rejects unknown wire strings),
  `reloadFromStore()`. Mirrors `ChatSettings` (settings/chat).
- Both `pub mod` in bridges/mod.rs and listed in build.rs `files`.

## New QML pages (qml/pages/settings/system/, registered in build.rs)
- GeneralSettingsPage.qml — GeneralSettingsController; language ATextField, transition switches, privacy/network switches; immediate apply on toggle; load() on Component.onCompleted.
- ChatSettingsPage.qml — ChatSettingsController; send/suggest ASelect, streamIdleTimeout AInputNumber (0–3600000, step 10000), director-notes/combine-system switches; immediate apply; load() on completed.
- AudioDeviceSettingsPage.qml — existing AudioDeviceSettingsController; input-enabled switch, input/output device id ATextFields with placeholders (paste pactl keys) + hint that enumeration is unavailable; Save button.
- UserProfileSettingsPage.qml — existing UserProfileSettingsController; name field, description/prompt ATextArea, voiceProfileId field; Save button.

## i18n
Added `settings.nav.{spine,mmd,live2d,general,chat,voice,profile}` and sections
`general.*`, `chat-settings.*`, `audio.*`, `profile.*` to all 10 shell.yaml locales
(en, es, fr, id, ja, ko, ru, vi, zh-Hans, zh-Hant). ja/ko values containing `: ` were quoted.
`npx vitest run` in packages/i18n: 3/3 pass (leaf parity kept).

## Verification
- `cargo build -p airi-qt` green.
- `cargo clippy --workspace --all-targets -- -D warnings` green.
- `cargo fmt --all` applied.
- `QT_QPA_PLATFORM=offscreen cargo run -p airi-qt -- --smoke` exit 0.
  NOTE: SettingsWindow failed to instantiate — p6b-owned SpineSettingsPage.qml:291:43
  "Invalid property assignment: int expected" ("Type SpineSettingsPage unavailable").
  Reported to p6b-render-pages; not fixed here (their file).

## Deviations
- Device enumeration intentionally not faked: audio page uses text-field device ids.
- streamIdleTimeoutMs exposed as f64 (cxx-qt SpinBox `value` is double); clamped/rounded to u64 on save.
- New bridges live in their own files rather than settings_sections.rs (additive, no restructuring of the p6-sections lane file).
