# P10 Lane J1 — `airi-mmd` crate: M0 remaining scope (VMD parser, synthetic round-trip, live-test gating)

Status: **M0 (parser headroom) complete.** The PMX morph section is now decoded, the
VMD reader landed, the 14 repo VMDs parse, and the env-gated live tests exist.
Everything past parsing (rendering, IK/physics evaluation, animation) is still ahead;
this note covers exactly what was built and verified.

Lane scope: `crates/airi-mmd/**` only. Nothing else in the workspace was touched by
this lane. `apps/airi-qt/Cargo.toml` / `Cargo.lock` were already modified before this
lane (workspace registration) and are untouched by it. `cargo fmt`, `cargo clippy
--all-targets -D warnings`, `cargo test` are all green (run 2026-11-11).

Crate: `apps/airi-qt/crates/airi-mmd` (workspace member already registered).

## What landed

### 1. VMD parser — `src/vmd.rs`

```rust
VmdMotion::parse(bytes: &[u8]) -> Result<VmdMotion, MmdError>
VmdMotion::from_path(path) -> Result<VmdMotion, MmdError>   // convenience
motion.signature: String            // "Vocaloid Motion Data 0002"
motion.legacy_signature: bool       // true for 0000/0001 (parsed, unverified)
motion.model_name / .model_name_raw // 20-byte CP932 model name field
motion.bones: Vec<VmdBoneKey>       // .name/.name_raw, .frame, .position,
                                    // .rotation (quat xyzw as stored), .interpolation [u8;64]
motion.morphs: Vec<VmdMorphKey>     // .name/.name_raw, .frame, .weight
motion.camera_count / .light_count / .shadow_count: u32   // records skipped, counts stored
motion.trailing_bytes: usize        // IK on/off section, never decoded
motion.bone_frame_range() -> Option<(u32, u32)>
```

Wire layout verified **against all 14 repo VMDs and against three-stdlib's
`mmdparser.js`** (the engine AIRI's Vue stage actually runs):

```
30-byte NUL-padded signature "Vocaloid Motion Data 0002"
20-byte NUL-padded model name (CP932)          ← the design note missed this field
u32 bone-key count; per key: 15-byte name | u32 frame | 3×f32 pos |
  4×f32 quaternion (xyzw as stored) | 64 bytes interpolation          (111 B/key)
u32 morph-key count; per key: 15-byte name | u32 frame | f32 weight   (23 B/key)
u32 camera-key count; per record: 61 bytes (frame | f32 distance | 3×f32 target |
  3×f32 rotation | 24 B interpolation | u32 fov | u8 perspective)     — skipped
u32 light-key count; per record: 20 bytes (frame | 3×f32 color | f32 intensity) — skipped
u32 shadow-key count; per record: 9 bytes (frame | u8 mode | f32 distance) — skipped
…trailing bytes (the IK on/off section — never decoded; see below)
```

Deviations from the design note (`p10-mmd-design.md` §VMD parser strategy), all
verified against the bytes, not assumed:

- **The 20-byte model-name field after the signature exists.** Without it every one
  of the 14 repo VMDs misparses by 20 bytes. three-stdlib reads it as a CP932 string
  too.
- **Camera records are 61 bytes, not 56.** The design note's 56 drops the trailing
  `fov u32 + perspective u8` (five bytes). three-stdlib reads 61. **All 14 repo VMDs
  carry `camera_count == 0`, so this is verified against the vendored parser only,
  not against any real camera-containing file.**
- **The trailing IK on/off section exists in 13 of 14 files** (only
  `circulation.vmd` ends after the light/shadow counts). Layout, decoded empirically
  across all 14 files: `u32 lightCount (=0)` + `u32 shadowCount (=0)` +
  `u32 numBatches (=2)`; per batch: `u32 batchFrame` (observed 0 in batch 1) +
  `u8 01` + `u32 keyFrame` (equal to the frame of the enabled record — 1/4/5/6
  observed), then N records of `15-byte name` + `u32 frame` +
  `u8 on/off` + `u8 pad 01` = **21-byte stride**, NUL-padded CP932 names
  (`右足ＩＫ`, `右つま先ＩＫ`, `TailIK`, …), disabled records carrying uninitialized
  frame bytes (`00 00 00 01` in most files; `0xFDFDFDFD` in
  `impatient_foot_tapping.vmd` / `crossed_arms_look_around_confident.vmd`), and the
  file ends with `00 00 00 00 01`. Batch 2's keyframe values observed: 240/270/300/
  330/360/390/510 (usually — not always — the motion's final frame).
  **The file stores no record count anywhere and batch boundaries are not reliably
  delimitable; the on/off records carry no frame data AIRI consumes. The section is
  therefore parsed-and-discarded as opaque trailing bytes and reported only as
  `trailing_bytes`.** A future lane that wants this section needs a hexdump-verified
  decoder; don't infer one.
- **Signature `0000`/`0001`**: tolerated (parse proceeds, `legacy_signature = true`,
  camera records skipped with the design note's 56-byte legacy record size). Unverified —
  no `0000`/`0001` file exists in-repo. Garbage signatures fail with
  `MmdError::BadVmdSignature`.
- **CP932 caveat:** VMD names are CP932 (Shift-JIS) on the wire. This crate
  deliberately does **not** add `encoding_rs`; names are decoded ASCII-lossily
  (non-ASCII bytes → U+FFFD) and the raw 15 bytes are preserved in `name_raw`.
  ASCII names (`TailIK`, `HairIK`, …) decode exactly; Japanese names
  (`右足ＩＫ`) come out as mojibake in `name` — recover via `name_raw`.
- **Nothing is validated semantically.** Quaternion norms, frame monotonicity, and
  bone-name resolution against a model are *not* checked (a VMD is meaningless
  without its model). Tolerant by design; bounds checks still apply to every read;
  `parse` never panics (truncation sweep + 512-iteration mutation sweep in tests).
- **Camera/light/shadow records are skipped, not decoded** — their counts are stored.
  Light (`u32 count + count×20`) and shadow (`count×9`) sections are read only when
  ≥ 8 trailing bytes remain after cameras; `circulation.vmd` ends with a single
  ambiguous 4-byte `00 00 00 00` which is tolerated as opaque `trailing_bytes`
  (light=shadow=0, trailing=4) rather than guessed at.

### 2. PMX morphs — now decoded (previously `UnsupportedFeature("morphs")`)

`MmdModel` gains `pub morphs: Vec<MmdMorph>`; each morph carries `name`,
`name_global`, `panel` (raw byte), `morph_type` (raw byte) and typed
`offsets: Vec<MmdMorphOffset>`. Group/vertex/bone/UV/material (types 0–3, 8) were
verified against three-stdlib; index signedness per element is as on the wire
(vertex/UV indices unsigned; group/bone/material signed).
Validation: group members must reference an existing morph; vertex/UV
indices must reference an existing vertex; bone indices `-1` allowed or must reference
an existing bone; material indices `-1` ("all materials") allowed or must reference an
existing material. Layout of **additional-UV morphs (types 4–7)** is parsed
spec-consistently as `vertex index + vec4` but **cannot be verified** (three-stdlib
does not decode them); **flip/display-frame morphs (types 9, 10) return
`MmdError::UnsupportedMorphType(u8)`** because no layout is confirmed.
Two-pass validation runs after the morphs section is complete (forward references
within the section are legal).

Display frames, rigid bodies and joints (everything after morphs) are still never
read; a file that ends right after morphs is equally valid (asserted by
`synthetic_model_survives_trailing_section_garbage`).

### 3. Synthetic PMX round-trip — `tests/synthetic_pmx.rs` + `tests/common/mod.rs`

The in-test fixture writers moved to `tests/common/mod.rs` (shared between the PMX
and VMD test binaries). The synthetic model is small-but-valid PMX 2.0: **4 vertices**
(BDEF1), 1 triangle, 1 texture, **1 material**, **2 bones** (parent `センター`/
`center` ← child `足`/`leg`, `parent_index = 0`), **1 vertex morph** (2 offsets,
positions `(0.25,0,0)` / `(0,0.5,0)` on vertices 0 and 1) and **1 group morph**
(`笑顔`/`smile`) referencing it (`morph_index = 0`, `weight = 1.0`). The file ends
with the display-frames / rigid-bodies / joints zero counts as a real PmxEditor
export would; the parser never reads them.
Round-trip assertions: version/encoding/name, vertex count + positions, face
indices, texture + material indices, bone parent id, morph count, vertex-morph
offsets exact, and group-morph **membership** resolves to the vertex morph by name.

Honest coverage note: everything is BDEF1, UTF-8 only, one material, no IK/grant
bones, no additional UVs, no rigid bodies, no SDEF/BDEF4 weights (those are covered
by `pmx_parse.rs` instead). Like the M0 fixtures, the fixture is author-verified by
the parser that consumes it — it can catch regressions and field-order drift in the
writer↔reader pair, but **it cannot prove agreement with a real PmxEditor file**; no
real `.pmx` exists in-repo and none may be committed without a license review.
Additional-UV morph layout and flip/display-frame morphs remain unverified for the
same reason.

### 4. Live tests — `tests/live_model.rs` (all silently skipped when env unset)

- `live_model_loads_from_env` — `AIRI_TEST_MMD_MODEL=/path/to/model.pmx`: parses,
  asserts non-empty vertices/bones/materials, eprints counts.
- `live_zip_loads_from_env` — `AIRI_TEST_MMD_ZIP=/path/to/package.zip`: extracts the
  archive to a per-process temp dir (zip-slip-safe via `enclosed_name`), finds the
  first `.pmx` inside, parses it, asserts non-empty, cleans the temp dir up.
  Uses the `zip` crate as a **dev-dependency only** (`zip = { workspace = true }`) —
  the crate's normal dependency surface is unchanged.
- `live_vmd_companion_loads_from_env` — when `AIRI_TEST_MMD_MODEL` is set, additionally
  parses `swaying_arms_and_hips.vmd` from the repo to report its frame range
  (informational; never fatal).

No model is committed; none is downloaded; none may be.

## Test evidence (run 2026-11-11)

```
cargo test -p airi-mmd                                     # all green
cargo clippy -p airi-mmd --all-targets -- -D warnings      # clean
cargo fmt -p airi-mmd --check                              # clean
```

31 tests total: `pmx_parse` 14 (pre-existing; one test renamed —
`morphs_declared_but_absent_returns_truncated` replaces
`morphs_present_aborts_parse`; the fixture machinery moved into
`tests/common/mod.rs`) + `vmd_parse` 10 (incl. `repo_vmds_all_parse` and the
mutation sweep) + `synthetic_pmx` 3 + `live_model` 3 + 1 doctest.

### The 14 repo VMDs (all parse; ≥ 1 bone key each; frame ranges as printed)

| File | Bones | Morphs | Frame range | trailing B |
|---|---|---|---|---|
| brushoff_nice_and_tidy.vmd | 726 | 120 | 0–330 | 190 |
| circulation.vmd | 25975 | 2344 | 0–5639 | 4 |
| crossed_arms_look_around_confident.vmd | 552 | 131 | 0–240 | 190 |
| fixing_hair_or_wig.vmd | 2333 | 65 | 0–330 | 190 |
| getting_item_out_of_bra.vmd | 1508 | 64 | 0–330 | 190 |
| hat_flip.vmd | 1419 | 169 | 0–510 | 190 |
| impatient_foot_tapping.vmd | 708 | 98 | 0–240 | 190 |
| shy.vmd | 3394 | 125 | 0–270 | 190 |
| skittish_mermay.vmd | 546 | 144 | 0–360 | 64 |
| smelling_something_in_the_air.vmd | 1505 | 153 | 0–300 | 232 |
| something_in_the_sky.vmd | 1097 | 174 | 0–330 | 190 |
| stretching.vmd | 977 | 82 | 0–210 | 190 |
| swaying_arms_and_hips.vmd | 1596 | 121 | 0–390 | 190 |
| tracker.vmd | 1332 | 83 | 0–390 | 274 |

All carry `camera_count == light_count == shadow_count == 0`. Every file parses;
zero are skipped; zero files found was not applicable. CP932 names appear in all of
them (e.g. `右足ＩＫ`) — decoded ASCII-lossily to mojibake by design, raw bytes kept
(see CP932 caveat above).

## What this crate still does not do (unchanged from M0)

- **No real `.pmx` was ever parsed.** Unchanged; live tests exist but are
  env-gated and were not run here (no license-clean model on this machine).
- Physics — never simulated; IK data decoded+stored, never evaluated; QDEF →
  `UnsupportedDeformType(4)`; PMD — `BadMagic`; PMX 2.1 — `UnsupportedVersion(2.1…)`.
- Additional-UV morphs (4–7) parse spec-consistently but are unverifiable in-repo;
  flip/display morphs → `UnsupportedMorphType`.
- Display frames, rigid bodies, joints — never read; file may end anywhere after morphs.
- The VMD IK on/off section — never interpreted (see §1).
- Camera record size (61 B) and 0000/0001 legacy layout are source-verified only
  (three-stdlib), not fixture-verified — no repo VMD carries camera keys.
- SDEF remains BDEF2-approximation-at-render-time policy, unchanged; the warning
  counter stays with the renderer lane.
- Unused declared deps (`serde`, `serde_json`, `tracing`) remain for later milestones.

## Integration asks (none beyond this crate)

For the M1 rendering lane and whoever picks up the morph/IK work later:

1. **VMD names are CP932.** Any CP932-aware display/search of bone/morph names needs
   `name_raw`, or an `encoding_rs` decision at that time. Quaternions are as stored
   (`xyzw`); frame range is available via `bone_frame_range()`.
2. **Group morphs expand the weighted sum at evaluation time** (weight as stored;
   absolute weights not normalized). Vertex-morph offsets are **additive** relative
   offsets.
3. **`trailing_bytes` ≠ parsed IK.** If IK-on/off playback is ever desired, the
   section needs a fresh decode effort — don't reuse this lane's discovery as a
   format spec without re-verifying.
4. **Camera playback** would need the 61-byte camera decode (position target,
   rotation euler, fov, perspective) plus the 64-byte interpolation curves — trivial
   to add given the cursor is already in place; currently counted and discarded.
5. Live tests are wired and silent; run `AIRI_TEST_MMD_MODEL=… cargo test -p airi-mmd live_`
   on a machine with a license-clean model before any M1 desk check.
6. Workspace registration (`Cargo.lock`) was already dirty before this lane; no
   `Cargo.toml` change from this lane except the dev-only `zip`.

Cross-refs: `docs/phase-notes/p10-mmd-design.md` · `p10-lane-mmd.md` ·
`crates/airi-mmd/` (`src/{vmd,pmx,model,error,cursor}.rs`, `tests/`).
