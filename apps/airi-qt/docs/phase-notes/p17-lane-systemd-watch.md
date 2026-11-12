# P4a1 — Lane `systemd-watch`: systemd1 unit-failure watch + wake/suspend facts

Wave P4a (system-bus reads, no helper). Daemon-side only. Additive-only edits
to `apps/airi-qt/crates/airi-daemon/**` plus this note. Nothing else in the
tree was touched by this lane (in particular not the Qt crate, locales,
packaging, `Cargo.toml`, or any dependency set — no new deps were added).

Status: implemented, tested, self-tested on this machine. One thing this lane
**cannot** verify, and does not claim to: a real `JobRemoved` fire on this
machine. See "Honest limits" and "What was not verified" below.

## What shipped

### 1. New source: `units` (systemd1 `JobRemoved`, system bus)

Match rule installed on the **system bus** (session bus is untouched — this is
a machine-scope signal):

```
type='signal',interface='org.freedesktop.systemd1.Manager',member='JobRemoved'
```

(`observe::systemd1::MATCH_RULE`; the `--selftest` probe prints it — see test
evidence below — and it is accepted by this machine's `dbus-broker`.)

`JobRemoved` carries `(id: u32, unit: s, jobType: s, result: s)` and is
emitted for **every** job systemd runs — starts, stops, reloads, timeouts,
dependency chains. The daemon is a read-only subscriber; it never calls
`StartUnit`/`StopUnit`/`ReloadUnit`/`ResetFailedUnit` or any other actuation
API, and it never will from this code path (actuation is L2/L3 territory,
always interactive polkit, P4b/P4c at the earliest).

**Filter semantics (deliberate):**

| `result` | Handling |
|---|---|
| `"done"` | **Counted, never audited.** Fed to the same per-unit 250 ms debounce as media/network/power (keyed `(unit, "units")`); inside the window it increments `rate_limited_drops` (surfaced once a minute in the aggregate `system`/`rate-limited` audit line); outside the window it is seen and nothing else. No ring event, no audit line, ever. |
| anything else (`failed`, `timeout`, `dependency`, `canceled`, `skipped`, …) | **Always lands**: ring event + audit line + `units_failed_since_wake` increment + `recent_failed_units` update. Debounce pressure never silences a failure. |
| malformed (wrong interface/member/type, missing or mistyped args, empty `unit` or empty `result`, not a signal) | Dropped silently (`None`). The daemon never guesses on bus input. |

Ring/audit event shape (audit tag = `units`):

```
source: units
event:  unit: <unit> failed (<result>)
detail: unit: <unit> failed (<result>)
```

**Redaction is applied uniformly.** Unit names and the `result` string pass
through the hand-rolled redactor (`crate::redact`) before they are formatted
into the event text — a unit name cannot hold a secret, but the rule "all bus
input is untrusted and redact before disk" holds with no exceptions. Ring
text is pre-redacted too (the ring is in-memory only; the audit detail is
re-redacted unconditionally by `AuditLog::append` as a second rail). Example:
`sk-ant-secret.service` fails → ring/audit see `unit: *** failed (failed)`.

**`units` is a first-class source for the arm/pause/lockdown machine**, like
every other source — it is `Source::Units` in `state.rs`:

- `GetStatus.sources` gains `"units": true/false` (reflects the per-source
  armed flag, same semantics as the other six).
- `SetSource("units", false|true)` works today; unknown sources still fail
  closed with the documented error string (now listing `units`).
- Lockdown (screen lock / sleep) disarms it like the rest; wake/unlock
  re-arms it automatically **unless** the user kill-switch is set (user flag
  wins — unchanged precedence rule). Lockdown purges the ring (existing
  behavior, applies to unit events too).
- A **disarmed/paused/locked `units` source observes nothing and remembers
  nothing**: failures are dropped *before* ring/audit/counters (the only
  side effect left is the debounce-map timestamp update, which carries no
  content).

### 2. Wake/suspend facts for the morning briefing (additive GetStatus keys)

The loop now tracks, in memory only (`wake_facts::WakeFacts`):

- `last_suspend_ms` — epoch-ms of the last observed `PrepareForSleep(true)`;
- `last_wake_ms` — epoch-ms of the last observed `PrepareForSleep(false)`;
- `units_failed_since_wake` — raw count of failed `JobRemoved`s since the
  last wake;
- `recent_failed_units` — last 3 unit names that failed since the last wake,
  **newest first**, consecutive duplicates skipped (a unit failing 5× in a row
  occupies one slot), non-consecutive duplicates kept (`a, b, a` stays
  `[a, b, a]`), hard cap 3. The **counter is always raw** — the dedup applies
  only to the list.

**Reset rule: wake resets.** `PrepareForSleep(false)` zeroes
`units_failed_since_wake` and clears `recent_failed_units`.
`PrepareForSleep(true)` records `last_suspend_ms` and resets **nothing** —
"since the last wake" is the one honest window; sleep itself carries no
failure signal worth windowing. (An intermediate design resetting on suspend
was considered and dropped: a failure that happens at 03:00 while you are
asleep still happened "since you left" only if you last left by waking — and
failures during a sleep window are exactly what the briefing wants *kept*,
which is also why `units_failed_since_wake` accumulates across arbitrary
uptime until the next wake.) Wake facts are recorded **even while the user
kill switch is set or the daemon is in lockdown** — they are facts about the
machine, not about the lock state; a user-paused wake is still a wake.

**GetStatus JSON — additive keys, protocol stays 1.** Key set after this
change (serde_json emits keys sorted; order is not contractual):

```json
{
  "protocol": 1,
  "version": "0.1.0",
  "paused": false,
  "sources": { "sleep": true, "lock": true, "media": true, "network": true, "power": true, "screen": true, "units": true },
  "ring_count": 0,
  "audit_path": "/home/vi/.local/share/airi-qt/audit/awareness-audit.jsonl",
  "session_bus": true,
  "system_bus": true,
  "audit_pruned": 0,
  "paused_by": "",
  "last_suspend_ms": 0,
  "last_wake_ms": 0,
  "units_failed_since_wake": 0,
  "recent_failed_units": []
}
```

Zero values are meaningful and must be rendered as such: `0` = "never
observed since daemon start", `[]` = "no failures since wake". There is no
persisted state anywhere in the wake/suspend facts — **a daemon restart
resets all four facts to 0/[]**, and we say so to the UI rather than faking
continuity.

Putting failures, sleep, and wake in one timeline:

```
wake(1000)  → fail(a) fail(b)  → suspend(5000)   → fail(c) [lockdown: not counted]  → wake(9000): counter=0, list=[]
wake(1000)  → fail(a) fail(a) fail(b) → (no sleep) → counter=3, list=[b, a]
```

(The `fail(c) [not counted]` step reflects the arm/pause/lockdown gate, not a
`WakeFacts` property; at the `WakeFacts` level only `on_wake` resets.)

### 3. Plumbing notes

- `observe::systemd1` bypasses `observe::parse_signal` by design — `JobRemoved`
  is outcome-bearing (done vs. failure), not a plain metadata verb, so
  `handle_message` intercepts it on the system-bus path before the generic
  dispatch and routes it to `handle_unit_job`.
- `--selftest` now prints the `units` match-rule line (system-bus section)
  and probes `org.freedesktop.systemd1` ownership alongside login1/NM/UPower.
  Selftest still exits 0 regardless of rule-add outcome.
- The `system`/`rate-limited` aggregate audit line now reads "debounced
  change signals" (successful jobs join the same counter).
- No new dependencies; clippy clean with `-D warnings` (and `--all-targets`).

## Lockdown / pause interplay (exact behavior)

| State | `units` failure observed | Ring/audit | Counters |
|---|---|---|---|
| armed (default) | yes | written | `units_failed_since_wake += 1`, list updated |
| `SetSource("units", false)` | dropped pre-recording | — | — |
| `Pause(true)` (kill switch) | dropped pre-recording | — | — |
| lockdown (lock/sleep) | dropped pre-recording | — | — |
| wake while user-paused | dropped pre-recording, **but** `last_wake_ms` is recorded and counters/list are cleared | — | reset at wake |
| unlock/wake with no user pause | re-armed automatically | — | as armed |

`done` jobs are never ring/audited in any state (counting via the debounce
map happens regardless of gates — a timestamp, nothing more).

## Test evidence (this machine, 2026-11-12)

Baseline before the change: `cargo test -p airi-daemon` → **51 passed**.

After the change:

```
cargo test -p airi-daemon      → 63 passed (51 baseline + 12 new), 0 failed
cargo clippy -p airi-daemon --all-targets -- -D warnings   → clean
cargo clippy -p airi-daemon -- -D warnings                 → clean
cargo fmt -p airi-daemon -- --check                        → clean
```

New tests:

- `observe::systemd1` (5): failure → `UnitJob::Failed` + event text;
  `done` → countable, `event_text() == None`; all non-`done` results are
  failures; malformed (wrong interface/member, missing arg, empty unit/result,
  non-signal) → dropped; redactor applied uniformly (`sk-ant-secret.service`
  → `***`).
- `wake_facts` (5): zeroed start; synthesized sleep→fail→suspend→wake
  sequence (reset at wake, suspend is not a reset point); raw counter vs.
  deduped list; cap-3 newest-first; consecutive-dedup vs. non-consecutive
  duplicates.
- `state` (1): `units` arm/disarm/lockdown/unlock/pause/kill-switch
  precedence, mirroring `unlock_rearm_respects_explicit_user_pause`.
- `control` (1+): GetStatus reports the four new keys (zeroed defaults and
  verbatim after a wake + 2 failures); protocol assertion stays `1`;
  `sources.units` present.

`--selftest` on this machine (exit 0):

```
system bus: present
  [ok] match rule (sleep): type='signal',interface='org.freedesktop.login1.Manager',member='PrepareForSleep'
  [ok] match rule (network): type='signal',interface='org.freedesktop.DBus.Properties',member='PropertiesChanged',sender='org.freedesktop.NetworkManager',arg0='org.freedesktop.NetworkManager'
  [ok] match rule (power): type='signal',interface='org.freedesktop.DBus.Properties',member='PropertiesChanged',sender='org.freedesktop.UPower',arg0='org.freedesktop.UPower'
  [ok] match rule (units): type='signal',interface='org.freedesktop.systemd1.Manager',member='JobRemoved'
  [info] system name owned: org.freedesktop.systemd1
```

So: the units match rule **is accepted by this machine's bus**, and systemd1
is present and owned. (Session bus and a11y also probe `[ok]`; unchanged.)

## What was not verified — honestly

- **No real `JobRemoved` was observed or injected in this lane.** Exercising
  one would require starting/stopping/reloading a real unit
  (`systemctl stop nginx.service`-class actions). That was explicitly out of
  scope and was not approved, and this lane did not do it. The parser is
  verified against synthesized messages byte-identical in shape to what
  systemd emits (`new_signal` + `(u32, s, s, s)` append), and the match rule
  is verified accepted by the live bus via `--selftest`; the end-to-end
  "a real failed unit lands in the ring+audit" path is **not** observed
  working on this machine yet.
- JobRemoved fires **once per job**; a failing boot target or a dependency
  chain can produce several `failed` fires for one logical incident.
  `units_failed_since_wake` counts raw fires (documented, deliberate — faking
  incident-grouping would be worse); the display list dedups consecutive
  repeats and caps at 3.
- The `done` count for a single lone success between debounce windows leaves
  no trace anywhere except the debounce map timestamp (by design). Storms of
  `done` are visible only in the once-a-minute aggregate
  `system`/`rate-limited` audit line.
- In-memory only, restart resets — already stated, repeated because the UI
  must not render stale "since wake" numbers as if they survived a restart.
- systemd may be absent (containers, minimal images): the selftest and the
  daemon degrade honestly — rule-add failure would mark `units` unavailable
  at startup, exactly like the other system-bus sources. On this machine it
  does not apply (rule `[ok]`).
- Ring/audit are local files; the audit log prunes to 7 days at startup.
  Unit-failure audit lines are subject to the same retention.

## Handoff for the Qt lane (P4a pair)

1. **GetStatus grew four keys; protocol is still 1.** No re-handshake, no
   schema file, no version bump negotiation. If the Qt bridge parses
   GetStatus into a strict whitelist of keys, add the four; if it passes the
   JSON through opaquely, do nothing.
   - `last_suspend_ms: u64` — `0` = never observed since daemon start
   - `last_wake_ms: u64` — `0` = never observed
   - `units_failed_since_wake: u64` — raw failure-job count since last wake; `0` = none (or unknown due to restart)
   - `recent_failed_units: [string]` — newest first, ≤ 3, consecutive-dup-skipped; `[]` = none (or restart)
   - `sources` map now carries `"units"` — same `SetSource("units", bool)` / GetStatus-`sources` path as the other six; the Settings → Awareness toggle can be wired to it like its siblings.
2. **Render zeros as unknowns, not as facts.** `last_wake_ms == 0` means "we have not seen a wake since start", not "the machine never slept". A briefing card should say "no data (daemon restarted)" rather than "0 failures" in that case.
3. **Morning briefing composition** (the P4a exit criterion this feeds):
   `last_wake_ms` / `last_suspend_ms` bound the window;
   `units_failed_since_wake > 0` ⇒ show "N unit failure(s) since your last
   wake: <recent_failed_units joined>"; otherwise the section can stay
   silent. The counter counts jobs, not incidents — copy should say
   "unit job(s)" or just "failure(s)", not "N outages".
4. **Audit viewer**: unit-failure lines appear as source `units`, event
   `unit: <name> failed (<result>)` — they need no special renderer; if the
   viewer wants a glyph/tint, key off `source == "units"`.
5. **Pause/lockdown honesty**: if the user opens the awareness page while
   locked/paused, `sources.units` shows the per-source armed flag, which may
   be `true` while `paused`/`paused_by` disarm everything — render exactly
   like the other sources (armed flag vs. effective state are deliberately
   different axes).
6. **Not available to the UI**: any start/stop/restart of units (by design —
   read-only lane; L2/L3 will get its own lane and polkit surface), and any
   cross-session view of failures beyond 7 days (audit retention).
7. The daemon-side redactor mangles token-shaped unit names (`***`); the UI
   must be able to display `***` in a unit name without crashing or assuming
   a valid unit-name charset. Unit icons/lookup by unit name will fail on
   such names — degrade silently.
8. Companion edit in the tree, if any, is the Qt lane's own
   (`crates/airi-qt/src/bridges/daemon.rs` shows ~385 lines of uncommitted
   work-in-progress by that lane at the time of writing; this lane did not
   read, edit, or merge it).

## Files touched (all in-lane)

- `crates/airi-daemon/src/observe/systemd1.rs` (new)
- `crates/airi-daemon/src/wake_facts.rs` (new)
- `crates/airi-daemon/src/observe/mod.rs` (registry + doc note)
- `crates/airi-daemon/src/state.rs` (`Source::Units`, `armed[7]`, mirror test)
- `crates/airi-daemon/src/control.rs` (`StatusContext.wake`, additive JSON keys, error-string source list, tests)
- `crates/airi-daemon/src/main.rs` (loop wiring, `handle_unit_job`, LoopCtx, selftest probe list, doc header)
- `docs/phase-notes/p17-lane-systemd-watch.md` (this file)
