# LoCoMo Pass 3 Jev Architecture — Peer Review

Reviewed 2026-09-21 against [`911529e2cb0561b5c49137b26f352e33140c8d81`](https://github.com/dasilva333/airi/commit/911529e2cb0561b5c49137b26f352e33140c8d81), including implementation commit `561afd23e4`. Scope: `conv-47`, 31 sessions, 689 actual turns, 150 non-adversarial questions.

**Recommendation: retain batched reranking and the indexed-ledger direction, but fix the existing data and execution contracts before expanding the temporal graph.** The retrieval improvement is reproducible from the saved trace. The stronger claims about general graph reasoning, Needle answer synthesis, canonical scores, and complete runtime are not established by this implementation.

The next useful pass is: correct source dates and persistence; replace benchmark-specific graph bindings; hydrate raw evidence; add a validated span reader; then introduce bounded temporal joins. There is no evidence that closing the immediate gaps requires a ten-query generative planner.

**What was verified**

The review checked the pinned source, architecture document, genealogy, timing audit, Run 16 analysis, cached ledger, embeddings, and Pass 1–3 traces. It reproduced all 900 stored F1/BLEU values and all 450 evidence-recall records across the three arms of the Pass 3 trace. It also reconstructed the deterministic candidate pools, replayed answer formatting without Needle, exercised the reranker with controlled responses, checked ledger serialization, and rescored predictions with the upstream LoCoMo scoring functions. No cloud inference, benchmark output replacement, repository code modification, commit, or push was performed.

All question numbers below are **zero-based trace indices**. Model recommendations and new architectures are proposals; their quality and latency have not been measured here.

**The most consequential findings, in implementation order**

1. **P1 — Source dates are wrong throughout the cached ledger.** Ingestion reads `locomoDataset[session_date_time]`, but the dates live under `locomoDataset.conversation`. Its fallback assigns April 12, 2022 to every source. Consequently, 673 of the 689 real turns have the wrong calendar date. The session-key filter also accepts date strings as sessions, iterates their characters, and creates an extra source with no turn ID. The cache contains 690 sources, all with the same timestamp. Fix the dataset adapter, require array-valued session records, explicitly parse LoCoMo timestamps, and invalidate this cache. Do not silently substitute a valid-looking date when parsing fails. [Ingestion, lines 37–76](https://github.com/dasilva333/airi/blob/911529e2cb0561b5c49137b26f352e33140c8d81/scripts/tests/locomo-benchmark/ledger-ingest.mjs#L37)

2. **P1 — The ledger does not yet ingest general claims or persist events.** Its cache contains 315 entities and only 17 claims: 15 pet claims and two manually added game preferences. Only the two Ned adoption/ownership claims carry dates. Ingestion records the count of Needle claims but never inserts those claims; its actual claim creation is a set of pet-name rules. Hydrated `events`, `mentions`, and `byEvent` are empty. `toJSON()` omits events and mention records, and `fromJSON()` regenerates claim IDs. A controlled event round-trip loses the event. Persist stable IDs, event records, source spans, claim qualifiers, and temporal relations before relying on them in timeline queries. [Claim binding](https://github.com/dasilva333/airi/blob/911529e2cb0561b5c49137b26f352e33140c8d81/scripts/tests/locomo-benchmark/ledger-ingest.mjs#L129), [serialization](https://github.com/dasilva333/airi/blob/911529e2cb0561b5c49137b26f352e33140c8d81/scripts/tests/locomo-benchmark/entity-ledger.mjs#L217)

3. **P1 — Jev triage is currently observational, and the claimed 70/30 rerank fusion is not active.** `DualSearcherPass3.search()` never reads its `triage` argument. Hybrid search always uses its default 0.68/0.32 weights. Hybrid candidates expose `fusedScore`; the reranker reads `cand.score`, so all candidates receive `originalScore = 0.5`. The effective score is `0.7 × relevance/3 + 0.15`, meaning Jev relevance determines ordering, with original order retained for ties. Controlled equal-relevance responses confirmed this. Wire the intended retrieval score explicitly, but compare pure Jev ranking against corrected fusion before assuming fusion helps. Fold useful query classification into the same request as reranking, or remove the unused triage request. [Searcher](https://github.com/dasilva333/airi/blob/911529e2cb0561b5c49137b26f352e33140c8d81/scripts/tests/locomo-benchmark/dual-searcher-pass3.mjs#L33), [fusion](https://github.com/dasilva333/airi/blob/911529e2cb0561b5c49137b26f352e33140c8d81/scripts/tests/locomo-benchmark/jev-rerank.mjs#L49)

4. **P1 — Several headline graph successes are benchmark-specific rules.** The runner explicitly inserts the two favorite-game claims, and the answer head returns their full answer as a string literal. Ingestion defaults any adoption mention to Ned and binds ownership using Max/Daisy names. The place enrichment path explicitly processes Stamford and contains geographic defaults; the residence route returns `Likely yes` without checking the person or a residence relation. These facts may be true in the conversation, but manually binding them does not demonstrate general extraction or deduction. The five perfect answers at indices 6–10 are reproducible; they do not validate the broad architectural claim. [Runner enrichment](https://github.com/dasilva333/airi/blob/911529e2cb0561b5c49137b26f352e33140c8d81/scripts/tests/locomo-benchmark/locomo-runner-pass3-jev.mjs#L87), [answer literals](https://github.com/dasilva333/airi/blob/911529e2cb0561b5c49137b26f352e33140c8d81/scripts/tests/locomo-benchmark/answer-head-pass3.mjs#L41)

   The same rules produce observable errors: index 63 asks about a November road trip but receives Ned’s April adoption date because `get` matches inside `together`; index 79 asks for the adopted puppy’s name but receives all three dog names. A controlled question about John living in Connecticut also receives `Likely yes`. Replace substring dispatch with a grounded query specification containing the subject, relation/event, requested field, cardinality, and time constraint. Reject a graph answer when that specification does not match its proof. The “zero regex shortcuts” description should also be corrected: temporal and health-answer regexes remain active in the answer head.

   The place tree is a bounded classifier, not a complete geographic resolver. Europe and the broad other-world branch do not resolve countries; multiple subdivisions are unsupported, and name-only classification cannot disambiguate similarly named places. Preserve unresolved outcomes and contextual candidate identities, and store geographic knowledge separately from claims about a person’s residence. The saved enriched ledger contains only one place with resolved attributes: Stamford. [Place resolver](https://github.com/dasilva333/airi/blob/911529e2cb0561b5c49137b26f352e33140c8d81/scripts/tests/locomo-benchmark/place-resolver.mjs)

5. **P1 — Needle’s answer contract is mismatched, and no answer improvement is attributable to it in this trace.** The same engine remains initialized with the ingestion tool. The answer path asks for a short free-text answer, and `NeedleNode.complete()` preferentially returns `parsed.reasoning`, rather than validated tool arguments. The head sees only 200 characters of the first candidate. Using the saved candidate order, all 150 predictions are reproduced exactly by the answer head with Needle disabled: 135 are complete candidate texts, seven are date-heuristic outputs, and eight are graph outputs. This does not prove the model never ran; it establishes that its fallback adds no distinguishable answer benefit in these artifacts. [Wrapper](https://github.com/dasilva333/airi/blob/911529e2cb0561b5c49137b26f352e33140c8d81/scripts/tests/locomo-benchmark/needle-node.mjs#L128), [answer path](https://github.com/dasilva333/airi/blob/911529e2cb0561b5c49137b26f352e33140c8d81/scripts/tests/locomo-benchmark/answer-head-pass3.mjs#L59)

6. **P1 — Reported token F1 is a custom metric, not the upstream LoCoMo metric.** The harness omits stemming and category-specific evaluation, handles punctuation differently, and keeps `and` as a scored token. Its BLEU-1 also counts repeated matches against a set instead of clipping by reference frequency: `dog dog dog` against `dog` scores 1.0. Preserve these old numbers under a legacy label, then report upstream F1 for every arm. The published C1 record should remain provisional until historical predictions are rescored identically. [Local metrics](https://github.com/dasilva333/airi/blob/911529e2cb0561b5c49137b26f352e33140c8d81/scripts/tests/locomo-benchmark/locomo-metrics.mjs), [upstream evaluator](https://github.com/snap-research/locomo/blob/main/task_eval/evaluation.py)

7. **P2 — Evidence IDs, model input, and answer support are not consistently the same objects.** Geographic `entity.mentions` becomes a `Set` on hydration. The searcher accepts evidence only when it is an array, so geographic proof injection is skipped and the trace serializes its evidence as `{}`. Separately, observation references can be arrays: two saved top-three lists contain nested source arrays, and one repeats a source already covered by another candidate. Use `sourceTurnIds: string[]` everywhere, with explicit document IDs and source IDs. Record both retrieved evidence and the evidence actually used to answer. [Hydration](https://github.com/dasilva333/airi/blob/911529e2cb0561b5c49137b26f352e33140c8d81/scripts/tests/locomo-benchmark/entity-ledger.mjs#L240), [geographic proof and merging](https://github.com/dasilva333/airi/blob/911529e2cb0561b5c49137b26f352e33140c8d81/scripts/tests/locomo-benchmark/dual-searcher-pass3.mjs#L73)

8. **P2 — Runtime and reproducibility need narrower labels.** The 128.37-second timer starts after model initialization, cached ledger loading/enrichment, index construction, and embedding loading. It includes the baseline BM25 loop and Pass 3 inference while importing Pass 1 answers from the Pass 2 trace. Call it the saved warm evaluation-loop duration. The client has no deadline or retry policy, and the trace omits the resolved Jev version, usage, per-stage timings, full candidate scores, and Needle responses. Pin or record the resolved model, hash inputs/caches, and preserve stage traces before attributing gains to particular components. [Timer boundary](https://github.com/dasilva333/airi/blob/911529e2cb0561b5c49137b26f352e33140c8d81/scripts/tests/locomo-benchmark/locomo-runner-pass3-jev.mjs#L122), [HTTP client](https://github.com/dasilva333/airi/blob/911529e2cb0561b5c49137b26f352e33140c8d81/scripts/tests/locomo-benchmark/jev-client.mjs)

**Verified score interpretation**

| Metric | Saved custom scorer | Upstream LoCoMo scorer applied to the same predictions |
|---|---:|---:|
| Baseline overall F1 | 6.63% | 6.43% |
| Pass 1 comparison-arm overall F1 | 8.29% | 8.71% |
| Pass 3 overall F1 | 18.95% | 18.51% |
| Pass 3 C1 F1 | 30.05% | 24.63% |
| Pass 3 C2 F1 | 8.16% | 8.02% |
| Pass 3 C3 F1 | 19.62% | 19.51% |
| Pass 3 C4 F1 | 20.59% | 21.17% |

The rescore executes the upstream normalization, Porter stemming, per-gold-item C1 calculation, and C3 answer-prefix handling. It does not estimate historical Run 07/11/16 results. Those historical predictions were not available under the indexed `test_results/` paths at this commit.

The changed Pass 1 comparison numbers are also explainable: this runner imports the Pass 1 arm from the Pass 2 trace, whose answer policy uses candidate `text`. It is not the original Pass 1 shootout’s answer policy. The architecture should identify that comparison as a rerun/variant, rather than treating 8.29% and the earlier 9.68% as interchangeable.

| Pass 3 category | Questions | Gold evidence hits / references | Questions with any hit @3 | Questions with all references @3 |
|---|---:|---:|---:|---:|
| C1 | 20 | 24 / 57 | 15 | 3 |
| C2 | 34 | 22 / 42 | 21 | 18 |
| C3 | 13 | 8 / 16 | 8 | 5 |
| C4 | 83 | 62 / 88 | 62 | 57 |
| Total | 150 | 116 / 203 = 57.14% | 106 | 83 |

This 57.14% is micro recall over gold evidence references. Question-macro recall is 63.00%; any-hit rate is 70.67%. It is not an answer-accuracy measure. The current three slots are candidate slots, occasionally representing multiple source turns. C2 retrieval actually falls from Pass 1’s 24/42 to 22/42 despite the aggregate gain.

Deterministic replay gives 84/203 hits for default hybrid top three, 86/203 after source-key deduplication, and 92/203 after adding the current graph rules without Jev. The saved complete pipeline reaches 116/203. This supports keeping reranking, while its precise contribution still needs saved relevance scores and matched ablations. The reconstructed ten-candidate text pool contains 119/203 references; its C2 portion contains 27/42. Both candidate selection and temporal reading remain bottlenecks.

The two geographic questions contribute 15.38 percentage points to the 19.62% custom C3 score. The remaining 11 C3 questions average 5.01%. Treat the geography success as a useful narrow case rather than evidence that broad open-domain reasoning is solved.

The timing addendum is the more accurate historical framing. The committed audit records Run 07 at **78.93 minutes**, Run 09 at **79.57 minutes**, and Run 16 at **186.48 minutes**. The genealogy’s 18 minutes is an added cost, not Run 07’s total. The saved original Pass 1 trace reports **560.67 seconds**, and the Pass 2 trace reports **376.05 seconds**. These timer boundaries differ, so they do not establish a clean end-to-end speedup ratio. [Timing audit](https://github.com/dasilva333/airi/blob/911529e2cb0561b5c49137b26f352e33140c8d81/docs/memory_lab/run-timing-audit.md), [genealogy](https://github.com/dasilva333/airi/blob/911529e2cb0561b5c49137b26f352e33140c8d81/docs/memory_lab/benchmark_history_and_outlook.md)

**Answer to Question 1 — Close the temporal gap with source hydration and bounded event joins**

Start with errors that already have useful retrieved evidence. The index retains correct session timestamp strings; ingestion corrupts them, and answer construction does not use them. Hydrate every selected observation to its original raw turn before extracting temporal information. Add a small neighboring-turn window only where the event or its subject is incomplete. Keep the observation as a retrieval aid, with the raw source as the proof. Also preserve structured state in `TypeSafeJevClient`: when given an object containing `target_turn.text`, it currently sends only that text, dropping surrounding metadata and context.

| Existing trace case | Information already reachable | Required operation |
|---|---|---|
| Italy visit, index 13 | Raw D6:12 says a prior year; session date is April 20, 2022 | Resolve to year 2021; the retrieved observation omitted the time phrase |
| Adventure-book purchase, index 14 | D8:11 has a three-day offset; session date is April 29 | Subtract calendar days → April 26, 2022 |
| New job, index 23 | D13:5 supplies the relative month; D13:3 supplies the job | Bind the same job episode; preserve a planned July 2022 start |
| Beach outing, index 42 | Raw D19:12 has a one-day offset; its observation omits it | Resolve → August 9, 2022 |
| Cooking class, index 50 | D23:13 is second in the candidate list and contains the start offset | Read beyond top one → September 2, 2022 |
| Cyberpunk, index 58 | D28:27 supplies yesterday relative to October 21 | Resolve → October 20; do not treat the title’s 2077 as an event year |
| Road trip, index 63 | D30:1 is already retrieved | Match the road-trip event, then resolve → November 4, 2022 |

These are correction examples, not a measured post-fix score. The current temporal resolver also needs next/last month and year, weekdays/weekends, durations, named full dates, and multiple expressions bound to separate events. Its named-month branch currently discards day precision. Use calendar arithmetic with an explicit locale/week policy; avoid subtracting milliseconds for civil months or days across time-zone transitions. Preserve unknown time zones rather than assigning the host machine’s zone. [Temporal resolver](https://github.com/dasilva333/airi/blob/911529e2cb0561b5c49137b26f352e33140c8d81/scripts/tests/locomo-benchmark/temporal-resolver.mjs)

For multi-session questions, compile a small executable query specification:

```json
{
  "operation": "duration",
  "subjectId": "resolved-person-id",
  "episodeId": "resolved-project-id",
  "startRole": "started",
  "endRole": "completed",
  "timeFilter": null,
  "answerPrecision": "month",
  "status": "resolved"
}
```

The IDs must come from actual mention/entity resolution. Permit unresolved fields; never default an absent subject or object to James or Ned. Separate `operation` from `timeFilter`: several LoCoMo C2 questions ask for an activity, location, or feeling at a date, rather than asking for a date.

Execute an indexed join for the requested person and episode, select candidate start/end observations, verify that they refer to the same episode and compatible modalities, and compute the result in code. For missing operands, issue **one bounded parallel retrieval round** for the missing roles, then batch relevance and event-identity judgments. Stop after that round or return uncertainty. There is no need for an unconstrained ten-query plan.

Recommended initial budgets, to validate on development conversations: at most 12 event candidates per operand, two expansion queries, and two Jev requests on a temporal question needing recovery. These are controls on work, not latency promises. Use direct indexed lookups and a cached result for questions whose proof is already complete.

Jev can classify operation, requested answer type, candidate relevance, and proposed event links in one request when all inputs are available. Decisions within that request are independent; a question cannot depend on another question’s answer from the same batch. Generate bounded alternatives before calling, then combine the returned judgments in code. This matches the documented [speculative fan-out pattern](https://docs.typesafe.ai/patterns/fan-out).

**Answer to Question 2 — Use a validated span reader over all three raw candidates**

My first implementation choice is **Needle span proposals plus Jev selection in the existing rerank batch**, with deterministic graph formatting for fully grounded claims. If Needle cannot supply sufficient answer-bearing spans on held-out dialogue, use a dedicated extractive QA model as the proposal source. A larger generative SLM should be a later comparison.

The trace supports reading more than the first candidate: C4 has a gold hit in the first candidate on 45/83 questions and anywhere in the top three on 62/83. Eighty-one C4 predictions are complete candidate texts. Median normalized answer length is 16 tokens versus three gold tokens. Most first candidates are generated observations, not raw turns.

A gold-assisted diagnostic searched all contiguous whitespace-delimited spans in the raw turns referenced by saved candidates. Under upstream scoring, the best span from the first candidate averages **54.25% C4 F1**; the best span from the first three averages **74.35%**, with perfect spans on 42/83 questions. This is an **oracle ceiling for that defined span search**, not a trained reader result, and it excludes summary text and neighbor expansion. It shows why trimming top one alone is an unnecessarily restrictive design.

Use this contract:

1. Resolve observation references into raw source turns, carrying speaker, session date, and source IDs. Use a bounded neighboring context for pronouns or short replies.
2. Ask a dedicated Needle extraction tool for zero or more proposed spans. Reset or isolate its toolset from ingestion. Keep the prompt and passages within the model’s effective context budget.
3. Validate each quote against the exact source. Resolve character offsets in the host; if repeated text makes the location ambiguous, retain candidates until context disambiguates them. Use one defined offset convention, such as UTF-16 code units for JavaScript slicing.
4. Assign host-generated span IDs. Ask Jev to select an eligible span or `none`, checking the requested subject, relation, time constraint, and completeness. Where proposals are available before reranking, include this selection in the same HTTP request.
5. Return the host’s source slice, or a deterministic composition of grounded values. Keep provenance outside the benchmark answer string. If no validated answer exists, use a bounded fallback rather than emitting an entire irrelevant turn.

A compact proposal payload is sufficient:

```json
{
  "spans": [
    { "source_id": "candidate-source-id", "quote": "copied answer phrase" }
  ]
}
```

Generate the permitted `source_id` values from the actual supplied sources. Permit `spans: []`. A schema containing an arbitrary `answer: string` enforces JSON shape but does not enforce copying. Stronger copy constraints require a finite enum/trie of candidate spans or a pointer representation plus host validation. Choosing a span ID is generally easier to verify than asking a tiny model to count offsets.

Needle’s documented extraction interface consumes tool arguments, while `reasoning` is unconstrained; its model card also describes a 256-token sliding window. Those constraints explain why the existing general-answer prompt and reasoning-field return are poor contracts. [Needle model card](https://huggingface.co/Cactus-Compute/needle2)

Jev supplies typed choices and scores, not a free-form text extraction head. It can select a span when its text and identity are supplied as options; it cannot recover an omitted phrase from an undeclared answer space. Include an explicit none/unsupported option. Treat score as a probability-weighted rubric value, and calibrate decision thresholds on held-out data rather than interpreting confidence as guaranteed correctness. [API contract](https://docs.typesafe.ai/api), [confidence](https://docs.typesafe.ai/confidence)

| Option | Recommended role | Main limitation |
|---|---|---|
| Needle, separate extraction tool | First span-proposal experiment; reuses the existing local component | Proposal recall and short-context behavior must be measured |
| Jev choice/score | Select and validate declared spans alongside reranking | Cannot produce unseen span text; cloud dependency remains |
| `deepset/minilm-uncased-squad2` | Local start/end-span reader comparison | Requires a compatible runtime/export and dialogue-specific evaluation |
| Small generative SLM | Later answer synthesis for cases that genuinely require composition | Adds runtime and grounding work without fixing missing evidence |

The MiniLM candidate is explicitly trained for extractive QA on SQuAD 2.0; no LoCoMo performance or CPU latency is claimed here. [Model card](https://huggingface.co/deepset/minilm-uncased-squad2)

Do not impose one noun-phrase rule on every C4 question: some answers are actions or explanations. Predict answer type and preserve the shortest **complete supported answer**, including necessary modifiers and negation. Multi-value answers need multiple validated spans; inferred geography and normalized dates need structured derivations rather than literal copying.

**Answer to Question 3 — Separate episodes, occurrences, observations, and temporal constraints**

Keep the Maps and secondary indexes. A graph database adds little at this scale. Introduce stable records for distinct concepts instead of placing one mutable date on each event.

| Record | Purpose and essential fields |
|---|---|
| Source | `turnId`, text, speaker ID, session ID, parsed session date, original timestamp, ingestion sequence |
| Episode | An ongoing course, project, job, trip, or relationship; entity roles and identity evidence |
| Occurrence | A particular enrollment, class, milestone, departure, completion, or status transition; episode ID and role bindings |
| Observation/claim | What a source asserts about an occurrence or state; polarity, modality, evidence spans, recorded time |
| Temporal anchor | Raw phrase, source anchor, precision, possible-time bounds or explicit duration, resolver policy and ambiguity |
| Temporal relation | Typed relation between occurrence IDs, supporting claim IDs, origin, and verification status |
| State version | Subject, predicate, value, validity boundary references, boundary status, and supersession evidence |

**Precedence.** Store directed `before` edges, inverse `after`, and a small needed set such as `during`, `overlaps`, and `same_event`. Keep `same_event` identity judgments separate from temporal order. An explicit sentence, a deterministic interval implication, and a model guess must retain different origins. Only accepted relations participate in answer proofs. Reject cycles in strict precedence; contradictory evidence should remain visible as a conflict, not silently overwrite an edge. The distinction among instants, intervals, durations, and temporal relations follows the useful vocabulary of [OWL-Time](https://www.w3.org/TR/owl-time/), without requiring an RDF implementation.

**Uncertainty.** An event that happened sometime last week has a possible occurrence window; it did not necessarily last seven days. Store that window separately from an event’s duration and start/end boundaries. Distinguish before from meeting at an adjacent boundary. Derive definite ordering only when all permitted event times satisfy it. Overlapping uncertainty windows leave order unknown.

For uncertain point times `A ∈ [a₁,a₂]` and `B ∈ [b₁,b₂]`, the possible elapsed time is `[b₁−a₂, b₂−a₁]`, intersected with any explicit order constraints. Use calendar-aware units for month/year answers; do not quietly convert every month to 30 days. If an endpoint or episode link is missing, the duration remains unresolved.

**Recurring progress.** Represent a course as an episode and individual classes or progress reports as occurrences/observations. Link mentions using participant identity, course/project name, topic, organization, and explicit continuation cues. Jev can choose among a bounded set of episode candidates plus `new` and `unresolved`. Preserve ambiguous candidates rather than merging every mention of game development.

The brief’s Sessions 1/6/13 example particularly needs this discipline: those sessions contain John’s programming course, James’s childhood game project, James’s Witcher-inspired collaboration, and James’s later gaming/programming course. Shared vocabulary does not prove they form one course progression. Repeated reports of one milestone should merge as evidence; repeated classes or tournaments remain distinct occurrences.

**Validity.** Keep when a claim was reported separate from when it was true. A June report of a planned July job start has a June observation time and a planned July event window. It does not establish employment beginning in June, nor a completed transition in July. For a state record, use `valid_from` and `valid_until` as references to precise or uncertain boundaries, plus a status such as `unknown` or `open_as_last_observed` for an absent end. A null end must not mean known forever.

Close a state interval only with a supported transition and a relation-specific exclusivity rule. People can hold multiple jobs or own multiple pets. Later silence does not establish an end, and a later correction should supersede the prior interpretation while preserving its source and reporting history. Support both “what was true then?” and “what had been reported by then?” when the evaluation requires them.

Suggested indexes are `byEntityRole`, `byEpisode`, `byEventType`, `bySubjectPredicate`, `bySource`, and outgoing/incoming temporal relations. Small sorted arrays of interval bounds per episode are sufficient initially. Restrict joins to the relevant person and episode; avoid building every possible event pair. Serialize every record and rebuild indexes deterministically while preserving IDs.

**Evaluation safeguards that directly affect this next pass**

- Keep `conv-47` as a visible regression/development example. Tune schemas and thresholds on other conversations, then evaluate unseen conversations. Include renamed actors/pets/places, paraphrased questions, negative and planned events, and irrelevant mentions to expose the current name-specific rules.
- Preserve modality, negation, and source ownership through every extraction and merge. A source substring validates copying, not whether the resulting relation is entailed.
- Maintain separate raw-only and dataset-observation/summary-assisted experiments. The current text index includes supplied observations and session summaries, whose provenance and construction cost differ from Needle ingestion.
- Measure C1 complete-proof recall with a larger explicit evidence budget as well as Recall@3; some questions require more than three references. Answer support must include every claim used in a set or duration result, even when a separate retrieval metric uses three slots.
- Cache keys should include dataset/source hashes, schema and resolver versions, extraction model/assets, prompt definitions, and the resolved Jev model version. Fixing ingestion while accepting the old cache leaves the bug active.
- Log cold ingestion, model loading, embedding work, warm query latency, API calls/tokens, retries, timeouts, and p50/p95 separately. One HTTP batch supports parallel decisions; the saved trace does not independently establish a 350 ms backend forward pass. Jev’s alias can move and the service charges for input tokens, so Pass 1’s offline/$0 claim does not carry into Pass 3. [Jev models and pricing](https://docs.typesafe.ai/models)

Retain a visible annotation-error register. At this commit, gold evidence `D4:36` does not exist. The Canada duration question’s gold says 19 days, whereas its cited departure/return facts imply July 11 to July 20, 2022—nine elapsed calendar days, or ten dates counted inclusively. Another question says October 2023 while citing October 2022 dialogue. A correct temporal engine should expose such conflicts, not invent dates to match them. Report official scores unchanged alongside clearly labeled annotation-reviewed diagnostics; never silently alter gold data.

**A concrete next-pass sequence**

| Step | Change | Evidence required before advancing |
|---|---|---|
| 1 | Freeze upstream scoring and experiment manifests | Same saved predictions rescore identically; historical variants are labeled |
| 2 | Repair date adapter, cache invalidation, stable-ID persistence, source arrays | Exactly 689 sources with 31 session anchors; event/claim/provenance round-trips |
| 3 | Wire general claim binding and remove fixed answers/entity defaults | Perturbed-name and negation cases behave correctly; extraction yield and precision are reported |
| 4 | Hydrate source turns and compare answer readers on frozen retrieval | Answer-span proposal recall, supported F1, abstention rate, and added latency |
| 5 | Add event episodes, temporal anchors, and bounded missing-operand retrieval | Correct single-anchor dates first; then valid event links, durations, and as-of queries |
| 6 | Compare pure Jev vs corrected fusion and combined vs separate classification calls | Fixed pools, stored scores, paired quality/latency results on held-out conversations |

The present result supports investing in retrieval plus a concise, grounded reader. It does not justify promising Run 07 or Run 16 scores on the next execution. The highest-confidence gains come from correcting facts already present in the pipeline and making the answer head consume them faithfully.
