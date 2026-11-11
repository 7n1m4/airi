<!-- SPDX-License-Identifier: GPL-3.0-or-later -->

# airi-mmd

MMD (MikuMikuDance) parsers for AIRI's Qt stage — the P10 **M0 (parser)** milestone.
Pure Rust, no Qt dependency. It decodes **PMX 2.0** models and **VMD** motions into
typed Rust structures. It does **not** render, load textures, simulate physics,
evaluate IK, or animate; those land in later P10 milestones.

## What parses

- PMX 2.0: header (magic, `f32` version = 2.0, encoding flag, index sizes),
  vertices (BDEF1/BDEF2/BDEF4/SDEF), faces, textures, materials, bones
  (incl. IK definitions and rotation/translation inheritance), morphs
  (group/vertex/bone/UV/material).
- VMD: signature (`Vocaloid Motion Data 0000/0001/0002`; `0000`/`0001` parsed with an
  unverified legacy 56-byte camera record size), model name, bone keys
  (position, rotation quaternion, 64-byte interpolation), morph keys. Camera,
  light and shadow sections are skipped — their counts are stored, records are not
  decoded. The trailing IK on/off section is never interpreted.

Everything bounds-checked; parsing an untrusted buffer never panics. Allocation is
capped on hostile input (`MAX_*` constants in `src/model.rs` / `src/vmd.rs`).

## Not supported (by design)

- PMD, PMX 2.1, QDEF, flip/display-frame morphs (`UnsupportedMorphType`).
- Display frames, rigid bodies, joints (bytes after the morphs section are never read).
- Physics simulation, IK evaluation.
- CP932 decoding. VMD bone/morph names are CP932 on the wire; this crate has no
  `encoding_rs` dependency and decodes ASCII-lossily, preserving the raw 15 bytes in
  `name_raw` (Japanese names appear as mojibake in `name`).

## Live tests

Env-gated; silently skipped when unset. No model is committed or downloaded — the
user supplies one locally (MMD models are usually redistribution-restricted):

```sh
AIRI_TEST_MMD_MODEL=/path/to/model.pmx cargo test -p airi-mmd live_
AIRI_TEST_MMD_ZIP=/path/to/package.zip cargo test -p airi-mmd live_   # PMX inside a ZIP
```

`AIRI_TEST_MMD_ZIP` extracts to a per-process temp directory (zip-slip-safe), parses
the first `.pmx` found, and cleans up. The `zip` crate is a **dev-dependency only**.

## Verification

```sh
cargo test -p airi-mmd
cargo clippy -p airi-mmd --all-targets -- -D warnings
cargo fmt -p airi-mmd --check
```

The test suite iterates over the 14 `.vmd` motions vendored in this repo
(`apps/stage-tamagotchi/src/renderer/public/assets/mmd/animations/`) and asserts each
parses; it fails if the directory is empty or missing.

See `apps/airi-qt/docs/phase-notes/p10-lane-mmd-m0.md` for the full fixture strategy
and honesty notes (what is verified vs assumed).
