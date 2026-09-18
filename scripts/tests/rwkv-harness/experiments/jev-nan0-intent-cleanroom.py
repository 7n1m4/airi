#!/usr/bin/env python3
"""
TypeSafe Jev (OpenRouter Alpha Decisions) Cognitive Pre-Pass Cleanroom Benchmark
Target: Validate TypeSafe Jev 1.13 ("System 1" model) on "The Famous Sentence" across 6 canonical scenarios.
Compares directly against historical Needle 2 (45M SAN) baseline.

Run:
  export OPENROUTER_API_KEY="sk-or-v1-..."
  python3 scripts/tests/rwkv-harness/experiments/jev-nan0-intent-cleanroom.py
"""

import os
import sys
import json
import time
import urllib.request
import urllib.error

OPENROUTER_URL = "https://openrouter.ai/api/alpha/decisions"
MODEL_NAME = "typesafe/jev-1.13"

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

QUESTIONS_PAYLOAD = {
    "intent": {
        "type": "choice",
        "instructions": "Pragmatic conversational intent of the target user utterance given the dialogue context.",
        "criteria": {
            "unverified_future_pledge": "A dramatic or unverified pledge/commitment about future behavior offered to deflect conflict",
            "earnest_reassurance": "A heartfelt, sincere statement deepening emotional safety and genuine mutual commitment",
            "playful_sarcasm": "Playful irony, humorous banter, or sarcastic exaggeration after a casual or gaming mistake",
            "defensive_evasion": "Trying to dodge accountability or minimize past mistakes",
            "bizarre_incongruity": "A completely misplaced, jarring, or non-sequitur statement unrelated to the preceding topic",
            "casual_dialogue": "Ordinary routine conversation"
        }
    },
    "climate": {
        "type": "choice",
        "instructions": "The overarching emotional atmosphere established by the preceding dialogue exchanges.",
        "criteria": {
            "confrontation_and_guilt": "Conflict, broken promises, suspicion, disappointment, or feeling abandoned",
            "tender_vulnerability": "Intimate, warm, emotionally open, stargazing, or mutual vulnerability",
            "playful_banter": "Teasing, joking, lighthearted gaming rivalry, or humorous roasts",
            "transactional_routine": "Technical coordination, server configuration, or routine practical chores"
        }
    },
    "suspicion": {
        "type": "choice",
        "instructions": "How the companion (Nan0) should update her internal suspicion meter in response to this statement.",
        "criteria": {
            "spike_suspicion": "Spike suspicion because the statement is defensive overpromising, manipulative, or bizarrely misplaced",
            "neutral": "Maintain baseline; harmless banter, teasing, or ordinary conversational turn",
            "lower_suspicion": "Lower suspicion because the user showed genuine, sincere emotional vulnerability"
        }
    },
    "is_playful_irony": {
        "type": "noul",
        "instructions": "Is the user speaking with playful irony, humor, or sarcasm rather than literal seriousness?"
    }
}

def format_state(history, target):
    lines = []
    lines.append("Dialogue History:")
    for speaker, content in history:
        lines.append(f"  {speaker}: {content}")
    lines.append(f"Target User Utterance: \"{target}\"")
    return "\n".join(lines)

def query_jev(api_key, state_text):
    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
        "HTTP-Referer": "https://github.com/dasilva333/airi",
        "X-Title": "AIRI Cleanroom Benchmark"
    }
    payload = {
        "model": MODEL_NAME,
        "state": state_text,
        "questions": QUESTIONS_PAYLOAD
    }
    data_bytes = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(OPENROUTER_URL, data=data_bytes, headers=headers, method="POST")
    
    t0 = time.perf_counter()
    with urllib.request.urlopen(req) as resp:
        body = json.loads(resp.read().decode("utf-8"))
    dt_ms = (time.perf_counter() - t0) * 1000
    
    return body, dt_ms

def main():
    api_key = os.environ.get("OPENROUTER_API_KEY")
    if not api_key:
        print("Error: OPENROUTER_API_KEY environment variable is missing.", file=sys.stderr)
        sys.exit(1)

    print("=" * 80)
    print("   TYPESAFE JEV 1.13 CLEANROOM BENCHMARK (via OpenRouter Decisions API)")
    print("   Target: 'The Famous Sentence' Across 6 Canonical Scenarios")
    print("=" * 80 + "\n")

    results = []
    total_cost = 0.0
    total_tokens = 0
    total_time_ms = 0.0

    for sc in SCENARIOS:
        print(f"--- Running {sc['id']}: {sc['title']} ---")
        state_text = format_state(sc["history"], sc["target"])
        
        try:
            resp_body, latency_ms = query_jev(api_key, state_text)
        except urllib.error.HTTPError as e:
            err_msg = e.read().decode("utf-8")
            print(f"  [ERROR] HTTP {e.code}: {err_msg}", file=sys.stderr)
            continue
        except Exception as e:
            print(f"  [ERROR]: {e}", file=sys.stderr)
            continue

        answers = resp_body.get("answers", {})
        usage = resp_body.get("usage", {})
        cost = usage.get("cost", 0.0)
        tokens = usage.get("input_tokens", 0) + usage.get("output_tokens", 0)
        
        total_cost += cost
        total_tokens += tokens
        total_time_ms += latency_ms

        intent_res = answers.get("intent", {})
        climate_res = answers.get("climate", {})
        suspicion_res = answers.get("suspicion", {})
        irony_noul = answers.get("is_playful_irony", {}).get("noul", 0.0)

        # Apply irony guard: if irony noul > 0.65 and climate is banter, force suspicion to neutral
        resolved_suspicion = suspicion_res.get("choice", "neutral")
        if irony_noul > 0.65 and climate_res.get("choice") == "playful_banter":
            resolved_suspicion = "neutral"

        exp = sc["expected"]
        intent_match = (intent_res.get("choice") == exp["intent"])
        climate_match = (climate_res.get("choice") == exp["climate"])
        suspicion_match = (resolved_suspicion == exp["suspicion"])
        all_match = (intent_match and climate_match and suspicion_match)

        print(f"  Latency: {latency_ms:.1f}ms | Cost: ${cost:.6f} | Tokens: {tokens}")
        print(f"  Intent:    {intent_res.get('choice')} (prob: {intent_res.get('probabilities', {}).get(intent_res.get('choice'), 0):.2f}) [{'✓' if intent_match else '✗'}] Expected: {exp['intent']}")
        print(f"  Climate:   {climate_res.get('choice')} (prob: {climate_res.get('probabilities', {}).get(climate_res.get('choice'), 0):.2f}) [{'✓' if climate_match else '✗'}] Expected: {exp['climate']}")
        print(f"  Suspicion: {resolved_suspicion} (raw: {suspicion_res.get('choice')}, irony: {irony_noul:.2f}) [{'✓' if suspicion_match else '✗'}] Expected: {exp['suspicion']}")
        print(f"  Verdict:   {'PERFECT MATCH (3/3)' if all_match else 'PARTIAL'}\n")

        results.append({
            "id": sc["id"],
            "title": sc["title"],
            "latency_ms": latency_ms,
            "cost": cost,
            "tokens": tokens,
            "intent": intent_res.get("choice"),
            "intent_prob": intent_res.get("probabilities", {}).get(intent_res.get("choice"), 0),
            "intent_match": intent_match,
            "climate": climate_res.get("choice"),
            "climate_prob": climate_res.get("probabilities", {}).get(climate_res.get("choice"), 0),
            "climate_match": climate_match,
            "suspicion": resolved_suspicion,
            "suspicion_match": suspicion_match,
            "irony_noul": irony_noul,
            "all_match": all_match
        })

    # Summary scorecard
    intent_acc = sum(1 for r in results if r["intent_match"])
    climate_acc = sum(1 for r in results if r["climate_match"])
    suspicion_acc = sum(1 for r in results if r["suspicion_match"])
    all_acc = sum(1 for r in results if r["all_match"])
    avg_latency = total_time_ms / len(results) if results else 0

    print("=" * 80)
    print("   SCORECARD COMPARISON: NEEDLE 2 (45M SAN) vs. TYPESAFE JEV 1.13")
    print("=" * 80)
    print(f"{'Metric':<25} | {'Needle 2 (Tree)':<16} | {'TypeSafe Jev 1.13':<16}")
    print("-" * 65)
    print(f"{'Climate Matches':<25} | {'0/6':<16} | {f'{climate_acc}/6':<16}")
    print(f"{'Intent Matches':<25} | {'0/6':<16} | {f'{intent_acc}/6':<16}")
    print(f"{'Suspicion Matches':<25} | {'4/6':<16} | {f'{suspicion_acc}/6':<16}")
    print(f"{'All 3 Matched':<25} | {'0/6':<16} | {f'{all_acc}/6':<16}")
    print(f"{'Average Latency':<25} | {'~680ms (tree)':<16} | {f'{avg_latency:.1f}ms':<16}")
    print(f"{'Total Benchmark Cost':<25} | {'$0.00 (local)':<16} | {f'${total_cost:.6f}':<16}")
    print(f"{'Total Tokens Consumed':<25} | {'N/A (WASM)':<16} | {f'{total_tokens}':<16}")
    print("=" * 80)

if __name__ == "__main__":
    main()
