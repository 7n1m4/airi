// SPDX-License-Identifier: GPL-3.0-or-later
# P14 — Lane awareness page (P1b: the Qt face of the awareness daemon)

**Status:** implemented, verified in a scratch copy; not committed; central
wires the module (see "Central steps" below). The daemon (`airi-daemon`,
lane P1a) landed in the tree **in parallel while this lane ran** — this
note records the contract as actually shipped, not only as speced.

## Ownership (this lane)

| File | Change |
|---|---|
| `crates/airi-qt/src/bridges/daemon.rs` | NEW — `DaemonController` bridge |
| `crates/airi-qt/src/bridges/desktop.rs` | additive — `ACTION_TOGGLE_AWARENESS` + one tray item |
| `qml/pages/settings/modules/awareness/AwarenessSettingsPage.qml` | NEW — settings page |
| `qml/shell/MainShell.qml` | additive — `DaemonController { id: daemonCtl }` + one `dispatchDesktopAction` case |
| `docs/phase-notes/p14-lane-awareness-page.md` | this note |

Nothing else touched by this lane. `Cargo.toml`, `Cargo.lock`,
`build.rs`, `bridges/mod.rs`, `SettingsWindow.qml`, locales, and
`Main.qml` are all **unchanged by this lane**. (Observed mid-lane, not
mine: P1a/central added `crates/airi-daemon` to `apps/airi-qt/Cargo.toml`
workspace members and it appeared in `Cargo.lock`; the sibling daemon
itself landed at `apps/airi-qt/crates/airi-daemon/`.)

## Contract discrepancy found in the parallel daemon (read-only)

The lane brief specified the audit file as `awareness.jsonl`. The daemon
as actually written resolves **`awareness-audit.jsonl`**
(`AUDIT_FILE_NAME` in `crates/airi-daemon/src/audit.rs`; daemon README
dev-run section agrees). Per the standing rule "resolve exactly as the
daemon does", the bridge uses `awareness-audit.jsonl`. Likewise the
daemon's audit rows are `{ts_ms, source, event, detail}` — the `event`
field, not `verb`; the bridge maps `event` → `verb` on output (an explicit
`verb` field wins if a future writer emits both) so the page's
`{ts_ms, source, verb, detail}` contract holds against the real daemon.

Also confirmed against the daemon source: object path
`/org/moeru/airi/Daemon1` (`OBJECT_PATH` in `control.rs`), interface,
`GetStatus`/`SetSource`/`Pause` signatures and the exact `GetStatus`
JSON keys, `paused_by ∈ {"user", "lockdown", ""}`. And one semantic worth
central knowing: **the daemon's `Pause(true)` also purges its in-memory
ring** (`control.rs::pause`) and audits it as
`awareness: paused (kill switch)` — the brief for this lane said only
"arms/disarms ALL observers"; pausing is *stronger* than speced. The
page copy does not contradict this (it says pause wins over lockdown
re-arm, which is accurate).

## Bridge API — `DaemonController` (`bridges/daemon.rs`)

`DaemonController` (`#[qml_element]`, namespace `airi_qt`,
`com.airi.airiqt`). QML-visible properties (`READ, NOTIFY`):

| Property | Type | Meaning |
|---|---|---|
| `running` | bool | `true` when `GetStatus` succeeded within 800 ms |
| `paused` | bool | daemon kill-switch state (read-back, never requested) |
| `sourcesJson` | QString | passthrough of the `sources` object (or `{}`) |
| `auditPath` | QString | `audit_path` from `GetStatus` when set, else the locally resolved path |
| `statusLine` | QString | human, token-free; daemon-down text or `airi-daemon <v> · protocol 1 · running/paused [by …]` |

Qinvokables:

| Call | Signature | Behavior |
|---|---|---|
| `refresh()` | `()` | GetStatus via a fresh blocking session-bus connection (800 ms timeout). Any failure ⇒ `running=false`, statusLine = `airi-daemon is not running — see packaging/README.md (dev-run section)`; **never throws** |
| `toggleSource(source, enabled)` | `(QString, bool) -> bool` | `SetSource`, then `refresh()`, then returns the value **read back** from `sourcesJson` (not the requested one) |
| `togglePause()` | `() -> bool` | `Pause(!paused)`, then `refresh()`, returns paused state read back |
| `recentAudit(count)` | `(i32) -> QString` | tail of the shared JSONL, clamped to 50, malformed lines skipped, newest-first `[{ts_ms, source, verb, detail}]`; missing/unreadable file ⇒ `[]`; never throws |
| `clearAudit()` | `() -> bool` | truncates the audit file to zero bytes (creates it if missing); **does not delete the file and does not clear the daemon's in-memory ring buffer** |

Threading: all qinvokables on the Qt thread; each D-Bus call opens and
closes its own blocking connection (airi-channel peer-count idiom). No
signals of its own — the page polls via a 1 s `Timer`. The 800 ms bound
caps the worst-case Qt-thread stall per poll.

One deliberate bridge choice: `audit_path` in `GetStatus` wins over the
locally resolved path for display, but all file operations
(`recentAudit`/`clearAudit`) always use the locally resolved path — the
two agree in practice (both are `dirs::data_dir()/airi-qt/audit/`).

## Tray / MainShell wiring points

- `desktop.rs`: `ACTION_TOGGLE_AWARENESS = "toggle-awareness"` added next
  to `ACTION_TOGGLE_STAGE`; new tray item **"Awareness: Toggle"** directly
  after "Toggle Stage" (stage neighborhood, as briefed); identical
  `publish_desktop_action` path; one log line updated. No other tray
  code touched.
- `MainShell.qml`: `DaemonController { id: daemonCtl }` after
  `AudioDeviceSettingsController`; `dispatchDesktopAction` gained only
  `case "toggle-awareness": daemonCtl.togglePause(); break` (placed right
  after `toggle-stage`). Every other pixel untouched.

## Page structure — `AwarenessSettingsPage.qml`

Header (title "Awareness" + `ABadge "Preview"` (warning) + caption stating
nothing acts autonomously) → daemon-down `ACard` (`AEmptyState` + Retry
`AButton`, only when `!running`; switch cards are visible but disabled +
dimmed in that state) → kill-switch `ACard` (`ASwitch` "Awareness
enabled", checked = `!paused`, `onToggled: controller.togglePause()`) →
sources `ACard` (five `ASwitch` rows, keys `sleep`/`lock`/`media`/`network`/
`power`, bound to a `sources` QML binding that re-parses `sourcesJson` on
notify) → audit viewer `ACard` (header row: title + Refresh `AButton`
(Ghost) + Clear `AButton` (Danger); `ListView` over
`page.auditEntries` from `recentAudit(50)`; per row: source `ABadge`
chip (sleep→info, lock→warning, media→accent, network→success,
power/system/default), bold verb, detail, absolute `yyyy-MM-dd HH:mm:ss`
timestamp; `AEmptyState` when empty; `ASeparator`; local-only footer note
with the raw `auditPath` printed beneath it in tiny type) → status-line
`Text` (raw English, `Theme.warning` when the daemon is down) →
`AModal` clear-confirm ("Clear the audit log? This cannot be undone." →
`clearAudit()` + refresh) → 1 s `Timer` polling `refresh()` +
`refreshAudit()`.

Honest property: the badge is Preview; the daemon is dev-run only; no
agent dispatch, no chat wiring, no autonomous action anywhere; the page
configures and views only.

**Deviations from the brief, all deliberate:**
- `AToggle` does not exist in `qml/components/` — the toggle idiom is
  `ASwitch` (as used by every wired page). Brief's `AToggle` rows are
  implemented as `ASwitch`.
- One extra i18n key beyond the brief's list, `shell.awareness.sources.title`
  ("Sources", the card header), since the brief's list had per-row keys
  but no card-header key; reported in the i18n handoff below.
- The brief's `audit.footer` example text referenced `awareness.jsonl`;
  the shipped string says `awareness-audit.jsonl` (the real filename).
- `daemonDownSubtitle`/`daemonDownTitle` are split across `AEmptyState`'s
  title/subtitle instead of one long string; the words are the brief's.
- The page disables + dims (not hides) the kill-switch/sources cards when
  the daemon is down, so the layout stays inspectable offline.

## i18n keys — handoff (locales NOT edited by this lane)

All under `shell.awareness.*` plus `shell.settings.nav.awareness` (31
keys total; brief said "×10", the page uses more). Suggested placement
next to `memory:` in
`packages/i18n/src/locales/en/shell.yaml`. English source values:

```yaml
awareness:
  title: 'Awareness'
  badge: 'Preview'
  caption: 'Status, per-source switches, kill switch and the local audit log for the opt-in awareness daemon. Nothing here acts on its own.'
  daemonDownTitle: 'airi-daemon is not running'
  daemonDownSubtitle: 'The awareness daemon is an opt-in user-session service. Dev-run instructions: apps/airi-qt/packaging/README.md.'
  retry: 'Retry'
  killSwitch:
    title: 'Awareness enabled'
    caption: 'Pauses ALL observers instantly — your pause wins over re-arming after lock or sleep. Observation happens only while awareness is enabled; lock and sleep disarm all observers temporarily regardless.'
  sources:
    title: 'Sources'
    sleep:
      title: 'Sleep/wake'
      caption: 'Machine sleep and resume events (logind).'
    lock:
      title: 'Screen lock'
      caption: 'Screen lock/unlock via the desktop screensaver service (best effort per desktop).'
    media:
      title: 'Media playback'
      caption: 'Play/pause changes reported by media players (MPRIS).'
    network:
      title: 'Network state'
      caption: 'Connectivity changes reported by NetworkManager.'
    power:
      title: 'Battery/AC'
      caption: 'Battery versus AC power changes (UPower).'
  audit:
    title: 'Audit log'
    refresh: 'Refresh'
    clear: 'Clear…'
    emptyTitle: 'No awareness events yet'
    emptySubtitle: 'No awareness events yet — enable a source and see what the machine whispers.'
    footer: 'Local only — stored as awareness-audit.jsonl in the app data directory (7-day retention, redacted). Nothing leaves the machine.'
  confirmClear:
    title: 'Clear the audit log?'
    body: 'Clear the audit log? This cannot be undone.'
    confirm: 'Clear'
    cancel: 'Cancel'
```

Plus:

```yaml
settings:
  nav:
    awareness: 'Awareness'
```

No other keys consumed. `statusLine` is raw English (bridge convention);
source chip texts (`sleep`/`lock`/…/`system`) and the raw `auditPath` are
untranslated by design; `ts_ms` formats via `Qt.formatDateTime`, not a
translatable string.

## Central steps (exact)

In `crates/airi-qt/src/bridges/mod.rs`:

1. Add `pub mod daemon;` (alphabetical: after `pub mod capture;`).

In `crates/airi-qt/build.rs`:

2. After `manifest_dir.join("src/bridges/desktop.rs"),` add
   `manifest_dir.join("src/bridges/daemon.rs"),`
3. After `module = module.qml_file("qml/pages/settings/modules/hearing/HearingSettingsPage.qml");` add
   `module = module.qml_file("qml/pages/settings/modules/awareness/AwarenessSettingsPage.qml");`

In `qml/shell/SettingsWindow.qml` (nav index 29 is central's — do not
let this lane touch it):

4. Add a nav `AListItem` (icon `👁️`,
   `title: I18n.tr("shell.settings.nav.awareness")`, `navIndex === 29`)
   after Hearing (28), and an `AwarenessSettingsPage {}` as the StackLayout
   page after the Hearing page. Verify indexes against the live tree.

5. Locales — add the `shell.awareness.*` keys + `shell.settings.nav.awareness`
   (values above; other locales fall back to the key until translated).

6. `Cargo.toml` needs no change from this lane (`dbus`, `dirs`,
   `serde_json`, `cxx-qt(-lib)` already present; `airi-daemon` itself was
   added to workspace members by the daemon lane/central, observed).

Nothing else. The real tree's `build.rs`/`mod.rs`/`SettingsWindow.qml`/
locale files were **not** edited by this lane.

## Verification evidence

All build/test work ran in a scratch copy at `/home/vi/airi-p1b-check`
(rsync of `apps/airi-qt` minus `target/` and `dist/`; glue lines from the
"Central steps" applied **in the copy only**; `target/` built fresh there,
including after the daemon lane wired `airi-daemon` into the workspace —
copy re-synced with current `Cargo.toml`/`Cargo.lock`/`crates/airi-daemon`
and re-verified). The real tree was never cargo-built by this lane.

| Check | Result |
|---|---|
| `cargo check -p airi-qt` (copy) | PASS |
| `cargo test -p airi-qt` (copy) | **65 passed / 0 failed** — 59 pre-existing green + 6 new `bridges::daemon::tests::*` (newest-first order, malformed-line skipping + `event`→`verb` mapping, clamp/cap/zero, missing-field tolerance, `status_line_from`, `sources_json_from`) |
| `cargo clippy -p airi-qt -- -D warnings` (copy) | PASS, zero warnings |
| `cargo fmt -p airi-qt -- --check` (copy) | PASS (one `cargo fmt` pass applied; copy re-verified after) |
| `qmllint -I <symlinked module tree>` (copy, Qt 6.12.0) `AwarenessSettingsPage.qml` | **exit 0**; only the established `Member "length" not found on type "QString"` info (same class every wired page reports; line 513, the `statusLine.length` idiom) — no other diagnostics |
| `qmllint` (same sandbox) `MainShell.qml` | **exit 0**; only the pre-existing QString-`.length` info at line 352 — nothing from this lane's additive lines |
| `qmlcachegen` via the cxx-qt build | `AwarenessSettingsPage` listed in the generated `qmldir`; `DaemonController` in `plugin.qmltypes` with all five properties + notify signals — the page compiles through the QML pipeline |
| smoke run / app launch | **not run** (central gates; explicit lane instruction) |

The brief's "pre-existing 657" does not match this crate's actual baseline
(59 tests before this lane; +6 = 65) — the 657 figure presumably counts
the wider workspace. All pre-existing airi-qt tests stay green either
way.

Scratch copy `/home/vi/airi-p1b-check` is disposable; it is removed in the
cleanup step of this handoff.

## What is honestly absent / on the record

- **The daemon is not auto-installed or auto-enabled anywhere.** The
  page configures an opt-in service the user must dev-run (packaging
  README, dev-run section, added by the daemon lane). Nothing in the deb
  ships it; `systemctl --user enable airi-daemon` is the only opt-in at
  login.
- **`clearAudit()` does not clear the daemon's in-memory ring buffer.**
  It only truncates the JSONL file; the ring (cap 200) keeps its events
  until the daemon purges it (the daemon *does* purge the ring on
  `Pause(true)` — kill switch — but *not* on `clearAudit`). The page's
  copy says nothing that contradicts this.
- **KDE/GNOME screen-lock/sleep observation is best-effort by the
  daemon**, not something this page can strengthen — the lock toggle only
  reflects/requests the daemon's armed state.
- **Lockdown re-arm is daemon-side.** The user pause wins over lockdown
  re-arm (`paused_by` = `user` vs `lockdown`); the page displays the
  read-back state and never asserts what it didn't verify.
- No widget, no notification, no tray icon beyond the one "Awareness:
  Toggle" menu item; no per-source retention policy controls; no
  auto-enable of any source; no agent dispatch or chat wiring anywhere on
  the page; no clearing of the daemon ring from the page.
- `toggleSource`/`togglePause` return the **read-back** value; a daemon
  that refuses (or vanishes mid-call) reports `false`/stale state, never
  the requested one.
- Under a missing session bus or absent daemon: every qinvokable degrades
  to `running=false` + the dev-run status line; `recentAudit` still reads
  the local file if present (read-only, honest).

## Not done (explicit)

- No auto-enable of any source or of the daemon itself.
- No tray widget beyond the single menu item; no notification on toggle.
- No per-source retention, ring-size, or pruning controls on the page.
- No locales, no `SettingsWindow.qml` nav entry (central, index 29), no
  `build.rs`/`mod.rs` wiring in the real tree (central), no smoke run.
- No daemon-side changes; the `airi-daemon` workspace-membership edit in
  `apps/airi-qt/Cargo.toml` and the `Cargo.lock` regen are the daemon
  lane's, observed not made.
