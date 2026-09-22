# LoCoMo Pass 10 peer review

**Reviewed commit:** `4a010c80f5fafb5acf7a651c6d4ec472af97ce7c`, `dasilva333/airi`.

**Verdict:** the saved predictions reproduce **74.23% upstream F1**. Turn-1 indexing makes the demonstrated job-start turn retrievable. Keep that change. However, the monolithic result measures joint batch answering, and the current experiment does not establish how much of the improvement comes from anaphora handling versus shared evidence, batching, or model variability. Several concrete correctness defects remain.

Review scope: read-only source inspection, independent Python rescoring, the existing Vitest suite, BM25 reproduction, and local mocks. No cloud benchmark was rerun, no application code was changed, and the repository checkout remained clean.

## Verified scorecard

The committed traces reproduce all four category scores and all per-question upstream scores without discrepancies. Their questions and gold answers match the canonical dataset.

| Metric | Pass 8 | Pass 9 Jev | Pass 9 Laya | Pass 10 |
|---|---:|---:|---:|---:|
| Upstream F1 | 70.20% | 69.29% | 69.12% | **74.23%** |
| C1 multi-hop | 65.42% | 67.80% | 77.24% | **81.07%** |
| C2 temporal | 60.14% | 57.53% | 62.19% | **62.64%** |
| C3 open-domain | 44.62% | 44.62% | 44.62% | **52.31%** |
| C4 literal | 79.49% | 78.34% | 73.85% | **80.76%** |
| Answers with F1 ≥0.8 | 84 | 85 | 86 | **92** |
| First-three-center evidence hits / 203 | 135 | 137 | 84 | **133** |
| Trace duration | 264.37s | **272.69s** | 1348.24s | **148.41s** |

The exact Pass 10 score is 74.2277865925%; its gain over Pass 9 Jev is **4.9347307205 percentage points**, conventionally rounded to **+4.93**, not +4.94. The handoff’s Pass 9 total of 312.8s conflicts with the trace’s 272.69s. Identify the source run before claiming that timing comparison.

Pass 10’s 65.52% Recall@3 is **133/203**, now explicitly restricted to three candidates in the runner. All selected centers yield 134/203. `fullWindowRecall` still measures candidate IDs, not every raw turn delivered inside their conversational windows. A reconstruction using just recorded raw centers and their immediate neighbors finds 148/203 gold-turn hits before prompt truncation; it is not a measurement of the exact delivered prompt, whose body is not saved.

All **19 tests pass under Vitest**. The standalone package still does not declare the full audit dependency set, so I used the isolated dependencies from the preceding reviews. Passing tests should not be described as new anaphora integration coverage: the added tests cover polar guarding, date parsing, and an explicitly unverified graph result.

## P1 — Joint prompting changes the evaluation condition

**Sources:** `system2-batch-resolver.mjs`, lines 73–122; `locomo-runner-pass10-anaphora.mjs`, System-2 queue and dispatch.

All 121 escalated questions, each with its retrieved evidence, enter one shared model context. “Answer each item independently” is an instruction, not an information boundary. The model can consult evidence retrieved for other questions and information implied by the other questions themselves. This is especially relevant to C1 lists: the combined batch can contain facts missing from a particular question’s retrieval.

This is **not evidence of gold-answer leakage** in the main runner. It is a different inference protocol from isolated question answering. The score is valid for the recorded joint protocol; it does not by itself establish equivalent performance when AIRI receives one user question at a time. Earlier chunked batches also allowed sharing within each chunk; increasing to one batch expands that shared context substantially.

**Recommendation:** report two explicitly named tracks:

1. Independent-question QA: isolate model context per question, with bounded concurrent requests for throughput.
2. Joint conversation QA: permit the full batch’s evidence to be shared and report the resulting evidence budget and batch dependence.

For the joint track, test shuffled question order, removal of related questions, and a different conversation. For the independent track, answer each item using the same frozen evidence packets. Cross-session memory access should come from retrieval or a question-independent conversation index; it should not require other evaluation questions to supply missing facts.

The 66.33s batch time is a throughput result. An individual answer in that request waits for the complete response. Dividing total runtime by 150 does not establish interactive response latency.

## P1 — The “isolated” batch experiment is confounded

**Source:** `isolated-batch-shootout.mjs`, lines 51–58 and comparison/reporting code.

The experiment selects questions using `p9.category === 1 || p9.category === 3`; these are benchmark gold categories, unlike the production triage fields. It also includes previously resolved questions and UNKNOWN predictions. The saved experiment contains **126 items**—119 answered plus seven insufficient—rather than the handoff’s 121-question production queue.

Its monolithic evidence is reconstructed from center turns only. The earlier production answers were generated using hydrated conversational windows. Finally, the chunked arm is not executed in this script: predictions are borrowed from the Pass 9 trace, while 182.18s and 13 requests are constants.

Consequently this is a diagnostic comparison, not a controlled batch-size ablation. Its 69.7056% versus 69.3207% subset scores cannot isolate monolithic batching’s causal effect.

**Recommendation:** persist one label-blind queue and its exact evidence strings. Run both batch sizes over those identical items, with the same model, prompt, sampling settings, and output policy. Record complete outputs and token usage for both. Repeat enough times to distinguish a small gain from generation variability. Separately vary windowing in a 2×2 experiment.

## P1 — Temporal answers still accept unrelated dates and durations

**Source:** `answer-head-pass3.mjs`, temporal branch.

The polar-question guard and removal of the unconditional session-date fallback are useful fixes. Relative expressions and durations are still accepted without binding them to the requested event; two lexical overlaps for explicit dates are not an event-identity check.

There are **29 retained System-1 answers**, averaging 71.19% upstream F1. Several are clearly incorrect:

| Question | Retained answer | Gold |
|---|---|---|
| When did James depart for Canada? | November 4, 2022 | July 11, 2022 |
| When did James start Civilization VI? | April 27, 2022 | March 2022 |
| When did James meet Samantha? | September 3, 2022 | August 9, 2022 |
| How long had John played drums as of March 27? | a few days | One month |

The Canada question already has **D16:9 ranked first**, containing “leaving the day after tomorrow evening.” That expression is absent from the answer-head matcher. The reader proceeds to another candidate and accepts an unrelated offset. The Civilization window contains the relevant “for a month now,” followed by a different speaker’s “two days ago”; the latter supplies the wrong answer.

**Recommendation:** bind an accepted time expression to actor, event, source span, and anchor before doing calendar arithmetic. Support future offsets and elapsed-time statements only with that binding. Otherwise escalate. Treat the retrieved correct turn plus an incorrect retained answer as an answer-acceptance failure, not a retrieval failure.

## P1 — “Verified” ledger results still include unbound matches

**Sources:** `dual-searcher-pass3.mjs`, graph branches; `answer-head-pass3.mjs`, escalation gate.

Unknown pet owners no longer automatically default to John in the ownership branch. However, the adoption-name branch recognizes only James or John; any other name sets `askedSubject = null`, which removes the subject filter. I reproduced:

- Question: “What is the name of the puppy adopted by Mira?”
- Only stored adoption: James adopted Ned.
- Result: Ned, `verified: true`, escalation disabled.

The adoption-date branch still explicitly queries James/Ned. Residence inference still marks “Likely yes” as verified from place information. The router also preserves bypass behavior when `verified` is missing.

**Recommendation:** fail closed for unresolved subjects, bind all query arguments, and require actual proof checks before setting `verified`. Make verified facts, supported inferences, unresolved requests, and partial lists distinct outcomes. A Boolean attached after a heuristic match is not verification.

## P2 — Anaphora context disappears at the reranker boundary

**Source:** `jev-rerank.mjs`, line 32.

The index and distillation use the new contextual `text`, but the reranker still prefers `rawText`. My mock captured its actual input for a contextual job-start candidate:

> Candidate Fact: “Thank you! I'm starting next month.”

The preceding job-offer statement was absent. Thus the stage deciding which candidates survive can discard the context that made them relevant. Hydration happens after reranking.

I independently reproduced **D13:5 at BM25 rank #2**. The trace puts it first and answers “July 2022” at F1 0.8. That validates the example; it does not eliminate this boundary defect.

**Recommendation:** use a shared context formatter for indexing, distillation, reranking, and the answer prompt. Preserve the current turn as a guaranteed segment when cropping: distillation’s first-380-character truncation can otherwise contain only a long preceding turn. Include explicit IDs and speakers for both turns, and test long antecedents and ambiguous speaker changes.

## P2 — Date-hook candidates can be discarded before evaluation

**Sources:** `temporal-date-hook.mjs`, line 130; `dual-searcher-pass3.mjs`, line 325; `jev-rerank.mjs`, line 24.

The date hook appends candidates after the 15/25 hybrid hits. The reranker then keeps only the first 10/15 candidates. Unless deduplication has substantially shortened the list, injected candidates never reach Jev.

A local mock with 15 distinct hybrid hits plus a relevant date-matched drums turn sent exactly ten original candidates to the reranker and omitted the injected turn.

**Recommendation:** merge and budget the candidate pool before reranking, reserving bounded slots for date supplementation or selecting across the combined pool. Normalize hook scores: raw keyword counts currently enter the same fusion path as normalized hybrid scores. Add an integration test proving that an injected candidate reaches reranking and can survive selection; the date-parser unit test is insufficient.

## P1 — Monolithic response failures are accepted silently

**Source:** `system2-batch-resolver.mjs`, response parsing, lines 149–179.

The resolver ignores `finish_reason`, accepts any object status other than `insufficient`, accepts bare strings, and marks a response successful even when requested IDs are absent. A local mocked response with `finish_reason: length`, one `status: error` answer, and a missing second ID produced the error answer as a valid result after **one call**, without retrying the missing item.

This existed as a contract weakness before; placing 121 items in one response increases its impact. Omitting `max_tokens` delegates the ceiling to the provider—it does not remove context or output limits. The source already acknowledges provider-specific limits, but does not enforce a measured budget or handle truncation explicitly.

**Recommendation:** accept exactly `status: answered` with a valid string, track every requested ID, and record insufficient, missing, malformed, refused, and truncated outcomes separately. Retry only unresolved items or split on measured limits. Persist finish reason, token usage, response status, and elapsed time. Preserve configurable provider limits rather than replacing them with another arbitrary fixed cap.

The main trace records route reasons only for successfully resolved items. It contains 117 resolved answers out of 121 queued, but cannot distinguish the four remaining outcomes. The cited 66.33s System-2 duration is printed by the runner rather than saved in its trace metadata, so this review could verify the 148.41s total artifact value, not independently reconstruct the substage timing.

## Further interpretation and reproducibility notes

- Strict Recall@3 and explicit distillation abstention are real improvements since Pass 8. `none` no longer forces the top raw turn. The original summary remains eligible; label that fallback distinctly and retain its provenance rather than implying every answer has raw-turn grounding.
- Laya’s **coprocessor** is local. Its reported final F1 also includes cloud System-2: the trace shows 139 routed questions and 126 resolved responses. The Laya-versus-Jev comparison also changes batching and retrieval, so it does not isolate local model reasoning quality.
- `query-expander.mjs` includes conversation-specific additions such as Samantha and “left IT job 3 years.” These are development-set rules, not general synonym expansion. Keep them visible as such, derive entity aliases from memory when appropriate, and evaluate a held-out conversation before making generalization claims.
- The Pass 10 baseline now reads the windowed index, so it is a changed baseline, not the original frozen regex/BM25 arm. Label it accordingly.
- Saved aggregate scores are reproducible; a fresh run additionally needs model/provider versions, prompts, cache hashes, window policy, and actual request/response telemetry. The embeddings cache should record the text and model revision it represents. Initialization remains outside the reported question-loop timer.

## Recommended next pass

First repair temporal acceptance, graph argument binding, and response validation. Then preserve anaphora context through reranking and make date supplementation survive pool budgeting. Add focused regression cases for the reproduced defects.

Freeze the resulting evidence packets and compare independent requests with joint batches under identical conditions. Report answer quality alongside retained System-1 error rate, escalation outcomes, per-question evidence coverage, shared evidence budget, time to answer, and batch throughput. Preserve the current 74.23% trace as the joint-batch development result rather than overwriting it during ablations.

## Audit basis

Sources are the reviewed commit’s Pass 8, Pass 9 Jev, Pass 9 Laya, and Pass 10 traces; Pass 10 report and brief; the benchmark index, dual searcher, answer head, reranker, date hook, query expander, System-2 resolver, runner, isolated batch experiment, and parity tests.

Independent scoring used the previously retained upstream Python normalization, stemming, category handling, and F1 functions, source SHA-256 `51b663d5d4e26562ea0b4b763a171f98356e10cf937326a0322a01207ad1bc75`. This validates saved-prediction scoring, not a new cloud execution or provider timing measurement.
