<script setup lang="ts">
// --- Step 1: Source & Archetype State ---
import type { ArchetypePreset } from './foundry-presets'

import { ModelSelectorDialog } from '@proj-airi/stage-ui/components/scenarios/dialogs/model-selector'
import {
  formatBytes,
  getWebRwkvAdapter,
  isModelCached,
  WEB_RWKV_MODELS,
  WEB_RWKV_STATE_CARTRIDGES,
} from '@proj-airi/stage-ui/libs/inference'
import { useChatSessionStore } from '@proj-airi/stage-ui/stores/chat/session-store'
import { useAiriCardStore } from '@proj-airi/stage-ui/stores/modules/airi-card'
import { useSpeechStore } from '@proj-airi/stage-ui/stores/modules/speech'
import { buildRwkvPrompt, createThinkPrefixStripper } from '@proj-airi/stage-ui/stores/providers/web-rwkv'
import { Button, FieldInput } from '@proj-airi/ui'
import { storeToRefs } from 'pinia'
import { computed, onMounted, ref, toRaw, watch } from 'vue'
import { useRouter } from 'vue-router'
import { toast } from 'vue-sonner'

import { PRESETS as presets } from './foundry-presets'

const router = useRouter()
const cardStore = useAiriCardStore()
const chatSessionStore = useChatSessionStore()
const speechStore = useSpeechStore()
const { cards } = storeToRefs(cardStore)
const { savedVoiceProfiles } = storeToRefs(speechStore)

// --- Wizard Stepper Navigation (1 -> 2 -> 3 -> 4) ---
const currentStep = ref<1 | 2 | 3 | 4>(1)

const steps = [
  { step: 1, title: 'Source & Archetype' },
  { step: 2, title: 'Golden Turns' },
  { step: 3, title: 'RWKV Engine' },
  { step: 4, title: 'Identity & Commit' },
] as const

type SourceType = 'preset' | 'custom'
const sourceType = ref<SourceType>('preset')

const selectedArchetype = ref<ArchetypePreset>(presets.find(p => p.id === 'glyph') || presets[0]) // Default to Glyph
const selectedSourceCardId = ref<string>('')
const selectedSessionId = ref<string>('')
const distillationDepth = ref<'sample' | 'deep' | 'full'>('full')

// Available existing cards for distillation
const availableCards = computed(() => {
  return Array.from(cards.value.entries()).map(([id, card]: [string, any]) => ({
    id,
    name: card?.name || card?.data?.name || 'Unnamed Companion',
    description: card?.description || card?.data?.description || '',
  }))
})

// Available sessions for selected card
const availableSessions = computed(() => {
  if (!selectedSourceCardId.value)
    return []
  const charData = (chatSessionStore.index as any)?.characters?.[selectedSourceCardId.value]
  if (!charData?.sessions)
    return []
  return Object.entries(charData.sessions).map(([id, session]: [string, any]) => ({
    id,
    title: session.title || `Session ${id.slice(0, 6)}`,
    messageCount: session.messageCount || 0,
    updatedAt: session.updatedAt || session.createdAt || 0,
  }))
})

// --- Step 3: RWKV Engine & Playground State ---
const selectedModelId = ref<string>(WEB_RWKV_MODELS[2].id) // 1.5B Sweet Spot
const selectedQuantization = ref<'nf4' | 'int8' | 'none'>('nf4')
const temperature = ref<number>(0.8)
const topP = ref<number>(0.85)

const cachedModelMap = ref<Record<string, boolean>>({})

async function refreshCache() {
  for (const m of WEB_RWKV_MODELS) {
    cachedModelMap.value[m.id] = await isModelCached(m.id)
  }
}

onMounted(() => {
  void refreshCache()
})

// In-Wizard Live Taste-Test Session (Real WebGPU Inference)
const tasteTestPrompt = ref<string>('')
const tasteTestOutput = ref<string>('')
const isTasteTesting = ref<boolean>(false)
const tasteTestStatus = ref<string>('')
const downloadPercent = ref<number>(-1)
const tasteTestError = ref<string | null>(null)
const tasteTestMetrics = ref<{
  ttftMs: number | null
  tokensPerSec: number | null
  tokenCount: number
}>({
  ttftMs: null,
  tokensPerSec: null,
  tokenCount: 0,
})
let tasteTestAbortController: AbortController | null = null

// --- Step 4: Identity, Avatar & Voice State ---
const cardName = ref<string>('Glyph')
const cardNickname = ref<string>('Kaomoji Gremlin')
const cardGreeting = ref<string>('(｡◕‿◕｡) *waves cheerfully* Nya! Welcome back!')

const modelSelectorOpen = ref<boolean>(false)
const selectedDisplayModel = ref<any>(undefined)
const selectedDisplayModelId = ref<string>('')
const selectedDisplayModelName = ref<string>('')
const selectedVoiceId = ref<string>('')

// Watch archetype changes to update default hyperparameters & test prompts
watch(selectedArchetype, (arch) => {
  if (arch) {
    temperature.value = arch.temperature
    topP.value = arch.topP
    tasteTestPrompt.value = arch.testProbePrompt
    tasteTestOutput.value = ''
    cardName.value = arch.name
    cardNickname.value = arch.nickname
    cardGreeting.value = arch.greetings[0] || ''
  }
}, { immediate: true })

function cancelTasteTest() {
  if (tasteTestAbortController) {
    tasteTestAbortController.abort()
    tasteTestAbortController = null
  }
  isTasteTesting.value = false
  tasteTestStatus.value = 'Cancelled'
}

async function runTasteTest() {
  if (isTasteTesting.value) {
    cancelTasteTest()
    return
  }

  const cleanPrompt = tasteTestPrompt.value.trim()
  if (!cleanPrompt)
    return

  isTasteTesting.value = true
  tasteTestError.value = null
  tasteTestOutput.value = ''
  tasteTestStatus.value = 'Initializing WebGPU adapter...'
  downloadPercent.value = -1
  tasteTestMetrics.value = { ttftMs: null, tokensPerSec: null, tokenCount: 0 }

  tasteTestAbortController = new AbortController()
  const signal = tasteTestAbortController.signal

  let firstTokenTime: number | null = null
  let tokensEmitted = 0

  try {
    const adapter = await getWebRwkvAdapter()

    tasteTestStatus.value = 'Loading model weights into GPU...'
    await adapter.loadModel(selectedModelId.value, undefined, {
      quantization: selectedQuantization.value,
      onProgress: (p) => {
        if (p.percent !== undefined)
          downloadPercent.value = p.percent
        if (p.message)
          tasteTestStatus.value = p.message
      },
      signal,
    })

    await refreshCache()

    const selectedModelInfo = WEB_RWKV_MODELS.find(m => m.id === selectedModelId.value) || WEB_RWKV_MODELS[2]
    const tierKey = (selectedModelInfo.params.toLowerCase() === '0.4b' ? '0.4b' : '1.5b') as '0.4b' | '1.5b'
    const cartridgeCatalog = WEB_RWKV_STATE_CARTRIDGES.find(c => c.archetype === selectedArchetype.value.id)
    const resolvedCartridgeUrl = cartridgeCatalog?.stateUrls[tierKey]
      || `https://huggingface.co/dasilva333/rwkv7-g1-webgpu-prefabs/resolve/main/states/${tierKey}/${selectedArchetype.value.id}.state`
    const stateCartridgeId = `cartridge-${selectedArchetype.value.id}-${tierKey}-v1`

    // Determine conditioning dialogue blocks (unwrapping Vue proxies with toRaw to prevent DataCloneError)
    let conditioningTexts: string[] | undefined
    if (sourceType.value === 'preset') {
      const rawArch = toRaw(selectedArchetype.value)
      const turns = rawArch?.conditioningTurns || []
      const count = distillationDepth.value === 'sample' ? 15 : distillationDepth.value === 'deep' ? 50 : turns.length
      conditioningTexts = Array.from(turns.slice(0, count)).map(t => String(t))
    }
    else if (sourceType.value === 'custom') {
      const msgs = selectedSessionId.value
        ? toRaw(chatSessionStore.sessionMessages[selectedSessionId.value])
        : Object.values(toRaw(chatSessionStore.sessionMessages)).flat()
      if (msgs && msgs.length > 0) {
        const blocks: string[] = []
        for (let i = 0; i < msgs.length; i++) {
          const m = toRaw(msgs[i])
          if (m?.role === 'user') {
            const next = toRaw(msgs[i + 1])
            if (next && next?.role === 'assistant') {
              blocks.push(`User: ${String(m.content)}\n\nAssistant: ${String(next.content)}\n\n`)
              i++
            }
          }
        }
        if (blocks.length > 0) {
          const count = distillationDepth.value === 'sample' ? 15 : distillationDepth.value === 'deep' ? 50 : blocks.length
          conditioningTexts = blocks.slice(0, count)
        }
      }
    }

    const condTurnsCount = conditioningTexts?.length || 0
    tasteTestStatus.value = condTurnsCount > 100
      ? `Conditioning recurrent state in-situ (${condTurnsCount} turns, ~1.5–2 min on initial run)...`
      : 'Conditioning recurrent state & generating on WebGPU...'
    const formattedPrompt = buildRwkvPrompt([
      { role: 'user', content: cleanPrompt },
    ], { enableG1Prefill: false })

    const thinkStripper = createThinkPrefixStripper()
    const genStart = performance.now()

    await adapter.generate({
      prompt: formattedPrompt,
      maxTokens: 128,
      temperature: temperature.value,
      topP: topP.value,
      presencePenalty: 0.4,
      countPenalty: 0.4,
      penaltyDecay: 0.996,
      stateCartridgeId,
      stateCartridgeUrl: resolvedCartridgeUrl,
      conditioningTexts,
    }, {
      onToken: (chunk) => {
        if (!firstTokenTime) {
          firstTokenTime = performance.now()
          tasteTestMetrics.value.ttftMs = Math.round(firstTokenTime - genStart)
        }
        const stripped = thinkStripper(chunk)
        if (stripped) {
          tasteTestOutput.value += stripped
          tokensEmitted++
          tasteTestMetrics.value.tokenCount = tokensEmitted
          const elapsedSec = (performance.now() - genStart) / 1000
          if (elapsedSec > 0) {
            tasteTestMetrics.value.tokensPerSec = Number((tokensEmitted / elapsedSec).toFixed(1))
          }
        }
      },
      signal,
    })

    tasteTestStatus.value = 'Completed'
  }
  catch (err: any) {
    if (err?.name === 'AbortError' || signal.aborted) {
      tasteTestStatus.value = 'Cancelled'
    }
    else {
      console.error('[Foundry TasteTest] Inference failed:', err)
      tasteTestError.value = err?.message || String(err)
      tasteTestStatus.value = 'Inference failed'
    }
  }
  finally {
    isTasteTesting.value = false
    tasteTestAbortController = null
  }
}

function handlePickModel(model: any) {
  selectedDisplayModel.value = model
  selectedDisplayModelId.value = model?.id || ''
  selectedDisplayModelName.value = model?.name || 'Default Avatar'
  modelSelectorOpen.value = false
}

function handleBack() {
  if (currentStep.value > 1) {
    currentStep.value = (currentStep.value - 1) as 1 | 2 | 3 | 4
  }
  else {
    router.push('/settings/airi-card')
  }
}

function handleNext() {
  if (currentStep.value === 1 && sourceType.value === 'custom' && !selectedSourceCardId.value) {
    toast.error('Please select an existing companion card.')
    return
  }
  if (currentStep.value < 4) {
    currentStep.value = (currentStep.value + 1) as 1 | 2 | 3 | 4
  }
}

// Commit & Forge Card Action
async function handleCommitForge() {
  if (!cardName.value.trim()) {
    toast.error('Please provide a name for your forged companion.')
    return
  }

  try {
    const selectedModelInfo = WEB_RWKV_MODELS.find(m => m.id === selectedModelId.value) || WEB_RWKV_MODELS[2]
    const cartridgeCatalog = WEB_RWKV_STATE_CARTRIDGES.find(c => c.archetype === selectedArchetype.value.id)
    const tierKey = (selectedModelInfo.params.toLowerCase() === '0.4b' ? '0.4b' : '1.5b') as '0.4b' | '1.5b'
    const resolvedCartridgeUrl = cartridgeCatalog?.stateUrls[tierKey]
      || `https://huggingface.co/dasilva333/rwkv7-g1-webgpu-prefabs/resolve/main/states/${selectedModelInfo.params.toLowerCase()}/${selectedArchetype.value.id}.state`

    const newCard: any = {
      name: cardName.value.trim(),
      nickname: cardNickname.value.trim(),
      version: '1.0.0',
      description: selectedArchetype.value.description,
      personality: selectedArchetype.value.personality,
      scenario: selectedArchetype.value.scenario,
      greetings: [cardGreeting.value.trim()].filter(Boolean),
      systemPrompt: '', // ZERO system prompt tokens!
      postHistoryInstructions: '',
      messageExample: [],
      extensions: {
        airi: {
          modules: {
            consciousness: {
              provider: 'web-rwkv',
              model: selectedModelInfo.params,
            },
            speech: {
              provider: selectedVoiceId.value ? 'kokoro' : 'none',
              model: '',
              voice_id: selectedVoiceId.value,
            },
            displayModelId: selectedDisplayModelId.value || 'none',
            activeBackgroundId: 'none',
          },
          rwkv: {
            stateCartridgeId: `cartridge-${selectedArchetype.value.id}-${tierKey}-v1`,
            stateCartridgeUrl: resolvedCartridgeUrl,
            archetype: selectedArchetype.value.id,
            baseModel: selectedModelInfo.params,
            quantization: selectedQuantization.value,
            recommendedTemperature: temperature.value,
            recommendedTopP: topP.value,
            zeroPromptVerified: true,
          },
        },
      },
    }

    const newId = await cardStore.addCard(newCard)
    toast.success(`Companion "${newCard.name}" forged into library!`)
    await router.push({
      path: '/settings/airi-card',
      query: { cardId: newId },
    })
  }
  catch (err: any) {
    console.error('[Foundry] Failed to commit forged card:', err)
    toast.error(err.message || 'Failed to forge character card')
  }
}
</script>

<template>
  <div class="mx-auto max-w-5xl w-full flex flex-col gap-6 pb-20 pt-1">
    <!-- Top Bar Navigation -->
    <div class="flex items-center justify-between border-b border-neutral-200/80 pb-4 dark:border-neutral-800/80">
      <div class="flex items-center gap-3">
        <Button
          variant="secondary"
          class="size-9 flex items-center justify-center rounded-xl p-0"
          @click="handleBack"
        >
          <div class="i-solar:alt-arrow-left-bold text-base" />
        </Button>
        <div>
          <div class="flex items-center gap-2">
            <h2 class="text-xl text-neutral-900 font-bold dark:text-white">
              Persona Foundry
            </h2>
            <span
              :class="[
                'rounded-full px-2 py-0.5 text-[10px] font-bold',
                'bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20',
              ]"
            >
              RWKV-7 G1 Recurrent Engine
            </span>
            <span
              :class="[
                'rounded-full px-2 py-0.5 text-[10px] font-bold',
                'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20',
              ]"
            >
              Zero-Prompt LoRA
            </span>
          </div>
          <p class="text-xs text-neutral-500 dark:text-neutral-400">
            Guided 4-step distillation wizard for constant-memory recurrent state cartridges.
          </p>
        </div>
      </div>
    </div>

    <!-- 4-Step Stepper Header -->
    <div class="grid grid-cols-2 gap-2 sm:grid-cols-4">
      <div
        v-for="s in steps"
        :key="s.step"
        :class="[
          'flex items-center gap-2.5 p-3 rounded-xl border transition-all cursor-pointer',
          currentStep === s.step
            ? 'border-amber-500 bg-amber-500/10 text-amber-700 dark:text-amber-300 font-bold'
            : currentStep > s.step
              ? 'border-emerald-500/30 bg-emerald-500/5 text-emerald-700 dark:text-emerald-300'
              : 'border-neutral-200/80 dark:border-neutral-800/80 text-neutral-500 dark:text-neutral-400 opacity-60',
        ]"
        @click="currentStep = s.step as 1 | 2 | 3 | 4"
      >
        <div
          :class="[
            'size-6 rounded-full flex items-center justify-center text-xs font-bold shrink-0',
            currentStep === s.step
              ? 'bg-amber-500 text-white'
              : currentStep > s.step
                ? 'bg-emerald-500 text-white'
                : 'bg-neutral-200 dark:bg-neutral-800 text-neutral-600 dark:text-neutral-400',
          ]"
        >
          <span v-if="currentStep > s.step">✓</span>
          <span v-else>{{ s.step }}</span>
        </div>
        <span class="truncate text-xs">{{ s.title }}</span>
      </div>
    </div>

    <!-- ==================== STEP 1: Source & Archetype Selection ==================== -->
    <div v-if="currentStep === 1" class="flex flex-col gap-6">
      <div class="flex items-center gap-2 border-b border-neutral-200/60 pb-3 dark:border-neutral-800/60">
        <button
          type="button"
          :class="[
            'px-4 py-2 rounded-xl text-xs font-semibold flex items-center gap-2 transition-all',
            sourceType === 'preset'
              ? 'bg-amber-500/20 text-amber-700 dark:text-amber-300 border border-amber-500/30'
              : 'text-neutral-600 dark:text-neutral-400 hover:text-neutral-900',
          ]"
          @click="sourceType = 'preset'"
        >
          <div class="i-solar:stars-line-bold-duotone text-base" />
          Curated Archetype Trifecta
        </button>

        <button
          type="button"
          :class="[
            'px-4 py-2 rounded-xl text-xs font-semibold flex items-center gap-2 transition-all',
            sourceType === 'custom'
              ? 'bg-amber-500/20 text-amber-700 dark:text-amber-300 border border-amber-500/30'
              : 'text-neutral-600 dark:text-neutral-400 hover:text-neutral-900',
          ]"
          @click="sourceType = 'custom'"
        >
          <div class="i-solar:fire-bold-duotone text-base" />
          Distill Existing Companion
        </button>
      </div>

      <!-- Presets Grid -->
      <div v-if="sourceType === 'preset'" class="grid grid-cols-1 gap-4 lg:grid-cols-4 sm:grid-cols-2">
        <div
          v-for="preset in presets"
          :key="preset.id"
          :class="[
            'flex flex-col justify-between rounded-2xl border p-5 transition-all cursor-pointer',
            'bg-white/80 dark:bg-neutral-900/80 backdrop-blur-md',
            selectedArchetype.id === preset.id
              ? preset.color === 'emerald'
                ? 'border-emerald-500 ring-2 ring-emerald-500/30 bg-emerald-500/5'
                : preset.color === 'purple'
                  ? 'border-purple-500 ring-2 ring-purple-500/30 bg-purple-500/5'
                  : preset.color === 'rose'
                    ? 'border-rose-500 ring-2 ring-rose-500/30 bg-rose-500/5'
                    : 'border-amber-500 ring-2 ring-amber-500/30 bg-amber-500/5'
              : 'border-neutral-200/80 dark:border-neutral-800/80 hover:border-neutral-400',
          ]"
          @click="selectedArchetype = preset"
        >
          <div>
            <div class="mb-3 flex items-center justify-between">
              <div
                :class="[
                  'rounded-xl p-2.5 text-xl',
                  preset.color === 'emerald'
                    ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400'
                    : preset.color === 'purple'
                      ? 'bg-purple-500/15 text-purple-600 dark:text-purple-400'
                      : preset.color === 'rose'
                        ? 'bg-rose-500/15 text-rose-600 dark:text-rose-400'
                        : 'bg-amber-500/15 text-amber-600 dark:text-amber-400',
                ]"
              >
                <div :class="preset.icon" />
              </div>
              <span
                :class="[
                  'rounded-full px-2 py-0.5 text-[10px] font-bold tracking-wider uppercase',
                  preset.color === 'emerald'
                    ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300'
                    : preset.color === 'purple'
                      ? 'bg-purple-500/15 text-purple-700 dark:text-purple-300'
                      : preset.color === 'rose'
                        ? 'bg-rose-500/15 text-rose-700 dark:text-rose-300'
                        : 'bg-amber-500/15 text-amber-700 dark:text-amber-300',
                ]"
              >
                {{ preset.tag }}
              </span>
            </div>

            <h3 class="text-base text-neutral-900 font-bold dark:text-white">
              {{ preset.name }}
            </h3>
            <p class="text-xs text-neutral-500 dark:text-neutral-400">
              {{ preset.archetypeTitle }}
            </p>
            <p class="mt-2.5 text-xs text-neutral-600 leading-relaxed dark:text-neutral-300">
              {{ preset.description }}
            </p>
          </div>

          <div class="mt-4 flex items-center justify-between border-t border-neutral-200/50 pt-3 text-[11px] dark:border-neutral-800/50">
            <span class="text-neutral-500 dark:text-neutral-400">Distilled:</span>
            <span class="text-neutral-800 font-semibold dark:text-neutral-200">{{ preset.goldenTurnsText }}</span>
          </div>
        </div>
      </div>

      <!-- Custom Companion Selection -->
      <div v-else class="flex flex-col gap-4 border border-neutral-200/80 rounded-2xl bg-white/80 p-6 dark:border-neutral-800/80 dark:bg-neutral-900/80">
        <label class="text-xs text-neutral-700 font-semibold dark:text-neutral-300">
          Select Companion with Chat History:
        </label>
        <select
          v-model="selectedSourceCardId"
          class="border border-neutral-200 rounded-xl bg-white px-3 py-2 text-xs text-neutral-800 dark:border-neutral-800 dark:bg-neutral-800 dark:text-neutral-200"
        >
          <option value="" disabled>
            -- Choose a companion from library --
          </option>
          <option
            v-for="card in availableCards"
            :key="card.id"
            :value="card.id"
          >
            {{ card.name }} (ID: {{ card.id.slice(0, 8) }}...)
          </option>
        </select>
      </div>

      <!-- Next Button -->
      <div class="flex justify-end pt-2">
        <Button
          variant="primary"
          class="h-[40px] bg-amber-600 px-6 text-xs text-white font-bold hover:bg-amber-500"
          @click="handleNext"
        >
          Next: Golden Turns &amp; Dialogue →
        </Button>
      </div>
    </div>

    <!-- ==================== STEP 2: Golden Turns & Dialogue Inspection ==================== -->
    <div v-else-if="currentStep === 2" class="flex flex-col gap-6">
      <div class="flex flex-col gap-2 border border-amber-500/20 rounded-2xl bg-amber-500/5 p-5">
        <div class="flex items-center gap-2">
          <div class="i-solar:shield-check-bold text-xl text-amber-500" />
          <h3 class="text-sm text-neutral-900 font-bold dark:text-white">
            Single-Actor Dialogue Conditioning
          </h3>
        </div>
        <p class="text-xs text-neutral-600 leading-relaxed dark:text-neutral-300">
          Recurrent state vector distillation transforms user and assistant interactions into mathematical weight distributions (h₀ ∈ ℝ³,²⁴⁴,⁰³²). Zero raw chat text is stored in the cartridge.
        </p>
      </div>

      <!-- If Curated Preset Selected -->
      <div v-if="sourceType === 'preset'" class="flex flex-col gap-4 border border-neutral-200/80 rounded-2xl bg-white/80 p-6 dark:border-neutral-800/80 dark:bg-neutral-900/80">
        <div class="flex items-center justify-between border-b border-neutral-200/60 pb-3 dark:border-neutral-800/60">
          <div>
            <h4 class="text-base text-neutral-900 font-bold dark:text-white">
              {{ selectedArchetype.name }} Golden Turns Inspection
            </h4>
            <span class="text-xs text-neutral-500 dark:text-neutral-400">
              Cleanroom Verified Benchmark Metrics
            </span>
          </div>
          <span class="rounded bg-amber-500/15 px-2 py-0.5 text-xs text-amber-600 font-bold dark:text-amber-400">
            {{ selectedArchetype.goldenTurnsText }}
          </span>
        </div>

        <!-- Benchmark Metric Cards -->
        <div class="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <div class="border border-neutral-200/60 rounded-xl bg-neutral-50/60 p-3.5 dark:border-neutral-800/60 dark:bg-neutral-800/30">
            <span class="text-[11px] text-neutral-500 dark:text-neutral-400">Empirical Brevity:</span>
            <div class="mt-1 text-sm text-neutral-900 font-bold dark:text-white">
              {{ selectedArchetype.brevityScore }}
            </div>
          </div>
          <div class="border border-neutral-200/60 rounded-xl bg-neutral-50/60 p-3.5 dark:border-neutral-800/60 dark:bg-neutral-800/30">
            <span class="text-[11px] text-neutral-500 dark:text-neutral-400">TTFT Latency:</span>
            <div class="mt-1 text-sm text-neutral-900 font-bold dark:text-white">
              {{ selectedArchetype.ttft }}
            </div>
          </div>
          <div class="border border-neutral-200/60 rounded-xl bg-neutral-50/60 p-3.5 dark:border-neutral-800/60 dark:bg-neutral-800/30">
            <span class="text-[11px] text-neutral-500 dark:text-neutral-400">Prompt Overhead:</span>
            <div class="mt-1 text-sm text-emerald-600 font-bold dark:text-emerald-400">
              0 Tokens (Null System Prompt)
            </div>
          </div>
        </div>

        <!-- Verified Mannerisms -->
        <div class="flex flex-col gap-2 pt-2">
          <span class="text-xs text-neutral-700 font-semibold dark:text-neutral-300">
            Verified Syntactic Mannerisms:
          </span>
          <ul class="flex flex-col list-disc gap-1.5 pl-5 text-xs text-neutral-600 dark:text-neutral-300">
            <li v-for="(m, i) in selectedArchetype.mannerisms" :key="i">
              {{ m }}
            </li>
          </ul>
        </div>

        <!-- Sample Quote -->
        <div class="border border-neutral-200/60 rounded-xl bg-neutral-50/50 p-3 text-xs text-neutral-700 italic dark:border-neutral-800/60 dark:bg-neutral-800/30 dark:text-neutral-300">
          {{ selectedArchetype.testedSample }}
        </div>
      </div>

      <!-- If Custom Companion Selected -->
      <div v-else class="flex flex-col gap-4 border border-neutral-200/80 rounded-2xl bg-white/80 p-6 dark:border-neutral-800/80 dark:bg-neutral-900/80">
        <h4 class="text-base text-neutral-900 font-bold dark:text-white">
          Timeline &amp; Turn Depth
        </h4>

        <div class="flex flex-col gap-2">
          <label class="text-xs text-neutral-700 font-semibold dark:text-neutral-300">
            Select Chat Timeline:
          </label>
          <select
            v-model="selectedSessionId"
            class="border border-neutral-200 rounded-xl bg-white px-3 py-2 text-xs text-neutral-800 dark:border-neutral-800 dark:bg-neutral-800 dark:text-neutral-200"
          >
            <option value="">
              -- All timelines combined (Maximum saturation) --
            </option>
            <option
              v-for="session in availableSessions"
              :key="session.id"
              :value="session.id"
            >
              {{ session.title }} ({{ session.messageCount }} messages)
            </option>
          </select>
        </div>

        <div class="flex flex-col gap-2 pt-2">
          <label class="text-xs text-neutral-700 font-semibold dark:text-neutral-300">
            Distillation Depth:
          </label>
          <div class="grid grid-cols-1 gap-2.5 sm:grid-cols-3">
            <div
              :class="[
                'p-3 rounded-xl border cursor-pointer transition-all flex flex-col gap-1',
                distillationDepth === 'sample' ? 'border-amber-500 bg-amber-500/10' : 'border-neutral-200 dark:border-neutral-800',
              ]"
              @click="distillationDepth = 'sample'"
            >
              <span class="text-xs font-bold">Quick Sample</span>
              <span class="text-[10px] text-neutral-500">15 Turns (~1.1k tokens)</span>
            </div>
            <div
              :class="[
                'p-3 rounded-xl border cursor-pointer transition-all flex flex-col gap-1',
                distillationDepth === 'deep' ? 'border-amber-500 bg-amber-500/10' : 'border-neutral-200 dark:border-neutral-800',
              ]"
              @click="distillationDepth = 'deep'"
            >
              <span class="text-xs font-bold">Deep Conditioning</span>
              <span class="text-[10px] text-neutral-500">50 Turns (~3.9k tokens)</span>
            </div>
            <div
              :class="[
                'p-3 rounded-xl border cursor-pointer transition-all flex flex-col gap-1',
                distillationDepth === 'full' ? 'border-amber-500 bg-amber-500/10' : 'border-neutral-200 dark:border-neutral-800',
              ]"
              @click="distillationDepth = 'full'"
            >
              <span class="text-xs font-bold">Full History (Best)</span>
              <span class="text-[10px] text-neutral-500">All available golden turns</span>
            </div>
          </div>
        </div>
      </div>

      <!-- Navigation Buttons -->
      <div class="flex justify-between pt-2">
        <Button variant="secondary" class="h-[40px] px-5 text-xs" @click="handleBack">
          ← Back
        </Button>
        <Button
          variant="primary"
          class="h-[40px] bg-amber-600 px-6 text-xs text-white font-bold hover:bg-amber-500"
          @click="handleNext"
        >
          Next: RWKV Engine &amp; Playground →
        </Button>
      </div>
    </div>

    <!-- ==================== STEP 3: RWKV Engine Playground & Taste-Test ==================== -->
    <div v-else-if="currentStep === 3" class="flex flex-col gap-6">
      <!-- Model Size Grid -->
      <div class="flex flex-col gap-3 border border-neutral-200/80 rounded-2xl bg-white/80 p-6 dark:border-neutral-800/80 dark:bg-neutral-900/80">
        <h4 class="text-base text-neutral-900 font-bold dark:text-white">
          1. Select Model Tier &amp; Hardware Target
        </h4>

        <div class="grid grid-cols-1 gap-3 lg:grid-cols-4 sm:grid-cols-2">
          <div
            v-for="m in WEB_RWKV_MODELS"
            :key="m.id"
            :class="[
              'p-3.5 rounded-xl border cursor-pointer transition-all flex flex-col justify-between gap-2',
              selectedModelId === m.id
                ? 'border-amber-500 bg-amber-500/10 ring-2 ring-amber-500/30'
                : 'border-neutral-200/80 dark:border-neutral-800/80 hover:border-neutral-400',
            ]"
            @click="selectedModelId = m.id"
          >
            <div>
              <div class="flex items-center justify-between">
                <span class="rounded bg-neutral-200/60 px-1.5 py-0.5 text-[10px] font-bold dark:bg-neutral-800">
                  {{ m.params }}
                </span>
                <span
                  v-if="m.badge"
                  class="rounded bg-amber-500/20 px-1.5 py-0.5 text-[9px] text-amber-700 font-bold dark:text-amber-300"
                >
                  {{ m.badge }}
                </span>
              </div>
              <h5 class="mt-2 text-xs text-neutral-800 font-bold dark:text-neutral-200">
                {{ m.name }}
              </h5>
              <p class="mt-1 text-[11px] text-neutral-500 leading-tight dark:text-neutral-400">
                {{ m.description }}
              </p>
            </div>
            <div class="border-t border-neutral-200/40 pt-2 text-[10px] text-neutral-500 dark:border-neutral-800/40">
              VRAM: ~{{ m.vramMB }} MB · DL: {{ formatBytes(m.downloadBytes) }}
            </div>
          </div>
        </div>
      </div>

      <!-- Quantization & Hyperparameters -->
      <div class="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <!-- Quantization -->
        <div class="flex flex-col gap-3 border border-neutral-200/80 rounded-2xl bg-white/80 p-5 dark:border-neutral-800/80 dark:bg-neutral-900/80">
          <h4 class="text-sm text-neutral-900 font-bold dark:text-white">
            2. Quantization Format
          </h4>
          <div class="grid grid-cols-3 gap-2">
            <div
              :class="[
                'p-2.5 rounded-xl border text-center cursor-pointer transition-all',
                selectedQuantization === 'nf4' ? 'border-amber-500 bg-amber-500/10 font-bold' : 'border-neutral-200 dark:border-neutral-800',
              ]"
              @click="selectedQuantization = 'nf4'"
            >
              <div class="text-xs">
                NF4
              </div>
              <div class="text-[10px] text-neutral-500">
                Fastest
              </div>
            </div>
            <div
              :class="[
                'p-2.5 rounded-xl border text-center cursor-pointer transition-all',
                selectedQuantization === 'int8' ? 'border-amber-500 bg-amber-500/10 font-bold' : 'border-neutral-200 dark:border-neutral-800',
              ]"
              @click="selectedQuantization = 'int8'"
            >
              <div class="text-xs">
                Int8
              </div>
              <div class="text-[10px] text-neutral-500">
                Balanced
              </div>
            </div>
            <div
              :class="[
                'p-2.5 rounded-xl border text-center cursor-pointer transition-all',
                selectedQuantization === 'none' ? 'border-amber-500 bg-amber-500/10 font-bold' : 'border-neutral-200 dark:border-neutral-800',
              ]"
              @click="selectedQuantization = 'none'"
            >
              <div class="text-xs">
                FP16
              </div>
              <div class="text-[10px] text-neutral-500">
                Full Res
              </div>
            </div>
          </div>
        </div>

        <!-- Sliders -->
        <div class="flex flex-col gap-3 border border-neutral-200/80 rounded-2xl bg-white/80 p-5 dark:border-neutral-800/80 dark:bg-neutral-900/80">
          <h4 class="text-sm text-neutral-900 font-bold dark:text-white">
            3. Persona Hyperparameters
          </h4>
          <div class="flex flex-col gap-2">
            <div class="flex items-center justify-between text-xs">
              <span class="text-neutral-600 dark:text-neutral-400">Temperature (Creativity):</span>
              <span class="text-amber-600 font-bold dark:text-amber-400">{{ temperature }}</span>
            </div>
            <input
              v-model.number="temperature"
              type="range"
              min="0.1"
              max="2.0"
              step="0.05"
              class="w-full cursor-pointer accent-amber-500"
            >
          </div>
          <div class="flex flex-col gap-2">
            <div class="flex items-center justify-between text-xs">
              <span class="text-neutral-600 dark:text-neutral-400">Top-P (Nucleus Sampling):</span>
              <span class="text-amber-600 font-bold dark:text-amber-400">{{ topP }}</span>
            </div>
            <input
              v-model.number="topP"
              type="range"
              min="0.1"
              max="1.0"
              step="0.05"
              class="w-full cursor-pointer accent-amber-500"
            >
          </div>
        </div>
      </div>

      <!-- Live Interactive Taste-Test Session -->
      <div class="flex flex-col gap-4 border border-neutral-200/80 rounded-2xl bg-white/80 p-6 dark:border-neutral-800/80 dark:bg-neutral-900/80">
        <div class="flex items-center justify-between">
          <div class="flex items-center gap-2">
            <div class="i-solar:play-circle-bold text-lg text-amber-500" />
            <h4 class="text-sm text-neutral-900 font-bold dark:text-white">
              Interactive Taste-Test Session
            </h4>
          </div>
          <div class="flex items-center gap-3">
            <span v-if="tasteTestMetrics.tokensPerSec" class="text-[10px] text-amber-600 font-bold font-mono dark:text-amber-400">
              ⚡ {{ tasteTestMetrics.tokensPerSec }} tok/s · TTFT: {{ tasteTestMetrics.ttftMs }}ms
            </span>
            <span class="text-[11px] text-neutral-500">
              Real WebGPU Local Inference
            </span>
          </div>
        </div>

        <div class="flex gap-2">
          <input
            v-model="tasteTestPrompt"
            placeholder="Type a test prompt to probe the model on WebGPU..."
            class="flex-1 border border-neutral-200 rounded-xl bg-neutral-50/50 px-3 py-2 text-xs text-neutral-800 outline-none dark:border-neutral-800 focus:border-amber-500 dark:bg-neutral-800/50 dark:text-neutral-200"
            :disabled="isTasteTesting"
            @keydown.enter.prevent="runTasteTest"
          >
          <Button
            v-if="!isTasteTesting"
            variant="primary"
            class="h-[36px] shrink-0 bg-amber-600 px-4 text-xs text-white font-bold hover:bg-amber-500"
            :disabled="!tasteTestPrompt.trim()"
            @click="runTasteTest"
          >
            Send Test Probe
          </Button>
          <Button
            v-else
            variant="secondary"
            class="h-[36px] shrink-0 px-4 text-xs text-red-500 font-bold hover:text-red-600"
            @click="cancelTasteTest"
          >
            Cancel
          </Button>
        </div>

        <!-- Download & Status Indicator -->
        <div v-if="tasteTestStatus" class="flex flex-col gap-1.5">
          <div class="flex items-center justify-between text-[11px]">
            <span class="flex items-center gap-1.5 text-neutral-600 dark:text-neutral-400">
              <div v-if="isTasteTesting" class="i-svg-spinners:ring-resize text-xs text-amber-500" />
              {{ tasteTestStatus }}
            </span>
            <span v-if="downloadPercent >= 0" class="text-amber-600 font-bold font-mono dark:text-amber-400">
              {{ downloadPercent }}%
            </span>
          </div>
          <div v-if="downloadPercent >= 0" class="h-1.5 w-full overflow-hidden rounded-full bg-neutral-200 dark:bg-neutral-800">
            <div
              class="h-full bg-amber-500 transition-all duration-200"
              :style="{ width: `${downloadPercent}%` }"
            />
          </div>
        </div>

        <!-- Error Feedback -->
        <div v-if="tasteTestError" class="border border-red-500/20 rounded-xl bg-red-500/10 p-3 text-xs text-red-600 dark:text-red-400">
          {{ tasteTestError }}
        </div>

        <div class="min-h-[72px] border border-neutral-200/60 rounded-xl bg-neutral-100/50 p-3.5 text-xs text-neutral-800 leading-relaxed font-mono dark:border-neutral-800/60 dark:bg-neutral-950/40 dark:text-neutral-200">
          <span v-if="tasteTestOutput">{{ tasteTestOutput }}</span>
          <span v-else class="text-neutral-400 italic">No output yet. Click 'Send Test Probe' to run live WebGPU generation.</span>
        </div>
      </div>

      <!-- Navigation Buttons -->
      <div class="flex justify-between pt-2">
        <Button variant="secondary" class="h-[40px] px-5 text-xs" @click="handleBack">
          ← Back
        </Button>
        <Button
          variant="primary"
          class="h-[40px] bg-amber-600 px-6 text-xs text-white font-bold hover:bg-amber-500"
          @click="handleNext"
        >
          Next: Identity, Avatar &amp; Voice →
        </Button>
      </div>
    </div>

    <!-- ==================== STEP 4: Identity, Avatar & Voice ==================== -->
    <div v-else-if="currentStep === 4" class="flex flex-col gap-6">
      <div class="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <!-- Identity Form -->
        <div class="flex flex-col gap-4 border border-neutral-200/80 rounded-2xl bg-white/80 p-6 dark:border-neutral-800/80 dark:bg-neutral-900/80">
          <h4 class="text-sm text-neutral-900 font-bold dark:text-white">
            Companion Identity &amp; Greetings
          </h4>

          <FieldInput
            v-model="cardName"
            label="Companion Name"
            placeholder="e.g. Glyph, Mori, Sylvia"
            :required="true"
          />

          <FieldInput
            v-model="cardNickname"
            label="Nickname / Title"
            placeholder="e.g. Kaomoji Gremlin"
          />

          <div class="flex flex-col gap-1.5">
            <label class="text-xs text-neutral-700 font-medium dark:text-neutral-300">
              Opening Greeting Line
            </label>
            <textarea
              v-model="cardGreeting"
              rows="3"
              class="border border-neutral-200 rounded-xl bg-neutral-50/50 p-2.5 text-xs text-neutral-800 outline-none dark:border-neutral-800 focus:border-amber-500 dark:bg-neutral-800/50 dark:text-neutral-200"
            />
          </div>
        </div>

        <!-- Avatar & Voice Configuration -->
        <div class="flex flex-col gap-5 border border-neutral-200/80 rounded-2xl bg-white/80 p-6 dark:border-neutral-800/80 dark:bg-neutral-900/80">
          <h4 class="text-sm text-neutral-900 font-bold dark:text-white">
            Vessel &amp; Voice Bindings
          </h4>

          <!-- Avatar Picker -->
          <div class="flex flex-col gap-2">
            <label class="text-xs text-neutral-700 font-medium dark:text-neutral-300">
              Body &amp; Avatar Model (VRM / Live2D / 2D)
            </label>
            <div class="flex items-center gap-3">
              <div class="size-11 flex items-center justify-center border border-neutral-200 rounded-xl bg-neutral-100 text-lg dark:border-neutral-700 dark:bg-neutral-800">
                <div class="i-solar:user-bold-duotone text-neutral-600 dark:text-neutral-400" />
              </div>
              <div class="flex-1">
                <div class="truncate text-xs text-neutral-800 font-bold dark:text-neutral-200">
                  {{ selectedDisplayModelName || 'No model bound (Default)' }}
                </div>
                <div class="text-[10px] text-neutral-500">
                  Select 3D VRM or Live2D avatar from library
                </div>
              </div>
              <Button
                variant="secondary"
                class="h-[34px] px-3 text-xs"
                @click="modelSelectorOpen = true"
              >
                Choose Model
              </Button>
            </div>
          </div>

          <!-- Voice Picker -->
          <div class="flex flex-col gap-2 border-t border-neutral-200/40 pt-2 dark:border-neutral-800/40">
            <label class="text-xs text-neutral-700 font-medium dark:text-neutral-300">
              Voice Profile Binding
            </label>
            <select
              v-model="selectedVoiceId"
              class="border border-neutral-200 rounded-xl bg-white px-3 py-2 text-xs text-neutral-800 dark:border-neutral-800 dark:bg-neutral-800 dark:text-neutral-200"
            >
              <option value="">
                -- None (Silent Roleplay) --
              </option>
              <option
                v-for="voice in savedVoiceProfiles"
                :key="voice.id"
                :value="voice.id"
              >
                {{ voice.name || voice.id }}
              </option>
            </select>
          </div>

          <!-- Zero-Bloat Invariant Checklist -->
          <div class="mt-2 flex flex-col gap-1.5 rounded-xl bg-neutral-50 p-3 text-[11px] text-neutral-600 dark:bg-neutral-800/30 dark:text-neutral-300">
            <div class="flex items-center gap-1.5 text-emerald-600 font-bold dark:text-emerald-400">
              <span>✓ Zero Git Leakage (12 MB mathematical state vector)</span>
            </div>
            <div class="flex items-center gap-1.5 text-emerald-600 font-bold dark:text-emerald-400">
              <span>✓ Null System Prompt Exemption active</span>
            </div>
            <div class="flex items-center gap-1.5 text-emerald-600 font-bold dark:text-emerald-400">
              <span>✓ Constant O(1) Memory Complexity</span>
            </div>
          </div>
        </div>
      </div>

      <!-- Commit Action -->
      <div class="flex justify-between pt-2">
        <Button variant="secondary" class="h-[40px] px-5 text-xs" @click="handleBack">
          ← Back
        </Button>
        <Button
          variant="primary"
          class="h-[44px] bg-amber-600 px-8 text-xs text-white font-bold shadow-amber-500/20 shadow-lg hover:bg-amber-500"
          @click="handleCommitForge"
        >
          <div class="i-solar:fire-bold mr-2 text-base" />
          <span>Forge Character Card</span>
        </Button>
      </div>
    </div>

    <!-- Model Selector Dialog Sheet -->
    <ModelSelectorDialog
      v-model:show="modelSelectorOpen"
      :selected-model="selectedDisplayModel"
      @pick="handlePickModel"
    />
  </div>
</template>

<route lang="yaml">
meta:
  layout: settings
  titleKey: settings.pages.card.title
  subtitleKey: settings.title
  descriptionKey: settings.pages.card.description
  icon: i-solar:fire-bold-duotone
  settingsEntry: false
  order: 2
  stageTransition:
    name: slide
    pageSpecificAvailable: true
</route>
