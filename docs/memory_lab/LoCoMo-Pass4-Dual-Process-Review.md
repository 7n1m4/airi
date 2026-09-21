# LoCoMo Pass 3.1 / Pass 4 peer review

**Reviewed:** 2026-09-21. Repository: `dasilva333/airi`. Commits: `c7474b7fa76d6f0ff0ba64ff722f19385de18ea9` and `be78caa52fe10c57481f630b503f04398691e754`. Comparison checkpoint: `911529e2cb0561b5c49137b26f352e33140c8d81`.

**Verdict:** The saved answers show substantial improvement, particularly after the timestamp repair and span reader. The claim that all five remediation steps are complete is premature. Correct upstream rescoring gives **41.89% overall F1**, and the Pass 4 inference path reads gold categories when deciding which questions receive System-2. Fix evaluation isolation, fresh-ledger indexing, and raw-evidence handling before treating this as a validated autonomous architecture or promoting the historical-record claims.

This was a read-only review. I inspected both commits, rescored saved predictions, reconstructed local retrieval candidates, and exercised critical functions with synthetic inputs and mocked model responses. I did not rerun cloud inference, measure fresh latency, alter benchmark artifacts, or change repository code. Question numbers below use the trace's zero-based `index`.

**Verified results**

I executed the upstream scoring functions unchanged, with NLTK's default Porter stemmer, against the saved predictions. Categories contain 20, 34, 13, and 83 questions respectively.

| Metric | Original Pass 3, corrected | Pass 3.1, corrected | Pass 4, corrected | Pass 4 reported as upstream |
| :--- | ---: | ---: | ---: | ---: |
| Overall F1 | 18.51% | 39.70% | **41.89%** | 43.93% |
| C1 multi-hop F1 | 24.63% | 27.68% | **28.43%** | 28.43% |
| C2 temporal F1 | 8.02% | 45.05% | **45.45%** | 50.73% |
| C3 open-domain F1 | 19.51% | 19.08% | **43.61%** | 46.06% |
| C4 literal F1 | 21.17% | 43.63% | **43.41%** | 44.55% |

The same evaluator gives **6.43%** for the saved baseline and **8.71%** for Pass 1, rather than 8.94% and 12.32%. Pass 4's legacy F1 **42.30%** and the repository's other stored aggregates reproduce under its own functions. The discrepancy is evaluator parity, not stale aggregate arithmetic.

These are corrected scores for the existing predictions, which were produced with gold-assisted routing. They are **not** measurements of a corrected label-blind pipeline. Pass 3.1 and Pass 4 also differ on 23 retrieved evidence lists and three predicted categories; their 2.19-point overall difference is not a controlled System-2 ablation.

Stored evidence accounting reproduces **115/203 = 56.65%**. Normalizing array-valued references recovers one missed hit at Q74, producing **116/203 = 57.14%**. Apply that normalization consistently to every run: original Pass 3 similarly changes from 116 to 117 hits. Pass 4 therefore does not establish a new retrieval record. Distinguish three retrieved documents from three distinct supporting turns when one observation references multiple turns.

**Findings requiring correction**

**1. P1 — Gold labels influence inference, and reader abstention does not reliably trigger escalation.**

In [locomo-runner-pass3-jev.mjs](sandbox:/workspace/scratch/6f068d2a23fd/airi-review/scripts/tests/locomo-benchmark/locomo-runner-pass3-jev.mjs), `needsSystem2` includes `goldCategory === 3`. Gold categories must be available to evaluation, but unavailable to the router and answer head.

Fourteen saved answers have `system2Resolved: true`: eleven are gold C3 and three are C4. Of those eleven C3 questions, **ten were classified outside C3 by Jev**: Q0, Q12, Q16, Q17, Q19, Q25, Q30, Q33, Q35, and Q36. This includes the successful UNO, Canada, and Greenland examples. The trace overwrites the pre-System-2 prediction, so it cannot establish whether any of those ten would independently have escalated through the `UNKNOWN` condition. A label-blind rerun is required; removing ten answers after the fact would not be a valid counterfactual either.

Separately, the span reader can select `none`, but the answer head falls through to Needle or the entire first candidate. A controlled `none` response returned the unrelated full sentence rather than `UNKNOWN`. Thus the brief's claimed “reader returns none → System-2” behavior is absent for ordinary nonempty retrieval results.

Return a typed reader result such as `{status, answer, sourceIds, reason}`. Route using predicted task, missing support, conflict, or explicit abstention. Keep `initialAnswer`, `finalAnswer`, `routeReason`, and stage responses. An invariance test should confirm that changing gold categories, answers, and evidence leaves inference requests and outputs unchanged.

**2. P1 — The new scorer is not upstream-compatible.**

[locomo-metrics.mjs](sandbox:/workspace/scratch/6f068d2a23fd/airi-review/scripts/tests/locomo-benchmark/locomo-metrics.mjs) applies comma-separated multi-answer averaging to every category. Upstream applies that operation to C1; C2–C4 use single-answer F1, with additional reference preprocessing for C3. For example, Q25's prediction `No` receives 0.50 in the repository but approximately **0.182** upstream. A shared year can also receive excessive credit after splitting a date at its comma. See the [upstream evaluator](https://github.com/snap-research/locomo/blob/main/task_eval/evaluation.py).

The custom stemmer also differs from NLTK's default `NLTK_EXTENSIONS` behavior: corpus examples include `used → us` versus `use`, and `one → on` versus `one`. Matching the original Porter algorithm does not establish parity with the evaluator's implementation. NLTK documents these [distinct stemmer modes](https://www.nltk.org/api/nltk.stem.PorterStemmer.html).

Use the pinned upstream evaluator as the authority, or require a port to match it on every saved prediction plus focused comma/date, C3-reference, stemming, and empty-answer cases. Thirty Pass 4 per-question F1 values currently differ. Historical “beat Run 07/14” claims require rescoring those saved answers with the same evaluator and subset.

**3. P1 — Fresh claims corrupt secondary indexes; cache hydration masks the defect.**

In [entity-ledger.mjs](sandbox:/workspace/scratch/6f068d2a23fd/airi-review/scripts/tests/locomo-benchmark/entity-ledger.mjs), `addClaim()` generates `id`, stores the claim under `id`, but inserts the input `claimId` into the subject, object, and source indexes. When omitted by ingestion, that input is `null`.

Reproduction: insert two dog-ownership claims for a synthetic person. The claim map contains `claim_1` and `claim_2`, while its predicate index contains only `null`. `queryPetsByOwner()` throws `Cannot read properties of undefined (reading 'object')`. Serialize and reload the same data, and the query succeeds because deserialized claims supply explicit IDs.

Insert the resolved `id` into every index. Require query equivalence before and after serialization, and validate that every index member resolves to a claim. The existing cached benchmark does not exercise this fresh-ingestion failure.

**4. P1 — Derived observations are treated as authoritative evidence without reading their cited turns.**

In this index, an STMM candidate's `rawText` is its **observation text**, not the raw conversation. The reader and System-2 use that field directly. Two case studies change the proposed fixes materially:

| Case | What the model actually receives | What the cited raw turn says | Consequence |
| :--- | :--- | :--- | :--- |
| Q13, Italy | An observation lists countries and omits the time expression | D6:12 says “Last year I visited Italy” | Hydrate D6:12 and support `last year`; adding an explicit-year regex does not fix this input |
| Q17, game identification | An observation explicitly says John played **Among Us** | D8:36 describes finding impostors without naming the game | System-2 is being supplied an unsupported game label before it reasons |

The brief's Q13 quotation attributing “in 2021” to D6:14 is not present in that raw turn. An explicit-date/year check already precedes the session-date fallback in the answer head.

Resolve every candidate to a normalized `sourceTurnIds: string[]`, hydrate those raw turns, and preserve speaker, session date, and text boundaries. Observations and summaries can locate evidence; their assertions need verification against the cited dialogue before becoming answer facts. For Q17, enforce the board/social-game constraint after this repair, while allowing abstention if the raw clues still do not uniquely identify Mafia.

**5. P1 — Benchmark-specific answers and unbound graph queries remain.**

[dual-searcher-pass3.mjs](sandbox:/workspace/scratch/6f068d2a23fd/airi-review/scripts/tests/locomo-benchmark/dual-searcher-pass3.mjs) answers an adoption-name question using the first `adopted` claim without binding the requested adopter. Asking for the dog adopted by synthetic person Mira returned James's **Ned**. [answer-head-pass3.mjs](sandbox:/workspace/scratch/6f068d2a23fd/airi-review/scripts/tests/locomo-benchmark/answer-head-pass3.mjs) still returns the fixed CS:GO/Apex Legends sentence for `gaming_preferences`, even when supplied claims for different people and games.

[ledger-ingest.mjs](sandbox:/workspace/scratch/6f068d2a23fd/airi-review/scripts/tests/locomo-benchmark/ledger-ingest.mjs) still defaults an adoption mention to Ned and contains named pet rules. The rebuild script manually adds the two favorite-game claims and supplies geographic defaults. Removing the obesity rule and substring collision was useful, but the claimed generic-query purge is incomplete.

Bind subject, predicate, object constraints, temporal scope, and evidence before formatting. Read the answer from the matched claim. Missing bindings should produce an unresolved result, not a canonical benchmark default.

**6. P1 — Calendar arithmetic improved; event-time joins remain unimplemented.**

The temporal answer branch scans candidates for a date expression, then returns the first candidate's session date for a `when` question. It does not establish that the dated event is the event being asked about. It can return before examining a later candidate containing the answer.

Controlled examples returned April 12, 2022 for both an unrelated first turn followed by an explicit 2021 visit, and a visit described as `last year`. A duration question with an April 10 arrival and April 14 departure returned **April 10, 2022**, rather than a duration. These are event-binding and answer-type failures, not arithmetic-library failures.

Select the event first; then resolve its own time expression. Keep the reporting/session time distinct from event time. Compute durations only from compatible start/end events and state the elapsed-versus-inclusive policy. Preserve uncertainty and precision: an unknown month is not a precise session day. Add `last year`, future offsets, intervals, and reported speech only with explicit anchoring rules.

**7. P2 — Span candidates are not validated copies, and a shared top-ten cap can lose answers.**

[span-reader.mjs](sandbox:/workspace/scratch/6f068d2a23fd/airi-review/scripts/tests/locomo-benchmark/span-reader.mjs) removes punctuation before generating n-grams. It proposes `York Boston` from `Mira visited York. Boston was crowded.` although that phrase never occurs in the text. Its length filter produces no candidate at all for a one-word passage `Ned`. It keeps ten proposals ranked mainly for novelty, while the model sees only the first 600 characters of a potentially longer passage.

For the 82 nongraph C4 questions, a gold-selected diagnostic oracle over the current top-two-context proposals achieves **59.19%** best possible F1 after the ten-option cap, versus **68.54%** before it. Adding the third context while keeping that shared cap reduces this ceiling to **54.99%**, because other proposals displace useful ones. These are candidate-set ceilings, not measured reader accuracy; they demonstrate why increasing context alone can regress results.

Generate proposals per source with `{turnId, start, end}`, verify each substring, preserve negation, and allocate candidates across evidence turns and requested answer types. Jev can select valid proposal IDs or abstain. Use a separate collection operator for lists rather than forcing every question through one selected phrase.

**8. P2 — System-2 batching lacks a validated output contract and bounded failure handling.**

[system2-batch-resolver.mjs](sandbox:/workspace/scratch/6f068d2a23fd/airi-review/scripts/tests/locomo-benchmark/system2-batch-resolver.mjs) requests JSON mode, with its schema only described in prose. It accepts arbitrary string keys. In a mocked two-chunk response, an answer from the second chunk overwrote the first chunk's ID, and an unrequested ID was accepted. There is no request deadline or handling of incomplete generation. Evidence is cut to 500 characters after concatenation, which can remove later supporting turns entirely.

Validate requested IDs, status enums, field types, source membership, and completeness before accepting an answer. Reject cross-chunk IDs, retain the initial answer on failure, retry only unresolved items within a bounded budget, and record failures. Pass source-separated evidence with per-item token budgets. Add a request deadline and preserve returned usage/model metadata. Do not infer that one HTTP request establishes a particular backend batching or forward-pass implementation.

**What is now repaired**

All **689 cached source records** have the correct session-date string for their source session, spanning **31 dates**. Mentions and events are serialized; claim IDs survive hydration. The cache has **1,157 mentions, 27 claims, and two events**, but only **two claims contain non-null `dateInfo`**. The two events are D5:1 and D21:3 mentions of Ned's adoption, not two distinct adoptions. No charity-tournament event nodes exist yet.

The reranker now reads `fusedScore`, triage changes retrieval weights, the obesity shortcut is removed, and calendar operations use `date-fns`. Those are concrete improvements. The broader generic ledger, validated reader, scorer parity, and bounded temporal joins remain partial.

**Answers to the Pass 5 design questions**

**1. Use adaptive collection; neither top-three union nor a fixed K=5 solves C1 generally.**

Pass 4 retrieves 22 of 57 annotated C1 evidence turns, with complete support for **3/20 questions**. Four C1 questions cite more than three turns; one cites six. Reconstructing the ten text candidates entering the reranker finds complete annotated support for only **2/20**, before graph injection. Merely keeping five of those candidates cannot recover support absent from that pool.

Use this bounded procedure:

1. Compile a label-blind task: `lookup | collect | count | temporal | infer`, with subject, relation, object type, polarity, and time scope. C1 classification alone is insufficient; a count and a list need different operators.
2. Retrieve the existing pool, expand cited raw turns, and select an initial five distinct supporting sources for collection, favoring complementary facts across sessions. Include a neighboring turn when needed to resolve an antecedent or reply.
3. Extract supported values per source. Deduplicate canonical entities while retaining every proof. For events, distinguish completed, planned, recurring, and retrospectively mentioned occurrences.
4. If coverage remains incomplete, perform at most two relation-specific ledger/BM25 follow-ups. Query expansion should preserve the requested person and relation. New dense queries require new embeddings; the current cache only contains the benchmark questions.
5. Stop on the evidence/token budget or when follow-up retrieval adds no supported facts. Render a comma-separated list deterministically, or count distinct matched event occurrences.

Keep Recall@3 for continuity, and add recall at the actual consumed evidence budget, complete-support rate, list precision/recall, and distinct-event count accuracy. Do not label a five-source answer's evidence score Recall@3.

For Q20, counting `ledger.events` today would return no relevant tournament events. First ingest tournament occurrences and reconcile repeated mentions. A simple count of event nodes would also count Ned's adoption twice. Use stable event identity, actor roles, time compatibility, and mention-to-event links before enabling count answers.

**2. Repair inputs and constrain the inference task before tuning batch size.**

The current default cap of 15 accommodated all 14 items. The trace does not establish an optimal batch size. Keep it as an initial offline setting; compare smaller batches against it under a fixed token budget and frozen inputs. For interactive use, flush on a short maximum queue wait or dispatch immediately when no batch is forming. Waiting until all benchmark questions finish is an offline throughput strategy.

Each item should carry its question, expected answer kind, explicit constraints, and a list of raw evidence records with source IDs. An appropriate general instruction is:

> Answer each item independently. Use dialogue evidence for personal facts. Use general knowledge only to interpret those facts. Enforce the requested entity type, medium, actor, and time scope. Do not turn an unsupported summary assertion into evidence. If support is insufficient or conflicting, return that status. Give the shortest sufficient answer, preserving qualifications and requested reasons or list members.

Use a validated response contract:

| Field | Requirement |
| :--- | :--- |
| `id` | Exactly one requested item ID; unique within its response |
| `status` | `answered`, `insufficient`, or `conflicting` |
| `answer` | String; empty when unresolved; length appropriate to the answer kind |
| `sourceTurnIds` | Valid input sources supporting personal facts |
| `usedGeneralKnowledge` | Boolean, kept separate from dialogue assertions |

A medium constraint such as `board_or_social_game` is reusable and compact. It does not require adding Mafia-specific hints. The raw description may still be ambiguous, so no prompt should promise the desired label without sufficient evidence.

Drop the blanket one-to-four-word limit: a `why` question or a qualified conclusion may need more words. `No` and `Presumably not` are not identical in certainty. Q12 also lacks its gold evidence in retrieval, so treat it as a support problem before optimizing phrasing. Report semantic adequacy separately from canonical token F1; do not rewrite references to reward a chosen answer style.

**3. Give roleplay a narrative clock independent of storage time.**

Keep three concepts distinct:

| Concept | Meaning | Example |
| :--- | :--- | :--- |
| `recordedAt` | Real timestamp when AIRI stored a statement | Used for synchronization and audit history |
| `narrativeTime` | Time the described event occupies in a particular story | Day 12, evening; before a named battle |
| `validDuring` | Interval over which a fact holds in that story | Employment starts after hiring and ends on resignation |

Every event and fact needs the existing memory scope plus explicit story/timeline/branch identity. A narrative position can be an absolute date, a relative offset from an anchored event, or an ordinal scene/day label. Do not invent an ISO date when the story supplies only order. If the current scene is Day 12, “yesterday” can resolve to Day 11; if even the day is unknown, retain an unresolved relative expression and its anchor.

Represent recurrence with an activity identity and distinct occurrence IDs. Store `before`, `after`, and interval relations with provenance; reject inconsistent cycles. Explicit scene transitions advance story time. A real-world pause does not automatically advance it. Flashbacks and quotations use their own temporal anchor. Real appointments use the real clock unless the user explicitly makes them fictional.

Corrections should supersede claims while preserving when each version was recorded. Branches and alternate universes must not share facts merely because entity names match. A later observation is evidence about a state; it does not automatically establish when that state began or ended. W3C's [Time Ontology](https://www.w3.org/TR/owl-time/) provides useful interval-relation terminology; this design can remain ordinary Node.js Maps and records without adopting an OWL engine.

**Recommended execution order and acceptance gates**

1. **Make the benchmark trustworthy:** isolate gold fields, fix canonical scoring and reference normalization, preserve pre/post-escalation outputs, and freeze dataset/model/cache versions. Recompute historical comparisons on matched artifacts.
2. **Make ingestion and evidence reliable:** fix generated-ID indexing, remove named defaults, hydrate raw sources, and validate all proof references. Missing/stale caches should trigger a validated rebuild path, not silently reuse the old ledger with a few manual enrichments.
3. **Improve answer operations:** add typed abstention, per-source span validation, collection/count operators, event-bound temporal resolution, and bounded follow-up retrieval.
4. **Measure each change with frozen inputs:** first compare System-1 and System-2 on the same stored retrieval results, then measure retrieval changes separately. Use an untouched conversation or held-out questions before claiming generalization from conv-47.

At minimum, retain regression cases for fresh-versus-reloaded ledgers, unrelated owners, multiple adoption events, last-year references, distractor dates, repeated event mentions, negative/planned actions, reader abstention, array-valued source references, invalid batch IDs, and story-clock isolation. Pin `date-fns` in the harness's declared dependencies; it is imported by the new code but absent from that standalone package's manifest.

Using corrected upstream F1 and normalized source references, there are **72 questions below 0.30**: 29 have no annotated support, 15 have partial support, and 28 have all annotated support. This replaces the brief's binary 29/40 failure split. Complete annotated support is a useful diagnostic, not proof that all residual failures are formatting errors; annotations and inference ambiguity still need inspection.

The recorded **127.06 seconds** covers the timed query loop and System-2 stage, after model/index/cache initialization. Pass 1 answers are reused from a historical trace. Report cold preparation, warm query throughput, interactive latency distributions, and API usage separately. Jev and the new System-2 resolver are cloud calls. Dividing 127.06 by 150 gives amortized benchmark time, not the waiting time of a queued user question. The claimed 17-second System-2 duration is not preserved in trace metadata for independent verification.

**Reproducibility record**

All repository aggregates reproduced with their current functions. Upstream rescoring used only the unchanged normalization/F1/evaluation functions, omitting unrelated model imports. Local retrieval reconstruction matched every nongraph stored evidence selection to its pre-rerank candidate pool. Synthetic tests used mocked model responses; temporal checks loaded `date-fns` 4.1.0 from an isolated audit dependency directory. The git working tree remained clean.

Artifact SHA-256 values:

| Artifact | SHA-256 |
| :--- | :--- |
| Pass 4 trace | `3dc2c10a58554a008be4a2c4ea992684cc4e2b0bb9237aea1003a0f8187d5f21` |
| Pass 3.1 trace, stored under the Pass 3 filename | `74a46daa4ec0eb67c7af3c4ac972cdd72392764835f474dd17ea607c45d36860` |
| conv-47 dataset | `76a8a1f20c5a07f2c8c7c08a88720631498b32df8e9e666ec9005aba14dd28d0` |
| Repaired ledger | `37d71431360ccde26cf388ae9ce1dfe9f1f5b6c3dbfcdb23ab5fd0dc315c008b` |
| Upstream evaluator source used | `51b663d5d4e26562ea0b4b763a171f98356e10cf937326a0322a01207ad1bc75` |
