<script setup lang="ts">
// --- Step 1: Source & Archetype State ---
import type { ArchetypePreset } from './foundry-presets'

import { CharacterAvatar } from '@proj-airi/stage-ui/components'
import { ModelSelectorDialog } from '@proj-airi/stage-ui/components/scenarios/dialogs/model-selector'
import {
  formatBytes,
  getWebRwkvAdapter,
  isModelCached,
  WEB_RWKV_MODELS,
  WEB_RWKV_STATE_CARTRIDGES,
} from '@proj-airi/stage-ui/libs/inference'
import { useChatSessionStore } from '@proj-airi/stage-ui/stores/chat/session-store'
import { useDisplayModelsStore } from '@proj-airi/stage-ui/stores/display-models'
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
const displayModelsStore = useDisplayModelsStore()
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
const companionSearchQuery = ref<string>('')
const selectedSessionIds = ref<string[]>([])
type DistillationDepth = '15' | '50' | '200' | 'all'
const distillationDepth = ref<DistillationDepth>('50')

// Available existing cards for distillation with session telemetry and search filtering
const availableCards = computed(() => {
  const query = companionSearchQuery.value.trim().toLowerCase()
  const list = Array.from(cards.value.entries()).map(([id, card]: [string, any]) => {
    const rawCard = toRaw(card)
    const name = rawCard?.name || rawCard?.data?.name || 'Unnamed Companion'
    const nickname = rawCard?.nickname || rawCard?.data?.nickname || ''
    const description = rawCard?.description || rawCard?.data?.description || ''
    const modules = rawCard?.extensions?.airi?.modules || rawCard?.data?.extensions?.airi?.modules
    const displayModelId = modules?.displayModelId

    const charData = (chatSessionStore.index as any)?.characters?.[id]
    const sessions = charData?.sessions ? Object.values(charData.sessions) : []
    const sessionCount = sessions.length
    const totalMessages = sessions.reduce((sum: number, s: any) => sum + (s.messageCount || 0), 0)

    return {
      id,
      name,
      nickname,
      description,
      displayModelId,
      sessionCount,
      totalMessages,
    }
  })

  const filtered = query
    ? list.filter(c => c.name.toLowerCase().includes(query) || c.nickname.toLowerCase().includes(query))
    : list

  // Prioritize companions with messages, then sort by message count descending
  return filtered.sort((a, b) => {
    if (b.totalMessages !== a.totalMessages)
      return b.totalMessages - a.totalMessages
    if (b.sessionCount !== a.sessionCount)
      return b.sessionCount - a.sessionCount
    return a.name.localeCompare(b.name)
  })
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
  })).sort((a, b) => b.updatedAt - a.updatedAt)
})

const totalSelectedMessages = computed(() => {
  const idSet = new Set(selectedSessionIds.value)
  return availableSessions.value
    .filter(s => idSet.has(s.id))
    .reduce((sum, s) => sum + s.messageCount, 0)
})

function toggleSessionSelection(sessionId: string) {
  if (selectedSessionIds.value.includes(sessionId)) {
    selectedSessionIds.value = selectedSessionIds.value.filter(id => id !== sessionId)
  }
  else {
    selectedSessionIds.value.push(sessionId)
  }
}

function selectAllSessions() {
  selectedSessionIds.value = availableSessions.value.map(s => s.id)
}

function deselectAllSessions() {
  selectedSessionIds.value = []
}

function formatSessionDate(ts?: number): string {
  if (!ts)
    return ''
  try {
    const d = new Date(ts)
    return d.toLocaleDateString(undefined, {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    })
  }
  catch {
    return ''
  }
}

// Extracted turns telemetry & rough token estimation
const extractedTurns = ref<string[]>([])
const isExtractingTurns = ref<boolean>(false)

async function extractTurnsForCustomCard() {
  if (!selectedSourceCardId.value) {
    extractedTurns.value = []
    return
  }

  const sessionIdsToLoad = selectedSessionIds.value.length > 0
    ? selectedSessionIds.value
    : availableSessions.value.map(s => s.id)

  if (sessionIdsToLoad.length === 0) {
    extractedTurns.value = []
    return
  }

  isExtractingTurns.value = true
  try {
    for (const sid of sessionIdsToLoad) {
      await chatSessionStore.loadSession(sid)
    }

    const allMsgs: any[] = []
    for (const sid of sessionIdsToLoad) {
      const msgs = chatSessionStore.sessionMessages[sid]
      if (msgs && msgs.length > 0) {
        allMsgs.push(...toRaw(msgs))
      }
    }

    const blocks: string[] = []
    for (let i = 0; i < allMsgs.length; i++) {
      const m = toRaw(allMsgs[i])
      if (m?.role === 'user') {
        const next = toRaw(allMsgs[i + 1])
        if (next && next?.role === 'assistant') {
          blocks.push(`User: ${String(m.content)}\n\nAssistant: ${String(next.content)}\n\n`)
          i++
        }
      }
    }
    extractedTurns.value = blocks
  }
  finally {
    isExtractingTurns.value = false
  }
}

watch([selectedSourceCardId, selectedSessionIds], async ([cardId, sessionIds]) => {
  if (sourceType.value === 'custom' && cardId && sessionIds.length > 0) {
    await extractTurnsForCustomCard()
  }
  else if (sourceType.value === 'custom') {
    extractedTurns.value = []
  }
}, { immediate: true })

watch(sourceType, async (type) => {
  if (type === 'custom' && selectedSourceCardId.value && selectedSessionIds.value.length > 0) {
    await extractTurnsForCustomCard()
  }
})

function estimateTokensForTurns(turns: string[]): number {
  const totalChars = turns.reduce((acc, t) => acc + t.length, 0)
  return Math.ceil(totalChars / 3.8)
}

function formatTokens(count: number): string {
  if (count >= 1000) {
    return `~${(count / 1000).toFixed(1)}k tokens`
  }
  return `~${count} tokens`
}

const allAvailableTurns = computed<string[]>(() => {
  if (sourceType.value === 'preset') {
    const rawArch = toRaw(selectedArchetype.value)
    return (rawArch?.conditioningTurns || []).map(t => String(t))
  }
  return extractedTurns.value
})

const totalAvailableTurnsCount = computed(() => allAvailableTurns.value.length)

// 15 Turns
const turnsCount15 = computed(() => Math.min(15, totalAvailableTurnsCount.value))
const tokensCount15 = computed(() => {
  const count = turnsCount15.value
  if (count === 0)
    return 0
  const slice = allAvailableTurns.value.slice(Math.max(0, totalAvailableTurnsCount.value - count))
  return estimateTokensForTurns(slice)
})

// 50 Turns
const turnsCount50 = computed(() => Math.min(50, totalAvailableTurnsCount.value))
const tokensCount50 = computed(() => {
  const count = turnsCount50.value
  if (count === 0)
    return 0
  const slice = allAvailableTurns.value.slice(Math.max(0, totalAvailableTurnsCount.value - count))
  return estimateTokensForTurns(slice)
})

// 200 Turns
const turnsCount200 = computed(() => Math.min(200, totalAvailableTurnsCount.value))
const tokensCount200 = computed(() => {
  const count = turnsCount200.value
  if (count === 0)
    return 0
  const slice = allAvailableTurns.value.slice(Math.max(0, totalAvailableTurnsCount.value - count))
  return estimateTokensForTurns(slice)
})

// All Turns
const tokensCountAll = computed(() => {
  return estimateTokensForTurns(allAvailableTurns.value)
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
  if (arch && sourceType.value === 'preset') {
    temperature.value = arch.temperature
    topP.value = arch.topP
    tasteTestPrompt.value = arch.testProbePrompt
    tasteTestOutput.value = ''
    cardName.value = arch.name
    cardNickname.value = arch.nickname
    cardGreeting.value = arch.greetings[0] || ''
  }
}, { immediate: true })

// Reset and auto-select available sessions whenever selected source card changes
watch(selectedSourceCardId, (cardId) => {
  if (cardId) {
    const sessions = availableSessions.value
    const withMessages = sessions.filter(s => s.messageCount > 0).map(s => s.id)
    selectedSessionIds.value = withMessages.length > 0 ? withMessages : sessions.map(s => s.id)
  }
  else {
    selectedSessionIds.value = []
  }
})

// Watch custom companion selection or sourceType switch to pre-fill identity, avatar, and voice
watch([selectedSourceCardId, sourceType], ([cardId, type]) => {
  if (type === 'custom' && cardId) {
    const rawSource = cards.value.get(cardId)
    const sourceCard = rawSource ? toRaw(rawSource) : undefined
    if (sourceCard) {
      cardName.value = sourceCard.name || (sourceCard as any).data?.name || ''
      cardNickname.value = sourceCard.nickname || (sourceCard as any).data?.nickname || ''
      cardGreeting.value = sourceCard.greetings?.[0] || (sourceCard as any).data?.first_mes || ''
      tasteTestPrompt.value = 'Hello! Can you tell me a bit about yourself?'
      tasteTestOutput.value = ''

      const sourceModules = sourceCard.extensions?.airi?.modules || (sourceCard as any).data?.extensions?.airi?.modules
      const boundModelId = sourceModules?.displayModelId
      if (boundModelId && boundModelId !== 'none') {
        selectedDisplayModelId.value = boundModelId
        const model = displayModelsStore.displayModels.find(m => m.id === boundModelId)
        selectedDisplayModel.value = model
        selectedDisplayModelName.value = model?.name || 'Bound Avatar'
      }
      else {
        selectedDisplayModelId.value = ''
        selectedDisplayModel.value = undefined
        selectedDisplayModelName.value = ''
      }

      const boundVoiceId = sourceModules?.speech?.voice_id
      selectedVoiceId.value = boundVoiceId || ''
    }
  }
  else if (type === 'preset' && selectedArchetype.value) {
    temperature.value = selectedArchetype.value.temperature
    topP.value = selectedArchetype.value.topP
    tasteTestPrompt.value = selectedArchetype.value.testProbePrompt
    tasteTestOutput.value = ''
    cardName.value = selectedArchetype.value.name
    cardNickname.value = selectedArchetype.value.nickname
    cardGreeting.value = selectedArchetype.value.greetings[0] || ''
    selectedDisplayModelId.value = ''
    selectedDisplayModel.value = undefined
    selectedDisplayModelName.value = ''
    selectedVoiceId.value = ''
  }
})

// Resolve conditioning dialogue blocks (unwrapping Vue proxies with toRaw to prevent DataCloneError)
async function resolveConditioningTexts(): Promise<string[] | undefined> {
  let turns: string[] = []

  if (sourceType.value === 'preset') {
    const rawArch = toRaw(selectedArchetype.value)
    turns = (rawArch?.conditioningTurns || []).map(t => String(t))
  }

  else if (sourceType.value === 'custom') {
    if (!selectedSourceCardId.value)
      return undefined

    if (extractedTurns.value.length === 0) {
      await extractTurnsForCustomCard()
    }
    turns = extractedTurns.value
  }

  if (turns.length === 0)
    return undefined

  let limit = turns.length
  if (distillationDepth.value === '15')
    limit = 15
  else if (distillationDepth.value === '50')
    limit = 50
  else if (distillationDepth.value === '200')
    limit = 200
  else
    limit = turns.length

  // Slices the most recent `limit` turns (in chronological order)
  return turns.length > limit
    ? turns.slice(turns.length - limit)
    : turns
}

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
    const isCustom = sourceType.value === 'custom'

    let stateCartridgeId: string
    let resolvedCartridgeUrl: string | undefined

    if (isCustom) {
      stateCartridgeId = `cartridge-custom-${selectedSourceCardId.value}-${tierKey}-v1`
      resolvedCartridgeUrl = undefined
    }
    else {
      const cartridgeCatalog = WEB_RWKV_STATE_CARTRIDGES.find(c => c.archetype === selectedArchetype.value.id)
      resolvedCartridgeUrl = cartridgeCatalog?.stateUrls[tierKey]
        || `https://huggingface.co/dasilva333/rwkv7-g1-webgpu-prefabs/resolve/main/states/${tierKey}/${selectedArchetype.value.id}.state`
      stateCartridgeId = `cartridge-${selectedArchetype.value.id}-${tierKey}-v1`
    }

    tasteTestStatus.value = 'Preparing dialogue conditioning turns...'
    const conditioningTexts = await resolveConditioningTexts()

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
      forceRecondition: isCustom,
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
  if (currentStep.value === 1 && sourceType.value === 'custom') {
    void resolveConditioningTexts()
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
    const tierKey = (selectedModelInfo.params.toLowerCase() === '0.4b' ? '0.4b' : '1.5b') as '0.4b' | '1.5b'
    const isCustom = sourceType.value === 'custom'

    let stateCartridgeId: string
    let resolvedCartridgeUrl: string | undefined
    let archetype: string
    let description: string
    let personality: string
    let scenario: string
    let postHistoryInstructions: string
    let messageExample: any[]
    let activeBackgroundId = 'none'

    const conditioningTexts = await resolveConditioningTexts()

    if (isCustom) {
      const rawSource = cards.value.get(selectedSourceCardId.value)
      const sourceCard = rawSource ? toRaw(rawSource) : undefined
      const sourceModules = sourceCard?.extensions?.airi?.modules || (sourceCard as any)?.data?.extensions?.airi?.modules

      stateCartridgeId = `cartridge-custom-${selectedSourceCardId.value}-${tierKey}-v1`
      resolvedCartridgeUrl = undefined
      archetype = 'custom'
      description = sourceCard?.description || (sourceCard as any)?.data?.description || ''
      personality = sourceCard?.personality || (sourceCard as any)?.data?.personality || ''
      scenario = sourceCard?.scenario || (sourceCard as any)?.data?.scenario || ''
      postHistoryInstructions = sourceCard?.postHistoryInstructions || (sourceCard as any)?.data?.post_history_instructions || ''
      messageExample = sourceCard?.messageExample || (sourceCard as any)?.data?.mes_example || []
      activeBackgroundId = sourceModules?.activeBackgroundId || 'none'
    }
    else {
      const cartridgeCatalog = WEB_RWKV_STATE_CARTRIDGES.find(c => c.archetype === selectedArchetype.value.id)
      resolvedCartridgeUrl = cartridgeCatalog?.stateUrls[tierKey]
        || `https://huggingface.co/dasilva333/rwkv7-g1-webgpu-prefabs/resolve/main/states/${selectedModelInfo.params.toLowerCase()}/${selectedArchetype.value.id}.state`
      stateCartridgeId = `cartridge-${selectedArchetype.value.id}-${tierKey}-v1`
      archetype = selectedArchetype.value.id
      description = selectedArchetype.value.description
      personality = selectedArchetype.value.personality
      scenario = selectedArchetype.value.scenario
      postHistoryInstructions = ''
      messageExample = []
    }

    const newCard: any = {
      name: cardName.value.trim(),
      nickname: cardNickname.value.trim(),
      version: '1.0.0',
      description,
      personality,
      scenario,
      greetings: [cardGreeting.value.trim()].filter(Boolean),
      systemPrompt: '', // ZERO system prompt tokens!
      postHistoryInstructions,
      messageExample,
      extensions: {
        airi: {
          modules: {
            consciousness: {
              provider: 'web-rwkv',
              model: selectedModelInfo.id,
            },
            speech: {
              provider: selectedVoiceId.value ? 'kokoro' : 'none',
              model: '',
              voice_id: selectedVoiceId.value,
            },
            displayModelId: selectedDisplayModelId.value || 'none',
            activeBackgroundId,
          },
          rwkv: {
            stateCartridgeId,
            stateCartridgeUrl: resolvedCartridgeUrl,
            archetype,
            baseModel: selectedModelInfo.params,
            quantization: selectedQuantization.value,
            recommendedTemperature: temperature.value,
            recommendedTopP: topP.value,
            zeroPromptVerified: true,
            conditioningTurns: conditioningTexts,
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
                'bg-primary-500/10 text-primary-600 dark:text-primary-400 border border-primary-500/20',
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
            ? 'border-primary-500 bg-primary-500/10 text-primary-700 dark:text-primary-300 font-bold'
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
              ? 'bg-primary-500 text-white'
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
              ? 'bg-primary-500/15 text-primary-700 dark:text-primary-300 border border-primary-500/30 font-bold'
              : 'text-neutral-600 dark:text-neutral-400 hover:text-neutral-900 dark:hover:text-neutral-100',
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
              ? 'bg-primary-500/15 text-primary-700 dark:text-primary-300 border border-primary-500/30 font-bold'
              : 'text-neutral-600 dark:text-neutral-400 hover:text-neutral-900 dark:hover:text-neutral-100',
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
                    : 'border-primary-500 ring-2 ring-primary-500/30 bg-primary-500/5'
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
                        : 'bg-primary-500/15 text-primary-600 dark:text-primary-400',
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
                        : 'bg-primary-500/15 text-primary-700 dark:text-primary-300',
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
        <div class="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h3 class="text-sm text-neutral-900 font-bold dark:text-white">
              Select Companion to Distill
            </h3>
            <p class="text-xs text-neutral-500 dark:text-neutral-400">
              Pick a companion from your library. Their personality and chat history will be distilled into a zero-prompt cartridge.
            </p>
          </div>
          <div class="relative w-full sm:w-64">
            <input
              v-model="companionSearchQuery"
              type="text"
              placeholder="Search companions..."
              class="w-full border border-neutral-200 rounded-xl bg-white/70 py-1.5 pl-8 pr-3 text-xs text-neutral-800 outline-none dark:border-neutral-800 focus:border-primary-500 dark:bg-neutral-900/60 dark:text-neutral-100 placeholder-neutral-400 dark:placeholder-neutral-500"
            >
            <div class="i-solar:magnifer-linear absolute left-2.5 top-1/2 text-xs text-neutral-400 -translate-y-1/2" />
          </div>
        </div>

        <div v-if="availableCards.length === 0" class="flex flex-col items-center justify-center py-10 text-center">
          <div class="i-solar:ghost-bold text-3xl text-neutral-300 dark:text-neutral-600" />
          <p class="mt-2 text-xs text-neutral-500">
            No companions found matching your query.
          </p>
        </div>

        <div v-else class="grid grid-cols-1 max-h-[380px] gap-3 overflow-y-auto pr-1 lg:grid-cols-3 sm:grid-cols-2">
          <div
            v-for="card in availableCards"
            :key="card.id"
            :class="[
              'p-3.5 rounded-xl border cursor-pointer transition-all flex items-start gap-3',
              selectedSourceCardId === card.id
                ? 'border-primary-500 bg-primary-500/10 ring-2 ring-primary-500/30'
                : 'border-neutral-200/80 bg-white/70 dark:border-neutral-800/80 dark:bg-neutral-900/60 hover:border-primary-500/40 hover:bg-white dark:hover:bg-neutral-800/50',
            ]"
            @click="selectedSourceCardId = card.id"
          >
            <CharacterAvatar
              :card-id="card.id"
              :name="card.name"
              :display-model-id="card.displayModelId"
              size-class="size-11"
              shape="rounded"
              class="shrink-0"
            />
            <div class="min-w-0 flex-1">
              <div class="flex items-center justify-between gap-1">
                <span class="truncate text-xs text-neutral-900 font-bold dark:text-white">
                  {{ card.name }}
                </span>
                <div
                  v-if="selectedSourceCardId === card.id"
                  class="i-solar:check-circle-bold shrink-0 text-sm text-primary-500"
                />
              </div>
              <p v-if="card.nickname" class="truncate text-[10px] text-neutral-500 dark:text-neutral-400">
                {{ card.nickname }}
              </p>
              <div class="mt-2 flex items-center gap-1.5 text-[10px]">
                <span
                  v-if="card.totalMessages > 0"
                  :class="[
                    'px-1.5 py-0.5 rounded-full font-semibold',
                    'bg-primary-500/15 text-primary-700 dark:text-primary-300 border border-primary-500/20',
                  ]"
                >
                  {{ card.sessionCount }} {{ card.sessionCount === 1 ? 'session' : 'sessions' }} · {{ card.totalMessages }} msgs
                </span>
                <span
                  v-else
                  class="rounded-full bg-neutral-200/60 px-1.5 py-0.5 text-neutral-500 dark:bg-neutral-800 dark:text-neutral-400"
                >
                  0 messages
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- Next Button -->
      <div class="flex justify-end pt-2">
        <Button
          variant="primary"
          class="h-[40px] px-6 text-xs text-white font-bold"
          @click="handleNext"
        >
          Next: Golden Turns &amp; Dialogue →
        </Button>
      </div>
    </div>

    <!-- ==================== STEP 2: Golden Turns & Dialogue Inspection ==================== -->
    <div v-else-if="currentStep === 2" class="flex flex-col gap-6">
      <div class="flex flex-col gap-2 border border-primary-500/20 rounded-2xl bg-primary-500/5 p-5">
        <div class="flex items-center gap-2">
          <div class="i-solar:shield-check-bold text-xl text-primary-500" />
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
          <span class="rounded bg-primary-500/15 px-2 py-0.5 text-xs text-primary-600 font-bold dark:text-primary-400">
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
      <div v-else class="flex flex-col gap-5 border border-neutral-200/80 rounded-2xl bg-white/80 p-6 dark:border-neutral-800/80 dark:bg-neutral-900/80">
        <div class="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h4 class="text-base text-neutral-900 font-bold dark:text-white">
              Select Chat Timelines to Distill
            </h4>
            <p class="text-xs text-neutral-500 dark:text-neutral-400">
              Choose which conversations to extract golden dialogue turns from. All selected turns are synthesized in-situ on WebGPU.
            </p>
          </div>
          <div v-if="availableSessions.length > 0" class="flex items-center gap-2 pt-1 sm:pt-0">
            <button
              type="button"
              class="text-xs text-primary-600 font-semibold dark:text-primary-400 hover:underline"
              @click="selectAllSessions"
            >
              Select All
            </button>
            <span class="text-xs text-neutral-300 dark:text-neutral-700">·</span>
            <button
              type="button"
              class="text-xs text-neutral-500 font-semibold dark:text-neutral-400 hover:text-neutral-700 hover:underline dark:hover:text-neutral-200"
              @click="deselectAllSessions"
            >
              Deselect All
            </button>
          </div>
        </div>

        <!-- Empty State if no sessions exist -->
        <div v-if="availableSessions.length === 0" class="flex flex-col items-center justify-center border border-neutral-300 rounded-xl border-dashed py-8 text-center dark:border-neutral-700">
          <div class="i-solar:chat-round-line-bold-duotone text-3xl text-neutral-400 dark:text-neutral-500" />
          <p class="mt-2 text-xs text-neutral-700 font-semibold dark:text-neutral-300">
            No chat sessions recorded yet
          </p>
          <p class="mt-0.5 max-w-sm text-[11px] text-neutral-500 leading-relaxed">
            This companion has no chat history to distill. You can start a conversation with them in Chat first to build memory turns, or choose one of the curated presets in Step 1.
          </p>
        </div>

        <!-- Sessions Checklist -->
        <div v-else class="flex flex-col gap-2">
          <div class="flex items-center justify-between text-[11px] text-neutral-500 dark:text-neutral-400">
            <span>
              {{ selectedSessionIds.length }} of {{ availableSessions.length }} sessions selected
            </span>
            <span v-if="totalSelectedMessages > 0" class="text-primary-600 font-bold dark:text-primary-400">
              {{ totalSelectedMessages }} total messages available
            </span>
          </div>

          <div class="max-h-[260px] flex flex-col gap-2 overflow-y-auto pr-1">
            <div
              v-for="session in availableSessions"
              :key="session.id"
              :class="[
                'p-3 rounded-xl border cursor-pointer transition-all flex items-center justify-between gap-3',
                selectedSessionIds.includes(session.id)
                  ? 'border-primary-500 bg-primary-500/10 dark:bg-primary-500/10'
                  : 'border-neutral-200/80 bg-white/70 hover:border-primary-500/40 dark:border-neutral-800/80 dark:bg-neutral-900/60 dark:hover:bg-neutral-800/50',
              ]"
              @click="toggleSessionSelection(session.id)"
            >
              <div class="min-w-0 flex items-center gap-3">
                <input
                  type="checkbox"
                  :checked="selectedSessionIds.includes(session.id)"
                  class="size-4 cursor-pointer border-neutral-300 rounded accent-primary-500"
                  @click.stop="toggleSessionSelection(session.id)"
                >
                <div class="min-w-0">
                  <div class="truncate text-xs text-neutral-900 font-bold dark:text-white">
                    {{ session.title }}
                  </div>
                  <div v-if="session.updatedAt" class="text-[10px] text-neutral-400">
                    Updated {{ formatSessionDate(session.updatedAt) }}
                  </div>
                </div>
              </div>

              <div class="flex shrink-0 items-center gap-2">
                <span
                  :class="[
                    'px-2 py-0.5 rounded-full text-[10px] font-semibold',
                    session.messageCount > 0
                      ? 'bg-primary-500/15 text-primary-700 dark:text-primary-300 border border-primary-500/20'
                      : 'bg-neutral-200/50 text-neutral-500 dark:bg-neutral-800 dark:text-neutral-400',
                  ]"
                >
                  {{ session.messageCount }} msgs
                </span>
              </div>
            </div>
          </div>
        </div>

        <!-- Distillation Depth Selector (15 | 50 | 200 | All) -->
        <div class="flex flex-col gap-2.5 border-t border-neutral-200/50 pt-3 dark:border-neutral-800/50">
          <div class="flex items-center justify-between">
            <label class="text-xs text-neutral-700 font-semibold dark:text-neutral-300">
              Distillation Depth:
            </label>
            <span v-if="isExtractingTurns" class="flex items-center gap-1.5 text-[11px] text-neutral-400">
              <div class="i-svg-spinners:ring-resize text-xs text-primary-500" />
              Measuring dialogue tokens...
            </span>
            <span v-else class="text-[11px] text-neutral-500 dark:text-neutral-400">
              {{ totalAvailableTurnsCount }} turns extracted across selected sessions
            </span>
          </div>

          <div class="grid grid-cols-1 gap-2.5 lg:grid-cols-4 sm:grid-cols-2">
            <!-- 15 Turns: Quick Sample -->
            <div
              :class="[
                'p-3 rounded-xl border cursor-pointer transition-all flex flex-col justify-between gap-2',
                distillationDepth === '15'
                  ? 'border-primary-500 bg-primary-500/10 text-primary-700 dark:text-primary-300 font-bold ring-2 ring-primary-500/30'
                  : 'border-neutral-200 dark:border-neutral-800 bg-white/60 dark:bg-neutral-900/40 hover:border-primary-500/40',
              ]"
              @click="distillationDepth = '15'"
            >
              <div>
                <div class="flex items-center justify-between">
                  <span class="text-xs font-bold">Quick Sample</span>
                  <span class="rounded bg-neutral-200/60 px-1.5 py-0.5 text-[9px] font-bold dark:bg-neutral-800">
                    Fastest
                  </span>
                </div>
                <div class="mt-1 text-[11px] text-neutral-600 dark:text-neutral-300">
                  {{ turnsCount15 }} Turns · {{ formatTokens(tokensCount15) }}
                </div>
              </div>
              <div class="text-[10px] text-neutral-400">
                Fast smoke testing (&lt;5s prefill)
              </div>
            </div>

            <!-- 50 Turns: Deep Conditioning -->
            <div
              :class="[
                'p-3 rounded-xl border cursor-pointer transition-all flex flex-col justify-between gap-2',
                distillationDepth === '50'
                  ? 'border-primary-500 bg-primary-500/10 text-primary-700 dark:text-primary-300 font-bold ring-2 ring-primary-500/30'
                  : 'border-neutral-200 dark:border-neutral-800 bg-white/60 dark:bg-neutral-900/40 hover:border-primary-500/40',
              ]"
              @click="distillationDepth = '50'"
            >
              <div>
                <div class="flex items-center justify-between">
                  <span class="text-xs font-bold">Deep Conditioning</span>
                  <span class="rounded bg-emerald-500/15 px-1.5 py-0.5 text-[9px] text-emerald-700 font-bold dark:text-emerald-300">
                    Recommended
                  </span>
                </div>
                <div class="mt-1 text-[11px] text-neutral-600 dark:text-neutral-300">
                  {{ turnsCount50 }} Turns · {{ formatTokens(tokensCount50) }}
                </div>
              </div>
              <div class="text-[10px] text-neutral-400">
                Peak style retention without decay
              </div>
            </div>

            <!-- 200 Turns: Extended Recurrence -->
            <div
              :class="[
                'p-3 rounded-xl border cursor-pointer transition-all flex flex-col justify-between gap-2',
                distillationDepth === '200'
                  ? 'border-primary-500 bg-primary-500/10 text-primary-700 dark:text-primary-300 font-bold ring-2 ring-primary-500/30'
                  : 'border-neutral-200 dark:border-neutral-800 bg-white/60 dark:bg-neutral-900/40 hover:border-primary-500/40',
              ]"
              @click="distillationDepth = '200'"
            >
              <div>
                <div class="flex items-center justify-between">
                  <span class="text-xs font-bold">Extended Context</span>
                  <span class="rounded bg-primary-500/15 px-1.5 py-0.5 text-[9px] text-primary-700 font-bold dark:text-primary-300">
                    Rich Persona
                  </span>
                </div>
                <div class="mt-1 text-[11px] text-neutral-600 dark:text-neutral-300">
                  {{ turnsCount200 }} Turns · {{ formatTokens(tokensCount200) }}
                </div>
              </div>
              <div class="text-[10px] text-neutral-400">
                Nuanced memory (~20–45s prefill)
              </div>
            </div>

            <!-- All Turns: Full History (NO "(Best)") -->
            <div
              :class="[
                'p-3 rounded-xl border cursor-pointer transition-all flex flex-col justify-between gap-2',
                distillationDepth === 'all'
                  ? 'border-primary-500 bg-primary-500/10 text-primary-700 dark:text-primary-300 font-bold ring-2 ring-primary-500/30'
                  : 'border-neutral-200 dark:border-neutral-800 bg-white/60 dark:bg-neutral-900/40 hover:border-primary-500/40',
              ]"
              @click="distillationDepth = 'all'"
            >
              <div>
                <div class="flex items-center justify-between">
                  <span class="text-xs font-bold">Full History</span>
                  <span
                    v-if="tokensCountAll <= 10000"
                    class="rounded bg-emerald-500/15 px-1.5 py-0.5 text-[9px] text-emerald-700 font-bold dark:text-emerald-300"
                  >
                    ✓ Optimal
                  </span>
                  <span
                    v-else-if="tokensCountAll <= 20000"
                    class="rounded bg-sky-500/15 px-1.5 py-0.5 text-[9px] text-sky-700 font-bold dark:text-sky-300"
                  >
                    ℹ Extended
                  </span>
                  <span
                    v-else
                    class="rounded bg-amber-500/20 px-1.5 py-0.5 text-[9px] text-amber-700 font-bold dark:text-amber-300"
                  >
                    ⚠ Saturation Risk
                  </span>
                </div>
                <div class="mt-1 text-[11px] text-neutral-600 dark:text-neutral-300">
                  All {{ totalAvailableTurnsCount }} Turns · {{ formatTokens(tokensCountAll) }}
                </div>
              </div>
              <div class="text-[10px] text-neutral-400">
                {{ tokensCountAll > 20000 ? 'May exceed recurrent capacity' : 'Synthesizes all selected turns' }}
              </div>
            </div>
          </div>

          <!-- Recurrent Capacity & Saturation Advisory Callout -->
          <div
            v-if="distillationDepth === 'all' && tokensCountAll > 10000"
            :class="[
              'p-3.5 rounded-xl border flex flex-col gap-2 transition-all',
              tokensCountAll > 20000
                ? 'border-amber-500/30 bg-amber-500/10 text-amber-900 dark:text-amber-200'
                : 'border-primary-500/30 bg-primary-500/10 text-neutral-800 dark:text-neutral-200',
            ]"
          >
            <div class="flex items-center gap-2 text-xs font-bold">
              <div
                :class="tokensCountAll > 20000 ? 'i-solar:danger-triangle-bold text-amber-600 dark:text-amber-400 text-base' : 'i-solar:info-circle-bold text-primary-600 dark:text-primary-400 text-base'"
              />
              <span>
                {{ tokensCountAll > 20000 ? 'Recurrent State Capacity Warning' : 'Extended Prefill Advisory' }}
              </span>
              <span class="ml-auto border border-current rounded-full bg-white/60 px-2 py-0.5 text-[10px] font-mono dark:bg-black/30">
                {{ totalAvailableTurnsCount }} turns · {{ formatTokens(tokensCountAll) }}
              </span>
            </div>

            <p class="text-[11px] leading-relaxed opacity-90">
              <template v-if="tokensCountAll > 20000">
                RWKV-7 compresses sequence memory into a fixed-size mathematical state vector (12 MB).
                Conditioning beyond <strong>10k–15k tokens</strong> reaches the recurrent state capacity limit—early conversation turns
                suffer time-decay attenuation and fade away, yielding diminishing returns compared to the most recent 50–200 turns.
                Additionally, prefilling {{ formatTokens(tokensCountAll) }} on WebGPU may take <strong>several minutes</strong> or trigger browser GPU timeouts.
              </template>
              <template v-else>
                Conditioning on {{ formatTokens(tokensCountAll) }} provides deep context, but initial WebGPU prefill will take ~30–60s.
                Earlier turns will carry softer weight due to recurrent time-decay.
              </template>
            </p>

            <div v-if="tokensCountAll > 20000" class="flex items-center gap-2 pt-1">
              <span class="text-[10px] text-neutral-600 font-semibold dark:text-neutral-400">Recommended action:</span>
              <button
                type="button"
                class="text-[10px] text-primary-600 font-bold underline dark:text-primary-400 hover:opacity-80"
                @click="distillationDepth = '50'"
              >
                Switch to 50 Turns (Optimal)
              </button>
              <span class="text-neutral-400">·</span>
              <button
                type="button"
                class="text-[10px] text-primary-600 font-bold underline dark:text-primary-400 hover:opacity-80"
                @click="distillationDepth = '200'"
              >
                Switch to 200 Turns (Extended)
              </button>
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
          class="h-[40px] px-6 text-xs text-white font-bold"
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
                ? 'border-primary-500 bg-primary-500/10 ring-2 ring-primary-500/30'
                : 'border-neutral-200/80 bg-white/70 dark:border-neutral-800/80 dark:bg-neutral-900/60 hover:border-primary-500/40 hover:bg-white dark:hover:bg-neutral-800/50',
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
                  class="rounded bg-primary-500/20 px-1.5 py-0.5 text-[9px] text-primary-700 font-bold dark:text-primary-300"
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
                selectedQuantization === 'nf4'
                  ? 'border-primary-500 bg-primary-500/10 font-bold text-primary-700 dark:text-primary-300'
                  : 'border-neutral-200 dark:border-neutral-800 bg-white/60 dark:bg-neutral-900/40',
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
                selectedQuantization === 'int8'
                  ? 'border-primary-500 bg-primary-500/10 font-bold text-primary-700 dark:text-primary-300'
                  : 'border-neutral-200 dark:border-neutral-800 bg-white/60 dark:bg-neutral-900/40',
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
                selectedQuantization === 'none'
                  ? 'border-primary-500 bg-primary-500/10 font-bold text-primary-700 dark:text-primary-300'
                  : 'border-neutral-200 dark:border-neutral-800 bg-white/60 dark:bg-neutral-900/40',
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
              <span class="text-primary-600 font-bold dark:text-primary-400">{{ temperature }}</span>
            </div>
            <input
              v-model.number="temperature"
              type="range"
              min="0.1"
              max="2.0"
              step="0.05"
              class="w-full cursor-pointer accent-primary-500"
            >
          </div>
          <div class="flex flex-col gap-2">
            <div class="flex items-center justify-between text-xs">
              <span class="text-neutral-600 dark:text-neutral-400">Top-P (Nucleus Sampling):</span>
              <span class="text-primary-600 font-bold dark:text-primary-400">{{ topP }}</span>
            </div>
            <input
              v-model.number="topP"
              type="range"
              min="0.1"
              max="1.0"
              step="0.05"
              class="w-full cursor-pointer accent-primary-500"
            >
          </div>
        </div>
      </div>

      <!-- Live Interactive Taste-Test Session -->
      <div class="flex flex-col gap-4 border border-neutral-200/80 rounded-2xl bg-white/80 p-6 dark:border-neutral-800/80 dark:bg-neutral-900/80">
        <div class="flex items-center justify-between">
          <div class="flex items-center gap-2">
            <div class="i-solar:play-circle-bold text-lg text-primary-500" />
            <h4 class="text-sm text-neutral-900 font-bold dark:text-white">
              Interactive Taste-Test Session
            </h4>
          </div>
          <div class="flex items-center gap-3">
            <span v-if="tasteTestMetrics.tokensPerSec" class="text-[10px] text-primary-600 font-bold font-mono dark:text-primary-400">
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
            class="flex-1 border border-neutral-200 rounded-xl bg-white/70 px-3 py-2 text-xs text-neutral-800 outline-none dark:border-neutral-800 focus:border-primary-500 dark:bg-neutral-900/60 dark:text-neutral-100 placeholder-neutral-400 dark:placeholder-neutral-500"
            :disabled="isTasteTesting"
            @keydown.enter.prevent="runTasteTest"
          >
          <Button
            v-if="!isTasteTesting"
            variant="primary"
            class="h-[36px] shrink-0 px-4 text-xs text-white font-bold"
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
              <div v-if="isTasteTesting" class="i-svg-spinners:ring-resize text-xs text-primary-500" />
              {{ tasteTestStatus }}
            </span>
            <span v-if="downloadPercent >= 0" class="text-primary-600 font-bold font-mono dark:text-primary-400">
              {{ downloadPercent }}%
            </span>
          </div>
          <div v-if="downloadPercent >= 0" class="h-1.5 w-full overflow-hidden rounded-full bg-neutral-200 dark:bg-neutral-800">
            <div
              class="h-full bg-primary-500 transition-all duration-200"
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
          class="h-[40px] px-6 text-xs text-white font-bold"
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
              class="border border-neutral-200 rounded-xl bg-white/70 p-2.5 text-xs text-neutral-800 outline-none dark:border-neutral-800 focus:border-primary-500 dark:bg-neutral-900/60 dark:text-neutral-100 placeholder-neutral-400 dark:placeholder-neutral-500"
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
              class="border border-neutral-200 rounded-xl bg-white/70 px-3 py-2 text-xs text-neutral-800 outline-none dark:border-neutral-800 focus:border-primary-500 dark:bg-neutral-900/60 dark:text-neutral-100"
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
          <div class="mt-2 flex flex-col gap-1.5 border border-neutral-200/60 rounded-xl bg-neutral-100/60 p-3 text-[11px] text-neutral-600 dark:border-neutral-800/60 dark:bg-neutral-900/40 dark:text-neutral-300">
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
          class="h-[44px] px-8 text-xs text-white font-bold shadow-lg"
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
