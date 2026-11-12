<!-- SPDX-License-Identifier: GPL-3.0-or-later -->
# P15 lane — Screen awareness (AT-SPI) for `airi-daemon` — lane P2a

Status: **implemented + verified on this machine (2026-11-12)**. Local
verification only: crate tests, daemon unit tests, clippy `-D warnings`, fmt,
`--selftest` live, and a temporary live digest probe (since removed). The
airi-qt workspace gate was NOT run (central owns it after P2b). No git writes.

Mission recap: give `airi-daemon` opt-in AT-SPI2 eyes — the same channel the
screen reader uses — behind hard rails, and expose the digest strictly on
demand. Everything below is additive; the daemon's loop, session-bus poll
(20 ms), system-bus poll (0 ms), debounce, and lockdown rails were extended,
not restructured.

---

## 1. Architecture

Two layers, one new crate, one daemon extension:

    airi-qt workspace
    ├── crates/airi-a11y/          (NEW — self-contained, deps: dbus only)
    │     src/discover.rs           org.a11y.Bus.GetAddress / org.a11y.Status.IsEnabled (session bus)
    │     src/focus.rs              match rules, signal parsing, lastFocus cache
    │     src/digest.rs             TreeNode model, caps, exclusions, redaction (pure, unit-tested)
    │     src/client.rs             A11yClient: a11y bus connection + live subtree walk
    │     src/redact.rs             deliberate copy of airi-daemon::redact (crate stays self-contained)
    │
    └── apps/airi-qt/crates/airi-daemon/   (EDIT — additive)
          src/screen.rs              (NEW) exclusions store, focus-event rails, digest/SetExcludedApps JSON
          src/state.rs               Source gains Screen ("screen", 6th source, [bool; 6])
          src/control.rs             GetFocusDigest, SetExcludedApps; GetStatus sources gains screen: bool
          src/main.rs                a11y client init, 0 ms a11y poll inside the same loop, selftest section

Data flow (focus event, hot path — never content):

    a11y bus signal ──► poll_focus() (zero-wait, same loop iteration)
        ──► effective_armed(Screen)?  no → drop, clear cache (observe nothing)
        ──► resolve_app_name() (GetApplication + verify, else Parent walk)
        ──► excluded?                 yes → drop (never ring/audit)
        ──► ring + audit              "screen: focused <app> — <title>"  (metadata only)

Data flow (digest, strictly on demand — the Qt button path):

    GetFocusDigest() ──► capture_digest(sender, path, cached_title)
        ──► build_tree (budget-capped, password subtrees not descended)
        ──► digest_from_tree (caps 200 / depth 8 / 500 chars/node / 4000 chars total)
        ──► redact per line → { ok:true, app, title, lines, text_length, skipped_password_nodes }
        ──► excluded? → { ok:false, error:"excluded" }   (an excluded app NEVER yields a digest)

Nothing is pushed. Nothing is cached to disk. Focus events are metadata-only.
Content is computed once per `GetFocusDigest()` call and leaves the process
only as the method reply.

## 2. The exact a11y bus negotiation outcome ON THIS MACHINE

Machine: Arch Linux, systemd 262, Hyprland (Wayland), GTK 4.24.1 apps.
Session bus: `unix:path=/run/user/1000/bus`. At-spi: `at-spi-bus-laun`
(pid 1435) + `at-spi2-registryd --use-gnome-session` (pid 1443) both running.

`airi-daemon --selftest` (live, this machine, exit 0):

    session bus: present
      [ok] match rule (media): …
      [ok] match rule (lock): (freedesktop / GNOME / KDE screensaver rules)
      [info] screen-saver name owned on session bus: org.freedesktop.ScreenSaver
      [info] screen-saver name not owned: org.gnome.ScreenSaver
      [info] screen-saver name not owned: org.kde.ScreenSaver
      [info] a11y: available (a11y bus address fetched; IsEnabled=false (apps may not build trees))
      [ok] connected to the a11y bus at unix:path=/run/user/1000/at-spi/bus_0
      [ok] focus match rule (screen): type='signal',interface='org.a11y.atspi.Event.Object',member='StateChanged'
      [ok] focus match rule (screen): type='signal',interface='org.a11y.atspi.Event.Window',member='Activate'
    system bus: present …

Startup in run mode prints the same and `sources armed: lock,media,network,power,screen,sleep`.

Key findings (all verified with `gdbus` by hand):

- `org.a11y.Bus` IS on the session bus at `/org/a11y/bus`; `GetAddress()` →
  `unix:path=/run/user/1000/at-spi/bus_0` (socket exists, mode 700).
- `org.a11y.Status.IsEnabled` is a **property** (read via
  `org.freedesktop.DBus.Properties.Get`), value **`false`** on this desktop
  (the "screen reader enabled" bit). It is read as `Variant<bool>` — honest
  report, not a guess.
- **The a11y bus accepts our match rules.** Both focus match rules install
  and remove cleanly (selftest adds, probes, removes them; exit 0).
- `IsEnabled=false` does NOT prevent the GTK4 trees from being built on this
  machine: `/org/a11y/atspi/accessible/root` exists and answers
  `GetChildren`/`GetRoleName`/`GetApplication` for gnome-clocks, nautilus,
  vibepanel and hyprshell (all GTK4). Parsed trees: mostly `generic` nodes
  with empty names; nautilus's file-manager window reports role `window`,
  Name `Evangelion`; gnome-clocks root reports role `application`,
  Name `org.gnome.clocks`.
- **dbus API decision (as ordered):** `dbus::blocking::Connection::new_address(&str)`
  in dbus 0.9.12 is the API that won. It exists, and it connects *and*
  registers (Hello) on a custom bus. `new_custom` does **not** exist in
  dbus 0.9.12 — report accordingly. No invented API, no fakes.
- The a11y bus itself is brokered by `at-spi2-registryd`; a client can see
  the broker's own root at `/org/a11y/atspi/accessible/root` (the "desktop
  frame", Name `main`). Two traps were found and fixed in `resolve_app_name`/
  `resolve_title` (see §3).
- `tuned-gui` (pid 1092290) times out on a11y D-Bus calls — the app does not
  answer its accessible objects within 500 ms. The digest fails with an
  honest error string; the daemon keeps running.

## 3. Focus-event plumbing and the application-resolution traps

Match rules (installed on the a11y bus, not on session/system; `subscribe` per
the lane spec, no arg0 filter):

    type='signal',interface='org.a11y.atspi.Event.Object',member='StateChanged'
    type='signal',interface='org.a11y.atspi.Event.Window',member='Activate'

Parsing (`airi-a11y::focus`, all tolerant, all unit-tested on synthetic
messages, untrusted-bus discipline — malformed → drop):

- `StateChanged`: arg0 must be `"focused"` (case-insensitive); arg1
  (`detail1: i`) `== 0` means focus *left* and is dropped. Missing arg1 is
  accepted (toolkits disagree). The accessible path comes from the message
  path (signals are emitted ON the accessible object), never from the body.
- `Window.Activate`: arg2 (a string) is taken as the window title; arg1 may
  be an object path (`o`) or a plain string (`s`) and is *deliberately
  ignored* — the message path wins (unit test asserts this when they
  disagree). Missing/unparseable title → focus still tracked, title absent.
- `lastFocus {app, title, path, sender}` is cached in the daemon. `sender`
  is the unique bus name of the emitting app and is required as destination
  for every subsequent D-Bus call; focus events carry no application name,
  so `app` is always resolved lazily and stale names are dropped on every
  focus change.

Application resolution (live-tested):

1. If the focused node itself has role `application`, its own `Name` is the
   app — never the *parent* application above it, because of this bus's
   hierarchy trap (below).
2. Otherwise `Accessible.GetApplication()` → `(dest, path)` of the
   application root — **trust but verify**: the returned node must have
   role `application`; if not (or on call failure), a bounded Parent walk to
   role `application` (max 16 levels) is used instead.
3. `Name` (via `org.freedesktop.DBus.Properties.Get`) of the application
   root is the app name; if it is empty, the unique bus name is used as the
   identifier.

Title resolution: nearest ancestor with **exact** role `window` / `frame` /
`dialog` / `alert` and a non-empty `Name` (exact match only), stopping at
the application root — never crossing into the registry. Fallback: the
node's own `Name`.

The two traps that motivated the exact rules (found live):

- `GetApplication()` on an application root returns the **registry**
  (`(:1.2, /org/a11y/atspi/accessible/root)`, the "desktop frame" whose
  `Name` is `main`), not the app. Verified with `gdbus` for gnome-clocks and
  nautilus. Any code that trusts it unconditionally reports
  `app: main` — garbage. Fixed in §3.1/3.2 above.
- The registry's desktop frame role is `desktop frame`; a sloppy
  `ends_with("frame")` title match made `title: main` for root probes.
  Fixed by exact role equality + the application-root stop.

Verified live (temporary probe, then removed): window of nautilus
(`Evangelion`) → `app: org.gnome.Nautilus`, `title: Evangelion`; a deep
generic child of that window resolves the same way (app via ancestor walk);
gnome-clocks root → `app: org.gnome.clocks`, `title: org.gnome.clocks`;
`tuned-gui` → clean error ("a11y bus call failed…"), daemon stays up.

Event → ring/audit path in the daemon (`screen::resolve_focus_event`):

- `effective_armed(Source::Screen)` is checked BEFORE any resolution or
  ring/audit write. Paused/locked/disarmed → the event is dropped and the
  cache is cleared (observe nothing, remember nothing).
- App resolution failure (app died mid-event) → fail closed: no ring line,
  no audit line, one `eprintln`.
- Excluded app (built-in or user list, case-insensitive substring of the
  application name) → fail closed: never rings, never audits.
- Otherwise: one ring event + one audit line, text
  `screen: focused <app> — <title>`, redacted before the ring push
  (audit redacts on write anyway). App name and window title are metadata
  by the lane spec; no content is ever included.

## 4. The digest walker: caps and the exclusion rails

`digest_from_tree` is pure and unit-tested; the live D-Bus walker in
`client.rs` only *builds* the tree (same struct, budget-spent recursion) and
then delegates to the same function — no divergent logic.

Hard rails (all enforced, none optional):

| Rail | Value / rule |
|---|---|
| Node budget | 200 nodes total per digest (includes password-skipped nodes) |
| Depth cap | 8 (root = 0); deeper nodes are never visited |
| Per-node text | 500 chars max, `…` truncation, char-boundary safe (multi-byte safe, tested) |
| Total digest | 4000 chars (sum of emitted lines; stop-at-cap, `text_length` never exceeds) |
| Password roles | `password text` / `password-text` (any case, trimmed) → skip node **and subtree**, count `skipped_password_nodes` |
| Protected state | `TreeNode.protected_state` flag → same skip path (see §4.1 — this wire bit does not exist in the build here) |
| Heuristic | role/name/description containing (ci): `password` `passphrase` `secret` `token` `api-key` `api_key` `apikey` `pin` → skip subtree (over-inclusive on purpose: false positives hide, never leak) |
| Redaction | every emitted line passes the daemon's redactor pattern set (copied into `airi-a11y::redact`); token-ish strings become `***` |
| Sibling safety | excluding a node never excludes its siblings |

### 4.1 The "protected state" honesty note

The research spec (§C rail 1) says "skip roles/states: `password text`,
`protected` state". Verified against this machine's ATK/ATSPI headers:
`/usr/include/at-spi-2.0/atspi/atspi-constants.h` — `AtspiStateType` ends at
`ATSPI_STATE_LAST_DEFINED` with **no `ATSPI_STATE_PROTECTED`** (44 defined
states, indices 0..43). ATK (`atk/atkstate.h`, this package) has no protected
state either. The bit cannot be decoded honestly on this desktop. What is
implemented instead:

- `TreeNode.protected_state` exists as a first-class flag and is exercised by
  the password fixture test (a node with the flag set is skipped and counted).
- The live walker always sets it `false` (nothing to decode), and the two
  password rails that *can* fire on this bus — role name and the heuristic —
  carry the load. This is documented in code and here, not papered over.

### 4.2 The password test fixture (as committed)

`digest::tests::password_fixture_skips_credentials_keeps_siblings` builds a
synthetic tree:

    application: test-app
      label: Username                ← kept
      password text: hunter2         ← role rail: skipped+counted, children NOT walked
      text: secret token: ghp_...    ← heuristic rail: skipped+counted
      push button: Log in            ← kept

Asserts: `skipped_password_nodes == 2`, no line contains `hunter2` or the
ghp_ token, `Username`/`Log in`/`application: test-app` are present.
Plus: `password_subtree_children_are_not_walked` (nested content under a
password node never surfaces), `protected_state_flag_excludes_even_a_plain_node`,
the caps tests (200 nodes / depth 8 / 500 chars / 4000 chars), multi-byte
truncation, and the daemon-parity redactor tests (`redact_matches_daemon_cases`,
`lines_are_redacted_before_leaving_memory`). No live bus is required by any
unit test; D-Bus message parsing is tested with synthetic `Message`s.

## 5. Exclusion list (built-in + user, persisted)

`<data_dir>/airi-qt/awareness-exclusions.json` — plain JSON string array,
e.g. `["my bank", "keepassxc"]` (the user's array replaces, atomically via
tmp+rename, the user half; built-ins are code, never persisted):

- Built-in always-on denylist: `keepass`, `1password`, `bitwarden`,
  `secret-service` — case-insensitive substring of the app name
  (spec §C rail 4, "default on").
- User entries: case-insensitive substring of the application's name,
  ≤256 entries, each ≤128 chars, trimmed, non-empty; validated on set and on
  load; persisted atomically; reloaded at daemon start.
- SetExcludedApps with a malformed/oversized/non-string array → `{ok:false,
  error}` and the in-memory list is untouched (rollback-on-failure tested).
- Excluded apps: no ring/audit from focus events, and
  `GetFocusDigest → {ok:false, error:"excluded"}` — a digest is **not**
  produced, not even truncated. (Tested via
  `digest_json` + the `set_excluded_apps_*_via_dispatch` tests.)
- Built-in and user matching is substring of the *application name* only —
  window titles are NOT matched (a password manager whose window title
  happens to contain a needle is out of scope of the configured rail).

## 6. Audit / ring semantics (metadata only — content never persisted)

- `Source::Screen` = `"screen"`, 6th source. `SetSource("screen", …)`,
  `GetStatus` sources gains `screen: bool` (sources_json / tests updated).
  Pause / lockdown / resume affect the screen source exactly like the other
  five (it is in `Source::ALL` and `[bool; 6]`; `effective_armed` covers it).
- Focus events: ring event `screen: focused <app> — <title>` (cap 200 ring,
  purged on lockdown like the rest), audit line same text, redacted on write.
  Never markup/content/field values.
- Kill switch (`Pause(true)`) and screen lock both disarm the screen source
  via the same lockdown rail; on `Pause(true)` the ring is purged.
- `GetFocusDigest` is NOT audited and NOT cached — viewing your own
  screen-reader digest is not an "observation event" worth a permanent line.
- `SetExcludedApps` IS audited: `source: screen`, `screen: excluded apps
  updated`; the detail carries only the entry counts ("N user exclusion(s)
  + M built-in"), never the user-chosen name strings.
- A runtime a11y read error disarms `screen` for the rest of the run with one
  audit line (`screen unavailable`) and an `eprintln` — no crash, no retry
  loop, restart re-probes (systemd semantics, same as session bus).
- `--selftest` reports the a11y negotiation and **always exits 0**.

## 7. Desktop gaps (honest list)

1. **`IsEnabled=false` on this machine.** GNOME's "screen reader" bit is off.
   Measured effect: GTK4 trees exist anyway (gnome-clocks/nautilus/vibepanel/
   hyprshell all answer); Qt (QML) trees and Firefox/Chromium trees will not
   be built until the bit flips (or a toolkit is forced, e.g.
   `QT_ACCESSIBILITY`). On this desktop everything GUI is GTK4 today, so the
   walk works — but a Qt AIRI running on a default GNOME would currently be
   blind until the user enables the bit (which enables it for **every
   same-UID process** — the one-bit blast radius from the research doc).
2. **No live focus signal was observed** in a 3 s window (user inactive, and
   `IsEnabled=false` suppresses some toolkits' emission). The event path is
   code-complete and unit-tested on synthetic messages, and both match rules
   are proven installable on the bus — but "bytes actually arrived on focus
   change" is NOT yet demonstrated on this machine. Enabling a screen reader
   once, focusing a GTK window, and watching the journal would close this.
3. **`tuned-gui` (python, pid 1092290) times out** on a11y D-Bus calls —
   its accessible objects do not reply within 500 ms. Honest error, clean
   failure, daemon unaffected. Per-app silence is a normal AT-SPI reality;
   the digest can never see through an app that won't answer.
4. **Trees are sparse.** GTK4 here exposes structure but mostly empty,
   unnamed `generic` containers; text-rich nodes (`org.a11y.atspi.Text`) were
   not observed in the live trees, so digest lines today are few and mostly
   `window: <title>`-grade. This is GTK4-on-Wayland reality, not a walker bug
   (the walker is verified on synthetic trees with full labels + Text).
5. **Registry-root hierarchy trap**: the a11y bus places application roots
   *under* `org.a11y.atspi.Registry`'s desktop frame (Name `main`). Naive
   `GetApplication()` on an app root returns the registry; naive suffix
   title matching blessed `main` as "the window". Both fixed (§3) — but any
   future code reading the a11y tree on this bus must repeat those checks.
6. **No protected-state bit exists** in this ATSPI build (§4.1) — the
   `protected` exclusion rail is only as strong as role + heuristics +
   built-in denylist here.
7. **No Firefox/Chromium/Electron trees to test** — none running on this
   desktop; web content behavior is unverified. Password managers: the
   built-in denylist covers keepass/1password/bitwarden/secret-service app
   names only; a mislabeled custom field inside a browser would rely on the
   `password text` role + heuristics. Residual risk, documented.
8. **Exclusions match the application name, not the title** — a bank's page
   inside Firefox is "firefox" for exclusion purposes; per-tab exclusion is
   not possible at this layer.
9. `org.a11y.Status.IsEnabled` read failure is tolerated (reported as
   unread, `unavailable_reason` stays `None` — the address is what gates).
   If a future desktop exposes neither the bus nor the property, screen stays
   disarmed with an honest status line; the daemon keeps running.

## 8. Verification log (exact commands, this machine)

    cargo test -p airi-a11y -p airi-daemon   # 33 + 51 passed, 0 failed  (daemon: 43 pre-existing + 8 new)
    cargo clippy -p airi-a11y -p airi-daemon --all-targets -- -D warnings   # clean
    cargo fmt -p airi-a11y -p airi-daemon -- --check                        # clean
    cargo build -p airi-daemon && ./target/debug/airi-daemon --selftest     # exit 0 (§2 transcript)
    timeout 3 ./target/debug/airi-daemon                                     # arms screen; kills by timeout
    live digest probe (temporary example, run, captured, DELETED):           # §3 transcripts

New daemon tests: `set_source_screen_is_accepted_and_toggles`,
`get_focus_digest_roundtrip_via_dispatch`, `set_excluded_apps_roundtrip_via_dispatch`,
`screen::tests::{builtin_denylist_is_case_insensitive_and_always_on,
user_entry_matching_is_substring_of_app_name,
set_validates_and_rolls_back_on_validation_failure,
exclusions_persist_and_reload_roundtrip, set_excluded_apps_json_shape}`.

NOT run: the airi-qt workspace gate (central), the Qt app live digest button
(P2b), and any test requiring a live focus event (needs a user at the keyboard).

## 9. Central steps (done by this lane, both reported)

1. **airi-qt/Cargo.toml**: I ADD the workspace member line myself —
   `"crates/airi-a11y",` appended after `"crates/airi-daemon",` (I only
   touched that one line; everything else in the workspace file is unchanged).
   **Report it.**
2. **airi-daemon/Cargo.toml**: was read first — it did **not** have the
   dependency. I ADD it: `airi-a11y = { path = "../airi-a11y" }`.
   **Report it.** (If central has already written it by the time this is
   merged, the line is identical — dedupe harmlessly.)
3. **airi-qt workspace Cargo.lock** regenerated by cargo (airi-a11y package
   entry + airi-daemon dep). No other dependency changes. No other crates
   rebuilt/upgraded.
4. `packaging/systemd/airi-daemon.service`: **no changes** — the a11y client
   is in-process; no second unit, no helper.
5. **Qt bridge (`bridges/daemon.rs`, modified by another lane): no changes
   needed.** It already consumes `sources.screen` generically
   (`screen_enabled_from_sources_json`, absent/non-bool → `false`, never
   fabricated) and has dedicated round-trip helpers
   (`call_get_focus_digest`, `call_set_excluded_apps`) plus a pure
   `classify_digest_body` that special-cases `{ok:false, error:"excluded"}` —
   byte-compatible with this lane's GetFocusDigest/SetExcludedApps JSON.
   P2b's job is the UI, not the protocol.
6. **i18n keys requested from lane P2b** (P2b owns Qt pages/locales; I added
   none): suggested keys for the Awareness page —
   `awareness.screen.title` ("Focus awareness (AT-SPI)"),
   `awareness.screen.summary`,
   `awareness.screen.status.unavailable` ("Not available on this desktop"),
   `awareness.screen.exclusions.title`, `awareness.screen.exclusions.add`,
   `awareness.screen.exclusions.hint` (case-insensitive substring; KeePass/
   1Password/Bitwarden/secret-service always excluded),
   `awareness.audit.source.screen` (audit-viewer source label),
   `awareness.screen.digest.button` ("Read current focus") with an on-demand
   tooltip. P2b owns final naming/format and the page itself.
7. **No git writes were made by this lane.** All work is uncommitted on top
   of the existing tree; `git status` delta = the files listed in §10 plus
   two pre-existing NOT-MINE modifications (`bridges/daemon.rs`,
   `qml/.../AwarenessSettingsPage.qml`) owned by P2b.

## 10. Files

Created:
- `apps/airi-qt/crates/airi-a11y/` (Cargo.toml + src/{lib,client,digest,discover,focus,redact}.rs)
- `apps/airi-qt/crates/airi-daemon/src/screen.rs`
- `apps/airi-qt/docs/phase-notes/p15-lane-screen-awareness.md` (this file)

Edited (additive):
- `apps/airi-qt/Cargo.toml` — one member line (§9.1)
- `apps/airi-qt/Cargo.lock` — auto (airi-a11y entry)
- `apps/airi-qt/crates/airi-daemon/Cargo.toml` — path dep (§9.2)
- `apps/airi-qt/crates/airi-daemon/src/{main.rs,state.rs,control.rs}`
  — 6th source, digest/exclusions plumbing, a11y poll in the same loop,
  selftest section; loop not restructured; `observe/` untouched
- `apps/airi-qt/crates/airi-a11y/src/client.rs` API note: a11y match rules
  are installed/removed via `Connection::add_match_no_cb` /
  `remove_match_no_cb` (probe cleanup).

Not touched: Qt pages, locales, `airi-daemon.service`, build scripts,
anything outside the three owned paths.

## 11. Open items / follow-ups (not done, by design or by dependency)

- P2b: Qt button → GetFocusDigest, exclusions UI, i18n keys (§9.5).
- Enable-screen-reader verification: one real keyboard focus burst with
  `org.a11y.Status.IsEnabled=true` to prove the event path live (needs the
  user at the machine).
- Decide whether `--selftest` should *optionally* probe the digest end-to-
  end against the focused window (would claim/exercise focus; intentionally
  left out — selftest claims no bus name and never synthesizes events).
- `GetFocusDigest` latency: worst case ~1 D-Bus round trip per node at
  500 ms timeouts (a dead app can make a press take seconds). Consider a
  per-call deadline if P2b's UI needs one; today it is honest-but-slow on a
  dead app rather than async.
- The ring entry for focus events is metadata; if the transcript-to-model
  attach path ever wires screen lines in, per-message explicit consent only
  (§F rail 9 — nothing here changes that boundary).
