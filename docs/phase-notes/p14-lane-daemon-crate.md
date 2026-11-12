<!-- SPDX-License-Identifier: GPL-3.0-or-later -->
# P14 Lane Daemon — user-session awareness daemon crate (wave P1, part 1 of 2)

Lane P1a of wave P1. Scope (exclusive): `crates/airi-daemon/**` (new crate),
`apps/airi-qt/packaging/systemd/airi-daemon.service` (new),
`apps/airi-qt/packaging/dbus/org.moeru.airi.Daemon1.service` (new),
`apps/airi-qt/packaging/README.md` (appended section only), this note (new).
Nothing else touched. No git writes. No new dependencies — workspace
`dbus`, `dirs`, `serde`, `serde_json` only (hand-rolled redactor, hand-rolled
arg parsing, no regex/tokio). Not wired into the Qt app — P1b builds the
face; central adds the workspace member line.

Read first (all honored): `p12-system-embedding-research.md` §A.2 (user-session
posture, single instance, Restart=on-failure + 2s/burst 5, Type=dbus BusName
preference, protocol versioning), §B.2–B.6 (the eyes; PropertiesChanged arg0
discipline; B5 monitor mode rejected), §E (packaging), §F (rails — all
mandatory, all implemented), §H (P1 row).

## What shipped

```
crates/airi-daemon/
  Cargo.toml            bin name airi-daemon; deps: dbus, dirs, serde, serde_json (workspace)
  src/main.rs           arg parse (default run / --foreground / --selftest / --version / --help),
                        single-threaded poll loop over session+system buses, match-rule install,
                        signal dispatch, 250 ms property-bag debounce, rate-limit audit flush
  src/redact.rs         hand-rolled credential redactor (no regex)
  src/ring.rs           in-memory ring, cap 200, oldest evicted
  src/audit.rs          audit JSONL writer + 7-day prune-on-start (clock injectable for tests)
  src/state.rs          Awareness machine: per-source armed flags, user pause (kill switch),
                        lockdown flag — pure logic, fully unit-tested
  src/observe/mod.rs    registry: bus routing + exact match-rule table
  src/observe/mpris.rs  source 1 (session)
  src/observe/screensaver.rs  source 2 (session, 3 rules installed opportunistically)
  src/observe/logind.rs source 3 (system)
  src/observe/network.rs source 4 (system)
  src/observe/upower.rs source 5 (system)
  src/control.rs        org.moeru.airi.Daemon1 interface (GetStatus / SetSource / Pause);
                        pure ControlOutcome dispatch, bus-side Message wrapper thin
```

Packaging (new, not built by `build-deb.sh`, per spec):

```
packaging/systemd/airi-daemon.service
packaging/dbus/org.moeru.airi.Daemon1.service
packaging/README.md                       (appended "## Dev-run airi-daemon" only)
```

## The five observers — exact match rules

| # | Source (tag) | Bus | Match rule |
|---|---|---|---|
| 1 | MPRIS playback (`media`) | session | `type='signal',interface='org.freedesktop.DBus.Properties',member='PropertiesChanged',arg0='org.mpris.MediaPlayer2.Player'` |
| 2 | Screen-lock (`lock`) | session | `type='signal',interface='org.freedesktop.ScreenSaver',member='ActiveChanged'` **and** `type='signal',interface='org.gnome.ScreenSaver',member='ActiveChanged'`; KDE: `type='signal',interface='org.kde.ScreenSaver',member='ActiveChanged'` (opportunistic) |
| 2′ | — KDE | session | rule above; this machine reports `org.freedesktop.ScreenSaver` owned, GNOME/KDE not owned (see selftest below) |
| 3 | logind prepare-for-sleep (`sleep`) | system | `type='signal',interface='org.freedesktop.login1.Manager',member='PrepareForSleep'` |
| 4 | NetworkManager state (`network`) | system | `type='signal',interface='org.freedesktop.DBus.Properties',member='PropertiesChanged',sender='org.freedesktop.NetworkManager',arg0='org.freedesktop.NetworkManager'` |
| 5 | UPower on-battery (`power`) | system | `type='signal',interface='org.freedesktop.DBus.Properties',member='PropertiesChanged',sender='org.freedesktop.UPower',arg0='org.freedesktop.UPower'` |

Behavior per source:

1. **MPRIS** — parses `PropertiesChanged(arg0, arg1=a{sv}, arg2)`; reads
   `PlaybackStatus` from the dict → `Playing|Paused|Stopped` → `media: <status>`.
   Non-standard values are kept truncated to 32 chars (honest, never guessed).
   Sender is *not* used (MPRIS players own per-player well-known names; the
   match rule portability story is arg0-only, per the spec and §B3). arg0 is
   re-verified locally in the parser. If the player is not MPRIS (wrong arg0)
   the signal is dropped.
2. **Screen-lock** — `ActiveChanged(b)`; freedesktop + GNOME rules both
   installed when the bus allows; KDE rule tried opportunistically and its
   result reported by `--selftest`. If a bus has neither, the source simply
   never fires — noted in the selftest/status, no crash. KDE is
   best-effort: a KDE session where `org.kde.ScreenSaver` owns the name
   works; one where only the freedesktop shim exists works via rule 2.
3. **logind** — `PrepareForSleep(b)`: true → `sleep: suspending` (drives
   lockdown + audit), false → `power: wake` (ends lockdown). Read-only.
4. **NM** — `State` (u32) from the arg0=`org.freedesktop.NetworkManager`
   property bag: `70` → `network: online`; anything else → `network: state <n>`.
   Unknown states are reported numerically, never mapped to guessed symbols.
   NM `StateChanged(u)` is *not* used (deprecated; the match rule above is
   the §B3-sanctioned pattern).
5. **UPower** — `OnBattery` (b): `power: on battery` / `power: on AC`.
   No lid handling: there is no portable lid signal; faking one would be
   dishonest. Not implemented.

Debounce: property-bag signals (media/network/power) are debounced 250 ms
per `(object path, source)`; drops are counted and flushed to the audit log
at most once per minute as `source=system, event=rate-limited` ("dropped N
debounced property-change signals"). Lock/logind signals are never debounced.

## Control interface — org.moeru.airi.Daemon1

Object path `/org/moeru/airi/Daemon1`, interface `org.moeru.airi.Daemon1`.
Well-known name requested on the session bus with `do_not_queue=true`;
failure → clear stderr message + `exit(1)` (systemd `Restart=on-failure`
handles bounded retries; standalone dev runs fail loudly). A second
concurrent instance exits(1) with `could not own ... (reply: Exists)` —
verified live (see below).

```
GetStatus() -> s
  JSON: {protocol: 1, version: "0.1.0", paused: bool,
         sources: {sleep: bool, lock: bool, media: bool, network: bool, power: bool},
         ring_count: u64, audit_path: string, session_bus: bool, system_bus: bool,
         audit_pruned: u64, paused_by: string}

SetSource(source: s, enabled: b) -> s
  JSON: {ok: bool} | {ok: false, error: string}
  Flips the per-source armed flag live. Unknown source →
  {ok: false, error: "unknown source '<x>' (expected one of: sleep, lock, media, network, power)"}

Pause(p: b)            (no output arguments)
  p=true  → kill switch: disarm all observers, purge the in-memory ring,
            audit "awareness: paused (kill switch)" (source=system)
  p=false → resume: audit "awareness: resumed"
```

`protocol` is 1 (additive changes keep it; a breaking change renames the
interface — §A.2). Clients feature-detect via Introspectable, not by parsing
`version`.

`paused` = user kill switch **or** lockdown. `paused_by` = `"user"` |
`"lockdown"` | `""`; when both are set the user wins the label — same
precedence as the re-arm rule below.

`audit_pruned` = lines dropped by this run's startup prune (not a cumulative
counter). `sources` shows the per-source `armed` flag the user toggled —
not the effective state; the effective veto is carried by `paused`/`paused_by`.
`ring_count` = current ring length (monotonic-ish gauge, cap 200).
`session_bus`/`system_bus` report the last known connection state; on a
mid-run disconnect they flip to false and stay false until a process restart
(see Honest limits).

## Audit & redaction

- Path: `<data_dir>/airi-qt/audit/awareness-audit.jsonl`
  (default `~/.local/share/airi-qt/audit/awareness-audit.jsonl`). No file
  writes happen anywhere else at runtime (audit-dir creation + append +
  startup prune; unit `ReadWritePaths` enforces the same boundary).
- Format: one JSON object per line:
  `{"ts_ms": u64, "source": "system|sleep|lock|media|network|power", "event": string, "detail": string}`.
- Retention **7 days, hardcoded** (`RETENTION_MS` in `src/audit.rs`);
  prune-on-start drops aged lines, rewrites via tmp+rename inside the audit
  dir, and preserves unageable lines (malformed JSON, missing/non-numeric
  `ts_ms`, future timestamps) untouched. First run (file absent) prunes
  nothing.
- Every detail string passes the hand-rolled redactor **inside
  `AuditLog::append`** before bytes hit disk — call sites cannot bypass it.
- The redactor matches (case-insensitive, left boundary must be start-of-
  string or a non-alphanumeric byte — keeps `disk-3` clean):
  `Bearer `, `Basic `, `token=`, `api_key`, `sk-`, `sk-ant-`, `ghp_`,
  `gho_`, `github_pat_`, `xoxb-`, `xoxp-`, `AIza`, `ya29.`, `gsk_`.
  Token extent = maximal run of `[A-Za-z0-9-._~+/=]` after the pattern;
  everything is replaced with `***`. A clean string passes byte-identical
  (asserted by tests). 15 pattern tests + boundary/mixed/adjacent cases.
- Events are **metadata verbs only** (`media: Playing`, `network: state 60`);
  raw property payloads (track titles, battery %, IPs) never enter a line.
- `audit_pruned` is reported in GetStatus. All arm/disarm/kill-switch/
  lockdown transitions are audited; disarmed-drops are *not* audited per
  event (would spam), only the 60-second rate-limited counter row is.

## Ring buffer

In-memory only, cap **200**, oldest evicted (`Ring::push`). Never persisted,
never sent anywhere. Purged completely on screen-lock/sleep lockdown and on
kill switch (`Pause(true)`). Nothing else reads it yet — P1b may drain it
over the bus or not; the D-Bus surface exposes no ring contents this wave.

## The paused-vs-lockdown precedence rule (exactly as shipped)

Three independent switches, evaluated in one place (`src/state.rs`):

1. per-source `armed` flags — set ONLY by `SetSource`;
2. `user_paused` — set ONLY by `Pause` (the kill switch);
3. `lockdown` — set by lock (Lock) or PrepareForSleep(true) (Sleep);
   cleared by Unlock / PrepareForSleep(false).

Effective armed = `armed[source] && !user_paused && !lockdown`.

- Unlock/wake **re-arms T0 sources automatically only when the user has not
  explicitly paused**. If `user_paused`, unlock/wake clears the lockdown flag
  but sensors stay disarmed — **the user flag always wins**.
- A per-source `armed=false` survives pause/lockdown cycles (unlock re-arm
  never resurrects a source the user toggled off).
- `paused` in GetStatus = `user_paused || lockdown`; `paused_by` reports
  `user` when the user flag is set (even if lockdown is also active),
  else `lockdown`, else `""`.
- Lock/sleep **trigger** signals are processed even during pause/lockdown
  (they are the re-arm hinge) and their events bypass the disarmed-drop
  filter — they are the audit evidence for the disarm itself. Every other
  event respects the drop.

## Packaging — systemd unit: choice and reasons

`packaging/systemd/airi-daemon.service`:

```ini
[Unit]
Description=AIRI awareness daemon (user session)
After=graphical-session.target
PartOf=graphical-session.target
StartLimitBurst=5
StartLimitIntervalSec=60

[Service]
Type=dbus
BusName=org.moeru.airi.Daemon1
ExecStart=%h/.local/bin/airi-daemon
Restart=on-failure
RestartSec=2
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=read-only
ReadWritePaths=%h/.local/share/airi-qt/audit
ProtectKernelTunables=true
ProtectKernelModules=true
ProtectControlGroups=true
RestrictAddressFamilies=AF_UNIX
LockPersonality=true
RestrictRealtime=true
MemoryMax=64M
CPUQuota=25%

[Install]
WantedBy=graphical-session.target
```

`StartLimitBurst`/`StartLimitIntervalSec` live in `[Unit]`, not `[Service]`:
`systemd-analyze --user verify` on this machine reported them as
`Unknown key ... in section [Service], ignoring` (systemd would silently
have had no circuit breaker). With them in `[Unit]` the verify output is
clean except for the expected "Command … is not executable" until the
binary is installed to `~/.local/bin`.

Reasons, decision by decision:

- **`Type=dbus` + `BusName=`** (§A.2 preference): systemd starts the daemon
  when something asks for the name — zero login cost; D-Bus activation
  dedups concurrent first-requests; systemd additionally refuses a second
  unit instance with the same BusName. We keep `Restart=on-failure` for
  crashes (it cannot resurrect a lost-name zombie — see Honest limits).
- **`WantedBy=graphical-session.target`** + `PartOf=`: dies with the
  session, starts with it — correct for a session companion; no linger.
- **`ProtectSystem=strict`**: system tree read-only; the daemon never writes
  outside its audit dir.
- **`ProtectHome=read-only`** + **`ReadWritePaths=%h/.local/share/airi-qt/audit`**:
  the audit log lives in the home directory, so `ProtectHome=inaccessible`
  or `tmpfs` are off the table (`tmpfs` would also mask the real home and
  break `dirs::data_dir()` resolution against the audit path). read-only
  home with one narrow RW exception is the tightest posture that works.
  `ProtectHome=yes` (== read-only) is equivalent; `no`/`false` was rejected
  as broader than needed.
- **`RestrictAddressFamilies=AF_UNIX`**: enforcement-level guarantee of the
  "no network, ever" rail — even a future bug cannot open a socket.
- **NoNewPrivileges, PrivateTmp, LockPersonality, RestrictRealtime,
  ProtectKernel{Tunables,Modules,ControlGroups}**: standard cheap hardening;
  daemon needs none of these.
- **MemoryMax=64M, CPUQuota=25%**: metadata verbs + 200-event ring; generous
  yet bounded.
- D-Bus activation file
  (`packaging/dbus/org.moeru.airi.Daemon1.service`): minimal
  `Name=`/`Exec=`, per the P1 spec. `SystemdService=airi-daemon.service`
  would route activation through the user unit (and its Restart= policy);
  deliberately **not** added — spec asked for the minimal pair; adding it
  later is a one-line, backwards-compatible change (noted in the file
  header and packaging README).

## Verification (actually run)

| Check | Result |
|---|---|
| `cargo test -p airi-daemon` | **43 passed**, 0 failed |
| `cargo clippy -p airi-daemon --all-targets -- -D warnings` | clean |
| `cargo fmt -p airi-daemon -- --check` | clean |
| `--selftest` (this machine, session+system buses present) | all 7 match rules `[ok]`; see verbatim output below |
| Live smoke: run → GetStatus → SetSource(media,false) → SetSource(teleport) → Pause(true) → Pause(false) | all correct; audit lines verified on disk; second instance exits(1) |
| Kill-switch ring purge | confirmed: pause → `GetStatus` returns `ring_count: 0`, audit line says "ring purged" |
| `systemd-analyze --user verify` (unit file) | clean except expected "not executable" until install; StartLimit* moved to `[Unit]` accordingly |

`--selftest` verbatim (this machine; buses present; nothing claimed on the
bus, exits 0):

```
airi-daemon 0.1.0 (protocol 1) — selftest (claims no bus name; exits 0)
session bus: present
  [ok] match rule (media): type='signal',interface='org.freedesktop.DBus.Properties',member='PropertiesChanged',arg0='org.mpris.MediaPlayer2.Player'
  [ok] match rule (lock): type='signal',interface='org.freedesktop.ScreenSaver',member='ActiveChanged'
  [ok] match rule (lock): type='signal',interface='org.gnome.ScreenSaver',member='ActiveChanged'
  [ok] match rule (lock): type='signal',interface='org.kde.ScreenSaver',member='ActiveChanged'
  [info] screen-saver name owned on session bus: org.freedesktop.ScreenSaver
  [info] screen-saver name not owned: org.gnome.ScreenSaver
  [info] screen-saver name not owned: org.kde.ScreenSaver

system bus: present
  [ok] match rule (sleep): type='signal',interface='org.freedesktop.login1.Manager',member='PrepareForSleep'
  [ok] match rule (network): type='signal',interface='org.freedesktop.DBus.Properties',member='PropertiesChanged',sender='org.freedesktop.NetworkManager',arg0='org.freedesktop.NetworkManager'
  [ok] match rule (power): type='signal',interface='org.freedesktop.DBus.Properties',member='PropertiesChanged',sender='org.freedesktop.UPower',arg0='org.freedesktop.UPower'
  [info] system name owned: org.freedesktop.login1
  [info] system name owned: org.freedesktop.NetworkManager
  [info] system name owned: org.freedesktop.UPower

audit path: /home/vi/.local/share/airi-qt/audit/awareness-audit.jsonl
interface: org.moeru.airi.Daemon1
selftest done (no name claimed, no state changed)
```

This machine has a real session bus (user logged into a KDE-ish/X11 seat with
`org.freedesktop.ScreenSaver` provided by the DE) and a system bus with
logind/NM/UPower — so "honestly absent" cases did **not** trigger here; the
code path for them (`session bus: ABSENT` / `system bus: ABSENT` branches)
is written and reported, just not exercised by this host.

Important for reproducibility: `cargo test`/`clippy`/`fmt` were run against a
**temporarily added** `"crates/airi-daemon",` member line in the workspace
`Cargo.toml` (central owns that edit and will add it themselves — see next
section). After verification the file was restored **byte-identical**
(`sha256 848d5ecb19e9168a6e4867a071df3fad4b95097264bc9483c6ef4b5ef7ce2ebc`
before and after; verified with `cmp`). The `Cargo.lock` entry that cargo
auto-added (one `[[package]] airi-daemon` stanza) was also removed, leaving
`git status` exactly as P1b had it (`M crates/airi-qt/src/bridges/desktop.rs`,
`M qml/shell/MainShell.qml`, `?? crates/airi-daemon/`, P1b's
`daemon.rs` + `awareness/`). The full airi-qt workspace gate was **not
run** — central owns it after P1b.

## Central steps (required before anything builds)

1. Add `"crates/airi-daemon",` to `members` in `apps/airi-qt/Cargo.toml`
   (after `crates/airi-discord`), as already planned. `cargo build -p airi-daemon`
   re-adds the `Cargo.lock` stanza automatically.
2. Nothing else — no new deps, no feature flags, no `.desktop` changes
   (the daemon is not part of the deb this wave).
3. After P1b lands, the central gate can call GetStatus over the user bus
   to smoke-test the face ↔ daemon link.

## Honest limits

- **systemd install not executed** — the unit + activation file are
  deliverables, not deployed artifacts. `systemctl --user start` of an
  installed copy was not performed on this machine (and must not be done
  silently); `--selftest` + live smoke are the verification story.
- **MPRIS arg0-only filtering** — the match rule portability story is arg0
  (per-player unique names can't be matched portably); other apps'
  `PropertiesChanged` chatter for the MPRIS *interface* arrives but is
  parsed-and-dropped locally. Spoofed senders can claim org.mpris.* —
  irrelevant, signals never authorize anything.
- **KDE lock path is best-effort** — `org.kde.ScreenSaver` rule is tried and
  its absence is reported, never fatal. If a KDE build owns neither
  `org.kde.ScreenSaver` nor `org.freedesktop.ScreenSaver`, lock detection
  simply doesn't fire (the sleep rail still locks down).
- **UPower has no lid event** — not implemented, on purpose; asking would be
  having a screen-dimmed-machine sign or nothing.
- **NM state reporting is numeric** — `network: state <n>` for anything ≠70;
  symbol mapping lives in P1b if the UI wants it.
- **Retention hardcoded to 7 days** — no setting this wave.
- **No in-process bus reconnect** — on session/system bus disconnect the
  daemon logs, marks that bus's `session_bus`/`system_bus` false in
  GetStatus, keeps running (never panics), and drops events from that bus
  permanently until process restart. The `Type=dbus` unit cannot restart a
  "running but dead-name" daemon; `Restart=on-failure` covers crashes only.
  If the session bus dies, the right recovery is `systemctl --user restart
  airi-daemon` — P1b should surface "companion core offline — restart?"
  exactly as the §A.2 circuit breaker describes.
- **Lockdown triggers bypass the disarmed-drop filter** (by design — they
  are the re-arm hinge and the audit evidence); every *other* event honors
  pause/lockdown drops.
- **Trigger events are always recorded** (recorded to ring + audit even
  mid-lockdown). The kill switch (Pause) does not get this exemption — it
  purges the ring and drops everything.
- **`--selftest` result is this machine's truth**, not a universal promise:
  on a host with no session bus it prints `session bus: ABSENT (...)`,
  lists the match rules as not attempted, and exits 0. Run-mode on such a
  host exits(1) with a clear stderr message (name can't be owned).
- **Abort-safety in control replies** — unit tests never build a
  `method_return` from unserialized messages (libdbus asserts a reply
  serial); the `ControlOutcome` enum carries the pure decision and
  `handle_method_call` is the only place a `Message` reply is constructed.
  Bus-constructed calls always carry a serial on the wire, so production
  replies are safe.
- **Debounce is silent until the minute-flush** — the 250 ms drop counter
  aggregates into one `rate-limited` audit row per minute; it is not
  surfaced in GetStatus.
- **`SetSource` is not sticky across kill switch** — pause does not touch
  per-source flags; unpausing restores the user's toggles, not "everything".
- **Audit file is append-only and user-deletable** — "forget everything"
  UX is P1b/Settings territory; the daemon offers no delete RPC this wave.
- **Spoofing** — all signals are parsed metadata verbs; nothing in a signal
  is ever used for an authorization decision (there are no actions at all
  this wave; T2/HITL is untouched).

## Handoff ledger

- Owning files only, per lane charter; nothing else edited.
- Ambient pre-existing changes (not mine): `crates/airi-qt/src/bridges/desktop.rs`,
  `qml/shell/MainShell.qml`, `crates/airi-qt/src/bridges/daemon.rs`,
  `qml/pages/settings/modules/awareness/` (P1b's lane).
- Not run: full airi-qt workspace gate, `build-deb.sh`, any systemctl command,
  any push/commit.
