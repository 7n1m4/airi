// SPDX-License-Identifier: GPL-3.0-or-later
# P15 — Lane awareness screen (P2b: the Qt face of AT-SPI screen awareness)

**Status:** implemented in the real tree; verified for `-p airi-qt`
(see "Verification evidence"). The parallel P2a daemon lane **landed its
core into this same tree mid-lane** — the note records the contract as it
actually shipped in `crates/airi-daemon` (read-only inspection; this lane
did not touch it), not only as it was speced. At the time of handoff the
daemon crate does **not** compile (P2a's in-flight `screen.rs` wiring —
see "Workspace build state"; not this lane's code and not reverted).
Nothing here is committed; central wires nothing new (the page and the
bridge were already registered by wave P1/central steps).

## Ownership (this lane)

| File | Change |
|---|---|
| `crates/airi-qt/src/bridges/daemon.rs` | additive — `focusDigestJson`/`screenEnabled` qproperties, `fetchFocusDigest`/`setExcludedApps` qinvokables, 4 new pure helpers, 4 new unit tests |
| `qml/pages/settings/modules/awareness/AwarenessSettingsPage.qml` | additive — "Screen awareness (AT-SPI)" card (after Sources, before Audit) + focus-digest preview dialog; small header-comment extension |
| `docs/phase-notes/p15-lane-awareness-screen.md` | this note |

Nothing else touched. No `build.rs`, no `bridges/mod.rs`, no
`SettingsWindow.qml`, no locales, no `Cargo.toml`, no `MainShell.qml`,
no P2a files. `toggleSource` already passed any source name through
unvalidated (no whitelist — verified), so `toggleSource("screen", …)`
works unchanged; only its doc comment was updated to name `screen`.

## What P2a actually shipped (verified against the tree, not the spec)

The `p15-lane-screen-awareness.md` note **does not exist** (P2a has not
published its own phase note at handoff time), so the daemon source of
truth won:

- `airi-a11y` crate exists (`crates/airi-a11y/`): AT-SPI2 client,
  `FocusCache`, per-node digest with node/summary caps, redaction.
- `screen.rs` (daemon, NEW by P2a, **read-only for this lane**):
  - Focus events ring/audit **app name + window title only**, redacted,
    and only while `effective_armed(Source::Screen)`; excluded apps never
    ring/audit; unresolved focus fails closed.
  - `digest_json(client, cache, exclusions)` — computed on demand per
    `GetFocusDigest` call, never cached, never persisted. Returns
    `{ok:true, app, title, lines, text_length, skipped_password_nodes}`
    or `{ok:false, error}` with these actual strings:
    - `"screen awareness unavailable on this desktop (a11y bus not reachable)"`
    - `"no focused accessible tracked yet (focus a window first)"` ← **not** the spec's
      `"no focus captured yet — click into a window once"`; this lane handles errors
      generically, and the page shows the daemon's raw string inline instead of
      fabricating the spec's one. **Spec drift, recorded.**
    - `"excluded"` when the focused app is on the exclusion list
    - `client.capture_digest` errors (raw daemon error string) otherwise
  - `SetExcludedApps(json: s) -> s` — validates a JSON array of strings
    (≤ 256 entries, each ≤ 128 chars, non-empty), stores **in memory and
    persists** to `<data_dir>/airi-qt/awareness-exclusions.json`
    (write-tmp+rename). Matching is **case-insensitive SUBSTRING of the
    application name** (not literal name equality — spec label drift,
    recorded; the page copy says "substrings" for this reason).
    **Each call replaces the entire user exclusion list.**
  - Built-in credential-manager denylist (`keepass`, `1password`,
    `bitwarden`, `secret-service`) is always on, is code (not user data),
    and is **not** listed by any control method.
  - **No `GetExcludedApps`.** The daemon's user list is write-only from
    the control plane. Confirmed in `control.rs::dispatch` — only
    `GetStatus`, `SetSource`, `Pause`, `GetFocusDigest`,
    `SetExcludedApps` exist.
- `control.rs` (P2a, in-flight): `GetStatus().sources` gains `screen`
  (armed flag, default `true`, toggleable via `SetSource("screen")`).
  **AT-SPI availability is NOT exposed in `GetStatus`** — the daemon
  tracks it internally (`availability: HashMap<Source, bool>` in
  `main.rs`, used only for the startup eprintln summary; when the a11y
  bus read errors mid-run, screen is disarmed for the rest of the run and
  an audit line `screen unavailable` is appended). The **only** in-band
  availability signal is the `GetFocusDigest` error string above.
- `state.rs`: `Source::Screen` added (index 5); `sources_json()` now
  emits six keys.
- Exclusion audit line: on successful `SetExcludedApps` the daemon audits
  `screen: excluded apps updated` with `<n> user exclusion(s) + <m>
  built-in …`. No content, ever.

### Consequences for this lane

1. The exclusion editor **cannot be prefilled** — there is no read path.
   It starts empty and its session note says exactly that, including the
   uncomfortable part: **saving replaces the daemon's entire user
   exclusion list** with what is shown, so pre-existing exclusions from
   earlier sessions are replaced (built-ins are not affected). The
   alternative — hiding the editor — was rejected; the note makes the
   semantics explicit instead.
2. The AT-SPI-unavailable state has exactly two honest triggers:
   - `sources` has **no `screen` key** while the daemon is running
     (pre-P2a build) → the card shows the unavailable empty state;
   - a live `GetFocusDigest` reply containing `"screen awareness
     unavailable"` (the only a11y-unusable signal the daemon exposes)
     → latches `digestUnavailable`, swapping the card body to the same
     empty state.
   The page never derives availability from anywhere else and never
   fabricates tree data.
3. `sources.screen == true` means *armed*, not *usable*. The master
   switch reflects/requests the armed flag only.

## Bridge API — `DaemonController` (`bridges/daemon.rs`), additive

| Property (READ, NOTIFY) | Type | Meaning |
|---|---|---|
| `focusDigestJson` | QString | last `{ok:true}` digest, raw JSON; `""` before the first successful preview; untouched on any failure |
| `screenEnabled` | bool | `sources.screen === true` (strict bool check); `false` when the key is absent/non-bool or the daemon is down — never fabricated |

Qinvokables (all on the Qt thread, own blocking session-bus connection
with the existing 800 ms timeout; none throws):

| Call | Signature | Behavior |
|---|---|---|
| `fetchFocusDigest()` | `() -> bool` | one `GetFocusDigest` round-trip. `{ok:true}` ⇒ `focusDigestJson` = full raw JSON, return `true`. `{ok:false, error:"excluded"}` ⇒ `statusLine` = exactly `App is excluded from screen awareness.` `false` + return. Any other `{ok:false}` ⇒ `statusLine` = the daemon's raw error string (our own spec'd, token-free strings). transport failures (daemon down / predates P2a) ⇒ eprintln + `statusLine`
= `screen digest unavailable: <raw dbus error>`; `false`. The digest is fetched only on demand (the page's Preview button), never on the 1 s poll |
| `setExcludedApps(listJson)` | `(QString) -> bool` | validates **locally first**: parses `listJson`, requires a JSON array of non-empty strings (≤ whatever the daemon tolerates; daemon additionally enforces ≤ 256 entries / ≤ 128 chars and reports `{ok:false,error}` which the bridge surfaces raw in `statusLine`). Normalizes, calls `SetExcludedApps`, returns the daemon's `ok`. Any failure ⇒ `false` + `statusLine` explains; never throws |
| `toggleSource("screen", …)` | unchanged | no whitelist existed; passes through; read-back semantics unchanged |

`statusLine` for excluded is the one string the spec hard-pinned;
everything else passes the daemon's through untouched.

New pure helpers (all unit-tested): `screen_enabled_from_sources_json`,
`call_get_focus_digest`, `call_set_excluded_apps`, `classify_digest_body`
(→ `DigestOutcome::{Ok, Excluded, Error(String)}`), `validate_excluded_apps`,
`set_excluded_apps_ok`. Existing 6 bridge unit tests untouched; 4 new ones
added (`screen_enabled_only_from_a_reported_bool_source`,
`classify_digest_body_covers_ok_excluded_and_other_errors`,
`validate_excluded_apps_accepts_arrays_of_non_empty_strings`,
`set_excluded_apps_ok_parses_daemon_reply`).

## Page section — "Screen awareness (AT-SPI)" card

Inserted after the Sources card, before the Audit viewer card. The page's
page-wide Preview badge and the daemon-down empty state cover framing;
the card itself is disabled/dimmed (like every other card) when the
daemon is down.

Layout, top to bottom:
1. Card title `Screen awareness (AT-SPI)`.
2. **AT-SPI-unavailable state** (`AEmptyState`-style, shown instead of all
   interactive content): icon 🖥️, title `Screen awareness unavailable`,
   subtitle *"AT-SPI is not available on this desktop (the a11y bus did
   not answer). Screen awareness is inert here — the rest of Awareness is
   unaffected."* Never shown unless an honest trigger fired (see above).
3. Master `ASwitch` `Screen awareness` → `toggleSource("screen", …)`
   (checked = read-back `sources.screen`), caption: *"Same channel screen
   readers use. Content is never persisted — audits record only app and
   window names. Preview computes it live, nothing else."* (The Preview
   badge is the page-header one; not repeated here, per page-wide Preview
   framing.)
4. **Exclusion list editor** — title `Excluded apps`, caption
   *"Case-insensitive substrings of the app name. Exclusions apply before
   anything is shown or logged."*, then a session note (the confessional):
   *"The daemon does not expose the current exclusion list, so this starts
   empty. Saving replaces the daemon's entire user list with this one.
   Built-in credential-manager exclusions (keepass, 1password, bitwarden,
   secret-service) are always on and are not shown here."*
   Rows: `ATextField` (placeholder `App name or substring…`, Enter adds) +
   `Add` `AButton`; each row is the app-name text + a Ghost `Remove`
   button (dedupe is case-insensitive). On every add/remove the list is
   persisted via `setExcludedApps(JSON.stringify(list))`; **on save
   failure the local list rolls back** to the previous array so the UI
   never claims exclusions the daemon did not accept. When the list is
   empty an `AEmptyState`-free muted line says `No excluded apps.`
   (deliberately not the big empty state — the editor must stay visible).
5. **Preview focus digest** `AButton` (Accent) → `fetchFocusDigest()`.
   - `ok:true` ⇒ `AModal` `Focus digest` opens: `App` + `Window` rows
     (elided), a meta line `<text_length> characters · <skipped_password_nodes>
     password-field nodes skipped`, a `monospace`, read-only, elided
     `ListView` of the **first 12 lines only** plus `… (truncated)` when
     the daemon reports more, then a footer: *"Entirely local — nothing
     leaves the machine; content is never written to the audit log."* and
     a `Close` Accent button. Lines come from the daemon untouched; this
     page never synthesizes content.
   - `ok:false` ⇒ no dialog; the daemon's raw error line is shown inline
     in the card (warning color) — covering verbatim-ish the actual
     `"no focused accessible tracked yet (focus a window first)"`,
     `"excluded"` (surfaced as `App is excluded from screen awareness.`),
     and a11y-unusable (which additionally latches the unavailable state).
6. No chat wiring, no background digest fetch, no notification, no new
   polling — the 1 s timer still only calls `refresh()` +
   `refreshAudit()`.

**Deviation from the brief, deliberate:** the brief asked for an
`AToggle`; the page idiom (as established in P1b) is `ASwitch` — used
consistently here.

## i18n keys — handoff (locales NOT edited by this lane)

Exactly the 21 keys consumed, all under `shell.awareness.screen.*`.
Suggested placement next to the existing `awareness:` block in
`packages/i18n/src/locales/en/shell.yaml`. English source values:

```yaml
screen:
  title: 'Screen awareness (AT-SPI)'
  masterTitle: 'Screen awareness'
  masterCaption: 'Same channel screen readers use. Content is never persisted — audits record only app and window names. Preview computes it live, nothing else.'
  unavailableTitle: 'Screen awareness unavailable'
  unavailableSubtitle: 'AT-SPI is not available on this desktop (the a11y bus did not answer). Screen awareness is inert here — the rest of Awareness is unaffected.'
  exclusionsTitle: 'Excluded apps'
  exclusionsCaption: 'Case-insensitive substrings of the app name. Exclusions apply before anything is shown or logged.'
  exclusionsSessionNote: 'The daemon does not expose the current exclusion list, so this starts empty. Saving replaces the daemon’s entire user list with this one. Built-in credential-manager exclusions (keepass, 1password, bitwarden, secret-service) are always on and are not shown here.'
  exclusionsPlaceholder: 'App name or substring…'
  exclusionsAdd: 'Add'
  exclusionsRemove: 'Remove'
  exclusionsEmpty: 'No excluded apps.'
  preview: 'Preview focus digest'
  digestTitle: 'Focus digest'
  digestApp: 'App'
  digestWindow: 'Window'
  digestChars: 'characters'
  digestPasswordSkipped: 'password-field nodes skipped'
  digestTruncated: '… (truncated)'
  digestFooter: 'Entirely local — nothing leaves the machine; content is never written to the audit log.'
  digestClose: 'Close'
```

No other keys consumed. `statusLine` (including the excluded message) is
raw English by bridge convention; `digestLines` content, raw
`auditPath`, and `ts_ms` are untranslated by design. Per-locale fallback:
other locales fall back to English until translated — locales untouched
by this lane. (The brief's "×10" presumably means "for the 10-locale
handoff"; the key list above is complete — nothing else is consumed.)

## Verification evidence

| Check | Result |
|---|---|
| `cargo check -p airi-qt` | PASS (after one `mut self` borrow fix in `set_status_line`) |
| `cargo test -p airi-qt` | **69 passed / 0 failed** — 65 pre-existing (incl. the 6 P1b bridge tests, all green) + 4 new |
| `cargo clippy -p airi-qt -- -D warnings` | PASS, zero warnings |
| `cargo fmt -p airi-qt -- --check` | PASS (one `cargo fmt` applied; re-verified clean) |
| `qmllint` (Qt 6.12.0, `-I` sandbox at `/tmp/opencode/qmllint-screen-awareness`: copy of `qml/` + build-produced `qmldir`/`plugin.qmltypes` — `plugin.qmltypes` regenerated by this lane's build and confirmed to export `DaemonController` with `focusDigestJson`, `screenEnabled`, `focusDigestJsonChanged`, `screenEnabledChanged`, `fetchFocusDigest`, `setExcludedApps`) | **exit 0**; single diagnostic remains: the pre-existing, established `Member "length" not found on type "QString"` at the `statusLine.length` idiom (line 800; same class every wired page reports; P1b note line 241 documents the same) |
| `qmllint` regression — new code | zero diagnostics from this lane's additions (the one `toLowerCase` warning initially reported on `controller.statusLine` was fixed via `String(...)`) |
| smoke run / app launch | **not run** (central gates; explicit lane instruction) |
| `cargo test --workspace` | **unusable as a gate right now** — P2a's in-flight daemon edits fail to compile (`airi-daemon`: E0271/E0599/E0425/E0061 around `init_screen_awareness`/`screen.rs:93`). This is P2a's code in the same tree, changing under this lane as we type; it was **not** fixed, reverted, or worked around by this lane. Before P2a's last writes hit the disk, a workspace run showed **710 passed** across 50 suites with **zero** failures. `airi-qt` does not depend on `airi-daemon`, so all `-p airi-qt` results above are unaffected. |
| Baseline count remark | The brief's "existing 706" does not match this crate (`-p airi-qt` = 65 pre-existing + 4 = 69; workspace-wide observed 710 before P2a's breakage). Same class of brief-vs-tree drift P1b recorded. Reported honestly. |

## Honesty rails — how this lane holds them

- **No content anywhere except the preview dialog.** Nothing serializes
  the digest to disk, the audit log, settings, or the ring; the dialog is
  populated only from `focusDigestJson` after an explicit Preview press.
- **No background fetch.** The 1 s poll still never calls
  `fetchFocusDigest`.
- **Exclusions apply daemon-side before content exists** (P2a: enforced
  inside `resolve_focus_event`/`digest_json`, not just at display). This
  page claims no more: it never says "excluded apps are hidden from you",
  only that the daemon applies them before anything is shown/logged.
- **Password nodes** are filtered by the daemon and surfaced only as the
  `skipped_password_nodes` count; the page cannot and does not show what
  they contained.
- **Excluded app error path** never displays content; it shows the
  bridge's pinned English line.
- **Nothing fabricated**: unavailability is only ever shown from a real
  daemon reply (missing `sources.screen` key, or the digest error). When
  in doubt the page shows an honest error, never an empty digest, never
  placeholder data.
- **Fail-closed exclusions**: a failed `SetExcludedApps` rolls the local
  list back; the UI never displays exclusions the daemon rejected.
- **Trust in the daemon** (documented, not verified by this lane): the
  audit's `screen` lines carry app name + window title only, redacted;
  7-day retention; nothing leaves the machine. The page-wide Preview
  badge framing remains.

## Not done (explicit)

- **No chat context injection.** The digest never enters any prompt,
  transcript, or agent path; `chat.rs` untouched.
- **No background watching UI / no digest streaming / no tray surface**
  beyond the existing P1b tray item.
- **No per-app granular roles/permissions** — exclusions are name-substring
  only, daemon-side.
- **No `GetExcludedApps`** — it does not exist in the daemon; the editor
  cannot be prefilled and each save replaces the daemon's whole user list
  (called out in the UI session note). If P2a later adds it, the note +
  `previewFocusDigest` flow are the two places to revisit.
- **No spec-sentinel support for `"no focus captured yet — click into a
  window once"`** — the daemon emits a different string; handled
  generically and honestly inline instead.
- **No availability bit in `GetStatus`** — consumed only via
  `GetFocusDigest` replies; the missing-key case (pre-P2a daemons) shows
  the same unavailable state, which is fail-closed but conflates "no a11y
  bus" with "old daemon". Distinguishing them needs a daemon-side signal
  this lane does not own.
- **No locale edits, no `SettingsWindow.qml`/nav change, no `build.rs`/
  `mod.rs` edits, no `MainShell.qml` change, no smoke run, no git writes.**
- **Workspace does not currently compile** (P2a's in-flight daemon code);
  the `-p airi-qt` gates all pass. A normal `cargo test --workspace`
  should be re-run once P2a stabilizes its `screen.rs` wiring.
