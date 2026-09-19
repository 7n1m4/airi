#!/usr/bin/env python3
"""
Release Download Metrics & Chart Generator
Queries GitHub releases for a customizable timeframe (default: 90 days) and renders a 4-line platform download chart:
  1. Windows (.exe + win .zip)
  2. Android (.apk)
  3. macOS (.dmg + mac .zip)
  4. iOS (.ipa)
"""

import argparse
import json
import os
import shutil
import subprocess
import sys
from datetime import datetime, timedelta, timezone

import matplotlib.pyplot as plt

def fetch_releases(repo="dasilva333/airi"):
    cmd = [
        "gh", "api", f"repos/{repo}/releases", "--paginate"
    ]
    env = os.environ.copy()
    env["GITHUB_TOKEN"] = ""
    env["GH_SSL_NO_VERIFY"] = "true"
    
    result = subprocess.run(cmd, capture_output=True, text=True, env=env)
    if result.returncode != 0:
        print(f"Error fetching releases: {result.stderr}", file=sys.stderr)
        sys.exit(1)
    
    return json.loads(result.stdout)

def classify_asset(name):
    name_lower = name.lower()
    
    if name_lower.endswith(".blockmap") or name_lower.endswith(".yml") or name_lower.endswith(".json"):
        return None
    
    if name_lower.endswith(".ipa"):
        return "ios"
    if name_lower.endswith(".apk") or name_lower.endswith(".aab"):
        return "android"
    if name_lower.endswith(".dmg") or ("mac" in name_lower and name_lower.endswith(".zip")):
        return "macos"
    if name_lower.endswith(".exe") or ("win" in name_lower and name_lower.endswith(".zip")):
        return "windows"
    
    return None

def process_releases(releases, days=90):
    now = datetime.now(timezone.utc)
    cutoff = now - timedelta(days=days)
    
    data_points = []
    
    for rel in releases:
        tag = rel.get("tag_name", "")
        if not tag.startswith("v0."):
            continue
            
        pub_str = rel.get("published_at")
        if not pub_str:
            continue
        
        pub_date = datetime.fromisoformat(pub_str.replace("Z", "+00:00"))
        if pub_date < cutoff:
            continue
        
        counts = {
            "ios": 0,
            "macos": 0,
            "android": 0,
            "windows": 0,
        }
        
        for asset in rel.get("assets", []):
            cat = classify_asset(asset.get("name", ""))
            if cat in counts:
                counts[cat] += asset.get("download_count", 0)
        
        data_points.append({
            "tag": tag,
            "date": pub_date,
            "date_label": pub_date.strftime("%b %d"),
            "ios": counts["ios"],
            "macos": counts["macos"],
            "android": counts["android"],
            "windows": counts["windows"],
            "total": sum(counts.values())
        })
    
    # Sort chronologically
    data_points.sort(key=lambda x: x["date"])
    return data_points

def render_chart(data_points, output_path, days=90):
    if not data_points:
        print("No release data found in the specified timeframe.")
        return
    
    # Set dark aesthetic matching AIRI stage theme
    plt.style.use("dark_background")
    fig_width = max(13, len(data_points) * 0.8)
    fig, ax = plt.subplots(figsize=(fig_width, 7.0), dpi=300)
    
    fig.patch.set_facecolor("#121316")
    ax.set_facecolor("#18191E")
    
    labels = [f"{d['date_label']}\n({d['tag']})" for d in data_points]
    x = range(len(data_points))
    
    ios_counts = [d["ios"] for d in data_points]
    mac_counts = [d["macos"] for d in data_points]
    android_counts = [d["android"] for d in data_points]
    win_counts = [d["windows"] for d in data_points]
    
    # Custom vibrant line styling
    line_win, = ax.plot(x, win_counts, label="Windows (.exe + .zip)", color="#00B4D8", linewidth=3, marker="o", markersize=7, zorder=4)
    line_apk, = ax.plot(x, android_counts, label="Android (.apk)", color="#52B788", linewidth=3, marker="s", markersize=7, zorder=4)
    line_mac, = ax.plot(x, mac_counts, label="macOS (.dmg + .zip)", color="#F77F00", linewidth=3, marker="^", markersize=7, zorder=4)
    line_ios, = ax.plot(x, ios_counts, label="iOS (.ipa)", color="#E63946", linewidth=3, marker="D", markersize=7, zorder=4)
    
    # Data value callouts above markers
    for i in x:
        if win_counts[i] > 0:
            ax.annotate(f"{win_counts[i]}", (i, win_counts[i]), textcoords="offset points", xytext=(0, 7), ha="center", fontsize=8, fontweight="bold", color="#00B4D8")
        if android_counts[i] > 0:
            ax.annotate(f"{android_counts[i]}", (i, android_counts[i]), textcoords="offset points", xytext=(0, 7), ha="center", fontsize=8, fontweight="bold", color="#52B788")
        if mac_counts[i] > 0:
            ax.annotate(f"{mac_counts[i]}", (i, mac_counts[i]), textcoords="offset points", xytext=(0, 7), ha="center", fontsize=8, fontweight="bold", color="#F77F00")
        if ios_counts[i] > 0:
            ax.annotate(f"{ios_counts[i]}", (i, ios_counts[i]), textcoords="offset points", xytext=(0, 7), ha="center", fontsize=8, fontweight="bold", color="#E63946")

    ax.set_title(f"AIRI Release Downloads by Platform (Last {days} Days)", fontsize=16, fontweight="bold", pad=20, color="#F8F9FA")
    ax.set_ylabel("Download Count", fontsize=11, fontweight="bold", labelpad=12, color="#CED4DA")
    ax.set_xlabel("Release Timeline", fontsize=11, fontweight="bold", labelpad=12, color="#CED4DA")
    
    ax.set_xticks(list(x))
    ax.set_xticklabels(labels, fontsize=8, rotation=25, ha="right", color="#ADB5BD")
    ax.tick_params(colors="#ADB5BD")
    
    # Grid lines
    ax.grid(True, linestyle="--", alpha=0.18, color="#6C757D", zorder=1)
    ax.set_axisbelow(True)
    
    # Adjust y-limit with breathing room
    max_val = max(max(win_counts), max(android_counts), max(mac_counts), max(ios_counts), 5)
    ax.set_ylim(-1, max_val + 7)
    
    # Clean spines
    for spine in ax.spines.values():
        spine.set_color("#2B2D42")
        spine.set_linewidth(1.2)
    
    # Legend
    legend = ax.legend(loc="upper left", frameon=True, facecolor="#1F2026", edgecolor="#3A3D4D", fontsize=9.5)
    for text in legend.get_texts():
        text.set_color("#E9ECEF")
    
    plt.tight_layout()
    plt.savefig(output_path, dpi=300)
    plt.close()
    print(f"✅ Saved download chart to: {output_path}")

def main():
    parser = argparse.ArgumentParser(description="Generate AIRI release download chart.")
    parser.add_argument("--days", type=int, default=90, help="Number of past days to query (default: 90)")
    args = parser.parse_args()
    
    print(f"🔄 Fetching GitHub release statistics for dasilva333/airi (last {args.days} days)...")
    releases = fetch_releases()
    data_points = process_releases(releases, days=args.days)
    
    print(f"📊 Found {len(data_points)} release(s) in the last {args.days} days:")
    for d in data_points:
        print(f"  • {d['tag']} ({d['date_label']}): Win={d['windows']}, Android={d['android']}, Mac={d['macos']}, iOS={d['ios']} | Total={d['total']}")
    
    output_png = f"release_downloads_{args.days}d.png"
    render_chart(data_points, output_png, days=args.days)
    
    # Copy to Antigravity conversation artifact directory if present
    artifact_dir = os.environ.get("ANTIGRAVITY_ARTIFACT_DIR") or "/Users/richardpinedo/.gemini/antigravity/brain/0beb0618-7b15-4ed1-90fd-01b8a59aa9f4"
    if os.path.exists(artifact_dir):
        dest = os.path.join(artifact_dir, output_png)
        shutil.copyfile(output_png, dest)
        print(f"📁 Copied chart to artifact directory: {dest}")

if __name__ == "__main__":
    main()
