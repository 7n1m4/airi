# LoCoMo Pass 8 peer review

Reviewed commit: `7ff7cce7383b5afb019f7c60ab53133c1c040e60` in `dasilva333/airi`.

**Verdict: the 70.20% saved-prediction milestone is reproducible. The claim that System-1 now answers with 100% precision is not supported.** Keep the architecture change, repair temporal answer acceptance and distillation abstention, and correct the historical scorecard before using it to guide the next pass.

This was a read-only source, artifact, and local contract review. I independently rescored the saved predictions using the upstream Python evaluation functions, ran the 16 tests with Vitest, and mocked Jev responses to exercise distillation. I did not rerun the cloud benchmark or modify repository code. The checkout remained clean. Rescoring establishes evaluation consistency, not reproducibility of a fresh model run.

## 1. Verified results and corrected comparison

The committed Pass 6, 7, and 8 traces contain these results. Every per-question upstream score matched the independent Python calculation; Pass 7 and Pass 8 questions, answers, and gold evidence were unchanged.

| Metric | Pass 6 | Pass 7 | Pass 8 | Pass 8 − Pass 7 |
|---|---:|---:|---:|---:|
| Upstream F1 | 49.13% | 53.70% | 70.20% | +16.50 points |
| C1 multi-hop F1 | 45.88% | 50.26% | 65.42% | +15.16 points |
| C2 temporal F1 | 50.58% | 55.13% | 60.14% | +4.99 points |
| C3 open-domain F1 | 43.61% | 42.06% | 44.62% | +2.56 points |
| C4 literal F1 | 50.19% | 55.76% | 79.49% | +23.72 points |
| Legacy token F1, trace aggregate | 48.92% | 53.19% | 69.60% | +16.41 points |
| Recorded run duration | 184.85s | 154.13s | 264.37s | +110.24s |

The handoff’s Pass 6 and Pass 7 category values do not match those traces. In particular, the temporal gain is **4.99**, not 14.73 points. The current trace supports 84/150 questions with upstream F1 ≥0.8; Pass 7 has **54**, not 49. Call these high-scoring answers: gold-dependent F1 is not model confidence.

Pass 8 evidence hits reproduce **135/203 = 66.50%**, compared with Pass 7’s **113/203 = 55.67%**. Recomputing from only the first three recorded evidence IDs gives those same counts for these runs. However, the evaluator actually consumes all selected candidates: Pass 8 gives six centers to 19 questions and three to 131. Therefore the implementation does not enforce a fixed Recall@3 contract even though restricting these particular traces to three happens not to change the result. Explicitly slice for Recall@3, and report selected-window coverage separately.

The recorded runtime is approximately **4.41 minutes or 1.76s/question**, 71.5% longer than Pass 7. Initialization is outside the runner’s timed question loop; this is not total cold-start time. BLEU-1 64.39% agrees with the trace aggregate; the independent scorer audit here targeted upstream F1.

## 2. Highest-priority correctness findings

### P1 — Temporal answers bypass escalation without proving event identity

Locations: `answer-head-pass3.mjs`, temporal branches and `shouldEscalateToSystem2`.

Pass 8 routes 115/150 questions to System-2 under its production routing rule. The remaining 35 System-1 answers average **68.70% upstream F1**, with 16 achieving F1=1. F1 below one can reflect wording differences, so it is not by itself a semantic precision measure. Nevertheless, the trace contains unmistakable failures:

| Question | Retained answer | Gold answer |
|---|---|---|
| When did John start his job in IT? | June 13, 2022 | 2019 |
| When did James depart for his trip to Canada? | November 4, 2022 | July 11, 2022 |
| Did James have a girlfriend during April 2022? | September 3, 2022 | Presumably not |
| How long had John played drums as of March 27, 2022? | a few days | One month |

The temporal reader selects expressions from dialogue windows without reliably binding them to the queried actor and event. A session date can still become the answer to a “when” question without evidence that the event occurred on that date. A triage mistake can turn a polar question into a calendar answer. Removing the narrow greeting-duration pattern did not establish general event binding.

**Recommended fix:** permit deterministic output only from a resolved temporal claim containing the actor, event identity, source turn, time expression, anchor, and relation. Validate answer type against the question. Missing or conflicting bindings should return `UNKNOWN`. Preserve vague dates as intervals or granularity-aware values; do not invent an exact day. Add regression cases for these actual failures and actor/event-swapped variants.

### P1 — Ledger existence is treated as sufficient proof

Locations: `dual-searcher-pass3.mjs`, graph branches; `answer-head-pass3.mjs`, escalation gate.

`if (ledgerResult) return false` prevents escalation for every non-null graph result. Yet the adopted-pet-name branch chooses the first adoption claim without checking the requested adopter; the adoption-date branch explicitly queries James/Ned. Pet ownership defaults to John when James is absent. Residence inference can turn shelter location into “Likely yes.” These are broader acceptance rules than the evidence supports.

**Recommended fix:** require an explicit verified result with bound entities, predicate, temporal scope, source provenance, and—for list queries—a defined completeness scope. Return unresolved for unmatched names. Treat residence inference as inference, not a deterministic fact. Test another adopter, an unknown owner, conflicting claims, and incomplete lists. A graph supplies a representation; it does not make a loosely matched claim correct.

### P1 — Distillation ignores Jev’s “none” answer

Location: `dual-searcher-pass3.mjs`, in-session distillation.

Before calling Jev, the code initializes `winningTurn` to the highest locally ranked turn. A valid `turn_N` replaces it; `none`, an absent answer, and a failed call leave that initial choice intact. A negative classifier result therefore still replaces the summary with a raw turn.

I reproduced this with a one-session mock against the committed class:

| Jev response | Returned evidence |
|---|---|
| `choice: none, confidence: 1` | `D1:1` |
| `choice: turn_0, confidence: 0` | `D1:1` |
| Missing answer | `D1:1` |

**Recommended fix:** distinguish `selected`, `abstained`, and `failed`. Respect explicit `none`; use a separately identified retrieval fallback for transport failure only if that is the intended policy. Validate the exact choice key. Record the summary ID, candidate IDs, selected turn, confidence, fallback reason, and latency. Confidence is currently neither checked nor persisted, so the trace cannot establish the handoff’s 70–90% confidence claim or its calibration.

## 3. Retrieval and evidence improvements for the next pass

The summary-to-raw-turn transformation is useful: it gives the answer model conversational evidence rather than a short abstraction. Unified selected windows and date headers also repair important earlier evidence-delivery problems. Preserve those changes.

Three remaining limits deserve bounded fixes:

- **Choice truncation:** Jev sees only the first 160 characters of each distillation candidate, and the reranker sees 280. Evidence later in a turn can be invisible even though the complete turn is eventually hydrated. Use a measured token budget or sentence selection that retains the relevant span and its context. Test answers occurring beyond each cutoff.
- **One winner per session:** a list can require two distant turns in the same session. Permit a small number of additional independently supported turns for multi-hop questions, subject to a fixed total evidence budget. Session diversity alone does not establish list completeness.
- **Incomplete provenance:** hydration can combine several referenced turns, but `toPrimaryId` retains only the first ID. Neighbor windows also lack per-turn IDs, and metadata comes from the first source. Represent each delivered turn with its own ID, date, and speaker; deduplicate overlapping turns before applying the prompt budget. This supports meaningful prompt-visible recall and correct temporal anchoring.

The System-2 evidence cap is now 6,000 characters and includes date headers; the old 800-character criticism no longer applies. It is still a cap, so “uncapped context” is inaccurate. Persist the actual delivered evidence or a reproducible manifest with truncation metadata.

## 4. Tests and response contracts

**The 16 tests pass under Vitest.** The documented native `node --test` command does not demonstrate that result: with dependencies resolved, it reports one passing file and zero suites rather than executing the 16 Vitest cases. Provide a Vitest-backed package script and make CI assert the expected test count. Declare the necessary dependencies or document the workspace dependency boundary.

The new production escalation helper is directly tested, an improvement over a duplicated routing fixture. Add tests for the new distillation path—particularly explicit abstention, missing answers, malformed choices, and relevant content beyond the crop. The existing 16 passing cases do not cover these failures.

The System-2 resolver now has a timeout and retry loop. It still treats some syntactically successful but incomplete payloads as success, accepts bare strings alongside structured answers, and does not expose a reliable per-question failure status. Validate each requested ID and retry only unresolved items when appropriate. Record refused, truncated, malformed, missing, insufficient-evidence, and answered outcomes separately. Its five-minute attempt timeout with three sequential attempts also warrants a reported batch and run budget; no new cloud experiment is needed to test these contracts.

## 5. What the milestone establishes—and what to measure next

The combined system improved materially on this development conversation. Attribution remains unresolved: Pass 8 simultaneously changed distillation, answer acceptance, list routing, and System-2 usage. Its initial System-1 predictions score **16.03% overall**, while the completed system reaches 70.20%; 110 final predictions differ from their initial values. The milestone therefore describes the complete dual-process system, not a demonstrated 70.20% System-1 reader.

Run a cached, controlled 2×2 ablation: distillation off/on crossed with the previous/new escalation policy. Hold candidate budgets, evidence formatting, model versions, and decoding settings fixed; reuse identical System-2 inputs where possible. Report per-category F1, answerable-evidence coverage, retained System-1 semantic error rate, escalation rate, model calls/tokens, and latency percentiles. A single batched HTTP request should not be described as one backend forward pass without provider evidence.

For Pass 9, prioritize verified temporal and graph acceptance, then distillation abstention and provenance. Repair the historical table and test command immediately. Freeze those changes before evaluating another LoCoMo conversation; repeated optimization on conv-47 alone does not establish broader benchmark performance. Pin commit, dataset and cache hashes, scorer revision, prompts, model identifiers, and actual request outcomes so the next gain can be reproduced and attributed.

## Reviewed sources

All paths below are relative to the reviewed repository commit:

- `reports/memory-lab/locomo-conv47-pass6-trace.json`
- `reports/memory-lab/locomo-conv47-pass7-trace.json`
- `reports/memory-lab/locomo-conv47-pass8-trace.json`
- `reports/memory-lab/locomo-conv47-pass8-report.md`
- `scripts/tests/locomo-benchmark/dual-searcher-pass3.mjs`
- `scripts/tests/locomo-benchmark/answer-head-pass3.mjs`
- `scripts/tests/locomo-benchmark/jev-rerank.mjs`
- `scripts/tests/locomo-benchmark/system2-batch-resolver.mjs`
- `scripts/tests/locomo-benchmark/locomo-runner-pass3-jev.mjs`
- `scripts/tests/locomo-benchmark/locomo-index.mjs`
- `scripts/tests/locomo-benchmark/evaluator-parity.test.mjs`

Independent scoring reused the upstream evaluation source retained during the preceding review, SHA-256 `51b663d5d4e26562ea0b4b763a171f98356e10cf937326a0322a01207ad1bc75`, with its Python normalization, stemming, category handling, and answer scoring functions.
