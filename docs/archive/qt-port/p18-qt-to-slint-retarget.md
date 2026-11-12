# Qt → Slint retarget (rename + render seam)

Date: 2026-11-13. Status: **in progress** — the port is ongoing; this records
what landed.

## Decision

The Qt Quick port (`crates/airi-qt`, `qml/`) was renamed to `crates/airi-slint`
and retargeted from Qt6/cxx-qt to Slint 1.18 (`renderer-software` backend).
The user chose in-place mutation over a parallel crate: one crate, renamed,
with the working tree cut over as each slice lands.

## What landed

### Rename (complete)

- `crates/airi-qt/` → `crates/airi-slint/`; workspace member and all path deps.
- `qml/` deleted (74 `.qml` files, ~3.8k lines).
- `crates/airi-slint/src/cpp/` deleted (`spine_item`, `capture_item`,
  `airi_qt_bridge` — the Qt scene-graph items).
- `src/bridges/_qt_src/` holds the **27 Qt bridge sources** as porting
  reference. They are outside the compile path (`bridges/mod.rs` exposes only
  `spine`). Delete once the last bridge is ported.
- Functional identifier renames: `LOCK_FILE_NAME` = `airi-slint.lock`,
  `APP_DIR_NAME` = `airi-slint`, update-check user agent, Silero/Whisper model
  relative paths. Doc comments swept.
- `cxx`, `cxx-qt`, `cxx-qt-lib`, `cxx-qt-build`, `qt-build-utils` dropped;
  `slint` + `slint-build` added to the workspace.
- Packaging: `packaging/airi-slint.desktop`, `build-deb.sh`, the systemd unit,
  and `packaging/README.md` (the runtime-dep table is gone — Slint links no
  toolkit packages).

### Render seam (complete)

`crates/airi-slint/src/spine_render.rs` — CPU rasterizer over
`airi_render::spine::SpineSession::collect_draws()`, displayed via
`slint::Image::from_rgba8`.

**Decision:** Slint 1.x stable exposes no raw per-frame GL callback suitable
for spine-cpp vertex data, so the rasterizer is CPU (textured triangles, alpha
and additive blend). `shortcut: CPU rasterization at 256x256 costs ~10ms/frame;
upgrade to a borrowed-GL-texture path when Slint exposes a stable render-thread
hook.`

`spine_rt.rs` keeps the process-wide session and its Rust API
(`load_bundle_path`, `play_idle`, `play`, `poke`, `set_skin`,
`set_default_mix`, `advance`, `loaded`, `with_session`, `bundle_root`); the
`extern "C"` ABI the C++ `SpineItem` consumed is deleted.

Test: `cargo test -p airi-slint --lib spine_render` loads
`test-models/synthetic/synthetic.zip`, ticks 10 frames, renders 256×256, and
asserts non-zero opaque pixels. **Passes, 36,433 opaque pixels, 0.01s.**

### Slint UI shell (partial)

`src/ui/`: `Theme.slint` and `I18n.slint` globals, 16 components in
`components/`, 5 shell windows in `shell/`, `bootstrap.slint` (the `MainWindow`
root), `main.slint` (re-export hub so `slint::include_modules!` exposes
everything).

`build.rs` compiles **`bootstrap.slint`** as the single entry — Slint only
generates Rust types for components reachable from the entry, so the entry
must import the whole tree.

**Structural finding:** Slint does not nest `Window` subclasses — a `Window`
child is an ordinary element, not a separate OS window. `Splash` and
`MainShell` are therefore `Rectangle` components hosted by the bootstrap root.
Separate top-level windows (chat, settings, about, stage) belong to the Rust
window registry (`windows.rs`), which is a later slice.

## Bridge ports (complete)

All 27 bridges ported; 117 tests pass. The conversion rule is mechanical:
`#[cxx_qt::bridge]` and the `qobject` wrapper become a plain state struct
behind a `Mutex` static with a `with_state` accessor, `#[qproperty]`
becomes `pub` fields, `#[qinvokable]` becomes inherent methods, `QString`
becomes `String`, and `QObjectList`/`QVariantList` becomes
`Vec<plain struct>`. `QTimer` event pumps become plain `drain_*()`
methods, so the UI layer owns scheduling.

Remaining work (not bridge ports):
- VRM stage: `StageScene.qml` / `VrmMtoonMaterial.qml` had no Slint port yet.
  `airi-render`'s geometry math is reusable; MToon has no Slint shader
  equivalent.
- Settings/Chat window bodies are layout skeletons, not wired to the Rust
  controllers.
- `--smoke` tour driver: the CLI flag parses, the milestone walk is not wired.
- `src/bridges/_qt_src/` still holds the 27 Qt sources as reference; delete it
  once nothing else needs to consult them.

## Test notes

The settings bridge tests initially failed in the full suite for two reasons
worth recording, both in the tests rather than the bridges:

- `temp_path()` put the extension mid-filename, so `Path::extension()`
  returned the pid and the `.vrm` import validators rejected files the test
  had just written. It now keeps the extension at the end.
- `SettingsStore` is a `OnceLock`, so only the first test's database is ever
  used. `register_temp_store` now clears every key, so each test starts from
  defaults regardless of registration order.
