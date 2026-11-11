// SPDX-License-Identifier: GPL-3.0-or-later

//! Rest-pose (M1) mesh assembly for PMX models.
//!
//! [`RestPoseEngine`] converts a parsed [`MmdModel`] into the interleaved
//! 64-byte vertex buffer + u32 index buffers the Qt Quick 3D
//! `AiriVrmGeometryShell` already consumes. One primitive is emitted per
//! contiguous face range per material (PMX orders faces by material, so each
//! material normally yields exactly one primitive).
//!
//! ## Buffer layout (matches the VRM path exactly)
//!
//! Stride is [`VERTEX_STRIDE`] (64 bytes), little-endian:
//!
//! | offset | field    | bytes |
//! |--------|----------|-------|
//! | 0      | position | 12    |
//! | 12     | normal   | 12    |
//! | 24     | uv0      | 8     |
//! | 32     | joints   | 16    | `u32 × 4`
//! | 48     | weights  | 16    | `f32 × 4`
//!
//! Every primitive shares the same interleaved vertex buffer; only the index
//! buffer differs. This mirrors how the VRM bridge hands the same buffer to
//! each `AiriVrmGeometryShell` instance.
//!
//! ## Deform expansion (BDEF/SDEF)
//!
//! - **BDEF1** → `joints = [i, 0, 0, 0]`, `weights = [1, 0, 0, 0]`.
//! - **BDEF2** → `joints = [a, b, 0, 0]`, `weights = [w, 1 - w, 0, 0]`
//!   (the `1 - w` term is computed at parse time and stored).
//! - **BDEF4** → stored verbatim (indices + 4 weights). Weights are **not**
//!   renormalized; well-formed PMX files store a normalized set.
//! - **SDEF** → BDEF2-style approximation with the two stored influences:
//!   `joints = [i0, i1, 0, 0]`, `weights = [w, 1 - w, 0, 0]`. The SDEF
//!   rotation center `C` and rotation references `R0`/`R1` are **dropped** —
//!   skinning degrades from dual-quaternion-ish to linear blend. Approved by
//!   the user on 2026-11-11; every SDEF vertex increments
//!   [`RestPoseEngine::sdef_approximated`] so the caller can warn. Proper
//!   SDEF evaluation is M2+ work.
//!
//! Joint indices that are negative or out of range are clamped into
//! `0..bone_count - 1` and counted in [`RestPoseEngine::invalid_joint_count`]
//! (defensive; well-formed files never carry them).
//!
//! ## Materials → MToon-ish parameters
//!
//! - `base_color` = PMX `diffuse` RGBA (verbatim).
//! - `shade_color` = PMX `ambient` RGB with alpha = diffuse alpha. When the
//!   ambient vector is exactly `[0, 0, 0]` (a common authoring default), it is
//!   replaced by `diffuse.rgb * 0.6` — counted in
//!   [`RestPoseEngine::ambient_fallback_count`].
//! - Specular, shininess, edge flags/colors/sizes, sphere maps and the toon
//!   reference are **ignored** in M1 (see the phase note); the two-step toon
//!   ramp applied by the QML material family is the only toon term.
//!
//! ## Textures
//!
//! Texture bytes are loaded only via [`RestPoseEngine::from_path`]: each
//! material's texture path (as stored in the PMX — typically a Windows-style
//! relative path) is normalized (`\\` → `/`) and resolved relative to the
//! `.pmx` file's parent directory. Missing/unreadable files are skipped
//! silently-but-counted ([`RestPoseEngine::texture_failures`]); the caller
//! falls back to an untextured binding. `.zip`/`.pmd` archives are **not**
//! supported — those are M2. Built-in MMD toon ramps are never resolved.

use std::path::{Path, PathBuf};

use crate::model::{Deform, MmdModel};

/// Interleaved vertex stride in bytes (pos 12 + normal 12 + uv0 8 +
/// joints 16 + weights 16).
pub const VERTEX_STRIDE: usize = 64;

/// One primitive split from the model's face list.
#[derive(Debug, Clone, PartialEq)]
pub struct RestPosePrimitive {
    /// Index into [`RestPoseEngine::materials`], or `-1` for faces left over
    /// after every material consumed its declared range (malformed models
    /// only; see the module docs).
    pub material_index: i32,
    /// u32 triangle indices (little-endian bytes).
    pub index_data: Vec<u8>,
    /// Number of vertices this primitive references (the full shared buffer
    /// is always uploaded; kept for diagnostics/logging).
    pub vertex_count: usize,
}

/// A texture blob resolved from disk (sibling of the `.pmx`).
#[derive(Debug, Clone, PartialEq)]
pub struct RestPoseTexture {
    /// Raw file bytes.
    pub bytes: Vec<u8>,
    /// Lower-cased extension without the dot (e.g. `png`, `jpg`).
    pub extension: String,
}

/// MToon-approximated material parameters for one PMX material.
#[derive(Debug, Clone, PartialEq)]
pub struct RestPoseMaterial {
    /// Local (authoring-language) material name.
    pub name: String,
    /// Global (English) material name, may be empty.
    pub name_global: String,
    /// Base color (PMX diffuse RGBA, verbatim).
    pub base_color: [f32; 4],
    /// Shade color (PMX ambient RGB, or `diffuse.rgb * 0.6` when ambient is
    /// exactly `[0, 0, 0]`; alpha = diffuse alpha).
    pub shade_color: [f32; 4],
    /// Index into the PMX texture table, or `-1` for none.
    pub texture_index: i32,
    /// Resolved texture, if any. Always `None` for engines built with
    /// [`RestPoseEngine::build`]; populated by [`RestPoseEngine::from_path`].
    pub texture: Option<RestPoseTexture>,
}

/// A PMX model assembled into render-ready rest-pose buffers.
///
/// Pure data; no Qt types. The bridge layer wraps this in a QObject.
#[derive(Debug, Clone, PartialEq)]
pub struct RestPoseEngine {
    vertex_data: Vec<u8>,
    primitives: Vec<RestPosePrimitive>,
    materials: Vec<RestPoseMaterial>,
    /// Number of SDEF vertices remapped onto BDEF2 (linear blend).
    sdef_approximated: usize,
    /// Number of materials whose all-zero ambient was replaced by
    /// `diffuse.rgb * 0.6`.
    ambient_fallback_count: usize,
    /// Number of joint indices clamped because they were negative or out of
    /// range.
    invalid_joint_count: usize,
    /// Number of material texture loads that failed (missing/unreadable
    /// file, or resolution attempted with no base directory).
    texture_failures: usize,
    /// True when the sum of material `vertex_count`s did not match the face
    /// list; leftover faces were attached to a primitive with
    /// `material_index == -1`.
    face_range_mismatch: bool,
    ticks: u64,
    elapsed_ms: f64,
    /// Texture paths as stored in the PMX (index-aligned with the model's
    /// texture table). Kept so [`Self::resolve_textures`] can resolve them
    /// later; not exposed.
    texture_paths: Vec<String>,
}

impl RestPoseEngine {
    /// Parse a `.pmx` file and assemble the rest-pose mesh.
    ///
    /// Texture paths are resolved relative to the `.pmx` file's parent
    /// directory (see the module docs). Individual texture failures are
    /// counted, never fatal.
    ///
    /// # Errors
    ///
    /// Returns whatever [`MmdModel::from_path`](crate::MmdModel::from_path)
    /// can return.
    pub fn from_path(path: impl AsRef<Path>) -> Result<Self, crate::MmdError> {
        let model = MmdModel::from_path(path.as_ref())?;
        let mut engine = Self::build(&model);
        let base = path.as_ref().parent().map(Path::to_path_buf);
        engine.resolve_textures(base.as_deref());
        Ok(engine)
    }

    /// Assemble the rest-pose mesh from an already-parsed model.
    ///
    /// No texture I/O happens; [`RestPoseMaterial::texture`] stays `None`.
    #[must_use]
    pub fn build(model: &MmdModel) -> Self {
        let vertex_data = interleave_vertices(model);
        let (primitives, face_range_mismatch) = split_primitives(model, &vertex_data);
        let (materials, ambient_fallback_count) = map_materials(model);
        let sdef_approximated = model
            .vertices
            .iter()
            .filter(|v| matches!(v.deform, Deform::Sdef { .. }))
            .count();
        let invalid_joint_count = count_invalid_joints(model);
        Self {
            vertex_data,
            primitives,
            materials,
            sdef_approximated,
            ambient_fallback_count,
            invalid_joint_count,
            texture_failures: 0,
            face_range_mismatch,
            ticks: 0,
            elapsed_ms: 0.0,
            texture_paths: model.textures.clone(),
        }
    }

    /// Attempt to load every material's texture relative to `base_dir`.
    ///
    /// `None` skips all loads (each attempt with `Some(dir)` that fails is
    /// counted in [`Self::texture_failures`]). Path handling: the stored
    /// path has `\` normalized to `/`; if the normalized path is absolute it
    /// is used as-is, otherwise it is joined onto `base_dir`. No
    /// case-insensitive fallback and no archive extraction — those are M2.
    pub fn resolve_textures(&mut self, base_dir: Option<&Path>) {
        let Some(base) = base_dir else {
            self.texture_failures += self
                .materials
                .iter()
                .filter(|m| m.texture_index >= 0)
                .count();
            return;
        };
        for material in &mut self.materials {
            if material.texture_index < 0 {
                continue;
            }
            let Some(stored) = self.texture_paths.get(material.texture_index as usize) else {
                self.texture_failures += 1;
                continue;
            };
            let normalized = stored.replace('\\', "/");
            let candidate = {
                let p = PathBuf::from(&normalized);
                if p.is_absolute() {
                    p
                } else {
                    base.join(&p)
                }
            };
            match std::fs::read(&candidate) {
                Ok(bytes) => {
                    let extension = candidate
                        .extension()
                        .and_then(|e| e.to_str())
                        .map(str::to_ascii_lowercase)
                        .unwrap_or_else(|| "bin".to_string());
                    material.texture = Some(RestPoseTexture { bytes, extension });
                }
                Err(_) => self.texture_failures += 1,
            }
        }
    }

    /// Interleaved vertex buffer bytes (stride [`VERTEX_STRIDE`]).
    #[must_use]
    pub fn vertex_bytes(&self) -> &[u8] {
        &self.vertex_data
    }

    /// Index buffer bytes (u32 LE) for primitive `index`, or `None`.
    #[must_use]
    pub fn index_bytes(&self, index: usize) -> Option<&[u8]> {
        self.primitives.get(index).map(|p| p.index_data.as_slice())
    }

    /// Number of primitives (one per contiguous face range per material,
    /// plus at most one trailing `material_index == -1` primitive for
    /// leftover faces).
    #[must_use]
    pub fn primitive_count(&self) -> usize {
        self.primitives.len()
    }

    /// Material index for primitive `index` (`-1` = unassigned faces), or
    /// `None` when `index` is out of range.
    #[must_use]
    pub fn primitive_material(&self, index: usize) -> Option<i32> {
        self.primitives.get(index).map(|p| p.material_index)
    }

    /// Material table (index-aligned with primitive `material_index`).
    #[must_use]
    pub fn materials(&self) -> &[RestPoseMaterial] {
        &self.materials
    }

    /// Number of SDEF vertices remapped onto BDEF2.
    #[must_use]
    pub fn sdef_approximated(&self) -> usize {
        self.sdef_approximated
    }

    /// Number of materials whose all-zero ambient was replaced by
    /// `diffuse.rgb * 0.6`.
    #[must_use]
    pub fn ambient_fallback_count(&self) -> usize {
        self.ambient_fallback_count
    }

    /// Number of joint indices clamped into `0..bone_count - 1`.
    #[must_use]
    pub fn invalid_joint_count(&self) -> usize {
        self.invalid_joint_count
    }

    /// Number of material texture loads that failed.
    #[must_use]
    pub fn texture_failures(&self) -> usize {
        self.texture_failures
    }

    /// True when material `vertex_count` sums did not match the face list.
    #[must_use]
    pub fn face_range_mismatch(&self) -> bool {
        self.face_range_mismatch
    }

    /// Number of [`Self::tick`] calls (the M1 skin/morph counter).
    #[must_use]
    pub fn ticks(&self) -> u64 {
        self.ticks
    }

    /// Accumulated tick time in milliseconds.
    #[must_use]
    pub fn elapsed_ms(&self) -> f64 {
        self.elapsed_ms
    }

    /// Advance the (M1: non-existent) animation clock.
    ///
    /// No pose is evaluated — the rest pose is uploaded verbatim on every
    /// tick. The counter exists so the QML frame timer and the smoke tour
    /// have a truthful "frames elapsed" signal.
    pub fn tick(&mut self, dt_ms: f32) {
        if dt_ms.is_finite() && dt_ms > 0.0 {
            self.elapsed_ms += f64::from(dt_ms);
        }
        self.ticks += 1;
    }
}

/// Interleave every vertex into the 64-byte VRM layout.
fn interleave_vertices(model: &MmdModel) -> Vec<u8> {
    let mut out = Vec::with_capacity(model.vertices.len() * VERTEX_STRIDE);
    for vertex in &model.vertices {
        for component in vertex.position {
            out.extend_from_slice(&component.to_le_bytes());
        }
        for component in vertex.normal {
            out.extend_from_slice(&component.to_le_bytes());
        }
        for component in vertex.uv {
            out.extend_from_slice(&component.to_le_bytes());
        }
        let (joints, weights) = expand_deform(&vertex.deform, model.bones.len());
        for joint in joints {
            out.extend_from_slice(&joint.to_le_bytes());
        }
        for weight in weights {
            out.extend_from_slice(&weight.to_le_bytes());
        }
    }
    out
}

/// Expand a [`Deform`] into 4-slot joints (u32) + 4-slot weights (f32).
///
/// The SDEF case is the only lossy one; see the module docs. Indices are
/// clamped to `0` when negative (PMX does not use `-1` for skinning
/// influences; anything else is malformed and counted by the caller).
fn expand_deform(deform: &Deform, bone_count: usize) -> ([u32; 4], [f32; 4]) {
    let upper = bone_count.saturating_sub(1) as i32;
    let clamp = |i: i32| i.clamp(0, upper.max(0)) as u32;
    match *deform {
        Deform::Bdef1([a]) => ([clamp(a), 0, 0, 0], [1.0, 0.0, 0.0, 0.0]),
        Deform::Bdef2([a, b], [w, w1]) => ([clamp(a), clamp(b), 0, 0], [w, w1, 0.0, 0.0]),
        Deform::Bdef4(indices, weights) => (
            [
                clamp(indices[0]),
                clamp(indices[1]),
                clamp(indices[2]),
                clamp(indices[3]),
            ],
            weights,
        ),
        Deform::Sdef {
            indices: [a, b],
            weights: [w, w1],
            ..
        } => ([clamp(a), clamp(b), 0, 0], [w, w1, 0.0, 0.0]),
    }
}

/// Count joint indices that are negative or beyond `bone_count` (diagnostics).
fn count_invalid_joints(model: &MmdModel) -> usize {
    let bone_count = model.bones.len() as i64;
    let mut invalid = 0usize;
    let mut check = |i: i32| {
        if i64::from(i) < 0 || i64::from(i) >= bone_count {
            invalid += 1;
        }
    };
    for vertex in &model.vertices {
        match vertex.deform {
            Deform::Bdef1([a]) => check(a),
            Deform::Bdef2([a, b], _)
            | Deform::Sdef {
                indices: [a, b], ..
            } => {
                check(a);
                check(b);
            }
            Deform::Bdef4(indices, _) => {
                for i in indices {
                    check(i);
                }
            }
        }
    }
    invalid
}

/// Split the face list into one primitive per contiguous face range per
/// material.
///
/// Materials consume `vertex_count / 3` faces in file order (PMX orders
/// faces by material). A declared range that overruns the remaining faces is
/// clamped; faces left over after every material consumed its range are
/// attached to a trailing primitive with `material_index == -1`. Either
/// situation sets the mismatch flag.
fn split_primitives(model: &MmdModel, _vertex_data: &[u8]) -> (Vec<RestPosePrimitive>, bool) {
    let vertex_count = model.vertices.len();
    let mut primitives = Vec::with_capacity(model.materials.len() + 1);
    let mut face_cursor = 0usize;
    let mut mismatch = false;

    for (material_index, material) in model.materials.iter().enumerate() {
        let declared_faces = (material.vertex_count.max(0) / 3) as usize;
        let remaining = model.faces.len().saturating_sub(face_cursor);
        let faces_to_take = declared_faces.min(remaining);
        if faces_to_take != declared_faces {
            mismatch = true;
        }
        if faces_to_take == 0 {
            continue;
        }
        primitives.push(build_primitive(
            material_index as i32,
            &model.faces[face_cursor..face_cursor + faces_to_take],
            vertex_count,
        ));
        face_cursor += faces_to_take;
    }

    if face_cursor < model.faces.len() {
        mismatch = true;
        primitives.push(build_primitive(
            -1,
            &model.faces[face_cursor..],
            vertex_count,
        ));
    }

    (primitives, mismatch)
}

fn build_primitive(
    material_index: i32,
    faces: &[[u32; 3]],
    vertex_count: usize,
) -> RestPosePrimitive {
    let mut index_data = Vec::with_capacity(faces.len() * 12);
    for face in faces {
        for index in face {
            index_data.extend_from_slice(&index.to_le_bytes());
        }
    }
    RestPosePrimitive {
        material_index,
        index_data,
        vertex_count,
    }
}

/// Map PMX materials onto the MToon-ish approximation (see module docs).
/// Returns the materials and the number of ambient→diffuse fallbacks used.
fn map_materials(model: &MmdModel) -> (Vec<RestPoseMaterial>, usize) {
    let mut ambient_fallback_count = 0usize;
    let materials = model
        .materials
        .iter()
        .map(|material| {
            let diffuse = material.diffuse;
            let ambient = material.ambient;
            let shade_rgb = if ambient == [0.0, 0.0, 0.0] {
                ambient_fallback_count += 1;
                [diffuse[0] * 0.6, diffuse[1] * 0.6, diffuse[2] * 0.6]
            } else {
                ambient
            };
            RestPoseMaterial {
                name: material.name.clone(),
                name_global: material.name_global.clone(),
                base_color: diffuse,
                shade_color: [shade_rgb[0], shade_rgb[1], shade_rgb[2], diffuse[3]],
                texture_index: material.texture_index,
                texture: None,
            }
        })
        .collect();
    (materials, ambient_fallback_count)
}
