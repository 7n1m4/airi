// SPDX-License-Identifier: GPL-3.0-or-later
#![deny(missing_docs)]

//! Short-term memory: daily summary blocks.
//!
//! Ported from the Electron store `packages/stage-ui/src/stores/memory-short-term.ts`.
//! Semantics kept:
//!
//! - One summary block per local-calendar day, keyed by a `YYYY-MM-DD`
//!   string.
//! - A per-day token budget ([`ShortTermMemoryConfig::token_budget_per_day`],
//!   default 1000, mirroring the card extension `tokenBudgetPerDay` default).
//! - A `max_days` retention cap (default 365), enforced by
//!   [`SummaryRepo::prune_over_days`](airi_store::SummaryRepo::prune_over_days).
//! - Transcript cap of [`MAX_SOURCE_CHARS_PER_DAY`] (24_000 chars).
//! - `window_size` days (default 3, mirroring `windowSize`) considered for
//!   prompt injection via [`ShortTermMemoryService::build_context`].
//!
//! Not ported (Electron-only, single-user desktop): character cards as
//! summarizer context (the Rust core has no card store yet),
//! universe/user scoping, broadcast-channel sync, `ensureYesterdayBlock`
//! scheduling, and IndexedDB normalization layers.
//!
//! Summaries are generated through the same provider table the chat pipeline
//! uses (registered `ChatProvider` clients, falling back to the static
//! `airi_llm` registry); there is intentionally no separate HTTP path.

use std::collections::HashMap;
use std::sync::{Arc, Mutex};

use airi_llm::{ChatMessage, ChatProvider, ChatRequest, ProviderConfig, ProviderRegistry, Role};
use airi_store::{Database, MessageRepo, StoredSession, StoredSummary, SummaryRepo};
use anyhow::{bail, Context, Result};

use crate::chat::collect_completion;
use crate::{new_id, now_ms};

/// Maximum characters of transcript fed to the summarizer (mirrors the
/// Electron `MAX_SOURCE_CHARS_PER_DAY`).
pub const MAX_SOURCE_CHARS_PER_DAY: usize = 24_000;

/// Short-term memory tuning.
///
/// Defaults mirror the Electron card extension defaults: `windowSize = 3`,
/// `tokenBudgetPerDay = 1000`, and the plan's 365-day retention cap.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ShortTermMemoryConfig {
    /// Days of summaries considered "current" for prompt injection.
    pub window_size: u32,
    /// Target token budget per daily summary (and per day injected into the
    /// prompt context).
    pub token_budget_per_day: u64,
    /// Maximum number of distinct days retained.
    pub max_days: u32,
}

impl Default for ShortTermMemoryConfig {
    fn default() -> Self {
        Self {
            window_size: 3,
            token_budget_per_day: 1000,
            max_days: 365,
        }
    }
}

/// Rough token estimate: whitespace-split words × 1.33, rounded up.
///
/// The Electron side uses a CJK-aware counter (`estimateTokens`); this keeps
/// the simpler plan-specified approximation. Non-empty text estimates at
/// least 1 token; empty text estimates 0.
pub fn estimate_tokens(text: &str) -> u64 {
    let trimmed = text.trim();
    if trimmed.is_empty() {
        return 0;
    }
    let words = trimmed.split_whitespace().count() as f64;
    ((words * 1.33).ceil() as u64).max(1)
}

/// Truncate a raw model completion to the token budget: keep whole words
/// up to `floor(budget / 1.33)` and append an ellipsis when truncated.
fn sanitize_summary(raw: &str, token_budget: u64) -> String {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return String::new();
    }
    if estimate_tokens(trimmed) <= token_budget {
        return trimmed.to_string();
    }
    let word_budget = ((token_budget as f64) / 1.33).floor().max(1.0) as usize;
    let kept: Vec<&str> = trimmed.split_whitespace().take(word_budget).collect();
    let mut out = kept.join(" ");
    out.push('…');
    out
}

/// Validate a `YYYY-MM-DD` day key (shape check only; ranges unchecked).
fn validate_day(day: &str) -> Result<()> {
    let bytes = day.as_bytes();
    let ok = bytes.len() == 10
        && bytes.iter().enumerate().all(|(i, b)| match i {
            4 | 7 => *b == b'-',
            _ => b.is_ascii_digit(),
        });
    if !ok {
        bail!("day must be a YYYY-MM-DD key, got {day:?}");
    }
    Ok(())
}

/// Build the summarizer prompt (mirrors the Electron `buildSummarizerMessages`,
/// minus character-card context, which the Rust core has no store for yet).
fn build_summarizer_messages(day: &str, transcript: &str, target_tokens: u64) -> Vec<ChatMessage> {
    let system = [
        "You summarize one local-calendar day of chat history into a compact short-term memory block for future session continuity.",
        "Write concise markdown only.",
        "Use the same main language(s) as the chat history for the summary.",
        "Focus on salient events, emotional tone shifts, promises or plans, preferences, facts worth remembering, and unresolved threads.",
        "Do not roleplay. Do not embellish. Do not invent facts. Do not quote large chunks of dialogue.",
        &format!("Aim for roughly {target_tokens} tokens or less unless the day is unusually dense."),
    ]
    .join("\n");
    let user = [
        format!("Date: {day}"),
        format!("Transcript:\n{transcript}"),
        "Produce a single dense markdown summary block that future sessions can load as hidden continuity context.".to_string(),
    ]
    .join("\n\n");
    vec![
        ChatMessage {
            role: Role::System,
            content: system,
            tool_call_id: None,
        },
        ChatMessage {
            role: Role::User,
            content: user,
            tool_call_id: None,
        },
    ]
}

/// Short-term memory service: daily summary generation, persistence, and
/// prompt-context assembly.
///
/// Cheap to clone; clones share the database, the provider table, and the
/// summary repository.
#[derive(Clone)]
pub struct ShortTermMemoryService {
    summaries: SummaryRepo,
    messages: MessageRepo,
    /// LLM clients by provider id (shared with the chat pipeline when built
    /// with [`ShortTermMemoryService::with_shared_providers`]); checked
    /// before the static registry.
    pub providers: Arc<Mutex<HashMap<String, Arc<dyn ChatProvider>>>>,
    registry: ProviderRegistry,
    config: ShortTermMemoryConfig,
}

impl ShortTermMemoryService {
    /// Create a service with its own (empty) provider table; providers are
    /// then resolved through the static `airi_llm` registry.
    pub fn new(db: Database) -> Self {
        Self::with_shared_providers(db, Arc::new(Mutex::new(HashMap::new())), Default::default())
    }

    /// Create a service sharing an existing provider table and using an
    /// explicit configuration.
    pub fn with_shared_providers(
        db: Database,
        providers: Arc<Mutex<HashMap<String, Arc<dyn ChatProvider>>>>,
        config: ShortTermMemoryConfig,
    ) -> Self {
        Self {
            summaries: SummaryRepo::new(db.clone()),
            messages: MessageRepo::new(db),
            providers,
            registry: ProviderRegistry::new(),
            config,
        }
    }

    /// Register an LLM client under a provider id (replacing any previous
    /// one), mirroring [`crate::chat::ChatService::register_client`].
    pub fn register_client(&self, provider_id: impl Into<String>, client: Arc<dyn ChatProvider>) {
        self.providers
            .lock()
            .expect("providers mutex poisoned")
            .insert(provider_id.into(), client);
    }

    /// The configuration this service was built with.
    pub fn config(&self) -> ShortTermMemoryConfig {
        self.config
    }

    /// Summarize one local-calendar day and persist the resulting block.
    ///
    /// `sessions` are the sessions attributed to `day` by the caller (the
    /// Electron side buckets sessions by day via
    /// `collectCharacterDayBuckets`; bucketing lives outside this service).
    /// Messages are filtered to `user`/`assistant` with non-empty trimmed
    /// content; the transcript is capped at [`MAX_SOURCE_CHARS_PER_DAY`].
    ///
    /// The summary is generated through `provider_id` (registered client
    /// first, registry fallback) and truncated to
    /// [`ShortTermMemoryConfig::token_budget_per_day`]. An empty provider
    /// response, a day with no summarizable content, or an unknown provider
    /// are errors.
    pub async fn summarize_day(
        &self,
        day: &str,
        sessions: &[StoredSession],
        provider_id: &str,
        config: ProviderConfig,
        model: &str,
    ) -> Result<StoredSummary> {
        validate_day(day)?;

        let mut lines = Vec::new();
        let mut session_ids = Vec::new();
        for session in sessions {
            let history = self.messages.list(&session.id)?;
            let mut count_for_session = 0usize;
            for message in &history {
                if message.role != "user" && message.role != "assistant" {
                    continue;
                }
                let text = message.content.trim();
                if text.is_empty() {
                    continue;
                }

                let label = if message.role == "user" {
                    "User"
                } else {
                    "Assistant"
                };
                lines.push(format!("{label}: {text}"));
                count_for_session += 1;
            }
            if count_for_session > 0 {
                session_ids.push(session.id.clone());
            }
        }

        let transcript_full = lines.join("\n");
        let transcript: String = transcript_full
            .chars()
            .take(MAX_SOURCE_CHARS_PER_DAY)
            .collect();
        if transcript.trim().is_empty() {
            bail!("no summarizable user/assistant content for day {day}");
        }

        let budget = self.config.token_budget_per_day;
        let request = ChatRequest {
            model: model.to_string(),
            messages: build_summarizer_messages(day, &transcript, budget),
            system: None,
            temperature: None,
            max_tokens: None,
            tools: Vec::new(),
        };
        let client =
            // No settings store handle here; the native llama-cpp-local
            // provider resolves through env (AIRI_QT_LLAMA_MODEL) plus the
            // default settings blob.
            crate::chat::resolve_provider(&self.providers, &self.registry, provider_id, config, None)
                .await
                .with_context(|| format!("summarizer provider unavailable: {provider_id}"))?;
        let raw = collect_completion(&*client, request).await?;
        let summary = sanitize_summary(&raw, budget);
        if summary.is_empty() {
            bail!("provider returned an empty summary for day {day}");
        }

        let estimate = estimate_tokens(&summary);
        let record = StoredSummary {
            id: new_id(),
            day: day.to_string(),
            content: summary,
            source_session_ids: session_ids,
            token_estimate: i64::try_from(estimate).unwrap_or(i64::MAX),
            created_at: now_ms(),
        };
        self.summaries.insert(&record)?;
        Ok(record)
    }

    /// Build the prompt-injection context for the given days' summaries.
    ///
    /// Blocks are emitted chronologically (oldest day first) in the Electron
    /// `[PAST CONTINUITY / DAILY SUMMARIES]` format, one `Date: <day>`
    /// section per stored summary. The combined budget is
    /// `days.len() * token_budget_per_day`; a block that would exceed the
    /// remaining budget is skipped entirely (never partially injected).
    /// Returns an empty string when there is nothing worth injecting.
    pub fn build_context(&self, days: &[String]) -> Result<String> {
        let mut unique: Vec<String> = days.to_vec();
        unique.sort();
        unique.dedup();
        if unique.is_empty() {
            return Ok(String::new());
        }

        let mut budget = (unique.len() as u64) * self.config.token_budget_per_day;
        let mut blocks: Vec<String> = Vec::new();
        for day in &unique {
            for summary in self.summaries.list_by_day(day)? {
                let block = format!("Date: {}\n{}", summary.day, summary.content);
                let cost = estimate_tokens(&block);
                if cost > budget {
                    continue;
                }
                budget = budget.saturating_sub(cost);
                blocks.push(block);
            }
        }
        if blocks.is_empty() {
            return Ok(String::new());
        }

        let mut parts = vec![
            "[PAST CONTINUITY / DAILY SUMMARIES]".to_string(),
            "The following daily continuity blocks were distilled from recent chat history from previous days. Use them as background continuity context:".to_string(),
        ];
        parts.extend(blocks);
        Ok(parts.join("\n\n"))
    }

    /// Prune summaries older than [`ShortTermMemoryConfig::max_days`]
    /// distinct days; returns the number of deleted rows.
    pub fn prune(&self) -> Result<usize> {
        self.summaries.prune_over_days(self.config.max_days)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use airi_llm::{ChatChunk, ChatStream, ModelInfo};
    use airi_store::{MessageRepo, SessionRepo};
    use async_trait::async_trait;
    use tempfile::tempdir;

    /// Scripted mock provider (same shape as the chat.rs test mock).
    struct MockChatClient {
        deltas: Vec<String>,
    }

    impl MockChatClient {
        fn scripted(deltas: &[&str]) -> Self {
            Self {
                deltas: deltas.iter().map(|d| d.to_string()).collect(),
            }
        }
    }

    #[async_trait]
    impl ChatProvider for MockChatClient {
        fn id(&self) -> &str {
            "mock"
        }

        async fn models(&self) -> Result<Vec<ModelInfo>, airi_llm::LlmError> {
            Ok(vec![ModelInfo {
                id: "mock-model".to_string(),
                owned_by: None,
            }])
        }

        async fn stream(&self, _req: ChatRequest) -> Result<ChatStream, airi_llm::LlmError> {
            let mut events: Vec<Result<ChatChunk, airi_llm::LlmError>> = self
                .deltas
                .iter()
                .map(|d| Ok(ChatChunk::text(d.clone())))
                .collect();
            events.push(Ok(ChatChunk::finish("stop")));
            Ok(Box::pin(futures_util::stream::iter(events)))
        }
    }

    fn test_db() -> (tempfile::TempDir, Database) {
        let dir = tempdir().expect("tempdir");
        let db = Database::open(&dir.path().join("stm.sqlite")).expect("open db");
        (dir, db)
    }

    fn seed_session(
        db: &Database,
        id: &str,
        title: &str,
        messages: &[(&str, &str)],
    ) -> StoredSession {
        let sessions = SessionRepo::new(db.clone());
        let session = sessions.create(id, title).expect("create session");
        let repo = MessageRepo::new(db.clone());
        for (i, (role, content)) in messages.iter().enumerate() {
            repo.insert(&airi_store::StoredMessage {
                id: format!("{id}-m{i}"),
                session_id: id.to_string(),
                role: role.to_string(),
                content: content.to_string(),
                created_at: (i as i64 + 1) * 1_000,
                metadata: serde_json::json!({}),
            })
            .expect("insert message");
        }
        session
    }

    #[test]
    fn estimate_tokens_counts_words() {
        assert_eq!(estimate_tokens(""), 0);
        assert_eq!(estimate_tokens("   "), 0);
        assert_eq!(estimate_tokens("hello"), 2); // 1 * 1.33 -> 2
        assert_eq!(estimate_tokens("one two three four"), 6); // 4 * 1.33 -> 6
    }

    #[test]
    fn sanitize_summary_truncates_to_budget() {
        let raw = "word ".repeat(500);
        let out = sanitize_summary(&raw, 10);
        assert!(estimate_tokens(&out) <= 10);
        assert!(out.ends_with('…'));
        assert_eq!(sanitize_summary("short text", 100), "short text");
        assert_eq!(sanitize_summary("   ", 100), "");
    }

    #[test]
    fn validate_day_shape() {
        assert!(validate_day("2026-11-10").is_ok());
        assert!(validate_day("2026-1-1").is_err());
        assert!(validate_day("not-a-day").is_err());
        assert!(validate_day("20261110").is_err());
    }

    #[tokio::test]
    async fn summarize_day_generates_persists_and_feeds_context() {
        let (_dir, db) = test_db();
        let session = seed_session(
            &db,
            "s1",
            "Weekend plans",
            &[
                ("user", "I want to rebuild the deck this weekend"),
                ("assistant", "Sounds good — I'll reserve Saturday morning."),
            ],
        );

        let svc = ShortTermMemoryService::new(db.clone());
        svc.register_client(
            "mock",
            Arc::new(MockChatClient::scripted(&[
                "- User plans a deck rebuild this weekend\n",
                "- Assistant reserved Saturday morning\n",
            ])),
        );

        let summary = svc
            .summarize_day(
                "2026-11-10",
                std::slice::from_ref(&session),
                "mock",
                ProviderConfig::default(),
                "mock-model",
            )
            .await
            .unwrap();

        assert_eq!(summary.day, "2026-11-10");
        assert!(summary.content.contains("deck rebuild"));
        assert_eq!(summary.source_session_ids, vec!["s1".to_string()]);
        assert!(summary.token_estimate > 0);

        // Persisted and retrievable.
        let stored = SummaryRepo::new(db.clone())
            .list_by_day("2026-11-10")
            .unwrap();
        assert_eq!(stored.len(), 1);
        assert_eq!(stored[0].id, summary.id);

        // A second day summarizes through the same service.
        svc.summarize_day(
            "2026-11-09",
            std::slice::from_ref(&session),
            "mock",
            ProviderConfig::default(),
            "mock-model",
        )
        .await
        .unwrap();

        let ctx = svc
            .build_context(&["2026-11-10".to_string(), "2026-11-09".to_string()])
            .unwrap();
        assert!(ctx.contains("[PAST CONTINUITY / DAILY SUMMARIES]"));
        assert!(ctx.contains("Date: 2026-11-09"));
        assert!(ctx.contains("Date: 2026-11-10"));
        assert!(ctx.contains("deck rebuild"));
        // Chronological order, regardless of argument order.
        assert!(ctx.find("Date: 2026-11-09").unwrap() < ctx.find("Date: 2026-11-10").unwrap());
    }

    #[tokio::test]
    async fn summarize_day_errors_without_summarizable_content() {
        let (_dir, db) = test_db();
        let session = seed_session(
            &db,
            "empty",
            "Nothing",
            &[("system", "ignored role"), ("tool", "also ignored")],
        );
        let svc = ShortTermMemoryService::new(db.clone());
        svc.register_client("mock", Arc::new(MockChatClient::scripted(&["unused"])));
        let err = svc
            .summarize_day(
                "2026-11-10",
                std::slice::from_ref(&session),
                "mock",
                ProviderConfig::default(),
                "mock-model",
            )
            .await
            .unwrap_err();
        assert!(format!("{err:#}").contains("no summarizable"));
    }

    #[tokio::test]
    async fn summarize_day_rejects_bad_day_and_unknown_provider() {
        let (_dir, db) = test_db();
        let session = seed_session(&db, "s", "t", &[("user", "hi")]);
        let svc = ShortTermMemoryService::new(db.clone());
        assert!(svc
            .summarize_day(
                "11-10",
                std::slice::from_ref(&session),
                "mock",
                ProviderConfig::default(),
                "m"
            )
            .await
            .is_err());

        let session2 = seed_session(&db, "s2", "t", &[("user", "hi")]);
        let err = svc
            .summarize_day(
                "2026-11-10",
                std::slice::from_ref(&session2),
                "no-such-provider",
                ProviderConfig::default(),
                "m",
            )
            .await
            .unwrap_err();
        assert!(format!("{err:#}").contains("no-such-provider"));
    }

    #[tokio::test]
    async fn build_context_respects_combined_budget() {
        let (_dir, db) = test_db();
        let session = seed_session(
            &db,
            "s",
            "t",
            &[("user", "token talk"), ("assistant", "token token")],
        );
        let svc = ShortTermMemoryService::with_shared_providers(
            db.clone(),
            Arc::new(Mutex::new(HashMap::new())),
            ShortTermMemoryConfig {
                window_size: 3,
                token_budget_per_day: 1_000_000,
                max_days: 365,
            },
        );
        svc.register_client(
            "mock",
            Arc::new(MockChatClient::scripted(&["alpha fact", "beta fact"])),
        );
        for day in ["2026-11-09", "2026-11-10"] {
            svc.summarize_day(
                day,
                std::slice::from_ref(&session),
                "mock",
                ProviderConfig::default(),
                "mock-model",
            )
            .await
            .unwrap();
        }

        // A one-token-per-day combined budget cannot fit any block.
        let tight = ShortTermMemoryService::with_shared_providers(
            db.clone(),
            Arc::new(Mutex::new(HashMap::new())),
            ShortTermMemoryConfig {
                window_size: 3,
                token_budget_per_day: 1,
                max_days: 365,
            },
        );
        let ctx = tight
            .build_context(&["2026-11-09".to_string(), "2026-11-10".to_string()])
            .unwrap();
        assert_eq!(ctx, "");
    }

    #[test]
    fn build_context_empty_days_is_empty() {
        let (_dir, db) = test_db();
        let svc = ShortTermMemoryService::new(db);
        assert_eq!(svc.build_context(&[]).unwrap(), "");
    }

    #[test]
    fn prune_uses_configured_max_days() {
        let (_dir, db) = test_db();
        let repo = SummaryRepo::new(db.clone());
        for i in 0..5 {
            repo.insert(&StoredSummary {
                id: format!("s{i}"),
                day: format!("2026-11-{:02}", 10 + i),
                content: format!("day {i}"),
                source_session_ids: vec![],
                token_estimate: 1,
                created_at: i64::from(i),
            })
            .unwrap();
        }
        let svc = ShortTermMemoryService::with_shared_providers(
            db.clone(),
            Arc::new(Mutex::new(HashMap::new())),
            ShortTermMemoryConfig {
                window_size: 3,
                token_budget_per_day: 1000,
                max_days: 2,
            },
        );
        let deleted = svc.prune().unwrap();
        assert_eq!(deleted, 3);
        assert_eq!(repo.count().unwrap(), 2);
    }
}
