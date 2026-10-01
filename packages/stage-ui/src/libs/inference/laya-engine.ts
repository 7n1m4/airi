/**
 * Local Laya (System 1 Decision Engine) facade.
 *
 * Inference now runs in `workers/laya/worker.ts` behind
 * `adapters/laya.ts` (`createGpuWorkerHost`: TTL, LRU eviction, OOM
 * circuit-breaker; `worker.terminate()` reclaims the WASM SharedArrayBuffer).
 * This module keeps the historical exports (CacheStorage downloads, session
 * shims, `runLayaSystemOne`) so providers and settings UI keep working while
 * the main thread never imports `onnxruntime-web`.
 */

import { LAYA_CACHE_NAME } from './cache-utils'

export const LAYA_HF_REPO = 'tozp/laya-onnx'
export const LAYA_INT8_MODEL_FILE = 'model_int8.onnx'
export const LAYA_FP16_MODEL_FILE = 'model_fp16.onnx'

export const LAYA_BUNDLE_FILES = [
  LAYA_INT8_MODEL_FILE,
  'tokenizer.json',
  'tokenizer_config.json',
  'rl_agent_config.json',
] as const

export interface LayaDownloadProgress {
  file: string
  loaded: number
  total: number
  percentage: number
}

export interface LayaSessionOptions {
  useWebGpu?: boolean
}

export async function isLayaDownloaded(precision: 'int8' | 'fp16' = 'int8'): Promise<boolean> {
  if (typeof caches === 'undefined')
    return false

  try {
    const has = await caches.has(LAYA_CACHE_NAME)
    if (!has)
      return false
    const cache = await caches.open(LAYA_CACHE_NAME)
    const targetFile = precision === 'fp16' ? LAYA_FP16_MODEL_FILE : LAYA_INT8_MODEL_FILE
    const fileUrl = `https://huggingface.co/${LAYA_HF_REPO}/resolve/main/${targetFile}`
    const match = await cache.match(fileUrl)
    if (!match)
      return false

    const contentLength = Number(match.headers.get('content-length')) || 0
    if (contentLength > 0)
      return contentLength > 50_000_000

    const blob = await match.clone().blob()
    return blob.size > 50_000_000
  }
  catch {
    return false
  }
}

export async function downloadLayaModel(options?: {
  precision?: 'int8' | 'fp16'
  onProgress?: (progress: LayaDownloadProgress) => void
}): Promise<void> {
  if (typeof caches === 'undefined') {
    throw new TypeError('Cache Storage API is not supported in this environment.')
  }

  const precision = options?.precision ?? 'int8'
  const modelFile = precision === 'fp16' ? LAYA_FP16_MODEL_FILE : LAYA_INT8_MODEL_FILE
  const filesToDownload = [
    modelFile,
    'tokenizer.json',
    'tokenizer_config.json',
    'rl_agent_config.json',
  ]

  const cache = await caches.open(LAYA_CACHE_NAME)

  for (const fileName of filesToDownload) {
    const fileUrl = `https://huggingface.co/${LAYA_HF_REPO}/resolve/main/${fileName}`
    const cacheMatch = await cache.match(fileUrl)

    if (cacheMatch) {
      if (fileName.endsWith('.onnx')) {
        const cl = Number(cacheMatch.headers.get('content-length')) || 0
        let size = cl
        if (size <= 0) {
          const b = await cacheMatch.clone().blob()
          size = b.size
        }
        if (size < 50_000_000) {
          console.warn(`[LayaEngine] Existing cache entry for ${fileName} is truncated (${size} bytes). Evicting...`)
          await cache.delete(fileUrl)
        }
        else {
          options?.onProgress?.({ file: fileName, loaded: size, total: size, percentage: 100 })
          continue
        }
      }
      else {
        options?.onProgress?.({ file: fileName, loaded: 1, total: 1, percentage: 100 })
        continue
      }
    }

    const response = await fetch(fileUrl, { redirect: 'follow' })
    if (!response.ok || !response.body) {
      throw new Error(`Failed to download ${fileName}: HTTP ${response.status} ${response.statusText}`)
    }

    const contentLength = Number(response.headers.get('content-length')) || 0
    const reader = response.body.getReader()
    const chunks: Uint8Array[] = []
    let receivedBytes = 0

    while (true) {
      const { done, value } = await reader.read()
      if (done)
        break
      chunks.push(value)
      receivedBytes += value.length
      const percentage = contentLength > 0
        ? Math.min(100, Math.round((receivedBytes / contentLength) * 100))
        : 0

      options?.onProgress?.({ file: fileName, loaded: receivedBytes, total: contentLength, percentage })
    }

    if (contentLength > 0 && receivedBytes < contentLength) {
      throw new Error(`Download of ${fileName} was interrupted: received ${receivedBytes} of ${contentLength} bytes.`)
    }

    const fullBlob = new Blob(chunks as BlobPart[], { type: 'application/octet-stream' })
    const cachedResponse = new Response(fullBlob, {
      headers: {
        'content-length': String(receivedBytes),
        'content-type': 'application/octet-stream',
      },
    })
    await cache.put(fileUrl, cachedResponse)
  }
}

export async function deleteLayaModel(): Promise<void> {
  if (typeof caches !== 'undefined') {
    await caches.delete(LAYA_CACHE_NAME)
  }
}

// NOTICE: Historical main-thread ORT configurator. ORT is now configured
// inside the worker; kept as a no-op for import compatibility.
export function ensureOrtConfigured(): void {}

export async function withLayaSessionLock<T>(task: () => Promise<T>): Promise<T> {
  return task()
}

// Compatibility shim: ensures the worker model is loaded. No session object
// crosses threads; the worker owns it.
export async function loadLayaSession(
  precision: 'int8' | 'fp16' = 'int8',
  options?: LayaSessionOptions,
): Promise<void> {
  const { getLayaAdapter } = await import('./adapters/laya')
  const adapter = await getLayaAdapter()
  await adapter.load(precision, { useWebGpu: options?.useWebGpu })
}

export async function loadLayaTokenizer(): Promise<null> {
  return null
}

// Drops the worker session (frees WASM tensors); the host TTL + eviction
// then terminates the worker to reclaim the SharedArrayBuffer.
export async function resetLayaSession(): Promise<void> {
  const { getLayaAdapter } = await import('./adapters/laya')
  const adapter = await getLayaAdapter()
  await adapter.unload().catch(() => {})
}

export async function terminateLayaWorker(): Promise<void> {
  const { getLayaAdapter } = await import('./adapters/laya')
  const adapter = await getLayaAdapter()
  adapter.terminate()
}

export async function runLayaSystemOne(
  state: any,
  questions: Record<string, any>,
  precision: 'int8' | 'fp16' = 'int8',
  options?: LayaSessionOptions,
): Promise<{
  model: string
  answers: Record<string, any>
  usage: { input_tokens: number, output_tokens: number }
  latency_ms: number
}> {
  const qids = Object.keys(questions)
  if (qids.length === 0)
    throw new Error('runLayaSystemOne: at least one question is required')
  const { getLayaAdapter } = await import('./adapters/laya')
  const adapter = await getLayaAdapter()
  return adapter.decide(state, questions, precision, { useWebGpu: options?.useWebGpu })
}
