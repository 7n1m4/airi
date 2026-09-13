<script setup lang="ts">
import type { RemovableRef } from '@vueuse/core'

import {
  Alert,
  ProviderBasicSettings,
  ProviderSettingsContainer,
  ProviderSettingsLayout,
} from '@proj-airi/stage-ui/components'
import { useProvidersStore } from '@proj-airi/stage-ui/stores/providers'
import { Button } from '@proj-airi/ui'
import { storeToRefs } from 'pinia'
import { computed, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRouter } from 'vue-router'

const providerId = 'moondream-local'
const { t } = useI18n()
const router = useRouter()

const providersStore = useProvidersStore()
const { providers, providerRuntimeState, addedProviders } = storeToRefs(providersStore) as {
  providers: RemovableRef<Record<string, any>>
  providerRuntimeState: RemovableRef<Record<string, any>>
  addedProviders: RemovableRef<Record<string, boolean>>
}

// Initialize provider if needed
providersStore.initializeProvider(providerId)
if (!providers.value[providerId]?.model) {
  providers.value[providerId] = { model: 'Xenova/moondream2' }
}

const providerMetadata = computed(() => providersStore.getProviderMetadata(providerId))

// UI Playground State
const fileInput = ref<HTMLInputElement | null>(null)
const isModelLoaded = ref(false)
const loadingModel = ref(false)
const processingImage = ref(false)
const modelLoadProgress = ref(0)
const downloadStatusText = ref('Model not resident in VRAM')
const errorMessage = ref('')
const customPrompt = ref('Describe what is happening in this image in detail.')

const testImageFile = ref<File | null>(null)
const testImageUrl = ref<string | null>(null)
const captionResult = ref('')
const latencyMs = ref<number | null>(null)

const runDevice = computed(() => {
  return providerRuntimeState.value[providerId]?.device ?? 'WebGPU'
})

onMounted(async () => {
  try {
    const providerInstance = await providersStore.getProviderInstance<any>(providerId)
    if (providerInstance?.isModelLoaded || providerInstance?.state === 'ready') {
      isModelLoaded.value = true
      downloadStatusText.value = 'Model is loaded & ready in VRAM'
    }
  }
  catch {}
})

function handleResetSettings() {
  providers.value[providerId] = { model: 'Xenova/moondream2' }
  isModelLoaded.value = false
  modelLoadProgress.value = 0
  downloadStatusText.value = 'Model not resident in VRAM'
  errorMessage.value = ''
  customPrompt.value = 'Describe what is happening in this image in detail.'
}

const isEnabled = computed(() => {
  return !!providerRuntimeState.value[providerId]?.isConfigured && !!addedProviders.value?.[providerId]
})

async function toggleProvider() {
  if (isEnabled.value) {
    providersStore.unmarkProviderAdded(providerId)
    if (providerRuntimeState.value[providerId]) {
      providerRuntimeState.value[providerId].isConfigured = false
    }
    isModelLoaded.value = false
  }
  else {
    if (!providers.value[providerId]?.model) {
      providers.value[providerId] = { model: 'Xenova/moondream2' }
    }
    providersStore.initializeProvider(providerId)
    providersStore.forceProviderConfigured(providerId)
  }
}

// Drag & Drop / File Upload
function handleFileChange(event: Event) {
  const target = event.target as HTMLInputElement
  if (target.files && target.files.length > 0) {
    setImageFile(target.files[0])
  }
}

function handleDrop(event: DragEvent) {
  event.preventDefault()
  if (event.dataTransfer?.files && event.dataTransfer.files.length > 0) {
    setImageFile(event.dataTransfer.files[0])
  }
}

function setImageFile(file: File) {
  testImageFile.value = file
  testImageUrl.value = URL.createObjectURL(file)
  captionResult.value = ''
  latencyMs.value = null
}

async function handleLoadModel() {
  if (loadingModel.value)
    return

  loadingModel.value = true
  errorMessage.value = ''
  modelLoadProgress.value = 0
  downloadStatusText.value = 'Initializing Moondream2 model weights...'

  const shardMap = new Map<string, { loaded: number, total: number }>()
  const EXPECTED_TOTAL_BYTES = 720 * 1024 * 1024

  try {
    const providerInstance = await providersStore.getProviderInstance<any>(providerId)
    await providerInstance.loadModel({
      onProgress: (progress: any) => {
        if (progress?.file) {
          const rawFile = String(progress.file)
          const fileName = rawFile.split('/').pop() || rawFile
          shardMap.set(rawFile, {
            loaded: progress.loaded || 0,
            total: progress.total || 0,
          })

          let sumLoaded = 0
          for (const shard of shardMap.values()) {
            sumLoaded += shard.loaded
          }

          if (sumLoaded > 0) {
            const calculatedPct = Math.min(99, Math.round((sumLoaded / EXPECTED_TOTAL_BYTES) * 100))
            modelLoadProgress.value = Math.max(modelLoadProgress.value, calculatedPct)
            const loadedMb = (sumLoaded / (1024 * 1024)).toFixed(1)
            downloadStatusText.value = `Downloading ${fileName} (${loadedMb} MB / ~720 MB)...`
          }
          else if (typeof progress.percent === 'number' && progress.percent >= 0) {
            modelLoadProgress.value = Math.min(100, Math.round(progress.percent))
            downloadStatusText.value = `Downloading ${fileName}...`
          }
        }
        else if (progress?.phase === 'compile' || (progress?.message && progress.message.includes('shader'))) {
          modelLoadProgress.value = 100
          downloadStatusText.value = progress.message || 'Compiling WebGPU shaders and preparing model sessions...'
        }
        else if (typeof progress?.percent === 'number' && progress.percent >= 0) {
          modelLoadProgress.value = Math.min(100, Math.round(progress.percent))
          if (progress.message) {
            downloadStatusText.value = progress.message
          }
        }
        else if (typeof progress?.progress === 'number' && progress.progress >= 0) {
          modelLoadProgress.value = Math.min(100, Math.round(progress.progress))
        }
      },
    })
    isModelLoaded.value = true
    modelLoadProgress.value = 100
    downloadStatusText.value = 'Model is loaded & ready in VRAM'
  }
  catch (err: any) {
    console.error('[Moondream Local Settings] Failed to load model:', err)
    errorMessage.value = err.message || 'Failed to load model.'
  }
  finally {
    loadingModel.value = false
  }
}

// Run Vision Inference Pipeline
async function runPlaygroundInference() {
  if (!testImageUrl.value) {
    errorMessage.value = 'Please upload or drop an image first.'
    return
  }

  errorMessage.value = ''
  processingImage.value = true
  const startTime = performance.now()

  try {
    // 1. Get or create provider instance
    const providerInstance = await providersStore.getProviderInstance<any>(providerId)

    // 2. Ensure model is loaded into VRAM
    if (!isModelLoaded.value && providerInstance?.state !== 'ready') {
      await handleLoadModel()
      if (!isModelLoaded.value) {
        throw new Error(errorMessage.value || 'Failed to initialize Moondream2 weights.')
      }
    }

    // 3. Run VLM image captioning with prompt
    const result = await providerInstance.captionImage(testImageUrl.value, {
      prompt: customPrompt.value,
    })
    captionResult.value = result
    latencyMs.value = Math.round(performance.now() - startTime)
  }
  catch (err: any) {
    console.error('[Moondream Playground] Inference failed:', err)
    errorMessage.value = err.message || 'Failed to process image.'
  }
  finally {
    processingImage.value = false
  }
}
</script>

<template>
  <ProviderSettingsLayout
    :provider-name="providerMetadata?.localizedName || 'Moondream2 VLM (Local, WebGPU)'"
    :provider-description="providerMetadata?.localizedDescription || 'Local on-device visual language model via WebGPU'"
    :provider-icon="providerMetadata?.icon || 'i-solar:eye-scan-bold-duotone'"
    :provider-icon-color="providerMetadata?.iconColor || 'text-cyan-500'"
    :deployment="providerMetadata?.deployment || 'local'"
    :pricing="providerMetadata?.pricing || 'free'"
    :beginner-recommended="providerMetadata?.beginnerRecommended"
    :on-back="() => router.back()"
  >
    <div class="w-full flex flex-col gap-6 lg:flex-row">
      <!-- Left Column: Settings (~30-35% on desktop, 100% on portrait/narrow) -->
      <div class="w-full shrink-0 lg:w-[35%] xl:w-[30%] space-y-6">
        <Alert type="info">
          <template #title>
            Local On-Device Vision-Language Model
          </template>
          <template #content>
            This provider runs <b>Moondream2 (1.6B parameters)</b> directly in your browser using WebGPU. Unlike tag-based classifiers, Moondream2 is a full conversational VLM capable of natural-language scene understanding and visual question answering.
          </template>
        </Alert>

        <ProviderSettingsContainer>
          <ProviderBasicSettings
            :title="t('settings.pages.providers.common.section.basic.title')"
            :description="t('settings.pages.providers.common.section.basic.description')"
            :on-reset="handleResetSettings"
          >
            <div class="space-y-4">
              <div class="flex items-center justify-between border-b border-neutral-100 pb-4 dark:border-neutral-800">
                <div>
                  <h4 class="text-sm text-neutral-900 font-semibold dark:text-neutral-100">
                    Enable Provider
                  </h4>
                  <p class="text-xs text-neutral-500">
                    Toggle the on-device Moondream2 VLM pipeline.
                  </p>
                </div>
                <button
                  type="button"
                  class="relative h-6 w-11 inline-flex flex-shrink-0 cursor-pointer border-2 border-transparent rounded-full transition-colors duration-200 ease-in-out focus:outline-none"
                  :class="isEnabled ? 'bg-primary-500' : 'bg-neutral-200 dark:bg-neutral-700'"
                  @click="toggleProvider"
                >
                  <span
                    class="pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out"
                    :class="isEnabled ? 'translate-x-5' : 'translate-x-0'"
                  />
                </button>
              </div>

              <div class="flex items-center justify-between text-xs text-neutral-500">
                <span>Model Weights</span>
                <span class="text-neutral-700 font-mono dark:text-neutral-300">Xenova/moondream2 (~700MB q4/q8)</span>
              </div>

              <div class="flex items-center justify-between text-xs text-neutral-500">
                <span>Hardware Backend</span>
                <span class="text-neutral-700 font-semibold dark:text-neutral-300">{{ runDevice }}</span>
              </div>

              <!-- VRAM / Resident Status & Actions -->
              <div class="mt-4 border-t border-neutral-100 pt-4 space-y-3 dark:border-neutral-800">
                <div v-if="loadingModel" class="border border-primary-500/20 rounded-xl bg-primary-500/5 p-3 space-y-2">
                  <div class="flex items-center justify-between text-xs opacity-80">
                    <span class="max-w-[75%] truncate font-medium" :title="downloadStatusText">{{ downloadStatusText }}</span>
                    <span class="font-semibold font-mono">{{ modelLoadProgress }}%</span>
                  </div>
                  <div class="h-1.5 w-full overflow-hidden rounded-full bg-neutral-200 dark:bg-neutral-700">
                    <div
                      class="h-full bg-primary-500 transition-all duration-200"
                      :style="{ width: `${modelLoadProgress}%` }"
                    />
                  </div>
                </div>

                <div v-else-if="!isModelLoaded" class="flex items-center justify-between border border-neutral-200/80 rounded-xl bg-neutral-50/50 p-3 dark:border-neutral-800 dark:bg-neutral-900/50">
                  <div class="flex items-center gap-2 text-xs text-neutral-600 dark:text-neutral-300">
                    <div class="i-solar:info-circle-bold-duotone shrink-0 text-base text-primary-500" />
                    <span>Not loaded in VRAM (~700MB cached)</span>
                  </div>
                  <Button
                    size="sm"
                    variant="secondary"
                    :disabled="loadingModel"
                    class="flex shrink-0 items-center gap-1 text-xs"
                    @click="handleLoadModel"
                  >
                    <div class="i-solar:cloud-download-bold-duotone text-sm" />
                    <span>Load to VRAM</span>
                  </Button>
                </div>

                <div v-else class="flex items-center justify-between border border-emerald-500/20 rounded-xl bg-emerald-500/10 p-3 text-xs text-emerald-700 dark:text-emerald-300">
                  <div class="flex items-center gap-2 font-medium">
                    <div class="i-solar:check-circle-bold-duotone shrink-0 text-base text-emerald-500" />
                    <span>Model ready in VRAM</span>
                  </div>
                  <Button
                    size="sm"
                    variant="secondary"
                    :disabled="loadingModel || processingImage"
                    class="flex shrink-0 items-center gap-1 text-xs"
                    @click="handleLoadModel"
                  >
                    <div class="i-solar:refresh-circle-bold-duotone text-sm" />
                    <span>Reload</span>
                  </Button>
                </div>
              </div>
            </div>
          </ProviderBasicSettings>
        </ProviderSettingsContainer>
      </div>

      <!-- Right Column: Interactive Playground (~65-70% on desktop, 100% on portrait/narrow) -->
      <div class="min-w-0 flex-1 space-y-6">
        <!-- Interactive Playground when isEnabled -->
        <div
          v-if="isEnabled"
          class="border border-neutral-200/80 rounded-2xl bg-white/70 p-5 space-y-5 dark:border-neutral-800/80 dark:bg-neutral-900/60"
        >
          <div>
            <h3 class="text-base text-neutral-900 font-semibold dark:text-neutral-100">
              Moondream2 VLM Playground
            </h3>
            <p class="text-xs text-neutral-500">
              Upload an image and ask a question to test on-device visual language understanding on your GPU.
            </p>
          </div>

          <div class="space-y-3">
            <label class="block text-xs text-neutral-700 font-medium dark:text-neutral-300">Question / Prompt</label>
            <input
              v-model="customPrompt"
              type="text"
              class="w-full border border-neutral-300 rounded-md bg-white px-3 py-1.5 text-sm dark:border-neutral-700 dark:bg-neutral-800"
              placeholder="e.g. Describe what is happening in this image in detail."
            >
          </div>

          <div class="grid grid-cols-1 gap-5 md:grid-cols-2">
            <!-- Upload/Drop Area -->
            <div
              class="min-h-[220px] flex flex-col cursor-pointer items-center justify-center border-2 border-neutral-200 rounded-xl border-dashed p-5 transition-colors dark:border-neutral-800 hover:border-primary-500"
              @dragover.prevent
              @drop="handleDrop"
              @click="fileInput?.click()"
            >
              <input
                ref="fileInput"
                type="file"
                accept="image/*"
                class="hidden"
                @change="handleFileChange"
              >

              <template v-if="testImageUrl">
                <img
                  :src="testImageUrl"
                  class="max-h-[200px] max-w-full rounded-lg object-contain shadow-sm"
                  alt="Test image"
                >
                <span class="mt-2 text-xs text-neutral-400">Click or drop to replace</span>
              </template>
              <template v-else>
                <div class="i-solar:gallery-send-bold-duotone mb-2 text-4xl text-neutral-400" />
                <span class="text-sm text-neutral-700 font-medium dark:text-neutral-300">Drop an image here</span>
                <span class="text-xs text-neutral-400">or click to browse files</span>
              </template>
            </div>

            <!-- Inference Controls & Output -->
            <div class="flex flex-col justify-between space-y-4">
              <div>
                <div class="flex items-center justify-between text-xs text-neutral-500">
                  <span>Hardware Backend:</span>
                  <span class="text-neutral-800 font-semibold dark:text-neutral-200">{{ runDevice }}</span>
                </div>
                <div v-if="latencyMs !== null" class="mt-1 flex items-center justify-between text-xs text-neutral-500">
                  <span>Inference Latency:</span>
                  <span class="text-neutral-800 font-semibold dark:text-neutral-200">{{ latencyMs }} ms</span>
                </div>
              </div>

              <!-- Loading Progress -->
              <div v-if="loadingModel" class="space-y-2">
                <div class="flex items-center justify-between text-xs text-neutral-500">
                  <span class="max-w-[75%] truncate" :title="downloadStatusText">{{ downloadStatusText }}</span>
                  <span class="font-medium font-mono">{{ modelLoadProgress }}%</span>
                </div>
                <div class="h-1.5 w-full overflow-hidden rounded-full bg-neutral-200 dark:bg-neutral-700">
                  <div
                    class="h-full bg-primary-500 transition-all duration-200"
                    :style="{ width: `${modelLoadProgress}%` }"
                  />
                </div>
              </div>

              <!-- Error message -->
              <Alert v-if="errorMessage" type="error">
                <template #content>
                  {{ errorMessage }}
                </template>
              </Alert>

              <!-- Result Box -->
              <div class="flex-1 border border-neutral-200 rounded-lg bg-neutral-50 p-3 dark:border-neutral-800 dark:bg-neutral-900/50">
                <span class="block text-[11px] text-neutral-400 font-medium tracking-wider uppercase">Moondream2 Output</span>
                <div v-if="processingImage && !loadingModel" class="flex items-center gap-2 py-4 text-xs text-neutral-500">
                  <div class="i-solar:spinner-line-duotone animate-spin text-lg text-primary-500" />
                  <span>Running visual language inference on WebGPU...</span>
                </div>
                <div v-else-if="captionResult" class="mt-2 select-text text-sm text-neutral-800 leading-relaxed dark:text-neutral-200">
                  {{ captionResult }}
                </div>
                <div v-else class="mt-2 text-xs text-neutral-400 italic">
                  Upload an image and click "Analyze with Moondream2" to view the response.
                </div>
              </div>

              <Button
                variant="primary"
                class="w-full"
                :disabled="!testImageUrl || processingImage || loadingModel"
                @click="runPlaygroundInference"
              >
                <div v-if="processingImage || loadingModel" class="i-solar:spinner-line-duotone mr-2 animate-spin" />
                <div v-else class="i-solar:stars-minimalistic-bold-duotone mr-2" />
                <span>{{ loadingModel ? 'Loading Model...' : (processingImage ? 'Analyzing...' : 'Analyze with Moondream2') }}</span>
              </Button>
            </div>
          </div>
        </div>

        <!-- Disabled Placeholder when !isEnabled -->
        <div v-else class="border border-neutral-200/60 rounded-2xl border-dashed bg-neutral-50/50 p-8 text-center dark:border-neutral-800/60 dark:bg-neutral-900/20">
          <div class="i-solar:eye-scan-bold-duotone mx-auto mb-3 text-4xl text-neutral-400" />
          <h3 class="text-sm text-neutral-700 font-semibold dark:text-neutral-300">
            Provider Disabled
          </h3>
          <p class="mt-1 text-xs text-neutral-400">
            Enable Moondream2 in the configuration panel to test on-device vision inference.
          </p>
        </div>
      </div>
    </div>
  </ProviderSettingsLayout>
</template>

<route lang="yaml">
meta:
  layout: settings
  subtitleKey: settings.pages.providers.title
  stageTransition:
    name: slide
</route>
