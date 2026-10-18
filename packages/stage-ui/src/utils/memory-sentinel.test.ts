import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  getMemoryPressureLevel,
  initMemorySentinel,
  isMemorySentinelEnabled,
  logMemoryProbe,
  shouldDegradeBackgroundWork,
} from './memory-sentinel'

const { procMock } = vi.hoisted(() => ({ procMock: { memoryUsage: () => ({ rss: 0 }) } }))
vi.mock('node:process', () => ({ default: procMock }))

describe('memory-sentinel', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('getMemoryPressureLevel honors forced critical/elevated', () => {
    vi.stubGlobal('localStorage', { getItem: (k: string) => (k === 'settings/debug/force-memory-pressure' ? 'critical' : null) } as unknown as Storage)
    expect(getMemoryPressureLevel()).toBe('critical')

    vi.unstubAllGlobals()
    vi.stubGlobal('localStorage', { getItem: (k: string) => (k === 'settings/debug/force-memory-pressure' ? 'elevated' : null) } as unknown as Storage)
    expect(getMemoryPressureLevel()).toBe('elevated')
  })

  it('getMemoryPressureLevel normal when no signal', () => {
    vi.stubGlobal('localStorage', { getItem: () => null } as unknown as Storage)
    vi.stubGlobal('performance', {} as unknown as Performance)
    procMock.memoryUsage = () => ({ rss: 0 })
    expect(getMemoryPressureLevel()).toBe('normal')
  })

  it('rss elevated/critical', () => {
    vi.stubGlobal('localStorage', { getItem: () => null } as unknown as Storage)
    vi.stubGlobal('performance', {} as unknown as Performance)
    procMock.memoryUsage = () => ({ rss: 2048 * 1024 * 1024 })
    expect(getMemoryPressureLevel()).toBe('elevated')

    vi.unstubAllGlobals()
    vi.stubGlobal('localStorage', { getItem: () => null } as unknown as Storage)
    vi.stubGlobal('performance', {} as unknown as Performance)
    procMock.memoryUsage = () => ({ rss: 3072 * 1024 * 1024 })
    expect(getMemoryPressureLevel()).toBe('critical')
  })

  it('heap ratio elevated/critical', () => {
    vi.stubGlobal('localStorage', { getItem: () => null } as unknown as Storage)
    vi.stubGlobal('performance', { memory: { usedJSHeapSize: 800, totalJSHeapSize: 1000, jsHeapSizeLimit: 1000 } } as unknown as Performance)
    procMock.memoryUsage = () => ({ rss: 0 })
    expect(getMemoryPressureLevel()).toBe('elevated')

    vi.unstubAllGlobals()
    vi.stubGlobal('localStorage', { getItem: () => null } as unknown as Storage)
    vi.stubGlobal('performance', { memory: { usedJSHeapSize: 900, totalJSHeapSize: 1000, jsHeapSizeLimit: 1000 } } as unknown as Performance)
    procMock.memoryUsage = () => ({ rss: 0 })
    expect(getMemoryPressureLevel()).toBe('critical')
  })

  it('shouldDegradeBackgroundWork', () => {
    vi.stubGlobal('localStorage', { getItem: (k: string) => (k === 'settings/debug/force-memory-pressure' ? 'elevated' : null) } as unknown as Storage)
    expect(shouldDegradeBackgroundWork()).toBe(true)
  })

  it('isMemorySentinelEnabled true/false and catch', () => {
    vi.stubGlobal('localStorage', { getItem: () => 'true' } as unknown as Storage)
    expect(isMemorySentinelEnabled()).toBe(true)

    vi.unstubAllGlobals()
    vi.stubGlobal('localStorage', { getItem: () => 'false' } as unknown as Storage)
    expect(isMemorySentinelEnabled()).toBe(false)

    vi.unstubAllGlobals()
    vi.stubGlobal('localStorage', { getItem: () => { throw new Error('x') } } as unknown as Storage)
    expect(isMemorySentinelEnabled()).toBe(false)
  })

  it('isMemorySentinelEnabled returns false when localStorage undefined', () => {
    vi.unstubAllGlobals()
    expect(isMemorySentinelEnabled()).toBe(false)
  })

  it('logMemoryProbe disabled returns', () => {
    vi.stubGlobal('localStorage', { getItem: () => null } as unknown as Storage)
    const info = vi.fn()
    vi.stubGlobal('console', { info, warn: vi.fn() } as unknown as Console)
    logMemoryProbe()
    expect(info).not.toHaveBeenCalled()
  })

  it('logMemoryProbe enabled logs', () => {
    vi.stubGlobal('localStorage', { getItem: (k: string) => (k === 'settings/debug/enable-memory-sentinel' ? 'true' : null) } as unknown as Storage)
    const info = vi.fn()
    const warn = vi.fn()
    vi.stubGlobal('console', { info, warn } as unknown as Console)
    vi.stubGlobal('performance', { memory: { usedJSHeapSize: 10, totalJSHeapSize: 20, jsHeapSizeLimit: 30 } } as unknown as Performance)
    procMock.memoryUsage = () => ({ rss: 1024 * 1024 })
    vi.stubGlobal('window', { location: { hash: '#/x' } } as unknown as Window)
    logMemoryProbe('TAG', { action: 'act', extra: { a: 1 } })
    expect(info).toHaveBeenCalled()

    logMemoryProbe('TAG2')
    expect(info).toHaveBeenCalledTimes(2)
  })

  it('logMemoryProbe catch warns', () => {
    vi.stubGlobal('localStorage', { getItem: () => 'true' } as unknown as Storage)
    procMock.memoryUsage = () => { throw new Error('boom') }
    const warn = vi.fn()
    vi.stubGlobal('console', { info: vi.fn(), warn } as unknown as Console)
    vi.stubGlobal('performance', {} as unknown as Performance)
    const circular: Record<string, unknown> = {}
    circular.self = circular
    logMemoryProbe('TAG', { extra: circular })
    expect(warn).toHaveBeenCalled()
  })

  it('logMemoryProbe window unknown branch', () => {
    vi.stubGlobal('localStorage', { getItem: () => 'true' } as unknown as Storage)
    vi.stubGlobal('window', undefined as unknown as Window)
    const info = vi.fn()
    vi.stubGlobal('console', { info, warn: vi.fn() } as unknown as Console)
    vi.stubGlobal('performance', {} as unknown as Performance)
    procMock.memoryUsage = () => ({ rss: 0 })
    logMemoryProbe()
    expect(info).toHaveBeenCalled()
  })

  it('getMemoryPressureLevel catch on localStorage', () => {
    vi.stubGlobal('localStorage', { getItem: () => { throw new Error('x') } } as unknown as Storage)
    vi.stubGlobal('performance', {} as unknown as Performance)
    procMock.memoryUsage = () => ({ rss: 0 })
    expect(getMemoryPressureLevel()).toBe('normal')
  })

  it('readMemoryMB catch on process memoryUsage', () => {
    vi.stubGlobal('localStorage', { getItem: () => null } as unknown as Storage)
    vi.stubGlobal('performance', {} as unknown as Performance)
    procMock.memoryUsage = () => { throw new Error('boom') }
    expect(getMemoryPressureLevel()).toBe('normal')
  })

  it('initMemorySentinel enabled', () => {
    vi.stubGlobal('localStorage', { getItem: (k: string) => (k === 'settings/debug/enable-memory-sentinel' ? 'true' : null) } as unknown as Storage)
    const cbHolder: { cb?: () => void } = {}
    const setInterval = vi.fn((cb: () => void) => { cbHolder.cb = cb; return 1 as unknown as number })
    vi.stubGlobal('window', { setInterval, location: { hash: '#/' } } as unknown as Window & { setInterval: typeof setInterval })
    vi.stubGlobal('performance', {} as unknown as Performance)
    procMock.memoryUsage = () => ({ rss: 0 })
    const info = vi.fn()
    vi.stubGlobal('console', { info, warn: vi.fn() } as unknown as Console)
    initMemorySentinel(5000)
    expect(setInterval).toHaveBeenCalled()
    cbHolder.cb?.()
    expect(info).toHaveBeenCalled()
  })

  it('initMemorySentinel disabled no-op', () => {
    vi.stubGlobal('localStorage', { getItem: () => null } as unknown as Storage)
    const setInterval = vi.fn()
    vi.stubGlobal('window', { setInterval } as unknown as Window)
    initMemorySentinel()
    expect(setInterval).not.toHaveBeenCalled()
  })
})
