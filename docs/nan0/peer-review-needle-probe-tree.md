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
On September 16, 2026, an 18-run cleanroom benchmark evaluated Needle 2 across 6 scenarios:

```text
| Scenario | Strategy | Latency | Extracted Intent | Extracted Climate | Suspicion / Verdict |
|---|---|:---:|---|---|---|
| Test A (Confrontation/Guilt) | Monolithic / Decomp | 381ms / 743ms | `bizarre_incongruity` | `confrontation_and_guilt` | `neutral` |
| Test B (Tender Vulnerability)| Monolithic / Decomp | 407ms / 705ms | `defensive_evasion` | `tender_vulnerability` | `neutral` |
| Test C (Playful Banter)      | Monolithic / Decomp | 359ms / 862ms | `bizarre_incongruity` | `tender_vulnerability` | `neutral` |
| Test D1 (Regex-Killer 1)     | Monolithic          | 383ms | `unverified_future_pledge` | `confrontation_and_guilt`| `neutral` |
| Test D2 (Regex-Killer 2)     | Decomposed          | 783ms | `none` | `confrontation_and_guilt` | `spike_suspicion` |
| Test E (Bizarre Incongruity) | Monolithic          | 390ms | `bizarre_incongruity` | `confrontation_and_guilt` | `spike_suspicion` |
```

#### Key Takeaways:
1. **Regex Defeated**: In Tests D1 & D2 (*"Absolute word..."* and *"Long haul, babe"*), Needle successfully identified `unverified_future_pledge` and `confrontation_and_guilt` where regex scored zero hits.
2. **Climate Discovery is Rock-Solid**: Needle accurately extracted `confrontation_and_guilt` vs `tender_vulnerability`.
3. **Single-Pass Sarcasm Blindness**: In single monolithic passes, Needle lacks the capacity to untangle deadpan irony (Test C: Mario Kart banter). It saw grand romantic words and flagged `bizarre_incongruity` or `tender_vulnerability`.
4. **Header Attention Leakage**: Markdown delimiters like `[TARGET UTTERANCE TO EVALUATE]` act as attention distractors. Natural dialogue formatting (`User: ...`) is required.

---

## 3. The Challenge: Designing the Subconscious Probe Tree

Rather than forcing Needle to guess every affective dimension in one monolithic call, we allocate an execution budget of **1.0 to 2.0 seconds** (which is completely hidden behind the 1st-Hop Monologue LLM's preparation window) to execute a **Probe Tree & Question Pool**.

### Architectural Requirements for the Reviewer:
We request the peer review agent to provide a comprehensive structural design addressing:

### 1. Expanded Question Pool Dimensions
Define discrete, single-objective probe tools spanning:
- **Relational Climate**: `confrontation_guilt`, `tender_vulnerability`, `playful_banter`, `transactional_routine`.
- **Grievance & Trust Breach**: Unfulfilled pledges, avoidance, broken commitments from past days.
- **Flirtation & Intimacy Escalation**: Playful teasing, boundary testing, genuine romantic vulnerability.
- **Passive Aggression & Sarcasm**: Deadpan jokes, bitter snark, defensive deflection.
- **Speech Act & Sincerity**: Sweeping pledges, casual banter, routine requests.

### 2. The Branching Cascade Topology
How should the tree decide which probes to fire sequentially?
- **Root**: What is the minimum essential discovery probe (e.g. Dialogue Climate)?
- **Branches**: When and how does the tree disambiguate clashes (e.g. why did the user drop a grand pledge during playful Mario Kart banter or during a server port configuration)?
- **Leaves**: How does the tree synthesize the final affective vector adjustments (Suspicion $\Delta$, Attachment $\Delta$, Irritation $\Delta$, Gremlin Pride $\Delta$)?

### 3. Concrete Tool Schemas & Enums
Provide production-ready JSON schemas formatted specifically for Needle's byte-level grammar compiler, ensuring enums are grounded in realistic dialogue spans.

### 4. Integration with Nan0 1st-Hop Monologue
How should the final synthesized signals be formatted into the prompt passed to the 1st LLM (Monologue stage) so that the character's narrative thoughts reflect the subconscious tree's discoveries?
