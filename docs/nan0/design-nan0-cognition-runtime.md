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

### 3. The Novel Living Cognition UI Architecture (3-Segment Layout)

### 3.1 Sub-Navigation Segmented Layout
To avoid wordy tab labels and ensure every panel is richly populated, `CardCreationTabCognition.vue` is structured into **3 single-word, high-density segments**:

```
┌────────────────────────────────────────────────────────────────────────────────────────────────────────┐
│               [ ⚙️ Routing ]               [ 🧠 Affect ]               [ 🤝 Continuity ]               │
└────────────────────────────────────────────────────────────────────────────────────────────────────────┘
```

When `1st-Hop Processor` is set to `local_nan0` (Nan0 Local Engine), the `Affect` and `Continuity` segments unlock and present a clear preview disclaimer:
> **🚧 Preview Edition • Work In Progress — Nan0 Cognition Runtime (Mockup / Non-Functional Display)**

---

### 3.2 Segment 1: `Routing`
Focuses on the high-traffic two-hop pipeline mechanics:
- **Master Switch**: `Cognitive Pipeline (Two-Hop Routing)` toggle.
- **1st-Hop Processor Dropdown**:
  - `None (Direct Proxy / Raw Prompt)`: Fast pass-through for external proxies (e.g. Hermes). Passes raw input directly to 1st LLM.
  - `Nan0 Local Engine (Emotional & Attention Rules)`: Activates the pre-processor, private monologue, post-processor decision engine, and relationship memory.
- **1st LLM Group**: Provider & Model selectors for Private Narrative Monologue.
- **2nd LLM Group**: Provider & Model selectors for Outward Vocal Speech (TTS / Lip-Sync).
- **Engine Status Card**: When `Nan0 Local Engine` is active, displays an interactive status card with quick shortcuts to customize `Affect` and `Continuity`.

---

### 3.3 Segment 2: `Affect`
Instruments Nan0's emotional dynamics (`Nan0EmotionalDynamics.ts`) and metabolic state (`Nan0Metabolism.ts`):

1. **Preview Banner**:
   - `🚧 Preview Edition • Nan0 Cognition Runtime — Emotional Dynamics (Non-Functional Mockup)`
2. **Dynamic Mood Presets**:
   - One-click presets that configure the underlying vector baselines:
     - `😏 Classic Tsundere Gremlin` (High Pride, Medium Suspicion, Quick Sarcasm)
     - `🧐 Observant Companion` (High Attachment, Balanced Suspicion, Thoughtful Deliberation)
     - `😤 Sarcastic Analyst` (High Pride, High Irritation Sensitivity, Demands Silence easily)
     - `🛡️ Vigilant Sentry` (Ultra-High Suspicion, Guarded Attachment, Rigid Verification)
3. **Affective Baselines & Decay Sliders**:
   - **Suspicion Sensitivity**: Controls how easily unverified claims perturb suspicion (`Low`, `Balanced`, `Paranoid`).
   - **Irritation Half-Life**: Controls how long irritation persists after repetition before cooling down (`Fast (15m)`, `Normal (45m)`, `Grudge (24h)`).
   - **Gremlin Pride Baseline**: Sets baseline machine ego and playful resistance (`Modest`, `Playful`, `Machine Sovereign`).
   - **Metabolic Energy & Rest**: Configures recovery cycles and session fatigue.
4. **Live Affective Vector Telemetry HUD**:
   - Visual gauges showing real-time vector levels: Suspicion, Attachment, Irritation, Pride, and Energy.
   - Dynamic mood badge reflecting current dominant state.

---

### 3.4 Segment 3: `Continuity`
Unifies Relationship Memory, the Subconscious Semantic Reflex (Needle 2), and Decision Gating:

1. **Dynamic Companion Anchor Identity (Global User Profile)**:
   - Instead of hardcoding `kyo`, the runtime automatically binds the primary companion anchor to `useSettingsUserProfile().name` (slugified, e.g. `richard` or `companion`).
   - Optional override input allows setting a custom persona anchor.
2. **Grievance & Grudge Ledger**:
   - **Grievance Tracking Switch**: Toggle remembering negative interactions, broken promises, or ignored queries.
   - **Grievance Threshold**: Minimum negative intensity (default `0.6`) to register an active grievance.
   - **Forgiveness Rate Slider**: Controls the daily decay rate for resolving historical grudges.
3. **Subconscious Semantic Reflex (Needle 2 Synergy)**:
   - **Language-Agnostic Intent Pre-Pass**: Toggle replacing fragile regex keyword matching (`/promise|plan|commit/i`) with Needle 2's 150ms WASM model. Evaluates sliding window of last 2–4 turns for semantic intent (`unverified_future_pledge`, `provocation`, `reassurance`, `evasiveness`).
   - **Decision Schema Normalizer**: Toggle Needle 2 as a zero-cost fallback JSON parser for `===NAN0_EXTRACTION===` if the 1st LLM emits malformed monologue output.
4. **Silence & Action Gating**:
   - Controls when Nan0's decision engine commands `SILENCE` / `NO_REPLY` vs authoring outward speech.

---

### 3.5 Surfacing: Chatbox Left-Side Drawer
- Rather than cluttering the Card Editor with runtime streaming controls, live thought viewing is moved to the **Chatbox Left-Side Drawer** (co-located with Context Grounding and Memories Ribbon).
- On stage, floating thought clouds visually display private reactions or intentional silence (`demandsSilence`) without emitting TTS audio.

---

## 4. Phased Porting & Delivery Strategy

### Phase 1: Canonical Documentation Hub (COMPLETED)
- Consolidated 7 canonical design specs and audit reports under `docs/nan0/`.

### Phase 2: Source Extraction & Test Parity (COMPLETED)
- Extracted `@proj-airi/nan0-runtime` into `packages/nan0-runtime/`.
- Verified 24 unit test files (301 tests) pass in 848ms.
- Updated `docs/project-testing-parity.md` and confirmed 100% audit parity via `node scripts/audit-test-catalog.mjs`.

### Phase 3: Card Editor Cognition Tab Mockup (Frontend Preview)
- Build the 3-segment sub-tab layout (`Routing`, `Affect`, `Continuity`) in `CardCreationTabCognition.vue`.
- Add preview disclaimer banners disclaiming non-functional mockup state.
- Validate via `pnpm -F @proj-airi/stage-pages typecheck`.

### Phase 4: Cleanroom POC — Needle 2 Semantic Intent Harness
- Create an isolated cleanroom benchmark (`scripts/tests/needle-nan0-prepass.ts` or in `packages/nan0-runtime/`).
- Evaluate Needle 2 against a 20-turn benchmark (paraphrased promises, subtle manipulation, evasion) to verify:
  1. Sub-150ms execution on CPU.
  2. Language-agnostic semantic intent extraction.
  3. Strict schema compliance without cloud LLM dependencies.
- Vet the feature completely before performing invasive runtime wiring.

### Phase 5: Isolated Branch & Runtime Integration
- Create `feature/nan0-cognition-runtime` from `main`.
- Wire `packages/stage-ui/src/stores/nan0.ts` and `nan0-bridge.ts` into the decomposed `chat.ts` orchestrator.
- Wire Needle 2 into the Pre-Processor and Post-Processor.
- Wire Dual-Track Monologue stream into the Chatbox left-side drawer.

### Phase 6: Verification & Test Catalog Audit
- Full typechecks across workspaces, desktop Electron build, and test catalog audit.

---

## 4. Phased Porting & Delivery Strategy

1. **Phase 1: Canonical Documentation Consolidation (COMPLETED)**:
   - Established isolated `docs/nan0/` documentation hub with all 7 canonical design specs, audit reports, roadmaps, and validation criteria.
2. **Phase 2: Source Package Extraction & Test Parity (COMPLETED)**:
   - Extracted `@proj-airi/nan0-runtime` into `packages/nan0-runtime/`.
   - Verified **24 test suites / 301 unit tests passing in 848ms** with zero errors.
   - Cataloged all suites in `docs/project-testing-parity.md` and achieved **100% audit parity** with `scripts/audit-test-catalog.mjs`.
3. **Phase 3: Novel Living Cognition UI Implementation**:
   - Build the Affective Vector HUD, Relationship Dossier, and Dual-Track Monologue accordion into `packages/stage-pages` and `packages/stage-ui`.
   - Implement the Head-Tethered Thought Cloud overlay on the stage.
4. **Phase 4: Isolated Feature Branch & Runtime Integration**:
   - Create `feature/nan0-cognition-runtime` from `main`.
   - Wire `packages/stage-ui/src/stores/nan0.ts` and `nan0-bridge.ts` into the decomposed `chat.ts` orchestrator with verified fallback safety.
5. **Phase 5: Needle 2 Reflex Wiring & End-to-End Validation**:
   - Wire Needle 2 WASM as the fast 150ms sensory reflex upstream of Nan0's affective perturbation and thought engine.
   - Execute full workspace typechecks and desktop Electron verification.
