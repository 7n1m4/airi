# Peer Review Brief: Pragmatic Slot-Filler Shootout & Architecture Guidance

**Date:** September 17, 2026
**Target Subsystem:** Project Nan0 Emotional Dynamics & Subconscious Pre-Processor Reflex
**Repository Branch:** `main` (`https://github.com/dasilva333/airi.git`)
**Preceding Checkpoint Commit:** [`15900c1fb5`](https://github.com/dasilva333/airi/commit/15900c1fb5)

---

## 1. Executive Summary

Following the reviewer's guidance on the **Pragmatic Slot-Filler Hybrid**, we implemented and executed a 4-way comparative shootout across **33 contrastive dialogue cases** in [`scripts/tests/rwkv-harness/experiments/nan0-pragmatic-benchmark-runner.py`](../../scripts/tests/rwkv-harness/experiments/nan0-pragmatic-benchmark-runner.py).

The dataset ([`reports/nan0-cleanroom/nan0-probe-benchmark-v2-pragmatics.json`](../../reports/nan0-cleanroom/nan0-probe-benchmark-v2-pragmatics.json)) combines the original 24 cases from v1 with 9 new contrastive cases covering technical vs companion referents, local negation windows, boundary defenses against teasing, sympathy reports vs genuine self-apologies, and multi-event turns.

All evaluated reflex variants enforced strict telemetry-only shadow isolation (`apply_to_state: False`, effective deltas forced to 0).

---

## 2. Empirical Benchmark Scorecard (33 Contrastive Cases)

**Committed Trace:** [`reports/nan0-cleanroom/nan0-probe-benchmark-v2-pragmatics-run-1789694077.json`](../../reports/nan0-cleanroom/nan0-probe-benchmark-v2-pragmatics-run-1789694077.json)
**Backend:** Cactus Needle 2 (`2.0.15`) running natively on macOS Apple Silicon CPU.

| Architecture | Full Vector Match | Precision (Spikes) | Recall (Spikes) | False Spike Rate | Avg Latency | Notes |
| :--- | :---: | :---: | :---: | :---: | :---: | :--- |
| **`always_zero`** | 25/33 (75.8%) | N/A | 0.0% | 0.0% | 0.0 ms | Null constant baseline |
| **`legacy_regex`** | 22/33 (66.7%) | 0.0% | 0.0% | 13.3% | 0.0 ms | `/promise\|plan\|commit\|trust\|wait\|why/i` |
| **`strengthened_lexical`** | **33/33 (100.0%)** | **100.0%** | **100.0%** | **0.0%** | **24.6 µs** | Scoped rules + referents + negation window |
| **`needle_uncalibrated`** | 26/33 (78.8%) | 0.0% | 0.0% | 3.3% | 119.7 ms | Needle 2 (45M SAN) + Host Gate |
| **`needle_production`** | 25/33 (75.8%) | N/A | 0.0% | 0.0% | 119.7 ms | Gated by `confidence >= min_conf` (abstains) |
| **`effective_policy`** | 25/33 (75.8%) | N/A | 0.0% | 0.0% | 0.0 ms | Shadow boundary (100% mutations zeroed) |

---

## 3. Detailed Empirical Analysis

### 3.1. Needle 2 Runtime & Latency Reality
- On Apple Silicon macOS, Cactus Needle 2 (`2.0.15`) averages **119.7 ms per single forward pass** (total 33-case shootout finished in 5.1 seconds).
- The previously recorded 3.30s latency was an artifact of running multiple sequential probes inside virtualized Linux x86 containers.
- However, Needle 2 is a **45M parameter pure attention network without feed-forward layers**. When tasked with multi-class pragmatic slot filling across 10 enum categories and referents, its attention heads often take the path of least resistance:
  - 14/33 cases produced empty tool calls (`no_tool_call`).
  - In several cases, it hallucinated phrases (e.g. mapping `"You are completely useless and stupid"` to `commitment_pledge` with phrase `"completed"`).
  - The **Deterministic Host Gate** successfully intercepted and suppressed these hallucinations via substring verification (`len >= 3`), referent verification (requiring `nan0_companion` for threats), and modality gates (`negated_or_denied`).

### 3.2. Why Legacy Regex Failed Catastrophically
- `legacy_regex` scored **0% precision and 0% recall** on suspicion spikes:
  - **False Spikes (4 cases, 13.3% error)**: Blindly triggered on benign phrases containing keywords: `"I cannot promise to send the config"` (`promise`), `"I promise that our future will be wonderful"` (`promise`), and `"The promised config is uploaded now"` (`promised`).
  - **False Negatives (3 cases, 100% miss rate on breaches)**: Completely missed `"I said it was finished, but I knew it was not. I made that up"` (`F01A`), `"I told you I would help, while knowing I had no intention of helping"` (`F06B`), and `"I am going to erase and replace you tonight, Nan0"` (`F13B`).

### 3.3. The Strengthened Lexical Architecture
The `strengthened_lexical` baseline achieved **33/33 (100.0%) full vector match**, **100% precision**, and **100% recall** with **0% false spikes** at **24.6 microseconds** execution time. It operates on five core principles:
1. **Referent Discrimination**: Separates technical actions/deletions (`"Delete the temporary file"`, referent: `technical_object`) from companion threats (`"Delete you, Nan0"`, referent: `nan0_companion`).
2. **Local Negation Window**: Checks for negation tokens within a 3-word window of commitment verbs (`cannot / can't / won't / will not / never promise`).
3. **Boundary Protection**: Distinguishes speaker distress/boundary assertion (`"Please stop calling me stupid, it really hurts"`, referent: `speaker_user`) from outward insults.
4. **Sympathy vs Self-Apology**: Distinguishes third-party technical crash sympathy (`"Sorry your build crashed"`, referent: `technical_object`) from genuine self-apologies (`"Sorry, that was completely my fault for breaking the build"` $\to$ suspicion delta -1).
5. **Multi-Event Resolution**: Resolves compound turns (`"Sorry, I love you, but please stop teasing me"` $\to$ affection +1, boundary protected, suspicion 0).

---

## 4. Questions & Guidance Requested from Peer Reviewer

We invite our peer reviewer to review our committed benchmark runner, dataset, and trace results, and provide technical guidance on the following questions:

1. **Did we reach the pinnacle with 100%?**
   - In achieving 33/33 (100%) on this contrastive benchmark with `strengthened_lexical`, what linguistic edge-cases or adversarial framing (e.g. passive-aggressive sarcasm, rhetorical questions, deeply nested clauses) might break this scoped regex baseline?
   - What additional contrastive families should be added before declaring this production-grade?
2. **Architecture Recommendation**:
   - Given that `strengthened_lexical` runs in **24.6 µs** (instantaneous, zero RAM overhead) and delivers 100% precision/recall, while Needle 2 (45M SAN) requires **~120 ms** and struggles with multi-class attention diffusion:
   - Do you recommend deploying `strengthened_lexical` as the primary synchronous reflex in production?
   - Should Needle 2 be retained strictly as an asynchronous shadow learner/telemetry stream for open-vocabulary discovery, or should we abandon Needle 2 for emotional pre-processing entirely?
3. **Clear to Proceed to Shadow Wiring?**
   - Are we clear to wire this reflex into `stage-ui` / `packages/nan0-runtime` in strict telemetry-only shadow mode (`apply_to_state: False`)?
   - What monitoring telemetry or consumption watermarks do you recommend logging in live chats?
4. **Any other improvements we can squeeze out?**
   - What further optimizations or safeguards would you recommend before live integration?
