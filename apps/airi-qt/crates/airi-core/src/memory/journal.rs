// SPDX-License-Identifier: GPL-3.0-or-later
#![deny(missing_docs)]

//! Append-only text journal.
//!
//! Thin facade over [`JournalRepo`] (`airi-store`), ported from the Electron
//! store `packages/stage-ui/src/stores/memory-text-journal.ts`. Entries are
//! immutable once written: this module deliberately exposes no update or
//! delete operations.
//!
//! The embedding column is write-path only here: callers may attach a
//! precomputed vector via [`TextJournalService::append_with_embedding`], and
//! entries default to `NULL`. The semantic index (backfill, search, hybrid
//! retrieval) is lane ②'s (`airi-core::memory` retrieval side); this module
//! does not embed or search.

use airi_store::{Database, JournalRepo, StoredJournalEntry};
use anyhow::Result;

/// Kind of text journal entry.
///
/// Wire values match the `kind` column whitelist in `airi-store`
/// (`note` | `dream` | `milestone` | `summary`).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum JournalKind {
    /// A freeform note.
    Note,
    /// A dreaming/"dream gate" outcome worth recording.
    Dream,
    /// A project milestone.
    Milestone,
    /// A roll-up summary of other journal material.
    Summary,
}

impl JournalKind {
    /// Wire string stored in the `kind` column.
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Note => "note",
            Self::Dream => "dream",
            Self::Milestone => "milestone",
            Self::Summary => "summary",
        }
    }
}

/// Append-only text journal service.
///
/// Cheap to clone; clones share the repository handle (and therefore the
/// database connection pool inside [`Database`]).
#[derive(Clone)]
pub struct TextJournalService {
    repo: JournalRepo,
}

impl TextJournalService {
    /// Create a journal service over the given database.
    pub fn new(db: Database) -> Self {
        Self {
            repo: JournalRepo::new(db),
        }
    }

    /// Append a `note` entry; returns the entry id.
    pub fn append_note(&self, content: &str) -> Result<String> {
        self.repo.append(JournalKind::Note.as_str(), content, None)
    }

    /// Append a `milestone` entry; returns the entry id.
    pub fn append_milestone(&self, content: &str) -> Result<String> {
        self.repo
            .append(JournalKind::Milestone.as_str(), content, None)
    }

    /// Append a `dream` entry recording a dream-gate outcome; returns the
    /// entry id.
    pub fn append_dream_gate_outcome(&self, content: &str) -> Result<String> {
        self.repo.append(JournalKind::Dream.as_str(), content, None)
    }

    /// Append an entry of the given kind, without an embedding.
    pub fn append(&self, kind: JournalKind, content: &str) -> Result<String> {
        self.repo.append(kind.as_str(), content, None)
    }

    /// Append an entry with a precomputed embedding vector; returns the
    /// entry id.
    ///
    /// This is the admission seam for lane ② (retrieval): the vector is
    /// stored as a JSON array in the `embedding` column. No embedding is
    /// computed here — callers supply their own.
    pub fn append_with_embedding(
        &self,
        kind: JournalKind,
        content: &str,
        embedding: Vec<f32>,
    ) -> Result<String> {
        self.repo.append(kind.as_str(), content, Some(&embedding))
    }

    /// List the most recent entries, newest first.
    pub fn list_recent(&self, limit: usize) -> Result<Vec<StoredJournalEntry>> {
        self.repo.list_recent(limit)
    }

    /// List entries created within `[from_ms, to_ms]` (inclusive), oldest first.
    pub fn list_between(
        &self,
        from_ms: i64,
        to_ms: i64,
        limit: usize,
    ) -> Result<Vec<StoredJournalEntry>> {
        self.repo.list_between(from_ms, to_ms, limit)
    }

    /// Total number of entries.
    pub fn count(&self) -> Result<u64> {
        self.repo.count()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    fn journal() -> (tempfile::TempDir, TextJournalService) {
        let dir = tempdir().expect("tempdir");
        let db = Database::open(&dir.path().join("journal.sqlite")).expect("open db");
        (dir, TextJournalService::new(db))
    }

    #[test]
    fn append_helpers_write_expected_kinds() {
        let (_dir, service) = journal();
        service.append_note("a note").unwrap();
        service.append_milestone("shipped P6").unwrap();
        service
            .append_dream_gate_outcome("dream gate: 2 threads")
            .unwrap();
        service
            .append(JournalKind::Summary, "weekly roll-up")
            .unwrap();

        let all = service.list_between(0, i64::MAX, 10).unwrap();
        assert_eq!(all.len(), 4);
        let kinds: Vec<&str> = all.iter().map(|e| e.kind.as_str()).collect();
        assert_eq!(kinds, vec!["note", "milestone", "dream", "summary"]);
        assert_eq!(service.count().unwrap(), 4);
    }

    #[test]
    fn empty_content_is_rejected_for_every_entrypoint() {
        let (_dir, service) = journal();
        assert!(service.append_note("  ").is_err());
        assert!(service.append_milestone("").is_err());
        assert!(service.append_dream_gate_outcome("\n\t").is_err());
        assert!(service.append(JournalKind::Note, "   ").is_err());
        assert!(service
            .append_with_embedding(JournalKind::Note, "", vec![1.0])
            .is_err());
        assert_eq!(service.count().unwrap(), 0);
    }

    #[test]
    fn embedding_write_path_round_trips() {
        let (_dir, service) = journal();
        let id = service
            .append_with_embedding(JournalKind::Note, "embedded", vec![0.125_f32, -2.5, 1024.0])
            .unwrap();
        let entries = service.list_recent(1).unwrap();
        assert_eq!(entries[0].id, id);
        assert_eq!(entries[0].embedding, Some(vec![0.125_f32, -2.5, 1024.0]));

        // Default append leaves the embedding NULL.
        service.append_note("not embedded").unwrap();
        let entries = service.list_recent(1).unwrap();
        assert_eq!(entries[0].embedding, None);
    }

    #[test]
    fn list_between_is_chronological_and_limited() {
        let (_dir, service) = journal();
        for i in 0..5 {
            service.append_note(&format!("note {i}")).unwrap();
        }
        let all = service.list_between(0, i64::MAX, 10).unwrap();
        assert_eq!(all.len(), 5);
        for pair in all.windows(2) {
            assert!(pair[0].created_at <= pair[1].created_at);
        }
        assert_eq!(service.list_between(0, i64::MAX, 3).unwrap().len(), 3);

        let recent: Vec<String> = service
            .list_recent(2)
            .unwrap()
            .into_iter()
            .map(|e| e.content)
            .collect();
        assert_eq!(recent, vec!["note 4".to_string(), "note 3".to_string()]);
    }
}
