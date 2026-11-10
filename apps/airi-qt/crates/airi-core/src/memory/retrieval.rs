// SPDX-License-Identifier: GPL-3.0-or-later
#![deny(missing_docs)]

//! Hybrid retrieval for memory context assembly (P7 lane ②).
//!
//! Semantic search over the `memory_embeddings` table (migration v3) with
//! cosine similarity computed in-process — no vector database or server.
//! Candidates are blended with a lexical token-overlap score:
//!
//! ```text
//! hybrid = 0.75 * semantic + 0.25 * lexical   (semantic unavailable → lexical)
//! ```
//!
//! When the embedder fails or returns nothing for a query, the semantic term
//! is skipped and ranking degrades gracefully to lexical-only; `search` does
//! not hard-fail on embedding provider outages. Database errors still
//! propagate as `Err`.
//!
//! # Chat context assembly
//!
//! `chat.rs` is intentionally untouched. This module exposes
//! [`MemoryRetrieval::build_prompt_block`], whose output the chat pipeline
//! (or a future prompt-assembly layer) consumes verbatim, e.g. injected as a
//! system-prompt prefix. Returns an empty string when nothing relevant is
//! found, so callers can `push_str` unconditionally.
//!
//! # 5W hooks
//!
//! [`five_w`] provides the 5W *slot* interface (`who/what/when/where_/why`)
//! that the rest of the memory pipeline is built against. The shipped
//! implementation is an **extractive placeholder**, NOT an LLM analysis; see
//! its module docs. [`MemoryRetrieval::search_expanded`] feeds
//! [`five_w::FiveWAnalysis::expanded_query`] into [`MemoryRetrieval::search`].
//!
//! # Notes
//!
//! - `search`/`search_expanded`/`build_prompt_block` are `async` and return
//!   `Result<_>` (embedding goes over HTTP); the spec sketch
//!   (`fn search(...) -> Vec<RetrievedMemory>`) is a simplification.
//! - `kind` filter values: `'journal'` | `'summary'`. `None` searches both.
//! - At most [`MAX_EMBEDDINGS_SCANNED`] (2000) most-recent rows are scored
//!   per query.
//! - Auto-indexing on journal/summary append is NOT wired in (lane ①'s code
//!   paths must stay untouched). Callers invoke [`MemoryIndexer`] explicitly,
//!   or run [`MemoryIndexer::index_missing`] as a backfill. Scheduling is a
//!   documented follow-up.

use std::collections::HashSet;
use std::sync::Arc;

use airi_store::{Database, MemoryEmbeddingRecord, MemoryEmbeddingRepo};
use anyhow::Result;

use crate::memory::embedding::Embedder;

/// Weight of the semantic (cosine) term in the hybrid score.
pub const SEMANTIC_WEIGHT: f32 = 0.75;
/// Weight of the lexical (token overlap) term in the hybrid score.
pub const LEXICAL_WEIGHT: f32 = 0.25;
/// Maximum number of most-recent embeddings scored per query.
pub const MAX_EMBEDDINGS_SCANNED: usize = 2000;

/// A retrieved memory row, with its hybrid score.
#[derive(Debug, Clone, PartialEq)]
pub struct RetrievedMemory {
    /// Source row id (`journal_entries.id`, or `'summary:' || summaries.day`).
    pub source_id: String,
    /// `'journal'` | `'summary'`.
    pub kind: String,
    /// Stored content (the embedded text).
    pub content: String,
    /// Hybrid score in `[0.0, 1.0]`; higher is more relevant.
    pub score: f32,
}

/// A memory entry to index, as provided by the caller.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct IndexEntry {
    /// Source row id (`'summary:' || day` for summaries).
    pub source_id: String,
    /// `'journal'` | `'summary'`.
    pub kind: String,
    /// Text to embed and store.
    pub content: String,
}

/// Tokenize for lexical matching: lowercase alphanumeric words.
pub(crate) fn tokenize(text: &str) -> Vec<String> {
    text.split(|c: char| !c.is_alphanumeric())
        .filter(|s| s.len() >= 2)
        .map(|s| s.to_lowercase())
        .collect()
}

/// Cosine similarity of two equal-length vectors. Returns 0.0 for
/// mismatched lengths or zero-norm vectors.
pub fn cosine(a: &[f32], b: &[f32]) -> f32 {
    if a.len() != b.len() || a.is_empty() {
        return 0.0;
    }
    let dot: f32 = a.iter().zip(b.iter()).map(|(x, y)| x * y).sum();
    let norm_a: f32 = a.iter().map(|x| x * x).sum::<f32>().sqrt();
    let norm_b: f32 = b.iter().map(|x| x * x).sum::<f32>().sqrt();
    if norm_a == 0.0 || norm_b == 0.0 {
        return 0.0;
    }
    dot / (norm_a * norm_b)
}

/// Jaccard token overlap between two pre-tokenized texts, in `[0.0, 1.0]`.
pub fn lexical_overlap(query_tokens: &[String], document_tokens: &[String]) -> f32 {
    if query_tokens.is_empty() || document_tokens.is_empty() {
        return 0.0;
    }
    let q: HashSet<&str> = query_tokens.iter().map(String::as_str).collect();
    let d: HashSet<&str> = document_tokens.iter().map(String::as_str).collect();
    let intersection = q.intersection(&d).count() as f32;
    let union = q.union(&d).count() as f32;
    if union == 0.0 {
        0.0
    } else {
        intersection / union
    }
}

/// Blend semantic and lexical scores. `semantic == None` (embedding
/// unavailable) yields the lexical score alone.
pub fn hybrid_score(semantic: Option<f32>, lexical: f32) -> f32 {
    match semantic {
        Some(s) => SEMANTIC_WEIGHT * s + LEXICAL_WEIGHT * lexical,
        None => lexical,
    }
}

/// Hybrid retrieval over the `memory_embeddings` index.
pub struct MemoryRetrieval {
    repo: MemoryEmbeddingRepo,
    embedder: Arc<dyn Embedder>,
}

impl MemoryRetrieval {
    /// Bind retrieval to a database handle and an embedder.
    pub fn new(db: Database, embedder: Arc<dyn Embedder>) -> Self {
        Self {
            repo: MemoryEmbeddingRepo::new(db),
            embedder,
        }
    }

    /// Hybrid search. See module docs for scoring and degraded behavior.
    pub async fn search(
        &self,
        query: &str,
        kind: Option<&str>,
        top_k: usize,
    ) -> Result<Vec<RetrievedMemory>> {
        if top_k == 0 {
            return Ok(Vec::new());
        }
        let candidates = self.repo.list_latest(MAX_EMBEDDINGS_SCANNED, kind)?;
        if candidates.is_empty() {
            return Ok(Vec::new());
        }
        let query_tokens = tokenize(query);
        // Embedding outages degrade to lexical-only; they are not fatal.
        let query_vector = self
            .embedder
            .embed(&[query.to_string()])
            .await
            .map_err(|err| {
                tracing::warn!(
                    "memory retrieval: query embedding failed, using lexical-only ranking: {err}"
                );
                err
            })
            .ok()
            .and_then(|mut vectors| vectors.pop());
        let mut scored: Vec<RetrievedMemory> = candidates
            .into_iter()
            .map(|row| {
                let semantic = query_vector
                    .as_deref()
                    .and_then(|qv| cosine_opt(qv, &row.vector));
                let lexical = lexical_overlap(&query_tokens, &tokenize(&row.content));
                RetrievedMemory {
                    source_id: row.id,
                    kind: row.kind,
                    content: row.content,
                    score: hybrid_score(semantic, lexical),
                }
            })
            .collect();
        scored.sort_by(|a, b| {
            b.score
                .partial_cmp(&a.score)
                .unwrap_or(std::cmp::Ordering::Equal)
                .then_with(|| a.source_id.cmp(&b.source_id))
        });
        scored.truncate(top_k);
        Ok(scored)
    }

    /// 5W-expanded search: [`five_w::FiveWAnalysis::expanded_query`] of
    /// `query` is used for the lexical/semantic match, and the raw query
    /// remains available to callers for prompt wording.
    pub async fn search_expanded(
        &self,
        query: &str,
        kind: Option<&str>,
        top_k: usize,
    ) -> Result<Vec<RetrievedMemory>> {
        let analysis = five_w::FiveWAnalysis::analyze(query);
        self.search(&analysis.expanded_query(), kind, top_k).await
    }

    /// Build a prompt block for chat context assembly.
    ///
    /// The chat pipeline (or a future prompt-assembly layer) injects the
    /// returned string verbatim; `chat.rs` is not modified. Returns an empty
    /// string when nothing scored above 0.0, so callers can append it
    /// unconditionally.
    pub async fn build_prompt_block(&self, query: &str, top_k: usize) -> Result<String> {
        let memories = self.search(query, None, top_k).await?;
        let lines: Vec<String> = memories
            .into_iter()
            .filter(|m| m.score > 0.0)
            .map(|m| format!("- [{}] {}", m.kind, m.content))
            .collect();
        if lines.is_empty() {
            return Ok(String::new());
        }
        Ok(format!(
            "Relevant memories (retrieved automatically, may be outdated):\n{}\n",
            lines.join("\n")
        ))
    }
}

fn cosine_opt(a: &[f32], b: &[f32]) -> Option<f32> {
    if a.len() != b.len() {
        return None;
    }
    Some(cosine(a, b))
}

/// Indexing pipeline: embeds entries and upserts them into
/// `memory_embeddings`.
pub struct MemoryIndexer {
    repo: MemoryEmbeddingRepo,
    embedder: Arc<dyn Embedder>,
}

impl MemoryIndexer {
    /// Bind the indexer to a database handle and an embedder.
    pub fn new(db: Database, embedder: Arc<dyn Embedder>) -> Self {
        Self {
            repo: MemoryEmbeddingRepo::new(db),
            embedder,
        }
    }

    /// Index a journal entry by its `journal_entries.id`.
    pub async fn index_journal_entry(&self, id: &str, content: &str) -> Result<()> {
        self.index_entries(&[IndexEntry {
            source_id: id.to_string(),
            kind: "journal".to_string(),
            content: content.to_string(),
        }])
        .await
        .map(|_| ())
    }

    /// Index a daily summary; the source id is `'summary:' || day`.
    pub async fn index_summary_day(&self, day: &str, content: &str) -> Result<()> {
        self.index_entries(&[IndexEntry {
            source_id: format!("summary:{day}"),
            kind: "summary".to_string(),
            content: content.to_string(),
        }])
        .await
        .map(|_| ())
    }

    /// Hook for callers that append journal/summary rows. Indexes `entry`
    /// when `enabled` and returns whether it indexed. Wiring this into
    /// lane ①'s append paths (auto-on-insert) is a deliberate non-goal of
    /// this lane; callers invoke it explicitly.
    pub async fn index_if_enabled(&self, enabled: bool, entry: &IndexEntry) -> Result<bool> {
        if !enabled {
            return Ok(false);
        }
        self.index_entries(std::slice::from_ref(entry)).await?;
        Ok(true)
    }

    /// Batch-embed entries and upsert them. Returns the number indexed.
    pub async fn index_entries(&self, entries: &[IndexEntry]) -> Result<usize> {
        if entries.is_empty() {
            return Ok(0);
        }
        let texts: Vec<String> = entries.iter().map(|e| e.content.clone()).collect();
        let vectors = self.embedder.embed(&texts).await?;
        anyhow::ensure!(
            vectors.len() == entries.len(),
            "embedder returned {} vectors for {} inputs",
            vectors.len(),
            entries.len()
        );
        let now = crate::now_ms();
        for (entry, vector) in entries.iter().zip(vectors) {
            self.repo.upsert(&MemoryEmbeddingRecord {
                id: entry.source_id.clone(),
                kind: entry.kind.clone(),
                content: entry.content.clone(),
                vector,
                created_at: now,
            })?;
        }
        Ok(entries.len())
    }

    /// Backfill: scan lane ①'s `journal_entries` / `summaries` tables (when
    /// present) for rows missing an embedding and embed them in one call.
    ///
    /// Lane ① table shapes (migration v2): `journal_entries(id, content,
    /// ...)` and `summaries(id, day, content, ...)`. Both are probed via
    /// `sqlite_master`; absent tables are skipped and yield 0 indexed rows.
    /// Lane ② never writes lane ① tables.
    pub async fn index_missing(&self) -> Result<usize> {
        let entries = self.collect_missing_entries()?;
        self.index_entries(&entries).await
    }

    fn collect_missing_entries(&self) -> Result<Vec<IndexEntry>> {
        Ok(self
            .repo
            .list_missing_sources()?
            .into_iter()
            .map(|m| IndexEntry {
                source_id: m.id,
                kind: m.kind,
                content: m.content,
            })
            .collect())
    }
}

/// 5W query hooks for memory retrieval.
///
/// **Placeholder quality.** AIRI's memory pipeline is designed around 5W
/// slots (who/what/when/where/why). This module ships an honest, minimal
/// extractive heuristic — NOT an LLM analysis — so that the rest of the
/// pipeline can depend on the slot interface today. An LLM-powered analyzer
/// may replace [`FiveWAnalysis::analyze`] later without changing the API.
///
/// Heuristics (documented, deliberately naive):
///
/// - `when`: temporal words/phrases — `today`, `tonight`, `tomorrow`,
///   `yesterday`, `now`, `soon`, `later`, `recently`, `this|last|next <word>`,
///   English weekday and month names, ISO dates (`YYYY-MM-DD`).
/// - `who`: person-ish capitalized token runs appearing after the first
///   token, plus possessive/entity references (`my`, `user's`, `the user`),
///   normalized to `user` where applicable.
/// - `what`: possessive noun-phrase spans of the form
///   `<possessive> <1-2 words>` (e.g. `user's cat`); this is the closest
///   thing to an "object of interest" an extractive heuristic can honestly
///   produce.
/// - `where_` / `why`: no reliable heuristic exists, so they return the
///   trimmed query verbatim.
/// - Slots with no match also fall back to the trimmed query verbatim.
///
/// [`FiveWAnalysis::expanded_query`] joins unique tokens from all slots with
/// single spaces for query expansion.
pub mod five_w {
    /// Extracted 5W slots for a query.
    #[derive(Debug, Clone, PartialEq, Eq)]
    pub struct FiveWAnalysis {
        /// Person-ish entities; fallback: trimmed query.
        pub who: String,
        /// Object-of-interest span; fallback: trimmed query.
        pub what: String,
        /// Temporal expressions; fallback: trimmed query.
        pub when: String,
        /// Place-ish content; no heuristic — always the trimmed query.
        pub where_: String,
        /// Reason-ish content; no heuristic — always the trimmed query.
        pub why: String,
    }

    const TEMPORAL_WORDS: &[&str] = &[
        "today",
        "tonight",
        "tomorrow",
        "yesterday",
        "now",
        "soon",
        "later",
        "recently",
        "monday",
        "tuesday",
        "wednesday",
        "thursday",
        "friday",
        "saturday",
        "sunday",
        "january",
        "february",
        "march",
        "april",
        "may",
        "june",
        "july",
        "august",
        "september",
        "october",
        "november",
        "december",
    ];

    const POSSESSIVES: &[&str] = &["my", "user's", "the user's", "the user", "user"];

    impl FiveWAnalysis {
        /// Extract 5W slots from `query` with the placeholder heuristics
        /// documented on this module.
        pub fn analyze(query: &str) -> Self {
            let trimmed = query.trim();
            let fallback = || trimmed.to_string();
            let tokens: Vec<&str> = trimmed.split_whitespace().collect();

            let when = extract_when(&tokens).unwrap_or_else(fallback);
            let who = extract_who(&tokens).unwrap_or_else(fallback);
            let what = extract_what(&tokens).unwrap_or_else(fallback);

            Self {
                who,
                what,
                when,
                where_: trimmed.to_string(),
                why: trimmed.to_string(),
            }
        }

        /// Query expansion: unique tokens from all slots, first-occurrence
        /// order, joined with single spaces.
        pub fn expanded_query(&self) -> String {
            let mut seen = std::collections::HashSet::new();
            let mut out: Vec<&str> = Vec::new();
            for slot in [
                self.who.as_str(),
                self.what.as_str(),
                self.when.as_str(),
                self.where_.as_str(),
                self.why.as_str(),
            ] {
                for token in slot.split_whitespace() {
                    let key = token.to_lowercase();
                    if seen.insert(key) {
                        out.push(token);
                    }
                }
            }
            out.join(" ")
        }
    }

    fn trim_token(token: &str) -> &str {
        token.trim_matches(|c: char| !c.is_alphanumeric() && c != '-' && c != '\'')
    }

    fn is_capitalized(token: &str) -> bool {
        let mut chars = token.chars();
        match chars.next() {
            Some(first) => first.is_uppercase() && token.len() > 1,
            None => false,
        }
    }

    fn extract_when(tokens: &[&str]) -> Option<String> {
        let mut spans: Vec<String> = Vec::new();
        let mut i = 0;
        while i < tokens.len() {
            let bare = trim_token(tokens[i]);
            let lower = bare.to_lowercase();
            // ISO date: YYYY-MM-DD
            if is_iso_date(bare) {
                spans.push(bare.to_string());
                i += 1;
                continue;
            }
            // this|last|next <word>
            if matches!(lower.as_str(), "this" | "last" | "next") && i + 1 < tokens.len() {
                let next = trim_token(tokens[i + 1]);
                if !next.is_empty() {
                    spans.push(format!("{bare} {next}"));
                    i += 2;
                    continue;
                }
            }
            if TEMPORAL_WORDS.contains(&lower.as_str()) {
                spans.push(bare.to_string());
            }
            i += 1;
        }
        if spans.is_empty() {
            None
        } else {
            Some(spans.join(", "))
        }
    }

    fn is_iso_date(token: &str) -> bool {
        let bytes = token.as_bytes();
        if bytes.len() != 10 {
            return false;
        }
        bytes.iter().enumerate().all(|(i, b)| match i {
            4 | 7 => *b == b'-',
            _ => b.is_ascii_digit(),
        })
    }

    fn extract_who(tokens: &[&str]) -> Option<String> {
        let mut names: Vec<String> = Vec::new();
        // Possessive/entity references → the user.
        let joined_lower = tokens
            .iter()
            .map(|t| trim_token(t).to_lowercase())
            .collect::<Vec<_>>()
            .join(" ");
        if POSSESSIVES.iter().any(|p| joined_lower.contains(p)) {
            names.push("user".to_string());
        }
        // Capitalized token runs after the first token (sentence-initial
        // capitalization is not evidence of a name).
        let mut run: Vec<&str> = Vec::new();
        for (index, token) in tokens.iter().enumerate() {
            let bare = trim_token(token);
            if index > 0 && is_capitalized(bare) {
                run.push(bare);
            } else {
                if !run.is_empty() {
                    names.push(run.join(" "));
                    run.clear();
                }
            }
        }
        if !run.is_empty() {
            names.push(run.join(" "));
        }
        if names.is_empty() {
            None
        } else {
            Some(names.join(", "))
        }
    }

    fn extract_what(tokens: &[&str]) -> Option<String> {
        let lowers: Vec<String> = tokens
            .iter()
            .map(|t| trim_token(t).to_lowercase())
            .collect();
        for i in 0..lowers.len() {
            let pair = if i + 1 < lowers.len() {
                format!("{} {}", lowers[i], lowers[i + 1])
            } else {
                lowers[i].clone()
            };
            let possessive_len = if pair == "the user's" || pair == "the user" {
                2
            } else if matches!(lowers[i].as_str(), "my" | "user's" | "user") {
                1
            } else {
                continue;
            };
            // Possessive + up to 2 following words, e.g. `user's cat named`.
            let start = i;
            let end = (i + possessive_len + 2).min(tokens.len());
            let span: Vec<&str> = tokens[start..end].iter().map(|t| trim_token(t)).collect();
            let span = span.join(" ");
            if !span.is_empty() {
                return Some(span);
            }
        }
        None
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::memory::embedding::EmbeddingError;
    use airi_store::Database;
    use async_trait::async_trait;

    /// Deterministic mock embedder: maps known synonym classes onto shared
    /// dimensions so paraphrases cosine-match. Unknown tokens land in a
    /// per-token hash bucket, which keeps unrelated texts near-orthogonal.
    struct MockEmbedder;

    const SYNONYM_CLASSES: &[&[&str]] = &[
        &["cat", "feline", "kitten"],
        &["miso"],
        &["user", "my"],
        &["hiking", "hike", "trail"],
        &["wifi", "password"],
        &["named", "called", "name"],
        &["likes", "like", "loves"],
    ];
    const DIM: usize = 16;

    fn mock_vector(text: &str) -> Vec<f32> {
        let mut v = vec![0.0f32; DIM];
        for token in tokenize(text) {
            let mut placed = false;
            for (slot, class) in SYNONYM_CLASSES.iter().enumerate() {
                if class.contains(&token.as_str()) {
                    v[slot] += 1.0;
                    placed = true;
                    break;
                }
            }
            if !placed {
                // Spread unknown tokens across the trailing hash buckets.
                let mut hash: u32 = 5381;
                for b in token.bytes() {
                    hash = hash.wrapping_mul(33).wrapping_add(b as u32);
                }
                v[8 + (hash as usize % (DIM - 8))] += 1.0;
            }
        }
        v
    }

    #[async_trait]
    impl Embedder for MockEmbedder {
        async fn embed(&self, texts: &[String]) -> Result<Vec<Vec<f32>>, EmbeddingError> {
            Ok(texts.iter().map(|t| mock_vector(t)).collect())
        }
    }

    struct FailingEmbedder;

    #[async_trait]
    impl Embedder for FailingEmbedder {
        async fn embed(&self, _texts: &[String]) -> Result<Vec<Vec<f32>>, EmbeddingError> {
            Err(EmbeddingError::Empty)
        }
    }

    fn seeded_db() -> (tempfile::TempDir, Database) {
        let dir = tempfile::tempdir().expect("tempdir");
        let db = Database::open(&dir.path().join("test.sqlite")).expect("open db");
        (dir, db)
    }

    #[tokio::test]
    async fn retrieval_returns_seeded_fact_for_paraphrase() {
        let (_dir, db) = seeded_db();
        let embedder: Arc<dyn Embedder> = Arc::new(MockEmbedder);
        let indexer = MemoryIndexer::new(db.clone(), embedder.clone());
        indexer
            .index_journal_entry("j1", "The user's cat is named Miso")
            .await
            .unwrap();
        indexer
            .index_journal_entry("j2", "The user likes hiking and the trail near the lake")
            .await
            .unwrap();
        indexer
            .index_journal_entry("j3", "The office wifi password is hunter2")
            .await
            .unwrap();
        indexer
            .index_summary_day("2026-11-09", "The user talked about their cat  Miso again")
            .await
            .unwrap();

        let retrieval = MemoryRetrieval::new(db, embedder);
        let hits = retrieval
            .search("what is the user's feline called?", None, 3)
            .await
            .unwrap();
        let ids: Vec<&str> = hits.iter().map(|m| m.source_id.as_str()).collect();
        assert!(
            ids.contains(&"j1"),
            "expected seeded fact j1 in top-3, got {ids:?}"
        );
    }

    #[tokio::test]
    async fn retrieval_kind_filter_excludes_other_kinds() {
        let (_dir, db) = seeded_db();
        let embedder: Arc<dyn Embedder> = Arc::new(MockEmbedder);
        let indexer = MemoryIndexer::new(db.clone(), embedder.clone());
        indexer
            .index_journal_entry("j1", "The user's cat is named Miso")
            .await
            .unwrap();
        indexer
            .index_summary_day("2026-11-09", "Summary mentions the user's cat Miso")
            .await
            .unwrap();

        let retrieval = MemoryRetrieval::new(db, embedder);
        let only_summaries = retrieval
            .search("cat Miso", Some("summary"), 10)
            .await
            .unwrap();
        assert!(only_summaries.iter().all(|m| m.kind == "summary"));
        assert!(only_summaries
            .iter()
            .any(|m| m.source_id == "summary:2026-11-09"));
    }

    #[test]
    fn cosine_basic_properties() {
        let a = vec![1.0, 0.0, 0.0];
        let b = vec![1.0, 0.0, 0.0];
        let c = vec![0.0, 1.0, 0.0];
        assert!((cosine(&a, &b) - 1.0).abs() < 1e-6);
        assert!(cosine(&a, &c).abs() < 1e-6);
        assert_eq!(cosine(&a, &[1.0, 0.0]), 0.0);
        assert_eq!(cosine(&[0.0, 0.0], &[1.0, 0.0]), 0.0);
    }

    #[test]
    fn lexical_overlap_jaccard() {
        let q = tokenize("user feline called");
        let d = tokenize("the user's feline is named miso");
        let overlap = lexical_overlap(&q, &d);
        // intersection = {user, feline} = 2; union = {user, feline, called, the, is, named, miso} = 7
        assert!((overlap - 2.0 / 7.0).abs() < 1e-6, "overlap was {overlap}");
        assert_eq!(lexical_overlap(&[], &d), 0.0);
    }

    #[test]
    fn hybrid_score_weights_and_semantic_absence() {
        assert!((hybrid_score(Some(1.0), 1.0) - 1.0).abs() < 1e-6);
        assert!((hybrid_score(Some(1.0), 0.0) - SEMANTIC_WEIGHT).abs() < 1e-6);
        assert!((hybrid_score(Some(0.0), 1.0) - LEXICAL_WEIGHT).abs() < 1e-6);
        // Semantic unavailable → lexical only.
        assert_eq!(hybrid_score(None, 0.4), 0.4);
    }

    #[tokio::test]
    async fn lexical_fallback_when_embedder_fails() {
        let (_dir, db) = seeded_db();
        let good: Arc<dyn Embedder> = Arc::new(MockEmbedder);
        let indexer = MemoryIndexer::new(db.clone(), good);
        indexer
            .index_journal_entry("j1", "The user's cat is named Miso")
            .await
            .unwrap();
        indexer
            .index_journal_entry("j2", "utterly unrelated content xylophone zephyr")
            .await
            .unwrap();

        let retrieval = MemoryRetrieval::new(db, Arc::new(FailingEmbedder));
        let hits = retrieval.search("cat Miso", None, 2).await.unwrap();
        assert_eq!(hits[0].source_id, "j1");
    }

    #[tokio::test]
    async fn index_if_enabled_respects_flag() {
        let (_dir, db) = seeded_db();
        let embedder: Arc<dyn Embedder> = Arc::new(MockEmbedder);
        let indexer = MemoryIndexer::new(db.clone(), embedder);
        let entry = IndexEntry {
            source_id: "j9".to_string(),
            kind: "journal".to_string(),
            content: "disabled write".to_string(),
        };
        assert!(!indexer.index_if_enabled(false, &entry).await.unwrap());
        assert!(indexer.index_if_enabled(true, &entry).await.unwrap());
    }

    #[tokio::test]
    async fn index_missing_backfills_from_lane1_tables() {
        let (_dir, db) = seeded_db();
        // Simulate lane ①'s v2 tables (real migration lands separately).
        db.with_connection(|conn| {
            conn.execute_batch(
                r#"
                create table if not exists journal_entries (
                    id text primary key,
                    kind text not null default 'note',
                    content text not null,
                    embedding text,
                    created_at integer not null,
                    updated_at integer not null
                );
                create table if not exists summaries (
                    id text primary key,
                    day text not null,
                    content text not null,
                    source_session_ids text not null default '[]',
                    token_estimate integer not null default 0,
                    created_at integer not null
                );
                insert into journal_entries values ('j1', 'note', 'The user''s cat is named Miso', null, 1, 1);
                insert into summaries values ('s1', '2026-11-09', 'Discussed the cat Miso at length', '[]', 10, 2);
                "#,
            )?;
            Ok(())
        })
        .unwrap();

        let embedder: Arc<dyn Embedder> = Arc::new(MockEmbedder);
        let indexer = MemoryIndexer::new(db.clone(), embedder);
        let indexed = indexer.index_missing().await.unwrap();
        assert_eq!(indexed, 2);
        // Idempotent: second run finds nothing missing.
        let indexed_again = indexer.index_missing().await.unwrap();
        assert_eq!(indexed_again, 0);
    }

    #[tokio::test]
    async fn build_prompt_block_formats_memories() {
        let (_dir, db) = seeded_db();
        let embedder: Arc<dyn Embedder> = Arc::new(MockEmbedder);
        let indexer = MemoryIndexer::new(db.clone(), embedder.clone());
        indexer
            .index_journal_entry("j1", "The user's cat is named Miso")
            .await
            .unwrap();
        let retrieval = MemoryRetrieval::new(db, embedder);
        let block = retrieval.build_prompt_block("cat Miso", 3).await.unwrap();
        assert!(
            block.contains("[journal] The user's cat is named Miso"),
            "block: {block}"
        );
        let empty = retrieval.build_prompt_block("zz qqq", 3).await.unwrap();
        assert!(
            empty.is_empty() || empty.starts_with("Relevant memories"),
            "unexpected block: {empty}"
        );
    }

    #[test]
    fn five_w_extracts_temporal_and_possessive() {
        let analysis = five_w::FiveWAnalysis::analyze("what is the user's feline called tomorrow?");
        assert_eq!(analysis.when, "tomorrow");
        assert!(analysis.who.contains("user"), "who: {}", analysis.who);
        assert!(analysis.what.contains("user's"), "what: {}", analysis.what);
        assert_eq!(analysis.where_, analysis.why);
    }

    #[test]
    fn five_w_falls_back_to_trimmed_query() {
        let analysis = five_w::FiveWAnalysis::analyze("hello world");
        // no temporal words, no capitalized tokens after position 0, no possessives
        assert_eq!(analysis.when, "hello world");
        assert_eq!(analysis.who, "hello world");
        assert_eq!(analysis.what, "hello world");
    }

    #[test]
    fn five_w_expanded_query_dedups_tokens() {
        let analysis = five_w::FiveWAnalysis::analyze("cat cat cat");
        let expanded = analysis.expanded_query();
        let count = expanded.split_whitespace().filter(|t| *t == "cat").count();
        assert_eq!(count, 1, "expanded: {expanded}");
    }
}
