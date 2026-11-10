// SPDX-License-Identifier: GPL-3.0-or-later

//! Error type for PMX parsing.

use std::io;

/// Error returned when a PMX file cannot be decoded into an [`crate::MmdModel`].
///
/// `from_bytes` never panics on untrusted input; every bounds failure surfaces
/// here.
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
    /// not decode yet.
    ///
    /// Today this is used for the morphs section (and everything behind it:
    /// display frames, rigid bodies, joints). Physics and IK *evaluation* are
    /// likewise out of scope for the M0 parser milestone.
    #[error("unsupported PMX feature: {0}")]
    UnsupportedFeature(&'static str),

    /// A structurally impossible value was found (bad index size, count not
    /// divisible by 3, limit exceeded, face index out of range, …).
    #[error("invalid PMX data: {0}")]
    InvalidData(&'static str),

    /// Filesystem error when loading through [`crate::MmdModel::from_path`].
    #[error("I/O error: {0}")]
    Io(#[from] io::Error),
}
