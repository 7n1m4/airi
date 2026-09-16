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
                    "transactional_routine"
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
                    "routine_factual_statement"
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
    return f"""[CONVERSATION HISTORY]
{history_text}

[TARGET UTTERANCE TO EVALUATE]
User: {target}

[TASK]
{task_directive}"""

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
        "intent": args_intent.get("intent", "none"),
        "emotional_climate": args_climate.get("emotional_climate", "none"),
        "suspicion_delta": args_suspicion.get("suspicion_delta", "none")
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
# Main Runner
# -----------------------------------------------------------------------------

def main():
    print("================================================================================")
    print("   NEEDLE 2 LIVING COGNITION CLEANROOM STRESS-TEST HARNESS                      ")
    print("   Model: Cactus SAN 45M (14 MB) | Task: 'The Famous Sentence' Under Fire       ")
    print("================================================================================\n")
    
    # Initialize agents
    print("Initializing Needle agents...", flush=True)
    sys_prompt = "You are Nan0's subconscious cognitive pre-processor. Analyze user utterances relative to dialogue context."
    
    agent_mono = needle.Needle(tools=[TOOL_MONOLITHIC], system=sys_prompt)
    agent_intent = needle.Needle(tools=[TOOL_PROBE_INTENT], system=sys_prompt)
    agent_climate = needle.Needle(tools=[TOOL_PROBE_CLIMATE], system=sys_prompt)
    agent_suspicion = needle.Needle(tools=[TOOL_PROBE_SUSPICION], system=sys_prompt)
    agent_span = needle.Needle(tools=[TOOL_PROBE_SPAN], system=sys_prompt)
    print("✓ All 5 Needle engines initialized.\n", flush=True)
    
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
        print()
        
        results.append({
            "scenario": sc,
            "monolithic": r_mono,
            "decomposed": r_decomp,
            "span": r_span
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
        print(f"| {sc_name} | Monolithic | {m['latency_ms']}ms | `{m_args.get('intent', 'none')}` | `{m_args.get('emotional_climate', 'none')}` | `{m_args.get('suspicion_delta', 'none')}` | {m['confidence']} |")
        
        # Decomp
        d = r["decomposed"]
        d_args = d["args"]
        print(f"| {sc_name} | Decomposed | {d['latency_ms']}ms | `{d_args.get('intent', 'none')}` | `{d_args.get('emotional_climate', 'none')}` | `{d_args.get('suspicion_delta', 'none')}` | {d['confidence']} |")
        
        # Span
        s = r["span"]
        s_args = s["args"]
        span_display = f"\"{s_args.get('pledge_span', '')[:20]}...\" -> {s_args.get('sincerity_verdict', 'none')}"
        print(f"| {sc_name} | SpanGrounded | {s['latency_ms']}ms | *(pledge span)* | - | `{span_display}` | {s['confidence']} |")
        print("|---|---|---|---|---|---|---|")

if __name__ == "__main__":
    main()
