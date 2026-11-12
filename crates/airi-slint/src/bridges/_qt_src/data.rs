// SPDX-License-Identifier: GPL-3.0-or-later
//! Data vault bridge (`DataController`) exposed to QML.
//!
//! Drives the `qml/pages/settings/data/` pages: vault statistics, export of a
//! user-selected domain set to a stored-ZIP archive, inspection and restore of
//! vault archives (chats + memory only — existing rows win), the chat-history
//! media scrub, and the scrub-run log.
//!
//! Boundary contract: everything crossing into QML is a one-shot JSON document
//! string (`{"path": …, "bytes": …}` / `{"error": …}` / a report object/array).
//! JSON is used at this boundary for the same reasons as in the providers and
//! cards bridges: cxx-qt 0.10 cannot express a Rust-subclassed
//! `QAbstractListModel`, and these are consumed wholesale by the pages.
//!
//! Everything the bridge exposes is honest about scope:
//! - destructive resets (delete all data / reset providers / …) are *not*
//!   wired and never will be silently; they go through a dedicated
//!   destructive-action bridge in wave ④, gated on explicit user intent;
//! - Cloud Sync is untouched (sync-engine bridge, separate phase);
//! - orphan detection is impossible today — Qt sessions carry no card linkage
//!   (`sessions.metadata` is `{}` by default), so the unlinked-data UI stays
//!   an empty state rather than a lie.

use cxx_qt::CxxQtType;
use cxx_qt_lib::QString;
use std::pin::Pin;

use airi_core::vault::{self, VaultSelection};
use serde_json::json;

use crate::bridges;
use crate::bridges::chat;
use crate::bridges::qstring_to_string;

fn backgrounds_dir() -> Option<std::path::PathBuf> {
    dirs::data_dir().map(|base| base.join("airi-slint").join("backgrounds"))
}

fn exports_dir() -> Option<std::path::PathBuf> {
    bridges::profile_dir()
        .map(|p| p.join("exports"))
        .or_else(|| dirs::data_dir().map(|base| base.join("airi-slint").join("exports")))
}

fn json_ok(value: serde_json::Value) -> QString {
    QString::from(value.to_string().as_str())
}

fn json_err(message: impl std::fmt::Display) -> QString {
    json_ok(json!({ "error": message.to_string() }))
}

/// cxx-qt bridge definitions for the data-vault bridge.
#[cxx_qt::bridge]
pub mod qobject {
    unsafe extern "C++" {
        include!("cxx-qt-lib/qstring.h");
        /// QString from cxx-qt-lib.
        type QString = cxx_qt_lib::QString;
    }

    extern "RustQt" {
        /// Data-vault view-model. Create one per page.
        #[qobject]
        #[qml_element]
        #[namespace = "airi_qt"]
        #[qproperty(QString, stats_json, cxx_name = "statsJson")]
        #[qproperty(QString, last_error, cxx_name = "lastError")]
        #[qproperty(bool, working)]
        type DataController = super::DataControllerRust;
    }

    extern "RustQt" {
        /// Emitted after a full stats rescan.
        #[qsignal]
        #[cxx_name = "statsChanged"]
        fn stats_changed(self: Pin<&mut DataController>);

        /// Re-scan database + card dirs; updates `statsJson`.
        /// Shape: `{"domains":[{"id","count","bytes"}],"totalBytes":n,"totalCount":n}`.
        #[qinvokable]
        #[cxx_name = "refreshStats"]
        fn refresh_stats(self: Pin<&mut DataController>);

        /// Export the domains picked in `selection_json`
        /// (`{"characters":bool,"chats":bool,"memory":bool,"providers":bool,"backgrounds":bool}`).
        ///
        /// `dest_path` is the destination `.zip`; empty selects
        /// `<profile>/exports/airi-vault-<ms>.zip` (or the platform data dir).
        /// Returns `{"path","bytes","domains"}` or `{"error"}`.
        #[qinvokable]
        #[cxx_name = "exportVault"]
        fn export_vault(
            self: Pin<&mut DataController>,
            selection_json: QString,
            dest_path: QString,
        ) -> QString;

        /// Inspect a vault archive. Returns the inspection report as JSON, or `{"error"}`.
        #[qinvokable]
        #[cxx_name = "inspectVault"]
        fn inspect_vault(self: &DataController, path: QString) -> QString;

        /// Apply a vault archive: chats + memory only, existing rows win.
        /// Returns the commit report as JSON, or `{"error"}`.
        #[qinvokable]
        #[cxx_name = "commitVaultImport"]
        fn commit_vault_import(self: Pin<&mut DataController>, path: QString) -> QString;

        /// Scrub inline base64 images out of chat history into the backgrounds store.
        /// `create_backup = true` writes a pre-scrub archive first (default for UI flows).
        /// Returns the scrub report as JSON, or `{"error"}`.
        #[qinvokable]
        #[cxx_name = "scrubRun"]
        fn scrub_run(self: Pin<&mut DataController>, create_backup: bool) -> QString;

        /// Recent scrub runs, newest first: JSON array of
        /// `{"id","startedAt","sessionsScanned","imagesExtracted","bytesExtracted","backupPath"}`.
        #[qinvokable]
        #[cxx_name = "listScrubRuns"]
        fn list_scrub_runs(self: &DataController) -> QString;
    }
}

/// Rust storage for `DataController`.
pub struct DataControllerRust {
    stats_json: QString,
    last_error: QString,
    working: bool,
}

impl Default for DataControllerRust {
    fn default() -> Self {
        Self {
            stats_json: QString::from("{}"),
            last_error: QString::from(""),
            working: false,
        }
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

impl qobject::DataController {
    fn clear_error(mut self: std::pin::Pin<&mut Self>) {
        let s = QString::from("");
        self.as_mut().rust_mut().last_error = s.clone();
        self.as_mut().set_last_error(s);
    }

    fn sync_stats(mut self: std::pin::Pin<&mut Self>) {
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
        let s = QString::from(serialized.as_str());
        {
            let mut rust_mut = self.as_mut().rust_mut();
            rust_mut.stats_json = s.clone();
        }
        self.as_mut().set_stats_json(s);
        qobject::DataController::stats_changed(self.as_mut());
    }

    /// Re-scan the vault statistics.
    pub fn refresh_stats(mut self: Pin<&mut Self>) {
        self.as_mut().clear_error();
        self.sync_stats();
    }

    /// Export selected domains to a ZIP archive.
    pub fn export_vault(
        mut self: Pin<&mut Self>,
        selection_json: QString,
        dest_path: QString,
    ) -> QString {
        self.as_mut().clear_error();
        let selection = qstring_to_string(&selection_json);
        let dest = qstring_to_string(&dest_path);

        let parsed: serde_json::Value = match serde_json::from_str(&selection) {
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

        let dest = if dest.is_empty() {
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
            std::path::PathBuf::from(dest)
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
        self.as_mut().sync_stats();
        json_ok(result)
    }

    /// Inspect a vault archive.
    pub fn inspect_vault(&self, path: QString) -> QString {
        let path = qstring_to_string(&path);
        let bytes = match std::fs::read(&path) {
            Ok(b) => b,
            Err(e) => return json_err(format!("failed to read {path}: {e}")),
        };
        match vault::inspect_archive(&bytes) {
            Ok(report) => json_ok(serde_json::to_value(report).unwrap_or_else(|_| json!({}))),
            Err(e) => json_err(format!("inspection failed: {e}")),
        }
    }

    /// Apply a vault archive (chats + memory only).
    pub fn commit_vault_import(mut self: Pin<&mut Self>, path: QString) -> QString {
        self.as_mut().clear_error();
        let path = qstring_to_string(&path);
        let bytes = match std::fs::read(&path) {
            Ok(b) => b,
            Err(e) => return json_err(format!("failed to read {path}: {e}")),
        };
        let Some(db) = bridges::database().cloned() else {
            return json_err("database is not available (profile not registered)");
        };
        match vault::commit_archive(&db, &bytes) {
            Ok(report) => {
                self.as_mut().sync_stats();
                json_ok(serde_json::to_value(report).unwrap_or_else(|_| json!({})))
            }
            Err(e) => json_err(format!("import failed: {e}")),
        }
    }

    /// Scrub inline base64 images out of the chat history.
    pub fn scrub_run(mut self: Pin<&mut Self>, create_backup: bool) -> QString {
        self.as_mut().clear_error();
        let Some(db) = bridges::database().cloned() else {
            return json_err("database is not available (profile not registered)");
        };
        let Some(backgrounds) = backgrounds_dir() else {
            return json_err("could not resolve the backgrounds directory");
        };
        match vault::scrub_session_media(&db, &backgrounds, &chat::card_dirs(), create_backup) {
            Ok(report) => {
                self.as_mut().sync_stats();
                json_ok(serde_json::to_value(report).unwrap_or_else(|_| json!({})))
            }
            Err(e) => json_err(format!("scrub failed: {e}")),
        }
    }

    /// List recent scrub runs (newest first).
    pub fn list_scrub_runs(&self) -> QString {
        let Some(db) = bridges::database().cloned() else {
            return QString::from("[]");
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
            Err(_) => QString::from("[]"),
        }
    }
}
