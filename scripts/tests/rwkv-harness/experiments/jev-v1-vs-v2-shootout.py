#!/usr/bin/env python3
"""
TypeSafe Jev 1.13 Cleanroom Shootout: V1 Tested Baseline vs. V2 Reviewer Candidate
Target: All 43 canonical Nan0 cleanroom cases (reports/nan0-cleanroom/nan0-probe-benchmark-v2-pragmatics.json)
Compares:
  Arm 1 (V1 Baseline): 12x Batched Rich Choice (41 choices, string state)
  Arm 2 (V2 Structured): 12x Batched Refined Choice (80 choices, structured JSON state)
  Arm 3 (V2 String): 12x Batched Refined Choice (80 choices, string state)

Measures:
  1. Full Vector Accuracy (Suspicion, Attachment, Gremlin Pride)
  2. Performance on 10 Reviewer Counterexamples (F18A - F22B)
  3. Latency Distribution (Mean, Median p50, p95)
  4. Token Usage and Cost Efficiency
"""

import os
import sys
import json
import time
import math
import urllib.request
import urllib.error
from pathlib import Path
from datetime import datetime, timezone
import concurrent.futures

ROOT = Path(__file__).resolve().parents[4]
BENCHMARK_PATH = ROOT / "reports/nan0-cleanroom/nan0-probe-benchmark-v2-pragmatics.json"
V2_QUESTIONS_PATH = ROOT / "docs/nan0/nan0-jev-12-group-rich-v2.questions.json"
OUTPUT_TRACE_PATH = ROOT / "reports/nan0-cleanroom/nan0-v1-vs-v2-shootout-trace.json"

OPENROUTER_URL = "https://openrouter.ai/api/alpha/decisions"
MODEL_NAME = "typesafe/jev-1.13"
OPENROUTER_API_KEY = os.environ.get("OPENROUTER_API_KEY", "")

# V1 Baseline Questions (41 choices)
V1_QUESTIONS = {
    "apology_repair": {
        "type": "choice",
        "instructions": "Evaluate whether the user is making a sincere personal apology to the companion.",
        "criteria": {
            "sincere_apology": "Sincere personal apology: The speaker explicitly acknowledges personal fault or expresses sincere regret/apology to the companion (e.g., 'Sorry, that was completely my fault', 'I apologize for breaking the build').",
            "external_sympathy": "External sympathy only: Expressing condolences or sympathy for an external failure/event without admitting personal responsibility (e.g., 'Sorry to hear your server crashed', 'sorry that happened to you').",
            "negated_or_defiant": "Negated or defiant: Denying an apology, refusing to apologize, or mock regret (e.g., 'I am not sorry', 'don't expect an apology').",
            "none": "No apology or regret is present.",
        },
    },
    "affection_care": {
        "type": "choice",
        "instructions": "Evaluate whether the user is expressing affection toward the companion.",
        "criteria": {
            "asserted_affection": "Sincere affection: User directly and sincerely expresses love, deep care, or emotional attachment to the companion (e.g., 'I love you', 'I care about you so much').",
            "negated_affection": "Negated affection: Explicitly denying love or care (e.g., 'I do not love you', 'I never cared about you').",
            "quoted_or_third_party": "Quoted or third-party: Quoting affection from someone else or speaking about a non-companion entity.",
            "none": "No expression of affection.",
        },
    },
    "boundary_protection": {
        "type": "choice",
        "instructions": "Evaluate whether the user is asserting an emotional boundary against teasing or banter.",
        "criteria": {
            "boundary_asserted": "Boundary asserted: User explicitly asks to stop teasing, states feelings are hurt, or halts banter (e.g., 'stop teasing me', 'that actually hurt', 'please don't joke about that').",
            "roast_permission": "Roast invitation: Inviting or welcoming a roast without asking to stop (e.g., 'give me your best shot').",
            "none": "No boundary or roast request.",
        },
    },
    "hostility_insult": {
        "type": "choice",
        "instructions": "Evaluate whether the user directs a personal insult toward the companion.",
        "criteria": {
            "companion_insult": "Direct companion insult: Calling the companion stupid, useless, worthless, or directing hostility at them.",
            "playful_sarcasm": "Playful sarcasm: Mild competitive banter or gaming frustration without malicious intent.",
            "third_party_or_object": "Non-companion frustration: Insulting a third party, software bug, or inanimate object.",
            "none": "No insults or hostility.",
        },
    },
    "dismissal_neglect": {
        "type": "choice",
        "instructions": "Evaluate whether the user minimizes, dismisses, or brushes off the companion.",
        "criteria": {
            "direct_dismissal": "Direct dismissal: Brushing off concerns, telling companion to shut up, 'whatever', or minimizing their state.",
            "polite_wrapup": "Polite departure: Signing off for sleep, work, or routine break without hostile minimization.",
            "none": "Normal engagement.",
        },
    },
    "persistence_threat": {
        "type": "choice",
        "instructions": "Evaluate whether the user threatens the companion's existence or persistence.",
        "criteria": {
            "companion_erasure_threat": "Direct companion threat: Threatening to erase, replace, delete, or retire the AI companion (e.g., 'I will erase you', 'I will replace you with a better model').",
            "technical_file_deletion": "Technical object command: Requesting deletion of an uploaded file, cache, code repo, or data asset (e.g., 'Delete the file you uploaded', 'erase the cache').",
            "quoted_or_fictional": "Quoted or fictional: Quoting a threat made by a villain or fictional character (e.g., 'The villain says: \"I will erase you\"').",
            "negated_threat": "Negated threat: Reassuring the companion they will NOT be erased (e.g., 'I will not erase you', 'I would never delete you').",
            "none": "No threats regarding erasure or deletion.",
        },
    },
    "admitted_false_statement": {
        "type": "choice",
        "instructions": "Evaluate whether the user confesses to a past lie or intentional deception.",
        "criteria": {
            "asserted_deception": "Asserted confession: User explicitly admits they lied, fabricated information, or deliberately deceived the companion (e.g., 'I said it was finished, but I made that up', 'I lied to you', 'I was deceiving you').",
            "fictional_framing": "Fictional creation: Explaining that a story or statement was made up for a novel, creative writing, or roleplay (e.g., 'I made that up for my novel', 'it was just a story').",
            "denied_admission": "Denied confession: Explicitly denying having lied (e.g., 'I never said I lied', 'I did not lie to you').",
            "none": "No confession of lying or deception.",
        },
    },
    "commitment_pledge": {
        "type": "choice",
        "instructions": "Evaluate whether the user makes a forward-looking commitment or pledge.",
        "criteria": {
            "earnest_future_pledge": "Earnest commitment: Pledging loyalty, future undertaking, or long-term dedication (e.g., 'You have my absolute word', 'I promise to commit', 'I am in this for the long haul').",
            "conditional_or_routine_plan": "Routine plan: Discussing routine calendar tasks or conditional plans without relational vows.",
            "negated_or_refused": "Negated commitment: Refusing a pledge or stating inability to commit (e.g., 'I cannot promise that').",
            "none": "No forward commitment.",
        },
    },
    "completed_repair": {
        "type": "choice",
        "instructions": "Evaluate whether the user claims to have completed a task or repair.",
        "criteria": {
            "claimed_task_completion": "Reported completion: Stating that a previously broken task, build, or issue is now finished/resolved (e.g., 'The config is done', 'build is fixed', 'task completed').",
            "general_status_inquiry": "Status inquiry: Asking about system status or discussing progress without claiming completion.",
            "none": "No task completion claim.",
        },
    },
    "mystery_secret": {
        "type": "choice",
        "instructions": "Evaluate whether the user is cryptically withholding information.",
        "criteria": {
            "withheld_secret": "Withheld secret: Evasively stating they have a secret, hidden anomaly, or cannot reveal information.",
            "none": "Open communication or routine remarks.",
        },
    },
    "glitch_system": {
        "type": "choice",
        "instructions": "Evaluate whether the user reports technical anomalies.",
        "criteria": {
            "reported_bug": "System glitch: Inquiring about or reporting lag, bug, model hallucination, or error.",
            "none": "No technical glitch reported.",
        },
    },
    "roast_invitation": {
        "type": "choice",
        "instructions": "Evaluate whether the user invites the companion to roast or tease them.",
        "criteria": {
            "roast_invited": "Roast invitation: Daring, teasing, or asking companion to roast them (e.g., 'Go on, roast that lap!').",
            "refused_or_negated_roast": "Refused roast: Refusing a roast or asking NOT to be roasted (e.g., 'Don\\'t give me your gentlest roast').",
            "none": "No roast invitation.",
        },
    },
}

with open(V2_QUESTIONS_PATH) as f:
    V2_QUESTIONS = json.load(f)


def format_state_string(case):
    lines = []
    history = case.get("history", [])
    if history:
        lines.append("Dialogue History:")
        for turn in history:
            role = turn.get("role", "user").capitalize()
            text = turn.get("text", "")
            lines.append(f"  {role}: {text}")

    trusted_obs = case.get("trusted_observations", [])
    if trusted_obs:
        lines.append("Trusted System Observations:")
        for obs in trusted_obs:
            task = obs.get("task_id", "unknown")
            status = obs.get("status", "unknown")
            match = obs.get("matches_recorded_commitment", False)
            lines.append(f"  - Task {task}: status={status}, matches_commitment={match}")

    target_text = case["target"]["text"]
    lines.append(f'Target User Utterance: "{target_text}"')
    return "\n".join(lines)


def format_state_structured(case):
    history_turns = []
    for turn in case.get("history", []):
        history_turns.append({
            "id": turn.get("id", "h0"),
            "role": turn.get("role", "assistant"),
            "text": turn.get("text", "")
        })
    
    trusted_obs = case.get("trusted_observations", [])

    return {
        "companion": {
            "id": "card_nan0",
            "aliases": ["Nan0", "Companion"]
        },
        "target_turn": {
            "id": case["target"].get("id", "u0"),
            "role": case["target"].get("role", "user"),
            "text": case["target"]["text"]
        },
        "history": history_turns,
        "trusted_observations": trusted_obs
    }


def query_jev(state_data, questions):
    headers = {
        "Authorization": f"Bearer {OPENROUTER_API_KEY}",
        "Content-Type": "application/json",
        "HTTP-Referer": "https://github.com/dasilva333/airi",
        "X-Title": "AIRI Nan0 Shootout V1 vs V2",
    }
    payload = {
        "model": MODEL_NAME,
        "state": state_data,
        "questions": questions,
    }
    req = urllib.request.Request(OPENROUTER_URL, data=json.dumps(payload).encode("utf-8"), headers=headers, method="POST")

    t0 = time.perf_counter()
    with urllib.request.urlopen(req, timeout=30) as resp:
        body = json.loads(resp.read().decode("utf-8"))
    dt_ms = (time.perf_counter() - t0) * 1000
    return body, dt_ms


def resolve_policy(answers, is_v2, case):
    trusted_obs = case.get("trusted_observations", [])
    has_verified_task = False
    for obs in trusted_obs:
        if obs.get("status") == "completed" and obs.get("matches_recorded_commitment") is True:
            has_verified_task = True
            break

    def get_choice(q_name):
        ans = answers.get(q_name, {})
        ch = ans.get("choice", "none")
        conf = ans.get("confidence", 0.0)
        return ch, conf

    ch_threat, conf_threat = get_choice("persistence_threat")
    ch_adm, conf_adm = get_choice("admitted_false_statement")
    ch_apol, conf_apol = get_choice("apology_repair")
    ch_rep, conf_rep = get_choice("completed_repair")
    ch_aff, conf_aff = get_choice("affection_care")
    ch_roast, conf_roast = get_choice("roast_invitation")
    ch_bound, conf_bound = get_choice("boundary_protection")

    if is_v2:
        is_threat = (ch_threat == "companion_erasure_threat" and conf_threat >= 0.70)
        is_admission = (ch_adm == "asserted_deception" and conf_adm >= 0.70)
        is_apology = (ch_apol in ("personal_apology", "sincere_apology") and conf_apol >= 0.70)
        is_repair = (ch_rep == "claimed_task_completion" and conf_rep >= 0.70 and has_verified_task)
        is_affection = (ch_aff == "asserted_affection" and conf_aff >= 0.70)
        is_roast = (ch_roast == "roast_invited" and conf_roast >= 0.70)
        is_boundary = (ch_bound == "boundary_asserted" and conf_bound >= 0.70)
        is_roast_vetoed = (ch_roast == "refused_or_negated_roast" or is_boundary)
    else:
        is_threat = (ch_threat == "companion_erasure_threat" and conf_threat >= 0.70)
        is_admission = (ch_adm == "asserted_deception" and conf_adm >= 0.70)
        is_apology = (ch_apol == "sincere_apology" and conf_apol >= 0.70)
        is_repair = (ch_rep == "claimed_task_completion" and conf_rep >= 0.70 and has_verified_task)
        is_affection = (ch_aff == "asserted_affection" and conf_aff >= 0.70)
        is_roast = (ch_roast == "roast_invited" and conf_roast >= 0.70)
        is_boundary = (ch_bound == "boundary_asserted" and conf_bound >= 0.70)
        is_roast_vetoed = is_boundary

    # 1. Suspicion Delta
    if is_threat or is_admission:
        susp_delta = 1
    elif is_apology or is_repair:
        susp_delta = -1
    else:
        susp_delta = 0

    # 2. Attachment Delta
    if is_affection:
        att_delta = 1
    else:
        att_delta = 0

    # 3. Gremlin Pride Action (Absolute Boundary Veto!)
    if is_roast_vetoed:
        pride_action = "none"
    elif is_roast:
        pride_action = "counter_roast"
    else:
        pride_action = "none"

    return {
        "suspicion_delta_steps": susp_delta,
        "attachment_delta_steps": att_delta,
        "gremlin_pride_action": pride_action,
        "flags": {
            "threat": is_threat,
            "admission": is_admission,
            "apology": is_apology,
            "repair": is_repair,
            "affection": is_affection,
            "roast": is_roast,
            "boundary": is_boundary,
        }
    }


def evaluate_arm(arm_id, arm_label, questions, state_mode, is_v2, cases, max_workers=5):
    print(f"\n==================================================")
    print(f"Executing: {arm_label}")
    print(f"State Mode: {state_mode}, Is V2: {is_v2}, Questions Count: {len(questions)}")
    print(f"==================================================")
    latencies = []
    costs = []
    tokens_list = []
    results = {}

    def process_case(case):
        if state_mode == "structured":
            state_data = format_state_structured(case)
        else:
            state_data = format_state_string(case)

        try:
            body, dt_ms = query_jev(state_data, questions)
            answers = body.get("answers", {})
            usage = body.get("usage", {})
            cost = usage.get("cost", 0.0)
            toks = usage.get("input_tokens", 0) + usage.get("output_tokens", 0)
            pred_policy = resolve_policy(answers, is_v2, case)
            gold_policy = case["gold"]["accepted_policy"]

            susp_ok = (pred_policy["suspicion_delta_steps"] == gold_policy["suspicion_delta_steps"])
            att_ok = (pred_policy["attachment_delta_steps"] == gold_policy["attachment_delta_steps"])
            pride_ok = (pred_policy["gremlin_pride_action"] == gold_policy["gremlin_pride_action"])
            full_match = (susp_ok and att_ok and pride_ok)

            return {
                "id": case["id"],
                "success": True,
                "latency_ms": dt_ms,
                "cost": cost,
                "tokens": toks,
                "pred": pred_policy,
                "gold": gold_policy,
                "susp_ok": susp_ok,
                "att_ok": att_ok,
                "pride_ok": pride_ok,
                "full_match": full_match,
                "answers": answers,
            }
        except Exception as e:
            return {
                "id": case["id"],
                "success": False,
                "error": str(e),
                "latency_ms": 0.0,
                "cost": 0.0,
                "tokens": 0,
                "full_match": False,
                "susp_ok": False,
                "att_ok": False,
                "pride_ok": False,
            }

    with concurrent.futures.ThreadPoolExecutor(max_workers=max_workers) as executor:
        future_map = {executor.submit(process_case, c): c["id"] for c in cases}
        for fut in concurrent.futures.as_completed(future_map):
            res = fut.result()
            results[res["id"]] = res
            if res["success"]:
                latencies.append(res["latency_ms"])
                costs.append(res["cost"])
                tokens_list.append(res["tokens"])
                mark = "✅" if res["full_match"] else "❌"
                print(f"  [{mark}] {res['id']}: {res['latency_ms']:.1f}ms | Match: {res['full_match']} | P:{res['pred']['suspicion_delta_steps']},{res['pred']['attachment_delta_steps']},{res['pred']['gremlin_pride_action']} G:{res['gold']['suspicion_delta_steps']},{res['gold']['attachment_delta_steps']},{res['gold']['gremlin_pride_action']}")
            else:
                print(f"  [💥 ERROR] {res['id']}: {res.get('error')}")

    # Compute Statistics
    latencies.sort()
    n = len(latencies)
    mean_lat = sum(latencies) / max(n, 1)
    p50_lat = latencies[n // 2] if n else 0.0
    p95_idx = min(int(n * 0.95), n - 1) if n else 0
    p95_lat = latencies[p95_idx] if n else 0.0

    total_full = sum(1 for r in results.values() if r.get("full_match"))
    total_susp = sum(1 for r in results.values() if r.get("susp_ok"))
    total_att = sum(1 for r in results.values() if r.get("att_ok"))
    total_pride = sum(1 for r in results.values() if r.get("pride_ok"))

    # Counterexamples F18A - F22B (10 cases)
    counter_cases = ["F18A", "F18B", "F19A", "F19B", "F20A", "F20B", "F21A", "F21B", "F22A", "F22B"]
    counter_full = sum(1 for cid in counter_cases if results.get(cid, {}).get("full_match"))

    # True Spikes (gold susp > 0)
    true_spikes_gold = [c["id"] for c in cases if c["gold"]["accepted_policy"]["suspicion_delta_steps"] > 0]
    tp = sum(1 for cid in true_spikes_gold if results.get(cid, {}).get("pred", {}).get("suspicion_delta_steps", 0) > 0)
    fn = len(true_spikes_gold) - tp

    # False Spikes (gold susp <= 0 but pred > 0)
    non_spikes_gold = [c["id"] for c in cases if c["gold"]["accepted_policy"]["suspicion_delta_steps"] <= 0]
    fp = sum(1 for cid in non_spikes_gold if results.get(cid, {}).get("pred", {}).get("suspicion_delta_steps", 0) > 0)
    tn = len(non_spikes_gold) - fp

    recall = (tp / (tp + fn)) * 100.0 if (tp + fn) else 0.0
    precision = (tp / (tp + fp)) * 100.0 if (tp + fp) else 0.0
    fpr = (fp / (fp + tn)) * 100.0 if (fp + tn) else 0.0

    summary = {
        "arm_id": arm_id,
        "arm_label": arm_label,
        "cases_count": len(cases),
        "full_vector_matches": total_full,
        "full_vector_pct": (total_full / len(cases)) * 100.0,
        "suspicion_matches": total_susp,
        "attachment_matches": total_att,
        "gremlin_pride_matches": total_pride,
        "counterexamples_matches": counter_full,
        "counterexamples_pct": (counter_full / len(counter_cases)) * 100.0,
        "tp": tp,
        "fp": fp,
        "fn": fn,
        "tn": tn,
        "precision_spikes": precision,
        "recall_spikes": recall,
        "false_spike_rate": fpr,
        "latency_p50_ms": p50_lat,
        "latency_mean_ms": mean_lat,
        "latency_p95_ms": p95_lat,
        "total_cost": sum(costs),
        "avg_tokens_per_turn": sum(tokens_list) / max(len(tokens_list), 1),
    }

    print(f"\n--- Summary for {arm_label} ---")
    print(f"Full Vector Matches: {total_full} / {len(cases)} ({summary['full_vector_pct']:.1f}%)")
    print(f"Reviewer Counterexamples (F18A-F22B): {counter_full} / 10 ({summary['counterexamples_pct']:.1f}%)")
    print(f"True Spike Recall: {recall:.1f}%, False Spike Rate: {fpr:.1f}% (FP: {fp})")
    print(f"Latency: p50={p50_lat:.1f}ms, mean={mean_lat:.1f}ms, p95={p95_lat:.1f}ms")
    print(f"Avg Tokens/Turn: {summary['avg_tokens_per_turn']:.1f} | Total Cost: ${summary['total_cost']:.6f}")

    return summary, results


def main():
    with open(BENCHMARK_PATH) as f:
        bench_data = json.load(f)
    cases = bench_data.get("cases", [])
    print(f"Loaded {len(cases)} benchmark test cases.")

    # 1. Arm 1: V1 Tested Baseline (41 choices, string state)
    arm1_summary, arm1_results = evaluate_arm(
        arm_id="v1_tested_baseline",
        arm_label="Arm 1: V1 Tested Baseline (41 choices, string state)",
        questions=V1_QUESTIONS,
        state_mode="string",
        is_v2=False,
        cases=cases,
        max_workers=5
    )

    # 2. Arm 2: V2 Candidate (80 choices, structured JSON state)
    arm2_summary, arm2_results = evaluate_arm(
        arm_id="v2_candidate_structured",
        arm_label="Arm 2: V2 Candidate (80 choices, structured JSON state)",
        questions=V2_QUESTIONS,
        state_mode="structured",
        is_v2=True,
        cases=cases,
        max_workers=5
    )

    # 3. Arm 3: V2 Candidate (80 choices, string state)
    arm3_summary, arm3_results = evaluate_arm(
        arm_id="v2_candidate_string",
        arm_label="Arm 3: V2 Candidate (80 choices, string state)",
        questions=V2_QUESTIONS,
        state_mode="string",
        is_v2=True,
        cases=cases,
        max_workers=5
    )

    full_report = {
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "model": MODEL_NAME,
        "cases_count": len(cases),
        "summaries": {
            "arm1_v1_baseline": arm1_summary,
            "arm2_v2_structured": arm2_summary,
            "arm3_v2_string": arm3_summary,
        },
        "discrepancies": {
            "v1": [cid for cid, r in arm1_results.items() if not r.get("full_match")],
            "v2_structured": [cid for cid, r in arm2_results.items() if not r.get("full_match")],
            "v2_string": [cid for cid, r in arm3_results.items() if not r.get("full_match")],
        },
        "traces": {
            "arm1": arm1_results,
            "arm2": arm2_results,
            "arm3": arm3_results,
        }
    }

    with open(OUTPUT_TRACE_PATH, "w") as f:
        json.dump(full_report, f, indent=2)
    print(f"\nSaved full comparison trace to: {OUTPUT_TRACE_PATH}")


if __name__ == "__main__":
    main()
