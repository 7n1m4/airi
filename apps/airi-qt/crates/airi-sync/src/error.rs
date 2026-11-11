// SPDX-License-Identifier: GPL-3.0-or-later
//! Error type for `airi-sync`.

use std::io;
use std::path::PathBuf;

/// Errors returned by the `airi-sync` snapshot engine.
///
/// Variants are deliberately typed (rather than a single `String`) so callers —
/// in particular the future Qt bridge — can branch on the failure mode
/// (e.g. show a "files were modified" dialog for [`SyncError::DirtyTarget`]).
#[derive(Debug, thiserror::Error)]
pub enum SyncError {
    /// The source directory does not exist, or it produced no snapshot-able
    /// files (it is empty, or every file in it failed to hash).
    #[error("source directory is missing or produced no snapshot-able files: {0}")]
    EmptySource(PathBuf),

    /// A filesystem operation failed. `path` is the path involved in the
    /// failing operation.
    #[error("I/O error on {path}: {source}")]
    Io {
        /// The path the operation was acting on.
        path: PathBuf,
        /// The underlying I/O error.
        source: io::Error,
    },

    /// A `manifest.json` exists but could not be parsed as JSON. Corrupt
    /// manifests are *skipped* (not fatal) by [`crate::list_snapshots`] and
    /// [`crate::prune_snapshots`]; this variant is returned by
    /// [`crate::verify_snapshot`] and [`crate::restore_snapshot`], where the
    /// caller explicitly named a single snapshot.
    #[error("failed to parse snapshot manifest at {path}: {source}")]
    Manifest {
        /// The manifest path that failed to parse.
        path: PathBuf,
        /// The underlying JSON error.
        source: serde_json::Error,
    },

    /// A `manifest.json` parsed as JSON but is not a valid snapshot manifest
    /// (wrong `format_version`, unsafe file path, unsupported layout, ...).
    #[error("snapshot manifest at {path} is invalid: {reason}")]
    ManifestInvalid {
        /// The manifest path that failed validation.
        path: PathBuf,
        /// Human-readable reason the manifest was rejected.
        reason: String,
    },

    /// [`crate::restore_snapshot`] was asked to restore a snapshot whose
    /// `files/` tree is missing entries listed in its manifest. Pre-flight
    /// check; the destination is left untouched.
    #[error("snapshot at {snapshot} is incomplete; missing files: {missing:?}")]
    SnapshotIncomplete {
        /// The `.snap` directory being restored from.
        snapshot: PathBuf,
        /// Relative (forward-slash) paths listed in the manifest but absent
        /// from `files/`.
        missing: Vec<String>,
    },

    /// [`crate::restore_snapshot`] with `require_clean: true` found files in
    /// the destination whose current sha256 differs from the snapshot's.
    /// Refuses to touch the destination.
    #[error("refusing to overwrite {count} modified file(s) in the destination: {files:?}")]
    DirtyTarget {
        /// Number of files that would be overwritten but were modified.
        count: usize,
        /// Relative (forward-slash) paths of the modified files.
        files: Vec<String>,
    },

    /// [`crate::prune_snapshots`] was called with `keep_last == 0`. A zero
    /// keep count would delete every snapshot; the engine refuses rather
    /// than let a bad call site wipe the backup root.
    #[error("prune_snapshots requires keep_last >= 1; refusing to prune everything")]
    PruneKeepZero,
}

impl SyncError {
    /// Attach path context to a raw `io::Error`.
    pub(crate) fn io(path: impl Into<PathBuf>, source: io::Error) -> Self {
        Self::Io {
            path: path.into(),
            source,
        }
    }
}
