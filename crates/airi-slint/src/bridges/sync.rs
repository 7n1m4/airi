// SPDX-License-Identifier: GPL-3.0-or-later
//! Local-FS sync bridge (`SyncState`) exposed to Slint.
//!
//! Drives the cloud-sync settings page against the `airi-sync` snapshot
//! engine: point-in-time snapshots of the app's data directory onto a
//! **local filesystem target** (a folder, an external drive, an NFS/SMB/NAS
//! mount). S3 is not implemented — there is no network code anywhere in this
//! path.
//!
//! Honesty contract:
//!
//! * The configured target is read from disk (`<profile>/airi/sync.json`, or
//!   the platform data dir when `--profile` is not set — same convention as
//!   the MCP bridge's mcp.json) or is empty. Nothing is fabricated.
//! * `airi-probe` snapshots created by [`SyncState::probe_target`] are
//!   **kept** on success — a probe that leaves the target list honest is
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

use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use airi_sync::{RestoreMode, SyncError, VerifyReport};
use serde_json::json;

use crate::bridges;

/// `<profile>/airi/sync.json` or `<platform-data>/airi-slint/sync.json`.
fn sync_config_path() -> PathBuf {
    bridges::profile_dir()
        .map(|p| p.join("airi").join("sync.json"))
        .or_else(|| dirs::data_dir().map(|base| base.join("airi-slint").join("sync.json")))
        .unwrap_or_else(|| PathBuf::from("sync.json"))
}

/// The app's data directory — the snapshot *source*.
///
/// Same resolution chain the MCP bridge uses for its config file, minus the
/// `airi/` leaf, because the SQLite vault (`airi.sqlite*`) lives directly in
/// the data dir: `<profile>` when `--profile` is set, else
/// `<platform-data>/airi-slint`.
fn data_dir() -> Option<PathBuf> {
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

/// Snapshot ids are `YYYYMMDDTHHMMZ-<4 hex>`; the UI passes them back over the
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

fn json_ok(value: serde_json::Value) -> String {
    value.to_string()
}

/// Sync view-model (one process-wide instance).
pub struct SyncState {
    /// JSON array of snapshot summaries, newest first.
    pub snapshots_json: String,
    /// Configured target folder (empty when unset).
    pub target_path: String,
    /// Resolved target directory (empty when unset).
    pub snapshots_dir: String,
    /// Last error line, empty when none.
    pub last_error: String,
    /// `true` while an engine call is in flight.
    pub working: bool,
}

impl Default for SyncState {
    fn default() -> Self {
        Self {
            snapshots_json: "[]".to_string(),
            target_path: String::new(),
            snapshots_dir: String::new(),
            last_error: String::new(),
            working: false,
        }
    }
}

/// Process-wide state guarded by a mutex (a poisoned lock is recovered so a
/// panicking engine call must not wedge the UI).
static STATE: Mutex<Option<SyncState>> = Mutex::new(None);

/// Lock the process-wide sync state for a UI-thread operation, creating it on
/// first use.
pub fn with_state<R>(f: impl FnOnce(&mut SyncState) -> R) -> R {
    let mut guard = STATE.lock().unwrap_or_else(|e| e.into_inner());
    let state = guard.get_or_insert_with(SyncState::default);
    f(state)
}

impl SyncState {
    fn set_error(&mut self, message: String) {
        self.last_error = message;
    }

    fn clear_error(&mut self) {
        self.last_error = String::new();
    }

    fn set_working_flag(&mut self, working: bool) {
        self.working = working;
    }

    fn snapshot_dir(target: &Path, id: &str) -> PathBuf {
        target.join(format!("{id}.snap"))
    }

    /// Re-read the config file and the target's snapshot list into the fields.
    fn reload(&mut self) {
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
        self.snapshots_json = serde_json::to_string(&snapshots).unwrap_or_else(|_| "[]".into());
        self.target_path = target_text;
        self.snapshots_dir = target
            .as_ref()
            .map(|d| d.display().to_string())
            .unwrap_or_default();
        if let Some(e) = load_error {
            self.set_error(e);
        } else if let Some(w) = warning {
            self.set_error(w);
        } else {
            self.clear_error();
        }
    }

    /// Re-read the target folder into `snapshots_json`.
    pub fn refresh_snapshots(&mut self) {
        self.reload();
    }

    /// Persist the target folder and refresh.
    pub fn save_target_path(&mut self, path: &str) -> bool {
        self.clear_error();
        let trimmed = path.trim().to_string();
        if trimmed.is_empty() {
            self.set_error("target path must not be empty".into());
            return false;
        }
        match save_config(&SyncConfigFile {
            target_path: Some(trimmed),
        }) {
            Ok(()) => {
                self.reload();
                true
            }
            Err(e) => {
                self.set_error(e);
                false
            }
        }
    }

    /// Probe the target with a tiny `airi-probe` snapshot, then verify it.
    /// The probe snapshot is kept on purpose (it shows in the list).
    pub fn probe_target(&mut self) -> String {
        self.clear_error();
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
        self.set_working_flag(true);

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
            self.set_working_flag(false);
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

        self.reload();
        json_ok(outcome)
    }

    /// Snapshot the app data directory into the target.
    pub fn create_snapshot(&mut self, label: &str) -> bool {
        self.clear_error();
        let Some(target) = configured_target() else {
            self.set_error("no sync target set — choose a target folder first".into());
            return false;
        };
        let Some(source) = data_dir() else {
            self.set_error("could not resolve the data directory".into());
            return false;
        };
        let label = label.trim().to_string();
        let label = if label.is_empty() { None } else { Some(label) };
        self.set_working_flag(true);
        match airi_sync::create_snapshot(&source, &target, label.as_deref()) {
            Ok(_manifest) => {
                self.reload();
                self.set_working_flag(false);
                true
            }
            Err(e) => {
                self.set_error(sync_error_message(&e));
                self.set_working_flag(false);
                false
            }
        }
    }

    /// Re-hash a snapshot against its manifest.
    pub fn verify_snapshot(&mut self, snapshot_id: &str) -> String {
        self.clear_error();
        let id = snapshot_id;
        if !valid_snapshot_id(id) {
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
        self.set_working_flag(true);
        let snap_dir = Self::snapshot_dir(&target, id);
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
        self.set_working_flag(false);
        json_ok(report)
    }

    /// Dry-run restore plan against the app data directory. Never writes.
    pub fn dry_run_restore(&mut self, snapshot_id: &str) -> String {
        self.clear_error();
        let id = snapshot_id;
        if !valid_snapshot_id(id) {
            return json_ok(json!({ "error": "invalid snapshot id" }));
        }
        let Some(target) = configured_target() else {
            return json_ok(json!({ "error": "no sync target set" }));
        };
        let Some(data_dir) = data_dir() else {
            return json_ok(json!({ "error": "could not resolve the data directory" }));
        };
        self.set_working_flag(true);
        let snap_dir = Self::snapshot_dir(&target, id);
        let plan = match airi_sync::restore_snapshot(&snap_dir, &data_dir, RestoreMode::DryRun) {
            Ok(report) => json!({
                "create": report.plan.create,
                "overwrite": report.plan.overwrite,
                "unchanged": report.plan.unchanged,
                "keep": report.plan.keep,
            }),
            Err(e) => json!({ "error": sync_error_message(&e) }),
        };
        self.set_working_flag(false);
        json_ok(plan)
    }

    /// Restore a snapshot into the app data directory. With `allow_dirty ==
    /// false` the engine's `require_clean` guard refuses modified files
    /// (`DirtyTarget`); with `true` it overwrites anyway.
    pub fn restore_snapshot(&mut self, snapshot_id: &str, allow_dirty: bool) -> bool {
        self.clear_error();
        let id = snapshot_id;
        if !valid_snapshot_id(id) {
            self.set_error("invalid snapshot id".into());
            return false;
        }
        let Some(target) = configured_target() else {
            self.set_error("no sync target set".into());
            return false;
        };
        let Some(data_dir) = data_dir() else {
            self.set_error("could not resolve the data directory".into());
            return false;
        };
        self.set_working_flag(true);
        let snap_dir = Self::snapshot_dir(&target, id);
        let outcome = airi_sync::restore_snapshot(
            &snap_dir,
            &data_dir,
            RestoreMode::Overwrite {
                require_clean: !allow_dirty,
            },
        );
        self.set_working_flag(false);
        match outcome {
            Ok(_report) => true,
            Err(e) => {
                self.set_error(sync_error_message(&e));
                false
            }
        }
    }

    /// Prune old snapshots in the target, keeping the newest `keep_last`.
    pub fn prune_snapshots(&mut self, keep_last: i64) -> bool {
        self.clear_error();
        if keep_last < 1 {
            self.set_error("prune requires keepLast >= 1; refusing to prune everything".into());
            return false;
        }
        let Some(target) = configured_target() else {
            self.set_error("no sync target set".into());
            return false;
        };
        self.set_working_flag(true);
        let prune_result = airi_sync::prune_snapshots(&target, keep_last as usize);
        match prune_result {
            Ok(_report) => {
                self.set_working_flag(false);
                self.reload();
                true
            }
            Err(e) => {
                self.set_working_flag(false);
                self.set_error(sync_error_message(&e));
                false
            }
        }
    }
}
