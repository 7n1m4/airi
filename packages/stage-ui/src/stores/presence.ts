import type { PresenceSnapshot, PresenceState, PresenceStateAvailability } from '@proj-airi/stage-shared/agentic'

import { useElectronEventaInvoke } from '@proj-airi/electron-vueuse'
import { isElectronWindow, sensorsGetIdleTime } from '@proj-airi/stage-shared'
import { defineStore, storeToRefs } from 'pinia'
import { computed, onScopeDispose, ref, shallowRef, watch } from 'vue'

import { useAiriCardStore } from './modules/airi-card'
import { useProactivityStore } from './proactivity'

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
 * Whether this build can read a lock-state or sleep/wake signal at all.
 *
 * Honesty note for the report: on the desktop app the main process *does* have
 * `powerMonitor.on('lock-screen')` and `powerMonitor.on('suspend')` — see
 * `apps/stage-tamagotchi/src/main/services/electron/window.ts:72-80` — but they
 * are consumed locally to hide/restore windows and are **not** forwarded to the
 * renderer as a queryable state. No invoke contract asking "is the screen
 * locked?" exists in `packages/stage-shared`, so the renderer genuinely cannot
 * observe either signal today. The presence store therefore reports both
 * states as `unavailable` instead of synthesising them from idle time.
 */
function detectSignalAvailability(): PresenceStateAvailability {
  const wireLockSignal = false
  const wireSleepSignal = false
  return {
    'active': 'derivable',
    'idle': 'derivable',
    'away': 'derivable',
    'screen-locked': wireLockSignal ? 'derivable' : 'unavailable',
    'sleep': wireSleepSignal ? 'derivable' : 'unavailable',
  }
}

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

export const usePresenceStore = defineStore('presence', () => {
  const proactivity = useProactivityStore()
  const airiCardStore = useAiriCardStore()
  const { activeCard } = storeToRefs(airiCardStore)

  const isElectron = computed(() => typeof window !== 'undefined' && isElectronWindow(window))

  /**
   * Lock/sleep signals, if a future invoke contract exposes them. Today there
   * is none, so these stay `null` and the derived state never claims
   * `screen-locked` or `sleep`.
   */
  const lockSignal = shallowRef<'locked' | 'unlocked' | null>(null)
  const sleepSignal = shallowRef<'awake' | 'asleep' | null>(null)

  const availability = computed(() => detectSignalAvailability())

  /**
   * NOTICE: this store deliberately adds **no polling of its own**. The
   * proactivity store already runs a single `useIntervalFn(updateSensors, 10000)`
   * that keeps `idleTimeSec`, `winHistory`, `locTime` and friends current, and
   * gates that loop on `isProactivityLoopNeeded`. Presence is a *derived read*
   * of those refs: adding a second timer here would both duplicate the IPC
   * probes and let the two loops disagree about when the user left.
   */
  const afkThresholdMinutes = computed(() => resolveAfkThresholdMinutes(activeCard.value?.extensions))

  const idleTimeSec = computed(() => proactivity.idleTimeSec ?? null)

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
   * Recompute the snapshot from the current proactivity sensor refs. The
   * lock/sleep signal reads are inlined because both are permanently `null`
   * today; when a contract exposes them, this is the one place that changes.
   */
  function recompute() {
    const idle = proactivity.idleTimeSec ?? null
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

  // The proactivity loop writes `idleTimeSec` at most every 10s; recomputing on
  // each change keeps the snapshot fresh without a timer of our own.
  watch([idleTimeSec, afkThresholdMinutes, lockSignal, sleepSignal], () => {
    recompute()
  }, { immediate: true })

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
   * Single idle-only probe, used when the proactivity loop is paused (heartbeats
   * disabled and grounding off) but an autonomous cycle still needs one fresh
   * reading. It reuses the *same* invoke contract the 10s loop uses; it does not
   * create a second polling schedule.
   */
  const invokeGetIdleTime = isElectron.value ? useElectronEventaInvoke(sensorsGetIdleTime) : null

  async function refreshIdleTimeOnce() {
    if (!invokeGetIdleTime)
      return
    try {
      const idleMs = await invokeGetIdleTime()
      if (idleMs !== undefined)
        proactivity.idleTimeSec = Math.floor(idleMs / 1000)
    }
    catch (err) {
      console.warn('[PresenceStore] Failed to refresh idle time:', err)
    }
  }

  onScopeDispose(() => {
    lockSignal.value = null
    sleepSignal.value = null
  })

  return {
    presence,
    presenceState: computed(() => presence.value.state),
    idleTimeSec,
    afkThresholdMinutes,
    derivableStates,
    isAway,
    isUserPresent,
    recompute,
    refreshIdleTimeOnce,
  }
})
