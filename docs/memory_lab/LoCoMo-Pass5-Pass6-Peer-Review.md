# LoCoMo Pass 5 / Pass 6 peer review

**Date:** 2026-09-21
**Repository:** `dasilva333/airi`
**Reviewed commits:** `620b33938e` and `3d19ed06e9ff7a8426a2ed704b1fa5dd33d71670`
**Scope:** Read-only review of implementation, saved traces, tests, and the proposed Pass 7 priorities. No cloud benchmark rerun or repository code changes.

**Verdict:** The **49.13% upstream F1 result is reproducible from the saved Pass 6 answers**. The previous scoring, gold-category routing, and generated-claim indexing defects are repaired for the audited benchmark. The next priority should be preserving and binding the evidence already retrieved: the reader and System-2 consume different candidate sets, most System-2 evidence is truncated, and temporal extraction still selects unrelated expressions. Two proposed Pass 7 fixes are based on incorrect diagnoses.

**Verified results**

| Metric | Pass 5 | Pass 6 |
| :--- | ---: | ---: |
| Upstream overall F1 | 44.2705% | **49.1323%** |
| C1 | 37.1739% | **45.8829%** |
| C2 | 49.5926% | **50.5819%** |
| C3 | 40.1656% | **43.6077%** |
| C4 | 44.4433% | **50.1867%** |
| Saved pre-System-2 predictions, overall F1 | 31.2984% | 28.6643% |
| Questions eligible for System-2 | 52/150 | **63/150** |
| Accepted System-2 answers | 39 | **52** |
| Final answers with F1 below 0.5 | 86 | **76** |
| Recorded timed-loop duration | 215.85 seconds | 184.85 seconds |

Every saved per-question upstream F1 value matches independent execution of the [Snap Research evaluator](https://github.com/snap-research/locomo/blob/main/task_eval/evaluation.py). The custom stemmer also matches NLTK on all **1,240 unique normalized tokens** in the audited Pass 6 gold/baseline/Pass 1/Pass 6 answer vocabulary. This does not prove equivalence on every possible input: the repository still gives empty/empty F1 = 1 where upstream gives 0, although that edge does not affect these results.

Pass 6 improves by **4.86 percentage points** over Pass 5. Its architecture now escalates **42% of questions**, so characterize it as a selective cloud-assisted reader rather than carrying forward the earlier approximately 91% System-1-only claim. The lower pre-System-2 score includes abstentions scored as zero; it is not, by itself, proof that accepted System-1 answers became less accurate. Measure accepted-answer accuracy and coverage separately.

**Status of the previous findings**

| Finding | Verification |
| :--- | :--- |
| Category-specific scorer and stemmer | Fixed for all audited saved predictions; small empty-answer parity edge remains |
| Gold category in escalation | Removed from production routing; gold fields are used for subset selection and evaluation |
| Reader `none` swallowed by paragraph fallback | Explicit abstention now returns `UNKNOWN`; reproduced locally |
| Fresh claim indexes contain `null` | Fixed; generated-ID ownership query succeeds before hydration |
| Cross-sentence candidate `York Boston` | Fixed by sentence isolation and substring checks |
| Italy `last year` | Fixed; Q13 returns `In 2021` |
| All evidence is verbatim dialogue | Partial: scalar raw-turn references hydrate, but summaries and array-valued references still retain derived text |
| Generic graph binding and event joins | Still incomplete |

**1. P1 — The new retrieval breadth is lost between selection and answer generation.**

[dual-searcher-pass3.mjs](sandbox:/workspace/scratch/6f068d2a23fd/airi-review/scripts/tests/locomo-benchmark/dual-searcher-pass3.mjs) applies session diversity to `candidateObjects`, but returns `textCandidates: rankedHits.slice(0, effectiveLimit)` to the answer head. Those are separate lists. [answer-head-pass3.mjs](sandbox:/workspace/scratch/6f068d2a23fd/airi-review/scripts/tests/locomo-benchmark/answer-head-pass3.mjs) then reads only the first two text candidates for span selection.

A controlled six-session case selected `D1:10, D2:10, …, D6:10` for System-2 while returning six session-1 turns to the reader. If that reader accepts one plausible span, a list question need not escalate, and the diversity work is unused.

When escalation does occur, [system2-batch-resolver.mjs](sandbox:/workspace/scratch/6f068d2a23fd/airi-review/scripts/tests/locomo-benchmark/system2-batch-resolver.mjs) concatenates evidence and keeps only its first **800 characters**. Reconstructing the payloads from stored selections and current hydration logic shows **57/63 eligible questions exceed this limit**. At Q34, the six selected candidates produce 3,201 characters; only the first window is fully visible, the second is partially visible, and the remaining four are absent. The visible prefix emphasizes Italy, Turkey, and Mexico, matching the wrong answer.

The hydrated `timestamp` and source ID fields are also discarded when the runner serializes only candidate text. System-2 receives speaker labels but generally lacks the dates needed to resolve relative expressions.

**Fix:** Create one explicit evidence bundle shared by both readers. Retain per-turn IDs, speakers, session dates, and raw text. Merge overlapping windows; allocate the token budget across selected sessions instead of cutting off the tail. Log the actual evidence sent to each model. Use a collection operation for list requests even when the scalar reader finds one valid item.

**2. P1 — Temporal extraction still chooses the first expression rather than the requested event's time.**

The temporal subtype split correctly prevents several subordinate-`when` errors. It does not bind the extracted duration/date to the requested subject and event. Broader windows increase exposure to irrelevant expressions.

Q62 is a direct example: the requested relationship duration is answered with **“a few days”**, which comes from “it's been a few days since we talked” in another retrieved turn. That measures a conversation gap, not the relationship. The duration regex suggested for Pass 7 is already present and is the mechanism selecting this wrong phrase.

Controlled tests reproduced both failure forms:

| Evidence | Question | Current output |
| :--- | :--- | :--- |
| Tomas visited Berlin last year; Mira visited Rome yesterday | When did Mira visit Rome? | `In 2021` |
| Tomas's holiday lasted three days; Mira's course lasted six months | How long did Mira attend the course? | `three days` |

There is also an inconsistent triage fallback: `category === 2 && temporalSubtype !== 'duration'` enables calendar extraction even when the explicit subtype is `none`. A synthetic C2/none input asking what Mira studied returned `in 2020` instead of a subject. The brief's claim that `none` always bypasses date formatting is therefore false.

**Fix:** Treat `none` as an explicit decision, with fallback only for an absent subtype. Select evidence for the target event and actor before parsing a time expression. Preserve the expression's owning turn and anchor. For intervals, resolve compatible start/end events; do not substitute a session date or an unrelated duration. Invalid answer types should cause abstention and escalation. Q12 still demonstrates this need: a yes/no relationship question receives `September 2022` and never escalates.

**3. P1 — Verbatim hydration is incomplete and happens after relevance grading.**

The new helper returns summary text unchanged when `doc.kind !== 'raw'`. Array-valued `refDiaId` is used directly as a Map key, so it fails to resolve the underlying raw documents and leaves the original observation in place. **55/150 stored selections include at least one summary or array-valued reference**; array examples occur at Q60, Q74, Q130, and Q141.

Additionally, Jev reranks candidates before the hydration loop. Thus synthetic observation claims can still influence which evidence survives, even when the downstream text is eventually replaced. Scalar hydration fixes the previously reported Among Us input problem for that source; it does not eliminate synthetic assertions throughout the pipeline.

**Fix:** Normalize references to `sourceTurnIds: string[]` before deduplication and lookup. Hydrate proof-bearing raw turns before final relevance grading. Keep summaries as explicitly marked retrieval aids; resolve their supporting turns before relying on their personal-fact assertions. Do not silently call summary content verbatim dialogue.

**4. P2 — The published test command can report success without running the eleven tests.**

[evaluator-parity.test.mjs](sandbox:/workspace/scratch/6f068d2a23fd/airi-review/scripts/tests/locomo-benchmark/evaluator-parity.test.mjs) imports `describe` and `it` from **Vitest**, while the handoff instructs reviewers to run `node --test`.

In the isolated checkout, the documented command initially fails because dependencies are not installed. After resolving Vitest 4.0.18 and date-fns 4.1.0 from isolated audit dependencies, `node --test` exits green with **one file test and zero suites**. It does not execute the eleven Vitest cases. Running the actual Vitest runner with the test explicitly included executes **11/11 passing tests**.

Either import the Node test API for the documented command or document/configure a real Vitest invocation. Declare the harness's dependencies, including date-fns, instead of relying on another workspace package's installation.

The label-blind test is also weaker than its description: it tests a locally copied `route()` function and passes gold labels to an unused parameter. It does not import the production router or observe inference requests. The production code is currently fixed, but this test would still pass if gold-label routing were reintroduced there. Extract and test the production decision, then compare recorded requests under perturbed gold metadata.

**5. P2 — The System-2 output contract is still only partially validated.**

Requested-ID validation is now present and closes the earlier cross-chunk overwrite problem. However, the resolver accepts any object whose status is not literally `insufficient`. A mocked response with `{status: 'error', answer: 'accepted invalid status'}` was accepted. Bare strings remain accepted despite the typed contract, and `usedGeneralKnowledge` is not checked or retained. Requests still have no deadline.

Require `status === 'answered'`, validate every field, preserve unresolved/error reasons, and bound the request duration. Retain route reasons for all queued items, not only successful replacements. A result marked `insufficient` should remain distinguishable from malformed output, timeout, or a missing response.

The blanket 1–4-word constraint also conflicts with complete lists, explanations, and qualified conclusions. Use an explicit answer kind: count, duration, date, entity, list, boolean, or explanation. Durations should retain units; lists should retain all supported members; boolean uncertainty should not automatically become a categorical yes/no.

**6. P2 — Evidence recall no longer describes a fixed top-three budget or the evidence actually read.**

Pass 6 stores three selected centers for 131 questions and six for 19 questions, yet the report still labels its aggregate `Evidence Recall@3`. Each center can expand to three raw turns, but only center references are counted. Array-valued references are still missed by the scorer.

The stored count is **112/203**. Flattening selected references yields **113/203**. Expanding the selected raw windows yields **129/203 before reader-specific selection and character truncation**. That last number is a source-presence diagnostic, not measured recall of model-visible evidence. Additional selected centers beyond the first three do not add annotated hits in this trace, although they may still add useful unannotated facts or summary content.

Record separate measures for seed Recall@3, selected-source recall, model-visible-source recall, and complete support. Keep one turn-ID provenance list for every window and preserve truncation boundaries. This is necessary to distinguish retrieval failures from evidence that was retrieved and subsequently omitted.

**Correct the Pass 7 roadmap before implementing it**

**Q20: format counts in the answer renderer; preserve the official evaluator.** The saved `2` versus reference `two` mismatch is real. A consistent count-formatting policy can emit English words for small counts. Apply that policy only to typed count answers, not dates, IDs, measurements, or all digit tokens. Do not modify canonical F1 normalization and continue calling the result official upstream F1. A supplementary number-aware metric can be reported separately.

**Q31: the handoff's quoted duration does not exist in the raw evidence.** Session 16 is dated July 9, 2022. D16:9 says James is leaving **“the day after tomorrow evening”**; D16:13 says **“I plan to return on July 20”**. That supports July 11–20, approximately nine elapsed calendar days or ten inclusive dates under those conventions. Neither source says “stay for 19 days.” The added unit test supplies an invented 19-day sentence under the real turn ID D16:13, so it verifies a synthetic regex case rather than the canonical scenario.

Flag the reference `19 days` as disputed and preserve it in the official benchmark. Add a separate annotation audit and use actual source text for the canonical regression. The current prediction `9` is numerically consistent with one interpretation, but its System-2 evidence lacks the session-date anchor, so the output alone does not establish correct grounded reasoning. Test the full anchored calculation and render units.

**Q34: constrain event time, not exclusively the session's reporting date.** First repair the truncated six-session bundle. Then retrieve the July travel episode and its locations, resolve geographic entities, and filter facts by the episode's event-time interval. Hard-filtering on session date can discard a later recollection of a July trip and admit an older trip merely discussed in July. Session dates are useful anchors and retrieval priors, not interchangeable with event dates.

**Generic ledger behavior remains an open item.** Adoption-name lookup still takes the first adoption claim without binding the requested person. The favorite-game formatter now uses supplied claims, which is an improvement, but the searcher's fixed people/pet/place logic and ingestion defaults remain. The current event cache still lacks the general occurrence model needed for reliable counts and durations. Those earlier findings should remain open rather than disappear from the remediation checklist.

**Recommended next checkpoint**

1. Unify the selected evidence bundle, normalize references, merge overlapping windows, and preserve dates/source IDs through model input construction.
2. Replace blind 800-character truncation with per-source allocation; then replay the same saved questions to isolate the evidence-delivery change.
3. Bind temporal expressions to events and implement answer-type validation. Add real Q31/Q62 fixtures alongside synthetic actor/duration counterexamples.
4. Make collection explicit, including complete list formatting and distinct-event counting. Preserve canonical scoring and report annotation disputes separately.
5. Repair the test entry point and exercise production routing directly. Log all escalation outcomes, actual prompts, selected spans, model versions, and stage latency/usage.

Avoid attributing the whole 4.86-point gain to one mechanism: Pass 6 changes triage, retrieval breadth, windows, and prompts simultaneously. Frozen-input ablations and a held-out conversation are needed to establish which changes generalize.

**Verification limits and documentation corrections**

I independently rescored both traces, compared the answer-vocabulary stems, ran all eleven tests under Vitest, and exercised local contracts with mocked model responses. Reconstruction of System-2 evidence used the saved candidate references and committed hydration/serialization logic; actual request bodies are not saved in the trace. No live Jev or DeepSeek calls were made. Repository working tree is clean.

The recorded 184.85 seconds is a timed warm query loop, excluding initialization and ledger preparation; it is not newly measured interactive latency. The handoff's Pass 4 comparison cells also need correction or a cited alternate artifact: the committed Pass 4 trace records **127.06 seconds and 35.94% repository BLEU-1**, not approximately 230 seconds and 37.80%. Its historical 41.89% corrected upstream F1 comes from rescoring; the old trace still stores the earlier incorrect upstream aggregate.
