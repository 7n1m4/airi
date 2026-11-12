<!-- SPDX-License-Identifier: GPL-3.0-or-later -->
# P11 Lane D4 — Modules overview page (`/settings/modules` landing, Qt port)

**Lane:** D4 of wave ⑪ (module services). **Owner files (exclusive):**
`qml/pages/settings/modules/ModulesSettingsPage.qml` (NEW), this note.
Everything else read-only: no `build.rs`, no `bridges/mod.rs`, no locales, no
`Cargo.toml`, no `SettingsWindow.qml`, no nav edits, no git writes.

**Date:** 2026-11-12. **Method:** read-only inspection of the Qt tree + Vue
intent + audit/notes; qmllint only (no Qt build run — the page is not
registered anywhere yet, so a build would not exercise it).

> **Sibling-lane staleness checkpoint (task time):** at write time
> `qml/pages/settings/modules/` contained ONLY
> `discord/DiscordSettingsPage.qml`, `cloud-sync/CloudSyncSettingsPage.qml`,
> `mcp/McpSettingsPage.qml`, `acp/AcpAgentsPage.qml` + this lane's new file.
> The `memory/`, `speech/`, `hearing/` directories promised by sibling lanes
> this wave **were not on disk**. The page marks Memory / Speech / Hearing
> "Ready" because that is the end-of-wave truth (routes handled by the Qt
> settings nav; backends landed). If those lanes slip, the three rows point at
> nav targets that do not exist yet — re-check at integration.
> Re-checked at the end of this lane: still absent.

## 1. What this is (and is not)

Honest, static port of the Vue `/settings/modules` landing
(`packages/stage-pages/src/pages/settings/modules/index.vue`). Intent ported:
grouped module cards with icons, one-line blurbs, and a status badge.
**Not** ported:

- `GlobalFacultiesMatrix` (faculties/failover defaults matrix) — explicitly
  deferred for Qt v1 per `p11-audit.md` §4.1 row **#216** (size L). Qt shows a
  static overview only.
- Navigation wiring. `SettingsWindow.qml` provides routes; this page emits
  nothing and navigates nowhere. (`SettingsWindow.qml` embeds plain pages;
  there is no "navigate to settings page" signal to reuse, and inventing one
  was out of scope.)
- Live status, toggles, connection indicators, per-module config. Zero fake
  affordances: no switch, no "connected" row, no activity spinner.

Deferred entries are inert: rendered at 55 % opacity, no click handler, no
mouse area on the card. The status badge carries a hover tooltip with the
reason and where the module lives today (Electron, or nowhere yet).

## 2. Page structure (`ModulesSettingsPage.qml`)

Idioms mirror `qml/pages/widgets/WidgetsPage.qml` (static in-memory catalog,
`ACard` per entry, `ABadge` status pill, `ATooltip` on badge hover, uppercase
section headers, `Flickable` + `ColumnLayout`).

```
Flickable
└─ ColumnLayout
   ├─ RowLayout          title ("Modules", 22 bold) + ABadge(variant "info", "Overview")
   ├─ ACard (info)       honest banner: static page, statuses not live, nav provides routes
   ├─ Repeater(sections) section header (uppercase, 12 bold, textSecondary)
   │  └─ Repeater(entries) ACard (deferred → opacity 0.55)
   │     └─ RowLayout
   │        ├─ Text  icon (24 px)
   │        ├─ ColumnLayout  name (14 bold) + blurb (12, wrap, secondary)
   │        └─ Item(badge wrapper, MouseArea hover)
   │           ├─ ABadge(variant by status: success|warning|default)
   │           └─ ATooltip(reason text, hover-visible)
   └─ Text             footer (deferred disabled; page toggles/connects/persists nothing)
```

Entry model (JS object literal on `page.sections`): `{ icon, name, status,
blurbKey, reasonKey }` — status ∈ `ready | experimental | deferred`. Names are
literal English module nouns (as in the settings nav); blurbs, reasons,
sections, statuses, title, badge, notice and footer are `I18n.tr` keys under
`shell.modules.*` (§5).

**Verification:** `qmllint -I qml -I target/cxxqt/qml_modules` → **no
errors**; 10 "unqualified access" warnings, the same accepted class
`WidgetsPage.qml` emits (3 there). No build run (not registered yet — see
§4). Not runtime-verified; nothing to run it in until §4 lands.

## 3. The static catalog — exact per-item status and reason

Statuses follow the mission brief; reasons cite `p11-audit.md` where an
applicable row exists (audit rows are about Vue→Qt parity; several are stale
against this wave's wiring — staleness flagged). Section: **Chat &
Intelligence**.

| # | Module | Status | Reason (tooltip) |
|---|--------|--------|-------------------|
| 1 | Memory | **Ready** | Qt routes handled by nav. Backend landed: `airi-core` memory (`journal`, `retrieval`, embeddings), `airi-store` v2–v4 summaries/journal (audit §4.1 #52/#64–#67). Qt settings surface lands from this wave's sibling lane (memory journal/lifetime pages) — **not on disk at write time**. |
| 2 | Speech | **Ready** | Backend landed: `airi-speech` 26 TTS definitions + in-process Kokoro (`client_kokoro.rs`, `TtsStatus::Partial`). Qt TTS/STT settings surface is this wave's sibling lane (audit §4.1 #70) — **not on disk at write time**. |
| 3 | Hearing | **Ready** | Backend landed: `airi-stt` (capture, Silero VAD, Deepgram/Aliyun streaming + whisper-local; Aliyun token acquisition out of scope). Qt hearing settings surface is this wave's sibling lane (audit §4.1 #61) — **not on disk at write time**. |
| 4 | Vision | **Deferred** | No Qt vision stack; moondream/blip/apple-core-ai not in the Rust registry. Lives in the Electron app today (audit #73). |
| 5 | Consciousness | **Deferred** | No Qt counterpart (ConsciousnessWorkspace; large). Lives in the Electron app today (audit #59). |
| 6 | Agentic OS | **Deferred** | No Qt backend (presence / companion scopes / event log stores; large). Lives in the Electron app today (audit #55). |
| 7 | Text-to-Motion | **Deferred** | No Qt counterpart (FlowMDM, VRMA generation); P10-adjacent (VRMA/VMD). Lives in the Electron app today (audit #72, #97). |

**Integrations**

| # | Module | Status | Reason |
|---|--------|--------|--------|
| 8 | Discord | **Ready** (wired, send-only + opt-in gateway) | `DiscordController` bridge; Save & Verify, send, opt-in in-memory-only receive-only gateway (never auto-starts, never parses/dispatches, 100-event cap). No bot commands, no automation. Electron keeps the bot-commands path. Audit #68 ((c), "not planned") is stale against this wiring. |
| 9 | MCP | **Ready** (wired) | `McpController` bridge (`airi-mcp` stdio: initialize → tools/list → call), config at `mcp.json`. Discover stays a deferred preview. Audit #26/#221 ("(d) blocked, no Qt bridge/pages") stale against this wiring. |
| 10 | ACP / Agents | **Ready** (wired) | `AcpController` bridge; HITL permission prompts functional in Qt (p9-lane-acp-* notes). No audit row; landed in P9. |
| 11 | Cloud Sync | **Ready** (wired, partial) | `SyncController` bridge + `airi-sync` snapshot engine: local-folder target (persisted), snapshot list/refresh, Test Connection (probe), Sync Now, Verify, Restore (dry-run + explicit overwrite). S3, mesh sync, selective sync, interval slider: disabled. Audit #58 ("(d) blocked on sync-engine phase, no Qt sync backend", high) **predates this wiring** — see §7 staleness. `SettingsWindow.qml`'s trailing comment on the nav item ("scaffold; sync engine pending") is likewise stale; not editable from this lane. |
| 12 | Plugin Host | **Deferred** (scaffold/deferred host) | Qt renders the Plugins page (`qml/pages/devtools/plugin-host/PluginHostPage.qml`, UI-complete scaffold) but has **no** manifest discovery, enablement store, plugin-sdk bridge, or capability bus. Lives in the Electron main process (`apps/stage-tamagotchi/src/main/services/airi/plugins/`). Waived for Qt v1 via the devtools waiver (p11-audit §4.2, #40). |

**Renderers**

| # | Module | Status | Reason |
|---|--------|--------|--------|
| 13 | VRM | **Ready** | Qt stage renders VRM (`VrmMtoonMaterial` + stage scene); smoke-verified. |
| 14 | Spine | **Ready** | `SpineStage` + `SpineSettingsPage`; smoke-verified (p4-spine). |
| 15 | MMD | **Experimental** | Synthetic-verified rest pose only — no real, license-clean `.pmx` exercised (desk check pending). M2 unfinished (p9-wave10-decisions #4; p10-lane-mmd-m1, §7 "synthetic-fixture-only"). |
| 16 | Live2D | **Deferred** | License; no Qt Cubism runtime; Electron renders Live2D. `Live2dSettingsPage.qml` is a disabled placeholder today. |

**Card-AI**

| # | Module | Status | Reason |
|---|--------|--------|--------|
| 17 | Card Creation Studio | **Deferred** | Waived for Qt v1 → v1.1: 62 card-AI suite rows waived with dated reasons (`p9-wave10-decisions.md` §1). Lives in the Electron app today (openCard AI flows, CardCreate* suite). |

Counts: 17 entries = 9 Ready (incl. wired integrations), 1 Experimental,
7 Deferred. The audit's §4.1 #62 ("modules landing … S/M") is the row this
lane satisfies.

**Not shown (deliberately):** Artistry, Beat Sync, Friends/X/Factorio, beat-sync,
System-one, memory-short/long/lifetime/signals rows, EntityDetailModal,
LifetimeMemoryView/History/Provisioning, GlobalFacultiesMatrix — all either
deferred/greenfield (audit §4.1/§4.4), sibling-lane scope this wave, or waived.
Adding them here would be scope creep and would duplicate sibling pages.

## 4. Central integration steps (NOT done — owned by integration)

**`build.rs`** (`crates/airi-qt/build.rs`) — after the ACP line (currently
line 153), add:

```rust
    module = module.qml_file("qml/pages/settings/modules/ModulesSettingsPage.qml");
```

(`emit_rerun_if_changed` already walks the tree recursively, so the new file
is picked up for rebuilds once registered.)

**`bridges/mod.rs`** — **N/A.** QML-only page; no bridge, no `static`, no Rust.

**Settings nav** (`qml/shell/SettingsWindow.qml`) — do NOT insert in the
middle. Current max nav index is **24** (`acpAgents`; StackLayout indexes
0–24). Append at **end**:

```qml
// nav (after the acpAgents AListItem)
AListItem {
    Layout.fillWidth: true
    icon: "🧩"
    title: I18n.tr("shell.settings.nav.modules")   // new key, i18n lane's call
    active: settingsWindow.navIndex === 25
    onClicked: settingsWindow.navIndex = 25
}
```

```qml
// StackLayout (after AcpAgentsPage)
ModulesSettingsPage {
}
```

**Nav indexes must renumber** if any page is ever inserted before the end —
both the `AListItem`s and the `StackLayout` children are index-coupled. The
insert-at-end approach needs no renumbering of existing pages; index =
current max + 1 = **25**. Suggested nav label key `shell.settings.nav.modules`
(report to i18n lane; do not add here).

**No `qrc_resources` entry needed** (page has no JS assets).

## 5. i18n keys (report to i18n lane — do NOT add here)

All under `shell.modules.*` — the prefix is currently unused (the existing
`shell.data.modules.*` group is the Data page's "Module Settings" reset
section, unrelated; `shell.mcp.*`, `shell.widgets.*` are their own groups).
Suggested YAML nesting in `en/shell.yaml` (and es/fr/ja/zh-Hans/ko/… to
match house 4/4-locale parity):

```yaml
modules:                      # shell.modules.*
  title: 'Modules'
  overviewBadge: 'Overview'
  notice: 'Static overview of the module family — statuses verified by hand when this page landed; nothing here is live. The settings nav provides the routes; deferred entries are disabled.'
  footer: 'Deferred modules are disabled. This page does not toggle, connect, or persist anything.'
  sectionChat: 'Chat & Intelligence'
  sectionIntegrations: 'Integrations'
  sectionRenderers: 'Renderers'
  sectionCardAi: 'Card-AI'
  statusReady: 'Ready'
  statusExperimental: 'Experimental'
  statusDeferred: 'Deferred'
  entries:
    memory:      { blurb: '…', reason: '…' }
    speech:      { blurb: '…', reason: '…' }
    hearing:     { blurb: '…', reason: '…' }
    vision:      { blurb: '…', reason: '…' }
    consciousness: { blurb: '…', reason: '…' }
    agenticOs:   { blurb: '…', reason: '…' }
    textToMotion:{ blurb: '…', reason: '…' }
    discord:     { blurb: '…', reason: '…' }
    mcp:         { blurb: '…', reason: '…' }
    acp:         { blurb: '…', reason: '…' }
    cloudSync:   { blurb: '…', reason: '…' }
    pluginHost:  { blurb: '…', reason: '…' }
    vrm:         { blurb: '…', reason: '…' }
    spine:       { blurb: '…', reason: '…' }
    mmd:         { blurb: '…', reason: '…' }
    live2d:      { blurb: '…', reason: '…' }
    cardAiStudio:{ blurb: '…', reason: '…' }
```

**Exact key list (45 keys):**

`shell.modules.title`, `shell.modules.overviewBadge`, `shell.modules.notice`,
`shell.modules.footer`,
`shell.modules.sectionChat`, `shell.modules.sectionIntegrations`,
`shell.modules.sectionRenderers`, `shell.modules.sectionCardAi`,
`shell.modules.statusReady`, `shell.modules.statusExperimental`,
`shell.modules.statusDeferred`,
`shell.modules.entries.{memory,speech,hearing,vision,consciousness,agenticOs,textToMotion,discord,mcp,acp,cloudSync,pluginHost,vrm,spine,mmd,live2d,cardAiStudio}.blurb` (×17),
`shell.modules.entries.{…same 17…}.reason` (×17).

Suggested blurb/reason values (generic, no marketing fluff — final wording is
the i18n lane's call):

- memory.blurb: "Short- and long-term memory, journals and retrieval for your companion."
  memory.reason: "Ready in Qt — routes handled by the settings nav; backend landed in airi-core memory (journal, retrieval, embeddings); settings surface lands from this wave's sibling lane."
- speech.blurb: "Text-to-speech voice output for your companion."
  speech.reason: "Ready in Qt — backend landed in airi-speech (26 TTS definitions + Kokoro); Qt TTS/STT settings surface lands from this wave's sibling lane."
- hearing.blurb: "Microphone input, voice activity detection and transcription."
  hearing.reason: "Ready in Qt — backend landed in airi-stt (capture, Silero VAD, Deepgram/Aliyun/whisper-local); Qt hearing settings surface lands from this wave's sibling lane."
- vision.blurb: "Screen and camera visual perception."
  vision.reason: "Deferred — no Qt vision stack (moondream/blip/apple-core-ai not in the Rust registry); lives in the Electron app today (p11-audit #73)."
- consciousness.blurb: "Personality, reasoning and baseline model behavior."
  consciousness.reason: "Deferred — no Qt counterpart; lives in the Electron app today (p11-audit #59)."
- agenticOs.blurb: "Presence-driven autonomous behavior and OS automation hooks."
  agenticOs.reason: "Deferred — no Qt backend (presence, companion scopes, event log); lives in the Electron app today (p11-audit #55)."
- textToMotion.blurb: "Procedural animation generation from text (VRMA output)."
  textToMotion.reason: "Deferred — no Qt counterpart (FlowMDM / VRMA); P10-adjacent; lives in the Electron app today (p11-audit #72/#97)."
- discord.blurb: "Discord bot: send messages and watch a receive-only gateway."
  discord.reason: "Wired (send-only) — DiscordController bridge: verify, send, opt-in in-memory receive-only gateway; no bot commands; Electron keeps the full bot-commands path."
- mcp.blurb: "Model Context Protocol servers and tool suites."
  mcp.reason: "Wired — McpController bridge (airi-mcp stdio: initialize / tools-list / call), config at mcp.json; Discover deferred."
- acp.blurb: "Agent Client Protocol sessions with HITL permissions."
  acp.reason: "Wired — AcpController bridge; HITL permission prompts functional in Qt."
- cloudSync.blurb: "Back up snapshots to your own storage (BYOS)."
  cloudSync.reason: "Wired (partial) — SyncController bridge: local-folder target, snapshot verify/restore; S3/mesh/selective sync disabled."
- pluginHost.blurb: "Host for AIRI plugin packages."
  pluginHost.reason: "Scaffold only — Qt renders the Plugins page with no discovery/enablement/capability bus; lives in the Electron main process; waived for Qt v1 (p11-audit §4.2, #40)."
- vrm.blurb: "VRM model rendering and stage scene."
  vrm.reason: "Ready in Qt — VRM stage renders (VrmMtoonMaterial + stage scene); smoke-verified."
- spine.blurb: "Spine 2D skeletal animation models."
  spine.reason: "Ready in Qt — SpineStage + SpineSettingsPage; smoke-verified (p4-spine)."
- mmd.blurb: "MikuMikuDance models (.pmx/.pmd)."
  mmd.reason: "Experimental — synthetic-verified rest pose only; no license-clean real .pmx exercised (p9-wave10-decisions #4; p10-lane-mmd-m1)."
- live2d.blurb: "Live2D Cubism models."
  live2d.reason: "Deferred — license; no Qt Cubism runtime; Electron renders Live2D; Live2dSettingsPage.qml is a disabled placeholder."
- cardAiStudio.blurb: "AI-assisted character card creation studio."
  cardAiStudio.reason: "Deferred — waived for Qt v1, slated v1.1 (62 card-AI rows waived, p9-wave10-decisions); lives in the Electron app today."

Names (`Memory`, `Speech`, … `Card Creation Studio`) are intentionally
**literal**, not keys — module nouns shared with the nav vocabulary.

## 6. Honest limits

- **Static page.** Statuses were verified by hand at write time against the
  tree and the notes; nothing is live-checked. If a sibling lane lands or
  slips after this note merges, the badges do not follow automatically.
- **No live status** — by design; there is no module-status bridge and there
  will not be one for v1 from this lane.
- **Ready ≠ feature-complete.** Discord is send-only (no commands, no
  dispatch, receive-only in-memory gateway). MCP has no Discover. Cloud Sync
  is the local-folder BYOS slice only. MMD is synthetic-verified rest-pose
  only, never a real model. Speech/Hearing/Memory are backend-ready with Qt
  settings surfaces pending sibling lanes at write time.
- **Tooltip reasons are pinned prose**, not computed from bridge state.
- Not runtime-verified in this lane (no build; page unregistered).

## 7. Not done (explicit)

- GlobalFacultiesMatrix (Qt equivalent) — deferred, large (audit #216).
- Per-module toggles / settings affordances of any kind.
- Navigation plumbing (no `onClicked` on entries; no `settingsNavRequested`
  signal; nav provides routes).
- EntityDetailModal / Lifetime* modals / memory-signals surfaces (audit
  #215/#217–#219) — separate lanes.
- Registration (`build.rs` line), nav item, i18n keys, locale files, smoke
  verify — all with the integration step (§4) / i18n lane.
- Beat Sync row (audit #57; explicitly new work, not this page).
- System-one / Laya row (audit #71; blocked on airi-llm→airi-laya wiring
  decision).

## 8. Staleness found while reading (flag, don't fix)

1. `p11-audit.md` rows **#58** (cloud-sync "(d) blocked… no Qt sync backend",
   high), **#26/#221** (mcp "(d) blocked… no Qt bridge/pages", high),
   **#68** (messaging-discord "(c) not planned", medium) predate this wave's
   Discord/MCP/Cloud Sync wiring. This lane updates nothing in the audit; a
   manifest refresh should reclassify them before the next parity count.
2. `SettingsWindow.qml` nav comments are stale: Cloud Sync item says
   "scaffold; sync engine pending" while the page is wired for the local-FS
   slice; Plugin Host item says "devtools scaffold (host not wired)" — that
   one is still accurate.
3. `ModulesSettingsPage.qml` sibling folders `memory/ speech/ hearing/`
   (this wave) absent at write time — see checkpoint note up top.
4. `shell.data.modules.*` exists in `shell.yaml` under the Data page's "Reset
   Module Settings"; `shell.modules.*` itself is free. No clash.
5. MCP page header (in-tree) documents itself accurately; Discord/Cloud Sync
   headers likewise — trust the page headers over nav comments.
