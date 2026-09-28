/**
 * In-App Diagnostic Memory Sentinel & Telemetry Probe
 *
 * Runs inside the Electron renderer process to capture exact subsystem state
 * and memory metrics before/after background events and on periodic intervals.
 * Output is logged with `[MEM-PROBE]` to stdout/airi.log.
 */

export interface SubsystemStats {
  action?: string
  extra?: Record<string, any>
}

export type MemoryPressureLevel = 'normal' | 'elevated' | 'critical'

// NOTICE: thresholds for the watchdog-killer class (native/WebGPU pressure that
// performance.memory cannot see). Defaults are deliberately conservative —
// degradation only kicks in when the renderer is genuinely large, and callers
// must always fall back to a working degraded path (heuristic search, deferred
// indexing), never to a dropped user turn.
const RSS_ELEVATED_MB = 2048
const RSS_CRITICAL_MB = 3072
const HEAP_ELEVATED_RATIO = 0.8
const HEAP_CRITICAL_RATIO = 0.9

let lastHeapMB = 0
let sentinelStarted = false

function readMemoryMB(): { jsHeapUsed: number, jsHeapTotal: number, jsHeapLimit: number, rssMB: number } {
  const perf = (typeof performance !== 'undefined' ? performance : null) as any
  const mem = perf?.memory
  let rssMB = 0
  try {
    const proc = (typeof process !== 'undefined' ? process : null) as any
    rssMB = proc?.memoryUsage?.() ? proc.memoryUsage().rss / (1024 * 1024) : 0
  }
  catch {}
  return {
    jsHeapUsed: mem?.usedJSHeapSize ? mem.usedJSHeapSize / (1024 * 1024) : 0,
    jsHeapTotal: mem?.totalJSHeapSize ? mem.totalJSHeapSize / (1024 * 1024) : 0,
    jsHeapLimit: mem?.jsHeapSizeLimit ? mem.jsHeapSizeLimit / (1024 * 1024) : 0,
    rssMB,
  }
}

function levelOf(level: MemoryPressureLevel, candidate: MemoryPressureLevel): MemoryPressureLevel {
  const rank = { normal: 0, elevated: 1, critical: 2 } as const
  return rank[candidate] > rank[level] ? candidate : level
}

/**
 * Current process memory pressure. Returns 'normal' when no signal is
 * available (blind renderers must not degrade). A manual override via
 * localStorage `settings/debug/force-memory-pressure` ('elevated'/'critical')
 * is honored for testing the degraded paths.
 */
export function getMemoryPressureLevel(): MemoryPressureLevel {
  try {
    if (typeof localStorage !== 'undefined') {
      const forced = localStorage.getItem('settings/debug/force-memory-pressure')
      if (forced === 'critical' || forced === 'elevated')
        return forced
    }
  }
  catch {}
  const { jsHeapUsed, jsHeapLimit, rssMB } = readMemoryMB()
  let level: MemoryPressureLevel = 'normal'
  if (rssMB >= RSS_CRITICAL_MB)
    level = levelOf(level, 'critical')
  else if (rssMB >= RSS_ELEVATED_MB)
    level = levelOf(level, 'elevated')
  if (jsHeapLimit > 0) {
    const ratio = jsHeapUsed / jsHeapLimit
    if (ratio >= HEAP_CRITICAL_RATIO)
      level = levelOf(level, 'critical')
    else if (ratio >= HEAP_ELEVATED_RATIO)
      level = levelOf(level, 'elevated')
  }
  return level
}

/** True when background work (indexing, rerank, OCR pre-warm) should stand down. */
export function shouldDegradeBackgroundWork(): boolean {
  return getMemoryPressureLevel() !== 'normal'
}

export function logMemoryProbe(tag: string = 'TICK', stats?: SubsystemStats): void {
  try {
    const { jsHeapUsed, jsHeapTotal, jsHeapLimit, rssMB } = readMemoryMB()

    const delta = lastHeapMB > 0 ? (jsHeapUsed - lastHeapMB) : 0
    lastHeapMB = jsHeapUsed

    const deltaStr = delta >= 0 ? `+${delta.toFixed(1)} MB` : `${delta.toFixed(1)} MB`
    const winHash = typeof window !== 'undefined' ? (window.location.hash || '#/') : 'unknown'
    // NOTICE: JS heap alone cannot see the watchdog-killer class (WebGPU Dawn,
    // ONNX WASM, IndexedDB snapshots, compressor segments). Include Node/Electron
    // RSS plus the pressure level so airi.log shows native pressure alongside V8.
    const nativeStr = rssMB > 0 ? ` | RSS: ${rssMB.toFixed(0)} MB` : ''
    const pressureStr = ` | Pressure: ${getMemoryPressureLevel()}`
    const extraStr = stats?.extra ? ` | Details: ${JSON.stringify(stats.extra)}` : ''
    const actionStr = stats?.action ? ` | Action: [${stats.action}]` : ''

    console.log(
      `[MEM-PROBE] [${tag}] Route: "${winHash}" | JS Heap: ${jsHeapUsed.toFixed(1)} MB / ${jsHeapTotal.toFixed(1)} MB (Limit: ${jsHeapLimit.toFixed(0)} MB, Δ: ${deltaStr})${nativeStr}${pressureStr}${actionStr}${extraStr}`,
    )
  }
  catch (err) {
    console.warn('[MEM-PROBE] Failed to log memory stats:', err)
  }
}

export function initMemorySentinel(intervalMs = 10000): void {
  if (sentinelStarted)
    return
  sentinelStarted = true

  // Initial boot log
  logMemoryProbe('INIT', { action: 'App startup & sentinel initialization' })

  // Periodic heartbeat log
  if (typeof window !== 'undefined') {
    window.setInterval(() => {
      logMemoryProbe('PERIODIC')
    }, intervalMs)
  }
}
