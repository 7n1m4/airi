# airi-qt

Native Qt Quick desktop application for AIRI (Rust + cxx-qt).

This is the standalone Rust+Qt rewrite workspace, separate from the frozen `apps/stage-qt` Electron sidecar.

## Layout

- `crates/airi-store` — SQLite persistence (rusqlite bundled, WAL, typed repos)
- `crates/airi-llm` — LLM provider registry/config and chat clients (stub/types in P0)
- `crates/airi-core` — domain services/state/events (stub/types in P0)
- `crates/airi-i18n` — build-time i18n codegen from `packages/i18n` YAML
- `crates/airi-render` — VRM/Spine render logic seeded from stage-qt
- `crates/airi-qt` — Qt binary, cxx-qt bridges, QML shell
- `qml/` — QML sources
- `docs/port-manifest/` — generated Electron/Vue port inventory
- `scripts/gen-manifest/` — deterministic manifest generators

## Dev

```sh
cargo test --workspace
cargo run -p airi-qt -- --smoke
cargo run -p airi-qt -- --profile ./tmp-profile
```

Requires Qt 6 development packages (Gui/Qml/Quick/Quick3D/Network) for the Qt-dependent crates/binary.

## Single-instance lock & crash logs

GUI launches take a named lock (`airi-qt.lock`) on startup and exit 0 when
another live instance holds it. With `--profile <dir>` the lock lives in the
profile; `--smoke` without `--profile` uses its throwaway temp profile;
otherwise it lives in the platform data dir (`<data>/airi-qt/airi-qt.lock`).
A stale lock from a dead pid is reclaimed automatically; an unverifiable lock
(`/proc` unavailable, unparseable contents) fails safe and refuses to start —
remove the lock file by hand if that is wrong. Rust panics (unwinding) are
captured as JSON lines to `<data>/logs/panic-<millis>-<pid>.log` (newest 20
kept). C++ exceptions/`std::terminate` raised inside Qt never reach the panic
hook and are not logged.

## Platform notes (P8: Linux-first)

- **Linux** is the primary target. `/proc` is used for the pid liveness probe
  backing the single-instance lock; other platforms need the lock to be
  probed differently (the current build assumes `/proc`).
- **Windows**: the tray icon needs a proper `.ico` resource (currently the
  Linux icon path is used; supplying `airi.ico` at packaging time is enough).
  The lock's `/proc` probe fails safe there (lock never verifiable → second
  instance refuses to start rather than risk double-running); a named mutex
  would be the correct primitive when Windows support lands.
- **macOS**: global hotkey registration requires accessibility/input-monitoring
  permission for the app bundle; without it the hotkeys silently do nothing.
  Use a proper `.icns` for the bundle. The pid liveness probe has the same
  `/proc` limitation as Windows.
- Crash-log backtraces only include frames when `RUST_BACKTRACE=1` is set;
  Qt/`std::terminate` aborts bypass the hook entirely (see above).

## Third-party licenses: Spine Runtimes (vendored)

`vendor/spine-runtimes/` contains pinned snapshots of the C++ part of the
public [spine-runtimes](https://github.com/EsotericSoftware/spine-runtimes)
repository (spine-cpp only — no Spine Editor, no example projects, no other
runtimes). Exact pins are recorded in `vendor/spine-runtimes/VERSIONS.md`.

- Each vendored tree ships its own `LICENSE` (`Spine Runtimes License
  Agreement`, Apr 2019 / Apr 2025), preserved verbatim together with the
  per-file copyright headers. These runtimes may be redistributed under
  those terms provided the license and copyright notice travel with copies —
  which is exactly how we ship them.
- The Spine Runtimes License requires that users integrating the runtimes
  into their own products obtain their own Spine Editor license (or comply
  with Spine Editor License Agreement Section 2). AIRI's distribution of the
  runtimes is limited to their redistribution under that license; AIRI does
  not claim ownership of the runtimes, and they are not relicensed under
  GPL-3.0-or-later.
- The Spine Editor and any Spine-exportable assets that ship with AIRI's
  test suite are synthetic (generated, see `assets/test-models/`) and are
  not subject to this license; no proprietary Spine content is committed.
- When linking against vendored spine-cpp, keep the LICENSE files within
  every distributed artifact (e.g. AppImage/deb/msi resource payloads must
  include `vendor/spine-runtimes/*/LICENSE`).
