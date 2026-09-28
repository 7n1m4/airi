# AIRI Card Import / Export Design

> Doc ownership (2026-09-28): this document covers **all** portable formats and how they intermingle (JSON house backup, PNG ecosystem compatibility, ZIP complete bundle, Data Vault bulk archive). Fork schema internals and the ZIP Package Spec v2 definition live in [`docs/design-airi-card.md`](./design-airi-card.md) — this doc references that spec, it does not duplicate it.

## Goal

AIRI cards should be portable.

Users need a durable copy of their cards that can be:
- backed up
- versioned in git
- shared with other AIRI users
- imported from broader character-card ecosystems

The current AIRI card editor is too valuable to leave trapped in local storage.

---

## Product Direction

The feature is intentionally split into three layers:

### 1. AIRI JSON

This is the full-fidelity house format.

Use it for:
- backup
- restore
- version control
- preserving AIRI-specific extensions without loss

### 2. Compatibility PNG

This is the shareable ecosystem format.

Use it for:
- importing existing community cards
- exporting AIRI cards into the broader card ecosystem
- cross-tool sharing

The compatibility target is currently:
- SillyTavern-style `chara_card_v2` PNG cards

### 3. ZIP Complete Bundle (new)

This is the whole-character package: card metadata plus binaries and (optionally) history.

Use it for:
- sharing a character with its display model, background, voice profiles, and cover art in one file
- moving a character between devices/users without losing assets
- upstream-compatible exchange (v1) or full fork-fidelity exchange (v2)

Two flavors (spec in [`docs/design-airi-card.md`](./design-airi-card.md) §6):
- **v1 Upstream (`moeru-ai` standard)**: `manifest.json` (`format: 'airi-character-card'`, `version: 1`) + CCv3 `card.json` + single `models/body-model.<ext>`. No memories, no voices, no background — upstream whitelist only.
- **v2 Extended (fork)**: `manifest.json` (`format: 'airi-card-package'`, `version: 2`) + `card.json` + `cover.png` + `background.png` + `models/` + `voices/` + `memories/chat_sessions.json` + `README.md`. Fork-only: intentionally fails upstream validation until a v2 importer ships.

---

## AIRI-Native JSON Format

The AIRI JSON export is the canonical backup/export format.

It preserves:
- base card fields
- greetings
- system prompt
- post-history instructions
- AIRI extensions
  - modules
  - artistry
  - acting
  - heartbeats / proactivity config
  - future AIRI-specific fields

### Current JSON Wrapper

```json
{
  "format": "airi-card",
  "version": 1,
  "card": {
    "...": "full AIRI card payload"
  }
}
```

Why this wrapper exists:
- schema evolution
- migration/versioning
- import validation

### Current JSON Import Behavior

When AIRI imports JSON:
- if it sees the AIRI wrapper, it loads `card`
- otherwise it still accepts the older raw-card JSON path
- duplicate names are auto-renamed on import

Example:
- `Lain`
- `Lain (2)`
- `Lain (3)`

---

## Compatibility PNG Direction

PNG export/import is the compatibility layer, not the AIRI source of truth.

The current implementation uses:
- the cached model `previewImage`
- a `chara_card_v2` payload
- PNG text metadata

This keeps the implementation simple while maximizing compatibility.

### Why This Is The Right MVP

- no new render pipeline required
- immediate interoperability with existing card communities
- AIRI JSON remains the durable house format

---

## Current PNG Compatibility Contract

The current compatibility target is:
- PNG metadata key: `chara`
- metadata chunk type: `tEXt`
- metadata value: base64-encoded UTF-8 JSON
- JSON payload type: `chara_card_v2`

### Example Top-Level Payload

```json
{
  "spec": "chara_card_v2",
  "spec_version": "2.0",
  "data": {
    "name": "Character Name",
    "description": "Character description",
    "personality": "",
    "scenario": "",
    "first_mes": "First greeting",
    "mes_example": "",
    "creator_notes": "",
    "system_prompt": "",
    "post_history_instructions": "",
    "alternate_greetings": [],
    "tags": [],
    "creator": "",
    "character_version": "",
    "extensions": {}
  }
}
```

---

## AIRI Field Mapping To `chara_card_v2`

Current AIRI PNG export maps:
- `name` <- card name
- `description` <- card description
- `personality` <- card personality
- `scenario` <- card scenario
- `first_mes` <- first greeting
- `alternate_greetings` <- remaining greetings
- `mes_example` <- flattened example messages
- `creator_notes` <- card notes
- `system_prompt` <- AIRI system prompt
- `post_history_instructions` <- AIRI post-history instructions
- `character_version` <- AIRI card version
- `tags` <- AIRI tags
- `creator` <- AIRI creator
- `extensions` <- AIRI extensions object as-is

Important:
- AIRI-specific fields are preserved only opportunistically in `extensions`
- true full fidelity still belongs to AIRI JSON

---

## Current PNG Import Behavior

When AIRI imports PNG:
- it reads PNG `tEXt` metadata chunks
- looks for the `chara` key
- base64-decodes the payload
- parses the embedded JSON
- imports the compatibility card into AIRI as a new card
- auto-renames duplicates on import

If the payload is compatibility-only, AIRI should:
- fill the standard character fields
- keep AIRI-specific fields defaulted if they are missing
- let the user enhance the card afterward

---

## ZIP Wiring: Reuse Data Vault, Narrow To One Character

> Findings (2026-09-28 audit of `Settings -> Data` top export). Do not reinvent the wheel: the vault already solves archiving, full-fidelity session dump, multi-pillar memory dump, and binary-in-ZIP. The single-card ZIP reuses its accessors and patterns, with a different layout.
>
> Implemented 2026-09-28: `importCardZipPackage()` in `use-data-maintenance.ts` + `.zip` branch in the `inputFiles` watcher (`index.vue`). Port notes: this fork's `addDisplayModel` returns `void` (upstream returned the model), so the fresh model id is resolved by diffing the in-memory catalog.

### What the vault already does

- `exportDataVaultArchive(selection)` in `packages/stage-ui/src/composables/use-data-maintenance.ts:628-714` builds an `ArchivePayload` per selected domain and zips it via `createDataVaultArchive()` (`packages/stage-ui/src/utils/data-vault/archive.ts:67-143`, `JSZip.generateAsync({ type: 'blob' })`). Import mirrors it via `extractDataVaultArchive()` + `commitVaultImport()`.
- Chat: `chatStore.exportSessions()` (`session-store.ts:1103-1135`) dumps the **full** `{ format: 'chat-sessions-index:v1', index, sessions: Record<sessionId, { meta, messages }> }` — index plus every transcript, read from `chat-sessions.repo` with in-memory fallback.
- Memory: `memory.json` (`format: 'airi-memory:v2'`) bundles STMM blocks + LTMM journal entries + `lifetimeArtifacts` per card + echo chips.
- Backgrounds: `{ metadata, blob }` items → `backgrounds/<id>.<ext>` binaries + `backgrounds/metadata.json`.

### Per-character narrowing (the plan — no new repo code)

- **Chat:** filter `exportSessions()` output to `index.characters[cardId]` plus its session IDs. Reuse the full-record shape; never copy the metas-only pattern (see below).
- **Memory — full pillars (LOCKED 2026-09-28):** same `airi-memory:v2` shape filtered by `characterId`: STMM blocks + LTMM journal entries + echo chips (all carry `characterId`, `universeId` falls back `'global'`) plus `lifetimeArtifacts`. Lifetime keys are universe-scoped (`local:memory/lifetime/{characterId}:{universeId}`, default `'global'` in `lifetime-memory.repo.ts:6-7`) — enumerate universes from the character's `sessionMetas` (+ `'global'`) and fetch each, so non-global universes are not silently dropped the way the vault's global-only read does.
- **Background:** same `BackgroundArchiveItem` read, written as a single `background.png` instead of `backgrounds/<id>.<ext>`.
- **Characters:** single card entry instead of the whole `cards` array.
- **Do NOT reuse `createDataVaultArchive()` directly** — its layout is vault-style (`characters.json`, `chat-sessions.json`, …). The card package needs card layout (`manifest.json`, `card.json`, `models/`, …). Decompose instead: extract `exportSessionsForCharacter(cardId)` + `exportMemoryForCharacter(cardId)` helpers (thin filters over the vault logic, e.g. in `utils/data-vault/per-character.ts` or as `useDataMaintenance` additions) consumed by both Vault and `exportCardZip`.

### Memories data reality and known bug

Chat history is two-tier (`docs/data-catalog.md` §1.4/§1.5): light index `local:chat/index/{userId}` (`characters[cardId].sessions` = `ChatSessionMeta[]`: titles, counts, timestamps, `universeId`) and full records `local:chat/sessions/{sessionId}` (`{ meta, messages: ChatHistoryItem[] }`). In-memory mirrors are `sessionMetas` + `sessionMessages`; message reads require `await loadSession(sessionId)` first (lazy) — and `await initialize()` before `getCharacterIndex(cardId)` (the dialog already does this on open).

> KNOWN BUG: `exportCardJson({ includeMemories })` (`use-card-export.ts:387-391`) and `detectedChatSessions` export **metas only** — no transcript content. The ZIP `memories/` dir MUST use full records: per session `await loadSession(id)` → `getSessionMessages(id)` → `memories/chat_sessions.json` as `{ version: 1, characterId, exportedAt, sessions: [{ meta, messages }] }`, plus `memories/memory.json` in vault `airi-memory:v2` shape filtered to the character. Fix JSON export to share the same helper.

### Size cap (LOCKED 2026-09-28): 1 GB per ZIP

No truncation, no streaming — estimate up front (model bytes + background bytes + JSON lengths) and abort with a clear error if the package would exceed **1 GB**. Rationale: archive-reader and 32-bit size-field issues past that point; the dialog already shows per-domain estimates via `getVaultStats()`, so surface the running total before generating.

### ZIP import behavior (LOCKED 2026-09-28: export-only first)

- v1 import: ignore `memories/` and any v2-only entries; import card + primary model through the upstream-equivalent path.
- v2 `memories/` import comes after export validates: restore as new timelines/records, never overwriting live sessions (`storageState.isImportingRemoteData = true` while writing).
- Upstream PR #1998 service file has zero memories handling — `memories/` is fork-only by design.

---

## UI Direction

Current direction:

### AIRI Cards Page

- one global import surface
- per-card export action

This is the current intended split:
- `Import` is page-level because it creates a new card
- `Export` is per-card because it targets one specific card

### Current UI Behavior (updated 2026-09-28 — the old JSON/PNG-only menu description below was stale)

- Per-card export is `CardExportDialog.vue` (`packages/stage-pages/src/pages/settings/airi-card/components/`): three segments — ZIP Package (flavors v2 Extended / v1 Standard, asset toggles + live archive-tree preview), Portable PNG, Raw JSON. PNG/JSON are wired via `use-card-export.ts`; ZIP generation (`exportCardZip`) is UI-rendered but unwired.
- Import tile supports AIRI JSON and `chara_card_v2` / SillyTavern-style PNG (`parseImportedCard` / `parsePngCharaPayload` in `index.vue`).
- Bulk export/import already exists under `Settings -> Data` and is **not** later-phase:
  - **Data Vault** (`data/index.vue:379-401` → `ExportVaultModal.vue` / `ImportVaultModal.vue` → `useDataMaintenance().exportDataVaultArchive()` → `createDataVaultArchive()` in `packages/stage-ui/src/utils/data-vault/archive.ts`, JSZip): selective ZIP across domains `characters` / `chat-sessions` / `memory` / `providers` / `settings` / `backgrounds`.
  - Legacy single-file JSON tools (collapsed by default): `exportAllCharacters`, `exportChatSessions`, `exportMemory`, `exportBackgrounds`.

---

## Preview Image Behavior

Current PNG export uses the card's selected display model cached `previewImage`.

That is still the correct MVP because:
- the selector/model library already generates good previews
- the image is already cached
- no extra model render path is needed

### Current Framed Composition

The current shareable PNG export composes three layers:

1. cached model `previewImage`
2. rectangular clip to the portrait window
3. exported frame overlay

Current frame asset:
- `packages/stage-pages/src/pages/settings/airi-card/card-export-frame.png`

Current frame canvas:
- `925 x 1436`

Current inner portrait box:
- `x = 65`
- `y = 79`
- `width = 831`
- `height = 1295`

Current preview placement rule:
- fit preview to the inner-box width
- align to the top edge of the inner box
- crop any bottom overflow

This keeps the first framed export deterministic and simple.

### Important Note

This is good enough for now, but not the final quality target.

The cached preview does not necessarily reflect:
- customized outfit state
- active expressions
- the card's intended personality framing

That is a later renderer/composition problem, not a blocker for current compatibility export.

---

## Future Visual Export Polish

Once PNG export exists, AIRI can polish the shareable artifact further because AIRI controls:
- the preview render
- the export image dimensions
- the final composition pipeline

Possible later export modes:
- `Raw Preview PNG`
- `Styled Card PNG`

### Styled Card PNG Ideas

- decorative frame or border treatment
- AIRI branding mark in a corner
- tuned composition for portrait-style sharing
- title/name plate
- optional subtle metadata overlay

### Future Render Quality Direction

Longer-term, AIRI may want a dedicated export render path that can reflect more of the card's actual presentation state, such as:
- active outfit / customized model variant
- configured expressions
- more character-specific framing
- export-specific composition tuned for sharing

The correct order is:
1. make import/export functionally correct
2. then refine presentation and branding

---

## Open Design Questions

1. Should AIRI later support an AIRI-native PNG mode?
   Current recommendation: probably unnecessary unless compatibility limits become painful.

2. Can `chara_card_v2` safely carry richer arbitrary AIRI fields without breaking external parsers?
   Current recommendation: investigate later, do not assume.

3. Should import always create a new card, or support overwrite/update?
   Current recommendation: create new by default.

4. Should preview images be exported separately in JSON mode?
   Current recommendation: no. Keep JSON textual and durable first.

5. Should compatibility import/export stay in the same UI action set or move into an advanced menu later?
   Current recommendation: `CardExportDialog.vue` three-segment modal is the answer — shipped.

6. Should single-card ZIP memories restore on import, or export-only?
   LOCKED 2026-09-28: export-only first; restore as new timelines/records later (never overwrite live sessions).

7. Should ZIP memories include STMM/LTMM/lifetime/echo chips, or chat sessions only?
   LOCKED 2026-09-28: full pillars — chat sessions + STMM + LTMM + lifetime + echo chips, all filtered to the character (lifetime enumerated per universe).

---

## Recommended Near-Term Next Steps

1. Keep AIRI JSON as the canonical backup format.
2. Keep compatibility PNG focused on strict `chara_card_v2` interoperability.
3. Wire `exportCardZip(cardId, options)` in `use-card-export.ts`: `exportToJSON()` for `card.json` (sanitized v1 / full v2), per-flavor manifest, model via `getDisplayModel()` (`toRaw`, MMD skipped), background blob, filtered voice profiles, `composeCardExportPng()` cover, full-record `memories/chat_sessions.json` + per-character `memories/memory.json` (STMM/LTMM/lifetime-per-universe/echo), README — all through `jszip`, all sharing new per-character vault helpers, with a pre-generate 1 GB size estimate that aborts cleanly.
4. Fix the metas-only bug by routing JSON `includeMemories` through the same full-record helper.
5. Validate: `pnpm -F stage-pages typecheck`, manual v1→upstream-shaped import check, v2 round-trip incl. a large-history character against the 1 GB guard; then spec the v2 memories importer.
6. Later, improve the PNG render/composition quality without changing the compatibility contract.

## Relevant Skills

- [[airi-card-editor-wizard]]
- [[airi-card-schema]]
- [[airi-data-persistence]]
- [[airi-memory-chat-sessions]]
