# Design: user presence as a single source of truth

Status: implemented on `feat/agentic-os-companion-nap-chat`.
Related: `docs/design-agentic-os.md` (Agentic OS cycle), `docs/design-agentic-os-nap-chat.md`
(nap/chat feature built on top of this), `docs/rosetta-stone.md` (heartbeat / dream-state
semantics).

## 1. Why this exists

"Is the user here?" was answered four different ways in four places:

1. `apps/stage-tamagotchi/src/main/services/sensors/index.ts:292` —
   `powerMonitor.getSystemIdleTime()`, pushed to the renderer over eventa.
2. `packages/stage-ui/src/stores/proactivity.ts:110` — a raw `idleTimeSec` ref, refreshed
   every 10 s on the proactivity sensor loop (`:256`), plus `refreshIdleTimeOnly` (`:1067`).
3. `packages/stage-ui/src/stores/presence.ts` — derives an `active` / `idle` / `away`
   snapshot from that ref, but does not own it.
4. `packages/stage-ui/src/stores/proactivity.ts:429` — Dream State computes its own
   `(config.afkThresholdMinutes || 5) * 60` inline and reads the raw ref directly, bypassing
   the derived layer entirely.

The heartbeat's AFK gate lived in `proactivity-telemetry.ts:38` as a pure function, so the
"AFK" decision was duplicated three ways — Dream State on its own required
`afkThresholdMinutes` field, heartbeats on their own optional one, and the derived presence
state nobody consumed. Two of those copies read the raw signal directly. Adding a new
signal — a real lock/sleep contract, in-app mouse/keyboard, global native hooks — meant
editing each of those four places.

What centralisation must **not** do is collapse those two config fields into one: they are
genuinely different knobs, and a companion may legitimately want heartbeats every minute and
consolidation only after fifteen. §2 and §6 keep the signal shared and the thresholds
per-feature.

## 2. The canonical model

```
     ┌────────────────────────── raw OS / platform signals ──────────────────────────┐
     │  OS idle seconds (sensorsGetIdleTime)   lock   sleep   in-app mouse/keyboard   │
     └────────────────────────────────────┬──────────────────────────────────────────┘
                                          ▼
                        PresenceSignalProvider.read*()  (pluggable, see §4)
                                          │
                                          ▼
    presence store: rawIdleTimeSec   ← exactly ONE writer of the raw idle value
                                          │
                       watch([rawIdleTimeSec, afkThresholdMinutes, lockSignal, sleepSignal])
                                          ▼
                       recompute() → derivePresenceState() → presence snapshot
                                          ▼
                    ┌─────────────────────┼─────────────────────┐
                    ▼                     ▼                     ▼
            presenceState          isUserAway(minutes?)      resolved thresholds
          (active/idle/away)       (parameterized AFK)      (afkThresholdMinutes …)
                                          │
                          ┌───────────────┴───────────────┐
                          ▼                               ▼
                 heartbeat's own field          dreamState's own field
                 (optional, default 5)          (required, no default)
```

The model is three layers, and the boundary between them matters:

- **Raw signal layer.** One number: seconds of OS-level input idle. Written by exactly one
  place — the provider read path inside the presence store (§3).
- **Normalized presence layer.** `derivePresenceState(input)` turns raw signals plus
  resolved thresholds into `{ state, reason }`. It is a pure function and takes its
  thresholds as arguments, so it never reads config itself and stays unit-testable.
- **Consumer layer.** A snapshot (`presence.presenceState`, plus `afk` / `isUserAway()`)
  that carries everything any consumer needs. There is no reason for a consumer to read
  the raw ref, and none does after this refactor.

### Thresholds

Three numbers, all resolved in one place and exposed together:

| Constant | Value | Source |
| --- | --- | --- |
| `IDLE_THRESHOLD_MINUTES` | 2 | `presence.ts` — a policy constant, the pre-AFK "quiet input" floor |
| `AWAY_THRESHOLD_MINUTES` | 30 | `presence.ts` — a policy constant, the "unattended" floor |
| `DEFAULT_AFK_THRESHOLD_MINUTES` | 5 | fallback when a feature's own field is unset, zero or NaN |

`resolveAfkThresholdMinutes(cardExtensions)` resolves the per-companion override from
`heartbeats.afkThresholdMinutes`, clamping non-finite and non-positive values to the
5-minute default. Consumers read `presence.afkThresholdMinutes` rather than re-reading the
card.

**There are two separate AFK config fields, and they must stay separate.**
`heartbeats.afkThresholdMinutes` (`card.schema.ts:137`) is optional and drives presence's
own default. `dreamState.afkThresholdMinutes` (`card.schema.ts:146`) is *required*, and
Dream State gates on it. They are not redundant knobs — a companion can have heartbeats
every minute and consolidate only after fifteen. The canonical predicate is therefore
parameterizable:

```ts
presence.isUserAway() // presence's default (heartbeats' field)
presence.isUserAway(config.afkThresholdMinutes) // this feature's own field
```

`isUserAway(minutes)` applies the same `|| 5` fallback the old inline expression
`(config.afkThresholdMinutes || 5) * 60` used, so a feature that never set its own field
keeps the exact behavior it had. Both forms return `false` when no reading exists — an
unavailable probe must never assert the user is gone.

The AFK threshold is intentionally *not* used to derive the `away` state — see the NOTICE
in `presence.ts:19` and `docs/design-agentic-os.md:45`: `afkThresholdMinutes` is a
per-companion knob, so a long value must not widen the fixed 30-minute unattended floor.

### The AFK predicate

`presence.afk` is a derived boolean: true exactly when
`rawIdleTimeSec >= afkThresholdMinutes * 60` and a raw reading exists, where
`afkThresholdMinutes` resolves from `heartbeats.afkThresholdMinutes`. This is the
predicate the heartbeat's `pauseWhenAfk` gate consumes.

`isUserAway(thresholdMinutes?)` is the parameterizable form. With no argument it is
`afk`; with an argument it compares against the caller's own threshold. Both read the
same single raw signal — only the threshold differs:

- **Heartbeat** (`pauseWhenAfk`) → `presence.afkThresholdMinutes` / `presence.afk`,
  i.e. heartbeats' own field.
- **Dream State** (`strictAfkGating`) → `presence.isUserAway(config.afkThresholdMinutes)`,
  dream state's own required field.

Because both forms read the same raw signal, the two gates can no longer disagree about
*the reading* — only about the threshold each feature deliberately chose. The predicate is
*not* the same as `state === 'away'`: `away` is the 30-minute floor, AFK is the per-feature
threshold, and that distinction is the reason both exist.

## 3. Ownership and the single writer

Before this refactor there were two writers of the raw idle value:
`proactivity.idleTimeSec` (the sensor loop and `refreshIdleTimeOnly`) and
`presence.refreshIdleTimeOnce()` writing *into* `proactivity.idleTimeSec` across the store
boundary. Neither store could reason about the value's freshness without reading the other.

After:

- The presence store owns the raw signal (`rawIdleTimeSec`) and the only write path
  (`writeIdleTimeSec`). The proactivity sensor loop feeds it via that store's API rather
  than owning its own copy.
- `proactivity.idleTimeSec` remains exported as a read-only computed view of
  `presence.rawIdleTimeSec`, because `step-sensory.vue` and `formatSensorPayload` still
  consume the sensor telemetry.
- The proactivity store re-exports it for back-compat, but does not own the decision of
  what "idle" means.

Consumers that only need presence go through the presence store. Consumers that need the
sensor *payload* (window history, load, volume — the whole telemetry string) still use the
proactivity store; that is a different concern from presence and is deliberately left alone.

## 4. The pluggable signal interface

`PresenceSignalProvider` is declared in `packages/stage-shared/src/agentic.ts`, so the
contract is shared between the sensor contract file and the renderer store without the
renderer importing a concrete provider:

```ts
export interface PresenceSignalProvider {
  readonly id: string
  readIdleSec: () => number | undefined
  readLockState?: () => 'locked' | 'unlocked' | undefined
  readSleepState?: () => 'awake' | 'asleep' | undefined
}
```

`undefined` means "this provider cannot answer" — not "the user is active". The store holds
the last known value instead of silently resetting to `active`, which is why a browser build
(no Electron, no probe) does not flip presence on every recompute.

Exactly one provider is registered at runtime:

| Provider | Signals | Status |
| --- | --- | --- |
| `osIdleTime` | `readIdleSec` from `sensorsGetIdleTime` via `refreshIdleTimeOnce` | wired |
| in-app mouse/keyboard | `readIdleSec` from this window's input events | documented extension point, not wired — see below |
| global native input hook | `readIdleSec` from a main-process global hook | not wired |
| lock/sleep | `readLockState` / `readSleepState` from `powerMonitor` | not wired |

### Why only OS idle runs today

The OS idle counter is the only signal the repository can genuinely read. Lock and sleep
exist in the main process (`powerMonitor.on('lock-screen')` /
`powerMonitor.on('suspend')`, `apps/stage-tamagotchi/src/main/services/electron/window.ts`)
but are consumed locally to hide/restore windows and are never forwarded to the renderer, so
no invoke contract asks "is the screen locked?". The store therefore reports those states
`unavailable` in `PresenceStateAvailability` rather than synthesising them from idle time.
In-app input would only be right if it *also* covered the case where the window is
unfocused, which a window-scoped listener cannot tell apart from "the user is in another
app" — which is what the OS idle counter already answers correctly. So it is an extension
point, documented and tested, and not wired.

## 5. Adding a provider (the extension contract)

A future provider plugs in without any consumer changing, because consumers read the
snapshot, not the provider list:

```ts
const provider: PresenceSignalProvider = {
  id: 'global-native-input',
  readIdleSec: () => nativeIdleBridge.read(),
}
presenceStore.addSignalProvider(provider)   // recomputes and takes effect immediately
…
presenceStore.removeSignalProvider('global-native-input')  // back to OS idle, no consumer change
```

Resolution order when several providers are registered: the *largest* idle reading wins.
Larger means "longer quiet", which is the safe direction — a window-scoped listener that
stops reporting while the app is backgrounded must not make the companion think the user is
active when they are not. `screen-locked` and `sleep` are read from the first provider that
answers, and both outrank idle time in `derivePresenceState` regardless of providers.

Provider registration is the only store surface a new signal needs. Nothing in
`proactivity.ts`, `proactivity-telemetry.ts`, or any consumer is touched.

## 6. Consumers after the refactor

| Consumer | Before | After |
| --- | --- | --- |
| Heartbeat AFK gate (`proactivity.ts:587`) | `evaluateHeartbeatGating({ afkThresholdMinutes: config?.afkThresholdMinutes ?? 5, currentIdleSec: idleTimeSec.value ?? 0 })` | same pure call; the threshold comes from `presence.afkThresholdMinutes` (resolved via `resolveAfkThresholdMinutes`, same clamp) and the idle value from the presence store's single raw signal |
| Dream State gate (`proactivity.ts:443`) | inline `(config.afkThresholdMinutes || 5) * 60` — reading **dreamState's own** field — compared against the raw ref | `presence.isUserAway(config.afkThresholdMinutes)`: same threshold field, same `|| 5` fallback, same strict `>=` sign, same raw signal. Dream state keeps its own threshold rather than inheriting heartbeats' |
| Agentic OS gate (`agentic.ts:320`) | `presence.presenceState` | unchanged — already the derived snapshot |
| Screen watcher AFK gate (`modules/screen-watcher.ts:391`) | its own `afkLimitMinutes` chain plus `proactivityStore.refreshIdleTimeOnly()` | unchanged in this refactor; it is the screen-watcher's own config, and centralising it is a follow-up (see §8). Its `proactivityStore.idleTimeSec` read and `refreshIdleTimeOnly()` now flow through the presence store, so it still sees the same reading |
| `proactivity.refreshIdleTimeOnly` | second writer path | delegates to `presence.refreshIdleTimeOnce()`; the provider path is the only writer |

`evaluateHeartbeatGating` itself is unchanged and still pure — it is the one gate that
already had a testable shape, and this refactor routes *inputs* to it through the canonical
source rather than changing it.

## 7. Tests

- `packages/stage-ui/src/stores/presence.test.ts` — 19 tests: derivation and
  threshold resolution (`derivePresenceState`, `resolveAfkThresholdMinutes`).
  Unchanged by this refactor; still pure-function only.
- `packages/stage-ui/src/stores/presence-signal.test.ts` — 14 tests: the
  single-writer contract (`writeIdleTimeSec` ignores `undefined`, no other
  exported setter), threshold resolution from the active card, the
  `isUserAway(minutes)` `|| 5` fallback and its no-reading guard, provider
  resolution (largest reading wins, non-answerers skipped, no duplicate ids,
  all-throwing rejects), and provider add/remove leaving the consumer API
  shape and lock/sleep availability transitions intact.
- `packages/stage-ui/src/stores/dream-state-gate.test.ts` — 10 tests:
  `strictAfkGating` below threshold (no consolidation) / above threshold
  (consolidation); `dreamState.afkThresholdMinutes = 15` does **not**
  consolidate at 600s (10 min) and does at 960s (16 min) — this is the case
  that caught the regression where dream state inherited heartbeats' field;
  the two fields are independent (dream 15 + heartbeats 1 → no consolidation
  at 200s, while `presence.isUserAway()` is already true); heartbeats' override
  does not reach dream state; `force` bypass; gate disabled — plus the
  heartbeat's AFK suppress/unsuppress pair driven through `presence.afk`.
- `packages/stage-ui/src/stores/proactivity.test.ts` — 26 tests: unchanged.
  The `evaluateHeartbeatGating` cases still pass verbatim because the function is
  unchanged and the refactor only routes its inputs through presence.
- `packages/stage-ui/src/stores/proactivity-errors.test.ts` (2) and
  `packages/stage-ui/src/stores/agentic.gate.test.ts` (13) — unchanged; the
  latter still writes `presence.presence.state` directly, which is exactly the
  public snapshot shape the store keeps.

Whole `src/stores` suite: 612 passed, 3 skipped (60 files passed, 1 skipped) —
   no pre-existing test was modified.

## 8. Deliberately out of scope

- Wiring the lock/sleep signals from the main process. Needs a new invoke contract in
  `packages/stage-shared`; until then the store honestly reports them `unavailable`.
- Centralising `modules/screen-watcher.ts`'s AFK gate. It resolves its own threshold from
  `screenWatching.afkThresholdMinutes ?? heartbeats.afkThresholdMinutes ?? 5`, a
  screen-watcher-specific fallback chain that is *not* identical to
  `resolveAfkThresholdMinutes`. Making it read the presence store changes which config
  field wins in one case; that is a behaviour change and is left for its own review.
- Changing any numeric threshold. Every value in this refactor is the value that was
  already in effect: `strictAfkGating` still compares against
  `afkThresholdMinutes * 60` (now resolved via the same path the heartbeat gate uses, which
  already defaulted to 5), and the heartbeat gate is called with the same
  `afkThresholdMinutes ?? 5` and `currentIdleSec ?? 0` it always had.
