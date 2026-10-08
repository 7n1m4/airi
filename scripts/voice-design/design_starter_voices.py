#!/usr/bin/env python3
"""
design_starter_voices.py
Uses MOSS-VoiceGenerator (/v1/audio/voice-design on airi-audio-server)
to synthesize high-quality voice personas for AIRI's starter companions in voice_design_roster.json.

Once synthesized, saves the WAV reference samples locally into previews/
and updates voice_design_roster.json with status 'ready'.

Usage:
  # Check status of roster
  python3 scripts/voice-design/design_starter_voices.py --status

  # Dry run (inspect payload without calling server)
  python3 scripts/voice-design/design_starter_voices.py --actor relu --dry-run
  python3 scripts/voice-design/design_starter_voices.py --all --dry-run

  # Synthesize specific actor
  python3 scripts/voice-design/design_starter_voices.py --actor relu

  # Synthesize all pending actors
  python3 scripts/voice-design/design_starter_voices.py --all
"""

import os
import sys
import json
import argparse
import urllib.request
import urllib.error
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent
ROSTER_PATH = BASE_DIR / "voice_design_roster.json"
DEFAULT_PREVIEWS_DIR = BASE_DIR / "previews"

DEFAULT_SERVER_URL = os.environ.get("AIRI_AUDIO_SERVER_URL", "http://10.0.0.91:8095")


def load_json(path: Path) -> dict:
    if not path.exists():
        return {}
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)


def save_json(path: Path, data: dict):
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2, ensure_ascii=False)
        f.write("\n")


def print_status(roster_data: dict):
    roster = roster_data.get("roster", {})
    print(f"\n{'='*92}")
    print(f"  AIRI STARTER VOICE DESIGN ROSTER ({len(roster)} characters)")
    print(f"{'='*92}")
    print(f"{'Actor':<12} | {'Name':<16} | {'Gender':<8} | {'Status':<10} | {'Voice ID':<16} | {'Lang':<8} | {'Age'}")
    print(f"{'-'*12}-+-{'-'*16}-+-{'-'*8}-+-{'-'*10}-+-{'-'*16}-+-{'-'*8}-+--------")
    pending_count = 0
    ready_count = 0
    for actor, info in roster.items():
        status = info.get("status", "pending")
        vid = info.get("assigned_voice_id") or "—"
        name = info.get("name", actor)
        gender = info.get("gender", "—")
        age = info.get("apparent_age", "—")
        lang = info.get("language", "English")
        if status == "ready":
            status_str = "✅ Ready"
            ready_count += 1
        else:
            status_str = "⏳ Pending"
            pending_count += 1
        print(f"{actor:<12} | {name:<16} | {gender:<8} | {status_str:<10} | {vid:<16} | {lang:<8} | {age}")
    print(f"{'-'*82}")
    print(f"Summary: {ready_count} ready, {pending_count} pending voice design.\n")


def design_voice(actor: str, info: dict, server_url: str, output_dir: Path, dry_run: bool = False):
    name = info.get("name", actor)
    prompt = info.get("voice_prompt", "").strip()
    text = info.get("sample_line", "").strip()
    lang = info.get("language", "English").strip()
    target_voice_id = info.get("assigned_voice_id", f"airi_{actor}")

    if not prompt:
        print(f"❌ Error: Character '{actor}' does not have a 'voice_prompt' defined.")
        return False
    if not text:
        text = f"Hello, this is {name} speaking. I am ready to serve my role."

    payload = {
        "instruct": prompt,
        "text": text,
        "language": lang,
        "save_as_voice": target_voice_id,
        "audio_temperature": 1.5,
        "audio_top_p": 0.6,
        "audio_top_k": 50,
        "audio_repetition_penalty": 1.1
    }

    print(f"\n🎤 Designing Voice Persona for '{actor}' ({name})")
    print(f"   Target Voice ID : {target_voice_id}")
    print(f"   Language        : {lang}")
    print(f"   Prompt (Instruct): \"{prompt}\"")
    print(f"   Sample Line     : \"{text}\"")

    if dry_run:
        print("   [DRY-RUN] Payload prepared successfully. No network call made.")
        return target_voice_id

    url = f"{server_url.rstrip('/')}/v1/audio/voice-design"
    print(f"   Sending request to {url}...")
    try:
        data_bytes = json.dumps(payload).encode("utf-8")
        req = urllib.request.Request(
            url,
            data=data_bytes,
            headers={"Content-Type": "application/json"}
        )
        with urllib.request.urlopen(req, timeout=180) as resp:
            audio_bytes = resp.read()
            latency = resp.headers.get("X-Synthesis-Latency-Ms", "N/A")

        output_dir.mkdir(parents=True, exist_ok=True)
        preview_file = output_dir / f"{target_voice_id}.wav"
        with open(preview_file, "wb") as f:
            f.write(audio_bytes)

        print(f"   ✅ Successfully generated and saved voice '{target_voice_id}' ({len(audio_bytes)} bytes, latency: {latency} ms)")
        print(f"   📁 Local WAV saved to: {preview_file}")
        return target_voice_id

    except urllib.error.HTTPError as e:
        err_body = e.read().decode("utf-8", errors="replace")
        print(f"❌ Server returned HTTP {e.code}: {err_body}")
        return False
    except Exception as e:
        print(f"❌ Request failed: {e}")
        return False


def main():
    parser = argparse.ArgumentParser(description="AIRI Starter Voice Persona Designer")
    parser.add_argument("--actor", help="Specific character key to design voice for (e.g. relu, aria, lupin)")
    parser.add_argument("--all", action="store_true", help="Design voices for all pending characters in roster")
    parser.add_argument("--status", action="store_true", help="Print status of voice design roster")
    parser.add_argument("--dry-run", action="store_true", help="Show payload without making network calls")
    parser.add_argument("--server", default=DEFAULT_SERVER_URL, help=f"Base URL for airi-audio-server (default: {DEFAULT_SERVER_URL})")
    parser.add_argument("--output-dir", default=str(DEFAULT_PREVIEWS_DIR), help=f"Directory to save preview WAVs (default: {DEFAULT_PREVIEWS_DIR})")
    args = parser.parse_args()

    roster_data = load_json(ROSTER_PATH)
    roster = roster_data.get("roster", {})

    if not roster:
        print(f"❌ No roster found at {ROSTER_PATH}")
        sys.exit(1)

    output_dir = Path(args.output_dir)

    if args.status or (not args.actor and not args.all):
        print_status(roster_data)
        if not args.actor and not args.all:
            print("Tip: Run with --dry-run or --actor <name> or --all to synthesize personas.")
            return

    if args.actor:
        actor = args.actor.lower()
        if actor not in roster:
            print(f"❌ Character '{actor}' not found in {ROSTER_PATH}. Available: {', '.join(roster.keys())}")
            sys.exit(1)
        info = roster[actor]
        result = design_voice(actor, info, args.server, output_dir, dry_run=args.dry_run)
        if result and not args.dry_run:
            info["status"] = "ready"
            save_json(ROSTER_PATH, roster_data)
            print(f"🎉 Persona '{actor}' completed and registered successfully in roster!")

    elif args.all:
        pending = [a for a, inf in roster.items() if inf.get("status") != "ready"]
        if not pending:
            print("✅ All characters in roster are already synthesized and marked 'ready'!")
            return

        print(f"🚀 Processing {len(pending)} pending characters: {', '.join(pending)}")
        for idx, actor in enumerate(pending, 1):
            print(f"\n--- [{idx}/{len(pending)}] Processing '{actor}' ---")
            info = roster[actor]
            result = design_voice(actor, info, args.server, output_dir, dry_run=args.dry_run)
            if result and not args.dry_run:
                info["status"] = "ready"
                save_json(ROSTER_PATH, roster_data)
                print(f"🎉 Persona '{actor}' completed!")
            elif not result and not args.dry_run:
                print(f"⚠️ Pausing batch: synthesis failed for '{actor}'.")
                break


if __name__ == "__main__":
    main()
