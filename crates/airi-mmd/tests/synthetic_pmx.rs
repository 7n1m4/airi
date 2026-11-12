// SPDX-License-Identifier: GPL-3.0-or-later

//! Synthetic PMX 2.0 round-trip: build a small-but-valid PMX in memory,
//! parse it, and assert the values survive the round trip.
//!
//! The fixture carries: 4 vertices (BDEF1), one triangle, one texture, **one**
//! material, **two** bones (parent + child), and **two** morphs — a vertex
//! morph and a group morph that references it ("morph membership"). The file
//! ends with the three trailing section counts (display frames / rigid
//! bodies / joints = 0) as a real PmxEditor export would; the parser never
//! reads those sections.
//!
//! No binary fixtures are committed; everything is built byte-by-byte.

use airi_mmd::*;

mod common;
use common::*;

/// Write a BDEF1 vertex with dummy-but-deterministic values.
fn w_vertex_bdef1(buf: &mut Vec<u8>, x: f32, y: f32, z: f32) {
    w_f32(buf, x);
    w_f32(buf, y);
    w_f32(buf, z);
    w_f32(buf, 0.0);
    w_f32(buf, 1.0);
    w_f32(buf, 0.0);
    w_f32(buf, 0.0);
    w_f32(buf, 0.0); // uv
    w_u8(buf, 0); // BDEF1
    w_index_signed(buf, 2, 0); // bone 0
    w_f32(buf, 1.0); // edge factor
}

fn w_bone(buf: &mut Vec<u8>, enc: u8, name: &str, name_global: &str, parent: i32, pos: [f32; 3]) {
    w_str(buf, enc, name);
    w_str(buf, enc, name_global);
    for v in pos {
        w_f32(buf, v);
    }
    w_index_signed(buf, 2, parent);
    w_i32(buf, 0); // layer
    w_u16(
        buf,
        bone_flags::ROTATABLE | bone_flags::VISIBLE | bone_flags::ENABLED,
    );
    // TAIL_INDEX clear -> tail offset
    for v in [0.0_f32, -1.0, 0.0] {
        w_f32(buf, v);
    }
}

/// Build the synthetic model buffer.
fn build_synthetic_model() -> Vec<u8> {
    let enc = ENC_UTF8;
    let mut buf = base_header(enc, 0);
    w_names(&mut buf, enc);

    // Vertices: a tiny tetrahedron.
    w_u32(&mut buf, 4);
    w_vertex_bdef1(&mut buf, 0.0, 1.0, 0.0);
    w_vertex_bdef1(&mut buf, -1.0, 0.0, 0.0);
    w_vertex_bdef1(&mut buf, 1.0, 0.0, 0.0);
    w_vertex_bdef1(&mut buf, 0.0, 0.0, 1.0);

    // One face (raw index count, divisible by 3).
    w_u32(&mut buf, 3);
    for i in [0_u32, 1, 2] {
        w_index_unsigned(&mut buf, 2, i);
    }

    // One texture.
    w_u32(&mut buf, 1);
    w_str(&mut buf, enc, "textures/body.png");

    // One material referencing the texture.
    w_u32(&mut buf, 1);
    w_str(&mut buf, enc, "body");
    w_str(&mut buf, enc, "body-en");
    for v in [0.8_f32, 0.8, 0.8, 1.0] {
        w_f32(&mut buf, v); // diffuse
    }
    for v in [0.0_f32, 0.0, 0.0] {
        w_f32(&mut buf, v); // specular
    }
    w_f32(&mut buf, 0.0); // specular strength
    for v in [0.2_f32, 0.2, 0.2] {
        w_f32(&mut buf, v); // ambient
    }
    w_u8(&mut buf, 0x10); // edge enabled
    for v in [0.0_f32, 0.0, 0.0, 1.0] {
        w_f32(&mut buf, v); // edge color
    }
    w_f32(&mut buf, 1.0); // edge size
    w_index_signed(&mut buf, 1, 0); // texture index
    w_index_signed(&mut buf, 1, -1); // sphere: none
    w_u8(&mut buf, sphere_mode::NONE);
    w_u8(&mut buf, 0); // toon mode: texture index
    w_index_signed(&mut buf, 1, -1); // toon: none
    w_str(&mut buf, enc, "synthetic memo");
    w_u32(&mut buf, 3); // material vertex count (one triangle)

    // Two bones: parent (センター) and child (足) parented to the root.
    w_u32(&mut buf, 2);
    w_bone(&mut buf, enc, "センター", "center", -1, [0.0, 10.0, 0.0]);
    w_bone(&mut buf, enc, "足", "leg", 0, [0.0, 5.0, 0.0]);

    // Morphs: one vertex morph, one group morph referencing it.
    w_u32(&mut buf, 2);

    // morph[0]: vertex morph "頂点変形", panel 4 (その他), two relative offsets
    w_str(&mut buf, enc, "頂点変形");
    w_str(&mut buf, enc, "vertex-deform");
    w_u8(&mut buf, 4); // panel: other
    w_u8(&mut buf, morph_types::VERTEX);
    w_u32(&mut buf, 2); // offset count
    w_index_unsigned(&mut buf, 2, 0); // vertex 0
    for v in [0.25_f32, 0.0, 0.0] {
        w_f32(&mut buf, v);
    }
    w_index_unsigned(&mut buf, 2, 1); // vertex 1
    for v in [0.0_f32, 0.5, 0.0] {
        w_f32(&mut buf, v);
    }

    // morph[1]: group morph "笑顔", panel 3 (口), one member: morph 0 at weight 1.0
    w_str(&mut buf, enc, "笑顔");
    w_str(&mut buf, enc, "smile");
    w_u8(&mut buf, 3); // panel: mouth
    w_u8(&mut buf, morph_types::GROUP);
    w_u32(&mut buf, 1); // offset count
    w_index_signed(&mut buf, 1, 0); // member morph 0 (morph index size = 1)
    w_f32(&mut buf, 1.0); // member weight

    // Trailing sections as a real PmxEditor export carries them.
    // The parser must not read (or care about) these.
    w_u32(&mut buf, 0); // display frames
    w_u32(&mut buf, 0); // rigid bodies
    w_u32(&mut buf, 0); // joints

    buf
}

#[test]
fn synthetic_model_round_trip() {
    let bytes = build_synthetic_model();
    let model = from_bytes(&bytes).expect("synthetic fixture must parse");

    assert_eq!(model.version, 2.0);
    assert_eq!(model.encoding, PmxEncoding::Utf8);
    assert_eq!(model.name, "テストモデル");

    // Vertices and faces survive as written.
    assert_eq!(model.vertices.len(), 4);
    assert_eq!(model.vertices[0].position, [0.0, 1.0, 0.0]);
    assert_eq!(model.vertices[3].position, [0.0, 0.0, 1.0]);
    assert_eq!(model.faces, vec![[0, 1, 2]]);

    // Texture and material.
    assert_eq!(model.textures, vec!["textures/body.png".to_string()]);
    assert_eq!(model.materials.len(), 1);
    assert_eq!(model.materials[0].name, "body");
    assert_eq!(model.materials[0].texture_index, 0);

    // Bone round-trip: child parent id is bone 0.
    assert_eq!(model.bones.len(), 2);
    assert_eq!(model.bones[0].parent_index, -1);
    assert_eq!(model.bones[1].parent_index, 0);
    assert_eq!(model.bones[1].position, [0.0, 5.0, 0.0]);

    // Morph round-trip: vertex morph offsets decoded exactly.
    assert_eq!(model.morphs.len(), 2);
    let vertex = &model.morphs[0];
    assert_eq!(vertex.name, "頂点変形");
    assert_eq!(vertex.name_global, "vertex-deform");
    assert_eq!(vertex.morph_type, morph_types::VERTEX);
    assert_eq!(
        vertex.offsets,
        vec![
            MmdMorphOffset::Vertex {
                vertex_index: 0,
                offset: [0.25, 0.0, 0.0],
            },
            MmdMorphOffset::Vertex {
                vertex_index: 1,
                offset: [0.0, 0.5, 0.0],
            },
        ]
    );

    // Group morph membership: smile → vertex-deform at weight 1.0.
    let group = &model.morphs[1];
    assert_eq!(group.name, "笑顔");
    assert_eq!(group.morph_type, morph_types::GROUP);
    assert_eq!(
        group.offsets,
        vec![MmdMorphOffset::Group {
            morph_index: 0,
            weight: 1.0,
        }]
    );
    match &group.offsets[0] {
        MmdMorphOffset::Group { morph_index, .. } => {
            let target = &model.morphs[*morph_index as usize];
            assert_eq!(target.name, "頂点変形");
        }
        other => panic!("expected Group offset, got {other:?}"),
    }
}

#[test]
fn synthetic_model_survives_trailing_section_garbage() {
    // The parser must stop after morphs; extra trailing bytes are legal and
    // unread. Append junk and re-parse: values must be unchanged.
    let mut bytes = build_synthetic_model();
    let expected = from_bytes(&bytes).expect("fixture must parse");
    bytes.extend_from_slice(&[0xDE, 0xAD, 0xBE, 0xEF, 0x01, 0x02]);
    let tolerated = from_bytes(&bytes).expect("trailing garbage after morphs must be tolerated");
    assert_eq!(tolerated, expected);
}

#[test]
fn group_morph_with_out_of_range_member_returns_error() {
    // One group morph whose only member is morph 7 — out of range.
    let enc = ENC_UTF8;
    let mut buf = base_header(enc, 0);
    w_names(&mut buf, enc);
    w_u32(&mut buf, 0); // no vertices
    w_u32(&mut buf, 0); // no faces
    w_u32(&mut buf, 0); // no textures
    w_u32(&mut buf, 0); // no materials
    w_u32(&mut buf, 0); // no bones
    w_u32(&mut buf, 1); // one morph
    w_str(&mut buf, enc, "bad-group");
    w_str(&mut buf, enc, "bad-group");
    w_u8(&mut buf, 0); // panel
    w_u8(&mut buf, morph_types::GROUP);
    w_u32(&mut buf, 1); // one member
    w_index_signed(&mut buf, 1, 7); // member morph 7 — out of range
    w_f32(&mut buf, 1.0);

    let err = from_bytes(&buf).unwrap_err();
    assert!(
        matches!(err, MmdError::InvalidData(_)),
        "expected InvalidData, got {err:?}"
    );
}
