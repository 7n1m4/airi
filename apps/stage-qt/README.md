# stage-qt — Native Qt Quick 3D VRM desktop-pet renderer

Native companion renderer for AIRI, built the Qt way (Qt Quick 3D scene graph,
no web tech), implemented in **Rust + cxx-qt**. It speaks the same WebSocket
JSONL protocol as the Unity Stage-Mate sidecar so AIRI can drive either
renderer interchangeably.

## License

**GPL-3.0-or-later** (this directory only). Qt Quick 3D is shipped under
GPL (not LGPL on the GPL branch of Qt), so this app's sources are GPL-3.0.
The rest of the AIRI monorepo remains MIT. See `LICENSE`.

## Prerequisites

- Qt **6.12** with the `quick3d`, `declarative`, and `shadertools` modules
  (`qt6-base`, `qt6-declarative`, `qt6-shadertools`, `qt6-quick3d` on Arch;
  `qsb` must be on `$PATH` or at `<qt>/bin/qsb`).
- Rust **stable** (pinned via `rust-toolchain.toml`).

## Quickstart

```bash
# 1. Build
pnpm -F @proj-airi/stage-qt build        # cargo build --release → bin/stage-qt

# 2. Standalone: harness + renderer (loads a test VRM)
pnpm -F @proj-airi/stage-qt harness      # terminal 1: mock AIRI server on :6171
pnpm -F @proj-airi/stage-qt dev -- --model apps/stage-qt/test-model.vrm

# 3. Live with AIRI (Electron spawns this binary with --token when the
#    Unity Stage-Mate binary is absent; see step 8 of the plan / README
#    section below).
pnpm dev:tamagotchi
```

## Protocol summary

The app connects to the AIRI stage server (`ws://127.0.0.1:6171`), performs
`module:authenticate` → `module:announce`, then receives `stage:state:sync`.
It renders `stage:vrm:load` models and replies `stage:vrm:ready`; it also
handles `stage:vrm:expression`, `stage:vrm:lip-sync`, `stage:control:mouse`
(gaze), `stage:model:position`, `control:stage`, `stage:caption`, and emits
`stage:window:bounds` / `stage:model:position` on user interaction. Full
message tables live in `src/protocol/` (mirroring
`apps/stage-mate/unity-src/Assets/StageMate/Core/StageMateProtocol.cs`).

## Tests

```bash
cargo test   # expression engine, lip-sync, gaze, springbones, idle
```
