// SPDX-License-Identifier: GPL-3.0-or-later
//! Memory settings bridge (`MemoryController`) exposed to QML.
//!
//! Drives `qml/pages/settings/modules/memory/MemorySettingsPage.qml`:
//!
//! - **Preference persistence** — the enable switch and the retrieval
//!   `topK` are stored as a single `settings/memory` JSON blob (camelCase
//!   fields `enabled` / `topK`) through the same `SettingsStore` pattern as
//!   the hearing/stage bridges. `airi-core::settings` has no memory section
//!   type and is read-only for this lane, so the blob is (de)serialized
//!   here with `#[serde(default)]` semantics; missing/corrupt blob →
//!   defaults (`enabled: false`, `topK: 5`).
//! - **Long-term journal — live read** — `journalCount` / `recentJson` are
//!   read straight from `airi-store` (`journal_entries`, migration v2) via
//!   [`airi_core::memory::TextJournalService`] (`list_recent` / `count`).
//!   Entries are appended by the chat pipeline and dream-gate paths; this
//!   bridge never writes, updates, or deletes journal rows.
//! - **Retrieval provider display** — `retrievalProvider` carries the label
//!   of the LLM provider the chat pipeline would resolve today (env
//!   `AIRI_QT_PROVIDER` first, then the first enabled row in the
//!   `providers` table), formatted `id · model` (model omitted when unset).
//!   `""` means "not configured"; the page renders a localized
//!   placeholder. Provider secrets (API keys) are never read or surfaced.
//!
//! Implementation note (why the qproperties are `READ, NOTIFY`): cxx-qt
//! generates a `void` setter slot for every qproperty with an implicit
//! `WRITE` (`setEnabled`, `setTopK`, …). A `bool` qinvokable named
//! `setEnabled(bool)` cannot overload that slot, so the setter `WRITE` is
//! omitted and the properties are updated by mutating the storage fields
//! directly + emitting the `*Changed` notify signals. This keeps the QML
//! API exactly as speced (`enabled` / `topK` / … + `setEnabled`/`setTopK`
//! invokables); `Q_PROPERTY(... READ ... NOTIFY ...)` without `WRITE` is
//! valid for Qt and the getters are unchanged.
//!
//! What is **not** wired (honest, on the record):
//! - Nothing in this Qt build consumes `settings/memory` yet. Short-term
//!   summarization (`ShortTermMemoryService`), journal-aware retrieval
//!   (`MemoryRetrieval::build_prompt_block`) and the indexing pipeline
//!   (`MemoryIndexer`) exist in `airi-core` but are not called from the
//!   chat pipeline; `chat.rs` is untouched this wave. The persisted flag
//!   is intent, not a live switch.
//! - `clearJournal` is **omitted on purpose**: `JournalRepo` exposes no
//!   delete/clear (journal entries are immutable by design), and this lane
//!   may not add destructive ops the backend lacks. The page therefore
//!   shows no journal-clearing affordance.
//! - Daily-summary blocks are not surfaced on the page; `topK` is the
//!   retrieval budget only.
//! - The smoke chat-provider override (`set_chat_provider_override`) is not
//!   observable from this bridge, so under `--smoke` the retrieval provider
//!   line reflects the persisted configuration, not the mock.

use cxx_qt::CxxQtType;
use cxx_qt_lib::QString;
use std::pin::Pin;

use airi_core::memory::TextJournalService;
use airi_store::StoredJournalEntry;
use serde::{Deserialize, Serialize};

use crate::bridges;

/// Storage key for the memory preference blob.
const MEMORY_KEY: &str = "settings/memory";
/// Maximum number of journal entries returned by `recentJson` (and shown by the page).
const JOURNAL_CAP: usize = 20;
/// Journal entry `text` field is truncated to this many Unicode scalar values.
const TEXT_TRUNCATION: usize = 400;
/// Default retrieval `topK` when the blob is missing/corrupt.
const DEFAULT_TOP_K: i32 = 5;
/// Smallest accepted `topK`.
const TOP_K_MIN: i32 = 1;
/// Largest accepted `topK`.
const TOP_K_MAX: i32 = 20;

/// cxx-qt bridge definitions for the memory settings bridge.
#[cxx_qt::bridge]
pub mod qobject {
    unsafe extern "C++" {
        include!("cxx-qt-lib/qstring.h");
        /// QString from cxx-qt-lib.
        type QString = cxx_qt_lib::QString;
    }

    extern "RustQt" {
        /// Memory settings mirror. Create one per page. `refresh()` re-reads
        /// `settings/memory` and the journal into the mirror.
        #[qobject]
        #[qml_element]
        #[namespace = "airi_qt"]
        #[qproperty(bool, enabled, READ, NOTIFY)]
        #[qproperty(i32, top_k, cxx_name = "topK", READ, NOTIFY)]
        #[qproperty(i32, journal_count, cxx_name = "journalCount", READ, NOTIFY)]
        #[qproperty(QString, recent_json, cxx_name = "recentJson", READ, NOTIFY)]
        #[qproperty(
            QString,
            retrieval_provider,
            cxx_name = "retrievalProvider",
            READ,
            NOTIFY
        )]
        #[qproperty(QString, status_line, cxx_name = "statusLine", READ, NOTIFY)]
        type MemoryController = super::MemoryControllerRust;
    }

    extern "RustQt" {
        /// Emitted after every mirror mutation / refresh / save.
        #[qsignal]
        #[cxx_name = "stateChanged"]
        fn state_changed(self: Pin<&mut MemoryController>);

        /// Re-read `settings/memory`, journal count + recent entries, and the
        /// retrieval provider label into the mirror. Emits `stateChanged`.
        #[qinvokable]
        fn refresh(self: Pin<&mut MemoryController>);

        /// Persist `enabled` (`settings/memory.enabled`) with the current
        /// `topK`. Returns `true` on success; on failure `statusLine` carries
        /// the reason and the mirror keeps the new value (theme/hearing idiom:
        /// the switch reflects intent, the status line carries the truth).
        #[qinvokable]
        #[cxx_name = "setEnabled"]
        fn apply_enabled(self: Pin<&mut MemoryController>, enabled: bool) -> bool;

        /// Clamp `topK` to 1–20 and persist it (`settings/memory.topK`) with
        /// the current `enabled` flag. Returns `true` on success.
        #[qinvokable]
        #[cxx_name = "setTopK"]
        fn apply_top_k(self: Pin<&mut MemoryController>, top_k: i32) -> bool;
    }
}

/// The `settings/memory` blob. Field names serialize camelCase to stay
/// recognizable next to the Electron keys. Unknown fields are ignored on
/// load (serde default), missing fields fall back to the defaults below.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
struct MemorySettingsBlob {
    /// Whether the memory module should be active (intent only — nothing
    /// in this build consumes it yet).
    enabled: bool,
    /// Retrieval budget: how many memories `build_prompt_block` may inject.
    top_k: i32,
}

impl Default for MemorySettingsBlob {
    fn default() -> Self {
        Self {
            enabled: false,
            top_k: DEFAULT_TOP_K,
        }
    }
}

/// Rust storage for `MemoryController`.
pub struct MemoryControllerRust {
    enabled: bool,
    top_k: i32,
    journal_count: i32,
    recent_json: QString,
    retrieval_provider: QString,
    status_line: QString,
}

/// Plain-value mirror snapshot used to update the qproperty storage.
struct Mirror {
    enabled: bool,
    top_k: i32,
    journal_count: i32,
    recent_json: String,
    retrieval_provider: String,
    status_line: String,
}

impl Default for MemoryControllerRust {
    fn default() -> Self {
        let blob = load_blob();
        let (journal_count, recent_json, journal_note) = journal_snapshot();
        Self {
            enabled: blob.enabled,
            top_k: blob.top_k,
            journal_count,
            recent_json: QString::from(recent_json.as_str()),
            retrieval_provider: QString::from(llm_provider_label().as_str()),
            status_line: QString::from(base_status_line(&journal_note).as_str()),
        }
    }
}

impl qobject::MemoryController {
    /// Re-read the blob, journal, and provider label into the mirror.
    pub fn refresh(mut self: Pin<&mut Self>) {
        let blob = load_blob();
        let (journal_count, recent_json, journal_note) = journal_snapshot();
        self.as_mut().write_mirror(&Mirror {
            enabled: blob.enabled,
            top_k: blob.top_k,
            journal_count,
            recent_json,
            retrieval_provider: llm_provider_label(),
            status_line: base_status_line(&journal_note),
        });
        qobject::MemoryController::state_changed(self.as_mut());
    }

    /// Persist `enabled` (keeping `topK`) and mirror it.
    pub fn apply_enabled(mut self: Pin<&mut Self>, enabled: bool) -> bool {
        self.as_mut().rust_mut().enabled = enabled;
        self.as_mut().enabled_changed();
        self.persist_with_status()
    }

    /// Clamp `topK` to 1–20, persist it (keeping `enabled`) and mirror it.
    pub fn apply_top_k(mut self: Pin<&mut Self>, top_k: i32) -> bool {
        let clamped = top_k.clamp(TOP_K_MIN, TOP_K_MAX);
        self.as_mut().rust_mut().top_k = clamped;
        self.as_mut().top_k_changed();
        self.persist_with_status()
    }

    /// Snapshot the mirror, persist it, update `statusLine`, emit
    /// `stateChanged` and report success.
    fn persist_with_status(mut self: Pin<&mut Self>) -> bool {
        let blob = {
            let inner = self.as_mut().rust_mut();
            MemorySettingsBlob {
                enabled: inner.enabled,
                top_k: inner.top_k.clamp(TOP_K_MIN, TOP_K_MAX),
            }
        };
        let result = save_blob(&blob);
        let (journal_count, recent_json, journal_note) = journal_snapshot();
        let (status_line, ok) = match &result {
            Ok(()) => (base_status_line(&journal_note), true),
            Err(e) => {
                eprintln!("[airi-qt] memory: failed to persist {MEMORY_KEY}: {e}");
                (format!("save failed: {e}"), false)
            }
        };
        self.as_mut().write_mirror(&Mirror {
            enabled: blob.enabled,
            top_k: blob.top_k,
            journal_count,
            recent_json,
            retrieval_provider: llm_provider_label(),
            status_line,
        });
        qobject::MemoryController::state_changed(self.as_mut());
        ok
    }

    /// Copy a mirror into the qproperty storage and emit the notify signals.
    fn write_mirror(mut self: Pin<&mut Self>, mirror: &Mirror) {
        {
            let mut inner = self.as_mut().rust_mut();
            inner.enabled = mirror.enabled;
            inner.top_k = mirror.top_k;
            inner.journal_count = mirror.journal_count;
            inner.recent_json = QString::from(mirror.recent_json.as_str());
            inner.retrieval_provider = QString::from(mirror.retrieval_provider.as_str());
            inner.status_line = QString::from(mirror.status_line.as_str());
        }
        self.as_mut().enabled_changed();
        self.as_mut().top_k_changed();
        self.as_mut().journal_count_changed();
        self.as_mut().recent_json_changed();
        self.as_mut().retrieval_provider_changed();
        self.as_mut().status_line_changed();
    }
}

/// Human-readable (raw English, bridge convention) base status line.
fn base_status_line(journal_note: &str) -> String {
    let mut line =
        "persists enabled/topK under settings/memory — not consumed by this build yet".to_string();
    if !journal_note.is_empty() {
        line.push_str("; ");
        line.push_str(journal_note);
    }
    line
}

/// Read journal count + recent entries. Returns `(count, recent_json, note)`;
/// `note` is empty on success and carries the failure reason otherwise.
fn journal_snapshot() -> (i32, String, String) {
    let Some(db) = bridges::database().cloned() else {
        return (
            0,
            "[]".to_string(),
            "journal unavailable: database not registered".to_string(),
        );
    };
    let service = TextJournalService::new(db);
    let count = match service.count() {
        Ok(count) => i32::try_from(count).unwrap_or(i32::MAX),
        Err(e) => {
            eprintln!("[airi-qt] memory: journal count failed: {e}");
            return (0, "[]".to_string(), format!("journal count failed: {e}"));
        }
    };
    let entries = match service.list_recent(JOURNAL_CAP) {
        Ok(entries) => entries,
        Err(e) => {
            eprintln!("[airi-qt] memory: journal list failed: {e}");
            return (count, "[]".to_string(), format!("journal read failed: {e}"));
        }
    };
    (count, recent_json(&entries), String::new())
}

/// Shape the `recentJson` payload: newest-first array of
/// `{id, timestampMs, kind, text}` with `text` truncated to [`TEXT_TRUNCATION`].
fn recent_json(entries: &[StoredJournalEntry]) -> String {
    let shaped: Vec<serde_json::Value> = entries
        .iter()
        .map(|entry| {
            serde_json::json!({
                "id": entry.id,
                "timestampMs": entry.created_at,
                "kind": entry.kind,
                "text": truncate_chars(&entry.content, TEXT_TRUNCATION),
            })
        })
        .collect();
    serde_json::Value::Array(shaped).to_string()
}

/// Truncate to at most `max` Unicode scalar values, appending `…` when cut.
fn truncate_chars(text: &str, max: usize) -> String {
    let mut chars = text.chars();
    let kept: String = chars.by_ref().take(max).collect();
    if chars.next().is_some() {
        format!("{kept}…")
    } else {
        kept
    }
}

/// Label of the LLM provider the chat pipeline would resolve today
/// (`id` or `id · model`), or `""` when nothing is configured.
///
/// Mirrors `chat.rs::resolve_provider`'s env-then-stored order, minus the
/// implicit "openai" fallback: an unset configuration reports as not
/// configured instead of naming a provider that was never set up. The smoke
/// override is not observable from this bridge (noted in the module docs).
/// Provider secrets are never read or surfaced.
fn llm_provider_label() -> String {
    if let Ok(id) = std::env::var("AIRI_QT_PROVIDER") {
        let id = id.trim().to_string();
        if !id.is_empty() {
            let model = std::env::var("AIRI_QT_MODEL").unwrap_or_default();
            return provider_label(&id, model.trim());
        }
    }
    let repo = bridges::provider_repo().cloned().or_else(|| {
        bridges::database()
            .cloned()
            .map(airi_store::ProviderRepo::new)
    });
    let Some(repo) = repo else {
        return String::new();
    };
    match repo.list() {
        Ok(rows) => {
            if let Some(provider) = rows.into_iter().find(|p| p.enabled) {
                let model = provider
                    .config
                    .get("model")
                    .and_then(|m| m.as_str())
                    .unwrap_or_default()
                    .trim()
                    .to_string();
                provider_label(&provider.id, &model)
            } else {
                String::new()
            }
        }
        Err(e) => {
            eprintln!("[airi-qt] memory: provider list failed: {e}");
            String::new()
        }
    }
}

/// `id` when `model` is empty, else `id · model`.
fn provider_label(id: &str, model: &str) -> String {
    if model.is_empty() {
        id.to_string()
    } else {
        format!("{id} · {model}")
    }
}

fn load_blob() -> MemorySettingsBlob {
    bridges::settings_store()
        .and_then(|store| store.load::<MemorySettingsBlob>(MEMORY_KEY).ok())
        .unwrap_or_default()
}

fn save_blob(blob: &MemorySettingsBlob) -> anyhow::Result<()> {
    let Some(store) = bridges::settings_store() else {
        anyhow::bail!("settings store not registered");
    };
    store.save(MEMORY_KEY, blob)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn truncate_chars_counts_scalars_and_marks_elision() {
        assert_eq!(truncate_chars("hello", 400), "hello");
        assert_eq!(truncate_chars("hello world", 5), "hello…");
        // Multi-byte scalars count once each.
        let cjk = "記憶".repeat(300);
        assert_eq!(truncate_chars(&cjk, 400).chars().count(), 401);
        // Exactly-at-limit text is not marked as truncated.
        assert_eq!(truncate_chars(&"a".repeat(400), 400), "a".repeat(400));
    }

    #[test]
    fn recent_json_shapes_capped_entries() {
        let entries: Vec<StoredJournalEntry> = (0..3)
            .map(|i| StoredJournalEntry {
                id: format!("id-{i}"),
                kind: "note".to_string(),
                content: format!("entry {i}"),
                embedding: None,
                created_at: 1_700_000_000_000 + i,
                updated_at: 1_700_000_000_000 + i,
            })
            .collect();
        let parsed: serde_json::Value =
            serde_json::from_str(&recent_json(&entries)).expect("recent_json is valid json");
        let rows = parsed.as_array().expect("recent_json is an array");
        assert_eq!(rows.len(), 3);
        assert_eq!(rows[0]["id"], "id-0");
        assert_eq!(rows[0]["kind"], "note");
        assert_eq!(rows[0]["timestampMs"], 1_700_000_000_000_i64);
        assert!(rows[0]["text"].is_string());
        // No embedding payload ever crosses the boundary.
        assert!(rows[0].get("embedding").is_none());
    }

    #[test]
    fn provider_label_formats_with_and_without_model() {
        assert_eq!(provider_label("openai", ""), "openai");
        assert_eq!(provider_label("openai", "gpt-4o"), "openai · gpt-4o");
    }
}
