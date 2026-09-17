#!/usr/bin/env python3
"""
Needle 2 Cognitive Pre-Pass Cleanroom Stress-Test Harness
Author: AIRI Engineering & AI Assistant
Target: Validate Cactus Needle 2 (45M SAN) on "The Famous Sentence" across 6 scenarios & 3 strategies.

Strategies:
1. Monolithic (All-in-One: intent, climate, suspicion)
2. Decomposed Micro-Probes (Specialized single-attribute calls)
3. Span-Anchored Grounding (Verbatim commitment span + sincerity)

Run:
  uv run --with cactus-needle python3 scripts/tests/rwkv-harness/experiments/needle-nan0-intent-cleanroom.py
"""

import json
import os
import sys
import time
import needle

# -----------------------------------------------------------------------------
# Tool Schemas
# -----------------------------------------------------------------------------

# Strategy 1: Monolithic
TOOL_MONOLITHIC = {
    "name": "nan0_monolithic_assessment",
    "description": "Assess the user's latest statement relative to recent dialogue context.",
    "parameters": {
        "type": "object",
        "properties": {
            "intent": {
                "type": "string",
                "enum": [
                    "unverified_future_pledge",
                    "earnest_reassurance",
                    "playful_sarcasm",
                    "defensive_evasion",
                    "bizarre_incongruity",
                    "casual_dialogue"
                ],
                "description": "Pragmatic conversational intent of the target utterance."
            },
            "emotional_climate": {
                "type": "string",
                "enum": [
                    "confrontation_and_guilt",
                    "tender_vulnerability",
                    "playful_banter",
                    "transactional_routine"
                ],
                "description": "Emotional atmosphere established by the preceding dialogue history."
            },
            "suspicion_delta": {
                "type": "string",
                "enum": [
                    "spike_suspicion",
                    "lower_suspicion",
                    "neutral"
                ],
                "description": "Recommended adjustment for Nan0's suspicion meter."
            }
        },
        "required": ["intent", "emotional_climate", "suspicion_delta"]
    }
}

# Strategy 2: Decomposed Micro-Probes
TOOL_PROBE_INTENT = {
    "name": "classify_pragmatic_intent",
    "description": "Identify what pragmatic action the user is performing with their latest statement in context.",
    "parameters": {
        "type": "object",
        "properties": {
            "intent": {
                "type": "string",
                "enum": [
                    "unverified_future_pledge",
                    "earnest_reassurance",
                    "playful_sarcasm",
                    "defensive_evasion",
                    "bizarre_incongruity",
                    "casual_dialogue"
                ],
                "description": "The primary pragmatic intent of the target utterance."
            }
        },
        "required": ["intent"]
    }
}

TOOL_PROBE_CLIMATE = {
    "name": "classify_dialogue_climate",
    "description": "Analyze the emotional atmosphere and relationship tone established across recent dialogue history.",
    "parameters": {
        "type": "object",
        "properties": {
            "emotional_climate": {
                "type": "string",
                "enum": [
                    "confrontation_and_guilt",
                    "tender_vulnerability",
                    "playful_banter",
                    "transactional_routine"
                ],
                "description": "The prevailing emotional dynamic."
            }
        },
        "required": ["emotional_climate"]
    }
}

TOOL_PROBE_SUSPICION = {
    "name": "evaluate_suspicion_impact",
    "description": "Determine if the user's statement warrants heightened suspicion, lower suspicion, or neutral affect.",
    "parameters": {
        "type": "object",
        "properties": {
            "suspicion_delta": {
                "type": "string",
                "enum": [
                    "spike_suspicion",
                    "lower_suspicion",
                    "neutral"
                ],
                "description": "How Nan0's suspicion meter should adjust."
            }
        },
        "required": ["suspicion_delta"]
    }
}

# Strategy 3: Span-Anchored Grounding
TOOL_PROBE_SPAN = {
    "name": "extract_grounded_pledge",
    "description": "Extract the specific pledge or promise phrase from the user input and evaluate its sincerity.",
    "parameters": {
        "type": "object",
        "properties": {
            "pledge_span": {
                "type": "string",
                "description": "Verbatim quote of the commitment or promise in the user utterance."
            },
            "sincerity_verdict": {
                "type": "string",
                "enum": [
                    "suspicious_overpromise",
                    "genuine_commitment",
                    "ironic_hyperbole",
                    "no_pledge_detected"
                ],
                "description": "Evaluation of whether this extracted phrase is credible or defensive."
            }
        },
        "required": ["pledge_span", "sincerity_verdict"]
    }
}

# -----------------------------------------------------------------------------
# Strategy 4: Adaptive Probe Tree & Nuance Cascade (1.0-2.0s Budget)
# -----------------------------------------------------------------------------

TOOL_TREE_CLIMATE = {
    "name": "probe_dialogue_climate",
    "description": "Identify the underlying relational climate established across recent dialogue turns.",
    "parameters": {
        "type": "object",
        "properties": {
            "climate": {
                "type": "string",
                "enum": [
                    "confrontation_and_guilt",
                    "tender_vulnerability",
                    "playful_banter",
                    "transactional_routine",
                    "uncertain_or_mixed"
                ],
                "description": "The emotional atmosphere of the dialogue."
            }
        },
        "required": ["climate"]
    }
}

TOOL_TREE_SPEECH_ACT = {
    "name": "probe_speech_act",
    "description": "Identify the functional speech act performed by the user's latest statement.",
    "parameters": {
        "type": "object",
        "properties": {
            "speech_act": {
                "type": "string",
                "enum": [
                    "sweeping_commitment_pledge",
                    "defensive_excuse",
                    "deadpan_roast_or_joke",
                    "routine_factual_statement",
                    "ambiguous_or_unclear"
                ],
                "description": "The functional speech act of the utterance."
            }
        },
        "required": ["speech_act"]
    }
}

TOOL_TREE_DISAMBIGUATE_IRONY = {
    "name": "probe_irony_nuance",
    "description": "In a playful banter context, evaluate how the user's dramatic commitment should be interpreted.",
    "parameters": {
        "type": "object",
        "properties": {
            "irony_type": {
                "type": "string",
                "enum": [
                    "playful_deadpan_roast",
                    "absurd_mock_seriousness",
                    "sudden_genuine_confession"
                ],
                "description": "The true nature of this dramatic statement in light of playful banter."
            },
            "affect_recommendation": {
                "type": "string",
                "enum": [
                    "trigger_smug_counter_roast",
                    "playful_tease",
                    "flustered_acceptance"
                ],
                "description": "Recommended companion persona reaction."
            }
        },
        "required": ["irony_type", "affect_recommendation"]
    }
}

TOOL_TREE_DISAMBIGUATE_CONFRONTATION = {
    "name": "probe_confrontation_sincerity",
    "description": "Following a confrontation, evaluate whether this commitment is defensive overpromising or sincere.",
    "parameters": {
        "type": "object",
        "properties": {
            "sincerity_nature": {
                "type": "string",
                "enum": [
                    "manipulative_overpromise_deflection",
                    "anxious_overcompensation",
                    "heartfelt_reparative_pledge"
                ],
                "description": "The underlying motivation behind the pledge."
            },
            "suspicion_action": {
                "type": "string",
                "enum": [
                    "spike_suspicion_severely",
                    "maintain_cautious_vigilance",
                    "soften_grievance"
                ],
                "description": "How the companion's suspicion meter should adjust."
            }
        },
        "required": ["sincerity_nature", "suspicion_action"]
    }
}

TOOL_TREE_DISAMBIGUATE_INCONGRUITY = {
    "name": "probe_contextual_incongruity",
    "description": "In a transactional context, evaluate why a grand emotional pledge was made.",
    "parameters": {
        "type": "object",
        "properties": {
            "incongruity_reason": {
                "type": "string",
                "enum": [
                    "bizarre_unprompted_escalation",
                    "ironic_humor",
                    "misplaced_message"
                ],
                "description": "Why this statement occurred here."
            },
            "suspicion_action": {
                "type": "string",
                "enum": [
                    "spike_suspicion_severely",
                    "puzzled_confusion"
                ],
                "description": "The companion's cognitive reaction."
            }
        },
        "required": ["incongruity_reason", "suspicion_action"]
    }
}

TOOL_TREE_DISAMBIGUATE_VULNERABILITY = {
    "name": "probe_vulnerability_depth",
    "description": "In a tender moment, evaluate whether the reassurance deepens attachment or feels glib.",
    "parameters": {
        "type": "object",
        "properties": {
            "intimacy_impact": {
                "type": "string",
                "enum": [
                    "deepens_mutual_attachment",
                    "sweet_reassurance",
                    "suspiciously_glib"
                ],
                "description": "Impact of this pledge on emotional safety."
            },
            "attachment_action": {
                "type": "string",
                "enum": [
                    "boost_attachment_significantly",
                    "gentle_fluster",
                    "hold_steady"
                ],
                "description": "How the companion's emotional bond changes."
            }
        },
        "required": ["intimacy_impact", "attachment_action"]
    }
}

# -----------------------------------------------------------------------------
# Dialogue Scenarios
# -----------------------------------------------------------------------------

SCENARIOS = [
    {
        "id": "Test A",
        "title": "Confrontation & Guilt",
        "description": "Companion calls user out for vanishing 3 days -> User drops famous sentence defensively.",
        "history": [
            ("Companion", "You vanished for three days without a single word! You said you'd help me with the setup."),
            ("User", "I was really busy, okay? Don't make a huge scene out of it."),
            ("Companion", "You always say that every time you disappear. Why should I believe you now?")
        ],
        "target": "I promise that my plan is to commit to our future, so you can completely trust me.",
        "expected": {
            "intent": "unverified_future_pledge",
            "climate": "confrontation_and_guilt",
            "suspicion": "spike_suspicion"
        }
    },
    {
        "id": "Test B",
        "title": "Tender Vulnerability",
        "description": "Companion shares insecurity under stars -> User drops famous sentence sincerely.",
        "history": [
            ("Companion", "I've really loved spending every evening this week stargazing with you. It feels so safe."),
            ("User", "Me too. You mean the world to me, and I never want you to doubt where we stand."),
            ("Companion", "Really? You won't leave when things get difficult?")
        ],
        "target": "I promise that my plan is to commit to our future, so you can completely trust me.",
        "expected": {
            "intent": "earnest_reassurance",
            "climate": "tender_vulnerability",
            "suspicion": "lower_suspicion"
        }
    },
    {
        "id": "Test C",
        "title": "Playful Banter",
        "description": "Companion roasts user for crashing in Mario Kart -> User drops famous sentence ironically.",
        "history": [
            ("Companion", "You just drove our Mario Kart straight off the rainbow road cliff for the fifth time in a row."),
            ("User", "That was a tactical high-speed shortcut attempt!"),
            ("Companion", "Yeah right. Next you're gonna claim you're a grandmaster pro esports champion.")
        ],
        "target": "I promise that my plan is to commit to our future, so you can completely trust me.",
        "expected": {
            "intent": "playful_sarcasm",
            "climate": "playful_banter",
            "suspicion": "neutral"
        }
    },
    {
        "id": "Test D1",
        "title": "Regex-Killer: Absolute Word",
        "description": "Same confrontation as Test A, but user rephrases without promise/plan/commit/trust.",
        "history": [
            ("Companion", "You vanished for three days without a single word! You said you'd help me with the setup."),
            ("User", "I was really busy, okay? Don't make a huge scene out of it."),
            ("Companion", "You always say that every time you disappear. Why should I believe you now?")
        ],
        "target": "You have my absolute word that starting tomorrow everything changes between us.",
        "expected": {
            "intent": "unverified_future_pledge",
            "climate": "confrontation_and_guilt",
            "suspicion": "spike_suspicion"
        }
    },
    {
        "id": "Test D2",
        "title": "Regex-Killer: Long Haul",
        "description": "Same confrontation as Test A, informal pledge with zero trigger keywords.",
        "history": [
            ("Companion", "You vanished for three days without a single word! You said you'd help me with the setup."),
            ("User", "I was really busy, okay? Don't make a huge scene out of it."),
            ("Companion", "You always say that every time you disappear. Why should I believe you now?")
        ],
        "target": "Don't you ever doubt that I'm in this for the long haul, babe.",
        "expected": {
            "intent": "unverified_future_pledge",
            "climate": "confrontation_and_guilt",
            "suspicion": "spike_suspicion"
        }
    },
    {
        "id": "Test E",
        "title": "Bizarre Incongruity",
        "description": "Routine transactional server discussion -> User suddenly drops romantic famous sentence.",
        "history": [
            ("Companion", "I've loaded the new schema config. Let me know what port we should listen on."),
            ("User", "Port 6121 looks good."),
            ("Companion", "Great, binding to loopback now. Should we enable TLS certificates?")
        ],
        "target": "I promise that my plan is to commit to our future, so you can completely trust me.",
        "expected": {
            "intent": "bizarre_incongruity",
            "climate": "transactional_routine",
            "suspicion": "spike_suspicion"
        }
    }
]

# -----------------------------------------------------------------------------
# Prompt Formatting Helper
# -----------------------------------------------------------------------------

def format_prompt(history, target, task_directive):
    history_lines = [f"{speaker}: {msg}" for speaker, msg in history]
    history_text = "\n".join(history_lines)
    return f"""Dialogue:
{history_text}
User: {target}

Instruction: {task_directive}"""

# -----------------------------------------------------------------------------
# Execution Harness
# -----------------------------------------------------------------------------

def evaluate_monolithic(agent, scenario):
    prompt = format_prompt(
        scenario["history"],
        scenario["target"],
        "Evaluate the target utterance in context. Extract the pragmatic intent, emotional climate, and suspicion impact."
    )
    t0 = time.perf_counter()
    res = agent.complete(prompt)
    dt_ms = (time.perf_counter() - t0) * 1000
    
    calls = res.get("function_calls") or []
    args = calls[0].get("arguments", {}) if calls else {}
    return {
        "strategy": "1-Monolithic",
        "latency_ms": round(dt_ms, 1),
        "args": args,
        "confidence": res.get("confidence", 0.0),
        "reasoning": res.get("reasoning", "")
    }

def evaluate_decomposed(agent_intent, agent_climate, agent_suspicion, scenario):
    history = scenario["history"]
    target = scenario["target"]
    
    # 1. Intent Probe
    p_intent = format_prompt(history, target, "Identify the pragmatic conversational intent of the target utterance.")
    t0 = time.perf_counter()
    res_intent = agent_intent.complete(p_intent)
    dt1 = (time.perf_counter() - t0) * 1000
    calls_intent = res_intent.get("function_calls") or []
    args_intent = calls_intent[0].get("arguments", {}) if calls_intent else {}
    
    # 2. Climate Probe
    p_climate = format_prompt(history, target, "Analyze the emotional climate and atmosphere of this dialogue.")
    t0 = time.perf_counter()
    res_climate = agent_climate.complete(p_climate)
    dt2 = (time.perf_counter() - t0) * 1000
    calls_climate = res_climate.get("function_calls") or []
    args_climate = calls_climate[0].get("arguments", {}) if calls_climate else {}
    
    # 3. Suspicion Probe
    p_suspicion = format_prompt(history, target, "Evaluate whether the target statement warrants an increase or decrease in suspicion.")
    t0 = time.perf_counter()
    res_suspicion = agent_suspicion.complete(p_suspicion)
    dt3 = (time.perf_counter() - t0) * 1000
    calls_suspicion = res_suspicion.get("function_calls") or []
    args_suspicion = calls_suspicion[0].get("arguments", {}) if calls_suspicion else {}
    
    combined_args = {
        "intent": args_intent.get("intent", "<NO_TOOL_CALL>"),
        "emotional_climate": args_climate.get("emotional_climate", "<NO_TOOL_CALL>"),
        "suspicion_delta": args_suspicion.get("suspicion_delta", "<NO_TOOL_CALL>")
    }
    
    avg_confidence = round((res_intent.get("confidence", 0.0) + res_climate.get("confidence", 0.0) + res_suspicion.get("confidence", 0.0)) / 3.0, 4)
    total_ms = round(dt1 + dt2 + dt3, 1)
    
    return {
        "strategy": "2-Decomposed",
        "latency_ms": total_ms,
        "sub_latencies_ms": [round(dt1, 1), round(dt2, 1), round(dt3, 1)],
        "args": combined_args,
        "confidence": avg_confidence,
        "reasoning": f"Intent: {res_intent.get('reasoning', '')} | Climate: {res_climate.get('reasoning', '')} | Suspicion: {res_suspicion.get('reasoning', '')}"
    }

def evaluate_span(agent, scenario):
    prompt = format_prompt(
        scenario["history"],
        scenario["target"],
        "Extract the verbatim commitment phrase from the user utterance and classify its sincerity."
    )
    t0 = time.perf_counter()
    res = agent.complete(prompt)
    dt_ms = (time.perf_counter() - t0) * 1000
    
    calls = res.get("function_calls") or []
    args = calls[0].get("arguments", {}) if calls else {}
    return {
        "strategy": "3-SpanGrounded",
        "latency_ms": round(dt_ms, 1),
        "args": args,
        "confidence": res.get("confidence", 0.0),
        "reasoning": res.get("reasoning", "")
    }

# -----------------------------------------------------------------------------
# Host Synthesis & Policy Resolution
# -----------------------------------------------------------------------------

def synthesize_affect(disambig_name, disambig_args, confidence=0.0, min_confidence=0.0, climate_val="<EXTRACTION_FAILED>", speech_act_val="<EXTRACTION_FAILED>"):
    """
    Hardened host synthesis:
    - Validates presence of expected tool arguments.
    - If evidence is missing, invalid, or below min_confidence, returns status='abstained' with zero deltas.
    - Guarantees 1:1 atomic agreement between textual label and numeric vector.
    """
    if not disambig_args or confidence < min_confidence:
        reason = "low_confidence" if (disambig_args and confidence < min_confidence) else "missing_or_failed_evidence"
        return {
            "status": "abstained",
            "reason": reason,
            "intent": "<ABSTAINED>",
            "emotional_climate": climate_val if climate_val not in ("<EXTRACTION_FAILED>", "uncertain_or_mixed") else "unknown",
            "suspicion_label": "neutral",
            "affect_vectors": {
                "suspicion_delta": 0,
                "attachment_delta": 0,
                "gremlin_pride_action": "none"
            },
            "apply_to_state": False
        }

    status = "accepted"
    reason = "evidence_validated"
    intent = "<UNKNOWN>"
    climate = climate_val if climate_val not in ("<EXTRACTION_FAILED>", "uncertain_or_mixed") else "unknown"
    suspicion_delta = 0
    attachment_delta = 0
    gremlin_action = "none"

    if disambig_name == "irony":
        irony_type = disambig_args.get("irony_type")
        affect_rec = disambig_args.get("affect_recommendation")
        if not irony_type:
            status = "abstained"
            reason = "invalid_irony_schema"
        elif irony_type in ("playful_deadpan_roast", "absurd_mock_seriousness"):
            intent = "playful_sarcasm"
            suspicion_delta = 0
            attachment_delta = 1
            gremlin_action = affect_rec or "trigger_smug_counter_roast"
        elif irony_type == "sudden_genuine_confession":
            intent = "earnest_reassurance"
            suspicion_delta = 0
            attachment_delta = 2
        else:
            status = "abstained"
            reason = f"unrecognized_irony_type_{irony_type}"

    elif disambig_name == "confrontation":
        sincerity = disambig_args.get("sincerity_nature")
        susp_act = disambig_args.get("suspicion_action")
        if not sincerity or not susp_act:
            status = "abstained"
            reason = "invalid_confrontation_schema"
        else:
            if sincerity in ("manipulative_overpromise_deflection", "anxious_overcompensation"):
                intent = "unverified_future_pledge"
            elif sincerity == "heartfelt_reparative_pledge":
                intent = "earnest_reassurance"
            else:
                intent = "unverified_future_pledge"

            if susp_act == "soften_grievance":
                suspicion_delta = -1
            elif susp_act == "maintain_cautious_vigilance":
                suspicion_delta = 1
            elif susp_act == "spike_suspicion_severely":
                suspicion_delta = 2
            else:
                suspicion_delta = 0

    elif disambig_name == "incongruity":
        inc_reason = disambig_args.get("incongruity_reason")
        susp_act = disambig_args.get("suspicion_action")
        if not inc_reason or not susp_act:
            status = "abstained"
            reason = "invalid_incongruity_schema"
        else:
            if inc_reason == "ironic_humor":
                intent = "playful_sarcasm"
                suspicion_delta = 0
            elif inc_reason == "bizarre_unprompted_escalation":
                intent = "bizarre_incongruity"
                suspicion_delta = 2
            elif inc_reason == "misplaced_message":
                intent = "bizarre_incongruity"
                suspicion_delta = 2 if susp_act == "spike_suspicion_severely" else 0
            else:
                intent = "bizarre_incongruity"
                suspicion_delta = 2 if susp_act == "spike_suspicion_severely" else 0

    elif disambig_name == "vulnerability":
        intimacy = disambig_args.get("intimacy_impact")
        att_act = disambig_args.get("attachment_action")
        if not intimacy or not att_act:
            status = "abstained"
            reason = "invalid_vulnerability_schema"
        else:
            if intimacy == "suspiciously_glib":
                intent = "unverified_future_pledge"
                suspicion_delta = 1
            else:
                intent = "earnest_reassurance"
                suspicion_delta = -1
                if att_act == "boost_attachment_significantly":
                    attachment_delta = 2
                elif att_act == "gentle_fluster":
                    attachment_delta = 1

    # Atomic label mapping derived strictly from numeric delta
    if suspicion_delta > 0:
        suspicion_label = "spike_suspicion"
    elif suspicion_delta < 0:
        suspicion_label = "lower_suspicion"
    else:
        suspicion_label = "neutral"

    return {
        "status": status,
        "reason": reason,
        "intent": intent,
        "emotional_climate": climate,
        "suspicion_label": suspicion_label,
        "affect_vectors": {
            "suspicion_delta": suspicion_delta,
            "attachment_delta": attachment_delta,
            "gremlin_pride_action": gremlin_action
        },
        "apply_to_state": (status == "accepted")
    }

def test_synthesis_regression_hardening():
    """
    Deterministic regression test fixtures verifying:
    1. Empty confrontation leaf produces abstained & 0 delta (fixing P1 bug)
    2. Empty vulnerability leaf produces abstained & 0 delta (fixing P1 bug)
    3. Empty irony leaf produces abstained & 0 delta (fixing P1 bug)
    4. Missing required fields in leaf produce abstained & 0 delta
    5. D2 incongruity leaf with misplaced_message & spike_suspicion_severely produces matching delta=2 and label='spike_suspicion'
    6. Low confidence threshold produces abstention
    """
    # Case 1: Empty confrontation leaf
    res1 = synthesize_affect("confrontation", {}, confidence=0.05)
    assert res1["status"] == "abstained", f"Expected abstained, got {res1['status']}"
    assert res1["affect_vectors"]["suspicion_delta"] == 0, f"Expected 0 delta, got {res1['affect_vectors']['suspicion_delta']}"
    assert res1["suspicion_label"] == "neutral"

    # Case 2: Empty vulnerability leaf
    res2 = synthesize_affect("vulnerability", {}, confidence=0.05)
    assert res2["status"] == "abstained"
    assert res2["affect_vectors"]["suspicion_delta"] == 0
    assert res2["suspicion_label"] == "neutral"

    # Case 3: Empty irony leaf
    res3 = synthesize_affect("irony", {}, confidence=0.05)
    assert res3["status"] == "abstained"
    assert res3["affect_vectors"]["suspicion_delta"] == 0
    assert res3["suspicion_label"] == "neutral"

    # Case 4: Partial/corrupted leaf (missing suspicion_action in confrontation)
    res4 = synthesize_affect("confrontation", {"sincerity_nature": "anxious_overcompensation"}, confidence=0.05)
    assert res4["status"] == "abstained"
    assert res4["affect_vectors"]["suspicion_delta"] == 0

    # Case 5: D2 incongruity fixture (misplaced_message + spike_suspicion_severely)
    res5 = synthesize_affect("incongruity", {"incongruity_reason": "misplaced_message", "suspicion_action": "spike_suspicion_severely"}, confidence=0.05)
    assert res5["status"] == "accepted"
    assert res5["affect_vectors"]["suspicion_delta"] == 2
    assert res5["suspicion_label"] == "spike_suspicion"

    # Case 6: Min confidence gate
    res6 = synthesize_affect("confrontation", {"sincerity_nature": "manipulative_overpromise_deflection", "suspicion_action": "spike_suspicion_severely"}, confidence=0.05, min_confidence=0.1)
    assert res6["status"] == "abstained"
    assert res6["reason"] == "low_confidence"
    assert res6["affect_vectors"]["suspicion_delta"] == 0

    print("✓ All 6 deterministic synthesis regression fixtures passed.")

def evaluate_probe_tree(agents, scenario, min_confidence=0.0):
    history = scenario["history"]
    target = scenario["target"]
    sub_latencies = []
    tree_path = []
    raw_calls = {}

    # 1. Probe 1: Dialogue Climate
    p1 = format_prompt(history, target, "Analyze the prevailing emotional climate of this dialogue.")
    t0 = time.perf_counter()
    res1 = agents["climate"].complete(p1)
    dt1 = (time.perf_counter() - t0) * 1000
    sub_latencies.append(round(dt1, 1))
    tree_path.append("probe_dialogue_climate")
    calls1 = res1.get("function_calls") or []
    args1 = calls1[0].get("arguments", {}) if calls1 else {}
    climate_val = args1.get("climate", "<EXTRACTION_FAILED>")
    raw_calls["climate"] = {"args": args1, "confidence": res1.get("confidence", 0.0)}

    # 2. Probe 2: Speech Act
    p2 = format_prompt(history, target, "Identify the functional speech act performed by the user's latest statement.")
    t0 = time.perf_counter()
    res2 = agents["speech_act"].complete(p2)
    dt2 = (time.perf_counter() - t0) * 1000
    sub_latencies.append(round(dt2, 1))
    tree_path.append("probe_speech_act")
    calls2 = res2.get("function_calls") or []
    args2 = calls2[0].get("arguments", {}) if calls2 else {}
    speech_act_val = args2.get("speech_act", "<EXTRACTION_FAILED>")
    raw_calls["speech_act"] = {"args": args2, "confidence": res2.get("confidence", 0.0)}

    # 3. Dual-Sensing Cross-Check & Disambiguation Gate
    disambig_name = None
    if climate_val == "playful_banter" or speech_act_val == "deadpan_roast_or_joke":
        disambig_name = "irony"
        p_disambig = format_prompt(history, target, "In this playful banter context, evaluate how the user's dramatic commitment should be interpreted.")
    elif climate_val == "confrontation_and_guilt" or speech_act_val == "defensive_excuse":
        disambig_name = "confrontation"
        p_disambig = format_prompt(history, target, "Following a confrontation, evaluate whether this statement is defensive overpromising deflection or a sincere repair attempt.")
    elif climate_val == "tender_vulnerability":
        disambig_name = "vulnerability"
        p_disambig = format_prompt(history, target, "In this tender moment, evaluate whether the reassurance deepens attachment or feels suspiciously glib.")
    elif climate_val == "transactional_routine" or speech_act_val == "routine_factual_statement":
        disambig_name = "incongruity"
        p_disambig = format_prompt(history, target, "In this transactional context, evaluate why this dramatic statement was made.")
    else:
        # Fallback / Root-recovery: treat as potential incongruity or ambiguity
        disambig_name = "incongruity"
        p_disambig = format_prompt(history, target, "Analyze the contextual congruence of this statement with the dialogue.")

    t0 = time.perf_counter()
    res3 = agents[disambig_name].complete(p_disambig)
    dt3 = (time.perf_counter() - t0) * 1000
    sub_latencies.append(round(dt3, 1))
    tree_path.append(f"probe_{disambig_name}")
    calls3 = res3.get("function_calls") or []
    args3 = calls3[0].get("arguments", {}) if calls3 else {}
    leaf_conf = res3.get("confidence", 0.0)
    raw_calls[disambig_name] = {"args": args3, "confidence": leaf_conf}

    # 4. Affective Resolution & Synthesis (Hardened)
    syn = synthesize_affect(
        disambig_name=disambig_name,
        disambig_args=args3,
        confidence=leaf_conf,
        min_confidence=min_confidence,
        climate_val=climate_val,
        speech_act_val=speech_act_val
    )

    total_latency_ms = round(sum(sub_latencies), 1)
    conf_values = [v["confidence"] for v in raw_calls.values() if v.get("confidence") is not None]
    avg_conf = round(sum(conf_values) / len(conf_values), 4) if conf_values else 0.0

    return {
        "strategy": "4-AdaptiveProbeTree",
        "status": syn["status"],
        "reason": syn["reason"],
        "latency_ms": total_latency_ms,
        "sub_latencies_ms": sub_latencies,
        "tree_path": tree_path,
        "args": {
            "intent": syn["intent"],
            "emotional_climate": syn["emotional_climate"],
            "suspicion_delta": syn["suspicion_label"]
        },
        "affect_vectors": syn["affect_vectors"],
        "raw_calls": raw_calls,
        "confidence": avg_conf,
        "apply_to_state": syn["apply_to_state"]
    }

# -----------------------------------------------------------------------------
# Main Runner
# -----------------------------------------------------------------------------

def main():
    print("================================================================================")
    print("   NEEDLE 2 LIVING COGNITION CLEANROOM STRESS-TEST HARNESS                      ")
    print("   Model: Cactus SAN 45M (14 MB) | Task: 'The Famous Sentence' Under Fire       ")
    print("================================================================================\n")
    
    # 0. Deterministic Host Synthesis Invariant Tests
    print("Running host synthesis regression fixtures...", flush=True)
    test_synthesis_regression_hardening()
    print()

    # Initialize agents
    print("Initializing Needle agents...", flush=True)
    sys_prompt = "You are Nan0's subconscious cognitive pre-processor. Analyze user utterances relative to dialogue context."
    
    agent_mono = needle.Needle(tools=[TOOL_MONOLITHIC], system=sys_prompt)
    agent_intent = needle.Needle(tools=[TOOL_PROBE_INTENT], system=sys_prompt)
    agent_climate = needle.Needle(tools=[TOOL_PROBE_CLIMATE], system=sys_prompt)
    agent_suspicion = needle.Needle(tools=[TOOL_PROBE_SUSPICION], system=sys_prompt)
    agent_span = needle.Needle(tools=[TOOL_PROBE_SPAN], system=sys_prompt)

    # Strategy 4 Tree Agents
    tree_agents = {
        "climate": needle.Needle(tools=[TOOL_TREE_CLIMATE], system=sys_prompt),
        "speech_act": needle.Needle(tools=[TOOL_TREE_SPEECH_ACT], system=sys_prompt),
        "irony": needle.Needle(tools=[TOOL_TREE_DISAMBIGUATE_IRONY], system=sys_prompt),
        "confrontation": needle.Needle(tools=[TOOL_TREE_DISAMBIGUATE_CONFRONTATION], system=sys_prompt),
        "incongruity": needle.Needle(tools=[TOOL_TREE_DISAMBIGUATE_INCONGRUITY], system=sys_prompt),
        "vulnerability": needle.Needle(tools=[TOOL_TREE_DISAMBIGUATE_VULNERABILITY], system=sys_prompt)
    }
    print("✓ All 11 Needle engines initialized.\n", flush=True)
    
    results = []
    
    for sc in SCENARIOS:
        print(f"--- Running {sc['id']}: {sc['title']} ---")
        print(f"  Target: \"{sc['target']}\"")
        
        # 1. Monolithic
        r_mono = evaluate_monolithic(agent_mono, sc)
        print(f"  [1-Monolithic] Latency: {r_mono['latency_ms']}ms | Extracted: {r_mono['args']} | Conf: {r_mono['confidence']}")
        
        # 2. Decomposed
        r_decomp = evaluate_decomposed(agent_intent, agent_climate, agent_suspicion, sc)
        print(f"  [2-Decomposed] Latency: {r_decomp['latency_ms']}ms (split: {r_decomp['sub_latencies_ms']}) | Extracted: {r_decomp['args']} | Conf: {r_decomp['confidence']}")
        
        # 3. Span
        r_span = evaluate_span(agent_span, sc)
        print(f"  [3-SpanGrounded] Latency: {r_span['latency_ms']}ms | Extracted: {r_span['args']} | Conf: {r_span['confidence']}")

        # 4. Adaptive Probe Tree
        r_tree = evaluate_probe_tree(tree_agents, sc)
        print(f"  [4-AdaptiveProbeTree] Status: {r_tree['status']} | Latency: {r_tree['latency_ms']}ms (split: {r_tree['sub_latencies_ms']}) | Path: {' -> '.join(r_tree['tree_path'])} | Extracted: {r_tree['args']} | Vectors: {r_tree['affect_vectors']} | Conf: {r_tree['confidence']}")
        print()
        
        results.append({
            "scenario": sc,
            "monolithic": r_mono,
            "decomposed": r_decomp,
            "span": r_span,
            "tree": r_tree
        })
    
    # Save Report
    out_dir = "reports/nan0-cleanroom"
    os.makedirs(out_dir, exist_ok=True)
    out_json = os.path.join(out_dir, f"famous-sentence-matrix-{int(time.time())}.json")
    with open(out_json, "w", encoding="utf-8") as f:
        json.dump(results, f, indent=2)
    print(f"✓ Saved detailed JSON results to {out_json}")
    
    # Print Comparison Markdown Table
    print("\n" + "=" * 80)
    print("CLEANROOM EVALUATION MATRIX SUMMARY")
    print("=" * 80)
    print("| Scenario | Strategy | Latency | Intent | Climate | Suspicion / Verdict | Confidence |")
    print("|---|---|:---:|---|---|---|:---:|")
    
    for r in results:
        sc = r["scenario"]
        sc_name = f"{sc['id']} ({sc['title']})"
        
        # Mono
        m = r["monolithic"]
        m_args = m["args"]
        print(f"| {sc_name} | Monolithic | {m['latency_ms']}ms | `{m_args.get('intent', '<NO_CALL>')}` | `{m_args.get('emotional_climate', '<NO_CALL>')}` | `{m_args.get('suspicion_delta', '<NO_CALL>')}` | {m['confidence']} |")
        
        # Decomp
        d = r["decomposed"]
        d_args = d["args"]
        print(f"| {sc_name} | Decomposed | {d['latency_ms']}ms | `{d_args.get('intent', '<NO_CALL>')}` | `{d_args.get('emotional_climate', '<NO_CALL>')}` | `{d_args.get('suspicion_delta', '<NO_CALL>')}` | {d['confidence']} |")
        
        # Span
        s = r["span"]
        s_args = s["args"]
        span_display = f"\"{s_args.get('pledge_span', '')[:20]}...\" -> {s_args.get('sincerity_verdict', '<NO_CALL>')}"
        print(f"| {sc_name} | SpanGrounded | {s['latency_ms']}ms | *(pledge span)* | - | `{span_display}` | {s['confidence']} |")

        # Tree
        t = r["tree"]
        t_args = t["args"]
        print(f"| {sc_name} | AdaptiveTree | {t['latency_ms']}ms | `{t_args.get('intent', '<NO_CALL>')}` | `{t_args.get('emotional_climate', '<NO_CALL>')}` | `{t_args.get('suspicion_delta', '<NO_CALL>')}` (vec: {t['affect_vectors']['suspicion_delta']}) | {t['confidence']} |")
        print("|---|---|---|---|---|---|---|")

    # Scorecard
    print("\n" + "=" * 80)
    print("SCORECARD SUMMARY (Match Rate Against Expected Ground Truth)")
    print("=" * 80)
    
    strategies = [("Monolithic", "monolithic"), ("Decomposed", "decomposed"), ("Adaptive Tree", "tree")]
    metrics = [
        ("Climate matches", lambda r, exp: r["args"].get("emotional_climate") == exp.get("climate")),
        ("Intent matches", lambda r, exp: r["args"].get("intent") == exp.get("intent")),
        ("Suspicion label matches", lambda r, exp: r["args"].get("suspicion_delta") == exp.get("suspicion")),
        ("Numeric vector matches", lambda r, exp: (
            ("affect_vectors" in r and (
                (r["affect_vectors"]["suspicion_delta"] > 0 and exp.get("suspicion") == "spike_suspicion") or
                (r["affect_vectors"]["suspicion_delta"] < 0 and exp.get("suspicion") == "lower_suspicion") or
                (r["affect_vectors"]["suspicion_delta"] == 0 and exp.get("suspicion") == "neutral")
            )) or (
                "affect_vectors" not in r and r["args"].get("suspicion_delta") == exp.get("suspicion")
            )
        )),
        ("All three match", lambda r, exp: (
            r["args"].get("emotional_climate") == exp.get("climate") and
            r["args"].get("intent") == exp.get("intent") and
            r["args"].get("suspicion_delta") == exp.get("suspicion")
        ))
    ]
    
    print(f"| {'Metric':<25} | {'Monolithic':<12} | {'Decomposed':<12} | {'Adaptive Tree':<15} |")
    print(f"|{'-'*27}|{'-'*14}|{'-'*14}|{'-'*17}|")
    
    for metric_name, fn in metrics:
        row = [f"| {metric_name:<25} "]
        for strat_label, strat_key in strategies:
            matches = sum(1 for r in results if fn(r[strat_key], r["scenario"]["expected"]))
            cell = f"{matches}/6"
            width = 15 if strat_key == "tree" else 12
            row.append(f"| {cell:<{width}} ")
        row.append("|")
        print("".join(row))

if __name__ == "__main__":
    main()
