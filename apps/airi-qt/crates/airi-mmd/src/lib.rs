// SPDX-License-Identifier: GPL-3.0-or-later
#![deny(missing_docs)]

//! `airi-mmd` — MMD model parsers for the P10 renderer.
//!
//! This crate is the P10 **M0 (parser)** milestone for AIRI's Qt stage. It
//! decodes PMX 2.0 binary models and VMD motions into typed Rust structures.
//! It does **not** render, load textures, simulate physics, evaluate IK, or
//! animate; those land in later P10 milestones.
//!
//! What parses today:
//!
//! - Header (magic, `f32` version = 2.0 only, encoding flag, index sizes)
//! - Model name / comment (local + global), length-prefixed strings in
//!   UTF-16LE or UTF-8 (the flag is trusted, never sniffed)
//! - Vertices (position, normal, UV0, additional UV sets skipped over,
//!   BDEF1/BDEF2/BDEF4/SDEF deform, edge factor)
//! - Faces (unsigned indices, stored as `[u32; 3]` triangles)
//! - Textures (raw path strings, not resolved or loaded)
//! - Materials (diffuse/specular/ambient/edge colors, flags, texture,
//!   sphere and toon references, memo, raw index count)
//! - Bones (names, parent, layer, position, tail, rotation/translation
//!   inheritance, fixed axis, local axes, external-parent key, IK
//!   definition with angle-limited links)
//! - Morphs (group/vertex/bone/UV/additional-UV/material; flip and
//!   display-frame morphs return [`MmdError::UnsupportedMorphType`])
//! - VMD motions (`.vmd`; signature, model name, bone keys with 64-byte
//!   interpolation, morph keys; camera/light/shadow sections are skipped,
//!   their counts stored; the trailing IK on/off section is never decoded)
//!
//! What explicitly does **not** parse (a typed error is returned instead of
//! a misparse, or the section is never interpreted):
//!
//! - **PMX 2.1** and **PMD** — rejected (version/magic) respectively.
//! - **Display frames, rigid bodies and joints** — bytes after the morphs
//!   section are never read.
//! - **Physics / IK evaluation** — IK data is decoded and stored, never run.
//! - **QDEF** deform type — reported as [`MmdError::UnsupportedDeformType`](4).
//! - **CP932 decoding** — VMD names are CP932 on the wire; this crate has no
//!   encoding crate dependency and decodes ASCII-lossily, keeping raw bytes
//!   in `name_raw` (see the VMD module docs).
//!
//! ## Rest-pose engine (P10 M1)
//!
//! [`RestPoseEngine`] assembles an interleaved 64-byte vertex buffer (the
//! VRM layout) + per-material primitive index buffers from a parsed model,
//! expands BDEF1/BDEF2/BDEF4/SDEF deform data onto 4-slot joints/weights
//! (SDEF as an approved BDEF2-style approximation), and maps PMX materials
//! onto MToon-ish base/shade colors. It never animates: [`RestPoseEngine::tick`]
//! is a pure frame counter. Motion, IK and skinning land in M2+.
//!
//! Allocation is capped on hostile input (see [`MAX_VERTICES`] and friends),
//! and every read is bounds-checked; [`from_bytes`] never panics.
//!
//! # Example
//!
//! ```no_run
//! let model = airi_mmd::MmdModel::from_path("/path/to/model.pmx")?;
//! println!("{}: {} vertices", model.name, model.vertices.len());
//! # Ok::<(), airi_mmd::MmdError>(())
//! ```

mod cursor;
mod error;
mod model;
mod pmx;
mod rest_pose;
mod vmd;

pub use error::MmdError;
pub use model::{
    bone_flags, material_flags, morph_types, sphere_mode, BoneGrant, BoneIk, BoneIkLink, BoneTail,
    Deform, MmdBone, MmdMaterial, MmdModel, MmdMorph, MmdMorphOffset, MmdToon, MmdVertex,
    PmxEncoding, MAX_ADDITIONAL_UV, MAX_BONES, MAX_FACE_INDICES, MAX_IK_LINKS, MAX_MATERIALS,
    MAX_MORPHS, MAX_MORPH_OFFSETS, MAX_TEXTURES, MAX_VERTICES,
};
pub use rest_pose::{
    RestPoseEngine, RestPoseMaterial, RestPosePrimitive, RestPoseTexture, VERTEX_STRIDE,
};
pub use vmd::{
    VmdBoneKey, VmdMorphKey, VmdMotion, MAX_VMD_BONE_KEYS, MAX_VMD_CAMERA_KEYS, MAX_VMD_LIGHT_KEYS,
    MAX_VMD_MORPH_KEYS, MAX_VMD_SHADOW_KEYS,
};

/// Parse a PMX 2.0 model from an in-memory buffer.
///
/// Returns either a complete [`MmdModel`] (everything up to and including the
/// morphs section; sections past morphs are not decoded) or a typed [`MmdError`].
/// Never panics on untrusted input.
///
/// # Errors
///
/// See [`MmdError`]. Notably:
///
/// - [`MmdError::Truncated`] when the buffer ends early,
/// - [`MmdError::BadMagic`] when the first 4 bytes are not `PMX `,
/// - [`MmdError::UnsupportedVersion`] when the `f32` version is not `2.0`,
/// - [`MmdError::UnsupportedDeformType`] for deform types other than
///   BDEF1/BDEF2/BDEF4/SDEF,
/// - [`MmdError::UnsupportedMorphType`] for morph types other than
///   group/vertex/bone/UV/additional-UV/material (types 0..=8).
pub fn from_bytes(bytes: &[u8]) -> Result<MmdModel, MmdError> {
    pmx::parse(bytes)
}
