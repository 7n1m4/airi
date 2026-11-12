# P10 — MMD renderer design (Q Quick 3D, after VRM and Spine)

Status: **design only**. Nothing in this note is implemented; "P10" is not yet scheduled against a wave. Doc, not an implementation plan with dates. All crate/crates.io facts that could not be verified without network are marked **unverified**.

Context: AIRI's Qt stage renders VRM (`qml/stage/StageWindow.qml` → `View3D` + `StageScene` + per-primitive `Model`s with `AiriVrmGeometryShell`) and Spine (`SpineStage.qml` → C++ scene-graph `SpineItem`). MMD is the last renderer in the plan; `apps/airi-qt/qml/pages/settings/mmd/MmdSettingsPage.qml` exists (idle switch + renderScale; hint already says "physics is disabled until P10") but there is no MMD engine, parser, or render path anywhere in `apps/airi-qt`.

## Fixture inventory (measured, this repo)

- **No `.pmx` / `.pmd` models exist anywhere in the repo or in sibling checkouts under `/home/vi`** (`find . -iname '*.pmx'` / `*.pmd`, excluding `node_modules`/`target`/`.git` — zero hits). MMD sample models are non-commercial or redistribution-restricted; none are vendored, none may be added without a license review.
- **14 `.vmd` motion files** exist, duplicated three times (canonical source: `apps/stage-tamagotchi/src/renderer/public/assets/mmd/animations/`, mirrored in `apps/stage-web/public/assets/mmd/animations/` and the built `out/`/`dist/` trees). Names: `brushoff_nice_and_tidy, circulation (2.9 MB), crossed_arms_look_around_confident, fixing_hair_or_wig, getting_item_out_of_bra, hat_flip, impatient_foot_tapping, shy, skittish_mermay, smelling_something_in_the_air, something_in_the_sky, stretching, swaying_arms_and_hips, tracker`. Total ≈ 4.8 MB. These are the only MMD assets AIRI owns and the only safe live-test fixtures for the VMD parser. They are motions authored for specific (absent) models, so they double as "parses without its model" tests.
- `packages/stage-ui-mmd/` (Vue) loads models via `MMDLoader` from **user-supplied ZIPs** (`mmd-zip-loader.ts` — model + textures + optional `.vmd`); nothing in-repo exercises a real PMX. The Vue side is the spec for semantics, not for fixtures.
- **Test-fixture plan**: (1) tiny constructed fixtures built in-test (below); (2) the 14 repo VMDs for the VMD parser; (3) an opt-in live model test gated by env var, mirroring `LAYA_TEST_MODEL` / `LLAMA_TEST_MODEL` / `WHISPER_TEST_AUDIO`: `AIRI_TEST_MMD_MODEL=/path/to/model.pmx cargo test -p airi-mmd live_`. Real PMX/PMD files are **never committed**; the user supplies one locally. A license-clean synthetic PMX (built by a script, like `assets/test-models/synthetic/` for Spine) is also viable for parser/skinning tests but is not a substitute for one real-world-model smoke.

## Crate: `apps/airi-qt/crates/airi-mmd` (NOT to be created yet)

Pure-Rust, no Qt dependency, mirroring `airi-render`'s relationship to `airi-qt`: parser + CPU engine + typed document; `airi-qt`'s `bridges/mmd.rs` (cxx-qt) consumes it; `qml/stage/StageWindow.qml` gains a third mode. Workspace member; shares `anyhow`/`thiserror`/`serde_json`/`zip` conventions with `airi-render`.

### PMX/PMD parser strategy

- **Recommended: hand-rolled**, consistent with the Spine lane (which hand-rolled atlas/skeleton-JSON parsing) and with the PMX spec being short and stable.
  - **crates.io availability — unverified.** Candidates that may exist (e.g. `mmd-rs`, `pmx`, `mmd-model`) could not be checked (no network by policy). Even if they exist, they are likely unmaintained/low-usage, and AIRI needs exact control of encodings and error tolerance, so hand-rolling is the default. Revisit `mmd-rs` only if a maintenance signal check (downloads, last release, issue latency) is done at implementation time.
  - Structure: `PmxHeader { magic "PMX ", version: f32 (2.0 target; reject > known with a clear error), encoding_flag: u8 (0 = UTF-16LE, 1 = UTF-8), ... }`, then vertices (pos, normal, UV0 + ext UV sets, weight type BDEF1/BDEF2/BDEF4/SDEF, edge flag, vertex index), faces, textures, materials (diffuse/ambient/specular/edge colors, flags, tex/sphere/toon indices, edge size, tex coeffs), bones (parent, transform layer, position, flags incl. IK/inherit/fixed-axis/local axes, tail, inherit parent+rate, IK definition: target bone, iteration, angle limit, links), morphs (group/vertex/bone/UV/material/flip), display frames, rigid bodies (shape, size, position/rotation, mass/friction/repulsion, mode, bone), joints (6×6 limit matrix, spring).
  - **PMD** is a separate, legacy path: fixed-size records, **CP932 (Shift-JIS) strings** (needs `encoding_rs`, unverified version), different bone flag semantics, no UTF-8 option, PMDEditor quirks. Support as `parse_pmd` behind the same `MmdDocument` facade; do not try to unify the binary readers.
  - Encoding rules: PMX strings are length-prefixed and flagged (UTF-16LE or UTF-8 — never guess); PMD strings are fixed 20 B CP932. Texture/material paths are stored raw; resolve case-insensitively and tolerate `\` vs `/` (Windows-origin archives on Linux). Non-UTF8 paths that fail decode are logged and resolved via lossless byte→char mapping.

### VMD parser strategy

Hand-rolled (simple, documented): 30-byte signature `Vocaloid Motion Data 0002`, then u32 bone-key count → per key: 15-byte bone name, u32 frame, vec3 position, quaternion (xyzw), 64-byte interpolation (16×4 curves). Then u32 morph count (name + frame + weight), then camera/light/shadow sections (parse and discard; AIRI only consumes bone/morph channels). Signature variants (`0000`/`0001`?) — handle `0002` first, tolerate others with warning. Unit tests: synthetic 3-key fixture; live fixtures: all 14 repo VMDs (parse + frame ranges + morph names resolve). VMD alone can't be validated beyond parsing without its model — that is fine, parser tests only.

### Physics strategy

- Vue/three-stdlib path uses **Ammo.js** (Bullet compiled to WASM); AIRI Qt has no physics engine yet.
- **bullet-rs status — unverified.** A `bullet-rs` crate exists in my knowledge but I could not verify maintenance, version, or API currency (no network). Do **not** make it a hard dependency on unverified ground. Alternatives: `rapier3d` (pure Rust, actively maintained as of my knowledge cutoff — still unverified here), or the C++ Bullet from a system package.
- **Decision: physics off by default, behind a Cargo feature `mmd-physics` (default disabled)**, and excluded from P10's first milestone. PMX's rigid-body/joint definitions are parsed and stored (round-trip) but not simulated. This is an explicit deviation from the Vue behavior (physics toggle defaults on there); `MmdSettingsPage.qml` already advertises "physics is disabled until P10", so the UI contract matches.
- If enabled later: prefer `rapier3d` (no C++/cmake burden, deterministic ordering) with a documented behavioral gap vs Bullet (MMD tuning assumes Bullet's solver; skirt/hair collisions will differ); `bullet-rs` only if a maintenance check passes. IK runs **regardless** of physics (IK is kinematic, implemented in Rust — Vue used `MMDAnimationHelper`'s IK).
- IK: port three-stdlib/`MMDAnimationHelper` semantics (iteration + angle limit + bone chain from the PMX IK link list); unit-test on a synthetic two-bone chain. Grant/inherit bone evaluation (rotation/translation inheritance with rate), fixed-axis, and local-axes rotation modes are required for correct poses and are **not** optional in v1.

### Texture / skinning mapping onto the Qt Quick 3D pipeline

Reuse the VRM pattern wholesale — the PMX vertex layout is a superset of the glTF one:

- Interleaved buffer, **stay on the existing 64-byte stride** for the common case: `pos(12) normal(12) uv0(8) joints(u32×4=16) weights(f32×4=16)`. `JointSemantic`/`WeightSemantic` at offsets 32/48 already match `AiriVrmGeometryShell::setBuffers`; **no C++ change required for BDEF4**. (Note: `AiriVrmGeometryShell` is asset-agnostic — `QByteArray` + stride — and can be reused directly; if MMD later needs >4 influences or SDEF, add `setBuffersCompat` or a sibling shell instead of mutating the VRM contract.)
- **BDEF1/BDEF2** → expand to 4-slot with zero weights (GPU/CPU path unchanged). **SDEF** (dual-quaternion-ish: C, R0, R1 + weight) → v1: evaluate as BDEF2 approximation with a warning counter; v2: proper SDEF in the CPU skinning loop. Document as deviation.
- PMX extra UV sets (UV1–UV4) → store, do not upload; material morphs that rewrite UVs need them later.
- **Skinning is CPU-side** (as in the VRM path — full CPU skin, `skinAndMorph(dt)` per frame, `shell.updateVertexData(...)`), not Qt Quick 3D `Skin` nodes; this matches the existing engine and avoids Qt's joint-limit quirks.
- Materials → reuse the MToon QML material family (`qml/VrmMtoonMaterial.qml` + `qml/shaders/mtoon.{frag,vert}`) with MMD parameter mapping: diffuse→`uBaseColor`+diffuse texture, ambient→shade color, toon→two-step ramp (see below), sphere map (`.sph` multiply / `.spa` additive) → new `CustomMaterial` property or approximate with rim; emissive = 0 (MMD has none). Material flags (draw order, edge tint/edge-only, no-cull) → per-material `Model` `usedInBakedLighting`-style equivalents + edge rendering (edge pass = same geometry, inverted hull, only if `edge_enabled` — defer edge rendering to v2).
- **Toon textures**: PMX references `toon*.bmp` either by index into MMD's *built-in* toon set (files ship with MikuMikuDance, **not in this repo and not redistributable**) or by custom path. v1: always use the Qt two-step ramp; custom toon textures load if present (parse + bind); built-in indices log once and fall back to the ramp. **Not covered**; see Non-goals.
- Morphs: vertex morphs (relative/absolute), bone morphs, UV+material morphs in v1; group/flip/camera morphs stored, applied minimally (group = sum of members). Morph evaluation happens in the CPU engine (same pass as skinning).
- Render integration: extend `StageWindow.qml` with a third mode (`.pmx`/`.pmd`/`.zip`) alongside `isSpineModelPath`, or a sibling `MmdStage.qml` hosted the same way; `MmdController` cxx-qt bridge (`bridges/mmd.rs`) mirrors `bridges/spine.rs`/`StageSceneController` (loadModel, play, pause, setPhysicsEnabled(ignored), loadMotion). Rotation convention: PMX is Y-up, -Z-forward like VRM 0.x in this pipeline — reuse `modelRoot`'s 180° node rotation; verify against a real model when fixtures exist.
- Frame pacing: `Timer` 16 ms like VRM; PMX vertex counts can be 10–50k — CPU skinning cost is real but acceptable on desktop; measure before optimizing (no SIMD promises).

## Module / file breakdown (estimate)

| Module | Contents | Est. size |
|---|---|---|
| `airi-mmd/src/lib.rs` | crate docs, facade, `MmdDocument` | ~80 lines |
| `src/pmx/{mod,header,vertex,material,bone,morph,rigidbody,joint}.rs` | PMX 2.0 reader | ~1200 lines |
| `src/pmd.rs` | legacy PMD reader (CP932) | ~400 lines |
| `src/vmd.rs` | VMD reader/writer-lite | ~250 lines |
| `src/zip.rs` | reuse `airi-render::bundle::ModelBundle` (zip→temp dir, safe_join) — depend on `airi-render` or move bundle to a shared crate | ~0 (reuse) |
| `src/skeleton.rs` | bone tree, rest pose, inherit/grant/fixed-axis/local-axes | ~400 lines |
| `src/ik.rs` | IK solver | ~150 lines |
| `src/skin.rs` | BDEF1/2/4 (+SDEF approx), weld→joint indices | ~350 lines |
| `src/morph.rs` | morph base + weights (vertex/bone/UV/material/group) | ~300 lines |
| `src/engine.rs` | per-frame: sample VMD → bones/morphs → IK → CPU skin → interleaved buffer out (same 64 B stride) | ~400 lines |
| `src/texture.rs` | path resolution (ci, separators, lossless bytes), toon/sphere binding list | ~150 lines |
| `src/materials.rs` | PMX→MToon-ish params (reuse `airi_render::vrm::materials` shapes where possible) | ~200 lines |
| `airi-qt/src/bridges/mmd.rs` | cxx-qt `MmdController` | ~250 lines |
| `qml/stage/MmdStage.qml` / `StageWindow.qml` +3rd mode | QML host | ~150 lines |
| `tests/{pmx_parse.rs,vmd_parse.rs,ik.rs,live_model.rs}` | see test plan | ~500 lines |

Rough total **~4–5k lines** including tests — comparable to the Spine lane's shipped scope (parser+session+item+bridge). No C++ required for v1.

## Risks

- **PMD vs PMX**: two formats, one facade; PMD inherits Shift-JIS/CP932 hell and PMDEditor dialects. Recommend: PMX first, PMD read-only support, zero write support.
- **Encoding**: PMX has a flag; trust it, never sniff. Texture paths inside PMX are often mojibake when the archive was made on a JP Windows — path resolution must be lossy-tolerant and case-insensitive, or ZIP-loaded models render untextured (this exact bug class bit the Vue loader).
- **Toon shading fidelity**: built-in toons unavailable → models look flatter than in MMD; acceptable, documented.
- **SDEF**: wrong weights = broken limbs; the BDEF2 fallback is visible but tolerable.
- **IK stability**: naive iteration pops; needs angle limits + damping, borrowed from three-stdlib behavior.
- **Physics-off deviation**: hair/skirt clips through the body; MmdSettingsPage already sets the expectation.
- **ZIP layout**: nested folders, `テクスチャ/` dirs, multi-format archives (PMD inside PMX zip), basename collisions — reuse the Spine bundle rules (`flatten_name`, `is_manifest_json`-style skips).
- **Morph count**: PMX models can carry hundreds of morphs (vertex morphs dominate CPU); cap evaluated morphs per frame if profiling demands.
- **License**: zero MMD models may be committed; all fixtures in-tree are constructed or parser-only.
- **GUI verification honesty** (inherited from Spine lane): headless `--smoke` can prove load/tick, not pixels; final look needs a desk check with a user-supplied model.

## Test plan

1. **Constructed fixtures, in-test** (no binary blobs in git where avoidable):
   - Minimal PMX 2.0 (UTF-8): 3 bones (parent/child/IK target), 4 vertices/1 triangle, 1 material w/ texture index, 1 vertex morph — assert header fields, counts, name tables, weights of BDEF1/BDEF2/BDEF4 vertices, IK link list parse.
   - Minimal PMX with `encoding_flag=0` (UTF-16LE) — same assertions on decode.
   - Minimal PMD (CP932, one fixed 20-byte Japanese name) — assert lossy-free decode.
   - Malformed: bad magic, truncated vertex, unknown weight type → structured errors, no panics.
   - Minimal VMD: 30-byte signature, 2 bone keys + 1 morph key; assert frame ordering + quaternion decode. Parse all **14 repo VMDs** (in-repo, license-safe) — must not error; log frame ranges.
2. **Unit tests**: IK two-bone chain converges on a target; grant-rotation inheritance rate; skinning identity pose = rest pose; morph weight 0/1 extremes; toon fallback path.
3. **Live test (env-gated, not CI)**: `AIRI_TEST_MMD_MODEL=/path/to/model.pmx cargo test -p airi-mmd live_load` — loads, prints vertex/bone/material counts, plays `swaying_arms_and_hips.vmd` for 90 frames, asserts buffers changed. Also `AIRI_TEST_MMD_ZIP` for the zip path. Skipped silently (like `LAYA_TEST_MODEL`) when unset.
4. **Smoke tour**: extend `--smoke` to optionally load the synthetic PMX once P10 lands; assert `skinAndMorph` tick counter increments (same counter VRM uses).
5. **No GPU/pixel assertions** without a display; document that as a known gap, same as the Spine note.

## Explicit non-goals / not covered

- **OpenJev** — stays out (no pinned ONNX export; see `p9-laya.md`).
- **Live2D** — deferred pending Cubism SDK license; the Qt Live2D settings page remains a placeholder.
- **MMD physics** (Bullet/rapier simulation of rigid bodies/joints) — parsed, not simulated; Cargo-feature-gated later.
- **MMD camera motions**, accessory display physics, PMX *writing*, PMD *writing*.
- **Built-in `toonXX.bmp` ramps** (MMD distribution assets) — not redistributed; custom-toon textures only.
- **PMD-write / PMX 2.1-specific extensions** beyond tolerant parsing (version field is read; unknown sections fail loudly).
- **Edge rendering (inverted-hull)** — v2.
- **Finger poses / motion library expansion** — VMD catalog is whatever the user loads; the 14 bundled motions stay bundled.

## Inventory notes you should not have to rediscover

- `apps/airi-qt/qml/pages/settings/mmd/MmdSettingsPage.qml` already ships an MMD settings page (Idle switch + renderScale, "physics is disabled until P10" hint, `MmdSettingsController` bridge, `settings/mmd` blob). The renderer it configures does not exist yet — the page is a shell, not evidence of a port.
- The Vue ground truth for semantics: `packages/stage-ui-mmd/src/composables/mmd/loader.ts` (textures load by relative path from the model's base; sRGB retagging; albedo-glow emissive hack for r184), `src/stores/mmd.ts` (physics/IK/grant/gravity toggles, `physics-gravity` default 98, motion list, one-shot channel), `src/utils/mmd-zip-loader.ts` (ZIP = model+textures+`.vmd`; blob-URL resolution). Port behavior, not code.
- `issues-and-regressions` doc (`docs/research-mmd-issues-and-regressions.md`) — current MMD regressions are all Vue/display issues, none applicable to a fresh Qt engine.
- Stage window extension point is proven: Spine already added a second renderer with zero changes to the VRM path — add a third the same way (`isMmdModelPath` + a `MmdStage` host; `StageWindow.qml` loads by extension).

## Sequenced milestones (no dates, no estimates worth trusting)

1. **M0 — parser headroom**: crate skeleton, PMX 2.0 + VMD + PMD readers, constructed-fixture tests green, 14 repo VMDs parse.
2. **M1 — static render**: rest-pose mesh through the existing `AiriVrmGeometryShell` path, textures resolved from ZIP, two-step toon ramp, no morphs/IK/skinning motion. Acceptable failure: SDEF approximated.
3. **M2 — animation**: VMD bone channels → skeleton → IK → CPU skinning; idle loop; `MmdController` bridge; StageWindow third mode; `--smoke` tick.
4. **M3 — morphs + materials**: vertex/bone/UV morphs, group morphs, material morphs (diffuse/ambient), sphere-map binding, alpha/flags.
5. **M4 (optional, feature-gated)** — `mmd-physics`: rigid bodies + joints via rapier3d; behavioral delta vs Bullet documented; `MmdSettingsPage` physics toggle becomes live.

Each milestone ends in a phase-note update with the same honesty rules the spine note used (what is verified vs what is assumed).

## Open questions for the user (blocking before implementation)

1. **Fixture acquisition.** A real PMX (e.g. a license-clean model from the user's library) must be supplied locally for the smoke/desk check and for `AIRI_TEST_MMD_MODEL`; nothing in-repo can substitute. Which model, and is its license OK to render on-screen in demos/screenshots?
2. **Physics engine.** `mmd-physics` off (recommended for P10 first cut) or bring in `rapier3d` immediately? "Off" means hair/skirt clipping; the Vue default was on.
3. **PMD priority.** Ship PMX-only first, or is a legacy PMD model known to be needed? PMD cost is mostly CP932 handling + divergent bone flags; PMX-first is ~1 week cheaper.
4. **Toon ramps.** Accept the Qt two-step ramp as the permanent look (recommended), or scope in real toon-texture support later?

## Verification commands (for the implementing lane)

```sh
# parser + engine unit tests (no fixtures needed)
cargo test -p airi-mmd --all-targets
# optional live tests with a user-supplied model (skipped silently otherwise)
AIRI_TEST_MMD_MODEL=/path/to/model.pmx cargo test -p airi-mmd live_
AIRI_TEST_MMD_ZIP=/path/to/package.zip cargo test -p airi-mmd live_zip
# smoke tour (load + tick; proves code path, not pixels)
QT_QPA_PLATFORM=offscreen cargo run -p airi-qt -- --smoke
```

## Acceptance checklist (for the implementing lane)

- [ ] `crates/airi-mmd` parses PMX 2.0 + the 14 repo VMDs in `cargo test` (all in-test constructed fixtures).
- [ ] `MmdController` loads a user-supplied model + `.zip` end-to-end; MToon-approx materials render on the Qt Quick 3D path.
- [ ] `--smoke` ticks the MMD scene; GUI desk check recorded in the phase note.
- [ ] Physics remains feature-gated off; `MmdSettingsPage` copy updated only if behavior changes.
- [ ] No model files committed; `AIRI_TEST_MMD_MODEL` documented in the crate README.
