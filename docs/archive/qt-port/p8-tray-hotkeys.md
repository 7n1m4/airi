<!-- SPDX-License-Identifier: GPL-3.0-or-later -->
# P8 lane ① — Tray, global hotkeys, autostart, notifications

Bridge: `crates/airi-qt/src/bridges/desktop.rs` (`DesktopController`). Tray menu
items and the mic-toggle hotkey fire on worker threads (ksni D-Bus thread /
global-hotkey X11 backend thread), so they publish into module statics
(`DESKTOP_ACTIONS: Mutex<VecDeque<&'static str>>`, `MIC_TOGGLE: AtomicBool`).
QML drains them from a 33 ms `Timer` in `MainShell.qml` (same pump pattern as
the providers bridge) and dispatches to the same handlers the Control Strip
uses (`WindowManager` singleton / `toggleStageStrip()`). The six invokables
(`toggleChat()`, `toggleStage()`, `resetPositions()`, `openSettings()`,
`openAbout()`, `quit()`) enqueue the same action codes.

## Tray (`tray-item` + ksni)

- Menu order/labels mirror the Electron tray minus not-yet-ported entries:
  Toggle Chat, Toggle Stage, Reset Positions, separator, Settings, About,
  separator, Quit. The Control Strip / Companion Wizard / AnimaDex Wizard /
  Toggle Developer Tools items have no Qt counterpart yet and are omitted.
- Icon: `apps/airi-qt/assets/icon.png` (copied from
  `apps/stage-tamagotchi/resources/icon.png`), decoded to 32x32 ARGB32
  (network byte order) via the `image` crate, embedded with `include_bytes!`.
- Degraded modes: skipped entirely under `--smoke`; on session buses without
  `org.kde.StatusNotifierWatcher` / `org.freedesktop.StatusNotifierWatcher`
  (checked via a synchronous `dbus` NameHasOwner call) no tray is created and
  the app continues. Tray failure never aborts startup.
- Verified on Hyprland (via VibePanel watcher): item registers as
  `org.kde.StatusNotifierItem-<pid>-1`; `com.canonical.dbusmenu` GetLayout
  returns exactly the 8 items above.

## Global hotkeys (`global-hotkey`)

- Mic toggle registered as **ScrollLock** (Electron: `services/shortcuts/
  mic-toggle.ts`, `configs/global.ts` default `microphoneToggleHotkey:
  'Scroll'` → globalShortcut `ScrollLock`). Lock-key polling variants are
  Windows/macOS-only and intentionally not ported.
- Delivery is best-effort on Wayland: grabs apply to XWayland clients only
  (same limitation as Electron `globalShortcut` on Linux).
- QML pump (`MainShell.qml`) consumes the flag via `consumeMicToggle()` and
  toggles `settings/audio-device.inputEnabled` through
  `AudioDeviceSettingsController.save(...)` (re-read via `reloadFromStore()`
  first so toggles from other windows count) plus a console log.
  Integration with actual mic capture is out of scope.

## Autostart (`auto-launch`)

- OS-level entry, mirroring Electron's login-item behavior:
  - Linux: XDG autostart (.desktop in `~/.config/autostart`)
  - macOS: LaunchAgent in `~/Library/LaunchAgents`
  - Windows: registry Run key, current user
- Bridge invokable `DesktopController.setAutostart(bool) -> bool` /
  `autostartEnabled() -> bool`. Refuses to act under `--smoke`.
- QML: `Enable autostart on login` toggle in `GeneralSettingsPage.qml`
  (Startup card). The switch reflects OS state (`autostartEnabled()`);
  toggling applies the OS entry first, then persists.
- **`GeneralSettings` gained one additive field**: `autostart: bool` with
  `#[serde(default)]` (camelCase key `autostart` in `settings/general`). Not
  a new settings section, not a new capability export. It persists the
  last-applied preference; the OS entry itself is the source of truth for
  display. Pre-existing stores load it as `false` via serde default.
- Tray menu intentionally has NO autostart item (Electron parity).

## Notifications (`notify-rust`)

- `DesktopController.notify(title, body) -> bool`. Never fires under `--smoke`
  (also returns `false` when the daemon is unreachable).
- One wired usage: when a chat reply transitions streaming/waiting-on-tool →
  idle while the chat window is hidden, `"AIRI" / "AIRI replied"` is shown.
  Fed from a `ChatController` status watcher in `MainShell.qml` (pumps the
  same 33 ms timer; chat window visibility via `WindowManager.chatWindow`;
  guarded by `shell.isSmoke()`).

## Verification

- `cargo check`, `cargo build`, `cargo fmt --all -- --check` clean.
- `cargo test -p airi-qt --bin airi-qt` and `-p airi-core --lib settings`
  pass.
- `--smoke` exits 0 (tray/hotkeys skipped; chat done, 30 stage ticks).
- Tray registered live on this session; GetLayout matches the menu above.
  `dbus-send … Event int32:2 clicked` returned method-return and drove
  `toggleStageStrip()` end-to-end from D-Bus → ksni → publish → QML pump
  (log line `shell: WindowManager.stageWindow not available yet (pre-merge)`
  from the hide branch with a null stage window). Note: the running app
  under test predated the final root-scope Timer check and the `WindowManager.openStage`
  typeof guard was observed to take the persisted-visible-false path; the
  Chat-window appearance was NOT observed live (first D-Bus click used a
  malformed variant; only the stage path was observed via logs).
- Notification path not exercised live (needs a completed reply with a hidden
  chat window); guarded against `--smoke`.
