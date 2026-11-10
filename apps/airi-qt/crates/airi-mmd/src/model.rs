// SPDX-License-Identifier: GPL-3.0-or-later

//! Typed PMX 2.0 document model produced by [`crate::from_bytes`].

use std::path::Path;

use crate::error::MmdError;

/// Maximum number of vertices accepted (guards allocation on hostile input).
pub const MAX_VERTICES: usize = 1_000_000;
/// Maximum number of face indices accepted (i.e. 3× the face count).
pub const MAX_FACE_INDICES: usize = 5_000_000;
/// Maximum number of textures accepted.
pub const MAX_TEXTURES: usize = 10_000;
/// Maximum number of materials accepted.
pub const MAX_MATERIALS: usize = 4_096;
/// Maximum number of bones accepted.
pub const MAX_BONES: usize = 4_096;
/// Maximum number of IK links per IK bone accepted.
pub const MAX_IK_LINKS: usize = 256;
/// Maximum number of additional UV sets accepted (spec default is 4).
pub const MAX_ADDITIONAL_UV: usize = 16;

/// String encoding flag stored in the PMX header.
///
/// The flag is trusted, never sniffed: `0` = UTF-16LE, `1` = UTF-8.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PmxEncoding {
    /// UTF-16LE with a byte-length prefix on every string.
    Utf16Le,
    /// UTF-8 with a byte-length prefix on every string.
    Utf8,
}

/// Skinning deformation stored per vertex.
///
/// Weights always sum to 1.0 for well-formed models. `Sdef` carries the full
/// SDEF state (rotation center `c` and rotation references `r0`/`r1`) rather
/// than the single vector shown in a naïve abbreviation of the format, because
/// the renderer lane needs all three for correct (or BDEF2-fallback) skinning.
#[derive(Debug, Clone, Copy, PartialEq)]
pub enum Deform {
    /// Single bone influence (deform type 0).
    Bdef1([i32; 1]),
    /// Two bone influences with explicit weight pair (deform type 1).
    ///
    /// `[w0, w1]` with `w0 + w1 == 1.0`; the file stores only `w0`.
    Bdef2([i32; 2], [f32; 2]),
    /// Four bone influences with explicit weights (deform type 2).
    Bdef4([i32; 4], [f32; 4]),
    /// SDEF (deform type 3) — dual-quaternion-ish rigid skinning.
    Sdef {
        /// Bone indices for the two SDEF influences.
        indices: [i32; 2],
        /// Weights for the two influences (`w0` from file, `w1 = 1 - w0`).
        weights: [f32; 2],
        /// Rotation center (SDEF `C` vector).
        c: [f32; 3],
        /// Rotation reference 0 (SDEF `R0` vector).
        r0: [f32; 3],
        /// Rotation reference 1 (SDEF `R1` vector).
        r1: [f32; 3],
    },
}

/// A single mesh vertex.
#[derive(Debug, Clone, PartialEq)]
pub struct MmdVertex {
    /// Object-space position.
    pub position: [f32; 3],
    /// Object-space normal.
    pub normal: [f32; 3],
    /// Base UV set (set 0). Additional UV sets are parsed past but not stored.
    pub uv: [f32; 2],
    /// Edge (inverted-hull) scale factor; 1.0 = normal, 0.0 = no edge.
    pub edge_factor: f32,
    /// Skinning deformation (bone influences + weights).
    pub deform: Deform,
}

/// Toon-shading reference stored per material.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum MmdToon {
    /// Index into the texture table (PMX toon mode 0).
    Index(i32),
    /// Index into MMD's built-in toon ramp set (PMX toon mode 1).
    ///
    /// AIRI does not redistribute the built-in `toonNN.bmp` ramps; the
    /// renderer falls back to a two-step ramp and logs once per model.
    Builtin(u8),
}

/// PMX material flags (bitfield re-exported for convenience).
///
/// Only presence bits are named here; unknown bits are preserved in
/// [`MmdMaterial::flags`].
pub mod material_flags {
    /// Draw with double-sided faces (inverted cull).
    pub const DRAW_DOUBLES: u8 = 0x01;
    /// Render drops shadows onto this material.
    pub const GROUND_SHADOW: u8 = 0x02;
    /// Draw shadow map for this material.
    pub const DRAW_SHADOW: u8 = 0x04;
    /// Receive shadows on this material.
    pub const RECEIVE_SHADOW: u8 = 0x08;
    /// Has edge (inverted-hull) enabled.
    pub const EDGE_ENABLED: u8 = 0x10;
    /// Vertex color is multiplied into the diffuse term.
    pub const VERTEX_COLOR: u8 = 0x20;
    /// Point drawing mode.
    pub const POINT_DRAW: u8 = 0x40;
    /// Line drawing mode.
    pub const LINE_DRAW: u8 = 0x80;
}

/// Sphere (environment map) blend mode from the material's sphere flag byte.
pub mod sphere_mode {
    /// No sphere map.
    pub const NONE: u8 = 0;
    /// Multiply (`.sph`) sphere map.
    pub const MULTIPLY: u8 = 1;
    /// Add (`.spa`) sphere map.
    pub const ADD: u8 = 2;
}

/// A PMX material record.
#[derive(Debug, Clone, PartialEq)]
pub struct MmdMaterial {
    /// Local (authoring-language) material name.
    pub name: String,
    /// Global (English) material name, may be empty.
    pub name_global: String,
    /// Diffuse RGBA.
    pub diffuse: [f32; 4],
    /// Specular RGB.
    pub specular: [f32; 3],
    /// Specular strength (shininess).
    pub specular_strength: f32,
    /// Ambient RGB (used as the toon shade color).
    pub ambient: [f32; 3],
    /// Drawing flags bitfield (see [`material_flags`]).
    pub flags: u8,
    /// Edge (inverted-hull) color RGBA.
    pub edge_color: [f32; 4],
    /// Edge (inverted-hull) size.
    pub edge_size: f32,
    /// Index into the texture table, or -1 for none.
    pub texture_index: i32,
    /// Index into the texture table for the sphere map, or -1 for none.
    pub sphere_texture_index: i32,
    /// Sphere blend mode (see [`sphere_mode`]).
    pub sphere_mode: u8,
    /// Toon reference (texture-table index or built-in ramp id).
    pub toon: MmdToon,
    /// Free-form memo string stored by the authoring tool.
    pub comment: String,
    /// Raw vertex-index count consumed by this material (multiple of 3).
    ///
    /// The PMX spec calls this "face vertex count"; three.js and MMD both
    /// store the raw index count, not the face count. Divide by 3 for faces.
    pub vertex_count: i32,
}

/// Bone "tail" reference: either an offset from the bone position or a
/// reference to another bone.
#[derive(Debug, Clone, Copy, PartialEq)]
pub enum BoneTail {
    /// Tail offset relative to the bone position (flag `0x0001` clear).
    Offset([f32; 3]),
    /// Index of the bone whose position is the tail (flag `0x0001` set).
    Bone(i32),
}

/// Bone rotation/translation inheritance ("grant") data, present when the
/// `0x0100` or `0x0200` bone flag is set.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct BoneGrant {
    /// Index of the parent bone this bone inherits motion from.
    pub parent_index: i32,
    /// Inheritance ratio (0..=1 for rotation, can be >1 for translation).
    pub ratio: f32,
    /// True when inheritance is evaluated in the local (parent-relative)
    /// frame; false for global. Decoded from bone flag `0x0080`, matching
    /// three-stdlib's mmdparser.
    pub local: bool,
    /// Bone flag `0x0100`: inherits rotation.
    pub rotation: bool,
    /// Bone flag `0x0200`: inherits translation.
    pub translation: bool,
}

/// One link (constrained bone) in an IK chain.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct BoneIkLink {
    /// Index of the link bone.
    pub index: i32,
    /// Optional per-link angle limit (lower, upper) in radians.
    pub angle_limit: Option<([f32; 3], [f32; 3])>,
}

/// Inverse kinematics definition stored on the IK bone itself.
#[derive(Debug, Clone, PartialEq)]
pub struct BoneIk {
    /// Index of the end-effector bone (e.g. the toe for a leg IK).
    pub effector_index: i32,
    /// Solver iteration count.
    pub iteration: u32,
    /// Maximum angle (radians) a link may rotate per iteration.
    pub max_angle: f32,
    /// Chain links, outermost first.
    pub links: Vec<BoneIkLink>,
}

/// PMX bone record.
///
/// Note: PMX bones carry **no rest rotation/quaternion** — the rest pose is
/// pure translation in bone space. Poses come from motion data (`.vmd`).
#[derive(Debug, Clone, PartialEq)]
pub struct MmdBone {
    /// Local (authoring-language) bone name.
    pub name: String,
    /// Global (English) bone name, may be empty.
    pub name_global: String,
    /// Rest position in model space.
    pub position: [f32; 3],
    /// Parent bone index, or -1 for root bones.
    pub parent_index: i32,
    /// Transform layer (stacking order for evaluation).
    pub layer: i32,
    /// Raw bone flags bitfield (see [`bone_flags`]).
    pub flags: u16,
    /// Tail reference (offset or bone index).
    pub tail: BoneTail,
    /// Rotation/translation inheritance, if enabled.
    pub grant: Option<BoneGrant>,
    /// Fixed rotation axis, if flag `0x0400` is set.
    pub fixed_axis: Option<[f32; 3]>,
    /// Local X/Z axes, if flag `0x0800` is set.
    pub local_axes: Option<([f32; 3], [f32; 3])>,
    /// External-parent deform key, if flag `0x2000` is set.
    pub external_parent_key: Option<i32>,
    /// IK definition, if flag `0x0020` is set.
    pub ik: Option<BoneIk>,
}

/// PMX bone flags (bitfield, re-exported for convenience).
pub mod bone_flags {
    /// Tail reference is a bone index rather than a position offset.
    pub const TAIL_INDEX: u16 = 0x0001;
    /// Bone may be rotated.
    pub const ROTATABLE: u16 = 0x0002;
    /// Bone may be translated.
    pub const TRANSLATABLE: u16 = 0x0004;
    /// Bone is shown in the keyframe editor.
    pub const VISIBLE: u16 = 0x0008;
    /// Bone may be manipulated in the editor.
    pub const ENABLED: u16 = 0x0010;
    /// Bone carries an IK definition.
    pub const IK: u16 = 0x0020;
    /// Grant (inheritance) is evaluated in local frame (see [`super::BoneGrant::local`]).
    pub const GRANT_LOCAL: u16 = 0x0080;
    /// Bone inherits rotation from its grant parent.
    pub const GRANT_ROTATION: u16 = 0x0100;
    /// Bone inherits translation from its grant parent.
    pub const GRANT_TRANSLATION: u16 = 0x0200;
    /// Bone has a fixed rotation axis.
    pub const FIXED_AXIS: u16 = 0x0400;
    /// Bone rotates around local X/Z axes instead of world axes.
    pub const LOCAL_AXES: u16 = 0x0800;
    /// Bone carries an external-parent deform key (PhysX/outside motion link).
    pub const EXTERNAL_PARENT: u16 = 0x2000;
}

/// A fully decoded PMX 2.0 model, limited to the sections AIRI consumes.
///
/// Sections after bones (morphs, display frames, rigid bodies, joints) are
/// **not** decoded: a non-zero morph count yields
/// [`MmdError::UnsupportedFeature`], and frame/physics sections are never
/// interpreted. Zero-morph models parse successfully and simply carry no
/// morph information.
#[derive(Debug, Clone, PartialEq)]
pub struct MmdModel {
    /// Local (authoring-language) model name.
    pub name: String,
    /// Global (English) model name, may be empty.
    pub name_global: String,
    /// Local (authoring-language) model comment.
    pub comment: String,
    /// Global (English) model comment, may be empty.
    pub comment_global: String,
    /// PMX version as read from the `f32` version field (2.0 for PMX 2.0).
    pub version: f32,
    /// String encoding flag from the header.
    pub encoding: PmxEncoding,
    /// Vertices in file order.
    pub vertices: Vec<MmdVertex>,
    /// Triangles as absolute vertex indices (always 3 per triangle).
    pub faces: Vec<[u32; 3]>,
    /// Texture paths as stored (Windows separators, mojibake and all).
    pub textures: Vec<String>,
    /// Materials in file order.
    pub materials: Vec<MmdMaterial>,
    /// Bones in file order.
    pub bones: Vec<MmdBone>,
}

impl MmdModel {
    /// Read and parse a `.pmx` file from disk.
    ///
    /// # Errors
    ///
    /// Returns [`MmdError::Io`] if the file cannot be read, otherwise any
    /// error [`crate::from_bytes`] can produce.
    pub fn from_path(path: impl AsRef<Path>) -> Result<Self, MmdError> {
        let bytes = std::fs::read(path)?;
        crate::from_bytes(&bytes)
    }
}
