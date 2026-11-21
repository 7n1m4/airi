// SPDX-License-Identifier: GPL-3.0-or-later

//! Shared byte-fixture builders for the `airi-mmd` integration tests.
//!
//! Fixtures are built byte-by-byte in memory; no binary blobs are committed.
//! Layout mirrors what PmxEditor emits (and what three-stdlib's mmdparser
//! consumes), confirmed against both the vendored parser and the P10 design
//! note — with two deliberate notes: `version` is an `f32` and bones carry no
//! rest quaternion (see `p10-lane-mmd.md`).
//!
//! Not every builder is used by every test binary; keep the full set here and
//! let each binary ignore what it does not need.
#![allow(dead_code)]

pub const ENC_UTF16LE: u8 = 0;
pub const ENC_UTF8: u8 = 1;

pub fn w_f32(buf: &mut Vec<u8>, v: f32) {
    buf.extend_from_slice(&v.to_le_bytes());
}

pub fn w_u32(buf: &mut Vec<u8>, v: u32) {
    buf.extend_from_slice(&v.to_le_bytes());
}

pub fn w_i32(buf: &mut Vec<u8>, v: i32) {
    buf.extend_from_slice(&v.to_le_bytes());
}

pub fn w_u8(buf: &mut Vec<u8>, v: u8) {
    buf.push(v);
}

pub fn w_u16(buf: &mut Vec<u8>, v: u16) {
    buf.extend_from_slice(&v.to_le_bytes());
}

/// Write a signed index of the given PMX index size (1, 2 or 4 bytes).
pub fn w_index_signed(buf: &mut Vec<u8>, size: u8, v: i32) {
    match size {
        1 => w_u8(buf, v as i8 as u8),
        2 => buf.extend_from_slice(&(v as i16).to_le_bytes()),
        4 => buf.extend_from_slice(&v.to_le_bytes()),
        other => panic!("bad index size {other}"),
    }
}

/// Write an unsigned face index of the given PMX index size.
pub fn w_index_unsigned(buf: &mut Vec<u8>, size: u8, v: u32) {
    match size {
        1 => w_u8(buf, v as u8),
        2 => buf.extend_from_slice(&(v as u16).to_le_bytes()),
        4 => w_u32(buf, v),
        other => panic!("bad index size {other}"),
    }
}

/// Header with vertex/texture/material/bone/morph/rigidbody index sizes
/// [2, 1, 1, 2, 1, 1] — realistic for a small PMX 2.0 model.
pub fn base_header(enc: u8, additional_uv: u8) -> Vec<u8> {
    let mut buf = Vec::new();
    buf.extend_from_slice(b"PMX ");
    w_f32(&mut buf, 2.0);
    w_u8(&mut buf, 8); // header size
    w_u8(&mut buf, enc);
    w_u8(&mut buf, additional_uv);
    buf.extend_from_slice(&[2, 1, 1, 2, 1, 1]);
    buf
}

pub fn w_str(buf: &mut Vec<u8>, enc: u8, s: &str) {
    match enc {
        ENC_UTF16LE => {
            let units: Vec<u16> = s.encode_utf16().collect();
            w_i32(buf, (units.len() * 2) as i32);
            for unit in units {
                buf.extend_from_slice(&unit.to_le_bytes());
            }
        }
        _ => {
            w_i32(buf, s.len() as i32);
            buf.extend_from_slice(s.as_bytes());
        }
    }
}

/// Write a raw fixed-width name field (VMD-style), NUL-padded, truncated to
/// `width` bytes if the encoded name is longer.
pub fn w_fixed(buf: &mut Vec<u8>, s: &str, width: usize) {
    let raw = s.as_bytes();
    let mut field = vec![0_u8; width];
    let n = raw.len().min(width);
    field[..n].copy_from_slice(&raw[..n]);
    buf.extend_from_slice(&field);
}

/// Additional UV sets are vec4 in the file; emit `count` of them with
/// sentinel values so a parser that misreads them trips.
pub fn w_auvs(buf: &mut Vec<u8>, count: u8) {
    for i in 0..(count as u32 * 4) {
        w_f32(buf, 100.0 + i as f32);
    }
}

pub fn w_names(buf: &mut Vec<u8>, enc: u8) {
    w_str(buf, enc, "テストモデル");
    w_str(buf, enc, "test-model");
    w_str(buf, enc, "コメント");
    w_str(buf, enc, "comment");
}

pub fn assert_f32(a: f32, b: f32) {
    assert!((a - b).abs() < 1e-6, "expected {a} ≈ {b}");
}
