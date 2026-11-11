// SPDX-License-Identifier: GPL-3.0-or-later

//! Rest-pose mesh assembly tests.
//!
//! The fixture is built byte-by-byte in memory (same approach as
//! `synthetic_pmx.rs`) and carries a mix of BDEF1/BDEF2/BDEF4/SDEF vertices,
//! two materials with different face ranges, and both a zero and a non-zero
//! ambient vector to exercise the shade-color fallback.

use airi_mmd::*;

mod common;
use common::*;

const BONE_INDEX_SIZE: u8 = 2;

fn w_bone(buf: &mut Vec<u8>, enc: u8, name: &str, parent: i32, pos: [f32; 3]) {
    w_str(buf, enc, name);
    w_str(buf, enc, "");
    for v in pos {
        w_f32(buf, v);
    }
    w_index_signed(buf, BONE_INDEX_SIZE, parent);
    w_i32(buf, 0); // layer
    w_u16(
        buf,
        bone_flags::ROTATABLE | bone_flags::VISIBLE | bone_flags::ENABLED,
    );
    for v in [0.0_f32, -1.0, 0.0] {
        w_f32(buf, v); // tail offset
    }
}

fn w_common_header(buf: &mut Vec<u8>) {
    buf.extend_from_slice(b"PMX ");
    w_f32(buf, 2.0);
    w_u8(buf, 8); // header size
    w_u8(buf, ENC_UTF8);
    w_u8(buf, 0); // 0 additional UVs
    buf.extend_from_slice(&[2, 1, 1, 2, 1, 1]); // index sizes
}

fn w_vertex(buf: &mut Vec<u8>, pos: [f32; 3], uv: [f32; 2], deform: &[u8]) {
    for v in pos {
        w_f32(buf, v);
    }
    for v in [0.0_f32, 1.0, 0.0] {
        w_f32(buf, v); // normal
    }
    for v in uv {
        w_f32(buf, v);
    }
    buf.extend_from_slice(deform);
    w_f32(buf, 1.0); // edge factor
}

fn deform_bdef1(bone: i32) -> Vec<u8> {
    let mut d = vec![0u8];
    w_index_signed(&mut d, BONE_INDEX_SIZE, bone);
    d
}

fn deform_bdef2(a: i32, b: i32, w: f32) -> Vec<u8> {
    let mut d = vec![1u8];
    w_index_signed(&mut d, BONE_INDEX_SIZE, a);
    w_index_signed(&mut d, BONE_INDEX_SIZE, b);
    w_f32(&mut d, w);
    d
}

fn deform_bdef4(bones: [i32; 4], weights: [f32; 4]) -> Vec<u8> {
    let mut d = vec![2u8];
    for bone in bones {
        w_index_signed(&mut d, BONE_INDEX_SIZE, bone);
    }
    for weight in weights {
        w_f32(&mut d, weight);
    }
    d
}

fn deform_sdef(a: i32, b: i32, w: f32) -> Vec<u8> {
    let mut d = vec![3u8];
    w_index_signed(&mut d, BONE_INDEX_SIZE, a);
    w_index_signed(&mut d, BONE_INDEX_SIZE, b);
    w_f32(&mut d, w);
    for v in [1.0_f32, 2.0, 3.0] {
        w_f32(&mut d, v); // C
    }
    for v in [4.0_f32, 5.0, 6.0] {
        w_f32(&mut d, v); // R0
    }
    for v in [7.0_f32, 8.0, 9.0] {
        w_f32(&mut d, v); // R1
    }
    d
}

fn w_material(
    buf: &mut Vec<u8>,
    enc: u8,
    name: &str,
    diffuse: [f32; 4],
    ambient: [f32; 3],
    texture_index: i32,
    face_vertex_count: u32,
) {
    w_str(buf, enc, name);
    w_str(buf, enc, "");
    for v in diffuse {
        w_f32(buf, v);
    }
    for v in [0.0_f32, 0.0, 0.0] {
        w_f32(buf, v); // specular
    }
    w_f32(buf, 0.0); // specular strength
    for v in ambient {
        w_f32(buf, v);
    }
    w_u8(buf, 0x00); // flags
    for v in [0.0_f32, 0.0, 0.0, 1.0] {
        w_f32(buf, v); // edge color
    }
    w_f32(buf, 1.0); // edge size
    w_index_signed(buf, 1, texture_index); // texture
    w_index_signed(buf, 1, -1); // sphere: none
    w_u8(buf, sphere_mode::NONE);
    w_u8(buf, 0); // toon mode: texture index
    w_index_signed(buf, 1, -1); // toon: none
    w_str(buf, enc, ""); // comment
    w_u32(buf, face_vertex_count);
}

/// Six vertices, one triangle per material (materials consume 3 face indices
/// each), two bones, one texture.
fn build_mixed_model() -> Vec<u8> {
    let enc = ENC_UTF8;
    let mut buf = Vec::new();
    w_common_header(&mut buf);
    w_str(&mut buf, enc, "fixture");
    w_str(&mut buf, enc, "");
    w_str(&mut buf, enc, "");
    w_str(&mut buf, enc, "");

    w_u32(&mut buf, 6); // vertices
    w_vertex(&mut buf, [0.0, 1.0, 0.0], [0.0, 0.0], &deform_bdef1(0));
    w_vertex(
        &mut buf,
        [-1.0, 0.0, 0.0],
        [1.0, 0.0],
        &deform_bdef2(0, 1, 0.25),
    );
    w_vertex(
        &mut buf,
        [1.0, 0.0, 0.0],
        [0.0, 1.0],
        &deform_bdef4([0, 1, 0, 1], [0.1, 0.2, 0.3, 0.4]),
    );
    w_vertex(
        &mut buf,
        [0.0, 0.0, 1.0],
        [1.0, 1.0],
        &deform_sdef(1, 0, 0.8),
    );
    w_vertex(&mut buf, [2.0, 0.0, 0.0], [0.5, 0.5], &deform_bdef1(0));
    w_vertex(&mut buf, [3.0, 0.0, 0.0], [0.25, 0.75], &deform_bdef1(1));

    w_u32(&mut buf, 6); // face index count (2 triangles)
    for i in [0_u32, 1, 2, 3, 4, 5] {
        w_index_unsigned(&mut buf, 2, i);
    }

    w_u32(&mut buf, 1); // textures
    w_str(&mut buf, enc, "textures/body.png");

    w_u32(&mut buf, 2); // materials
    w_material(
        &mut buf,
        enc,
        "body",
        [0.8, 0.7, 0.6, 1.0],
        [0.2, 0.1, 0.05],
        0,
        3,
    );
    w_material(
        &mut buf,
        enc,
        "face",
        [1.0, 0.9, 0.8, 0.9],
        [0.0, 0.0, 0.0],
        -1,
        3,
    );

    w_u32(&mut buf, 2); // bones
    w_bone(&mut buf, enc, "センター", -1, [0.0, 10.0, 0.0]);
    w_bone(&mut buf, enc, "足", 0, [0.0, 5.0, 0.0]);

    w_u32(&mut buf, 0); // morphs

    buf
}

fn parse_fixture() -> MmdModel {
    from_bytes(&build_mixed_model()).expect("fixture must parse")
}

fn joint_weights(vertex_data: &[u8], index: usize) -> ([u32; 4], [f32; 4]) {
    let base = index * VERTEX_STRIDE;
    let joints: [u32; 4] = std::array::from_fn(|i| {
        u32::from_le_bytes(
            vertex_data[base + 32 + i * 4..base + 36 + i * 4]
                .try_into()
                .unwrap(),
        )
    });
    let weights: [f32; 4] = std::array::from_fn(|i| {
        f32::from_le_bytes(
            vertex_data[base + 48 + i * 4..base + 52 + i * 4]
                .try_into()
                .unwrap(),
        )
    });
    (joints, weights)
}

#[test]
fn vertex_buffer_layout_matches_vrm_stride() {
    let model = parse_fixture();
    let engine = RestPoseEngine::build(&model);
    assert_eq!(VERTEX_STRIDE, 64);
    assert_eq!(engine.vertex_bytes().len(), model.vertices.len() * 64);

    // Position of vertex 0 at offset 0.
    let p: [f32; 3] = std::array::from_fn(|i| {
        f32::from_le_bytes(engine.vertex_bytes()[i * 4..i * 4 + 4].try_into().unwrap())
    });
    assert_eq!(p, [0.0, 1.0, 0.0]);
    // UV of vertex 1 at offset (1*64) + 24.
    let uv_off = 64 + 24;
    let u = f32::from_le_bytes(
        engine.vertex_bytes()[uv_off..uv_off + 4]
            .try_into()
            .unwrap(),
    );
    assert_eq!(u, 1.0);
}

#[test]
fn deform_expansion_bdef1_bdef2_bdef4_sdef() {
    let model = parse_fixture();
    let engine = RestPoseEngine::build(&model);
    let data = engine.vertex_bytes();

    // BDEF1 → [i, 0, 0, 0] / [1, 0, 0, 0].
    let (j, w) = joint_weights(data, 0);
    assert_eq!(j, [0, 0, 0, 0]);
    assert_eq!(w, [1.0, 0.0, 0.0, 0.0]);

    // BDEF2 (stored w0 = 0.25) → [0, 1, 0, 0] / [0.25, 0.75, 0, 0].
    let (j, w) = joint_weights(data, 1);
    assert_eq!(j, [0, 1, 0, 0]);
    assert_eq!(w, [0.25, 0.75, 0.0, 0.0]);

    // BDEF4 → verbatim.
    let (j, w) = joint_weights(data, 2);
    assert_eq!(j, [0, 1, 0, 1]);
    assert_eq!(w, [0.1, 0.2, 0.3, 0.4]);

    // SDEF → BDEF2-style with the two stored influences; C/R0/R1 dropped.
    let (j, w) = joint_weights(data, 3);
    assert_eq!(j, [1, 0, 0, 0]);
    for (got, want) in w.iter().zip([0.8_f32, 0.2, 0.0, 0.0]) {
        assert!((got - want).abs() < 1e-6, "weight {got} != {want}");
    }
    assert_eq!(engine.sdef_approximated(), 1);

    assert_eq!(engine.invalid_joint_count(), 0);
}

#[test]
fn primitives_split_by_material_with_shared_vertex_buffer() {
    let model = parse_fixture();
    let engine = RestPoseEngine::build(&model);

    assert_eq!(engine.primitive_count(), 2);
    assert_eq!(engine.primitive_material(0), Some(0));
    assert_eq!(engine.primitive_material(1), Some(1));
    assert_eq!(engine.primitive_material(2), None);

    let indices0: Vec<u32> = engine
        .index_bytes(0)
        .unwrap()
        .as_chunks::<4>()
        .0
        .iter()
        .map(|c| u32::from_le_bytes(*c))
        .collect();
    let indices1: Vec<u32> = engine
        .index_bytes(1)
        .unwrap()
        .as_chunks::<4>()
        .0
        .iter()
        .map(|c| u32::from_le_bytes(*c))
        .collect();
    assert_eq!(indices0, vec![0, 1, 2]);
    assert_eq!(indices1, vec![3, 4, 5]);
    assert!(!engine.face_range_mismatch());
}

#[test]
fn material_mapping_ambient_used_or_fallback() {
    let model = parse_fixture();
    let engine = RestPoseEngine::build(&model);
    let materials = engine.materials();

    assert_eq!(materials.len(), 2);
    // Non-zero ambient: used verbatim, alpha from diffuse.
    assert_eq!(materials[0].shade_color, [0.2, 0.1, 0.05, 1.0]);
    assert_eq!(materials[0].base_color, [0.8, 0.7, 0.6, 1.0]);
    // Zero ambient: diffuse.rgb * 0.6, alpha preserved.
    let shade = materials[1].shade_color;
    for (got, want) in shade.iter().zip([0.6_f32, 0.54, 0.48, 0.9]) {
        assert!((got - want).abs() < 1e-6, "shade {got} != {want}");
    }
    assert_eq!(engine.ambient_fallback_count(), 1);
}

#[test]
fn face_range_overrun_is_clamped_and_flagged() {
    // Both materials declare one triangle but the file carries two — the
    // first consumes it, the second clamps to zero faces and is skipped.
    let enc = ENC_UTF8;
    let mut buf = Vec::new();
    w_common_header(&mut buf);
    w_str(&mut buf, enc, "m");
    w_str(&mut buf, enc, "");
    w_str(&mut buf, enc, "");
    w_str(&mut buf, enc, "");
    w_u32(&mut buf, 3);
    w_vertex(&mut buf, [0.0, 0.0, 0.0], [0.0, 0.0], &deform_bdef1(0));
    w_vertex(&mut buf, [1.0, 0.0, 0.0], [0.0, 0.0], &deform_bdef1(0));
    w_vertex(&mut buf, [0.0, 1.0, 0.0], [0.0, 0.0], &deform_bdef1(0));
    w_u32(&mut buf, 6); // two triangles
    for i in [0_u32, 1, 2, 0, 2, 1] {
        w_index_unsigned(&mut buf, 2, i);
    }
    w_u32(&mut buf, 0); // textures
    w_u32(&mut buf, 2); // materials, both claim all 6 indices
    w_material(&mut buf, enc, "a", [1.0; 4], [0.1, 0.1, 0.1], -1, 6);
    w_material(&mut buf, enc, "b", [1.0; 4], [0.1, 0.1, 0.1], -1, 6);
    w_u32(&mut buf, 1); // one bone
    w_bone(&mut buf, enc, "root", -1, [0.0, 0.0, 0.0]);
    w_u32(&mut buf, 0); // morphs

    let model = from_bytes(&buf).expect("fixture must parse");
    let engine = RestPoseEngine::build(&model);
    // Material a consumed the only triangle; b declared 6 but 0 remain.
    assert_eq!(engine.primitive_count(), 1);
    assert_eq!(engine.primitive_material(0), Some(0));
    assert!(engine.face_range_mismatch());
}

#[test]
fn leftover_faces_get_trailing_unassigned_primitive() {
    // Materials consume nothing; both triangles remain → one primitive with
    // material_index == -1.
    let enc = ENC_UTF8;
    let mut buf = Vec::new();
    w_common_header(&mut buf);
    w_str(&mut buf, enc, "m");
    w_str(&mut buf, enc, "");
    w_str(&mut buf, enc, "");
    w_str(&mut buf, enc, "");
    w_u32(&mut buf, 3);
    w_vertex(&mut buf, [0.0, 0.0, 0.0], [0.0, 0.0], &deform_bdef1(0));
    w_vertex(&mut buf, [1.0, 0.0, 0.0], [0.0, 0.0], &deform_bdef1(0));
    w_vertex(&mut buf, [0.0, 1.0, 0.0], [0.0, 0.0], &deform_bdef1(0));
    w_u32(&mut buf, 6);
    for i in [0_u32, 1, 2, 0, 1, 2] {
        w_index_unsigned(&mut buf, 2, i);
    }
    w_u32(&mut buf, 0); // textures
    w_u32(&mut buf, 1); // one material claiming zero faces
    w_material(&mut buf, enc, "empty", [1.0; 4], [0.1, 0.1, 0.1], -1, 0);
    w_u32(&mut buf, 1); // one bone
    w_bone(&mut buf, enc, "root", -1, [0.0, 0.0, 0.0]);
    w_u32(&mut buf, 0); // morphs

    let model = from_bytes(&buf).expect("fixture must parse");
    let engine = RestPoseEngine::build(&model);
    assert_eq!(engine.primitive_count(), 1);
    assert_eq!(engine.primitive_material(0), Some(-1));
    assert!(engine.face_range_mismatch());
    let indices: Vec<u32> = engine
        .index_bytes(0)
        .unwrap()
        .as_chunks::<4>()
        .0
        .iter()
        .map(|c| u32::from_le_bytes(*c))
        .collect();
    assert_eq!(indices, vec![0, 1, 2, 0, 1, 2]);
}

#[test]
fn out_of_range_joint_indices_are_clamped_and_counted() {
    let enc = ENC_UTF8;
    let mut buf = Vec::new();
    w_common_header(&mut buf);
    w_str(&mut buf, enc, "m");
    w_str(&mut buf, enc, "");
    w_str(&mut buf, enc, "");
    w_str(&mut buf, enc, "");
    w_u32(&mut buf, 1);
    w_vertex(&mut buf, [0.0, 0.0, 0.0], [0.0, 0.0], &deform_bdef1(99));
    w_u32(&mut buf, 0); // faces
    w_u32(&mut buf, 0); // textures
    w_u32(&mut buf, 0); // materials
    w_u32(&mut buf, 1); // one bone
    w_bone(&mut buf, enc, "root", -1, [0.0, 0.0, 0.0]);
    w_u32(&mut buf, 0); // morphs

    let model = from_bytes(&buf).expect("fixture must parse");
    let engine = RestPoseEngine::build(&model);
    assert_eq!(engine.invalid_joint_count(), 1);
    let (j, _w) = joint_weights(engine.vertex_bytes(), 0);
    assert_eq!(j[0], 0); // clamped into 0..bone_count-1
}

#[test]
fn tick_counts_frames_and_accumulates_elapsed() {
    let model = parse_fixture();
    let mut engine = RestPoseEngine::build(&model);
    assert_eq!(engine.ticks(), 0);
    engine.tick(16.0);
    engine.tick(16.0);
    engine.tick(f32::NAN); // counted, but does not poison elapsed_ms
    assert_eq!(engine.ticks(), 3);
    assert_eq!(engine.elapsed_ms(), 32.0);
}

#[test]
fn from_path_resolves_sibling_texture_and_counts_misses() {
    let dir = std::env::temp_dir().join(format!(
        "airi-mmd-rest-pose-test-{}-{:?}",
        std::process::id(),
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos()
    ));
    let tex_dir = dir.join("textures");
    std::fs::create_dir_all(&tex_dir).unwrap();
    std::fs::write(tex_dir.join("body.png"), b"\x89PNG-fake-bytes").unwrap();
    let pmx_path = dir.join("model.pmx");
    std::fs::write(&pmx_path, build_mixed_model()).unwrap();

    let engine = RestPoseEngine::from_path(&pmx_path).expect("model must load");
    assert_eq!(engine.primitive_count(), 2);
    let tex = engine.materials()[0]
        .texture
        .as_ref()
        .expect("texture must resolve");
    assert_eq!(tex.bytes, b"\x89PNG-fake-bytes");
    assert_eq!(tex.extension, "png");
    assert_eq!(engine.texture_failures(), 0);

    // Missing texture file → counted, not fatal.
    std::fs::remove_file(tex_dir.join("body.png")).unwrap();
    let engine = RestPoseEngine::from_path(&pmx_path).expect("model must still load");
    assert_eq!(engine.texture_failures(), 1);
    assert!(engine.materials()[0].texture.is_none());

    let _ = std::fs::remove_dir_all(&dir);
}
