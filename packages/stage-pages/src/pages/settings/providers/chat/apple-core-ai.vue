<script setup lang="ts">
import type { CachedModelInfo, DownloadProgressEvent, HardwareTelemetry } from '@proj-airi/stage-ui/libs/native-ai'

import {
  Alert,
  ProviderSettingsContainer,
  ProviderSettingsLayout,
} from '@proj-airi/stage-ui/components'
import { useProviderValidation } from '@proj-airi/stage-ui/composables/use-provider-validation'
import { formatBytes, NativeAI } from '@proj-airi/stage-ui/libs/native-ai'
import { useProvidersStore } from '@proj-airi/stage-ui/stores/providers'
import { computed, onMounted, ref } from 'vue'

const providerId = 'apple-core-ai'
const providersStore = useProvidersStore()

const {
  t,
  providerMetadata,
  handleResetSettings,
} = useProviderValidation(providerId)

const isEnabled = computed(() => {
  return providersStore.providerRuntimeState[providerId]?.isConfigured && !!providersStore.addedProviders[providerId]
})

async function toggleProvider() {
  if (isEnabled.value) {
    providersStore.unmarkProviderAdded(providerId)
    if (providersStore.providerRuntimeState[providerId]) {
      providersStore.providerRuntimeState[providerId].isConfigured = false
    }
  }
  else {
    await providersStore.validateProvider(providerId, { force: true })
  }
}

// --- Telemetry State ---
const isTelemetryLoading = ref(true)
const telemetry = ref<HardwareTelemetry | null>(null)

// --- Model State ---
const targetModelId = 'okayuji/Gemma-4-E2B-it-coreml-speculative'
const isDownloading = ref(false)
const downloadProgress = ref<DownloadProgressEvent | null>(null)
const cachedModels = ref<CachedModelInfo[]>([])
const isModelResident = ref(false)
const isLoadingModel = ref(false)

const cachedModelInfo = computed(() => {
  return cachedModels.value.find(m => m.modelId.includes('Gemma-4-E2B') || m.modelId === targetModelId)
})

const isCached = computed(() => {
  return !!cachedModelInfo.value && !!cachedModelInfo.value.isCompiled
})

async function fetchTelemetry() {
  isTelemetryLoading.value = true
  try {
    telemetry.value = await NativeAI.getHardwareTelemetry()
  }
  catch (err) {
    console.warn('[AppleCoreAISettings] Telemetry failed:', err)
  }
  finally {
    isTelemetryLoading.value = false
  }
}

async function refreshCachedModels() {
  try {
    const res = await NativeAI.listCachedModels()
    cachedModels.value = res.models
  }
  catch (err) {
    console.warn('[AppleCoreAISettings] Failed to list cached models:', err)
  }
}

async function handleDownloadModel() {
  if (isDownloading.value)
    return

  isDownloading.value = true
  downloadProgress.value = {
    modelId: targetModelId,
    bytesWritten: 0,
    totalBytes: 403_704_760,
    percentage: 0,
    speedMBs: 0,
    isCompleted: false,
  }

  try {
    await NativeAI.downloadModel(
      {
        modelId: targetModelId,
        repo: targetModelId,
      },
      (event: DownloadProgressEvent) => {
        downloadProgress.value = event
        if (event.isCompleted) {
          isDownloading.value = false
          refreshCachedModels()
        }
        else if (event.error) {
          isDownloading.value = false
          console.error('[AppleCoreAISettings] Download error:', event.error)
        }
      },
    )
  }
  catch (err) {
    console.error('[AppleCoreAISettings] Download start failed:', err)
    isDownloading.value = false
  }
}

async function handleLoadModel() {
  isLoadingModel.value = true
  try {
    const res = await NativeAI.loadModel({
      modelId: targetModelId,
      computeUnits: 'all',
    })
    isModelResident.value = res.isLoaded
  }
  catch (err) {
    console.error('[AppleCoreAISettings] Failed to load model:', err)
  }
  finally {
    isLoadingModel.value = false
  }
}

async function handleUnloadModel() {
  try {
    await NativeAI.unloadModel()
    isModelResident.value = false
  }
  catch (err) {
    console.error('[AppleCoreAISettings] Failed to unload model:', err)
  }
}

async function handleDeleteCache() {
  try {
    await NativeAI.deleteCachedModel({ modelId: targetModelId })
    isModelResident.value = false
    if (isEnabled.value) {
      providersStore.unmarkProviderAdded(providerId)
      if (providersStore.providerRuntimeState[providerId]) {
        providersStore.providerRuntimeState[providerId].isConfigured = false
      }
    }
    await refreshCachedModels()
  }
  catch (err) {
    console.error('[AppleCoreAISettings] Failed to delete cache:', err)
  }
}

onMounted(async () => {
  await fetchTelemetry()
  await refreshCachedModels()
})
</script>

<template>
  <ProviderSettingsLayout
    :provider-id="providerId"
    :provider-metadata="providerMetadata"
    @reset-settings="handleResetSettings"
  >
    <ProviderSettingsContainer
      :title="t('settings.pages.providers.provider.apple-core-ai.title')"
      :description="t('settings.pages.providers.provider.apple-core-ai.description')"
    >
      <Alert
        type="info"
        :title="t('settings.pages.providers.provider.apple-core-ai.alert.title')"
        :content="t('settings.pages.providers.provider.apple-core-ai.alert.content')"
        class="mb-4"
      />

      <!-- Hardware Telemetry Capsule -->
      <div class="mb-4 border border-neutral-200/80 rounded-2xl bg-neutral-50/50 p-4 dark:border-neutral-800 dark:bg-neutral-900/50">
        <div class="mb-3 flex items-center justify-between">
          <div class="flex items-center gap-2">
            <div class="i-solar:cpu-bold-duotone text-lg text-sky-500" />
            <h3 class="text-xs text-neutral-600 font-semibold tracking-wider uppercase dark:text-neutral-300">
              Apple Silicon Neural Subsystem
            </h3>
          </div>
          <span
            class="rounded-full px-2.5 py-0.5 text-[11px] font-semibold"
            :class="[
              telemetry?.isNeuralEngineAvailable
                ? 'bg-emerald-500/15 text-emerald-600 dark:bg-emerald-500/20 dark:text-emerald-400'
                : 'bg-amber-500/15 text-amber-600 dark:bg-amber-500/20 dark:text-amber-400',
            ]"
          >
            {{ telemetry?.isNeuralEngineAvailable ? 'Neural Engine Active' : 'Metal GPU' }}
          </span>
        </div>

        <div class="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
          <div class="shadow-xs rounded-xl bg-white p-2.5 dark:bg-neutral-800">
            <div class="text-[10px] text-neutral-400 font-medium">
              Chip Family
            </div>
            <div class="mt-0.5 truncate text-xs font-bold">
              {{ telemetry?.chipFamily || 'Apple Silicon' }}
            </div>
          </div>
          <div class="shadow-xs rounded-xl bg-white p-2.5 dark:bg-neutral-800">
            <div class="text-[10px] text-neutral-400 font-medium">
              CPU Cores
            </div>
            <div class="mt-0.5 truncate text-xs font-bold">
              {{ telemetry?.cpuCores || 4 }} Cores
            </div>
          </div>
          <div class="shadow-xs rounded-xl bg-white p-2.5 dark:bg-neutral-800">
            <div class="text-[10px] text-neutral-400 font-medium">
              Unified Memory
            </div>
            <div class="mt-0.5 truncate text-xs font-bold">
              {{ telemetry?.totalMemoryFormatted || 'Unified RAM' }}
            </div>
          </div>
          <div class="shadow-xs rounded-xl bg-white p-2.5 dark:bg-neutral-800">
            <div class="text-[10px] text-neutral-400 font-medium">
              Available Memory
            </div>
            <div class="mt-0.5 truncate text-xs text-emerald-600 font-bold dark:text-emerald-400">
              {{ telemetry?.availableMemoryFormatted || 'Auto' }}
            </div>
          </div>
        </div>
      </div>

      <!-- Curated On-Device Model Card -->
      <div class="shadow-xs border border-neutral-200/80 rounded-2xl bg-white p-4.5 dark:border-neutral-800 dark:bg-neutral-900">
        <div class="flex items-start justify-between gap-3">
          <div class="space-y-1">
            <div class="flex items-center gap-2">
              <span class="rounded-md bg-purple-500/10 px-2 py-0.5 text-[10px] text-purple-600 font-bold dark:bg-purple-500/20 dark:text-purple-400">
                Flagship On-Device
              </span>
              <span class="text-xs text-neutral-400">403 MB</span>
            </div>
            <h4 class="text-sm text-neutral-900 font-bold dark:text-neutral-100">
              Gemma 4 E2B IT (Speculative CoreML)
            </h4>
            <p class="text-xs text-neutral-500 dark:text-neutral-400">
              Ultra-fast on-device dialogue with speculative draft verification on Apple Neural Engine (~45–60 tok/s).
            </p>
          </div>

          <div class="flex flex-col items-end gap-1.5">
            <span
              class="inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[11px] font-medium"
              :class="[
                isCached
                  ? 'bg-emerald-500/15 text-emerald-600 dark:bg-emerald-500/20 dark:text-emerald-400'
                  : 'bg-neutral-100 text-neutral-500 dark:bg-neutral-800 dark:text-neutral-400',
              ]"
            >
              <div class="size-1.5 rounded-full" :class="[isCached ? 'bg-emerald-500' : 'bg-neutral-400']" />
              {{ isCached ? 'Cached on Disk' : 'Not Downloaded' }}
            </span>
            <span v-if="cachedModelInfo" class="text-[10px] text-neutral-400 font-mono">
              {{ formatBytes(cachedModelInfo.sizeBytes) }}
            </span>
          </div>
        </div>

        <!-- Download Progress -->
        <div v-if="isDownloading && downloadProgress" class="mt-3.5 border border-sky-200/60 rounded-xl bg-sky-50/50 p-3 dark:border-sky-800/40 dark:bg-sky-950/20">
          <div class="flex items-center justify-between text-xs font-semibold">
            <span class="text-sky-700 dark:text-sky-300">Downloading weights from Hugging Face...</span>
            <span class="text-sky-600 font-mono dark:text-sky-400">
              {{ downloadProgress.percentage.toFixed(1) }}% ({{ downloadProgress.speedMBs }} MB/s)
            </span>
          </div>
          <div class="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-sky-200/50 dark:bg-sky-800/50">
            <div
              class="h-full rounded-full bg-sky-500 transition-all duration-200"
              :style="{ width: `${downloadProgress.percentage}%` }"
            />
          </div>
        </div>

        <!-- Action Controls -->
        <div class="mt-4 flex flex-wrap items-center justify-between gap-2 border-t border-neutral-100 pt-3 dark:border-neutral-800/80">
          <div class="flex items-center gap-2">
            <button
              v-if="!isCached"
              class="shadow-xs flex items-center gap-1.5 rounded-xl bg-sky-500 px-4 py-2 text-xs text-white font-semibold transition active:scale-98 hover:bg-sky-600 disabled:opacity-50"
              :disabled="isDownloading"
              @click="handleDownloadModel"
            >
              <div class="i-solar:download-minimalistic-bold text-sm" :class="{ 'animate-bounce': isDownloading }" />
              <span>{{ isDownloading ? 'Downloading...' : 'Download from Hugging Face' }}</span>
            </button>

            <button
              v-else-if="!isModelResident"
              class="shadow-xs flex items-center gap-1.5 rounded-xl bg-emerald-500 px-4 py-2 text-xs text-white font-semibold transition active:scale-98 hover:bg-emerald-600 disabled:opacity-50"
              :disabled="isLoadingModel"
              @click="handleLoadModel"
            >
              <div class="i-solar:play-bold text-sm" :class="{ 'animate-spin': isLoadingModel }" />
              <span>{{ isLoadingModel ? 'Loading...' : 'Load into RAM' }}</span>
            </button>

            <button
              v-else
              class="flex items-center gap-1.5 border border-amber-300 rounded-xl bg-amber-50 px-4 py-2 text-xs text-amber-700 font-semibold transition active:scale-98 dark:border-amber-700 dark:bg-amber-950/40 hover:bg-amber-100 dark:text-amber-300 dark:hover:bg-amber-900/40"
              @click="handleUnloadModel"
            >
              <div class="i-solar:stop-bold text-sm" />
              <span>Unload from RAM</span>
            </button>
          </div>

          <button
            v-if="isCached"
            class="flex items-center gap-1 border border-neutral-200 rounded-xl bg-neutral-50 px-3 py-1.5 text-xs text-neutral-600 font-medium transition dark:border-neutral-700 hover:border-red-300 dark:bg-neutral-800 hover:bg-red-50 dark:text-neutral-300 hover:text-red-600 dark:hover:border-red-800 dark:hover:bg-red-950/40 dark:hover:text-red-400"
            @click="handleDeleteCache"
          >
            <div class="i-solar:trash-bin-trash-bold text-xs" />
            <span>Delete Cache</span>
          </button>
        </div>
      </div>

      <!-- Activation Status -->
      <div class="mt-4 flex items-center justify-between border border-neutral-200/80 rounded-2xl bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900">
        <div class="space-y-1">
          <h4 class="text-sm text-neutral-900 font-semibold dark:text-neutral-100">
            {{ isEnabled ? 'Provider Active' : 'Activate Provider' }}
          </h4>
          <p class="text-xs text-neutral-500 dark:text-neutral-400">
            {{ isEnabled ? 'This provider is active and available in Consciousness & Modules.' : 'Enable this provider to select it for character dialogue.' }}
          </p>
        </div>
        <button
          class="rounded-xl px-4 py-2 text-sm font-semibold transition-all duration-200"
          :class="isEnabled ? 'bg-red-500/10 text-red-600 hover:bg-red-500/20 dark:bg-red-500/20 dark:text-red-400 dark:hover:bg-red-500/30' : 'bg-primary-500 text-white hover:bg-primary-600 disabled:opacity-50 disabled:cursor-not-allowed'"
          :disabled="!isCached"
          @click="toggleProvider"
        >
          {{ isEnabled ? 'Deactivate' : 'Activate' }}
        </button>
      </div>
    </ProviderSettingsContainer>
  </ProviderSettingsLayout>
</template>

<route lang="yaml">
meta:
  layout: settings
  title: Apple Core AI (On-Device)
  subtitleKey: settings.title
</route>
