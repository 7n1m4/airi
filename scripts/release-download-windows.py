#!/usr/bin/env python3
"""
AIRI Windows .EXE Release Download Metrics & Chart Generator
Generates a focused 90-day line chart specifically for Windows .exe setup installer downloads.
"""

import json
import os
import shutil
import subprocess
import sys
from datetime import datetime, timedelta, timezone

import matplotlib.pyplot as plt

def fetch_releases(repo="dasilva333/airi"):
    cmd = ["gh", "api", f"repos/{repo}/releases", "--paginate"]
    env = os.environ.copy()
    env["GITHUB_TOKEN"] = ""
    env["GH_SSL_NO_VERIFY"] = "true"
    
    result = subprocess.run(cmd, capture_output=True, text=True, env=env)
    if result.returncode != 0:
        print(f"Error fetching releases: {result.stderr}", file=sys.stderr)
        sys.exit(1)
    
    return json.loads(result.stdout)

def process_windows_exe(releases, days=90):
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
        
        exe_count = 0
        exe_asset_name = ""
        
        for asset in rel.get("assets", []):
            name = asset.get("name", "")
            name_lower = name.lower()
            if name_lower.endswith(".exe") and ("setup" in name_lower or "airi" in name_lower):
                exe_count += asset.get("download_count", 0)
                exe_asset_name = name
        
        data_points.append({
            "tag": tag,
            "date": pub_date,
            "date_label": pub_date.strftime("%b %d"),
            "exe_count": exe_count,
            "asset_name": exe_asset_name
        })
    
    # Sort chronologically
    data_points.sort(key=lambda x: x["date"])
    return data_points

def render_windows_chart(data_points, output_path, days=90):
    if not data_points:
        print("No release data found.")
        return
    
    plt.style.use("dark_background")
    fig_width = max(13, len(data_points) * 0.75)
    fig, ax = plt.subplots(figsize=(fig_width, 6.5), dpi=300)
    
    fig.patch.set_facecolor("#121316")
    ax.set_facecolor("#18191E")
    
    labels = [f"{d['date_label']}\n({d['tag']})" for d in data_points]
    x = list(range(len(data_points)))
    y = [d["exe_count"] for d in data_points]
    
    total_exe = sum(y)
    peak_val = max(y) if y else 0
    avg_val = total_exe / len(y) if y else 0
    
    # Gradient area fill under curve
    ax.fill_between(x, y, color="#00B4D8", alpha=0.15, zorder=2)
    
    # Main vibrant line
    line, = ax.plot(x, y, label="Windows Installer (.exe)", color="#00B4D8", linewidth=3.5, marker="o", markersize=8, markerfacecolor="#90E0EF", markeredgecolor="#0077B6", markeredgewidth=1.5, zorder=4)
    
    # Average line reference
    ax.axhline(avg_val, color="#48CAE4", linestyle=":", linewidth=1.5, alpha=0.5, label=f"90-Day Avg ({avg_val:.1f} / release)", zorder=3)
    
    # Value callouts
    for i, val in enumerate(y):
        fontweight = "bold" if val == peak_val else "normal"
        fontsize = 9 if val == peak_val else 8
        color = "#00F5D4" if val == peak_val else "#CAF0F8"
        
        prefix = "★ " if val == peak_val else ""
        ax.annotate(
            f"{prefix}{val}",
            (i, val),
            textcoords="offset points",
            xytext=(0, 8),
            ha="center",
            fontsize=fontsize,
            fontweight=fontweight,
            color=color,
            zorder=5
        )
    
    ax.set_title(f"AIRI Windows Installer (.exe) Downloads — Last {days} Days (Total: {total_exe:,})", fontsize=15, fontweight="bold", pad=20, color="#F8F9FA")
    ax.set_ylabel("Downloads per Release", fontsize=11, fontweight="bold", labelpad=12, color="#CED4DA")
    ax.set_xlabel("Release Timeline", fontsize=11, fontweight="bold", labelpad=12, color="#CED4DA")
    
    ax.set_xticks(x)
    ax.set_xticklabels(labels, fontsize=8, rotation=25, ha="right", color="#ADB5BD")
    ax.tick_params(colors="#ADB5BD")
    
    # Grid lines
    ax.grid(True, linestyle="--", alpha=0.18, color="#6C757D", zorder=1)
    ax.set_axisbelow(True)
    
    # Y-limit
    ax.set_ylim(-1, peak_val + 8)
    
    # Spines
    for spine in ax.spines.values():
        spine.set_color("#2B2D42")
        spine.set_linewidth(1.2)
    
    # Legend
    legend = ax.legend(loc="upper left", frameon=True, facecolor="#1F2026", edgecolor="#3A3D4D", fontsize=10)
    for text in legend.get_texts():
        text.set_color("#E9ECEF")
    
    plt.tight_layout()
    plt.savefig(output_path, dpi=300)
    plt.close()
    print(f"✅ Saved Windows .exe chart to: {output_path}")

def main():
    print("🔄 Querying GitHub releases for Windows .exe metrics (last 90 days)...")
    releases = fetch_releases()
    data_points = process_windows_exe(releases, days=90)
    
    print(f"📊 Found {len(data_points)} release(s):")
    for d in data_points:
        print(f"  • {d['tag']} ({d['date_label']}): {d['exe_count']} downloads ({d['asset_name']})")
    
    output_png = "release_downloads_windows_exe_90d.png"
    render_windows_chart(data_points, output_png, days=90)
    
    artifact_dir = os.environ.get("ANTIGRAVITY_ARTIFACT_DIR") or "/Users/richardpinedo/.gemini/antigravity/brain/0beb0618-7b15-4ed1-90fd-01b8a59aa9f4"
    if os.path.exists(artifact_dir):
        dest = os.path.join(artifact_dir, output_png)
        shutil.copyfile(output_png, dest)
        print(f"📁 Copied chart to artifact directory: {dest}")

if __name__ == "__main__":
    main()
