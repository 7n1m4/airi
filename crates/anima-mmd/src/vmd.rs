// SPDX-License-Identifier: GPL-3.0-or-later

//! VMD (Vocaloid Motion Data) reader.
//!
//! Layout (all little-endian; verified against all 14 `.vmd` files vendored in
//! this repo **and** against three-stdlib's `mmdparser.js`, which is what
//! AIRI's Vue stage actually runs):
//!
//! ```text
//! 30-byte NUL-padded signature  "Vocaloid Motion Data 0002"
//! 20-byte NUL-padded model name (CP932 / Shift-JIS on the wire, e.g. the
//!   model the motion was authored for; NUL-padded, not length-prefixed)
//! u32 bone-key count
//! per bone key: 15-byte name | u32 frame | 3×f32 position |
//!   4×f32 rotation (quaternion, as stored: x, y, z, w) | 64 bytes interpolation
//! u32 morph-key count
//! per morph key: 15-byte name | u32 frame | f32 weight
//! u32 camera-key count
//! per camera key: 61 bytes (u32 frame | f32 distance | 3×f32 target |
//!   3×f32 rotation | 24 bytes interpolation | u32 fov | u8 perspective)
//! u32 light-key count
//! per light key: 20 bytes (u32 frame | 3×f32 color | f32 intensity)
//! u32 shadow-key count
//! per shadow key: 9 bytes (u32 frame | u8 mode | f32 distance)
//! …any trailing bytes are the IK on/off section (see below) and are NOT parsed
//! ```
//!
//! Deliberate deviations from the design note, verified against the bytes:
//!
//! - **The 20-byte model-name field after the signature exists.** The design
//!   note describes only a 30-byte signature; real files (and three-stdlib)
//!   carry a 20-byte CP932 model name after it. Without accounting for it,
//!   every repo VMD misparses by 20 bytes.
//! - **Camera records are 61 bytes, not 56.** three-stdlib reads
//!   frame+distance+position(12)+rotation(12)+interpolation(24)+fov(4)+
//!   perspective(1) = 61 B. The "56" in the design note drops fov+perspective.
//!   All 14 repo VMDs carry `camera_count == 0`, so this is verified against
//!   the vendored parser only, not against a file containing camera keys.
//! - **Signatures `0000`/`0001`** are accepted with [`VmdMotion::legacy_signature`]
//!   set and camera records skipped with the legacy 56-byte record size from
//!   the design note (unverified — no `0000`/`0001` file exists in-repo). The
//!   rest of the layout is identical.
//! - **The trailing IK on/off section is parsed and discarded, not decoded.**
//!   All 14 repo files carry, after light/shadow, a `u32` count (=2) followed by
//!   two batches of 21-byte records — `name(15) + frame(u32) + on/off(u8) +
//!   pad(u8)` — one batch per IK-toggle keyframe. The file stores **no record
//!   count anywhere** and there are no field boundaries between "disabled"
//!   records (whose frame bytes are uninitialized exporter garbage — `00 00 00 01`
//!   in healthy files, `0xFDFDFDFD` in two of them) and batch headers.
//!   Decoding it would require a heuristic that cannot be validated; the data
//!   is irrelevant to AIRI (IK runs kinematically from PMX). It is measured and
//!   reported as [`VmdMotion::trailing_bytes`], never interpreted.
//!
//! **Encoding caveat:** bone/morph names on the wire are **CP932-encoded** for
//! Japanese names. This crate does not depend on `encoding_rs`; names are
//! decoded ASCII-lossily (non-ASCII bytes become U+FFFD) and the raw 15 bytes
//! are preserved in `name_raw`. ASCII names (the overwhelming majority of the
//! 14 repo VMDs — e.g. `TailIK`, `HairIK`) decode exactly. Japanese names
//! (e.g. `右足ＩＫ`) will appear as mojibake in `name`; use `name_raw` to
//! recover the bytes. ASCII names containing no NULs parse trivially.
//!
//! Nothing is validated semantically: quaternion norms, frame monotonicity and
//! bone-name resolution against a model are **not** checked (a VMD is
//! meaningless without its target model). Bounds checks still apply to every
//! read; `parse` never panics on untrusted input.

use std::path::Path;

use crate::cursor::Cursor;
use crate::error::MmdError;

/// Maximum number of bone keys accepted (guards allocation on hostile input).
pub const MAX_VMD_BONE_KEYS: usize = 1_000_000;
/// Maximum number of morph keys accepted (guards allocation on hostile input).
pub const MAX_VMD_MORPH_KEYS: usize = 1_000_000;
/// Maximum number of camera keys accepted (guards allocation/skip on hostile input).
pub const MAX_VMD_CAMERA_KEYS: u32 = 100_000;
/// Maximum number of light keys accepted (guards allocation/skip on hostile input).
pub const MAX_VMD_LIGHT_KEYS: u32 = 100_000;
/// Maximum number of shadow keys accepted (guards allocation/skip on hostile input).
pub const MAX_VMD_SHADOW_KEYS: u32 = 100_000;

const SIGNATURE_LEN: usize = 30;
const SIGNATURE_PREFIX: &[u8; 21] = b"Vocaloid Motion Data ";
const MODEL_NAME_LEN: usize = 20;
const BONE_NAME_LEN: usize = 15;
const BONE_KEY_LEN: usize = 15 + 4 + 12 + 16 + 64; // 111
const MORPH_KEY_LEN: usize = 15 + 4 + 4; // 23
const CAMERA_RECORD_LEN_0002: usize = 61;
const CAMERA_RECORD_LEN_LEGACY: usize = 56; // 0000/0001, unverified
const LIGHT_RECORD_LEN: usize = 4 + 12 + 4; // 20
const SHADOW_RECORD_LEN: usize = 4 + 1 + 4; // 9

/// Decode a NUL-padded fixed-width field as ASCII-lossy UTF-8, trimmed at the
/// first NUL. Non-ASCII bytes become U+FFFD.
fn decode_fixed_lossy(raw: &[u8]) -> String {
    let end = raw.iter().position(|&b| b == 0).unwrap_or(raw.len());
    String::from_utf8_lossy(&raw[..end]).into_owned()
}

/// A single bone keyframe.
#[derive(Debug, Clone, PartialEq)]
pub struct VmdBoneKey {
    /// Bone name as stored (CP932 bytes, ASCII-lossy decode).
    ///
    /// Japanese names appear as mojibake (U+FFFD) — the raw CP932 bytes are
    /// preserved in [`VmdBoneKey::name_raw`].
    pub name: String,
    /// Raw 15-byte CP932 name field, exactly as stored (NUL-padded).
    pub name_raw: [u8; BONE_NAME_LEN],
    /// Frame index (30 frames per second in MMD).
    pub frame: u32,
    /// Object-space position.
    pub position: [f32; 3],
    /// Rotation quaternion, as stored (x, y, z, w).
    pub rotation: [f32; 4],
    /// Interpolation curves — 16 × 4 values (x/y moving bspline for x, y,
    /// rotation, and each of x/y/z/w position/rotation channels). Stored raw.
    pub interpolation: [u8; 64],
}

/// A single morph keyframe.
#[derive(Debug, Clone, PartialEq)]
pub struct VmdMorphKey {
    /// Morph name as stored (CP932 bytes, ASCII-lossy decode; see
    /// [`VmdBoneKey::name`]).
    pub name: String,
    /// Raw 15-byte CP932 name field, exactly as stored (NUL-padded).
    pub name_raw: [u8; BONE_NAME_LEN],
    /// Frame index.
    pub frame: u32,
    /// Morph weight (0..=1 typical, not enforced).
    pub weight: f32,
}

/// A fully decoded VMD motion, limited to the sections AIRI consumes.
///
/// Camera and light sections are skipped over (they are motion for the
/// camera, not the model); their counts are stored. The trailing IK on/off
/// section is never interpreted — only its byte length is reported in
/// [`VmdMotion::trailing_bytes`].
#[derive(Debug, Clone, PartialEq)]
pub struct VmdMotion {
    /// The signature string as stored (e.g. `"Vocaloid Motion Data 0002"`).
    ///
    /// `"0000"`/`"0001"` signatures are tolerated (see
    /// [`VmdMotion::legacy_signature`]); anything else fails with
    /// [`MmdError::BadVmdSignature`].
    pub signature: String,
    /// `true` when the signature is not `0002` (parsed with the legacy
    /// 56-byte camera record size; unverified — no legacy file exists in-repo).
    pub legacy_signature: bool,
    /// Model name as stored (CP932 bytes, ASCII-lossy decode; see
    /// [`VmdBoneKey::name`]). This is informational only — the motion is not
    /// bound to any model by this crate.
    pub model_name: String,
    /// Raw 20-byte CP932 model-name field, exactly as stored (NUL-padded).
    pub model_name_raw: [u8; MODEL_NAME_LEN],
    /// Bone keyframes in file order (not necessarily frame-sorted).
    pub bones: Vec<VmdBoneKey>,
    /// Morph keyframes in file order (not necessarily frame-sorted).
    pub morphs: Vec<VmdMorphKey>,
    /// Number of camera keyframes skipped (records are not decoded).
    pub camera_count: u32,
    /// Number of light keyframes skipped (records are not decoded).
    pub light_count: u32,
    /// Number of shadow keyframes skipped (records are not decoded).
    pub shadow_count: u32,
    /// Bytes after the light/shadow sections that were not interpreted (the
    /// IK on/off section, if present). Never decoded; counted only.
    ///
    /// `0` in every well-formed file that ends after the light/shadow
    /// sections. All 14 VMDs vendored in this repo carry a non-zero IK
    /// section here.
    pub trailing_bytes: usize,
}

impl VmdMotion {
    /// Parse a VMD buffer.
    ///
    /// # Errors
    ///
    /// See [`MmdError`]. Notably:
    ///
    /// - [`MmdError::BadVmdSignature`] when the 30-byte signature is not
    ///   `Vocaloid Motion Data 0000/0001/0002`,
    /// - [`MmdError::Truncated`] when the buffer ends early,
    /// - [`MmdError::InvalidData`] when a key count exceeds the allocation
    ///   limits or a skip would run past the end of the buffer.
    ///
    /// Never panics on untrusted input.
    pub fn parse(bytes: &[u8]) -> Result<Self, MmdError> {
        let mut cur = Cursor::new(bytes);

        cur.set_section("vmd-signature");
        let raw_sig = cur.take_bytes(SIGNATURE_LEN)?;
        let signature = decode_fixed_lossy(raw_sig);
        let version =
            std::str::from_utf8(&raw_sig[21..25]).map_err(|_| MmdError::BadVmdSignature)?;
        if &raw_sig[..21] != SIGNATURE_PREFIX {
            return Err(MmdError::BadVmdSignature);
        }
        match version {
            "0000" | "0001" | "0002" => {}
            _ => return Err(MmdError::BadVmdSignature),
        }
        let legacy_signature = version != "0002";

        cur.set_section("vmd-model-name");
        let raw_model: [u8; MODEL_NAME_LEN] = cur
            .take_bytes(MODEL_NAME_LEN)?
            .try_into()
            .expect("take_bytes returns exactly MODEL_NAME_LEN bytes");
        let model_name = decode_fixed_lossy(&raw_model);

        cur.set_section("vmd-bone-keys");
        let bone_count = cur.u32()? as usize;
        if bone_count > MAX_VMD_BONE_KEYS {
            return Err(MmdError::InvalidData("VMD bone-key count exceeds limit"));
        }
        let mut bones = Vec::with_capacity(bone_count);
        for _ in 0..bone_count {
            let raw_name: [u8; BONE_NAME_LEN] = cur
                .take_bytes(BONE_NAME_LEN)?
                .try_into()
                .expect("take_bytes returns exactly BONE_NAME_LEN bytes");
            let frame = cur.u32()?;
            let position = cur.f32_array::<3>()?;
            let rotation = cur.f32_array::<4>()?;
            let raw_interp = cur.take_bytes(64)?;
            let mut interpolation = [0_u8; 64];
            interpolation.copy_from_slice(raw_interp);
            bones.push(VmdBoneKey {
                name: decode_fixed_lossy(&raw_name),
                name_raw: raw_name,
                frame,
                position,
                rotation,
                interpolation,
            });
        }

        cur.set_section("vmd-morph-keys");
        let morph_count = cur.u32()? as usize;
        if morph_count > MAX_VMD_MORPH_KEYS {
            return Err(MmdError::InvalidData("VMD morph-key count exceeds limit"));
        }
        let mut morphs = Vec::with_capacity(morph_count);
        for _ in 0..morph_count {
            let raw_name: [u8; BONE_NAME_LEN] = cur
                .take_bytes(BONE_NAME_LEN)?
                .try_into()
                .expect("take_bytes returns exactly BONE_NAME_LEN bytes");
            let frame = cur.u32()?;
            let weight = cur.f32()?;
            morphs.push(VmdMorphKey {
                name: decode_fixed_lossy(&raw_name),
                name_raw: raw_name,
                frame,
                weight,
            });
        }

        // The motion sections below are all parsed and discarded — AIRI only
        // consumes bone/morph channels, and the camera/light/shadow records
        // exist for camera motion only.
        cur.set_section("vmd-cameras");
        let camera_count = cur.u32()?;
        if camera_count > MAX_VMD_CAMERA_KEYS {
            return Err(MmdError::InvalidData("VMD camera-key count exceeds limit"));
        }
        let camera_record_len = if legacy_signature {
            CAMERA_RECORD_LEN_LEGACY
        } else {
            CAMERA_RECORD_LEN_0002
        };
        cur.skip(camera_count as usize * camera_record_len)?;

        // Light and shadow sections are optional: files that end right after
        // the cameras (or that don't carry these sections at all) are valid.
        // A file that ends with 0..=7 trailing bytes carries no readable
        // counts, so those bytes are reported opaquely.
        let (mut light_count, mut shadow_count) = (0_u32, 0_u32);
        if cur.remaining() >= 8 {
            cur.set_section("vmd-lights");
            light_count = cur.u32()?;
            if light_count > MAX_VMD_LIGHT_KEYS {
                return Err(MmdError::InvalidData("VMD light-key count exceeds limit"));
            }
            cur.skip(light_count as usize * LIGHT_RECORD_LEN)?;

            cur.set_section("vmd-shadows");
            shadow_count = cur.u32()?;
            if shadow_count > MAX_VMD_SHADOW_KEYS {
                return Err(MmdError::InvalidData("VMD shadow-key count exceeds limit"));
            }
            cur.skip(shadow_count as usize * SHADOW_RECORD_LEN)?;
        }

        Ok(Self {
            signature,
            legacy_signature,
            model_name,
            model_name_raw: raw_model,
            bones,
            morphs,
            camera_count,
            light_count,
            shadow_count,
            trailing_bytes: cur.remaining(),
        })
    }

    /// Read and parse a `.vmd` file from disk.
    ///
    /// # Errors
    ///
    /// Returns [`MmdError::Io`] if the file cannot be read, otherwise any
    /// error [`VmdMotion::parse`] can produce.
    pub fn from_path(path: impl AsRef<Path>) -> Result<Self, MmdError> {
        let bytes = std::fs::read(path)?;
        Self::parse(&bytes)
    }

    /// Frame range covered by the bone keys, as `(min, max)`.
    ///
    /// Returns `None` when the motion carries no bone keys.
    pub fn bone_frame_range(&self) -> Option<(u32, u32)> {
        let mut range: Option<(u32, u32)> = None;
        for key in &self.bones {
            range = Some(match range {
                None => (key.frame, key.frame),
                Some((lo, hi)) => (lo.min(key.frame), hi.max(key.frame)),
            });
        }
        range
    }
}

// Exercise the constant sanity relationship in debug builds: the parsed
// sections must line up with the on-wire record sizes.
const _: () = {
    assert!(BONE_KEY_LEN == 111);
    assert!(MORPH_KEY_LEN == 23);
    assert!(CAMERA_RECORD_LEN_0002 == 61);
    assert!(LIGHT_RECORD_LEN == 20);
    assert!(SHADOW_RECORD_LEN == 9);
};
