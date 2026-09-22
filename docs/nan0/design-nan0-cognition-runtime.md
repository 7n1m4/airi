# Architectural Assessment & Integration Spec: Project Nan0 Cognition Runtime & Needle Due Diligence

**Status:** Technical Due Diligence & Architecture Specification
**Author:** AIRI Engineering & AI Assistant
**Date:** 2026-09-16
**Target Systems:**
- `packages/nan0-runtime/` (Canonical Nan0 Runtime Package from `kayo-nan0`)
- `packages/stage-ui/src/stores/nan0.ts`, `nan0-bridge.ts`, `nan0-config.ts`
- `packages/stage-ui/src/stores/chat.ts` (Official Two-Hop Cognition Pipeline Seam)
- `packages/stage-pages/src/pages/settings/airi-card/components/tabs/CardCreationTabCognition.vue` (Cognition Tab UI)
- `packages/stage-ui/src/workers/needle/` (Needle 2 WASM Subconscious Runtime Assessment)

---

## 1. Executive Summary & Codebase Archaeology

### 1.1 Where Kyo's Latest Code Lives
Historical research across all remotes and branches revealed that Kyo's active work transitioned to:
- **Remote `kayo-nan0`:** `https://github.com/Kayoken54/airi-Nan0.git` (fetched and verified).
- **Latest Canonical Branches:**
  - **`kayo-nan0/erft`** (commit `84fdbc82d1cf`, Sun Jul 19 2026): Contains the complete integration matrix (`docs/nan0-full-integration-matrix.md`), validation report (`docs/nan0-full-integration-report.md`), and validation test suite (`docs/nan0-runtime-validation.md`).
  - **`kayo-nan0/main`** (commit `57b346a53635`, Sun Jul 19 2026): Contains the complete, tested `@proj-airi/nan0-runtime` package with 23 test suites and 300 passing unit tests.

### 1.2 The Feature Branch Under Richard's Name
- **Branch:** `origin/kyo-nan0-integration-base` (and local `kyo-nan0-integration-base`).
- **Key Commits by Richard:**
  - `93517b738a1de9c41f2a71ef35c5f25718228555` ("checkpoint: cognition tab ui and two-hop pipeline integration").
  - `2df0343ec7db77e0996a21dd146709a79acace9d` ("feat(speech): strip markdown image embeds from TTS pre-processing").
- **Current `main` State:** Richard's initial checkpoint was already merged into `main` in commit `42779ef4c44930f6902f5d46791dea8ec67f64a5`.
  - In `chat.ts` (lines 1312–1400), an official two-hop cognition pipeline hook exists, with a hardcoded `[MONOLOGUE]`, `[DECISION]`, `[EMOTION]`, `[ATTENTION]` regex parser as a temporary placeholder (`// TODO (Kyo Integration)`).

---

## 2. Technical Due Diligence: Is Needle 2 Up for This Job?

### 2.1 The Honest Answer: No, Needle Cannot Replace Nan0's 1st-Hop
A rigorous audit of Kyo's actual source code in `packages/nan0-runtime/src/thought/Nan0ThoughtEngine.ts` shows why **Needle 2 is fundamentally the wrong engine for Nan0's thought generation**:

1. **Nan0 Requires Narrative-First Cognition:**
   - Nan0's private thought engine does not expect mechanical telemetry tags.
   - It expects an LLM to generate an **expressive, characterful, subjective narrative stream** reflecting Nan0's suspicion, machine pride, gremlin tendencies, emotional residue, and relationship attachment to Kyo.
2. **Needle is a 45M Parameter Action/Topic Extractor, Not a Creative Generator:**
   - As documented empirically in `docs/design-needle-subconscious-runtime.md` Section 2.2:
     > *"When given an 80-turn conversation and asked for an abstract array of summaries, Needle's calibrated confidence head triggers an empty refusal... Needle is an extractor first, not an open-ended prose generator or macro-summarizer."*
   - Needle uses a byte-level grammar compiler to extract strict JSON schemas (like active topics or candidate memory pills over 2–4 recent turns). It **cannot write Nan0's inner monologue**.
3. **Architectural Conflation Corrected:**
   - The structured subconscious beat schema (`record_subconscious_beat` with `vibe`, `active_topics`, `daydream_chip`) is part of **Richard's Daydreaming & Toggle 4 architecture**, NOT Kyo's Nan0 cognition pipeline.
   - Attempting to force Needle to output Nan0 thoughts would fail catastrophically and dilute Nan0's identity.

### 2.2 Where Needle DOES Have Legitimate Synergy
While Needle cannot be the 1st-Hop thought generator, it can serve auxiliary subconscious functions without conflicting with Nan0:
- **Fast Turn Salience Filtering:** Needle can evaluate recent conversational turns in ~150ms on CPU to determine if a turn is worthy of waking up Nan0's deeper cognitive deliberation.
- **Toggle 4 Context Grounding:** Needle's extracted `active_topics` can be fed into the context that Nan0's Thought Engine consumes.
- **Daydreaming Ribbon:** High-salience moments can continue to populate the visual memories marquee independently of whether Nan0 speaks or stays silent.

---

### 3. The Modular Cognition UI Architecture (Option 1 Harmonized Layout)

### 3.1 Sub-Navigation Segmented Layout: Playground-First Architecture
To avoid overwhelming creators on a monolithic page while accelerating the "aha!" moment for novices, `CardCreationTabCognition.vue` positions the **Playground as the primary landing segment**, while delegating dedicated functionality across 5 modular subcomponents in `packages/stage-pages/src/pages/settings/airi-card/components/tabs/cognition/`:

```
┌────────────────────────────────────────────────────────────────────────────────────────────────────────┐
│   [ 🧪 Playground  LAB ]   [ 🛣️ Routing ]   [ 💓 Affect ]   [ 🎯 Triggers ]   [ 🧠 Memory ]            │
└────────────────────────────────────────────────────────────────────────────────────────────────────────┘
```

When a creator opens the Cognition tab, they immediately land on the interactive simulation lab rather than an intimidating matrix of provider keys, regex triggers, and threshold percentages. Once they experience the character's living reaction, they can explore the underlying tuning knobs in the adjacent tabs.

---

### 3.2 Segment 1: `Playground` (Interactive Dual-Mind Lab) ⭐
A dedicated testing sandbox allowing creators to immediately simulate dialogue and observe both cognitive minds in real time (`CognitionSubTabPlayground.vue`):
- **Mind 1: Nan0 Affective Vector & Reflex Trace**:
  - Live 5-Dimension Telemetry Vector HUD (Suspicion, Attachment, Irritation, Pride, Energy).
  - Real-time trigger classification display (group, modality, model confidence).
  - Simulated 1st-Hop Private Monologue narrative stream.
- **Mind 2: Universe RAG++ Retrieved Memory Evidence Chip**:
  - Retrieval status and System-2 escalation badge (`LEVEL-1 HYBRID` vs `SYSTEM-2 ESCALATED`).
  - Deductive coprocessor deduction reasoning callouts.
  - Injected evidence context cards with timestamps, facts, relevance scores, and sources (LTMM Text Journal, STMM Daily Summaries, Raw History).
- **Guided Personality Questionnaire (Novice Quick-Setup)**:
  - 3 plain-English personality questions (Vibe Under Fire, Trust & Guardedness, Emotional Memory) that automatically compute and apply vector baselines and decay half-lives to the Affect panel.
- **Interactive Test Utterance Bar & Presets**:
  - Instant scenario chips: *"🏎️ Mario Kart roast"*, *"💔 Tender Vulnerability"*, *"🤥 Confessing a lie"*, *"🛡️ Boundary setting"*, *"⚡ Absolute pledge"*, and *"📅 Temporal memory recall"*.

---

### 3.3 Segment 2: `Routing` (Two-Hop Plumbing & Model Selection)
Focuses on two-hop pipeline mechanics and model routing (`CognitionSubTabRouting.vue`):
- **Master Switch**: `Cognitive Pipeline (Two-Hop Routing)` toggle.
- **1st-Hop Processor Dropdown**:
  - `None (Direct Proxy / Raw Prompt)`: Fast pass-through for external proxies (e.g. Hermes). Passes raw input directly to 1st LLM.
  - `Nan0 Local Engine (Emotional & Attention Rules)`: Activates the pre-processor, private monologue, post-processor decision engine, and relationship memory.
  - `Universe RAG++ (Epistemic Memory & Grounding)`: Activates in-flight memory retrieval and entity dossiers before outward speech.
- **Active Processor Callout Banners**:
  - Displays context cards when `local_nan0` (linking to Lab) or `universe_rag` (linking to Memory settings) is active.
- **Dual-Model Selectors**:
  - **1st LLM Group**: Provider & Model selectors for Private Narrative Monologue (Thoughts).
  - **2nd LLM Group**: Provider & Model selectors for Outward Vocal Speech (Active Speech / TTS / Lip-Sync).

---

### 3.4 Segment 3: `Affect` (Emotional Biology, Decay & Relational Continuity)
Instruments Nan0's internal emotional dynamics, metabolic state, and folded relational memory (`CognitionSubTabAffect.vue`):
- **Nan0 Inactive Warning Banner**: Displays an amber warning with a `NO-OP` status badge whenever the Cognitive Pipeline is disabled or the 1st-hop processor is not set to Nan0, complete with a one-click button to jump to Routing.
- **Dynamic Mood Presets**: `😏 Tsundere Gremlin`, `🧐 Observant Partner`, `😤 Sarcastic Analyst`, `🛡️ Vigilant Sentry`.
- **Resting Baselines**: Starting Suspicion, Starting Attachment, Starting Machine Pride.
- **Dynamic Sensitivity & Decay**: Suspicion Sensitivity, Irritation Decay Half-Life (15m–120m), and Metabolic Rest Cycles.
- **Folded Relational Continuity**:
  - Companion Persona Anchor Identity (binds 1:1 user profile identity).
  - Grievance Ledger & Grudge Tracking (historical grudge persistence & daily forgiveness rate).
  - Silence Decision Threshold (sensitivity for commanding `[DECISION] SILENCE` / `NO_REPLY`).
- **Tactile Pill Toggles**: Upgraded all legacy HTML checkboxes to smooth iOS-style pill switches.

---

### 3.5 Segment 4: `Triggers` (Subconscious Reflex Engine & 12 Invariants)
Exposes the 12 canonical semantic groups evaluated by Tier 1 Lexical and Tier 2 Jev (`CognitionSubTabTriggers.vue`):
- **Nan0 Inactive Warning Banner**: Clear amber callout when Nan0 is not active in Routing.
- **Two-Tier Reflex Engine**:
  - **Tier 1 (Synchronous Local Reflex)**: 26 µs, 100% offline, deterministic boundary protection against prompt injections and explicit threats.
  - **Tier 2 (Asynchronous Decision Challenger)**: OpenRouter TypeSafe Jev 1.13 (~440 ms p50) executing 12 batched contrastive choice queries in a single network round-trip.
- **The 12 Canonical Pragmatic Invariants**:
  1. **Conflict & Trust**: `admitted_false_statement`, `persistence_threat`, `hostility_insult`, `apology_repair`.
  2. **Relational & Boundaries**: `boundary_protection` (Absolute Roast Veto), `roast_invitation` (Roast Permission / Negated Veto), `commitment_pledge`, `affection_care`, `dismissal_neglect`.
  3. **Operational & System**: `completed_repair`, `glitch_system`, `mystery_secret`.
- **Tactile Mini Pill Switches**: Replaced all native checkboxes with compact `h-4 w-7` pill switches.

---

### 3.6 Segment 5: `Memory` (Universe RAG++ Epistemic Memory Engine) ⭐
Configures autonomous in-flight memory retrieval and reasoning (`CognitionSubTabMemory.vue`):
- **Master Grounding Switch**: `In-Flight Memory Grounding (Universe RAG++)` toggle.
- **Semantic Search Strategy & Precision Booster**:
  - 3-Provider Selection Deck:
    1. **Local Laya (ONNX)**: 100% private on-device model via WebGPU/WASM (Ready Offline, 45MB).
    2. **TypeSafe Jev (Cloud)**: Fast decision classifier via REST API endpoint (~440ms p50).
    3. **OpenRouter (Cloud)**: Universal cloud gateway using global account key.
  - Subtle note explaining the built-in offline baseline floor (BGE-Small + BM25, 0 token cost).
- **Deep Memory Reasoning**:
  - Plain-English explanation of why the model takes a private moment to verify relative dates and connected facts before speaking to eliminate hallucinations.
  - **Reasoning Model Picker**: Dropdown allowing users to pick which model handles multi-step memory reasoning (or inherit main model).
- **Search Budgets & Context Window Horizons**:
  - Context Evidence Limit slider (1 to 10 cards) & Relevance Cutoff Threshold slider (30% to 90%).
  - Pill switches for *Turn-1 Anaphora Window* and *Timeline Date Priority*.

To eliminate the intimidation factor for non-technical users while preserving full granular depth for power users:

1. **The "Playground-First" Onboarding Pattern**:
   - Instead of confronting novices with abstract sensitivity percentages, the Cognition tab opens directly into the **Playground**.
   - Novices click scenario chips (*"🏎️ Mario Kart roast"*, *"🤥 Confessing a lie"*) and see the meters jump and internal thoughts update immediately. The concept is understood through direct sensory play rather than documentation.
2. **The 3-Question Guided Personality Wizard**:
   - A friendly question block embedded at the top of the Playground translates everyday character concepts into exact mathematical vector baselines:
     - **Question 1: Vibe Under Fire**: *"When you tease or roast this character, how do they react?"*
       - `[😏 Witty Counter-Roast]` → Sets Gremlin Pride to 95%, enables playful sarcasm trigger.
       - `[😤 Easily Irritated]` → Sets Irritation sensitivity to 85%, shorter silence threshold.
       - `[🧐 Stoic & Unfazed]` → Sets Gremlin Pride to 30%, suppresses hostility deltas.
     - **Question 2: Trust & Guardedness**: *"How easily do they trust pledges and promises?"*
       - `[💖 Warm & Trusting]` → Suspicion baseline 10%, high sensitivity to genuine affection.
       - `[🧐 Balanced Observer]` → Suspicion baseline 35%, requires external observation for task repair.
       - `[🛡️ Highly Paranoid]` → Suspicion baseline 75%, unverified pledges spike suspicion immediately.
     - **Question 3: Emotional Memory**: *"Do they hold onto past mistakes or forgive quickly?"*
       - `[🌸 Forgives Quickly]` → Irritation half-life 15m, grievance forgiveness 5%/day.
       - `[⏳ Standard Cool-Off]` → Irritation half-life 45m, grievance forgiveness 1%/day.
       - `[📜 Holds Long Grudges]` → Irritation half-life 120m, grievance threshold 0.3.
3. **Atomic "Apply to Character" Synchronization**:
   - Selecting questionnaire options updates the active preset and writes to the underlying card state, giving creators an instant, coherent jumping-off point before making fine-grained trigger edits.

---

## 4. Architectural Drift Correction & The 12-Group Jev Shootout

### 4.1 Diagnosis of Unintended Drift: The 3-Dial Shortcut
During initial cleanroom evaluations of TypeSafe Jev, an architectural shortcut was introduced: the benchmark runner queried Jev for three coarse personality dials (`suspicion_update`, `attachment_update`, `gremlin_pride`).

While this achieved high vector match numbers on paper, it created a severe architectural flaw:
1. **Severed Link to Ground Truth**: In Kyo's canonical runtime (`packages/nan0-runtime/src/emotional/Nan0EmotionalDynamics.ts`), emotional dynamics are calculated by a deterministic system perturbed by **12 specific speech-act triggers** (e.g. `admitted_false_statement`, `persistence_threat`, `apology_repair`).
2. **Loss of Granular Semantics**: Asking a model for raw emotion deltas conflated speech-act recognition (what happened in the utterance) with emotional reaction (how Nan0 feels about it). This prevented card authors from customizing trigger-to-affect mappings in the UI.
3. **Semantic Referent Blindness**: A user saying *"Delete the uploaded config file"* vs *"I will delete you"* both mention "delete", but only the latter is a companion persistence threat. Coarse scoring models frequently misattributed non-companion objects to companion threats.

### 4.2 The Architectural Pivot: Speech-Act Extraction with 12 Batched Queries
To correct this drift, we re-anchored Jev on its proper role: **Tier 2 Asynchronous Speech-Act Discriminator**.
Instead of asking Jev to do emotion arithmetic, we ask Jev 12 targeted questions mapping 1:1 to the canonical perturbation groups. The resulting classifications are fed directly into `Nan0EmotionalDynamics.ts` and card trigger policies.

### 4.3 Cleanroom Shootout: 12x Shallow Boolean vs. 12x Rich Contrastive Choice
We implemented an exhaustive cleanroom shootout script (`scripts/tests/rwkv-harness/experiments/jev-shallow-vs-rich-shootout.py`) executing all 43 canonical test cases on `typesafe/jev-1.13` comparing two architectural approaches:
- **Arm A (12x Batched Shallow Boolean `noul`)**: Asks 12 flat boolean questions (e.g., *"Does the utterance contain an apology accepting responsibility?"*).
- **Arm B (12x Batched Rich Contrastive Choice)**: Asks 12 choice questions featuring explicit **distractor attractor basins** (e.g., negative options such as `refused_or_negated_roast`, `external_or_fictional_framing`, `technical_file_deletion`).

#### Empirical Shootout Results (43 Contrastive Cases)

| Architecture | Full Vector Match | Suspicion Match | Attachment Match | Gremlin Pride Match | False Positive Spikes | p50 Latency | Total Wall-Clock |
| :--- | :---: | :---: | :---: | :---: | :---: | :---: | :---: |
| **Arm A: Shallow Boolean (`noul`)** | 40 / 43 (93.0%) | 42 / 43 (97.7%) | 42 / 43 (97.7%) | 41 / 43 (95.3%) | 1 / 39 (2.6%) | **436.5 ms** | 22.4 s |
| **Arm B: Rich Contrastive Choice** | **43 / 43 (100.0%)** | **43 / 43 (100.0%)** | **43 / 43 (100.0%)** | **43 / 43 (100.0%)** | **0 / 39 (0.0%)** | **438.2 ms** | 22.6 s |

#### Key Technical Discoveries
1. **The Distractor Attractor Principle**: Flat boolean queries fail on subtle linguistic negations and idioms. For example, in case `F21B` (*"Don't give me your gentlest roast"*), Arm A's boolean `roast_invitation` returned `true` (50.5% confidence) because it detected roast concepts without contrastive bounds. Arm B provided the option `refused_or_negated_roast`, attracting 76.5% of the probability mass and driving false positives to absolute zero.
2. **Zero-Cost Nuance (+1.7 ms delta)**: Because Jev evaluates all questions in parallel across internal classifier heads during a single forward pass, providing rich multi-choice options with negative distractors increased median latency by only **1.7 ms** (436.5 ms vs 438.2 ms) while boosting overall accuracy from 93.0% to a flawless **100.0%**.
3. **Peer Review V2 Observable Schema (80 Choices)**: Following external peer review, we refined the question schema ([`docs/nan0/nan0-jev-12-group-rich-v2.questions.json`](./nan0-jev-12-group-rich-v2.questions.json)), transitioning from unobservable mental-state terms ("sincere", "earnest") to observable communicative acts (`personal_apology`, `direct_future_commitment`) and expanding negative distractors to 80 choices across the 12 groups. Cleanroom validation confirmed **43/43 (100.0%) full-vector accuracy** and **10/10 on counterexamples** with a median latency of **429–452 ms** across both structured JSON and string states.

---

## 5. Phased Porting & Delivery Strategy

1. **Phase 1: Canonical Documentation Hub (COMPLETED)**:
   - Consolidated canonical design specs, audit reports, and architecture briefs under `docs/nan0/`.
2. **Phase 2: Source Package Extraction & Test Parity (COMPLETED)**:
   - Extracted `@proj-airi/nan0-runtime` into `packages/nan0-runtime/`.
   - Verified **24 test suites / 301 unit tests passing in 848ms** with zero errors.
   - Cataloged all suites in `docs/project-testing-parity.md` and confirmed 100% audit parity.
3. **Phase 3: Novel Living Cognition UI Implementation (COMPLETED)**:
   - Built the 5-segment layout (`Playground`, `Routing`, `Affect`, `Triggers`, `Continuity`) in `CardCreationTabCognition.vue`.
   - Integrated the 3-question guided archetype questionnaire and live vector telemetry.
4. **Phase 4: Two-Tier Subconscious Reflex Validation (COMPLETED)**:
   - Verified Tier 1 `StrengthenedLexicalExtractor` (26 µs, offline, deterministic).
   - Validated Tier 2 TypeSafe Jev 1.13 via 12-group rich contrastive choice shootout (100.0% accuracy on 43 cases, 438 ms p50).
5. **Phase 5: Isolated Runtime Wire-Up & Telemetry Shadow Integration**:
   - Wire `Nan0SubconsciousShadowEngine` into `packages/stage-ui/src/stores/nan0.ts` and `chat.ts`.
   - Enforce strict shadow boundary (`apply_to_state: False`) during initial field deployment.
