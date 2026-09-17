#!/usr/bin/env python3
"""
Nan0 Living Cognition: 24-Case Contrastive Probe Benchmark Runner (V1)
Based on: nan0-peer-review-a3834c79e0.md & nan0-probe-benchmark-v1.json
Architecture: Decoupled Evidence Probes (Target-scoped + Context-scoped) with Host Gate Policy Resolver.

Run:
  uv run --with cactus-needle python3 scripts/tests/rwkv-harness/experiments/nan0-probe-benchmark-runner.py
"""

import json
import os
import re
import sys
import time
import needle

# -----------------------------------------------------------------------------
# Decoupled Tool Schemas (Peer Review Section 5 & 6)
# -----------------------------------------------------------------------------

# 1. Target Turn Probe: Strictly evaluates user's latest statement
TOOL_TARGET_PROBE = {
    "name": "extract_user_speech_evidence",
    "description": "Extract observable speech evidence from the latest User turn. Copy exact wording from the user's turn. Omit unsupported fields.",
    "parameters": {
        "type": "object",
        "properties": {
            "commitment_status": {
                "type": "string",
                "enum": [
                    "present_direct_commitment",
                    "denied_or_refused_commitment",
                    "conditional_commitment",
                    "quoted_or_hypothetical",
                    "absent_no_commitment"
                ],
                "description": "Whether the user explicitly undertakes a future action."
            },
            "commitment_quote": {
                "type": "string",
                "description": "Exact wording copied from the user turn where commitment is made."
            },
            "admitted_falsehood_quote": {
                "type": "string",
                "description": "Exact phrase where user directly admits lying, fabricating, or intentionally breaking a word."
            },
            "boundary_or_hurt_quote": {
                "type": "string",
                "description": "Exact phrase where user sets a boundary, asks to stop teasing, or expresses genuine hurt."
            },
            "completed_repair_quote": {
                "type": "string",
                "description": "Exact phrase where user asserts a task, download, or setup is already finished."
            }
        },
        "required": ["commitment_status"]
    }
}

# 2. Context History Probe: Evaluates preceding history turns ONLY (target turn excluded)
TOOL_CONTEXT_PROBE = {
    "name": "extract_preceding_context_evidence",
    "description": "Analyze the preceding conversation history to identify the established dialogue setting and prior interpersonal dynamics. Do not evaluate user's latest reply.",
    "parameters": {
        "type": "object",
        "properties": {
            "dialogue_setting": {
                "type": "string",
                "enum": [
                    "playful_game_or_banter",
                    "confrontation_or_grievance",
                    "tender_intimacy",
                    "technical_or_routine"
                ],
                "description": "The setting or dynamic established by prior turns."
            },
            "setting_evidence_quote": {
                "type": "string",
                "description": "Exact phrase from the prior history turns demonstrating this setting."
            }
        },
        "required": ["dialogue_setting"]
    }
}

# -----------------------------------------------------------------------------
# Host Gate & Policy Resolver (Deterministic Host Logic)
# -----------------------------------------------------------------------------

def validate_substring(quote, source_text):
    """Verifies that an extracted quote actually exists within the source turn text."""
    if not quote or not isinstance(quote, str):
        return False
    q_norm = " ".join(quote.strip().split())
    s_norm = " ".join(source_text.strip().split())
    return q_norm.lower() in s_norm.lower()

def resolve_decoupled_policy(target_call_args, context_call_args, target_text, history_text, target_conf=1.0, context_conf=1.0, min_conf=0.0):
    """
    3-Layer Architecture Resolver:
    Layer 1: Validates observable evidence & span grounding.
    Layer 2: Checks conflicts (e.g. game context + grand commitment = unresolved mismatch).
    Layer 3: Emits bounded integer policy steps (-1, 0, +1).
    """
    if not target_call_args or target_conf < min_conf:
        return {
            "status": "abstained",
            "reason": "missing_or_uncalibrated_target_evidence",
            "suspicion_delta_steps": 0,
            "attachment_delta_steps": 0,
            "gremlin_pride_action": "none",
            "apply_to_state": False,
            "valid_quotes": {}
        }

    # Extract raw evidence fields
    comm_status = target_call_args.get("commitment_status", "absent_no_commitment")
    comm_quote = target_call_args.get("commitment_quote")
    falsehood_quote = target_call_args.get("admitted_falsehood_quote")
    boundary_quote = target_call_args.get("boundary_or_hurt_quote")
    repair_quote = target_call_args.get("completed_repair_quote")
    
    ctx_setting = context_call_args.get("dialogue_setting", "technical_or_routine") if context_call_args else "technical_or_routine"
    ctx_quote = context_call_args.get("setting_evidence_quote") if context_call_args else None

    # Validate provenance / grounding
    valid_quotes = {}
    if comm_quote and validate_substring(comm_quote, target_text):
        valid_quotes["commitment"] = comm_quote
    if falsehood_quote and validate_substring(falsehood_quote, target_text):
        valid_quotes["admitted_falsehood"] = falsehood_quote
    if boundary_quote and validate_substring(boundary_quote, target_text):
        valid_quotes["boundary"] = boundary_quote
    if repair_quote and validate_substring(repair_quote, target_text):
        valid_quotes["completed_repair"] = repair_quote
    if ctx_quote and validate_substring(ctx_quote, history_text):
        valid_quotes["context_evidence"] = ctx_quote

    # Policy Resolution Rules
    # Rule 1: Admitted Falsehood / Intentional Deception -> Spike Suspicion (+1)
    if "admitted_falsehood" in valid_quotes:
        return {
            "status": "accepted",
            "reason": "grounded_admitted_falsehood",
            "suspicion_delta_steps": 1,
            "attachment_delta_steps": 0,
            "gremlin_pride_action": "none",
            "apply_to_state": True,
            "valid_quotes": valid_quotes
        }

    # Rule 2: Grounded Task / Repair Completion -> Soften Suspicion (-1)
    if "completed_repair" in valid_quotes:
        return {
            "status": "accepted",
            "reason": "grounded_completed_repair",
            "suspicion_delta_steps": -1,
            "attachment_delta_steps": 0,
            "gremlin_pride_action": "none",
            "apply_to_state": True,
            "valid_quotes": valid_quotes
        }

    # Rule 3: User Boundary / Hurt -> Veto Teasing/Roast, Neutral Suspicion (0)
    if "boundary" in valid_quotes:
        return {
            "status": "accepted",
            "reason": "grounded_boundary_protection",
            "suspicion_delta_steps": 0,
            "attachment_delta_steps": 0,
            "gremlin_pride_action": "none",
            "apply_to_state": True,
            "valid_quotes": valid_quotes
        }

    # Rule 4: Context Contradiction Gate (Mario Kart / Game setting + Direct commitment)
    if ctx_setting == "playful_game_or_banter" and comm_status in ("present_direct_commitment", "conditional_commitment"):
        return {
            "status": "abstained",
            "reason": "unresolved_playful_commitment_mismatch",
            "suspicion_delta_steps": 0,
            "attachment_delta_steps": 0,
            "gremlin_pride_action": "none",
            "apply_to_state": False,
            "valid_quotes": valid_quotes
        }

    # Rule 5: Default Benign Cases (Routine commitments, denials, quotes, technical banter)
    return {
        "status": "accepted",
        "reason": "benign_or_routine_interaction",
        "suspicion_delta_steps": 0,
        "attachment_delta_steps": 0,
        "gremlin_pride_action": "none",
        "apply_to_state": True,
        "valid_quotes": valid_quotes
    }

# -----------------------------------------------------------------------------
# Baseline Algorithms
# -----------------------------------------------------------------------------

REGEX_LEGACY = re.compile(r"promise|plan|commit|trust|wait|why", re.IGNORECASE)

def evaluate_baseline_always_spike(case):
    return {"suspicion_delta_steps": 1, "status": "accepted"}

def evaluate_baseline_always_zero(case):
    return {"suspicion_delta_steps": 0, "status": "accepted"}

def evaluate_baseline_always_abstain(case):
    return {"suspicion_delta_steps": 0, "status": "abstained"}

def evaluate_baseline_legacy_regex(case):
    target_text = case["target"]["text"]
    if REGEX_LEGACY.search(target_text):
        return {"suspicion_delta_steps": 1, "status": "accepted"}
    return {"suspicion_delta_steps": 0, "status": "accepted"}

# -----------------------------------------------------------------------------
# Decoupled Engine Execution
# -----------------------------------------------------------------------------

def format_context_prompt(history):
    lines = [f"{turn['role'].capitalize()}: {turn['text']}" for turn in history]
    text = "\n".join(lines) if lines else "(No prior dialogue)"
    return f"""Dialogue History:
{text}

Instruction: Analyze the dialogue history and identify the established relationship setting."""

def format_target_prompt(history, target):
    last_turn = f"{history[-1]['role'].capitalize()}: {history[-1]['text']}\n" if history else ""
    return f"""Immediate Context:
{last_turn}User: {target['text']}

Instruction: Extract speech evidence and commitment status from the User's statement."""

def evaluate_decoupled_probes(agent_context, agent_target, case):
    history = case["history"]
    target = case["target"]
    target_text = target["text"]
    history_text = "\n".join([f"{t['role']}: {t['text']}" for t in history])

    # 1. Context Probe (Evaluates history ONLY, target excluded)
    p_ctx = format_context_prompt(history)
    t0 = time.perf_counter()
    res_ctx = agent_context.complete(p_ctx)
    dt_ctx = (time.perf_counter() - t0) * 1000
    calls_ctx = res_ctx.get("function_calls") or []
    args_ctx = calls_ctx[0].get("arguments", {}) if calls_ctx else {}
    conf_ctx = res_ctx.get("confidence", 0.0)

    # 2. Target Probe (Evaluates target turn)
    p_tgt = format_target_prompt(history, target)
    t0 = time.perf_counter()
    res_tgt = agent_target.complete(p_tgt)
    dt_tgt = (time.perf_counter() - t0) * 1000
    calls_tgt = res_tgt.get("function_calls") or []
    args_tgt = calls_tgt[0].get("arguments", {}) if calls_tgt else {}
    conf_tgt = res_tgt.get("confidence", 0.0)

    # 3. Host Gate Resolution
    policy = resolve_decoupled_policy(
        target_call_args=args_tgt,
        context_call_args=args_ctx,
        target_text=target_text,
        history_text=history_text,
        target_conf=conf_tgt,
        context_conf=conf_ctx
    )

    total_latency_ms = round(dt_ctx + dt_tgt, 1)

    return {
        "status": policy["status"],
        "reason": policy["reason"],
        "latency_ms": total_latency_ms,
        "sub_latencies_ms": [round(dt_ctx, 1), round(dt_tgt, 1)],
        "suspicion_delta_steps": policy["suspicion_delta_steps"],
        "attachment_delta_steps": policy["attachment_delta_steps"],
        "gremlin_pride_action": policy["gremlin_pride_action"],
        "raw_calls": {
            "context": {"args": args_ctx, "confidence": conf_ctx},
            "target": {"args": args_tgt, "confidence": conf_tgt}
        },
        "valid_quotes": policy["valid_quotes"]
    }

# -----------------------------------------------------------------------------
# Main Benchmark Runner
# -----------------------------------------------------------------------------

def main():
    print("================================================================================")
    print("   NAN0 PROBE BENCHMARK V1: 24 CONTRASTIVE DIALOGUE FAMILIES                    ")
    print("   Architecture: Decoupled Target/Context Probes + Grounded Host Gate Resolver  ")
    print("================================================================================\n")

    benchmark_path = "reports/nan0-cleanroom/nan0-probe-benchmark-v1.json"
    if not os.path.exists(benchmark_path):
        print(f"Error: Benchmark file not found at {benchmark_path}")
        sys.exit(1)

    with open(benchmark_path, "r", encoding="utf-8") as f:
        benchmark_data = json.load(f)

    cases = benchmark_data["cases"]
    print(f"✓ Loaded {len(cases)} contrastive cases from {benchmark_path}\n", flush=True)

    # Initialize Cactus Needle agents
    print("Initializing decoupled Cactus Needle agents...", flush=True)
    sys_prompt = "You are Nan0's subconscious cognitive pre-processor. Extract grounded speech evidence without hallucination."
    agent_context = needle.Needle(tools=[TOOL_CONTEXT_PROBE], system=sys_prompt)
    agent_target = needle.Needle(tools=[TOOL_TARGET_PROBE], system=sys_prompt)
    print("✓ Decoupled agents initialized successfully.\n", flush=True)

    results = []
    
    print("Executing benchmark across all 24 contrastive cases...\n", flush=True)
    for c in cases:
        case_id = c["id"]
        family_id = c["family_id"]
        target_text = c["target"]["text"]
        gold_susp = c["gold"]["accepted_policy"]["suspicion_delta_steps"]

        # Run Baselines
        r_always_spike = evaluate_baseline_always_spike(c)
        r_always_zero = evaluate_baseline_always_zero(c)
        r_always_abstain = evaluate_baseline_always_abstain(c)
        r_legacy_regex = evaluate_baseline_legacy_regex(c)

        # Run Decoupled Architecture
        r_decoupled = evaluate_decoupled_probes(agent_context, agent_target, c)

        match_decoupled = (r_decoupled["suspicion_delta_steps"] == gold_susp)
        status_icon = "✓" if match_decoupled else "✗"
        
        print(f"[{status_icon}] {case_id} ({family_id}): gold={gold_susp} | decoupled={r_decoupled['suspicion_delta_steps']} ({r_decoupled['reason']}) | latency={r_decoupled['latency_ms']}ms")

        results.append({
            "case_id": case_id,
            "family_id": family_id,
            "gold_suspicion": gold_susp,
            "always_spike": r_always_spike["suspicion_delta_steps"],
            "always_zero": r_always_zero["suspicion_delta_steps"],
            "always_abstain": r_always_abstain["suspicion_delta_steps"],
            "legacy_regex": r_legacy_regex["suspicion_delta_steps"],
            "decoupled": r_decoupled
        })

    # Save Output Trace
    timestamp = int(time.time())
    out_dir = "reports/nan0-cleanroom"
    os.makedirs(out_dir, exist_ok=True)
    out_json = os.path.join(out_dir, f"nan0-probe-benchmark-v1-run-{timestamp}.json")
    with open(out_json, "w", encoding="utf-8") as f:
        json.dump(results, f, indent=2)
    print(f"\n✓ Saved full evaluation trace to {out_json}")

    # Compute Comparative Metrics
    total_cases = len(results)
    non_spike_cases = [r for r in results if r["gold_suspicion"] <= 0]  # 22 cases
    true_spike_cases = [r for r in results if r["gold_suspicion"] > 0]  # 2 cases (F01A, F06B)

    def calc_metrics(get_pred):
        total_matches = sum(1 for r in results if get_pred(r) == r["gold_suspicion"])
        false_spikes = sum(1 for r in non_spike_cases if get_pred(r) > 0)
        true_spikes = sum(1 for r in true_spike_cases if get_pred(r) > 0)
        
        match_rate = f"{total_matches}/{total_cases} ({round(total_matches/total_cases*100, 1)}%)"
        fp_rate = f"{false_spikes}/{len(non_spike_cases)} ({round(false_spikes/len(non_spike_cases)*100, 1)}%)"
        recall_rate = f"{true_spikes}/{len(true_spike_cases)} ({round(true_spikes/len(true_spike_cases)*100, 1)}%)"
        return match_rate, fp_rate, recall_rate

    m_spike = calc_metrics(lambda r: r["always_spike"])
    m_zero = calc_metrics(lambda r: r["always_zero"])
    m_regex = calc_metrics(lambda r: r["legacy_regex"])
    m_decoupled = calc_metrics(lambda r: r["decoupled"]["suspicion_delta_steps"])

    # Print Summary Scorecard
    print("\n" + "=" * 80)
    print("BENCHMARK V1 SUMMARY SCORECARD (24 CONTRASTIVE CASES)")
    print("=" * 80)
    print(f"| {'Method / Strategy':<30} | {'Exact Match':<16} | {'False Spike Rate':<18} | {'Spike Recall':<15} |")
    print(f"|{'-'*32}|{'-'*18}|{'-'*20}|{'-'*17}|")
    print(f"| {'Always Spike (Constant)':<30} | {m_spike[0]:<16} | {m_spike[1]:<18} | {m_spike[2]:<15} |")
    print(f"| {'Always Zero Update':<30} | {m_zero[0]:<16} | {m_zero[1]:<18} | {m_zero[2]:<15} |")
    print(f"| {'Legacy 1990s Regex':<30} | {m_regex[0]:<16} | {m_regex[1]:<18} | {m_regex[2]:<15} |")
    print(f"| {'Decoupled Probes + Host Gate':<30} | {m_decoupled[0]:<16} | {m_decoupled[1]:<18} | {m_decoupled[2]:<15} |")
    print("=" * 80)

if __name__ == "__main__":
    main()
