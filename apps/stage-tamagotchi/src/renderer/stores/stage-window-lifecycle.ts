import type { ElectronWindowLifecycleState } from '../../shared/eventa'

import { defineInvoke } from '@moeru/eventa'
import { getElectronEventaContext } from '@proj-airi/electron-vueuse'
import { defineStore } from 'pinia'
import { computed, ref } from 'vue'

import { electronGetWindowLifecycleState, electronWindowLifecycleChanged } from '../../shared/eventa'

export function createDefaultWindowLifecycleState(): ElectronWindowLifecycleState {
  return {
    focused: true,
    minimized: false,
    reason: 'initial',
    updatedAt: 0,
    visible: true,
  }
}

export function shouldPauseStageFromLifecycle(state: ElectronWindowLifecycleState) {
  return !state.visible || state.minimized
}

/**
 * Elapsed threshold before a sustained suspend/lock hibernates inference.
 * NOTICE: the main process maps both `powerMonitor` 'suspend' and
 * 'lock-screen' to reason `'suspend'` (`window.ts`), so this duration covers
 * extended screen lock. A true OS sleep freezes renderer timers — eviction
 * then applies to locks observed while the renderer is still alive.
 */
export const DEEP_STANDBY_AFTER_MS = 10 * 60 * 1000

/** Re-evaluation cadence for the suspend-duration clock (granularity only). */
const SUSPEND_CLOCK_TICK_MS = 30 * 1000

export function shouldEnterDeepStandby(suspendStartedAtMs: number | null, nowMs: number): boolean {
  return suspendStartedAtMs != null && nowMs - suspendStartedAtMs > DEEP_STANDBY_AFTER_MS
}

export const useStageWindowLifecycleStore = defineStore('stageWindowLifecycle', () => {
  const windowLifecycle = ref<ElectronWindowLifecycleState>(createDefaultWindowLifecycleState())
  const stagePaused = computed(() => shouldPauseStageFromLifecycle(windowLifecycle.value))

  // Suspend/lock tracking for Tier-2 deep standby (VRAM hibernation).
  const suspendStartedAt = ref<number | null>(null)
  const clockNow = ref<number>(Date.now())
  let suspendClock: ReturnType<typeof setInterval> | null = null

  const isSuspended = computed(() => windowLifecycle.value.reason === 'suspend')
  const suspendDurationMs = computed(() =>
    suspendStartedAt.value == null ? 0 : Math.max(0, clockNow.value - suspendStartedAt.value),
  )
  const deepStandby = computed(() => shouldEnterDeepStandby(suspendStartedAt.value, clockNow.value))

  function startSuspendClock() {
    clockNow.value = Date.now()
    if (suspendClock != null)
      return
    suspendClock = setInterval(() => {
      clockNow.value = Date.now()
    }, SUSPEND_CLOCK_TICK_MS)
  }

  function stopSuspendClock() {
    if (suspendClock != null) {
      clearInterval(suspendClock)
      suspendClock = null
    }
  }

  let initialized = false

  function updateWindowLifecycle(state: ElectronWindowLifecycleState) {
    windowLifecycle.value = { ...state }
    if (state.reason === 'suspend') {
      if (suspendStartedAt.value == null) {
        suspendStartedAt.value = Date.now()
        startSuspendClock()
      }
    }
    else if (suspendStartedAt.value != null) {
      suspendStartedAt.value = null
      stopSuspendClock()
    }
  }

  async function initializeWindowLifecycleBridge() {
    if (initialized)
      return

    initialized = true

    const context = getElectronEventaContext()
    if (!context) {
      console.warn('[StageWindowLifecycle] Electron context not available, skipping bridge initialization.')
      return
    }

    context.on(electronWindowLifecycleChanged, (event) => {
      if (!event?.body)
        return
      updateWindowLifecycle(event.body)
    })

    try {
      const getWindowLifecycleState = defineInvoke(context, electronGetWindowLifecycleState)
      updateWindowLifecycle(await getWindowLifecycleState())
    }
    catch (error) {
      console.warn('[StageWindowLifecycle] Failed to fetch initial window lifecycle state.', error)
    }
  }

  return {
    deepStandby,
    initializeWindowLifecycleBridge,
    isSuspended,
    stagePaused,
    suspendDurationMs,
    updateWindowLifecycle,
    windowLifecycle,
  }
})
