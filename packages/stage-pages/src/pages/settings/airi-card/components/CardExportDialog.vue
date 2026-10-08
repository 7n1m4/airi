<script setup lang="ts">
import type { AiriCard } from '@proj-airi/stage-ui/stores/modules/airi-card'

import { extractModelIcon, getLatestSelfie } from '@proj-airi/stage-ui/libs/character-media-resolver'
import { useBackgroundStore } from '@proj-airi/stage-ui/stores/background'
import { useChatSessionStore } from '@proj-airi/stage-ui/stores/chat/session-store'
import { useDisplayModelsStore } from '@proj-airi/stage-ui/stores/display-models'
import { useAiriCardStore } from '@proj-airi/stage-ui/stores/modules/airi-card'
import { Button } from '@proj-airi/ui'
import {
  DialogContent,
  DialogOverlay,
  DialogPortal,
  DialogRoot,
  DialogTitle,
} from 'reka-ui'
import { computed, ref, watch } from 'vue'
import { toast } from 'vue-sonner'

import cardExportFrameUrl from '../card-export-frame.png?url'

import { generateFallbackAvatarDataUrl, useCardExport } from '../composables/use-card-export'

interface Props {
  modelValue: boolean
  cardId?: string
  card?: AiriCard | null
}

const props = withDefaults(defineProps<Props>(), {
  cardId: '',
  card: null,
})

const emit = defineEmits<{
  (e: 'update:modelValue', value: boolean): void
}>()

// Core Stores for character asset query
const cardStore = useAiriCardStore()
const displayModelsStore = useDisplayModelsStore()
const backgroundStore = useBackgroundStore()
const chatSessionStore = useChatSessionStore()

// 3-part segment at top: defaults to 'zip'
const activeSegment = ref<'zip' | 'png' | 'json'>('zip')

// Active character data (props.card or safe fallback)
const activeCard = computed<AiriCard>(() => {
  if (props.card)
    return props.card

  return {
    name: 'nan0',
    nickname: 'Companion',
    description: 'Autonomous AI companion with expressive dynamic live avatars, multi-modal vision perception, and rich episodic memory.',
    version: '1.0.0',
    creator: 'Moeru AI',
    tags: ['Companion', 'Assistant', 'Anime', 'Live2D', 'VRM'],
    systemPrompt: 'You are an attentive and insightful digital companion.',
    greetings: [
      'Hello there! Ready to build something great today?',
    ],
    extensions: {
      airi: {
        consciousness: { provider: 'openrouter', model: 'anthropic/claude-3.7-sonnet' },
        artistry: { enabled: true },
        proactivity: { heartbeatIntervalSeconds: 30 },
      },
    },
  } as unknown as AiriCard
})

// Safe filenames based on actual card name
const safeBaseName = computed(() => {
  const raw = activeCard.value.name || 'airi_card'
  return raw.toLowerCase().replace(/[^a-z0-9_-]/g, '_')
})

// ==================== 1. DYNAMIC MODEL DETECTION ====================
const displayModelInfo = computed(() => {
  const modelId = (props.cardId ? cardStore.getCardDisplayModelId(props.cardId) : null)
    || (activeCard.value as any).displayModelId
    || (activeCard.value.extensions?.airi as any)?.model?.displayModelId
  if (!modelId || modelId === 'none')
    return null

  const model = displayModelsStore.displayModels.find(m => m.id === modelId)
  if (!model) {
    return {
      id: modelId,
      name: 'Body Model',
      format: 'VRM',
      rawFormat: 'vrm',
      filename: 'body-model.vrm',
      upstreamFilename: 'body-model.vrm',
      upstreamFormat: 'vrm',
      isMmd: false,
      exportSupported: true,
      previewImage: null,
    }
  }

  const rawFormat = (model.format || '').toLowerCase()
  const isVrm = rawFormat === 'vrm' || model.name.toLowerCase().endsWith('.vrm')
  const isMmd = rawFormat.includes('pmx') || rawFormat.includes('pmd')
  const isLive2d = rawFormat.includes('live2d')
  const isSpine = rawFormat.includes('spine')

  // Upstream file extensions: [VRM]: 'vrm', [Live2dZip]: 'zip', [SpineZip]: 'zip'.
  // Upstream manifest literals differ: 'vrm' | 'live2d-zip' | 'spine-zip' (never generic 'zip').
  const upstreamExt = isVrm ? 'vrm' : 'zip'
  const upstreamFormat = isVrm ? 'vrm' : isLive2d ? 'live2d-zip' : isSpine ? 'spine-zip' : null
  const ext = isVrm ? 'vrm' : isMmd ? 'pmx' : 'zip'
  const cleanName = (model.name || 'model').toLowerCase().replace(/[^a-z0-9_-]/g, '_')

  let formatLabel = '3D/2D'
  if (isVrm)
    formatLabel = 'VRM'
  else if (isLive2d)
    formatLabel = 'Live2D'
  else if (isSpine)
    formatLabel = 'Spine'
  else if (isMmd)
    formatLabel = 'MMD'

  return {
    id: model.id,
    name: model.name || 'Display Model',
    format: formatLabel,
    rawFormat,
    filename: `${cleanName}.${ext}`,
    upstreamFilename: `body-model.${upstreamExt}`,
    upstreamFormat,
    isMmd,
    exportSupported: !isMmd,
    previewImage: model.authorIcon || model.previewImage || null,
  }
})

// ==================== 1.1 COVER ART SOURCES (4-TIER STRATEGY) ====================
export type CoverArtSourceType = 'selfie' | 'preview' | 'author-icon' | 'letter'

interface CoverArtOption {
  type: CoverArtSourceType
  label: string
  sublabel: string
  url: string | null
  icon: string
}

const lazyExtractedIcon = ref<string | null>(null)
const selectedCoverSource = ref<CoverArtSourceType>('selfie')

// Lazy extract author icon from model zip if present
watch(() => displayModelInfo.value?.id, async (modelId) => {
  if (!modelId) {
    lazyExtractedIcon.value = null
    return
  }
  try {
    const icon = await extractModelIcon(modelId)
    if (icon) {
      lazyExtractedIcon.value = icon
    }
  }
  catch (err) {
    console.warn('[CardExportDialog] Failed to extract model icon:', err)
  }
}, { immediate: true })

const latestSelfieUrl = computed<string | null>(() => {
  if (!props.cardId)
    return null
  return getLatestSelfie(props.cardId)
})

const modelPreviewUrl = computed<string | null>(() => {
  const modelId = displayModelInfo.value?.id
  if (!modelId)
    return null
  const model = displayModelsStore.displayModels.find(m => m.id === modelId)
  return model?.previewImage || null
})

const authorIconUrl = computed<string | null>(() => {
  const modelId = displayModelInfo.value?.id
  if (!modelId)
    return null
  const model = displayModelsStore.displayModels.find(m => m.id === modelId)
  return model?.authorIcon || lazyExtractedIcon.value || null
})

// Available cover art sources for this character
const availableCoverSources = computed<CoverArtOption[]>(() => {
  const sources: CoverArtOption[] = []

  if (latestSelfieUrl.value) {
    sources.push({
      type: 'selfie',
      label: 'Stage Selfie',
      sublabel: 'Latest stage snapshot',
      url: latestSelfieUrl.value,
      icon: 'i-solar:camera-bold-duotone',
    })
  }

  if (modelPreviewUrl.value) {
    sources.push({
      type: 'preview',
      label: 'Model Render',
      sublabel: `${displayModelInfo.value?.format || 'Avatar'} snapshot`,
      url: modelPreviewUrl.value,
      icon: 'i-solar:gallery-wide-bold-duotone',
    })
  }

  if (authorIconUrl.value && authorIconUrl.value !== modelPreviewUrl.value) {
    sources.push({
      type: 'author-icon',
      label: 'Author Icon',
      sublabel: 'Model icon thumbnail',
      url: authorIconUrl.value,
      icon: 'i-solar:smile-circle-bold-duotone',
    })
  }

  // Real rendered vector monogram canvas for the Initial Badge
  const monogramDataUrl = generateFallbackAvatarDataUrl(activeCard.value.name || 'A')

  sources.push({
    type: 'letter',
    label: 'Initial Badge',
    sublabel: 'Vector monogram art',
    url: monogramDataUrl,
    icon: 'i-solar:text-bold-duotone',
  })

  return sources
})

// Auto-select the highest available tier on card or source change
watch(availableCoverSources, (sources) => {
  const exists = sources.some(s => s.type === selectedCoverSource.value)
  if (!exists) {
    selectedCoverSource.value = sources[0]?.type || 'letter'
  }
}, { immediate: true })

// The active resolved image URL for PNG preview and export
const activeCoverImageUrl = computed<string | null>(() => {
  switch (selectedCoverSource.value) {
    case 'selfie':
      return latestSelfieUrl.value
    case 'preview':
      return modelPreviewUrl.value
    case 'author-icon':
      return authorIconUrl.value
    case 'letter':
      return generateFallbackAvatarDataUrl(activeCard.value.name || 'A')
    default:
      return null
  }
})

// Header badge avatar uses the active cover art or fallback
const avatarImageUrl = computed(() => {
  return activeCoverImageUrl.value || latestSelfieUrl.value || modelPreviewUrl.value || authorIconUrl.value || null
})

// ==================== 2. DYNAMIC VOICE PROFILE DETECTION ====================
const detectedVoiceProfile = computed(() => {
  // Check bundled profiles from getCardWithExportedBackground
  const profiles = (activeCard.value.extensions?.airi as any)?.voice_profiles
  if (Array.isArray(profiles) && profiles.length > 0) {
    const first = profiles[0]
    const cleanId = (first.id || 'custom_voice').toLowerCase().replace(/[^a-z0-9_-]/g, '_')
    return {
      hasVoice: true,
      count: profiles.length,
      name: first.name || first.id || 'Virtual Voice Profile',
      provider: (first as any).provider || (first as any).engine || 'virtual-audio-studio',
      filename: `${cleanId}.json`,
    }
  }

  // Check speech config
  const speech = (activeCard.value.extensions?.airi as any)?.speech
    || (activeCard.value.extensions?.airi as any)?.modules?.speech
  if (speech && (speech.voice_id || speech.voiceId || speech.model)) {
    const provider = speech.provider || 'Custom'
    const voiceName = speech.voice_id || speech.voiceId || speech.model
    return {
      hasVoice: true,
      count: 1,
      name: `${provider} (${voiceName})`,
      provider,
      filename: 'voice_profile.json',
    }
  }

  return null
})

// ==================== 3. DYNAMIC SCENE BACKGROUND DETECTION ====================
const detectedBackground = computed(() => {
  const bgId = (activeCard.value.extensions?.airi as any)?.modules?.activeBackgroundId
    || (activeCard.value as any).backgroundId
  if (!bgId || bgId === 'none')
    return null

  const entry = backgroundStore.entries.get(bgId)
  return {
    hasBg: true,
    title: entry?.title || 'Scene Background',
    id: bgId,
  }
})

// ==================== 4. DYNAMIC CHAT SESSIONS / MEMORIES DETECTION ====================
// Initialize chatSessionStore when dialog opens to ensure index is populated
watch(() => props.modelValue, async (isOpen) => {
  if (isOpen && typeof chatSessionStore.initialize === 'function' && !chatSessionStore.isReady) {
    try {
      await chatSessionStore.initialize()
    }
    catch (err) {
      console.warn('[CardExportDialog] Failed to initialize chatSessionStore:', err)
    }
  }
}, { immediate: true })

const detectedChatSessions = computed(() => {
  if (!props.cardId)
    return []

  // Method 1: Official chatSessionStore.getCharacterIndex helper
  const charIndex = chatSessionStore.getCharacterIndex(props.cardId)
  if (charIndex?.sessions) {
    return Object.values(charIndex.sessions)
  }

  // Method 2: Raw index traversal if index object is direct
  const rawSessions = (chatSessionStore.index as any)?.characters?.[props.cardId]?.sessions
  if (rawSessions) {
    return Object.values(rawSessions)
  }

  // Method 3: Session metas lookup by characterId
  const matchingMetas = Object.values(chatSessionStore.sessionMetas || {}).filter(
    (meta: any) => meta?.characterId === props.cardId,
  )
  if (matchingMetas.length > 0)
    return matchingMetas

  return []
})

// ==================== OPTIONS STATE & DEFAULTS ====================
const zipFlavor = ref<'v2' | 'v1'>('v2')
const includeModels = ref(true)
const includeBackground = ref(true)
const includeVoiceProfiles = ref(true)
const includeCoverFrame = ref(true)
const includeMemories = ref(false)
const generateReadme = ref(true)

// Tree folder collapsible toggles
const treeExpandedModels = ref(true)
const treeExpandedVoices = ref(true)
const treeExpandedMemories = ref(true)

// PNG Options
const pngFramed = ref(true)
const pngOmitNotes = ref(false)

// JSON Options
const jsonPretty = ref(true)
const jsonIncludeMemories = ref(false)

// Synchronize initial checkbox states with detected capabilities
watch([() => activeCard.value, () => detectedChatSessions.value.length, () => displayModelInfo.value], () => {
  includeModels.value = !!displayModelInfo.value?.exportSupported
  includeBackground.value = !!detectedBackground.value
  includeVoiceProfiles.value = !!detectedVoiceProfile.value
  includeMemories.value = detectedChatSessions.value.length > 0
}, { immediate: true })

// 3-part compatibility matrix
const compatibilityMatrix = computed(() => {
  switch (activeSegment.value) {
    case 'zip':
      return {
        dasilva: true,
        sillyTavern: false,
        moeru: true,
      }
    case 'png':
      return {
        dasilva: true,
        sillyTavern: true,
        moeru: false,
      }
    case 'json':
      return {
        dasilva: true,
        sillyTavern: false,
        moeru: false,
      }
  }
})

// Dynamic button label based on format and flavor
const exportButtonLabel = computed(() => {
  switch (activeSegment.value) {
    case 'zip':
      return zipFlavor.value === 'v2'
        ? 'Export AIRI Package (.zip)'
        : 'Export Upstream Package (.zip)'
    case 'png':
      return 'Export Embedded Card (.png)'
    case 'json':
      return 'Export Character JSON (.json)'
  }
})

// Dynamic JSON manifest string preview
const previewJsonString = computed(() => {
  const payload: Record<string, any> = {
    format: 'airi-card',
    version: 1,
    exportedAt: new Date().toISOString(),
    card: activeCard.value,
  }
  if (jsonIncludeMemories.value && detectedChatSessions.value.length > 0) {
    payload.sessions = detectedChatSessions.value
  }
  return JSON.stringify(payload, null, jsonPretty.value ? 2 : 0)
})

const { exportCardJson, exportCardPng, exportCardZip } = useCardExport()
const isExporting = ref(false)

function handleClose() {
  emit('update:modelValue', false)
}

async function handleCopyPayload() {
  try {
    if (activeSegment.value === 'json') {
      await navigator.clipboard?.writeText(previewJsonString.value)
      toast.success(`Copied ${activeCard.value.name}'s JSON manifest to clipboard`)
    }
    else {
      toast.info(`Clipboard copy is currently only available for JSON manifest.`)
    }
  }
  catch (err: any) {
    console.error('[CardExportDialog] Failed to copy payload:', err)
    toast.error(`Failed to copy to clipboard: ${err?.message || 'Permission denied'}`)
  }
}

async function handleExportDownload() {
  if (!props.cardId) {
    toast.error('Cannot export without a valid card ID')
    return
  }

  isExporting.value = true
  try {
    if (activeSegment.value === 'json') {
      await exportCardJson(props.cardId, {
        pretty: jsonPretty.value,
        includeMemories: jsonIncludeMemories.value,
      })
      toast.success(`Exported ${activeCard.value.name} as .json`)
      handleClose()
    }
    else if (activeSegment.value === 'png') {
      await exportCardPng(props.cardId, {
        framed: pngFramed.value,
        omitNotes: pngOmitNotes.value,
        imageSourceUrl: activeCoverImageUrl.value,
      })
      toast.success(`Exported ${activeCard.value.name} as .png`)
      handleClose()
    }
    else {
      await exportCardZip(props.cardId, {
        flavor: zipFlavor.value,
        includeModels: includeModels.value,
        includeBackground: includeBackground.value,
        includeVoiceProfiles: includeVoiceProfiles.value,
        includeCover: includeCoverFrame.value,
        includeMemories: includeMemories.value,
        generateReadme: generateReadme.value,
        coverImageUrl: activeCoverImageUrl.value,
      })
      toast.success(`Exported ${activeCard.value.name} as .zip`)
      handleClose()
    }
  }
  catch (err: any) {
    console.error('[CardExportDialog] Export failed:', err)
    toast.error(`Export failed: ${err?.message || 'Unknown error'}`)
  }
  finally {
    isExporting.value = false
  }
}
</script>

<template>
  <DialogRoot :open="modelValue" @update:open="emit('update:modelValue', $event)">
    <DialogPortal>
      <DialogOverlay
        :class="[
          'fixed inset-0 z-999 bg-black/60 backdrop-blur-sm',
          'data-[state=closed]:animate-fadeOut data-[state=open]:animate-fadeIn',
        ]"
      />
      <DialogContent
        :class="[
          'fixed left-1/2 top-1/2 z-1000 max-h-[88vh] w-[92vw] max-w-3xl -translate-x-1/2 -translate-y-1/2',
          'flex flex-col overflow-hidden rounded-2xl bg-white shadow-2xl dark:bg-neutral-900',
          'border border-neutral-200 dark:border-neutral-800',
          'data-[state=closed]:animate-contentHide data-[state=open]:animate-contentShow',
        ]"
      >
        <!-- Modal Header with Character Details -->
        <div
          :class="[
            'flex items-center justify-between px-6 pt-5 pb-3',
            'bg-white dark:bg-neutral-900 border-b border-neutral-100 dark:border-neutral-800/60',
          ]"
        >
          <div :class="['flex items-center gap-3 min-w-0']">
            <!-- Avatar or Letter Badge -->
            <div
              :class="[
                'relative h-9 w-9 shrink-0 overflow-hidden rounded-xl border border-neutral-200 dark:border-neutral-700 bg-neutral-100 dark:bg-neutral-800 flex items-center justify-center',
              ]"
            >
              <img
                v-if="avatarImageUrl"
                :src="avatarImageUrl"
                :alt="activeCard.name"
                :class="['h-full w-full object-cover object-top']"
              >
              <div v-else i-solar:user-bold-duotone :class="['text-lg text-primary-500']" />
            </div>

            <div :class="['min-w-0 flex flex-col']">
              <div :class="['flex items-center gap-2 truncate']">
                <DialogTitle :class="['text-base font-semibold text-neutral-800 dark:text-neutral-100 truncate']">
                  Export {{ activeCard.name }}
                </DialogTitle>
                <span :class="['text-[11px] px-1.5 py-0.5 rounded bg-neutral-100 dark:bg-neutral-800 text-neutral-500 font-mono']">
                  v{{ activeCard.version || '1.0' }}
                </span>
                <span
                  v-if="activeCard.nickname && activeCard.nickname.trim() !== activeCard.name.trim()"
                  :class="['text-xs text-neutral-400 italic truncate']"
                >
                  "{{ activeCard.nickname }}"
                </span>
              </div>
              <p :class="['text-xs text-neutral-400 truncate']">
                Target: {{ safeBaseName }}.{{ activeSegment === 'zip' ? 'zip' : activeSegment }}
              </p>
            </div>
          </div>

          <button
            :class="[
              'rounded-lg p-1.5 text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-200',
              'hover:bg-neutral-100 dark:hover:bg-neutral-800 transition-colors',
            ]"
            @click="handleClose"
          >
            <div i-solar:close-circle-linear :class="['text-xl']" />
          </button>
        </div>

        <!-- 3-Part Segmented Control -->
        <div :class="['px-6 pt-3 pb-2']">
          <div
            :class="[
              'grid grid-cols-3 gap-1 rounded-xl bg-neutral-100 p-1 dark:bg-neutral-800/80',
              'border border-neutral-200/50 dark:border-neutral-700/50',
            ]"
          >
            <!-- ZIP Tab -->
            <button
              :class="[
                'flex items-center justify-center gap-2 py-2 text-xs font-semibold rounded-lg transition-all',
                activeSegment === 'zip'
                  ? 'bg-white text-primary-600 shadow-sm dark:bg-neutral-700 dark:text-primary-400'
                  : 'text-neutral-500 hover:text-neutral-800 dark:text-neutral-400 dark:hover:text-neutral-200',
              ]"
              @click="activeSegment = 'zip'"
            >
              <div i-solar:archive-bold-duotone :class="['text-base']" />
              <span>ZIP Package</span>
            </button>

            <!-- PNG Tab -->
            <button
              :class="[
                'flex items-center justify-center gap-2 py-2 text-xs font-semibold rounded-lg transition-all',
                activeSegment === 'png'
                  ? 'bg-white text-primary-600 shadow-sm dark:bg-neutral-700 dark:text-primary-400'
                  : 'text-neutral-500 hover:text-neutral-800 dark:text-neutral-400 dark:hover:text-neutral-200',
              ]"
              @click="activeSegment = 'png'"
            >
              <div i-solar:gallery-wide-bold-duotone :class="['text-base']" />
              <span>Portable PNG</span>
            </button>

            <!-- JSON Tab -->
            <button
              :class="[
                'flex items-center justify-center gap-2 py-2 text-xs font-semibold rounded-lg transition-all',
                activeSegment === 'json'
                  ? 'bg-white text-primary-600 shadow-sm dark:bg-neutral-700 dark:text-primary-400'
                  : 'text-neutral-500 hover:text-neutral-800 dark:text-neutral-400 dark:hover:text-neutral-200',
              ]"
              @click="activeSegment = 'json'"
            >
              <div i-solar:code-file-bold-duotone :class="['text-base']" />
              <span>Raw JSON</span>
            </button>
          </div>
        </div>

        <!-- 3-Part Compatibility Chips Bar -->
        <div :class="['px-6 pb-2.5 pt-0.5 flex items-center justify-center gap-2 flex-wrap']">
          <!-- moeru-ai/airi -->
          <div
            :class="[
              'inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium border transition-all',
              compatibilityMatrix.moeru
                ? 'bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 border-emerald-200 dark:border-emerald-800'
                : 'bg-neutral-100 dark:bg-neutral-800/60 text-neutral-400 dark:text-neutral-500 border-neutral-200 dark:border-neutral-700 line-through opacity-60',
            ]"
          >
            <div
              :class="[
                compatibilityMatrix.moeru
                  ? 'i-solar:check-circle-bold text-emerald-500'
                  : 'i-solar:close-circle-bold text-neutral-400',
                'text-sm',
              ]"
            />
            <span>moeru-ai/airi</span>
          </div>

          <!-- SillyTavern -->
          <div
            :class="[
              'inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium border transition-all',
              compatibilityMatrix.sillyTavern
                ? 'bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 border-emerald-200 dark:border-emerald-800'
                : 'bg-neutral-100 dark:bg-neutral-800/60 text-neutral-400 dark:text-neutral-500 border-neutral-200 dark:border-neutral-700 line-through opacity-60',
            ]"
          >
            <div
              :class="[
                compatibilityMatrix.sillyTavern
                  ? 'i-solar:check-circle-bold text-emerald-500'
                  : 'i-solar:close-circle-bold text-neutral-400',
                'text-sm',
              ]"
            />
            <span>SillyTavern Compatible</span>
          </div>

          <!-- dasilva333/airi -->
          <div
            :class="[
              'inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium border transition-all',
              compatibilityMatrix.dasilva
                ? 'bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 border-emerald-200 dark:border-emerald-800'
                : 'bg-neutral-100 dark:bg-neutral-800/60 text-neutral-400 dark:text-neutral-500 border-neutral-200 dark:border-neutral-700 line-through opacity-60',
            ]"
          >
            <div
              :class="[
                compatibilityMatrix.dasilva
                  ? 'i-solar:check-circle-bold text-emerald-500'
                  : 'i-solar:close-circle-bold text-neutral-400',
                'text-sm',
              ]"
            />
            <span>dasilva333/airi</span>
          </div>
        </div>

        <!-- Focused Segment Content Body -->
        <div :class="['flex-1 overflow-y-auto px-6 py-2.5']">
          <!-- ==================== 1. ZIP SECTION ==================== -->
          <div v-if="activeSegment === 'zip'" :class="['flex flex-col gap-3.5']">
            <!-- Top: Package Spec Flavor Buttons -->
            <div :class="['flex items-center gap-2 p-1 rounded-xl bg-neutral-100 dark:bg-neutral-800/70 w-full sm:w-fit text-xs font-medium border border-neutral-200/50 dark:border-neutral-700/50']">
              <button
                :class="[
                  'flex-1 sm:flex-initial px-3.5 py-1.5 rounded-lg transition-all',
                  zipFlavor === 'v2'
                    ? 'bg-white shadow-xs text-primary-600 dark:bg-neutral-700 dark:text-primary-400 font-semibold'
                    : 'text-neutral-500 hover:text-neutral-800 dark:text-neutral-400',
                ]"
                @click="zipFlavor = 'v2'"
              >
                dasilva333 Extended (v2)
              </button>
              <button
                :class="[
                  'flex-1 sm:flex-initial px-3.5 py-1.5 rounded-lg transition-all',
                  zipFlavor === 'v1'
                    ? 'bg-white shadow-xs text-primary-600 dark:bg-neutral-700 dark:text-primary-400 font-semibold'
                    : 'text-neutral-500 hover:text-neutral-800 dark:text-neutral-400',
                ]"
                @click="zipFlavor = 'v1'"
              >
                moeru-ai Standard (v1)
              </button>
            </div>

            <!-- Upstream Sanitization Notice Banner (v1 only) -->
            <div
              v-if="zipFlavor === 'v1'"
              :class="[
                'flex items-start gap-2.5 p-2.5 rounded-xl text-xs',
                'bg-sky-50/70 dark:bg-sky-950/30 text-sky-800 dark:text-sky-200 border border-sky-200/80 dark:border-sky-800/60',
              ]"
            >
              <div i-solar:info-circle-bold :class="['text-sm text-sky-500 shrink-0 mt-0.5']" />
              <div :class="['flex flex-col gap-0.5 leading-tight text-[11px]']">
                <span :class="['font-semibold']">Upstream Whitelist Active (PR #1998)</span>
                <span :class="['opacity-90']">
                  Exports clean CCv3 metadata and primary body model into <code>models/body-model.vrm</code>. Custom acting prompts, background scenes, voice profiles, and memory logs are omitted to match upstream's whitelist.
                </span>
              </div>
            </div>

            <!-- Middle: Dynamic Checkboxes based on detected data -->
            <div :class="['flex flex-col gap-2 rounded-xl border border-neutral-200 dark:border-neutral-800 p-3.5 bg-neutral-50/50 dark:bg-neutral-950/20 text-xs']">
              <!-- Bundle Models -->
              <label
                :class="[
                  'flex items-start gap-2.5 select-none',
                  displayModelInfo && displayModelInfo.exportSupported ? 'cursor-pointer' : 'cursor-not-allowed opacity-60',
                ]"
              >
                <input
                  v-model="includeModels"
                  type="checkbox"
                  :disabled="!displayModelInfo || !displayModelInfo.exportSupported"
                  :class="['mt-0.5 rounded text-primary-600']"
                >
                <div :class="['flex flex-col']">
                  <div :class="['flex items-center gap-2']">
                    <span :class="['font-medium text-neutral-800 dark:text-neutral-200']">
                      {{ zipFlavor === 'v1' ? `Bundle Body Model (${displayModelInfo?.upstreamFilename || 'body-model.vrm'})` : 'Bundle 3D/2D Display Model' }}
                    </span>
                    <span
                      v-if="displayModelInfo && displayModelInfo.exportSupported"
                      :class="['text-[10px] px-1.5 py-0.2 rounded bg-primary-100 dark:bg-primary-900/40 text-primary-700 dark:text-primary-300 font-mono']"
                    >
                      {{ displayModelInfo.name }} • {{ displayModelInfo.format }}
                    </span>
                    <span
                      v-else-if="displayModelInfo && displayModelInfo.isMmd"
                      :class="['text-[10px] px-1.5 py-0.2 rounded bg-amber-100 dark:bg-amber-950/40 text-amber-700 dark:text-amber-300 font-mono font-medium']"
                    >
                      MMD export not supported • Metadata only
                    </span>
                    <span
                      v-else
                      :class="['text-[10px] text-neutral-400 italic']"
                    >
                      (No model assigned)
                    </span>
                  </div>
                  <span
                    v-if="displayModelInfo?.isMmd"
                    :class="['text-[11px] text-amber-600 dark:text-amber-400 italic mt-0.5']"
                  >
                    MMD models utilize decomposed texture maps and are omitted from export archives.
                  </span>
                  <span
                    v-else
                    :class="['text-[11px] text-amber-600 dark:text-amber-400']"
                  >
                    Only share if model licenses permit redistribution
                  </span>
                </div>
              </label>

              <!-- v2-only options -->
              <template v-if="zipFlavor === 'v2'">
                <!-- Scene Background -->
                <label
                  :class="[
                    'flex items-center gap-2.5 select-none',
                    detectedBackground ? 'cursor-pointer' : 'cursor-not-allowed opacity-60',
                  ]"
                >
                  <input
                    v-model="includeBackground"
                    type="checkbox"
                    :disabled="!detectedBackground"
                    :class="['rounded text-primary-600']"
                  >
                  <div :class="['flex items-center gap-2']">
                    <span :class="['text-neutral-700 dark:text-neutral-300']">Include scene background image</span>
                    <span
                      v-if="detectedBackground"
                      :class="['text-[10px] px-1.5 py-0.2 rounded bg-neutral-200/70 dark:bg-neutral-800 text-neutral-600 dark:text-neutral-300 font-mono']"
                    >
                      {{ detectedBackground.title }}
                    </span>
                    <span v-else :class="['text-[10px] text-neutral-400 italic']">
                      (No background assigned)
                    </span>
                  </div>
                </label>

                <!-- Voice Profiles -->
                <label
                  :class="[
                    'flex items-center gap-2.5 select-none',
                    detectedVoiceProfile ? 'cursor-pointer' : 'cursor-not-allowed opacity-60',
                  ]"
                >
                  <input
                    v-model="includeVoiceProfiles"
                    type="checkbox"
                    :disabled="!detectedVoiceProfile"
                    :class="['rounded text-primary-600']"
                  >
                  <div :class="['flex items-center gap-2']">
                    <span :class="['text-neutral-700 dark:text-neutral-300']">Include virtual voice profiles</span>
                    <span
                      v-if="detectedVoiceProfile"
                      :class="['text-[10px] px-1.5 py-0.2 rounded bg-pink-100 dark:bg-pink-950/40 text-pink-700 dark:text-pink-300 font-mono']"
                    >
                      {{ detectedVoiceProfile.name }}
                    </span>
                    <span v-else :class="['text-[10px] text-neutral-400 italic']">
                      (No voice profile detected)
                    </span>
                  </div>
                </label>

                <!-- Glass Frame Cover -->
                <label :class="['flex items-center gap-2.5 cursor-pointer select-none']">
                  <input v-model="includeCoverFrame" type="checkbox" :class="['rounded text-primary-600']">
                  <span :class="['text-neutral-700 dark:text-neutral-300']">Include collectible glass-framed cover (925×1436)</span>
                </label>

                <!-- Memories & Chat Sessions -->
                <label :class="['flex items-center gap-2.5 cursor-pointer select-none']">
                  <input v-model="includeMemories" type="checkbox" :class="['rounded text-primary-600']">
                  <div :class="['flex items-center gap-2']">
                    <span :class="['text-neutral-700 dark:text-neutral-300']">Include episodic memories &amp; chat history</span>
                    <span
                      v-if="detectedChatSessions.length > 0"
                      :class="['text-[10px] px-1.5 py-0.2 rounded bg-teal-100 dark:bg-teal-950/40 text-teal-700 dark:text-teal-300 font-mono']"
                    >
                      {{ detectedChatSessions.length }} session(s) detected
                    </span>
                    <span v-else :class="['text-[10px] text-neutral-400 italic']">
                      (0 sessions logged)
                    </span>
                  </div>
                </label>

                <!-- Readme -->
                <label :class="['flex items-center gap-2.5 cursor-pointer select-none']">
                  <input v-model="generateReadme" type="checkbox" :class="['rounded text-primary-600']">
                  <span :class="['text-neutral-700 dark:text-neutral-300']">Generate README.md with credits &amp; compatibility</span>
                </label>
              </template>
            </div>

            <!-- Bottom: Clean, Light-Themed Dynamic Archive Layout Preview -->
            <div :class="['flex flex-col gap-1.5']">
              <div :class="['flex items-center justify-between text-[11px] text-neutral-400 font-semibold uppercase tracking-wider']">
                <span>Archive Structure Preview</span>
                <span class="text-neutral-500 font-normal font-mono normal-case">
                  {{ zipFlavor === 'v2' ? 'AIRI Package Spec v2' : 'moeru-ai v1 Archive' }}
                </span>
              </div>

              <div
                :class="[
                  'rounded-xl bg-neutral-50/80 dark:bg-neutral-800/40 p-3 text-[11px] font-mono leading-relaxed',
                  'border border-neutral-200/80 dark:border-neutral-700/60 text-neutral-700 dark:text-neutral-300 flex flex-col gap-1',
                ]"
              >
                <!-- ZIP Package Name -->
                <div :class="['flex items-center gap-1.5 text-primary-600 dark:text-primary-400 font-semibold pb-1.5 border-b border-neutral-200/70 dark:border-neutral-700/50']">
                  <div i-solar:archive-linear :class="['text-sm']" />
                  <span>{{ safeBaseName }}_card.zip</span>
                  <span :class="['text-[10px] font-normal text-neutral-400 dark:text-neutral-500 ml-auto']">
                    {{ zipFlavor === 'v2' ? 'v2 Extended' : 'v1 Standard' }}
                  </span>
                </div>

                <!-- Files Tree -->
                <div :class="['pt-1 flex flex-col gap-1 text-[11px]']">
                  <div :class="['flex items-center gap-1.5 text-neutral-700 dark:text-neutral-300']">
                    <div i-solar:file-code-linear :class="['text-amber-500']" />
                    <span>manifest.json</span>
                    <span :class="['text-[10px] text-neutral-400']">{{ zipFlavor === 'v2' ? '(v2 multi-resource)' : '(v1 manifest)' }}</span>
                  </div>
                  <div :class="['flex items-center gap-1.5 text-neutral-700 dark:text-neutral-300']">
                    <div i-solar:file-code-linear :class="['text-sky-500']" />
                    <span>card.json</span>
                    <span :class="['text-[10px] text-neutral-400']">{{ zipFlavor === 'v1' ? '(CCv3 standard)' : '(clean metadata)' }}</span>
                  </div>

                  <!-- v2 extended files -->
                  <template v-if="zipFlavor === 'v2'">
                    <div v-if="includeCoverFrame" :class="['flex items-center gap-1.5 text-neutral-700 dark:text-neutral-300']">
                      <div i-solar:gallery-linear :class="['text-emerald-500']" />
                      <span>cover.png</span>
                      <span :class="['text-[10px] text-neutral-400']">(glass frame)</span>
                    </div>
                    <div v-if="includeBackground && detectedBackground" :class="['flex items-center gap-1.5 text-neutral-700 dark:text-neutral-300']">
                      <div i-solar:wallpaper-linear :class="['text-emerald-500']" />
                      <span>background.png</span>
                      <span :class="['text-[10px] text-neutral-400']">({{ detectedBackground.title }})</span>
                    </div>
                  </template>

                  <!-- Models -->
                  <div v-if="includeModels && displayModelInfo && displayModelInfo.exportSupported" :class="['flex flex-col pl-2 border-l border-neutral-300 dark:border-neutral-700 text-neutral-700 dark:text-neutral-300']">
                    <button
                      type="button"
                      :class="['flex items-center gap-1.5 text-left text-neutral-400 text-[10px] uppercase font-bold hover:text-neutral-600 dark:hover:text-neutral-200 transition-colors py-0.5 select-none']"
                      @click="treeExpandedModels = !treeExpandedModels"
                    >
                      <div
                        :class="[
                          treeExpandedModels ? 'i-solar:alt-arrow-down-linear' : 'i-solar:alt-arrow-right-linear',
                          'text-xs text-neutral-400',
                        ]"
                      />
                      <span>📁 models/</span>
                      <span :class="['text-[9px] font-normal normal-case opacity-70 ml-1']">(1 item)</span>
                    </button>
                    <div v-show="treeExpandedModels" :class="['flex items-center gap-1.5 pl-3 py-0.5']">
                      <div i-solar:box-linear :class="['text-purple-500 text-xs']" />
                      <span>{{ zipFlavor === 'v1' ? displayModelInfo.upstreamFilename : displayModelInfo.filename }}</span>
                    </div>
                  </div>

                  <!-- Voices (v2 only) -->
                  <div v-if="zipFlavor === 'v2' && includeVoiceProfiles && detectedVoiceProfile" :class="['flex flex-col pl-2 border-l border-neutral-300 dark:border-neutral-700 text-neutral-700 dark:text-neutral-300']">
                    <button
                      type="button"
                      :class="['flex items-center gap-1.5 text-left text-neutral-400 text-[10px] uppercase font-bold hover:text-neutral-600 dark:hover:text-neutral-200 transition-colors py-0.5 select-none']"
                      @click="treeExpandedVoices = !treeExpandedVoices"
                    >
                      <div
                        :class="[
                          treeExpandedVoices ? 'i-solar:alt-arrow-down-linear' : 'i-solar:alt-arrow-right-linear',
                          'text-xs text-neutral-400',
                        ]"
                      />
                      <span>📁 voices/</span>
                      <span :class="['text-[9px] font-normal normal-case opacity-70 ml-1']">({{ detectedVoiceProfile.count }} item{{ detectedVoiceProfile.count > 1 ? 's' : '' }})</span>
                    </button>
                    <div v-show="treeExpandedVoices" :class="['flex items-center gap-1.5 pl-3 py-0.5']">
                      <div i-solar:soundwave-linear :class="['text-pink-500 text-xs']" />
                      <span>{{ detectedVoiceProfile.filename }}</span>
                    </div>
                  </div>

                  <!-- Memories (v2 only) -->
                  <div v-if="zipFlavor === 'v2' && includeMemories" :class="['flex flex-col pl-2 border-l border-neutral-300 dark:border-neutral-700 text-neutral-700 dark:text-neutral-300']">
                    <button
                      type="button"
                      :class="['flex items-center gap-1.5 text-left text-neutral-400 text-[10px] uppercase font-bold hover:text-neutral-600 dark:hover:text-neutral-200 transition-colors py-0.5 select-none']"
                      @click="treeExpandedMemories = !treeExpandedMemories"
                    >
                      <div
                        :class="[
                          treeExpandedMemories ? 'i-solar:alt-arrow-down-linear' : 'i-solar:alt-arrow-right-linear',
                          'text-xs text-neutral-400',
                        ]"
                      />
                      <span>📁 memories/</span>
                      <span :class="['text-[9px] font-normal normal-case opacity-70 ml-1']">({{ detectedChatSessions.length }} timeline{{ detectedChatSessions.length > 1 ? 's' : '' }})</span>
                    </button>
                    <div v-show="treeExpandedMemories" :class="['flex items-center gap-1.5 pl-3 py-0.5']">
                      <div i-solar:chat-round-dots-linear :class="['text-teal-500 text-xs']" />
                      <span>chat_sessions.json</span>
                    </div>
                  </div>

                  <!-- Readme (v2 only) -->
                  <div v-if="zipFlavor === 'v2' && generateReadme" :class="['flex items-center gap-1.5 text-neutral-500 dark:text-neutral-400 mt-0.5']">
                    <div i-solar:document-text-linear :class="['text-blue-500']" />
                    <span>README.md</span>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <!-- ==================== 2. PNG SECTION ==================== -->
          <div v-else-if="activeSegment === 'png'" :class="['flex flex-col sm:flex-row gap-5 items-start']">
            <!-- Left: PNG Card Preview -->
            <div :class="['w-full sm:w-[170px] shrink-0 flex flex-col items-center justify-center p-2 rounded-xl bg-neutral-50 dark:bg-neutral-950/50 border border-neutral-200 dark:border-neutral-800']">
              <div
                v-if="pngFramed"
                :class="[
                  'relative aspect-[925/1436] w-full max-w-[150px] overflow-hidden rounded-lg shadow-md border border-neutral-200 dark:border-neutral-700 bg-neutral-900',
                ]"
              >
                <div :class="['absolute inset-x-[7%] top-[5.5%] bottom-[5.5%] overflow-hidden rounded bg-neutral-800 flex items-center justify-center']">
                  <img
                    v-if="avatarImageUrl"
                    :src="avatarImageUrl"
                    :alt="activeCard.name"
                    :class="['h-full w-full object-cover object-center']"
                  >
                  <div v-else i-solar:user-bold-duotone :class="['text-4xl text-primary-400/80']" />
                </div>
                <img :src="cardExportFrameUrl" alt="Glass Frame" :class="['pointer-events-none absolute inset-0 h-full w-full object-fill z-10']">
              </div>
              <div
                v-else
                :class="[
                  'relative aspect-square w-full max-w-[150px] overflow-hidden rounded-xl shadow-md border border-neutral-200 dark:border-neutral-700 bg-neutral-800 flex items-center justify-center',
                ]"
              >
                <img
                  v-if="avatarImageUrl"
                  :src="avatarImageUrl"
                  :alt="activeCard.name"
                  :class="['h-full w-full object-cover object-top']"
                >
                <div v-else i-solar:user-bold-duotone :class="['text-5xl text-primary-400']" />
              </div>
              <span :class="['mt-2 text-[10px] text-neutral-400 font-mono']">
                {{ pngFramed ? '925 × 1436 px (Glass Frame)' : '1:1 Aspect (Raw)' }}
              </span>
            </div>

            <!-- Right: PNG Options -->
            <div :class="['flex-1 w-full flex flex-col gap-3']">
              <!-- Cover Art Source Picker -->
              <div :class="['flex flex-col gap-2 rounded-xl border border-neutral-200 dark:border-neutral-800 p-3 bg-neutral-50/50 dark:bg-neutral-950/20 text-xs']">
                <div :class="['flex items-center justify-between']">
                  <span :class="['font-semibold text-neutral-800 dark:text-neutral-200 text-[11px] uppercase tracking-wider text-neutral-400']">
                    Cover Art Source
                  </span>
                  <span :class="['text-[10px] text-neutral-400 font-mono']">
                    {{ availableCoverSources.length }} available
                  </span>
                </div>

                <div :class="['grid grid-cols-3 gap-2 mt-0.5']">
                  <button
                    v-for="source in availableCoverSources"
                    :key="source.type"
                    type="button"
                    :class="[
                      'flex items-center gap-2 p-2 rounded-lg border text-left transition-all',
                      selectedCoverSource === source.type
                        ? 'border-primary-500 bg-white dark:bg-neutral-800 text-primary-600 dark:text-primary-400 shadow-xs'
                        : 'border-neutral-200/80 dark:border-neutral-800 hover:border-neutral-300 dark:hover:border-neutral-700 bg-neutral-100/50 dark:bg-neutral-900/40 text-neutral-600 dark:text-neutral-400',
                    ]"
                    @click="selectedCoverSource = source.type"
                  >
                    <!-- Source Thumbnail / Icon -->
                    <div
                      :class="[
                        'h-7 w-7 rounded-md shrink-0 overflow-hidden flex items-center justify-center border border-neutral-200 dark:border-neutral-700 bg-neutral-200/60 dark:bg-neutral-800',
                      ]"
                    >
                      <img
                        v-if="source.url"
                        :src="source.url"
                        :alt="source.label"
                        :class="['h-full w-full object-cover object-top']"
                      >
                      <div
                        v-else
                        :class="[source.icon, 'text-sm text-neutral-500']"
                      />
                    </div>

                    <div :class="['min-w-0 flex flex-col']">
                      <span :class="['font-medium truncate text-xs']">{{ source.label }}</span>
                      <span :class="['text-[10px] opacity-70 truncate']">{{ source.sublabel }}</span>
                    </div>
                  </button>
                </div>
              </div>

              <!-- PNG Framing & Scratchpad Options -->
              <div :class="['flex flex-col gap-2.5 rounded-xl border border-neutral-200 dark:border-neutral-800 p-3.5 text-xs bg-neutral-50/50 dark:bg-neutral-950/20']">
                <label :class="['flex items-center gap-2 cursor-pointer select-none']">
                  <input v-model="pngFramed" type="checkbox" :class="['rounded text-primary-600']">
                  <span :class="['font-medium text-neutral-800 dark:text-neutral-200']">Apply AIRI Collectible Glass Frame Overlay</span>
                </label>
                <label :class="['flex items-center gap-2 cursor-pointer select-none']">
                  <input v-model="pngOmitNotes" type="checkbox" :class="['rounded text-primary-600']">
                  <span :class="['text-neutral-700 dark:text-neutral-300']">Omit private creator notes &amp; scratchpad</span>
                </label>
              </div>

              <!-- Character quick summary badge -->
              <div :class="['p-3 rounded-xl border border-neutral-200/80 dark:border-neutral-800 text-[11px] flex flex-col gap-1.5 text-neutral-500']">
                <div :class="['flex items-center justify-between']">
                  <span>Export File</span>
                  <span :class="['font-mono font-medium text-neutral-700 dark:text-neutral-300']">{{ safeBaseName }}.png</span>
                </div>
                <div :class="['flex items-center justify-between']">
                  <span>Display Model</span>
                  <span :class="['font-medium text-neutral-700 dark:text-neutral-300']">{{ displayModelInfo?.name || 'Default' }}</span>
                </div>
                <div :class="['flex items-center justify-between']">
                  <span>Cover Art Source</span>
                  <span :class="['font-medium text-primary-600 dark:text-primary-400 capitalize']">
                    {{ availableCoverSources.find(s => s.type === selectedCoverSource)?.label || 'Default' }}
                  </span>
                </div>
                <div :class="['flex items-center justify-between']">
                  <span>Metadata Format</span>
                  <span :class="['font-mono text-neutral-700 dark:text-neutral-300']">chara_card_v2 (tEXt)</span>
                </div>
              </div>
            </div>
          </div>

          <!-- ==================== 3. JSON SECTION ==================== -->
          <div v-else :class="['flex flex-col sm:flex-row gap-5 items-start']">
            <!-- Left: JSON Code Preview -->
            <div :class="['w-full sm:w-[240px] shrink-0 flex flex-col gap-1.5']">
              <span :class="['text-[11px] font-semibold uppercase tracking-wider text-neutral-400']">
                Manifest Code Preview
              </span>
              <div
                :class="[
                  'h-[210px] overflow-auto rounded-xl bg-neutral-50/80 dark:bg-neutral-800/40 p-2.5 text-[10px] font-mono text-neutral-700 dark:text-neutral-300 leading-relaxed',
                  'border border-neutral-200/80 dark:border-neutral-700/60',
                ]"
              >
                <pre><code>{{ previewJsonString }}</code></pre>
              </div>
            </div>

            <!-- Right: JSON Options -->
            <div :class="['flex-1 w-full flex flex-col gap-3']">
              <div :class="['flex flex-col gap-2.5 rounded-xl border border-neutral-200 dark:border-neutral-800 p-3.5 text-xs bg-neutral-50/50 dark:bg-neutral-950/20']">
                <label :class="['flex items-center gap-2 cursor-pointer select-none']">
                  <input v-model="jsonPretty" type="checkbox" :class="['rounded text-primary-600']">
                  <span :class="['font-medium text-neutral-800 dark:text-neutral-200']">Pretty-print with 2-space indentation (for git)</span>
                </label>
                <label :class="['flex items-center gap-2 cursor-pointer select-none']">
                  <input v-model="jsonIncludeMemories" type="checkbox" :class="['rounded text-primary-600']">
                  <div :class="['flex items-center gap-2']">
                    <span :class="['text-neutral-700 dark:text-neutral-300']">Include episodic memories &amp; chat sessions</span>
                    <span v-if="detectedChatSessions.length" :class="['text-[10px] text-neutral-400']">({{ detectedChatSessions.length }} found)</span>
                  </div>
                </label>
              </div>

              <!-- Payload info badge -->
              <div :class="['p-3 rounded-xl border border-neutral-200/80 dark:border-neutral-800 text-[11px] flex flex-col gap-1.5 text-neutral-500']">
                <div :class="['flex items-center justify-between']">
                  <span>File Output</span>
                  <span :class="['font-mono font-medium text-neutral-700 dark:text-neutral-300']">{{ safeBaseName }}.json</span>
                </div>
                <div :class="['flex items-center justify-between']">
                  <span>Greetings Configured</span>
                  <span :class="['font-medium text-neutral-700 dark:text-neutral-300']">{{ activeCard.greetings?.length || 1 }}</span>
                </div>
                <div :class="['flex items-center justify-between']">
                  <span>Consciousness Provider</span>
                  <span :class="['font-mono text-neutral-700 dark:text-neutral-300']">{{ (activeCard.extensions?.airi as any)?.consciousness?.provider || 'Default' }}</span>
                </div>
              </div>
            </div>
          </div>
        </div>

        <!-- Modal Footer -->
        <div
          :class="[
            'flex items-center justify-between px-6 py-3.5 border-t border-neutral-200 dark:border-neutral-800',
            'bg-neutral-50/70 dark:bg-neutral-900/70 backdrop-blur-md',
          ]"
        >
          <Button
            variant="secondary"
            :class="['flex items-center gap-1.5 text-xs']"
            :disabled="isExporting"
            @click="handleCopyPayload"
          >
            <div i-solar:copy-linear :class="['text-sm']" />
            <span>Copy {{ activeSegment.toUpperCase() }}</span>
          </Button>

          <div :class="['flex items-center gap-3']">
            <Button
              variant="secondary"
              :disabled="isExporting"
              @click="handleClose"
            >
              Cancel
            </Button>
            <Button
              variant="primary"
              :class="['flex items-center gap-1.5 font-semibold']"
              :disabled="isExporting"
              @click="handleExportDownload"
            >
              <div
                v-if="isExporting"
                i-solar:restart-circle-bold-duotone
                :class="['text-base animate-spin']"
              />
              <div
                v-else
                i-solar:download-minimalistic-bold-duotone
                :class="['text-base']"
              />
              <span>{{ isExporting ? 'Exporting...' : exportButtonLabel }}</span>
            </Button>
          </div>
        </div>
      </DialogContent>
    </DialogPortal>
  </DialogRoot>
</template>
