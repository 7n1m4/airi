/**
 * Background removal Web Worker entry point.
 *
 * Runs jellybox/isnet-anime (anime-native segmentation) off the main thread
 * via a raw onnxruntime-web session (laya-worker pattern — the repo ships a
 * bare `isnet-anime_1024.onnx` with no transformers config, so AutoModel
 * cannot load it).
 * Speaks the Eventa inference contract (see `libs/inference/contract.ts`):
 * load is a server-streaming invoke (download progress chunks then a terminal
 * `ready`); process is a unary invoke that transfers the raw mask buffer back
 * zero-copy.
 */

import type { InferenceDevice, LoadModelRequest, LoadStreamItem } from '../../libs/inference/contract'

import { RawImage, Tensor } from '@huggingface/transformers'
import { defineInvokeHandler, defineStreamInvokeHandler, toStreamHandler, withTransfer } from '@moeru/eventa'
import { createContext } from '@moeru/eventa/adapters/webworkers/worker'

import * as ort from 'onnxruntime-web/webgpu'

import { BG_REMOVAL_CACHE_NAME } from '../../libs/inference/cache-utils'
import {
  backgroundRemovalLoadEvent,
  backgroundRemovalProcessEvent,
  backgroundRemovalUnloadEvent,
} from '../../libs/inference/contract'

const { context } = createContext()

export const BGREMOVAL_HF_REPO = 'jellybox/isnet-anime'
export const BGREMOVAL_MODEL_FILE = 'isnet-anime_1024.onnx'
export const BGREMOVAL_INPUT_SIZE = 1024

let session: ort.InferenceSession | null = null
let sessionInputName = 'img'
let sessionOutputName = 'mask'
let resolvedDevice: InferenceDevice = 'webgpu'

/**
 * Detect whether WebGPU is available inside the worker.
 */
async function detectWebGPUInWorker(): Promise<boolean> {
  try {
    if (typeof navigator === 'undefined' || !navigator.gpu)
      return false
    const adapter = await navigator.gpu.requestAdapter()
    return adapter != null
  }
  catch {
    return false
  }
}

function ensureOrtConfigured(): void {
  if (!ort.env?.wasm)
    return
  ort.env.wasm.wasmPaths = 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.24.2/dist/'
  const isolated = typeof crossOriginIsolated !== 'undefined' && crossOriginIsolated
  const cores = typeof navigator !== 'undefined' ? (navigator.hardwareConcurrency || 4) : 4
  // NOTICE: threaded build requires SharedArrayBuffer + COOP/COEP.
  ort.env.wasm.numThreads = isolated ? Math.min(4, cores) : 1
  ort.env.wasm.simd = true
  ort.env.wasm.proxy = false
}

ensureOrtConfigured()

async function downloadFile(fileName: string, onProgress?: (loaded: number, total: number) => void): Promise<void> {
  const fileUrl = `https://huggingface.co/${BGREMOVAL_HF_REPO}/resolve/main/${fileName}`
  const cache = await caches.open(BG_REMOVAL_CACHE_NAME)
  const res = await fetch(fileUrl, { redirect: 'follow' })
  if (!res.ok || !res.body)
    throw new Error(`Failed to download ${fileName}: HTTP ${res.status}`)
  const total = Number(res.headers.get('content-length')) || 0
  const reader = res.body.getReader()
  const chunks: Uint8Array[] = []
  let received = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done)
      break
    chunks.push(value)
    received += value.length
    onProgress?.(received, total)
  }
  const blob = new Blob(chunks as BlobPart[], { type: 'application/octet-stream' })
  await cache.put(fileUrl, new Response(blob, {
    headers: { 'content-length': String(received), 'content-type': 'application/octet-stream' },
  }))
}

defineStreamInvokeHandler(context, backgroundRemovalLoadEvent, toStreamHandler<LoadModelRequest, LoadStreamItem>(async ({ payload, emit }) => {
  if (session) {
    emit({ kind: 'ready', info: { device: resolvedDevice } })
    return
  }

  const requestedDevice = payload.device ?? 'webgpu'
  // NOTICE: IS-Net anime is WebGPU-only. Its graph contains a ceil-mode
  // MaxPool whose shape inference the WASM EP does not implement
  // ("using ceil() in shape computation is not yet supported"), so any
  // non-WebGPU execution would download + compile 176 MB only to fail
  // deterministically on the first forward. Fail fast instead.
  const hasWebGPU = requestedDevice === 'webgpu' ? await detectWebGPUInWorker() : false
  if (!hasWebGPU) {
    throw new Error(
      'Background removal requires WebGPU, which is not available in this browser context. '
      + 'Use a Chromium-based browser with hardware acceleration enabled.',
    )
  }
  const device: InferenceDevice = 'webgpu'
  resolvedDevice = device

  ensureOrtConfigured()

  const fileUrl = `https://huggingface.co/${BGREMOVAL_HF_REPO}/resolve/main/${BGREMOVAL_MODEL_FILE}`
  const cache = await caches.open(BG_REMOVAL_CACHE_NAME)
  let match = await cache.match(fileUrl)
  if (!match) {
    await downloadFile(BGREMOVAL_MODEL_FILE, (loaded, total) => emit({
      kind: 'progress',
      payload: {
        phase: 'download',
        percent: total > 0 ? Math.round((loaded / total) * 100) : -1,
        message: BGREMOVAL_MODEL_FILE,
        file: BGREMOVAL_MODEL_FILE,
        loaded,
        total,
      },
    }))
    match = await cache.match(fileUrl)
    if (!match)
      throw new Error('Failed to retrieve IS-Net model from cache after download.')
  }
  const buffer = await match.arrayBuffer()
  if (buffer.byteLength < 50_000_000) {
    await cache.delete(fileUrl)
    throw new Error(`Cached IS-Net model truncated (${buffer.byteLength} bytes, expected ~176 MB). Evicted; retry load.`)
  }

  emit({ kind: 'progress', payload: { phase: 'compile', percent: -1, message: `Compiling ${BGREMOVAL_MODEL_FILE} (${device})...` } })
  // NOTICE: webgpu-only by design (see the device gate above). Never append
  // 'wasm': ORT would silently partition the ceil-mode MaxPool onto it and
  // fail at first run with an inscrutable error.
  const executionProviders: string[] = ['webgpu']
  session = await ort.InferenceSession.create(new Uint8Array(buffer), { executionProviders })
  // IS-Net's validated IO names (see neural-runtime 08-isnet-anime test).
  sessionInputName = session.inputNames[0] ?? 'img'
  sessionOutputName = session.outputNames[0] ?? 'mask'

  emit({ kind: 'ready', info: { device: resolvedDevice } })
}))

defineInvokeHandler(context, backgroundRemovalProcessEvent, async ({ imageData, width, height }) => {
  if (!session)
    throw new Error('Model not loaded. Send load first.')

  // IS-Net preprocessing (validated end-to-end): resize to 1024, plain RGB
  // float32 in [0, 1]. No mean/std, no BGR swap.
  const img = new RawImage(imageData, width, height, 4)
  const resized = await img.resize(BGREMOVAL_INPUT_SIZE, BGREMOVAL_INPUT_SIZE)
  const rgb = resized.data
  const N = BGREMOVAL_INPUT_SIZE * BGREMOVAL_INPUT_SIZE
  const input = new Float32Array(3 * N)
  for (let i = 0; i < N; i++) {
    input[i] = rgb[i * 4]! / 255
    input[N + i] = rgb[i * 4 + 1]! / 255
    input[2 * N + i] = rgb[i * 4 + 2]! / 255
  }
  const tensor = new ort.Tensor('float32', input, [1, 3, BGREMOVAL_INPUT_SIZE, BGREMOVAL_INPUT_SIZE])

  const output = await session.run({ [sessionInputName]: tensor })
  const maskTensor = output[sessionOutputName]
  if (!maskTensor)
    throw new Error(`IS-Net output "${sessionOutputName}" missing from session results.`)

  // Mask is float32 in [0, 1] (validated) at 1024; scale to uint8 and resize
  // back to source dimensions like the previous pipeline.
  const maskData = maskTensor.data as Float32Array
  const u8 = new Uint8ClampedArray(maskData.length)
  for (let i = 0; i < maskData.length; i++)
    u8[i] = Math.max(0, Math.min(255, Math.round(maskData[i]! * 255)))
  // Raw ORT outputs keep the batch dim ([1,1,1024,1024]); transformers'
  // Tensor requires exactly [C,H,W], so squeeze leading singletons first.
  const maskDims = (maskTensor.dims as number[]).slice()
  while (maskDims.length > 3 && maskDims[0] === 1)
    maskDims.shift()
  const mask = await RawImage.fromTensor(
    new Tensor('uint8', u8, maskDims),
  ).resize(width, height)

  const outMask = new Uint8Array(mask.data.buffer)

  // Transfer the mask buffer directly — avoids copying.
  return withTransfer({ maskData: outMask, width, height }, [outMask.buffer])
})

defineInvokeHandler(context, backgroundRemovalUnloadEvent, () => {
  // NOTICE: ort exposes no session dispose here; dropping refs lets the
  // worker GC tensors, while host.terminate() reclaims the WASM SAB itself.
  session = null
})
