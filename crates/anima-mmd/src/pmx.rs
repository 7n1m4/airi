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
//! This reader decodes everything up to and including the morphs section.
//! Display frames, rigid bodies and joints (everything after morphs) are
//! never interpreted. Physics and IK *evaluation* remain out of scope for
//! the M0 parser milestone (IK data is decoded and stored, never run).

use crate::cursor::Cursor;
use crate::error::MmdError;
use crate::model::{
    BoneGrant, BoneIk, BoneIkLink, BoneTail, Deform, MmdBone, MmdMaterial, MmdModel, MmdMorph,
    MmdMorphOffset, MmdToon, MmdVertex, PmxEncoding, MAX_ADDITIONAL_UV, MAX_BONES,
    MAX_FACE_INDICES, MAX_IK_LINKS, MAX_MATERIALS, MAX_MORPHS, MAX_MORPH_OFFSETS, MAX_TEXTURES,
    MAX_VERTICES,
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
    // Validated but, apart from the morphs section, unused: morph element
    // indices are read with these sizes (display frames/physics sections are
    // never decoded).
    let material_index_size = index_size(cur.u8()?)?;
    let bone_index_size = index_size(cur.u8()?)?;
    let morph_index_size = index_size(cur.u8()?)?;
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

    // The morphs section follows bones. Display frames, rigid bodies and
    // joints (everything after morphs) are never interpreted — a file that
    // ends right after the morphs section is equally valid.
    cur.set_section("morphs");
    let morph_count = count(cur.u32()?, MAX_MORPHS)?;
    let mut morphs = Vec::with_capacity(morph_count);
    for _ in 0..morph_count {
        morphs.push(parse_morph(
            &mut cur,
            encoding,
            vertex_index_size,
            bone_index_size,
            material_index_size,
            morph_index_size,
        )?);
    }
    validate_morph_indices(&morphs, vertices.len(), bones.len(), materials.len())?;

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
        morphs,
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

/// Parse a single morph record.
///
/// Element layouts are verified against three-stdlib's mmdparser.js (what
/// AIRI's Vue stage runs), with two exceptions: additional-UV morphs
/// (types 4..=7) are parsed spec-consistently as `vertex index + vec4` but
/// cannot be verified against a real file (three-stdlib does not decode
/// them), and flip/display morphs (types 9 and 10) return
/// [`MmdError::UnsupportedMorphType`] because no layout is confirmed.
fn parse_morph(
    cur: &mut Cursor<'_>,
    encoding: PmxEncoding,
    vertex_index_size: u8,
    bone_index_size: u8,
    material_index_size: u8,
    morph_index_size: u8,
) -> Result<MmdMorph, MmdError> {
    use crate::model::morph_types;

    let name = cur.string(encoding)?;
    let name_global = cur.string(encoding)?;
    let panel = cur.u8()?;
    let morph_type = cur.u8()?;
    let offset_count = count(cur.u32()?, MAX_MORPH_OFFSETS)?;
    let mut offsets = Vec::with_capacity(offset_count);

    for _ in 0..offset_count {
        match morph_type {
            morph_types::GROUP => offsets.push(MmdMorphOffset::Group {
                morph_index: cur.index_signed(morph_index_size)?,
                weight: cur.f32()?,
            }),
            morph_types::VERTEX => offsets.push(MmdMorphOffset::Vertex {
                vertex_index: cur.index_unsigned(vertex_index_size)?,
                offset: cur.f32_array::<3>()?,
            }),
            morph_types::BONE => offsets.push(MmdMorphOffset::Bone {
                bone_index: cur.index_signed(bone_index_size)?,
                position: cur.f32_array::<3>()?,
                rotation: cur.f32_array::<4>()?,
            }),
            morph_types::UV => offsets.push(MmdMorphOffset::Uv {
                vertex_index: cur.index_unsigned(vertex_index_size)?,
                offset: cur.f32_array::<4>()?,
            }),
            morph_types::ADDITIONAL_UV_1
            | morph_types::ADDITIONAL_UV_2
            | morph_types::ADDITIONAL_UV_3
            | morph_types::ADDITIONAL_UV_4 => offsets.push(MmdMorphOffset::AdditionalUv {
                uv_index: morph_type - morph_types::ADDITIONAL_UV_1 + 1,
                vertex_index: cur.index_unsigned(vertex_index_size)?,
                offset: cur.f32_array::<4>()?,
            }),
            morph_types::MATERIAL => offsets.push(MmdMorphOffset::Material {
                material_index: cur.index_signed(material_index_size)?,
                mode: cur.u8()?,
                diffuse: cur.f32_array::<4>()?,
                specular: cur.f32_array::<3>()?,
                shininess: cur.f32()?,
                ambient: cur.f32_array::<3>()?,
                edge_color: cur.f32_array::<4>()?,
                edge_size: cur.f32()?,
                texture_color: cur.f32_array::<4>()?,
                sphere_texture_color: cur.f32_array::<4>()?,
                toon_color: cur.f32_array::<4>()?,
            }),
            other => return Err(MmdError::UnsupportedMorphType(other)),
        }
    }

    Ok(MmdMorph {
        name,
        name_global,
        panel,
        morph_type,
        offsets,
    })
}

/// Bounds-check every morph offset against the decoded document.
///
/// Indices are validated against the sections they reference (a forward
/// reference to a not-yet-declared morph is not possible here because this
/// runs after the whole morphs section is decoded):
/// - group members must reference an existing morph,
/// - vertex/UV/additional-UV indices must reference an existing vertex,
/// - bone indices must be `-1` (none) or reference an existing bone,
/// - material indices must be `-1` ("all materials") or reference an existing
///   material.
fn validate_morph_indices(
    morphs: &[MmdMorph],
    vertex_count: usize,
    bone_count: usize,
    material_count: usize,
) -> Result<(), MmdError> {
    for morph in morphs {
        for offset in &morph.offsets {
            match offset {
                MmdMorphOffset::Group { morph_index, .. } => {
                    if *morph_index < 0 || *morph_index as usize >= morphs.len() {
                        return Err(MmdError::InvalidData(
                            "group morph references out-of-range morph",
                        ));
                    }
                }
                MmdMorphOffset::Vertex { vertex_index, .. }
                | MmdMorphOffset::Uv { vertex_index, .. }
                | MmdMorphOffset::AdditionalUv { vertex_index, .. } => {
                    if *vertex_index as usize >= vertex_count {
                        return Err(MmdError::InvalidData(
                            "morph references out-of-range vertex",
                        ));
                    }
                }
                MmdMorphOffset::Bone { bone_index, .. } => {
                    if *bone_index != -1 && *bone_index as usize >= bone_count {
                        return Err(MmdError::InvalidData("morph references out-of-range bone"));
                    }
                }
                MmdMorphOffset::Material { material_index, .. } => {
                    if *material_index != -1 && *material_index as usize >= material_count {
                        return Err(MmdError::InvalidData(
                            "morph references out-of-range material",
                        ));
                    }
                }
            }
        }
    }
    Ok(())
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

#[cfg(test)]
mod tests {
    use super::*;

    /// Encoding flags: 0 = UTF-16LE, 1 = UTF-8.
    const UTF16LE: u8 = 0;
    const UTF8: u8 = 1;

    /// Append a length-prefixed PMX string.
    fn put_string(buf: &mut Vec<u8>, encoding: u8, text: &str) {
        if encoding == UTF8 {
            buf.extend_from_slice(&(text.len() as i32).to_le_bytes());
            buf.extend_from_slice(text.as_bytes());
        } else {
            let units: Vec<u16> = text.encode_utf16().collect();
            buf.extend_from_slice(&((units.len() * 2) as i32).to_le_bytes());
            for unit in units {
                buf.extend_from_slice(&unit.to_le_bytes());
            }
        }
    }

    /// Append a little-endian `f32`.
    fn put_f32(buf: &mut Vec<u8>, value: f32) {
        buf.extend_from_slice(&value.to_le_bytes());
    }

    /// Append the PMX header (magic, version, globals) plus the four
    /// length-prefixed name/comment strings.
    fn put_header(buf: &mut Vec<u8>, encoding: u8) {
        buf.extend_from_slice(b"PMX ");
        put_f32(buf, 2.0);
        buf.push(8); // header_size, read and ignored
        buf.push(encoding);
        buf.push(0); // additional UV count
        for size in [1u8, 1, 1, 1, 1, 1] {
            buf.push(size); // vertex/texture/material/bone/morph/rigid-body index sizes
        }
        put_string(buf, encoding, "test model");
        put_string(buf, encoding, "");
        put_string(buf, encoding, "comment");
        put_string(buf, encoding, "");
    }

    /// Append the count that opens a section.
    fn put_count(buf: &mut Vec<u8>, n: u32) {
        buf.extend_from_slice(&n.to_le_bytes());
    }

    /// Build a minimal valid PMX 2.0 buffer: one model name and comment, zero
    /// vertices, faces, textures, materials, bones and morphs. Bytes after the
    /// morphs section (display frames, rigid bodies, joints) are never read, so
    /// the buffer ends there.
    fn minimal_pmx(encoding: u8) -> Vec<u8> {
        let mut buf = Vec::new();
        put_header(&mut buf, encoding);
        for _ in 0..6 {
            put_count(&mut buf, 0);
        }
        buf
    }

    /// Assert that `bytes` is rejected with a bounds error naming `section`.
    fn assert_truncated(bytes: &[u8], section: &str) {
        let error = parse(bytes).expect_err("truncated input must fail");
        assert!(
            matches!(&error, MmdError::Truncated { at } if *at == section),
            "expected Truncated {{ at: {section:?} }}, got {error:?}"
        );
    }

    #[test]
    fn parse_minimal_pmx_succeeds() {
        let model = parse(&minimal_pmx(1)).expect("minimal model must parse");

        assert_eq!(model.name, "test model");
        assert_eq!(model.name_global, "");
        assert_eq!(model.comment, "comment");
        assert_eq!(model.comment_global, "");
        assert_eq!(model.version, 2.0);
        assert_eq!(model.encoding, PmxEncoding::Utf8);
        assert!(model.vertices.is_empty());
        assert!(model.faces.is_empty());
        assert!(model.textures.is_empty());
        assert!(model.materials.is_empty());
        assert!(model.bones.is_empty());
        assert!(model.morphs.is_empty());
    }

    /// The same minimal model, encoded as UTF-16LE (the PMX default).
    #[test]
    fn parse_minimal_pmx_utf16_succeeds() {
        let buf = minimal_pmx(UTF16LE);

        let model = parse(&buf).expect("minimal UTF-16 model must parse");
        assert_eq!(model.name, "test model");
        assert_eq!(model.encoding, PmxEncoding::Utf16Le);
    }

    #[test]
    fn parse_rejects_bad_signature() {
        let mut bytes = minimal_pmx(1);
        bytes[0] = b'X';

        assert!(matches!(parse(&bytes), Err(MmdError::BadMagic)));
    }

    #[test]
    fn parse_rejects_truncated_header() {
        // The header is 16 bytes (magic 4 + version 4 + 8 global bytes): every
        // cut below that fails inside "header", and cutting into the model-name
        // length prefix reports "names".
        let bytes = minimal_pmx(1);
        for cut in [1, 4, 8, 15] {
            assert_truncated(&bytes[..cut], "header");
        }
        assert_truncated(&bytes[..17], "names");
    }

    /// Append one BDEF1 vertex record: position (3) + normal (3) + UV (2) +
    /// deform byte + bone index + edge factor = 52 bytes with 1-byte indices.
    fn put_vertex(buf: &mut Vec<u8>) {
        for value in [
            1.0f32, 2.0, 3.0, // position
            0.0, 1.0, 0.0, // normal
            0.5, 0.5, // uv
        ] {
            put_f32(buf, value);
        }
        buf.push(DEFORM_BDEF1);
        buf.push(0); // bone index 0
        put_f32(buf, 0.0); // edge factor
    }

    /// Length of one BDEF1 vertex record built by [`put_vertex`].
    const VERTEX_LEN: usize = 8 * 4 + 2 + 4;

    /// A model with one BDEF1 vertex. Returns the buffer and the offset of the
    /// vertex count inside it.
    fn one_vertex_pmx() -> (Vec<u8>, usize) {
        let mut buf = minimal_pmx(1);
        let vertex_count_at = buf.len() - 6 * 4;
        buf.truncate(vertex_count_at);
        put_count(&mut buf, 1);
        put_vertex(&mut buf);
        // Faces, textures, materials, bones, morphs (all empty).
        for _ in 0..5 {
            put_count(&mut buf, 0);
        }
        assert!(parse(&buf).is_ok());
        (buf, vertex_count_at)
    }

    #[test]
    fn parse_rejects_truncated_mid_body() {
        // Every cut inside the 52-byte record is a cut inside the vertex array.
        let (buf, vertex_count_at) = one_vertex_pmx();
        let vertex_at = vertex_count_at + 4;
        for cut in [1, 27, VERTEX_LEN - 1] {
            assert_truncated(&buf[..vertex_at + cut], "vertices");
        }

        // A count that promises more records than the buffer holds runs out of
        // input mid-array instead of reading past the end: the count says 4,
        // the buffer still carries exactly one record.
        let mut over_counted = buf;
        over_counted[vertex_count_at..vertex_at].copy_from_slice(&4u32.to_le_bytes());
        assert_truncated(&over_counted, "vertices");
    }
}
