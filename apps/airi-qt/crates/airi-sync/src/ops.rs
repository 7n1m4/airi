// SPDX-License-Identifier: GPL-3.0-or-later
//! Snapshot engine operations: create / list / verify / restore / prune.

use std::collections::BTreeSet;
use std::fs;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use sha2::{Digest, Sha256};

use crate::error::SyncError;
use crate::manifest::{
    validate_manifest_rel_path, ListReport, ManifestFile, PruneReport, RestoreMode, RestorePlan,
    RestoreReport, SnapshotManifest, SnapshotSummary, VerifyReport, FORMAT_VERSION,
};
use crate::timefmt::snapshot_id;

const MANIFEST_FILE: &str = "manifest.json";
const FILES_DIR: &str = "files";
const SNAP_SUFFIX: &str = ".snap";
const STAGING_PREFIX: &str = ".airi-sync-staging-";
/// A staging directory this old is considered abandoned (its run died) and is
/// removed. Fresh ones are left alone so concurrent runs cannot delete each
/// other's scratch space.
const STAGING_STALE_SECS: u64 = 6 * 60 * 60;
/// Nanoseconds per second, for decoding the timestamp in a staging dir name.
const NANOS_PER_SEC: u64 = 1_000_000_000;

fn now_unix_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

/// Hash a file's contents, streaming in 64 KiB chunks.
fn sha256_file(path: &Path) -> std::io::Result<(u64, String)> {
    let mut file = fs::File::open(path)?;
    let mut hasher = Sha256::new();
    let mut buf = [0u8; 64 * 1024];
    let mut total: u64 = 0;
    loop {
        let n = file.read(&mut buf)?;
        if n == 0 {
            break;
        }
        total += n as u64;
        hasher.update(&buf[..n]);
    }
    Ok((total, format!("{:x}", hasher.finalize())))
}

/// Convert a filesystem path to a manifest-relative path with forward
/// slashes. `root` must be a prefix of `path`.
fn rel_forward_slash(root: &Path, path: &Path) -> Option<String> {
    let rel = path.strip_prefix(root).ok()?;
    let mut out = String::new();
    for component in rel.components() {
        let std::path::Component::Normal(part) = component else {
            return None;
        };
        if !out.is_empty() {
            out.push('/');
        }
        out.push_str(&part.to_string_lossy());
    }
    if out.is_empty() {
        None
    } else {
        Some(out)
    }
}

/// Recursively collect candidate files under `root`. Symlinks are skipped
/// (never followed) with a tracing warning. Unreadable directories are
/// collected into `skipped`.
fn walk_files(root: &Path) -> (Vec<PathBuf>, Vec<String>) {
    let mut files = Vec::new();
    let mut skipped = Vec::new();
    let mut stack = vec![root.to_path_buf()];
    while let Some(dir) = stack.pop() {
        let entries = match fs::read_dir(&dir) {
            Ok(e) => e,
            Err(err) => {
                tracing::warn!(path = %dir.display(), error = %err, "skipping unreadable directory");
                let rel =
                    rel_forward_slash(root, &dir).unwrap_or_else(|| dir.display().to_string());
                skipped.push(rel);
                continue;
            }
        };
        for entry in entries {
            let entry = match entry {
                Ok(e) => e,
                Err(err) => {
                    tracing::warn!(error = %err, "skipping unreadable directory entry");
                    continue;
                }
            };
            let file_type = match entry.file_type() {
                Ok(t) => t,
                Err(err) => {
                    tracing::warn!(path = %entry.path().display(), error = %err, "skipping entry with unreadable type");
                    continue;
                }
            };
            let path = entry.path();
            if file_type.is_symlink() {
                tracing::warn!(path = %path.display(), "skipping symlink");
                continue;
            }
            if file_type.is_dir() {
                stack.push(path);
            } else if file_type.is_file() {
                files.push(path);
            }
        }
    }
    files.sort();
    (files, skipped)
}

/// Join a validated manifest-relative path onto a root.
///
/// Callers must run [`validate_manifest_rel_path`] first; this function
/// re-validates defensively and joins component-by-component (never via
/// `Path::join` on the raw string) so a malicious manifest cannot escape
/// the root.
fn join_under_root(root: &Path, rel: &str) -> Result<PathBuf, SyncError> {
    validate_manifest_rel_path(rel).map_err(|reason| SyncError::ManifestInvalid {
        path: root.join(MANIFEST_FILE),
        reason,
    })?;
    let mut out = root.to_path_buf();
    for component in rel.split('/') {
        out.push(component);
    }
    Ok(out)
}

/// Total size of all non-symlink files under `dir` (best effort).
fn dir_size_bytes(dir: &Path) -> u64 {
    let (files, _) = walk_files(dir);
    files
        .into_iter()
        .filter_map(|f| fs::metadata(&f).ok())
        .map(|m| m.len())
        .sum()
}

/// Read and validate the manifest of a `<id>.snap` directory.
///
/// `expected_id`, when set, requires the manifest's `id` to equal it (used
/// as a deletion guard by [`prune_snapshots`]); pass `None` to accept any id.
fn read_manifest(
    snapshot_dir: &Path,
    expected_id: Option<&str>,
) -> Result<SnapshotManifest, SyncError> {
    let manifest_path = snapshot_dir.join(MANIFEST_FILE);
    let raw = fs::read_to_string(&manifest_path).map_err(|source| SyncError::Io {
        path: manifest_path.clone(),
        source,
    })?;
    let manifest: SnapshotManifest =
        serde_json::from_str(&raw).map_err(|source| SyncError::Manifest {
            path: manifest_path.clone(),
            source,
        })?;
    if manifest.format_version != FORMAT_VERSION {
        return Err(SyncError::ManifestInvalid {
            path: manifest_path,
            reason: format!(
                "unsupported format_version {} (expected {FORMAT_VERSION})",
                manifest.format_version
            ),
        });
    }
    for file in &manifest.files {
        if let Err(reason) = validate_manifest_rel_path(&file.path) {
            return Err(SyncError::ManifestInvalid {
                path: manifest_path,
                reason: format!("unsafe file path {:?}: {reason}", file.path),
            });
        }
    }
    if let Some(expected) = expected_id {
        if manifest.id != expected {
            return Err(SyncError::ManifestInvalid {
                path: manifest_path,
                reason: format!(
                    "manifest id {:?} does not match snapshot directory {:?}",
                    manifest.id, expected
                ),
            });
        }
    }
    Ok(manifest)
}

/// Serialize a manifest to pretty JSON (used for tests' expectations too).
fn manifest_json(manifest: &SnapshotManifest) -> Result<String, SyncError> {
    serde_json::to_string_pretty(manifest).map_err(|source| SyncError::Manifest {
        path: PathBuf::from(MANIFEST_FILE),
        source,
    })
}

/// Create a snapshot of `source_dir` under `dest_root`.
///
/// Writes `<dest_root>/<id>.snap/files/<relative>` (plain file copies — see
/// crate-level docs for why) and, **last**, `<dest_root>/<id>.snap/manifest.json`.
/// The manifest is written after the tree so a parseable manifest implies a
/// complete file tree at write time. On any failure after the `.snap`
/// directory was created, the partial snapshot is removed before returning
/// the error.
///
/// ## Per-file consistency (copy-then-hash)
///
/// Each file is copied into a per-run staging directory **first**, and its
/// manifest entry is hashed from those archived bytes. Hashing the source
/// before copying it (the obvious order) opens a hash-then-copy TOCTOU window:
/// a file modified in between ships bytes that do not match the manifest, so
/// [`verify_snapshot`] would later report the snapshot corrupt, or — worse —
/// inconsistent bytes would reach a restore. Because the manifest records the
/// hash of exactly the bytes that were archived, the copy/hash pair can never
/// disagree.
///
/// The staged copies are then published into `<id>.snap/files/` with a rename,
/// so the snapshot tree is only ever filled with files that already have a
/// manifest hash. A source that changes *while* it is being copied (detected as
/// a length mismatch against the source after the copy) is copied once more;
/// if it is still changing, the file is listed in `manifest.skipped` rather
/// than archiving a torn copy.
///
/// Returns [`SyncError::EmptySource`] when `source_dir` is missing, not a
/// directory, or yields no archivable files.
pub fn create_snapshot(
    source_dir: &Path,
    dest_root: &Path,
    label: Option<&str>,
) -> Result<SnapshotManifest, SyncError> {
    let metadata =
        fs::metadata(source_dir).map_err(|_| SyncError::EmptySource(source_dir.into()))?;
    if !metadata.is_dir() {
        return Err(SyncError::EmptySource(source_dir.into()));
    }

    let (candidates, mut skipped) = walk_files(source_dir);

    // Leftovers from a run that died before it could clean up. The manifest is
    // written last, so a staging directory never belongs to a snapshot that
    // `list_snapshots` can already see.
    purge_stale_staging(dest_root);

    fs::create_dir_all(dest_root).map_err(|e| SyncError::io(dest_root, e))?;
    let staging_root = create_staging_dir(dest_root);

    let mut staged: Vec<ManifestFile> = Vec::with_capacity(candidates.len());
    for path in candidates {
        let rel = match rel_forward_slash(source_dir, &path) {
            Some(rel) => rel,
            None => {
                tracing::warn!(path = %path.display(), "skipping file outside source root");
                continue;
            }
        };
        match archive_file(&path, &rel, &staging_root) {
            Ok(file) => staged.push(file),
            Err(err) => {
                // One file that cannot be archived does not sink the snapshot;
                // it is recorded in `manifest.skipped` like any other unreadable
                // entry.
                tracing::warn!(path = %path.display(), error = %err, "skipping file that could not be archived");
                skipped.push(rel);
            }
        }
    }

    let result = (|| {
        if staged.is_empty() {
            return Err(SyncError::EmptySource(source_dir.into()));
        }
        staged.sort_by(|a, b| a.path.cmp(&b.path));
        skipped.sort();
        let total_bytes = staged.iter().map(|f| f.bytes).sum();

        let created_unix_ms = now_unix_ms();
        let mut attempts = 0;
        let (id, snap_dir) = loop {
            attempts += 1;
            let id = snapshot_id(created_unix_ms);
            let snap_dir = dest_root.join(format!("{id}{SNAP_SUFFIX}"));
            match fs::create_dir(&snap_dir) {
                Ok(()) => break (id, snap_dir),
                Err(err) if err.kind() == std::io::ErrorKind::AlreadyExists && attempts < 8 => {
                    tracing::warn!(%id, "snapshot id collision; regenerating");
                    continue;
                }
                Err(err) => return Err(SyncError::io(&snap_dir, err)),
            }
        };

        let manifest = publish_snapshot(
            &snap_dir,
            &id,
            created_unix_ms,
            label,
            source_dir,
            &staged,
            &staging_root,
            skipped,
            total_bytes,
        );
        if manifest.is_err() {
            // Never leave a half-written snapshot behind.
            let _ = fs::remove_dir_all(&snap_dir);
        }
        manifest
    })();

    // Staging is scratch space: it must not survive the run, and it must not be
    // mistaken for a snapshot by `list_snapshots`.
    let _ = fs::remove_dir_all(&staging_root);
    result
}

/// Move the staged copies into `<snap_dir>/files/` and write the manifest.
///
/// `staged` must already be sorted and hashed (see [`create_snapshot`]); the
/// manifest is written last.
#[allow(clippy::too_many_arguments)]
fn publish_snapshot(
    snap_dir: &Path,
    id: &str,
    created_unix_ms: i64,
    label: Option<&str>,
    source_dir: &Path,
    staged: &[ManifestFile],
    staging_root: &Path,
    skipped: Vec<String>,
    total_bytes: u64,
) -> Result<SnapshotManifest, SyncError> {
    let files_root = snap_dir.join(FILES_DIR);
    fs::create_dir_all(&files_root).map_err(|e| SyncError::io(&files_root, e))?;

    for file in staged {
        let from = join_under_root(staging_root, &file.path)?;
        let to = join_under_root(&files_root, &file.path)?;
        if let Some(parent) = to.parent() {
            fs::create_dir_all(parent).map_err(|e| SyncError::io(parent, e))?;
        }
        // The staged bytes are the bytes the hash was computed from, so
        // publishing is a rename — never a re-read that could pick up a
        // different version of the file.
        match fs::rename(&from, &to) {
            Ok(()) => {}
            // Staging may sit on another filesystem than the destination; the
            // bytes are unchanged, so a copy is equivalent.
            Err(err) if err.kind() == std::io::ErrorKind::CrossesDevices => {
                fs::copy(&from, &to).map_err(|e| SyncError::io(&to, e))?;
            }
            Err(err) => return Err(SyncError::io(&from, err)),
        }
    }

    let manifest = SnapshotManifest {
        format_version: FORMAT_VERSION,
        id: id.to_string(),
        created_unix_ms,
        label: label.map(str::to_string),
        source_path_hint: source_dir.display().to_string(),
        files: staged.to_vec(),
        skipped,
        total_bytes,
    };
    // Manifest LAST: a parseable manifest implies a complete tree.
    let manifest_path = snap_dir.join(MANIFEST_FILE);
    let json = manifest_json(&manifest)?;
    fs::write(&manifest_path, json).map_err(|e| SyncError::io(&manifest_path, e))?;
    Ok(manifest)
}

/// Copy one source file into the staging tree and hash the archived bytes.
///
/// The manifest entry is derived from the copy, never from the source, so the
/// recorded `(bytes, sha256)` always describes exactly what will be published.
/// A source that changes while it is being copied (detected as a length
/// mismatch after the copy) is copied once more; if it is still changing, the
/// file is refused and the caller records it as skipped.
fn archive_file(source: &Path, rel: &str, staging_root: &Path) -> Result<ManifestFile, String> {
    let staged = staging_root.join(rel);
    match archive_once(source, &staged, rel)? {
        Some(entry) => Ok(entry),
        // The source was being written while it was copied; one more attempt,
        // then refuse rather than publish a torn copy.
        None => archive_once(source, &staged, rel)?.ok_or_else(|| {
            format!(
                "{rel}: source kept changing while it was being copied ({} -> {})",
                source.display(),
                rel
            )
        }),
    }
}

/// Copy `source` to `staged` and hash the copied bytes.
///
/// `Ok(None)` means the copy succeeded but the source no longer has the length
/// the copy has, i.e. it was rewritten while the copy was in flight. The copy is
/// self-consistent (its hash describes its own bytes), but the caller should
/// retry to try to catch a settled version.
fn archive_once(source: &Path, staged: &Path, rel: &str) -> Result<Option<ManifestFile>, String> {
    if let Some(parent) = staged.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("{rel}: {e}"))?;
    }
    fs::copy(source, staged).map_err(|e| format!("{rel}: {e}"))?;

    // Hash the archived bytes: this is what the manifest records.
    let (bytes, sha256) = sha256_file(staged).map_err(|e| format!("{rel}: {e}"))?;
    if fs::metadata(source).is_ok_and(|meta| meta.len() != bytes) {
        return Ok(None);
    }
    Ok(Some(ManifestFile {
        path: rel.to_string(),
        bytes,
        sha256,
    }))
}

/// Remove staging directories left behind by a run that never finished.
///
/// A staging directory only exists between [`create_staging_dir`] and the end
/// of [`create_snapshot`], so anything found here is garbage — but only remove
/// it once it is old enough that a *concurrent* snapshot could not still be
/// filling it. Names embed the creation time in nanoseconds, so fresh entries
/// are left alone.
fn purge_stale_staging(dest_root: &Path) {
    let Ok(entries) = fs::read_dir(dest_root) else {
        return;
    };
    let cutoff = SystemTime::now()
        .checked_sub(std::time::Duration::from_secs(STAGING_STALE_SECS))
        .unwrap_or(UNIX_EPOCH);
    for entry in entries.flatten() {
        let name = entry.file_name();
        let Some(name) = name.to_str() else { continue };
        let Some(stamp) = name.strip_prefix(STAGING_PREFIX) else {
            continue;
        };
        if !entry.path().is_dir() {
            continue;
        }
        if staging_created_at(stamp).is_some_and(|created| created >= cutoff) {
            continue;
        }
        let _ = fs::remove_dir_all(entry.path());
    }
}

/// Parse the nanosecond timestamp embedded in a staging directory name.
fn staging_created_at(stamp: &str) -> Option<SystemTime> {
    let nanos: u64 = stamp.split('-').next()?.parse().ok()?;
    UNIX_EPOCH.checked_add(std::time::Duration::new(
        nanos / NANOS_PER_SEC,
        (nanos % NANOS_PER_SEC) as u32,
    ))
}

/// Create an empty staging directory for one snapshot run.
///
/// The name embeds a wall-clock nanosecond stamp (used by
/// [`purge_stale_staging`]) plus the pid, so concurrent runs never share a
/// directory.
fn create_staging_dir(dest_root: &Path) -> PathBuf {
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    let pid = std::process::id();
    let base = format!("{STAGING_PREFIX}{nanos}-{pid}");
    for attempt in 0..64u32 {
        let candidate = dest_root.join(format!("{base}-{attempt}"));
        match fs::create_dir(&candidate) {
            Ok(()) => return candidate,
            Err(err) if err.kind() == std::io::ErrorKind::AlreadyExists => continue,
            Err(err) => {
                tracing::warn!(path = %candidate.display(), error = %err, "could not create staging directory");
                break;
            }
        }
    }
    // Fall back to a name that was never created up front: every per-file copy
    // creates its parent directories, so it still works as scratch space.
    dest_root.join(format!("{base}-scratch"))
}

/// List snapshots under `dest_root`.
///
/// Entries are `<id>.snap` directories whose manifest parses and validates;
/// corrupt ones are skipped and counted in [`ListReport::skipped_corrupt`].
/// Sorted by `created_unix_ms` descending. A missing `dest_root` yields an
/// empty report rather than an error (a backup root that has never been
/// used is a valid state). Symlinks are never followed.
pub fn list_snapshots(dest_root: &Path) -> Result<ListReport, SyncError> {
    let mut snapshots = Vec::new();
    let mut skipped_corrupt = 0usize;

    let entries = match fs::read_dir(dest_root) {
        Ok(e) => e,
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => {
            return Ok(ListReport::default());
        }
        Err(err) => return Err(SyncError::io(dest_root, err)),
    };

    for entry in entries {
        let entry = entry.map_err(|e| SyncError::io(dest_root, e))?;
        let path = entry.path();
        let file_type = match entry.file_type() {
            Ok(t) => t,
            Err(_) => {
                skipped_corrupt += 1;
                continue;
            }
        };
        if file_type.is_symlink() || !file_type.is_dir() {
            continue;
        }
        let name = entry.file_name().to_string_lossy().into_owned();
        let Some(id) = name.strip_suffix(SNAP_SUFFIX) else {
            continue;
        };
        match read_manifest(&path, Some(id)) {
            Ok(manifest) => snapshots.push(SnapshotSummary {
                id: manifest.id,
                path,
                created_unix_ms: manifest.created_unix_ms,
                label: manifest.label,
                file_count: manifest.files.len(),
                total_bytes: manifest.total_bytes,
            }),
            Err(err) => {
                skipped_corrupt += 1;
                tracing::warn!(path = %path.display(), error = %err, "skipping corrupt snapshot");
            }
        }
    }

    snapshots.sort_by(|a, b| {
        b.created_unix_ms
            .cmp(&a.created_unix_ms)
            .then_with(|| a.id.cmp(&b.id))
    });
    Ok(ListReport {
        snapshots,
        skipped_corrupt,
    })
}

/// Re-hash every file in `snapshot_dir` against its manifest.
///
/// Returns [`VerifyReport::Ok`] when all files are present and match, or
/// [`VerifyReport::Corrupt`] listing missing and mismatched relative paths.
/// A missing or unparseable manifest is an error, not a report.
pub fn verify_snapshot(snapshot_dir: &Path) -> Result<VerifyReport, SyncError> {
    let manifest = read_manifest(snapshot_dir, None)?;
    let files_root = snapshot_dir.join(FILES_DIR);

    let mut missing = Vec::new();
    let mut mismatched = Vec::new();
    let mut bytes_checked = 0u64;
    let mut files_checked = 0usize;

    for file in &manifest.files {
        let path = join_under_root(&files_root, &file.path)?;
        match fs::metadata(&path) {
            Ok(meta) if !meta.is_file() => missing.push(file.path.clone()),
            Ok(_) => match sha256_file(&path) {
                Ok((bytes, sha256)) => {
                    if sha256 == file.sha256 {
                        files_checked += 1;
                        bytes_checked += bytes;
                    } else {
                        mismatched.push(file.path.clone());
                    }
                }
                Err(err) => {
                    tracing::warn!(path = %path.display(), error = %err, "file could not be hashed");
                    mismatched.push(file.path.clone());
                }
            },
            Err(_) => missing.push(file.path.clone()),
        }
    }

    if missing.is_empty() && mismatched.is_empty() {
        Ok(VerifyReport::Ok {
            files_checked,
            bytes_checked,
        })
    } else {
        Ok(VerifyReport::Corrupt {
            missing,
            mismatched,
        })
    }
}

/// Compute the restore plan for `manifest` against `dest_dir`.
fn compute_plan(manifest: &SnapshotManifest, dest_dir: &Path) -> Result<RestorePlan, SyncError> {
    let mut plan = RestorePlan::default();
    let mut snapshot_paths = BTreeSet::new();

    for file in &manifest.files {
        snapshot_paths.insert(file.path.clone());
        let dest = join_under_root(dest_dir, &file.path)?;
        match fs::metadata(&dest) {
            Ok(meta) if meta.is_file() => match sha256_file(&dest) {
                Ok((_, sha256)) if sha256 == file.sha256 => plan.unchanged.push(file.path.clone()),
                // Unreadable dest file: treat as needing overwrite so a
                // require_clean restore refuses rather than clobbers blindly.
                _ => plan.overwrite.push(file.path.clone()),
            },
            Ok(_) => plan.overwrite.push(file.path.clone()),
            Err(err) if err.kind() == std::io::ErrorKind::NotFound => {
                plan.create.push(file.path.clone())
            }
            Err(err) => return Err(SyncError::io(&dest, err)),
        }
    }

    if dest_dir.is_dir() {
        let (dest_files, _) = walk_files(dest_dir);
        for path in dest_files {
            if let Some(rel) = rel_forward_slash(dest_dir, &path) {
                if !snapshot_paths.contains(&rel) {
                    plan.keep.push(rel);
                }
            }
        }
    }

    plan.create.sort();
    plan.overwrite.sort();
    plan.unchanged.sort();
    plan.keep.sort();
    Ok(plan)
}

/// Restore `snapshot_dir` into `dest_dir`.
///
/// See [`RestoreMode`] for the exact semantics. Files in the destination
/// that are absent from the snapshot are never deleted; they appear in
/// [`RestorePlan::keep`]. With `require_clean: true` the pre-flight check
/// happens before any write, so a refused restore leaves the destination
/// untouched. Writes are plain per-file copies (not atomic renames); on
/// failure mid-restore the destination may contain a partially restored
/// tree — v1 does not roll back.
pub fn restore_snapshot(
    snapshot_dir: &Path,
    dest_dir: &Path,
    mode: RestoreMode,
) -> Result<RestoreReport, SyncError> {
    let manifest = read_manifest(snapshot_dir, None)?;
    let files_root = snapshot_dir.join(FILES_DIR);

    // Pre-flight: every file in the manifest must exist in files/ — do this
    // before writing anything so an incomplete snapshot cannot half-restore.
    let mut missing = Vec::new();
    for file in &manifest.files {
        let path = join_under_root(&files_root, &file.path)?;
        match fs::metadata(&path) {
            Ok(meta) if meta.is_file() => {}
            _ => missing.push(file.path.clone()),
        }
    }
    if !missing.is_empty() {
        return Err(SyncError::SnapshotIncomplete {
            snapshot: snapshot_dir.to_path_buf(),
            missing,
        });
    }

    let plan = compute_plan(&manifest, dest_dir)?;

    match mode {
        RestoreMode::DryRun => Ok(RestoreReport {
            plan,
            bytes_written: 0,
        }),
        RestoreMode::Overwrite { require_clean } => {
            if require_clean && !plan.overwrite.is_empty() {
                return Err(SyncError::DirtyTarget {
                    count: plan.overwrite.len(),
                    files: plan.overwrite.clone(),
                });
            }

            fs::create_dir_all(dest_dir).map_err(|e| SyncError::io(dest_dir, e))?;

            let mut bytes_written = 0u64;
            for file in &manifest.files {
                if plan.unchanged.binary_search(&file.path).is_ok() {
                    continue;
                }
                let from = join_under_root(&files_root, &file.path)?;
                let to = join_under_root(dest_dir, &file.path)?;
                if let Some(parent) = to.parent() {
                    fs::create_dir_all(parent).map_err(|e| SyncError::io(parent, e))?;
                }
                // If the destination is a symlink, replace the link itself
                // rather than writing through it to its target.
                if let Ok(meta) = fs::symlink_metadata(&to) {
                    if meta.file_type().is_symlink() {
                        fs::remove_file(&to).map_err(|e| SyncError::io(&to, e))?;
                    }
                }
                fs::copy(&from, &to).map_err(|e| SyncError::io(&to, e))?;
                bytes_written += file.bytes;
            }
            Ok(RestoreReport {
                plan,
                bytes_written,
            })
        }
    }
}

/// Prune old snapshots under `dest_root`, keeping the `keep_last` newest.
///
/// Safety rules (all enforced, all tested):
///
/// * `keep_last == 0` is a typed error ([`SyncError::PruneKeepZero`]); the
///   function never deletes anything in that case.
/// * Only direct `<id>.snap` children of `dest_root` are ever considered.
/// * A `.snap` directory is deleted only if its `manifest.json` parses,
///   validates, and its `id` matches the directory name exactly — a
///   directory that merely ends in `.snap` but fails those checks is
///   counted in [`PruneReport::skipped_corrupt`] and left alone.
/// * Symlinks are never followed or deleted.
/// * A missing `dest_root` yields an empty report.
pub fn prune_snapshots(dest_root: &Path, keep_last: usize) -> Result<PruneReport, SyncError> {
    if keep_last == 0 {
        return Err(SyncError::PruneKeepZero);
    }

    let mut report = PruneReport::default();
    let entries = match fs::read_dir(dest_root) {
        Ok(e) => e,
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => return Ok(report),
        Err(err) => return Err(SyncError::io(dest_root, err)),
    };

    let canonical_root = dest_root
        .canonicalize()
        .map_err(|e| SyncError::io(dest_root, e))?;

    struct Candidate {
        id: String,
        path: PathBuf,
        created_unix_ms: i64,
    }
    let mut candidates: Vec<Candidate> = Vec::new();

    for entry in entries {
        let entry = entry.map_err(|e| SyncError::io(dest_root, e))?;
        let path = entry.path();
        let file_type = match entry.file_type() {
            Ok(t) => t,
            Err(_) => {
                report.skipped_corrupt += 1;
                continue;
            }
        };
        if file_type.is_symlink() || !file_type.is_dir() {
            continue;
        }
        // Direct child of dest_root only (read_dir guarantees this, but the
        // name check is the real guard against ever pointing at a real
        // user directory).
        let name = entry.file_name().to_string_lossy().into_owned();
        let Some(id) = name.strip_suffix(SNAP_SUFFIX) else {
            continue;
        };
        let canonical_child = match path.canonicalize() {
            Ok(c) => c,
            Err(_) => {
                report.skipped_corrupt += 1;
                continue;
            }
        };
        if canonical_child.parent() != Some(canonical_root.as_path()) {
            report.skipped_corrupt += 1;
            continue;
        }
        match read_manifest(&path, Some(id)) {
            Ok(manifest) => candidates.push(Candidate {
                id: manifest.id,
                path,
                created_unix_ms: manifest.created_unix_ms,
            }),
            Err(err) => {
                report.skipped_corrupt += 1;
                tracing::warn!(path = %path.display(), error = %err, "refusing to prune snapshot with corrupt manifest");
            }
        }
    }

    candidates.sort_by(|a, b| {
        b.created_unix_ms
            .cmp(&a.created_unix_ms)
            .then_with(|| a.id.cmp(&b.id))
    });

    for (index, candidate) in candidates.into_iter().enumerate() {
        if index < keep_last {
            report.kept.push(candidate.id);
            continue;
        }
        // Re-check the identity right before deleting (TOCTOU paranoia).
        let name = candidate
            .path
            .file_name()
            .map(|n| n.to_string_lossy().into_owned())
            .unwrap_or_default();
        let is_snap_dir = candidate.path.is_dir()
            && name.strip_suffix(SNAP_SUFFIX) == Some(candidate.id.as_str())
            && read_manifest(&candidate.path, Some(&candidate.id)).is_ok();
        if !is_snap_dir {
            report.skipped_corrupt += 1;
            report.kept.push(candidate.id);
            continue;
        }
        report.bytes_freed += dir_size_bytes(&candidate.path);
        fs::remove_dir_all(&candidate.path).map_err(|e| SyncError::io(&candidate.path, e))?;
        report.deleted.push(candidate.id);
    }

    Ok(report)
}
