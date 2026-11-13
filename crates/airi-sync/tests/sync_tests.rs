// SPDX-License-Identifier: GPL-3.0-or-later
//! Tempdir-based integration tests for `airi-sync`.

use std::fs;
use std::path::{Path, PathBuf};

use airi_sync::{
    create_snapshot, list_snapshots, prune_snapshots, restore_snapshot, verify_snapshot,
    ListReport, RestoreMode, SyncError, VerifyReport,
};
use sha2::{Digest, Sha256};
use tempfile::TempDir;

fn write_file(root: &Path, rel: &str, contents: &[u8]) {
    let path = root.join(rel);
    fs::create_dir_all(path.parent().unwrap()).unwrap();
    fs::write(path, contents).unwrap();
}

fn sha256_hex(bytes: &[u8]) -> String {
    format!("{:x}", Sha256::digest(bytes))
}

fn make_source() -> TempDir {
    let dir = TempDir::new().unwrap();
    write_file(dir.path(), "airi.sqlite", b"sqlite-bytes-v1");
    write_file(dir.path(), "profile/settings.json", br#"{"theme":"dark"}"#);
    write_file(dir.path(), "profile/nested/deep/avatar.bin", &[0u8; 512]);
    dir
}

fn snapshot_dirs(dest_root: &Path) -> Vec<PathBuf> {
    let mut dirs: Vec<PathBuf> = fs::read_dir(dest_root)
        .unwrap()
        .map(|e| e.unwrap().path())
        .filter(|p| p.is_dir() && p.extension().is_some_and(|e| e == "snap"))
        .collect();
    dirs.sort();
    dirs
}

/// Rewrite a snapshot's `created_unix_ms` to a known value so list/prune
/// ordering can be asserted deterministically.
fn set_created_unix_ms(snap_dir: &Path, created_unix_ms: i64) {
    let manifest_path = snap_dir.join("manifest.json");
    let raw = fs::read_to_string(&manifest_path).unwrap();
    let mut value: serde_json::Value = serde_json::from_str(&raw).unwrap();
    value["created_unix_ms"] = serde_json::json!(created_unix_ms);
    fs::write(
        &manifest_path,
        serde_json::to_string_pretty(&value).unwrap(),
    )
    .unwrap();
}

#[test]
fn create_snapshot_manifest_lists_every_file_with_correct_sha256() {
    let source = make_source();
    let dest_root = TempDir::new().unwrap();

    let manifest = create_snapshot(source.path(), dest_root.path(), Some("nightly")).unwrap();

    assert_eq!(manifest.format_version, 1);
    assert_eq!(manifest.label.as_deref(), Some("nightly"));
    assert_eq!(manifest.files.len(), 3);
    assert!(manifest.skipped.is_empty());

    let paths: Vec<&str> = manifest.files.iter().map(|f| f.path.as_str()).collect();
    assert_eq!(
        paths,
        vec![
            "airi.sqlite",
            "profile/nested/deep/avatar.bin",
            "profile/settings.json"
        ]
    );

    let expected_total: u64 = manifest.files.iter().map(|f| f.bytes).sum();
    assert_eq!(manifest.total_bytes, expected_total);

    for file in &manifest.files {
        let bytes = fs::read(source.path().join(&file.path)).unwrap();
        assert_eq!(file.bytes as usize, bytes.len());
        assert_eq!(file.sha256, sha256_hex(&bytes));
        // Plain-copy tree, manifest present.
        let snap_file = dest_root
            .path()
            .join(format!("{}.snap", manifest.id))
            .join("files")
            .join(&file.path);
        assert!(
            snap_file.is_file(),
            "missing snapshot file {}",
            snap_file.display()
        );
        assert_eq!(fs::read(&snap_file).unwrap(), bytes);
    }

    let manifest_path = dest_root
        .path()
        .join(format!("{}.snap", manifest.id))
        .join("manifest.json");
    let on_disk: serde_json::Value =
        serde_json::from_str(&fs::read_to_string(manifest_path).unwrap()).unwrap();
    assert_eq!(on_disk["id"], serde_json::json!(manifest.id));
}

#[test]
fn create_snapshot_rejects_missing_and_empty_sources() {
    let dest_root = TempDir::new().unwrap();

    let missing = dest_root.path().join("does-not-exist");
    let err = create_snapshot(&missing, dest_root.path(), None).unwrap_err();
    assert!(matches!(err, SyncError::EmptySource(_)));

    let empty = TempDir::new().unwrap();
    let err = create_snapshot(empty.path(), dest_root.path(), None).unwrap_err();
    assert!(matches!(err, SyncError::EmptySource(_)));
}

#[test]
fn verify_snapshot_ok() {
    let source = make_source();
    let dest_root = TempDir::new().unwrap();
    let manifest = create_snapshot(source.path(), dest_root.path(), None).unwrap();
    let snap_dir = dest_root.path().join(format!("{}.snap", manifest.id));

    match verify_snapshot(&snap_dir).unwrap() {
        VerifyReport::Ok {
            files_checked,
            bytes_checked,
        } => {
            assert_eq!(files_checked, 3);
            assert_eq!(bytes_checked, manifest.total_bytes);
        }
        other => panic!("expected Ok, got {other:?}"),
    }
}

#[test]
fn verify_snapshot_detects_corruption() {
    let source = make_source();
    let dest_root = TempDir::new().unwrap();
    let manifest = create_snapshot(source.path(), dest_root.path(), None).unwrap();
    let snap_dir = dest_root.path().join(format!("{}.snap", manifest.id));

    // Flip a byte in one snapshot file.
    let victim = snap_dir.join("files").join("airi.sqlite");
    let mut bytes = fs::read(&victim).unwrap();
    bytes[0] ^= 0xff;
    fs::write(&victim, bytes).unwrap();

    match verify_snapshot(&snap_dir).unwrap() {
        VerifyReport::Corrupt {
            missing,
            mismatched,
        } => {
            assert!(missing.is_empty());
            assert_eq!(mismatched, vec!["airi.sqlite".to_string()]);
        }
        other => panic!("expected Corrupt, got {other:?}"),
    }

    // Delete a file entirely.
    fs::remove_file(&victim).unwrap();
    match verify_snapshot(&snap_dir).unwrap() {
        VerifyReport::Corrupt {
            missing,
            mismatched: _,
        } => {
            assert_eq!(missing, vec!["airi.sqlite".to_string()]);
        }
        other => panic!("expected Corrupt, got {other:?}"),
    }
}

/// A big file so `fs::copy` takes a while, and a churn thread that rewrites the
/// source to a different length mid-copy.
const TOCTOU_BYTES: usize = 64 * 1024 * 1024;
/// Replacement length the churn thread writes over the source.
const TOCTOU_REPLACEMENT: usize = 1024;

/// A file rewritten while it is copied must never produce a snapshot whose
/// archived bytes disagree with its manifest hash.
///
/// The pre-fix code hashed the *source* before copying it, so a source that
/// changed between hash and copy shipped bytes the manifest did not describe —
/// [`verify_snapshot`] then reported the snapshot corrupt. The fixed order
/// (copy first, hash the copy) cannot disagree: whatever the copy caught, the
/// manifest describes exactly those bytes. A source that moves while the copy
/// is in flight is copied once more and, if it is still moving, recorded in
/// `manifest.skipped` rather than archived torn.
#[test]
fn create_snapshot_never_archives_bytes_that_disagree_with_the_manifest() {
    let source = TempDir::new().unwrap();
    write_file(source.path(), "growing.bin", &vec![b'x'; TOCTOU_BYTES]);
    let dest_root = TempDir::new().unwrap();

    let churn = std::thread::spawn({
        let path = source.path().join("growing.bin");
        move || {
            let replacement = vec![b'y'; TOCTOU_REPLACEMENT];
            // Rewriting is the whole point; give up rather than spin forever
            // if the copy finished before the thread ever got scheduled.
            let deadline = std::time::Instant::now() + std::time::Duration::from_secs(5);
            while std::time::Instant::now() < deadline && fs::write(&path, &replacement).is_ok() {}
        }
    });

    let manifest = match create_snapshot(source.path(), dest_root.path(), None) {
        Ok(m) => m,
        // The churn thread won the race: the source was already replaced before
        // the snapshot started, so there was nothing left to archive. That is a
        // valid outcome, not a failure of the invariant under test.
        Err(SyncError::EmptySource(_)) => {
            churn.join().unwrap();
            return;
        }
        Err(e) => panic!("unexpected error: {e:?}"),
    };
    churn.join().unwrap();

    assert_eq!(
        manifest.files.len() + manifest.skipped.len(),
        1,
        "the file was neither archived nor skipped: {:?} / {:?}",
        manifest.files,
        manifest.skipped
    );

    // A 64 MiB copy cannot finish before the churn thread's first write, so one
    // of the outcomes below is observed.
    if manifest.skipped.is_empty() {
        let entry = &manifest.files[0];
        assert_eq!(entry.path, "growing.bin");
        let snap_dir = dest_root.path().join(format!("{}.snap", manifest.id));
        let archived = fs::read(snap_dir.join("files").join("growing.bin")).unwrap();

        // The invariant the fix exists for: the manifest hash describes the
        // bytes that were actually archived, so the snapshot verifies.
        assert_eq!(entry.bytes as usize, archived.len());
        assert_eq!(entry.sha256, sha256_hex(&archived));
        match verify_snapshot(&snap_dir).unwrap() {
            VerifyReport::Ok { files_checked, .. } => assert_eq!(files_checked, 1),
            other => panic!("expected Ok, got {other:?}"),
        }
    } else {
        // The source never settled: refused, never archived torn.
        assert_eq!(manifest.skipped, vec!["growing.bin".to_string()]);
        assert_eq!(manifest.total_bytes, 0);
        assert!(snapshot_dirs(dest_root.path()).is_empty());
    }
}

/// Every snapshot run cleans its staging scratch space, on success and failure.
#[test]
fn create_snapshot_removes_its_staging_directory() {
    let source = make_source();
    let dest_root = TempDir::new().unwrap();
    create_snapshot(source.path(), dest_root.path(), None).unwrap();
    create_snapshot(source.path(), dest_root.path(), None).unwrap();
    create_snapshot(
        &dest_root.path().join("does-not-exist"),
        dest_root.path(),
        None,
    )
    .unwrap_err();

    let leftovers: Vec<String> = fs::read_dir(dest_root.path())
        .unwrap()
        .map(|e| e.unwrap().file_name().to_string_lossy().into_owned())
        .filter(|name| name.starts_with(".airi-sync-staging-"))
        .collect();
    assert!(
        leftovers.is_empty(),
        "staging dirs left behind: {leftovers:?}"
    );
}

/// Leftovers from a run that died are garbage; a run's own scratch space and
/// another run's fresh scratch space are never touched.
#[test]
fn create_snapshot_only_purges_stale_staging_dirs() {
    let source = make_source();
    let dest_root = TempDir::new().unwrap();

    let stale = dest_root.path().join(".airi-sync-staging-1000000000-1-0");
    write_file(&stale, "airi.sqlite", b"abandoned");
    let fresh = dest_root.path().join(format!(
        ".airi-sync-staging-{}-{}",
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos(),
        std::process::id(),
    ));
    fs::create_dir_all(&fresh).unwrap();

    create_snapshot(source.path(), dest_root.path(), None).unwrap();

    assert!(!stale.exists(), "stale staging dir was not purged");
    assert!(fresh.is_dir(), "a concurrent run's staging dir was deleted");
}

/// A source with one unreadable file still produces a verifiable snapshot that
/// records the refused file in `manifest.skipped`.
#[cfg(unix)]
#[test]
fn create_snapshot_records_refused_files_in_skipped() {
    use std::os::unix::fs::PermissionsExt;

    let source = make_source();
    write_file(source.path(), "secret.txt", b"top secret");
    fs::set_permissions(
        source.path().join("secret.txt"),
        fs::Permissions::from_mode(0o000),
    )
    .unwrap();
    let dest_root = TempDir::new().unwrap();

    let manifest = create_snapshot(source.path(), dest_root.path(), None).unwrap();

    // Root ignores permission bits, so only assert the skip when the file was
    // really refused.
    fs::set_permissions(
        source.path().join("secret.txt"),
        fs::Permissions::from_mode(0o644),
    )
    .unwrap();
    if manifest.skipped.is_empty() {
        assert_eq!(manifest.files.len(), 4);
        return;
    }
    assert_eq!(manifest.skipped, vec!["secret.txt".to_string()]);
    assert_eq!(
        manifest
            .files
            .iter()
            .map(|f| f.path.as_str())
            .collect::<Vec<_>>(),
        vec![
            "airi.sqlite",
            "profile/nested/deep/avatar.bin",
            "profile/settings.json",
        ]
    );
    let snap_dir = dest_root.path().join(format!("{}.snap", manifest.id));
    match verify_snapshot(&snap_dir).unwrap() {
        VerifyReport::Ok { files_checked, .. } => assert_eq!(files_checked, 3),
        other => panic!("expected Ok, got {other:?}"),
    }
}

#[test]
fn list_snapshots_orders_newest_first_and_skips_corrupt_manifests() {
    let source = make_source();
    let dest_root = TempDir::new().unwrap();

    let first = create_snapshot(source.path(), dest_root.path(), Some("one")).unwrap();
    let second = create_snapshot(source.path(), dest_root.path(), Some("two")).unwrap();
    let third = create_snapshot(source.path(), dest_root.path(), Some("three")).unwrap();

    // Deterministic ordering regardless of wall-clock minute collisions.
    set_created_unix_ms(&dest_root.path().join(format!("{}.snap", first.id)), 1_000);
    set_created_unix_ms(&dest_root.path().join(format!("{}.snap", second.id)), 3_000);
    set_created_unix_ms(&dest_root.path().join(format!("{}.snap", third.id)), 2_000);

    // Corrupt one manifest.
    let corrupt_dir = dest_root.path().join(format!("{}.snap", third.id));
    fs::write(corrupt_dir.join("manifest.json"), b"{ not json").unwrap();

    let ListReport {
        snapshots,
        skipped_corrupt,
    } = list_snapshots(dest_root.path()).unwrap();

    assert_eq!(skipped_corrupt, 1);
    let ids: Vec<&str> = snapshots.iter().map(|s| s.id.as_str()).collect();
    assert_eq!(ids, vec![second.id.as_str(), first.id.as_str()]);
    assert_eq!(snapshots[0].label.as_deref(), Some("two"));
    assert_eq!(snapshots[0].file_count, 3);

    // Listing a never-used backup root yields an empty report, not an error.
    let fresh = TempDir::new().unwrap();
    let report = list_snapshots(&fresh.path().join("nonexistent")).unwrap();
    assert!(report.snapshots.is_empty());
    assert_eq!(report.skipped_corrupt, 0);
}

#[test]
fn dry_run_restore_on_empty_dest_creates_everything_and_writes_nothing() {
    let source = make_source();
    let dest_root = TempDir::new().unwrap();
    let dest = TempDir::new().unwrap();
    let manifest = create_snapshot(source.path(), dest_root.path(), None).unwrap();
    let snap_dir = dest_root.path().join(format!("{}.snap", manifest.id));

    let target = dest.path().join("restore-here");
    let report = restore_snapshot(&snap_dir, &target, RestoreMode::DryRun).unwrap();

    assert_eq!(report.bytes_written, 0);
    assert!(!target.exists(), "dry run must not create the destination");
    assert_eq!(report.plan.create.len(), 3);
    assert!(report.plan.overwrite.is_empty());
    assert!(report.plan.unchanged.is_empty());
    assert!(report.plan.keep.is_empty());
}

#[test]
fn dry_run_restore_on_identical_dest_reports_all_unchanged() {
    let source = make_source();
    let dest_root = TempDir::new().unwrap();
    let dest = TempDir::new().unwrap();
    let manifest = create_snapshot(source.path(), dest_root.path(), None).unwrap();
    let snap_dir = dest_root.path().join(format!("{}.snap", manifest.id));

    // Materialize the snapshot into dest first.
    restore_snapshot(&snap_dir, dest.path(), RestoreMode::OVERWRITE_CLEAN).unwrap();

    let report = restore_snapshot(&snap_dir, dest.path(), RestoreMode::DryRun).unwrap();
    assert_eq!(report.bytes_written, 0);
    assert!(report.plan.create.is_empty());
    assert!(report.plan.overwrite.is_empty());
    assert_eq!(report.plan.unchanged.len(), 3);
}

#[test]
fn dry_run_restore_lists_unrelated_dest_files_as_keep() {
    let source = make_source();
    let dest_root = TempDir::new().unwrap();
    let dest = TempDir::new().unwrap();
    write_file(dest.path(), "unrelated-notes.txt", b"keep me");

    let manifest = create_snapshot(source.path(), dest_root.path(), None).unwrap();
    let snap_dir = dest_root.path().join(format!("{}.snap", manifest.id));

    let report = restore_snapshot(&snap_dir, dest.path(), RestoreMode::DryRun).unwrap();
    assert_eq!(report.plan.keep, vec!["unrelated-notes.txt".to_string()]);
    // And nothing was written/deleted.
    assert_eq!(
        fs::read(dest.path().join("unrelated-notes.txt")).unwrap(),
        b"keep me"
    );
}

#[test]
fn restore_refuses_to_overwrite_dirty_files_and_touches_nothing() {
    let source = make_source();
    let dest_root = TempDir::new().unwrap();
    let dest = TempDir::new().unwrap();

    // Pre-populate dest with a *modified* version of one file.
    write_file(dest.path(), "airi.sqlite", b"user-edited-bytes");
    write_file(
        dest.path(),
        "profile/settings.json",
        br#"{"theme":"light"}"#,
    );

    let manifest = create_snapshot(source.path(), dest_root.path(), None).unwrap();
    let snap_dir = dest_root.path().join(format!("{}.snap", manifest.id));

    let err = restore_snapshot(&snap_dir, dest.path(), RestoreMode::OVERWRITE_CLEAN).unwrap_err();
    match err {
        SyncError::DirtyTarget { count, files } => {
            assert_eq!(count, 2);
            assert_eq!(
                files,
                vec![
                    "airi.sqlite".to_string(),
                    "profile/settings.json".to_string()
                ]
            );
        }
        other => panic!("expected DirtyTarget, got {other:?}"),
    }

    // Destination untouched: the two dirty files are intact and the
    // previously-absent file was not created.
    assert_eq!(
        fs::read(dest.path().join("airi.sqlite")).unwrap(),
        b"user-edited-bytes"
    );
    assert_eq!(
        fs::read(dest.path().join("profile/settings.json")).unwrap(),
        br#"{"theme":"light"}"#
    );
    assert!(!dest.path().join("profile/nested/deep/avatar.bin").exists());
}

#[test]
fn restore_with_require_clean_false_overwrites_dirty_files() {
    let source = make_source();
    let dest_root = TempDir::new().unwrap();
    let dest = TempDir::new().unwrap();

    write_file(dest.path(), "airi.sqlite", b"user-edited-bytes");

    let manifest = create_snapshot(source.path(), dest_root.path(), None).unwrap();
    let snap_dir = dest_root.path().join(format!("{}.snap", manifest.id));

    let report = restore_snapshot(
        &snap_dir,
        dest.path(),
        RestoreMode::Overwrite {
            require_clean: false,
        },
    )
    .unwrap();

    assert_eq!(report.plan.overwrite, vec!["airi.sqlite".to_string()]);
    assert_eq!(
        fs::read(dest.path().join("airi.sqlite")).unwrap(),
        b"sqlite-bytes-v1"
    );
    assert!(report.bytes_written >= report.plan.create.len() as u64);
}

#[test]
fn restore_creates_parent_directories_and_never_deletes_unrelated_files() {
    let source = make_source();
    let dest_root = TempDir::new().unwrap();
    let dest = TempDir::new().unwrap();
    write_file(dest.path(), "keep/this.txt", b"untouched");

    let manifest = create_snapshot(source.path(), dest_root.path(), None).unwrap();
    let snap_dir = dest_root.path().join(format!("{}.snap", manifest.id));

    let report = restore_snapshot(&snap_dir, dest.path(), RestoreMode::OVERWRITE_CLEAN).unwrap();
    assert!(report.plan.keep.contains(&"keep/this.txt".to_string()));
    assert_eq!(
        fs::read(dest.path().join("keep/this.txt")).unwrap(),
        b"untouched"
    );
    assert!(dest.path().join("profile/nested/deep/avatar.bin").is_file());
}

#[test]
fn prune_keeps_newest_n_and_refuses_zero() {
    let source = make_source();
    let dest_root = TempDir::new().unwrap();

    // Zero is a typed error and deletes nothing.
    let err = prune_snapshots(dest_root.path(), 0).unwrap_err();
    assert!(matches!(err, SyncError::PruneKeepZero));

    let mut ids = Vec::new();
    for _ in 0..4 {
        ids.push(
            create_snapshot(source.path(), dest_root.path(), None)
                .unwrap()
                .id,
        );
    }
    // Oldest → newest: assign increasing created_unix_ms in creation order.
    for (index, id) in ids.iter().enumerate() {
        set_created_unix_ms(
            &dest_root.path().join(format!("{id}.snap")),
            (index as i64 + 1) * 1_000,
        );
    }

    let report = prune_snapshots(dest_root.path(), 2).unwrap();
    assert_eq!(report.kept, vec![ids[3].clone(), ids[2].clone()]);
    assert_eq!(report.deleted.len(), 2);
    assert!(report.bytes_freed > 0);
    assert_eq!(report.skipped_corrupt, 0);

    let remaining = snapshot_dirs(dest_root.path());
    assert_eq!(remaining.len(), 2);
    assert!(remaining.iter().all(|p| {
        let name = p.file_name().unwrap().to_string_lossy().into_owned();
        name == format!("{}.snap", ids[3]) || name == format!("{}.snap", ids[2])
    }));
}

#[test]
fn prune_never_deletes_non_snap_dirs_or_corrupt_snap_dirs() {
    let source = make_source();
    let dest_root = TempDir::new().unwrap();

    let manifest = create_snapshot(source.path(), dest_root.path(), None).unwrap();
    set_created_unix_ms(
        &dest_root.path().join(format!("{}.snap", manifest.id)),
        10_000,
    );

    // A non-.snap directory that looks like it could be important.
    let precious = dest_root.path().join("my-actual-data");
    fs::create_dir_all(&precious).unwrap();
    fs::write(precious.join("keep.txt"), b"do not delete").unwrap();

    // A *.snap directory with a corrupt manifest: skipped, never deleted.
    let corrupt = dest_root.path().join("garbage.snap");
    fs::create_dir_all(&corrupt).unwrap();
    fs::write(corrupt.join("manifest.json"), b"not json at all").unwrap();

    // A *.snap directory with a valid manifest but mismatched id: skipped.
    let mismatched = dest_root.path().join("mismatch.snap");
    fs::create_dir_all(&mismatched).unwrap();
    let raw = fs::read_to_string(
        dest_root
            .path()
            .join(format!("{}.snap", manifest.id))
            .join("manifest.json"),
    )
    .unwrap();
    fs::write(mismatched.join("manifest.json"), raw).unwrap();

    let report = prune_snapshots(dest_root.path(), 1).unwrap();

    assert_eq!(report.kept, vec![manifest.id.clone()]);
    assert!(report.deleted.is_empty());
    assert_eq!(report.skipped_corrupt, 2);
    assert!(precious.join("keep.txt").is_file());
    assert!(corrupt.is_dir());
    assert!(mismatched.is_dir());
}

/// A snapshot whose `files/` tree lost an entry must be refused *before* the
/// destination is created at all, in every restore mode (dry run included).
#[test]
fn restore_incomplete_snapshot_is_rejected() {
    let source = TempDir::new().unwrap();
    write_file(source.path(), "alpha.txt", b"alpha-bytes");
    write_file(source.path(), "beta.txt", b"beta-bytes");

    let dest_root = TempDir::new().unwrap();
    let manifest = create_snapshot(source.path(), dest_root.path(), None).unwrap();
    let snap_dir = dest_root.path().join(format!("{}.snap", manifest.id));

    // A pre-existing destination, so "nothing was written" is observable:
    // the snapshot lists alpha.txt/beta.txt and dest holds neither, but an
    // aborted restore must not even create the directory.
    let dest = TempDir::new().unwrap();
    let target = dest.path().join("restore-here");

    fs::remove_file(snap_dir.join("files").join("alpha.txt")).unwrap();

    for mode in [
        RestoreMode::DryRun,
        RestoreMode::OVERWRITE_CLEAN,
        RestoreMode::Overwrite {
            require_clean: false,
        },
    ] {
        let err = restore_snapshot(&snap_dir, &target, mode).unwrap_err();
        match &err {
            SyncError::SnapshotIncomplete { snapshot, missing } => {
                assert_eq!(snapshot, &snap_dir);
                assert_eq!(missing, &vec!["alpha.txt".to_string()]);
            }
            other => panic!("expected SnapshotIncomplete for {mode:?}, got {other:?}"),
        }
        assert!(
            !target.exists(),
            "an incomplete snapshot must write nothing ({mode:?})"
        );
    }

    // The file that *is* present must not be restored either.
    assert!(fs::read_dir(dest.path()).unwrap().next().is_none());
}

/// `verify_snapshot` and the restore pre-flight must agree on completeness.
#[test]
fn verify_snapshot_and_restore_agree_on_missing_files() {
    let source = TempDir::new().unwrap();
    write_file(source.path(), "alpha.txt", b"alpha-bytes");
    write_file(source.path(), "beta.txt", b"beta-bytes");

    let dest_root = TempDir::new().unwrap();
    let manifest = create_snapshot(source.path(), dest_root.path(), None).unwrap();
    let snap_dir = dest_root.path().join(format!("{}.snap", manifest.id));

    fs::remove_file(snap_dir.join("files").join("beta.txt")).unwrap();

    match verify_snapshot(&snap_dir).unwrap() {
        VerifyReport::Corrupt {
            missing,
            mismatched,
        } => {
            assert_eq!(missing, vec!["beta.txt".to_string()]);
            assert!(mismatched.is_empty());
        }
        other => panic!("expected Corrupt, got {other:?}"),
    }

    let dest = TempDir::new().unwrap();
    let target = dest.path().join("restore-here");
    let err = restore_snapshot(&snap_dir, &target, RestoreMode::DryRun).unwrap_err();
    match err {
        SyncError::SnapshotIncomplete { missing, .. } => {
            assert_eq!(missing, vec!["beta.txt".to_string()]);
        }
        other => panic!("expected SnapshotIncomplete, got {other:?}"),
    }
    assert!(!target.exists());
}

/// Prune must keep the N newest by `created_unix_ms`, not by directory order.
#[test]
fn prune_keeps_last_n_newest_by_created_time() {
    let source = TempDir::new().unwrap();
    write_file(source.path(), "alpha.txt", b"alpha-bytes");

    let dest_root = TempDir::new().unwrap();
    let mut ids = Vec::new();
    for _ in 0..5 {
        ids.push(
            create_snapshot(source.path(), dest_root.path(), None)
                .unwrap()
                .id,
        );
    }
    // Oldest → newest: 1_000 .. 5_000.
    for (index, id) in ids.iter().enumerate() {
        set_created_unix_ms(
            &dest_root.path().join(format!("{id}.snap")),
            (index as i64 + 1) * 1_000,
        );
    }

    let report = prune_snapshots(dest_root.path(), 2).unwrap();

    assert_eq!(report.kept, vec![ids[4].clone(), ids[3].clone()]);
    assert_eq!(
        report.deleted,
        vec![ids[2].clone(), ids[1].clone(), ids[0].clone()]
    );
    assert_eq!(report.skipped_corrupt, 0);
    assert!(report.bytes_freed > 0);

    let remaining = snapshot_dirs(dest_root.path());
    assert_eq!(remaining.len(), 2);
    assert!(remaining
        .iter()
        .any(|p| p.ends_with(&format!("{}.snap", ids[3]))));
    assert!(remaining
        .iter()
        .any(|p| p.ends_with(&format!("{}.snap", ids[4]))));
    for id in &ids[..3] {
        assert!(
            !dest_root.path().join(format!("{id}.snap")).exists(),
            "{id}.snap should have been pruned"
        );
    }

    // keep_last >= candidate count keeps everything.
    let report = prune_snapshots(dest_root.path(), 5).unwrap();
    assert!(report.deleted.is_empty());
    assert_eq!(snapshot_dirs(dest_root.path()).len(), 2);
}

/// `keep_last == 0` is refused and deletes nothing.
#[test]
fn prune_rejects_keep_zero_and_deletes_nothing() {
    let source = TempDir::new().unwrap();
    write_file(source.path(), "alpha.txt", b"alpha-bytes");

    let dest_root = TempDir::new().unwrap();
    let manifest = create_snapshot(source.path(), dest_root.path(), None).unwrap();

    let err = prune_snapshots(dest_root.path(), 0).unwrap_err();
    assert!(matches!(err, SyncError::PruneKeepZero));
    assert!(dest_root
        .path()
        .join(format!("{}.snap", manifest.id))
        .is_dir());

    // A missing root is an empty report, not an error.
    let report = prune_snapshots(&dest_root.path().join("never-created"), 1).unwrap();
    assert!(report.deleted.is_empty());
    assert!(report.kept.is_empty());
}
