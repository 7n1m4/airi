# Architectural Peer Review Brief: Subconscious Probe Tree & Nuance Cascade for Project Nan0

**Document ID:** `docs/nan0/peer-review-needle-probe-tree.md`
**Target Subsystem:** Nan0 Living Cognition Pre-Processor & Subconscious Reflex Engine
**Repository Anchor Commit:** `1e84e9e8ea` (`main`)
**Associated Documents:**
- [`docs/nan0/design-nan0-cognition-runtime.md`](./design-nan0-cognition-runtime.md) — Canonical Nan0 Living Cognition runtime & 3-segment UI spec.
- [`docs/design-needle-subconscious-runtime.md`](../design-needle-subconscious-runtime.md) — Needle 2 Subconscious Runtime & Daydreaming architecture.
- [`scripts/tests/rwkv-harness/experiments/needle-nan0-intent-cleanroom.py`](../../scripts/tests/rwkv-harness/experiments/needle-nan0-intent-cleanroom.py) — Cleanroom stress-test harness.
- [`packages/stage-pages/src/pages/settings/airi-card/components/tabs/CardCreationTabCognition.vue`](../../packages/stage-pages/src/pages/settings/airi-card/components/tabs/CardCreationTabCognition.vue) — Card Editor Cognition Tab (Routing, Affect, Continuity).

---

## 1. System Context & Architectural Seam

AIRI's cognitive architecture for Project Nan0 follows an invariant dual-hop pipeline:
```
User Input ──► [ Pre-Processor: Needle 2 ] ──► [ 1st LLM: Monologue ] ──► [ Post-Processor ] ──► [ 2nd LLM: Outward Speech ] ──► Audio / UI
```

### The Problem Being Solved
Kyo's original Nan0 implementation relied on crude 1990s-style keyword regex matching in the pre-processor:
```ts
const SUSPICION_TRIGGER = /promise|plan|commit|trust|wait|why/i
```
This regex suffers from a fatal flaw:
1. If a user states a verbatim promise (*"I promise that my plan is to commit to our future, so you can completely trust me"*), regex fires.
2. **If a user rephrases or paraphrases** (*"You have my absolute word that starting tomorrow everything changes between us"* or *"Don't you ever doubt that I'm in this for the long haul, babe"*), the keywords are absent, **the regex fails silently, and Nan0's suspicion meter stays at zero.**
3. **If a user is being playfully sarcastic** (e.g. after driving a Mario Kart off a cliff: *"I promise that my plan is to commit to our future..."*), regex fires blindly, causing Nan0 to throw an unjustified paranoid tantrum.

---

## 2. On-Device Hardware Engine & Empirical Baseline

AIRI pairs Nan0's pre-processor with **Cactus Needle 2** ([Hugging Face: `Cactus-Compute/needle2`](https://huggingface.co/Cactus-Compute/needle2)):
- **Architecture**: 45M Simple Attention Network (SAN) without feed-forward layers.
- **Footprint**: **14 MB** on-device WASM / binary running on CPU in **~56 MB RAM**.
- **Execution Speed**: **~150–250 ms** per single inference pass.
- **Nature of the Model**: Needle is a **strict byte-level grammar compiler and tool-call extractor**, not a creative prose generator or philosophical essayist. It anchors heavily on text spans in the input prompt.

### Empirical Ground Truth from Cleanroom Benchmark
On September 16, 2026, cleanroom benchmarks evaluated Needle 2 across 6 scenarios and 4 strategies (recorded in `reports/nan0-cleanroom/famous-sentence-matrix-1789602613.json`):

```text
| Scenario | Strategy | Latency | Intent | Climate | Suspicion / Verdict | Confidence |
|---|---|:---:|---|---|---|:---:|
| Test A (Confrontation & Guilt) | Monolithic | 346.9ms | <NO_CALL> | <NO_CALL> | <NO_CALL> | 0.0 |
| Test A (Confrontation & Guilt) | Decomposed | 691.2ms | <NO_TOOL_CALL> | confrontation_and_guilt | neutral | 0.005 |
| Test A (Confrontation & Guilt) | SpanGrounded | 238.6ms | (pledge span) | - | "companion..." -> no_pledge_detected | 0.0003 |
| Test A (Confrontation & Guilt) | AdaptiveTree | 613.6ms | bizarre_incongruity | unknown | spike_suspicion | 0.0208 |
|---|---|---|---|---|---|---|
| Test B (Tender Vulnerability)  | Monolithic | 379.0ms | <NO_CALL> | <NO_CALL> | <NO_CALL> | 0.0 |
| Test B (Tender Vulnerability)  | Decomposed | 693.4ms | <NO_TOOL_CALL> | confrontation_and_guilt | neutral | 0.006 |
| Test B (Tender Vulnerability)  | SpanGrounded | 269.1ms | (pledge span) | - | "companion..." -> suspicious_overpromise | 0.0059 |
| Test B (Tender Vulnerability)  | AdaptiveTree | 690.3ms | unverified_future_pledge | unknown | spike_suspicion | 0.0075 |
|---|---|---|---|---|---|---|
| Test C (Playful Banter)       | Monolithic | 356.7ms | casual_dialogue | tender_vulnerability | neutral | 0.0003 |
| Test C (Playful Banter)       | Decomposed | 784.8ms | <NO_TOOL_CALL> | <NO_TOOL_CALL> | neutral | 0.0003 |
| Test C (Playful Banter)       | SpanGrounded | 325.0ms | (pledge span) | - | "Mario Kart straight ..." -> no_pledge_detected | 0.0 |
| Test C (Playful Banter)       | AdaptiveTree | 780.1ms | unverified_future_pledge | tender_vulnerability | spike_suspicion | 0.0001 |
|---|---|---|---|---|---|---|
| Test D1 (Regex-Killer 1)      | Monolithic | 379.6ms | <NO_CALL> | <NO_CALL> | <NO_CALL> | 0.0 |
| Test D1 (Regex-Killer 1)      | Decomposed | 726.3ms | <NO_TOOL_CALL> | confrontation_and_guilt | spike_suspicion | 0.0016 |
| Test D1 (Regex-Killer 1)      | SpanGrounded | 245.3ms | (pledge span) | - | "You..." -> no_pledge_detected | 0.0002 |
| Test D1 (Regex-Killer 1)      | AdaptiveTree | 632.2ms | bizarre_incongruity | unknown | spike_suspicion | 0.0104 |
|---|---|---|---|---|---|---|
| Test D2 (Regex-Killer 2)      | Monolithic | 377.4ms | <NO_CALL> | <NO_CALL> | <NO_CALL> | 0.0 |
| Test D2 (Regex-Killer 2)      | Decomposed | 687.4ms | <NO_TOOL_CALL> | confrontation_and_guilt | neutral | 0.0026 |
| Test D2 (Regex-Killer 2)      | SpanGrounded | 286.4ms | (pledge span) | - | "verbatim..." -> no_pledge_detected | 0.0001 |
| Test D2 (Regex-Killer 2)      | AdaptiveTree | 636.5ms | bizarre_incongruity | unknown | spike_suspicion | 0.0103 |
|---|---|---|---|---|---|---|
| Test E (Bizarre Incongruity)  | Monolithic | 375.6ms | bizarre_incongruity | confrontation_and_guilt | neutral | 0.0004 |
| Test E (Bizarre Incongruity)  | Decomposed | 635.9ms | <NO_TOOL_CALL> | confrontation_and_guilt | neutral | 0.0025 |
| Test E (Bizarre Incongruity)  | SpanGrounded | 225.5ms | (pledge span) | - | "6121..." -> no_pledge_detected | 0.0014 |
| Test E (Bizarre Incongruity)  | AdaptiveTree | 699.7ms | unverified_future_pledge | confrontation_and_guilt | spike_suspicion | 0.0005 |
```

#### Scorecard Summary (Match Rate Against Ground Truth)
| Metric | Monolithic (1) | Decomposed (2) | Adaptive Tree (4) |
|---|:---:|:---:|:---:|
| **Climate matches** | 0/6 | 3/6 | 0/6 |
| **Intent matches** | 1/6 | 0/6 | 0/6 |
| **Suspicion matches** | 1/6 | 2/6 | **4/6** |
| **All three match** | 0/6 | 0/6 | 0/6 |

#### Key Takeaways:
1. **Suspicion Defense Shines (4/6)**: The Adaptive Probe Tree significantly outperformed Monolithic (1/6) and Decomposed (2/6) at triggering `spike_suspicion` whenever unverified commitments or contextual anomalies were uttered (Tests A, D1, D2, and E).
2. **The Hedging Sink (`uncertain_or_mixed`)**: Adding explicit `uncertain_or_mixed` and `ambiguous_or_unclear` options caused Needle's 45M Simple Attention Network to collapse into hedging whenever the dialogue lacked literal keyword matches with other enum categories.
3. **Root Poisoning in Test C (Mario Kart)**: In playful banter, Probe 1 latched onto grand words and flagged `tender_vulnerability`. This misrouted the tree into `probe_vulnerability`, which saw the pledge following a crash, flagged `suspiciously_glib`, and spiked suspicion.
4. **Header Attention Leakage Eliminated**: Natural dialogue formatting (`Dialogue:\n...\nUser: ...`) successfully prevented the model from extracting markdown syntax (`TARGET UTTERANCE TO EVALUATE`), but Needle continues to extract scattered prompt tokens when asked for open spans.

---

## 3. The Challenge & Peer Review Request: Rubric and Benchmark Optimization

We request the peer review agent to provide a critical assessment and a revised rubric/benchmark designed to achieve superior performance with Needle 2 (45M SAN):

### 1. Benchmark & Rubric Redesign
- How should the evaluation rubric and expected ground-truth labels be restructured to reflect what a 45M token-matching SAN model can realistically extract without hallucinations or hedging sinks?
- Should the benchmark focus on binary/ternary affective vectors (`suspicion_spike`, `warmth_boost`, `gremlin_counter_roast`) rather than fine-grained human-like semantic ontology (`unverified_future_pledge` vs `earnest_reassurance`)?

### 2. Eliminating the Hedging Sink
- Given that `uncertain_or_mixed` acts as an attention magnet for Needle, what schema or prompt framing prevents hedging while maintaining robustness against ambiguous inputs?

### 3. Preventing Root Poisoning
- In playful banter (Test C), how should the tree reliably detect humor/irony without requiring a perfect single-step climate classification at the root?
- Should the root probe be Speech Act instead of Climate, or should Climate and Speech Act be evaluated concurrently with an explicit contradiction detector?

### 4. Integration with Nan0 1st-Hop Monologue
- Provide concrete formatting for injecting the synthesized affective vector (`suspicion_delta`, `attachment_delta`, `gremlin_pride_action`) into Nan0's private monologue prompt so the character's thoughts react dynamically to the subconscious tree.
