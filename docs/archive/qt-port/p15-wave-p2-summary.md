<!-- SPDX-License-Identifier: GPL-3.0-or-later -->
# P15 Wave P2 — AT-SPI screen awareness, opt-in, local-only (user direction 2026-11-13: "ok")

P2 from `p12-system-embedding-research.md`: the "eyes" rung. Strictly opt-in;
content never persisted; the screen-reader channel.

## What landed

**P2a — `crates/airi-a11y`** (33 tests): AT-SPI bus discovery (`org.a11y.Bus`
→ `GetAddress()`, `org.a11y.Status.IsEnabled` read as a Properties.Get), focus
event watchers (`Object.StateChanged` body-filtered `arg0=="focused"`,
`Window.Activate`; message-path wins over `arg1` — unit-tested), a pure
walker with hard caps (200 nodes / depth 8 / 500 chars per node,
char-boundary-safe / 4000 chars per digest), password rails (`password text`
role, credential-ish name heuristic, `protected` state, subtree skip —
siblings unaffected), and the redactor (copy, self-contained crate). Client
over `dbus::blocking::Connection::new_address` — `new_custom` does not exist in
dbus 0.9.12 (the API that won is the one that exists).

**P2a — daemon integration** (`crates/airi-daemon`, now 51 tests): 6th source
`screen` with full pause/lockdown semantics; built-in credential-manager
denylist (keepass/1password/bitwarden/secret-service, always on, never
persisted) + user exclusions (case-insensitive substring, ≤256×128 chars,
atomic JSON persist, rollback); 0-wait a11y poll in the same single-threaded
loop; focus events hit the ring/audit as metadata only (`screen: focused
<app> — <title>`), and only when armed. `GetFocusDigest()` — on-demand digest
(app, title, lines, counts, skipped-password-nodes), excluded apps get no
digest at all. `SetExcludedApps()` — validated, persisted, audited by counts.
`--selftest` reports the negotiation, exits 0.

**P2b — Qt surface** (`Awareness` page, index 29): "Screen awareness (AT-SPI)"
card — opt-in master switch, exclusion editor (starts empty by design; saving
replaces the daemon's whole user list; built-ins never shown), "Preview focus
digest" → on-demand AModal (≤12 elided lines + truncation marker + local-only
footer), AT-SPI-unavailable state surfaced only from real daemon signals.
Bridge additions + 4 new bridge unit tests; i18n `shell.awareness.screen.*`
21 keys ×10 locales (parity 4/4, audit ×10).

## Live evidence (this machine: Arch + Hyprland, Wayland)

a11y bus present at `/run/user/1000/at-spi/bus_0`, connectable, both focus
match rules install; **`IsEnabled=false`** — but GTK4 apps (nautilus…) still
expose trees (probe saw `/org/a11y/atspi/accessible/root` answer and a live
digest of nautilus → `app: org.gnome.Nautilus, title: Evangelion`; probe
deleted after). `tuned-gui` times out cleanly. **No live focus signal was
observed** — the event path is code-complete + unit-tested, not
keyboard-verified. Non-GTK4 toolkits: unknown — the honest default answer is
per-app unavailability.

## Verification

fmt clean · clippy `-D warnings` clean (workspace incl. airi-daemon +
airi-a11y) · **751 tests green (52 suites)** · offscreen `--smoke` exit 0
(30 pages, settings in tour) · `--selftest` exit 0 with full a11y negotiation
report · i18n parity 4/4 · audit ×10.

## Honest limits / not done

- Content is NEVER persisted; audit logs only `screen: focused <app> —
  <title>`, redacted. Preview is on-demand only; no background watching UI,
  no chat injection, no per-app roles, no GetExcludedApps (absent daemon-side
  — the exclusions editor is write-only).
- IsEnabled=false machine: trees possible per-app (GTK4 yes, others no);
  the page tells the truth per daemon signal.
- No live focus proof yet; IsEnabled flip not exercised (would enable all
  app trees session-wide — that is the user's explicit opt-in to make, not
  ours).
- Password rails tested against synthetic fixtures; no live credential UI
  was read.
- AT-SPI sees UI semantics, not keystrokes — this is not a keylogger and
  never will be.
