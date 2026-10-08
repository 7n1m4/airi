/**
 * GPU resource coordinator.
 *
 * Bookkeeping layer that tracks estimated GPU memory allocation
 * across inference models. Advisory — does not own the actual
 * GPUDevice (workers manage their own via transformers.js).
 *
 * Emits memory pressure events when allocation nears the budget
 * so consumers can decide to unload LRU models or fall back to WASM.
 *
 * Also records device-loss telemetry so adapters can coordinate
 * cross-model WASM fallback decisions.
 */

import type { DeviceLossReason } from './protocol'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type MemoryPressureLevel = 'warning' | 'critical'

export interface AllocationToken {
  modelId: string
  bytes: number
  allocatedAt: number
  lastUsedAt: number
}

export interface GPUResourceUsage {
  /** Total bytes currently allocated (sum of all tokens) */
  allocated: number
  /** Estimated budget in bytes */
  budget: number
  /** Currently loaded model IDs */
  models: string[]
}

export interface DeviceLossEvent {
  modelId: string
  reason: DeviceLossReason
  occurredAt: number
}

export interface DeviceLossMetrics {
  /** Total device-loss events recorded across all models */
  totalCount: number
  /** Per-model device-loss counts */
  byModel: Record<string, number>
  /** Most recent event, or null if none recorded */
  lastEvent: DeviceLossEvent | null
}

/**
 * Unload handler an adapter registers so the coordinator can actively evict
 * its model under critical VRAM pressure or deep standby. `isActive` must
 * report true while the model is executing inference or holding a GPU slot —
 * eviction never interrupts live work (fail-closed when uncertain).
 */
export interface EvictionHandler {
  /** Best-effort unload; may be async. The coordinator releases the token regardless. */
  unload: () => void | Promise<void>
  /** True while eviction is unsafe (executing inference / holding a GPU slot). */
  isActive?: () => boolean
}

export interface GPUResourceCoordinator {
  /**
   * Request an allocation for a model.
   * Returns the token. May trigger memory pressure events if over budget.
   */
  requestAllocation: (modelId: string, estimatedBytes: number) => AllocationToken

  /** Release a previously allocated token */
  release: (token: AllocationToken) => void

  /** Mark a model as recently used (updates LRU ordering) */
  touch: (modelId: string) => void

  /** Get current resource usage */
  getUsage: () => GPUResourceUsage

  /**
   * Get the least-recently-used model ID, or null if none loaded.
   * Useful for deciding which model to unload under pressure.
   */
  getLRUModel: () => string | null

  /**
   * Subscribe to memory pressure events.
   * Returns an unsubscribe function.
   */
  onMemoryPressure: (handler: (level: MemoryPressureLevel) => void) => () => void

  /**
   * Record a WebGPU device-loss event. Adapters call this from their error
   * handlers when they detect a DEVICE_LOST error so the coordinator can
   * maintain cross-model telemetry.
   */
  recordDeviceLoss: (event: DeviceLossEvent) => void

  /** Get current device-loss telemetry across all models */
  getDeviceLossMetrics: () => DeviceLossMetrics

  /**
   * Subscribe to device-loss events. Fired after `recordDeviceLoss()`.
   * Returns an unsubscribe function.
   */
  onDeviceLoss: (handler: (event: DeviceLossEvent) => void) => () => void

  /**
   * Register an unload handler so critical pressure or deep standby can
   * actively evict this model. Replaces any prior handler for `modelId`.
   * Returns an unregister function.
   */
  registerEvictable: (modelId: string, handler: EvictionHandler) => () => void

  /**
   * Evict one model: skip when it has no allocation, no handler, or its
   * `isActive()` reports live work. Otherwise invoke `unload()` best-effort
   * and release its allocation token. Returns true when evicted.
   */
  evictModel: (modelId: string) => boolean

  /**
   * Evict every registered inactive model. Used for deep standby hibernation.
   * Returns the evicted model IDs in eviction order.
   */
  evictInactive: () => string[]
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const WARNING_THRESHOLD = 0.80
const CRITICAL_THRESHOLD = 0.95
const BUDGET_SAFETY_FACTOR = 0.70

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export function createGPUResourceCoordinator(
  estimatedVRAM: number,
): GPUResourceCoordinator {
  const budget = estimatedVRAM > 0 ? estimatedVRAM * BUDGET_SAFETY_FACTOR : Number.POSITIVE_INFINITY
  const allocations = new Map<string, AllocationToken>()
  const evictables = new Map<string, EvictionHandler>()
  const pressureHandlers = new Set<(level: MemoryPressureLevel) => void>()
  const deviceLossHandlers = new Set<(event: DeviceLossEvent) => void>()
  const deviceLossByModel = new Map<string, number>()
  let deviceLossTotal = 0
  let lastDeviceLossEvent: DeviceLossEvent | null = null

  function getAllocated(): number {
    let total = 0
    for (const token of allocations.values())
      total += token.bytes
    return total
  }

  function checkPressure(): void {
    if (budget === Number.POSITIVE_INFINITY)
      return

    const ratio = getAllocated() / budget
    if (ratio >= CRITICAL_THRESHOLD) {
      for (const handler of pressureHandlers)
        handler('critical')
      evictLeastRecentlyUsedInactive()
    }
    else if (ratio >= WARNING_THRESHOLD) {
      for (const handler of pressureHandlers)
        handler('warning')
    }
  }

  // NOTICE: Active OOM mitigation. Telemetry alone never reclaimed VRAM —
  // Chromium holds WebGPU buffers until the worker unloads the model — so a
  // critical event also evicts the oldest registered inactive model. One per
  // event: repeated allocations re-trigger pressure and evict progressively.
  // Models without a handler (or reporting live work) are skipped.
  function evictLeastRecentlyUsedInactive(): void {
    const ordered = Array.from(allocations.values()).sort((a, b) => a.lastUsedAt - b.lastUsedAt)
    for (const token of ordered) {
      const handler = evictables.get(token.modelId)
      if (!handler)
        continue
      let active = false
      try {
        active = handler.isActive?.() ?? false
      }
      catch {
        continue
      }
      if (active)
        continue
      if (evictModel(token.modelId)) {
        console.warn(`[GPUCoordinator] Critical VRAM pressure — evicted LRU model: ${token.modelId}`)
        return
      }
    }
  }

  function requestAllocation(modelId: string, estimatedBytes: number): AllocationToken {
    // If model already allocated, update the byte estimate
    const existing = allocations.get(modelId)
    if (existing) {
      existing.bytes = estimatedBytes
      existing.lastUsedAt = Date.now()
      checkPressure()
      return existing
    }

    const token: AllocationToken = {
      modelId,
      bytes: estimatedBytes,
      allocatedAt: Date.now(),
      lastUsedAt: Date.now(),
    }
    allocations.set(modelId, token)
    checkPressure()
    return token
  }

  function release(token: AllocationToken): void {
    allocations.delete(token.modelId)
  }

  function touch(modelId: string): void {
    const token = allocations.get(modelId)
    if (token)
      token.lastUsedAt = Date.now()
  }

  function getUsage(): GPUResourceUsage {
    return {
      allocated: getAllocated(),
      budget: budget === Number.POSITIVE_INFINITY ? 0 : budget,
      models: Array.from(allocations.keys()),
    }
  }

  function getLRUModel(): string | null {
    let oldest: AllocationToken | null = null
    for (const token of allocations.values()) {
      if (!oldest || token.lastUsedAt < oldest.lastUsedAt)
        oldest = token
    }
    return oldest?.modelId ?? null
  }

  function onMemoryPressure(handler: (level: MemoryPressureLevel) => void): () => void {
    pressureHandlers.add(handler)
    return () => pressureHandlers.delete(handler)
  }

  function recordDeviceLoss(event: DeviceLossEvent): void {
    deviceLossTotal++
    deviceLossByModel.set(event.modelId, (deviceLossByModel.get(event.modelId) ?? 0) + 1)
    lastDeviceLossEvent = event
    for (const handler of deviceLossHandlers)
      handler(event)
  }

  function getDeviceLossMetrics(): DeviceLossMetrics {
    return {
      totalCount: deviceLossTotal,
      byModel: Object.fromEntries(deviceLossByModel),
      lastEvent: lastDeviceLossEvent,
    }
  }

  function onDeviceLoss(handler: (event: DeviceLossEvent) => void): () => void {
    deviceLossHandlers.add(handler)
    return () => deviceLossHandlers.delete(handler)
  }

  function registerEvictable(modelId: string, handler: EvictionHandler): () => void {
    evictables.set(modelId, handler)
    return () => {
      if (evictables.get(modelId) === handler)
        evictables.delete(modelId)
    }
  }

  function evictModel(modelId: string): boolean {
    const token = allocations.get(modelId)
    const handler = evictables.get(modelId)
    if (!token || !handler)
      return false
    try {
      if (handler.isActive?.())
        return false
    }
    catch {
      // NOTICE: Fail closed — when activity state is uncertain, never evict.
      return false
    }
    try {
      const result = handler.unload()
      if (result instanceof Promise)
        result.catch(error => console.warn(`[GPUCoordinator] Background eviction of ${modelId} failed:`, error))
    }
    catch (error) {
      console.warn(`[GPUCoordinator] Background eviction of ${modelId} failed:`, error)
    }
    allocations.delete(modelId)
    return true
  }

  function evictInactive(): string[] {
    const evicted: string[] = []
    for (const modelId of Array.from(evictables.keys())) {
      if (evictModel(modelId))
        evicted.push(modelId)
    }
    return evicted
  }

  return {
    requestAllocation,
    release,
    touch,
    getUsage,
    getLRUModel,
    onMemoryPressure,
    recordDeviceLoss,
    getDeviceLossMetrics,
    onDeviceLoss,
    registerEvictable,
    evictModel,
    evictInactive,
  }
}
