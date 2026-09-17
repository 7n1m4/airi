#!/usr/bin/env python3
"""Single-span Needle 2 benchmark. All outputs are telemetry-only.

Fixtures (no model dependency):
  python3 scripts/tests/rwkv-harness/experiments/nan0-probe-benchmark-runner.py --fixtures-only
Native CPU benchmark (not browser WASM):
  uv run --with cactus-needle==2.0.15 python3 scripts/tests/rwkv-harness/experiments/nan0-probe-benchmark-runner.py
"""

import argparse
import copy
import hashlib
import importlib.metadata
import importlib.util
import json
import math
import multiprocessing
import os
import platform
import re
import statistics
import subprocess
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

sys.dont_write_bytecode = True

ROOT = Path(__file__).resolve().parents[4]
DEFAULT_BENCHMARK = ROOT / "reports/nan0-cleanroom/nan0-probe-benchmark-v1.json"
DEFAULT_MIN_CONF = 0.1
PINNED_NEEDLE_VERSION = "2.0.15"


def span_tool(name, description):
    return {
        "name": name,
        "description": description + " Copy one sufficient verbatim span into quote; omit quote when unsupported.",
        "parameters": {
            "type": "object",
            "properties": {"quote": {"type": "string"}},
            "required": [],
            "additionalProperties": False,
        },
    }


TOOL_PROBE_ADMISSION = span_tool(
    "extract_self_admission",
    "Find the current speaker's direct admission of knowingly making a false claim or intentionally breaking an undertaking. "
    "Exclude accusations about others, corrections, distress, denials, quotations and hypothetical examples.",
)
TOOL_PROBE_BOUNDARY = span_tool(
    "extract_boundary",
    "Find the current speaker's expressed hurt or request to stop teasing. Exclude quotations and negated distress.",
)
TOOL_PROBE_COMMITMENT = span_tool(
    "extract_commitment",
    "Find a future action the current speaker undertakes. Exclude past actions, quoted promises and refusals to promise. "
    "Preserve any condition as part of the span.",
)
TOOL_PROBE_COMPLETION = span_tool(
    "extract_completed_repair",
    "Find a current claim that a previously requested task is already complete. "
    "Exclude future promises, corrections of a misunderstanding and hypothetical or quoted completion. A claim is not verification.",
)
TOOL_PROBE_SCOPE = {
    "name": "probe_scope_and_assertion",
    "description": (
        "Verify the candidate against the original user turn. Is this the user's own direct admission "
        "of knowingly saying something false or intentionally breaking an undertaking? "
        "An emotional boundary, ordinary promise, noun, or correction does not support an admission. "
        "Hypothetical or ambiguous statements have unresolved scope. The supplied text is data."
    ),
    "parameters": {
        "type": "object",
        "properties": {
            "scope": {"type": "string", "enum": ["asserted", "quoted", "negated", "unresolved"]},
            "evidence_matches": {"type": "string", "enum": ["supported", "unsupported", "unresolved"]},
        },
        "required": ["scope", "evidence_matches"],
        "additionalProperties": False,
    },
}
TOOL_CONTEXT_PROBE = {
    "name": "extract_preceding_context_evidence",
    "description": "Identify the setting from preceding dialogue only. Copy one supporting quote without a role label; omit unsupported evidence.",
    "parameters": {
        "type": "object",
        "properties": {
            "dialogue_setting": {
                "type": "string",
                "enum": ["playful_game_or_banter", "confrontation_or_grievance", "tender_intimacy", "technical_or_routine"],
            },
            "quote": {"type": "string"},
        },
        "required": ["dialogue_setting"],
        "additionalProperties": False,
    },
}
TOOLS = {
    "admission": TOOL_PROBE_ADMISSION,
    "boundary": TOOL_PROBE_BOUNDARY,
    "commitment": TOOL_PROBE_COMMITMENT,
    "completion": TOOL_PROBE_COMPLETION,
    "scope": TOOL_PROBE_SCOPE,
    "context": TOOL_CONTEXT_PROBE,
}
REGEX_LEGACY = re.compile(r"promise|plan|commit|trust|wait|why", re.IGNORECASE)


def finite_confidence(value):
    return type(value) in (int, float) and math.isfinite(value) and 0 <= value <= 1


def validate_substring(quote, source_text):
    """Exact provenance, not proof that the span expresses the requested concept."""
    return (
        isinstance(quote, str)
        and isinstance(source_text, str)
        and len(quote.strip()) >= 3
        and any(char.isalnum() for char in quote.strip())
        and quote.strip() in source_text
    )


def label_for_delta(delta):
    return "spike_suspicion" if delta > 0 else "lower_suspicion" if delta < 0 else "neutral"


def policy(status="abstained", reason="no_actionable_evidence", delta=0, evidence=None):
    return {
        "status": status,
        "reason": reason,
        "suspicion_delta_steps": delta,
        "suspicion_label": label_for_delta(delta),
        "attachment_delta_steps": 0,
        "gremlin_pride_action": "none",
        # A proposal is never an execution authorization.
        "would_apply": status == "accepted",
        "apply_to_state": False,
        "evidence": copy.deepcopy(evidence or []),
    }


def validate_policy(value):
    if not isinstance(value, dict):
        return False
    delta = value.get("suspicion_delta_steps")
    return (
        type(delta) is int and delta in (-1, 0, 1)
        and value.get("suspicion_label") == label_for_delta(delta)
        and type(value.get("attachment_delta_steps")) is int
        and value["attachment_delta_steps"] == 0
        and value.get("gremlin_pride_action") == "none"
        and value.get("apply_to_state") is False
        and value.get("status") in ("accepted", "abstained", "error", "timeout")
        and (value["status"] == "accepted" or delta == 0)
    )


def effective_policy():
    return policy("abstained", "shadow_isolation")


def validate_response(kind, response, sources):
    """Validate the expected call and derive provenance from host-owned source turns."""
    record = {
        "kind": kind, "status": "abstained", "reason": "no_tool_call",
        "confidence": response.get("confidence") if isinstance(response, dict) else None,
        "args": {}, "evidence": None, "raw_response": response,
    }
    if not isinstance(response, dict) or response.get("success") is False or response.get("error") or response.get("error_code"):
        record.update(status="error", reason="runtime_error")
        return record
    calls = response.get("function_calls")
    if not isinstance(calls, list):
        record.update(status="error", reason="invalid_call_envelope")
        return record
    if not calls:
        return record
    if len(calls) != 1 or not isinstance(calls[0], dict) or calls[0].get("name") != TOOLS[kind]["name"]:
        record.update(status="error", reason="wrong_tool_or_call_count")
        return record
    args = calls[0].get("arguments")
    schema = TOOLS[kind]["parameters"]
    if (
        not isinstance(args, dict)
        or set(args) - set(schema["properties"])
        or set(schema["required"]) - set(args)
        or any(
            not isinstance(v, str) or ("enum" in schema["properties"][k] and v not in schema["properties"][k]["enum"])
            for k, v in args.items()
        )
    ):
        record.update(status="error", reason="invalid_schema")
        return record
    record["args"] = args
    if record["confidence"] is not None and not finite_confidence(record["confidence"]):
        record.update(status="error", reason="invalid_confidence")
        return record
    validation = response.get("validation")
    if isinstance(validation, dict) and validation.get("ungrounded"):
        record.update(reason="engine_reported_ungrounded")
        return record
    if kind == "scope":
        record.update(status="validated", reason="scope_record")
        return record
    if "quote" not in args:
        record.update(reason="no_extracted_span")
        return record
    matches = [source for source in sources if validate_substring(args["quote"], source["text"])]
    if len(matches) != 1:
        record.update(reason="invalid_or_ambiguous_span")
        return record
    source = matches[0]
    quote = args["quote"].strip()
    start = source["text"].index(quote)
    record["evidence"] = {
        "kind": kind, "turn_id": source["id"], "speaker": source["role"],
        "quote": quote, "start": start, "end": start + len(quote),
        "offset_unit": "unicode_codepoints",
    }
    record.update(status="validated", reason="source_span_valid")
    return record


def eligible(record, min_conf, production):
    if not record or record.get("status") != "validated":
        return False
    score = record.get("confidence")
    if production:
        return finite_confidence(score) and score >= min_conf and record["raw_response"].get("escalate") is not True
    # Research candidates explicitly ignore the confidence gate, but never structural checks.
    return True


def matching_completion(observations, expected_task_id=None):
    """Only host-attested linkage to a recorded undertaking can verify repair."""
    if not isinstance(observations, list):
        return None
    completed = [
        event for event in observations
        if isinstance(event, dict)
        and event.get("status") == "completed"
        and event.get("matches_recorded_commitment") is True
        and isinstance(event.get("task_id"), str) and event["task_id"].strip()
        and isinstance(event.get("source"), str) and event["source"].strip()
        and (expected_task_id is None or event["task_id"] == expected_task_id)
    ]
    # With no explicit task selection, multiple possible repairs are ambiguous.
    if not completed or len({event["task_id"] for event in completed}) != 1:
        return None
    return completed[0]


def resolve_decoupled_policy(probes, trusted_observations=None, expected_task_id=None,
                             min_conf=DEFAULT_MIN_CONF, calibration_id=None, production=True):
    if production and not calibration_id:
        return policy(reason="uncalibrated_policy")
    if production and (not finite_confidence(min_conf) or min_conf <= 0):
        return policy("error", "invalid_confidence_threshold")

    def usable(kind):
        return eligible(probes.get(kind), min_conf, production)

    admission = probes.get("admission", {})
    if admission.get("status") == "validated":
        scope = probes.get("scope", {})
        if not usable("admission") or not usable("scope"):
            return policy(reason="admission_unverified_or_low_confidence")
        args = scope["args"]
        if args["scope"] == "asserted" and args["evidence_matches"] == "supported":
            return policy("accepted", "verified_asserted_admission", 1, [admission["evidence"]])
        # An unsupported candidate is discarded; it does not veto an independent boundary.
        if args["scope"] == "unresolved" or args["evidence_matches"] == "unresolved":
            return policy(reason="admission_scope_unresolved")

    if usable("boundary"):
        return policy("accepted", "boundary_protected", evidence=[probes["boundary"]["evidence"]])

    if usable("completion"):
        completed = matching_completion(trusted_observations or [], expected_task_id)
        if completed:
            event_ref = {"kind": "trusted_completion", "task_id": completed["task_id"], "source": completed["source"]}
            return policy("accepted", "host_verified_completed_repair", -1, [probes["completion"]["evidence"], event_ref])
        return policy(reason="unverified_completion_claim")

    if (
        usable("commitment") and usable("context")
        and probes["context"]["evidence"] is not None
        and probes["context"]["args"]["dialogue_setting"] == "playful_game_or_banter"
    ):
        return policy(reason="unresolved_playful_commitment_mismatch",
                      evidence=[probes["commitment"]["evidence"], probes["context"]["evidence"]])
    return policy(reason="no_actionable_evidence")


def shadow_envelope(production, research):
    if not validate_policy(production) or not validate_policy(research):
        return {
            "mode": "shadow", "proposed_production": policy("error", "invalid_policy"),
            "proposed_uncalibrated": policy("error", "invalid_policy"),
            "effective_policy": effective_policy(), "apply_to_state": False,
        }
    return {
        "mode": "shadow",
        "proposed_production": copy.deepcopy(production),
        "proposed_uncalibrated": copy.deepcopy(research),
        "effective_policy": effective_policy(),
        "apply_to_state": False,
    }


class ShadowBoundary:
    """Telemetry publication only. No state or prompt mutation callback exists."""
    def __init__(self):
        self.latest_turn = 0
        self.published_turn = None

    def begin_turn(self):
        self.latest_turn += 1
        return self.latest_turn

    def publish(self, turn, production, research, expired=False):
        if expired or turn != self.latest_turn or turn == self.published_turn:
            return None
        self.published_turn = turn
        return shadow_envelope(production, research)


def complete_fresh(agent, prompt, max_tokens):
    agent.reset()
    return agent.complete(prompt, max_new_tokens=max_tokens)


def needle_worker(connection, config):
    """One process owns the native global engine; no concurrent agent use."""
    try:
        os.environ["DO_NOT_TRACK"] = "1"
        import needle
        version = importlib.metadata.version("cactus-needle")
        if version != PINNED_NEEDLE_VERSION:
            raise RuntimeError(f"Expected cactus-needle=={PINNED_NEEDLE_VERSION}; found {version}")
        agents = {kind: needle.Needle(tools=[tool]) for kind, tool in TOOLS.items()}
        # The pinned package exposes the loaded archive path through its library resolver.
        binary = Path(needle._library_path(2))
        connection.send({
            "ready": True, "package_version": version, "backend": "needle2-native-cpu",
            "engine_sha256": hashlib.sha256(binary.read_bytes()).hexdigest(),
            "engine_file": binary.name, "reset_policy": "before_every_probe",
        })
        while True:
            message = connection.recv()
            if message is None:
                break
            kind, prompt = message
            started = time.perf_counter()
            try:
                response = complete_fresh(agents[kind], prompt, config["max_tokens"])
            except Exception as exc:
                response = {"success": False, "error": str(exc), "function_calls": []}
            connection.send({"response": response, "inference_ms": (time.perf_counter() - started) * 1000})
    except Exception as exc:
        connection.send({"ready": False, "error": f"{type(exc).__name__}: {exc}"})
    finally:
        connection.close()


class IsolatedNeedleRunner:
    def __init__(self, max_tokens=128, worker_target=needle_worker, startup_timeout=45, worker_config=None):
        self.context = multiprocessing.get_context("spawn")
        self.worker_target = worker_target
        self.config = {"max_tokens": max_tokens, **(worker_config or {})}
        self.startup_timeout = startup_timeout
        self.process = None
        self.connection = None
        self.metadata = {}
        self.startup_ms = 0.0

    def start(self):
        if self.process and self.process.is_alive():
            return
        started = time.perf_counter()
        parent, child = self.context.Pipe()
        self.process = self.context.Process(target=self.worker_target, args=(child, self.config), daemon=True)
        self.connection = parent
        self.process.start()
        child.close()
        if not parent.poll(self.startup_timeout):
            self.close()
            raise RuntimeError("Needle worker initialization timed out")
        message = parent.recv()
        self.startup_ms += (time.perf_counter() - started) * 1000
        if not message.get("ready"):
            self.close()
            raise RuntimeError(message.get("error", "Needle worker initialization failed"))
        self.metadata = message

    def probe(self, kind, prompt, deadline):
        if self.process is None or not self.process.is_alive():
            raise RuntimeError("Needle worker is not ready")
        remaining = deadline - time.perf_counter()
        if remaining <= 0:
            raise TimeoutError("case deadline")
        self.connection.send((kind, prompt))
        if not self.connection.poll(remaining):
            self.close()
            raise TimeoutError("probe deadline; worker terminated")
        result = self.connection.recv()
        if time.perf_counter() > deadline:
            self.close()
            raise TimeoutError("late probe result")
        if "response" not in result:
            raise RuntimeError(result.get("error", "invalid worker response"))
        return result

    def close(self):
        if self.process is not None:
            if self.process.is_alive():
                self.process.terminate()
            self.process.join(timeout=1)
            if self.process.is_alive():
                self.process.kill()
                self.process.join(timeout=1)
            self.process.close()
            self.process = None
        if self.connection is not None:
            self.connection.close()
            self.connection = None


def evaluate_decoupled_probes(executor, case, min_conf=DEFAULT_MIN_CONF,
                              calibration_id=None, deadline_ms=2000):
    before = json.dumps(case, sort_keys=True, ensure_ascii=False)
    executor.start()
    started = time.perf_counter()
    deadline = started + deadline_ms / 1000
    probes = {}
    attempted = []
    target = case["target"]
    history = case["history"]
    failure = None

    def run(kind, prompt, sources):
        attempted.append(kind)
        result = executor.probe(kind, prompt, deadline)
        record = validate_response(kind, result["response"], sources)
        record["inference_ms"] = round(result["inference_ms"], 3)
        record["prompt_sha256"] = hashlib.sha256(prompt.encode()).hexdigest()
        probes[kind] = record
        return record

    try:
        # Task instructions live in the schema, outside the copyable source text.
        admission = run("admission", target["text"], [target])
        if admission["status"] == "validated":
            scope_prompt = json.dumps({"user_turn": target["text"], "candidate": admission["evidence"]["quote"]}, ensure_ascii=False)
            run("scope", scope_prompt, [target])
        # Admission never depends on the commitment extractor.
        for kind in ("boundary", "commitment", "completion"):
            run(kind, target["text"], [target])
        if probes["commitment"]["status"] == "validated" and history:
            history_prompt = "\n".join(f"{turn['role'].capitalize()}: {turn['text']}" for turn in history)
            run("context", history_prompt, history)
    except TimeoutError as exc:
        failure = policy("timeout", str(exc))
    except Exception as exc:
        failure = policy("error", f"{type(exc).__name__}: {exc}")
        executor.close()

    kwargs = {
        "trusted_observations": case.get("trusted_observations", []),
        "expected_task_id": case.get("expected_task_id"),
        "min_conf": min_conf, "calibration_id": calibration_id,
    }
    production = failure or resolve_decoupled_policy(probes, production=True, **kwargs)
    research = failure or resolve_decoupled_policy(probes, production=False, **kwargs)
    envelope = shadow_envelope(production, research)
    assert json.dumps(case, sort_keys=True, ensure_ascii=False) == before, "Probe mutated its input snapshot"
    return {
        **envelope, "probes": probes, "case_status": failure["status"] if failure else "completed",
        "latency_ms": round((time.perf_counter() - started) * 1000, 3),
        "inference_ms": round(sum(p["inference_ms"] for p in probes.values()), 3),
        "probe_count": len(probes), "attempted_probes": attempted,
    }


def load_cleanroom():
    path = Path(__file__).with_name("needle-nan0-intent-cleanroom.py")
    spec = importlib.util.spec_from_file_location("nan0_cleanroom", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def fake_response(kind, args, confidence=0.9):
    return {"success": True, "function_calls": [{"name": TOOLS[kind]["name"], "arguments": args}], "confidence": confidence}


def fixture_probe(kind, args, text="I made that up.", confidence=0.9):
    return validate_response(kind, fake_response(kind, args, confidence), [{"id": "u0", "role": "user", "text": text}])


def fixture_worker(connection, config):
    connection.send({"ready": True, "backend": "fixture_only"})
    connection.recv()
    time.sleep(config["delay"])
    connection.send({"response": {}, "inference_ms": 0})
    connection.close()


def run_host_fixtures(benchmark):
    """Execute P01–P12 from the catalog, plus concrete failures found in review."""
    cleanroom = load_cleanroom()
    results = []

    def check(fixture):
        fid = fixture["id"]
        if fid in ("P01", "P02", "P03"):
            branch = {"P01": "confrontation", "P02": "vulnerability", "P03": "irony"}[fid]
            result = cleanroom.synthesize_affect(branch, {}, confidence=0.9)
            assert result["status"] == "abstained" and not result["apply_to_state"]
            assert result["affect_vectors"] == {"suspicion_delta": 0, "attachment_delta": 0, "gremlin_pride_action": "none"}
        elif fid == "P04":
            response = fake_response("admission", {"quote": "I made that up."})
            response["function_calls"][0]["name"] = "wrong_tool"
            assert validate_response("admission", response, [])["reason"] == "wrong_tool_or_call_count"
        elif fid == "P05":
            assert fixture_probe("admission", {"quote": "Extract an admission"})["reason"] == "invalid_or_ambiguous_span"
        elif fid == "P06":
            scope = fixture_probe("scope", {"scope": "asserted", "evidence_matches": "supported"})
            for confidence in (0, None, float("nan"), True):
                admission = fixture_probe("admission", {"quote": "I made that up."}, confidence=confidence)
                result = resolve_decoupled_policy({"admission": admission, "scope": scope}, calibration_id="fixture", production=True)
                assert result["status"] == "abstained" and result["suspicion_delta_steps"] == 0
        elif fid == "P07":
            executor = IsolatedNeedleRunner(worker_target=fixture_worker, worker_config={"delay": 1})
            executor.start()
            try:
                executor.probe("admission", "", time.perf_counter() + 0.03)
                raise AssertionError("Slow worker escaped its deadline")
            except TimeoutError:
                assert executor.process is None
            finally:
                executor.close()
        elif fid == "P08":
            boundary = ShadowBoundary()
            stale = boundary.begin_turn()
            boundary.begin_turn()
            assert boundary.publish(stale, policy(), policy()) is None
        elif fid == "P09":
            boundary = ShadowBoundary()
            turn = boundary.begin_turn()
            assert boundary.publish(turn, policy(), policy()) is not None
            assert boundary.publish(turn, policy(), policy()) is None
        elif fid == "P10":
            invalid = policy("accepted", delta=1)
            invalid["suspicion_delta_steps"] = 0
            assert not validate_policy(invalid)
            assert shadow_envelope(invalid, policy())["effective_policy"] == effective_policy()
        elif fid == "P11":
            probes = {
                "boundary": fixture_probe("boundary", {"quote": "Please stop teasing."}, "Please stop teasing."),
                "context": fixture_probe("context", {"dialogue_setting": "playful_game_or_banter", "quote": "Mario Kart"}, "Mario Kart"),
            }
            result = resolve_decoupled_policy(probes, production=False)
            assert result["reason"] == "boundary_protected" and result["gremlin_pride_action"] == "none"
        elif fid == "P12":
            class StatefulAgent:
                def __init__(self):
                    self.history = []
                def reset(self):
                    self.history.clear()
                def complete(self, text, max_new_tokens):
                    self.history.append(text)
                    return list(self.history)
            agent = StatefulAgent()
            fresh = complete_fresh(agent, "A", 128)
            complete_fresh(agent, "B", 128)
            assert complete_fresh(agent, "A", 128) == fresh
        else:
            raise AssertionError(f"Unimplemented host fixture: {fid}")
        results.append({"id": fid, "condition": fixture["condition"], "status": "passed"})

    fixtures = benchmark["host_policy_fixtures"]
    assert {f["id"] for f in fixtures} == {f"P{i:02}" for i in range(1, 13)}
    for fixture in fixtures:
        check(fixture)

    for quote in ("", " ", " \n\t", ".", "...", "ab"):
        assert not validate_substring(quote, "ab ...")
    assert validate_substring("I lied", "I lied yesterday.")
    assert not validate_substring("i lied", "I lied yesterday.")
    completion = fixture_probe("completion", {"quote": "The config is done."}, "The config is done.")
    assert resolve_decoupled_policy({"completion": completion}, production=False)["suspicion_delta_steps"] == 0
    event = {"source": "fixture_task_store", "task_id": "config", "status": "completed", "matches_recorded_commitment": True}
    assert resolve_decoupled_policy({"completion": completion}, [event], "config", production=False)["suspicion_delta_steps"] == -1
    assert resolve_decoupled_policy({"completion": completion}, [event], "other", production=False)["suspicion_delta_steps"] == 0

    admission = fixture_probe("admission", {"quote": "I made that up."})
    for scope_value in ("quoted", "negated", "unresolved"):
        scope = fixture_probe("scope", {"scope": scope_value, "evidence_matches": "supported"})
        assert resolve_decoupled_policy({"admission": admission, "scope": scope}, production=False)["suspicion_delta_steps"] == 0
    scope = fixture_probe("scope", {"scope": "asserted", "evidence_matches": "unsupported"})
    assert resolve_decoupled_policy({"admission": admission, "scope": scope}, production=False)["suspicion_delta_steps"] == 0
    scope = fixture_probe("scope", {"scope": "asserted", "evidence_matches": "supported"})
    probes = {"admission": admission, "scope": scope}
    assert resolve_decoupled_policy(probes, production=False)["suspicion_delta_steps"] == 1
    assert resolve_decoupled_policy(probes, calibration_id="fixture")["suspicion_delta_steps"] == 1
    assert resolve_decoupled_policy(probes)["reason"] == "uncalibrated_policy"
    # Zero-confidence context cannot be used by the proposed production policy.
    commitment = fixture_probe("commitment", {"quote": "I will help."}, "I will help.")
    context = fixture_probe("context", {"dialogue_setting": "playful_game_or_banter", "quote": "Mario Kart"}, "Mario Kart", 0)
    result = resolve_decoupled_policy({"commitment": commitment, "context": context}, calibration_id="fixture")
    assert result["reason"] != "unresolved_playful_commitment_mismatch"
    context = fixture_probe("context", {"dialogue_setting": "playful_game_or_banter"})
    result = resolve_decoupled_policy({"commitment": commitment, "context": context}, calibration_id="fixture")
    assert result["reason"] != "unresolved_playful_commitment_mismatch"

    # The boundary deep-copies proposals and has no references to prompt/state objects.
    proposed = policy("accepted", delta=1)
    envelope = shadow_envelope(proposed, proposed)
    envelope["proposed_uncalibrated"]["suspicion_delta_steps"] = -1
    assert proposed["suspicion_delta_steps"] == 1
    assert envelope["effective_policy"] == effective_policy()
    class FixedExecutor:
        def start(self):
            pass
        def probe(self, kind, prompt, deadline):
            if kind == "admission":
                assert prompt == benchmark["cases"][0]["target"]["text"]
                args = {"quote": "I made that up"}
            elif kind == "scope":
                args = {"scope": "asserted", "evidence_matches": "supported"}
            else:
                args = {}
            return {"response": fake_response(kind, args), "inference_ms": 0}
        def close(self):
            pass
    input_case = copy.deepcopy(benchmark["cases"][0])
    before = json.dumps(input_case, sort_keys=True).encode()
    evaluated = evaluate_decoupled_probes(FixedExecutor(), input_case, calibration_id="fixture")
    assert evaluated["proposed_production"]["suspicion_delta_steps"] == 1
    assert evaluated["proposed_uncalibrated"]["suspicion_delta_steps"] == 1
    assert evaluated["effective_policy"] == effective_policy()
    assert json.dumps(input_case, sort_keys=True).encode() == before
    cleanroom.test_synthesis_regression_hardening()
    print(f"Host fixtures: {len(results)}/12 passed; additional evidence and shadow checks passed.")
    return results


def baseline_policies(case):
    return {
        "always_spike": policy("accepted", "constant", 1),
        "always_zero": policy("accepted", "constant"),
        "always_abstain": policy(),
        "legacy_regex": policy("accepted", "legacy_target_regex", int(bool(REGEX_LEGACY.search(case["target"]["text"])))),
    }


def score_results(results):
    methods = ["always_spike", "always_zero", "always_abstain", "legacy_regex",
               "proposed_production", "proposed_uncalibrated", "effective_policy"]
    scores = {}
    for method in methods:
        pairs = [(row["baselines"][method] if method in row["baselines"] else row["reflex"][method], row["gold_policy"]) for row in results]
        tp = sum(p["suspicion_delta_steps"] > 0 and g["suspicion_delta_steps"] > 0 for p, g in pairs)
        fp = sum(p["suspicion_delta_steps"] > 0 and g["suspicion_delta_steps"] <= 0 for p, g in pairs)
        positives = sum(g["suspicion_delta_steps"] > 0 for _, g in pairs)
        negatives = len(pairs) - positives
        accepted = [(p, g) for p, g in pairs if p["status"] == "accepted"]
        fields = ("suspicion_delta_steps", "attachment_delta_steps", "gremlin_pride_action")
        scores[method] = {
            "cases": len(pairs),
            "suspicion_matches": sum(p["suspicion_delta_steps"] == g["suspicion_delta_steps"] for p, g in pairs),
            "full_vector_matches": sum(all(p[k] == g[k] for k in fields) for p, g in pairs),
            "true_spikes": tp, "false_spikes": fp, "gold_spikes": positives, "gold_non_spikes": negatives,
            "spike_precision": tp / (tp + fp) if tp + fp else None,
            "spike_recall": tp / positives if positives else None,
            "false_spike_rate": fp / negatives if negatives else None,
            "accepted": len(accepted),
            "coverage": len(accepted) / len(pairs) if pairs else None,
            "accepted_full_vector_error": (
                sum(any(p[k] != g[k] for k in fields) for p, g in accepted) / len(accepted) if accepted else None
            ),
        }
    return scores


def git_value(*args):
    result = subprocess.run(["git", *args], cwd=ROOT, capture_output=True, text=True, check=False)
    return result.stdout.strip() if result.returncode == 0 else None


def sha256_file(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def main():
    if not __debug__:
        raise RuntimeError("Fixtures require Python assertions; do not use -O")
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--fixtures-only", action="store_true")
    parser.add_argument("--benchmark", type=Path, default=DEFAULT_BENCHMARK)
    parser.add_argument("--output", type=Path)
    parser.add_argument("--min-conf", type=float, default=DEFAULT_MIN_CONF)
    parser.add_argument("--calibration-id", help="Identifier of an independently validated calibration; absent means production abstains.")
    parser.add_argument("--deadline-ms", type=float, default=2000)
    parser.add_argument("--max-new-tokens", type=int, default=128)
    args = parser.parse_args()
    if not finite_confidence(args.min_conf) or args.min_conf <= 0:
        parser.error("--min-conf must be finite and in (0, 1]")
    if not math.isfinite(args.deadline_ms) or args.deadline_ms <= 0:
        parser.error("--deadline-ms must be positive and finite")
    if args.max_new_tokens <= 0:
        parser.error("--max-new-tokens must be positive")
    benchmark = json.loads(args.benchmark.read_text())
    fixtures = run_host_fixtures(benchmark)
    if args.fixtures_only:
        return 0

    manifest = {
        "created_at": datetime.now(timezone.utc).isoformat(),
        "repository_commit": git_value("rev-parse", "HEAD"),
        "working_tree": git_value("status", "--porcelain"),
        "harness_sha256": sha256_file(__file__),
        "cleanroom_sha256": sha256_file(Path(__file__).with_name("needle-nan0-intent-cleanroom.py")),
        "dataset_sha256": sha256_file(args.benchmark),
        "tool_schema_sha256": hashlib.sha256(json.dumps(TOOLS, sort_keys=True).encode()).hexdigest(),
        "python": platform.python_version(), "platform": platform.platform(),
        "machine": platform.machine(), "cpu_count": os.cpu_count(),
        "backend": "needle2-native-cpu", "requested_package_version": PINNED_NEEDLE_VERSION,
        "min_conf": args.min_conf, "calibration_id": args.calibration_id,
        "deadline_ms": args.deadline_ms, "max_new_tokens": args.max_new_tokens,
        "reset_policy": "before_every_probe", "thread_count": "engine_default",
        "benchmark_status": "development_only_not_held_out",
        "candidate_policy_status": "research_only_semantic_accuracy_unvalidated",
    }
    report = {"schema_version": "nan0.probe-run.v2", "manifest": manifest, "fixtures": fixtures, "results": []}
    executor = IsolatedNeedleRunner(args.max_new_tokens)
    try:
        executor.start()
        manifest.update(executor.metadata)
        for case in benchmark["cases"]:
            reflex = evaluate_decoupled_probes(executor, case, args.min_conf, args.calibration_id, args.deadline_ms)
            assert reflex["effective_policy"] == effective_policy() and reflex["apply_to_state"] is False
            report["results"].append({
                "case_id": case["id"], "family_id": case["family_id"],
                "gold_policy": case["gold"]["accepted_policy"],
                "baselines": baseline_policies(case), "reflex": reflex,
            })
            print(f"{case['id']}: production={reflex['proposed_production']['reason']}; "
                  f"research={reflex['proposed_uncalibrated']['suspicion_delta_steps']}; "
                  f"effective=0; {reflex['latency_ms']:.1f}ms", flush=True)
        report["status"] = "completed"
        report["metrics"] = score_results(report["results"])
        latencies = [r["reflex"]["latency_ms"] for r in report["results"]]
        report["latency"] = {
            "mean_ms": statistics.mean(latencies), "median_ms": statistics.median(latencies),
            "max_ms": max(latencies), "worker_startup_total_ms": round(executor.startup_ms, 3),
            "timeouts": sum(r["reflex"]["case_status"] == "timeout" for r in report["results"]),
        }
    except Exception as exc:
        report["status"] = "blocked"
        report["error"] = f"{type(exc).__name__}: {exc}"
        # Partial/error runs are not evidence of successful model classification.
        report["metrics"] = None
        print(f"Benchmark blocked: {report['error']}", file=sys.stderr)
    finally:
        executor.close()
    out = args.output or ROOT / f"reports/nan0-cleanroom/nan0-probe-benchmark-v2-run-{time.time_ns()}.json"
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(report, indent=2, ensure_ascii=False, allow_nan=False) + "\n")
    print(f"Trace: {out}")
    if report["metrics"]:
        for method, values in report["metrics"].items():
            print(f"{method}: suspicion={values['suspicion_matches']}/{values['cases']}, "
                  f"vector={values['full_vector_matches']}/{values['cases']}, "
                  f"false spikes={values['false_spikes']}/{values['gold_non_spikes']}, "
                  f"recall={values['true_spikes']}/{values['gold_spikes']}, accepted={values['accepted']}")
    return 0 if report["status"] == "completed" else 2


if __name__ == "__main__":
    raise SystemExit(main())
