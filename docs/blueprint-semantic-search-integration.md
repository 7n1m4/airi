# Blueprint: Cognitive Memory & Semantic Search Integration (AIRI)

This blueprint establishes the canonical production architecture for integrating AIRI's cognitive memory retrieval engine—informally known as **Universe RAG++**—into the application runtime. It bridges the breakthrough empirical findings of the **AIRI Memory Lab** (culminating in Pass 11's record **75.97% Upstream F1** and **68.87% Temporal F1** on the LoCoMo benchmark) with the real-world operational requirements of a living desktop companion.

---

## 🏗️ 1. Architecture Overview: The Hybrid Paradigm

We move beyond naive keyword search and simple flat vector similarity toward a **Hierarchical Hybrid Intelligence** architecture.

```
┌────────────────────────────────────────────────────────────────────────────────────────┐
│                               USER INPUT / SYSTEM TURN                                 │
└──────────────────────────────────────────┬─────────────────────────────────────────────┘
                                           │
                                           ▼
┌────────────────────────────────────────────────────────────────────────────────────────┐
│                        UNIVERSE RAG++ RETRIEVAL ENGINE                                 │
│                                                                                        │
│   1. Query Analysis & Turn-1 Anaphora Resolution (Resolves "he", "she", "that")         │
│   2. Multi-Plan Candidate Generation (Base Fact, Temporal Events, Bridge Links)        │
│   3. Date-Hook Candidate Pool Budgeting (Preserves wide temporal windows)             │
│   4. Level-1 Hybrid Scoring:                                                           │
│      • Browser-Native Baseline: BGE-small embeddings + BM25 Lexical Scorer              │
│      • Optional Precision Booster: Cross-Encoder Reranking (Local Laya or Cloud Jev)   │
└──────────────────────────────────────────┬─────────────────────────────────────────────┘
                                           │
                                           │ Injects Formatted Evidence Block:
                                           │ [Retrieved Memory Context: ...]
                                           ▼
┌────────────────────────────────────────────────────────────────────────────────────────┐
│                                COGNITION PIPELINE                                      │
│                                                                                        │
│   Option A: Standard Direct               Option B: Nan0 Affective Pipeline            │
│   ┌───────────────────────────┐           ┌────────────────────────────────────────┐   │
│   │ • 1 Hop                   │           │ • Hop 1: Nan0 Emotional Internal Mind  │   │
│   │ • User Prompt + Context   │           │   (Attention, Monologue, Mood, Veto)   │   │
│   │ • Direct LLM Character    │           │ • Hop 2: Character Voice               │   │
│   └───────────────────────────┘           └────────────────────────────────────────┘   │
│                                                                                        │
│                   Option C: Universe RAG++ Epistemic Pipeline                          │
│                   ┌────────────────────────────────────────┐                           │
│                   │ • Hop 1: System-2 Deductive Coprocessor│                           │
│                   │   (Multi-hop, Temporal Math, Dossier)  │                           │
│                   │ • Hop 2: Character Voice (Speech)      │                           │
│                   └────────────────────────────────────────┘                           │
└────────────────────────────────────────────────────────────────────────────────────────┘
```

AIRI splits the computational workload to achieve hyperscale reasoning while maintaining a zero-install, privacy-first, browser-native storage runtime:

| Layer | Implementation | Operational Profile |
| :--- | :--- | :--- |
| **Knowledge Graph Substrate** | In-memory `EntityLedger` (`byAlias`, `claims`, `entities`, `sources`) + IndexedDB persistence (`local:entity-ledger:{characterId}`) | 100% offline, zero API cost, 0ms exact relational & alias graph traversal. |
| **Level 1 Search (Candidate Recall)** | In-memory BGE-small (`Xenova/bge-small-en-v1.5`) + BM25 via [`search.worker.ts`](file:///Users/richardpinedo/Projects.nosync/airi/airi_dasilva333/packages/stage-ui/src/libs/workers/search/search.worker.ts) | 100% offline, zero API cost, <50ms lookup. |
| **Level 1 Booster (Triage & Precision Rerank)** | Local ONNX Coprocessor (Laya) or Cloud REST API (Jev) | Optional System 1 booster; executes zero-shot query triage (C1–C4) and cross-encoder candidate reranking, lifting top-1 precision from ~65% to >75%. |
| **Level 2 Reasoning (Epistemic Deduction)** | Structured LLM Coprocessor (Configured User API or High-Tier Local LLM) | Dispatched conditionally for complex multi-hop or temporal contradictions. |
| **Storage & Index Snapshotting** | Persistent IndexedDB (`airi-search-index`, `text-journal.repo`, `local:entity-ledger:*`) | Flat universe-keyed persistence; zero external database server required. |

---

## 🎯 2. The 4 Consumers of Semantic Search

Semantic search within AIRI is not a single monolith. It serves **four distinct consumers**, each with fundamentally different latency tolerances, reasoning requirements, and presentation contracts.

```
┌─────────────────────────────────────────────────────────────────────────────────────────┐
│                           UNIVERSE RAG++ CORE RETRIEVAL                                 │
└──────────────┬──────────────────────────┬───────────────────────────┬───────────────────┘
               │                          │                           │                   │
               ▼                          ▼                           ▼                   ▼
    [ Consumer 1: User UI ]    [ Consumer 2: In-Flight ]    [ Consumer 3: Agent Tool ] [ Consumer 4: Background ]
    • Memory Hub / Dashboard   • Active Chat Injection      • `text_journal.search`    • Dreaming & Proactivity
    • Verbatim cards/snippets  • Fast L1 context            • Clean verbatim evidence  • Batch L1 + L2
    • Pure L1 (No System-2)    • Conditional L2 if enabled  • Agent reasons itself     • Zero UI latency pressure
    • Latency: <100ms          • Latency: <300ms            • Latency: <200ms          • Latency: Asynchronous
```

### Consumer 1: Human User Search (Memory Hub / Search Archive Inspector)
* **Surface**: Settings Long-Term Memory Dashboard (`memory-long-term.vue`), Search Archive input bar, and conversation history inspector.
* **Execution Tier**: **Level 1 Dual-Channel Engine** (Entity Ledger Graph Traversal + BGE-small vector search + BM25 keyword matching + optional Laya/Jev triage & cross-encoder reranking).
* **Strict Constraint**: **ZERO System-2 LLM synthesis**.
* **Design Rationale**: When a human types into a search box, they expect an immediate, faithful index of what was actually said or recorded. They want exact timestamps, matched phrases, source session IDs, and verbatim memory cards. Injecting an LLM synthesis pass here introduces latency (>1.5s), hides the raw data, and risks hallucinating memory contents.
* **Latency Budget**: `<100ms`.
* **Interactive UI Presentation**:
  - **Triage Status Indicator**: When System 1 is configured, displays live category status chips derived from Pass 11 triage (e.g. `[PASS 11: C1 MULTI-HOP]`, `[PASS 11: C2 TEMPORAL]`, `[PASS 11: C4 LITERAL]`). When System 1 is disabled/offline, gracefully falls back to `[HYBRID RRF: BASELINE]`.
  - **Unified Card Rendering**:
    - `[KNOWLEDGE GRAPH]`: Displays relational triples (`[Subject] ➔ [Predicate] ➔ [Object]`) with a 1-click trigger opening the [`EntityDetailModal`](file:///Users/richardpinedo/Projects.nosync/airi/airi_dasilva333/packages/stage-pages/src/pages/settings/modules/components/EntityDetailModal.vue) for full cognitive audit history and dialogue provenance.
    - `[JOURNAL]`: Verbatim episodic text notes created via `txt_journal`.
    - `[RECAP]`: Daily STMM memory blocks.
    - `[CHAT]`: Chronological dialogue turn sources.
  - **Smooth Reset**: Clearing the search input immediately restores the standard chronological journal records view.

### Consumer 2: In-Flight Chat Memory (Universe RAG Pre-Flight Grounding)
* **Surface**: Live conversation ingestion in [`packages/stage-ui/src/stores/chat.ts`](file:///Users/richardpinedo/Projects.nosync/airi/airi_dasilva333/packages/stage-ui/src/stores/chat.ts).
* **Execution Tier**: **Level 1 by default**, with **Conditional System-2 Escalation**.
* **Default Flow**: Upon receiving user input, the engine extracts the focus query using Turn-1 anaphora resolution, fetches top candidates across layered memory (LTMM, STMM, Raw), applies reciprocal rank fusion (and Laya/Jev reranking if available), and formats an evidence block injected into the prompt context.
* **Escalation Rules**: System-2 escalation occurs **only** when:
  1. The user explicitly enables *"Deep Memory Reasoning (System 2)"* in application settings; AND
  2. The query analyzer detects multi-hop dependency, complex temporal arithmetic, or contradictory memory claims that Level 1 candidate confidence cannot cleanly resolve.
* **Latency Budget**: `<300ms` for default Level 1; background streaming if Level 2 is escalated.

### Consumer 3: Agent Tool (`text_journal.search`)
* **Surface**: Autonomous tool calling by the assistant LLM during conversational turns or task execution.
* **Execution Tier**: **Pure Level 1**.
* **Strict Constraint**: **NO embedded System-2 synthesis inside the tool**.
* **Design Rationale**: The calling agent *is already an LLM*. Wrapping `text_journal.search` in an internal second LLM synthesis call burns unnecessary tokens, adds round-trip latency, conceals raw evidence, and robs the agent of the ability to conduct its own multi-query investigation.
* **Contract**: Returns clean, structured, high-precision evidence objects:
  ```json
  [
    {
      "id": "entry-9042",
      "date": "2024-06-12",
      "subject": "Guitar Lessons",
      "fact": "Started taking acoustic guitar lessons every Tuesday with Marcus.",
      "observed_text": "Had my first guitar lesson today! Marcus is teaching me fingerstyle.",
      "relevanceScore": 0.91
    }
  ]
  ```
  The calling agent can inspect the verbatim evidence, make deductions, or immediately issue a second search with refined terms.
* **Latency Budget**: `<200ms`.

### Consumer 4: Offline Background Workers (Dreaming & Consolidation)
* **Surface**: Dreaming Worker, Long-Term Memory consolidation, and sensory proactivity engines.
* **Execution Tier**: **Full Batch Level 1 + Level 2**.
* **Characteristics**: Runs when the user is idle, during sleep/dreaming phases, or via `requestIdleCallback`. Because there is zero UI keystroke pressure, the worker executes broad multi-hop clustering, PCL contradiction resolution, and deep profile synthesis.
* **Latency Budget**: Unconstrained (asynchronous).

---

## ⚡ 3. Execution Tiers & The Zero-Install Fallback Floor

A critical requirement of AIRI is **universal zero-install portability**. The system must never fail or block the user if specialized models are absent.

```
┌────────────────────────────────────────────────────────────────────────┐
│ LEVEL 2: DEDUCTIVE COPROCESSOR (System 2)                             │
│ • Multi-hop reasoning, temporal graph verification, conflict resolution│
│ • Dispatched via User LLM API or Local High-Tier Model                │
└──────────────────────────────────▲─────────────────────────────────────┘
                                   │ (Escalation)
┌──────────────────────────────────┴─────────────────────────────────────┐
│ LEVEL 1 BOOSTER: CROSS-ENCODER RERANKER                                │
│ • Local ONNX (Laya) or Cloud REST API (Jev)                            │
│ • Re-scores top-30 candidate pool to precision top-5                  │
└──────────────────────────────────▲─────────────────────────────────────┘
                                   │ (Optional Enhancement)
┌──────────────────────────────────┴─────────────────────────────────────┐
│ THE FALLBACK FLOOR: BROWSER-NATIVE SEARCH WORKER (Level 1 Baseline)    │
│ • Transformers.js (Xenova/bge-small-en-v1.5 on WebGPU/WASM)            │
│ • Pure In-Memory BM25 Lexical Inverted Index                           │
│ • 100% Offline, Zero-Install, Zero API Cost                            │
└────────────────────────────────────────────────────────────────────────┘
```

### The Baseline Floor
The foundation of the retrieval system is [`search.worker.ts`](file:///Users/richardpinedo/Projects.nosync/airi/airi_dasilva333/packages/stage-ui/src/libs/workers/search/search.worker.ts):
- Runs entirely inside a Web Worker using `@huggingface/transformers` (`Xenova/bge-small-en-v1.5`) compiled to WebGPU/WASM.
- Maintains an in-memory BM25 inverted index alongside document embeddings.
- Automatically persists index snapshots to IndexedDB (`airi-search-index`).
- **Guarantee**: Even on a fresh browser tab with no internet connection and no API keys, semantic and lexical memory retrieval works out of the box.

### The Level-1 Booster (Laya / Jev)
- **Laya**: A compact, local ONNX cross-encoder model running via ONNX Runtime Web.
- **Jev**: A cloud REST endpoint providing high-speed cross-encoder reranking.
- **Contract**: Laya and Jev are **optional performance boosters**, NOT hard system requirements. If neither is configured or available, the engine smoothly falls back to weighted Reciprocal Rank Fusion (RRF) using vector cosine similarity, BM25 score, and temporal proximity.

---

## 🧭 3.5 The Pass 11 Cognitive Retrieval Engine: Triage (C1–C4) & Category-Adapted Graph Strategies

In the AIRI Memory Lab, Pass 11 demonstrated that a single flat retrieval strategy cannot satisfy conversational memory. Different questions demand fundamentally different retrieval geometries.

AIRI integrates the canonical Pass 11 **Triage-Driven Dual Search Engine** (`DualSearcherPass3`):

```
┌────────────────────────────────────────────────────────────────────────────────────────┐
│                              INCOMING SEARCH / CHAT QUERY                              │
└──────────────────────────────────────────┬─────────────────────────────────────────────┘
                                           │
                        ┌──────────────────┴──────────────────┐
                        │ Is System 1 (Jev/Laya) Configured?  │
                        └─────────┬─────────────────┬─────────┘
                                  │ YES             │ NO (Offline / Disabled)
                                  ▼                 ▼
             ┌──────────────────────────────┐     ┌──────────────────────────────┐
             │ System 1 Zero-Shot Triage    │     │ Rule-Based Heuristic Triage  │
             │ (JEV_TRIAGE_SCHEMA)          │     │ (Regex date, list, literal)  │
             └──────────────┬───────────────┘     └──────────────┬───────────────┘
                            │                                    │
                            ▼                                    ▼
┌────────────────────────────────────────────────────────────────────────────────────────┐
│                        CATEGORY-ADAPTED RETRIEVAL STRATEGY                             │
│                                                                                        │
│  • C1: MULTI-HOP (Lists, Aggregation, Cross-Session Facts)                             │
│    - Expands candidate search limit from 15 to 25; searchScope: 'multi_session'         │
│    - Entity Graph Traversal: queries relational claims across sessions, joining proof  │
│      bundles without requiring intermediate LLM synthesis                              │
│                                                                                        │
│  • C2: TEMPORAL (Dates, Sequence, Elapsed Duration)                                    │
│    - Date-Hook Candidate Pool Budgeting: reserves ≥25% quota (min 3 slots) for dates   │
│    - Entity Graph Traversal: inspects entity mention timestamps & event date edges     │
│                                                                                        │
│  • C3: DETECTIVE / DEDUCTION (Implication, Location, World Knowledge)                  │
│    - Surfaces wide-context candidate turns; resolves entity administrative attributes  │
│                                                                                        │
│  • C4: LITERAL (Explicit Single Statement, Named Entity)                               │
│    - Rebalances hybrid scorer to 50% BM25 keyword / 50% vector cosine similarity       │
│    - Instant index hit via Entity Ledger byAlias directory                             │
└──────────────────────────────────────────┬─────────────────────────────────────────────┘
                                           │
                                           ▼
┌────────────────────────────────────────────────────────────────────────────────────────┐
│                        FUSION & LEVEL-1 CROSS-ENCODER RERANKING                        │
│                                                                                        │
│  • If System 1 Active: Batched Cross-Encoder Rerank (Jev/Laya) rescores top candidates │
│  • If System 1 Inactive: Fast Reciprocal Rank Fusion (RRF) with date-hook reservations │
│  • Guaranteed Invariant: Knowledge Graph lookups are 100% offline & ALWAYS queried    │
└────────────────────────────────────────────────────────────────────────────────────────┘
```

### 1. The Zero-Shot Triage Schema (`JEV_TRIAGE_SCHEMA`)
Located in [`packages/stage-ui/src/stores/modules/system-one.ts`](file:///Users/richardpinedo/Projects.nosync/airi/airi_dasilva333/packages/stage-ui/src/stores/modules/system-one.ts), triage maps queries into three orthogonal dimensions:
1. **`category`**:
   - `c1_multihop`: Requires joining, listing, counting, or aggregating multiple facts across different conversations (e.g. *"What pets does Asuka talk about?"*, *"List all the games we played"*).
   - `c2_temporal`: Asks when an event occurred, dates, duration, elapsed time, or sequence order (e.g. *"When did we go to Tokyo-3?"*).
   - `c3_detective`: Requires deductive reasoning, unstated implication, or geographic inference.
   - `c4_literal`: Direct retrieval of a single specific named entity or statement mentioned explicitly.
2. **`temporal_subtype`**: `calendar_date` vs `duration` vs `none`.
3. **`search_scope`**: `single_session` vs `multi_session`.

### 2. Category-Adapted Search Strategies
- **C1 Multi-Hop Strategy**: Expands the candidate search limit to 25 and return budget to 6+. Directly traverses the `EntityLedger` (`ledger.queryClaims(query)` and `ledger.byObjectPredicate`), pulling connected triples and proof bundles across all sessions.
- **C2 Temporal Strategy**: Enforces the **Date-Hook Candidate Quota** (reserving minimum 3 candidate slots so superficial semantic matches cannot displace dated records), while querying `ledger.queryEventDate(subject, object)` for explicit event edges.
- **C3 Detective Strategy**: Explores place and organization entities and their resolved attributes (e.g. residency, location, affiliations).
- **C4 Literal Strategy**: Adjusts hybrid weights to 0.50 BM25 / 0.50 vector to lock onto exact proper nouns and phrasing, accompanied by instantaneous `ledger.byAlias` hash lookups.

### 3. Graceful Degradation: System 1 Enabled vs. Disabled
A critical design requirement is that **disabling System 1 must NEVER disable semantic search or discard the Knowledge Graph**:
- **Knowledge Graph Invariant**: The `EntityLedger` is persisted in IndexedDB (`local:entity-ledger:{characterId}`). Once generated, querying `ledger.byAlias` or `ledger.queryClaims` is pure in-memory JavaScript `Map` lookups—**costing 0 API tokens and 0ms latency**. The system ALWAYS queries the graph regardless of whether System 1 is active.
- **Triage Fallback**: If System 1 is unconfigured or disabled, query analysis executes deterministic rule-based triage (detecting `when`/date hooks for C2, `list`/`all` keywords for C1, or literal for C4) and evaluates candidates with Reciprocal Rank Fusion (RRF) over the browser-native BGE-small + BM25 Web Worker.
- **System 1 Active**: Executes `systemOneStore.runTriage` for cognitive categorization, applies category-adapted dual search, and runs `systemOneStore.runRerank` for cross-encoder reranking.

---

## 🧠 4. Upstream Injection & The Cognition Pipeline

A common point of confusion is whether the **Cognition Pipeline** (e.g. Nan0) and **Universe RAG++** are mutually exclusive or "cross wires."

In AIRI, they do not collide—they **compose naturally across pipeline stages**:
1. **Memory Retrieval (Universe RAG) is UPSTREAM of Cognition**: When a user turn begins, Universe RAG executes first, retrieving relevant facts from LTMM/STMM and formatting them into a standard contextual memory block.
2. **Cognition Consumes the Grounded Input**: The Cognition Pipeline receives `[User Message + Injected Memory Context]` as its baseline input.

```
                  [User Input: "What's the door pin code?"]
                                     │
                                     ▼
                [Universe RAG++ Level 1 Hybrid Search]
                                     │
                                     ▼
              Injected Context: "Pin code to apartment: 4821"
                                     │
               ┌─────────────────────┴─────────────────────┐
               ▼                                           ▼
      [Nan0 Mode Active]                        [Universe RAG++ Mode Active]
      Hop 1: Nan0 Internal Mind                 Hop 1: Epistemic Analyst
      - Ingests User Prompt + Injected Context   - Ingests User Prompt + Injected Context
      - Knows pin code is 4821                   - Resolves multi-hop / temporal links
      - Decides Tsundere attitude                - Produces verified Epistemic Dossier
      - [MONOLOGUE] "He forgot again..."         Hop 2: Character Voice
      - [EMOTION] Annoyed / Affectionate         - Natural dialogue using dossier
      Hop 2: Character Voice
      - "Did you seriously forget it's 4821?"
```

### The 3 Cognition Pipeline Modes
In the application settings, users can select how AIRI's cognitive architecture processes incoming dialogue:

| Mode | Pipeline Shape | Focus | Primary Advantage |
| :--- | :--- | :--- | :--- |
| **1. Standard (Direct)** | 1-Hop: `Prompt + Memory Context` → LLM Character Voice | Conversational Fluidity | Lowest latency, zero intermediate token overhead. |
| **2. Nan0 Affective Pipeline** | 2-Hop: `Prompt + Memory Context` → Nan0 Internal Mind (`[MONOLOGUE]`, `[EMOTION]`, `[DECISION]`) → Character Voice | Affective Biology & "Sims Mode" | Deep emotional personality, relationship grudges, dynamic mood decay, silence vetoes. |
| **3. Universe RAG++ Epistemic Pipeline** | 2-Hop: `Prompt + Memory Context` → System-2 Deductive Coprocessor (Fact Dossier) → Character Voice | Epistemic Precision & Detective Logic | Zero hallucination on dates, multi-hop reasoning, temporal timelines, and contradiction resolution. |

> [!NOTE]
> When **Nan0 Mode** is active, Nan0's private monologue is already grounded in the facts retrieved by Universe RAG. If the user asks for their apartment pin code, Nan0's first hop knows the pin is `4821` and can express personality around that knowledge (e.g. *"He's asking for the pin code again... typical baka"*). The wires do not short-circuit; epistemic memory feeds affective reasoning.

---

## 🛠️ 5. Turn-1 Anaphora Resolution & Temporal Hooks

Benchmark passes 10 and 11 demonstrated that static single-turn retrieval catastrophically fails when queries contain anaphoric references (e.g. *"When did he leave?"* or *"Where was that restaurant?"*).

### Turn-1 Sliding Anaphora Window
Before executing search plans, the query preprocessor inspects the immediate preceding dialogue turn:
1. **Pronoun & Reference Detection**: Detects unresolved pronouns (`he`, `she`, `they`, `it`, `that`, `there`).
2. **Preceding Turn Context**: Binds the preceding user prompt and assistant reply into the focus query constructor.
3. **Reranker Context Preservation**: Crucially, this context is attached as a contextual prefix into the candidate reranker pool, ensuring cross-encoders (Laya/Jev) evaluate candidate documents against the full conversational context rather than the ambiguous standalone sentence.

### Date-Hook Candidate Pool Budgeting
Temporal and multi-hop queries frequently rely on anchor dates (e.g. *"What did John do the day after his birthday?"*):
- Rather than discarding date-matched candidates during initial lexical filtering, the candidate fusion layer reserves a guaranteed **Date-Hook Quota** (minimum 25% of candidate pool capacity).
- This prevents high-scoring superficial text matches from crowding out the exact dated journal records required for chronological math.

---

## 🔄 6. Memory Lifecycle & Predict-Calibrate Learning (PCL)

To prevent memory from decaying into an unsearchable, contradictory swamp, AIRI adopts the **Predict-Calibrate Learning (PCL)** model:

```
                  [New Episode / Conversation Turn]
                                  │
                                  ▼
                   ┌──────────────────────────────┐
                   │        PREDICT PHASE         │
                   │ Agent predicts episode facts │
                   │ based on existing LTMM/STMM  │
                   └──────────────┬───────────────┘
                                  │
                                  ▼
                   ┌──────────────────────────────┐
                   │       CALIBRATE PHASE        │
                   │ Compare Prediction to Actual │
                   │ Conversation Reality         │
                   └──────────────┬───────────────┘
                                  │
         ┌──────────────┬─────────┴────────┬──────────────┐
         ▼              ▼                  ▼              ▼
     [`new`]     [`reinforce`]         [`update`]   [`invalidate`]
   Novel fact     Confirmed fact      Contradicted    Fact proven
     created        strengthened      fact replaced    false (tombstone)
```

### The Sacred Journal Rule
- **Pillar 2 (LTMM Text Journal)** entries created directly by the user or explicitly confirmed are **immutable and append-only**.
- Automated background workers may create derived facts, synthesis summaries, and FSRS retrievability markers, but **must never silently delete or overwrite Sacred Journal records**.

### Free Spaced Repetition Scheduler (FSRS)
- Episodic memories decay over time using FSRS retrievability scoring:
  $$R(t) = \left(1 + \text{factor} \cdot \frac{t}{S}\right)^{-1}$$
- **Surprise-Driven Stability**: High-entropy emotional events (detected via valence/arousal shifts) receive an initial stability boost, preserving significant relationship milestones while mundane chatter naturally fades from active retrieval.

---

## 📦 7. Apalis Equivalent for Web: Reliable Background Jobs

Background consolidation cannot rely on server daemons in a client-side environment. AIRI implements reliable background execution via standard browser primitives:

| Feature | Architecture | Implementation |
| :--- | :--- | :--- |
| **Job Queue** | Persistent IndexedDB Store | `airi-consolidation-jobs` store tracking job status (`pending`, `active`, `completed`, `failed`). |
| **Job Worker** | Web Worker Thread | `cognitive-worker.ts` executes extraction, PCL reconciliation, and embedding off the main UI thread. |
| **Scheduler** | Cooperative Idle Loop | `requestIdleCallback` + visibility state listeners trigger batches when system load is low. |
| **Resilience & Tombstoning** | Atomic State Transitions | If a tab is closed mid-consolidation, incomplete jobs remain in `pending` and are cleanly resumed upon next boot. |

---

## 🎓 8. Benchmark to Production Graduation Matrix & Progress Tracker

Pass 11 established an all-time record score of **75.97% Upstream F1** on the LoCoMo benchmark. Production integration proceeds through targeted, auditable phases:

| Component | Status | Production Destination | Rationale |
| :--- | :--- | :--- | :--- |
| **Turn-1 Anaphora Resolution** | **Graduate** | [`packages/stage-ui/src/libs/search/`](file:///Users/richardpinedo/Projects.nosync/airi/airi_dasilva333/packages/stage-ui/src/libs/search/) | Essential for natural dialogue pronoun resolution. |
| **Date-Hook Candidate Quota** | **Graduate** | [`packages/stage-ui/src/libs/search/hybrid-scorer.ts`](file:///Users/richardpinedo/Projects.nosync/airi/airi_dasilva333/packages/stage-ui/src/libs/search/hybrid-scorer.ts) | Prevents chronological fact loss in temporal queries. |
| **Laya / Jev Reranking Booster** | **Graduate** | [`packages/stage-ui/src/libs/search/`](file:///Users/richardpinedo/Projects.nosync/airi/airi_dasilva333/packages/stage-ui/src/libs/search/) | Optional Level-1 precision amplifier with fallback floor. |
| **In-Memory Entity Ledger Substrate** | **Graduate** | [`packages/stage-ui/src/stores/entity-ledger.ts`](file:///Users/richardpinedo/Projects.nosync/airi/airi_dasilva333/packages/stage-ui/src/stores/entity-ledger.ts) | Indexed secondary Maps for 0ms relational traversal and proof bundles. |
| **Strict Fail-Closed Validation** | **Graduate** | [`packages/stage-ui/src/stores/chat.ts`](file:///Users/richardpinedo/Projects.nosync/airi/airi_dasilva333/packages/stage-ui/src/stores/chat.ts) | Prevents hallucinations when evidence is missing. |
| **Hyper-Terse Answer Compression** | **Lab Only** | *Discarded* | LoCoMo rewards 2-word answers; companion dialogue requires natural character voice. |
| **Dataset-Specific Category Hardcoding** | **Lab Only** | *Discarded* | Replaced by general query intent signals (`isTemporal`, `isMultiHop`). |
| **Monolithic Joint Batch Prompting** | **Lab Only** | *Discarded* | Real conversations occur turn-by-turn, not in 150-question batches. |

### Implementation Roadmap & Milestone Status

- **Phase 4.1: Knowledge Graph Substrate & System 1 Zero-Shot Classification** — ✅ **SHIPPED** (Commit `4f9434b4e7`):
  - Purged brittle regex dictionaries/hardcodes (`COMMON_ANIMALS`, `KNOWN_PLACES`, `KNOWN_PERSONS`, etc.).
  - Integrated System 1 (TypeSafe Jev / Local Laya) Zero-Shot Entity Classification (`JEV_ENTITY_CLASSIFIER_SCHEMA`) with taxonomy expansion (`person`, `animal`, `place`, `organization`, `activity`, `concept`, `unknown`) and conversational artifact pruning.
  - Built [`EntityDetailModal.vue`](file:///Users/richardpinedo/Projects.nosync/airi/airi_dasilva333/packages/stage-pages/src/pages/settings/modules/components/EntityDetailModal.vue) providing full cognitive audit visibility (model, confidence, logprob distribution, live re-evaluation), chronological dialogue provenance, connected relational triples, and noise deletion.
  - Full IndexedDB persistence via `local:entity-ledger:{characterId}`.

- **Phase 4.2: Consumer 1 - Search Archive Box & Dual-Channel Retrieval Engine** — 🔄 **ACTIVE / IN-PROGRESS**:
  - Wiring Pass 11 Zero-Shot Triage (`systemOneStore.runTriage`) and category-adapted search strategies (C1 Multi-Hop, C2 Temporal, C3 Detective, C4 Literal) into `textJournalStore.searchEntries`.
  - Dual-tier execution: Pass 11 booster when System 1 is active, graceful baseline floor with existing graph lookups when disabled.
  - Interactive UI presentation in the Long-Term Memory Search Archive box: live category/tier chips (`[PASS 11: C1 MULTI-HOP]`, `[HYBRID RRF: BASELINE]`), and unified card rendering (`[KNOWLEDGE GRAPH]` triples, `[JOURNAL]` entries, `[RECAP]` blocks, `[CHAT]` turns).

- **Phase 4.3: Consumer 2 - In-Flight Chat Memory (Pre-Flight Grounding)** — ⏳ **UPCOMING**:
  - Prompt injection integration in `packages/stage-ui/src/stores/chat.ts` with Turn-1 anaphora resolution and evidence context formatting.

- **Phase 4.4: Consumer 3 - Agent Tool (`text_journal.search`)** — ⏳ **UPCOMING**:
  - Exposing high-precision Level 1 search to autonomous tool calling without secondary LLM synthesis.

- **Phase 4.5: Consumer 4 - Offline Background Workers (Dreaming & PCL)** — ⏳ **UPCOMING**:
  - Unconstrained background consolidation, contradiction reconciliation, and FSRS decay maintenance.

---

## 🗺️ 9. File Mapping & Implementation Seams

| Subsystem | Canonical Path | Responsibility |
| :--- | :--- | :--- |
| **Knowledge Graph Ledger** | [`packages/stage-ui/src/libs/search/entity-ledger.ts`](file:///Users/richardpinedo/Projects.nosync/airi/airi_dasilva333/packages/stage-ui/src/libs/search/entity-ledger.ts) | Normalized Maps (`entities`, `claims`, `sources`, `byAlias`, `byObjectPredicate`). |
| **Knowledge Graph Store** | [`packages/stage-ui/src/stores/entity-ledger.ts`](file:///Users/richardpinedo/Projects.nosync/airi/airi_dasilva333/packages/stage-ui/src/stores/entity-ledger.ts) | Ledger lifecycle, IndexedDB persistence, provenance lookups, reclassification. |
| **Ledger Priming Engine** | [`packages/stage-ui/src/libs/search/ledger-priming.ts`](file:///Users/richardpinedo/Projects.nosync/airi/airi_dasilva333/packages/stage-ui/src/libs/search/ledger-priming.ts) | Turn knowledge extraction, System 1 entity classifier, candidate mention proposal. |
| **Entity Detail Inspector UI** | [`packages/stage-pages/src/pages/settings/modules/components/EntityDetailModal.vue`](file:///Users/richardpinedo/Projects.nosync/airi/airi_dasilva333/packages/stage-pages/src/pages/settings/modules/components/EntityDetailModal.vue) | Cognitive audit modal, probability distribution, dialogue provenance, noise pruning. |
| **Search Web Worker** | [`packages/stage-ui/src/libs/workers/search/search.worker.ts`](file:///Users/richardpinedo/Projects.nosync/airi/airi_dasilva333/packages/stage-ui/src/libs/workers/search/search.worker.ts) | BGE-small embeddings + BM25 inverted index in Web Worker. |
| **Layered Memory Adapter** | [`packages/stage-ui/src/libs/search/layered-memory.ts`](file:///Users/richardpinedo/Projects.nosync/airi/airi_dasilva333/packages/stage-ui/src/libs/search/layered-memory.ts) | Cross-pillar query orchestration across LTMM, STMM, and Raw history. |
| **Hybrid Scorer & Fusion** | [`packages/stage-ui/src/libs/search/hybrid-scorer.ts`](file:///Users/richardpinedo/Projects.nosync/airi/airi_dasilva333/packages/stage-ui/src/libs/search/hybrid-scorer.ts) | RRF fusion, temporal weights, date-hook reservations, and MMR diversity. |
| **System 1 Cognitive Store** | [`packages/stage-ui/src/stores/modules/system-one.ts`](file:///Users/richardpinedo/Projects.nosync/airi/airi_dasilva333/packages/stage-ui/src/stores/modules/system-one.ts) | Jev/Laya zero-shot triage (`runTriage`), rerank (`runRerank`), and entity classifier. |
| **Search Archive UI (Consumer 1)**| [`packages/stage-pages/src/pages/settings/modules/memory-long-term.vue`](file:///Users/richardpinedo/Projects.nosync/airi/airi_dasilva333/packages/stage-pages/src/pages/settings/modules/memory-long-term.vue) | Search Archive box, triage status chips, unified results view. |
| **Chat Ingestion Orchestrator** | [`packages/stage-ui/src/stores/chat.ts`](file:///Users/richardpinedo/Projects.nosync/airi/airi_dasilva333/packages/stage-ui/src/stores/chat.ts) | Ingestion pipeline, pre-flight grounding, and cognition dispatch. |
| **Agent Tool Definition** | [`packages/stage-ui/src/stores/memory-text-journal.ts`](file:///Users/richardpinedo/Projects.nosync/airi/airi_dasilva333/packages/stage-ui/src/stores/memory-text-journal.ts) | Exposes `text_journal.search` as pure Level 1 verbatim tool. |
| **Cognition Pipeline Seam** | [`packages/stage-ui/src/stores/chat/`](file:///Users/richardpinedo/Projects.nosync/airi/airi_dasilva333/packages/stage-ui/src/stores/chat/) | Houses Standard, Nan0 Affective, and Universe RAG++ Epistemic dispatchers. |
| **Cognitive Consolidation Worker** | `packages/stage-ui/src/libs/workers/memory/cognitive-worker.ts` | PCL consolidation, FSRS decay updates, and lifetime summarization. |

---

## Related Skills & References

- [[airi-memory-retrieval-engine]] — Query analysis, search plans, candidate fusion, and reranking.
- [[airi-memory-systems]] — The Eight Pillars hub and universe-keyed persistence.
- [[airi-interaction-pipelines]] — Ingestion routing, prompt assembly, and streaming handoffs.
- [[airi-memory-consolidation-dreaming]] — Dreaming worker, PCL contradictions, and memory consolidation.
