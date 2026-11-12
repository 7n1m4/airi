# P3→P4 merge — Spine hosted in the stage window

Status: **wired and headlessly verified**; GUI eyeball not done (needs a desktop with the smoke asset or a real spine export).

## What was wired

`apps/airi-qt/qml/stage/StageWindow.qml` (P3 lane file) — additive only, VRM path untouched for `.vrm`/empty:

- `settings/stage-model.modelId` is re-read every second (existing poll timer; now via `StageSettingsController.loadAll()`). Selection by file extension (case-insensitive): `.json` / `.skel` / `.atlas` / `.zip` → spine mode; everything else (incl. `.vrm` and empty → bundled VRM default) stays on the VRM `View3D` path.
- New `SpineStage` hosted as a sibling of the `View3D`; it is `anchors.fill: parent` and `visible` only in spine mode; `View3D` is hidden in spine mode. `SpineStage.modelPath` is set from the configured id in `Component.onCompleted` and on every settings change; `loadModel()` is called there, which auto-plays the idle loop.
- Empty state now also shows when spine mode fails to load (`spineStage.loaded == false`); VRM mode behavior unchanged.
- Status chip: spine mode shows `spine · model=<id> [ (load failed)]`; VRM mode unchanged.
- `frameTimer` still calls `controller.skinAndMorph(16.0)` unconditionally — it doubles as the smoke-tour tick counter (increments even with no VRM engine), so the smoke gate keeps working regardless of which model kind is configured.
- Gaze `lookAt` / `clearLookAt` calls are kept (no-op without a VRM engine, verified in `bridges/stage.rs`).

`apps/airi-qt/qml/spine/SpineStage.qml` (P4 lane file) + `bridges/spine.rs` (P4 lane):

- cxx-qt emits invokables **snake_case verbatim** unless `cxx_name` is given. Originally the file called `controller.loadModel(...)` and could not instantiate (`TypeError ... is not a function`). I first changed it to `controller.load_model(...)`; the P4 lane then added `#[cxx_name = "loadModel"]` / `"setSkin"` to the bridge invokables (matching the `stage.rs` convention) and renamed the call back to `controller.loadModel(path)`. Final state: camelCase on both properties (`maxFps`, `renderScale`, `mixSeconds`, `modelPath` — P4 lane added `cxx_name` to the `qproperty`s mid-merge) and invokables. No QML property-name asymmetry remains.

## What is verified

Headless only:

- `cargo build -p airi-qt` → OK (also after P4 lane's invokable `cxx_name` addition).
- `cargo test --workspace` → OK (13 suites green; one transient E0015 in `spine_rt.rs` during the run was a concurrent-clippy-lane build artifact — not reproducible, workspace green on rerun; my change touches no Rust).
- `cargo run -p airi-qt -- --smoke` (fresh temp profile, bundled VRM default) → **exit 0**; pages visited incl. `stage`; `stage skinAndMorph ticks: 30` (re-confirmed after P4 lane's cxx_name change).
- `cargo run -p airi-qt -- --smoke --profile <pre-seeded with `settings/stage-model.modelId = <repo>/apps/airi-qt/assets/test-models/synthetic/synthetic.zip`>` → **exit 0**; log shows `[airi-qt][spine] asset parsed ok (.../synthetic.zip), animation [idle] at t=0.000s` and `stage: spine model=... loaded=1`; no VRM model load attempted; no QML errors; stage window created and visited. Re-confirmed after P4 lane's cxx_name change.
- Geometry persistence, hide-not-destroy, caption overlay, close button, drag/Gaze handlers: untouched code paths (shared anchors/handlers sit above both scenes).

## What is NOT verified

- **GUI eyeball**: no screenshot/visible render of the synthetic spine blob on the desktop. The `SpineItem` scene-graph path (texture upload in `updatePaintNode`, Qt 6.12) remains unverified on a real compositor — same caveat as the P4 notes.
- Spine mode beyond load+idle auto-play: no poke/emotion/skin switching exposed in the stage window (deliberately minimal).
- Live model switching between VRM and spine at runtime exercised only via the same code path as the poll timer logic (not clicked through UI).

## What a user must do to see the spine model

1. Use a spine bundle the compiled runtime supports (default `4.2`; `.skel` from other editor majors hard-errors by design). A `.zip` containing atlas + skeleton + textures is the supported entry point (loose `.json`/`.skel`/`.atlas` *file paths* are routed to the spine stage by extension, but `ModelBundle::open` effectively requires a zip bundle or a directory containing the spine entries — single loose files will fail to load and show the empty state).
2. Open Settings → Stage, paste the absolute path into the model-path field (the settings page lists `.vrm` files only; the manual path field accepts any path), save.
3. Open/show the stage window. The bundled test asset is at `apps/airi-qt/assets/test-models/synthetic/synthetic.zip` (animated coral blob, idle wave) — license-clean, synthetic.

## Smoke gate decision

Left as-is per scope: the smoke tour runs with a fresh profile (no spine asset configured) and asserts VRM `skinAndMorph` ticks ≥ 30. No fake spine assertion was added. With a spine `modelId` pre-seeded in the smoke profile, the same tour passes (exit 0, spine logs `loaded=1`); extending the gate to *require* a spine asset would need CI/pre-seed wiring that does not exist yet.

## Deviations / notes

- `SpineStage.qml` touched (1 line) although outside the nominal file list — required for the counterpart to instantiate at all; coordinated with `p4-spine`, who added `cxx_name` to the invokables and reverted the call to `loadModel`.
- Empty-modelId → bundled VRM default unchanged; VRM drag/gaze/bounds/caption behavior unchanged.
- In spine mode the VRM engine is not loaded (no wasted VRM load); `skinAndMorph` still ticks because of the smoke counter. A previously loaded VRM engine (switch without restart) stays in memory, hidden.
- Status chip shows a plain English "spine · model=…" string, consistent with the existing hardcoded bridge status strings; no i18n keys added.
- The intermittent E0015 (`SpineState::default` in statics) observed once in `cargo test --workspace` came from the concurrent clippy lane's shared target dir; not caused by, and not reproducible from, this change.
