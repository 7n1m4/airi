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

async function callWorker(type: string, payload?: any): Promise<any> {
  const w = await getSearchWorker()
  const id = nextId++
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject })
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
  search: async (query: string, limit?: number, characterId?: string, temporalHooks?: any[]) => {
    await loadEmbeddingModel()
    return callWorker('search', { query, limit, characterId, temporalHooks })
  },
  remove: (id: string) => callWorker('remove', { id }),
  persist: () => callWorker('persist'),
}
