<!-- SPDX-License-Identifier: GPL-3.0-or-later -->
# P14 Wave P1 — user-session awareness daemon + Qt surface (user direction 2026-11-13: "word" for the P1 milestone)

Per the approved research posture (`p12-system-embedding-research.md`): P1 = user-session daemon +
T0 observers only. No root, no eBPF, no monitor mode, no autonomous actions.

## What landed

**P1a — `crates/airi-daemon`** (binary, workspace member): owns `org.moeru.airi.Daemon1` on the
session bus (single-instance by name ownership; `exit(1)` on contention), watches exactly five T0
sources — MPRIS playback (arg0-filtered PropertiesChanged), screen lock/unlock
(`org.freedesktop.ScreenSaver` first; gnome/kde variants matched opportunistically), logind
PrepareForSleep, NetworkManager State, UPower OnBattery — in one single-threaded bus loop with
250 ms debounce. GetStatus/SetSource/Pause control interface; ring buffer (cap 200); append-only
redacted JSONL audit at `<data_dir>/airi-qt/audit/awareness-audit.jsonl` (7-day prune on start);
**kill switch**: Pause disarms ALL observers incl. ring purge; **lockdown**: lock/sleep auto-disarm,
unlock/wake re-arms T0 — user's explicit pause always wins (re-arm never overrides it).
Hand-rolled redactor (no regex dep). systemd user unit + D-Bus activation file ship as opt-in
packaging (nothing auto-installed; `packaging/README.md` documents dev-run). Verified live on this
machine: `cargo test` 43/43, clippy clean, `--selftest` exits 0 with all match rules accepted,
live `serve->GetStatus` round trip with isolated XDG_DATA_HOME.

**P1b — Qt surface**: `DaemonController` bridge (blocking D-Bus client, 800 ms timeout everywhere;
never throws — daemon-down yields `running=false` + status line), tray item
"Awareness: Toggle" → `toggle-awareness` action, MainShell dispatch case. New
**Settings → Awareness** page (nav index 29, 👁️): Preview badge, honest daemon-down empty state +
Retry, master kill switch, five per-source toggles (with read-back state), audit viewer (newest
50, `event`→`verb` mapped — contract reconciled after daemon landed), Clear with AModal confirm,
1 s poll Timer. Honest absence list: no auto-install (daemon is dev-run), no clearing of the
daemon ring from the page (file truncation only), no per-source retention, no autonomy.

Central: workspace member line (after airi-discord), mod.rs `pub mod daemon;`, build.rs
(files + qml_file line), SettingsWindow nav 29 + StackLayout child (30 children, 0–29 verified),
32 i18n keys ×10 locales (parity 4/4, audit ×10).

## Verification

fmt clean · clippy `-D warnings` clean (workspace incl. daemon) · **706 tests green (50 suites)** ·
offscreen `--smoke` exit 0 (30 pages, settings in tour, daemon-down marker prints honestly) ·
live daemon GetStatus round trip OK (isolated XDG dir) · i18n parity 4/4 · audit ×10.

## Honesty anchors

- Daemon is **not** running by default; nothing auto-starts. Dev-run or systemctl --user unit
  required — see `packaging/README.md`. Tray "Awareness: Toggle" does nothing fatal when down.
- Audit retention is a hardcoded 7-day prune; the page cannot change it (yet).
- KDE/GNOME lock path best-effort; MPRIS media filter is arg0-only; UPower has no lid event;
  network byte counts are not observable via the chosen match rules.
- Bus loss = no reconnect (systemd Restart is the recovery story, by design).
- AI never acts on its own: L2 HITL remains the ceiling; this milestone adds eyes + off switch,
  no hands.
