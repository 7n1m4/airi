# P10 Lane J2 — MMD M1: static rest-pose render (`RestPoseEngine`, `MmdController`, StageWindow patch — do-not-apply)

Status: **M1 (static rest-pose render) implemented and verified up to headless
level. No real model has ever been rendered.** The engine, the cxx-qt bridge,
the StageWindow QML patch (in this note, **do-not-apply**) and the central
integration checklist are done. The QML patch was *executed* only inside a
throwaway `/tmp` copy (`/tmp/opencode/airi-qt-mmd-check`), never applied to
the real tree; the real `qml/stage/StageWindow.qml` is byte-identical to
before this lane.

Lane scope (exclusive): `crates/airi-mmd/**`, `crates/airi-qt/src/bridges/mmd.rs`
(new), this note. Everything else — `build.rs`, `bridges/mod.rs`
`crates/airi-qt/Cargo.toml`, `main.rs`, StageWindow.qml, locales, settings
pages — was **not** touched in the real tree and is listed here as central
integration steps. `git status` of this lane's work:

- `M apps/airi-qt/crates/airi-mmd/src/lib.rs`
- `A apps/airi-qt/crates/airi-mmd/src/rest_pose.rs`
- `A apps/airi-qt/crates/airi-mmd/tests/rest_pose.rs`
- `A apps/airi-qt/crates/airi-qt/src/bridges/mmd.rs`
- `A apps/airi-qt/docs/phase-notes/p10-lane-mmd-m1.md` (this file)

(`crates/airi-qt/src/main.rs` carries a pre-existing modification from a
different lane — platform-data-dir persistence — not from this lane.)

## 1. What landed — `airi-mmd`: `RestPoseEngine` (`src/rest_pose.rs`)

```rust
RestPoseEngine::from_path(path: impl AsRef<Path>) /* -> Result<Self, MmdError> */  // parse + resolve sibling textures
RestPoseEngine::build(model: &MmdModel) -> RestPoseEngine        // pure; no texture I/O
engine.vertex_bytes()      -> &[u8]      // shared interleaved buffer, stride 64
engine.index_bytes(prim)   -> Option<&[u8]>  // u32 LE, per-primitive index range
engine.primitive_count()   -> usize
engine.primitive_material(prim) -> Option<i32>   // -1 = unassigned leftover faces
engine.materials()         -> &[RestPoseMaterial] // index-aligned with material_index
engine.vertex_stride()     // via constant airi_mmd::VERTEX_STRIDE == 64
engine.sdef_approximated()      -> usize  // SDEF vertices remapped onto BDEF2
engine.ambient_fallback_count() -> usize  // materials whose ambient==0 got diffuse*0.6
engine.invalid_joint_count()    -> usize  // joint indices clamped into 0..bone_count-1
engine.texture_failures()       -> usize  // material texture loads that failed
engine.face_range_mismatch()    -> bool   // material vertex_count sums != face list
engine.ticks()                  -> u64    // pure frame counter (skinAndMorph proof)
engine.elapsed_ms()             -> f64
engine.tick(dt_ms: f32)                    // no pose evaluation; counter only
```

### Interleaved buffer layout (identical to the VRM path)

Little-endian, stride **64**, one record per vertex:

| offset | field    | bytes | type        |
|--------|----------|-------|-------------|
| 0      | position | 12    | f32 × 3     |
| 12     | normal   | 12    | f32 × 3     |
| 24     | uv0      | 8     | f32 × 2     |
| 32     | joints   | 16    | u32 × 4     |
| 48     | weights  | 16    | f32 × 4     |

All primitives **share one interleaved vertex buffer**; only index buffers
differ. This matches how the VRM bridge hands the same buffer to every
`AiriVrmGeometryShell`, and what `StageWindow.qml` expects
(`shell.setBuffers(vertexData, indexData, stride)` per primitive).

### Primitive splitting (by material, GLTF-style)

PMX orders faces by material; each material declares how many **face indices**
it consumes (`material.vertex_count`, a raw index count, ÷3 = triangles).
`RestPoseEngine` walks materials in file order, takes `min(declared, faces
remaining)` triangles per material, and emits one primitive each. Two
malformed-input cases are handled deterministically and never panic:

- A declared range that overruns the remaining faces is **clamped**; the
  mismatch is recorded (`face_range_mismatch() == true`).
- Faces left over after every material consumed its range go into a trailing
  primitive with `material_index == -1` (also flags `face_range_mismatch`).

Materials with zero faces are skipped (no empty primitive).

### Deform expansion (BDEF/SDEF → 4-slot joints/weights)

- **BDEF1** → `joints = [i, 0, 0, 0]`, `weights = [1, 0, 0, 0]`.
- **BDEF2** → `joints = [a, b, 0, 0]`, `weights = [w, 1−w, 0, 0]` (the `1−w`
  is computed at parse time and stored).
- **BDEF4** → verbatim (indices + 4 weights; **not renormalized** — PMX stores
  a normalized set).
- **SDEF** → **BDEF2-style approximation with the two stored influences**:
  `joints = [i0, i1, 0, 0]`, `weights = [w, 1−w, 0, 0]`. The SDEF rotation
  center `C` and rotation references `R0`/`R1` are **dropped**, so skinning
  degrades from dual-quaternion-ish to linear blend. This is the
  user-approved approximation (2026-11-11). Every SDEF vertex increments
  `sdef_approximated()` so the caller can surface a warning. Proper SDEF in
  the CPU skinning loop is M2+.
- Joint indices that are negative or `>= bones.len()` are clamped into
  `0..bone_count−1` and counted in `invalid_joint_count()` (defensive;
  well-formed files never carry them).

Skinning weights go into the buffer **verbatim**; there is no pose to
evaluate. Bones carry no rest rotation in PMX (the rest pose is translation
only), and M1 does not evaluate skinning at all — vertices upload in rest
bind pose, which for an unweighted stand-in is exactly the authored geometry.
CPU skinning lands in M2.

### Material mapping (PMX → MToon-ish)

- `base_color` = PMX `diffuse` RGBA, verbatim.
- `shade_color` = PMX `ambient` RGB with alpha = diffuse alpha. PMX ambient is
  always present (a `vec3`), so there is no "absent" case; the fallback is an
  authoring-heuristic: when ambient is **exactly `[0, 0, 0]`** it is replaced
  by `diffuse.rgb × 0.6` (counted in `ambient_fallback_count()`). Non-zero
  ambient is used verbatim.
- **Ignored in M1:** specular + shininess, edge flags/colors/sizes,
  vertex-color flag, point/line draw modes, ground/shadow flags, sphere
  maps (`.sph`/`.spa`), and the toon reference (built-in indices log
  nothing here at all — there is no toon plumbing yet). The Qt two-step toon
  ramp in the MToon QML material family is the only toon term.

### Textures

Resolved **only** by `RestPoseEngine::from_path`: each material's stored
texture path is `\`-normalized to `/`, and resolved relative to the `.pmx`
file's parent directory (absolute paths are used as-is). Missing/unreadable
files are counted (`texture_failures()`), never fatal; the bridge then falls
back to the white 1×1 binding. **No `.zip` support, no built-in MMD toon
ramps (`toonNN.bmp`), no case-insensitive lookup, no sphere maps.** `.zip` is
M2.

## 2. What landed — `bridges/mmd.rs`: `MmdController`

Mirrors the VRM `StageSceneController` QML-facing surface exactly (names,
types, semantics), with deliberate divergences listed below. **Not compiled
until the central session registers it** (build.rs + `bridges/mod.rs` — see
§5). `cargo check -p airi-qt` in the `/tmp` integration copy is **clean**
(including cxx-qt codegen and moc: `moc_mmd.cxxqt.h.o` was produced).

| Member | Type | Notes |
|---|---|---|
| `ready` | bool qproperty | set on successful load/unload |
| `status` | QString qproperty | "Model ready" / typed failure string |
| `modelId` | QString qproperty | the `settings/stage-model` id, or the path passed to `loadModel` |
| `primitiveCount` | i32 qproperty | one per material face-range |
| `modelVersion` | i32 qproperty | bumped on every load/unload (`onModelVersionChanged` → rebuildModels) |
| `loadModel(path: QString)` | qinvokable | empty → unload; `.pmd` → dedicated status; else parse |
| `loadFromSettings()` | qinvokable | reads `settings/stage-model` like the VRM path, filtered to `.pmx`/`.pmd` |
| `reloadFromSettings() -> bool` | qinvokable | cheap poll; reloads only on change |
| `unload()` | qinvokable | drop model, clear stage |
| `skinAndMorph(dtMs: f64)` | qinvokable | pure tick counter + smoke counter |
| `vertexData(prim: i32) -> QByteArray` | qinvokable | shared interleaved buffer (stride 64) |
| `indexData(prim: i32) -> QByteArray` | qinvokable | per-primitive u32 LE indices |
| `vertexStride() -> i32` | qinvokable | 64 |
| `primitiveMaterial(prim: i32) -> i32` | qinvokable | -1 = unassigned |
| `materialBaseColor(mat: i32) -> QColor` | qinvokable | PMX diffuse RGBA |
| `materialShadeColor(mat: i32) -> QColor` | qinvokable | ambient (or diffuse×0.6 fallback) |
| `materialTextureUrl(mat: i32) -> QString` | qinvokable | cached `file:///` URL; white 1×1 PNG fallback |
| `hasMaterialTexture(mat: i32) -> bool` | qinvokable | engine texture resolved at load |
| `smoke_skin_ticks()` | Rust fn (not QML) | smoke-tour counter, same pattern as the VRM bridge |

`loadFromSettings()` reads the **same** `settings/stage-model` blob as the VRM
path (`airi_core::settings::StageModelSettings`,
`crate::bridges::settings_store()`), filtered to case-insensitive `.pmx` /
`.pmd` paths. Non-MMD ids and the empty default leave the stage empty with a
typed status; the VRM/Spine renderers keep their own paths (StageWindow picks
by extension). `.pmd` currently fails with the dedicated status
`load failed: PMD is not supported yet (P10 M2)` — PMD parsing is not
implemented (M0 explicitly rejected it).

**Deliberate divergences from the VRM bridge (all small):**

1. `materialTextureUrl` / `hasMaterialTexture` use the engine's
   already-resolved texture bytes (sibling-of-`.pmx` files), cached under
   `<stage-cache>/mmd-{material}-{sample:x}.{ext}` — same scheme as the VRM
   path but with an `mmd-` prefix to avoid cross-controller cache collisions.
2. In the QML patch (§4), `uBaseMapUrl` is only requested when
   `matIdx >= 0` (`matIdx >= 0 ? active.materialTextureUrl(matIdx) : ""`).
   The VRM path queries the URL unconditionally (with `-1` clamped to 0 by the
   bridge); querying texture 0 for unassigned faces would be wrong.
3. M1 has **no motion, no morphs, no IK, no skinning evaluation**.
   `skinAndMorph` only bumps the engine tick and (in `--smoke`)
   `SMOKE_SKIN_TICKS`. Poses, expressions, lip-sync and gaze hooks are M2+.
4. `vertexData` ignores its `prim` argument — every primitive shares the one
   interleaved buffer. The parameter exists for API parity with the VRM
   controller and with what `StageWindow.qml` passes.
5. The smoke counter lives in `crate::bridges::mmd::smoke_skin_ticks()`;
   `main.rs`'s stage leg does **not** see it until the central session adds
   the two-line patch in §5.5.

**Errors never panic.** Malformed files → `load failed: <path>: <typed error>`
in `status`, `ready = false`, `primitiveCount = 0`, `modelVersion` bumped.

## 3. What works (verified) and what does not

**Works, verified on this machine 2026-11-11:**

- `cargo test -p airi-mmd` — all green, **40 tests** (14 `pmx_parse` + 10
  `vmd_parse` + 3 `synthetic_pmx` + 9 new `rest_pose` + 3 `live_model` +
  1 doctest). The 9 new tests assert: 64-byte stride and exact field
  offsets; BDEF1/BDEF2/BDEF4/SDEF expansion math; primitive split by material
  with the shared vertex buffer; zero-ambient → `diffuse×0.6` fallback and its
  counter; out-of-range joint clamping; face-range overrun clamping; leftover
  faces → trailing `material_index = -1` primitive; `tick()` counter; sibling
  texture resolution (happy path, missing-file path, counter).
- `cargo clippy -p airi-mmd --all-targets -- -D warnings` — clean.
  `cargo fmt -p airi-mmd --check` — clean.
- The synthetic fixture PMX (6 vertices / 2 triangles / 2 materials, written
  byte-by-byte by `tests/rest_pose.rs`) parses, assembles, splits into 2
  primitives and expands SDEF→BDEF2 exactly as specified.
- `/tmp/opencode/airi-qt-mmd-check` (throwaway copy of `apps/airi-qt` with the
  full integration applied **there only**): `cargo check -p airi-qt` clean
  (~2m40s cold), and `cargo build -p airi-qt` clean (~2m12s).
  `moc_mmd.cxxqt.h` generated; QML type `MmdController` registers through the
  static QML module the same way as the other bridges.
- `qmllint` on the patched StageWindow.qml reports **no syntax errors** and
  the same warning classes as the unpatched file (unqualified access,
  `Connections` target type) — i.e. the patch introduces no new lint class.
- `--profile` + `--smoke` with a seeded `settings/stage-model` pointing at a
  synthetic `.pmx` — **PASSED, see §7**. The stage window opened, the
  `MmdController` loaded the model (2 primitives), shells were created and
  buffers set through the real QML path, and the smoke tour exited 0.
  Offscreen renders no pixels (same as VRM) — no visual acceptance claimed.

**Does not work / not verified:**

- **No real `.pmx` has ever been parsed by this engine or rendered.**
  Everything rests on constructed fixtures plus the M0 parser coverage. A
  real model desk check (license-clean, user-supplied) is still required —
  including PMX-is-Y-up orientation on the shared `modelRoot` (180° node
  rotation inherited from the VRM path; unverified for MMD).
- **No pixels.** The smoke leg proves the code path runs (bridge ticks,
  buffers are set on the shells), not that anything is drawn or lit correctly.
- **Two-step ramp only.** No custom toon textures, no built-in toon ramps,
  no sphere maps, no `.spa`/`.sph`, no edge/inverted-hull pass.
- **Identity skinning.** Rest pose only; no VMD evaluation, no IK, no morphs
  (vertex/UV/bone/material/group), no grant/inherit bones. `skinAndMorph` is
  a counter.
- **SDEF is the approved BDEF2 approximation** — C/R0/R1 dropped; limbs on a
  shoulder/wrist-heavy model may visibly candy-wrapper vs MMD.
- **PMD unsupported** (dedicated load failure); **`.zip` unsupported**
  (M2); **textures are sibling-file resolution only** — no path
  remapping for Windows-authored archives, no case-insensitive fallback.
- **`face_range_mismatch` models** (material vertex counts inconsistent with
  the face list) render with clamped/trailing-unassigned primitives; the
  mismatch is reported via stderr and `face_range_mismatch()` but nothing
  fails the load.
- **QDEF** still rejects at parse (`UnsupportedDeformType(4)`), unchanged.
- **Alpha behavior**: base/shade colors carry diffuse alpha verbatim; the
  MToon two-step ramp path is used as-is — no cutout/blend logic was added.

## 4. The StageWindow.qml patch — DO-NOT-APPLY

Apply this **exactly** when doing the central integration. It was applied
only to `/tmp/opencode/airi-qt-mmd-check/qml/stage/StageWindow.qml` for
verification (`cargo check` clean, `qmllint` warning-parity, smoke run).

```diff
diff --git a/qml/stage/StageWindow.qml b/qml/stage/StageWindow.qml
index 0000000..1111111 100644
--- a/qml/stage/StageWindow.qml
+++ b/qml/stage/StageWindow.qml
@@
 // Renders the settings-selected model: `.vrm` via `StageScene`/`View3D`
-// (VRM path, unchanged), or a `.json`/`.skel`/`.atlas`/`.zip` bundle via
-// `SpineStage`. Selection is by extension of the configured
+// (VRM path, unchanged), a `.pmx`/`.pmd` model via the same
+// `StageScene`/`View3D` with `MmdController`, or a
+// `.json`/`.skel`/`.atlas`/`.zip` bundle via `SpineStage`.
+// Selection is by extension of the configured
 // `settings/stage-model.modelId`; empty modelId keeps the bundled VRM
 // default. Exposes lip-sync/gaze/expression hooks through
 // `StageSceneController` on the VRM path.
```

(Full unified diff — the complete, apply-to-the-real-tree patch — follows.
Reproduced verbatim from `diff -u` between the real tree and the verified
`/tmp` copy.)

```diff
@@ -1,8 +1,10 @@
 // SPDX-License-Identifier: GPL-3.0-or-later
 // Stage window: frameless, translucent, always-on-top desktop-pet stage.
 // Renders the settings-selected model: `.vrm` via `StageScene`/`View3D`
-// (VRM path, unchanged), or a `.json`/`.skel`/`.atlas`/`.zip` bundle via
-// `SpineStage`. Selection is by extension of the configured
+// (VRM path, unchanged), a `.pmx`/`.pmd` model via the same
+// `StageScene`/`View3D` with `MmdController`, or a
+// `.json`/`.skel`/`.atlas`/`.zip` bundle via `SpineStage`.
+// Selection is by extension of the configured
 // `settings/stage-model.modelId`; empty modelId keeps the bundled VRM
 // default. Exposes lip-sync/gaze/expression hooks through
 // `StageSceneController` on the VRM path.
@@ -42,15 +44,31 @@
         id: controller
     }

+    MmdController {
+        id: mmdController
+    }
+
     StageSettingsController {
         id: stageSettings
     }

     // --- Scene selection ------------------------------------------------------
-    // `.json`/`.skel`/`.atlas`/`.zip` route to the spine renderer; anything
-    // else (including `.vrm` and the empty bundled default) stays on VRM.
+    // `.json`/`.skel`/`.atlas`/`.zip` route to the spine renderer;
+    // `.pmx`/`.pmd` route to the MMD renderer; anything else (including
+    // `.vrm` and the empty bundled default) stays on VRM.
     property string stageModelId: ""

+    function isMmdModelPath(path) {
+        var lower = String(path).trim().toLowerCase()
+        var dot = lower.lastIndexOf(".")
+        if (dot < 0)
+            return false
+        var ext = lower.substring(dot)
+        return ext === ".pmx" || ext === ".pmd"
+    }
+
+    readonly property bool mmdMode: isMmdModelPath(stageModelId)
+
     function isSpineModelPath(path) {
         var lower = String(path).trim().toLowerCase()
         var dot = lower.lastIndexOf(".")
         if (dot < 0)
             return false
         var ext = lower.substring(dot)
         return ext === ".json" || ext === ".skel" || ext === ".atlas" || ext === ".zip"
     }

     readonly property bool spineMode: isSpineModelPath(stageModelId)

     function applyModelSelection() {
         if (spineMode)
             spineStage.loadModel(stageModelId)
+        else if (mmdMode)
+            mmdController.loadFromSettings()
         else
             controller.loadFromSettings()
     }
@@ -162,8 +182,9 @@
                 entry.material.destroy()
         }
         modelObjects = []
-        if (!controller.ready) {
-            console.log("[airi-qt] stage: no model (%1)".arg(controller.status))
+        var active = stageWindow.mmdMode ? mmdController : controller
+        if (!active.ready) {
+            console.log("[airi-qt] stage: no model (%1)".arg(active.status))
             return
         }
         var geomComp = Qt.createComponent("com.airi.airiqt", "AiriVrmGeometryShell")
@@ -174,16 +195,16 @@
             return
         }
         var created = []
-        for (var prim = 0; prim < controller.primitiveCount; prim++) {
+        for (var prim = 0; prim < active.primitiveCount; prim++) {
             var shell = geomComp.createObject(null)
-            shell.setBuffers(controller.vertexData(prim), controller.indexData(prim), controller.vertexStride())
-            var matIdx = controller.primitiveMaterial(prim)
-            var useMap = matIdx >= 0 && controller.hasMaterialTexture(matIdx)
+            shell.setBuffers(active.vertexData(prim), active.indexData(prim), active.vertexStride())
+            var matIdx = active.primitiveMaterial(prim)
+            var useMap = matIdx >= 0 && active.hasMaterialTexture(matIdx)
             var material = matComp.createObject(null, {
-                uBaseColor: matIdx >= 0 ? controller.materialBaseColor(matIdx) : "#ffffff",
-                uShadeColor: matIdx >= 0 ? controller.materialShadeColor(matIdx) : "#b4b4b4",
+                uBaseColor: matIdx >= 0 ? active.materialBaseColor(matIdx) : "#ffffff",
+                uShadeColor: matIdx >= 0 ? active.materialShadeColor(matIdx) : "#b4b4b4",
                 uUseMap: useMap ? 1.0 : 0.0,
-                uBaseMapUrl: controller.materialTextureUrl(matIdx)
+                uBaseMapUrl: matIdx >= 0 ? active.materialTextureUrl(matIdx) : ""
             })
             var model = modelComp.createObject(scene.modelRoot, {
                 geometry: shell,
@@ -203,13 +224,14 @@
         repeat: true
         onTriggered: {
             // skinAndMorph doubles as the smoke-tour tick counter (it
-            // increments even with no VRM engine loaded), so it runs
-            // unconditionally; the VRM scene is only repainted when ready.
-            controller.skinAndMorph(16.0)
-            if (!controller.ready)
+            // increments even with no engine loaded), so it runs
+            // unconditionally; the scene is only repainted when ready.
+            var active = stageWindow.mmdMode ? mmdController : controller
+            active.skinAndMorph(16.0)
+            if (!active.ready)
                 return
             for (var i = 0; i < modelObjects.length; i++)
-                modelObjects[i].shell.updateVertexData(controller.vertexData(modelObjects[i].index))
+                modelObjects[i].shell.updateVertexData(active.vertexData(modelObjects[i].index))
         }
     }

@@ -220,6 +242,13 @@
         }
     }

+    Connections {
+        target: mmdController
+        function onModelVersionChanged() {
+            rebuildModels()
+        }
+    }
+
     // Poll the settings-persisted model selection once a second so model
     // switches from the settings page apply live (cheap: the bridge only
     // reloads when the stored id changed).
@@ -230,7 +259,7 @@
         repeat: true
         onTriggered: {
             // Re-read the persisted model id; reload only when it changed.
-            // Spine reloads go through SpineStage; VRM through the bridge.
+            // Spine reloads go through SpineStage; VRM/MMD through their bridges.
             stageSettings.loadAll()
             var id = String(stageSettings.modelId).trim()
             if (id !== stageWindow.stageModelId) {
@@ -252,7 +281,9 @@
     AEmptyState {
         anchors.centerIn: parent
         width: parent.width - 2 * Theme.spacingL
-        visible: stageWindow.spineMode ? !spineStage.loaded : !controller.ready
+        visible: stageWindow.spineMode ? !spineStage.loaded
+            : stageWindow.mmdMode ? !mmdController.ready
+            : !controller.ready
         icon: "✦"
         title: I18n.tr("shell.stage.empty-title")
         subtitle: I18n.tr("shell.stage.empty-subtitle")
@@ -279,7 +310,9 @@
             anchors.centerIn: parent
             text: stageWindow.spineMode
                 ? ("spine · model=" + stageWindow.stageModelId + (spineStage.loaded ? "" : " (load failed)"))
-                : controller.status + (controller.ready ? " · model=" + controller.modelId : "")
+                : stageWindow.mmdMode
+                    ? "mmd · " + mmdController.status + (mmdController.ready ? " · model=" + mmdController.modelId : "")
+                    : controller.status + (controller.ready ? " · model=" + controller.modelId : "")
             color: "#ffffff"
             font.pixelSize: 11
             elide: Text.ElideRight
@@ -366,6 +399,9 @@
             if (stageWindow.spineMode)
                 console.log("[airi-qt] stage: spine model=%1 loaded=%2"
                     .arg(stageWindow.stageModelId).arg(spineStage.loaded))
+            else if (stageWindow.mmdMode)
+                console.log("[airi-qt] stage: mmd scene ticks ok, model=%1"
+                    .arg(mmdController.ready ? mmdController.modelId : "none"))
             else
                 console.log("[airi-qt] stage: scene ticks ok, model=%1"
                     .arg(controller.ready ? controller.modelId : "none"))
```

**Notes on the patch:**

- MMD shares the VRM `View3D` + `StageScene` (same `modelRoot` with its
  180° Y rotation, same `Camera`, same `AiriVrmGeometryShell` — the shell is
  asset-agnostic). `view3d.visible` stays `!spineMode` unchanged.
- No new `QtQuick3D` import or element registration is needed;
  `MmdController` registers via the existing static QML module (`qml_element`,
  namespace `airi_qt`).
- **i18n: no new keys.** The empty state reuses `shell.stage.empty-title` /
  `empty-subtitle` and the "✦" icon for all three renderers; the status chip
  uses a plain-English `mmd · …` prefix mirroring `spine · …`.
- `AEmptyState.visible` gains a middle MMD branch; the icon and text are
  identical for VRM and MMD (both are "no 3D model loaded" states).
- The `Connections` block for `mmdController` mirrors the VRM one exactly
  (`onModelVersionChanged → rebuildModels`).
- One subtle behavior: switching a live session between VRM and MMD ids works
  through the settings poll (`applyModelSelection` branches on the extension);
  `rebuildModels` destroys and recreates shells from the newly-ready
  controller. Switching **from** MMD **to** VRM leaves the MMD shells
  destroyed and rebuilds VRM ones — same pattern the spine↔vrm switch uses.

## 5. Central integration steps (in order)

All of the following are **outside this lane's scope** and were applied
only to the throwaway `/tmp/opencode/airi-qt-mmd-check` copy for
verification. Apply them to the real tree in this exact order:

1. **`crates/airi-qt/Cargo.toml`** — add the path dependency (one line):

   ```toml
   airi-mmd = { path = "../airi-mmd" }
   ```

   (after the `airi-render` line). No other dependency changes — M1 needs
   nothing new.

2. **`crates/airi-qt/build.rs`** — register the bridge for cxx-qt codegen,
   after the `stage.rs` line:

   ```rust
   manifest_dir.join("src/bridges/mmd.rs"),
   ```

3. **`crates/airi-qt/src/bridges/mod.rs`** — add the module, after the
   `pub mod mcp;` line (alphabetical):

   ```rust
   pub mod mmd;
   ```

4. **`qml/stage/StageWindow.qml`** — apply the §4 patch verbatim.

5. **`crates/airi-qt/src/main.rs`** — **required** for `--smoke` when
   `settings/stage-model` points at an `.pmx`/`.pmd` file. Without it the
   smoke tour's stage leg never ticks (the frame timer only ticks the active
   controller, so `bridges::stage::smoke_skin_ticks()` stays 0) and the smoke
   exits `FAILURE` ("stage scene did not tick"). The patch (verified in the
   `/tmp` copy):

   ```diff
   -            let stage_done = bridges::stage::smoke_skin_ticks() >= 30;
   +            let stage_done = bridges::stage::smoke_skin_ticks() >= 30
   +                || bridges::mmd::smoke_skin_ticks() >= 30;
   ```

   and

   ```diff
   -        let stage_ticks = bridges::stage::smoke_skin_ticks();
   +        let stage_ticks =
   +            bridges::stage::smoke_skin_ticks() + bridges::mmd::smoke_skin_ticks();
   ```

6. **Verification commands** (clean tree first, then):

   ```sh
   cd apps/airi-qt
   cargo test -p airi-mmd                    # 40 tests, all green
   cargo clippy -p airi-mmd --all-targets -- -D warnings
   cargo fmt -p airi-mmd --check
   cargo check -p airi-qt                    # cxx-qt codegen + moc must be clean
   ```

   Then the headless smoke run with a seeded `.pmx` modelId:

   ```sh
   # 1) Build a synthetic PMX (the one from this lane's tests, or your own).
   #    tests/rest_pose.rs writes it only in-memory; the smoke profile was
   #    seeded with a byte-identical stand-in at /tmp/opencode/smoke-mmd/test-model.pmx.
   mkdir -p /tmp/opencode/smoke-mmd/profile

   # 2) Seed settings/stage-model → the .pmx path. The store is
   #    <profile>/airi.sqlite (table `settings`, key `settings/stage-model`,
   #    value = camelCase JSON). Either pre-create it with sqlite3:
   python3 - <<'PY'
   import sqlite3, json, time, os
   db = '/tmp/opencode/smoke-mmd/profile/airi.sqlite'
   conn = sqlite3.connect(db)
   conn.execute("create table if not exists settings (key text primary key, value text not null, updated_at integer not null)")
   conn.execute("insert into settings (key, value, updated_at) values ('settings/stage-model', ?, ?) on conflict(key) do update set value=excluded.value, updated_at=excluded.updated_at",
                (json.dumps({"modelId": "/tmp/opencode/smoke-mmd/test-model.pmx"}), int(time.time()*1000)))
   conn.commit()
   PY
   #    or launch once interactively and set Settings → Stage → modelId — slower.

   # 3) Run the smoke tour offscreen:
   QT_QPA_PLATFORM=offscreen cargo run -p airi-qt -- \
       --profile /tmp/opencode/smoke-mmd/profile --smoke
   ```

   Expected: `[airi-qt] mmd: model loaded: /tmp/opencode/smoke-mmd/test-model.pmx (primitive_count=2, …)`,
   `smoke: stage skinAndMorph ticks: 30+`, `smoke: mmd scene ticks ok, model=/tmp/opencode/smoke-mmd/test-model.pmx`,
   exit code 0. If the stage leg reports < 30 ticks, step 5 was not applied.
   The bundled VRM default is unaffected (`.vrm` paths take the VRM branch).

7. **Optional but recommended:** `MmdSettingsPage.qml` copy stays as-is
   ("physics is disabled until P10" remains true). No settings-page or
   locale changes are required for M1.

## 6. Honest limits (read before claiming a desk check)

1. **Synthetic-fixture-only.** Every byte-level claim rests on constructed
   fixtures (`tests/rest_pose.rs` reuses the in-test PMX writer approach).
   No real `.pmx` was parsed; **no model was rendered**. Orientation of a
   real model on the shared `modelRoot` (Y-up assumption, 180° VRM rotation)
   is unverified — expect a possible upside-down model on first real run.
2. **Rest pose = identity skinning.** Vertices upload in bind pose; nothing
   moves, ever, in M1. There is no animation path, not even a static idle.
3. **SDEF → BDEF2** approximation (drops C/R0/R1; see §1). Approved
   2026-11-11. Visible on models with heavy SDEF usage (usually
   shoulders/wrists). A warning counter exists (`sdef_approximated()`);
   the bridge logs it to stderr on load.
4. **Two-step ramp only.** MToon's `uShadeColor` is fed with PMX ambient
   (or diffuse×0.6); no toon textures, no rim, no edge pass, no sphere maps.
5. **Textures = sibling-file resolution** of the path stored in the PMX.
   Windows-authored archives with `\` separators are normalized; anything
   more exotic (mojibake paths, `toonNN.bmp` built-ins, `.zip` packages,
   `.pmd`) is not resolved and is counted in `texture_failures()`.
6. **PMD and `.zip` are M2.** A `.pmd` id loads with the dedicated status
   `load failed: PMD is not supported yet (P10 M2)`. A `.zip` path fed to
   `MmdController.loadModel` is treated as a `.pmx` attempt and fails the
   PMX magic check with a typed error — it never reaches a zip reader.
7. **Mismatched face lists** (material `vertex_count` vs actual face count)
   are tolerated, clamped, and reported; they are not fatal and not silent.
8. **Per-material primitives share one vertex buffer** — Qt uploads it once
   per shell instance; for a 50k-vert model that's ~3.2 MB × primitive-count
   on the GPU. Fine on desktop, noted for M2's skinning rewrite.
9. **Smoke proves the path, not the pixels.** Headless `--smoke` cannot
   assert framing, lighting or toon look. Final acceptance needs a desk
   check with a user-supplied, license-clean model (`AIRI_TEST_MMD_MODEL`
   still applies to the parser layer).
10. **Performance:** no numbers yet. Assembly is O(n) over vertices; no
    per-frame work in M1. M2's CPU skinning will need the profiling pass the
    design note promised — measure before optimizing.

## 7. Test evidence

Run on the implementation tree (`/home/vi/Code/airi/apps/airi-qt`), 2026-11-11:

```
$ cargo test -p airi-mmd
test result: ok. 0 passed (lib)          — airi-mmd lib has no #[test]s
test result: ok. 3 passed  (live_model)  — incl. env-gated live tests, silently skipped
test result: ok. 14 passed (pmx_parse)
test result: ok. 9 passed  (rest_pose)   — new: buffer assembly & assembly math
test result: ok. 3 passed  (synthetic_pmx)
test result: ok. 10 passed (vmd_parse)
test result: ok. 1 passed  (doctest)
→ 40 tests, 0 failed

$ cargo clippy -p airi-mmd --all-targets -- -D warnings
    Checking airi-mmd … Finished — clean

$ cargo fmt -p airi-mmd --check && echo fmt-clean
fmt-clean
```

Integration verification in the throwaway `/tmp/opencode/airi-qt-mmd-check`
(not the real tree), full integration applied there only:

```
$ cargo check -p airi-qt          # cold build, ~2m40s
    …
    Checking airi-mmd v0.1.0
    Checking airi-i18n v0.1.0
    Compiling airi-qt v0.1.0      — cxx-qt codegen + moc_mmd.cxxqt.h generated
    Finished `dev` profile …      — clean, no errors, no new warnings

$ /usr/lib/qt6/bin/qmllint -I qml qml/stage/StageWindow.qml
    — no syntax errors; identical warning classes to the unpatched file
      (unqualified access, incompatible-type Connections target);
      MmdController resolves as a known type.
```

Headless smoke run (`--profile` with seeded `settings/stage-model` → synthetic
`.pmx`, `QT_QPA_PLATFORM=offscreen`), executed in the throwaway `/tmp` copy
with the full integration applied there (including the §5.5 `main.rs`
smoke-leg patch). The synthetic `test-model.pmx` is a byte-identical
stand-in of `tests/rest_pose.rs`'s fixture (6 vertices, 2 triangles,
2 materials, 2 bones; texture reference `textures/body.png` intentionally
missing on disk → counted, not fatal). Full log:

```
[airi-qt] starting v0.1.0, profile=/tmp/opencode/smoke-mmd/profile smoke=true
[airi-qt] store ready at /tmp/opencode/smoke-mmd/profile/airi.sqlite
…
[airi-qt] mmd: model loaded: /tmp/opencode/smoke-mmd/test-model.pmx (primitive_count=2, sdef_approximated=0, invalid_joints=0, face_mismatch=false)
[airi-qt][Qt] [airi-qt] stage: primitive 0 -> material 0 (ok verts)
[airi-qt][Qt] [airi-qt] stage: primitive 1 -> material 1 (ok verts)
[airi-qt] smoke: visited stage
[airi-qt][Qt] The Qt Quick scene is using a rendering method that is not based on QRhi and a 3D graphics API. Qt Quick 3D is not functional in such an environment. The View3D item is not going to display anything.
[airi-qt][Qt] [airi-qt] stage: mmd scene ticks ok, model=/tmp/opencode/smoke-mmd/test-model.pmx
[airi-qt] smoke: pages visited: splash, control-strip, chat, settings, about, stage
[airi-qt] smoke: chat outcome: done (2 deltas applied)
[airi-qt] smoke: stage skinAndMorph ticks: 30
```

exit code **0**. The "Qt Quick 3D is not functional in such an environment"
warning is expected offscreen noise (no QRhi); it applies equally to the VRM
path and does not affect the load/tick assertions. The smoke tour's stage leg
passed because `bridges::mmd::smoke_skin_ticks()` reached 30 through the
`main.rs` patch (§5.5) — **without it the MMD smoke exits FAILURE**.

What this proves: PMX bytes → parser → `RestPoseEngine` → cxx-qt bridge →
QML `AiriVrmGeometryShell` buffer setup → frame-timer tick loop — the whole
M1 path, end to end, headlessly. What it does not prove: a single pixel, any
real model, or correct visual orientation.

## 8. Cross-refs and integration asks

- Design: `apps/airi-qt/docs/phase-notes/p10-mmd-design.md` (M1 row),
  `p10-lane-mmd-m0.md` (parser API, SDEF policy), `p10-lane-mmd-m1.md` (this).
- Engine fixture extension policy: `tests/rest_pose.rs` is self-contained;
  `tests/common/mod.rs` and the existing synthetic fixtures are untouched and
  remain green.
- Central session: apply §5 steps 1–6, then update this note's §3/§7 and mark
  the StageWindow patch as applied (commit or file-history will show it).
  **Do not** edit `apps/airi-qt/crates/airi-mmd/**` from the integration
  session unless the smoke run exposes a defect — report back to this lane.
- For a real-model smoke: `AIRI_TEST_MMD_MODEL=/path/to/model.pmx cargo test
  -p airi-mmd live_` (parser level), plus the §5.6 recipe (bridge level).
- i18n: none added; none expected. If M2 adds user-visible strings, report
  keys to the locale lane instead of editing `packages/i18n` here.
