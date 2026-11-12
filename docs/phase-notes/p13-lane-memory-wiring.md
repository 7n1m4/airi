<!-- SPDX-License-Identifier: GPL-3.0-or-later -->
# P13 Lane R — Memory wiring: journal writer, retrieval injection, memory-page backfill (wave ⑬)

Lane R of the wave ⑬ delegation. Scope: `crates/airi-qt/src/bridges/chat.rs`
(EDIT), `crates/airi-qt/src/bridges/memory.rs` (EDIT),
`qml/pages/settings/modules/memory/MemorySettingsPage.qml` (EDIT), this
note (NEW). Nothing else touched. No `build.rs`, no `bridges/mod.rs`, no
locales, no Cargo.toml edits, no airi-core/airi-store edits, no git writes.

> Note: while this lane was in progress, the wave ⑫ integration landed
> in the real tree (central's `bridges/mod.rs` + `build.rs` edits; the
> ⑫ bridge's missing `CxxQtType` import was fixed in the same window).
> The real tree now compiles; `cargo test -p airi-qt` passes there — see
> [Validation](#validation).

## Integration sites (exact)

### 1. Journal writer — after every COMPLETED assistant turn
`chat.rs`, `impl qobject::ChatController::apply_chat_event`, the
`ChatEvent::MessageDone { session, message }` branch — the same point that
sets the smoke marker (`smoke_note_outcome("done")`). The `..` pattern in
the event was widened to `{ session, message }` to capture the persisted
assistant message id.

Flow (all synchronous SQLite up to the one embedding call):

1. `crate::bridges::memory::memory_preferences()` reads `settings/memory`
   (one key lookup). Off ⇒ this entire block is a no-op; smoke stays
   byte-identical because the flag is off in `--smoke` (nothing in the
   smoke path ever enables it).
2. `completed_turn_journal(true, &ctx.db, &session, &message)` →
   `journal_completed_turn`: loads the session's messages via
   `MessageRepo::list`, finds the just-persisted assistant message by id
   and the last `user` message before it. Appends ONE `note` entry via
   `TextJournalService::append_note`.
   Entry format (one line, newlines/tabs collapsed):
   `User: <user text truncated to 800 Unicode scalars> / AI: <assistant text truncated to 800 Unicode scalars>`
3. Embedding is spawned as a one-shot Tokio task on the global runtime
   (never on the Qt thread): `EmbeddingClient::from_provider_config(
   &resolution.config, DEFAULT_EMBEDDING_MODEL)` — the exact
   `resolve_provider` call `ChatController::send` uses (smoke override →
   `AIRI_QT_PROVIDER`/`AIRI_QT_MODEL`/`AIRI_QT_API_KEY`/`AIRI_QT_BASE_URL`
   env → first enabled `providers` row → unconfigured). Then
   `MemoryIndexer::index_if_enabled(true, &entry)`, i.e. exactly one
   batched embed call per completed turn.
   - Embedding/index failure → `eprintln!` + swallow; the journal row
     stays unembedded and is picked up by the backfill button later.
   - No runtime handle / client build failure → logged; journal row
     stays; backfill recovers.

**Deviation from the lane brief (deliberate, documented):** the brief
wrote `IndexEntry { kind: "note" }`. The index entry uses `kind: "journal"`
instead, matching `MemoryIndexer::index_journal_entry` and, critically,
the `kind = 'journal'` dedup key inside `MemoryIndexer::index_missing`
(`airi-store`, read-only this lane). Indexing chat turns as `"note"` would
make every chat-indexed journal row look "missing" to the backfill, so
the button would re-embed each of them (double spend) and flip their
`kind` on upsert. `kind: "journal"` embeds exactly once, ever. The
`journal_entries.kind` column still says `note`; only the retrieval
index's `kind` differs.

### 2. Retrieval injection — before the outgoing messages are sent
`chat.rs`, `send()`. The flag is read once on the Qt thread
(`memory_preferences()` at ~line 1687); the retrieval itself runs inside
the send task (HTTP — the Qt thread never blocks). Inside
`handle.spawn(async move { ... })`, before `service.stream(...)`:

```text
if memory.enabled {
    embedder = EmbeddingClient::from_provider_config(&memory_config, DEFAULT_EMBEDDING_MODEL)   // cloned chat config
    inject_memory_if_enabled(memory.enabled, memory.top_k, memory_db, embedder, &memory_user_text, &mut messages).await
}
```

`inject_memory_if_enabled` (chat.rs ~line 623): when enabled and the
client built, runs `MemoryRetrieval::new(db, embedder)
    .build_prompt_block(user_text, top_k).await` with `top_k` clamped to
1–20 again defensively, then inserts the block as a `Role::System`
message at index 0 — i.e. **prepended before the first system message
(the character card's) if one exists, else as the first message**. No
ACL/redaction logic is applied (by design; the memories are the user's
own prior turns).

Failure modes (all log + continue WITHOUT memories, turn never fails):
no embedding client (logged); `build_prompt_block` hard error — logged as
`[airi-qt] memory retrieval failed, continuing without: {e}`; embedder
outage — `build_prompt_block` degrades to lexical-only ranking internally
(airi-core behavior, `score = 0.25 * lexical`). Flag off ⇒ no embed call,
no retrieval, `messages` reaches `service.stream` byte-identical.

### 3. Memory page "Index memories now" action
`memory.rs`, `MemoryController::index_missing` (`indexMissing` qinvokable,
registered in the cxx-qt bridge block):

- Resolves the chat ProviderConfig exactly like `ChatController` —
  `crate::bridges::chat::resolve_provider(ctx)` (made `pub(crate)` this
  wave; smoke override → env → first enabled `providers` row). Under
  `--smoke` the mock provider is what gets resolved; the smoke run never
  enables memory so nothing is triggered there.
- `index_missing_blocking()`: `bridges::database()` →
  `chat_embedding_client()` (client build errors → `statusLine` carries
  the error, returns `false`) → short-lived `current_thread` runtime
  `block_on(index_missing_with(db, Arc::new(client)))` →
  `MemoryIndexer::index_missing()` — **one batched embedding call** for
  all missing rows (a zero-row backfill makes no provider call at all).
- `statusLine` ← `index_missing_summary`: `"Indexed N entries."` (true) /
  `"Indexing failed — <single-line, ≤~160 chars of the error chain>"`
  (false). The full chain is `eprintln!`'d. No keys cross the QML
  boundary; there is no provider UI.
- Synchronous on the Qt thread by design (one HTTP round-trip for an
  explicit user action); the QML button disables itself around the call
  (`page.indexing`).

QML (`MemorySettingsPage.qml`): one `AButton` (Ghost) labeled
`shell.memory.indexNow` + hint `Text` `shell.memory.indexHint`, placed in
the Long-term journal card below the header row; `page.indexing` disables
the button while running; the result lands in the page's existing
`statusLine` pattern (visible at the bottom of the page). No other page
changes; the statusLine pattern is reused unchanged.

## Injection message layout

```text
[0] system  "Relevant memories (retrieved automatically, may be outdated):\n- [journal] User: … / AI: …\n- […] …\n"   ← inserted only when non-empty
[1] system  "<character card system prompt>"                                                              ← existing (if any)
[2..]       user/assistant history (card greeting + persisted turns)
```

Empty retrieval (no rows, or all scores ≤ 0.0) ⇒ **no message added**
(position 0 stays the card/history content).

## Journal entry format

`journal_entries (kind = 'note')`, `content` =
`User: <user text> / AI: <assistant text>`, each side ≤ 800 Unicode
scalars (`truncate_chars`), whitespace runs (newlines/tabs) collapsed to
single spaces. `journal_entries.kind` remains `note`. The retrieval index
row (`memory_embeddings.kind = 'journal'`, `id = journal_entries.id`,
upserted) carries the same text. Re-indexing is idempotent (upsert).

## Spend profile (in words)

- Memory is **off by default**; enabling it is the user's explicit
  consent to spend provider quota.
- While enabled: **one embedding call per completed assistant turn**
  (a single `/embeddings` POST with one input), plus one embedding call
  per retrieval (another single-input POST) before that turn's model
  request. ≈ 2 embedding calls per completed turn, all against the
  configured chat provider, nothing else.
- The only backfill is the **"Index memories now" button**: one batched
  call embedding every unembedded journal/summary row (zero rows ⇒ zero
  calls). There is **no startup backfill, no background embedding loop,
  no indexing during `--smoke`, no embed on app launch.**
- Embedding model: `text-embedding-3-small` (`DEFAULT_EMBEDDING_MODEL`),
  requested from the chat provider's `/embeddings` endpoint with the
  chat provider's key — the same credential, no new key material.
- Empty-blob/unconfigured provider ⇒ no embedding calls at all (the
  "embedding client unavailable" inert path, documented below).

## Test evidence (this lane)

Unit tests, mock at the `Embedder` trait level (injection tests document
this choice: no Qt, no HTTP, no QML engine). Smoke-gated harness reused
only as a reference for mock-SSE, not extended. 15 new tests, all passing:

`bridges/chat.rs::tests` (11):
- `inject_memory_if_enabled_prepends_block_before_card_system_prompt` — enabled + canned embedder + temp sqlite seeded with one embedded journal row ⇒ block injected at index 0 before the card system prompt; exactly 1 retrieval query embed.
- `inject_memory_if_enabled_disabled_is_byte_identical_and_embeds_nothing` — flag off ⇒ messages unchanged, zero embed calls.
- `inject_memory_if_enabled_degrades_to_lexical_when_embedder_fails` — failing embedder + lexical overlap ⇒ block still injected (degraded, 0.25 weight); no overlap ⇒ nothing injected, turn proceeds.
- `inject_memory_if_enabled_continues_when_retrieval_hard_fails` — `memory_embeddings` dropped ⇒ `build_prompt_block` errors ⇒ logged, messages unchanged, no panic.
- `inject_memory_if_enabled_adds_nothing_when_index_is_empty` — empty index ⇒ no system message added.
- `completed_turn_journal_disabled_writes_nothing` — flag off ⇒ journal count 0.
- `completed_turn_journal_enabled_writes_one_line_note` — entry lands in journal; format `User: hello world second line or more / AI: hi there`; kind `journal` in the index payload; single line.
- `completed_turn_journal_truncates_each_side_to_800_scalars` — 900/1200-char inputs ⇒ each side exactly 800 scalars.
- `journal_completed_turn_skips_unknown_assistant_message` — missing assistant row ⇒ no entry, count 0.
- `index_entry_best_effort_makes_exactly_one_embed_call_per_turn` — 1 embed call, 1 `memory_embeddings` row.
- `index_entry_best_effort_failure_leaves_row_unembedded_journal_intact` — failing embedder ⇒ exactly 1 attempt, index untouched, journal row survives for backfill.

`bridges/memory.rs::index_tests` (4):
- `index_missing_with_indexes_canned_rows_in_one_batched_call` — canned unembedded journal rows ⇒ `Ok(2)`, exactly 1 batched embed call, 2 rows indexed; second call ⇒ `Ok(0)` with zero provider calls.
- `index_missing_with_embedder_failure_keeps_journal_intact` — failing embedder ⇒ `Err`, `statusLine` carries the error, journal intact, backfill-safe.
- `index_missing_summary_reports_zero_and_success_counts` / `index_missing_summary_failure_line_is_single_line_and_capped` — statusLine strings (`Indexed N entries.`, error line single-line + capped).

Baseline in the glue-patched copy before this lane's tests: 44 passed /
0 failed. With this lane's tests: **59 passed / 0 failed** — the pre-existing
44 (plus the wave ⑫ gateway-pump tests in that copy) are all unaffected.

`cargo test -p airi-qt`: **blocked in-tree by the pre-existing wave ⑫
integration gap; see Validation.**

## Validation

**Update during write-up:** shortly after this lane finished, the wave ⑫
integration landed in the real tree (`bridges/mod.rs`: `pub mod gateway_pump;`,
`build.rs`: `gateway_pump.rs` in the source list, plus the ⑫ `Main.qml` /
`airi-channel` pieces — central's diff, not this lane's). The real tree now
**compiles cleanly** (`cargo check -p airi-qt` passes; my lane's files report
no errors, and this lane's files pass `rustfmt --check`). `cargo test -p airi-qt`
was then re-run in the real tree: see the table below.

The original validation block is kept for the record:

The workspace tree at `/home/vi/Code/airi/apps/airi-qt` did not compile
when this lane finished (wave ⑫ was unintegrated at that point — see
history). To obtain real test evidence in parallel, the workspace was
copied to `/tmp/opencode/airi-qt-lane-r` (excluding `target/`), and the
two one-line ⑫ glue patches were applied **in the copy only**:

1. `pub mod gateway_pump;` in the copy's `bridges/mod.rs`
2. `use cxx_qt::CxxQtType;` in the copy's `bridges/gateway_pump.rs`
   (the ⑫ bridge itself is missing the import — pre-existing)

| Check | Where | Result |
|---|---|---|
| `cargo fmt -p airi-qt` | real tree | applied, clean (`rustfmt --check` passes for this lane's files) |
| `cargo check -p airi-qt` | real tree (post-⑫-integration) | **passes** |
| `cargo test -p airi-qt` | `/tmp/opencode/airi-qt-lane-r` (glue patched, tree synced) | **59 passed / 0 failed** (baseline 44; +15 this lane) |
| `cargo test -p airi-qt` | real tree (post-⑫-integration) | **59 passed / 0 failed** — confirmed by rerun |
| `cargo clippy -p airi-qt --all-targets -- -D warnings` | `/tmp/opencode/airi-qt-lane-r` (glue patched) | **clean** |
| `--smoke` GUI gate | not run — central's gate | n/a |

`cargo test -p airi-qt` in the glue-patched copy exercised the real
build (Qt-linked bin, all pre-existing tests included) — 0 failures,
including every pre-existing test present in that copy.

Also verified by reading (not running): the `--smoke` path registers no
`settings/memory` blob ⇒ flag off ⇒ nothing journals/embeds/retrieves;
smoke markers (`smoke_chat_outcome`, `smoke_delta_count`) untouched.

## i18n keys

**New (locales lane must add; this lane does NOT touch locales):**

| Key | Intended English |
|---|---|
| `shell.memory.indexNow` | `Index memories now` |
| `shell.memory.indexHint` | `Embed unindexed journal entries with your configured provider — one API call per entry.` (see honesty note below) |

Note on `indexHint`: the actual backfill is **one batched** embedding
call for ALL missing rows (not literally one call per entry). The hint
string comes from the lane brief verbatim; central may want to soften it
to "embeds all unindexed journal entries in one request" when the locales
land. Keys are reported, not written.

**Drive-by fix (mine, reported):** the page referenced
`shell.memory.footer.note`, which does not exist in any locale (pre-existing;
the page would have rendered the raw key). It now references the existing
`shell.memory.footer`, whose English text is accurate post-wiring.

**Now stale — English copy contradicts the wiring (locales lane must
update; the QML no longer references any of the false ones):**

- `shell.memory.notWiredNotice` — false ("no part of this build consumes
  it yet"). QML now uses raw English text (bridge convention precedent:
  the page's `statusLine`) until locales adopt it.
- `shell.memory.enable.description` — false ("The chat pipeline does not
  read it in this build yet."). Same raw-English treatment.
- `shell.memory.shortTerm.badge` — "Not wired" → QML now shows raw "Wired"
  (variant `success`).
- `shell.memory.shortTerm.note` — "the chat pipeline does not call it in
  this build." → same treatment.
- `shell.memory.infoTip` — "Short-term summaries and retrieval are not
  consumed by this build yet" → same raw-English treatment (short-term
  summaries still aren't wired; retrieval now is).
- `shell.memory.footer`, `shell.memory.description` — still accurate.
  (`footer` text is accurate post-wiring; `description` already says
  memory augments the chat context and names only the configured
  provider.)

**Recommended new/updated keys for the locales lane** (none added by this
lane): `shell.memory.experimentalNotice`, `shell.memory.enable.description`
(reword), `shell.memory.shortTerm.badge` (`Wired`), `shell.memory.shortTerm.note`
(reword), `shell.memory.infoTip` (reword), `shell.memory.notWiredNotice`
(retire or reword to the experimental-notice text). All raw English
currently shown on the page is listed in the QML diff for adoption.

## Honesty rails kept

- Embedding happens only with the flag on (one call per completed turn +
  retrieval query) or on the explicit button press (one batch). No
  background loops, no startup backfill, no indexing in `--smoke`.
- Embeddings contain only journaled `User: … / AI: …` texts (chat turns).
  Card names/personas are not embedded; `airi-store` untouched; no new
  telemetry; the only network surface is the configured provider's
  `/embeddings` endpoint (plus the chat request itself, unchanged).
- Nothing is written anywhere else: the retrieval index
  (`memory_embeddings`) and `journal_entries` are the only tables the new
  code touches, both via the existing repositories.

## Honest limits

- With no working embedder (outage/misconfig), injection degrades to
  **lexical-only** ranking (airi-core behavior; `CAP` 2000 rows scanned),
  and journal rows simply stay unembedded until the backfill succeeds.
- Retrieval quality depends on `text-embedding-3-small` via the chat
  provider; providers without `/embeddings` (or with quota limits) get
  degraded-memory behavior, never a failed turn.
- Memory is invisible to users unless they enable it; the enable switch
  is the consent boundary and the spend boundary coincide exactly.
- Under `--smoke` nothing memory-related runs (flag off) and the smoke
  markers/path are untouched.
- The `MessageDone` → journal append happens on the Qt thread (sync
  SQLite, consistent with bridge conventions); if the process dies before
  the spawned indexing task finishes, the row stays unembedded — the
  backfill button is the recovery, by design.
- The `indexMissing()` invokable blocks the Qt thread for the duration of
  one batched embed HTTP call (design decision; the QML button disables
  itself around the call). A future async completion-signal rework can
  lift this without API changes.
- `retrievalProvider` line and `journalCount` are refreshed by `refresh()`,
  not live-bound; the journal card's count badge updates on refresh/backfill
  results via `stateChanged`.

## Not done (explicit)

- No summarization of chat sessions into the journal — raw turn notes only.
- No dream-gate wiring (the `dream` journal kind stays unused by chat).
- No per-entry recall UI beyond the existing journal browser (no "why was
  this memory shown", no sources list, no memory deletion — backend has
  no delete).
- No index-on-startup / no background indexing / no scheduled backfill.
- No short-term memory (`ShortTermMemoryService`) calls; `summaries` are
  indexed by the backfill button only if they already exist.
- No changes to locales; the stale `shell.memory.*` texts above are
  reported for the locales lane.
- `--smoke` unchanged; GUI smoke gate not run (central's).
- `cargo clippy -p airi-qt --all-targets -- -D warnings` cannot run
  in-tree (same pre-existing ⑫ blocker); it **passes** in the `/tmp`
  copy — see Validation.

## MessageDone caveat

The journal append sits in the `is_current_session`-gated branch, same as
all other `MessageDone` handling. A turn completed for a session the user
has switched away from before the stream finished is (like the rest of the
UI path) not handled — and therefore not journaled — by that code path.
This matches the pre-existing behavior of the bridge for all other
message-done side effects; widening it would be a separate change.
