# P7 lane ② — Hybrid retrieval for memory/context assembly

Status: **code complete; acceptance test green; `cargo test -p airi-core -p airi-store --all-targets` green (59 + 14); lane-② files clippy/fmt clean. Lane ① landed concurrently; see "Lane boundary / coordination" below.**
Crates: `airi-core` (`memory/embedding.rs`, `memory/retrieval.rs`, `memory/mod.rs`), `airi-store` (migration v3 + `MemoryEmbeddingRepo`).

## Delivered

- **Embedding client** (`memory/embedding.rs`): `EmbeddingClient` over the OpenAI-compatible
  `POST {base_url}/embeddings` endpoint via workspace `reqwest`. No new provider registry —
  built on `airi-llm`'s `ProviderConfig`: `EmbeddingClient::from_provider_config(&config, model)`;
  `model` empty selects `text-embedding-3-small` (`DEFAULT_EMBEDDING_MODEL`). `base_url` from
  config, falling back to `AIRI_QT_BASE_URL`; `api_key` from config, falling back to
  `AIRI_QT_API_KEY` (the same smoke-override env vars) so a unit e2e against a mock server is
  possible; default tests stay fully mocked (mockito HTTP-level test included, no live calls).
  Error taxonomy mirrors `airi-llm`: `Transport` / `Empty` / `Decode`, plus `InvalidConfig`.
  Response parsing sorts rows by `index`, rejects empty/mismatched-dimension data.
  `Embedder` trait is the injectable seam used by all retrieval tests.
- **Retrieval index (migration v3, airi-store)**: `memory_embeddings(id text primary key,
  kind text not null, content text not null, vector text not null /* JSON array<f32> */,
  created_at integer not null)` + `idx_mem_emb_kind`. `SCHEMA_VERSION` 2 → **3**; v3 is its own
  `if current < 3` block after lane ①'s v2 and is fully idempotent (`create table/index if not
  exists`). No vector DB, no server: latest ≤2000 rows are scored in-process.
- **Hybrid scoring** (`memory/retrieval.rs`): cosine in-process + lexical Jaccard token overlap
  (lowercase alphanumeric tokens, ≥2 chars). `hybrid = 0.75 * semantic + 0.25 * lexical`;
  semantic is skipped (lexical-only) when the embedder errors or returns nothing — a provider
  outage degrades ranking, it does not fail the query. Store errors still propagate.
- **`MemoryRetrieval`**: `search(query, kind, top_k)`, `search_expanded` (5W-expanded query),
  `build_prompt_block(query, top_k) -> Result<String>` — the prompt-assembly surface the chat
  pipeline consumes. **`chat.rs` is untouched**; nothing is wired into the chat path yet.
- **`MemoryIndexer`**: `index_journal_entry(id, content)`, `index_summary_day(day, content)`
  (source id `summary:<day>`), `index_entries(...)` batch (single embed call), `index_if_enabled`
  hook, and `index_missing()` backfill that probes lane ①'s `journal_entries` / `summaries` tables
  via `sqlite_master` (absent → 0 rows; present-but-wrong-columns → hard error, no silent skip).
  Lane ② never writes lane ① tables. `journal_entries.embedding` stays NULL as far as this lane
  is concerned.
- **5W hooks** (`memory::retrieval::five_w`): `FiveWAnalysis { who, what, when, where_, why }`.
  **Documented placeholder**: `when` matches temporal words/phrases (today…yesterday, now/soon/
  later/recently, `this|last|next <word>`, English weekdays/months, ISO dates), `who` matches
  capitalized token runs after position 0 plus possessive/entity references (`my`, `user's`,
  `the user` → `user`), `what` matches possessive noun-phrase spans (`user's cat …`),
  `where_`/`why` have no honest heuristic and return the trimmed query verbatim; any slot with no
  match falls back to the trimmed query. This is NOT an LLM analysis — it exists so the pipeline
  can depend on the 5W slot interface; an LLM-powered analyzer may replace `analyze` later
  without changing the API. `expanded_query()` joins unique tokens across slots, fed to
  `search_expanded`.
- **Phase note deviation from spec sketch**: `search` / `search_expanded` / `build_prompt_block`
  are `async` and return `Result<_>` (embedding goes over HTTP); the spec's
  `fn search(...) -> Vec<_>` was a simplification.

## Acceptance

`retrieval_returns_seeded_fact_for_paraphrase` (in `memory/retrieval.rs` tests): seeds journal
entry "The user's cat is named Miso" plus distractors (hiking, wifi) and a summary mentioning the
cat; queries "what is the user's feline called?" through `MemoryRetrieval::search(.., top_k=3)`
and asserts the seeded fact `j1` is in the top 3.

The mock that drives it is `MockEmbedder` (same file): a deterministic synonym-class vectorizer —
`cat/feline/kitten` → dim 0, `miso` → dim 1, `user/my` → dim 2, `hiking/hike/trail` → dim 3,
`wifi/password` → dim 4, `named/called/name` → dim 5, `likes/like/loves` → dim 6; unknown tokens
are spread over trailing dims by a 5381-style hash, keeping unrelated texts near-orthogonal. The
query and the seeded paraphrase-share synonym classes, so their cosines are ~0.87 (cat/feline)
vs ≤0.24 for distractors; hybrid lexical term adds a small constant. No network, no randomness.

## Tests

`cargo test -p airi-core -p airi-store --all-targets`: **59 + 14 passed** (airi-core / airi-store),
including: seeded-fact acceptance, kind filter, lexical-only fallback with a failing embedder,
5W extraction/fallback/expansion unit tests, cosine/Jaccard/hybrid-weight unit tests, migration
v3 applies (alongside v1+v2) and is idempotent on reopen, repo upsert/list/filter/delete,
`list_missing_sources` backfill over the real v2 tables (simulated-lane-① test now runs against
the actual tables since lane ① landed v2).

## Lane boundary / coordination

- Lane ① landed migration v2 (`journal_entries`, `summaries`, `SCHEMA_VERSION = 2`) in the working
  tree before lane ②'s v3 was added; v3 follows it with its own `if current < 3` gate per lane-①
  request. Lane ② touched lane ①'s code in exactly one place: the three `assert_eq!(version, 2)`
  assertions in airi-store tests were bumped to 3 (and one test renamed `…_schema_v3_…`), required
  by the version bump. Nothing else of lane ①'s was modified.
- Lane ① rewrote `memory/mod.rs` mid-flight and dropped the `pub mod embedding; pub mod retrieval;`
  declarations; lane ② re-added them next to lane ①'s `pub use` re-exports (kept verbatim).
  After lane ① landed `journal.rs` / `short_term.rs`, `cargo test` and `cargo clippy` compile the
  whole crate again; lane ② files are clippy/fmt clean. Lane ①'s `journal.rs` was written after
  the workspace fmt run and is not rustfmt-clean — lane ①'s to format.

## Hybrid weights

`SEMANTIC_WEIGHT = 0.75`, `LEXICAL_WEIGHT = 0.25` (constants in `memory/retrieval.rs`). Semantic
dominates because embeddings should generalize across paraphrases; lexical guards against
topic-drifted cosines on short queries and provides the offline path. Weights are not yet tuned
against a real corpus (no live embedding provider was exercised in tests — all default tests are
mocked; `AIRI_QT_BASE_URL`/`AIRI_QT_API_KEY` allow a manual e2e).
## Honest scope / non-goals

- **Not implemented (P9)**: lifetime artifacts, echo chips, event-log/ledger, 5W via LLM,
  scheduled auto-indexing on journal/summary append (callers invoke `MemoryIndexer` explicitly;
  `index_missing` is the backfill). The prompt block is exposed but not wired into chat.
- Cosine over ≤2000 rows loaded per query is O(n·d) with n=2000 — fine now; an ANN index is a
  scaling decision for later phases.
- `index_missing` embeds in one provider call; very large backfills may need chunking.
- Vectors are stored as JSON text (not a blob) for debuggability; costs some space.

## Verification

- `cargo test -p airi-core -p airi-store --all-targets` — green at time of writing (59 + 14 passed); lane ① reports **89 passed** after landing `short_term.rs`/`journal.rs` (count includes lane ①'s own tests).
- `cargo clippy -p airi-core -p airi-store --all-targets` — lane ② files clean. Lane ① subsequently reported `cargo clippy -p airi-core -p airi-store --all-targets -D warnings` clean, full-workspace clippy clean, and smoke exit 0 after their landing (not re-verified by lane ②).
- `cargo fmt` / `rustfmt --check` — lane ② files clean. Note: an early `cargo fmt --all` was run in this worktree, which may have reformatted unrelated in-flight files workspace-wide (formatting only, semantics preserved).
- Smoke untouched; `chat.rs` not modified by lane ②.
