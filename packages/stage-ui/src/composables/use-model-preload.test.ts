// @vitest-environment jsdom
import type { PreloadTask } from './use-model-preload'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createApp } from 'vue'

import { useModelPreload } from './use-model-preload'

function task(modelId: string, loader?: (signal: AbortSignal) => Promise<void>): PreloadTask {
  return {
    modelId,
    loader: loader ?? (async () => {}),
  }
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.spyOn(console, 'debug').mockImplementation(() => {})
  vi.spyOn(console, 'warn').mockImplementation(() => {})
})

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('useModelPreload', () => {
  it('exposes idle defaults', () => {
    const { preloading, preloadedModels, failedModels } = useModelPreload()

    expect(preloading.value).toBe(false)
    expect(preloadedModels.value).toEqual([])
    expect(failedModels.value).toEqual([])
  })

  it('returns the composable api', () => {
    const api = useModelPreload()

    expect(api).toHaveProperty('preloading')
    expect(api).toHaveProperty('preloadedModels')
    expect(api).toHaveProperty('failedModels')
    expect(api).toHaveProperty('schedulePreload')
    expect(api).toHaveProperty('cancelPreload')
  })

  it('ignores an empty task list', async () => {
    const { schedulePreload, preloading, preloadedModels, failedModels } = useModelPreload({ delayMs: 1000 })

    schedulePreload([])

    expect(preloading.value).toBe(false)
    await vi.advanceTimersByTimeAsync(5000)
    expect(preloading.value).toBe(false)
    expect(preloadedModels.value).toEqual([])
    expect(failedModels.value).toEqual([])
  })

  it('waits the configured delay before loading', async () => {
    const loader = vi.fn(async () => {})
    const { schedulePreload, preloading } = useModelPreload({ delayMs: 1000 })

    schedulePreload([task('model-a', loader)])
    expect(preloading.value).toBe(false)

    await vi.advanceTimersByTimeAsync(999)
    expect(loader).not.toHaveBeenCalled()
    expect(preloading.value).toBe(false)

    await vi.advanceTimersByTimeAsync(1)
    expect(loader).toHaveBeenCalledTimes(1)
    expect(preloading.value).toBe(false)
  })

  it('defaults to a 2000ms delay', async () => {
    const loader = vi.fn(async () => {})
    const { schedulePreload, preloading } = useModelPreload()

    schedulePreload([task('model-default', loader)])

    await vi.advanceTimersByTimeAsync(1999)
    expect(loader).not.toHaveBeenCalled()
    expect(preloading.value).toBe(false)

    await vi.advanceTimersByTimeAsync(1)
    expect(loader).toHaveBeenCalledTimes(1)
    expect(preloading.value).toBe(false)
  })

  it('reports preloading while the load is in flight', async () => {
    let release!: () => void
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })

    const { schedulePreload, preloading, preloadedModels } = useModelPreload({ delayMs: 100 })

    schedulePreload([task('model-slow', () => gate)])
    await vi.advanceTimersByTimeAsync(100)

    expect(preloading.value).toBe(true)
    expect(preloadedModels.value).toEqual([])

    release()
    await vi.advanceTimersByTimeAsync(1)

    expect(preloading.value).toBe(false)
    expect(preloadedModels.value).toEqual(['model-slow'])
  })

  it('loads all tasks sequentially and tracks successes', async () => {
    const order: string[] = []
    const { schedulePreload, preloading, preloadedModels, failedModels } = useModelPreload({ delayMs: 500 })

    schedulePreload([
      task('model-a', async () => {
        order.push('a')
      }),
      task('model-b', async () => {
        order.push('b')
      }),
    ])

    await vi.advanceTimersByTimeAsync(500)

    expect(order).toEqual(['a', 'b'])
    expect(preloadedModels.value).toEqual(['model-a', 'model-b'])
    expect(failedModels.value).toEqual([])
    expect(preloading.value).toBe(false)
  })

  it('passes the same abort signal to every loader', async () => {
    const signals: AbortSignal[] = []
    const { schedulePreload } = useModelPreload({ delayMs: 100 })

    schedulePreload([
      task('one', (signal) => {
        signals.push(signal)
        return Promise.resolve()
      }),
      task('two', (signal) => {
        signals.push(signal)
        return Promise.resolve()
      }),
    ])

    await vi.advanceTimersByTimeAsync(100)

    expect(signals).toHaveLength(2)
    expect(signals[0]).toBe(signals[1])
    expect(signals[0]!.aborted).toBe(false)
  })

  it('records failed models without aborting the run', async () => {
    const loaderC = vi.fn(async () => {})
    const { schedulePreload, preloading, preloadedModels, failedModels } = useModelPreload({ delayMs: 100 })

    schedulePreload([
      task('model-a', async () => {
        throw new Error('boom')
      }),
      task('model-b', loaderC),
    ])

    await vi.advanceTimersByTimeAsync(100)

    expect(failedModels.value).toEqual(['model-a'])
    expect(preloadedModels.value).toEqual(['model-b'])
    expect(loaderC).toHaveBeenCalledTimes(1)
    expect(preloading.value).toBe(false)
  })

  it('stops the run on AbortError and does not mark it failed', async () => {
    const loaderB = vi.fn(async () => {})
    const { schedulePreload, preloadedModels, failedModels, preloading } = useModelPreload({ delayMs: 100 })

    schedulePreload([
      task('model-a', async () => {
        throw Object.assign(new Error('aborted'), { name: 'AbortError' })
      }),
      task('model-b', loaderB),
    ])

    await vi.advanceTimersByTimeAsync(100)

    expect(failedModels.value).toEqual([])
    expect(preloadedModels.value).toEqual([])
    expect(loaderB).not.toHaveBeenCalled()
    expect(preloading.value).toBe(false)
  })

  it('treats a non-Error throw as a failure', async () => {
    const { schedulePreload, failedModels, preloadedModels } = useModelPreload({ delayMs: 100 })

    schedulePreload([
      task('model-a', async () => {
        throw { name: 'TimeoutError', message: 'too slow' }
      }),
    ])

    await vi.advanceTimersByTimeAsync(100)

    expect(failedModels.value).toEqual(['model-a'])
    expect(preloadedModels.value).toEqual([])
  })

  it('aborts a pending schedule before the delay elapses', async () => {
    const loader = vi.fn(async () => {})
    const { schedulePreload, cancelPreload, preloading, preloadedModels, failedModels } = useModelPreload({ delayMs: 1000 })

    schedulePreload([task('model-a', loader)])
    cancelPreload()

    await vi.advanceTimersByTimeAsync(5000)

    expect(loader).not.toHaveBeenCalled()
    expect(preloadedModels.value).toEqual([])
    expect(failedModels.value).toEqual([])
    expect(preloading.value).toBe(false)
  })

  it('aborts an in-flight preload with a reason', async () => {
    let observedSignal: AbortSignal | undefined
    const { schedulePreload, cancelPreload, preloading, preloadedModels } = useModelPreload({ delayMs: 10 })

    schedulePreload([task('model-a', (signal) => {
      observedSignal = signal
      return new Promise<void>(() => {})
    })])

    await vi.advanceTimersByTimeAsync(10)
    expect(preloading.value).toBe(true)

    cancelPreload()

    expect(observedSignal?.aborted).toBe(true)
    expect(observedSignal?.reason).toBeInstanceOf(Error)
    expect(preloading.value).toBe(false)
    expect(preloadedModels.value).toEqual([])
  })

  it('supersedes an earlier preload when rescheduled', async () => {
    const signals: AbortSignal[] = []
    let releaseFirst!: () => void
    const firstGate = new Promise<void>((resolve) => {
      releaseFirst = resolve
    })

    const { schedulePreload, preloadedModels } = useModelPreload({ delayMs: 10 })

    schedulePreload([task('first', (signal) => {
      signals.push(signal)
      return firstGate
    })])

    await vi.advanceTimersByTimeAsync(10)

    // The earlier run is aborted the moment a new schedule appears.
    schedulePreload([task('second')])
    expect(signals[0]!.aborted).toBe(true)

    releaseFirst()
    await vi.advanceTimersByTimeAsync(100)

    expect(preloadedModels.value).toEqual(['first', 'second'])
  })

  it('stops before the first task when cancelled mid-run', async () => {
    const secondLoader = vi.fn(async () => {})
    const { schedulePreload, cancelPreload, preloadedModels } = useModelPreload({ delayMs: 10 })

    let releaseFirst!: () => void
    const firstGate = new Promise<void>((resolve) => {
      releaseFirst = resolve
    })

    schedulePreload([
      task('model-a', () => firstGate),
      task('model-b', secondLoader),
    ])

    // The first loader starts, then the run is cancelled while it is pending.
    await vi.advanceTimersByTimeAsync(10)
    cancelPreload()
    releaseFirst()
    await vi.advanceTimersByTimeAsync(100)

    // The abort check sits at the top of each iteration, so pending work for
    // the first task settles (recording it) but the loop never reaches model-b.
    expect(preloadedModels.value).toEqual(['model-a'])
    expect(secondLoader).not.toHaveBeenCalled()
  })

  it('returns from the deferred callback when its signal is already aborted', async () => {
    const staleLoader = vi.fn(async () => {})
    const freshLoader = vi.fn(async () => {})
    const { schedulePreload } = useModelPreload({ delayMs: 10 })

    // Rescheduling aborts the previous controller but overwrites `timeoutId`,
    // so the stale callback still fires with an already-aborted signal and
    // must short-circuit on the `signal.aborted` guard.
    schedulePreload([task('stale', staleLoader)])
    schedulePreload([task('fresh', freshLoader)])
    await vi.advanceTimersByTimeAsync(10)

    expect(staleLoader).not.toHaveBeenCalled()
    expect(freshLoader).toHaveBeenCalledTimes(1)
  })

  it('cancelPreload is idempotent', async () => {
    const { schedulePreload, cancelPreload, preloading } = useModelPreload({ delayMs: 10 })

    schedulePreload([task('model-a', () => new Promise<void>(() => {}))])
    await vi.advanceTimersByTimeAsync(10)
    expect(preloading.value).toBe(true)

    cancelPreload()
    cancelPreload()

    expect(preloading.value).toBe(false)
  })

  it('cancelPreload is safe before any schedule', () => {
    const { cancelPreload, preloading, preloadedModels, failedModels } = useModelPreload()

    expect(() => cancelPreload()).not.toThrow()
    expect(preloading.value).toBe(false)
    expect(preloadedModels.value).toEqual([])
    expect(failedModels.value).toEqual([])
  })

  it('keeps accumulators across schedules', async () => {
    const { schedulePreload, preloadedModels } = useModelPreload({ delayMs: 10 })

    schedulePreload([task('one')])
    await vi.advanceTimersByTimeAsync(10)

    schedulePreload([task('two')])
    await vi.advanceTimersByTimeAsync(10)

    expect(preloadedModels.value).toEqual(['one', 'two'])
  })
})

describe('useModelPreload lifecycle', () => {
  it('cancels an in-flight preload when the owning component unmounts', async () => {
    let observedSignal: AbortSignal | undefined
    let disposed

    const app = createApp({
      setup() {
        disposed = useModelPreload({ delayMs: 10 })
        disposed.schedulePreload([task('model-a', (signal) => {
          observedSignal = signal
          return new Promise<void>(() => {})
        })])
        return () => {}
      },
    })

    app.mount(document.createElement('div'))
    await vi.advanceTimersByTimeAsync(10)
    expect(disposed.preloading.value).toBe(true)

    app.unmount()

    expect(observedSignal?.aborted).toBe(true)
    expect(disposed.preloading.value).toBe(false)
    expect(disposed.preloadedModels.value).toEqual([])
  })

  it('cancels a pending schedule when unmounted before the delay elapses', async () => {
    const loader = vi.fn(async () => {})

    const app = createApp({
      setup() {
        useModelPreload({ delayMs: 1000 }).schedulePreload([task('model-a', loader)])
        return () => {}
      },
    })

    app.mount(document.createElement('div'))
    app.unmount()
    await vi.advanceTimersByTimeAsync(5000)

    expect(loader).not.toHaveBeenCalled()
  })
})
