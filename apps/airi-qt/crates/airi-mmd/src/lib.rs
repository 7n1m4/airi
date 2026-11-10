// SPDX-License-Identifier: GPL-3.0-or-later
#![deny(missing_docs)]

//! `airi-mmd` — MMD model parsers for the P10 renderer.
//!
//! This crate is the P10 **M0 (parser)** milestone for AIRI's Qt stage. It
//! decodes PMX 2.0 binary models into typed Rust structures. It does **not**
//! render, load textures, simulate physics, evaluate IK, or animate; those
//! land in later P10 milestones.
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
//!
//! What explicitly does **not** parse (a typed [`MmdError::UnsupportedFeature`]
//! is returned instead of a misparse):
//!
//! - **Morphs** — a non-zero morph count aborts the parse. Display frames,
//!   rigid bodies, joints and everything after bones is never interpreted.
//! - **PMX 2.1** and **PMD** — rejected (version/magic) respectively.
//! - **Physics / IK evaluation** — IK data is decoded and stored, never run.
//! - **QDEF** deform type — reported as [`MmdError::UnsupportedDeformType`](4).
//! - **.vmd motion** files — out of scope for this milestone.
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

pub use error::MmdError;
pub use model::{
    bone_flags, material_flags, sphere_mode, BoneGrant, BoneIk, BoneIkLink, BoneTail, Deform,
    MmdBone, MmdMaterial, MmdModel, MmdToon, MmdVertex, PmxEncoding, MAX_ADDITIONAL_UV, MAX_BONES,
    MAX_FACE_INDICES, MAX_IK_LINKS, MAX_MATERIALS, MAX_TEXTURES, MAX_VERTICES,
};

/// Parse a PMX 2.0 model from an in-memory buffer.
///
/// Returns either a complete [`MmdModel`] (everything up to and including the
/// bones section; sections past bones are not decoded) or a typed [`MmdError`].
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
/// - [`MmdError::UnsupportedFeature`] when the model contains morphs.
pub fn from_bytes(bytes: &[u8]) -> Result<MmdModel, MmdError> {
    pmx::parse(bytes)
}
