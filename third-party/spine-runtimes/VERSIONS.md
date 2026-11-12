# Vendored Spine Runtimes (C++)

Esoteric Software Spine Runtimes, vendored as pinned snapshots of the public
`spine-runtimes` repository (https://github.com/EsotericSoftware/spine-runtimes).
Only the C++ runtime (`spine-cpp`) and the license texts are vendored — no
spine-editor, no proprietary assets, no sample projects from other runtimes.

| Dir       | Format line | Pin                                                    | npm alias (Vue)                              |
|-----------|-------------|--------------------------------------------------------|----------------------------------------------|
| `4.0.64/` | Spine 4.0   | tag `4.0.64` @ 01524d4cdc4e95ef727b86390936b119c64871d9 | `~4.0.31` (`@esotericsoftware/spine-webgl-4-0`) |
| `4.1.00/` | Spine 4.1   | tag `4.1.00` @ ab28b77c70e3aa766be5bdb759d7aedac9fd0bde | `~4.1.56` (`@esotericsoftware/spine-webgl-4-1`) |
| `4.2/`    | Spine 4.2   | branch `4.2` @ 5cb78e77d3711ddcd80c7bd043bb11cf70fcc88c (no plain `4.2` release tag exists upstream; branch HEAD pinned at vendor time 2026-11-10) | `^4.2.0` (`@esotericsoftware/spine-webgl`)   |

Notes:

- The Vue package (`packages/stage-ui-spine/src/utils/spine-runtime.ts`) lazy-loads
  one JS runtime per skeleton version. `spine-webgl-4-0` IS used by
  `spine-runtime.ts` (`case '4.0'`), so the 4.0 runtime is vendored as well,
  contrary to an earlier suspicion that it was unused.
- 3.8 is intentionally not vendored (the Vue package no longer routes to it).
- Each tree keeps its own `LICENSE` (`Spine Runtimes License Agreement`,
  see `<version>/LICENSE` and `<version>/spine-cpp/LICENSE`). These are
  redistributable under their terms; see the compliance note in
  `packaging/README.md`.
- `spine-cpp-unit-tests`, CMake files and per-runtime READMEs are NOT
  vendored — only `spine-cpp/{include,src}` + licenses.

## C++ API compatibility (airi-render shell)

The `airi-render` C++ shell (`crates/airi-render/cpp/spine_shell.{h,cpp}`)
targets the spine-cpp API as used across 4.1 and 4.2
(`Atlas`, `SkeletonJson`, `SkeletonBinary`, `SkeletonData`, `Skeleton`,
`AnimationStateData`, `AnimationState`, `AnimationStateData::defaultMix`,
`updateWorldTransform`). Skeletons exported by the 4.0 editor use the same
class surface but with minor signature drift; 4.0 is vendored for reference
and future enablement, only one runtime line is compiled into `airi-render`
at a time (cargo feature `spine-runtime-4-1` | `spine-runtime-4-2`, default
`4.2`). See `docs/phase-notes/p4-spine.md` for the deviation from the
JS runtime lazy-loading model and the rationale.
