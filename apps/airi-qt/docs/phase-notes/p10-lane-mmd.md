# P10 Lane F — `airi-mmd` crate: PMX 2.0 parser (P10 M0)

Status: **M0 (parser headroom) complete for the PMX side.** VMD/PMD readers,
the 14 repo VMDs, live-model tests, and everything past parsing are still
ahead of us; this note covers exactly what was built and verified.

Crate: `apps/airi-qt/crates/airi-mmd` (workspace member already registered).
Owns nothing else; no workspace/`Cargo.toml`, QML, or `packages/**` files were
modified. `Cargo.lock`/`apps/airi-qt/Cargo.toml` were already modified before
this lane (workspace registration) and are untouched by me.

## Module layout

```
crates/airi-mmd/
  Cargo.toml            thiserror (workspace); serde/serde_json/tracing declared, unused so far
  src/
    lib.rs              crate docs, `#![deny(missing_docs)]`, `from_bytes`, re-exports
    error.rs            `MmdError` (thiserror)
    model.rs            typed document structs, limits, flag bitfields
    cursor.rs           bounds-checked little-endian cursor; lossy string decode
    pmx.rs              PMX 2.0 reader (stops after bones)
  tests/
    pmx_parse.rs        byte-built fixtures, 14 tests
```

Public API (close to the mandated shape): `MmdModel { name, name_global,
comment, comment_global, version, encoding, vertices, faces, textures,
materials, bones }`, `MmdVertex { position, normal, uv, edge_factor, deform }`,
`Deform::{Bdef1([i32;1]), Bdef2([i32;2],[f32;2]), Bdef4([i32;4],[f32;4]),
Sdef{…}}`, `from_bytes(&[u8]) -> Result<MmdModel, MmdError>`, `MmdError::{Truncated{at},
BadMagic, UnsupportedVersion(f32), UnsupportedDeformType(u8),
UnsupportedFeature(&'static str), InvalidData(&'static str), Io(io::Error)}`,
plus `MmdModel::from_path` and `pub const` limits (`MAX_VERTICES = 1M`,
`MAX_FACE_INDICES = 5M`, `MAX_BONES/MAX_MATERIALS = 4096`, …).
`faces` are `[u32; 3]` unsigned triangles (PMX stores unsigned face indices;
signed everywhere else).

## PMX layout: what the design note / lane brief say vs what the bytes do

Ground truth used: `p10-mmd-design.md` **and** the vendored `three-stdlib`
`mmdparser.js` (`node_modules/.pnpm/three-stdlib@2.36.1…/libs/mmdparser.js`),
which is what AIRI's Vue stage actually runs, plus the design note itself. No
`.pmx`/`.pmd` exists in-repo to test against — **all fixtures are constructed;
no real-model smoke test has been run** (see Limits).

Header (offsets, all LE):

| Off | Field | Brief said | Reality (verified) |
|---|---|---|---|
| 0 | magic `"PMX "` (4) | ✓ | ✓ |
| 4 | **`f32` version** | brief: `u8 major (=2)` + `u8 minor (=0)` | **float32 `2.0`** — three-stdlib reads `getFloat32()` and the design note (line 22) says `f32` too; brief's `u8/u8` is wrong |
| 8 | `header_size` u8 (=8) | ✓ (=8) | read and intentionally ignored (fixed layout) |
| 9 | `encoding` u8 | ✓ 0=UTF-16LE, 1=UTF-8 | ✓ (trusted, never sniffed) |
| 10 | `additional_uv_count` u8 | "additionalVecCount" | ✓, and each additional UV is a **vec4** (16 B) per vertex, not a single f32 |
| 11–16 | vertex/texture/material/bone/morph/rigidbody index sizes | ✓ | ✓ each must be 1/2/4 |
| 17 | 4× length-prefixed strings (model name, name-global, comment, comment-global) | ✓ | ✓ `i32` **byte** length + bytes |

Other deltas from the brief worth knowing:

- **Faces** store a raw **index count, divisible by 3**; indices are unsigned
  (`u8/u16/u32` per `vertexIndexSize`). Brief's "u16 or i32 per index" is
  incomplete (size 1 exists; sign reading differs). We reject non-multiples of
  3 and out-of-range indices with `InvalidData`.
- **Bones carry no rest quaternion.** They store names, `position f32×3`,
  `parent i32`-sized index (-1 = none), `layer` (**4 bytes**), `flags u16`,
  tail (offset `f32×3` or bone index per flag `0x0001`),
  grant/fixed-axis/local-axes/external-parent blocks per flags, and the IK
  definition (effector index, iteration u32, maxAngle f32, link count, links
  with optional per-link angle limits). The brief's "rotation f32×4" and
  "tail/effector" framing were wrong; the design note's bone section matches.
- Bone flag ground truth (from three-stdlib, mirrors mmdparser): `0x0001`
  tail-is-bone, `0x0002` rotatable, `0x0004` translatable, `0x0008` visible,
  `0x0010` enabled, `0x0020` IK, `0x0080` grant-local-frame, `0x0100`
  grant-rotation, `0x0200` grant-translation, `0x0400` fixed axis,
  `0x0800` local axes, `0x2000` external-parent key. The grant block is
  emitted when `0x0100|0x0200` is set (not when `0x0080`); `0x0080` only
  controls the local/global evaluation frame.
- **Materials**: names ×2, diffuse RGBA, specular RGB, shininess f32, ambient
  RGB, drawing flags u8, edge RGBA, edge size f32, **texture index** (texture
  index size, signed), **sphere index** (same size), **sphere mode** u8 (0
  none / 1 multiply `.sph` / 2 add `.spa`), **toon mode** u8 (0 = texture
  index, 1 = built-in ramp id u8), memo string, then raw vertex-index count.
- **SDEF** carries **three** vectors (C, R0, R1) plus indices and weight;
  `Deform::Sdef { indices, weights, c, r0, r1 }` keeps all of them. The
  brief's `[f32; 3]` abbreviation would have thrown away R0/R1, which exact
  SDEF skinning (and the BDEF2 fallback debugging) needs.
- **Counts are `u32`** everywhere (vertex/face/texture/material/bone/morph).
  We cap allocations (`MAX_VERTICES` 1M, `MAX_FACE_INDICES` 5M, etc.) *before*
  reserving, and validate index sizes, face-count divisibility, face-index
  range, and IKs link counts.
- **Version is `f32`**, so `MmdError::UnsupportedVersion(f32)` (not `u8`).
  Only exactly `2.0` is accepted; 2.1/PMD/others are typed errors.
- Strings decode lossy (U+FFFD on bad sequences); a mojibake byte cannot sink
  a model. Length prefixes are byte counts; UTF-16 lengths are sanity-checked
  for evenness.
- After bones comes **morphs**; a non-zero morph count aborts with
  `UnsupportedFeature("morphs")`. Display frames, rigid bodies and joints are
  never interpreted (zero-morph files parse fine and simply carry no morph
  information).

## What parses

Header; names/comments (both encodings); vertices (BDEF1/BDEF2/BDEF4/SDEF,
additional-UV sets bounds-checked and skipped, edge factor); faces
(`[u32; 3]`, validated); textures (raw strings); materials (all fields incl.
sphere and both toon modes); bones (names, parent, layer, position, tail,
grant data, fixed axis, local axes, external-parent key, full IK definition
with per-link angle limits). `cargo test` proves every one of those fields
from constructed fixtures.

## What explicitly does not parse (no misparse, by design)

- **Morphs** (incl. group/vertex/UV/material morphs) — `UnsupportedFeature("morphs")`
- **Display frames, rigid bodies, joints** — never read (after-bones sections)
- **Physics** — nothing simulated; **IK** — decoded and stored, never evaluated
- **QDEF** deform type — `UnsupportedDeformType(4)` (and any other unknown byte)
- **PMX 2.1** — `UnsupportedVersion(2.0999999…)`; **PMD** — `BadMagic`
- **.vmd motion** — out of scope this milestone
- **Texture loading / path resolution / toon ramps** — strings are stored raw,
  never resolved or opened

## Fixture-construction approach

No binary blobs in git. `tests/pmx_parse.rs` builds fixtures byte-by-byte with
small writers (`w_f32`, `w_index_signed`, `w_str` with both UTF-8 and
UTF-16LE encodings, …). The standard fixture is a 4-vertex model covering
BDEF2 (weights asserted to expand `w → [w, 1−w]`), BDEF4, BDEF1 and SDEF
(C/R0/R1 asserted), one triangle, one texture, two materials (built-in-toon
and toon-by-texture, sphere off/add, texture/sphere indices incl. -1), two
bones (root with tail-offset, child with tail-as-bone-index) and zero morphs;
the `additional_uv = 4` variant writes sentinel vec4s so a parser that
misreads the stride trips. UTF-16LE fixture asserts full string/name equality
(Japanese model name and UTF-16-specific paths). Malformed-input coverage:
bad magic (both encodings), unsupported version, unknown deform byte, face
index count not divisible by 3, face index out of range, invalid index-size
byte, non-zero morph count, invalid IK angle-limit flag, empty input, plus an
**exhaustive truncation sweep** (every byte prefix) and a 512-iteration
**mutation sweep** (seeded xorshift, 8 byte flips per round) — neither may
panic. IK decode and grant (inherit) decode have their own fixtures.

## Test evidence (run 2026-11-10)

```
cargo test -p airi-mmd                     # 14 passed; 0 failed (+1 doctest)
cargo clippy -p airi-mmd --all-targets -- -D warnings   # clean
cargo fmt -p airi-mmd --check              # clean
```

Tests: `parses_utf8_minimal_model`, `parses_utf16le_minimal_model`,
`truncated_input_reports_typed_error`, `bad_magic_returns_typed_error`,
`unsupported_version_returns_typed_error`, `unsupported_deform_type_returns_typed_error`,
`morphs_present_aborts_parse`, `face_count_not_multiple_of_three_returns_error`,
`face_index_out_of_range_returns_error`, `invalid_index_size_returns_error`,
`grant_and_ik_bones_decode`, `ik_link_angle_limit_flag_invalid_returns_error`,
`every_truncation_prefix_returns_without_panicking`, `mutated_bytes_never_panic`.

## Limits

`MAX_VERTICES = 1_000_000` · `MAX_FACE_INDICES = 5_000_000` ·
`MAX_TEXTURES = 10_000` · `MAX_MATERIALS = 4_096` · `MAX_BONES = 4_096` ·
`MAX_IK_LINKS = 256` per IK bone · `MAX_ADDITIONAL_UV = 16`. All allocation
happens after these checks; every read goes through a bounds-checked cursor.

## Known gaps / honesty section

- **No real `.pmx` was ever parsed.** The layout was verified against
  three-stdlib's mmdparser and the design note, not against a shipping model
  (none exists in-repo; none may be committed without license review). First
  contact with a real model may expose a wrong field order somewhere; the
  constructed fixtures cannot catch that class of error. An
  `AIRI_TEST_MMD_MODEL` env-gated live test belongs in M1+ (noted for the
  renderer lane) and needs a user-supplied model.
- UTF-8 "PMX 2.0" files with invalid byte sequences decode lossy by design;
  nothing is logged (no logger in this crate yet).
- Material `vertex_count` is stored raw (raw index count, multiple of 3);
  has not been cross-checked against PmxEditor output on a real file.
- `header_size` is ignored rather than used to skip — intentional.
- `Deform::Sdef` keeps R0/R1 (extension of the sketched API); renderer lane
  must pick the BDEF2-approximation policy for SDEF.
- Unused deps (`serde`, `serde_json`, `tracing`) are still declared from the
  stub; harmless workspace deps, kept for the PMX renderer/M1 lanes.

## Integration asks

None beyond this crate. The renderer lane (M1/M2) will need: (1) SDEF
fallback policy, (2) additional-UV storage if material morphs need them,
(3) a decision on whether `airi-mmd` exports the raw flag bitfields (they are
exported as `bone_flags`/`material_flags`/`sphere_mode` modules today),
(4) the `AIRI_TEST_MMD_MODEL` env-gated live test when a license-clean model
is available. Workspace registration was already done by the delegator;
`Cargo.lock` was already dirty. No CMake/QML/C++ changes required.

Cross-refs: `docs/phase-notes/p10-mmd-design.md` · `crates/airi-mmd/`.
