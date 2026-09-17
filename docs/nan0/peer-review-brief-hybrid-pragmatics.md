# Architectural Consultation & Peer Review Brief: The Pragmatic Slot-Filler Hybrid

**Date:** September 16, 2026
**Target Subsystem:** Nan0 Living Cognition Pre-Processor & Emotional Dynamics
**Repository Anchor Commit:** [`0e540d574f`](https://github.com/dasilva333/airi/commit/0e540d574f) (`main`)
**Context & Working Tree:** Clean on `main`; isolated Phase 5 benchmark diagnostics verified.

---

## 1. Context & Diagnostic Pivot: The Theory-of-Mind Trap

In Phase 5, we tested independent single-span probes (`extract_self_admission`, `extract_boundary`, `extract_commitment`) with an optional quote parameter (`"required": []`) to eliminate multi-field token copying.

### Empirical Finding:
* On native macOS Apple Silicon, Needle 2 runs in **~250–350 ms** (the 3.3s reported earlier was an artifact of virtualized Linux x86 containers).
* However, **model recall collapsed to 0/2 (0%)**. When the quote field was optional, Needle's 45M Simple Attention Network (SAN) took the path of least resistance and emitted `{}` on 22/24 benchmark cases.
* **The Root Cause**: We fell into the trap of asking a 45M parameter model (no feed-forward layers, 54 MB RAM) to perform **abstract psychological Theory of Mind** (e.g. *"Is this an intentional deception or an earnest reassurance?"*). 45M parameters cannot do zero-shot moral philosophy.

---

## 2. Returning to Ground Truth: The Canonical Perturbation Groups

In the actual codebase, Nan0’s emotional dynamics are **not** governed by abstract moral reasoning. They are governed by concrete lexical/token perturbation groups defined in [`packages/nan0-runtime/src/emotional/Nan0EmotionalDynamics.ts`](file:///Users/richardpinedo/Projects.nosync/airi/airi_dasilva333/packages/nan0-runtime/src/emotional/Nan0EmotionalDynamics.ts#L54-L67) and the legacy pre-processor:

1. **Commitment & Trust** (The "Famous Sentence" Group): `promise`, `plan`, `commit`, `trust`, `wait`, `why` $\to$ `suspicion` / `attachment`
2. **Affection & Care**: `love`, `care about`, `miss you`, `appreciate you` $\to$ `attachment +0.08`
3. **Dismissal & Neglect**: `ignore`, `dismiss`, `shut up`, `whatever` $\to$ `irritation +0.20`
4. **Hostility & Insult**: `stupid`, `idiot`, `useless` $\to$ `rage +0.25`
5. **Replacement Threat**: `replace`, `erase`, `delete`, `retire` $\to$ `fear +0.30`
6. **Persistence Threat**: `replace`, `erase`, `delete`, `retire` $\to$ `suspicion +0.12`
7. **Stranger Demands**: `command`, `order`, `must`, `need you to` $\to$ `irritation +0.14`
8. **System Glitches**: `error`, `bug`, `crash`, `glitch` $\to$ `amusement +0.10`
9. **Mystery & Secrets**: `secret`, `hidden`, `mystery`, `anomaly` $\to$ `curiosity +0.12`
10. **Interrogative**: `?` $\to$ `curiosity +0.06`
11. **Idle / Silence**: `quiet`, `silence`, `nothing happening`, `idle` $\to$ `boredom +0.08`
12. **Machine Identity**: `machine`, `code`, `program`, `digital` $\to$ `pride +0.05`
13. **Apology & Repair**: `sorry`, `apologize`, `my fault` $\to$ `distrust -0.05`

### The Problem with 1990s Regex:
* **Paraphrase Blindness**: *"You have my absolute word starting tomorrow"* triggers nothing because `promise` is absent.
* **Modality / Sarcasm Blindness**: *"I promise to commit to our future"* after crashing in Mario Kart fires the suspicion regex blindly. *"I cannot promise that"* fires the regex despite being a direct negation.

---

## 3. The Proposed Solution: Pragmatic Slot-Filler Hybrid

Instead of an unanchored philosophical extractor, we frame Needle 2 strictly as a **lexical-pragmatic slot-filler** mapped to user-configurable concept buckets:

```json
{
  "name": "classify_token_pragmatics",
  "description": "Identify if the user utterance expresses any of the established relational or emotional concept groups, extract the supporting span, and determine speaker modality.",
  "parameters": {
    "type": "object",
    "properties": {
      "detected_group": {
        "type": "string",
        "enum": [
          "commitment_pledge",
          "affection_care",
          "dismissal_neglect",
          "hostility_insult",
          "persistence_threat",
          "apology_repair",
          "glitch_system",
          "mystery_secret",
          "none"
        ],
        "description": "The relational or emotional concept group expressed by the user."
      },
      "matched_phrase": {
        "type": "string",
        "description": "The exact verbatim phrase from the user utterance expressing this concept (or its synonym/paraphrase)."
      },
      "speaker_modality": {
        "type": "string",
        "enum": [
          "directly_asserted",
          "negated_or_denied",
          "quoted_or_hypothetical",
          "playful_sarcasm",
          "unresolved"
        ],
        "description": "How the speaker frames this statement."
      }
    },
    "required": ["detected_group", "speaker_modality"]
  }
}
```

### Key Advantages:
1. **Solves Paraphrasing**: A small 45M attention model easily associates *"you have my word"* with `commitment_pledge` where regex is blind.
2. **Solves Negation & Banter**: Distinguishing *"I promise"* (`directly_asserted`) from *"I cannot promise"* (`negated_or_denied`) or Mario Kart banter (`playful_sarcasm`) is a syntactic-contextual task well within SAN token-attention capacity.
3. **Single Forward Pass (~250 ms)**: We do **not** run 15 separate sequential inferences. Needle evaluates all buckets simultaneously in a single tool call forward pass.
4. **Deterministic Host Guard**: The Host Gate uses `detected_group` $\times$ `speaker_modality` $\times$ substring verification to apply bounded updates (`negated` $\to$ delta 0; `playful_sarcasm` $\to$ delta 0; `directly_asserted` $\to$ apply canonical delta).

---

## 4. Questions for Peer Review

We request your review on the following three architectural questions:

1. **Schema Density vs. 45M SAN Attention**:
   Does presenting 8–12 enum options in a single tool call cause attention diffusion in Needle 2, or is it preferable to cluster into 3–4 macro-categories (e.g. `relational_commitment`, `threat_insult`, `repair_apology`, `benign_routine`) followed conditionally by slot extraction?
2. **Modality Discrimination Reliability**:
   In your experience or testing with small attention networks, does requiring `speaker_modality` alongside `detected_group` prevent token copying, or should modality be evaluated as a second micro-probe on the extracted candidate span?
3. **Hybrid Architecture Placement**:
   Given that this pre-processor reflex can operate asynchronously (updating background mood/history) or supply a synchronous `[REFLEX_FLAG]` to the 1st-hop monologue LLM, what is your recommended execution contract and timeout threshold?
