<script setup lang="ts">
import type { WebRwkvModelInfo } from '@proj-airi/stage-ui/libs/inference'
import type { RemovableRef } from '@vueuse/core'

import {
  Alert,
  ProviderAdvancedSettings,
  ProviderBasicSettings,
  ProviderSettingsContainer,
  ProviderSettingsLayout,
} from '@proj-airi/stage-ui/components'
import {
  DEFAULT_WEB_RWKV_MODEL,
  formatBytes,
  getWebRwkvAdapter,
  isModelCached,
  WEB_RWKV_MODELS,
} from '@proj-airi/stage-ui/libs/inference'
import { useProvidersStore } from '@proj-airi/stage-ui/stores/providers'
import { buildRwkvPrompt, createThinkPrefixStripper } from '@proj-airi/stage-ui/stores/providers/web-rwkv'
import { Button, FieldCheckbox, FieldInput } from '@proj-airi/ui'
import { storeToRefs } from 'pinia'
import { computed, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRouter } from 'vue-router'

const providerId = 'web-rwkv'
const { t } = useI18n()
const router = useRouter()

const providersStore = useProvidersStore()
const { providers } = storeToRefs(providersStore) as { providers: RemovableRef<Record<string, any>> }

providersStore.initializeProvider(providerId)

const providerMetadata = computed(() => providersStore.getProviderMetadata(providerId))

const model = computed({
  get: () => providers.value[providerId]?.model ?? DEFAULT_WEB_RWKV_MODEL,
  set: (value) => {
    if (!providers.value[providerId])
      providers.value[providerId] = {}
    providers.value[providerId].model = value
  },
})

const vocab = computed({
  get: () => providers.value[providerId]?.vocab ?? '',
  set: (value) => {
    if (!providers.value[providerId])
      providers.value[providerId] = {}
    providers.value[providerId].vocab = value
  },
})

const quantization = computed<'none' | 'nf4' | 'int8'>({
  get: () => providers.value[providerId]?.quantization ?? 'none',
  set: (value) => {
    if (!providers.value[providerId])
      providers.value[providerId] = {}
    providers.value[providerId].quantization = value
  },
})

const enableG1Prefill = computed({
  get: () => providers.value[providerId]?.enableG1Prefill ?? false,
  set: (value) => {
    if (!providers.value[providerId])
      providers.value[providerId] = {}
    providers.value[providerId].enableG1Prefill = value
  },
})

const showCustomModelInput = ref(false)
const customModelInput = ref('')

const isKnownModel = computed(() => {
  return WEB_RWKV_MODELS.some(m => m.id === model.value)
})

watch(model, (val) => {
  if (!WEB_RWKV_MODELS.some(m => m.id === val)) {
    showCustomModelInput.value = true
    customModelInput.value = val
  }
}, { immediate: true })

function selectModel(m: WebRwkvModelInfo) {
  model.value = m.id
  showCustomModelInput.value = false
}

function selectQuantization(q: 'none' | 'nf4' | 'int8') {
  quantization.value = q
}

function handleCustomModelChange(val: string) {
  customModelInput.value = val
  if (val.trim()) {
    model.value = val.trim()
  }
}

function handleResetSettings() {
  providers.value[providerId] = {
    model: DEFAULT_WEB_RWKV_MODEL,
    vocab: '',
    enableG1Prefill: false,
    quantization: 'none',
  }
  showCustomModelInput.value = false
  customModelInput.value = ''
}

// --- Model Cache Status ---
const cachedModelMap = ref<Record<string, boolean>>({})

async function refreshCacheStatus() {
  for (const m of WEB_RWKV_MODELS) {
    cachedModelMap.value[m.id] = await isModelCached(m.id)
  }
  if (!isKnownModel.value && model.value) {
    cachedModelMap.value[model.value] = await isModelCached(model.value)
  }
}

onMounted(() => {
  refreshCacheStatus()
})

watch(model, () => {
  refreshCacheStatus()
})

const copySuccess = ref(false)
function copyPenaltiesJson() {
  const jsonText = JSON.stringify({
    presence_penalty: 0.4,
    count_penalty: 0.4,
    penalty_decay: 0.996,
  }, null, 2)
  navigator.clipboard.writeText(jsonText).then(() => {
    copySuccess.value = true
    setTimeout(() => {
      copySuccess.value = false
    }, 2000)
  })
}

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

// --- Inference Playground & Benchmark State ---
const testPrompt = ref('What is the capital of France, and why is it known as the City of Light?')
const testMaxTokens = ref(128)
const testTemperature = ref(1.0)
const testTopP = ref(0.5)

const isRunningTest = ref(false)
const testStatusMessage = ref('')
const downloadPercent = ref(-1)
const generatedOutput = ref('')
const testError = ref<string | null>(null)
let testAbortController: AbortController | null = null

const metrics = ref<{
  ttftMs: number | null
  totalMs: number | null
  tokensPerSec: number | null
  tokenCount: number
}>({
  ttftMs: null,
  totalMs: null,
  tokensPerSec: null,
  tokenCount: 0,
})

const PRESET_QUERIES = [
  {
    name: '🍓 Miss Strawberry',
    prompt: 'Hi Miss Strawberry! How is your day going?',
    temp: 0.8,
    topP: 0.5,
    tokens: 128,
  },
  {
    name: '🍝 Italian Carbonara',
    prompt: 'Can you give me a recipe for authentic Roman carbonara?',
    temp: 0.7,
    topP: 0.5,
    tokens: 256,
  },
  {
    name: '🦀 Rust & Memory',
    prompt: 'Explain how RWKV maintains constant state memory compared to Transformers.',
    temp: 0.6,
    topP: 0.5,
    tokens: 256,
  },
]

function applyPreset(p: typeof PRESET_QUERIES[number]) {
  testPrompt.value = p.prompt
  testTemperature.value = p.temp
  testTopP.value = p.topP
  testMaxTokens.value = p.tokens
}

async function runBenchmark() {
  if (isRunningTest.value) {
    testAbortController?.abort()
    isRunningTest.value = false
    testStatusMessage.value = 'Cancelled'
    return
  }

  isRunningTest.value = true
  testError.value = null
  generatedOutput.value = ''
  metrics.value = { ttftMs: null, totalMs: null, tokensPerSec: null, tokenCount: 0 }
  testStatusMessage.value = 'Initializing adapter...'
  downloadPercent.value = -1

  testAbortController = new AbortController()
  const signal = testAbortController.signal

  let firstTokenTime: number | null = null
  let tokensEmitted = 0

  try {
    const adapter = await getWebRwkvAdapter()

    testStatusMessage.value = 'Loading model weights...'
    await adapter.loadModel(model.value, vocab.value || undefined, {
      quantization: quantization.value,
      onProgress: (p) => {
        if (p.percent !== undefined)
          downloadPercent.value = p.percent
        if (p.message)
          testStatusMessage.value = p.message
      },
      signal,
    })

    await refreshCacheStatus()

    testStatusMessage.value = 'Prefilling prompt & generating...'
    const cleanPrompt = testPrompt.value.trim()
    const formattedPrompt = buildRwkvPrompt([
      { role: 'user', content: cleanPrompt },
    ], { enableG1Prefill: enableG1Prefill.value })

    const thinkStripper = enableG1Prefill.value ? createThinkPrefixStripper() : (s: string) => s
    const genStart = performance.now()

    await adapter.generate({
      prompt: formattedPrompt,
      maxTokens: testMaxTokens.value,
      temperature: testTemperature.value,
      topP: testTopP.value,
      presencePenalty: 0.4,
      countPenalty: 0.4,
      penaltyDecay: 0.996,
    }, {
      onToken: (chunk) => {
        if (!firstTokenTime) {
          firstTokenTime = performance.now()
          metrics.value.ttftMs = Math.round(firstTokenTime - genStart)
        }
        const stripped = thinkStripper(chunk)
        if (stripped) {
          generatedOutput.value += stripped
          tokensEmitted++
          metrics.value.tokenCount = tokensEmitted
          const elapsedSec = (performance.now() - genStart) / 1000
          if (elapsedSec > 0) {
            metrics.value.tokensPerSec = Number((tokensEmitted / elapsedSec).toFixed(1))
          }
        }
      },
      signal,
    })

    const totalDuration = performance.now() - genStart
    metrics.value.totalMs = Math.round(totalDuration)
    const elapsedSec = totalDuration / 1000
    if (elapsedSec > 0 && tokensEmitted > 0) {
      metrics.value.tokensPerSec = Number((tokensEmitted / elapsedSec).toFixed(1))
    }
    testStatusMessage.value = 'Completed'
  }
  catch (err: any) {
    if (err?.name === 'AbortError' || signal.aborted) {
      testError.value = 'Inference cancelled.'
    }
    else {
      testError.value = err?.message || String(err)
    }
    testStatusMessage.value = 'Failed'
  }
  finally {
    isRunningTest.value = false
    downloadPercent.value = -1
  }
}

const copyOutputSuccess = ref(false)
function copyOutput() {
  if (!generatedOutput.value)
    return
  navigator.clipboard.writeText(generatedOutput.value).then(() => {
    copyOutputSuccess.value = true
    setTimeout(() => {
      copyOutputSuccess.value = false
    }, 2000)
  })
}
</script>

<template>
  <ProviderSettingsLayout
    :provider-name="providerMetadata?.localizedName || 'RWKV (Local, WebGPU)'"
    :provider-description="providerMetadata?.localizedDescription"
    :provider-icon="providerMetadata?.icon"
    :provider-icon-color="providerMetadata?.iconColor"
    :provider-icon-image="providerMetadata?.iconImage"
    :deployment="providerMetadata?.deployment"
    :pricing="providerMetadata?.pricing"
    :beginner-recommended="providerMetadata?.beginnerRecommended"
    :on-back="() => router.push('/settings/providers#chat')"
  >
    <ProviderSettingsContainer class="w-full">
      <div :class="['flex flex-col xl:flex-row gap-6 w-full items-start']">
        <!-- Left Column: Model Settings & Configuration (~48%) -->
        <div :class="['w-full xl:w-[48%]', 'flex flex-col gap-6']">
          <Alert type="info">
            <template #title>
              {{ t('settings.pages.providers.provider.web-rwkv.alert.title') }}
            </template>
            <template #content>
              {{ t('settings.pages.providers.provider.web-rwkv.alert.content') }}
            </template>
          </Alert>

          <ProviderBasicSettings
            :title="t('settings.pages.providers.common.section.basic.title')"
            :description="t('settings.pages.providers.common.section.basic.description')"
            :on-reset="handleResetSettings"
          >
            <div class="space-y-5">
              <!-- Premium 2x2 Model Selection Grid -->
              <div class="space-y-2">
                <div class="flex items-center justify-between">
                  <label class="text-xs text-neutral-700 font-semibold dark:text-neutral-300">
                    Model Architecture & Size
                  </label>
                  <span class="text-[11px] text-neutral-400">
                    Single-Slot Cached (Auto-Eviction)
                  </span>
                </div>

                <div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <div
                    v-for="m in WEB_RWKV_MODELS"
                    :key="m.id"
                    :class="[
                      'p-3.5 rounded-xl border text-left cursor-pointer transition-all duration-200 relative flex flex-col justify-between gap-2.5',
                      model === m.id && !showCustomModelInput
                        ? 'border-primary-500 bg-primary-50/40 dark:bg-primary-950/20 shadow-sm ring-1 ring-primary-500/50'
                        : 'border-neutral-200 dark:border-neutral-800 bg-white/50 dark:bg-neutral-900/40 hover:border-neutral-300 dark:hover:border-neutral-700',
                    ]"
                    @click="selectModel(m)"
                  >
                    <!-- Header -->
                    <div class="flex items-start justify-between gap-2">
                      <div class="space-y-0.5">
                        <div class="flex items-center gap-1.5">
                          <span class="text-xs text-neutral-900 font-bold dark:text-neutral-100">
                            {{ m.name }}
                          </span>
                        </div>
                        <span
                          :class="[
                            'inline-block px-1.5 py-0.2 rounded text-[10px] font-semibold',
                            m.badge === 'Sweet Spot'
                              ? 'bg-amber-500/15 text-amber-600 dark:text-amber-400'
                              : m.badge === 'Nano'
                                ? 'bg-blue-500/15 text-blue-600 dark:text-blue-400'
                                : m.badge === 'Small'
                                  ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400'
                                  : 'bg-purple-500/15 text-purple-600 dark:text-purple-400',
                          ]"
                        >
                          {{ m.badge }}
                        </span>
                      </div>

                      <div
                        :class="[
                          'w-4 h-4 rounded-full flex items-center justify-center border transition-colors shrink-0',
                          model === m.id && !showCustomModelInput
                            ? 'border-primary-500 bg-primary-500 text-white'
                            : 'border-neutral-300 dark:border-neutral-700',
                        ]"
                      >
                        <div
                          v-if="model === m.id && !showCustomModelInput"
                          class="i-solar:check-read-bold text-[10px]"
                        />
                      </div>
                    </div>

                    <!-- Description -->
                    <p class="text-[11px] text-neutral-500 leading-tight dark:text-neutral-400">
                      {{ m.description }}
                    </p>

                    <!-- Footer Specs & Cache Pill -->
                    <div class="flex items-center justify-between border-t border-neutral-100 pt-2 text-[10px] text-neutral-500 font-mono dark:border-neutral-800/60 dark:text-neutral-400">
                      <span>{{ formatBytes(m.downloadBytes) }} · ~{{ m.vramMB }}MB VRAM</span>
                      <span
                        v-if="cachedModelMap[m.id]"
                        class="inline-flex items-center gap-1 text-emerald-600 font-semibold dark:text-emerald-400"
                      >
                        <div class="i-solar:check-circle-bold text-xs" />
                        Cached
                      </span>
                    </div>
                  </div>
                </div>

                <!-- Custom URL Toggle -->
                <div class="pt-1">
                  <button
                    type="button"
                    class="flex items-center gap-1 text-xs text-primary-600 font-medium dark:text-primary-400 hover:underline"
                    @click="showCustomModelInput = !showCustomModelInput"
                  >
                    <div :class="showCustomModelInput ? 'i-solar:alt-arrow-up-linear' : 'i-solar:alt-arrow-down-linear'" class="text-[10px]" />
                    <span>{{ showCustomModelInput ? 'Hide Custom Model URL' : 'Use Custom .safetensors URL' }}</span>
                  </button>

                  <div v-if="showCustomModelInput" class="mt-2 space-y-2">
                    <FieldInput
                      :model-value="customModelInput || model"
                      label="Custom Safetensors URL"
                      placeholder="https://huggingface.co/.../model.safetensors"
                      description="Specify a custom single-file safetensors URL with RWKV-native tensor names."
                      @update:model-value="handleCustomModelChange"
                    />
                  </div>
                </div>
              </div>

              <!-- Quantization & Precision Options -->
              <div class="border-t border-neutral-100 pt-4 space-y-2 dark:border-neutral-800/60">
                <div class="flex items-center justify-between">
                  <label class="text-xs text-neutral-700 font-semibold dark:text-neutral-300">
                    Precision & Quantization Mode
                  </label>
                  <span class="text-[11px] text-primary-600 font-medium dark:text-primary-400">
                    WebGPU Shader Transform
                  </span>
                </div>

                <div class="grid grid-cols-3 gap-2">
                  <div
                    :class="[
                      'p-2.5 rounded-lg border text-center cursor-pointer transition-all',
                      quantization === 'none'
                        ? 'border-primary-500 bg-primary-50/50 dark:bg-primary-950/20 font-bold text-primary-700 dark:text-primary-300'
                        : 'border-neutral-200 dark:border-neutral-800 bg-white/40 dark:bg-neutral-900/40 text-neutral-600 dark:text-neutral-400 hover:border-neutral-300',
                    ]"
                    @click="selectQuantization('none')"
                  >
                    <div class="text-xs">
                      FP16
                    </div>
                    <div class="text-[10px] opacity-75">
                      Full Precision
                    </div>
                  </div>

                  <div
                    :class="[
                      'p-2.5 rounded-lg border text-center cursor-pointer transition-all',
                      quantization === 'nf4'
                        ? 'border-primary-500 bg-primary-50/50 dark:bg-primary-950/20 font-bold text-primary-700 dark:text-primary-300'
                        : 'border-neutral-200 dark:border-neutral-800 bg-white/40 dark:bg-neutral-900/40 text-neutral-600 dark:text-neutral-400 hover:border-neutral-300',
                    ]"
                    @click="selectQuantization('nf4')"
                  >
                    <div class="text-xs">
                      NF4
                    </div>
                    <div class="text-[10px] text-emerald-600 font-semibold dark:text-emerald-400">
                      -60% VRAM
                    </div>
                  </div>

                  <div
                    :class="[
                      'p-2.5 rounded-lg border text-center cursor-pointer transition-all',
                      quantization === 'int8'
                        ? 'border-primary-500 bg-primary-50/50 dark:bg-primary-950/20 font-bold text-primary-700 dark:text-primary-300'
                        : 'border-neutral-200 dark:border-neutral-800 bg-white/40 dark:bg-neutral-900/40 text-neutral-600 dark:text-neutral-400 hover:border-neutral-300',
                    ]"
                    @click="selectQuantization('int8')"
                  >
                    <div class="text-xs">
                      Int8
                    </div>
                    <div class="text-[10px] opacity-75">
                      -40% VRAM
                    </div>
                  </div>
                </div>
                <p class="text-[11px] text-neutral-500 leading-tight dark:text-neutral-400">
                  NF4 / Int8 precision modes for catalog models load pre-quantized WebGPU prefabs instantly (~5.8s load, 50%+ download & VRAM savings).
                </p>
              </div>

              <!-- Vocab Input -->
              <FieldInput
                v-model="vocab"
                :label="t('settings.pages.providers.provider.web-rwkv.fields.vocab.label')"
                :description="t('settings.pages.providers.provider.web-rwkv.fields.vocab.description')"
                :placeholder="t('settings.pages.providers.provider.web-rwkv.fields.vocab.placeholder')"
              />
            </div>
          </ProviderBasicSettings>

          <ProviderAdvancedSettings :title="t('settings.pages.providers.common.section.advanced.title')">
            <div class="space-y-6">
              <FieldCheckbox
                v-model="enableG1Prefill"
                :label="t('settings.pages.providers.provider.web-rwkv.fields.enableG1Prefill.label')"
                :description="t('settings.pages.providers.provider.web-rwkv.fields.enableG1Prefill.description')"
              />

              <!-- Default Parameters Section -->
              <div class="border-t border-neutral-200 pt-6 dark:border-neutral-800">
                <h4 class="text-sm text-neutral-900 font-semibold dark:text-neutral-100">
                  {{ t('settings.pages.providers.provider.web-rwkv.defaultsSection.title') }}
                </h4>
                <p class="mb-4 mt-1 text-xs text-neutral-500 dark:text-neutral-400">
                  {{ t('settings.pages.providers.provider.web-rwkv.defaultsSection.description') }}
                </p>

                <div class="grid grid-cols-2 gap-4 border border-neutral-200 rounded-lg bg-neutral-50 p-4 dark:border-neutral-800 dark:bg-neutral-950">
                  <div class="text-xs text-neutral-600 dark:text-neutral-400">
                    {{ t('settings.pages.providers.provider.web-rwkv.defaultsSection.field.temperature') }}
                  </div>
                  <div class="text-xs text-neutral-600 dark:text-neutral-400">
                    {{ t('settings.pages.providers.provider.web-rwkv.defaultsSection.field.top_p') }}
                  </div>
                  <div class="text-xs text-neutral-600 dark:text-neutral-400">
                    {{ t('settings.pages.providers.provider.web-rwkv.defaultsSection.field.max_tokens') }}
                  </div>
                  <div class="text-xs text-neutral-600 dark:text-neutral-400">
                    {{ t('settings.pages.providers.provider.web-rwkv.defaultsSection.field.presence_penalty') }}
                  </div>
                  <div class="text-xs text-neutral-600 dark:text-neutral-400">
                    {{ t('settings.pages.providers.provider.web-rwkv.defaultsSection.field.count_penalty') }}
                  </div>
                  <div class="text-xs text-neutral-600 dark:text-neutral-400">
                    {{ t('settings.pages.providers.provider.web-rwkv.defaultsSection.field.penalty_decay') }}
                  </div>
                </div>

                <div class="mt-4 border border-blue-100 rounded-lg bg-blue-50/50 p-4 text-xs text-blue-800 leading-relaxed dark:border-blue-900/50 dark:bg-blue-950/20 dark:text-blue-200">
                  <p class="mb-2 font-medium">
                    {{ t('settings.pages.providers.provider.web-rwkv.defaultsSection.annotation') }}
                  </p>
                  <div class="relative mt-2">
                    <pre class="cursor-pointer overflow-x-auto border border-blue-200/60 rounded bg-blue-100/30 p-2.5 text-[11px] text-blue-900 font-mono transition dark:border-blue-800/40 dark:bg-blue-900/10 hover:bg-blue-100/50 dark:text-blue-300" @click="copyPenaltiesJson"><code>{
  "presence_penalty": 0.4,
  "count_penalty": 0.4,
  "penalty_decay": 0.996
}</code></pre>
                    <button
                      class="absolute right-2 top-2 rounded bg-blue-600 px-2 py-1 text-[10px] text-white font-medium transition active:scale-95 dark:bg-blue-500 hover:bg-blue-700 dark:hover:bg-blue-600"
                      @click="copyPenaltiesJson"
                    >
                      {{ copySuccess ? 'Copied!' : 'Copy JSON' }}
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </ProviderAdvancedSettings>

          <!-- Activation Status -->
          <div class="flex items-center justify-between border border-neutral-200 rounded-lg bg-neutral-50 p-4 dark:border-neutral-800 dark:bg-neutral-900/50">
            <div class="space-y-1">
              <h4 class="text-sm text-neutral-900 font-semibold dark:text-neutral-100">
                {{ isEnabled ? 'Provider Active' : 'Activate Provider' }}
              </h4>
              <p class="text-xs text-neutral-500 dark:text-neutral-400">
                {{ isEnabled ? 'This provider is active and available in Modules.' : 'Enable this provider to select it for character cards.' }}
              </p>
            </div>
            <button
              class="rounded-xl px-4 py-2 text-sm font-semibold transition-all duration-200"
              :class="isEnabled ? 'bg-red-500/10 text-red-600 hover:bg-red-500/20 dark:bg-red-500/20 dark:text-red-400 dark:hover:bg-red-500/30' : 'bg-primary-500 text-white hover:bg-primary-600'"
              @click="toggleProvider"
            >
              {{ isEnabled ? 'Deactivate' : 'Activate' }}
            </button>
          </div>
        </div>

        <!-- Right Column: Interactive Testing & Benchmark Playground (~52%) -->
        <div :class="['w-full xl:w-[52%]', 'flex flex-col gap-4 sticky top-4']">
          <div class="border border-neutral-200/80 rounded-2xl bg-white/70 p-5 shadow-sm space-y-4 dark:border-neutral-800/80 dark:bg-neutral-900/60">
            <!-- Playground Header -->
            <div class="flex items-start justify-between border-b border-neutral-100 pb-3 dark:border-neutral-800/60">
              <div class="space-y-0.5">
                <h3 class="flex items-center gap-2 text-sm text-neutral-900 font-bold dark:text-neutral-100">
                  <div class="i-solar:play-stream-bold-duotone text-lg text-primary-500" />
                  <span>Inference Playground & Benchmark</span>
                </h3>
                <p class="text-xs text-neutral-500 dark:text-neutral-400">
                  Live on-device WebGPU inference test with real-time token streaming and TTFT metrics.
                </p>
              </div>

              <div v-if="metrics.ttftMs !== null" class="border border-primary-500/20 rounded-lg bg-primary-500/10 px-2.5 py-1 text-xs text-primary-600 font-bold font-mono dark:text-primary-400">
                ⚡ {{ metrics.tokensPerSec }} tok/s
              </div>
            </div>

            <!-- Preset Queries -->
            <div class="space-y-1.5">
              <span class="text-[11px] text-neutral-500 font-medium dark:text-neutral-400">
                Quick Benchmarks:
              </span>
              <div class="flex flex-wrap gap-1.5">
                <button
                  v-for="p in PRESET_QUERIES"
                  :key="p.name"
                  type="button"
                  class="border border-neutral-200 rounded-lg bg-neutral-100/70 px-2.5 py-1 text-xs text-neutral-700 transition dark:border-neutral-800 dark:bg-neutral-800/60 hover:bg-neutral-200 dark:text-neutral-300 dark:hover:bg-neutral-700"
                  @click="applyPreset(p)"
                >
                  {{ p.name }}
                </button>
              </div>
            </div>

            <!-- Prompt Input -->
            <div class="space-y-1.5">
              <label class="text-xs text-neutral-700 font-semibold dark:text-neutral-300">
                Test Prompt (User Turn)
              </label>
              <textarea
                v-model="testPrompt"
                rows="4"
                placeholder="Type a prompt to test generation..."
                class="w-full border border-neutral-200 rounded-xl bg-neutral-50 p-3 text-xs text-neutral-800 leading-relaxed font-mono dark:border-neutral-800 dark:bg-neutral-950 dark:text-neutral-200 focus:outline-none focus:ring-1 focus:ring-primary-500"
              />
            </div>

            <!-- Parameters Grid -->
            <div class="grid grid-cols-3 gap-3">
              <div class="space-y-1">
                <label class="text-[10px] text-neutral-500 font-semibold tracking-wider uppercase dark:text-neutral-400">
                  Max Tokens
                </label>
                <input
                  v-model.number="testMaxTokens"
                  type="number"
                  min="32"
                  max="1024"
                  step="32"
                  class="w-full border border-neutral-200 rounded-lg bg-neutral-50 px-2.5 py-1.5 text-xs text-neutral-800 font-mono dark:border-neutral-800 dark:bg-neutral-950 dark:text-neutral-200 focus:outline-none focus:ring-1 focus:ring-primary-500"
                >
              </div>

              <div class="space-y-1">
                <label class="text-[10px] text-neutral-500 font-semibold tracking-wider uppercase dark:text-neutral-400">
                  Temperature
                </label>
                <input
                  v-model.number="testTemperature"
                  type="number"
                  min="0.1"
                  max="2.0"
                  step="0.1"
                  class="w-full border border-neutral-200 rounded-lg bg-neutral-50 px-2.5 py-1.5 text-xs text-neutral-800 font-mono dark:border-neutral-800 dark:bg-neutral-950 dark:text-neutral-200 focus:outline-none focus:ring-1 focus:ring-primary-500"
                >
              </div>

              <div class="space-y-1">
                <label class="text-[10px] text-neutral-500 font-semibold tracking-wider uppercase dark:text-neutral-400">
                  Top-P
                </label>
                <input
                  v-model.number="testTopP"
                  type="number"
                  min="0.1"
                  max="1.0"
                  step="0.05"
                  class="w-full border border-neutral-200 rounded-lg bg-neutral-50 px-2.5 py-1.5 text-xs text-neutral-800 font-mono dark:border-neutral-800 dark:bg-neutral-950 dark:text-neutral-200 focus:outline-none focus:ring-1 focus:ring-primary-500"
                >
              </div>
            </div>

            <!-- Execution Action & Status -->
            <div class="flex items-center justify-between pt-1">
              <Button
                :disabled="false"
                :class="[
                  isRunningTest ? 'bg-red-500 hover:bg-red-600 text-white' : '',
                ]"
                @click="runBenchmark"
              >
                <div v-if="isRunningTest" class="i-solar:stop-bold text-sm" />
                <div v-else class="i-solar:play-bold text-sm" />
                <span>{{ isRunningTest ? 'Halt Test' : 'Run Benchmark & Test' }}</span>
              </Button>

              <div v-if="testStatusMessage" class="flex items-center gap-1.5 text-xs text-neutral-500 font-mono dark:text-neutral-400">
                <div v-if="isRunningTest" class="i-solar:restart-bold animate-spin text-xs text-primary-500" />
                <span>{{ testStatusMessage }}</span>
                <span v-if="downloadPercent >= 0" class="text-primary-600 font-bold dark:text-primary-400">
                  ({{ downloadPercent }}%)
                </span>
              </div>
            </div>

            <!-- Error Banner -->
            <div v-if="testError" class="border border-red-500/30 rounded-xl bg-red-500/10 p-3 text-xs text-red-600 font-mono dark:text-red-400">
              {{ testError }}
            </div>

            <!-- Benchmark Metrics Banner -->
            <div v-if="metrics.ttftMs !== null || metrics.tokenCount > 0" class="grid grid-cols-4 gap-2 border border-neutral-200/80 rounded-xl bg-neutral-50/80 p-3 text-center dark:border-neutral-800 dark:bg-neutral-950/50">
              <div class="space-y-0.5">
                <div class="text-[10px] text-neutral-400 font-semibold uppercase">
                  TTFT
                </div>
                <div class="text-xs text-primary-600 font-bold font-mono dark:text-primary-400">
                  {{ metrics.ttftMs !== null ? `${metrics.ttftMs}ms` : '...' }}
                </div>
              </div>
              <div class="space-y-0.5">
                <div class="text-[10px] text-neutral-400 font-semibold uppercase">
                  Speed
                </div>
                <div class="text-xs text-emerald-600 font-bold font-mono dark:text-emerald-400">
                  {{ metrics.tokensPerSec !== null ? `${metrics.tokensPerSec} t/s` : '...' }}
                </div>
              </div>
              <div class="space-y-0.5">
                <div class="text-[10px] text-neutral-400 font-semibold uppercase">
                  Total
                </div>
                <div class="text-xs text-neutral-700 font-bold font-mono dark:text-neutral-300">
                  {{ metrics.totalMs !== null ? `${(metrics.totalMs / 1000).toFixed(2)}s` : '...' }}
                </div>
              </div>
              <div class="space-y-0.5">
                <div class="text-[10px] text-neutral-400 font-semibold uppercase">
                  Tokens
                </div>
                <div class="text-xs text-neutral-700 font-bold font-mono dark:text-neutral-300">
                  {{ metrics.tokenCount }}
                </div>
              </div>
            </div>

            <!-- Live Streaming Output Box -->
            <div class="space-y-1.5">
              <div class="flex items-center justify-between">
                <label class="flex items-center gap-1.5 text-xs text-neutral-700 font-semibold dark:text-neutral-300">
                  <div class="i-solar:terminal-bold text-sm text-neutral-400" />
                  <span>Streaming Output</span>
                </label>

                <div class="flex items-center gap-2">
                  <button
                    v-if="generatedOutput"
                    type="button"
                    class="text-[11px] text-neutral-500 transition dark:text-neutral-400 hover:text-neutral-800 dark:hover:text-neutral-200"
                    @click="copyOutput"
                  >
                    {{ copyOutputSuccess ? 'Copied!' : 'Copy' }}
                  </button>
                  <button
                    v-if="generatedOutput"
                    type="button"
                    class="text-[11px] text-neutral-500 transition hover:text-red-500"
                    @click="generatedOutput = ''"
                  >
                    Clear
                  </button>
                </div>
              </div>

              <div class="max-h-[380px] min-h-[140px] overflow-auto border border-neutral-200 rounded-xl bg-neutral-900 p-3.5 text-xs text-neutral-100 leading-relaxed font-mono dark:border-neutral-800">
                <div v-if="generatedOutput" class="whitespace-pre-wrap">
                  {{ generatedOutput }}<span v-if="isRunningTest" class="ml-0.5 inline-block h-3.5 w-1.5 animate-pulse bg-primary-400 align-middle" />
                </div>
                <div v-else-if="isRunningTest" class="flex items-center gap-2 text-neutral-500">
                  <div class="i-solar:restart-bold animate-spin text-primary-500" />
                  <span>Inferencing on WebGPU...</span>
                </div>
                <div v-else class="text-neutral-500 italic">
                  Press "Run Benchmark & Test" above to stream generated tokens in real time.
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </ProviderSettingsContainer>
  </ProviderSettingsLayout>
</template>

<route lang="yaml">
meta:
  layout: settings
  stageTransition:
    name: slide
</route>
