// SPDX-License-Identifier: GPL-3.0-or-later
//! Serializable manifest and report types for `airi-sync`.

use std::path::PathBuf;

use serde::{Deserialize, Serialize};

/// Current on-disk manifest format version. Readers must reject manifests
/// with a different `format_version` rather than guess.
pub const FORMAT_VERSION: u32 = 1;

/// One file recorded in a snapshot manifest.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ManifestFile {
    /// Path relative to the snapshotted source root, using forward slashes
    /// on all platforms. Never absolute; never contains `..` components
    /// (validated on read — see [`validate_manifest_rel_path`]).
    pub path: String,
    /// Size of the file in bytes.
    pub bytes: u64,
    /// Lowercase hex sha256 of the file contents.
    pub sha256: String,
}

/// The `manifest.json` written at the root of every `<id>.snap/` directory.
///
/// The manifest is written *last* during snapshot creation, so a manifest
/// that parses implies the file tree was complete at write time. Presence of
/// a manifest is also the gate used by [`crate::prune_snapshots`] before it
/// will delete a `.snap` directory.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct SnapshotManifest {
    /// Manifest format version. Always [`FORMAT_VERSION`] for this crate.
    pub format_version: u32,
    /// Snapshot id; also the directory name (`<id>.snap`). Format:
    /// `YYYYMMDDTHHMMZ-<4 lowercase hex>`, in UTC.
    pub id: String,
    /// Creation time as milliseconds since the Unix epoch (UTC).
    pub created_unix_ms: i64,
    /// Optional human-readable label supplied by the caller.
    pub label: Option<String>,
    /// Best-effort hint of where the snapshot was taken from (the
    /// `source_dir` argument as a display string). Informational only;
    /// never used to locate files on restore.
    pub source_path_hint: String,
    /// Files included in the snapshot, sorted by `path` for determinism.
    pub files: Vec<ManifestFile>,
    /// Relative (forward-slash) paths of files that were skipped during
    /// snapshot creation because they could not be hashed (permissions,
    /// vanished mid-scan, I/O error, ...). Symlinks are skipped too but are
    /// *not* listed here; see crate-level docs.
    #[serde(default)]
    pub skipped: Vec<String>,
    /// Sum of `bytes` over `files`.
    pub total_bytes: u64,
}

/// Lightweight summary of one snapshot, returned by [`crate::list_snapshots`].
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SnapshotSummary {
    /// Snapshot id (directory name minus `.snap`).
    pub id: String,
    /// Full path to the `<id>.snap` directory.
    pub path: PathBuf,
    /// Creation time in milliseconds since the Unix epoch.
    pub created_unix_ms: i64,
    /// Optional label, if the manifest carried one.
    pub label: Option<String>,
    /// Number of files recorded in the manifest.
    pub file_count: usize,
    /// Sum of `bytes` over the manifest's files.
    pub total_bytes: u64,
}

/// Result of listing a backup root directory.
///
/// Corrupt or unreadable entries (`*.snap` directories whose `manifest.json`
/// fails to parse or fails validation) are *skipped*, never fatal, and are
/// counted in `skipped_corrupt` so the UI can surface "N snapshots were
/// unreadable" without losing the rest of the list.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct ListReport {
    /// Snapshots whose manifests parsed and validated, sorted by
    /// `created_unix_ms` descending (newest first).
    pub snapshots: Vec<SnapshotSummary>,
    /// Number of `*.snap` directories skipped because their manifest was
    /// corrupt or invalid.
    pub skipped_corrupt: usize,
}

/// Result of re-hashing every file in a snapshot.
///
/// Returned as a value (not an error) so callers can render both arms;
/// an *unreadable manifest* is an error ([`crate::SyncError`]), a *corrupt
/// file tree* is this report.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum VerifyReport {
    /// Every file listed in the manifest was present and hashed to the
    /// recorded sha256.
    Ok {
        /// Number of files re-hashed.
        files_checked: usize,
        /// Sum of bytes re-hashed.
        bytes_checked: u64,
    },
    /// At least one file was missing or hashed differently.
    Corrupt {
        /// Relative paths listed in the manifest but absent from `files/`.
        missing: Vec<String>,
        /// Relative paths whose current sha256 differs from the manifest.
        mismatched: Vec<String>,
    },
}

/// How [`crate::restore_snapshot`] should treat existing destination files.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum RestoreMode {
    /// Compute the restore plan without writing anything. Always safe.
    #[default]
    DryRun,
    /// Actually restore. With `require_clean: true` (the default and the
    /// value a UI should use), refuse to overwrite any destination file
    /// whose current sha256 differs from the snapshot's; the destination is
    /// left untouched and [`crate::SyncError::DirtyTarget`] is returned.
    ///
    /// `require_clean: false` overwrites anyway; a UI exposing this must put
    /// a destructive confirm in front of it.
    Overwrite {
        /// When true (default), a destination file whose sha256 differs from
        /// the snapshot aborts the whole restore before anything is written.
        require_clean: bool,
    },
}

impl RestoreMode {
    /// The safe default: [`RestoreMode::Overwrite`] with `require_clean: true`.
    pub const OVERWRITE_CLEAN: RestoreMode = RestoreMode::Overwrite {
        require_clean: true,
    };
}

/// What a restore would do (or did), per relative path.
///
/// Deletions are never propagated in v1: files present in the destination but
/// absent from the snapshot are listed in `keep` and are left alone.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct RestorePlan {
    /// Relative paths that do not exist in the destination and would be
    /// created.
    pub create: Vec<String>,
    /// Relative paths that exist in the destination with different contents
    /// and would be overwritten.
    pub overwrite: Vec<String>,
    /// Relative paths that already exist with identical contents; skipped.
    pub unchanged: Vec<String>,
    /// Relative paths present in the destination but absent from the
    /// snapshot. Listed for visibility only; never deleted.
    pub keep: Vec<String>,
}

/// Result of [`crate::restore_snapshot`].
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RestoreReport {
    /// The plan that was applied (or, for [`RestoreMode::DryRun`], would be
    /// applied).
    pub plan: RestorePlan,
    /// Bytes actually written. Always `0` for [`RestoreMode::DryRun`].
    pub bytes_written: u64,
}

/// Result of [`crate::prune_snapshots`].
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct PruneReport {
    /// Ids of snapshots kept (newest first), including any unreadable ones
    /// that were deliberately not touched.
    pub kept: Vec<String>,
    /// Ids of snapshots deleted.
    pub deleted: Vec<String>,
    /// Number of `*.snap` directories skipped because their manifest was
    /// corrupt or their identity (manifest `id` vs. directory name) could
    /// not be confirmed. Skipped snapshots are never deleted.
    pub skipped_corrupt: usize,
    /// Total bytes of deleted snapshot directories (best effort, sum of file
    /// sizes walked before deletion).
    pub bytes_freed: u64,
}

/// Validate that a manifest-relative path is safe to join onto a restore or
/// verify root: forward slashes, no absolute components, no `.`/`..`/empty
/// components, no backslashes or NUL bytes.
///
/// Returns the offending component/reason on failure.
pub(crate) fn validate_manifest_rel_path(rel: &str) -> Result<(), String> {
    if rel.is_empty() {
        return Err("path is empty".into());
    }
    if rel.starts_with('/') {
        return Err("path is absolute".into());
    }
    if rel.contains('\\') {
        return Err("path contains a backslash".into());
    }
    if rel.contains('\0') {
        return Err("path contains NUL".into());
    }
    for component in rel.split('/') {
        match component {
            "" => return Err("path contains an empty component".into()),
            "." => return Err("path contains a '.' component".into()),
            ".." => return Err("path contains a '..' component".into()),
            _ => {}
        }
    }
    // Guard against Windows drive-letter / prefix smuggling even on unix.
    let mut chars = rel.chars();
    if let (Some(c), Some(':')) = (chars.next(), chars.next()) {
        if c.is_ascii_alphabetic() {
            return Err("path contains a drive-letter prefix".into());
        }
    }
    Ok(())
}
