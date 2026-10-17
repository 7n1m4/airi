/**
 * Voice Activity Detection (VAD) inference adapter.
 *
 * Offloads silero-vad inference to a Web Worker so the main
 * thread is not blocked during real-time speech detection.
 * Uses the unified inference protocol from protocol.ts.
 */

import type { VADInput, VADOutput } from '../../../workers/vad/vad.worker'
import type { AllocationToken } from '../gpu-resource-coordinator'
import type { ProgressPayload } from '../protocol'

import { Mutex } from 'async-mutex'

import { removeInferenceStatus, updateInferenceStatus } from '../../../composables/use-inference-status'
import { getGPUCoordinator, getGpuExecutor } from '../coordinator'
import { GPU_PRIORITY } from '../gpu-executor'
import { createRequestId, InferenceAbortError, throwIfAborted } from '../protocol'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface VADAdapter {
  /**
   * Load the Silero VAD model in the worker.
   * Must be called before `detectSpeech()`.
   * Pass `options.signal` to cancel; rejects with `InferenceAbortError`.
   */
  load: (
    onProgress?: (p: ProgressPayload) => void,
    options?: { signal?: AbortSignal },
  ) => Promise<void>

  /**
   * Run speech detection on an audio chunk.
   * Returns a promise of the speech probability.
   */
  detectSpeech: (
    buffer: Float32Array,
    sampleRate: number,
    options?: { signal?: AbortSignal },
  ) => Promise<number>

  /** Terminate the worker */
  terminate: () => void

  /** Current state */
  readonly state: 'idle' | 'loading' | 'ready' | 'processing' | 'error' | 'terminated'
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const LOAD_TIMEOUT = 120_000
const INFERENCE_TIMEOUT = 10_000

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export function createVADAdapter(): VADAdapter {
  let worker: Worker | null = null
  let state: VADAdapter['state'] = 'idle'
  let allocationToken: AllocationToken | null = null
  let errorListener: ((event: Event) => void) | null = null

  const operationMutex = new Mutex()

  function destroyWorker(): void {
    if (worker) {
      if (errorListener)
        worker.removeEventListener('error', errorListener)
      errorListener = null
      worker.terminate()
      worker = null
    }
  }

  function ensureWorker(): Worker {
    if (!worker) {
      worker = new Worker(
        new URL('../../../workers/vad/vad.worker.ts', import.meta.url),
        { type: 'module' },
      )
      errorListener = (_event: Event) => {
        state = 'error'
        operationMutex.cancel()
      }
      worker.addEventListener('error', errorListener)
    }
    return worker
  }

  /**
   * Wait for a specific message type from the worker, filtered by requestId.
   * Uses the unified protocol message types.
   */
  function waitForMessage<T = any>(
    w: Worker,
    requestId: string,
    targetType: string,
    timeout: number,
    onOther?: (data: any) => void,
    signal?: AbortSignal,
  ): Promise<T> {
    return new Promise((resolve, reject) => {
      let timeoutId: ReturnType<typeof setTimeout> | undefined
      let abortListener: (() => void) | null = null

      function handler(event: MessageEvent): void {
        if (event.data.requestId !== requestId)
          return

        if (event.data.type === targetType) {
          cleanup()
          resolve(event.data as T)
        }
        else if (event.data.type === 'error') {
          cleanup()
          const code = event.data.payload?.code
          if (code === 'CANCELLED')
            reject(new InferenceAbortError(event.data.payload?.message))
          else
            reject(new Error(event.data.payload?.message ?? 'Worker error'))
        }
        else {
          onOther?.(event.data)
        }
      }

      function cleanup(): void {
        clearTimeout(timeoutId)
        w.removeEventListener('message', handler)
        if (abortListener && signal)
          signal.removeEventListener('abort', abortListener)
      }

      w.addEventListener('message', handler)

      timeoutId = setTimeout(() => {
        cleanup()
        reject(new Error(`VAD: timeout after ${timeout}ms`))
      }, timeout)

      if (signal) {
        if (signal.aborted) {
          cleanup()
          w.postMessage({ type: 'cancel', requestId: createRequestId(), targetRequestId: requestId })
          reject(new InferenceAbortError(typeof signal.reason === 'string' ? signal.reason : undefined))
          return
        }
        abortListener = () => {
          cleanup()
          w.postMessage({ type: 'cancel', requestId: createRequestId(), targetRequestId: requestId })
          const reason = signal.reason
          reject(reason instanceof Error ? reason : new InferenceAbortError(typeof reason === 'string' ? reason : undefined))
        }
        signal.addEventListener('abort', abortListener)
      }
    })
  }

  async function load(
    onProgress?: (p: ProgressPayload) => void,
    options?: { signal?: AbortSignal },
  ): Promise<void> {
    throwIfAborted(options?.signal)
    return operationMutex.runExclusive(async () => {
      throwIfAborted(options?.signal)
      state = 'loading'
      updateInferenceStatus('silero-vad', { state: 'downloading', device: 'wasm' })

      return getGpuExecutor().run('silero-vad', GPU_PRIORITY.STT_LOAD + 1, async () => {
        throwIfAborted(options?.signal)
        const w = ensureWorker()
        const requestId = createRequestId()

        const loadedPromise = waitForMessage(w, requestId, 'model-ready', LOAD_TIMEOUT, (data) => {
          if (data.type === 'progress' && onProgress) {
            const payload = data.payload
            onProgress({
              phase: payload.phase ?? 'download',
              percent: payload.percent ?? -1,
              message: payload.message,
              file: payload.file,
              loaded: payload.loaded,
              total: payload.total,
            })
          }
        }, options?.signal)

        w.postMessage({ type: 'load-model', requestId, modelId: 'silero-vad', device: 'wasm' })

        let loadedResponse: any
        try {
          loadedResponse = await loadedPromise
        }
        catch (error) {
          state = 'error'
          updateInferenceStatus('silero-vad', { state: 'error' })
          throw error
        }

        const actualDevice = loadedResponse?.device ?? 'wasm'

        // Track GPU/WASM memory allocation (Silero is tiny, ~2 MB footprint)
        const coordinator = getGPUCoordinator()
        if (allocationToken)
          coordinator.release(allocationToken)
        allocationToken = coordinator.requestAllocation(
          'silero-vad',
          2 * 1024 * 1024,
        )

        state = 'ready'
        updateInferenceStatus('silero-vad', { state: 'ready', device: actualDevice })
      }, { signal: options?.signal })
    })
  }

  async function detectSpeech(
    buffer: Float32Array,
    sampleRate: number,
    options?: { signal?: AbortSignal },
  ): Promise<number> {
    throwIfAborted(options?.signal)
    return operationMutex.runExclusive(async () => {
      throwIfAborted(options?.signal)
      if (!worker || (state !== 'ready' && state !== 'processing'))
        throw new Error('Model not loaded. Call load() first.')

      state = 'processing'
      const requestId = createRequestId()

      const resultPromise = waitForMessage<any>(
        worker,
        requestId,
        'inference-result',
        INFERENCE_TIMEOUT,
        undefined,
        options?.signal,
      )

      // Transferable buffer optimization to prevent main thread blocking copy overhead
      const bufferCopy = new Float32Array(buffer)
      worker.postMessage(
        {
          type: 'run-inference',
          requestId,
          input: {
            buffer: bufferCopy,
            sampleRate,
          } as VADInput,
        },
        [bufferCopy.buffer],
      )

      let result: any
      try {
        result = await resultPromise
      }
      catch (error) {
        state = 'ready'
        throw error
      }

      state = 'ready'
      const output = result.output as VADOutput
      return output.speechProb
    })
  }

  function terminateAdapter(): void {
    operationMutex.cancel()
    destroyWorker()
    if (allocationToken) {
      removeInferenceStatus('silero-vad')
      getGPUCoordinator().release(allocationToken)
      allocationToken = null
    }
    state = 'terminated'
  }

  return {
    load,
    detectSpeech,
    terminate: terminateAdapter,
    get state() { return state },
  }
}
