<script setup lang="ts">
import RendererStage from '@proj-airi/stage-ui/components/scenes/RendererStage.vue'

import { useElectronEventaInvoke } from '@proj-airi/electron-vueuse'
import { useLive2d } from '@proj-airi/stage-ui-live2d/stores'
import { useMmd } from '@proj-airi/stage-ui-mmd'
import { useSpine } from '@proj-airi/stage-ui-spine'
import { useCustomVrmAnimationsStore, useModelStore } from '@proj-airi/stage-ui-three'
import { ModelCustomizer } from '@proj-airi/stage-ui/components/scenarios/settings/model-settings'
import {
  buildPersonaContext,
  createSentenceStrideBuffer,
  resolveCueToken,
  splitSentences,
} from '@proj-airi/stage-ui/composables'
import { useLlmmarkerParser } from '@proj-airi/stage-ui/composables/llm-marker-parser'
import { getSpeechBusContext, speechSegmentPlaybackEvent } from '@proj-airi/stage-ui/libs/speech/playback-events'
import { useAnimaDexWizardStore } from '@proj-airi/stage-ui/stores/animadex-wizard'
import { useChatOrchestratorStore } from '@proj-airi/stage-ui/stores/chat'
import { DisplayModelFormat, useDisplayModelsStore } from '@proj-airi/stage-ui/stores/display-models'
import { useLLM } from '@proj-airi/stage-ui/stores/llm'
import { useAiriCardStore } from '@proj-airi/stage-ui/stores/modules/airi-card'
import { useAutonomousArtistryStore } from '@proj-airi/stage-ui/stores/modules/artistry-autonomous'
import { useConsciousnessStore } from '@proj-airi/stage-ui/stores/modules/consciousness'
import { useSystemOneStore } from '@proj-airi/stage-ui/stores/modules/system-one'
import { useTextToMotionStore } from '@proj-airi/stage-ui/stores/modules/text-to-motion'
import { useProvidersStore } from '@proj-airi/stage-ui/stores/providers'
import { useSpeechRuntimeStore } from '@proj-airi/stage-ui/stores/speech-runtime'
import { Checkbox } from '@proj-airi/ui'
import { useBroadcastChannel, useLocalStorage } from '@vueuse/core'
import { storeToRefs } from 'pinia'
import { computed, onMounted, ref, watch } from 'vue'
import { toast } from 'vue-sonner'

import * as v from 'valibot'

import { electronOpenSettings } from '../../../shared/eventa'

const openSettings = useElectronEventaInvoke(electronOpenSettings)

const airiCardStore = useAiriCardStore()
const displayModelsStore = useDisplayModelsStore()
const wizardStore = useAnimaDexWizardStore()
const autonomousArtistryStore = useAutonomousArtistryStore()
const llmStore = useLLM()
const consciousnessStore = useConsciousnessStore()
const providersStore = useProvidersStore()
const orchestrator = useChatOrchestratorStore()
const customVrmAnimationsStore = useCustomVrmAnimationsStore()
const speechRuntimeStore = useSpeechRuntimeStore()
const systemOneStore = useSystemOneStore()
const live2dStore = useLive2d()
const vrmModelStore = useModelStore()
const mmdRehearsalStore = useMmd()
const spineRehearsalStore = useSpine()

const { activeCard, activeCardId } = storeToRefs(airiCardStore)
const { activeProvider, activeModel } = storeToRefs(consciousnessStore)

interface SpeakingState {
  mouthOpenSize: number
  nowSpeaking: boolean
}
const { data: speakingState } = useBroadcastChannel<SpeakingState, SpeakingState>({ name: 'airi-speaking-state' })

onMounted(async () => {
  if (wizardStore.characters.length === 0)
    await wizardStore.loadCatalog()
})

const selectedKey = ref<string | null>(null)

// Inline stage viewport (Phase A): local canvas so expression previews work
// with the Stage window closed. Audio playback still routes to the stage host
// (see playRehearsal gate below) — local speech hosting lands in Phase C.
const inlineStageCollapsed = ref(false)
const inlineStageXOffset = ref(0)
const inlineStageYOffset = ref(0)
const inlineStageScale = ref(1)

function handleInlineStageOffsetChange(pos: { x: number, y: number }) {
  inlineStageXOffset.value = pos.x
  inlineStageYOffset.value = pos.y
}

function handleInlineStageScaleChange(scale: number) {
  inlineStageScale.value = scale
}

function getModelPreviewUrl(modelId?: string) {
  if (!modelId)
    return ''
  const model = displayModelsStore.displayModels.find(m => m.id === modelId)
  return model?.previewImage || ''
}

/**
 * Rehearsal room is only concerned with 3D models that are physically "on set".
 *
 * Case A (Multi-Actor): collect every visual_asset entry that has a manifestation.modelId bound.
 *
 * Case B (Single-Actor / Fallback): If NO entries have a manifestation.modelId,
 * we synthesize 1 manually constructed item representing the active modules.displayModelId.
 */
const onSetModels = computed(() => {
  if (!activeCard.value)
    return []

  const assets = (activeCard.value.extensions?.airi?.visual_assets || {}) as Record<string, any>
  const modules = (activeCard.value.extensions?.airi?.modules || {}) as Record<string, any>

  const list: Array<{
    key: string
    name: string
    modelId: string
    avatarUrl: string
    isFallback: boolean
  }> = []

  // Check visual assets for per-actor manifestations
  for (const key of Object.keys(assets)) {
    const asset = assets[key] || {}
    const mod = modules[key] || {}

    const modelId = mod.manifestation?.modelId || asset.manifestation?.modelId
    if (!modelId)
      continue

    let displayName = key
    if (key === 'concept_user')
      displayName = 'User Entity'
    else
      displayName = key.replace(/^(actor_|actress_)/, '').replace(/_/g, ' ')

    let avatarUrl = getModelPreviewUrl(modelId)
    if (!avatarUrl) {
      const rawPrompt = mod.prompt || asset.prompt || ''
      const match = wizardStore.findCatalogCharacter(rawPrompt)
      const canonicalTrigger = match ? match.trigger : rawPrompt.split(',')[0]?.trim()
      avatarUrl = wizardStore.getCharacterThumbUrl(canonicalTrigger) || ''
    }

    list.push({
      key,
      name: displayName.charAt(0).toUpperCase() + displayName.slice(1),
      modelId,
      avatarUrl,
      isFallback: false,
    })
  }

  // Fallback Case B: Simple/Gen1 card with no per-actor manifestations.
  // Synthesize one single-item roster representing modules.displayModelId
  if (list.length === 0) {
    const fallbackId = modules.displayModelId
    if (fallbackId) {
      const displayName = (activeCard.value as any).nickname || activeCard.value.name || 'Primary Actor'
      let avatarUrl = getModelPreviewUrl(fallbackId)
      if (!avatarUrl) {
        const rawPrompt = activeCard.value.systemPrompt || ''
        const match = wizardStore.findCatalogCharacter(rawPrompt)
        const canonicalTrigger = match ? match.trigger : rawPrompt.split(',')[0]?.trim()
        avatarUrl = wizardStore.getCharacterThumbUrl(canonicalTrigger) || ''
      }

      list.push({
        key: 'actor_primary',
        name: displayName.charAt(0).toUpperCase() + displayName.slice(1),
        modelId: fallbackId,
        avatarUrl,
        isFallback: true,
      })
    }
  }

  console.log('[RehearsalRoom] onSetModels computed:', {
    cardId: activeCardId.value,
    count: list.length,
    models: list.map(m => ({ key: m.key, modelId: m.modelId, isFallback: m.isFallback })),
  })

  return list
})

// Active selection — resolves to selectedKey, or falls back to active concept on stage, or first element
const selectedModel = computed(() => {
  if (onSetModels.value.length === 0)
    return null

  const activeConcepts = activeCard.value?.extensions?.airi?.active_concepts || []
  // Priority: 1. explicit selection, 2. last active concept that matches a model on set, 3. first model on set
  const key = selectedKey.value
    || [...activeConcepts].reverse().find(id => onSetModels.value.some(m => m.key === id))
    || onSetModels.value[0]?.key

  return onSetModels.value.find(m => m.key === key) || onSetModels.value[0] || null
})

// Update selectedKey to keep UI selector highlighted
watch(selectedModel, (newVal) => {
  if (newVal && selectedKey.value !== newVal.key) {
    selectedKey.value = newVal.key
  }
}, { immediate: true })

const activeModelId = computed<string | null>(() => {
  return selectedModel.value?.modelId || null
})

// Resolve Model Format
const currentModel = computed(() => {
  return displayModelsStore.displayModels.find(m => m.id === activeModelId.value)
})

const modelType = computed<'live2d' | 'vrm' | 'mmd' | 'spine' | 'unknown'>(() => {
  if (!currentModel.value)
    return 'unknown'
  const fmt = currentModel.value.format
  if (fmt === DisplayModelFormat.Live2dZip || fmt === DisplayModelFormat.Live2dDirectory)
    return 'live2d'
  if (fmt === DisplayModelFormat.VRM)
    return 'vrm'
  if (fmt === DisplayModelFormat.PMXZip || fmt === DisplayModelFormat.PMXDirectory || fmt === DisplayModelFormat.PMD)
    return 'mmd'
  if (fmt === DisplayModelFormat.SpineZip)
    return 'spine'
  return 'unknown'
})

// Experimental System1 auto-cues: tied directly to the character card's autoCuesEnabled state.
// Armed only when enabled on the active character AND a System1 provider is configured globally.
const autoCuesEnabled = computed({
  get: () => Boolean((activeCard.value as any)?.extensions?.airi?.acting?.autoCuesEnabled),
  set: async (val: boolean) => {
    if (!activeCard.value || !activeCardId.value)
      return
    const currentCard = activeCard.value as any
    const extensions = JSON.parse(JSON.stringify(currentCard.extensions || {}))
    if (!extensions.airi)
      extensions.airi = {}
    if (!extensions.airi.acting)
      extensions.airi.acting = {}
    extensions.airi.acting.autoCuesEnabled = val

    await airiCardStore.updateCard(activeCardId.value, {
      ...currentCard,
      extensions,
    })
  },
})

const systemOneArmed = computed(() => autoCuesEnabled.value && systemOneStore.configured)

const systemOneBadge = computed(() => {
  if (!systemOneStore.configured) {
    return { label: 'Unconfigured', tone: 'amber' as const }
  }
  if (systemOneStore.activeProvider === 'laya-local') {
    return { label: 'Laya local', tone: 'emerald' as const }
  }
  const modelShort = (systemOneStore.activeModel || '').split('/').pop() || systemOneStore.activeModel
  return { label: `Jev · ${modelShort}`, tone: 'sky' as const }
})

// Phase C: stride simulator. Table read judges the whole script at once;
// dress rehearsal performs it line by line through the real pipeline.
type RehearsalSimMode = 'table-read' | 'dress-rehearsal'
const rehearsalSimMode = useLocalStorage<RehearsalSimMode>('rehearsal/system-one-mode', 'dress-rehearsal')
interface RehearsalStrideResult {
  sentence: string
  norm: string
  skippedPrefixed: boolean
  emotion: string
  confidence: number
  latencyMs: number
  status: 'held' | 'applied' | 'dropped' | 'skipped-prefixed' | 'none' | 'unmapped' | 'error'
  error?: string
}

const systemOneRuns = ref<RehearsalStrideResult[]>([])
const systemOneRequestCount = ref(0)
const systemOneRunning = ref(false)
const showSystemOneReadout = ref(false)

const ACT_TOKEN_RE = /<\|\s*(?:ACT|DELAY|ACTOR)[\s\S]*?\|\s*>/gi

function normalizeStrideText(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim()
}

// Hold-and-release: decided cues wait for their slice's audio play event.
// playedNorms tracks slices the host already spoke — late decisions drop.
const playedStrideNorms = ref<Set<string>>(new Set())

function holdStrideCue(sentence: string, emotion: string, confidence: number, latencyMs: number) {
  const norm = normalizeStrideText(sentence)
  if (playedStrideNorms.value.has(norm)) {
    systemOneRuns.value.push({ sentence, norm, skippedPrefixed: false, emotion, confidence, latencyMs, status: 'dropped' })
    return
  }
  systemOneRuns.value.push({ sentence, norm, skippedPrefixed: false, emotion, confidence, latencyMs, status: 'held' })
  console.info('[Rehearsal System1] held', { sentence: sentence.slice(0, 60), emotion, norm: norm.slice(0, 60) })
}

function releaseStrideCues(itemText: string) {
  const norm = normalizeStrideText(itemText)
  playedStrideNorms.value.add(norm)
  const held = systemOneRuns.value.filter(r => r.status === 'held')
  console.info('[Rehearsal System1] release attempt', { norm: norm.slice(0, 60), heldCount: held.length, heldNorms: held.map(r => r.norm.slice(0, 40)) })
  const row = held.find(r => norm.includes(r.norm) || r.norm.includes(norm))
  if (!row) {
    console.info('[Rehearsal System1] playback without held cue', { text: itemText.slice(0, 80) })
    return
  }
  console.info('[Rehearsal System1] release match', { sentence: row.sentence.slice(0, 60), emotion: row.emotion })
  void injectJevCue(row.sentence, row.emotion).then((fired) => {
    row.status = fired ? 'applied' : 'unmapped'
  })
}

try {
  console.info('[Rehearsal System1] subscribed to segment playback events')
  getSpeechBusContext().on(speechSegmentPlaybackEvent, (evt: any) => {
    const payload = evt?.body
    console.info('[Rehearsal System1] playback event', {
      intentId: payload?.intentId,
      text: (payload?.text || '').slice(0, 80),
    })
    if (!payload || !payload.text) {
      return
    }
    // NOTE: intent ids are minted fresh by the host pipeline, so the bus
    // event never carries the rehearsal's remote intent id. Matching is by
    // spoken words only — identical words deserve identical cues anyway, and
    // held rows only exist during/after a run, so stray turns can't misfire
    // against stale state.
    releaseStrideCues(payload.text)
  })
}
catch (err) {
  console.warn('[Rehearsal System1] Playback subscription failed:', err)
}

async function resolveRehearsalEmotionOptions(modelId: string | null): Promise<{ options: string[], fallback: boolean }> {
  // Source 1: the card's compiled whitelist (Verify keepers + Remap slots union).
  const whitelist = (activeCard.value as any)?.extensions?.airi?.acting?.cueAllowlist
    || (activeCard.value as any)?.extensions?.airi?.acting?.compiledWhitelist
  const whitelisted = Object.keys(whitelist?.emotions || {})
  // DIAG: snapshot for DevTools inspection (window.__jevDebug.snapshot()).
  stashJevSnapshot({ whitelist, whitelisted, modelId })
  if (whitelisted.length > 0) {
    console.info('[Rehearsal System1] options', { source: 'whitelist', keys: whitelisted })
    return { options: [...whitelisted, 'none'], fallback: false }
  }
  // Source 2: the display model's stored capabilities.
  if (modelId) {
    try {
      const model = await displayModelsStore.getDisplayModel(modelId)
      const values = [...new Set((model?.expressionCapabilities || []).filter(c => c.usable).map(c => c.label || c.rawKey))]
      if (values.length > 0) {
        console.info('[Rehearsal System1] options', { source: 'record', keys: values })
        return { options: [...values, 'none'], fallback: false }
      }
    }
    catch (err) {
      console.warn('[Rehearsal System1] Failed to load model vocabulary:', err)
    }
  }
  console.info('[Rehearsal System1] options', { source: 'canonical-fallback', keys: ['smile', 'blush', 'pout', 'surprise', 'wink', 'shy', 'none'] })
  return { options: ['smile', 'blush', 'pout', 'surprise', 'wink', 'shy', 'none'], fallback: true }
}

// DIAG: DevTools dump hook. Call window.__jevDebug.snapshot() in the chat
// window console to inspect the exact whitelist/criteria state per run.
function stashJevSnapshot(extra: Record<string, any>) {
  try {
    const card = activeCard.value as any
    ;(window as any).__jevDebug = {
      snapshot: () => JSON.parse(JSON.stringify({
        cardName: card?.name,
        cardId: activeCardId.value,
        actingExtension: card?.extensions?.airi?.acting || null,
        modelId: activeModelId.value,
        ...extra,
      })),
    }
  }
  catch {}
}

function triggerRehearsalEmotion(key: string) {
  try {
    const type = modelType.value
    if (type === 'live2d') {
      live2dStore.triggerEmotion(key, 1.0)
    }
    else if (type === 'vrm') {
      vrmModelStore.triggerEmotion(key, 1.0)
    }
    else if (type === 'mmd') {
      mmdRehearsalStore.previewExpression = key
      setTimeout(() => {
        if (mmdRehearsalStore.previewExpression === key) {
          mmdRehearsalStore.previewExpression = null
        }
      }, 2000)
    }
    else if (type === 'spine') {
      const match = key.match(/^(.+?)\s*\[(.+?)\]$/)
      if (match) {
        spineRehearsalStore.selectVariantAndSkin(match[1].trim(), match[2].trim())
      }
      else {
        spineRehearsalStore.selectVariantAndSkin(key, 'default')
      }
    }
  }
  catch (err) {
    console.error('[Rehearsal System1] Local trigger failed:', err)
  }
}

// DIAG (temporary proving-ground instrumentation — remove before Phase E):
// reads the live driver weight for a morph key. Undefined = no live manager;
// 0 after firing = the trigger did not move this morph.
function readLiveWeight(key: string): number | undefined {
  try {
    const em = (window as any)?.expressionManager
    if (!em || typeof em.getValue !== 'function') {
      return undefined
    }
    return em.getValue(key)
  }
  catch {
    return undefined
  }
}
const rigExpressionsCache = ref<{ modelId: string, expressions: string[] } | null>(null)

async function getRigExpressions(modelId: string | null): Promise<string[]> {
  if (!modelId) {
    return []
  }
  if (rigExpressionsCache.value?.modelId === modelId) {
    return rigExpressionsCache.value.expressions
  }
  try {
    const caps = await displayModelsStore.getOrLoadModelCapabilities(modelId)
    const expressions = (caps.expressionCapabilities || []).map(c => c.rawKey)
    rigExpressionsCache.value = { modelId, expressions }
    return expressions
  }
  catch (err) {
    console.warn('[Rehearsal System1] Failed to load rig expressions:', err)
    return []
  }
}

// Live rig truth: the mounted driver's expression map. File-caps lists (335)
// and live maps (207) are different universes — resolution trusts live first.
function liveMorphKeys(): string[] {
  try {
    const map = (window as any)?.expressionManager?.expressionMap
    if (map && typeof map === 'object') {
      return Object.keys(map)
    }
  }
  catch {}
  return []
}

// Resolve a curated actToken to a rig-playable raw morph key. Order:
// Resolve a curated actToken to a rig-playable raw morph key using shared resolveCueToken.
async function resolveActToken(token: string, modelId: string | null): Promise<string | null> {
  const allowlist = (activeCard.value as any)?.extensions?.airi?.acting?.cueAllowlist
    || (activeCard.value as any)?.extensions?.airi?.acting?.compiledWhitelist
  const model = modelId ? await displayModelsStore.getDisplayModel(modelId) : null
  const caps = model?.expressionCapabilities || []
  const live = liveMorphKeys()
  const rig = live.length > 0 ? live : (await getRigExpressions(modelId).catch(() => []))
  const resolved = resolveCueToken(token, { allowlist, capabilities: caps, rigExpressions: rig })
  const rawKey = resolved?.rawKey || null
  console.info('[Rehearsal System1] resolve', { token, resolved: rawKey, liveSize: live.length, rigSize: rig.length, t: Math.round(performance.now()) })
  return rawKey
}

// Single choke point for every Jev-originated cue in rehearsal: resolves the
// curated actToken to a rig-playable raw morph first. Returns the fired raw
// key, or null when unresolvable (caller marks `unmapped` — never fired).
// Phase E will extend this with rawContent persistence exclusion; the readout
// + log already carry provenance so nothing here can be mistaken for LLM output.
async function injectJevCue(sentence: string, emotion: string): Promise<string | null> {
  const rawKey = await resolveActToken(emotion, activeModelId.value)
  if (!rawKey) {
    console.warn('[Rehearsal System1] unmapped cue — not fired (provenance=system_one_jev)', { sentence, emotion, t: Math.round(performance.now()) })
    return null
  }
  // DIAG: weight before/after proves whether the driver actually moved.
  const before = readLiveWeight(rawKey)
  console.info('[Rehearsal System1] inject (provenance=system_one_jev)', { sentence, emotion, rawKey, weightBefore: before, t: Math.round(performance.now()) })
  triggerRehearsalEmotion(rawKey)
  window.setTimeout(() => {
    console.info('[Rehearsal System1] inject-verify', { rawKey, weightBefore: before, weightAfter: readLiveWeight(rawKey), t: Math.round(performance.now()) })
  }, 400)
  return rawKey
}

function buildEmotionCriteria(options: string[]) {
  return Object.fromEntries(options.map(o => [o, o === 'none' ? 'No cue fits this line.' : `Emotion cue: ${o}.`]))
}

// Dress-rehearsal path: one solo request per completed stride, each judged on
// its own sentence only (no sibling context) — the streaming-correct shape.
async function dispatchSoloStride(sentence: string) {
  const { name, block } = buildPersonaContext(activeCard.value)
  const { options } = await resolveRehearsalEmotionOptions(activeModelId.value)
  const state = `Rehearsal line for ${name}:\n${block}\nLine: "${sentence}"`
  const t0 = performance.now()
  try {
    const res = await systemOneStore.execute(state, {
      emotion: {
        type: 'choice',
        instructions: `Select the avatar emotion cue from ${name}'s allowed cues that best matches this line. Select none if no cue fits.`,
        criteria: buildEmotionCriteria(options),
      },
    })
    const latencyMs = Math.round(performance.now() - t0)
    systemOneRequestCount.value += 1
    const ans = (res.answers as any)?.emotion || {}
    const emotion: string = ans.choice || 'none'
    const confidence: number = typeof ans.confidence === 'number' ? ans.confidence : 0
    if (emotion === 'none') {
      systemOneRuns.value.push({ sentence, norm: normalizeStrideText(sentence), skippedPrefixed: false, emotion, confidence, latencyMs, status: 'none' })
      return
    }
    holdStrideCue(sentence, emotion, confidence, latencyMs)
  }
  catch (err: any) {
    console.error('[Rehearsal System1] Solo stride failed:', err)
    systemOneRuns.value.push({ sentence, norm: normalizeStrideText(sentence), skippedPrefixed: false, emotion: '', confidence: 0, latencyMs: 0, status: 'error', error: err?.message || String(err) })
  }
}

async function runSystemOneSimulation(text: string) {
  if (!systemOneArmed.value || systemOneRunning.value) {
    return
  }
  systemOneRunning.value = true
  systemOneRuns.value = []
  systemOneRequestCount.value = 0
  try {
    const rawStrides = splitSentences(text)
    if (rawStrides.length === 0) {
      return
    }
    const cleanStrides = rawStrides.map(s => s.replace(ACT_TOKEN_RE, '').trim())
    const { options: emotionOptions, fallback } = await resolveRehearsalEmotionOptions(activeModelId.value)
    const { name: personaName, block: personaBlock } = buildPersonaContext(activeCard.value)

    // Mirror rule: the simulator holds the complete text (remainder case), so
    // all strides ride ONE batched execute() with per-sentence groups.
    const questions: Record<string, any> = {}
    cleanStrides.forEach((sentence, i) => {
      if (!sentence) {
        return
      }
      questions[`s${i}_emotion`] = {
        type: 'choice',
        instructions: `Select the avatar emotion cue from ${personaName}'s allowed cues that best matches this line. Select none if no cue fits.`,
        criteria: Object.fromEntries(emotionOptions.map(o => [o, o === 'none' ? 'No cue fits this line.' : `Emotion cue: ${o}.`])),
      }
    })

    const state = `Rehearsal line for ${personaName}:\n${personaBlock}\nLine: "${cleanStrides.join(' ')}"${fallback ? '\n(Vocabulary note: fallback canonical cues — model has no stored mappings)' : ''}`
    const t0 = performance.now()
    const res = await systemOneStore.execute(state, questions)
    const latencyMs = Math.round(performance.now() - t0)
    systemOneRequestCount.value += 1

    rawStrides.forEach((raw, i) => {
      const sentence = cleanStrides[i]
      if (!sentence) {
        return
      }
      if (ACT_TOKEN_RE.test(raw)) {
        systemOneRuns.value.push({ sentence, norm: normalizeStrideText(sentence), skippedPrefixed: true, emotion: '', confidence: 0, latencyMs: 0, status: 'skipped-prefixed' })
        return
      }
      const ansEmotion = (res.answers as any)?.[`s${i}_emotion`] || {}
      const emotion: string = ansEmotion.choice || 'none'
      const confidence: number = typeof ansEmotion.confidence === 'number' ? ansEmotion.confidence : 0
      if (emotion === 'none') {
        systemOneRuns.value.push({ sentence, norm: normalizeStrideText(sentence), skippedPrefixed: false, emotion, confidence, latencyMs, status: 'none' })
        return
      }
      holdStrideCue(sentence, emotion, confidence, latencyMs)
    })
    showSystemOneReadout.value = true
  }
  catch (err: any) {
    console.error('[Rehearsal System1] Simulation failed:', err)
    systemOneRuns.value.push({ sentence: '', norm: '', skippedPrefixed: false, emotion: '', confidence: 0, latencyMs: 0, status: 'error', error: err?.message || String(err) })
    showSystemOneReadout.value = true
  }
  finally {
    systemOneRunning.value = false
  }
}

// Sandbox states & methods
const playgroundText = ref('<|ACT:emotion="happy"|> Hello world! Welcome to the Stage.')
const isRehearsing = ref(false)
const isGeneratingMotion = ref(false)
const shouldDownloadBackup = ref(false)
const isGeneratingAI = ref(false)
const aiSuggestions = ref<Array<{ title: string, dialogue: string }>>([])

// Retired: acting-instruction generation moved to the Emotion Calibration
// studio (settings window). The button below confirms, then opens it.
const showEmotionCalibrationConfirm = ref(false)

function openEmotionCalibration() {
  showEmotionCalibrationConfirm.value = false
  const modelId = activeModelId.value
  void openSettings({
    route: modelId ? `/settings/models/emotions?model=${modelId}` : '/settings/models/emotions',
  }).catch((err: any) => {
    console.error('Failed to open Emotion Calibration:', err)
  })
}

const visibleEmotions = ref<string[]>([])
const visibleMotions = ref<string[]>([])

function handleVisibleCapabilitiesUpdate(payload: { emotions: string[], motions: string[] }) {
  visibleEmotions.value = payload.emotions
  visibleMotions.value = payload.motions
}

function handleInsertToken(token: string) {
  if (playgroundText.value.trim().length > 0) {
    playgroundText.value = `${playgroundText.value.trim()} ${token}`
  }
  else {
    playgroundText.value = token
  }
  toast.success('Appended token to sandbox!')
}

const textToMotionStore = useTextToMotionStore()

async function createMotion() {
  const prompt = playgroundText.value.trim()
  if (!prompt) {
    toast.error('Please enter a motion description in the text box.')
    return
  }

  try {
    isGeneratingMotion.value = true
    toast.info('Generating motion animation...')

    const result = await textToMotionStore.generateMotion(prompt, {
      format: 'vrma',
    })

    // Save to Database (custom-vrm-animations store / localforage)
    let dbSaveSuccess = false
    let animationKey = ''
    try {
      animationKey = await textToMotionStore.saveResultToLibrary(result, customVrmAnimationsStore.addCustomAnimation)
      toast.success('Motion saved to library successfully!')
      dbSaveSuccess = true
    }
    catch (dbErr: any) {
      console.error('[CreateMotion] Database save failed:', dbErr)
      toast.error(`Library save failed: ${dbErr.message || String(dbErr)}. Running backup download...`)
    }

    // Failsafe backup download if requested or if DB save failed
    if (shouldDownloadBackup.value || !dbSaveSuccess) {
      textToMotionStore.downloadResultToDisk(result)

      if (dbSaveSuccess) {
        toast.success('Backup file downloaded successfully!')
      }
    }

    // Automatically stage the ACT token and play the rehearsal
    if (dbSaveSuccess && animationKey) {
      const motionName = result.fileName.replace(/_\d+\.vrma$/, '')
      playgroundText.value = `<|ACT:motion="${motionName}"|>`
      setTimeout(() => {
        void playRehearsal()
      }, 500)
    }
  }
  catch (err: any) {
    console.error('[CreateMotion] Failed:', err)
    toast.error(`Generation failed: ${err.message || String(err)}`)
  }
  finally {
    isGeneratingMotion.value = false
  }
}

watch(() => speakingState.value?.nowSpeaking, (speaking) => {
  if (!speaking && isRehearsing.value) {
    isRehearsing.value = false
  }
})

async function playRehearsal() {
  if (isRehearsing.value)
    return

  const text = playgroundText.value.trim()
  if (!text) {
    toast.error('Please enter acting dialogue or ACT tokens in the sandbox.')
    return
  }

  // Tier 2 proving ground: table read judges the whole script at once,
  // dress rehearsal classifies line by line as the stream flows.
  // Neither blocks nor alters the audiovisual pipeline.
  const dressModeArmed = systemOneArmed.value && rehearsalSimMode.value === 'dress-rehearsal'
  if (systemOneArmed.value) {
    systemOneRuns.value = []
    systemOneRequestCount.value = 0
    systemOneRunning.value = true
    showSystemOneReadout.value = true
    playedStrideNorms.value = new Set()
  }
  if (!dressModeArmed) {
    void runSystemOneSimulation(text)
  }
  const sentenceBuffer = createSentenceStrideBuffer()

  isRehearsing.value = true

  let intent: ReturnType<typeof speechRuntimeStore.openIntent> | null = null
  try {
    console.info('[Rehearsal Playback] Streaming via Speech Runtime Intent:', text)

    const actorId = selectedModel.value?.key
    const dummyContext = {
      assistantMessageId: `rehearsal-${Date.now()}`,
      assistantMessageCreatedAt: Date.now(),
      characterId: activeCardId.value,
      actorId,
    }

    // Open speech intent routed across windows to ControlStripHost / Stage
    intent = speechRuntimeStore.openIntent({
      ownerId: activeCardId.value || 'default',
      priority: 0,
      behavior: 'interrupt',
    })
    console.info('[Rehearsal System1] Act pressed', { mode: rehearsalSimMode.value })

    // Start of response
    await orchestrator.emitBeforeSendHooks('', dummyContext as any)

    // Prepend ACTOR tag if a specific actress/concept is selected on set
    if (selectedModel.value && !selectedModel.value.isFallback && actorId) {
      const actorToken = `<|ACTOR:${actorId}|>`
      console.info('[Rehearsal Playback] Emitting Selected Actor Tag:', actorToken)
      intent.writeSpecial(actorToken)
      await orchestrator.emitTokenSpecialHooks(actorToken, dummyContext as any)
    }

    // Parse text and ACT/DELAY/ACTOR markers through canonical LLM marker parser
    const parser = useLlmmarkerParser({
      onLiteral: async (literal) => {
        if (literal) {
          console.info('[Rehearsal Playback] Emitting Literal Text:', literal)
          intent?.writeLiteral(literal)
          await orchestrator.emitTokenLiteralHooks(literal, dummyContext as any)
          if (dressModeArmed) {
            const complete = sentenceBuffer.feed(literal)
            for (const sentence of complete) {
              void dispatchSoloStride(sentence)
            }
          }
        }
      },
      onSpecial: async (special) => {
        if (special) {
          console.info('[Rehearsal Playback] Emitting Special Tag:', special)
          intent?.writeSpecial(special)
          await orchestrator.emitTokenSpecialHooks(special, dummyContext as any)
        }
      },
    })

    await parser.consume(text)
    await parser.end()

    if (dressModeArmed) {
      // Final flush: the trailing fragment (no terminal punctuation) still
      // gets its solo judgment; stragglers resolve into the readout.
      const flushed = sentenceBuffer.flush()
      for (const tail of flushed) {
        void dispatchSoloStride(tail)
      }
      systemOneRunning.value = false
    }

    intent.writeFlush()
    intent.end()

    // End of stream
    await orchestrator.emitStreamEndHooks(dummyContext as any)

    const content = text.replace(/<\|ACT:[^|]+\|>/g, '').trim()
    await orchestrator.emitAssistantResponseEndHooks(content, dummyContext as any)

    toast.success('Rehearsal playback dispatched to Stage!')

    // Safety fallback timeout in case speaking state never toggles
    setTimeout(() => {
      if (isRehearsing.value && !speakingState.value?.nowSpeaking) {
        isRehearsing.value = false
      }
    }, 2000)
  }
  catch (err) {
    console.error('[Rehearsal Playback] Streaming failed:', err)
    if (intent) {
      intent.cancel(err instanceof Error ? err.message : String(err))
    }
    toast.error(`Rehearsal playback failed: ${err instanceof Error ? err.message : String(err)}`)
    isRehearsing.value = false
  }
}

async function suggestDialogue() {
  if (!activeCard.value)
    return
  if (!activeProvider.value || !activeModel.value) {
    toast.error('No active LLM model or provider is selected. Configure them in settings first.')
    return
  }

  isGeneratingAI.value = true
  aiSuggestions.value = []

  try {
    const providerInstance = await providersStore.getProviderInstance(activeProvider.value)
    if (!providerInstance) {
      throw new Error('Failed to get active LLM provider instance.')
    }

    const emotionsList = visibleEmotions.value
    const motionsList = visibleMotions.value

    const systemPrompt = `You are a creative dialogue script designer for a VTuber/AI agent rehearsal sandbox.
The user wants to generate 4 dialogue acting presets.
The avatar has the following acting capabilities:
- Available Emotions: [ ${emotionsList.join(', ') || 'None'} ]
- Available Motions: [ ${motionsList.join(', ') || 'None'} ]
- Available Elemental VFX / Auras: [ fire, electric, magic, verdant ]

Requirements for the dialogue presets:
1. Generate exactly 4 presets.
2. For each preset, create a short, punchy 1-2 word title (e.g., 'Shy Greeting', 'Surprised Gasps', 'Flustered Anger', 'Deep Thought', 'Fire Fury', 'Verdant Peace').
3. For each preset, write a natural dialogue line and embed <|ACT:emotion="key"|>, <|ACT:motion="key"|>, or <|ACT:vfx="key"|> tokens naturally inside the text.
4. Try to make at least 2 presets use a single emotion/motion/vfx token, and 2 presets use a combination of both an emotion/motion and a VFX aura.
5. Only use the exact emotion and motion keys listed above, or the 4 VFX keys (fire, electric, magic, verdant). Do not invent new ones.

Example output structure:
Preset 1: Title: 'Happy Wave', Dialogue: '<|ACT:emotion="happy"|> Hello there! <|ACT:motion="wave"|> I am so glad to see you!'
Preset 2: Title: 'Fire Ignition', Dialogue: '<|ACT:vfx="fire"|> Stand back! <|ACT:emotion="angry"|> Power is surging through me!'`

    const schema = v.object({
      suggestions: v.array(
        v.object({
          title: v.string(),
          dialogue: v.string(),
        }),
      ),
    })

    const result = await llmStore.generateObject<any>(
      activeModel.value,
      providerInstance as any,
      {
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: 'Generate 4 creative acting presets.' },
        ],
        schema,
      },
    )

    if (result && Array.isArray(result.suggestions)) {
      aiSuggestions.value = result.suggestions
      toast.success('Generated 4 new acting presets!')
    }
    else {
      throw new Error('Invalid response structure.')
    }
  }
  catch (err) {
    console.error('AI suggestion failed:', err)
    toast.error(`AI Suggestion failed: ${err instanceof Error ? err.message : String(err)}`)
  }
  finally {
    isGeneratingAI.value = false
  }
}

const dynamicPresets = computed(() => {
  const emotionsList = visibleEmotions.value
  const motionsList = visibleMotions.value

  const presets = []

  if (emotionsList.length > 0) {
    presets.push({
      label: 'Single Emotion',
      text: `<|ACT:emotion="${emotionsList[0]}"|> Hello world!`,
    })
  }
  else if (motionsList.length > 0) {
    presets.push({
      label: 'Single Motion',
      text: `<|ACT:motion="${motionsList[0]}"|> Hello world!`,
    })
  }

  if (emotionsList.length > 1) {
    presets.push({
      label: 'Dual Emotions',
      text: `<|ACT:emotion="${emotionsList[0]}"|> This is a sandbox test. <|ACT:emotion="${emotionsList[1]}"|>`,
    })
  }
  else if (motionsList.length > 1) {
    presets.push({
      label: 'Dual Motions',
      text: `<|ACT:motion="${motionsList[0]}"|> This is a sandbox test. <|ACT:motion="${motionsList[1]}"|>`,
    })
  }

  if (emotionsList.length > 0 && motionsList.length > 0) {
    presets.push({
      label: 'Combo Tag',
      text: `<|ACT:emotion="${emotionsList[0]}",motion="${motionsList[0]}"|> Moving and speaking.`,
    })
  }

  if (emotionsList.length > 1 && motionsList.length > 1) {
    presets.push({
      label: 'Dual Combos',
      text: `<|ACT:emotion="${emotionsList[0]}",motion="${motionsList[0]}"|> Starting off... <|ACT:emotion="${emotionsList[1]}",motion="${motionsList[1]}"|> and transitioning.`,
    })
  }

  // Elemental VFX & Aura Presets (VRM & MMD)
  presets.push({
    label: '🔥 Fire Aura',
    text: '<|ACT:vfx="fire"|> Feel the fiery energy surging through!',
  })
  presets.push({
    label: '⚡ Electric Surge',
    text: '<|ACT:vfx="electric"|> Sparks crackle as the current arcs across the floor!',
  })
  presets.push({
    label: '✨ Magic Arcane',
    text: '<|ACT:vfx="magic"|> Ancient runes awaken beneath our feet.',
  })
  presets.push({
    label: '🍃 Verdant Calm',
    text: '<|ACT:vfx="verdant"|> Sacred flora and glowing spores drift into bloom.',
  })

  return presets
})

// Click handler
function selectModel(m: typeof onSetModels.value[0]) {
  selectedKey.value = m.key
  if (!m.isFallback) {
    // Case A (Multi-Actor Concepts): Activate the concept on stage via concept stack
    void autonomousArtistryStore.activateConcept(m.key)
  }
  else if (activeCard.value && activeCardId.value) {
    // Case B (Single-Actor Fallback): Manually sync card's top-level displayModelId
    const extension = JSON.parse(JSON.stringify(activeCard.value.extensions || {}))
    if (!extension.airi)
      extension.airi = {}
    if (!extension.airi.modules)
      extension.airi.modules = {}

    extension.airi.modules.displayModelId = m.modelId

    void airiCardStore.updateCard(activeCardId.value, {
      ...activeCard.value,
      extensions: extension,
    })
  }
}
</script>

<template>
  <div class="h-full w-full flex flex-col overflow-hidden bg-white dark:bg-neutral-900/10">
    <!-- Header -->
    <div class="shrink-0 px-4 pb-2 pt-4">
      <h3 class="text-sm text-neutral-800 font-bold dark:text-neutral-200">
        Rehearsal Room
      </h3>
      <p class="mt-0.5 text-[10px] text-neutral-500">
        Select a model then map emotion &amp; motion keys in real time.
      </p>
    </div>

    <!-- No card loaded -->
    <div v-if="!activeCardId" class="flex flex-1 flex-col items-center justify-center p-6 text-center">
      <div class="i-solar:user-id-bold-duotone mb-2 text-4xl text-neutral-300 dark:text-neutral-700" />
      <h4 class="text-sm text-neutral-700 font-semibold dark:text-neutral-300">
        No Card Active
      </h4>
      <p class="mt-1 max-w-xs text-xs text-neutral-500">
        Open a chat session with an active character card to use the rehearsal room.
      </p>
    </div>

    <template v-else>
      <!-- Two-column workspace: controls scroll left, stage pinned right -->
      <div class="min-h-0 flex flex-1 flex-row gap-3 overflow-hidden px-4 pb-3">
        <div class="min-w-0 flex-1 overflow-y-auto">
          <!-- Unified Model Selector Grid (5 columns) -->
          <div class="shrink-0 pb-2">
            <div v-if="onSetModels.length === 0" class="py-2 text-center text-[10px] text-neutral-400 italic">
              No models bound to this card.
            </div>
            <div v-else class="grid grid-cols-5 gap-1.5">
              <button
                v-for="m in onSetModels"
                :key="m.key"
                class="group relative h-16 w-full flex flex-col justify-end overflow-hidden border rounded-xl transition-all duration-200"
                :class="selectedModel?.key === m.key
                  ? 'border-primary-500 ring-2 ring-primary-500/20 shadow-md shadow-primary-500/10'
                  : 'border-neutral-200 dark:border-neutral-800 opacity-60 hover:opacity-90 hover:border-neutral-300 dark:hover:border-neutral-700'"
                @click="selectModel(m)"
              >
                <!-- Avatar -->
                <div class="absolute inset-0 bg-neutral-100 dark:bg-neutral-900">
                  <img
                    v-if="m.avatarUrl"
                    :src="m.avatarUrl"
                    class="h-full w-full object-cover object-top transition-transform duration-300 group-hover:scale-105"
                  >
                  <div v-else class="h-full w-full flex items-center justify-center text-neutral-400 dark:text-neutral-600">
                    <div class="i-solar:user-bold-duotone text-xl" />
                  </div>
                </div>
                <div class="absolute inset-0 from-black/80 via-black/20 to-transparent bg-gradient-to-t" />
                <div class="relative z-10 px-1.5 pb-1.5">
                  <span class="line-clamp-1 block text-[9px] text-white font-bold leading-tight drop-shadow">
                    {{ m.name }}
                  </span>
                </div>
              </button>
            </div>
          </div>

          <!-- Divider -->
          <div v-if="onSetModels.length > 0" class="mb-2 border-t border-neutral-100 dark:border-neutral-800/60" />

          <!-- Sandbox Playground -->
          <div class="shrink-0 pb-3">
            <div class="border border-neutral-200 rounded-xl bg-neutral-50/50 p-3 dark:border-neutral-800 dark:bg-neutral-950/20">
              <div class="mb-2 flex items-center justify-between">
                <span class="text-[10px] text-neutral-400 font-bold tracking-wider uppercase">Sandbox Playground</span>
              </div>

              <div class="border border-neutral-200 rounded-lg bg-white dark:border-neutral-800 dark:bg-neutral-900">
                <textarea
                  v-model="playgroundText"
                  rows="2"
                  class="w-full border-none bg-transparent p-2 text-xs dark:text-neutral-100 placeholder:text-neutral-400 focus:outline-none focus:ring-0"
                  placeholder="e.g. <|ACT:emotion=&quot;happy&quot;|> Hello world!"
                />
              </div>

              <div class="mt-2 flex flex-col gap-2">
                <div
                  :class="[
                    'flex items-center justify-between gap-2',
                    'pl-0.5 py-0.5',
                    'select-none',
                  ]"
                >
                  <div :class="['flex flex-wrap items-center gap-1.5']">
                    <span :class="['text-[10px] font-semibold text-neutral-600 dark:text-neutral-300']">
                      Autonomous Cues
                    </span>
                    <span
                      :class="[
                        'rounded-full px-1.5 py-px text-[8px] font-bold font-mono',
                        systemOneBadge.tone === 'emerald'
                          ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
                          : systemOneBadge.tone === 'sky'
                            ? 'bg-sky-500/10 text-sky-600 dark:text-sky-400'
                            : 'bg-amber-500/10 text-amber-600 dark:text-amber-400',
                      ]"
                    >
                      {{ systemOneBadge.label }}
                    </span>
                  </div>

                  <Checkbox
                    v-model="autoCuesEnabled"
                    :disabled="!systemOneStore.configured || !activeCardId"
                    :title="systemOneStore.configured ? 'Classify each sentence with System1 and auto-inject ACT cues (tied to character settings)' : 'Configure a System1 provider first (Settings → Providers → System1)'"
                    :class="['origin-right scale-75']"
                  />
                </div>
                <p v-if="systemOneArmed" class="pl-0.5 text-[9px] text-neutral-400 dark:text-neutral-500">
                  Armed — pressing Act will classify each sentence and auto-inject ACT cues.
                </p>
                <div class="flex items-center gap-1 pl-0.5" role="radiogroup" aria-label="Rehearsal style">
                  <button
                    type="button"
                    role="radio"
                    :aria-checked="rehearsalSimMode === 'table-read'"
                    title="Judge the whole script at once, then show the scorecard"
                    :class="['cursor-pointer rounded-lg px-2 py-1 text-[9px] font-semibold transition-colors', rehearsalSimMode === 'table-read' ? 'bg-primary-500/15 text-primary-600 dark:text-primary-300' : 'text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-300']"
                    @click="rehearsalSimMode = 'table-read'"
                  >
                    📖 Table read
                  </button>
                  <button
                    type="button"
                    role="radio"
                    :aria-checked="rehearsalSimMode === 'dress-rehearsal'"
                    title="Perform it line by line through the real pipeline as the text streams"
                    :class="['cursor-pointer rounded-lg px-2 py-1 text-[9px] font-semibold transition-colors', rehearsalSimMode === 'dress-rehearsal' ? 'bg-primary-500/15 text-primary-600 dark:text-primary-300' : 'text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-300']"
                    @click="rehearsalSimMode = 'dress-rehearsal'"
                  >
                    🎭 Dress rehearsal
                  </button>
                </div>
                <div class="flex flex-wrap items-center gap-2">
                  <button
                    class="flex cursor-pointer items-center gap-1 rounded bg-primary-500/10 px-2.5 py-1 text-[10px] text-primary-600 font-bold transition-all hover:bg-primary-500/20 dark:text-primary-400"
                    :disabled="isRehearsing"
                    @click="playRehearsal"
                  >
                    <div :class="isRehearsing ? 'i-solar:spinner-bold animate-spin text-[10px]' : 'i-solar:clapperboard-play-bold-duotone'" />
                    Act
                  </button>

                  <button
                    v-if="modelType === 'vrm'"
                    class="flex cursor-pointer items-center gap-1 rounded bg-indigo-500/10 px-2.5 py-1 text-[10px] text-indigo-600 font-bold transition-all hover:bg-indigo-500/20 dark:text-indigo-400 disabled:opacity-50"
                    :disabled="isGeneratingMotion"
                    @click="createMotion"
                  >
                    <div :class="isGeneratingMotion ? 'i-solar:spinner-bold animate-spin text-[10px]' : 'i-solar:magic-stick-3-bold-duotone'" />
                    Create Motion
                  </button>

                  <button
                    class="flex cursor-pointer items-center gap-1 rounded bg-primary-500/10 px-2.5 py-1 text-[10px] text-primary-600 font-medium transition-all hover:bg-primary-500/20 dark:text-primary-400"
                    :disabled="isGeneratingAI"
                    @click="suggestDialogue"
                  >
                    <div :class="isGeneratingAI ? 'i-solar:spinner-bold animate-spin text-[10px]' : 'i-solar:magic-stick-3-bold-duotone'" />
                    {{ isGeneratingAI ? 'Generating...' : 'Suggest Dialog' }}
                  </button>

                  <button
                    class="flex cursor-pointer items-center gap-1 rounded bg-indigo-500/10 px-2.5 py-1 text-[10px] text-indigo-600 font-medium transition-all hover:bg-indigo-500/20 dark:text-indigo-400"
                    @click="showEmotionCalibrationConfirm = true"
                  >
                    <div class="i-ph:sparkle animate-pulse text-[10px]" />
                    Generate Acting Instructions
                  </button>
                </div>

                <div v-if="modelType === 'vrm'" class="flex items-center gap-2 pl-0.5">
                  <label class="flex cursor-pointer select-none items-center gap-1.5 py-0.5">
                    <input
                      v-model="shouldDownloadBackup"
                      type="checkbox"
                      class="h-3 w-3 border-neutral-300 rounded text-indigo-500 accent-indigo-500 focus:ring-indigo-500"
                    >
                    <span class="text-[9px] text-neutral-400 font-semibold dark:text-neutral-500">Download backup file to disk</span>
                  </label>
                </div>

                <p class="text-[9px] text-neutral-400 leading-normal dark:text-neutral-500">
                  Clicking this compiles all visible emotions, motions, and actor profiles into detailed markdown instructions that teach the AI how and when to emote. You can save these instructions directly to your character card's system settings.
                </p>
              </div>

              <!-- System1 stride readout (Tier 2 proving ground) -->
              <div v-if="systemOneRunning || systemOneRuns.length > 0" class="mt-2 border border-neutral-200 rounded-lg bg-neutral-50/60 dark:border-neutral-800 dark:bg-neutral-900/40">
                <button
                  type="button"
                  class="w-full flex cursor-pointer items-center justify-between px-2.5 py-1.5 text-left"
                  @click="showSystemOneReadout = !showSystemOneReadout"
                >
                  <span class="text-[9px] text-neutral-500 font-bold tracking-wider uppercase dark:text-neutral-400">
                    System1 strides · {{ systemOneRequestCount }} request{{ systemOneRequestCount === 1 ? '' : 's' }}
                    <span v-if="systemOneRunning" class="text-primary-500">· classifying…</span>
                  </span>
                  <span :class="showSystemOneReadout ? 'i-solar:alt-arrow-up-bold' : 'i-solar:alt-arrow-down-bold'" class="text-[10px] text-neutral-400" />
                </button>
                <div v-if="showSystemOneReadout" class="max-h-44 overflow-y-auto border-t border-neutral-200/60 px-2.5 py-1.5 dark:border-neutral-800/60">
                  <div
                    v-for="(run, idx) in systemOneRuns"
                    :key="idx"
                    class="flex items-start justify-between gap-2 border-b border-neutral-100 py-1 text-[9px] last:border-0 dark:border-neutral-800/50"
                  >
                    <span class="min-w-0 flex-1 truncate text-neutral-600 dark:text-neutral-300" :title="run.sentence || run.error">
                      {{ run.sentence || run.error || '—' }}
                    </span>
                    <span class="shrink-0 text-neutral-500 font-mono dark:text-neutral-400">
                      <template v-if="run.status === 'applied'">{{ run.emotion }} {{ Math.round(run.confidence * 100) }}% · {{ run.latencyMs }}ms</template>
                      <template v-else-if="run.status === 'dropped'">dropped · played bare</template>
                      <template v-else-if="run.status === 'skipped-prefixed'">prefixed — skipped</template>
                      <template v-else-if="run.status === 'unmapped'">unmapped · no rig morph</template>
                      <template v-else-if="run.status === 'held'">held · awaiting audio</template>
                      <template v-else-if="run.status === 'none'">none</template>
                      <template v-else>error</template>
                    </span>
                    <span
                      :class="[
                        'shrink-0 rounded-full px-1.5 py-px text-[8px] font-bold',
                        run.status === 'applied' ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
                        : run.status === 'dropped' ? 'bg-amber-500/10 text-amber-600 dark:text-amber-400'
                          : run.status === 'unmapped' ? 'bg-violet-500/10 text-violet-600 dark:text-violet-400'
                            : run.status === 'error' ? 'bg-red-500/10 text-red-600 dark:text-red-400'
                              : 'bg-neutral-500/10 text-neutral-500 dark:text-neutral-400',
                      ]"
                    >
                      {{ run.status }}
                    </span>
                  </div>
                </div>
              </div>

              <!-- presets & suggestions tray -->
              <div class="flex flex-wrap gap-1 border-t border-neutral-100 pt-2 dark:border-neutral-800">
                <!-- Dynamic Templates (Always Available) -->
                <button
                  v-for="p in dynamicPresets"
                  :key="p.label"
                  class="cursor-pointer border border-primary-200/50 rounded bg-primary-50/20 px-2 py-0.5 text-[9px] text-primary-600 font-bold transition-all dark:border-primary-900/40 dark:bg-primary-950/10 hover:bg-primary-500/10 dark:text-primary-400"
                  @click="playgroundText = p.text"
                >
                  {{ p.label }}
                </button>

                <!-- LLM Suggestions -->
                <button
                  v-for="s in aiSuggestions"
                  :key="s.title"
                  class="cursor-pointer border border-neutral-200 rounded bg-white px-2 py-0.5 text-[9px] text-neutral-600 font-medium transition-all dark:border-neutral-800 dark:bg-neutral-900 hover:bg-neutral-50 dark:text-neutral-400 dark:hover:bg-neutral-800"
                  @click="playgroundText = s.dialogue"
                >
                  {{ s.title }}
                </button>
              </div>
            </div>
          </div>

          <!-- No model active -->
          <div v-if="!activeModelId" class="flex flex-1 flex-col items-center justify-center p-6 text-center">
            <div class="i-solar:link-broken-bold-duotone mb-2 text-4xl text-neutral-300 dark:text-neutral-700" />
            <h4 class="text-sm text-neutral-700 font-semibold dark:text-neutral-300">
              No Model Active
            </h4>
            <p class="mt-1 max-w-xs text-xs text-neutral-500">
              Bind a model in Settings → Card → Studio.
            </p>
          </div>

          <!-- ModelCustomizer powered by active model -->
          <div v-else class="flex flex-col pb-4">
            <ModelCustomizer
              :key="activeModelId"
              :model-id="activeModelId"
              :show-insert-actions="true"
              @insert-token="handleInsertToken"
              @update:visible-capabilities="handleVisibleCapabilitiesUpdate"
            />
          </div>
        </div>

        <!-- Right column: pinned local stage -->
        <div class="w-[280px] shrink-0 overflow-y-auto">
          <div class="sticky top-0 flex flex-col gap-1.5">
            <div class="flex items-center justify-between">
              <span
                :class="['flex cursor-pointer items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[10px] font-bold tracking-wider uppercase transition-colors',
                         inlineStageCollapsed
                           ? 'bg-neutral-100/50 text-neutral-400 dark:bg-neutral-800/50'
                           : 'bg-primary-50/50 text-primary-500 dark:bg-primary-950/30 dark:text-primary-400']"
                @click="inlineStageCollapsed = !inlineStageCollapsed"
              >
                Stage
                <span :class="inlineStageCollapsed ? 'i-solar:eye-closed-linear' : 'i-solar:eye-linear'" class="text-xs" />
              </span>
            </div>
            <div
              v-if="!inlineStageCollapsed"
              class="relative aspect-[3/4] w-full overflow-hidden border border-neutral-200/40 rounded-xl bg-transparent dark:border-neutral-800/40"
            >
              <RendererStage
                :paused="inlineStageCollapsed"
                :focus-at="{ x: 0, y: 0 }"
                :x-offset="inlineStageXOffset"
                :y-offset="inlineStageYOffset"
                :scale="inlineStageScale"
                :show-background="false"
                :radial-menu-enabled="false"
                :draggable="true"
                :mouth-open-size="speakingState?.mouthOpenSize || 0"
                class="absolute inset-0 h-full w-full"
                @offset-change="handleInlineStageOffsetChange"
                @scale-change="handleInlineStageScaleChange"
              />
            </div>
          </div>
        </div>
      </div>

      <!-- Emotion Calibration redirect confirm -->
      <div
        v-if="showEmotionCalibrationConfirm"
        class="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
        @click.self="showEmotionCalibrationConfirm = false"
      >
        <div class="max-w-sm w-full flex flex-col gap-2.5 border border-neutral-200 rounded-2xl bg-white p-4 shadow-2xl dark:border-neutral-800 dark:bg-neutral-900">
          <div class="flex items-center gap-2">
            <div class="h-8 w-8 flex shrink-0 items-center justify-center rounded-xl bg-primary-500/10 text-primary-500">
              <div class="i-solar:smile-circle-bold-duotone text-base" />
            </div>
            <div class="text-xs text-neutral-900 font-bold dark:text-neutral-100">
              Open Emotion Calibration?
            </div>
          </div>
          <p class="text-[11px] text-neutral-500 leading-relaxed dark:text-neutral-400">
            Acting instructions moved to the full studio in the Settings window — live preview, AI naming,
            verification, and remaps for this model's expressions.
          </p>
          <div class="flex items-center justify-end gap-2 pt-0.5">
            <button
              type="button"
              class="cursor-pointer rounded-lg px-3 py-1.5 text-[11px] text-neutral-500 font-medium dark:text-neutral-400 hover:text-neutral-800 dark:hover:text-neutral-200"
              @click="showEmotionCalibrationConfirm = false"
            >
              Not now
            </button>
            <button
              type="button"
              class="cursor-pointer rounded-lg bg-primary-600 px-3.5 py-1.5 text-[11px] text-white font-semibold shadow-sm transition-all hover:bg-primary-500"
              @click="openEmotionCalibration"
            >
              Open in Settings →
            </button>
          </div>
        </div>
      </div>
    </template>
  </div>
</template>
