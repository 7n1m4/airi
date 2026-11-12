// SPDX-License-Identifier: GPL-3.0-or-later
#![deny(missing_docs)]

//! Memory services: short-term daily summaries and the append-only text
//! journal.
//!
//! Ported from the Electron stage-ui stores
//! (`packages/stage-ui/src/stores/memory-short-term.ts` and
//! `memory-text-journal.ts`) to typed Rust on top of `airi-store`.
//!
//! Lane ownership (P7):
//!
//! - [`short_term`] / [`journal`]: **lane ①** (`p7-memory-journal`) —
//!   persistence for daily summaries and the text journal (tables `summaries`
//!   and `journal_entries`, migration v2).
//! - [`embedding`] / [`retrieval`]: **lane ②** (`p7-retrieval`) — the
//!   embeddings client, the hybrid retrieval index (table `memory_embeddings`,
//!   migration v3), the 5W query hooks, the indexing pipeline, and the
//!   chat-context prompt-block builder.
//!
//! Boundary between the lanes: lane ① owns the `summaries` / `journal_entries`
//! tables (including `journal_entries.embedding`, which lane ① writes as a
//! NULL-by-default JSON-array column). Lane ② keeps its own retrieval index
//! in `memory_embeddings` and never writes lane ① tables; it only reads them
//! (existence-checked) to backfill missing embeddings in
//! [`retrieval::MemoryIndexer::index_missing`].
//!
//! Not in scope (P9): lifetime artifacts, echo chips, event-log/ledger, and
//! LLM-powered 5W analysis (the 5W hook is an extractive placeholder).

pub mod embedding;
pub mod journal;
pub mod retrieval;
pub mod short_term;

pub use journal::{JournalKind, TextJournalService};
pub use short_term::{ShortTermMemoryConfig, ShortTermMemoryService};
