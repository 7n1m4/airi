# P4 — Spine renderer port

Status: **incomplete** — vendoring, bundle loader, parsers, C ABI shell, scene-graph item, bridge, QML and smoke logging are all in and green; remaining verification (GUI-hosted SpineStage inside the stage window) depends on the P3 lane and on the merge. Acceptance checklist at the bottom.

## Vendored spine runtimes (deliverable 1)

`apps/airi-qt/vendor/spine-runtimes/{4.0.64,4.1.00,4.2}/` — pinned snapshots of the public `spine-runtimes` repo (spine-cpp only + LICENSE files; no tests, no CMake, no editor). Network was reachable. `VERSIONS.md` records exact tags/commits:

- `4.0.64` ← tag `4.0.64` (`01524d4c…`), npm alias `~4.0.31`
- `4.1.00` ← tag `4.1.00` (`ab28b77c…`), npm alias `~4.1.56`
- `4.2` ← branch `4.2` pinned at `5cb78e77…` (2026-11-10); no plain `4.2` release tag exists upstream — noted in VERSIONS.md
- 3.8 intentionally not vendored (Vue routes don't support it either)

**4.0 IS used** (`spine-runtime.ts` case `'4.0'`) — vendored as a result,
contrary to the earlier suspicion that it was unused.

## Dual-runtime story (deviation from plan, deliberate)

spackages/stage-ui-spine lazy-loads one JS runtime per skeleton version
because spine-webgl ships per-version bundles. spine-cpp exports all symbols
under one C++ namespace and cannot link two versions into one binary, so:

- `airi-render` compiles exactly **one** vendored line at a time; default `4.2` (matches the `^4.2.0` main dep). `AIRI_SPINE_RUNTIME=4.1.00` (or `4.0.64`) at build time switches the vendored line.
- Runtime version detection exists (`spine::version`, JSON + binary varint scan) and reports the bucket; the shell hard-errors on a `.skel` whose editor version does not match the compiled runtime (spine-cpp itself refuses the load with "Skeleton version X does not match runtime version Y" — observed in the FFI test).
- A true runtime dual/many-runtime (dlopen of per-version shared libs) is possible but deferred; the C ABI shell is designed so that remains straightforward. Vue behavior (pick runtime by detected version) is therefore only approximated today.

## ModelBundle loader (deliverable 2)

`airi-render::bundle::ModelBundle::open(path)`:

- zip → locate `*.atlas(+`.atlas.txt)`, `*.json` (minus manifest-looking JSONs), `*.skel`, textures (`png|webp|jpg|jpeg`); `spine_layout()` returns the spine entry points. VRM consumers can reuse the same API (no spine-specific code).
- Extraction cache: `<dirs::data_dir()>/airi-qt/model-cache/<slug>-<sha256[:16]>/`, slug from file name; `.complete` marker + `manifest.json`; extraction goes through a temp sibling and `rename` for atomicity; cache always platform data dir, **never** `--profile` (an app cache, not user state) — documented on `model_cache_root()`.
- `safe_join`/`sanitize_zip_path` blocks zip-slip members; `flatten_name` deduplicates basenames (collision-tested); `is_manifest_json` skips `model0.json`/`package.json` etc. when looking for the skeleton.
- Tests: synthetic zip written in-test (atlas + skeleton.json + empty png) → extracts, locates files, caches; second open hits cache (`cache_hit == true`); corrupt zip errors cleanly; zip-slip rejected. `open_bytes_with_root` makes tests hermetic (temp dirs), public contract unchanged.

## Parsers (deliverable 3)

- `spine::atlas::parse_atlas` — pages, regions, `size/format/filter/repeat/pma`, `xy/size/bounds/offsets/orig/rotate/index/split/pad`, unknown keys tolerated, whitespace-tolerant, pre-multiply detection via `pma` page key. UV rect helper computes normalized coords (rot=90 swaps). Unit tests included.
- `spine::skeleton` — typed view over `.json` (serde): `skeleton` block (spine/hash/x/y/width/height/fps/images/audio), bone/slot/skin names, event names, animation names + best-effort durations (max `time` key found recursively). `.skel` is NOT parsed in Rust by design (spine-cpp does it at load). Unit tests included.
- `spine::version` — runtime bucket detection (`4.0`/`4.1`/`4.2`) for JSON and `.skel` binaries (port of `spine-version.ts`). Unit tests included.
- `spine::animation` — `resolve_animation` (exact → ci → contains → reverse-contains), `resolve_idle` (idle/stand/first fallback), `find_hit_animation`, track constants (`IDLE_TRACK=0`, `EMOTION_TRACK=1`, `DEFAULT_MIX_SECONDS=0.2`). Port of `animation-manager.ts` + `emotions.ts`. Unit tests included.

## FFI shell (deliverable 4)

`airi-render/cpp/spine_shell.{h,cpp}` (C ABI, mirrors the stage-qt pattern — the C++-shell route wholesale, `cxx` not expressive enough for draw-command serialization):

- Opaque `airi_spine_session`, owned objects (`Atlas`, `SkeletonData`, `Skeleton`, `AnimationState(Data)`).
- `airi_spine_load(skel_bytes, is_binary, atlas_text) -> ok`, `airi_spine_bounds`, `airi_spine_animation_count/name`, `airi_spine_skin_count/name/set_skin`, `airi_spine_set_animation(track,name,loop)`, `airi_spine_set_empty_animation`, `airi_spine_set_default_mix`, `airi_spine_update(dt)` (update + `Physics_Update` on 4.2 / no-arg on 4.1 via `AIRI_SPINE_42` define), per-frame draw serialization (`airi_spine_draw_counts` + `airi_spine_collect_draws`) emitting `{page_index, blend_mode, alpha, ranges}` groups + `airi_spine_rt_page_*` for texture lookup.
- Draw serialization follows spine-cpp's own software renderer exactly: world vertices `[BR, BL, UL, UR]` zipped with `getUVs()` as-is, quad indices `[0,1,2,2,3,0]`; meshes use their own triangles; bounding-box/clipping/point/path attachments not drawable (clipping **not** honored yet — known limitation).
- `getDefaultExtension()` provided (spine-cpp requires the engine to supply it; uses `DefaultSpineExtension`).
- `airi-render` builds the selected vendored line with `cc` (build.rs); only one line links per binary (see dual-runtime note).

## Renderer + QML (deliverable 5)

- `airi-qt/src/cpp/spine_item.{h,cpp}` — `SpineItem` (C++, `QML_ELEMENT`), **scene-graph node**, not a painted item: rebuilds the node subtree per frame (`OwnedByParent` children, `QSGGeometry` + `QSGTextureMaterial` per draw group, per-page `QSGTexture` cache keyed by atlas page index, `QImage` loaded from the bundle root, converted to premultiplied ARGB32). Y-flip + fit-scale + centered bounds + user offsets on a `QSGTransformNode` above the per-page nodes. `maxFps` throttles the internal QTimer (0 = unthrottled, Vue default 0); `renderScale` multiplies the fit scale.
- `fitting`: skeleton bounds → 90% fit × user `renderScale` — close enough to canvas-centered Vue layout for the smoke asset; the full layout algebra (model0 scale_factor, anchors) is **not** ported (stage panel concern).
- `airi-qt/src/spine_rt.rs` — shared process-wide session (Mutex), C ABI for the render thread (`advance`, `collect`, `bounds`, `pages`, `bundle_root`) + `load_bundle_path` (zip via `ModelBundle`, loose directories supported for the synthetic asset) + smoke check.
- `bridges/spine.rs` — `SpineController` (cxx-qt): `#[qproperty] loaded, playing, maxFps, renderScale, mixSeconds, modelPath`; invokables `loadModel(path)`, `play(name, loop)` (idle fallback resolution), `poke()` (one-shot `hit_*` on the emotion track), `setSkin()`.
- `qml/spine/SpineStage.qml` — hosts `SpineController` + `SpineItem`, exposes `modelPath/renderScale/maxFps/offsetX/offsetY`, auto-plays `idle`.

## stage-ui-spine semantics (deliverable 6)

Ported into `spine::animation` + `SpineController` + `SpineItem`:

- `maxFps` throttle (item timer), `renderScale` resolution scale, `mixSeconds` default 0.2 (Vue `defaultMixDuration`), idle fallback via `resolve_idle` (idle/stand/first), emotion track one-shots revert to idle, `DEFAULT_MIX_SECONDS = 0.2`, `SPINE_IDLE_TRACK=0`, `SPINE_EMOTION_TRACK=1`.
- Gesture interaction: **minimal** `poke()` only (one-shot `hit_*`). The 802-line pointer/pull/spring system is intentionally not ported yet (`interactionMode tactile/orbit`, `radialHitRadius`, `hitDetectionMode`, pull offsets, motion audio).
- `animationSpeed`, `activeAnimations` (independent tracks), `playOneShotAnimation` broadcasting, emotion enum mapping (`EMOTION_SpineAnimationName_value`), `model0.json` scale_factor/motions/hit_areas, premultiplied-alpha auto-detection beyond page-pma, `patchAtlasText`/`patchAssetManagerForZipAssets` (Vue-side WebGL workarounds) — all not ported; most don't apply to a native renderer.

## Test asset (deliverable 7)

Synthetic, procedurally generated — `apps/airi-qt/assets/test-models/synthetic/{skeleton.json,synthetic.atlas,synthetic.png,synthetic.zip}` — generated by a python recipe (brush-stroke-free): a 32×32 coral blob with a waving bone (`idle`: rotate ±8° over 4s + bob; `hit_body`: squash-and-stretch). License-clean (no third-party content). The spine-runtimes `examples/` tree was inspected: **all example projects ship non-commercial-use-only images** (`license.txt` in each), so none was copied; a spineboy copy would still have been acceptable for a smoke but the synthetic asset removes the ambiguity entirely. Page is `pma:false`, `format:RGBA8888`, nearest filter.

## Verification (deliverable 8) — honest levels

1. `cargo test --workspace` → **all green** (incl. 41 airi-render unit tests + `spine_session` FFI integration test that ticks 90 frames and asserts vertices posed differently at t=1s).
2. `cargo run -p airi-qt -- --smoke` → **exit 0**; logs show `spine asset parsed ok, animation [idle] at t=0.000s` and `spine tick ok (90 frames, t=1.500s, vertices=4, draws=1)`. VRM stage ticks: 30.
3. Workspace `clippy` warnings in my files: only pre-existing P0 `vrm` warnings + 1 (fixed). `rustfmt` applied to touched files.
4. **GUI verification not reached** — DISPLAY=:0 / WAYLAND exist, but the stage window (P3) does not host `SpineStage.qml` yet; the smoke check runs the same Rust code path the scene-graph item drives, minus actual GL. No screenshot, no gdb inspection of `SpineItem` constructed. `SpineItem` compiles into the module (build-time) but was never instantiated by a QML view.
5. Render-thread texture creation (`createTextureFromImage` inside `updatePaintNode`) follows the custom-geometry pattern but is unverified on this Qt build (6.12.0).

## Other changes

- **Bug fix (outside spine lane, pre-existing P0):** `vrm/doc.rs` — `SecondaryAnimation.spring_groups` deserialized as `springGroups`, but VRM 0.x writes `boneGroups`; serde now has `rename = "boneGroups"`. This was the cause of the failing `engine_loads_and_ticks_bundled_model` test (`has_spring_bones()` false on a model with 10 bone groups). Test now passes.
- `bridges/mod.rs`, `main.rs`, `build.rs` — additive wiring (spine bridge + `spine_rt` module + `spine_item.cpp/h` + `qml/spine/SpineStage.qml` registration). P3's `StageWindow.qml` and `settings_stage`/`stage` bridges untouched.
- `docs/phase-notes/p4-spine.md` — this file.
- `README.md` — added Spine Runtimes License compliance note (what ships, under which license, what does not, editor-license requirement for integrators).

## Unmerged integration TODOs for P3 merge

1. Host `SpineStage.qml` in `StageWindow.qml` (e.g. below/above the VRM `View3D`); wire `loadModel` from the stage-settings model path (`.zip` = spine, `.vrm` = VRM — loader is bundle-agnostic; VRM consumption is P3's).
2. `StageWindow` smoke or visual check that `SpineItem` renders (tint/z-order with transparent stage background — item is transparent by default, `color: transparent` in parent).
3. Decide whether stage smoke should assert `SpineStage.loaded == true` rather than only the Rust-side log.
4. Gesture/tactile system, `animationSpeed`, `activeAnimations`, `model0.json` handling, premultiplied-alpha auto-detection, and non-`4.2` skeletons (compile-time `AIRI_SPINE_RUNTIME`) — none of these block P4 acceptance but they are the remaining semantics gaps.
5. Clipping attachments and additive/multiply blend modes are dropped (draws fall back to normal blend).
6. `airi_spine_rt_bundle_root()` uses a shared static buffer (documented, single-writer) — revisit if multiple spine items coexist.
