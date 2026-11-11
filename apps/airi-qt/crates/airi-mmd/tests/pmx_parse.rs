// SPDX-License-Identifier: GPL-3.0-or-later

//! Constructed-fixture tests for the PMX 2.0 parser.
//!
//! Fixtures are built byte-by-byte in memory; no binary blobs are committed.
//! The layout mirrors what PmxEditor emits (and what three-stdlib's mmdparser
//! consumes), confirmed against both the vendored parser and the P10 design
//! note — with two deliberate notes: `version` is an `f32` and bones carry no
//! rest quaternion (see `p10-lane-mmd.md`).

use airi_mmd::*;

mod common;
use common::*;

fn w_vertex_bdef2(buf: &mut Vec<u8>, additional_uv: u8, i0: i32, i1: i32, w: f32) {
    w_f32(buf, 1.0);
    w_f32(buf, 2.0);
    w_f32(buf, 3.0);
    w_f32(buf, 0.0);
    w_f32(buf, 1.0);
    w_f32(buf, 0.0);
    w_f32(buf, 0.25);
    w_f32(buf, 0.75);
    w_auvs(buf, additional_uv);
    w_u8(buf, 1); // BDEF2
    w_index_signed(buf, 2, i0);
    w_index_signed(buf, 2, i1);
    w_f32(buf, w);
    w_f32(buf, 0.25); // edge factor
}

fn w_vertex_bdef4(buf: &mut Vec<u8>, additional_uv: u8) {
    w_f32(buf, 4.0);
    w_f32(buf, 5.0);
    w_f32(buf, 6.0);
    w_f32(buf, 1.0);
    w_f32(buf, 0.0);
    w_f32(buf, 0.0);
    w_f32(buf, 0.5);
    w_f32(buf, 0.5);
    w_auvs(buf, additional_uv);
    w_u8(buf, 2); // BDEF4
    for i in [0, 1, 2, 3] {
        w_index_signed(buf, 2, i);
    }
    for w in [0.1_f32, 0.2, 0.3, 0.4] {
        w_f32(buf, w);
    }
    w_f32(buf, 1.0); // edge factor
}

fn w_vertex_bdef1(buf: &mut Vec<u8>, additional_uv: u8) {
    w_f32(buf, 7.0);
    w_f32(buf, 8.0);
    w_f32(buf, 9.0);
    w_f32(buf, 0.0);
    w_f32(buf, 0.0);
    w_f32(buf, 1.0);
    w_f32(buf, 0.0);
    w_f32(buf, 0.0);
    w_auvs(buf, additional_uv);
    w_u8(buf, 0); // BDEF1
    w_index_signed(buf, 2, 1);
    w_f32(buf, 0.0); // edge factor
}

fn w_vertex_sdef(buf: &mut Vec<u8>, additional_uv: u8) {
    w_f32(buf, 10.0);
    w_f32(buf, 11.0);
    w_f32(buf, 12.0);
    w_f32(buf, -1.0);
    w_f32(buf, -1.0);
    w_f32(buf, -1.0);
    w_f32(buf, 1.0);
    w_f32(buf, 1.0);
    w_auvs(buf, additional_uv);
    w_u8(buf, 3); // SDEF
    w_index_signed(buf, 2, 2);
    w_index_signed(buf, 2, 3);
    w_f32(buf, 0.8); // weight of first bone
    for v in [0.1_f32, 0.2, 0.3] {
        w_f32(buf, v); // C
    }
    for v in [0.4_f32, 0.5, 0.6] {
        w_f32(buf, v); // R0
    }
    for v in [0.7_f32, 0.8, 0.9] {
        w_f32(buf, v); // R1
    }
    w_f32(buf, 0.5); // edge factor
}

fn w_standard_sections(
    buf: &mut Vec<u8>,
    enc: u8,
    additional_uv: u8,
    vertex_index_size: u8,
    morph_count: u32,
) {
    // Vertices
    w_u32(buf, 4);
    w_vertex_bdef2(buf, additional_uv, 0, 1, 0.75);
    w_vertex_bdef4(buf, additional_uv);
    w_vertex_bdef1(buf, additional_uv);
    w_vertex_sdef(buf, additional_uv);

    // Faces: one triangle, count stored as raw index count
    w_u32(buf, 3);
    for i in [0_u32, 1, 2] {
        w_index_unsigned(buf, vertex_index_size, i);
    }

    // Textures
    w_u32(buf, 1);
    w_str(buf, enc, "textures/body.png");

    // Materials
    w_u32(buf, 2);

    // m0: toon by built-in ramp, sphere off
    w_str(buf, enc, "main");
    w_str(buf, enc, "main-en");
    for v in [0.8_f32, 0.7, 0.6, 1.0] {
        w_f32(buf, v); // diffuse
    }
    for v in [0.1_f32, 0.2, 0.3] {
        w_f32(buf, v); // specular
    }
    w_f32(buf, 32.0); // specular strength
    for v in [0.4_f32, 0.5, 0.6] {
        w_f32(buf, v); // ambient
    }
    w_u8(buf, 0x10); // drawing flags: edge enabled
    for v in [0.1_f32, 0.1, 0.1, 1.0] {
        w_f32(buf, v); // edge color
    }
    w_f32(buf, 1.5); // edge size
    w_index_signed(buf, 1, 0); // texture index
    w_index_signed(buf, 1, -1); // sphere index: none
    w_u8(buf, sphere_mode::NONE);
    w_u8(buf, 1); // toon mode 1 = built-in
    w_u8(buf, 5); // built-in toon id
    w_str(buf, enc, "mat-memo");
    w_u32(buf, 3); // material index count (one triangle)

    // m1: toon by texture index, additive sphere map
    w_str(buf, enc, "sub");
    w_str(buf, enc, "sub-en");
    for v in [1.0_f32, 0.5, 0.5, 0.9] {
        w_f32(buf, v); // diffuse
    }
    for v in [0.0_f32, 0.0, 0.0] {
        w_f32(buf, v); // specular
    }
    w_f32(buf, 0.0); // specular strength
    for v in [0.2_f32, 0.2, 0.2] {
        w_f32(buf, v); // ambient
    }
    w_u8(buf, 0x00); // drawing flags
    for v in [0.0_f32, 0.0, 0.0, 0.0] {
        w_f32(buf, v); // edge color
    }
    w_f32(buf, 0.0); // edge size
    w_index_signed(buf, 1, -1); // texture index: none
    w_index_signed(buf, 1, 0); // sphere index -> textures[0]
    w_u8(buf, sphere_mode::ADD);
    w_u8(buf, 0); // toon mode 0 = texture index
    w_index_signed(buf, 1, 0); // toon texture index
    w_str(buf, enc, "");
    w_u32(buf, 3); // material index count

    // Bones
    w_u32(buf, 2);

    // b0: root, tail as offset
    w_str(buf, enc, "センター");
    w_str(buf, enc, "center");
    for v in [0.0_f32, 10.0, 0.0] {
        w_f32(buf, v); // position
    }
    w_index_signed(buf, 2, -1); // parent: none
    w_i32(buf, 0); // layer
    w_u16(
        buf,
        bone_flags::ROTATABLE
            | bone_flags::TRANSLATABLE
            | bone_flags::VISIBLE
            | bone_flags::ENABLED,
    ); // 0x001E
       // tail: no TAIL_INDEX bit -> offset
    for v in [0.0_f32, -4.0, 0.0] {
        w_f32(buf, v);
    }

    // b1: child, tail as bone index 0
    w_str(buf, enc, "足");
    w_str(buf, enc, "leg");
    for v in [0.0_f32, 5.0, 0.0] {
        w_f32(buf, v); // position
    }
    w_index_signed(buf, 2, 0); // parent: bone 0
    w_i32(buf, 1); // layer
    w_u16(
        buf,
        bone_flags::ROTATABLE | bone_flags::VISIBLE | bone_flags::ENABLED | bone_flags::TAIL_INDEX,
    ); // 0x001B
    w_index_signed(buf, 2, 0); // tail: bone 0

    // Morphs
    w_u32(buf, morph_count);
}

/// Standard minimal model: 4 vertices (BDEF2/BDEF4/BDEF1/SDEF), 1 triangle,
/// 1 texture, 2 materials, 2 bones, 0 morphs.
fn build_model(enc: u8, additional_uv: u8, morph_count: u32) -> Vec<u8> {
    let mut buf = base_header(enc, additional_uv);
    w_names(&mut buf, enc);
    w_standard_sections(&mut buf, enc, additional_uv, 2, morph_count);
    buf
}

#[test]
fn parses_utf8_minimal_model() {
    let bytes = build_model(ENC_UTF8, 4, 0);
    let model = from_bytes(&bytes).expect("fixture must parse");

    assert_eq!(model.name, "テストモデル");
    assert_eq!(model.name_global, "test-model");
    assert_eq!(model.comment, "コメント");
    assert_eq!(model.comment_global, "comment");
    assert_eq!(model.version, 2.0);
    assert_eq!(model.encoding, PmxEncoding::Utf8);

    assert_eq!(model.vertices.len(), 4);

    let v0 = &model.vertices[0];
    assert_eq!(v0.position, [1.0, 2.0, 3.0]);
    assert_eq!(v0.normal, [0.0, 1.0, 0.0]);
    assert_eq!(v0.uv, [0.25, 0.75]);
    assert_f32(v0.edge_factor, 0.25);
    match v0.deform {
        Deform::Bdef2(indices, weights) => {
            assert_eq!(indices, [0, 1]);
            assert_f32(weights[0], 0.75);
            assert_f32(weights[1], 0.25);
            assert_f32(weights[0] + weights[1], 1.0);
        }
        other => panic!("expected BDEF2, got {other:?}"),
    }

    let v1 = &model.vertices[1];
    match v1.deform {
        Deform::Bdef4(indices, weights) => {
            assert_eq!(indices, [0, 1, 2, 3]);
            for (got, want) in weights.iter().zip([0.1_f32, 0.2, 0.3, 0.4]) {
                assert_f32(*got, want);
            }
        }
        other => panic!("expected BDEF4, got {other:?}"),
    }
    assert_eq!(v1.position, [4.0, 5.0, 6.0]);

    let v2 = &model.vertices[2];
    assert_eq!(v2.deform, Deform::Bdef1([1]));

    let v3 = &model.vertices[3];
    match v3.deform {
        Deform::Sdef {
            indices,
            weights,
            c,
            r0,
            r1,
        } => {
            assert_eq!(indices, [2, 3]);
            assert_f32(weights[0], 0.8);
            assert_f32(weights[1], 0.19999999);
            for (got, want) in c.iter().zip([0.1_f32, 0.2, 0.3]) {
                assert_f32(*got, want);
            }
            for (got, want) in r0.iter().zip([0.4_f32, 0.5, 0.6]) {
                assert_f32(*got, want);
            }
            for (got, want) in r1.iter().zip([0.7_f32, 0.8, 0.9]) {
                assert_f32(*got, want);
            }
        }
        other => panic!("expected SDEF, got {other:?}"),
    }
    assert_eq!(v3.position, [10.0, 11.0, 12.0]);
    assert_f32(v3.edge_factor, 0.5);

    assert_eq!(model.faces, vec![[0, 1, 2]]);

    assert_eq!(model.textures, vec!["textures/body.png".to_string()]);

    assert_eq!(model.materials.len(), 2);
    let m0 = &model.materials[0];
    assert_eq!(m0.name, "main");
    assert_eq!(m0.name_global, "main-en");
    assert_eq!(m0.diffuse, [0.8, 0.7, 0.6, 1.0]);
    assert_eq!(m0.specular, [0.1, 0.2, 0.3]);
    assert_f32(m0.specular_strength, 32.0);
    assert_eq!(m0.ambient, [0.4, 0.5, 0.6]);
    assert_eq!(m0.flags, 0x10);
    assert_eq!(m0.edge_color, [0.1, 0.1, 0.1, 1.0]);
    assert_f32(m0.edge_size, 1.5);
    assert_eq!(m0.texture_index, 0);
    assert_eq!(m0.sphere_texture_index, -1);
    assert_eq!(m0.sphere_mode, sphere_mode::NONE);
    assert_eq!(m0.toon, MmdToon::Builtin(5));
    assert_eq!(m0.comment, "mat-memo");
    assert_eq!(m0.vertex_count, 3);

    let m1 = &model.materials[1];
    assert_eq!(m1.texture_index, -1);
    assert_eq!(m1.sphere_texture_index, 0);
    assert_eq!(m1.sphere_mode, sphere_mode::ADD);
    assert_eq!(m1.toon, MmdToon::Index(0));
    assert_eq!(m1.comment, "");
    assert_eq!(m1.vertex_count, 3);

    assert_eq!(model.bones.len(), 2);
    let b0 = &model.bones[0];
    assert_eq!(b0.name, "センター");
    assert_eq!(b0.name_global, "center");
    assert_eq!(b0.position, [0.0, 10.0, 0.0]);
    assert_eq!(b0.parent_index, -1);
    assert_eq!(b0.layer, 0);
    assert_eq!(
        b0.flags,
        bone_flags::ROTATABLE
            | bone_flags::TRANSLATABLE
            | bone_flags::VISIBLE
            | bone_flags::ENABLED
    );
    assert_eq!(b0.tail, BoneTail::Offset([0.0, -4.0, 0.0]));
    assert!(b0.grant.is_none());
    assert!(b0.ik.is_none());
    assert!(b0.fixed_axis.is_none());

    let b1 = &model.bones[1];
    assert_eq!(b1.name, "足");
    assert_eq!(b1.parent_index, 0);
    assert_eq!(b1.layer, 1);
    assert_eq!(b1.tail, BoneTail::Bone(0));
    assert_eq!(
        b1.flags,
        bone_flags::ROTATABLE | bone_flags::VISIBLE | bone_flags::ENABLED | bone_flags::TAIL_INDEX
    );
}

#[test]
fn parses_utf16le_minimal_model() {
    let bytes = build_model(ENC_UTF16LE, 0, 0);
    let model = from_bytes(&bytes).expect("UTF-16LE fixture must parse");

    assert_eq!(model.encoding, PmxEncoding::Utf16Le);
    assert_eq!(model.name, "テストモデル");
    assert_eq!(model.name_global, "test-model");
    assert_eq!(model.comment, "コメント");
    assert_eq!(model.comment_global, "comment");

    assert_eq!(model.vertices.len(), 4);
    assert_eq!(model.faces, vec![[0, 1, 2]]);
    assert_eq!(model.textures, vec!["textures/body.png".to_string()]);
    assert_eq!(model.materials.len(), 2);
    assert_eq!(model.bones.len(), 2);
    assert_eq!(model.bones[0].name, "センター");
    assert_eq!(model.bones[1].name, "足");
}

#[test]
fn truncated_input_reports_typed_error() {
    let bytes = build_model(ENC_UTF8, 4, 0);

    // Cut inside the header (names never appear).
    let cut = from_bytes(&bytes[..8]);
    assert!(
        matches!(cut, Err(MmdError::Truncated { .. })),
        "expected Truncated, got {cut:?}"
    );

    // Cut one byte before the morph-count tail (somewhere inside bones).
    let cut = from_bytes(&bytes[..bytes.len() - 1]);
    assert!(
        matches!(cut, Err(MmdError::Truncated { .. })),
        "expected Truncated, got {cut:?}"
    );

    // Empty input.
    let cut = from_bytes(&[]);
    assert!(matches!(cut, Err(MmdError::Truncated { .. })));
}

#[test]
fn bad_magic_returns_typed_error() {
    let mut bytes = build_model(ENC_UTF8, 0, 0);
    bytes[0] = b'X';
    assert!(matches!(from_bytes(&bytes), Err(MmdError::BadMagic)));

    let mut bytes = build_model(ENC_UTF16LE, 0, 0);
    bytes[3] = b'!';
    assert!(matches!(from_bytes(&bytes), Err(MmdError::BadMagic)));
}

#[test]
fn unsupported_version_returns_typed_error() {
    let mut buf = base_header(ENC_UTF8, 0);
    buf.splice(4..8, 3.0_f32.to_le_bytes());
    let err = from_bytes(&buf).unwrap_err();
    assert!(
        matches!(err, MmdError::UnsupportedVersion(v) if (v - 3.0).abs() < f32::EPSILON),
        "expected UnsupportedVersion(3.0), got {err:?}"
    );
}

#[test]
fn unsupported_deform_type_returns_typed_error() {
    // One vertex, deform type 0x09 (not BDEF1/2/4/SDEF).
    let mut buf = base_header(ENC_UTF8, 0);
    w_names(&mut buf, ENC_UTF8);
    w_u32(&mut buf, 1); // one vertex
    for v in [0.0_f32, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0] {
        w_f32(&mut buf, v);
    }
    w_u8(&mut buf, 9); // deform type: not supported
    let err = from_bytes(&buf).unwrap_err();
    assert!(
        matches!(err, MmdError::UnsupportedDeformType(9)),
        "expected UnsupportedDeformType(9), got {err:?}"
    );
}

#[test]
fn morphs_declared_but_absent_returns_truncated() {
    // Two morphs declared but not written — must surface as a typed
    // Truncated error (morphs are decoded since the morph-parser landed;
    // the old UnsupportedFeature("morphs") behavior is gone).
    let bytes = build_model(ENC_UTF8, 0, 2); // two morphs declared, none written
    let err = from_bytes(&bytes).unwrap_err();
    assert!(
        matches!(err, MmdError::Truncated { at: "morphs" }),
        "expected Truncated at \"morphs\", got {err:?}"
    );
}

#[test]
fn face_count_not_multiple_of_three_returns_error() {
    let mut buf = base_header(ENC_UTF8, 0);
    w_names(&mut buf, ENC_UTF8);
    w_u32(&mut buf, 3); // three vertices
    for _ in 0..3 {
        for v in [0.0_f32, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0] {
            w_f32(&mut buf, v);
        }
        w_u8(&mut buf, 0); // BDEF1
        w_index_signed(&mut buf, 2, 0);
        w_f32(&mut buf, 0.0); // edge factor
    }
    w_u32(&mut buf, 4); // face index count — not divisible by 3
    let err = from_bytes(&buf).unwrap_err();
    assert!(
        matches!(err, MmdError::InvalidData(_)),
        "expected InvalidData, got {err:?}"
    );
}

#[test]
fn face_index_out_of_range_returns_error() {
    let mut buf = base_header(ENC_UTF8, 0);
    w_names(&mut buf, ENC_UTF8);
    w_u32(&mut buf, 3); // three vertices
    for _ in 0..3 {
        for v in [0.0_f32, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0] {
            w_f32(&mut buf, v);
        }
        w_u8(&mut buf, 0); // BDEF1
        w_index_signed(&mut buf, 2, 0);
        w_f32(&mut buf, 0.0);
    }
    w_u32(&mut buf, 3); // one face
    for i in [0_u32, 1, 9] {
        // 9 is out of range
        w_index_unsigned(&mut buf, 2, i);
    }
    let err = from_bytes(&buf).unwrap_err();
    assert!(
        matches!(err, MmdError::InvalidData(_)),
        "expected InvalidData, got {err:?}"
    );
}

#[test]
fn invalid_index_size_returns_error() {
    let mut buf = base_header(ENC_UTF8, 0);
    buf[11] = 3; // vertexIndexSize — only 1, 2, 4 are valid
    let err = from_bytes(&buf).unwrap_err();
    assert!(
        matches!(err, MmdError::InvalidData(_)),
        "expected InvalidData, got {err:?}"
    );
}

#[test]
fn grant_and_ik_bones_decode() {
    let enc = ENC_UTF8;
    let mut buf = base_header(enc, 0);
    w_names(&mut buf, enc);

    // No vertices, no faces, no textures, no materials.
    w_u32(&mut buf, 0);
    w_u32(&mut buf, 0);
    w_u32(&mut buf, 0);
    w_u32(&mut buf, 0);

    // Three bones: root, grant-child, IK bone.
    w_u32(&mut buf, 3);

    // b0: root
    w_str(&mut buf, enc, "センター");
    w_str(&mut buf, enc, "center");
    for v in [0.0_f32, 10.0, 0.0] {
        w_f32(&mut buf, v);
    }
    w_index_signed(&mut buf, 2, -1);
    w_i32(&mut buf, 0);
    w_u16(&mut buf, 0x001E);
    for v in [0.0_f32, -4.0, 0.0] {
        w_f32(&mut buf, v);
    }

    // b1: inherits rotation+translation, local frame
    w_str(&mut buf, enc, "腕");
    w_str(&mut buf, enc, "arm");
    for v in [0.0_f32, 8.0, 0.0] {
        w_f32(&mut buf, v);
    }
    w_index_signed(&mut buf, 2, 0); // parent
    w_i32(&mut buf, 0);
    w_u16(
        &mut buf,
        bone_flags::VISIBLE
            | bone_flags::ENABLED
            | bone_flags::GRANT_ROTATION
            | bone_flags::GRANT_TRANSLATION
            | bone_flags::GRANT_LOCAL,
    );
    for v in [0.0_f32, -2.0, 0.0] {
        w_f32(&mut buf, v); // tail offset
    }
    w_index_signed(&mut buf, 2, 0); // grant parent
    w_f32(&mut buf, 0.5); // grant ratio

    // b2: IK bone, one angle-limited link
    w_str(&mut buf, enc, "足ＩＫ");
    w_str(&mut buf, enc, "leg-ik");
    for v in [0.0_f32, 0.0, 0.0] {
        w_f32(&mut buf, v);
    }
    w_index_signed(&mut buf, 2, -1); // parent: none
    w_i32(&mut buf, 0);
    w_u16(
        &mut buf,
        bone_flags::VISIBLE | bone_flags::ENABLED | bone_flags::IK,
    );
    for v in [0.0_f32, -4.0, 0.0] {
        w_f32(&mut buf, v); // tail offset
    }
    w_index_signed(&mut buf, 2, 1); // effector: bone 1
    w_u32(&mut buf, 40); // iteration
    w_f32(&mut buf, 1.0); // max angle
    w_u32(&mut buf, 1); // one link
    w_index_signed(&mut buf, 2, 1); // link bone 1
    w_u8(&mut buf, 1); // angle limit present
    for v in [-0.5_f32, -0.5, -0.5] {
        w_f32(&mut buf, v); // lower
    }
    for v in [0.5_f32, 0.5, 0.5] {
        w_f32(&mut buf, v); // upper
    }

    // No morphs.
    w_u32(&mut buf, 0);

    let model = from_bytes(&buf).expect("fixture must parse");
    assert_eq!(model.bones.len(), 3);

    let b1 = &model.bones[1];
    let grant = b1.grant.expect("grant data must be present");
    assert_eq!(grant.parent_index, 0);
    assert_f32(grant.ratio, 0.5);
    assert!(grant.local);
    assert!(grant.rotation);
    assert!(grant.translation);

    let b2 = &model.bones[2];
    let ik = b2.ik.as_ref().expect("IK data must be present");
    assert_eq!(ik.effector_index, 1);
    assert_eq!(ik.iteration, 40);
    assert_f32(ik.max_angle, 1.0);
    assert_eq!(ik.links.len(), 1);
    assert_eq!(ik.links[0].index, 1);
    let (lower, upper) = ik.links[0].angle_limit.expect("angle limit present");
    assert_eq!(lower, [-0.5, -0.5, -0.5]);
    assert_eq!(upper, [0.5, 0.5, 0.5]);
}

#[test]
fn every_truncation_prefix_returns_without_panicking() {
    let bytes = build_model(ENC_UTF8, 4, 0);
    for len in 0..bytes.len() {
        let _ = from_bytes(&bytes[..len]);
    }
}

#[test]
fn mutated_bytes_never_panic() {
    let bytes = build_model(ENC_UTF8, 4, 0);
    // xorshift64 — deterministic; no external fuzzer needed.
    let mut state = 0x243F6A8885A308D3_u64;
    for _ in 0..512 {
        let mut mutated = bytes.clone();
        for _ in 0..8 {
            state ^= state << 13;
            state ^= state >> 7;
            state ^= state << 17;
            let pos = (state as usize) % mutated.len();
            state ^= state << 13;
            state ^= state >> 7;
            state ^= state << 17;
            mutated[pos] = state as u8;
        }
        // A flip may produce Ok or a typed error; it may never panic.
        let _ = from_bytes(&mutated);
    }
}

#[test]
fn ik_link_angle_limit_flag_invalid_returns_error() {
    let enc = ENC_UTF8;
    let mut buf = base_header(enc, 0);
    w_names(&mut buf, enc);
    w_u32(&mut buf, 0); // no vertices
    w_u32(&mut buf, 0); // no faces
    w_u32(&mut buf, 0); // no textures
    w_u32(&mut buf, 0); // no materials

    w_u32(&mut buf, 1); // one bone
    w_str(&mut buf, enc, "ＩＫ");
    w_str(&mut buf, enc, "ik");
    for v in [0.0_f32, 0.0, 0.0] {
        w_f32(&mut buf, v);
    }
    w_index_signed(&mut buf, 2, -1);
    w_i32(&mut buf, 0);
    w_u16(&mut buf, bone_flags::ENABLED | bone_flags::IK);
    for v in [0.0_f32, 0.0, 0.0] {
        w_f32(&mut buf, v); // tail offset
    }
    w_index_signed(&mut buf, 2, 0); // effector
    w_u32(&mut buf, 10); // iteration
    w_f32(&mut buf, 0.5); // max angle
    w_u32(&mut buf, 1); // one link
    w_index_signed(&mut buf, 2, 0);
    w_u8(&mut buf, 2); // invalid angle-limit flag

    let err = from_bytes(&buf).unwrap_err();
    assert!(
        matches!(err, MmdError::InvalidData(_)),
        "expected InvalidData, got {err:?}"
    );
}
