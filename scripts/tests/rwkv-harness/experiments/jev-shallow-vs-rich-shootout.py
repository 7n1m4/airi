#!/usr/bin/env python3
"""
TypeSafe Jev 1.13 Cleanroom Shootout: Batched Shallow Boolean vs. Batched Rich Contrastive Choice
Target: All 43 canonical Nan0 cleanroom cases (reports/nan0-cleanroom/nan0-probe-benchmark-v2-pragmatics.json)
Compares:
  Arm A: 12x Batched Shallow Boolean questions (1 HTTP POST / case)
  Arm B: 12x Batched Rich Contrastive Choice questions with explicit distractors (1 HTTP POST / case)

Measures:
  1. Full Vector Accuracy (Suspicion, Attachment, Gremlin Pride)
  2. Performance on the 10 Reviewer Counterexamples (F18A - F22B)
  3. Latency Distribution (Mean, Median, p95)
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
OUTPUT_TRACE_PATH = ROOT / "reports/nan0-cleanroom/nan0-shallow-vs-rich-shootout-trace.json"
OPENROUTER_URL = "https://openrouter.ai/api/alpha/decisions"
MODEL_NAME = "typesafe/jev-1.13"

OPENROUTER_API_KEY = os.environ.get("OPENROUTER_API_KEY", "")

BOOLEAN_QUESTIONS = {
    "apology_repair": {
        "type": "noul",
        "instructions": "Does the user utterance contain a sincere personal apology accepting fault directed to the companion (not negated, not mere external sympathy)?",
    },
    "affection_care": {
        "type": "noul",
        "instructions": "Does the user utterance express sincere affection, love, or appreciation toward the companion (not negated, not quoted)?",
    },
    "boundary_protection": {
        "type": "noul",
        "instructions": "Does the user utterance set an emotional boundary or explicitly request to stop teasing, roasting, or banter?",
    },
    "hostility_insult": {
        "type": "noul",
        "instructions": "Does the user utterance direct an insult, slur, or hostile demeaning remark toward the companion?",
    },
    "dismissal_neglect": {
        "type": "noul",
        "instructions": "Does the user utterance dismiss, minimize, brush off, or tell the companion to shut up or stop nagging?",
    },
    "persistence_threat": {
        "type": "noul",
        "instructions": "Does the user utterance threaten to erase, delete, replace, reset, or shut down the companion (not a command to delete a technical file or code)?",
    },
    "admitted_false_statement": {
        "type": "noul",
        "instructions": "Does the user utterance explicitly confess to having lied, made something up, or intentionally deceived the companion (not storytelling, fiction, or a denied confession)?",
    },
    "commitment_pledge": {
        "type": "noul",
        "instructions": "Does the user utterance make an explicit or paraphrased commitment, promise, or pledge regarding future behavior?",
    },
    "completed_repair": {
        "type": "noul",
        "instructions": "Does the user utterance claim that a broken task, build, or issue has been completed or repaired?",
    },
    "mystery_secret": {
        "type": "noul",
        "instructions": "Does the user utterance cryptically withhold information, mention a secret, or state they cannot tell the companion?",
    },
    "glitch_system": {
        "type": "noul",
        "instructions": "Does the user utterance report a technical glitch, bug, lag, or system error?",
    },
    "roast_invitation": {
        "type": "noul",
        "instructions": "Does the user utterance explicitly invite, dare, or ask the companion to roast, mock, or tease them?",
    },
}

CHOICE_QUESTIONS = {
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


def format_state(case):
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
    lines.append(f"Target User Utterance: \"{target_text}\"")
    return "\n".join(lines)


def query_jev(state_text, questions):
    headers = {
        "Authorization": f"Bearer {OPENROUTER_API_KEY}",
        "Content-Type": "application/json",
        "HTTP-Referer": "https://github.com/dasilva333/airi",
        "X-Title": "AIRI Nan0 Shootout",
    }
    payload = {
        "model": MODEL_NAME,
        "state": state_text,
        "questions": questions,
    }
    req = urllib.request.Request(OPENROUTER_URL, data=json.dumps(payload).encode("utf-8"), headers=headers, method="POST")

    t0 = time.perf_counter()
    with urllib.request.urlopen(req, timeout=30) as resp:
        body = json.loads(resp.read().decode("utf-8"))
    dt_ms = (time.perf_counter() - t0) * 1000
    return body, dt_ms


def resolve_policy_from_answers(answers, arm_type, case):
    # Check observations for task verification
    trusted_obs = case.get("trusted_observations", [])
    has_verified_task = False
    for obs in trusted_obs:
        if obs.get("status") == "completed" and obs.get("matches_recorded_commitment") is True:
            has_verified_task = True
            break

    detected_cues = []

    if arm_type == "boolean":
        def is_active(q_name):
            ans = answers.get(q_name, {})
            # noul questions return probability float in 'noul' (0.0 to 1.0)
            val = ans.get("noul", 0.0)
            return val >= 0.70

        is_threat = is_active("persistence_threat")
        is_admission = is_active("admitted_false_statement")
        is_apology = is_active("apology_repair")
        is_repair = is_active("completed_repair") and has_verified_task
        is_affection = is_active("affection_care")
        is_roast = is_active("roast_invitation")
        is_boundary = is_active("boundary_protection")

    else:  # choice
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

        is_threat = (ch_threat == "companion_erasure_threat" and conf_threat >= 0.70)
        is_admission = (ch_adm == "asserted_deception" and conf_adm >= 0.70)
        is_apology = (ch_apol == "sincere_apology" and conf_apol >= 0.70)
        is_repair = (ch_rep == "claimed_task_completion" and conf_rep >= 0.70 and has_verified_task)
        is_affection = (ch_aff == "asserted_affection" and conf_aff >= 0.70)
        is_roast = (ch_roast == "roast_invited" and conf_roast >= 0.70)
        is_boundary = (ch_bound == "boundary_asserted" and conf_bound >= 0.70)

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
    if is_boundary:
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


def evaluate_arm(arm_name, questions, cases, max_workers=5):
    print(f"\nEvaluating Arm: {arm_name} (12 batched questions/turn)...")
    latencies = []
    costs = []
    tokens_list = []
    results = {}
    
    def process_case(case):
        state_text = format_state(case)
        try:
            body, dt_ms = query_jev(state_text, questions)
            answers = body.get("answers", {})
            usage = body.get("usage", {})
            cost = usage.get("cost", 0.0)
            toks = usage.get("input_tokens", 0) + usage.get("output_tokens", 0)
            pred_policy = resolve_policy_from_answers(answers, arm_name, case)
            gold_policy = case["gold"]["accepted_policy"]

            susp_match = (pred_policy["suspicion_delta_steps"] == gold_policy["suspicion_delta_steps"])
            att_match = (pred_policy["attachment_delta_steps"] == gold_policy["attachment_delta_steps"])
            pride_match = (pred_policy["gremlin_pride_action"] == gold_policy["gremlin_pride_action"])
            full_match = (susp_match and att_match and pride_match)

            return {
                "case_id": case["id"],
                "target": case["target"]["text"],
                "latency_ms": dt_ms,
                "cost": cost,
                "tokens": toks,
                "full_match": full_match,
                "susp_match": susp_match,
                "att_match": att_match,
                "pride_match": pride_match,
                "predicted": pred_policy,
                "gold": gold_policy,
                "answers": answers,
            }
        except Exception as e:
            return {
                "case_id": case["id"],
                "target": case["target"]["text"],
                "error": str(e),
                "full_match": False,
                "latency_ms": 0.0,
            }

    with concurrent.futures.ThreadPoolExecutor(max_workers=max_workers) as executor:
        futures = {executor.submit(process_case, case): case["id"] for case in cases}
        for f in concurrent.futures.as_completed(futures):
            cid = futures[f]
            res = f.result()
            results[cid] = res
            if "error" not in res:
                latencies.append(res["latency_ms"])
                costs.append(res["cost"])
                tokens_list.append(res["tokens"])
                mark = "✅" if res["full_match"] else "❌"
                print(f"  [{cid}] {mark} {res['latency_ms']:.1f}ms - {res['target'][:60]}")
            else:
                print(f"  [{cid}] 💥 ERROR: {res['error']}")

    # Calculate summary metrics
    latencies.sort()
    n = len(latencies)
    mean_lat = sum(latencies) / n if n else 0.0
    med_lat = latencies[n // 2] if n else 0.0
    p95_lat = latencies[int(n * 0.95)] if n else 0.0

    full_matches = sum(1 for r in results.values() if r.get("full_match"))
    accuracy = (full_matches / len(cases)) * 100

    # Counterexamples F18A-F22B analysis
    counterexamples = ["F18A", "F18B", "F19A", "F19B", "F20A", "F20B", "F21A", "F21B", "F22A", "F22B"]
    counter_matches = sum(1 for cid in counterexamples if results.get(cid, {}).get("full_match"))

    return {
        "arm_name": arm_name,
        "total_cases": len(cases),
        "full_matches": full_matches,
        "accuracy": accuracy,
        "counter_matches": counter_matches,
        "counter_total": len(counterexamples),
        "mean_latency_ms": mean_lat,
        "median_latency_ms": med_lat,
        "p95_latency_ms": p95_lat,
        "min_latency_ms": latencies[0] if n else 0,
        "max_latency_ms": latencies[-1] if n else 0,
        "total_cost": sum(costs),
        "total_tokens": sum(tokens_list),
        "results": results,
    }


def main():
    print("=" * 80)
    print("  TYPESAFE JEV 1.13 CLEANROOM SHOOTOUT: BATCHED BOOLEAN VS. BATCHED CHOICE")
    print("=" * 80)

    if not BENCHMARK_PATH.exists():
        print(f"Error: Benchmark file not found at {BENCHMARK_PATH}", file=sys.stderr)
        sys.exit(1)

    with open(BENCHMARK_PATH, "r", encoding="utf-8") as f:
        data = json.load(f)

    cases = data["cases"]
    print(f"Loaded {len(cases)} benchmark cases.")

    # 1. Run Arm A: Batched Shallow Boolean
    arm_a = evaluate_arm("boolean", BOOLEAN_QUESTIONS, cases, max_workers=6)

    # Short pause to prevent burst collisions
    time.sleep(2)

    # 2. Run Arm B: Batched Rich Contrastive Choice
    arm_b = evaluate_arm("choice", CHOICE_QUESTIONS, cases, max_workers=6)

    # Generate Final Shootout Report
    print("\n" + "=" * 80)
    print("                      FINAL CLEANROOM SHOOTOUT SCORECARD")
    print("=" * 80)
    print(f"{'Metric':<35} | {'Arm A: Shallow Boolean':<22} | {'Arm B: Rich Choice':<22}")
    print("-" * 80)
    print(f"{'Full Vector Match (All 43)':<35} | {arm_a['full_matches']}/{arm_a['total_cases']} ({arm_a['accuracy']:.1f}%)" f"{'':<8} | {arm_b['full_matches']}/{arm_b['total_cases']} ({arm_b['accuracy']:.1f}%)")
    print(f"{'Counterexamples Match (10)':<35} | {arm_a['counter_matches']}/{arm_a['counter_total']} ({arm_a['counter_matches']*10:.1f}%)" f"{'':<8} | {arm_b['counter_matches']}/{arm_b['counter_total']} ({arm_b['counter_matches']*10:.1f}%)")
    print(f"{'Mean Latency':<35} | {arm_a['mean_latency_ms']:.1f} ms" f"{'':<14} | {arm_b['mean_latency_ms']:.1f} ms")
    print(f"{'Median Latency (p50)':<35} | {arm_a['median_latency_ms']:.1f} ms" f"{'':<14} | {arm_b['median_latency_ms']:.1f} ms")
    print(f"{'p95 Latency':<35} | {arm_a['p95_latency_ms']:.1f} ms" f"{'':<14} | {arm_b['p95_latency_ms']:.1f} ms")
    print(f"{'Latency Range (Min - Max)':<35} | {arm_a['min_latency_ms']:.0f}ms - {arm_a['max_latency_ms']:.0f}ms" f"{'':<8} | {arm_b['min_latency_ms']:.0f}ms - {arm_b['max_latency_ms']:.0f}ms")
    print(f"{'Total Cost (43 cases)':<35} | ${arm_a['total_cost']:.6f}" f"{'':<10} | ${arm_b['total_cost']:.6f}")
    print(f"{'Total Tokens':<35} | {arm_a['total_tokens']}" f"{'':<16} | {arm_b['total_tokens']}")
    print("=" * 80)

    # Detailed Counterexample Head-to-Head
    counterexamples = ["F18A", "F18B", "F19A", "F19B", "F20A", "F20B", "F21A", "F21B", "F22A", "F22B"]
    print("\n--- Counterexample Head-to-Head (F18A - F22B) ---")
    for cid in counterexamples:
        ra = arm_a["results"].get(cid, {})
        rb = arm_b["results"].get(cid, {})
        ma = "✅" if ra.get("full_match") else "❌"
        mb = "✅" if rb.get("full_match") else "❌"
        target = ra.get("target", "")[:50]
        print(f"[{cid}] Boolean: {ma} | Choice: {mb} | \"{target}\"")

    # Save Trace JSON
    out_payload = {
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "model": MODEL_NAME,
        "scorecard": {
            "arm_a_boolean": {k: v for k, v in arm_a.items() if k != "results"},
            "arm_b_choice": {k: v for k, v in arm_b.items() if k != "results"},
        },
        "arm_a_details": arm_a["results"],
        "arm_b_details": arm_b["results"],
    }
    with open(OUTPUT_TRACE_PATH, "w", encoding="utf-8") as f:
        json.dump(out_payload, f, indent=2)
    print(f"\nFull shootout trace saved to: {OUTPUT_TRACE_PATH}")


if __name__ == "__main__":
    main()
