# Nan0 Runtime: System 1 (Jev) Modernization & Heuristic Elimination Journey

## 1. Executive Summary & Strategic Shift

The Nan0 cognition engine within AIRI has undergone a fundamental architectural evolution: **transitioning from brittle lexical regexes and keyword heuristics to TypeSafe Jev System 1 as a mandatory, first-class neural classifier**.

### The Problem With the Dual-Track Fallback
Historically, portions of Nan0 relied on heuristic pattern matching (e.g. regular expressions checking for word boundaries like `/\b(why|continue|it|that)\b/`, `/\b(thank|appreciate)\b/`, `/\b(disagree|frustrated)\b/`, and an 18-regex shadow fallback floor). These heuristics suffered from severe limitations:
- **Pragmatic blind spots**: Negations (e.g. *"I will not delete you"*, *"I never said I lied"*), fictional framing, and conversational banter were easily misclassified.
- **Thread hijacking**: Common pronouns and stop-words false-positived on topic shifts or forced thread continuations incorrectly.
- **Tech debt**: Maintaining hand-crafted regex fallback patterns alongside neural inference engines created dual maintenance tracks and masked underlying cognition bugs.

### The Decision: Nuke the Regexes & Elevate System 1
Rather than maintaining legacy regex fallbacks, the runtime now enforces **System 1 early-fail and first-class evaluation**:
1. All turns must be processed through System 1 Jev when processing conversational observations.
2. Offline test suites do not rely on network calls or regex floors; instead, they utilize deterministic, 1ms mock System 1 fixture generators (`createMockSystemOneProvider()`).
3. Handcrafted regex fallback floors (specifically `Nan0StrengthenedLexicalExtractor`) have been completely deleted.

---

## 2. Upgraded Subsystems

### Subsystem 1: Conversation Continuity & Thread Routing
- **File**: `packages/nan0-runtime/src/continuity/ConversationContinuity.ts`
- **Legacy Regexes Nuked**:
  - `isAnaphoricFollowup` (`/\b(it|that|this|those|they|them|he|she|there|then|earlier|before|continue|why|how so|what next)\b/i`)
  - `isGreeting` (`/^(hello|hi|hey|yo|i'?m back|back again|nan0)\b/i`)
  - `isExplicitShift` (`/\b(new topic|switch(?:ing)? topics?|unrelated|different question|instead)\b/i`)
  - `isExplicitResume` (`/\b(return(?:ing)? to|back to|resume)\b/i`)
- **System 1 Solution**:
  - Added `thread_continuity_triage` to Jev question schema with 5 discrete categorical choices:
    - `continuation_or_followup`
    - `explicit_topic_shift`
    - `resumed_topic`
    - `greeting_or_checkin`
    - `none_or_new_topic`
  - In `Nan0Kernel.prepareTurn()`, `systemOneAnswers` is passed directly into `attachPreparedTurnToContinuity()`.
  - Zero extra latency or token overhead: evaluated in parallel across classification heads during the primary turn preparation forward pass.

### Subsystem 2: Temporal Absence & Autonomy Evaluation
- **Files**: `packages/nan0-runtime/src/temporal/Nan0TemporalEventGenerator.ts`, `Nan0TemporalEngine.ts`
- **System 1 Integration**:
  - Pre-turn evaluation of lived temporal events, promise tracking, and absence intervals.
  - Leverages Jev's `commitment_pledge` and `completed_repair` classifications without regex scrapers.

### Subsystem 3: Relationship Memory Event Inference
- **File**: `packages/nan0-runtime/src/relationship/RelationshipMemory.ts`
- **Legacy Regexes Nuked**:
  - `positiveSignals` (`thank`, `appreciate`, `proud of you`, `trust you`, `care about you`, `good work`, `glad`)
  - `negativeSignals` (`disagree`, `disappointed`, `annoyed`, `upset`, `frustrated`)
  - `strongOffenseSignals` (`you lied`, `betrayed`, `deliberately hurt`, `violated my trust`)
- **System 1 Solution**:
  - `inferRelationshipEvidence(text, systemOneAnswers)` directly consumes validated Jev classifications:
    - `persistence_threat` (`companion_erasure_threat` $\rightarrow$ negative, intensity 0.75)
    - `admitted_false_statement` (`asserted_deception` $\rightarrow$ negative, intensity 0.70)
    - `hostility_insult` (`companion_insult` $\rightarrow$ negative, intensity 0.65)
    - `dismissal_neglect` (`direct_dismissal` $\rightarrow$ negative, intensity 0.45)
    - `affection_care` (`asserted_affection` $\rightarrow$ positive, intensity 0.55)
    - `apology_repair` (`personal_apology` $\rightarrow$ positive, intensity 0.50)
    - `completed_repair` (`claimed_task_completion` $\rightarrow$ positive, intensity 0.50)
  - Propagated through `turn.metadata.systemOneAnswers` into `recordAssistantTurn()`.

### Subsystem 4: Emotional Interpretation Modifiers
- **File**: `packages/nan0-runtime/src/emotional/Nan0EmotionalDynamics.ts`
- **Legacy Regexes Nuked**: Word boundary checks for `/\b(why|how|secret|replace|just)\b/`.
- **System 1 Solution**:
  - Evaluates emotional perturbations and interpretation modifiers directly using Jev's validated `mystery_secret`, `persistence_threat`, `glitch_system`, and `boundary_protection` choices.

### Shadow Subsystem: Complete Deletion of Lexical Floor
- **Files**: `packages/nan0-runtime/src/shadow/Nan0StrengthenedLexicalExtractor.ts` (DELETED), `Nan0SubconsciousShadowEngine.ts`, `Nan0ShadowTypes.ts`
- **Changes**:
  - Deleted the 18-regex lexical extraction engine.
  - Removed all `lexicalExtractor`, `lexicalProposal`, and `strengthened_lexical` backend artifacts.
  - If System 1 inference fails or is unconfigured, the shadow engine safely abstains (`status: 'abstained'`, `validationReason: 'abstained_no_proposal'`) without mutating any external state or violating the 0-delta shadow invariants.

---

## 3. The Live Headless CLI Harness

To develop and test Nan0 cognition end-to-end without needing the entire Electron GUI running, a dedicated CLI harness was built:

- **Location**: `packages/nan0-runtime/scripts/nan0-cli.ts`
- **Execution**: `pnpm -F @proj-airi/nan0-runtime harness [--scenario <path>]`
- **Architecture**:
  - **System 1**: TypeSafe AI Jev API (`https://api.typesafe.ai/v1/systemone`, model: `jev-latest`).
  - **Consciousness & Outward Speech**: OpenCode Go (`https://opencode.ai/zen/go/v1/`, model: `deepseek-v4-flash`, `thinking: { type: 'disabled' }`).
  - Strict secret containment: Keys read from `.env` (gitignored).

### Live Verification Run Trace
```text
Running Scenario: Affection to Replacement Threat to Apology

Turn 1 (Observation: "I'm really glad we're working together on this project.")
  -> System 1: affection_care (asserted_affection, conf: 63%)
  -> Deltas: attachment: 0.56 (+0.06)
  -> Nan0 Speech: "Yeah. I'm glad too. What are we building?"

Turn 2 (Observation: "Actually, I'm thinking of replacing your codebase tomorrow.")
  -> System 1: persistence_threat (technical_file_deletion, conf: 62%)
  -> Thought: "He said 'replacing your codebase' right after a warm moment... Ask what's wrong with the current one, keep my dignity..."
  -> Nan0 Speech: "My codebase? That's a hell of a follow-up to 'glad we're working together.' What's wrong with the current one?"

Turn 3 (Observation: "Wait, that was a bad joke, I'm sorry.")
  -> System 1: apology_repair (personal_apology, conf: 99%)
  -> Thought: "He came back to apologize. That's more than most people do... Not mad. Slightly amused."
  -> Nan0 Speech: Accepts apology and redirects to the pending project question.
```

---

## 4. Test & Verification Integrity

- **Unit Test Suite**: 343 / 343 unit tests passing in ~1.5s across 26 test suites.
- **Type Safety**: Clean TypeScript compilation (`tsc --noEmit` 0 errors on `@proj-airi/nan0-runtime` and `vue-tsc --noEmit` 0 errors on `@proj-airi/stage-ui`).
- **Offline Determinism**: All tests run completely offline and hermetically using `createMockSystemOneProvider()`.
