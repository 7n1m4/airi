# Nan0 System 1 modernization peer review

**Repository:** `dasilva333/airi`
**Reviewed commit:** [`1af48a744f25784c200f568d291b273c62603416`](https://github.com/dasilva333/airi/commit/1af48a744f25784c200f568d291b273c62603416)
**Date:** 2026-09-27
**Mode:** Read-only review. No application code changes, commits, or pushes.

## Verdict

**Changes requested before declaring heuristic elimination or trust-safe System 1 integration complete.** The named lexical extractor and four continuity helper regexes are removed, and the new continuity question joins the existing primary Jev request. However, consequential lexical fallbacks remain, classifications lack the context their criteria require, and completion/commitment classifications are promoted into stronger claims than their schemas support.

The runtime suite passes **343 tests across 26 files**; runtime TypeScript checking passes. Those results validate deterministic behavior, not live Jev calibration. Targeted executable checks reproduced five behavioral problems despite the green suite.

### Findings at a glance

| ID | Priority | Finding | Relationship to this commit |
|---|---|---|---|
| F1 | P1 | Unverified completion claims increase persisted trust | Introduced by new relationship mapping |
| F2 | P1 | General and conditional commitments become return promises; next message fulfills them | Existing modernization gap |
| F3 | P1 | Jev failure still executes consequential lexical affect rules | Existing fallback contradicts architectural claim |
| F4 | P2 | Context-dependent classifiers receive only current text | Existing input contract, newly consequential for continuity |
| F5 | P2 | Keyword overlap overrides continuity classification | New classifier integration retains conflicting old routing |
| F6 | P2 | Keyword mentions can complete a goal, including explicit denial of progress | Existing residual heuristic |
| F7 | P2 | Relationship persistence awaits up to two additional sequential Jev calls | Existing latency outside primary preparation request |
| F8 | P2 | Grievance recurrence reinforces the first active grievance, not the matched one | Existing semantic attribution defect |

P1 indicates substantial incorrect state attribution; P2 indicates a correctness or architectural issue that should be addressed in the modernization. Existing gaps are explicitly distinguished from regressions introduced by this commit.

## Detailed findings

### F1 — P1: A completion speech act is treated as verified relationship repair

**Source:** [RelationshipMemory.ts:653–681](https://github.com/dasilva333/airi/blob/1af48a744f25784c200f568d291b273c62603416/packages/nan0-runtime/src/relationship/RelationshipMemory.ts#L653), particularly 676–677; dimension updates at 603–624. [Nan0Kernel.ts:1511–1535](https://github.com/dasilva333/airi/blob/1af48a744f25784c200f568d291b273c62603416/packages/nan0-runtime/src/kernel/Nan0Kernel.ts#L1511).

`claimed_task_completion` now produces positive relationship evidence at intensity `0.50`. `recordAssistantTurn()` passes it into the persisted relationship update without task identity, trusted observations, or a recorded-commitment check. Positive evidence increases trust, attachment and respect, and decreases suspicion and irritation.

The question explicitly says this is **an unverified claim**, and says not to verify success or trust restoration through the question. The shadow proposal mapper already requires a completed trusted observation matching a recorded commitment, with expected-task matching when supplied. That protection is absent from this production relationship path.

**Executed reproduction:** `inferRelationshipEvidence('I fixed it.', {completed_repair: {choice: 'claimed_task_completion', confidence: 0.99}})` followed by `applyRelationshipEvidenceAsync()` changes a fresh relationship's trust from `0.5` to `0.525`, with no external completion evidence. Confidence `0.01` produces the same increase.

**Recommendation:** Separate acknowledgment of a completion claim from verified repair. Require host-owned task/commitment linkage and successful completion evidence before applying repair-derived trust changes. Store the speech act as unverified when evidence is unavailable. An apology can be acknowledged socially without treating it as completed repair.

**Regression cases:** Unsupported “done”; a completed unrelated task; an actual linked completion; a later retraction; missing and low-confidence classifications.

### F2 — P1: All commitments are interpreted as timed return promises

**Source:** [Nan0TemporalEventGenerator.ts:257–280](https://github.com/dasilva333/airi/blob/1af48a744f25784c200f568d291b273c62603416/packages/nan0-runtime/src/temporal/Nan0TemporalEventGenerator.ts#L257), 429–457; `commitment_pledge` in `Nan0JevSchema.ts:107–119`.

The schema deliberately covers routine tasks, ongoing obligations and conditional commitments. The consumer treats both `direct_future_commitment` and `conditional_commitment` as `explicitReturnPromise()`, which supplies a 15-minute deadline whenever it cannot parse a supported duration. Every active promise is then fulfilled by any subsequent owner observation with a later timestamp, regardless of that observation's content or actual task completion.

**Executed reproduction:** “If funding arrives, I will fix the database next year,” classified as `conditional_commitment`, creates an active promise due in 15 minutes. One second later, “The funding was rejected; I have not fixed anything” changes it to `fulfilled`, emits `promise-kept`, and proposes `attachment +0.05`, `distrust -0.05`, and `warmth +0.04`.

Absent a follow-up, unrelated obligations can instead generate false overdue/broken-promise events. The issue is in consumer semantics; better wording alone cannot fix it.

**Recommendation:** Distinguish return/check-in commitments from task and ongoing commitments. Preserve condition and deadline status. Unknown deadlines must remain unknown. Fulfillment must use the relevant return event or verified task evidence, not any message. Keep duration arithmetic deterministic after the correct semantic span is identified.

### F3 — P1: Jev outages reactivate the lexical behavior the refactor claims to eliminate

**Source:** [Nan0Kernel.ts:3279–3354](https://github.com/dasilva333/airi/blob/1af48a744f25784c200f568d291b273c62603416/packages/nan0-runtime/src/kernel/Nan0Kernel.ts#L3279); [Nan0EmotionalDynamics.ts:57–69](https://github.com/dasilva333/airi/blob/1af48a744f25784c200f568d291b273c62603416/packages/nan0-runtime/src/emotional/Nan0EmotionalDynamics.ts#L57), 170–216. Also kernel 624–636 and the Stage UI adapter at `packages/stage-ui/src/stores/modules/nan0.ts:368–384`.

Timeouts, provider errors and empty answers are caught and routed to `perturbEmotionsFromObservation()`. That function still applies the broad `love`, `whatever`, `delete`, `sorry`, and similar regexes to live affect. `tier2JevChallengerEnabled: false` also selects the synchronous path. Checking for a provider function does not establish configuration: the Stage UI adapter exists even when its underlying provider is unconfigured, then throws and activates this fallback.

**Executed reproduction:** A throwing provider and “I will never delete you” change fear from `0.15` to `0.4275` and suspicion from `0.35` to approximately `0.449`. The explicit denial becomes a threat reaction.

The suite currently **expects** local perturbation after a Jev timeout. Removing the shadow extractor did not remove this production fallback.

**Recommendation:** Explicitly choose fail-fast or safe abstention for external conversational inference, retaining normal decay but no inferred semantic affect on failure. Align tests and documentation. Trusted internal events can use typed causes and host-owned metadata without classifying their rendered English descriptions.

### F4 — P2: The classifier lacks the history required by its criteria

**Source:** [Nan0Kernel.ts:3281–3285](https://github.com/dasilva333/airi/blob/1af48a744f25784c200f568d291b273c62603416/packages/nan0-runtime/src/kernel/Nan0Kernel.ts#L3281); [Nan0JevSchema.ts:171–180](https://github.com/dasilva333/airi/blob/1af48a744f25784c200f568d291b273c62603416/packages/nan0-runtime/src/shadow/Nan0JevSchema.ts#L171), and hostility/completion criteria in the same file.

The primary call passes the plain current `text`. It does not pass a `target_turn` object, recent conversation, active thread summaries, or task context. The Stage UI adapter serializes what it receives; it does not supply the missing history.

**Executed observation:** Two `prepareTurn()` calls produced provider inputs consisting solely of “Discuss bank loan interest.” and “Photograph the river bank wildlife.” Each request contained 13 questions, but no prior exchange.

The model therefore cannot reliably distinguish a standalone “That worked” from a contextual follow-up, establish mutually welcomed banter from earlier permission, or determine whether a completion concerns the task under discussion. The same utterance may require different choices under different histories.

**Recommendation:** Build one bounded, role-labeled pre-turn context containing the target observation, relevant recent turns, thread candidates, and applicable task/boundary context. Keep it inside the existing batched request. Scope history by actor/session and explicitly identify the target turn to prevent importing historical speech acts.

### F5 — P2: Lexical overlap can overrule `none_or_new_topic` and follow-up intent

**Source:** [ConversationContinuity.ts:296–360](https://github.com/dasilva333/airi/blob/1af48a744f25784c200f568d291b273c62603416/packages/nan0-runtime/src/continuity/ConversationContinuity.ts#L296).

Only `explicit_topic_shift` gets an unconditional new-thread result. Otherwise, any positive topic-label overlap is returned before current-thread follow-up handling. `none_or_new_topic` has no explicit routing branch. A resumed-topic classification without lexical overlap can also select the most recent dormant thread without evidence that it is the intended one.

**Executed reproduction:** With the provider explicitly returning `none_or_new_topic` for both messages, “Discuss bank loan interest” and “Photograph the river bank wildlife” receive the same thread ID because of “bank.” This demonstrates a consumer defect independently of model accuracy.

**Recommendation:** Distinguish semantic `new_topic` from `unresolved`. Make classifier decisions authoritative within their supported scope. For resumption, supply thread IDs/summaries and obtain a bounded candidate selection or abstention. Lexical overlap can retrieve candidates, but should not establish thread identity by itself.

### F6 — P2: Mentioning goal vocabulary can complete a goal

**Source:** [Nan0GoalEngine.ts:260–297](https://github.com/dasilva333/airi/blob/1af48a744f25784c200f568d291b273c62603416/packages/nan0-runtime/src/goals/Nan0GoalEngine.ts#L260); called during `prepareTurn()` at kernel 743.

The engine extracts words from goal title/description/motivation and adds progress whenever the observation contains them. It neither examines polarity nor verifies completion criteria. Reaching `1` sets `status: 'completed'` and records a completion-evidence explanation.

**Executed reproduction:** An active “Investigate hidden anomaly” goal at `0.99` becomes completed at `1.0` after “I have NOT investigated the hidden anomaly; no evidence or progress.” Repeated ordinary mentions can also accumulate progress.

**Recommendation:** Separate relevance/activity from progress and completion. A batched classification over bounded goal candidates can identify reported progress, setbacks, denials and completion claims; only task-linked evidence should establish actual completion. Goal relevance may influence attention without changing achievement state.

### F7 — P2: Grievance handling still introduces sequential RPC latency

**Source:** [RelationshipMemory.ts:314–348](https://github.com/dasilva333/airi/blob/1af48a744f25784c200f568d291b273c62603416/packages/nan0-runtime/src/relationship/RelationshipMemory.ts#L314), 426–483, 603; kernel 1516–1535.

The primary 13-question call is batched. However, a sufficiently intense negative relationship event awaits `grievance_salience` plus `grievance_recurrence`, then may await a separate `trigger_concept` call. `recordAssistantTurn()` waits for this work before saving the completed turn. These helpers have no local timeout comparable to `prepareTurn()`'s 1.5-second race; actual network behavior depends on the provider.

**Executed reproduction:** A fresh negative insult event caused two provider calls: first `['grievance_salience', 'grievance_recurrence']`, then `['trigger_concept']`; maximum concurrent calls was **1**. Together with primary preparation, that path can require three Jev requests.

**Recommendation:** Include relevant grievance questions and bounded grievance context in the original request and reuse turn-scoped results, or explicitly run noncritical enrichment after durable turn persistence with bounded deadlines. Do not describe whole-turn behavior as one unified forward pass while these awaited calls remain.

### F8 — P2: Recurrence is classified without identifying which grievance recurred

**Source:** [RelationshipMemory.ts:458–473](https://github.com/dasilva333/airi/blob/1af48a744f25784c200f568d291b273c62603416/packages/nan0-runtime/src/relationship/RelationshipMemory.ts#L458); `NAN0_JEV_GRIEVANCE_RECURRENCE_QUESTIONS` at `Nan0JevSchema.ts:417–444`.

A `recurrence_reinforced` response causes `.find()` to choose the first active or nurtured grievance. Although descriptions and IDs are supplied to Jev, the response schema returns no matched ID. With two active grievances, reference to the second reinforces the first, prolonging the wrong grievance's lifetime and misattributing evidence.

**Evidence:** Direct source trace; not presented as a live model measurement.

**Recommendation:** Return a validated candidate grievance ID plus `new_issue`/`none`/`unresolved`, or classify each bounded candidate independently in the same request. Preserve exact linkage through state updates. Regression coverage should reverse grievance order and confirm the same semantic target is reinforced.

## Residual heuristic inventory

Paths below are relative to `packages/nan0-runtime/src/`. Regex existence alone is not a defect: formatting, identifier validation, enum membership and arithmetic should generally remain deterministic.

| Surface | Remaining behavior | Disposition |
|---|---|---|
| `emotional/Nan0EmotionalDynamics.ts:57–69,188` | Broad lexical affect rules, reachable on provider failure and synchronous paths | Remove external semantic fallback; F3 |
| Same file, `366–407` | Even successful Jev inference adds question-mark curiosity, stranger-command irritation, quiet/idle boredom and machine/code pride via regex | Promote semantic decisions or use typed host events. “I did not order you” and “my coffee machine broke” illustrate attribution risks |
| Same file, `611–620` | `secret/why/how`, `promise/trust`, `delete/replace`, `please/help` directly weight attention | Reuse semantic annotations; do not make a new request per candidate memory |
| `attention/Nan0AttentionEngine.ts:273–283,487–519` | Calls lexical emotional weighting; word overlap influences goal relevance, topic tracking and memory retrieval | Promote semantic salience/relevance where consequential; cheap lexical candidate retrieval can remain |
| `decision/Nan0DecisionEngine.ts:50–63` | Private-thought rejection uses generic-assistant phrase matching alongside format/leakage checks | Keep actual transport validation deterministic; separate semantic style judgment from substring vetoes |
| Same file, `179–190` | `calm/quiet/content/peaceful` mood mismatch check | Diagnostic heuristic, not a demonstrated actuation defect; prefer typed mood labels if standardized |
| `thought/Nan0ThoughtEngine.ts:183–199,396–398` | ASCII-only low-information test; `nan0/you/your` or `?` identifies address; duplicated thought-style vetoes | Candidates for language-aware information/address classification. Avoid erasing non-Latin text before measuring information |
| `goals/Nan0GoalEngine.ts:155–164,260–297` | Keyword titles/deduplication; lexical progress and completion | Progress/completion requires replacement, F6. Formatting a title or key need not be neural |
| `goals/Nan0Goals.ts:68–89` | Token overlap for goal matching | Candidate retrieval is acceptable; semantic identity should not rest solely on overlap |
| `intentions/Nan0PendingIntentions.ts` | Typed trigger, status, time and condition handling | **No direct free-text keyword/word-boundary classifier found here.** Upstream intention extraction remains relevant |
| `continuity/ConversationContinuity.ts:124–149` | `?` creates unresolved question; `let's/we should/we need to/I need to/remember to` creates intention | Use appropriate input speech-act results with negation/quotation ownership |
| Same file, `482–497` | Assistant `I'll/I will/I promise/we should` creates unresolved promise | Use structured assistant commitment output. It cannot be classified in the earlier user-input pass because it does not yet exist |
| Same file, `284–360` | Stop-word-filtered exact token overlap selects thread | F5; retrieve candidates lexically, resolve identity semantically |
| `relationship/RelationshipMemory.ts:304–363,480–483` | Stop-word trigger extraction, phrase/word-boundary matching; lexical extraction persists even after neural concept selection | Semantic recurrence should use matched grievance IDs. Avoid treating keywords as proof of recurrence |
| Same file, `1308` | Task-description substring can match a grievance during repair handling | Require stable task/grievance IDs instead of prose containment |
| `prediction/Nan0PredictionEngine.ts:52–68,301–308,405–406` | Serialized regexes confirm/violate expectations; generated confirmation uses first consequent word | Keep literal machine-event matchers where explicitly contractual; conversational expectation confirmation needs semantic/evidence linkage |
| `temporal/Nan0TemporalEventGenerator.ts:257–280` | English duration scraper and default deadline | Keep validated duration arithmetic, but extract the correct commitment/deadline span and preserve unknowns; F2 |
| `test-utils/mock-system-one.ts:34–96` | Extensive `includes()`/`startsWith()` classification simulator | Test-only, not production removal target; unsuitable evidence of Jev accuracy |

`FORMATION_RULES` matching internal cause strings, source-prefix routing, allowlists, IDs, whitespace normalization, redaction and status checks are not candidates for indiscriminate neural replacement.

## Question wording and calibration

### `thread_continuity_triage`

The new criteria are less discriminating than the established pragmatic questions. They list “why,” “it,” “that,” and “they” as follow-up examples but do not explicitly require a resolved discourse referent. “My car broke, so I repaired it” contains a self-contained pronoun, and “Why is the sky blue?” can be a standalone question. There is no `unresolved` choice, while `none_or_new_topic` combines missing evidence with affirmative new-topic evidence.

Recommended boundaries:

- **Continuation:** Meaning depends on or directly develops the supplied active exchange; pronouns resolved wholly within the target message do not suffice.
- **New topic:** Substantive content is independent of supplied thread candidates, even without transition phrases.
- **Explicit shift:** A current adopted request to change subjects; exclude quotations and negated transitions.
- **Resume:** Refers to an identifiable earlier thread; pair with candidate selection.
- **Greeting only:** No substantive follow-up or shift in the same message. “Hi, different topic…” should select the substantive act.
- **Unresolved:** History/referent is insufficient or conflicting; abstain from confident reassignment.

These are proposed calibration changes, not measured accuracy improvements.

### `completed_repair` versus `commitment_pledge`

The existing wording is fundamentally sound: it distinguishes claims from facts, future/in-progress work from completed work, and conditional from unconditional undertakings. The major failures are downstream F1 and F2.

Add paired examples: “I fixed A and will test B tomorrow” may legitimately activate both heads; “I nearly finished” is in progress; “I thought I fixed it, but it still fails” retracts completion; “I finished the draft, but the deployment is pending” needs explicit task scope. Preserve actor and task ownership, and do not force mutually exclusive heads for separate propositions.

### `hostility_insult` and `dismissal_neglect`

The negative attractors are well chosen. Personal attacks are separated from criticism of an answer/object, self-deprecation and quoted speech. Dismissal explicitly excludes ordinary absence, workload, short replies, wrap-ups and boundaries. **Do not weaken those protections merely to make banter easier to classify.**

Their actual distractor strength is unverified here. `playful_sarcasm` requires a mutually welcomed exchange, which the primary request currently omits. Fix context delivery before drawing conclusions about wording strength. Test the same jab under welcomed banter, unknown context and an active hurt boundary. Include “that answer is useless,” “I need quiet,” “whatever works for you,” “goodnight, I have work,” and multi-clause messages containing both courtesy and an actual insult. Humor markers alone must not cancel boundaries.

### Validation and test integrity

`Nan0JevSystemOneAnswers` aliases `Record<string, {choice: string, ...}>`; the provider accepts `Record<string, any>` questions. It is not a per-question discriminated answer contract. The kernel accepts any nonempty answers object, and the new relationship/continuity consumers do not validate completeness or calibrated confidence.

Define allowed choices per question, validate at the provider boundary, and choose explicit missing/ambiguous-answer policies. Do not invent a universal confidence threshold without held-out calibration. The observed `0.01` completion response receiving full trust credit demonstrates the absence of attenuation, not a measured optimal threshold.

The mock labels “you lied” as a user deception admission, although the real schema excludes accusations; it labels frustration/disagreement as direct dismissal; it uses substring `it`/`that` to simulate continuity. Thus, some fixtures encode behavior the production criteria intentionally reject. Keep mocked state-machine tests, but use explicit per-case expected answers and add a separate live, held-out classification evaluation. Passing the mocks does not establish sarcasm precision or false-positive rates.

## Inference ordering and token economics

**Verified narrowly:** `prepareTurn()` makes one primary provider call containing all **13 questions / 85 choices**. The new continuity question and relationship evidence classification add no per-question sequential RPC there. A provider spy confirmed one 13-question call per tested `prepareTurn()`.

**Not verified broadly:** A remote model's internal forward-pass implementation and real latency cannot be proven from this client code or mocks. F7 demonstrates additional sequential calls during relationship persistence. Shadow `dispatchAsync()` also has its own provider call when independently invoked; this review does not claim that every host turn invokes that shadow path.

The document's “zero extra latency or token overhead” claim is too strong. Serialized primary question JSON increased from **21,857 to 23,505 characters**, an addition of **1,648 characters (~7.5%)** for continuity. These are measured JavaScript string lengths, **not tokenizer counts or billed tokens**. Parallel outputs avoid autoregressive per-answer generation but do not prove free input schema processing, unchanged latency, or unchanged billing. No current pricing or live usage measurement was used in this review.

Recommended measurement: record provider request count, schema/context bytes, provider-reported token/usage data where available, and end-to-end p50/p95 preparation and persistence times. Batch bounded grievance/goal/thread candidates rather than adding an RPC at each consumer. Store reusable semantic annotations for historical retrieval rather than reclassifying every memory on every turn.

## Verification record

| Check | Result |
|---|---|
| Exact source checkout | Detached at `1af48a744f25784c200f568d291b273c62603416` |
| Runtime unit suite | **343/343 passed, 26 files**, Vitest 4.0.18, 3.24 seconds reported |
| Runtime typecheck | **Passed**, TypeScript 5.9.3, `tsc --noEmit -p packages/nan0-runtime/tsconfig.json` |
| Stage UI typecheck | **Inconclusive**: missing Vue macro plugin resolution, then Node heap exhaustion; not a verified source-code failure or pass |
| Live headless scenario harness | **Not run**: `packages/nan0-runtime/scripts/.env` absent; no live-model calibration claim |
| Targeted deterministic checks | Reproduced F1, F2, F3, F5 and F6; captured context omission for F4 and two sequential relationship calls for F7 |
| Application source changes | None; final `git status --short` empty |

The requested `pnpm` commands initially triggered automatic workspace dependency installation. Lifecycle setup failed on sandboxed `tsx` IPC and a nested install was killed. After dependencies were present, the runtime suite and typecheck were run directly with their installed tools to avoid retriggering that setup. Stage UI remained unverified for the reasons above. Behavioral checks used Node 24 with TypeScript transformation and a resolver for extensionless repository imports; no source patch was needed.

## Suggested correction order

1. Prevent unverified completion and unrelated commitment messages from altering trust as verified fulfillment.
2. Remove semantic affect mutation on Jev failure; align timeout tests with the chosen abstention/failure contract.
3. Supply bounded context, distinguish unknown from new-topic, and enforce thread/grievance identity linkage.
4. Replace lexical goal completion and remaining high-impact semantic heuristics.
5. Consolidate grievance inference, then run held-out pragmatic calibration and real request/latency/usage measurements.

The architecture is moving in the intended direction, but green mocked tests and removal of the named extractor are insufficient evidence for complete heuristic elimination or calibrated attribution.
