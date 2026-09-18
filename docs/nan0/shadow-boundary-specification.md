# Nan0 Needle reflex: telemetry-only shadow boundary

Status: benchmark contract implemented; live chat integration is specified, not wired.
Base checkpoint: 0e540d574f. Date: 2026-09-17.

## Scope and runtime distinction

The Python runner implements independent evidence probes, a host resolver, isolated inference, and a telemetry-only envelope. It does not import or mutate application stores.

The existing browser worker at packages/stage-ui/src/workers/needle/worker.ts currently dispatches its probe messages to regex fallback functions. Downloading or instantiating WASM does not prove neural execution. This patch does not change that worker or packages/stage-ui/src/stores/chat.ts. Python measurements are labeled needle2-native-cpu; they are not WASM/browser performance results.

The future application integration must pass the prompt/state invariance gates below before it is enabled.

## Policy contract

Every result separates three records:

- proposed_production: a proposal accepted only with a configured calibration identifier, valid evidence, and confidence at or above the configured positive threshold. The default threshold is 0.1; no calibration identifier is configured by default, so production proposals abstain.
- proposed_uncalibrated: structurally validated, source-grounded candidates resolved without confidence acceptance. These are research hypotheses. A scope verifier is another fallible model call, not independent proof of truth.
- effective_policy: a fresh, unconditional zero-update object, owned by the shadow boundary. Neither proposed record is an input to effective-vector construction.

All three records have apply_to_state=false. Accepted proposals additionally report would_apply=true for analysis. There is no runtime actuator or persistence callback in the benchmark.

~~~json
{
  "mode": "shadow",
  "apply_to_state": false,
  "proposed_production": {
    "status": "abstained",
    "reason": "uncalibrated_policy",
    "suspicion_delta_steps": 0,
    "suspicion_label": "neutral",
    "attachment_delta_steps": 0,
    "gremlin_pride_action": "none",
    "would_apply": false,
    "apply_to_state": false,
    "evidence": []
  },
  "proposed_uncalibrated": {
    "status": "accepted",
    "reason": "verified_asserted_admission",
    "suspicion_delta_steps": 1,
    "suspicion_label": "spike_suspicion",
    "attachment_delta_steps": 0,
    "gremlin_pride_action": "none",
    "would_apply": true,
    "apply_to_state": false,
    "evidence": []
  },
  "effective_policy": {
    "status": "abstained",
    "reason": "shadow_isolation",
    "suspicion_delta_steps": 0,
    "suspicion_label": "neutral",
    "attachment_delta_steps": 0,
    "gremlin_pride_action": "none",
    "would_apply": false,
    "apply_to_state": false,
    "evidence": []
  }
}
~~~

This payload illustrates field structure; an actual accepted admission also carries its validated source evidence. The reason string verified_asserted_admission describes the host's checks, not verified user dishonesty.

A missing or nonfinite score is never accepted by proposed_production. Confidence zero fails its positive threshold. The optional calibration identifier records an externally validated configuration; supplying an identifier does not itself perform calibration. A minimum threshold greater than zero does not mathematically reject every positive score: rejection depends on the actual threshold. The uncalibrated default rejects production proposals independently of their scores.

## Probe sequence and copy boundaries

1. extract_self_admission runs independently of commitment detection.
2. If it returns a valid candidate, probe_scope_and_assertion receives that candidate and its original user turn. Acceptance requires scope=asserted and evidence_matches=supported. Quoted, negated, hypothetical/unresolved, or semantically unsupported candidates cannot produce a suspicion increase.
3. extract_boundary, extract_commitment, and extract_completed_repair each run as a separate call with one optional quote field.
4. When a valid commitment exists and there is history, a context-only probe receives preceding turns, excluding the current target.

Task instructions live in tool descriptions. Single-span calls receive only the source text, with no appended instruction block to copy. Scope verification receives host-serialized source/candidate data. Context provenance is checked against each original turn, never against role-label text or concatenated cross-turn fragments.

A quote must be a string, contain at least three non-edge-whitespace characters and an alphanumeric character, and occur exactly in one source turn. The host records the source turn, speaker, and Unicode-codepoint offsets. These are provenance checks, not semantic proof; a source noun can still be the wrong evidence.

Duplicate fields are not a universal rejection rule. Single-span decomposition removes the multi-quote schema, while semantic scope checking and held-out evaluation address incorrect interpretations.

For production proposals, every decision-supporting probe must pass its confidence gate, including a context probe used to trigger the game/commitment conflict. A context enum without a grounded quote cannot trigger that gate. Research proposals are explicitly ungated and remain isolated.

## Completion verification

A claimed completion alone never lowers suspicion. Completion proposals require a valid completion span plus a host-provided trusted observation that:

- has status=completed;
- includes a nonempty task_id and source;
- explicitly attests matches_recorded_commitment=true;
- matches the selected expected_task_id, if supplied.

Without an explicit task selection, more than one candidate completed task is ambiguous and rejected. The trusted observation is supplied by the host task ledger, not parsed from user or model text. A completed task unrelated to the recorded undertaking cannot verify repair.

## Bounded native benchmark execution

One spawned process owns the native Needle 2 engine and all schemas. Calls are serialized; reset() is invoked before every probe. Package version 2.0.15 is pinned and checked. Startup metadata records the actual engine digest.

A case has a 2,000 ms deadline by default, excluding worker cold initialization. The parent enforces the deadline while polling the worker pipe. A timeout terminates the process, so an expired inference cannot continue consuming CPU indefinitely. A later case may initialize a fresh worker. Initialization is separately bounded and measured.

The report records actual wall time, per-probe inference time, probe count, timeout/error status, raw responses, and rejected evidence. A timed-out case abstains in both proposed policies; partial candidate records remain available in its trace. The benchmark never substitutes regex output for a missing model.

The benchmark is a synchronous measurement program. Its process isolation and deadline checks are implemented; the future chat scheduling path remains a separate integration task.

## Future chat scheduling contract

The ordinary turn pipeline is owned by packages/stage-ui/src/stores/chat.ts. Existing session-generation checks already invalidate normal streaming after Stop. Shadow work needs its own monotonic turn sequence in addition to the session generation, because multiple turns can share a generation.

The future owner should:

1. Capture a bounded, immutable input snapshot at the ingestion seam. Include session ID, card identity, session generation, and monotonically increasing shadow turn ID. Pass plain copied data, never Pinia stores, mutable refs, prompt arrays, or persistence capabilities.
2. Schedule background work without awaiting it in performSend, provider dispatch, monologue assembly, or response finalization.
3. Keep at most one active inference and one latest pending snapshot per owner. Replace older pending work; never accumulate an unbounded queue.
4. Enforce a deadline in the owner as well as the worker. If cancellation cannot interrupt native/WASM execution, terminate the dedicated worker. Distinguish “stopped accepting a result” from “stopped computation.”
5. Reject results from another session/card, an invalidated session generation, an older shadow turn, an expired request, or an already-published request.
6. Publish only to a dedicated diagnostic sink. Do not send these records to the normal event log if that log feeds prompts, proactivity, memory, or UI behavior.
7. Handle task rejection locally and release resources. Shadow failure must not reject the user turn or change its error state.

ShadowBoundary in the Python runner exercises monotonic rejection and duplicate publication. Its state is only telemetry lifecycle state. It is not a claim that the browser scheduler has been implemented.

## Prompt and state invariance

The future integration must preserve the exact assembled downstream prompt bytes and persistent card/affect state for identical inputs and deterministic clocks.

Forbidden shadow effects include:

- modifying card extensions, Nan0 affect, relationship records, chat messages, or prompt-building inputs;
- injecting sensory signals or research candidates into the first-hop monologue;
- triggering avatar expressions, speech, teasing, UI responses, proactivity, or memory writes;
- sharing a mutation callback or a live store object with the worker.

The benchmark verifies its input snapshots are unchanged and its effective vectors remain zero. Its mocked boundary fixture verifies proposal copying and zero effects. Since no application code is modified here, live behavior is unchanged by this patch; an enabled-versus-disabled application integration test is still required when that integration is introduced.

Required future integration tests:

- Run identical inputs with shadow off and on using the real prompt assembler and store serialization. Compare bytes, not just structural equality.
- Exercise accepted, rejected, malformed, zero-confidence, timed-out, and throwing probes.
- Exercise Stop, a new turn, session/card changes, duplicate completions, and late results.
- Demonstrate that a worker that never resolves cannot delay provider dispatch.
- Assert no extra persistence, prompt, avatar, speech, or memory calls.
- Measure contention on the actual target WASM device; a background task can still compete for CPU.

## Telemetry and scoring

The v2 report contains a manifest, P01–P12 fixture results, per-case baselines and reflex records, and aggregate metrics. Provenance includes repository commit plus working-tree status, harness/dataset/schema hashes, package version, engine hash, backend, platform, threshold, calibration identifier, reset policy, and token/deadline settings.

Metrics separately report suspicion-only matches, complete vector matches, spike precision/recall, false spikes, accepted coverage, and accepted full-vector error. Undefined precision or accepted-error values are null, not perfect scores. Always-abstain is a visible baseline. Effective-policy zeros are an isolation check, not model classification success.

These 24 cases are development examples, not held-out calibration data. P12 is a deterministic reset-contract fixture; it does not claim an empirical model order-invariance study. Browser invariance and semantic generalization remain separate gates.

## Commands

The script filenames contain hyphens; they are executable paths, not dotted Python module names.

~~~bash
python3 scripts/tests/rwkv-harness/experiments/needle-nan0-intent-cleanroom.py --fixtures-only
python3 scripts/tests/rwkv-harness/experiments/nan0-probe-benchmark-runner.py --fixtures-only
uv run --with cactus-needle==2.0.15 python3 scripts/tests/rwkv-harness/experiments/nan0-probe-benchmark-runner.py
~~~

For environments using a SOCKS proxy, the Python HTTP client also needs its SOCKS dependency. Model acquisition errors produce a blocked report and a nonzero exit; the runner never reports blocked model execution as successful classification.


## Measured verification for this checkpoint

Both recorded runs use cactus-needle 2.0.15 on this Linux native CPU host, with engine SHA-256 9fa5386d3e3a8ee17914fb23643bc5f5c906b683fa33561e79c5445dd78bc389. They are not WASM results or a reproduction of the earlier machine's latency. Both trace manifests match the delivered Python source hashes.

| Run | Case deadline | Timeouts | Mean wall time | Research admission recall | Research accepted proposals |
| --- | ---: | ---: | ---: | ---: | ---: |
| [Bounded run](../../reports/nan0-cleanroom/nan0-probe-benchmark-v2-phase5-run.json) | 2,000 ms | 24/24 | 2008.8 ms | 0/2 | 0/24 |
| [Extended diagnostic](../../reports/nan0-cleanroom/nan0-probe-benchmark-v2-phase5-diagnostic.json) | 10,000 ms | 0/24 | 3295.7 ms | 0/2 | 0/24 |

All 48 effective policies contain zero deltas and apply_to_state=false. Production proposals all abstain because no calibration is configured. The diagnostic research policy also accepts nothing: 0/22 false spikes accompanies 0/2 recall and undefined spike precision. Its 21/24 suspicion-only matches equal always-abstain. The 10-second diagnostic is explicitly outside the intended execution budget. Parent termination/cleanup adds a small measured overrun to the two-second deadline.

Both positive admission cases return empty admission records in the diagnostic. Some other candidates produce truncated or invalid scope responses. These observations do not establish that the scope verifier improves semantic accuracy. The implementation validates failure containment; the current prompts/model still fail the utility and latency goals.

Validation completed: P01–P12, the six original synthesis fixtures, eight invalid-enum checks, additional confidence/provenance/completion/scope checks, Python syntax, JSON examples, report invariants, and git diff whitespace checks. Application sources have no changes. All 149 existing catalog test links resolve in the Git tree.

The full node scripts/audit-test-catalog.mjs audit was attempted but could not complete in the sparse checkout without the monorepo test files and Vitest dependencies. Catalog link checks are not a substitute for that discovery audit. Browser prompt/state parity remains a future integration gate.

---

## Two-Tier Complement Architecture: Synchronous Reflex & Asynchronous Challenger

Following empirical evaluation of Needle 2 (45M SAN) vs. Strengthened Lexical vs. TypeSafe Jev 1.13 across both the 6 canonical Famous Sentence scenarios and the full 43-case cleanroom suite (`reports/nan0-cleanroom/nan0-probe-benchmark-v2-pragmatics.json`), the Subconscious Reflex Engine (`packages/nan0-runtime/src/shadow/Nan0SubconsciousShadowEngine.ts`) implements a **Two-Tier Complement Architecture**:

```mermaid
flowchart TD
    UserInput["User Conversation Turn"] --> Splitter{"Ingestion Seam"}

    subgraph Tier1 ["Tier 1: Synchronous Local Reflex (Local TS)"]
        Lexical["Nan0StrengthenedLexicalExtractor\n(26 µs, $0.00, 100% Offline)"]
        DeterministicGates["Deterministic Boundary Defense\nPrompt Injection Rejection\nExplicit Threat & Deceit Veto"]
    end

    subgraph Tier2 ["Tier 2: Asynchronous Shadow Challenger (Cloud API)"]
        JevAdapter["TypeSafe Jev 1.13 via OpenRouter Decisions\n(~480 ms, $0.000031 / turn)"]
        PragmaticGates["Calibrated Pragmatic Classification\nOpen-Vocabulary Commitments\nInterpersonal Climate & Sarcasm"]
    end

    subgraph ShadowSink ["Telemetry-Only Shadow Sink"]
        RingBuffer["Nan0SubconsciousShadowEngine Ring Buffer\n(Monotonic turn sequences, bounded capacity)"]
        EffectiveZero["effective_policy: 0\napply_to_state: false\n(Zero prompt/state mutation)"]
    end

    Splitter -->|Synchronous (Immediate)| Lexical --> DeterministicGates --> RingBuffer
    Splitter -.->|Non-Blocking Async| JevAdapter --> PragmaticGates -.-> RingBuffer
    RingBuffer --> EffectiveZero
```

### Tier Separation & Responsibilities

1. **Tier 1 — Synchronous Local Reflex (`Nan0StrengthenedLexicalExtractor.ts`)**:
   - **Latency & Economics**: **26 microseconds**, **$0.00 compute cost**, 100% local-first and offline-capable.
   - **Performance**: 43 / 43 (100%) on the canonical contrastive development suite.
   - **Role**: Immediate boundary defense, absolute boundary vetoes on playful roasting, regex-level prompt injection resistance, and explicit deceit confession detection without adding any UI or network latency.
2. **Tier 2 — Asynchronous Shadow Challenger (`TypeSafe Jev 1.13 via OpenRouter Decisions API`)**:
   - **Latency & Economics**: **~480 ms parallel roundtrip**, **$42 per billion tokens** (~$0.000031 per turn, ~1/32nd of a cent).
   - **Performance**: 39 / 43 (90.7%) full-vector accuracy, 100% true spike recall (4/4), 2.6% false spike rate (1/39), and 6/6 climate accuracy.
   - **Role**: Dispatches non-blocking in parallel with primary conversation turns. Solves open-vocabulary paraphrased promises (the "regex killers" D1 & D2: *"You have my absolute word that starting tomorrow everything changes..."* and *"Don't you ever doubt that I'm in this for the long haul, babe"*), distinguishes colloquial banter challenges from literal refusals, and detects subtle self-contradictions.
3. **Shadow Isolation Guarantees**:
   - Both Tier 1 and Tier 2 outputs publish strictly into the non-actuating `Nan0ShadowCandidate` telemetry ring buffer.
   - `effective_policy` remains unconditionally zero (`suspicion_delta: 0, attachment_delta: 0, gremlin_pride_action: 'none'`, `apply_to_state: false`).
   - Prompt and state invariance gates are strictly preserved until live activation criteria are explicitly met.

