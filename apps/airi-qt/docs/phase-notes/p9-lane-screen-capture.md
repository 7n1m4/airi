<!-- SPDX-License-Identifier: GPL-3.0-or-later -->
# P9 Lane H2 — Screen Capture (Qt), first slice of vision

Grab the primary screen to a PNG under the captures directory, list saved captures with thumbnails, open them in the system viewer, and clear them behind a destructive confirm. The capture path is real end-to-end (QML button → `CaptureController` bridge → C++ `QScreen::grabWindow(0)` → PNG on disk); there is no screenshot stub anywhere on this path.

**Ownership (this lane):** `crates/airi-qt/src/cpp/capture_item.{h,cpp}` (new), `crates/airi-qt/src/bridges/capture.rs` (new), `qml/pages/devtools/screen-capture/ScreenCapturePage.qml` (new), this note. **Nothing else was touched** — no `build.rs`, no `bridges/mod.rs`, no `SettingsWindow.qml`, no components, no locale files, no git writes, no workspace gates run against the repo.

## What landed

| File | Role |
|---|---|
| `crates/airi-qt/src/cpp/capture_item.h` | Declaration of the single bound function; documents the error channel. |
| `crates/airi-qt/src/cpp/capture_item.cpp` | Implementation: `mkpath` outDir → `primaryScreen()->grabWindow(0)` → `QImage` → `capture-<millis>.png`. |
| `crates/airi-qt/src/bridges/capture.rs` | `CaptureController` qobject (cxx-qt bridge), `capturesJson` / `lastError` / `working`, invokables `captureNow` / `refreshCaptures` / `clearCaptures`. |
| `qml/pages/devtools/screen-capture/ScreenCapturePage.qml` | Devtools page: header, Capture Screen button (wired), thumbnail grid (click = system viewer), Clear All with `AModal` confirm + count, last-error banner, empty state. |

## The C++↔Rust boundary (exact signature)

One function is bound, nothing more:

```cpp
// crates/airi-qt/src/cpp/capture_item.h
QString airi_capture_primary_screen(const QString &outDir);
```

```rust
// crates/airi-qt/src/bridges/capture.rs, inside #[cxx_qt::bridge] pub mod qobject
unsafe extern "C++" {
    include!("cxx-qt-lib/qstring.h");
    type QString = cxx_qt_lib::QString;
}

unsafe extern "C++" {
    include!("airi-qt/src/cpp/capture_item.h");
    fn airi_capture_primary_screen(out_dir: &QString) -> QString;
}
```

Notes on the boundary shape (mirrors the mcp.rs / stage.rs conventions):

- `include!` uses the crate's own include prefix (`airi-qt/<path-from-crate-root>`), resolved against the `header_root` include path `cxx-qt-build` sets up (the crate root is copied there as `<crate-name>/`). Same convention as `include!("cxx-qt-lib/qstring.h")` resolving against `header_root/cxx-qt-lib/`.
- Types cross as `QString` in both directions (cxx-qt-lib `QString` maps to the plain Qt class). No `rust::String`, no `rust::Str` — the shim stays pure-Qt (`QString`/`QDir`/`QImage`), exactly the airi_qt_bridge.cpp style.
- The generated FFI shim is emitted `pub` inside the bridge module (`cxx-qt-build`'s `visibility_pub` maps any visibility to `pub`), so `qobject::airi_capture_primary_screen(...)` is callable from the `impl qobject::CaptureController` block — same pattern as `qobject::McpController::servers_changed(...)`.
- The header has no `Q_OBJECT`/`QML_ELEMENT` and the .cpp compiles with plain QtGui/Core — **no Qt Quick3D involvement** (rule followed). `moc` is not needed for the shim itself.
- `build.rs` gains nothing from this lane; it is the main agent's job to add `src/bridges/capture.rs` to `files` and `src/cpp/capture_item.{cpp,h}` to `cpp_files` (see Integration lists below). Until then the bridge is not part of the build and `cargo check -p airi-qt` in the repo does not see it (baseline check was run: clean, 28.89s).

## Capture flow

1. Page: `Component.onCompleted` → `controller.refreshCaptures()`; re-parses `capturesJson` on every `capturesChanged` signal.
2. **Capture Screen** button → `controller.captureNow()`:
   - smoke mode (`bridges::smoke()`) → returns `""` and sets `lastError` ("screen capture is suppressed in smoke mode"). Same idiom as the desktop bridge's notification suppression: a headless smoke run never grabs the real screen.
   - resolves the captures dir (see below); fails → `lastError` + `""`.
   - sets `working = true`, calls the C++ shim synchronously (GUI thread, like every QML-triggered bridge call), sets `working = false`.
   - C++: `QDir().mkpath(outDir)` → `QGuiApplication::primaryScreen()` (null → error+empty) → `screen->grabWindow(0)` (null pixmap → error+empty) → save as `capture-<currentMSecsSinceEpoch>.png` → returns absolute path.
   - on success the bridge re-scans and emits `capturesChanged`; the PNG appears in the grid.
3. **Grid**: `Repeater` of `CaptureTile` cells (thumbnail `Image` with `asynchronous: true`, file name, mtime+size). Click → `Qt.openUrlExternally("file://" + path.replace(/ /g, "%20"))` (same encoding idiom as the card library page). There is deliberately **no bridge call for open** — the mission left that choice open and QML's `Qt.openUrlExternally` is enough; `QDesktopServices::openUrl` would be a second dependency for the same thing.
4. **Clear All Captures** (Danger) → `AModal` confirm showing the count (`%1` placeholder replaced with `page.captures.length`) → `controller.clearCaptures()`.

## Captures directory

`<profile>/captures/` when `--profile` is set, else `<platform-data>/airi-qt/captures/` (`dirs::data_dir()`), mirroring the MCP config convention (`<profile>/airi/mcp.json`). The directory is created on demand by the shim (`mkpath`); a missing directory reads as an empty list, not an error. Only direct regular files whose names match the strict pattern `capture-<digits>.png` (all-ASCII digits between the fixed stem and suffix) are listed or deleted; symlinks are never followed or removed; nothing else in the directory is touched.

## Error semantics (single channel)

- C++ shim → Rust: **empty `QString` = failure**. The specific reason is printed to stderr with the `[airi-qt][capture]` prefix (same style as `airi_qt_bridge.cpp`'s message handler). The bridge maps the empty return to `lastError = "screen capture failed — see the log for the reason (Wayland compositors may deny the grab)"`.
- Rust → QML: `lastError` (string, empty = ok) surfaced as an error-colored `ACard` banner with a title and the raw message; `captureNow()` returns the absolute path (success) or `""` (failure).
- `clearCaptures()` deletes what it can and reports the number deleted; a first failure is collected into `lastError` after the refresh (deletion is best-effort per file, never aborts midway silently).
- `createdMs` is the file **mtime** in ms since the epoch (creation time is not portable across filesystems); collisions of two captures in the same millisecond would overwrite — accepted, not handled (see Limits).

## i18n keys — namespace `shell.capture.*` (English source strings)

**Locale files were not edited in this lane.** Keys for the main agent to add (top-level `capture:` section in `packages/i18n/src/locales/*/shell.yaml`, flattened to `shell.capture.*`):

```yaml
capture:
  title: Screen Capture
  badge: Primary screen
  description: Grab the primary screen to a PNG, saved under the app's captures folder. Saved captures are listed below — click one to open it in the system image viewer.
  errorTitle: Couldn't complete the capture action
  captureButton: Capture Screen
  refresh: Refresh
  clearAll: Clear All Captures
  openHint: Click a thumbnail to open it in the system image viewer.
  capturesSection: Saved Captures
  emptyTitle: No captures yet
  emptySubtitle: Press Capture Screen to grab the primary screen. Captures land in the captures folder and are listed here.
  clearConfirmTitle: Clear All Captures
  clearConfirmBody: Permanently delete %1 capture file(s) from the captures folder. Only files matching capture-*.png are deleted — nothing else is touched. This cannot be undone.
  clearConfirmCancel: Cancel
  clearConfirmConfirm: Delete
```

`clearConfirmBody` takes a `%1` placeholder — the page does `.replace("%1", page.captures.length)` (I18n.tr has no argument support; Qt's own `tr` convention). Translators must keep `%1`.

> Plus **one nav key outside the namespace** (mirrors `shell.settings.nav.pluginHost`): `shell.settings.nav.screenCapture` = `Screen Capture`. Nothing else in the page composes raw English.

## Limits (explicit)

- **Single primary screen only** (`QGuiApplication::primaryScreen()`), whole-screen grab via `grabWindow(0)`. No multi-monitor selection, no monitor picking, no per-window capture (`grabWindow(WId)`) — a window-specific mode would need a picker UI; not in this slice.
- **Wayland**: verified empirically on this machine (native wayland session) — the compositor denies `QScreen::grabWindow(0)`, Qt returns a **null pixmap**, the shim logs `[airi-qt][capture] grabWindow(0) returned a null pixmap — unsupported platform or the compositor denied the grab (common on Wayland)` and returns `""`; the page shows the `lastError` banner and **no file is written** (out dir is created, directory stays empty). X11 works (see Verification). Qt on Xwayland behaves like X11. If a Wayland-native path is wanted later, it needs `xdg-desktop-portal` ScreenCast or a compositor-specific protocol — a separate ticket, not a fix here.
- **No clipboard, no OCR, no image copy yet** — this lane is save-to-disk + list + open only.
- **Destructive `clearCaptures()`**: deletes files matching exactly `capture-<digits>.png` in the captures dir (regular files only, symlinks never followed). It cannot delete other files, but it is still irreversible — hence the `AModal` confirm with the live count. Deletion is best-effort; failures are reported in `lastError` after the list refreshes. Nothing else on disk is ever removed.
- **Filename collision**: two captures within the same millisecond overwrite. Extremely unlikely from a human clicking; not guarded.
- **`createdMs` = mtime**; copying a capture into the folder manually (with a matching `capture-<digits>.png` name) makes it appear in the list — that is by design (the list is a directory scan, not a registry).
- **Open uses the system handler** (`Qt.openUrlExternally("file://…")` with space→`%20`); the app does not bundle or require an image viewer.
- **Smoke mode**: `captureNow()` is suppressed under `--smoke` (returns `""` + `lastError`); the smoke tour never grabs the screen.
- **Thumbnails are loaded by path** — moving/renaming files behind the app's back shows the error glyph (🖼) via `Image.status === Image.Error`.
- **Qt Quick6/2.15 idioms**: `import QtQuick 2.15` + `QtQuick.Layouts 1.15` like the sibling pages; Controls are not imported directly (no QtQuick.Controls usage); page is a `Flickable` + `ColumnLayout` with an inline `CaptureTile` component and `Flow`+`Repeater` grid.
- **Missing Theme tokens**: no `Theme.fontMono`, so paths/metadata use `Theme.fontBody` (Lane B/MCP precedent); no icon set dependency beyond emoji glyphs already used by sibling pages.

## Verification

Repo untouched by the integration steps (all integration done in a `/tmp` copy):

- `qmllint -I <module-sandbox> com/airi/airiqt/qml/pages/devtools/screen-capture/ScreenCapturePage.qml` — **0 errors; 4 warnings, all `Unqualified access [unqualified]`** (the `page.*` reference inside inline components — the same idiom the sibling pages emit; accepted per lane rules). Sandbox at `/tmp/opencode/qmllint-capture/com/airi/airiqt` (copy of `qml/` + generated `qmldir` + a `plugin.qmltypes` extended with the exact `CaptureController` declaration; deleted-or-left under `/tmp`, not committed).
- `cargo check -p airi-qt` in the repo — **clean** (28.89s); as expected, `capture.rs` is not in the module tree yet.
- **In a scratch copy** (`/tmp/opencode/airi-qt-real`, `tar` of `apps/airi-qt`) the lane's integration was applied *exactly* as below (build.rs `files`/`cpp_files`/`qml_file`, `pub mod capture` in `bridges/mod.rs`, nav + page in `SettingsWindow.qml` — copy only): `cargo check -p airi-qt` clean; **full `cargo build -p airi-qt` linked** (the cxx↔C++ symbol `airi_capture_primary_screen` resolves); `cxx-qt`'s own tooling emitted the generated `qmldir` (`ScreenCapturePage 1.0`) and `plugin.qmltypes` (`airi_qt::CaptureController` with `capturesJson`/`lastError`/`working` and `captureNow`/`refreshCaptures`/`clearCaptures`) — my hand-written sandbox declarations matched the real ones.
- Smoke (scratch copy, `QT_QPA_PLATFORM=offscreen --smoke`, throwaway `/tmp` profile): splash → control-strip → chat → **settings** → about → stage, chat outcome `done (2 deltas applied)`, stage ticks 30, exit 0. My page was instantiated in the settings StackLayout and its `Component.onCompleted` → `refreshCaptures()` ran without QML errors (the app handler prints all Qt/QML errors with the `[airi-qt][Qt]` prefix; none appeared for the page or the controller).
- Capture path, exercised via a scratch C++ harness linked against the same shim (not the app): `QT_QPA_PLATFORM=offscreen` → valid 800×800 PNG; `Xvfb :99` (X11-only, synthetic screen — the user's real screen was not captured) → valid 1280×720 PNG (`file` confirms); native `wayland` → `grabWindow(0)` returned null pixmap, no PNG written, error logged (see Limits). Harness at `/tmp/opencode/capture-harness/` (scratch, disposable).
- `rustfmt --check` on `capture.rs`: parses clean (the module is not reachable from the crate until the main agent's `mod.rs` edit, so it is not otherwise compiled by the repo build).
- i18n keys report only — locale files untouched, keys unverified against crowdin (expected: additive).

## Integration lists (for the main agent — do NOT apply in this lane)

### 1. `crates/airi-qt/build.rs` (repo)

```rust
// in `files` (after data.rs is fine):
manifest_dir.join("src/bridges/capture.rs"),
// in `cpp_files`:
manifest_dir.join("src/cpp/capture_item.cpp"),
manifest_dir.join("src/cpp/capture_item.h"),
```

and register the page (after the plugin-host line):

```rust
module = module.qml_file("qml/pages/devtools/screen-capture/ScreenCapturePage.qml");
```

`emit_rerun_if_changed` already walks `qml/`; Qt modules already include `Gui` (needed by the shim) — no `.qt_module(...)` changes.

### 2. `crates/airi-qt/src/bridges/mod.rs` (repo)

```rust
pub mod capture;
```

### 3. `qml/shell/SettingsWindow.qml` (repo) — append at the end of the nav (index 25, everything else keeps its index) and at the end of the `StackLayout`:

```qml
// Nav (after the Plugin Host row):
AListItem {
    Layout.fillWidth: true
    icon: "📸"
    title: I18n.tr("shell.settings.nav.screenCapture")
    active: settingsWindow.navIndex === 25
    onClicked: settingsWindow.navIndex = 25
}

// StackLayout (after PluginHostPage { }):
// Screen Capture — wired to the CaptureController bridge.
ScreenCapturePage {
}
```

### 4. Locale files — add the `capture:` section above + `shell.settings.nav.screenCapture: Screen Capture` (en source; other locales per normal translation flow).

## Follow-ups / honest gaps

- Verify `captureNow()` against a real interactive session (needs a human click or an automation hook; offscreen/acceptance used the harness instead). The X11 path is validated; the Wayland path is validated to fail cleanly; the in-app success path (button → bridge → grid re-scan) is validated only up to QML instantiation + bridge link/register, not to a produced PNG.
- If the page should be reachable from the smoke tour, teach the tour to navigate to index 25 and call `captureNow()` — **do not** let smoke grab a real screen.
- Wayland-native capture would need `xdg-desktop-portal`/`libportal` (ScreenCast) — separate lane.
- `openCapture` was intentionally left to QML; if a bridge-side opener is ever wanted (e.g. to also reveal the captures dir), it should follow the desktop bridge's pattern, not be bolted onto `CaptureController`.
- Registration in the real repo is pending (by design); until then this lane's code is dead code in the tree and the smoke/capture flows do not include it.
