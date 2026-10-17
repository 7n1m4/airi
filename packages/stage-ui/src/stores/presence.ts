import type { PresenceSignalProvider, PresenceSnapshot, PresenceState, PresenceStateAvailability } from '@proj-airi/stage-shared/agentic'

import { useElectronEventaInvoke } from '@proj-airi/electron-vueuse'
import { isElectronWindow, sensorsGetIdleTime } from '@proj-airi/stage-shared'
import { defineStore, storeToRefs } from 'pinia'
import { computed, ref, watch } from 'vue'

import { useAiriCardStore } from './modules/airi-card'

/**
 * Idle seconds past which the user is still considered present, just quiet.
 * Mirrors the default `afkThresholdMinutes` on `HeartbeatConfig` (5 minutes) so
 * presence agrees with the heartbeat gate that already exists.
 */
const DEFAULT_AFK_THRESHOLD_MINUTES = 5

/**
 * Idle seconds past which the machine is considered unattended (`away`).
 *
 * NOTICE: this is a policy constant, not a sensor reading. The repository has
 * no proximity, camera, Bluetooth, or keyboard/mouse sensor beyond the OS
 * idle-time counter, so "unattended" cannot be measured directly. It is
 * therefore derived from elapsed idle time, and named here so the derivation
 * is auditable rather than implied.
 */
export const AWAY_THRESHOLD_MINUTES = 30

/**
 * Idle seconds past which the user is active-but-quiet (`idle`) rather than
 * `active`. Lower than the AFK threshold: `idle` is a *pre-AFK* state that
 * lets the autonomous cycle stop while the user is still plausibly at the desk
 * (reading, watching), which is exactly when a companion should not interrupt.
 */
export const IDLE_THRESHOLD_MINUTES = 2

/** Stable frozen fallbacks; inline `{}`/`[]` allocate a new reference per read. */
const EMPTY_STATE_AVAILABILITY: Readonly<PresenceStateAvailability> = Object.freeze({
  'active': 'derivable',
  'idle': 'derivable',
  'away': 'derivable',
  'screen-locked': 'unavailable',
  'sleep': 'unavailable',
})

/**
 * Derive the presence state from the signals that exist.
 *
 * `undefined`/`null` idle time means the probe is unavailable (browser, or the
 * Electron sensor service never answered). Rather than guess, the store holds
 * the last known state and records the reason.
 */
export function derivePresenceState(input: {
  idleTimeSec: number | null
  afkThresholdMinutes: number
  lockSignal?: 'locked' | 'unlocked' | null
  sleepSignal?: 'awake' | 'asleep' | null
}): { state: PresenceState, reason: string } {
  const afkThresholdSec = Math.max(1, input.afkThresholdMinutes) * 60
  const idleThresholdSec = IDLE_THRESHOLD_MINUTES * 60
  const awayThresholdSec = AWAY_THRESHOLD_MINUTES * 60

  if (input.sleepSignal === 'asleep') {
    return { state: 'sleep', reason: 'OS reported a suspend/sleep event' }
  }

  if (input.lockSignal === 'locked') {
    return { state: 'screen-locked', reason: 'OS reported the screen is locked' }
  }

  const idle = input.idleTimeSec
  if (idle == null) {
    return {
      state: 'active',
      reason: 'No idle-time signal available; assuming active rather than guessing a quieter state',
    }
  }

  if (idle >= awayThresholdSec) {
    return {
      state: 'away',
      reason: `Idle ${formatDuration(idle)} exceeds the ${AWAY_THRESHOLD_MINUTES}m unattended threshold`,
    }
  }

  if (idle >= afkThresholdSec) {
    return {
      state: 'idle',
      reason: `Idle ${formatDuration(idle)} exceeds the ${Math.round(afkThresholdSec / 60)}m AFK threshold; machine unattended`,
    }
  }

  if (idle >= idleThresholdSec) {
    return {
      state: 'idle',
      reason: `Idle ${formatDuration(idle)} exceeds the ${IDLE_THRESHOLD_MINUTES}m quiet-input threshold`,
    }
  }

  return { state: 'active', reason: `Recent input (idle ${formatDuration(idle)})` }
}

function formatDuration(totalSeconds: number): string {
  const secs = Math.max(0, Math.floor(totalSeconds))
  const minutes = Math.floor(secs / 60)
  const rest = secs % 60
  if (minutes === 0)
    return `${rest}s`
  return `${minutes}m ${rest}s`
}

/**
 * AFK threshold for the active companion, read from the card extension.
 *
 * This is the *same* field the heartbeat gate uses
 * (`HeartbeatConfig.afkThresholdMinutes`, default 5m), so presence and
 * heartbeats cannot disagree about when the user stepped away, and a
 * per-companion override needs no second setting of its own.
 *
 * Exported so the derivation is testable without instantiating the store.
 */
export function resolveAfkThresholdMinutes(
  cardExtensions: { airi?: { heartbeats?: { afkThresholdMinutes?: number } } } | undefined | null,
): number {
  const configured = cardExtensions?.airi?.heartbeats?.afkThresholdMinutes
  return typeof configured === 'number' && configured > 0 ? configured : DEFAULT_AFK_THRESHOLD_MINUTES
}

/**
 * Whether this build can read a lock-state or sleep/wake signal at all.
 *
 * Honesty note: on the desktop app the main process *does* have
 * `powerMonitor.on('lock-screen')` and `powerMonitor.on('suspend')` — see
 * `apps/stage-tamagotchi/src/main/services/electron/window.ts` — but they are
 * consumed locally to hide/restore windows and are **not** forwarded to the
 * renderer as a queryable state. No invoke contract asking "is the screen
 * locked?" exists in `packages/stage-shared`, so the renderer genuinely cannot
 * observe either signal today. `screen-locked` therefore stays `unavailable`
 * until a `PresenceSignalProvider` that answers the lock/sleep question is
 * registered — at which point this store needs no further change.
 */
function resolveSignalAvailability(providers: readonly PresenceSignalProvider[]): PresenceStateAvailability {
  return {
    'active': 'derivable',
    'idle': 'derivable',
    'away': 'derivable',
    'screen-locked': providers.some(provider => provider.readLockState !== undefined) ? 'derivable' : 'unavailable',
    'sleep': providers.some(provider => provider.readSleepState !== undefined) ? 'derivable' : 'unavailable',
  }
}

export type PresenceStore = ReturnType<typeof usePresenceStore>

export const usePresenceStore = defineStore('presence', () => {
  const airiCardStore = useAiriCardStore()
  const { activeCard } = storeToRefs(airiCardStore)

  const isElectron = computed(() => typeof window !== 'undefined' && isElectronWindow(window))

  /**
   * The raw presence signal this build can read: OS-level input idle, in
   * seconds. `undefined` means nothing has been read yet.
   *
   * This store is the sole owner of the value. Everything that produces a
   * reading — the provider read, the proactivity sensor loop, an on-demand
   * refresh — goes through `writeIdleTimeSec()`, so "how many places can
   * change presence what" has exactly one answer, and no consumer has to know
   * whether the value came from a probe or from a fresh IPC call.
   */
  const rawIdleTimeSec = ref<number | undefined>(undefined)

  /**
   * Pluggable signal sources. See `PresenceSignalProvider` in
   * `packages/stage-shared/src/agentic.ts` and `docs/design-user-presence.md`.
   *
   * Immutable updates, so the recompute watch reacts to add/remove.
   */
  const signalProviders = ref<readonly PresenceSignalProvider[]>([])

  function addSignalProvider(provider: PresenceSignalProvider) {
    if (signalProviders.value.some(registered => registered.id === provider.id))
      return
    signalProviders.value = [...signalProviders.value, provider]
  }

  function removeSignalProvider(id: string) {
    signalProviders.value = signalProviders.value.filter(registered => registered.id !== id)
  }

  /**
   * The single write path for the raw idle signal.
   *
   * `undefined` means "no reading was obtained" and is ignored, so a probe
   * that fails or a provider that cannot answer leaves the last known value in
   * place rather than silently resetting presence to `active`.
   */
  function writeIdleTimeSec(idleTimeSec: number | undefined) {
    if (idleTimeSec === undefined)
      return
    rawIdleTimeSec.value = idleTimeSec
  }

  /**
   * Resolve the idle reading across every registered provider, without
   * writing anything.
   *
   * The largest reading wins: a larger reading means "quiet for longer", which
   * is the safe direction. A window-scoped provider that stops reporting while
   * the app is backgrounded must not make the companion believe the user is
   * present when the OS idle counter says otherwise.
   *
   * NOTICE: a provider that throws is treated as "cannot answer", but rejection
   * is preserved when *no* provider produced a usable value, so callers keep
   * seeing the failure (the proactivity sensor loop records a failed probe, and
   * `refreshIdleTimeOnce` logs it) instead of silently returning `undefined`.
   */
  async function readIdleTimeOnce(): Promise<number | undefined> {
    const settled = await Promise.allSettled(signalProviders.value.map(async provider => provider.readIdleSec()))
    const failures = settled.filter((result): result is PromiseRejectedResult => result.status === 'rejected')
    const readings = settled.filter((result): result is PromiseFulfilledResult<number | undefined> => result.status === 'fulfilled')
    const usable = readings
      .map(result => result.value)
      .filter((value): value is number => typeof value === 'number' && Number.isFinite(value))

    if (usable.length === 0 && failures.length > 0)
      throw failures[0].reason

    return usable.length > 0 ? Math.floor(Math.max(...usable)) : undefined
  }

  /** Read the registered providers and store the result. One fresh reading. */
  async function refreshIdleTimeOnce() {
    try {
      writeIdleTimeSec(await readIdleTimeOnce())
    }
    catch (err) {
      console.warn('[PresenceStore] Failed to refresh idle time:', err)
    }
  }

  const afkThresholdMinutes = computed(() => resolveAfkThresholdMinutes(activeCard.value?.extensions))
  const afkThresholdSec = computed(() => afkThresholdMinutes.value * 60)

  /** Lock/sleep readings, contributed by any provider that can answer them. */
  const lockSignal = computed<'locked' | 'unlocked' | null>(() => {
    for (const provider of signalProviders.value) {
      const state = provider.readLockState?.()
      if (state !== undefined)
        return state
    }
    return null
  })

  const sleepSignal = computed<'awake' | 'asleep' | null>(() => {
    for (const provider of signalProviders.value) {
      const state = provider.readSleepState?.()
      if (state !== undefined)
        return state
    }
    return null
  })

  const availability = computed(() => resolveSignalAvailability(signalProviders.value))

  const presence = ref<PresenceSnapshot>({
    state: 'active',
    updatedAt: 0,
    reason: 'Presence not yet derived',
    signals: {
      idleTimeSec: null,
      hasIdleTime: false,
      hasLockSignal: false,
      hasSleepSignal: false,
      availability: EMPTY_STATE_AVAILABILITY,
    },
  })

  /**
   * Recompute the snapshot from the resolved signals. Adding, removing or
   * changing a provider is the only way a new signal enters presence, and it
   * needs no change here: this is the single place signals become a state.
   */
  function recompute() {
    const idle = rawIdleTimeSec.value ?? null
    const derived = derivePresenceState({
      idleTimeSec: idle,
      afkThresholdMinutes: afkThresholdMinutes.value,
      lockSignal: lockSignal.value,
      sleepSignal: sleepSignal.value,
    })

    presence.value = {
      state: derived.state,
      updatedAt: Date.now(),
      reason: derived.reason,
      signals: {
        idleTimeSec: idle,
        hasIdleTime: idle != null,
        hasLockSignal: lockSignal.value != null,
        hasSleepSignal: sleepSignal.value != null,
        availability: availability.value,
      },
    }
  }

  // A fresh reading lands on `rawIdleTimeSec` at most every 10s (proactivity's
  // loop) or on demand; recomputing on each change keeps the snapshot fresh
  // without a timer of our own. Presence deliberately adds no polling of its
  // own: a second schedule would duplicate the IPC probes and let two loops
  // disagree about when the user left.
  // `flush: 'sync'` — a consumer that reads the snapshot immediately after it
  // writes a reading (e.g. `evaluateDreamState` reading `presence.afk` straight
  // after a refresh) must observe the fresh state, not the pre-flush one.
  watch([rawIdleTimeSec, afkThresholdMinutes, signalProviders, lockSignal, sleepSignal], () => {
    recompute()
  }, { immediate: true, flush: 'sync' })

  /**
   * The states this build can actually distinguish. Used by the settings UI and
   * the report, so the user is never shown a `screen-locked` / `sleep` control
   * for a state the renderer cannot observe.
   */
  const derivableStates = computed<PresenceState[]>(() => {
    const report = availability.value
    const states: PresenceState[] = ['active', 'idle', 'away']
    if (report['screen-locked'] === 'derivable')
      states.push('screen-locked')
    if (report.sleep === 'derivable')
      states.push('sleep')
    return states
  })

  /** True when the machine is considered unattended. */
  const isAway = computed(() => presence.value.state === 'away')

  /** True when the user is plausibly present and interacting. */
  const isUserPresent = computed(() => presence.value.state === 'active')

  /**
   * Whether the user is away from the desk, per the resolved AFK threshold.
   *
   * This is the heartbeat's `pauseWhenAfk` predicate, so it resolves the
   * threshold the same way `heartbeats.afkThresholdMinutes` does. `false` when
   * no reading exists — an unavailable probe must not assert the user is gone.
   */
  const afk = computed(() => rawIdleTimeSec.value !== undefined && rawIdleTimeSec.value >= afkThresholdSec.value)

  /**
   * The canonical AFK predicate, parameterizable per consumer.
   *
   * `isUserAway()` uses presence's own default threshold (`heartbeats.
   * afkThresholdMinutes`), which is what the heartbeat gate reads.
   *
   * `isUserAway(minutes)` asks against a caller-supplied threshold, so a
   * feature with its own config — Dream State's own *required*
   * `afkThresholdMinutes` (`card.schema.ts:146`), distinct from heartbeats'
   * optional one (`card.schema.ts:137`) — keeps its own threshold while still
   * reading the single canonical idle signal instead of probing the OS itself.
   *
   * The `|| 5` fallback matches the expression Dream State used inline
   * (`(config.afkThresholdMinutes || 5) * 60`) exactly: an unset, zero or NaN
   * value falls back to the 5-minute default rather than clamping to 1.
   * Returns `false` when no reading exists.
   */
  function isUserAway(thresholdMinutes?: number): boolean {
    const idle = rawIdleTimeSec.value
    if (idle === undefined)
      return false

    const thresholdSec = thresholdMinutes === undefined
      ? afkThresholdSec.value
      : (thresholdMinutes || DEFAULT_AFK_THRESHOLD_MINUTES) * 60

    return idle >= thresholdSec
  }

  /**
   * The only presence signal provider registered at runtime today: the OS
   * input-idle counter, read over the `sensorsGetIdleTime` invoke contract.
   *
   * In-app window input, global native hooks and a lock/sleep contract are the
   * same three lines of registration, and need no consumer change — see
   * `docs/design-user-presence.md` §5.
   */
  if (isElectron.value) {
    const invokeGetIdleTime = useElectronEventaInvoke(sensorsGetIdleTime)
    addSignalProvider({
      id: 'os-idle-time',
      readIdleSec: async () => {
        const idleMs = await invokeGetIdleTime()
        return typeof idleMs === 'number' && Number.isFinite(idleMs) ? idleMs / 1000 : undefined
      },
    })
  }

  return {
    presence,
    presenceState: computed(() => presence.value.state),
    rawIdleTimeSec,
    /** Canonical idle read for consumers: `null` when nothing has been read. */
    idleTimeSec: computed(() => rawIdleTimeSec.value ?? null),
    signalProviders: computed(() => signalProviders.value),
    afkThresholdMinutes,
    afkThresholdSec,
    afk,
    isUserAway,
    availability,
    derivableStates,
    isAway,
    isUserPresent,
    addSignalProvider,
    removeSignalProvider,
    readIdleTimeOnce,
    writeIdleTimeSec,
    refreshIdleTimeOnce,
    recompute,
  }
})
