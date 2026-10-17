/**
 * Needle 2 inference client adapter.
 *
 * Provides a typed interface to the Needle 2 Web Worker:
 * - Cache status and manual pre-warming / preparation with progress reporting
 * - Task 2: Fast-path probe on user prompt at t = 0 racing against TTFT
 * - Task 3: Background extraction on streaming CoT reasoning buffer ahead of interval cadence
 */

import { isNeedleModelCached } from '../cache-utils'

export interface NeedleClient {
  isReady: () => boolean
  isPreparing: () => boolean
  isCached: () => Promise<boolean>
  prepare: (onProgress?: (ratio: number) => void) => Promise<boolean>
  probeInitialReaction: (userPrompt: string, budgetMs?: number) => Promise<string | null>
  probeCotPivot: (reasoningSnippet: string, budgetMs?: number) => Promise<string | null>
  terminate: () => void
}

let workerInstance: Worker | null = null
let isInitialized = false
let isPreparingInternal = false
let preparePromise: Promise<boolean> | null = null

function createRequestId(): string {
  return `needle-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

function ensureWorker(): Worker | null {
  if (typeof Worker === 'undefined')
    return null
  if (!workerInstance) {
    try {
      workerInstance = new Worker(
        new URL('../../../workers/needle/worker.ts', import.meta.url),
        { type: 'module' },
      )
    }
    catch (err) {
      console.warn('[NeedleClient] Failed to instantiate worker:', err)
      return null
    }
  }
  return workerInstance
}

export function createNeedleClient(): NeedleClient {
  function isReady(): boolean {
    return isInitialized
  }

  function isPreparing(): boolean {
    return isPreparingInternal
  }

  async function isCached(): Promise<boolean> {
    return await isNeedleModelCached()
  }

  async function prepare(onProgress?: (ratio: number) => void): Promise<boolean> {
    if (isInitialized) {
      onProgress?.(1.0)
      return true
    }

    if (preparePromise) {
      return preparePromise
    }

    const worker = ensureWorker()
    if (!worker) {
      isInitialized = true
      onProgress?.(1.0)
      return true
    }

    isPreparingInternal = true
    const requestId = createRequestId()

    let resolvePrepare: (ok: boolean) => void = () => {}
    let timeoutId: NodeJS.Timeout | undefined

    const promise = new Promise<boolean>((resolve) => {
      resolvePrepare = resolve
    })

    // Keep a narrowed alias in scope for the closures below: TypeScript does not
    // retain the `if (!worker) return` guard inside function declarations.
    const workerRef = worker

    function cleanup() {
      clearTimeout(timeoutId)
      workerRef.removeEventListener('message', handler)
      isPreparingInternal = false
      preparePromise = null
    }

    function handler(event: MessageEvent) {
      const data = event.data || {}
      if (data.requestId !== requestId)
        return

      if (data.type === 'progress') {
        if (typeof data.ratio === 'number') {
          onProgress?.(data.ratio)
        }
      }
      else if (data.type === 'ready') {
        isInitialized = true
        cleanup()
        onProgress?.(1.0)
        resolvePrepare(Boolean(data.ok))
      }
      else if (data.type === 'error') {
        console.warn('[NeedleClient] Worker prepare error:', data.message)
        // Fallback to ready state so pacing doesn't stall
        isInitialized = true
        cleanup()
        resolvePrepare(false)
      }
    }

    // Safety timeout (e.g. 60s for download)
    workerRef.addEventListener('message', handler)
    timeoutId = setTimeout(() => {
      console.warn('[NeedleClient] Prepare timed out, marking fallback ready')
      isInitialized = true
      cleanup()
      resolvePrepare(false)
    }, 60000)

    workerRef.postMessage({ type: 'prepare', requestId })

    preparePromise = promise

    return promise
  }

  async function probeInitialReaction(userPrompt: string, budgetMs: number = 1200): Promise<string | null> {
    if (!userPrompt || !userPrompt.trim())
      return null

    const worker = ensureWorker()
    if (!worker) {
      // In non-worker environments (e.g. tests), return immediate fallback candidate
      return 'Let me see...'
    }

    // Active inference bailout: If Needle is not prepared yet, do not kick off heavy 14MB download and WASM
    // compilation during an active streaming turn. Return null and let Tier 3 (heuristics/regex) handle it.
    if (!isInitialized) {
      return null
    }

    const requestId = createRequestId()

    let resolveProbe: (value: string | null) => void = () => {}
    let timeoutId: NodeJS.Timeout | undefined

    const promise = new Promise<string | null>((resolve) => {
      resolveProbe = resolve
    })

    // Keep a narrowed alias in scope for the closures below: TypeScript does not
    // retain the `if (!worker) return` guard inside function declarations.
    const workerRef = worker

    function cleanup() {
      clearTimeout(timeoutId)
      workerRef.removeEventListener('message', handler)
    }

    function handler(event: MessageEvent) {
      const data = event.data || {}
      if (data.requestId !== requestId)
        return

      if (data.type === 'response')
        resolveProbe(data.text || null)
      else if (data.type === 'error')
        resolveProbe(null)
    }

    workerRef.addEventListener('message', handler)
    timeoutId = setTimeout(() => {
      cleanup()
      resolveProbe(null)
    }, budgetMs)

    workerRef.postMessage({ type: 'probe_initial_reaction', requestId, prompt: userPrompt })

    return promise
  }

  async function probeCotPivot(reasoningSnippet: string, budgetMs: number = 2000): Promise<string | null> {
    if (!reasoningSnippet || reasoningSnippet.length < 15)
      return null

    const worker = ensureWorker()
    if (!worker) {
      return null
    }

    const requestId = createRequestId()

    let resolveProbe: (value: string | null) => void = () => {}
    let timeoutId: NodeJS.Timeout | undefined

    const promise = new Promise<string | null>((resolve) => {
      resolveProbe = resolve
    })

    // Keep a narrowed alias in scope for the closures below: TypeScript does not
    // retain the `if (!worker) return` guard inside function declarations.
    const workerRef = worker

    function cleanup() {
      clearTimeout(timeoutId)
      workerRef.removeEventListener('message', handler)
    }

    function handler(event: MessageEvent) {
      const data = event.data || {}
      if (data.requestId !== requestId)
        return

      if (data.type === 'response')
        resolveProbe(data.text || null)
      else if (data.type === 'error')
        resolveProbe(null)
    }

    workerRef.addEventListener('message', handler)
    timeoutId = setTimeout(() => {
      cleanup()
      resolveProbe(null)
    }, budgetMs)

    workerRef.postMessage({ type: 'probe_cot_pivot', requestId, snippet: reasoningSnippet })

    return promise
  }

  function terminate(): void {
    if (workerInstance) {
      workerInstance.terminate()
      workerInstance = null
      isInitialized = false
      isPreparingInternal = false
      preparePromise = null
    }
  }

  return {
    isReady,
    isPreparing,
    isCached,
    prepare,
    probeInitialReaction,
    probeCotPivot,
    terminate,
  }
}

export const needleClient = createNeedleClient()
