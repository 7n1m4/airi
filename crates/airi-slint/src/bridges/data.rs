// SPDX-License-Identifier: GPL-3.0-or-later
//! Data vault bridge (`DataController`) exposed to Slint.
//!
//! Drives the settings/data pages: vault statistics, export of a
//! user-selected domain set to a stored-ZIP archive, inspection and restore of
//! vault archives (chats + memory only — existing rows win), the chat-history
//! media scrub, and the scrub-run log.
//!
//! Boundary contract: everything crossing into the UI is a one-shot JSON
//! document string (`{"path": …, "bytes": …}` / `{"error": …}` / a report
//! object/array). JSON is used at this boundary for the same reasons as in the
//! providers and cards bridges: these are consumed wholesale by the pages, and
//! the payload shapes (nested arrays, optional fields) do not survive a flat
//! record list.
//!
//! Everything the bridge exposes is honest about scope:
//! - destructive resets (delete all data / reset providers / …) are *not*
//!   wired and never will be silently; they go through a dedicated
//!   destructive-action bridge in wave ④, gated on explicit user intent;
//! - Cloud Sync is untouched (sync-engine bridge, separate phase);
//! - orphan detection is impossible today — sessions carry no card linkage
//!   (`sessions.metadata` is `{}` by default), so the unlinked-data UI stays
//!   an empty state rather than a lie.

use std::sync::Mutex;

use airi_core::vault::{self, VaultSelection};
use serde_json::json;

use crate::bridges;
use crate::bridges::chat;

fn backgrounds_dir() -> Option<std::path::PathBuf> {
    dirs::data_dir().map(|base| base.join("airi-slint").join("backgrounds"))
}

fn exports_dir() -> Option<std::path::PathBuf> {
    bridges::profile_dir()
        .map(|p| p.join("exports"))
        .or_else(|| dirs::data_dir().map(|base| base.join("airi-slint").join("exports")))
}

fn json_ok(value: serde_json::Value) -> String {
    value.to_string()
}

fn json_err(message: impl std::fmt::Display) -> String {
    json_ok(json!({ "error": message.to_string() }))
}

/// Data-vault view-model state. One process-wide instance.
pub struct DataControllerState {
    /// Vault statistics as a JSON document; `{}` until the first scan.
    pub stats_json: String,
    /// Last error message, empty when none.
    pub last_error: String,
    /// True while a long operation runs.
    pub working: bool,
}

impl Default for DataControllerState {
    fn default() -> Self {
        Self {
            stats_json: "{}".to_string(),
            last_error: String::new(),
            working: false,
        }
    }
}

/// Process-wide controller guarded by a mutex.
static STATE: Mutex<DataControllerState> = Mutex::new(DataControllerState {
    stats_json: String::new(),
    last_error: String::new(),
    working: false,
});

/// Lock the process-wide controller for a UI-thread operation.
pub fn with_state<R>(f: impl FnOnce(&mut DataControllerState) -> R) -> R {
    match STATE.lock() {
        Ok(mut guard) => f(&mut guard),
        Err(poisoned) => f(&mut poisoned.into_inner()),
    }
}

fn selection_from_json(value: &serde_json::Value) -> Vec<String> {
    let mut ids = Vec::new();
    for id in ["characters", "chats", "memory", "providers", "backgrounds"] {
        if value.get(id).and_then(|v| v.as_bool()).unwrap_or(false) {
            ids.push(id.to_string());
        }
    }
    ids
}

impl DataControllerState {
    fn clear_error(&mut self) {
        self.last_error = String::new();
    }

    fn sync_stats(&mut self) {
        let db = bridges::database().cloned();
        let stats = db.and_then(|db| {
            vault::stats(&db, &chat::card_dirs())
                .map(|s| {
                    json!({
                        "domains": s.domains.iter().map(|d| json!({
                            "id": d.id,
                            "count": d.count,
                            "bytes": d.bytes,
                        })).collect::<Vec<_>>(),
                        "totalBytes": s.total_bytes,
                        "totalCount": s.total_count,
                    })
                })
                .ok()
        });
        let serialized = stats.map(|s| s.to_string()).unwrap_or_else(|| "{}".into());
        self.stats_json = serialized;
    }

    /// Re-scan the vault statistics.
    pub fn refresh_stats(&mut self) {
        self.clear_error();
        self.sync_stats();
    }

    /// Export selected domains to a ZIP archive.
    pub fn export_vault(&mut self, selection_json: &str, dest_path: &str) -> String {
        self.clear_error();

        let parsed: serde_json::Value = match serde_json::from_str(selection_json) {
            Ok(v) => v,
            Err(e) => return json_err(format!("selection payload is not valid JSON: {e}")),
        };
        let ids = selection_from_json(&parsed);
        if ids.is_empty() {
            return json_err("select at least one domain to export");
        }
        let id_refs: Vec<&str> = ids.iter().map(String::as_str).collect();
        let selection = VaultSelection::parse(&id_refs);

        let Some(db) = bridges::database().cloned() else {
            return json_err("database is not available (profile not registered)");
        };
        let archive = match vault::collect_archive(&db, &chat::card_dirs(), selection) {
            Ok(a) => a,
            Err(e) => return json_err(format!("failed to build the archive: {e}")),
        };

        let dest = if dest_path.is_empty() {
            let Some(dir) = exports_dir() else {
                return json_err("could not resolve an export directory");
            };
            if let Err(e) = std::fs::create_dir_all(&dir) {
                return json_err(format!("failed to create {}: {e}", dir.display()));
            }
            dir.join(format!(
                "airi-vault-{}.zip",
                std::time::SystemTime::now()
                    .duration_since(std::time::UNIX_EPOCH)
                    .map(|d| d.as_millis())
                    .unwrap_or(0)
            ))
        } else {
            std::path::PathBuf::from(dest_path)
        };

        if let Err(e) = std::fs::write(&dest, &archive) {
            return json_err(format!("failed to write {}: {e}", dest.display()));
        }

        let bytes = archive.len();
        let dest_s = dest.to_string_lossy().into_owned();
        let result = json!({
            "path": dest_s,
            "bytes": bytes,
            "domains": ids,
        });
        self.sync_stats();
        json_ok(result)
    }

    /// Inspect a vault archive.
    pub fn inspect_vault(&self, path: &str) -> String {
        let bytes = match std::fs::read(path) {
            Ok(b) => b,
            Err(e) => return json_err(format!("failed to read {path}: {e}")),
        };
        match vault::inspect_archive(&bytes) {
            Ok(report) => json_ok(serde_json::to_value(report).unwrap_or_else(|_| json!({}))),
            Err(e) => json_err(format!("inspection failed: {e}")),
        }
    }

    /// Apply a vault archive (chats + memory only).
    pub fn commit_vault_import(&mut self, path: &str) -> String {
        self.clear_error();
        let bytes = match std::fs::read(path) {
            Ok(b) => b,
            Err(e) => return json_err(format!("failed to read {path}: {e}")),
        };
        let Some(db) = bridges::database().cloned() else {
            return json_err("database is not available (profile not registered)");
        };
        match vault::commit_archive(&db, &bytes) {
            Ok(report) => {
                self.sync_stats();
                json_ok(serde_json::to_value(report).unwrap_or_else(|_| json!({})))
            }
            Err(e) => json_err(format!("import failed: {e}")),
        }
    }

    /// Scrub inline base64 images out of the chat history.
    pub fn scrub_run(&mut self, create_backup: bool) -> String {
        self.clear_error();
        let Some(db) = bridges::database().cloned() else {
            return json_err("database is not available (profile not registered)");
        };
        let Some(backgrounds) = backgrounds_dir() else {
            return json_err("could not resolve the backgrounds directory");
        };
        match vault::scrub_session_media(&db, &backgrounds, &chat::card_dirs(), create_backup) {
            Ok(report) => {
                self.sync_stats();
                json_ok(serde_json::to_value(report).unwrap_or_else(|_| json!({})))
            }
            Err(e) => json_err(format!("scrub failed: {e}")),
        }
    }

    /// List recent scrub runs (newest first).
    pub fn list_scrub_runs(&self) -> String {
        let Some(db) = bridges::database().cloned() else {
            return "[]".to_string();
        };
        match airi_store::ScrubRunRepo::new(db).list_recent(20) {
            Ok(runs) => json_ok(json!(runs
                .into_iter()
                .map(|r| json!({
                    "id": r.id,
                    "startedAt": r.started_at,
                    "sessionsScanned": r.sessions_scanned,
                    "imagesExtracted": r.images_extracted,
                    "bytesExtracted": r.bytes_extracted,
                    "backupPath": r.backup_path,
                }))
                .collect::<Vec<_>>())),
            Err(_) => "[]".to_string(),
        }
    }
}