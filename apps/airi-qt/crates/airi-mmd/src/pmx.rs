// SPDX-License-Identifier: GPL-3.0-or-later

//! PMX 2.0 binary reader.
//!
//! Layout (all little-endian, verified against three-stdlib's mmdparser and
//! the P10 design note):
//!
//! ```text
//! "PMX " (4) | version: f32 (=2.0) | header_size: u8 (=8) |
//! encoding: u8 (0=UTF-16LE, 1=UTF-8) | additional_uv_count: u8 |
//! vertex/texture/material/bone/morph/rigid_body index sizes: u8 × 6
//! 4 × length-prefixed strings (model name, model-name-global, comment, comment-global)
//! vertices, faces, textures, materials, bones, morphs…
//! ```
//!
//! This reader deliberately stops after the bones section. A non-zero morph
//! count yields [`MmdError::UnsupportedFeature`] ("morphs"); display frames,
//! rigid bodies and joints are never interpreted. Zero-morph models decode
//! successfully and simply carry no morph/frame/physics information.

use crate::cursor::Cursor;
use crate::error::MmdError;
use crate::model::{
    BoneGrant, BoneIk, BoneIkLink, BoneTail, Deform, MmdBone, MmdMaterial, MmdModel, MmdToon,
    MmdVertex, PmxEncoding, MAX_ADDITIONAL_UV, MAX_BONES, MAX_FACE_INDICES, MAX_IK_LINKS,
    MAX_MATERIALS, MAX_TEXTURES, MAX_VERTICES,
};

/// Deform type byte values as stored in the file.
const DEFORM_BDEF1: u8 = 0;
const DEFORM_BDEF2: u8 = 1;
const DEFORM_BDEF4: u8 = 2;
const DEFORM_SDEF: u8 = 3;

/// Parse a PMX 2.0 buffer into an [`MmdModel`].
pub(crate) fn parse(bytes: &[u8]) -> Result<MmdModel, MmdError> {
    let mut cur = Cursor::new(bytes);

    cur.set_section("header");
    let magic = cur.take_magic()?;
    if &magic != b"PMX " {
        return Err(MmdError::BadMagic);
    }
    let version = cur.f32()?;
    if version != 2.0 {
        return Err(MmdError::UnsupportedVersion(version));
    }
    // header_size (=8) is read and ignored: the layout is fixed, and using the
    // byte to skip would misparse any file that stores something unexpected.
    let _header_size = cur.u8()?;
    let encoding = match cur.u8()? {
        0 => PmxEncoding::Utf16Le,
        1 => PmxEncoding::Utf8,
        _ => {
            return Err(MmdError::InvalidData(
                "unknown encoding flag (only 0=UTF-16LE and 1=UTF-8 exist in PMX 2.0)",
            ));
        }
    };
    let additional_uv = cur.u8()?;
    if additional_uv as usize > MAX_ADDITIONAL_UV {
        return Err(MmdError::InvalidData("additional UV count exceeds limit"));
    }
    let vertex_index_size = index_size(cur.u8()?)?;
    let texture_index_size = index_size(cur.u8()?)?;
    // Validated but otherwise unused by the sections decoded below: indices
    // are read with the parsed bone/texture index sizes.
    let _material_index_size = index_size(cur.u8()?)?;
    let bone_index_size = index_size(cur.u8()?)?;
    let _morph_index_size = index_size(cur.u8()?)?;
    let _rigid_body_index_size = index_size(cur.u8()?)?;

    cur.set_section("names");
    let name = cur.string(encoding)?;
    let name_global = cur.string(encoding)?;
    let comment = cur.string(encoding)?;
    let comment_global = cur.string(encoding)?;

    cur.set_section("vertices");
    let vertex_count = count(cur.u32()?, MAX_VERTICES)?;
    let mut vertices = Vec::with_capacity(vertex_count);
    for _ in 0..vertex_count {
        vertices.push(parse_vertex(&mut cur, additional_uv, bone_index_size)?);
    }

    cur.set_section("faces");
    let face_index_count = count(cur.u32()?, MAX_FACE_INDICES)?;
    if face_index_count % 3 != 0 {
        return Err(MmdError::InvalidData(
            "face index count is not a multiple of 3",
        ));
    }
    let mut faces = Vec::with_capacity(face_index_count / 3);
    for _ in 0..face_index_count / 3 {
        let a = cur.index_unsigned(vertex_index_size)?;
        let b = cur.index_unsigned(vertex_index_size)?;
        let c = cur.index_unsigned(vertex_index_size)?;
        for idx in [a, b, c] {
            if idx as usize >= vertices.len() {
                return Err(MmdError::InvalidData("face index out of range"));
            }
        }
        faces.push([a, b, c]);
    }

    cur.set_section("textures");
    let texture_count = count(cur.u32()?, MAX_TEXTURES)?;
    let mut textures = Vec::with_capacity(texture_count);
    for _ in 0..texture_count {
        textures.push(cur.string(encoding)?);
    }

    cur.set_section("materials");
    let material_count = count(cur.u32()?, MAX_MATERIALS)?;
    let mut materials = Vec::with_capacity(material_count);
    for _ in 0..material_count {
        materials.push(parse_material(&mut cur, encoding, texture_index_size)?);
    }

    cur.set_section("bones");
    let bone_count = count(cur.u32()?, MAX_BONES)?;
    let mut bones = Vec::with_capacity(bone_count);
    for _ in 0..bone_count {
        bones.push(parse_bone(&mut cur, encoding, bone_index_size)?);
    }

    // The morphs section follows bones. We do not decode morphs yet; a
    // non-zero count is a loud, typed error rather than a misparse.
    cur.set_section("morphs");
    let morph_count = cur.u32()?;
    if morph_count != 0 {
        return Err(MmdError::UnsupportedFeature("morphs"));
    }

    Ok(MmdModel {
        name,
        name_global,
        comment,
        comment_global,
        version,
        encoding,
        vertices,
        faces,
        textures,
        materials,
        bones,
    })
}

/// Validate a stored index-size byte.
fn index_size(raw: u8) -> Result<u8, MmdError> {
    match raw {
        1 | 2 | 4 => Ok(raw),
        _ => Err(MmdError::InvalidData("index size must be 1, 2 or 4")),
    }
}

/// Validate a section count stored as `u32` against an allocation limit.
fn count(raw: u32, limit: usize) -> Result<usize, MmdError> {
    let n = raw as usize;
    if n > limit {
        return Err(MmdError::InvalidData("section count exceeds limit"));
    }
    Ok(n)
}

/// Parse a single vertex record.
fn parse_vertex(
    cur: &mut Cursor<'_>,
    additional_uv: u8,
    bone_index_size: u8,
) -> Result<MmdVertex, MmdError> {
    let position = cur.f32_array::<3>()?;
    let normal = cur.f32_array::<3>()?;
    let uv = cur.f32_array::<2>()?;
    // Additional UV sets are vec4 each; parse and discard (the renderer lane
    // does not consume them yet).
    for _ in 0..additional_uv {
        cur.skip(16)?;
    }

    let deform_type = cur.u8()?;
    let deform = match deform_type {
        DEFORM_BDEF1 => Deform::Bdef1([cur.index_signed(bone_index_size)?]),
        DEFORM_BDEF2 => {
            let a = cur.index_signed(bone_index_size)?;
            let b = cur.index_signed(bone_index_size)?;
            let w = cur.f32()?;
            Deform::Bdef2([a, b], [w, 1.0 - w])
        }
        DEFORM_BDEF4 => {
            let indices = [
                cur.index_signed(bone_index_size)?,
                cur.index_signed(bone_index_size)?,
                cur.index_signed(bone_index_size)?,
                cur.index_signed(bone_index_size)?,
            ];
            let weights = cur.f32_array::<4>()?;
            Deform::Bdef4(indices, weights)
        }
        DEFORM_SDEF => {
            let a = cur.index_signed(bone_index_size)?;
            let b = cur.index_signed(bone_index_size)?;
            let w = cur.f32()?;
            let c = cur.f32_array::<3>()?;
            let r0 = cur.f32_array::<3>()?;
            let r1 = cur.f32_array::<3>()?;
            Deform::Sdef {
                indices: [a, b],
                weights: [w, 1.0 - w],
                c,
                r0,
                r1,
            }
        }
        other => return Err(MmdError::UnsupportedDeformType(other)),
    };

    let edge_factor = cur.f32()?;
    Ok(MmdVertex {
        position,
        normal,
        uv,
        edge_factor,
        deform,
    })
}

/// Parse a single material record.
fn parse_material(
    cur: &mut Cursor<'_>,
    encoding: PmxEncoding,
    texture_index_size: u8,
) -> Result<MmdMaterial, MmdError> {
    let name = cur.string(encoding)?;
    let name_global = cur.string(encoding)?;
    let diffuse = cur.f32_array::<4>()?;
    let specular = cur.f32_array::<3>()?;
    let specular_strength = cur.f32()?;
    let ambient = cur.f32_array::<3>()?;
    let flags = cur.u8()?;
    let edge_color = cur.f32_array::<4>()?;
    let edge_size = cur.f32()?;
    let texture_index = cur.index_signed(texture_index_size)?;
    let sphere_texture_index = cur.index_signed(texture_index_size)?;
    let sphere_mode = cur.u8()?;
    let toon_mode = cur.u8()?;
    let toon = match toon_mode {
        0 => MmdToon::Index(cur.index_signed(texture_index_size)?),
        1 => MmdToon::Builtin(cur.u8()?),
        _ => {
            return Err(MmdError::InvalidData(
                "unknown toon mode (expected 0=texture index, 1=built-in)",
            ))
        }
    };
    let comment = cur.string(encoding)?;
    let raw_vertex_count = i64::from(cur.u32()?);
    if raw_vertex_count > i32::MAX as i64 {
        return Err(MmdError::InvalidData("material vertex count exceeds i32"));
    }
    Ok(MmdMaterial {
        name,
        name_global,
        diffuse,
        specular,
        specular_strength,
        ambient,
        flags,
        edge_color,
        edge_size,
        texture_index,
        sphere_texture_index,
        sphere_mode,
        toon,
        comment,
        vertex_count: raw_vertex_count as i32,
    })
}

/// Parse a single bone record.
fn parse_bone(
    cur: &mut Cursor<'_>,
    encoding: PmxEncoding,
    bone_index_size: u8,
) -> Result<MmdBone, MmdError> {
    let name = cur.string(encoding)?;
    let name_global = cur.string(encoding)?;
    let position = cur.f32_array::<3>()?;
    let parent_index = cur.index_signed(bone_index_size)?;
    // Reserved/legacy "transform layer" — read as i32 (three-stdlib uses u32;
    // identical byte layout, only the sign interpretation differs).
    let layer = cur.i32()?;
    let flags = cur.u16()?;

    let tail = if flags & crate::model::bone_flags::TAIL_INDEX != 0 {
        BoneTail::Bone(cur.index_signed(bone_index_size)?)
    } else {
        BoneTail::Offset(cur.f32_array::<3>()?)
    };

    let grant = if flags
        & (crate::model::bone_flags::GRANT_ROTATION | crate::model::bone_flags::GRANT_TRANSLATION)
        != 0
    {
        Some(BoneGrant {
            parent_index: cur.index_signed(bone_index_size)?,
            ratio: cur.f32()?,
            local: flags & crate::model::bone_flags::GRANT_LOCAL != 0,
            rotation: flags & crate::model::bone_flags::GRANT_ROTATION != 0,
            translation: flags & crate::model::bone_flags::GRANT_TRANSLATION != 0,
        })
    } else {
        None
    };

    let fixed_axis = if flags & crate::model::bone_flags::FIXED_AXIS != 0 {
        Some(cur.f32_array::<3>()?)
    } else {
        None
    };

    let local_axes = if flags & crate::model::bone_flags::LOCAL_AXES != 0 {
        Some((cur.f32_array::<3>()?, cur.f32_array::<3>()?))
    } else {
        None
    };

    let external_parent_key = if flags & crate::model::bone_flags::EXTERNAL_PARENT != 0 {
        Some(cur.i32()?)
    } else {
        None
    };

    let ik = if flags & crate::model::bone_flags::IK != 0 {
        let effector_index = cur.index_signed(bone_index_size)?;
        let iteration = cur.u32()?;
        let max_angle = cur.f32()?;
        let link_count = count(cur.u32()?, MAX_IK_LINKS)?;
        let mut links = Vec::with_capacity(link_count);
        for _ in 0..link_count {
            let index = cur.index_signed(bone_index_size)?;
            let angle_limit = match cur.u8()? {
                0 => None,
                1 => Some((cur.f32_array::<3>()?, cur.f32_array::<3>()?)),
                _ => {
                    return Err(MmdError::InvalidData(
                        "IK link angle-limit flag must be 0 or 1",
                    ))
                }
            };
            links.push(BoneIkLink { index, angle_limit });
        }
        Some(BoneIk {
            effector_index,
            iteration,
            max_angle,
            links,
        })
    } else {
        None
    };

    Ok(MmdBone {
        name,
        name_global,
        position,
        parent_index,
        layer,
        flags,
        tail,
        grant,
        fixed_axis,
        local_axes,
        external_parent_key,
        ik,
    })
}
