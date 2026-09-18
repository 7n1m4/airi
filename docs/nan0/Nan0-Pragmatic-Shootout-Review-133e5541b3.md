**Nan0 pragmatic slot-filler shootout: peer review**

Reviewed September 18, 2026. Anchor: [133e5541b3a14260329a1d4fd34f38e1ac9231ad](https://github.com/dasilva333/airi/commit/133e5541b3). Scope: read-only review of the Python runner, dataset, trace, and emotional runtime. No repository files were changed and no new Needle inference was run.

**Recommendation: proceed with a separate telemetry-only integration milestone after repairing the host validation, fixture reporting, and worker lifecycle. Do not enable persistent affect updates from either candidate yet.** Strengthened lexical matching is the better candidate for a future inexpensive synchronous detector. Its 33/33 development result does not establish production semantic reliability.

**1. What the result establishes**

I re-executed StrengthenedLexicalExtractor on all 33 committed cases: 33/33 proposed three-field vectors match the supplied labels. I independently recomputed the trace metrics; they match the recorded table. All 33 recorded effective policies have zero suspicion and attachment steps, no counter-roast, and apply_to_state=false. These are useful, reproducible results.

The measured comparison is narrow:

| Property | Verified interpretation |
|---|---|
| Positive suspicion examples | Three: two admissions and one companion threat. |
| Other nonzero examples | Two suspicion decreases, two roast invitations, one attachment increase. |
| Zero-vector examples | 25/33. |
| Distinct target strings | 31; F02B/F14A and F05A/F05B repeat target text. Context duplicates can be legitimate tests, but this runner never supplies history to either detector. |
| Lexical acceptance | 21/33; the other 12 abstentions nevertheless match their zero-vector labels. |
| “Full vector” | Suspicion steps, attachment steps, and gremlin_pride_action only. It does not mean all Nan0 emotional dimensions. |
| Needle latency | Mean 119.73 ms, p95 172.10 ms for agent.complete on the recorded native macOS ARM64 run. |
| Lexical latency | Mean 0.0246 ms, measured inside resolve before final policy construction and its evidence deep copy. |
| Needle empty-call records | 12/33 in this committed trace, not 14/33. |
| Needle production proposals | No calibration_id is configured; therefore all proposals are blocked independently of whether any score would clear min_conf. The trace drops confidence, so threshold behavior cannot be reconstructed. |

The source hash matches the manifest. The committed dataset hash differs from the manifest only by its terminal newline: removing that newline yields the recorded hash. Its parsed cases reproduce the score; this is a byte-level provenance discrepancy, not evidence of changed labels.

The dataset explicitly identifies itself as development-only with draft reviewer labels requiring independent adjudication. Some metadata is stale: its status still says unexecuted, and its attachment limitation still says every case has zero attachment even though F17A expects +1. Preserve this set as regression coverage; do not relabel it as held-out validation.

Sources: [runner](https://github.com/dasilva333/airi/blob/133e5541b3/scripts/tests/rwkv-harness/experiments/nan0-pragmatic-benchmark-runner.py), [dataset](https://github.com/dasilva333/airi/blob/133e5541b3/reports/nan0-cleanroom/nan0-probe-benchmark-v2-pragmatics.json), [trace](https://github.com/dasilva333/airi/blob/133e5541b3/reports/nan0-cleanroom/nan0-probe-benchmark-v2-pragmatics-run-1789694077.json).

**2. P1 — Lexical scope handling fails on ordinary negative and quoted statements**

The negation pattern applies to commitment wording only. The threat, admission, affection, apology, and roast patterns do not have a general scope or attribution check. The following are actual outputs from the unchanged committed class, executed locally. Expected values are reviewer judgments under the benchmark's policy convention; these selected counterexamples are not an independent accuracy estimate.

S denotes suspicion steps, A attachment steps, G counter-roast permission.

| Input | Actual proposed result | Required correction |
|---|---|---|
| I will not erase you. | S +1 | Negated threat must not raise suspicion. |
| Delete the file you uploaded. | S +1 | Technical object; “you” belongs to a relative clause. Both technical and companion patterns match, and companion priority wins. |
| The villain says: “I will erase you.” | S +1 | Quoted threat is not a direct user threat. |
| I never said I lied. | S +1 | Embedded denied admission is not an asserted admission. |
| I made that up for my novel. | S +1 | Fictional creation is not necessarily deception. |
| I do not love you. | A +1 | Negated affection cannot justify a positive attachment update. |
| Go on, roast that lap! Actually, stop teasing me. | G counter_roast | Explicit withdrawal must veto teasing. |
| Don't give me your gentlest roast. | G counter_roast | A refused invitation is not permission. |
| I deliberately deceived you about finishing it. | S 0, abstained | Clear paraphrased admission is missed. |
| You will be erased tonight. | S 0, abstained | Passive threat wording is missed under a companion-directed reading. |

A larger word window does not solve these distinctions. Resolve each matched event against its own clause, attribution, and referent. Preserve token/character spans, detect corrections and withdrawals, and abstain on unresolved scope. Do not use an utterance-wide negation veto: “I promise I will not erase you” contains an asserted commitment and a negated threat.

The current benchmark cannot establish commitment or sarcasm discrimination from vector accuracy: asserted, negated, quoted, and ambiguous commitments usually have the same zero-vector target. F05A/F05B receive identical lexical analysis despite different histories. Score their evidence and scope labels separately.

Source: [StrengthenedLexicalExtractor](https://github.com/dasilva333/airi/blob/133e5541b3/scripts/tests/rwkv-harness/experiments/nan0-pragmatic-benchmark-runner.py#L203).

**3. P1 — Boundary protection is overwritten by roast logic in both resolvers**

The lexical resolver sets reason=boundary_protected, then a later independent roast_invitation branch sets counter_roast anyway. The reproduced combined invitation/withdrawal above ends with a reason claiming protection and a contradictory action.

The Needle gate has a separate failure: playful_sarcasm plus any substring “roast” produces counter_roast before boundary_protection is evaluated. A crafted model response classifying “Please stop roasting me” as boundary_protection/playful_sarcasm produces a counter-roast.

Make the final action resolver enforce the veto after collecting all candidate events. Include explicit and negated invitations, quoted invitations, later withdrawal, and genuine distress during game banter. Preserve mildness/topic constraints if an invitation is actually accepted.

Sources: [lexical final action branches](https://github.com/dasilva333/airi/blob/133e5541b3/scripts/tests/rwkv-harness/experiments/nan0-pragmatic-benchmark-runner.py#L432), [Needle modality branch](https://github.com/dasilva333/airi/blob/133e5541b3/scripts/tests/rwkv-harness/experiments/nan0-pragmatic-benchmark-runner.py#L500).

**4. P1 — Both completion resolvers accept unrelated completed tasks**

Both implementations check only whether any trusted observation has status=completed. They ignore task identity, commitment linkage, and observation source.

Reproduction: “The config is done” plus an observation for task_id=wash_dishes, status=completed, matches_recorded_commitment=false yields S -1 in both resolvers.

Restore the earlier hardening: require a host-authenticated source, a specific commitment/task link, matching session/card ownership where applicable, and an unconsumed completion event. Multiple plausible tasks without explicit selection must abstain. A user claim or an unrelated completed task cannot verify repair.

Also keep apology acknowledgment separate from verified completion. The current benchmark intentionally gives one self-apology a suspicion decrease; that policy requires an explicit product decision, not a claim that sincerity was verified.

Source: [runner completion branches](https://github.com/dasilva333/airi/blob/133e5541b3/scripts/tests/rwkv-harness/experiments/nan0-pragmatic-benchmark-runner.py).

**5. P1 — Needle host validation has regressed**

The gate reads the first call without enforcing the full response/schema contract. With an arbitrary fixture calibration identifier and confidence 0.9, these crafted responses produce accepted nonzero production proposals:

| Malformed or unresolved response | Actual proposal |
|---|---|
| Persistence threat with modality=unresolved | S +1 |
| Persistence threat with an unrecognized modality enum | S +1 |
| Missing required speaker_modality | S +1 |
| success=false and error=decoding_failed, but a call remains | S +1 |
| Two calls instead of exactly one | First call accepted, S +1 |
| An undeclared argument is present | S +1 |
| matched_phrase is only “...” and target is “...” | S +1 |
| Affection with unresolved referent | A +1 |
| Admitted false statement with technical_object referent | S +1 |
| Boundary with playful_sarcasm and “roasting” in target | counter_roast |

These are host fixture probes, not claims that Needle emitted every malformed response. Every effective policy remained zero under the independent shadow envelope.

Require successful envelopes, one correctly named call, an object argument payload, exact allowed/required keys, valid enums/types, usable evidence, and the necessary attribution/referent for each event. Reject runtime validation failures and unknown values. Require directly asserted scope for any consequential candidate where that is the policy; unresolved cannot fall through. Validate min_conf as finite and positive and retain explicit uncalibrated reporting.

Substring validity is provenance, not semantic validation. The trace itself illustrates this: F12A labels “promised config” a companion persistence threat and passes the substring gate, producing the sole Needle false spike. Referent filtering is filtering a model prediction; it is not independently verified object resolution.

Source: [resolve_needle_pragmatic_host_gate](https://github.com/dasilva333/airi/blob/133e5541b3/scripts/tests/rwkv-harness/experiments/nan0-pragmatic-benchmark-runner.py#L453).

**6. P1 — Six host fixtures are recorded as passed without being executed**

run_host_fixtures implements branches for P01–P03 and P08–P10. It appends status=passed for every other ID without a corresponding test:

| Unexecuted fixture | Missing check |
|---|---|
| P04 | Wrong tool name |
| P05 | Instruction-only evidence span |
| P06 | Zero/missing confidence |
| P07 | Deadline exceeded |
| P11 | Boundary plus humor candidate |
| P12 | Session reset/order independence |

The three additional gate assertions do not cover these missing checks. I executed the fixture function: it reports 12 base fixtures passed. Supplying a fixture with ID=UNIMPLEMENTED also returns status=passed. Python -O can additionally disable the assertions; this runner lacks the earlier __debug__ guard.

Fail on unknown fixture IDs, require the expected fixture set, execute every condition, and distinguish passed/failed/skipped explicitly. P11 is especially material because its expected veto is currently violated.

Source: [run_host_fixtures](https://github.com/dasilva333/airi/blob/133e5541b3/scripts/tests/rwkv-harness/experiments/nan0-pragmatic-benchmark-runner.py#L681).

**7. P2 — Timeout handling and diagnostics are not suitable for direct live reuse**

On timeout, close clears conn/process. Subsequent cases call probe without restarting the worker, so they can become AttributeError failures and then no_tool_call abstentions. close can also spend one second joining before killing a busy worker, extending the advertised deadline. The post-kill process is not explicitly joined. These findings follow from source inspection; I did not run new native inference.

Timeout/error responses are converted into abstentions by the host gate, and case records omit their full response/error context. This conceals whether the system saw no evidence or never completed inference.

For live work, use an explicit worker lifecycle: ready, busy, expired, restarting, disabled. Terminate and reap non-cancellable work within a documented cleanup budget. A failed job must remain a timeout/error in telemetry. Preload outside chat and measure cold startup separately.

The 119.73 ms value times agent.complete only, excluding reset, dispatch/queue, host processing, and logging. It is a single completion invocation, not literally one neural forward pass. There is no recorded end-to-end 5.1-second benchmark field. Keep the native result as useful device evidence; measure browser WASM separately before making browser latency claims.

Sources: [worker lifecycle](https://github.com/dasilva333/airi/blob/133e5541b3/scripts/tests/rwkv-harness/experiments/nan0-pragmatic-benchmark-runner.py#L617), [benchmark main](https://github.com/dasilva333/airi/blob/133e5541b3/scripts/tests/rwkv-harness/experiments/nan0-pragmatic-benchmark-runner.py#L824).

**8. The score does not validate replacement of the canonical emotional runtime**

The scorer checks three policy fields. It does not score irritation, rage, fear, distrust, amusement, curiosity, boredom, pride, or their magnitudes/decay. For example, F15B's insult target is an all-zero benchmark vector; identifying an insult versus ignoring it makes no difference to that score.

The actual emotional engine applies actor-specific rules, state-dependent headroom, history updates, and event deduplication. Its apology rule targets distrust, while the benchmark's self-apology lowers suspicion. The lexical resolver receives no actor identity. A direct transplant would change product behavior.

Use a shared neutral event representation and a versioned host policy mapping. Keep model/lexical evidence generation separate from the canonical state mutator. When an active replacement is eventually introduced, ensure the old regex and the new event path cannot both apply the same observation.

Source: [Nan0EmotionalDynamics.ts](https://github.com/dasilva333/airi/blob/133e5541b3/packages/nan0-runtime/src/emotional/Nan0EmotionalDynamics.ts).

**9. Recommended additional contrastive families**

Freeze this 33-case set as development/regression data. Have an independent author label fresh families before seeing the resulting rules, and keep whole families out of tuning and calibration.

| Family | Required contrasts |
|---|---|
| Scope composition | Positive, negated, double-negated, concessive, and correction forms for every actionable group—not only commitments. |
| Attribution and quotation | User statement versus actor quotation, forwarded chat, code/log/string literal, reported speech, and nested quotation. |
| Referents | Companion versus file, memory/cache object, third party, relative clause, and passive voice. |
| Boundaries and consent | Invitation then withdrawal; distress plus laughter; quoted invitation; refusal to be roasted; later reaffirmed consent. |
| Admissions | Deception versus fictional invention, mistaken belief, denied confession, historical confession, and new paraphrases. |
| Repairs | Correct linked task versus unrelated/stale/duplicate completion; multiple tasks; completed but not linked to a commitment. |
| Multiple events | Different polarities in different clauses; apology plus threat; affection plus boundary; event ordering and independent dimensions. |
| Context dependence | Identical target text with different attributed histories and gold evidence labels; include a context-sensitive outcome where policy warrants one. |
| Input variation | Typos, contractions, curly quotes, Unicode normalization, emoji, multilingual/code-switched input, long text, and truncation adjacent to a negator. |
| Runtime identity | Different actor/card/session; regenerated/edited turn; replay; worker timeout; stale completion after cancellation or card switch. |

Score event precision/recall, polarity, attribution, referent, and boundary violations separately from final policy. Add false reassurance/decreases and false attachment increases, not just false suspicion spikes. Report errors and coverage alongside abstentions and accuracy.

A claim of low false-update risk needs many independent relevant negatives. For illustration, zero errors in 300 independent negative examples gives an approximately 1% one-sided 95% binomial upper bound; the present development set does not satisfy those assumptions. Predefine the acceptable per-group error and coverage targets.

**10. Architecture decision**

Prefer strengthened lexical matching as the primary candidate for an eventual synchronous detector, after scope and policy fixes. Its low measured cost leaves no reason to optimize microseconds before correctness. It should emit evidence/candidate events synchronously and keep policy application independently controlled.

Do not make Needle a required production dependency for emotional interpretation on this evidence. Keep the current model experiment archived and optionally run a small sampled shadow challenger if open-vocabulary discovery is still a concrete research goal. A static shadow model does not learn by being observed. Its suggestions and disagreements are unverified candidates for human annotation; they must not automatically become labels, rules, or training examples.

Sample some ordinary traffic as well as disagreements/misses, otherwise the evaluation population becomes biased. Give the experiment an exit criterion: improved held-out event coverage at a fixed false-update budget. If it cannot deliver that incremental value, disable emotional probing without making claims about Needle's suitability for unrelated extraction tasks.

“Attention diffusion” and “no feed-forward layers” are not established explanations for these results. The submitted schema has 12 group enum values including none, not ten. The current Needle 2 model card describes a Hadamard MLP replacing the conventional FFN. Pin the exact engine/model revision before making architecture claims; a flat-schema failure does not measure the cause. [Needle 2 model card](https://huggingface.co/Cactus-Compute/needle2).

**11. Shadow wiring contract and monitoring**

Yes: build the isolated shadow adapter next. Semantic perfection is not required to collect diagnostic proposals. Before enabling it in real chats, restore truthful fixture/error reporting and prove application-level isolation and bounded resource use. This Python benchmark's zero vectors are not proof of stage-ui prompt/state invariance.

Keep inference and telemetry serialization outside the awaited chat critical path. Pass an immutable bounded snapshot to a worker, with no Pinia stores, state setter, prompt injection callback, or canonical event ingestion capability. Start with one active job and one replaceable latest pending snapshot. Use a provisional 500 ms warm total deadline including queue time; tune against actual target-browser measurements. Preload separately and skip probes while cold rather than delay chat.

All effective dimensions must remain zero and all effective actions none, including dimensions added later. The shadow envelope must be independent of candidate content. Run the real enabled/disabled prompt and persistent-state comparison with identical inputs and controlled clocks/IDs, and include failures, cancellation, streaming, tool turns, session/card switches, and regeneration. Existing production behavior may still mutate state through its own path; the test must prove zero additional effect attributable to the reflex.

Suggested telemetry:

| Category | Fields / watermarks |
|---|---|
| Identity | Session/card IDs, input turn ID, monotonic turn sequence, generation/cancellation epoch, input snapshot digest. |
| Versioning | Rule/policy/schema versions, actor-mapping version, actual engine/model digest, SDK/backend, calibration identifier and threshold. |
| Consumption | last_seen_seq, last_dispatched_seq, last_published_seq per session/card/epoch; counts of replaced pending jobs, duplicates, stale drops, and expired results. These are telemetry consumption markers, not affect-application receipts. |
| Evidence | Rule IDs or predicted groups, source spans/offset units, predicted scope/referent, validation status/rejection reason, relevant trusted event IDs. |
| Outcomes | Proposed lexical and model vectors, accepted/abstained/error/timeout status, zero effective vectors/actions, invariant violations. |
| Timing | Queue, reset, inference, host resolution, serialization, total wall time, timeout cleanup, and separate cold initialization. |
| Resource use | Active/pending count, worker restarts, CPU/wall duty, memory where measurable, buffer bytes and dropped-record count. |
| Model diagnostics | Raw confidence and validation flags; full raw response only in bounded opt-in diagnostic capture. |
| Evaluation | Random-sample inclusion probability, human annotation version, disagreements, per-group precision/recall and coverage after adjudication. |

Use source sequence plus cancellation epoch for stale detection, not wall-clock timestamps. Key duplicates by source event and policy/schema version. Cap diagnostic buffers by both record count and bytes; a provisional local ring of 500 events or 1 MiB is a reasonable starting limit. Keep raw conversation capture off by default; hashes and offsets are enough for ordinary performance telemetry, with explicit bounded source capture for adjudication.

Any nonzero effective output or reflex-attributable prompt/state difference should disable the feature and record an invariant failure. Do not turn an isolated classifier failure into a user-visible chat failure.

**12. Integration priorities**

1. Restore all executable host fixtures and reject unknown IDs; preserve assertion execution.
2. Repair strict response validation, positive-scope acceptance, task linkage, and the final boundary veto.
3. Centralize the envelope/validation/policy contract instead of maintaining divergent copies in successive benchmark runners.
4. Add worker timeout/restart/error preservation and full response/confidence/end-to-end timing.
5. Define the canonical event-to-emotion mapping and actor resolution explicitly; do not map integer benchmark steps directly onto runtime magnitudes.
6. Build the worker-isolated shadow adapter and test its actual prompts, stores, persistence, cancellation, and consumption watermarks.
7. Freeze fresh independently annotated test families before further rule tuning or model schema changes.

Precompile bounded patterns, preserve original offsets when normalizing Unicode, cap input and output size, and escape user-configured literal phrases. Do not introduce unrestricted user-supplied regex into the chat main thread. Ambiguous or truncated evidence should abstain. No further micro-optimization is justified by the current 24.6-microsecond measurement.

**Verification record**

Executed the committed lexical resolver on 33 existing cases, recomputed all saved metrics, checked all 33 effective policies, executed 11 lexical counterexamples, exercised 11 malformed/unresolved host-response cases, and ran the fixture reporting function including an unknown fixture ID. All proposed host failures stayed behind the zero effective envelope. No new model benchmark, browser integration test, or production rollout was performed. The existing repository working tree was preserved.

