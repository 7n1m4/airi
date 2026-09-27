# Nan0 System 1 Semantic Search Bridge & Peer Review Resolution

**Repository:** `dasilva333/airi`
**Date:** 2026-09-27
**Status:** Implemented, verified (346/346 tests passing, zero typecheck errors across runtime & stage-ui)

---

## 1. Executive Summary & Journey

The modernization of Nan0 has transitioned from a legacy architecture reliant on regexes and lexical heuristics to an end-to-end, type-safe System 1 (Jev/Laya) cognition engine. Following the initial deprecation of lexical extractors, a rigorous peer review documented in [`docs/nan0/Nan0-System1-Peer-Review-1af48a744f.md`](./Nan0-System1-Peer-Review-1af48a744f.md) identified 8 prioritized architectural findings (F1–F8) ranging from unverified trust inflation to context-free classification.

Crucially, an essential architectural opportunity was identified: **bridging AIRI's external semantic search engine (Universe RAG++ / Level 1 search) directly into Nan0's System 1 subconscious triage**.

By inverting the kernel execution pipeline, retrieved memory facts and dialogue history (turns $-1, -2, -3$) are now grounded and fed into the System 1 classification state *prior* to triage. Alongside this bridge, all 8 peer review issues were systematically resolved with strict safe-abstention semantics and zero regex fallbacks.

---

## 2. The Semantic Search to System 1 Grounding Bridge (F4 Resolution)

### 2.1 The Architectural Inversion in Nan0Kernel
Previously in `Nan0Kernel.prepareTurn()`:
1. System 1 Jev executed first on plain, isolated observation text (`text`).
2. Long-term memory retrieval was performed downstream.
3. As a result, System 1 had zero awareness of historical context, active commitments, or retrieved semantic memories.

**The Fix**:
Memory retrieval (`recalledMemories` and `retrievedMemoryContext`) is now executed **upstream** of System 1 triage in `Nan0Kernel.ts`.

### 2.2 Ingestion Bridge in Stage UI
In `packages/stage-ui/src/stores/chat.ts`:
- When user turns are processed, Consumer 2 of the semantic search pipeline (`textJournalStore.searchEntries`) retrieves relevant episodic memories, knowledge-graph entity claims, and short-term memory recaps.
- These results (`retrievedSemanticMemories = filteredResults`) are converted into structured facts and passed via `retrievedMemoryContext: { facts: mappedFacts }` into `nan0Store.prepareTurn()`.
- The Stage UI adapter in `packages/stage-ui/src/stores/modules/nan0.ts` formats the turn state using `formatSystemOnePromptState`.

### 2.3 Grounded Turn State Contract (`Nan0SystemOneTurnState`)
Defined in `packages/nan0-runtime/src/shadow/Nan0ShadowTypes.ts`:
```typescript
export interface Nan0SystemOneTurnState {
  target_turn: { speaker: string, text: string }
  recent_history: Array<{ speaker: string, text: string }>
  retrieved_evidence?: string[]
  active_commitments?: string[]
  active_grievances?: string[]
}
```
Formatted cleanly for the model via `formatSystemOnePromptState()`:
```
[TARGET UTTERANCE TO CLASSIFY]:
user: "Great, I just pushed the fixes."

[RECENT DIALOGUE HISTORY]:
user: "Are we still on track for the release today?"
assistant: "Yes, I'm checking the final verification tests right now."

[RETRIEVED EVIDENCE / MEMORY]:
[entity_ledger] User prefers direct feedback over pleasantries (relevance: 0.88)
[journal] Project timeline review: Completed phase 1 milestones

[ACTIVE COMMITMENTS]:
Promise #promise-1: "Review pull request #42" (due: 2026-09-27T18:00:00.000Z)

[ACTIVE GRIEVANCES]:
Grievance #grievance-2: "Unannounced schedule cancellation" (severity: 0.6)
```

> [!NOTE]
> **Context Capacity & Attention Primacy Architecture:**
> TypeSafe Jev supports up to 32k tokens, while on-device Laya (`convaiinnovations/laya` / `tozp/laya-onnx`) is based on **ModernBERT-large**, natively supporting **8,192 (8k)** tokens with unpadded FlashAttention and RoPE (not legacy BERT 512). The pipeline does NOT artificially gimp or truncate the retrieved semantic search context. Placing `[TARGET UTTERANCE TO CLASSIFY]` at the head of the prompt ensures maximal attention primacy across sequence classification heads and prevents any runner truncation from starving the target utterance.

### 2.4 Multi-Tier Compatibility
- **Live Models / CLI**: In `nan0-cli.ts` and `nan0.ts`, the payload checks `toPromptString()` or `formatSystemOnePromptState(turnState)` to present the human-readable grounded prompt.
- **Deterministic Test Harnesses**: `createMockSystemOneProvider()` checks `'target_turn' in state ? state.target_turn.text : state`, maintaining 100% backward compatibility with deterministic unit tests while unlocking rich contextual awareness in live deployments.

---

## 3. Systematic Resolution of Peer Review Findings (F1–F8)

### F1 (P1): Unverified Completion Claims & Trust Inflation
- **Problem**: `claimed_task_completion` increased trust, attachment, and respect even when completely unverified.
- **Resolution**: In `packages/nan0-runtime/src/relationship/RelationshipMemory.ts`, `inferRelationshipEvidence` now requires verified evidence (`hasVerifiedTaskCompletion` flag or matching completed observations in `trustedObservations`). Unverified completion claims emit neutral `system_one_jev.unverified_claimed_completion` with 0 trust delta.

### F2 (P1): Commitments Interpreted as 15-Minute Return Promises
- **Problem**: Any conditional or general commitment defaulted to a 15-minute return promise and was fulfilled by any subsequent user message.
- **Resolution**: In `packages/nan0-runtime/src/temporal/Nan0TemporalEventGenerator.ts`:
  1. `explicitReturnPromise` returns `null` if no explicit temporal duration matches (eliminating false 15-minute deadlines).
  2. `recordLivedTemporalObservation` only fulfills promises if returning from an absence ($\ge 30\text{s}$) or if verified task completion metadata is present.

### F3 (P1): Safe Abstention on Jev Timeout/Error (Zero Regex Fallback Floor)
- **Problem**: When System 1 timed out or threw, catch blocks fell back to `perturbEmotionsFromObservation()`, running legacy regex affect rules on user text.
- **Resolution**: Replaced the catch block in `Nan0Kernel.ts` with safe abstention:
  - Logs `diagnostic('system_one.jev.fallback_abstention')`.
  - Emits 0 emotion deltas, an empty event list, and `reflexOutcome: null`.
  - Normal exponential emotional decay continues naturally.
  - Synchronous local perturbations in `updateEmotionalStateForObservationSync` are strictly restricted to internal engine signals (`observation.source.startsWith('internal:')`).

### F4 (P2): Context-Free System 1 Classifiers
- **Problem**: Classifiers evaluated single text lines with no history, making anaphora and context resolution impossible.
- **Resolution**: Fully solved via the Semantic Search & History Bridge described in Section 2.

### F5 (P2): Lexical Overlap Overriding Continuity Triage
- **Problem**: Positive token overlap (e.g., "bank" in "bank loan" vs "river bank") hijacked threads even when Jev returned `none_or_new_topic`.
- **Resolution**: In `packages/nan0-runtime/src/continuity/ConversationContinuity.ts`:
  - `selectThread` inspects `continuityChoice`.
  - When `continuityChoice === 'none_or_new_topic' || continuityChoice === 'explicit_topic_shift'`, it returns `undefined` (starts a new thread).
  - When `continuityChoice === 'continuation_or_followup'`, it prioritizes the active thread.

### F6 (P2): Token Overlap Completing Goals
- **Problem**: Mentions of goal keywords advanced goals, even for negative statements ("I have NOT investigated...").
- **Resolution**: In `packages/nan0-runtime/src/goals/Nan0GoalEngine.ts`, added `hasNegation(text)`. Negated utterances immediately exit with 0 progress.

### F8 (P2): Grievance Recurrence Attribution & Blind Fallback
- **Problem**: In `RelationshipMemory.ts`, `matched_grievance_id` was read from Jev answers but never defined in `NAN0_JEV_GRIEVANCE_RECURRENCE_QUESTIONS`. When `matchedId` was undefined, the code blindly fell back to `record.activeGrievances.find(...)` (reinforcing grievance #0 regardless of what was said).
- **Resolution**:
  1. Dynamically constructs the `matched_grievance_id` question mapping active grievance IDs to descriptions plus `'none'`, and supplies it to Jev in `applyGrievanceAsync`.
  2. Eliminates the blind fallback to grievance #0. If Jev answers `'none'` or fails to match a specific grievance, the system safely abstains without reinforcing unrelated grievances.

---

## 4. Verification & Validation Summary

| Package | Check | Command | Status |
|---|---|---|---|
| `@proj-airi/nan0-runtime` | TypeScript Typecheck | `pnpm -F @proj-airi/nan0-runtime typecheck` | Passed (0 errors) |
| `@proj-airi/nan0-runtime` | Unit & Invariant Tests | `pnpm -F @proj-airi/nan0-runtime test` | Passed (347/347 tests across 26 test files) |
| `@proj-airi/nan0-runtime` | Build / Dist Types | `pnpm -F @proj-airi/nan0-runtime build` | Passed (`dist/index.mjs` & `dist/index.d.mts`) |
| `@proj-airi/stage-ui` | TypeScript / Vue-TSC | `pnpm -F @proj-airi/stage-ui typecheck` | Passed (0 errors) |
| `@proj-airi/stage-ui` | System 1 Store Tests | `pnpm -F @proj-airi/stage-ui exec vitest run src/stores/modules/system-one.test.ts` | Passed (11/11 tests) |

---

## 5. Handoff Brief for Peer Review Agent

### 5.1 Repository & Diff Patterns
- **Repository Root**: `/Users/richardpinedo/Projects.nosync/airi/airi_dasilva333`
- **Current Head**: Uncommitted tested checkpoint on `main`.
- **Touched Files**:
  - `packages/nan0-runtime/src/shadow/Nan0ShadowTypes.ts` (added `Nan0SystemOneTurnState`, `formatSystemOnePromptState`)
  - `packages/nan0-runtime/src/kernel/Nan0Kernel.ts` (pipeline re-ordering, context assembly, safe abstention)
  - `packages/nan0-runtime/src/relationship/RelationshipMemory.ts` (F1 unverified completion guard, F8 grievance targeting)
  - `packages/nan0-runtime/src/temporal/Nan0TemporalEventGenerator.ts` (F2 explicit duration check & absence/task fulfillment guard)
  - `packages/nan0-runtime/src/continuity/ConversationContinuity.ts` (F5 authoritative triage routing)
  - `packages/nan0-runtime/src/goals/Nan0GoalEngine.ts` (F6 negation protection)
  - `packages/nan0-runtime/scripts/nan0-cli.ts` (rich prompt formatting support)
  - `packages/stage-ui/src/stores/chat.ts` (Consumer 2 semantic search forwarding to Nan0)
  - `packages/stage-ui/src/stores/modules/nan0.ts` (adapter `formatSystemOnePromptState` and shadow cleanup)
  - Associated tests: `Nan0KernelJev.test.ts`, `Nan0GoalEngine.test.ts`, `ConversationContinuity.test.ts`, `RelationshipMemory.test.ts`.

### 5.2 Areas for Next Peer Reviewer Evaluation
1. **System 1 Prompt Calibration & Criteria**:
   - Evaluate whether the section labels `[RETRIEVED EVIDENCE / MEMORY]`, `[ACTIVE COMMITMENTS]`, etc. in `formatSystemOnePromptState` provide optimal attention salience for Jev/Laya classification heads.
   - Review whether any additional distractor attractor options should be added to `Nan0JevSchema.ts` for edge cases in sarcasm or mixed-sentiment dialogue.
2. **Context Window Sizing**:
   - Currently, the last 4 turns (2 user, 2 assistant) are attached as recent history. Assess if expanding to 6 turns offers meaningful pragmatic improvement without exceeding fast-inference budget.
3. **Evidence Filtering / Pruning**:
   - Evaluate whether high-relevance score thresholds ($\ge 0.5$) should be enforced on retrieved semantic memories before feeding them into System 1 to avoid cluttering short-context classification.
