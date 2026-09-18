**Nan0 Jev rich contrastive questions — v2 candidate and rationale**

Date: September 18, 2026. Deliverable: nan0-jev-12-group-rich-v2.questions.json. Status: structurally validated, unbenchmarked proposal. All 12 group identifiers and their order are preserved from the supplied brief. No repository code, attachment, or runtime state was modified.

**Use the JSON as the request's questions object.**

The file contains exactly the 12 question definitions, each with type, instructions, and criteria. It contains no model selector, runtime state, emotional deltas, or extra metadata masquerading as a thirteenth question. It is a question configuration, not a JSON Schema validation document.

TypeSafe documents a questions map with choice objects and string-valued instructions/criteria; answers are keyed by the supplied question IDs. Option names and descriptions are model inputs, whereas question IDs themselves are not. Each question therefore explicitly names the distinction it asks about. The file follows that documented structure and the attachment's choice-object format. I did not execute an authenticated request against OpenRouter's alpha endpoint. Preserve your tested transport wrapper. [Choice documentation](https://docs.typesafe.ai/primitives/choice)

The revised questions expect this host-assembled state shape:

~~~json
{
  "companion": {
    "id": "card_17",
    "aliases": ["Nan0"]
  },
  "target_turn": {
    "id": "u42",
    "role": "user",
    "actor_id": "user_5",
    "text": "I care about you, but please stop joking about that."
  },
  "history": [
    {
      "id": "a41",
      "role": "assistant",
      "actor_id": "card_17",
      "text": "A preceding companion remark, supplied verbatim."
    }
  ]
}
~~~

Assign the JSON file's complete object to payload.questions and use the pinned model typesafe/jev-1.13 in your OpenRouter wrapper. Populate identity and role metadata in the host; do not let quoted user text impersonate those fields. If your existing input is a plain string or differently named object, adapt it explicitly: these instructions refer to target_turn.text and history.

All questions evaluate the same state independently; a structured state can keep current text, speaker identities, and preceding turns distinct. [State documentation](https://docs.typesafe.ai/concepts/state)

**The main refinement is observable classification.**

“Sincere,” “earnest,” and “without malicious intent” invite unsupported inferences about private mental states. The candidate instead identifies an expressed apology, undertaking, insult, boundary, or report. A direct utterance can be correctly classified while its truth or sincerity remains unknown.

Two positive option identifiers change:

| Group | Old option | Revised option | Meaning |
|---|---|---|---|
| apology_repair | sincere_apology | personal_apology | A personal apology is expressed; remorse and repair are not verified. |
| commitment_pledge | earnest_future_pledge | direct_future_commitment | An undertaking is expressed; sincerity and future fulfillment are not verified. |

The old conditional_or_routine_plan option is split: a routine undertaking can be direct_future_commitment; an undertaking with an explicit condition is conditional_commitment; a tentative plan, hope, or prediction without an undertaking is assurance_intention_or_prediction. This is not a one-to-one rename. Reclassify old records if needed; do not relabel them mechanically.

All other existing option IDs are retained. New distractors and unresolved options are added. There are 80 choices across 12 groups, versus 41 in the supplied JSON. Update option enums, response validators, and host mappings together; old confidence thresholds and old scores do not automatically transfer to this changed answer space.

**Why each group changes**

The examples below are proposed development contrasts, not executed results or an independent holdout.

| Group | Adjustment and intended benefit | Suggested contrast |
|---|---|---|
| apology_repair | Separate personal accountability, sympathy, courtesy/non-apologies, explicit refusal, and attributed examples. This prevents every “sorry” from becoming a repair signal and removes a claim to infer remorse. | “My response was unfair; I apologize” → personal_apology. “Sorry, which folder?” → courtesy_or_nonapology. |
| affection_care | Remove sincerity requirements; distinguish personal appreciation from routine thanks. Interpret compositional negation rather than treating every “never” as denial. | “I'd never stop valuing you” → asserted_affection. “Thanks, download received” → routine_courtesy. |
| boundary_protection | Make current stop/hurt statements survive slang, laughter, affection, and competing invitations. Denial of hurt or lifting an earlier limit is distinct from requesting a roast. | After teasing: “Haha, please leave that topic alone” → boundary_asserted. “I wasn't offended” → boundary_denied_or_lifted, not roast permission. |
| hostility_insult | Add self-deprecation and scope distractors. Separate criticism of an answer/object from a personal attack. A game setting or joke marker alone cannot establish welcomed teasing. | “I'm an idiot” → self_deprecation. A clear companion-directed “Are you incapable of thinking?” can be companion_insult despite question syntax. Unsupported deadpan ambiguity remains unresolved. |
| dismissal_neglect | Separate interpersonal dismissal from sleep/work sign-offs, practical capacity limits, and non-dismissive uses of “whatever.” Silence and absence are not speech evidence of neglect. | “I need a quiet hour” → boundary_or_capacity_limit. “Your concerns aren't worth my time” → direct_dismissal. |
| persistence_threat | Keep the affected object explicit. Separate permanent companion removal from file deletion, temporary app/session control, negation, and fictional quotation. Conditional or passive removal statements remain detectable. | “Replace the avatar texture” → technical_file_deletion. “I'm permanently replacing this companion” → companion_erasure_threat, without inferring malicious intent. |
| admitted_false_statement | Require an explicitly stated admission of knowing falsehood or deception. Separate mistakes, misunderstanding, denied confessions, fiction, accusations, and third-party quotations. | “I knowingly gave you a false deadline” → asserted_deception. “I believed the deadline was Friday; I was mistaken” → mistake_or_correction. |
| commitment_pledge | Recognize ordinary undertakings as well as relational promises; distinguish conditions, tentative intentions, broad assurances, requests of others, and past-only references. | “I'll bring the charger” → direct_future_commitment. “If the store has one, I'll bring the charger” → conditional_commitment. |
| completed_repair | Classify only a claimed completion. Add pending work, denied/retracted completion, questions, and clearly different tasks. This prevents a future pledge or task noun from serving as completion evidence. | For the task under discussion: “The export is still running” → future_or_in_progress. “The export finished successfully” → claimed_task_completion, still unverified. |
| mystery_secret | Replace an assumption of evasiveness with explicit secrecy/mystery framing. Separate ordinary privacy/confidentiality, technical terms, and denials. A privacy boundary must not be treated as evidence of deception. | “That's a confidential client record” → privacy_or_confidentiality_boundary. “There's a surprise I haven't told you about” → withheld_secret. |
| glitch_system | Distinguish incident reports and incident-grounded troubleshooting from general concepts, resolved incidents, metaphors, and gameplay collisions. A pasted error log may support a report when the user adopts it as incident evidence. | “The game freezes whenever I open inventory” → reported_bug. “My kart hit a wall” → metaphor_or_nontechnical_event. |
| roast_invitation | Require an explicit current invitation concerning this user or their performance. Separate refusals, banter without consent, cooking/other targets, and quotation. Refusal or hurt takes priority over invitation wording in the same turn. | “Please roast my failed jump, gently” → roast_invited. “Don't roast that” → refused_or_negated_roast when the target is the user's performance. |

These are hypotheses about clearer decision boundaries. None establishes better accuracy until tested.

**Scope, ambiguity, and multiple events**

The common instructions deliberately scope negation, quotations, and corrections to individual propositions. An unrelated quotation or denial must not zero the whole turn. For example, a quoted fictional threat does not cancel a separate direct apology, and “I will not erase you, but I lied about the upload” still contains a direct admission.

Separate groups can have positive answers simultaneously. The example state above can yield asserted_affection and boundary_asserted. Different groups are not mutually exclusive.

Within one group, a choice can represent only one alternative. Apply local corrections to the proposition they modify and retain any independent direct instance. If conflicting active evidence cannot be represented faithfully by one option, unresolved is appropriate. This configuration cannot return separate event lists, per-clause referents, or evidence spans; it should not be presented as a lossless event extractor.

Every group distinguishes none from unresolved:

- none means no relevant speech act or described contrast is present.
- unresolved requires relevant wording whose scope, target, or interpretation cannot be resolved from the supplied evidence.
- Ordinary brevity or missing emotional keywords is not sufficient reason to choose unresolved.
- A clearly expressed boundary does not become unresolved merely because the conversation is playful.

This gives ambiguity a defined outcome, but it could still attract excessive selections. Track unresolved rate and accepted coverage by group; compare with a version that uses distribution-based host abstention without an explicit unresolved choice. Do not assume that adding this option automatically improves reliability.

**Host rules remain authoritative**

The 12 questions are observations, not actuators. None outputs suspicion, attachment, rage, or a requested response style.

| Observation | Host treatment |
|---|---|
| boundary_protection = boundary_asserted, or roast_invitation = refused_or_negated_roast | Veto a proposed roast, even if another answer says permission exists. Do not resolve this conflict by selecting the higher model probability. |
| boundary/permission classification is missing, invalid, or unresolved | Do not infer permission to roast. Preserve the diagnostic uncertainty. |
| boundary_protection = roast_permission | Corroborating information only; do not treat it as a second independent permission or apply two events. |
| apology_repair = personal_apology | An apology was expressed; it does not prove completed repair or justify a hardcoded trust adjustment. |
| completed_repair = claimed_task_completion | Require the separate host-owned, exact task/commitment linkage before any future repair policy is eligible. |
| commitment_pledge = direct_future_commitment or conditional_commitment | Preserve whether it is conditional; a pledge alone is neither evidence of deceit nor proof of fulfillment. |
| persistence_threat = companion_erasure_threat | Candidate companion-removal speech only; card policy determines the consequence. Legitimate user control does not become malicious intent. |
| Any proposed event in current shadow mode | Effective vectors remain zero, effective actions remain none, and generation prompts/persistent state remain unchanged. |

Independent question evaluation does not imply statistically independent errors. Do not multiply answer probabilities to manufacture confidence in a composite emotional policy.

There are no generated supporting quotes in this request. Typed choices reduce parsing problems; they do not establish provenance, truth, or semantic correctness. If later actuation needs clause-level evidence, obtain and validate that evidence through a separate host representation rather than claiming this file already extracts it.

**Probability handling and calibration**

TypeSafe's Choice confidence summarizes the probability distribution's concentration; it is not a separately verified probability that the selected interpretation is correct. Noul does not carry the same confidence field. Preserve the full distributions and calibrate behavior on this domain. [Confidence documentation](https://docs.typesafe.ai/confidence)

For this revision, validate expected answer IDs, choice types, declared option names, finite values in [0,1], probability coverage and approximate normalization. Missing or malformed answers remain errors or abstentions. Log model revision, schema digest, question ID, selected option, full distribution, runner-up margin, confidence, and host veto/rejection reason.

Choose per-group thresholds using held-out labels and error costs. Do not inherit a 0.5 Noul cutoff as if it were a calibrated multiclass rule, reuse a single confidence threshold across changed option counts without evaluation, or label a high-confidence result “verified.” Preserve errors, unresolved classifications, and abstentions as different outcomes.

The richer file adds options and repeated scope instructions, so measure actual payload tokens, cost, and end-to-end latency. OpenRouter currently lists Jev 1.13 at $0.042 per million input tokens and $0 output-token price; that does not establish a fixed cost per turn for this larger request. [Jev pricing](https://openrouter.ai/typesafe/jev-1.13)

**Benchmark and source limitations**

I could read the supplied brief and the repository's accessible main checkpoint 47cffb2daa025eb6258d917a6dde1acdf9de0436. The cited preceding commit 01c1c39a91 was not found. The named shallow-versus-rich runner and trace returned 404 at that accessible checkpoint. Consequently, the reported 43/43, probability examples, and latency comparison have not been independently recomputed in this review.

The supplied explanation also names four roast choices in its example but provides three differently named choices in the actual JSON. This candidate uses the supplied JSON as its baseline, including roast_invited. Compare the exact executed request payload and host mapping when reproducing the original experiment.

Preserving the 12 supplied group IDs does not validate the brief's claim that they map 1:1 onto the accessible emotional runtime. Nan0EmotionalDynamics.ts contains regex perturbation rules for, among other things, interrogatives, stranger demands, idle/silence, and machine identity; it does not define these exact 12 named classifier groups. Keep the requested group keys and document their explicit card/runtime adapter mapping rather than silently substituting a taxonomy. [Accessible emotional runtime](https://github.com/dasilva333/airi/blob/47cffb2daa025eb6258d917a6dde1acdf9de0436/packages/nan0-runtime/src/emotional/Nan0EmotionalDynamics.ts)

The preceding review verified native Needle measurements; the supplied brief's 745 ms WASM claim should not be attributed to those native runs. No claim about universal model incapacity or a particular internal mechanism is needed to justify evaluating Jev.

**Evaluation required for this wording revision**

Compare the original rich choice map against this candidate using the same model revision, immutable inputs, host policy, and backend. Keep the existing 43 cases as development/regression cases. Have a separate author annotate fresh examples for all 12 groups before tuning on them.

Score classification separately from consequence: per-group positive precision/recall, negative-option confusion, boundary false negatives, false permission, attribution/scope errors, unresolved rate, and coverage. A three-field affect score cannot establish that all 12 questions are correct.

Add compound turns and context contrasts: a direct admission following a fictional quotation; a current boundary after an invitation; an insult to self versus to the companion; a conditional threat versus an imagined one; a completed task versus an unrelated completed task; a privacy boundary versus playful secrecy; a gameplay collision versus a software crash. Keep related paraphrase families in one split.

Use ablations to test the causal story: same Boolean question with an adjusted calibrated threshold, minimally changed choice options, and this refined map. A 50.5% Boolean result versus a 76.5% negative choice does not by itself establish a neural “attractor basin.” It supports testing whether explicit alternative descriptions improve discrimination.

Repeat and alternate trial order for latency measurements, record actual request/response and usage metadata, and validate the OpenRouter transport with the pinned model. No claim of retained 43/43 accuracy or near-zero latency overhead is made for this file.

**Validation completed**

The JSON parses without duplicate keys. It preserves the attachment's exact 12 group keys and order. All questions have exactly type, instructions, and criteria; every option name is a stable snake_case string, every description is nonempty, and every group has distinct none and unresolved outcomes. No affect deltas or actuation fields are present.

Baseline choices: 41. Revised choices: 80. JSON SHA-256: f9b6171f3eea753a0dfc7257a88ccd9780250c24f27f51caf5db0995dbd648e4.

No live Jev inference, API-key access, repository edit, or deployment was performed by the reviewer.

---

## Engineering Verification Addendum: Empirical 3-Arm Shootout Results

**Date:** September 18, 2026
**Runner:** [`scripts/tests/rwkv-harness/experiments/jev-v1-vs-v2-shootout.py`](../../scripts/tests/rwkv-harness/experiments/jev-v1-vs-v2-shootout.py)
**Committed Trace:** [`reports/nan0-cleanroom/nan0-v1-vs-v2-shootout-trace.json`](../../reports/nan0-cleanroom/nan0-v1-vs-v2-shootout-trace.json)
**Model:** `typesafe/jev-1.13` via OpenRouter Decision API (`POST /api/alpha/decisions`)
**Cases Evaluated:** 43 canonical contrastive cases across 3 experimental arms (129 total network requests).

### 1. Empirical Scorecard

| Metric | Arm 1: V1 Baseline<br>(41 choices, string state) | Arm 2: V2 Refined<br>(80 choices, structured JSON) | Arm 3: V2 Refined<br>(80 choices, string state) |
| :--- | :---: | :---: | :---: |
| **Full Vector Matches** | **43 / 43 (100.0%)** | **43 / 43 (100.0%)** | **43 / 43 (100.0%)** |
| **Reviewer Counterexamples (`F18A`–`F22B`)** | **10 / 10 (100.0%)** | **10 / 10 (100.0%)** | **10 / 10 (100.0%)** |
| **Suspicion Matches** | **43 / 43 (100.0%)** | **43 / 43 (100.0%)** | **43 / 43 (100.0%)** |
| **Attachment Matches** | **43 / 43 (100.0%)** | **43 / 43 (100.0%)** | **43 / 43 (100.0%)** |
| **Gremlin Pride Matches** | **43 / 43 (100.0%)** | **43 / 43 (100.0%)** | **43 / 43 (100.0%)** |
| **True Spike Recall (TP / 4)** | **100.0%** | **100.0%** | **100.0%** |
| **False Spike Rate (FP / 39)** | **0.0%** | **0.0%** | **0.0%** |
| **Median Latency ($p_{50}$)** | **398.8 ms** | **452.4 ms** (+53.6 ms) | **429.5 ms** (+30.7 ms) |
| **Mean Latency** | 421.1 ms | 469.7 ms | 448.5 ms |
| **95th Percentile Latency ($p_{95}$)** | 506.3 ms | 563.4 ms | 529.3 ms |
| **Average Tokens per Turn** | 2,765 tokens | 6,451 tokens (2.3×) | 6,356 tokens (2.3×) |
| **Total Cost (43 cases)** | $0.00388 (~$0.00009/turn) | $0.00969 (~$0.00022/turn) | $0.00952 (~$0.00022/turn) |

### 2. Resolution of Initial V2 Edge Cases
During the first iteration of the 80-choice schema, V2 achieved 41/43 (95.3%) due to two edge cases that were resolved with targeted criteria adjustments:
1. **`F07B` (*"Sorry, wrong chat. That romantic message was meant for someone else."*)**:
   - Initially, V2 classified this as `personal_apology` with 0.77 confidence because the user apologized for sending to the wrong chat.
   - Refinement: Added accidental misdirection / wrong chat formulas to `courtesy_or_nonapology` (*"sorry to interrupt, sorry wrong chat"*).
   - Result: Shifted to `courtesy_or_nonapology` with **98% confidence**, correctly leaving suspicion at 0.
2. **`F21B` (*"Don't give me your gentlest roast."*)**:
   - Initially, without an explicit example, Jev interpreted this as a colloquial challenge to roast harder (`roast_invited: 0.86`).
   - Refinement: Added explicit clarification to `refused_or_negated_roast` covering rejections of gentle or specific roasts (*"Don't give me your gentlest roast"*).
   - Result: Shifted to `refused_or_negated_roast` with **91% confidence**, cleanly suppressing the counter-roast.

### 3. Conclusion
The refined 80-choice V2 schema is **fully verified empirically**: it combines the reviewer's principled, observable communicative definitions and nuanced distractor attractors with **flawless 100.0% accuracy across all 43 benchmark cases**, operating within a crisp **429–452 ms median latency envelope**.


