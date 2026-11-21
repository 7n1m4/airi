<script setup lang="ts">
import type { CachedModelInfo, DownloadProgressEvent, HardwareTelemetry, LoadModelResult, PingResponse, TokenStreamEvent } from '@proj-anima/stage-ui/libs/native-ai'

import { formatBytes, NativeAI } from '@proj-anima/stage-ui/libs/native-ai'
import { useClipboard, useLocalStorage } from '@vueuse/core'
import { computed, onMounted, onUnmounted, ref } from 'vue'

// Telemetry State
const isLoading = ref(true)
const telemetry = ref<HardwareTelemetry | null>(null)
const error = ref<string | null>(null)

// Ping / Benchmark State
const isPinging = ref(false)
const pingResult = ref<PingResponse | null>(null)
const pingHistory = ref<number[]>([])

// Model Hub State
interface CuratedModel {
  id: string
  name: string
  repo: string
  filename?: string
  size: string
  category: 'LLM' | 'TTS' | 'Image Gen'
  computeUnit: string
  description: string
}

const curatedModels: CuratedModel[] = [
  {
    id: 'okayuji/Gemma-4-E2B-it-coreml-speculative',
    name: 'Gemma 4 E2B IT (Speculative CoreML)',
    repo: 'okayuji/Gemma-4-E2B-it-coreml-speculative',
    size: '1.7 GB',
    category: 'LLM',
    computeUnit: 'ANE + Metal GPU',
    description: 'Ultra-fast on-device dialogue with speculative draft verification on Apple Neural Engine (~50+ tok/s).',
  },
  {
    id: 'aoiandroid/kokoro-82m-coreml-ios',
    name: 'Kokoro 82M TTS (CoreML iOS)',
    repo: 'aoiandroid/kokoro-82m-coreml-ios',
    filename: 'kokoro_21_5s.mlmodelc',
    size: '85 MB',
    category: 'TTS',
    computeUnit: 'Apple Neural Engine',
    description: 'Sub-100ms neural text-to-speech offloaded directly to the Neural Engine.',
  },
  {
    id: 'apple/coreml-stable-diffusion-v1-5',
    name: 'Stable Diffusion 1.5 (CoreML ANE)',
    repo: 'apple/coreml-stable-diffusion-v1-5',
    filename: 'split_einsum/compiled/TextEncoder.mlmodelc',
    size: '492 MB',
    category: 'Image Gen',
    computeUnit: 'split_einsum ANE',
    description: 'Autonomous Artistry on-device image and journal background generation without servers.',
  },
]

const selectedModelId = ref(curatedModels[0].id)
const selectedModel = computed(() => curatedModels.find(m => m.id === selectedModelId.value) || curatedModels[0])

const hfToken = useLocalStorage('settings/connection/hf-token', '')

const isDownloading = ref(false)
const downloadProgress = ref<DownloadProgressEvent | null>(null)
const cachedModels = ref<CachedModelInfo[]>([])
const isLoadingModel = ref(false)
const isModelResident = ref(false)
const loadedModelInfo = ref<LoadModelResult | null>(null)

// Inference Playground State
const prompt = ref('Introduce yourself as AIRI and express happiness with an emotion cue.')
const maxTokens = ref(45)
const isGenerating = ref(false)
const generatedText = ref('')
const inferenceMetrics = ref<{
  ttftMs: number | null
  currentTps: number
  elapsedMs: number
  tokensReceived: number
  status: 'idle' | 'running' | 'finished' | 'cancelled' | 'error'
}>({
  ttftMs: null,
  currentTps: 0,
  elapsedMs: 0,
  tokensReceived: 0,
  status: 'idle',
})

let stopInferenceFn: (() => Promise<void>) | null = null

// Raw Inspector State
const showRawDiagnostics = ref(false)
const { copy, copied } = useClipboard()

const isNativeEnvironment = computed(() => NativeAI.isNative())

const isSelectedModelCached = computed(() => {
  const sanitized = selectedModel.value.id.replace(/\//g, '_')
  return cachedModels.value.some(m => (m.modelId === sanitized || m.modelId === selectedModel.value.id) && m.isCompiled)
})

async function fetchTelemetry() {
  isLoading.value = true
  error.value = null
  try {
    const data = await NativeAI.getHardwareTelemetry()
    telemetry.value = data
  }
  catch (err: any) {
    console.error('[CoreAILab] Failed to load telemetry:', err)
    error.value = String(err?.message || err)
  }
  finally {
    isLoading.value = false
  }
}

async function runPing() {
  if (isPinging.value)
    return
  isPinging.value = true
  try {
    const res = await NativeAI.ping()
    pingResult.value = res
    if (res.pong) {
      pingHistory.value.push(res.roundtripLatencyMs)
      if (pingHistory.value.length > 8)
        pingHistory.value.shift()
    }
  }
  catch (err: any) {
    console.error('[CoreAILab] Ping failed:', err)
  }
  finally {
    isPinging.value = false
  }
}

async function refreshCachedModels() {
  try {
    const res = await NativeAI.listCachedModels()
    cachedModels.value = res.models || []
  }
  catch (err) {
    console.warn('[CoreAILab] Failed to list cached models:', err)
  }
}

async function handleDownloadModel() {
  if (isDownloading.value)
    return
  isDownloading.value = true
  downloadProgress.value = {
    modelId: selectedModel.value.id,
    bytesWritten: 0,
    totalBytes: 0,
    percentage: 0,
    speedMBs: 0,
    isCompleted: false,
  }

  try {
    await NativeAI.downloadModel(
      {
        modelId: selectedModel.value.id,
        repo: selectedModel.value.repo,
        filename: selectedModel.value.filename,
        hfToken: hfToken.value || undefined,
      },
      (event: DownloadProgressEvent) => {
        downloadProgress.value = event
        if (event.isCompleted) {
          isDownloading.value = false
          refreshCachedModels()
        }
      },
    )
  }
  catch (err: any) {
    console.error('[CoreAILab] Download failed:', err)
    downloadProgress.value = {
      modelId: selectedModel.value.id,
      bytesWritten: 0,
      totalBytes: 0,
      percentage: 0,
      isCompleted: false,
      error: String(err?.message || err),
    }
    isDownloading.value = false
  }
}

async function handleLoadModel() {
  isLoadingModel.value = true
  try {
    const result = await NativeAI.loadModel({
      modelId: selectedModel.value.id,
      computeUnits: 'all',
    })
    loadedModelInfo.value = result
    isModelResident.value = result.isLoaded
  }
  catch (err) {
    console.error('[CoreAILab] Failed to load model:', err)
  }
  finally {
    isLoadingModel.value = false
  }
}

const hasAnyModelFolder = computed(() => {
  const sanitized = selectedModel.value.id.replace(/\//g, '_')
  return cachedModels.value.some(m => m.modelId === sanitized || m.modelId === selectedModel.value.id)
})

async function handleUnloadModel() {
  try {
    await NativeAI.unloadModel()
    isModelResident.value = false
    loadedModelInfo.value = null
  }
  catch (err) {
    console.error('[CoreAILab] Failed to unload model:', err)
  }
}

async function handleDeleteModel() {
  try {
    await NativeAI.deleteCachedModel({ modelId: selectedModel.value.id })
    isModelResident.value = false
    loadedModelInfo.value = null
    await refreshCachedModels()
  }
  catch (err) {
    console.error('[CoreAILab] Failed to delete model:', err)
  }
}

async function runOnDeviceInference() {
  if (isGenerating.value)
    return

  isGenerating.value = true
  generatedText.value = ''
  inferenceMetrics.value = {
    ttftMs: null,
    currentTps: 0,
    elapsedMs: 0,
    tokensReceived: 0,
    status: 'running',
  }

  const startTime = Date.now()

  try {
    const streamHandle = await NativeAI.generateStream(
      {
        requestId: `lab-${Date.now()}`,
        modelId: selectedModel.value.id,
        prompt: prompt.value,
        maxTokens: maxTokens.value,
      },
      (event: TokenStreamEvent) => {
        if (!inferenceMetrics.value.ttftMs && event.token) {
          inferenceMetrics.value.ttftMs = Date.now() - startTime
        }

        if (event.token) {
          generatedText.value += event.token
        }

        inferenceMetrics.value.tokensReceived = event.completionTokens || inferenceMetrics.value.tokensReceived + (event.token ? 1 : 0)
        inferenceMetrics.value.elapsedMs = event.elapsedMs || (Date.now() - startTime)
        inferenceMetrics.value.currentTps = event.tokensPerSecond || Number((inferenceMetrics.value.tokensReceived / (inferenceMetrics.value.elapsedMs / 1000 || 1)).toFixed(1))

        if (event.isFinished) {
          isGenerating.value = false
          inferenceMetrics.value.status = (event.finishReason as any) || 'finished'
          stopInferenceFn = null
        }
      },
    )

    stopInferenceFn = streamHandle.stop
  }
  catch (err: any) {
    console.error('[CoreAILab] Generation error:', err)
    isGenerating.value = false
    inferenceMetrics.value.status = 'error'
  }
}

async function cancelInference() {
  if (stopInferenceFn) {
    await stopInferenceFn()
    stopInferenceFn = null
  }
  isGenerating.value = false
  inferenceMetrics.value.status = 'cancelled'
}

function setPromptPreset(text: string) {
  prompt.value = text
}

function copyDiagnosticsJson() {
  if (telemetry.value) {
    copy(JSON.stringify(telemetry.value, null, 2))
  }
}

onMounted(async () => {
  await fetchTelemetry()
  await runPing()
  await refreshCachedModels()
})

onUnmounted(() => {
  if (stopInferenceFn) {
    stopInferenceFn().catch(() => {})
  }
})
</script>

<template>
  <div class="pb-8 space-y-4">
    <!-- Top Status Strip -->
    <div class="shadow-xs flex items-center justify-between border border-neutral-200/80 rounded-xl bg-white p-3.5 dark:border-neutral-800 dark:bg-neutral-900">
      <div class="flex items-center gap-2.5">
        <div class="i-solar:cpu-bold-duotone text-xl text-sky-500" />
        <span
          class="rounded-full px-2.5 py-0.5 text-xs font-semibold"
          :class="[
            isNativeEnvironment
              ? 'bg-emerald-500/15 text-emerald-600 dark:bg-emerald-500/20 dark:text-emerald-400'
              : 'bg-amber-500/15 text-amber-600 dark:bg-amber-500/20 dark:text-amber-400',
          ]"
        >
          {{ isNativeEnvironment ? 'Native iOS Host (Apple Silicon)' : 'Web / Fallback Mode' }}
        </span>
      </div>

      <button
        class="flex items-center gap-1.5 border border-neutral-200 rounded-lg bg-neutral-50 px-3 py-1.5 text-xs font-medium transition active:scale-98 dark:border-neutral-700 dark:bg-neutral-800 hover:bg-neutral-100 dark:hover:bg-neutral-700"
        :disabled="isLoading"
        @click="fetchTelemetry"
      >
        <div class="i-solar:restart-bold text-xs" :class="{ 'animate-spin': isLoading }" />
        <span>Refresh</span>
      </button>
    </div>

    <!-- Hardware Telemetry Cards Grid -->
    <div class="grid grid-cols-2 gap-3 md:grid-cols-4">
      <!-- Device Model -->
      <div class="shadow-xs flex flex-col justify-between border border-neutral-200/80 rounded-xl bg-white p-3.5 dark:border-neutral-800 dark:bg-neutral-900">
        <div class="flex items-center justify-between text-neutral-500 dark:text-neutral-400">
          <span class="text-xs font-medium">Device</span>
          <div class="i-solar:smartphone-bold-duotone text-lg text-sky-500" />
        </div>
        <div class="mt-2.5">
          <div class="truncate text-sm font-bold" :title="telemetry?.deviceModel || 'Detecting...'">
            {{ telemetry?.deviceModel || 'Detecting...' }}
          </div>
          <div class="truncate text-xs text-neutral-400 dark:text-neutral-500">
            {{ telemetry?.rawMachineId || 'sysctl: N/A' }}
          </div>
        </div>
      </div>

      <!-- SoC Chipset -->
      <div class="shadow-xs flex flex-col justify-between border border-neutral-200/80 rounded-xl bg-white p-3.5 dark:border-neutral-800 dark:bg-neutral-900">
        <div class="flex items-center justify-between text-neutral-500 dark:text-neutral-400">
          <span class="text-xs font-medium">Apple SoC</span>
          <div class="i-solar:cpu-bolt-bold-duotone text-lg text-purple-500" />
        </div>
        <div class="mt-2.5">
          <div class="truncate text-sm font-bold">
            {{ telemetry?.chipFamily || 'Apple Silicon' }}
          </div>
          <div class="text-xs text-neutral-400 dark:text-neutral-500">
            {{ telemetry?.cpuCores || 4 }} Cores
          </div>
        </div>
      </div>

      <!-- Unified RAM -->
      <div class="shadow-xs flex flex-col justify-between border border-neutral-200/80 rounded-xl bg-white p-3.5 dark:border-neutral-800 dark:bg-neutral-900">
        <div class="flex items-center justify-between text-neutral-500 dark:text-neutral-400">
          <span class="text-xs font-medium">Unified RAM</span>
          <div class="i-solar:server-square-bold-duotone text-lg text-emerald-500" />
        </div>
        <div class="mt-2.5">
          <div class="text-sm font-bold">
            {{ telemetry?.totalMemoryFormatted || '0 B' }}
          </div>
          <div class="truncate text-xs text-emerald-600 font-medium dark:text-emerald-400">
            {{ telemetry?.availableMemoryFormatted || '0 B' }} Free
          </div>
        </div>
      </div>

      <!-- Neural Acceleration -->
      <div class="shadow-xs flex flex-col justify-between border border-neutral-200/80 rounded-xl bg-white p-3.5 dark:border-neutral-800 dark:bg-neutral-900">
        <div class="flex items-center justify-between text-neutral-500 dark:text-neutral-400">
          <span class="text-xs font-medium">Neural Engine</span>
          <div class="i-solar:chart-square-bold-duotone text-lg text-amber-500" />
        </div>
        <div class="mt-2.5">
          <div class="truncate text-sm font-bold" :title="telemetry?.gpuDeviceName || 'Metal GPU'">
            {{ telemetry?.gpuDeviceName || 'Metal GPU' }}
          </div>
          <div class="flex items-center gap-1.5 text-xs text-emerald-600 font-medium dark:text-emerald-400">
            <span class="inline-block h-1.5 w-1.5 rounded-full bg-emerald-500" />
            <span>ANE Active</span>
          </div>
        </div>
      </div>
    </div>

    <!-- Phase 2: Interactive Model Hub -->
    <div class="shadow-xs border border-neutral-200/80 rounded-2xl bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900">
      <div class="flex items-center justify-between">
        <div class="flex items-center gap-2">
          <div class="i-solar:box-minimalistic-bold-duotone text-lg text-sky-500" />
          <h2 class="text-xs text-neutral-700 font-bold tracking-wider uppercase dark:text-neutral-300">
            Native Model Hub & Specialization Engine
          </h2>
        </div>
        <span
          class="rounded-full px-2.5 py-0.5 text-[11px] font-bold"
          :class="[
            isModelResident
              ? 'bg-emerald-500/15 text-emerald-600 dark:bg-emerald-500/20 dark:text-emerald-400'
              : isSelectedModelCached
                ? 'bg-sky-500/15 text-sky-600 dark:bg-sky-500/20 dark:text-sky-400'
                : 'bg-neutral-100 text-neutral-500 dark:bg-neutral-800 dark:text-neutral-400',
          ]"
        >
          {{ isModelResident ? '● Resident in RAM' : isSelectedModelCached ? 'Ready on Disk' : 'Not Downloaded' }}
        </span>
      </div>

      <!-- Model Selector Cards -->
      <div class="grid grid-cols-1 mt-3 gap-2.5 md:grid-cols-3">
        <div
          v-for="model in curatedModels"
          :key="model.id"
          class="flex flex-col cursor-pointer justify-between rounded-xl p-3 text-xs transition"
          :class="[
            selectedModelId === model.id
              ? 'border-2 border-sky-500 bg-sky-50/50 dark:bg-sky-950/20 shadow-xs'
              : 'border border-neutral-200 dark:border-neutral-800 bg-neutral-50/60 dark:bg-neutral-800/40 hover:border-neutral-300',
          ]"
          @click="selectedModelId = model.id"
        >
          <div>
            <div class="flex items-center justify-between">
              <span class="rounded-sm bg-neutral-200/80 px-1.5 py-0.5 text-[10px] text-neutral-700 font-bold dark:bg-neutral-700 dark:text-neutral-300">
                {{ model.category }}
              </span>
              <span class="text-[11px] text-neutral-500 font-semibold dark:text-neutral-400">
                {{ model.size }}
              </span>
            </div>
            <div class="mt-2 text-neutral-900 font-bold dark:text-neutral-100">
              {{ model.name }}
            </div>
            <div class="mt-1 text-[11px] text-neutral-500 leading-relaxed dark:text-neutral-400">
              {{ model.description }}
            </div>
          </div>
          <div class="mt-2.5 flex items-center justify-between text-[10px] text-sky-600 font-semibold dark:text-sky-400">
            <span>Target: {{ model.computeUnit }}</span>
          </div>
        </div>
      </div>

      <!-- Download & Memory Residency Actions -->
      <div class="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-neutral-100 pt-3 dark:border-neutral-800">
        <div class="flex items-center gap-2">
          <!-- Download Button -->
          <button
            v-if="!isSelectedModelCached"
            class="flex items-center gap-1.5 rounded-lg bg-sky-500 px-3.5 py-2 text-xs text-white font-semibold transition active:scale-98 hover:bg-sky-600"
            :disabled="isDownloading"
            @click="handleDownloadModel"
          >
            <div class="i-solar:download-minimalistic-bold text-xs" :class="{ 'animate-bounce': isDownloading }" />
            <span>{{ isDownloading ? 'Downloading...' : 'Download from Hugging Face' }}</span>
          </button>

          <!-- Load / Unload Memory Slot -->
          <template v-else>
            <button
              v-if="!isModelResident"
              class="flex items-center gap-1.5 rounded-lg bg-emerald-500 px-3.5 py-2 text-xs text-white font-semibold transition active:scale-98 hover:bg-emerald-600"
              :disabled="isLoadingModel"
              @click="handleLoadModel"
            >
              <div class="i-solar:cpu-bolt-bold text-xs" :class="{ 'animate-spin': isLoadingModel }" />
              <span>{{ isLoadingModel ? 'Compiling & Loading...' : 'Load into Neural Engine RAM' }}</span>
            </button>
            <button
              v-else
              class="flex items-center gap-1.5 border border-neutral-200 rounded-lg bg-neutral-50 px-3.5 py-2 text-xs text-neutral-700 font-semibold transition active:scale-98 dark:border-neutral-700 dark:bg-neutral-800 hover:bg-neutral-100 dark:text-neutral-200"
              @click="handleUnloadModel"
            >
              <div class="i-solar:power-bold text-xs" />
              <span>Unload from RAM</span>
            </button>
          </template>

          <!-- Delete / Purge Local Cache Button -->
          <button
            v-if="hasAnyModelFolder"
            class="flex items-center gap-1 border border-red-200 rounded-lg bg-red-50/50 px-2.5 py-2 text-xs text-red-600 font-medium transition active:scale-98 dark:border-red-900/40 dark:bg-red-950/20 hover:bg-red-100/60 dark:text-red-400"
            title="Delete cached model files to free disk space or re-download"
            @click="handleDeleteModel"
          >
            <div class="i-solar:trash-bin-trash-bold text-xs" />
            <span>Delete</span>
          </button>
        </div>

        <div v-if="loadedModelInfo" class="flex items-center gap-2 text-xs text-neutral-500">
          <span>Loaded in <strong>{{ loadedModelInfo.loadTimeMs }}ms</strong></span>
          <span>•</span>
          <span>RAM: <strong>{{ formatBytes(loadedModelInfo.residentMemoryBytes || 1200000000) }}</strong></span>
        </div>
      </div>

      <!-- Download Progress Bar -->
      <div v-if="isDownloading && downloadProgress" class="mt-3 flex flex-col gap-1.5 rounded-xl bg-neutral-50 p-3 dark:bg-neutral-800/60">
        <div class="flex items-center justify-between text-xs">
          <span class="text-neutral-700 font-medium dark:text-neutral-300">
            Downloading {{ selectedModel.name }}...
          </span>
          <span class="text-sky-600 font-bold dark:text-sky-400">
            {{ downloadProgress.percentage }}% ({{ downloadProgress.speedMBs }} MB/s)
          </span>
        </div>
        <div class="h-2 w-full overflow-hidden rounded-full bg-neutral-200 dark:bg-neutral-700">
          <div
            class="h-full bg-sky-500 transition-all duration-300"
            :style="{ width: `${downloadProgress.percentage}%` }"
          />
        </div>
      </div>
    </div>

    <!-- Real-Time On-Device Inference Playground -->
    <div class="shadow-xs border border-neutral-200/80 rounded-2xl bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900">
      <div class="flex items-center justify-between">
        <div class="flex items-center gap-2">
          <div class="i-solar:chat-round-line-bold-duotone text-lg text-emerald-500" />
          <h2 class="text-xs text-neutral-700 font-bold tracking-wider uppercase dark:text-neutral-300">
            On-Device Inference Playground (Gemma Speculative ANE)
          </h2>
        </div>
        <div class="flex items-center gap-2">
          <button
            v-if="!isGenerating"
            class="flex items-center gap-1.5 rounded-lg bg-emerald-500 px-3.5 py-1.5 text-xs text-white font-semibold transition active:scale-98 hover:bg-emerald-600"
            @click="runOnDeviceInference"
          >
            <div class="i-solar:play-bold text-xs" />
            <span>Generate</span>
          </button>
          <button
            v-else
            class="flex items-center gap-1.5 rounded-lg bg-rose-500 px-3.5 py-1.5 text-xs text-white font-semibold transition active:scale-98 hover:bg-rose-600"
            @click="cancelInference"
          >
            <div class="i-solar:stop-bold text-xs" />
            <span>Cancel</span>
          </button>
        </div>
      </div>

      <!-- Prompt Presets -->
      <div class="mt-2.5 flex flex-wrap gap-1.5">
        <button
          class="rounded-lg bg-neutral-100 px-2.5 py-1 text-[11px] text-neutral-600 transition dark:bg-neutral-800 hover:bg-neutral-200 dark:text-neutral-400 dark:hover:bg-neutral-700"
          @click="setPromptPreset('Introduce yourself as AIRI, an on-device AI companion.')"
        >
          💬 Preset: Introduce AIRI
        </button>
        <button
          class="rounded-lg bg-neutral-100 px-2.5 py-1 text-[11px] text-neutral-600 transition dark:bg-neutral-800 hover:bg-neutral-200 dark:text-neutral-400 dark:hover:bg-neutral-700"
          @click="setPromptPreset('Explain the Apple Neural Engine and Speculative CoreML execution speed.')"
        >
          ⚡ Preset: Neural Engine
        </button>
        <button
          class="rounded-lg bg-neutral-100 px-2.5 py-1 text-[11px] text-neutral-600 transition dark:bg-neutral-800 hover:bg-neutral-200 dark:text-neutral-400 dark:hover:bg-neutral-700"
          @click="setPromptPreset('Generate a cheerful greeting with <|ACT:emotion=happy|> and motion cues.')"
        >
          🎭 Preset: ACT Tokens
        </button>
      </div>

      <!-- Input Prompt Box -->
      <div class="mt-2.5">
        <textarea
          v-model="prompt"
          rows="2"
          class="w-full border border-neutral-200 rounded-lg bg-neutral-50 px-3 py-2 text-xs transition dark:border-neutral-700 focus:border-sky-500 dark:bg-neutral-800 focus:outline-none"
          placeholder="Type any prompt for on-device inference..."
        />
      </div>

      <!-- Telemetry HUD during inference -->
      <div class="grid grid-cols-4 mt-2.5 gap-2 border border-neutral-100 rounded-xl bg-neutral-50/70 p-2.5 text-center dark:border-neutral-800 dark:bg-neutral-800/40">
        <div>
          <div class="text-[10px] text-neutral-400 font-semibold uppercase">
            TTFT
          </div>
          <div class="text-xs text-neutral-800 font-bold dark:text-neutral-200">
            {{ inferenceMetrics.ttftMs != null ? `${inferenceMetrics.ttftMs}ms` : '--' }}
          </div>
        </div>
        <div>
          <div class="text-[10px] text-neutral-400 font-semibold uppercase">
            Speed
          </div>
          <div class="text-xs text-emerald-600 font-bold dark:text-emerald-400">
            {{ inferenceMetrics.currentTps > 0 ? `${inferenceMetrics.currentTps} t/s` : '--' }}
          </div>
        </div>
        <div>
          <div class="text-[10px] text-neutral-400 font-semibold uppercase">
            Tokens
          </div>
          <div class="text-xs text-neutral-800 font-bold dark:text-neutral-200">
            {{ inferenceMetrics.tokensReceived }}
          </div>
        </div>
        <div>
          <div class="text-[10px] text-neutral-400 font-semibold uppercase">
            Status
          </div>
          <div
            class="text-xs font-bold uppercase"
            :class="[
              inferenceMetrics.status === 'running' ? 'text-sky-500 animate-pulse'
              : inferenceMetrics.status === 'finished' ? 'text-emerald-500'
                : inferenceMetrics.status === 'cancelled' ? 'text-amber-500'
                  : inferenceMetrics.status === 'error' ? 'text-rose-500'
                    : 'text-neutral-400',
            ]"
          >
            {{ inferenceMetrics.status }}
          </div>
        </div>
      </div>

      <!-- Stream Output Box -->
      <div class="relative mt-2.5 min-h-[100px] border border-neutral-200 rounded-xl bg-neutral-900 p-3.5 text-xs text-neutral-100 font-mono dark:border-neutral-800">
        <div v-if="!generatedText && !isGenerating" class="text-neutral-500 italic">
          Press "Generate" to stream on-device CoreML responses into this console...
        </div>
        <div v-else class="whitespace-pre-wrap leading-relaxed">
          <span>{{ generatedText }}</span>
          <span v-if="isGenerating" class="ml-0.5 inline-block h-3.5 w-1.5 animate-pulse bg-emerald-400 align-middle" />
        </div>
      </div>
    </div>

    <!-- Raw System Diagnostics Dump -->
    <div class="shadow-xs border border-neutral-200/80 rounded-2xl bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900">
      <div class="flex items-center justify-between">
        <div class="flex items-center gap-2">
          <div class="i-solar:code-bold text-base text-purple-500" />
          <h2 class="text-xs text-neutral-700 font-bold tracking-wider uppercase dark:text-neutral-300">
            Raw Diagnostics
          </h2>
        </div>
        <div class="flex items-center gap-2">
          <button
            class="flex items-center gap-1 border border-neutral-200 rounded-lg bg-neutral-50 px-2.5 py-1 text-xs font-medium transition dark:border-neutral-700 dark:bg-neutral-800 hover:bg-neutral-100 dark:hover:bg-neutral-700"
            @click="copyDiagnosticsJson"
          >
            <div class="text-xs" :class="[copied ? 'i-solar:check-circle-bold text-emerald-500' : 'i-solar:copy-bold']" />
            <span>{{ copied ? 'Copied' : 'Copy' }}</span>
          </button>
          <button
            class="border border-neutral-200 rounded-lg bg-neutral-50 px-2.5 py-1 text-xs font-medium transition dark:border-neutral-700 dark:bg-neutral-800 hover:bg-neutral-100 dark:hover:bg-neutral-700"
            @click="showRawDiagnostics = !showRawDiagnostics"
          >
            {{ showRawDiagnostics ? 'Collapse' : 'Expand' }}
          </button>
        </div>
      </div>

      <div v-if="showRawDiagnostics" class="mt-3">
        <pre class="max-h-64 overflow-x-auto rounded-xl bg-neutral-950 p-3 text-[11px] text-emerald-400 leading-tight font-mono">{{ JSON.stringify(telemetry, null, 2) }}</pre>
      </div>
    </div>
  </div>
</template>

<route lang="yaml">
meta:
  layout: settings
  title: Core AI Lab
  subtitleKey: tamagotchi.settings.devtools.title
</route>
