// SPDX-License-Identifier: GPL-3.0-or-later
//! Local-FS sync bridge (`SyncController`) exposed to QML.
//!
//! Drives the `qml/pages/settings/modules/cloud-sync/` page against the
//! `airi-sync` snapshot engine: point-in-time snapshots of the Qt app's data
//! directory onto a **local filesystem target** (a folder, an external drive,
//! an NFS/SMB/NAS mount). S3 is not implemented — there is no network code
//! anywhere in this path.
//!
//! Honesty contract:
//!
//! * The configured target is read from disk (`<profile>/airi/sync.json`, or
//!   the platform data dir when `--profile` is not set — same convention as
//!   the MCP bridge's mcp.json) or is empty. Nothing is fabricated.
//! * `airi-probe` snapshots created by [`qobject::SyncController::probe_target`]
//!   are **kept** on success — a probe that leaves the target list honest is
//!   better than one that hides the evidence.
//! * Restore is never run without an explicit user action, and the default
//!   overwrite guard (`require_clean: true`) refuses to clobber files that
//!   were modified since the snapshot. The relaxed path (`allow_dirty: true`)
//!   exists only for the UI's explicit "Overwrite anyway" confirm.
//! * The snapshot source is the same data directory the app uses
//!   (`<profile>`, or `<platform-data>/airi-slint` — resolved exactly like the
//!   MCP bridge resolves its config parent, minus the `airi/` leaf). The
//!   `airi.sqlite*` files are included, but a snapshot taken while the app
//!   is running is a *plain file copy* of a live database — see the phase
//!   note for the copy-consistency caveat.
//!
//! Boundary contract (same as cards/providers/data/mcp bridges): JSON
//! document strings cross the boundary.

use cxx_qt::CxxQtType;
use cxx_qt_lib::QString;
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use std::pin::Pin;

use airi_sync::{RestoreMode, SyncError, VerifyReport};
use serde_json::json;

use crate::bridges;
use crate::bridges::qstring_to_string;

/// `<profile>/airi/sync.json` or `<platform-data>/airi-slint/sync.json`.
fn sync_config_path() -> PathBuf {
    bridges::profile_dir()
        .map(|p| p.join("airi").join("sync.json"))
        .or_else(|| dirs::data_dir().map(|base| base.join("airi-slint").join("sync.json")))
        .unwrap_or_else(|| PathBuf::from("sync.json"))
}

/// The Qt app's data directory — the snapshot *source*.
///
/// Same resolution chain the MCP bridge uses for its config file, minus the
/// `airi/` leaf, because the SQLite vault (`airi.sqlite*`) lives directly in
/// the data dir: `<profile>` when `--profile` is set, else
/// `<platform-data>/airi-slint`.
fn qt_data_dir() -> Option<PathBuf> {
    bridges::profile_dir()
        .cloned()
        .or_else(|| dirs::data_dir().map(|base| base.join("airi-slint")))
}

/// On-disk `sync.json`. Schema is intentionally tiny; target paths are
/// stored verbatim (no canonicalization — a symlinked target folder is the
/// user's choice).
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
struct SyncConfigFile {
    /// Absolute path of the local backup folder.
    #[serde(default)]
    target_path: Option<String>,
}

/// Load the config file; `Ok(None)` when missing, `Err` when unreadable.
fn load_config() -> Result<Option<SyncConfigFile>, String> {
    let path = sync_config_path();
    if !path.exists() {
        return Ok(None);
    }
    let text = std::fs::read_to_string(&path)
        .map_err(|e| format!("failed to read {}: {e}", path.display()))?;
    serde_json::from_str(&text)
        .map(Some)
        .map_err(|e| format!("{} is not a valid sync.json: {e}", path.display()))
}

fn save_config(config: &SyncConfigFile) -> Result<(), String> {
    let path = sync_config_path();
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| format!("failed to create {}: {e}", parent.display()))?;
    }
    let text = serde_json::to_string_pretty(config)
        .map_err(|e| format!("failed to serialize config: {e}"))?;
    let tmp = path.with_extension("json.tmp");
    std::fs::write(&tmp, text).map_err(|e| format!("failed to write {}: {e}", tmp.display()))?;
    std::fs::rename(&tmp, &path).map_err(|e| format!("failed to rename {}: {e}", path.display()))
}

/// Snapshot ids are `YYYYMMDDTHHMMZ-<4 hex>`; QML passes them back over the
/// boundary. Reject anything that is not a flat, single path component.
fn valid_snapshot_id(id: &str) -> bool {
    !id.is_empty() && id.len() <= 64 && id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-')
}

/// Resolve the configured target folder, if any.
fn configured_target() -> Option<PathBuf> {
    match load_config() {
        Ok(Some(config)) => config
            .target_path
            .map(|t| t.trim().to_string())
            .filter(|t| !t.is_empty())
            .map(PathBuf::from),
        _ => None,
    }
}

/// Map engine errors to UI-facing strings. `DirtyTarget` gets a file-list
/// summary because the UI shows it verbatim in the restore modal.
fn sync_error_message(error: &SyncError) -> String {
    match error {
        SyncError::DirtyTarget { count, files } => {
            const SHOW: usize = 5;
            let shown: Vec<&str> = files.iter().take(SHOW).map(String::as_str).collect();
            let extra = files.len().saturating_sub(shown.len());
            let mut message = format!(
                "refusing to overwrite {count} modified file(s): {}",
                shown.join(", ")
            );
            if extra > 0 {
                message.push_str(&format!(", and {extra} more"));
            }
            message
        }
        other => other.to_string(),
    }
}

fn snapshots_value(report: &airi_sync::ListReport) -> Vec<serde_json::Value> {
    report
        .snapshots
        .iter()
        .map(|summary| {
            json!({
                "id": summary.id,
                "createdMs": summary.created_unix_ms,
                "label": summary.label,
                "totalBytes": summary.total_bytes,
                "files": summary.file_count,
            })
        })
        .collect()
}

/// cxx-qt bridge definitions for the local-FS sync bridge.
#[cxx_qt::bridge]
pub mod qobject {
    unsafe extern "C++" {
        include!("cxx-qt-lib/qstring.h");
        /// QString from cxx-qt-lib.
        type QString = cxx_qt_lib::QString;
    }

    extern "RustQt" {
        /// Sync view-model. Create one per page.
        #[qobject]
        #[qml_element]
        #[namespace = "airi_qt"]
        #[qproperty(QString, snapshots_json, cxx_name = "snapshotsJson")]
        #[qproperty(QString, target_path, cxx_name = "targetPath")]
        #[qproperty(QString, snapshots_dir, cxx_name = "snapshotsDir")]
        #[qproperty(QString, last_error, cxx_name = "lastError")]
        #[qproperty(bool, working)]
        type SyncController = super::SyncControllerRust;
    }

    extern "RustQt" {
        /// Emitted after the snapshot list may have changed (create/probe/
        /// prune/target change).
        #[qsignal]
        #[cxx_name = "snapshotsChanged"]
        fn snapshots_changed(self: Pin<&mut SyncController>);

        /// Re-read the target folder into `snapshotsJson`. A missing target
        /// folder yields an empty list; a missing `sync.json` is not an
        /// error.
        #[qinvokable]
        #[cxx_name = "refreshSnapshots"]
        fn refresh_snapshots(self: Pin<&mut SyncController>);

        /// Persist `path` as the target folder and refresh. Returns `true`
        /// on success. NOTE: named `saveTargetPath` (not the spec's
        /// `setTargetPath`) because cxx-qt always generates a property
        /// setter `setTargetPath` for the `targetPath` property — a same-
        /// signature invokable cannot coexist with it.
        #[qinvokable]
        #[cxx_name = "saveTargetPath"]
        fn save_target_path(self: Pin<&mut SyncController>, path: QString) -> bool;

        /// Create a tiny `airi-probe` snapshot of a temp folder in the
        /// target, verify it, and keep it. Returns
        /// `{"ok":true,"probeId":"...","filesChecked":N,"bytesChecked":N}` |
        /// `{"ok":false,"error":"...","probeId":"..."?}` | `{"error":"..."}`.
        #[qinvokable]
        #[cxx_name = "probeTarget"]
        fn probe_target(self: Pin<&mut SyncController>) -> QString;

        /// Snapshot the Qt data directory into the target. `label` of `""`
        /// means no label. Returns `true` on success.
        #[qinvokable]
        #[cxx_name = "createSnapshot"]
        fn create_snapshot(self: Pin<&mut SyncController>, label: QString) -> bool;

        /// Re-hash every file in `<target>/<snapshotId>.snap` against its
        /// manifest. Returns `{"ok":true,"filesChecked":N,"bytesChecked":N}` |
        /// `{"ok":false,"missing":[...],"mismatched":[...]}` |
        /// `{"ok":false,...,"error":"..."}`.
        #[qinvokable]
        #[cxx_name = "verifySnapshot"]
        fn verify_snapshot(self: Pin<&mut SyncController>, snapshot_id: QString) -> QString;

        /// Dry-run restore of `<snapshotId>` against the Qt data directory.
        /// Never writes. Returns
        /// `{"create":[...],"overwrite":[...],"unchanged":[...],"keep":[...]}` |
        /// `{"error":"..."}`.
        #[qinvokable]
        #[cxx_name = "dryRunRestore"]
        fn dry_run_restore(self: Pin<&mut SyncController>, snapshot_id: QString) -> QString;

        /// Restore `<snapshotId>` into the Qt data directory. With
        /// `allow_dirty == false` the engine refuses to overwrite files that
        /// were modified since the snapshot (`DirtyTarget`); with
        /// `allow_dirty == true` it overwrites anyway (destructive — the UI
        /// only reaches this behind an explicit confirm). Returns `true` on
        /// success; on failure `lastError` carries the reason (for
        /// `DirtyTarget`, a file-list summary).
        #[qinvokable]
        #[cxx_name = "restoreSnapshot"]
        fn restore_snapshot(
            self: Pin<&mut SyncController>,
            snapshot_id: QString,
            allow_dirty: bool,
        ) -> bool;

        /// Prune snapshots in the target, keeping the `keep_last` newest.
        /// `keep_last < 1` is rejected. Returns `true` on success.
        #[qinvokable]
        #[cxx_name = "pruneSnapshots"]
        fn prune_snapshots(self: Pin<&mut SyncController>, keep_last: i64) -> bool;
    }
}

/// Rust storage for `SyncController`.
pub struct SyncControllerRust {
    snapshots_json: QString,
    target_path: QString,
    snapshots_dir: QString,
    last_error: QString,
    working: bool,
}

impl Default for SyncControllerRust {
    fn default() -> Self {
        Self {
            snapshots_json: QString::from("[]"),
            target_path: QString::from(""),
            snapshots_dir: QString::from(""),
            last_error: QString::from(""),
            working: false,
        }
    }
}

impl qobject::SyncController {
    fn set_error(mut self: std::pin::Pin<&mut Self>, message: String) {
        let s = QString::from(message.as_str());
        self.as_mut().rust_mut().last_error = s.clone();
        self.as_mut().set_last_error(s);
    }

    fn clear_error(mut self: std::pin::Pin<&mut Self>) {
        let s = QString::from("");
        self.as_mut().rust_mut().last_error = s.clone();
        self.as_mut().set_last_error(s);
    }

    fn set_working_flag(mut self: std::pin::Pin<&mut Self>, working: bool) {
        self.as_mut().rust_mut().working = working;
        self.as_mut().set_working(working);
    }

    fn snapshot_dir(target: &Path, id: &str) -> PathBuf {
        target.join(format!("{id}.snap"))
    }

    fn reload(mut self: std::pin::Pin<&mut Self>) {
        let (target_text, load_error) = match load_config() {
            Ok(Some(config)) => (
                config.target_path.unwrap_or_default().trim().to_string(),
                None,
            ),
            Ok(None) => (String::new(), None),
            Err(e) => (String::new(), Some(e)),
        };
        let target = if target_text.is_empty() {
            None
        } else {
            Some(PathBuf::from(target_text.as_str()))
        };
        let (snapshots, warning) = match &target {
            None => (Vec::new(), None),
            Some(dir) => match airi_sync::list_snapshots(dir) {
                Ok(report) => {
                    let warning = (report.skipped_corrupt > 0).then(|| {
                        format!(
                            "{} unreadable snapshot(s) skipped in {}",
                            report.skipped_corrupt,
                            dir.display()
                        )
                    });
                    (snapshots_value(&report), warning)
                }
                Err(e) => (Vec::new(), Some(sync_error_message(&e))),
            },
        };
        let snapshots_text = serde_json::to_string(&snapshots).unwrap_or_else(|_| "[]".into());
        let snapshots_qs = QString::from(snapshots_text.as_str());
        let target_qs = QString::from(target_text.as_str());
        let dir_qs = QString::from(
            target
                .as_ref()
                .map(|d| d.display().to_string())
                .unwrap_or_default()
                .as_str(),
        );
        {
            let mut rust_mut = self.as_mut().rust_mut();
            rust_mut.snapshots_json = snapshots_qs.clone();
            rust_mut.target_path = target_qs.clone();
            rust_mut.snapshots_dir = dir_qs.clone();
        }
        self.as_mut().set_snapshots_json(snapshots_qs);
        self.as_mut().set_target_path(target_qs);
        self.as_mut().set_snapshots_dir(dir_qs);
        if let Some(e) = load_error {
            self.as_mut().set_error(e);
        } else if let Some(w) = warning {
            self.as_mut().set_error(w);
        } else {
            self.as_mut().clear_error();
        }
    }

    /// Re-read the target folder into `snapshotsJson`.
    pub fn refresh_snapshots(self: Pin<&mut Self>) {
        self.reload();
    }

    /// Persist the target folder and refresh.
    pub fn save_target_path(mut self: Pin<&mut Self>, path: QString) -> bool {
        self.as_mut().clear_error();
        let trimmed = qstring_to_string(&path).trim().to_string();
        if trimmed.is_empty() {
            self.as_mut()
                .set_error("target path must not be empty".into());
            return false;
        }
        match save_config(&SyncConfigFile {
            target_path: Some(trimmed),
        }) {
            Ok(()) => {
                self.as_mut().reload();
                qobject::SyncController::snapshots_changed(self.as_mut());
                true
            }
            Err(e) => {
                self.as_mut().set_error(e);
                false
            }
        }
    }

    /// Probe the target with a tiny `airi-probe` snapshot, then verify it.
    /// The probe snapshot is kept on purpose (it shows in the list).
    pub fn probe_target(mut self: Pin<&mut Self>) -> QString {
        self.as_mut().clear_error();
        let Some(target) = configured_target() else {
            return json_ok(
                json!({ "error": "no sync target set — choose a target folder first" }),
            );
        };
        if !target.is_dir() {
            return json_ok(json!({
                "error": format!(
                    "target folder does not exist or is not a directory: {} — create it first",
                    target.display()
                )
            }));
        }
        self.as_mut().set_working_flag(true);

        let unique = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_millis())
            .unwrap_or(0);
        let probe_dir =
            std::env::temp_dir().join(format!("airi-sync-probe-{}-{unique}", std::process::id()));
        let probe_result = std::fs::create_dir_all(&probe_dir)
            .and_then(|()| std::fs::write(probe_dir.join("probe.txt"), "airi-sync probe\n"));
        if let Err(e) = probe_result {
            let _ = std::fs::remove_dir_all(&probe_dir);
            self.as_mut().set_working_flag(false);
            return json_ok(json!({
                "error": format!("failed to prepare probe folder {}: {e}", probe_dir.display())
            }));
        }

        let outcome = match airi_sync::create_snapshot(&probe_dir, &target, Some("airi-probe")) {
            Ok(manifest) => {
                let snap_dir = Self::snapshot_dir(&target, &manifest.id);
                match airi_sync::verify_snapshot(&snap_dir) {
                    Ok(VerifyReport::Ok {
                        files_checked,
                        bytes_checked,
                    }) => json!({
                        "ok": true,
                        "probeId": manifest.id,
                        "filesChecked": files_checked,
                        "bytesChecked": bytes_checked,
                    }),
                    Ok(VerifyReport::Corrupt {
                        missing,
                        mismatched,
                    }) => json!({
                        "ok": false,
                        "probeId": manifest.id,
                        "error": format!(
                            "probe snapshot failed verification: {} missing, {} mismatched",
                            missing.len(),
                            mismatched.len()
                        ),
                    }),
                    Err(e) => json!({
                        "ok": false,
                        "probeId": manifest.id,
                        "error": sync_error_message(&e),
                    }),
                }
            }
            Err(e) => json!({ "error": sync_error_message(&e) }),
        };
        let _ = std::fs::remove_dir_all(&probe_dir);

        let created = outcome.get("probeId").is_some();
        self.as_mut().reload();
        if created {
            qobject::SyncController::snapshots_changed(self.as_mut());
        }
        self.as_mut().set_working_flag(false);
        json_ok(outcome)
    }

    /// Snapshot the Qt data directory into the target.
    pub fn create_snapshot(mut self: Pin<&mut Self>, label: QString) -> bool {
        self.as_mut().clear_error();
        let Some(target) = configured_target() else {
            self.as_mut()
                .set_error("no sync target set — choose a target folder first".into());
            return false;
        };
        let Some(source) = qt_data_dir() else {
            self.as_mut()
                .set_error("could not resolve the Qt data directory".into());
            return false;
        };
        let label = qstring_to_string(&label).trim().to_string();
        let label = if label.is_empty() { None } else { Some(label) };
        self.as_mut().set_working_flag(true);
        match airi_sync::create_snapshot(&source, &target, label.as_deref()) {
            Ok(_manifest) => {
                self.as_mut().reload();
                self.as_mut().set_working_flag(false);
                qobject::SyncController::snapshots_changed(self.as_mut());
                true
            }
            Err(e) => {
                self.as_mut().set_error(sync_error_message(&e));
                self.as_mut().set_working_flag(false);
                false
            }
        }
    }

    /// Re-hash a snapshot against its manifest.
    pub fn verify_snapshot(mut self: Pin<&mut Self>, snapshot_id: QString) -> QString {
        self.as_mut().clear_error();
        let id = qstring_to_string(&snapshot_id);
        if !valid_snapshot_id(&id) {
            return json_ok(
                json!({ "ok": false, "missing": [], "mismatched": [], "error": "invalid snapshot id" }),
            );
        }
        let Some(target) = configured_target() else {
            return json_ok(json!({
                "ok": false,
                "missing": [],
                "mismatched": [],
                "error": "no sync target set",
            }));
        };
        self.as_mut().set_working_flag(true);
        let snap_dir = Self::snapshot_dir(&target, &id);
        let report = match airi_sync::verify_snapshot(&snap_dir) {
            Ok(VerifyReport::Ok {
                files_checked,
                bytes_checked,
            }) => {
                json!({ "ok": true, "filesChecked": files_checked, "bytesChecked": bytes_checked })
            }
            Ok(VerifyReport::Corrupt {
                missing,
                mismatched,
            }) => {
                json!({ "ok": false, "missing": missing, "mismatched": mismatched })
            }
            Err(e) => json!({
                "ok": false,
                "missing": [],
                "mismatched": [],
                "error": sync_error_message(&e),
            }),
        };
        self.as_mut().set_working_flag(false);
        json_ok(report)
    }

    /// Dry-run restore plan against the Qt data directory. Never writes.
    pub fn dry_run_restore(mut self: Pin<&mut Self>, snapshot_id: QString) -> QString {
        self.as_mut().clear_error();
        let id = qstring_to_string(&snapshot_id);
        if !valid_snapshot_id(&id) {
            return json_ok(json!({ "error": "invalid snapshot id" }));
        }
        let Some(target) = configured_target() else {
            return json_ok(json!({ "error": "no sync target set" }));
        };
        let Some(data_dir) = qt_data_dir() else {
            return json_ok(json!({ "error": "could not resolve the Qt data directory" }));
        };
        self.as_mut().set_working_flag(true);
        let snap_dir = Self::snapshot_dir(&target, &id);
        let plan = match airi_sync::restore_snapshot(&snap_dir, &data_dir, RestoreMode::DryRun) {
            Ok(report) => json!({
                "create": report.plan.create,
                "overwrite": report.plan.overwrite,
                "unchanged": report.plan.unchanged,
                "keep": report.plan.keep,
            }),
            Err(e) => json!({ "error": sync_error_message(&e) }),
        };
        self.as_mut().set_working_flag(false);
        json_ok(plan)
    }

    /// Restore a snapshot into the Qt data directory. With `allow_dirty ==
    /// false` the engine's `require_clean` guard refuses modified files
    /// (`DirtyTarget`); with `true` it overwrites anyway.
    pub fn restore_snapshot(
        mut self: Pin<&mut Self>,
        snapshot_id: QString,
        allow_dirty: bool,
    ) -> bool {
        self.as_mut().clear_error();
        let id = qstring_to_string(&snapshot_id);
        if !valid_snapshot_id(&id) {
            self.as_mut().set_error("invalid snapshot id".into());
            return false;
        }
        let Some(target) = configured_target() else {
            self.as_mut().set_error("no sync target set".into());
            return false;
        };
        let Some(data_dir) = qt_data_dir() else {
            self.as_mut()
                .set_error("could not resolve the Qt data directory".into());
            return false;
        };
        self.as_mut().set_working_flag(true);
        let snap_dir = Self::snapshot_dir(&target, &id);
        let outcome = airi_sync::restore_snapshot(
            &snap_dir,
            &data_dir,
            RestoreMode::Overwrite {
                require_clean: !allow_dirty,
            },
        );
        self.as_mut().set_working_flag(false);
        match outcome {
            Ok(_report) => {
                qobject::SyncController::snapshots_changed(self.as_mut());
                true
            }
            Err(e) => {
                self.as_mut().set_error(sync_error_message(&e));
                false
            }
        }
    }

    /// Prune old snapshots in the target, keeping the newest `keep_last`.
    pub fn prune_snapshots(mut self: Pin<&mut Self>, keep_last: i64) -> bool {
        self.as_mut().clear_error();
        if keep_last < 1 {
            self.as_mut()
                .set_error("prune requires keepLast >= 1; refusing to prune everything".into());
            return false;
        }
        let Some(target) = configured_target() else {
            self.as_mut().set_error("no sync target set".into());
            return false;
        };
        self.as_mut().set_working_flag(true);
        let prune_result = airi_sync::prune_snapshots(&target, keep_last as usize);
        match prune_result {
            Ok(_report) => {
                self.as_mut().set_working_flag(false);
                self.as_mut().reload();
                qobject::SyncController::snapshots_changed(self.as_mut());
                true
            }
            Err(e) => {
                self.as_mut().set_working_flag(false);
                self.as_mut().set_error(sync_error_message(&e));
                false
            }
        }
    }
}

fn json_ok(value: serde_json::Value) -> QString {
    QString::from(value.to_string().as_str())
}
