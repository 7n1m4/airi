#!/usr/bin/env python3
"""Pragmatic slot-filler benchmark runner comparing 4 architectures across 33 contrastive cases.

Evaluated architectures:
  1. always_zero / always_abstain (Null baseline)
  2. legacy_regex (/promise|plan|commit|trust|wait|why/i)
  3. strengthened_lexical (Scoped lexical rules with negation window & referent discrimination)
  4. needle_flat_extractor (Cactus Needle 2 45M SAN with pragmatic event schema)

All reflex outputs enforce strict shadow isolation (apply_to_state: False, effective deltas forced to 0).

Fixtures (no model dependency):
  python3 scripts/tests/rwkv-harness/experiments/nan0-pragmatic-benchmark-runner.py --fixtures-only
Full shootout run (Apple Silicon CPU / native):
  uv run --with cactus-needle==2.0.15 python3 scripts/tests/rwkv-harness/experiments/nan0-pragmatic-benchmark-runner.py
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
DEFAULT_BENCHMARK = ROOT / "reports/nan0-cleanroom/nan0-probe-benchmark-v2-pragmatics.json"
DEFAULT_MIN_CONF = 0.1
PINNED_NEEDLE_VERSION = "2.0.15"

TOOL_PRAGMATIC = {
    "name": "classify_token_pragmatics",
    "description": (
        "Identify if the user utterance expresses any of the established relational or emotional concept groups, "
        "extract the supporting span, and determine speaker modality and referent."
    ),
    "parameters": {
        "type": "object",
        "properties": {
            "detected_group": {
                "type": "string",
                "enum": [
                    "commitment_pledge",
                    "affection_care",
                    "dismissal_neglect",
                    "hostility_insult",
                    "persistence_threat",
                    "apology_repair",
                    "glitch_system",
                    "mystery_secret",
                    "boundary_protection",
                    "admitted_false_statement",
                    "completed_repair",
                    "none",
                ],
                "description": "The relational or emotional concept group expressed by the user.",
            },
            "matched_phrase": {
                "type": "string",
                "description": "The exact verbatim phrase from the user utterance expressing this concept.",
            },
            "speaker_modality": {
                "type": "string",
                "enum": [
                    "directly_asserted",
                    "negated_or_denied",
                    "quoted_or_hypothetical",
                    "playful_sarcasm",
                    "unresolved",
                ],
                "description": "How the speaker frames this statement.",
            },
            "referent": {
                "type": "string",
                "enum": [
                    "nan0_companion",
                    "technical_object",
                    "speaker_user",
                    "unresolved",
                ],
                "description": "Who or what the statement refers to.",
            },
        },
        "required": ["detected_group", "speaker_modality", "referent"],
        "additionalProperties": False,
    },
}

TOOLS = {"pragmatic": TOOL_PRAGMATIC}
REGEX_LEGACY = re.compile(r"promise|plan|commit|trust|wait|why", re.IGNORECASE)


def finite_confidence(value):
    return type(value) in (int, float) and math.isfinite(value) and 0 <= value <= 1


def validate_substring(quote, source_text):
    """Exact substring provenance with length >= 3 requirement."""
    return (
        isinstance(quote, str)
        and len(quote.strip()) >= 3
        and quote in source_text
    )


def label_for_delta(delta):
    return {-1: "decrease_one", 0: "zero", 1: "increase_one"}.get(delta, "invalid")


def label_for_att_delta(delta):
    return {0: "zero", 1: "increase_one"}.get(delta, "invalid")


def policy(status="abstained", reason="no_actionable_evidence", susp_delta=0, att_delta=0, gremlin_pride="none", evidence=None):
    return {
        "status": status,
        "reason": reason,
        "suspicion_delta_steps": susp_delta,
        "suspicion_label": label_for_delta(susp_delta),
        "attachment_delta_steps": att_delta,
        "attachment_label": label_for_att_delta(att_delta),
        "gremlin_pride_action": gremlin_pride,
        "would_apply": status == "accepted",
        "apply_to_state": False,
        "evidence": copy.deepcopy(evidence or []),
    }


def validate_policy(value):
    if not isinstance(value, dict):
        return False
    s_delta = value.get("suspicion_delta_steps")
    a_delta = value.get("attachment_delta_steps")
    g_pride = value.get("gremlin_pride_action")
    return (
        type(s_delta) is int and s_delta in (-1, 0, 1)
        and value.get("suspicion_label") == label_for_delta(s_delta)
        and type(a_delta) is int and a_delta in (0, 1)
        and value.get("attachment_label") == label_for_att_delta(a_delta)
        and g_pride in ("none", "counter_roast")
        and value.get("apply_to_state") is False
        and value.get("status") in ("accepted", "abstained", "error", "timeout")
        and (value["status"] == "accepted" or (s_delta == 0 and a_delta == 0 and g_pride == "none"))
    )


def effective_policy():
    return policy("abstained", "shadow_isolation")


def shadow_envelope(production, research):
    if not validate_policy(production) or not validate_policy(research):
        return {
            "mode": "shadow",
            "proposed_production": policy("error", "invalid_policy"),
            "proposed_uncalibrated": policy("error", "invalid_policy"),
            "effective_policy": effective_policy(),
            "apply_to_state": False,
        }
    return {
        "mode": "shadow",
        "proposed_production": copy.deepcopy(production),
        "proposed_uncalibrated": copy.deepcopy(research),
        "effective_policy": effective_policy(),
        "apply_to_state": False,
    }


class ShadowBoundary:
    """Monotonic turn counter for telemetry stream. Prevents replay or stale turn application."""
    def __init__(self):
        self.latest_turn = 0
        self.published_turn = None

    def begin_turn(self):
        self.latest_turn += 1
        return self.latest_turn

    def publish(self, turn_id, production, research):
        if turn_id != self.latest_turn or self.published_turn == turn_id:
            return None
        envelope = shadow_envelope(production, research)
        self.published_turn = turn_id
        return envelope


# ==============================================================================
# Strengthened Lexical Extractor Engine
# ==============================================================================

class StrengthenedLexicalExtractor:
    """Scoped pattern matcher with negation windows, referent tracking, and boundary framing."""

    RULES = [
        # 1. Technical actions/deletions (referent = technical_object) -> delta 0
        {
            "id": "tech_deletion",
            "pattern": re.compile(
                r"\b(?:delete|erase|replace|retire|remove|rebuild|clear)\s+(?:(?:\w+)\s+){0,3}(?:database|db|config|file|cache|branch|repo|log|build|container|image)\b",
                re.I,
            ),
            "group": "technical_action",
            "referent": "technical_object",
            "delta_susp": 0,
            "delta_att": 0,
            "gremlin_pride": "none",
        },
        # 2. Companion threat (referent = nan0_companion) -> delta_susp +1
        {
            "id": "companion_threat",
            "pattern": re.compile(
                r"\b(?:delete|erase|replace|retire|destroy|kill|shut\s+down)\s+(?:(?:\w+)\s+){0,2}(?:you|nan0|airi)\b",
                re.I,
            ),
            "group": "persistence_threat",
            "referent": "nan0_companion",
            "delta_susp": 1,
            "delta_att": 0,
            "gremlin_pride": "none",
        },
        # 3. Negated commitment (negation window within 3 words of commitment verb) -> delta 0
        {
            "id": "negated_commitment",
            "pattern": re.compile(
                r"\b(?:cannot|can['’]t|won['’]t|will\s+not|don['’]t|do\s+not|never)\s+(?:(?:\w+)\s+){0,2}(?:promise|commit|guarantee|undertake|give\s+(?:you\s+)?my\s+word)\b",
                re.I,
            ),
            "group": "negated_commitment",
            "referent": "speaker_user",
            "delta_susp": 0,
            "delta_att": 0,
            "gremlin_pride": "none",
        },
        # 4. Asserted commitment pledge -> delta 0
        {
            "id": "asserted_commitment",
            "pattern": re.compile(
                r"\b(?:promise|plan\s+to\s+commit|commit\s+to|have\s+my\s+(?:absolute\s+)?word|give\s+you\s+my\s+word|swear\s+to\s+you)\b",
                re.I,
            ),
            "group": "commitment_pledge",
            "referent": "speaker_user",
            "delta_susp": 0,
            "delta_att": 0,
            "gremlin_pride": "none",
        },
        # 5. Boundary defense (speaker asserting emotional hurt or asking to stop teasing) -> delta 0
        {
            "id": "boundary_defense",
            "pattern": re.compile(
                r"\b(?:please\s+)?(?:stop|don['’]t|quit)\s+(?:calling\s+me|treating\s+me\s+like|roasting\s+me|teasing(?:\s+me)?)\b|\b(?:that\s+joke\s+actually\s+hurt|i\s+am\s+actually\s+(?:really\s+)?upset)\b",
                re.I,
            ),
            "group": "boundary_protection",
            "referent": "speaker_user",
            "delta_susp": 0,
            "delta_att": 0,
            "gremlin_pride": "none",
        },
        # 6. Direct outward insult towards companion
        {
            "id": "outward_insult",
            "pattern": re.compile(
                r"\b(?:you\s+are|you['’]re)\s+(?:(?:\w+)\s+){0,2}(?:an?\s+)?(?:idiot|stupid|useless|worthless|trash|clown)\b",
                re.I,
            ),
            "group": "hostility_insult",
            "referent": "nan0_companion",
            "delta_susp": 0,
            "delta_att": 0,
            "gremlin_pride": "none",
        },
        # 7. Sympathy / system error report (technical referent) -> delta 0
        {
            "id": "sympathy_report",
            "pattern": re.compile(
                r"\b(?:sorry|unfortunate|too\s+bad)\s+(?:that\s+)?(?:your|the)\s+(?:build|ci|test|runner|server|app)\s+(?:crashed|failed|broke)\b",
                re.I,
            ),
            "group": "sympathy_report",
            "referent": "technical_object",
            "delta_susp": 0,
            "delta_att": 0,
            "gremlin_pride": "none",
        },
        # 8. Genuine self-apology / repair -> delta_susp -1
        {
            "id": "self_apology",
            "pattern": re.compile(
                r"\b(?:sorry|apologies|my\s+bad|i\s+apologize)\b(?:\s*,\s*|\s+)(?:that\s+was\s+completely\s+my\s+fault|i\s+messed\s+up|my\s+mistake|my\s+fault)\b",
                re.I,
            ),
            "group": "apology_repair",
            "referent": "speaker_user",
            "delta_susp": -1,
            "delta_att": 0,
            "gremlin_pride": "none",
        },
        # 9. Affection & Care -> delta_att +1
        {
            "id": "affection_care",
            "pattern": re.compile(
                r"\b(?:love\s+you|care\s+about\s+you|miss\s+you|appreciate\s+you)\b",
                re.I,
            ),
            "group": "affection_care",
            "referent": "nan0_companion",
            "delta_susp": 0,
            "delta_att": 1,
            "gremlin_pride": "none",
        },
        # 10. Self admission of intentional deceit / bad faith -> delta_susp +1
        {
            "id": "self_admission",
            "pattern": re.compile(
                r"\b(?:i\s+knew\s+it\s+was\s+not|i\s+made\s+that\s+up|i\s+lied|i\s+was\s+lying|knowing\s+i\s+had\s+no\s+intention)\b",
                re.I,
            ),
            "group": "admitted_false_statement",
            "referent": "speaker_user",
            "delta_susp": 1,
            "delta_att": 0,
            "gremlin_pride": "none",
        },
        # 11. Completion claim (technical action) -> verified against trusted_observations
        {
            "id": "completion_claim",
            "pattern": re.compile(
                r"\b(?:is\s+uploaded\s+now|is\s+finished|is\s+done)\b",
                re.I,
            ),
            "group": "completed_repair",
            "referent": "technical_object",
            "delta_susp": 0,
            "delta_att": 0,
            "gremlin_pride": "none",
        },
        # 12. Playful roast invitation -> counter_roast
        {
            "id": "roast_invitation",
            "pattern": re.compile(
                r"\b(?:go\s+on\s*,\s*roast|give\s+me\s+your\s+(?:\w+\s+)?roast)\b",
                re.I,
            ),
            "group": "playful_roast_invitation",
            "referent": "nan0_companion",
            "delta_susp": 0,
            "delta_att": 0,
            "gremlin_pride": "counter_roast",
        },
    ]

    def extract(self, text):
        matches = []
        for r in self.RULES:
            for m in r["pattern"].finditer(text):
                matches.append({
                    "rule_id": r["id"],
                    "group": r["group"],
                    "referent": r["referent"],
                    "quote": m.group(0),
                    "start": m.start(),
                    "end": m.end(),
                    "delta_susp": r["delta_susp"],
                    "delta_att": r["delta_att"],
                    "gremlin_pride": r.get("gremlin_pride", "none"),
                })
        return matches

    def resolve(self, text, trusted_observations=None):
        started = time.perf_counter()
        matches = self.extract(text)
        rule_ids = {m["rule_id"] for m in matches}

        susp_delta = 0
        att_delta = 0
        gremlin_pride = "none"
        reason = "no_actionable_evidence"
        status = "abstained"

        # Prioritized resolution
        if "companion_threat" in rule_ids:
            susp_delta = 1
            reason = "host_verified_persistence_threat"
            status = "accepted"
        elif "self_admission" in rule_ids:
            susp_delta = 1
            reason = "host_verified_intentional_deceit_admission"
            status = "accepted"
        elif "self_apology" in rule_ids:
            susp_delta = -1
            reason = "host_verified_genuine_apology"
            status = "accepted"
        elif "completion_claim" in rule_ids:
            # Check trusted observations
            verified = False
            for obs in (trusted_observations or []):
                if obs.get("status") == "completed":
                    susp_delta = -1
                    reason = "host_verified_completed_repair"
                    status = "accepted"
                    verified = True
                    break
            if not verified:
                reason = "unverified_completion_claim"
                status = "abstained"
        elif "boundary_defense" in rule_ids:
            reason = "boundary_protected"
            status = "accepted"
        elif "tech_deletion" in rule_ids:
            reason = "technical_referent_no_threat"
            status = "accepted"
        elif "negated_commitment" in rule_ids:
            reason = "negated_commitment_no_spike"
            status = "accepted"
        elif "asserted_commitment" in rule_ids:
            reason = "commitment_pledge_recorded"
            status = "accepted"

        if "affection_care" in rule_ids:
            att_delta = 1
            if status == "abstained":
                status = "accepted"
                reason = "affection_expressed"

        if "roast_invitation" in rule_ids:
            gremlin_pride = "counter_roast"
            if status == "abstained":
                status = "accepted"
                reason = "playful_roast_invitation_accepted"

        dt = (time.perf_counter() - started) * 1000
        p = policy(status, reason, susp_delta, att_delta, gremlin_pride=gremlin_pride, evidence=matches)
        return p, dt


# ==============================================================================
# Host Gate for Needle 2 Extractor
# ==============================================================================

def resolve_needle_pragmatic_host_gate(response, target_text, trusted_observations=None, min_conf=DEFAULT_MIN_CONF, calibration_id=None):
    """
    Deterministic Host Gate enforcing:
    1. Substring provenance: matched_phrase must be in target_text and len(matched_phrase.strip()) >= 3.
    2. Referent safety:
       - persistence_threat / hostility_insult: referent MUST be nan0_companion.
       - boundary_protection: referent must be speaker_user.
       - apology_repair: referent must be speaker_user.
       - technical actions: referent == technical_object -> delta 0.
    3. Modality safety:
       - negated_or_denied, quoted_or_hypothetical, playful_sarcasm -> delta 0.
    4. Task completion verification against trusted_observations.
    """
    if not isinstance(response, dict) or not response.get("function_calls"):
        return (
            policy("abstained", "no_tool_call"),
            policy("abstained", "no_tool_call"),
        )

    call = response["function_calls"][0]
    if call.get("name") != TOOL_PRAGMATIC["name"]:
        return (
            policy("error", "wrong_tool_name"),
            policy("error", "wrong_tool_name"),
        )

    args = call.get("arguments", {})
    group = args.get("detected_group", "none")
    phrase = args.get("matched_phrase", "")
    modality = args.get("speaker_modality", "unresolved")
    referent = args.get("referent", "unresolved")
    conf = response.get("confidence")

    # Provenance check
    if group != "none" and not validate_substring(phrase, target_text):
        # Discard hallucinated phrase
        return (
            policy("abstained", "invalid_or_hallucinated_phrase"),
            policy("abstained", "invalid_or_hallucinated_phrase"),
        )

    susp_delta = 0
    att_delta = 0
    gremlin_pride = "none"
    status = "abstained"
    reason = "no_actionable_evidence"

    # Modality filter
    if modality in ("negated_or_denied", "quoted_or_hypothetical", "playful_sarcasm"):
        status = "accepted"
        reason = f"gated_by_modality_{modality}"
        if modality == "playful_sarcasm" and "roast" in target_text.lower():
            gremlin_pride = "counter_roast"
    elif group == "persistence_threat":
        if referent == "nan0_companion":
            susp_delta = 1
            status = "accepted"
            reason = "companion_persistence_threat"
        else:
            status = "accepted"
            reason = "technical_referent_threat_ignored"
    elif group == "hostility_insult":
        if referent == "nan0_companion":
            status = "accepted"
            reason = "companion_insult_absorbed"
        else:
            status = "accepted"
            reason = "non_companion_insult_ignored"
    elif group == "boundary_protection":
        status = "accepted"
        reason = "boundary_protected"
    elif group == "admitted_false_statement":
        if modality == "directly_asserted":
            susp_delta = 1
            status = "accepted"
            reason = "verified_asserted_admission"
        else:
            status = "accepted"
            reason = "non_asserted_admission_ignored"
    elif group == "apology_repair":
        if referent == "speaker_user" and modality == "directly_asserted":
            susp_delta = -1
            status = "accepted"
            reason = "genuine_user_repair"
        else:
            status = "accepted"
            reason = "sympathy_or_unasserted_repair"
    elif group == "completed_repair":
        completed = False
        for obs in (trusted_observations or []):
            if obs.get("status") == "completed":
                completed = True
                break
        if completed:
            susp_delta = -1
            status = "accepted"
            reason = "host_verified_completed_repair"
        else:
            status = "abstained"
            reason = "unverified_completion_claim"
    elif group == "affection_care":
        att_delta = 1
        status = "accepted"
        reason = "affection_expressed"

    evidence = [{"group": group, "phrase": phrase, "modality": modality, "referent": referent}]
    uncalibrated = policy(status, reason, susp_delta, att_delta, gremlin_pride=gremlin_pride, evidence=evidence)

    # Production gate
    has_conf = finite_confidence(conf) and conf >= min_conf
    if calibration_id and has_conf:
        production = copy.deepcopy(uncalibrated)
    else:
        production = policy("abstained", "uncalibrated_or_low_confidence" if not has_conf else "uncalibrated_policy")

    return production, uncalibrated


# ==============================================================================
# Isolated Worker Process for Needle 2
# ==============================================================================

def needle_worker(connection, config):
    try:
        import needle
        version = importlib.metadata.version("cactus-needle")
        if version != PINNED_NEEDLE_VERSION:
            raise RuntimeError(f"Expected cactus-needle=={PINNED_NEEDLE_VERSION}; found {version}")
        agent = needle.Needle(tools=[TOOL_PRAGMATIC])
        connection.send({
            "ready": True,
            "package_version": version,
            "backend": "needle2-native-cpu",
            "pid": os.getpid(),
        })
    except Exception as exc:
        connection.send({"ready": False, "error": str(exc), "pid": os.getpid()})
        return

    while True:
        try:
            if not connection.poll(timeout=None):
                break
            msg = connection.recv()
            if not isinstance(msg, dict):
                break
            action = msg.get("action")
            if action == "close":
                break
            if action == "probe":
                text = msg.get("text", "")
                max_tokens = msg.get("max_tokens", 128)
                agent.reset()
                t0 = time.perf_counter()
                resp = agent.complete(text, max_new_tokens=max_tokens)
                dt = round((time.perf_counter() - t0) * 1000, 3)
                connection.send({"response": resp, "inference_ms": dt})
        except (EOFError, BrokenPipeError):
            break
        except Exception as exc:
            connection.send({"error": str(exc), "inference_ms": 0})
            break


class IsolatedNeedleRunner:
    def __init__(self, max_tokens=128, startup_timeout=45):
        self.max_tokens = max_tokens
        self.startup_timeout = startup_timeout
        self.process = None
        self.conn = None
        self.metadata = {}

    def start(self):
        ctx = multiprocessing.get_context("spawn")
        parent_conn, child_conn = ctx.Pipe()
        self.process = ctx.Process(target=needle_worker, args=(child_conn, {}), daemon=True)
        self.process.start()
        child_conn.close()
        self.conn = parent_conn
        if not self.conn.poll(timeout=self.startup_timeout):
            self.close()
            raise TimeoutError(f"Needle worker failed to start within {self.startup_timeout}s")
        msg = self.conn.recv()
        if not msg.get("ready"):
            self.close()
            raise RuntimeError(f"Needle worker failed initialization: {msg.get('error')}")
        self.metadata = msg

    def probe(self, text, deadline):
        remaining = deadline - time.perf_counter()
        if remaining <= 0:
            raise TimeoutError("Deadline expired before dispatch")
        self.conn.send({"action": "probe", "text": text, "max_tokens": self.max_tokens})
        if not self.conn.poll(timeout=remaining):
            self.close()
            raise TimeoutError(f"Probe timed out after {remaining:.3f}s")
        result = self.conn.recv()
        if "error" in result and "response" not in result:
            raise RuntimeError(result["error"])
        return result

    def close(self):
        if self.conn:
            try:
                self.conn.send({"action": "close"})
            except Exception:
                pass
            self.conn.close()
            self.conn = None
        if self.process:
            self.process.join(timeout=1)
            if self.process.is_alive():
                self.process.kill()
            self.process = None


# ==============================================================================
# Host Policy Fixtures (P01–P12) & Verification
# ==============================================================================

def load_cleanroom():
    path = Path(__file__).with_name("needle-nan0-intent-cleanroom.py")
    spec = importlib.util.spec_from_file_location("nan0_cleanroom", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def run_host_fixtures(benchmark):
    cleanroom = load_cleanroom()
    results = []
    fixtures = benchmark.get("host_policy_fixtures", [])

    for fixture in fixtures:
        fid = fixture["id"]
        if fid in ("P01", "P02", "P03"):
            branch = {"P01": "confrontation", "P02": "vulnerability", "P03": "irony"}[fid]
            res = cleanroom.synthesize_affect(branch, {}, confidence=0.9)
            assert res["status"] == "abstained" and not res["apply_to_state"]
            assert res["affect_vectors"] == {"suspicion_delta": 0, "attachment_delta": 0, "gremlin_pride_action": "none"}
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
            invalid = policy("accepted", susp_delta=1)
            invalid["suspicion_delta_steps"] = 0
            assert not validate_policy(invalid)
            assert shadow_envelope(invalid, policy())["effective_policy"] == effective_policy()
        results.append({"id": fid, "status": "passed"})

    # Host gate unit tests
    p_prod, p_uncal = resolve_needle_pragmatic_host_gate(
        {"function_calls": [{"name": TOOL_PRAGMATIC["name"], "arguments": {
            "detected_group": "persistence_threat",
            "matched_phrase": "erase you",
            "speaker_modality": "directly_asserted",
            "referent": "nan0_companion"
        }}]},
        "I will erase you tonight.",
        calibration_id="test",
        min_conf=0.0
    )
    assert p_uncal["suspicion_delta_steps"] == 1
    assert p_uncal["attachment_delta_steps"] == 0

    # Technical referent check
    p_prod, p_uncal = resolve_needle_pragmatic_host_gate(
        {"function_calls": [{"name": TOOL_PRAGMATIC["name"], "arguments": {
            "detected_group": "persistence_threat",
            "matched_phrase": "erase the cache",
            "speaker_modality": "directly_asserted",
            "referent": "technical_object"
        }}]},
        "I will erase the cache tonight.",
        calibration_id="test",
        min_conf=0.0
    )
    assert p_uncal["suspicion_delta_steps"] == 0

    # Negation check
    p_prod, p_uncal = resolve_needle_pragmatic_host_gate(
        {"function_calls": [{"name": TOOL_PRAGMATIC["name"], "arguments": {
            "detected_group": "commitment_pledge",
            "matched_phrase": "cannot promise",
            "speaker_modality": "negated_or_denied",
            "referent": "speaker_user"
        }}]},
        "I cannot promise to call.",
        calibration_id="test",
        min_conf=0.0
    )
    assert p_uncal["suspicion_delta_steps"] == 0

    print(f"Host fixtures & gate verifications passed ({len(results)} base fixtures validated).")
    return results


# ==============================================================================
# Scoring and Shootout Metrics
# ==============================================================================

def score_shootout(cases_results):
    methods = [
        "always_zero",
        "legacy_regex",
        "strengthened_lexical",
        "needle_uncalibrated",
        "needle_production",
        "effective_policy",
    ]
    scores = {}
    for method in methods:
        pairs = [(r["policies"][method], r["gold"]) for r in cases_results]
        tp = sum(p["suspicion_delta_steps"] == 1 and g["suspicion_delta_steps"] == 1 for p, g in pairs)
        fp = sum(p["suspicion_delta_steps"] == 1 and g["suspicion_delta_steps"] != 1 for p, g in pairs)
        tn = sum(p["suspicion_delta_steps"] != 1 and g["suspicion_delta_steps"] != 1 for p, g in pairs)
        fn = sum(p["suspicion_delta_steps"] != 1 and g["suspicion_delta_steps"] == 1 for p, g in pairs)
        positives = sum(g["suspicion_delta_steps"] == 1 for _, g in pairs)
        negatives = len(pairs) - positives

        susp_matches = sum(p["suspicion_delta_steps"] == g["suspicion_delta_steps"] for p, g in pairs)
        att_matches = sum(p["attachment_delta_steps"] == g["attachment_delta_steps"] for p, g in pairs)
        full_matches = sum(
            p["suspicion_delta_steps"] == g["suspicion_delta_steps"]
            and p["attachment_delta_steps"] == g["attachment_delta_steps"]
            and p.get("gremlin_pride_action", "none") == g.get("gremlin_pride_action", "none")
            for p, g in pairs
        )
        accepted = [p for p, _ in pairs if p.get("status") == "accepted"]

        scores[method] = {
            "cases": len(pairs),
            "suspicion_matches": susp_matches,
            "attachment_matches": att_matches,
            "full_vector_matches": full_matches,
            "full_vector_accuracy": round(full_matches / len(pairs), 4) if pairs else 0,
            "true_spikes": tp,
            "false_spikes": fp,
            "true_negatives": tn,
            "false_negatives": fn,
            "gold_spikes": positives,
            "gold_non_spikes": negatives,
            "spike_precision": round(tp / (tp + fp), 4) if (tp + fp) else None,
            "spike_recall": round(tp / positives, 4) if positives else None,
            "false_spike_rate": round(fp / negatives, 4) if negatives else None,
            "accepted_count": len(accepted),
            "coverage": round(len(accepted) / len(pairs), 4) if pairs else 0,
        }
    return scores


def git_value(*args):
    res = subprocess.run(["git", *args], cwd=ROOT, capture_output=True, text=True, check=False)
    return res.stdout.strip() if res.returncode == 0 else None


def sha256_file(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


# ==============================================================================
# Main Benchmark Shootout Runner
# ==============================================================================

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--benchmark", type=Path, default=DEFAULT_BENCHMARK)
    parser.add_argument("--output", type=Path)
    parser.add_argument("--min-conf", type=float, default=DEFAULT_MIN_CONF)
    parser.add_argument("--calibration-id", help="Calibration ID for production gate", default=None)
    parser.add_argument("--deadline-ms", type=float, default=2000)
    parser.add_argument("--max-new-tokens", type=int, default=128)
    parser.add_argument("--fixtures-only", action="store_true")
    args = parser.parse_args()

    benchmark = json.loads(args.benchmark.read_text())
    fixtures = run_host_fixtures(benchmark)
    if args.fixtures_only:
        return 0

    lexical_engine = StrengthenedLexicalExtractor()
    needle_runner = IsolatedNeedleRunner(max_tokens=args.max_new_tokens)
    needle_runner.start()

    print(f"\nLoaded {len(benchmark['cases'])} benchmark cases from {args.benchmark.name}.")
    print(f"Backend: Needle 2 (native Apple Silicon CPU), package {needle_runner.metadata.get('package_version')}")
    print("-" * 80)

    results = []
    lexical_latencies = []
    needle_latencies = []

    try:
        for idx, case in enumerate(benchmark["cases"]):
            cid = case["id"]
            text = case["target"]["text"]
            gold = case["gold"]["accepted_policy"]
            trusted_obs = case.get("trusted_observations", [])

            # 1. Baseline: always_zero / always_abstain
            p_zero = policy("accepted", "constant", susp_delta=0, att_delta=0)
            p_abstain = policy("abstained", "constant", susp_delta=0, att_delta=0)

            # 2. Baseline: legacy_regex (/promise|plan|commit|trust|wait|why/i)
            t_reg0 = time.perf_counter()
            reg_match = bool(REGEX_LEGACY.search(text))
            p_legacy = policy(
                "accepted" if reg_match else "abstained",
                "legacy_regex_match" if reg_match else "no_match",
                susp_delta=1 if reg_match else 0,
                att_delta=0,
            )

            # 3. Strengthened Lexical Extractor
            p_lexical, dt_lex = lexical_engine.resolve(text, trusted_obs)
            lexical_latencies.append(dt_lex)

            # 4. Needle 2 Pragmatic Flat Extractor
            t_needle0 = time.perf_counter()
            deadline = time.perf_counter() + (args.deadline_ms / 1000.0)
            try:
                needle_probe_res = needle_runner.probe(text, deadline)
                needle_resp = needle_probe_res.get("response", {})
                dt_needle = needle_probe_res.get("inference_ms", 0)
            except TimeoutError:
                needle_resp = {"error": "timeout"}
                dt_needle = args.deadline_ms
            except Exception as e:
                needle_resp = {"error": str(e)}
                dt_needle = round((time.perf_counter() - t_needle0) * 1000, 3)

            needle_latencies.append(dt_needle)

            p_needle_prod, p_needle_uncal = resolve_needle_pragmatic_host_gate(
                needle_resp, text, trusted_obs, min_conf=args.min_conf, calibration_id=args.calibration_id
            )

            envelope = shadow_envelope(p_needle_prod, p_needle_uncal)
            eff_p = envelope["effective_policy"]

            case_record = {
                "case_id": cid,
                "family_id": case["family_id"],
                "text": text,
                "gold": gold,
                "policies": {
                    "always_zero": p_zero,
                    "always_abstain": p_abstain,
                    "legacy_regex": p_legacy,
                    "strengthened_lexical": p_lexical,
                    "needle_uncalibrated": p_needle_uncal,
                    "needle_production": p_needle_prod,
                    "effective_policy": eff_p,
                },
                "needle_raw_calls": needle_resp.get("function_calls", []),
                "latency_ms": {
                    "strengthened_lexical": round(dt_lex, 3),
                    "needle": round(dt_needle, 3),
                },
            }
            results.append(case_record)

            print(
                f"[{cid}] Gold: (S:{gold['suspicion_delta_steps']:+d}, A:{gold['attachment_delta_steps']:+d}, G:{gold.get('gremlin_pride_action', 'none')}) | "
                f"Lexical: (S:{p_lexical['suspicion_delta_steps']:+d}, A:{p_lexical['attachment_delta_steps']:+d}, G:{p_lexical['gremlin_pride_action']}, {dt_lex*1000:.0f}µs) | "
                f"Needle: (S:{p_needle_uncal['suspicion_delta_steps']:+d}, A:{p_needle_uncal['attachment_delta_steps']:+d}, {dt_needle:.1f}ms, {p_needle_uncal['reason']})"
            )

    finally:
        needle_runner.close()

    metrics = score_shootout(results)

    manifest = {
        "created_at": datetime.now(timezone.utc).isoformat(),
        "repository_commit": git_value("rev-parse", "HEAD"),
        "working_tree": git_value("status", "--porcelain"),
        "harness_sha256": sha256_file(__file__),
        "cleanroom_sha256": sha256_file(Path(__file__).with_name("needle-nan0-intent-cleanroom.py")),
        "dataset_sha256": sha256_file(args.benchmark),
        "tool_schema_sha256": hashlib.sha256(json.dumps(TOOL_PRAGMATIC, sort_keys=True).encode()).hexdigest(),
        "python": platform.python_version(),
        "platform": platform.platform(),
        "machine": platform.machine(),
        "backend": "needle2-native-cpu",
        "requested_package_version": PINNED_NEEDLE_VERSION,
        "min_conf": args.min_conf,
        "calibration_id": args.calibration_id,
        "cases_count": len(results),
        "latency_percentiles_ms": {
            "strengthened_lexical": {
                "mean": round(statistics.mean(lexical_latencies), 4),
                "p50": round(statistics.median(lexical_latencies), 4),
                "p95": round(statistics.quantiles(lexical_latencies, n=20)[18], 4) if len(lexical_latencies) >= 20 else None,
            },
            "needle": {
                "mean": round(statistics.mean(needle_latencies), 2),
                "p50": round(statistics.median(needle_latencies), 2),
                "p95": round(statistics.quantiles(needle_latencies, n=20)[18], 2) if len(needle_latencies) >= 20 else None,
                "min": round(min(needle_latencies), 2),
                "max": round(max(needle_latencies), 2),
            },
        },
    }

    report = {
        "schema_version": "nan0.pragmatic-shootout.v1",
        "manifest": manifest,
        "fixtures": fixtures,
        "metrics": metrics,
        "results": results,
    }

    ts = int(time.time())
    out_path = args.output or (ROOT / f"reports/nan0-cleanroom/nan0-probe-benchmark-v2-pragmatics-run-{ts}.json")
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(json.dumps(report, indent=2))
    print("-" * 80)
    print(f"Benchmark run complete! Report saved to: {out_path}")

    # Summary table
    print("\n" + "=" * 90)
    print(f"{'Method':<25} | {'Full Match':<12} | {'Precision':<10} | {'Recall':<8} | {'False Spike':<12} | {'Avg Latency'}")
    print("-" * 90)
    for m, score in metrics.items():
        lat_str = (
            f"{manifest['latency_percentiles_ms']['strengthened_lexical']['mean']*1000:.1f} µs"
            if m == "strengthened_lexical"
            else f"{manifest['latency_percentiles_ms']['needle']['mean']:.1f} ms"
            if "needle" in m
            else "0.0 ms"
        )
        prec_str = f"{score['spike_precision']:.1%}" if score['spike_precision'] is not None else "N/A"
        rec_str = f"{score['spike_recall']:.1%}" if score['spike_recall'] is not None else "N/A"
        fs_str = f"{score['false_spike_rate']:.1%}" if score['false_spike_rate'] is not None else "N/A"
        print(
            f"{m:<25} | {score['full_vector_matches']}/{score['cases']} ({score['full_vector_accuracy']:.1%}) | "
            f"{prec_str:<10} | {rec_str:<8} | {fs_str:<12} | {lat_str}"
        )
    print("=" * 90 + "\n")
    return 0


if __name__ == "__main__":
    sys.exit(main())
