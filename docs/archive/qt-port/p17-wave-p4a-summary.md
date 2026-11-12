<!-- SPDX-License-Identifier: GPL-3.0-or-later -->
# P17 Wave P4a — system-bus reads + wake briefing (user direction 2026-11-13: "ok continue")

P4a from the research doc (`p12-system-embedding-research.md`): expose the
system bus wider and add the deterministic wake briefing. Two lanes, disjoint
files; this note records integration + gate.

## What landed

**P4a1 — daemon (`crates/airi-daemon`, lane note `p17-lane-systemd-watch.md`)**:
seventh source `units` — systemd1 `JobRemoved` watch on the **system bus**
(failure jobs only: ring + audit + counters; `done` jobs counted, never
audited); wake/suspend facts (`last_suspend_ms`, `last_wake_ms`,
`units_failed_since_wake`, `recent_failed_units` — in-memory only, reset at
wake, raw counter with deduped newest-first ≤3 list); additive GetStatus keys,
protocol stays 1. Read-only subscriber — no actuation API. Selftest probes
`org.freedesktop.systemd1` + the `JobRemoved` match rule (accepted by this
machine's bus).

**P4a2 — Qt surface (`crates/airi-qt/src/bridges/daemon.rs`, `qml/**`)**:
"enable + Settings → Awareness" wake-briefing card (opt-in, default **off**,
persisted by the bridge as `settings/awareness` → `wakeBriefing` camelCase
JSON blob); MainShell 5 s Timer edge-detects `last_wake_ms` and calls
`checkWakeBriefingTick()` → one-line deterministic fact sheet via
notify-rust on the session bus, at most once per wake edge, silent prime on
first observation; renders zeros as unknowns; paused/lockdown quiet; daemon
down = quiet, never an error. Settings → Awareness page gains the opt-in
switch with honest captions. i18n: 3 `shell.awareness.wake.*` keys ×10
locales (parity 4/4, audit ×10).

## Gate

fmt clean · clippy `-D warnings` clean (workspace) · **791 tests green (52
suites)** · offscreen `--smoke` exit 0 (pages: splash, control-strip, chat,
settings, about, stage; chat done, 30 stage ticks; daemon-down marker
honest) · i18n parity 4/4 · audit ×10.

## Honest limits

- **No live `JobRemoved` was exercised** (would require stopping a real unit —
  out of scope, not approved). Parser verified against synthesized messages;
  match rule verified accepted by the live bus; end-to-end path not yet
  observed.
- Wake facts are in-memory only — daemon restart resets them; the UI renders
  zeros as "no data".
- Briefing is deterministic facts only — no LLM, no tokens, no network, no
  action.
- `units_failed_since_wake` counts job fires, not incidents (documented).
- Disk pressure note: the lane gate initially failed with `StorageFull` on
  `/tmp` (50G of stale lane build copies under `/tmp/opencode`); removed
  (throwaway copies only, verified against the working tree) and re-ran the
  gate green.

## Files

- `crates/airi-daemon/**` (P4a1: `observe/systemd1.rs` new, `wake_facts.rs`
  new, `observe/mod.rs`, `state.rs`, `control.rs`, `main.rs`)
- `crates/airi-qt/src/bridges/daemon.rs` (P4a2: wake snapshot/edge/compose,
  settings blob, 4 qinvokables/properties, 12 unit tests)
- `qml/pages/settings/modules/awareness/AwarenessSettingsPage.qml` (wake card)
- `qml/shell/MainShell.qml` (5 s wake pump)
- `packages/i18n/src/locales/*/shell.yaml` (3 keys ×10)
- `docs/phase-notes/p17-lane-systemd-watch.md` (P4a1 lane note)
