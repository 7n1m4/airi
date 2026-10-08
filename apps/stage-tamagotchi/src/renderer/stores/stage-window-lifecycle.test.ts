import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { shouldSampleStageTransparency } from '../utils/stage-three-transparency'
import {
  createDefaultWindowLifecycleState,
  DEEP_STANDBY_AFTER_MS,
  shouldEnterDeepStandby,
  shouldPauseStageFromLifecycle,
  useStageWindowLifecycleStore,
} from './stage-window-lifecycle'

describe('stage window lifecycle helpers', () => {
  it('pauses only for hidden or minimized window lifecycle states', () => {
    expect(shouldPauseStageFromLifecycle({
      ...createDefaultWindowLifecycleState(),
      reason: 'show',
      visible: true,
    })).toBe(false)

    expect(shouldPauseStageFromLifecycle({
      ...createDefaultWindowLifecycleState(),
      reason: 'restore',
      visible: true,
    })).toBe(false)

    expect(shouldPauseStageFromLifecycle({
      ...createDefaultWindowLifecycleState(),
      reason: 'hide',
      visible: false,
    })).toBe(true)

    expect(shouldPauseStageFromLifecycle({
      ...createDefaultWindowLifecycleState(),
      minimized: true,
      reason: 'minimize',
    })).toBe(true)

    expect(shouldPauseStageFromLifecycle({
      ...createDefaultWindowLifecycleState(),
      reason: 'suspend',
      visible: false,
    })).toBe(true)
  })

  it('samples stage transparency only for mounted vrm stage while fade-on-hover is active', () => {
    expect(shouldSampleStageTransparency({
      componentState: 'mounted',
      fadeOnHoverEnabled: true,
      stageModelRenderer: 'vrm',
      stagePaused: false,
    })).toBe(true)

    expect(shouldSampleStageTransparency({
      componentState: 'loading',
      fadeOnHoverEnabled: true,
      stageModelRenderer: 'vrm',
      stagePaused: false,
    })).toBe(false)

    expect(shouldSampleStageTransparency({
      componentState: 'mounted',
      fadeOnHoverEnabled: false,
      stageModelRenderer: 'vrm',
      stagePaused: false,
    })).toBe(false)

    expect(shouldSampleStageTransparency({
      componentState: 'mounted',
      fadeOnHoverEnabled: true,
      stageModelRenderer: 'live2d',
      stagePaused: false,
    })).toBe(false)

    expect(shouldSampleStageTransparency({
      componentState: 'mounted',
      fadeOnHoverEnabled: true,
      stageModelRenderer: 'vrm',
      stagePaused: true,
    })).toBe(false)
  })
})

describe('useStageWindowLifecycleStore', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('initializes with default visible state and unpaused stage', () => {
    const store = useStageWindowLifecycleStore()
    expect(store.stagePaused).toBe(false)
    expect(store.windowLifecycle).toEqual(createDefaultWindowLifecycleState())
  })

  it('enters deep standby only after the suspend threshold elapses', () => {
    const start = 1_000_000
    expect(shouldEnterDeepStandby(null, start + DEEP_STANDBY_AFTER_MS * 2)).toBe(false)
    expect(shouldEnterDeepStandby(start, start + DEEP_STANDBY_AFTER_MS)).toBe(false)
    expect(shouldEnterDeepStandby(start, start + DEEP_STANDBY_AFTER_MS + 1)).toBe(true)
  })

  it('tracks suspend duration and clears deep standby on resume', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(0)
    try {
      const store = useStageWindowLifecycleStore()
      expect(store.deepStandby).toBe(false)
      expect(store.suspendDurationMs).toBe(0)

      store.updateWindowLifecycle({
        focused: true,
        minimized: false,
        reason: 'suspend',
        updatedAt: 0,
        visible: false,
      })
      expect(store.isSuspended).toBe(true)
      expect(store.deepStandby).toBe(false)

      await vi.advanceTimersByTimeAsync(DEEP_STANDBY_AFTER_MS + 30_000)
      expect(store.deepStandby).toBe(true)
      expect(store.suspendDurationMs).toBeGreaterThan(DEEP_STANDBY_AFTER_MS)

      store.updateWindowLifecycle({
        focused: true,
        minimized: false,
        reason: 'restore',
        updatedAt: DEEP_STANDBY_AFTER_MS + 30_000,
        visible: true,
      })
      expect(store.deepStandby).toBe(false)
      expect(store.isSuspended).toBe(false)
      expect(store.suspendDurationMs).toBe(0)
    }
    finally {
      vi.useRealTimers()
    }
  })

  it('reactively pauses stage when window is suspended or hidden, and unpauses on restore', () => {
    const store = useStageWindowLifecycleStore()

    store.updateWindowLifecycle({
      focused: true,
      minimized: false,
      reason: 'suspend',
      updatedAt: 1000,
      visible: false,
    })
    expect(store.stagePaused).toBe(true)

    store.updateWindowLifecycle({
      focused: true,
      minimized: false,
      reason: 'restore',
      updatedAt: 2000,
      visible: true,
    })
    expect(store.stagePaused).toBe(false)

    store.updateWindowLifecycle({
      focused: false,
      minimized: true,
      reason: 'minimize',
      updatedAt: 3000,
      visible: true,
    })
    expect(store.stagePaused).toBe(true)
  })
})
