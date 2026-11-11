// SPDX-License-Identifier: GPL-3.0-or-later

//! Error type for PMX/VMD parsing.

use std::io;

/// Error returned when a PMX file cannot be decoded into an [`crate::MmdModel`],
/// or a VMD file cannot be decoded into an [`crate::VmdMotion`].
///
/// `from_bytes` / [`crate::VmdMotion::parse`] never panic on untrusted input;
/// every bounds failure surfaces here.
#[derive(Debug, thiserror::Error)]
#[non_exhaustive]
pub enum MmdError {
    /// The input ended before a complete structure could be read.
    ///
    /// The `at` field names the section being decoded when the bounds check
    /// fired (for example `"vertices"` or `"bones"`).
    #[error("truncated PMX data while reading {at}")]
    Truncated {
        /// Section being decoded when input ran out.
        at: &'static str,
    },

    /// The 4-byte magic was not `PMX `.
    #[error("bad PMX magic (expected \"PMX \")")]
    BadMagic,

    /// The `f32` version field was not `2.0`.
    #[error("unsupported PMX version {0} (only 2.0 is supported)")]
    UnsupportedVersion(f32),

    /// A vertex deform type other than BDEF1/BDEF2/BDEF4/SDEF (0..=3) was found.
    #[error("unsupported vertex deform type {0}")]
    UnsupportedDeformType(u8),

    /// A correctly-formed section was found that this crate deliberately does
    /// not decode.
    ///
    /// Reserved; morphs were the canonical use case until the morph parser
    /// landed (they are decoded now). Kept for future correctly-formed but
    /// unsupported sections.
    #[error("unsupported PMX feature: {0}")]
    UnsupportedFeature(&'static str),

    /// A morph type byte this crate does not decode (flip, display-frame or
    /// an unknown value).
    ///
    /// Group/vertex/bone/UV/additional-UV/material morphs (types 0..=8) are
    /// decoded; anything else is a loud, typed error rather than a misparse.
    #[error("unsupported PMX morph type {0}")]
    UnsupportedMorphType(u8),

    /// The 30-byte VMD signature was not `Vocaloid Motion Data 0000/0001/0002`.
    #[error("bad VMD signature (expected \"Vocaloid Motion Data 0002\")")]
    BadVmdSignature,

    /// A structurally impossible value was found (bad index size, count not
    /// divisible by 3, limit exceeded, face index out of range, …).
    #[error("invalid PMX data: {0}")]
    InvalidData(&'static str),

    /// Filesystem error when loading through [`crate::MmdModel::from_path`].
    #[error("I/O error: {0}")]
    Io(#[from] io::Error),
}
