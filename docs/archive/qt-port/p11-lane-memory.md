# P11 — Memory settings page (`/settings/modules/memory`)

Lane D1. Scope: port the Vue `/settings/memory` + `memory-short-term` +
`memory-long-term` surfaces' *intent* to a Qt settings page. Three files
added, nothing else touched:

- `qml/pages/settings/modules/memory/MemorySettingsPage.qml` (NEW)
- `crates/airi-qt/src/bridges/memory.rs` (NEW — `MemoryController`)
- `docs/phase-notes/p11-lane-memory.md` (this file)

Read-only for this lane: `build.rs`, `bridges/mod.rs`, `SettingsWindow.qml`,
`Cargo.toml`, locales, `airi-core`, `airi-store`, chat pipeline. **No git
writes were performed.** Scope of the upstream port: `memory-short-term.vue`
(enable toggle, rebuild actions, per-card delete, echo chips) and
`memory-long-term.vue` (text-journal list, entity-graph tab, vector-index
progress). The Qt page ports *intent only*: the enable toggle, the retrieval
`topK`, and a read-only journal list. Per-card summary delete/rebuild, echo
chips, the knowledge graph, lifetime artifacts, and 5W analysis display are
deliberately **not** ported (no backend surface in this build; see
Not-done list).

Backend status before this lane: `airi-core::memory` (`short_term.rs`,
`journal.rs`, `retrieval.rs`, `embedding.rs`) and the airi-store
`summaries` / `journal_entries` / `memory_embeddings` tables exist and are
tested. **No Qt settings surface existed.** Nothing in the Qt build
references `MemoryRetrieval`, `ShortTermMemoryService`, `TextJournalService`,
or `MemoryIndexer` (verified by grep) — the chat pipeline
(`chat.rs`, `chat_context`) is untouched this wave, so the persisted
preference is intent, not a live switch. This lane therefore wires the page
to what genuinely exists (preference blob + live journal read) and renders
everything else as honest disabled/absent UI.

## Bridge API (`MemoryController`, namespace `airi_qt`)

QML element: `MemoryController`. Properties (all `READ, NOTIFY` — see
"qproperty note" below):

| Member | Type | Notes |
|---|---|---|
| `enabled` | qproperty bool | persisted (`settings/memory.enabled`), default `false` |
| `topK` | qproperty i32 | persisted (`settings/memory.topK`), default `5`, clamped 1–20 on set/snapshot |
| `journalCount` | qproperty i32 | live read: `TextJournalService::count()`, `u64` clamped to `i32::MAX` |
| `recentJson` | qproperty QString | live read: newest-first JSON array, cap 20, items `{id, timestampMs, kind, text}`; `text` truncated to 400 Unicode scalar values (`…` when cut); **embedding never crosses the boundary** |
| `retrievalProvider` | qproperty QString | `id` or `id · model` of the chat pipeline's resolved LLM provider; `""` = not configured (page renders a localized placeholder); keys never read or surfaced |
| `statusLine` | qproperty QString | raw English status (bridge convention, like discord/hearing); carries journal-read failures and save failures |
| `stateChanged` | qsignal | emitted on every mirror mutation / refresh / save |

Invokables (each `bool`; `true` = persisted/re-read OK):

- `refresh()` — re-read blob + journal + provider label into the mirror; emits `stateChanged`.
- `setEnabled(bool)` — persists `enabled` (keeping `topK`).
- `setTopK(int)` — clamps 1–20, persists `topK` (keeping `enabled`).

`clearJournal` is **omitted entirely** — see "Journal mutation verdict".

**qproperty note (compile-driven).** cxx-qt auto-generates a `void` setter
slot for every qproperty with an implicit `WRITE` (`setEnabled`, `setTopK`,…),
and a `bool` qinvokable `setEnabled(bool)` cannot overload it
(`'bool MemoryController::setEnabled(bool)' cannot be overloaded with
'void MemoryController::setEnabled(bool)'` — verified against the real
generator source in `cxx-qt-gen-0.10`: `setter_name_from_property` /
`meta::generate`). To keep the speced QML API exactly as requested
(`enabled`, `topK`, … + `setEnabled(bool)` / `setTopK(int)`), the qproperties
are declared `READ, NOTIFY` (no `WRITE` → no setter slot; valid
`Q_PROPERTY(... READ ... NOTIFY ...)` for Qt), the storage fields are
mutated directly, and the `*Changed` notify signals are emitted manually.
`cargo check`/`clippy` in the verification copy confirm the design.

## Persistence

- Key: **`settings/memory`** (single JSON blob, camelCase fields: `enabled`,
  `topK`), stored via the existing `SettingsStore` pattern
  (`bridges::settings_store()`, synchronous SQLite), exactly like
  `settings/stage-window`, `settings/hearing`.
- Why this key: `airi-core::settings.rs` defines no memory section
  (`grep -n "memory" airi-core/src/settings.rs` → no matches) and is
  read-only for this lane, so a new typed `SettingsSection` could not be
  added. `SettingsStore::load`/`save` take arbitrary keys, which is the
  sanctioned escape hatch here (same as the hearing lane). The
  `settings/<group>` namespace is the Electron-compatible convention used by
  every other blob.
- Defaults / corruption: `#[serde(default)]` + `Default` impl ⇒
  `{enabled: false, topK: 5}` on missing or corrupt blob. Unknown fields are
  ignored.
- `topK` default is **5** — the retrieval block builder has no intrinsic
  default; 5 is a conservative middle of the 1–20 range. Documented choice,
  not a port (the Vue page has no top-k control; retrieval's `top_k` param
  is caller-supplied).

## What's wired vs. honestly disabled

**Live / wired:**
- Preference persistence (`enabled`, `topK`) — real SQLite blob, immediately
  persisted on toggle/spin (no Save button, theme/hearing idiom).
- Long-term journal — real rows from `journal_entries` (migration v2):
  count badge + newest-first list (kind chip, relative/absolute timestamp,
  3-line elided text). Cap 20.
- Retrieval provider display — the label the chat pipeline would resolve
  today (env `AIRI_QT_PROVIDER` + `AIRI_QT_MODEL`, else the first enabled
  row in the `providers` table, formatted `id · model`), **never** the
  stored config blob's secrets. When nothing is configured, the bridge
  returns `""` and the page shows localized "not configured". Resolution
  mirrors `chat.rs::resolve_provider` minus the implicit `openai` fallback —
  naming an unconfigured provider would be a lie. The `--smoke` override
  (`set_chat_provider_override`) is not observable from this bridge, so
  under `--smoke` the line reflects persisted configuration, not the mock.

**Honestly disabled / absent (on the record):**
- **Nothing consumes `settings/memory`.** `chat.rs` is untouched;
  `ShortTermMemoryService` / `MemoryRetrieval::build_prompt_block` /
  `MemoryIndexer` exist in `airi-core` but are never called from the Qt
  chat path. The enable switch persists intent only; the status line and
  the page's warning card say so verbatim.
- **No journal mutation.** `JournalRepo` has no update/delete/clear
  (entries are immutable by design; verified in `airi-store/src/lib.rs` and
  in `airi-core::memory::journal` module docs). No "Clear journal" button,
  no per-entry delete, no AModal confirm — adding destructive ops is out of
  this lane's mandate.
- **Short-term summaries are not surfaced.** No summary list, no
  "rebuild today", no token-budget editing: `ShortTermMemoryService` is
  unwired in Qt, and its config knobs
  (`window_size`/`token_budget_per_day`/`max_days`) are not exposed rather
  than faked. The card shows the retrieval `topK` only.
- **Retrieval itself is not live** in this build (embedding client exists;
  no caller), so the page implies nothing about fresh recall.
- **No knowledge graph, no lifetime artifacts, no echo chips, no charts** —
  out of scope by mission.
- **No path display for the vault.** No existing helper prints the sqlite
  path (`main.rs` constructs `profile_dir.join("airi.sqlite")` inline and
  registers the handle; it does not print it). The footer uses generic
  wording ("the airi-store SQLite vault for this profile") instead of
  inventing a path helper.

## i18n keys (English source report only — locales untouched)

All under `shell.memory.*`; suggested file placement next to `acp:` in
`packages/i18n/src/locales/en/shell.yaml`. `%1` placeholders as noted:

```yaml
memory:
  title: 'Memory'
  badge: 'Info'
  infoTip: 'Memory augments the chat context. Short-term summaries and retrieval are not consumed by this build yet; the journal below is live.'
  description: 'Short-term daily summaries and a long-term text journal. Memory augments the chat context — nothing leaves the machine except to the configured LLM provider.'
  notWiredNotice: 'Enabling memory persists your preference only. No part of this build consumes it yet — short-term summarization and retrieval are not wired into chat. The journal below is live.'
  enable:
    title: 'Enable memory'
    description: 'Persist the preference below. The chat pipeline does not read it in this build yet.'
    disabledCaption: 'Memory is off — the retrieval controls below are disabled until you enable it.'
  shortTerm:
    title: 'Short-term & retrieval'
    badge: 'Not wired'
    note: 'topK caps how many retrieved memories may be injected into a prompt (1–20). Retrieval ranking blends semantic similarity (weight 0.75) with lexical overlap (weight 0.25) in airi-core; the chat pipeline does not call it in this build.'
  topK:
    label: 'Retrieval top-k'
    description: 'How many memories retrieval may inject per prompt (1–20).'
    disabledTip: 'Enable memory to change the retrieval budget.'
  provider:
    label: 'Retrieval provider'
    notConfigured: 'not configured'
  journal:
    title: 'Long-term journal'
    refresh: 'Refresh'
    emptyTitle: 'No journal entries yet'
    emptySubtitle: 'No journal entries yet — chat memory fills this as you use the app.'
  footer:
    note: 'Preference and journal live in the airi-store SQLite vault (airi.sqlite) for this profile. Memory augments the chat context — nothing leaves the machine except to the configured LLM provider.'
  saveError: 'Failed to save — see the status line for details.'
  time:
    justNow: 'just now'
    minutesAgo: '%1m ago'
    hoursAgo: '%1h ago'
```

Plus the nav key the SettingsWindow entry needs (page does not use it):

```yaml
settings:
  nav:
    memory: 'Memory'
```

No other keys are consumed. Journal `kind` values (`note`/`dream`/
`milestone`/`summary`) render raw, untranslated. The count badge is a raw
number. `statusLine` is raw English (bridge convention).

## Central steps (exact)

In `crates/airi-qt/build.rs`:

1. After line 44 (`manifest_dir.join("src/bridges/acp.rs"),`) add:
   `        manifest_dir.join("src/bridges/memory.rs"),`
2. After line 153 (`…qml_file("qml/pages/settings/modules/acp/AcpAgentsPage.qml");`) add:
   `    module = module.qml_file("qml/pages/settings/modules/memory/MemorySettingsPage.qml");`

In `crates/airi-qt/src/bridges/mod.rs`:

3. After line 18 (`pub mod mcp;`) add: `pub mod memory;` (alphabetical position; adjust line numbers if earlier lanes applied first).

**Also required to reach the page (outside this lane's file ownership, flagged, not applied):**

4. `qml/shell/SettingsWindow.qml` — add a nav AListItem (`icon: "🧠"`, `title: I18n.tr("shell.settings.nav.memory")`, `navIndex === 25`) and a `MemorySettingsPage {}` as the StackLayout page at index 25 (after ACP Agents at 24). The file is under active multi-lane edit; re-verify indexes against the tree before applying.
5. Locales — add the `shell.memory.*` keys + `shell.settings.nav.memory` (English source above; flatten per existing `shell.yaml` style; other locales fall back to the key until translated).

Nothing else. `Cargo.toml` unchanged (no new Rust deps; everything needed —
`airi-core`, `airi-store`, `serde`, `serde_json`, `cxx-qt(-lib)` — is already
a dependency). The real tree's `build.rs` / `mod.rs` / `SettingsWindow.qml` /
locale files were **not** edited by this lane.

## Verification evidence

All compile/test work was done in a scratch copy at
`/tmp/opencode/airi-qt-check` (rsync of `apps/airi-qt` minus
`target/`, `dist/`, `vendor/`; `vendor/spine-runtimes` symlinked; the only
edits inside the copy were the three central-wiring lines above). The real
tree was never built or modified centrally.

- `cargo check -p airi-qt` (in copy) — **PASS**, no errors.
- `cargo clippy -p airi-qt` (in copy) — **PASS**, zero errors and zero
  clippy/unused warnings for the crate (two pre-existing dependencies'
  `warning` noise lines aside; none attribute to `memory.rs`).
- `cargo test -p airi-qt memory` (in copy) — **3 passed**, 0 failed:
  `truncate_chars_counts_scalars_and_marks_elision`,
  `recent_json_shapes_capped_entries` (asserts newest-first shape, field set,
  `embedding` absence), `provider_label_formats_with_and_without_model`.
  (17 other tests, all from other lanes, filtered out.)
- `MemorySettingsPage.qml` — compiled by `qmlcachegen` as part of the build
  pipeline (registered as a `qml_file` in the copy; `MemorySettingsPage.qml.cpp`
  emitted) and listed in the generated `qmldir`.
  `qmllint -I <symlinked module tree>` reports only the same class of
  warnings as the untouched `AcpAgentsPage.qml` baseline ("Member 'length'
  not found on type QString" — the established QString-`.length` idiom used
  by every wired page); **no other diagnostics**.
- `cargo fmt --check -p airi-qt` — **PASS** (one `cargo fmt` pass was
  applied to `memory.rs` after an initial check diff; the copy re-verified
  green afterwards).
- **Not run:** full app link/Qt smoke run, locale regeneration, QML runtime
  instantiation of the page, nav wiring (central), `--smoke` end-to-end.
  Per lane protocol this lane did not touch git.

Test scope honesty: the only unit tests are for pure JSON shaping / string
helpers in the bridge. There is **no** integration test of the bridge against
a real `airi-store` journal (the airi-core/airi-store repos cover those
paths; a bridge-level DB test needs a `Database` opened from a temp path,
which is possible but was not trivially cheap to wire for the journal
because `bridges::database()` is a process static — deliberately not faked).

## Not-done list (explicit)

- No wiring of memory into chat (`chat.rs` untouched; topK does nothing yet).
- `clearJournal` and any destructive ops — absent by backend design.
- Short-term summary UI (daily blocks, token budget edit, rebuild/delete) —
  absent; the service is unwired and the knobs have no UI.
- Knowledge graph / entity ledger tab (`memory-long-term.vue` graph tab),
  lifetime artifacts, echo chips, 5W analysis display, recall quality
  metrics/charts — not ported.
- Retrieval provider badge shows *chat pipeline* provider, not an
  embedding-provider row; `EmbeddingClient` config is not separately
  configurable in this build.
- `journalCount` is `i32` (clamped); the backend count is `u64`.
- Vault path not displayed on the page (no existing helper prints it).
- Nav entry, locale keys, and this doc's central steps are **not applied** —
  they need a central/integrator pass. The page is unreachable until then.
- Smoke-override caveat: under `--smoke`, `retrievalProvider` reflects the
  persisted/env configuration, not the mock provider (the override static is
  private to `chat.rs`).

## Observation for neighbouring lanes (not fixed, not mine)

`hearing.rs` (in-flight, unregistered) declares `#[qproperty(bool, enabled)]`
(default `WRITE` ⇒ auto void slot `setEnabled`) **and** an invokable with
`#[cxx_name = "setEnabled"]` returning `bool`. That is the exact C++
overload collision diagnosed here (`bool setEnabled(bool)` vs
`void setEnabled(bool)`); hearing will fail the same way at build time when
it is wired. Same latent pattern in `speech.rs`? — no: speech declares no
same-named bool qproperty/invokable pair. Not edited (out of lane); flagged
for the hearing lane/central.
