# P7 ① — Memory: session persistence polish, short-term memory, append-only text journal

Lane ① of the P7 plan. Lane ② (`p7-retrieval`) owns retrieval/embeddings and
migration v3 (`memory_embeddings`, `memory::embedding` / `memory::retrieval`);
those landed concurrently in the same working tree and are documented by
lane ②.

## What is implemented

### Session persistence polish (`airi-store`, `airi-core`)

- **Search** — `SessionRepo::search(query) -> Result<Vec<StoredSession>>`
  (`airi-store`). Case-insensitive substring match over `title` (SQLite
  `LIKE` semantics, ASCII folding), LIKE metacharacters in the query
  (`\`, `%`, `_`) escaped and bound as a parameter, `ORDER BY updated_at
  DESC LIMIT 50`, empty/whitespace query returns no rows.
- **Auto-titling** — `ChatService::maybe_auto_title` runs after the
  assistant's first reply completes (after `MessageDone`, awaited inline
  before `StreamOutcome` returns; inline chosen so the behavior is
  deterministic in tests — worst case is bounded by the 10 s
  `tokio::time::timeout`). Renames only empty/default
  (`"New chat"`, ASCII case-insensitive) titles with exactly one assistant
  message in the session; re-checks the title immediately before writing so
  a concurrent rename is never clobbered. Uses the same provider used for
  the chat (registered client, registry fallback) with `max_tokens: 32` and a
  "Reply with a 3-5 word title for this conversation" system prompt
  (mirrors the plan). Unconfigured/unresolvable provider → silent skip
  (`tracing::debug`); provider failure or timeout → `tracing::warn`,
  existing title kept. Titles sanitized: first non-empty line, wrapping
  quotes/backticks stripped, single-spaced, trailing punctuation removed,
  capped at 6 words / 64 chars.
- **Export** — `airi_core::sessions::export_jsonl(db, session_id) -> Result<String>`.
  One JSON object per line: line 0 is
  `{"type":"session","session":{...}}`, subsequent lines
  `{"type":"message","message":{...}}` in chronological order. No file I/O
  (CLI flag deferred).

### `summaries` table (`airi-store`, migration v2)

```sql
create table if not exists summaries (
  id text primary key,
  day text not null,           -- YYYY-MM-DD
  content text not null,
  source_session_ids text not null default '[]',   -- JSON array of session ids
  token_estimate integer not null default 0,
  created_at integer not null
);
create index if not exists idx_summaries_day on summaries(day);
```

`SummaryRepo`: `insert`, `list_by_day` (oldest first), `list_recent` (newest
day first, ties by `created_at`), `count`, plus `prune_over_365_days()` and a
parameterized `prune_over_days(max_days)` (used by the service config).

### `journal_entries` table (`airi-store`, migration v2)

```sql
create table if not exists journal_entries (
  id text primary key,
  kind text not null default 'note',  -- note | dream | milestone | summary
  content text not null,
  embedding text,                     -- JSON array<f32> | NULL
  created_at integer not null,
  updated_at integer not null         -- == created_at at insert; never mutated
);
create index if not exists idx_journal_created on journal_entries(created_at);
```

`JournalRepo` (append-only — **no** update/delete methods): `append(kind,
content, embedding)` with a kind whitelist and empty-content rejection,
`list_between(from_ms, to_ms, limit)` (oldest first), `list_recent` (newest
first), `count`.

`TextJournalService` (`airi-core::memory::journal`) facade: `append_note`,
`append_milestone`, `append_dream_gate_outcome`, `append(kind, _)`,
`append_with_embedding(kind, content, Vec<f32>)` (lane ② admission seam;
embeddings are otherwise NULL — the write path computes nothing), plus
`list_recent` / `list_between` / `count`. `JournalKind` is a typed enum
(`Note` | `Dream` | `Milestone` | `Summary`) mapped to the wire strings.

### Short-term memory (`airi-core::memory::short_term`)

`ShortTermMemoryConfig { window_size: u32 = 3, token_budget_per_day: u64 = 1000, max_days: u32 = 365 }`
(defaults mirror the Electron card-extension defaults `windowSize = 3`,
`tokenBudgetPerDay = 1000`, and the plan's 365-day cap).

`ShortTermMemoryService` (shared provider table optional via
`with_shared_providers`; own table + registry fallback by default,
`register_client` for direct injection):

- `summarize_day(day, sessions, provider_id, config, model) -> Result<StoredSummary>`
  — `YYYY-MM-DD` shape validated; messages filtered to user/assistant with
  non-empty trimmed content (roles outside that set are ignored); transcript
  capped at 24 000 chars (`MAX_SOURCE_CHARS_PER_DAY`, mirrors Electron);
  prompt mirrors `buildSummarizerMessages` (minus character-card context —
  no card store in Rust core); summary sanitized (whitespace-word × 1.33
  token estimate, truncated to budget); persisted via `SummaryRepo`;
  `source_session_ids` records only sessions that contributed ≥ 1 line.
- `build_context(days) -> Result<String>` — chronological (oldest day
  first), Electron `[PAST CONTINUITY / DAILY SUMMARIES]` block format,
  combined budget `days.len() * token_budget_per_day`; a block that would
  exceed the remaining budget is skipped wholly (never partially injected).
  Empty when nothing fits.
- `prune()` — deletes summaries beyond `config.max_days` distinct days.

## Migration version

`user_version` is now **3** in the working tree: lane ① landed the v2 step
(`summaries`, `journal_entries`) inside the existing `SCHEMA_VERSION`
framework with `if current < 2`, exactly as planned; lane ② then bumped the
constant to 3 and appended `if current < 3` (`memory_embeddings`) on top.
The v2 block is unchanged. Tests: fresh open applies everything (v3),
idempotent reopen, and an honest v1→ upgrade path simulation (drop v2
objects + `user_version = 1`, reopen, verify v1 rows survive and v2 tables
are recreated).

## Mock proof

- `memory::short_term::tests::summarize_day_generates_persists_and_feeds_context`
  — scripted mock `ChatProvider` → scripted session → summary generated →
  persisted (`list_by_day` round trip) → `build_context` contains the fact
  (`deck rebuild`) and both `Date:` sections.
- `memory::short_term::tests::summarize_day_errors_without_summarizable_content`,
  `summarize_day_rejects_bad_day_and_unknown_provider`,
  `build_context_respects_combined_budget` (1-token budget → empty string),
  `prune_uses_configured_max_days`.
- `chat::tests::auto_title_renames_default_title_after_first_reply`,
  `auto_title_keeps_custom_title`,
  `maybe_auto_title_skips_unconfigured_provider_and_multi_reply_sessions`,
  `is_default_title_recognizes_placeholder`,
  `sanitize_title_strips_quotes_punctuation_and_caps`.
- `sessions::tests::export_jsonl_emits_session_header_then_messages`,
  `export_jsonl_errors_for_missing_session`.
- `memory::journal::tests::*` — kind whitelist, empty-content rejection,
  embedding round trip (write path only), chronological `list_between`.
- Store side: summary repo list/prune/count, append-only journal repo,
  session search (`LIKE` escaping, 50-row cap), migration tests above.
- Lane ②'s `index_missing_backfills_from_lane1_tables` and
  `migration_v3_memory_embeddings_applies_and_is_idempotent` pass green
  against the v2 tables (lane-mesh verified by their suite, not ours).

## Verification

- `cargo test -p airi-core -p airi-store --all-targets` — **89 passed**
  (75 core + 14 store, 0 failed).
- `cargo clippy -p airi-core -p airi-store --all-targets -- -D warnings` — clean.
- `cargo clippy --workspace --all-targets -- -D warnings` — clean.
- `cargo fmt -p airi-core -p airi-store -- --check` — clean.
- Workspace smoke: `QT_QPA_PLATFORM=offscreen cargo run -p airi-qt -- --smoke`
  — exit 0 (pages visited, stage ticks OK).

## Deviations from the TS store / plan

1. **SCHEMA_VERSION is 3, not 2** — lane ② bumped the shared constant for
   `memory_embeddings` after our v2 landed; v2 content unchanged.
2. `prune_over_365_days` uses `SELECT DISTINCT day ... LIMIT 365` (the plan
   sketch omitted `DISTINCT`, which could prune an entire old day while
   keeping duplicate rows of a newer day); parameterized `prune_over_days`
   added so `config.max_days` is honored.
3. `build_context(days)` returns `Result<String>` (plan sketched `String`);
   days are deduped and sorted chronologically; combined budget =
   `days.len() * token_budget_per_day`; overflowing blocks are dropped, not
   truncated.
4. `summarize_day` returns `Result<StoredSummary>` (plan sketched
   `Result<Summary>`) and treats an empty/day-with-no-content transcript as
   an error (Electron returns `null` there; callers like
   `ensureYesterdayBlock` get their "no bucket" signal from the error).
5. Token estimation is the plan's words × 1.33 approximation, not the
   Electron CJK-aware `estimateTokens`.
6. Summarizer prompt has no character-card context (Rust core has no card
   store yet); assistant lines are labeled `Assistant`.
7. `token_estimate` is stored as `i64` (SQLite integer);
   `source_session_ids` round-trips as a JSON array.
8. Search is case-insensitive with SQLite `LIKE` ASCII folding (not full
   Unicode caseless matching).
9. Auto-titling runs inline (awaited) after `MessageDone` rather than as a
   detached task; 10 s bound; failure keeps the title; default-title
   re-checked pre-write. No Qt-side refresh event is emitted — UI picks up
   the new title on its normal session reload.
10. `updated_at` equals `created_at` at journal insert; append-only is
    enforced by the absence of update/delete API (plus a test), not by a
    trigger.
11. Summary test days use fixed synthetic keys (`2024-000`…) only in the
    prune unit test (fixed-width keys exercise lexical ordering); the
    service validates `YYYY-MM-DD` shape on the `summarize_day` path.

## Deferred (not in this lane)

- Lifetime artifacts, echo chips, event log, entity ledger, dream-gate
  scheduling and `ensureYesterdayBlock`/`rebuild*` orchestration —
  P9 waves (semantics in `docs/port-manifest/stores.md`).
- Retrieval / embeddings / 5W analysis — lane ② (delivered concurrently).
- Character-card-aware summarizer context, universe/userId scoping,
  broadcast-channel sync — port with the card store.
- Qt/QML surface for summaries/journal — core-only by design (keeps this
  lane mergeable); bridge in a later phase.
- JSONL export CLI flag.
- Dream-gate outcome scheduling (the `append_dream_gate_outcome` hook is a
  write path only; nothing calls it yet).
