import searchWorkerUrl from './search.worker?worker&url'

import { updateInferenceStatus } from '../../../composables/use-inference-status'
import { getGPUCoordinator, getGpuExecutor } from '../../inference/coordinator'
import { GPU_PRIORITY } from '../../inference/gpu-executor'

let worker: Worker | null = null
let nextId = 1
const pending = new Map<number, { resolve: (val: any) => void, reject: (err: any) => void }>()
let isModelLoaded = false
let isModelLoading = false
let modelLoadPromise: Promise<void> | null = null

export async function getSearchWorker() {
  if (!worker) {
    worker = new Worker(searchWorkerUrl, { type: 'module' })
    worker.addEventListener('message', (e) => {
      const { id, type, results, snapshot, count, error } = e.data
      const promise = pending.get(id)
      if (!promise)
        return

      if (type === 'error') {
        promise.reject(new Error(error))
      }
      else {
        switch (type) {
          case 'results':
            promise.resolve(results)
            break
          case 'snapshot':
            promise.resolve(snapshot)
            break
          case 'indexed':
            promise.resolve(count)
            break
          default:
            promise.resolve(e.data)
        }
      }
      pending.delete(id)
    })
  }
  return worker
}

// NOTICE: abortable worker RPC. ONNX embedding runs cannot be cancelled
// mid-flight inside the worker, but the caller must stop waiting on timeout/
// turn-cancel so orphan GPU work cannot pile up behind stale chat turns.
async function callWorker(type: string, payload?: any, signal?: AbortSignal): Promise<any> {
  if (signal?.aborted)
    throw new DOMException('Aborted', 'AbortError')
  const w = await getSearchWorker()
  const id = nextId++
  return new Promise((resolve, reject) => {
    const onAbort = () => {
      pending.delete(id)
      reject(new DOMException('Aborted', 'AbortError'))
    }
    if (signal) {
      if (signal.aborted)
        return onAbort()
      signal.addEventListener('abort', onAbort, { once: true })
    }
    pending.set(id, {
      resolve: (val: any) => {
        signal?.removeEventListener('abort', onAbort)
        resolve(val)
      },
      reject: (err: any) => {
        signal?.removeEventListener('abort', onAbort)
        reject(err)
      },
    })
    w.postMessage({ id, type, payload })
  })
}

/**
 * Explicitly load the embedding model enqueued via the LoadQueue.
 * Establishes WebGPU device context sequentially.
 */
async function loadEmbeddingModel(): Promise<void> {
  if (isModelLoaded)
    return

  if (isModelLoading && modelLoadPromise) {
    return modelLoadPromise
  }

  isModelLoading = true
  updateInferenceStatus('bge-small-en', { state: 'downloading', device: 'webgpu' })

  modelLoadPromise = getGpuExecutor().run('bge-small-en', GPU_PRIORITY.BG_REMOVAL_LOAD + 1, async () => {
    try {
      await callWorker('load-model')

      // Track VRAM allocation (~100 MB footprint)
      getGPUCoordinator().requestAllocation('bge-small-en', 100 * 1024 * 1024)

      isModelLoaded = true
      updateInferenceStatus('bge-small-en', { state: 'ready', device: 'webgpu' })
    }
    catch (error) {
      updateInferenceStatus('bge-small-en', { state: 'error' })
      throw error
    }
    finally {
      isModelLoading = false
      modelLoadPromise = null
    }
  })

  return modelLoadPromise
}

export const searchWorker = {
  init: (snapshot?: any) => callWorker('init', { snapshot }),
  index: async (documents: any[]) => {
    await loadEmbeddingModel()
    return callWorker('index', { documents })
  },
  search: async (query: string, limit?: number, characterId?: string, temporalHooks?: any[], signal?: AbortSignal, vector?: number[]) => {
    await loadEmbeddingModel()
    return callWorker('search', { query, limit, characterId, temporalHooks, vector }, signal)
  },
  remove: (id: string) => callWorker('remove', { id }),
  persist: () => callWorker('persist'),
}
