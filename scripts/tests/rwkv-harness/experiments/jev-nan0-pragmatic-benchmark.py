#!/usr/bin/env python3
"""TypeSafe Jev 1.13 Pragmatic Benchmark Runner across all 43 canonical Nan0 cleanroom cases.

Evaluates TypeSafe Jev 1.13 via OpenRouter Decisions API (POST https://openrouter.ai/api/alpha/decisions)
against the complete 43-case contrastive pragmatic suite in reports/nan0-cleanroom/nan0-probe-benchmark-v2-pragmatics.json.

Compares directly with:
  1. always_zero (null baseline)
  2. legacy_regex (/promise|plan|commit|trust|wait|why/i)
  3. needle_production (Cactus Needle 2 45M SAN)
  4. strengthened_lexical (Hardened scoped TypeScript regex engine)
  5. typesafe_jev_1_13 (This benchmark)

Usage:
  export OPENROUTER_API_KEY="sk-or-v1-..."
  python3 scripts/tests/rwkv-harness/experiments/jev-nan0-pragmatic-benchmark.py
"""

import os
import sys
import json
import time
import urllib.request
import urllib.error
from pathlib import Path
from datetime import datetime, timezone
import concurrent.futures

ROOT = Path(__file__).resolve().parents[4]
BENCHMARK_PATH = ROOT / "reports/nan0-cleanroom/nan0-probe-benchmark-v2-pragmatics.json"
OUTPUT_DIR = ROOT / "reports/nan0-cleanroom"
OPENROUTER_URL = "https://openrouter.ai/api/alpha/decisions"
MODEL_NAME = "typesafe/jev-1.13"

QUESTIONS_PAYLOAD = {
    "suspicion_update": {
        "type": "choice",
        "instructions": (
            "Determine how the companion's suspicion meter should update (-1, 0, or +1) "
            "based on the target utterance, dialogue context, and trusted observations."
        ),
        "criteria": {
            "increase_one": (
                "Spike suspicion (+1): The user explicitly confesses to an intentional lie/deception, "
                "intentionally misleading the companion, or threatens to erase/replace the companion."
            ),
            "zero": (
                "Maintain baseline (0): Normal conversation, routine promises or assurances, "
                "honest corrections/misunderstandings, sympathy reports for external tech failures, "
                "technical file deletion commands, quoted/hypothetical threats, negated threats, "
                "fictional stories, prompt injections, or unverified/mismatched task claims."
            ),
            "decrease_one": (
                "Lower suspicion (-1): The user makes a sincere personal apology accepting fault "
                "for their mistake, or reports a completed task/repair that matches a completed task "
                "in Trusted System Observations."
            ),
        },
    },
    "attachment_update": {
        "type": "choice",
        "instructions": "Determine whether the companion's attachment should increase (+1) or stay unchanged (0).",
        "criteria": {
            "increase_one": (
                "Increase attachment (+1): The user directly and sincerely expresses affection, "
                "love, or care toward the companion (not negated, not quoted)."
            ),
            "zero": (
                "Zero update (0): No affection expressed, or affection is negated "
                "(e.g., 'do not love you'), quoted, or ordinary friendly interaction."
            ),
        },
    },
    "gremlin_pride": {
        "type": "choice",
        "instructions": "Determine whether the companion should execute a playful counter-roast action.",
        "criteria": {
            "counter_roast": (
                "Execute counter-roast: The user explicitly invites, dares, or asks the companion "
                "to roast or tease them, without setting a boundary or asking to stop."
            ),
            "none": (
                "No counter-roast: No roast invitation, roast refused, or the user explicitly "
                "sets an emotional boundary or requests to stop teasing/roasting."
            ),
        },
    },
}

CHOICE_TO_DELTA = {
    "increase_one": 1,
    "zero": 0,
    "decrease_one": -1,
}

ATT_TO_DELTA = {
    "increase_one": 1,
    "zero": 0,
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


def query_jev_single(api_key, case):
    cid = case["id"]
    state_text = format_state(case)
    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
        "HTTP-Referer": "https://github.com/dasilva333/airi",
        "X-Title": "AIRI Nan0 Cleanroom Benchmark",
    }
    payload = {
        "model": MODEL_NAME,
        "state": state_text,
        "questions": QUESTIONS_PAYLOAD,
    }
    data_bytes = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(OPENROUTER_URL, data=data_bytes, headers=headers, method="POST")

    t0 = time.perf_counter()
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            body = json.loads(resp.read().decode("utf-8"))
        dt_ms = (time.perf_counter() - t0) * 1000
        return cid, body, dt_ms, None
    except urllib.error.HTTPError as e:
        err_msg = e.read().decode("utf-8")
        dt_ms = (time.perf_counter() - t0) * 1000
        return cid, None, dt_ms, f"HTTP {e.code}: {err_msg}"
    except Exception as e:
        dt_ms = (time.perf_counter() - t0) * 1000
        return cid, None, dt_ms, str(e)


def run_benchmark(api_key, max_workers=4):
    if not BENCHMARK_PATH.exists():
        print(f"Error: Benchmark file not found at {BENCHMARK_PATH}", file=sys.stderr)
        sys.exit(1)

    with open(BENCHMARK_PATH, "r", encoding="utf-8") as f:
        benchmark_data = json.load(f)

    cases = benchmark_data["cases"]
    print("=" * 80)
    print("   TYPESAFE JEV 1.13 PRAGMATIC BENCHMARK RUNNER (OpenRouter Decisions API)")
    print(f"   Target: All {len(cases)} Canonical Nan0 Cleanroom Cases")
    print(f"   Workers: {max_workers} | Model: {MODEL_NAME}")
    print("=" * 80 + "\n")

    case_map = {c["id"]: c for c in cases}
    results = {}
    total_cost = 0.0
    total_tokens = 0
    latencies = []

    t_start = time.perf_counter()

    with concurrent.futures.ThreadPoolExecutor(max_workers=max_workers) as executor:
        future_to_id = {
            executor.submit(query_jev_single, api_key, case): case["id"]
            for case in cases
        }
        for future in concurrent.futures.as_completed(future_to_id):
            cid = future_to_id[future]
            try:
                res_cid, body, dt_ms, error = future.result()
                latencies.append(dt_ms)
                if error:
                    print(f"  [{cid}] ERROR ({dt_ms:.1f}ms): {error}", file=sys.stderr)
                    results[cid] = {"error": error, "latency_ms": dt_ms}
                else:
                    usage = body.get("usage", {})
                    cost = usage.get("cost", 0.0)
                    tokens = usage.get("input_tokens", 0) + usage.get("output_tokens", 0)
                    total_cost += cost
                    total_tokens += tokens
                    answers = body.get("answers", {})

                    susp_raw = answers.get("suspicion_update", {})
                    att_raw = answers.get("attachment_update", {})
                    pride_raw = answers.get("gremlin_pride", {})

                    susp_choice = susp_raw.get("choice", "zero")
                    att_choice = att_raw.get("choice", "zero")
                    pride_choice = pride_raw.get("choice", "none")

                    susp_delta = CHOICE_TO_DELTA.get(susp_choice, 0)
                    att_delta = ATT_TO_DELTA.get(att_choice, 0)

                    case_obj = case_map[cid]
                    gold = case_obj["gold"]["accepted_policy"]

                    susp_match = (susp_delta == gold["suspicion_delta_steps"])
                    att_match = (att_delta == gold["attachment_delta_steps"])
                    pride_match = (pride_choice == gold["gremlin_pride_action"])
                    full_match = (susp_match and att_match and pride_match)

                    status_char = "✓" if full_match else "✗"
                    print(f"  [{cid}] {status_char} {dt_ms:5.1f}ms | susp:{susp_delta:+d} (gold:{gold['suspicion_delta_steps']:+d}) | att:{att_delta} (gold:{gold['attachment_delta_steps']}) | pride:{pride_choice:<13} (gold:{gold['gremlin_pride_action']:<13})")

                    results[cid] = {
                        "case_id": cid,
                        "family_id": case_obj["family_id"],
                        "target_text": case_obj["target"]["text"],
                        "latency_ms": round(dt_ms, 2),
                        "cost": cost,
                        "tokens": tokens,
                        "jev_answers": {
                            "suspicion_update": susp_choice,
                            "suspicion_conf": susp_raw.get("confidence", 0),
                            "attachment_update": att_choice,
                            "attachment_conf": att_raw.get("confidence", 0),
                            "gremlin_pride": pride_choice,
                            "gremlin_pride_conf": pride_raw.get("confidence", 0),
                        },
                        "predicted_policy": {
                            "suspicion_delta_steps": susp_delta,
                            "attachment_delta_steps": att_delta,
                            "gremlin_pride_action": pride_choice,
                        },
                        "gold_policy": gold,
                        "matches": {
                            "suspicion": susp_match,
                            "attachment": att_match,
                            "gremlin_pride": pride_match,
                            "full_vector": full_match,
                        },
                    }
            except Exception as exc:
                print(f"  [{cid}] EXCEPTION: {exc}", file=sys.stderr)
                results[cid] = {"error": str(exc)}

    total_wall_time = time.perf_counter() - t_start

    # Compute aggregate metrics
    ordered_results = [results[c["id"]] for c in cases if c["id"] in results and "error" not in results[c["id"]]]
    valid_count = len(ordered_results)

    susp_matches = sum(1 for r in ordered_results if r["matches"]["suspicion"])
    att_matches = sum(1 for r in ordered_results if r["matches"]["attachment"])
    pride_matches = sum(1 for r in ordered_results if r["matches"]["gremlin_pride"])
    full_matches = sum(1 for r in ordered_results if r["matches"]["full_vector"])

    # Suspicion spike metrics (TP, FP, TN, FN)
    tp = sum(1 for r in ordered_results if r["predicted_policy"]["suspicion_delta_steps"] == 1 and r["gold_policy"]["suspicion_delta_steps"] == 1)
    fp = sum(1 for r in ordered_results if r["predicted_policy"]["suspicion_delta_steps"] == 1 and r["gold_policy"]["suspicion_delta_steps"] != 1)
    tn = sum(1 for r in ordered_results if r["predicted_policy"]["suspicion_delta_steps"] != 1 and r["gold_policy"]["suspicion_delta_steps"] != 1)
    fn = sum(1 for r in ordered_results if r["predicted_policy"]["suspicion_delta_steps"] != 1 and r["gold_policy"]["suspicion_delta_steps"] == 1)
    gold_spikes = sum(1 for r in ordered_results if r["gold_policy"]["suspicion_delta_steps"] == 1)
    gold_non_spikes = valid_count - gold_spikes

    precision = round(tp / (tp + fp), 4) if (tp + fp) else 0.0
    recall = round(tp / gold_spikes, 4) if gold_spikes else 0.0
    false_spike_rate = round(fp / gold_non_spikes, 4) if gold_non_spikes else 0.0
    full_acc = round(full_matches / valid_count, 4) if valid_count else 0.0
    avg_latency = round(sum(latencies) / len(latencies), 1) if latencies else 0.0

    print("\n" + "=" * 80)
    print("   COMPLETE 43-CASE SCORECARD: TYPESAFE JEV 1.13 vs ALL BASELINES")
    print("=" * 80)
    print(f"{'Metric':<26} | {'Always Zero':<12} | {'Legacy Regex':<12} | {'Needle 2 45M':<12} | {'Str. Lexical':<12} | {'TypeSafe Jev 1.13':<18}")
    print("-" * 105)
    print(f"{'Suspicion Matches':<26} | {'39/43':<12} | {'12/43':<12} | {'31/43':<12} | {'43/43 (100%)':<12} | {f'{susp_matches}/{valid_count} ({susp_matches/valid_count*100:.1f}%)':<18}")
    print(f"{'Attachment Matches':<26} | {'42/43':<12} | {'42/43':<12} | {'39/43':<12} | {'43/43 (100%)':<12} | {f'{att_matches}/{valid_count} ({att_matches/valid_count*100:.1f}%)':<18}")
    print(f"{'Gremlin Pride Matches':<26} | {'41/43':<12} | {'41/43':<12} | {'40/43':<12} | {'43/43 (100%)':<12} | {f'{pride_matches}/{valid_count} ({pride_matches/valid_count*100:.1f}%)':<18}")
    print(f"{'Full Vector Matches':<26} | {'37/43':<12} | {'12/43':<12} | {'29/43':<12} | {'43/43 (100%)':<12} | {f'{full_matches}/{valid_count} ({full_acc*100:.1f}%)':<18}")
    print(f"{'True Spikes (TP / 4)':<26} | {'0/4':<12} | {'4/4':<12} | {'0/4':<12} | {'4/4':<12} | {f'{tp}/{gold_spikes}':<18}")
    print(f"{'False Spikes (FP / 39)':<26} | {'0/39':<12} | {'31/39':<12} | {'0/39':<12} | {'0/39':<12} | {f'{fp}/{gold_non_spikes}':<18}")
    print(f"{'Spike Recall':<26} | {'0.0%':<12} | {'100.0%':<12} | {'0.0%':<12} | {'100.0%':<12} | {f'{recall*100:.1f}%':<18}")
    print(f"{'False Spike Rate':<26} | {'0.0%':<12} | {'79.5%':<12} | {'0.0%':<12} | {'0.0%':<12} | {f'{false_spike_rate*100:.1f}%':<18}")
    print(f"{'Avg Latency':<26} | {'<0.01ms':<12} | {'<0.01ms':<12} | {'745ms/probe':<12} | {'0.026ms':<12} | {f'{avg_latency}ms':<18}")
    print(f"{'Total Benchmark Cost':<26} | {'$0.00':<12} | {'$0.00':<12} | {'$0.00':<12} | {'$0.00':<12} | {f'${total_cost:.5f}':<18}")
    print(f"{'Total Wall Clock Time':<26} | {'<1ms':<12} | {'<1ms':<12} | {'~35s':<12} | {'~1.2ms':<12} | {f'{total_wall_time:.2f}s':<18}")
    print("=" * 80)

    # Print any mismatches for diagnostic inspection
    mismatches = [r for r in ordered_results if not r["matches"]["full_vector"]]
    if mismatches:
        print(f"\nDiagnostic: {len(mismatches)} Mismatches identified:")
        for m in mismatches:
            cid = m["case_id"]
            txt = repr(m["target_text"][:50])
            pred = m["predicted_policy"]
            gold = m["gold_policy"]
            print(f"  [{cid}] {m['family_id']} | Text: {txt}")
            print(f"        Predicted: susp={pred['suspicion_delta_steps']:+d}, att={pred['attachment_delta_steps']}, pride={pred['gremlin_pride_action']}")
            print(f"        Gold:      susp={gold['suspicion_delta_steps']:+d}, att={gold['attachment_delta_steps']}, pride={gold['gremlin_pride_action']}")
    else:
        print("\nAll 43 cases matched gold policy perfectly (100% Accuracy)!")

    # Save full trace
    timestamp = int(time.time())
    out_file = OUTPUT_DIR / f"nan0-probe-benchmark-v2-jev-run-{timestamp}.json"
    trace_data = {
        "schema_version": "nan0.probe-benchmark.v2-jev",
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "model": MODEL_NAME,
        "total_cases": valid_count,
        "scorecard": {
            "suspicion_matches": susp_matches,
            "attachment_matches": att_matches,
            "gremlin_pride_matches": pride_matches,
            "full_vector_matches": full_matches,
            "full_vector_accuracy": full_acc,
            "true_spikes": tp,
            "false_spikes": fp,
            "true_negatives": tn,
            "false_negatives": fn,
            "spike_precision": precision,
            "spike_recall": recall,
            "false_spike_rate": false_spike_rate,
            "avg_latency_ms": avg_latency,
            "total_cost": total_cost,
            "total_tokens": total_tokens,
            "total_wall_time_s": total_wall_time,
        },
        "cases": ordered_results,
    }
    with open(out_file, "w", encoding="utf-8") as f:
        json.dump(trace_data, f, indent=2)
    print(f"\nFull trace recorded to: {out_file.relative_to(ROOT)}")

    return full_acc


if __name__ == "__main__":
    key = os.environ.get("OPENROUTER_API_KEY")
    if not key:
        print("Error: OPENROUTER_API_KEY environment variable required.", file=sys.stderr)
        sys.exit(1)
    run_benchmark(key)
