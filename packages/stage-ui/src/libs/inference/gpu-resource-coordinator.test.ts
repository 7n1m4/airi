import { describe, expect, it, vi } from 'vitest'

import { createGPUResourceCoordinator } from './gpu-resource-coordinator'

describe('gpuResourceCoordinator', () => {
  // 1 GB VRAM budget (budget = 1GB * 0.70 = 716.8 MB)
  const VRAM = 1024 * 1024 * 1024

  it('should track allocations and report usage', () => {
    const coordinator = createGPUResourceCoordinator(VRAM)

    const token = coordinator.requestAllocation('model-a', 200 * 1024 * 1024)

    const usage = coordinator.getUsage()
    expect(usage.allocated).toBe(200 * 1024 * 1024)
    expect(usage.models).toContain('model-a')
    expect(usage.budget).toBeGreaterThan(0)

    coordinator.release(token)
    expect(coordinator.getUsage().allocated).toBe(0)
    expect(coordinator.getUsage().models).toEqual([])
  })

  it('should emit warning when allocation exceeds 80% of budget', () => {
    const coordinator = createGPUResourceCoordinator(VRAM)
    const handler = vi.fn()
    coordinator.onMemoryPressure(handler)

    // Budget is ~716.8 MB. 80% = ~573 MB. Allocate 600 MB to trigger warning.
    coordinator.requestAllocation('big-model', 600 * 1024 * 1024)

    expect(handler).toHaveBeenCalledWith('warning')
  })

  it('should emit critical when allocation exceeds 95% of budget', () => {
    const coordinator = createGPUResourceCoordinator(VRAM)
    const handler = vi.fn()
    coordinator.onMemoryPressure(handler)

    // 95% of 716.8 MB ≈ 681 MB
    coordinator.requestAllocation('huge-model', 700 * 1024 * 1024)

    expect(handler).toHaveBeenCalledWith('critical')
  })

  it('should not emit pressure when VRAM is unknown (Infinity budget)', () => {
    const coordinator = createGPUResourceCoordinator(0)
    const handler = vi.fn()
    coordinator.onMemoryPressure(handler)

    coordinator.requestAllocation('model', 999 * 1024 * 1024 * 1024) // 999 GB
    expect(handler).not.toHaveBeenCalled()
  })

  it('should track LRU model correctly', () => {
    const coordinator = createGPUResourceCoordinator(VRAM)

    // Allocate both models
    const oldToken = coordinator.requestAllocation('old', 100 * 1024 * 1024)
    const newToken = coordinator.requestAllocation('new', 100 * 1024 * 1024)

    // Manually set timestamps to ensure deterministic ordering
    oldToken.lastUsedAt = 1000
    newToken.lastUsedAt = 2000

    expect(coordinator.getLRUModel()).toBe('old')

    // Touch the old one — now it's the freshest
    coordinator.touch('old')
    expect(coordinator.getLRUModel()).toBe('new')
  })

  it('should update allocation if model already exists', () => {
    const coordinator = createGPUResourceCoordinator(VRAM)

    coordinator.requestAllocation('model', 100 * 1024 * 1024)
    expect(coordinator.getUsage().allocated).toBe(100 * 1024 * 1024)

    // Re-allocate with different size
    coordinator.requestAllocation('model', 200 * 1024 * 1024)
    expect(coordinator.getUsage().allocated).toBe(200 * 1024 * 1024)
    expect(coordinator.getUsage().models).toEqual(['model'])
  })

  it('should allow unsubscribing from pressure events', () => {
    const coordinator = createGPUResourceCoordinator(VRAM)
    const handler = vi.fn()
    const unsub = coordinator.onMemoryPressure(handler)

    unsub()
    coordinator.requestAllocation('model', 700 * 1024 * 1024)
    expect(handler).not.toHaveBeenCalled()
  })

  describe('eviction registry', () => {
    const MB = 1024 * 1024

    it('auto-evicts the LRU inactive model on critical pressure', () => {
      const coordinator = createGPUResourceCoordinator(VRAM)
      const unloadA = vi.fn()
      const unloadB = vi.fn()

      coordinator.requestAllocation('a', 400 * MB)
      coordinator.registerEvictable('a', { unload: unloadA })
      coordinator.registerEvictable('b', { unload: unloadB })
      // Total 800 MB ≥ 95% of the ~716.8 MB budget → critical → evict LRU ('a').
      coordinator.requestAllocation('b', 400 * MB)

      expect(unloadA).toHaveBeenCalledTimes(1)
      expect(unloadB).not.toHaveBeenCalled()
      expect(coordinator.getUsage().models).toEqual(['b'])
      expect(coordinator.getUsage().allocated).toBe(400 * MB)
    })

    it('skips models reporting live work and evicts the next LRU', () => {
      const coordinator = createGPUResourceCoordinator(VRAM)
      const unloadActive = vi.fn()
      const unloadIdle = vi.fn()

      coordinator.requestAllocation('active', 400 * MB)
      coordinator.registerEvictable('active', { unload: unloadActive, isActive: () => true })
      coordinator.registerEvictable('idle', { unload: unloadIdle, isActive: () => false })
      coordinator.requestAllocation('idle', 400 * MB)

      expect(unloadActive).not.toHaveBeenCalled()
      expect(unloadIdle).toHaveBeenCalledTimes(1)
      expect(coordinator.getUsage().models).toEqual(['active'])
    })

    it('evictModel fails closed without allocation, handler, or on uncertain activity', () => {
      const coordinator = createGPUResourceCoordinator(VRAM)
      const unloadGhost = vi.fn()
      const unloadActive = vi.fn()

      coordinator.registerEvictable('ghost', { unload: unloadGhost })
      expect(coordinator.evictModel('ghost')).toBe(false)
      expect(unloadGhost).not.toHaveBeenCalled()

      expect(coordinator.evictModel('unknown')).toBe(false)

      coordinator.requestAllocation('busy', 100 * MB)
      coordinator.registerEvictable('busy', { unload: unloadActive, isActive: () => true })
      expect(coordinator.evictModel('busy')).toBe(false)
      expect(unloadActive).not.toHaveBeenCalled()

      coordinator.registerEvictable('flaky', {
        unload: vi.fn(),
        isActive: () => { throw new Error('uncertain') },
      })
      coordinator.requestAllocation('flaky', 100 * MB)
      expect(coordinator.evictModel('flaky')).toBe(false)
    })

    it('evictInactive reclaims every idle model for deep standby', () => {
      const coordinator = createGPUResourceCoordinator(VRAM)
      const unloadA = vi.fn()
      const unloadB = vi.fn()

      coordinator.requestAllocation('a', 200 * MB)
      coordinator.requestAllocation('b', 200 * MB)
      coordinator.registerEvictable('a', { unload: unloadA })
      coordinator.registerEvictable('b', { unload: unloadB })

      expect(coordinator.evictInactive()).toEqual(['a', 'b'])
      expect(unloadA).toHaveBeenCalledTimes(1)
      expect(unloadB).toHaveBeenCalledTimes(1)
      expect(coordinator.getUsage().allocated).toBe(0)
    })

    it('unregister removes the handler so later eviction is impossible', () => {
      const coordinator = createGPUResourceCoordinator(VRAM)
      const unload = vi.fn()

      coordinator.requestAllocation('a', 100 * MB)
      const unregister = coordinator.registerEvictable('a', { unload })
      unregister()

      expect(coordinator.evictModel('a')).toBe(false)
      expect(unload).not.toHaveBeenCalled()
      expect(coordinator.evictInactive()).toEqual([])
    })
  })

  describe('device loss telemetry', () => {
    it('should start with zero device-loss metrics', () => {
      const coordinator = createGPUResourceCoordinator(VRAM)
      const metrics = coordinator.getDeviceLossMetrics()

      expect(metrics.totalCount).toBe(0)
      expect(metrics.byModel).toEqual({})
      expect(metrics.lastEvent).toBeNull()
    })

    it('should aggregate device-loss events across models', () => {
      const coordinator = createGPUResourceCoordinator(VRAM)

      coordinator.recordDeviceLoss({ modelId: 'kokoro', reason: 'unknown', occurredAt: 100 })
      coordinator.recordDeviceLoss({ modelId: 'kokoro', reason: 'unknown', occurredAt: 200 })
      coordinator.recordDeviceLoss({ modelId: 'whisper', reason: 'destroyed', occurredAt: 300 })

      const metrics = coordinator.getDeviceLossMetrics()
      expect(metrics.totalCount).toBe(3)
      expect(metrics.byModel).toEqual({ kokoro: 2, whisper: 1 })
      expect(metrics.lastEvent).toEqual({ modelId: 'whisper', reason: 'destroyed', occurredAt: 300 })
    })

    it('should notify subscribers on device-loss events', () => {
      const coordinator = createGPUResourceCoordinator(VRAM)
      const handler = vi.fn()
      coordinator.onDeviceLoss(handler)

      const event = { modelId: 'kokoro', reason: 'unknown' as const, occurredAt: 100 }
      coordinator.recordDeviceLoss(event)

      expect(handler).toHaveBeenCalledTimes(1)
      expect(handler).toHaveBeenCalledWith(event)
    })

    it('should allow unsubscribing from device-loss events', () => {
      const coordinator = createGPUResourceCoordinator(VRAM)
      const handler = vi.fn()
      const unsub = coordinator.onDeviceLoss(handler)

      unsub()
      coordinator.recordDeviceLoss({ modelId: 'x', reason: 'unknown', occurredAt: 1 })

      expect(handler).not.toHaveBeenCalled()
    })
  })
})
