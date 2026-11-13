// SPDX-License-Identifier: GPL-3.0-or-later
//! Memory settings bridge (`MemoryController`) exposed to Slint.
//!
//! Drives the memory settings page:
//!
//! - **Preference persistence** — the enable switch and the retrieval
//!   `topK` are stored as a single `settings/memory` JSON blob (camelCase
//!   fields `enabled` / `topK`) through the same `SettingsStore` pattern as
//!   the hearing/stage bridges. `airi-core::settings` has no memory section
//!   type and is read-only for this lane, so the blob is (de)serialized
//!   here with `#[serde(default)]` semantics; missing/corrupt blob →
//!   defaults (`enabled: false`, `topK: 5`).
//! - **Long-term journal — live read** — `journal_count` / `recent_entries` are
//!   read straight from `airi-store` (`journal_entries`, migration v2) via
//!   [`airi_core::memory::TextJournalService`] (`list_recent` / `count`).
//!   Entries are appended by the chat pipeline and dream-gate paths; this
//!   bridge never writes, updates, or deletes journal rows.
//! - **Retrieval provider display** — `retrieval_provider` carries the label
//!   of the LLM provider the chat pipeline would resolve today (smoke
//!   override under `--smoke`, then env `AIRI_SLINT_PROVIDER`, then the first
//!   enabled row in the `providers` table), formatted `id · model` (model
//!   omitted when unset). `""` means "not configured"; the page renders a
//!   localized placeholder. Provider secrets (API keys) are never read or
//!   surfaced.
//! - **`index_missing` — the only backfill trigger** — embeds every
//!   unembedded `journal_entries` / `summaries` row with the *chat* provider
//!   config (resolved via `airi_core::providers::resolve_provider`) in one
//!   batched embedding call. The batch (full journal scan + one HTTP
//!   round-trip + N SQLite upserts) runs on the process Tokio runtime, never
//!   on the UI thread: the call returns `true` ("started") immediately and
//!   the batch runs detached — its honest outcome is logged. No keys cross
//!   the bridge.
//!
//! What the memory wiring does (wave ⑬): the chat pipeline consumes
//! `settings/memory` — completed turns are journaled as `note` entries and
//! (when `enabled`) embedded one-call-per-turn via
//! `MemoryIndexer::index_if_enabled`, retrieval injects
//! `MemoryRetrieval::build_prompt_block` as a leading system message, and
//! `index_missing` backfills historical rows on demand. See
//! `crates/airi-slint/src/bridges/chat.rs` and
//! `docs/phase-notes/p13-lane-memory-wiring.md`.
//!
//! What is **not** wired (honest, on the record):
//! - Short-term summarization (`ShortTermMemoryService`) is still not called
//!   from the chat pipeline.
//! - `clearJournal` is **omitted on purpose**: `JournalRepo` exposes no
//!   delete/clear (journal entries are immutable by design), and this lane
//!   may not add destructive ops the backend lacks. The page therefore
//!   shows no journal-clearing affordance.
//! - Daily-summary blocks are not surfaced on the page; `topK` is the
//!   retrieval budget only.
//! - The backfill outcome is not pushed back into `status_line`: the bridge
//!   owns no cross-thread UI signal yet, so the spawned task only logs.
//! - Under `--smoke` the smoke provider override *is* observable by
//!   `index_missing` (it resolves the provider the same way the chat
//!   bridge does); the smoke run itself never enables the memory
//!   flag, so no embed call happens there.

use std::sync::{Arc, Mutex};

use airi_core::memory::embedding::{Embedder, EmbeddingClient, DEFAULT_EMBEDDING_MODEL};
use airi_core::memory::retrieval::MemoryIndexer;
use airi_core::memory::TextJournalService;
use serde::{Deserialize, Serialize};

use crate::bridges;
use airi_core::util::truncate_chars;

/// Storage key for the memory preference blob.
const MEMORY_KEY: &str = "settings/memory";
/// Maximum number of journal entries returned by `recent_entries` (and shown by the page).
const JOURNAL_CAP: usize = 20;
/// Journal entry `text` field is truncated to this many Unicode scalar values.
const TEXT_TRUNCATION: usize = 400;
/// Default retrieval `topK` when the blob is missing/corrupt.
const DEFAULT_TOP_K: i32 = 5;
/// Smallest accepted `topK`.
const TOP_K_MIN: i32 = 1;
/// Largest accepted `topK`.
const TOP_K_MAX: i32 = 20;
/// Shown the moment a backfill is accepted, until the batch reports back.
const BACKFILL_STARTED: &str = "Backfilling memories…";

/// The `settings/memory` blob. Field names serialize camelCase to stay
/// recognizable next to the Electron keys. Unknown fields are ignored on
/// load (serde default), missing fields fall back to the defaults below.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
struct MemorySettingsBlob {
    /// Whether the memory module is active. Consumed by the chat pipeline
    /// (journal-on-completion + retrieval injection + per-turn indexing).
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

/// Plain-value snapshot of `settings/memory` for the chat pipeline.
///
/// `enabled` gates every memory side effect in `chat.rs` (journal write,
/// embedding call, retrieval injection); `top_k` is clamped defensively
/// (the writers clamp to 1–20 already). Missing/corrupt blobs yield the
/// defaults (`enabled: false`, `top_k: 5`).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) struct MemoryPreferences {
    /// `settings/memory.enabled`.
    pub enabled: bool,
    /// `settings/memory.topK`, clamped to 1–20.
    pub top_k: i32,
}

/// Read `settings/memory` as plain values (one key lookup; intended for
/// the chat send/complete paths, which run on the UI thread).
pub(crate) fn memory_preferences() -> MemoryPreferences {
    let blob = load_blob();
    MemoryPreferences {
        enabled: blob.enabled,
        top_k: blob.top_k.clamp(TOP_K_MIN, TOP_K_MAX),
    }
}

/// One long-term journal entry, shaped for the page list (newest first).
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MemoryEntry {
    /// Entry id.
    pub id: String,
    /// Creation time, ms since the Unix epoch.
    pub timestamp_ms: i64,
    /// Entry kind: `note` | `dream` | `milestone` | `summary`.
    pub kind: String,
    /// Entry body, truncated to [`TEXT_TRUNCATION`] scalar values.
    pub text: String,
}

/// Memory settings view-model state. One process-wide instance.
pub struct MemoryControllerState {
    /// `settings/memory.enabled`.
    pub enabled: bool,
    /// `settings/memory.topK`, clamped to 1–20.
    pub top_k: i32,
    /// Total journal rows at the last snapshot.
    pub journal_count: i32,
    /// Newest journal entries at the last snapshot.
    pub recent_entries: Vec<MemoryEntry>,
    /// Label of the provider retrieval would use, `""` when unconfigured.
    pub retrieval_provider: String,
    /// Human-readable status line (last outcome / persistence error).
    pub status_line: String,
}

impl Default for MemoryControllerState {
    fn default() -> Self {
        let blob = load_blob();
        let snapshot = journal_snapshot();
        Self {
            enabled: blob.enabled,
            top_k: blob.top_k,
            journal_count: snapshot.count,
            recent_entries: snapshot.entries,
            retrieval_provider: llm_provider_label(),
            status_line: base_status_line(&snapshot.note),
        }
    }
}

/// Process-wide controller guarded by a mutex.
static STATE: Mutex<MemoryControllerState> = Mutex::new(MemoryControllerState {
    enabled: false,
    top_k: DEFAULT_TOP_K,
    journal_count: 0,
    recent_entries: Vec::new(),
    retrieval_provider: String::new(),
    status_line: String::new(),
});

/// Lock the process-wide controller for a UI-thread operation.
pub fn with_state<R>(f: impl FnOnce(&mut MemoryControllerState) -> R) -> R {
    match STATE.lock() {
        Ok(mut guard) => f(&mut guard),
        Err(poisoned) => f(&mut poisoned.into_inner()),
    }
}

impl MemoryControllerState {
    /// Re-read the blob, journal, and provider label into the state.
    pub fn refresh(&mut self) {
        let blob = load_blob();
        let snapshot = journal_snapshot();
        self.enabled = blob.enabled;
        self.top_k = blob.top_k;
        self.journal_count = snapshot.count;
        self.recent_entries = snapshot.entries;
        self.retrieval_provider = llm_provider_label();
        self.status_line = base_status_line(&snapshot.note);
    }

    /// Persist `enabled` (keeping `topK`) and mirror it.
    pub fn apply_enabled(&mut self, enabled: bool) -> bool {
        self.enabled = enabled;
        self.persist_with_status()
    }

    /// Clamp `topK` to 1–20, persist it (keeping `enabled`) and mirror it.
    pub fn apply_top_k(&mut self, top_k: i32) -> bool {
        self.top_k = top_k.clamp(TOP_K_MIN, TOP_K_MAX);
        self.persist_with_status()
    }

    /// Hand every unembedded journal/summary row to one batched embedding
    /// call on the process Tokio runtime, then report the honest outcome on
    /// the log.
    ///
    /// Never blocks the UI thread: returns `true` ("started") as soon as the
    /// batch is spawned, with `status_line` set to a "backfilling…" line.
    /// shortcut: the batch runs detached and its result is only logged — no
    /// cross-thread status push yet; upgrade when the bridge owns a UI-thread
    /// wake-up channel (same hop `providers.rs` uses for its drain timer).
    pub fn index_missing(&mut self) -> bool {
        let Some(handle) = bridges::runtime_handle().cloned() else {
            self.status_line = "Backfill unavailable — the async runtime is not running.".into();
            eprintln!("[airi-slint] memory: indexMissing failed: no tokio runtime");
            return false;
        };
        self.status_line = BACKFILL_STARTED.to_owned();
        handle.spawn(async move {
            let outcome = index_missing_async().await;
            // The full error chain is on the log; statusLine stays short but
            // carries enough detail to be actionable.
            if let Err(e) = &outcome {
                eprintln!("[airi-slint] memory: indexMissing failed: {e:#}");
            }
            let (status_line, _ok) = index_missing_summary(&outcome);
            eprintln!("[airi-slint] memory: indexMissing: {status_line}");
        });
        true
    }

    /// Snapshot the mirror, persist it, update `status_line` and report
    /// success.
    fn persist_with_status(&mut self) -> bool {
        let blob = MemorySettingsBlob {
            enabled: self.enabled,
            top_k: self.top_k.clamp(TOP_K_MIN, TOP_K_MAX),
        };
        let result = save_blob(&blob);
        let snapshot = journal_snapshot();
        let (status_line, ok) = match &result {
            Ok(()) => (base_status_line(&snapshot.note), true),
            Err(e) => {
                eprintln!("[airi-slint] memory: failed to persist {MEMORY_KEY}: {e}");
                (format!("save failed: {e}"), false)
            }
        };
        self.top_k = blob.top_k;
        self.journal_count = snapshot.count;
        self.recent_entries = snapshot.entries;
        self.retrieval_provider = llm_provider_label();
        self.status_line = status_line;
        ok
    }
}

/// Human-readable (raw English, bridge convention) base status line.
fn base_status_line(journal_note: &str) -> String {
    let mut line = "memory wiring active — chat journal + retrieval run when enabled".to_string();
    if !journal_note.is_empty() {
        line.push_str("; ");
        line.push_str(journal_note);
    }
    line
}

/// Resolve the chat provider's config via `airi_core::providers::resolve_provider`
/// (smoke override → `AIRI_SLINT_PROVIDER` env → first enabled `providers`
/// row) and build an embedding client with the default embedding model.
/// Errors when the chat context is missing, no provider is configured, or
/// the config has no base URL — the caller surfaces that on the log.
fn chat_embedding_client() -> anyhow::Result<EmbeddingClient> {
    let ctx = crate::bridges::chat::chat_context()
        .ok_or_else(|| anyhow::anyhow!("chat context not registered"))?;
    let resolution = crate::bridges::chat::resolve_provider(ctx);
    Ok(EmbeddingClient::from_provider_config(
        &resolution.config,
        DEFAULT_EMBEDDING_MODEL,
    )?)
}

/// Embed every unembedded journal/summary row and upsert it into
/// `memory_embeddings`. Split out for tests (production passes a client
/// built from the chat provider config; tests inject a mock embedder).
async fn index_missing_with(
    db: airi_store::Database,
    embedder: Arc<dyn Embedder>,
) -> anyhow::Result<usize> {
    MemoryIndexer::new(db, embedder).index_missing().await
}

/// Batch entry point used by the backfill: resolves the chat provider, then
/// runs the batch on the caller's task (the process Tokio runtime — never the
/// UI thread).
async fn index_missing_async() -> anyhow::Result<usize> {
    let Some(db) = bridges::database().cloned() else {
        anyhow::bail!("database not registered");
    };
    let client = chat_embedding_client()?;
    index_missing_with(db, Arc::new(client)).await
}

/// Render the log line for a finished backfill (the success flag is unused by
/// the async caller but kept for the tests' assertions). The failure line
/// carries the error (single line, length-capped) so the log shows more than
/// "see log".
fn index_missing_summary(outcome: &anyhow::Result<usize>) -> (String, bool) {
    match outcome {
        Ok(0) => ("Indexed 0 entries.".to_string(), true),
        Ok(n) => (format!("Indexed {n} entries."), true),
        Err(e) => {
            let mut detail = format!("{e:#}").replace('\n', " ");
            const MAX: usize = 160;
            if detail.chars().count() > MAX {
                detail = detail.chars().take(MAX).collect::<String>() + "…";
            }
            (format!("Indexing failed — {detail}"), false)
        }
    }
}

/// Journal count + recent entries read together; `note` is empty on success
/// and carries the failure reason otherwise.
struct JournalSnapshot {
    count: i32,
    entries: Vec<MemoryEntry>,
    note: String,
}

/// Read journal count + recent entries.
fn journal_snapshot() -> JournalSnapshot {
    let Some(db) = bridges::database().cloned() else {
        return JournalSnapshot {
            count: 0,
            entries: Vec::new(),
            note: "journal unavailable: database not registered".to_string(),
        };
    };
    let service = TextJournalService::new(db);
    let count = match service.count() {
        Ok(count) => i32::try_from(count).unwrap_or(i32::MAX),
        Err(e) => {
            eprintln!("[airi-slint] memory: journal count failed: {e}");
            return JournalSnapshot {
                count: 0,
                entries: Vec::new(),
                note: format!("journal count failed: {e}"),
            };
        }
    };
    let entries = match service.list_recent(JOURNAL_CAP) {
        Ok(entries) => entries,
        Err(e) => {
            eprintln!("[airi-slint] memory: journal list failed: {e}");
            return JournalSnapshot {
                count,
                entries: Vec::new(),
                note: format!("journal read failed: {e}"),
            };
        }
    };
    JournalSnapshot {
        count,
        entries: entries.iter().map(memory_entry).collect(),
        note: String::new(),
    }
}

/// Shape one journal row for the page: `{id, timestampMs, kind, text}` with
/// `text` truncated to [`TEXT_TRUNCATION`] scalar values. The embedding
/// vector never crosses the boundary.
fn memory_entry(entry: &airi_store::StoredJournalEntry) -> MemoryEntry {
    MemoryEntry {
        id: entry.id.clone(),
        timestamp_ms: entry.created_at,
        kind: entry.kind.clone(),
        text: truncate_chars(&entry.content, TEXT_TRUNCATION),
    }
}

/// Label of the LLM provider the chat pipeline would resolve today
/// (`id` or `id · model`), or `""` when nothing is configured.
///
/// Uses the same resolution as the chat pipeline (env override → first
/// enabled providers row; see `airi_core::providers`), minus the smoke
/// override: it is not observable from this bridge. Provider secrets are
/// never read or surfaced.
fn llm_provider_label() -> String {
    let repo = bridges::provider_repo().cloned().or_else(|| {
        bridges::database()
            .cloned()
            .map(airi_store::ProviderRepo::new)
    });
    let rows = match repo.map(|r| r.list()) {
        Some(Ok(rows)) => rows,
        Some(Err(e)) => {
            eprintln!("[airi-slint] memory: provider list failed: {e}");
            Vec::new()
        }
        None => Vec::new(),
    };
    airi_core::providers::resolve_provider(|k| std::env::var(k).ok(), &rows)
        .map(|p| p.label())
        .unwrap_or_default()
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
    fn recent_entries_shape_capped_rows() {
        let entries: Vec<airi_store::StoredJournalEntry> = (0..3)
            .map(|i| airi_store::StoredJournalEntry {
                id: format!("id-{i}"),
                kind: "note".to_string(),
                content: format!("entry {i}"),
                embedding: None,
                created_at: 1_700_000_000_000 + i,
                updated_at: 1_700_000_000_000 + i,
            })
            .collect();
        let rows: Vec<MemoryEntry> = entries.iter().map(memory_entry).collect();
        assert_eq!(rows.len(), 3);
        assert_eq!(rows[0].id, "id-0");
        assert_eq!(rows[0].kind, "note");
        assert_eq!(rows[0].timestamp_ms, 1_700_000_000_000_i64);
        // The embedding vector never crosses the boundary: `MemoryEntry` has
        // no field for it.
        let json = serde_json::to_value(&rows).expect("entries serialize");
        assert!(json[0].get("embedding").is_none());
    }

    #[test]
    fn backfill_started_line_is_nonempty() {
        // The immediate "started" feedback the call writes before it
        // spawns; an empty line would leave the page with no feedback at all.
        assert!(!BACKFILL_STARTED.is_empty());
    }
}

#[cfg(test)]
mod index_tests {
    //! Tests for the `index_missing` backfill path (wave ⑬). The entry point
    //! itself (spawn on the process runtime) is not exercised here — these
    //! cover the shared core with an injected mock embedder, and the summary
    //! line rendering.
    use super::*;

    use airi_core::memory::embedding::EmbeddingError;

    use std::future::Future;
    use std::pin::Pin;

    struct TestDb {
        dir: std::path::PathBuf,
        db: airi_store::Database,
    }

    fn temp_db() -> TestDb {
        let unique = format!(
            "airi-slint-memory-test-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map(|d| d.as_nanos())
                .unwrap_or(0)
        );
        let dir = std::env::temp_dir().join(unique);
        std::fs::create_dir_all(&dir).expect("create temp dir");
        let db = airi_store::Database::open(&dir.join("test.sqlite")).expect("open db");
        TestDb { dir, db }
    }

    impl Drop for TestDb {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.dir);
        }
    }

    /// Canned embedder (one batched call per `embed` invocation).
    struct CannedEmbedder {
        calls: std::sync::Mutex<Vec<Vec<String>>>,
        fail: bool,
    }

    impl CannedEmbedder {
        fn ok() -> Self {
            Self {
                calls: std::sync::Mutex::new(Vec::new()),
                fail: false,
            }
        }
        fn failing() -> Self {
            Self {
                calls: std::sync::Mutex::new(Vec::new()),
                fail: true,
            }
        }
        fn call_count(&self) -> usize {
            self.calls.lock().expect("call log").len()
        }
    }

    impl Embedder for CannedEmbedder {
        // `Embedder` is `#[async_trait]`; spell out the desugar here (no
        // async-trait dep in this crate) — one elided lifetime per reference.
        fn embed<'life0, 'life1, 'async_trait>(
            &'life0 self,
            texts: &'life1 [String],
        ) -> Pin<
            Box<dyn Future<Output = Result<Vec<Vec<f32>>, EmbeddingError>> + Send + 'async_trait>,
        >
        where
            'life0: 'async_trait,
            'life1: 'async_trait,
        {
            Box::pin(async move {
                self.calls.lock().expect("call log").push(texts.to_vec());
                if self.fail {
                    return Err(EmbeddingError::Empty);
                }
                Ok(texts
                    .iter()
                    .map(|_| vec![0.5_f32, 0.25, 0.125, 1.0])
                    .collect())
            })
        }
    }

    #[tokio::test]
    async fn index_missing_with_indexes_canned_rows_in_one_batched_call() {
        let t = temp_db();
        let journal = TextJournalService::new(t.db.clone());
        journal.append_note("The user's cat is named Miso").unwrap();
        journal
            .append_note("The office wifi password is hunter2")
            .unwrap();

        let canned = Arc::new(CannedEmbedder::ok());
        let indexed = index_missing_with(t.db.clone(), canned.clone())
            .await
            .unwrap();
        assert_eq!(indexed, 2);
        assert_eq!(
            canned.call_count(),
            1,
            "backfill embeds all missing rows in one call"
        );
        assert_eq!(
            airi_store::MemoryEmbeddingRepo::new(t.db.clone())
                .count()
                .unwrap(),
            2
        );

        // Second run: nothing missing, and no provider call at all.
        let again = index_missing_with(t.db.clone(), canned.clone())
            .await
            .unwrap();
        assert_eq!(again, 0);
        assert_eq!(canned.call_count(), 1, "zero-row backfill stays silent");
    }

    #[tokio::test]
    async fn index_missing_with_embedder_failure_keeps_journal_intact() {
        let t = temp_db();
        let journal = TextJournalService::new(t.db.clone());
        journal
            .append_note("an entry that will fail to embed")
            .unwrap();

        let failing = Arc::new(CannedEmbedder::failing());
        let outcome = index_missing_with(t.db.clone(), failing.clone()).await;
        assert!(outcome.is_err());
        let (status_line, ok) = index_missing_summary(&outcome);
        assert!(!ok);
        assert!(
            status_line.starts_with("Indexing failed"),
            "line: {status_line}"
        );
        assert!(
            status_line.contains("empty embeddings response"),
            "summary carries the error: {status_line}"
        );
        // Journal row preserved for a later backfill; index untouched.
        assert_eq!(journal.count().unwrap(), 1);
        assert_eq!(
            airi_store::MemoryEmbeddingRepo::new(t.db.clone())
                .count()
                .unwrap(),
            0
        );
    }

    #[test]
    fn index_missing_summary_reports_zero_and_success_counts() {
        let (line, ok) = index_missing_summary(&Ok(0));
        assert_eq!(line, "Indexed 0 entries.");
        assert!(ok);
        let (line, ok) = index_missing_summary(&Ok(3));
        assert_eq!(line, "Indexed 3 entries.");
        assert!(ok);
    }

    #[test]
    fn index_missing_summary_failure_line_is_single_line_and_capped() {
        let err = anyhow::anyhow!("provider said no\nover multiple lines {}", "x".repeat(500));
        let (line, ok) = index_missing_summary(&Err(err));
        assert!(!ok);
        assert!(!line.contains('\n'));
        assert!(line.starts_with("Indexing failed — "));
        assert!(line.chars().count() <= "Indexing failed — ".chars().count() + 161);
    }
}
