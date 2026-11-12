// SPDX-License-Identifier: GPL-3.0-or-later

//! Constructed-fixture tests for the VMD (Vocaloid Motion Data) parser.
//!
//! Fixtures are built byte-by-byte in memory; no binary blobs are committed.
//! The wire layout below was verified against the 14 `.vmd` files vendored in
//! this repo and against three-stdlib's mmdparser.js. Two facts that are easy
//! to get wrong and are pinned down by tests here: the 30-byte signature is
//! followed by a **20-byte model name**, and camera records are **61 bytes**.

use airi_mmd::*;

mod common;
use common::{assert_f32, w_f32, w_fixed, w_u32, w_u8};

const SIGNATURE_0002: &[u8; 30] = b"Vocaloid Motion Data 0002\0\0\0\0\0";
const SIGNATURE_0001: &[u8; 30] = b"Vocaloid Motion Data 0001\0\0\0\0\0";

/// Build a VMD buffer: signature + model name + sections.
///
/// Section payloads (already serialized, without their counts; counts are
/// written by [`build_vmd`]). `trailing` is appended verbatim after the
/// shadow section.
struct Sections<'a> {
    bones: (&'a [u8], u32),
    morphs: (&'a [u8], u32),
    cameras: Option<(&'a [u8], u32)>, // payload (complete record bytes), count
    lights: Option<(&'a [u8], u32)>,
    shadows: Option<(&'a [u8], u32)>,
    trailing: &'a [u8],
}

impl<'a> Sections<'a> {
    fn empty() -> Self {
        Self {
            bones: (&[], 0),
            morphs: (&[], 0),
            cameras: None,
            lights: None,
            shadows: None,
            trailing: &[],
        }
    }
}

fn build_vmd(signature: &[u8; 30], model_name: &str, sections: &Sections<'_>) -> Vec<u8> {
    let mut buf = Vec::new();
    buf.extend_from_slice(signature);
    w_fixed(&mut buf, model_name, 20);
    w_u32(&mut buf, sections.bones.1);
    buf.extend_from_slice(sections.bones.0);
    w_u32(&mut buf, sections.morphs.1);
    buf.extend_from_slice(sections.morphs.0);
    for section in [&sections.cameras, &sections.lights, &sections.shadows] {
        match section {
            Some((payload, count)) => {
                w_u32(&mut buf, *count);
                buf.extend_from_slice(payload);
            }
            None => w_u32(&mut buf, 0),
        }
    }
    buf.extend_from_slice(sections.trailing);
    buf
}

fn w_bone_key(buf: &mut Vec<u8>, name: &str, frame: u32, pos: [f32; 3], rot: [f32; 4]) {
    w_fixed(buf, name, 15);
    w_u32(buf, frame);
    for v in pos {
        w_f32(buf, v);
    }
    for v in rot {
        w_f32(buf, v);
    }
    for i in 0..64 {
        buf.push(i as u8); // interpolation: 0x00..0x3f — distinctive pattern
    }
}

fn w_morph_key(buf: &mut Vec<u8>, name: &str, frame: u32, weight: f32) {
    w_fixed(buf, name, 15);
    w_u32(buf, frame);
    w_f32(buf, weight);
}

/// Minimal 3-bone-key + 1-morph fixture with camera, light and shadow keys,
/// plus a trailing IK-section-shaped tail.
fn build_full_fixture() -> Vec<u8> {
    let mut bones = Vec::new();
    w_bone_key(
        &mut bones,
        "センタ",
        0,
        [0.0, 10.0, 0.0],
        [0.0, 0.0, 0.0, 1.0],
    );
    w_bone_key(
        &mut bones,
        "Leg",
        10,
        [1.0, 5.0, 0.0],
        [
            0.0,
            0.0,
            std::f32::consts::FRAC_1_SQRT_2,
            std::f32::consts::FRAC_1_SQRT_2,
        ],
    );
    w_bone_key(
        &mut bones,
        "Arm",
        3,
        [0.5, 8.0, 0.5],
        [
            0.0,
            std::f32::consts::FRAC_1_SQRT_2,
            0.0,
            std::f32::consts::FRAC_1_SQRT_2,
        ],
    );

    let mut morphs = Vec::new();
    w_morph_key(&mut morphs, "まばたき", 5, 0.8);

    // Camera key: 61 bytes (frame, distance, target, rotation, 24 interp, fov, perspective).
    let mut camera = Vec::new();
    w_u32(&mut camera, 0); // frame
    w_f32(&mut camera, 45.5); // distance
    for v in [1.0_f32, 2.0, 3.0] {
        w_f32(&mut camera, v); // target
    }
    for v in [0.0_f32, 0.5, 0.1] {
        w_f32(&mut camera, v); // rotation
    }
    camera.extend_from_slice(&[7_u8; 24]); // interpolation
    w_u32(&mut camera, 30); // fov
    w_u8(&mut camera, 1); // perspective
    assert_eq!(camera.len(), 61);

    // Light key: 20 bytes (frame, color rgb, intensity).
    let mut light = Vec::new();
    w_u32(&mut light, 0);
    for v in [1.0_f32, 1.0, 1.0] {
        w_f32(&mut light, v);
    }
    w_f32(&mut light, 0.5); // intensity
    assert_eq!(light.len(), 20);

    // Shadow key: 9 bytes (frame, mode, distance).
    let mut shadow = Vec::new();
    w_u32(&mut shadow, 0);
    w_u8(&mut shadow, 1); // mode
    w_f32(&mut shadow, 0.3); // distance
    assert_eq!(shadow.len(), 9);

    // Trailing bytes shaped like the IK on/off section; must never be decoded.
    let trailing = [0x01, 0x00, 0x00, 0x00, 0x01, 0x04, 0x00, 0x00, 0x00];

    build_vmd(
        SIGNATURE_0002,
        "TestRig",
        &Sections {
            bones: (&bones, 3),
            morphs: (&morphs, 1),
            cameras: Some((&camera, 1)),
            lights: Some((&light, 1)),
            shadows: Some((&shadow, 1)),
            trailing: &trailing,
        },
    )
}

#[test]
fn parses_synthetic_motion_all_sections() {
    let bytes = build_full_fixture();
    let motion = VmdMotion::parse(&bytes).expect("fixture must parse");

    assert_eq!(motion.signature, "Vocaloid Motion Data 0002");
    assert!(!motion.legacy_signature);
    assert_eq!(motion.model_name, "TestRig");
    assert_eq!(&motion.model_name_raw[..7], b"TestRig");

    assert_eq!(motion.bones.len(), 3);
    let b = &motion.bones[2];
    assert_eq!(b.name, "Arm");
    assert_eq!(b.frame, 3);
    assert_eq!(b.position, [0.5, 8.0, 0.5]);
    assert_f32(b.rotation[1], std::f32::consts::FRAC_1_SQRT_2);
    assert_f32(b.rotation[3], std::f32::consts::FRAC_1_SQRT_2);
    // Interpolation pattern written by the fixture: 0x00..0x3f.
    assert_eq!(motion.bones[0].interpolation[0], 0x00);
    assert_eq!(motion.bones[0].interpolation[63], 0x3f);
    assert_eq!(motion.bones[0].name_raw[..9], *"センタ".as_bytes());

    assert_eq!(motion.morphs.len(), 1);
    let m = &motion.morphs[0];
    assert_eq!(m.frame, 5);
    assert_f32(m.weight, 0.8);
    assert_eq!(m.name_raw[..12], *"まばたき".as_bytes());

    assert_eq!(motion.camera_count, 1);
    assert_eq!(motion.light_count, 1);
    assert_eq!(motion.shadow_count, 1);
    assert_eq!(motion.trailing_bytes, 9);

    assert_eq!(motion.bone_frame_range(), Some((0, 10)));
}

#[test]
fn bone_frame_range_is_order_independent() {
    let mut bones = Vec::new();
    w_bone_key(&mut bones, "a", 10, [0.0; 3], [0.0, 0.0, 0.0, 1.0]);
    w_bone_key(&mut bones, "b", 3, [0.0; 3], [0.0, 0.0, 0.0, 1.0]);
    w_bone_key(&mut bones, "c", 7, [0.0; 3], [0.0, 0.0, 0.0, 1.0]);
    let bytes = build_vmd(
        SIGNATURE_0002,
        "m",
        &Sections {
            bones: (&bones, 3),
            ..Sections::empty()
        },
    );
    let motion = VmdMotion::parse(&bytes).expect("fixture must parse");
    assert_eq!(motion.bone_frame_range(), Some((3, 10)));
    assert_eq!(motion.camera_count, 0);
    assert_eq!(motion.light_count, 0);
    assert_eq!(motion.shadow_count, 0);
    assert_eq!(motion.trailing_bytes, 0);
}

#[test]
fn empty_motion_has_no_frame_range() {
    let bytes = build_vmd(SIGNATURE_0002, "m", &Sections::empty());
    let motion = VmdMotion::parse(&bytes).expect("fixture must parse");
    assert!(motion.bones.is_empty());
    assert_eq!(motion.bone_frame_range(), None);
}

#[test]
fn japanese_name_kept_raw_decoded_lossy() {
    // CP932 bytes for "右足ＩＫ" with NUL padding.
    let jp: [u8; 15] = [
        0x89, 0x45, 0x91, 0xab, 0x82, 0x68, 0x82, 0x6a, 0, 0, 0, 0, 0, 0, 0,
    ];
    let mut bones = Vec::new();
    bones.extend_from_slice(&jp);
    w_u32(&mut bones, 0);
    for v in [0.0_f32; 7] {
        w_f32(&mut bones, v); // position (3×f32) + rotation (4×f32)
    }
    bones.extend_from_slice(&[0u8; 64]);

    let bytes = build_vmd(
        SIGNATURE_0002,
        "m",
        &Sections {
            bones: (&bones, 1),
            ..Sections::empty()
        },
    );
    let motion = VmdMotion::parse(&bytes).expect("fixture must parse");
    assert_eq!(motion.bones[0].name_raw, jp);
    // Without an encoding crate the CP932 bytes decode lossily; the raw bytes
    // are the recovery path, never the `name` string.
    assert!(motion.bones[0].name.contains('\u{FFFD}'));
}

#[test]
fn legacy_signature_0001_tolerated_with_56byte_camera_records() {
    let mut camera = Vec::new();
    w_u32(&mut camera, 0); // frame
    w_f32(&mut camera, 45.5); // distance
    for v in [1.0_f32, 2.0, 3.0] {
        w_f32(&mut camera, v);
    }
    for v in [0.0_f32, 0.5, 0.1] {
        w_f32(&mut camera, v);
    }
    camera.extend_from_slice(&[7_u8; 24]); // interpolation
    assert_eq!(camera.len(), 56); // legacy size (no fov/perspective)

    let bytes = build_vmd(
        SIGNATURE_0001,
        "LegacyRig",
        &Sections {
            cameras: Some((&camera, 1)),
            ..Sections::empty()
        },
    );
    let motion = VmdMotion::parse(&bytes).expect("legacy fixture must parse");
    assert_eq!(motion.signature, "Vocaloid Motion Data 0001");
    assert!(motion.legacy_signature);
    assert_eq!(motion.camera_count, 1);
}

#[test]
fn unknown_signature_rejected() {
    for sig in [
        b"Vocaloid Motion Data 0003\0\0\0\0\0",
        b"Not a vmd signature!!!!!!!!!!!",
        b"Vocaloid Motion Data \0\0\0\0\0\0\0\0\0",
    ] {
        let bytes = build_vmd(sig, "m", &Sections::empty());
        assert!(
            matches!(VmdMotion::parse(&bytes), Err(MmdError::BadVmdSignature)),
            "expected BadVmdSignature for {sig:?}"
        );
    }
}

#[test]
fn mutated_bytes_never_panic() {
    let bytes = build_full_fixture();
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
        let _ = VmdMotion::parse(&mutated);
    }
}

#[test]
fn truncated_input_reports_typed_error() {
    let bytes = build_full_fixture();
    for cut in [0, 10, 29, 30, 49, 50, 60] {
        let result = VmdMotion::parse(&bytes[..cut]);
        assert!(
            matches!(result, Err(MmdError::Truncated { .. })),
            "cut at {cut}: expected Truncated, got {result:?}"
        );
    }

    // Cutting inside the opaque trailing bytes is not an error — the tail is
    // never interpreted, only counted.
    let cut = bytes.len() - 1;
    let motion = VmdMotion::parse(&bytes[..cut]).expect("opaque tail must not fail");
    assert_eq!(motion.trailing_bytes, 8);
}

#[test]
fn every_truncation_prefix_returns_without_panicking() {
    let bytes = build_full_fixture();
    for len in 0..bytes.len() {
        let _ = VmdMotion::parse(&bytes[..len]);
    }
}

/// The 14 VMDs vendored in this repo (motions authored for absent models).
/// Every file must parse and carry ≥ 1 bone key. Files that disappeared from
/// disk are skipped with a note; a completely missing directory fails the test.
#[test]
fn repo_vmds_all_parse() {
    const ANIMATIONS: &str = concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../../apps/stage-tamagotchi/src/renderer/public/assets/mmd/animations"
    );

    let entries = match std::fs::read_dir(ANIMATIONS) {
        Ok(entries) => entries,
        Err(e) => panic!("animations directory must exist ({ANIMATIONS}): {e}"),
    };
    let mut vmd_paths: Vec<_> = entries
        .filter_map(|e| e.ok())
        .map(|e| e.path())
        .filter(|p| p.extension().is_some_and(|ext| ext == "vmd"))
        .collect();
    vmd_paths.sort();
    assert!(
        !vmd_paths.is_empty(),
        "no .vmd files found in {ANIMATIONS} — optional fixtures may have moved; locate them before relying on this test"
    );

    let mut parsed = 0_u32;
    for path in &vmd_paths {
        let bytes = match std::fs::read(path) {
            Ok(bytes) => bytes,
            Err(e) => {
                eprintln!("SKIP {}: unreadable ({e})", path.display());
                continue;
            }
        };
        let file = path.file_name().unwrap_or_default().to_string_lossy();
        match VmdMotion::parse(&bytes) {
            Ok(motion) => {
                assert!(
                    !motion.bones.is_empty(),
                    "{file}: parsed but carries zero bone keys"
                );
                eprintln!(
                    "VMD {file}: bones={} morphs={} cams={} lights={} shadows={} trailing={} frame_range={:?}",
                    motion.bones.len(),
                    motion.morphs.len(),
                    motion.camera_count,
                    motion.light_count,
                    motion.shadow_count,
                    motion.trailing_bytes,
                    motion.bone_frame_range(),
                );
                parsed += 1;
            }
            Err(e) => panic!("{file}: failed to parse: {e}"),
        }
    }
    eprintln!(
        "VMD summary: {parsed}/{} repo files parsed",
        vmd_paths.len()
    );
    assert!(
        parsed > 0,
        "every .vmd file was skipped — all are expected to parse"
    );
}
