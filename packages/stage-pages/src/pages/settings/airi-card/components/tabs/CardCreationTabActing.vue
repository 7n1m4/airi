<script setup lang="ts">
import type { SpeechCapabilitiesInfo } from '@proj-airi/stage-ui/stores/providers'
import type { CharacterCueAllowlist } from '@proj-airi/stage-ui/types/card.schema'
import type { ThinkingFillerPhrase } from '@proj-airi/stage-ui/types/pacing'

import { DEFAULT_PACING_FILLERS, PACING_PROFILES } from '@proj-airi/stage-ui/types/pacing'
import { computed, ref, watch } from 'vue'

import ActingSubTabCues from './acting/ActingSubTabCues.vue'
import ActingSubTabIdling from './acting/ActingSubTabIdling.vue'
import ActingSubTabPacingPlayground from './acting/ActingSubTabPacingPlayground.vue'
import ActingSubTabStickers from './acting/ActingSubTabStickers.vue'
import ActingSubTabThinking from './acting/ActingSubTabThinking.vue'
import ActingSubTabVoice from './acting/ActingSubTabVoice.vue'

import { useActingCapabilities } from '../../composables/useActingCapabilities'

interface Props {
  actingModelEmotionOptions?: string[]
  actingModelMotionOptions?: string[]
  actingGroupedExpressionTags?: { category: string, tags: { tag: string, description?: string }[] }[]
  actingMannerismOptions?: NonNullable<SpeechCapabilitiesInfo['mannerisms']>
  actingSpeechCapabilitiesLoading?: boolean
  selectedSpeechProviderLabel?: string
  isLive2d?: boolean
  insertModelEmotion?: (name: string) => void
  insertModelMotion?: (name: string) => void
  insertModelVfx?: (name: string) => void
  insertSpeechTag?: (tag: string, description?: string) => void
  insertSpeechMannerism?: (id: string) => void
  actingIdleAnimationOptions?: { label: string, value: string }[]
  selectedDisplayModelId?: string
  selectedSpeechProvider?: string
  selectedSpeechModel?: string
  selectedSpeechVoiceId?: string
  cardId?: string
}

const props = defineProps<Props>()

const emit = defineEmits<{
  (e: 'sparkle-click', fieldId: string): void
}>()

const capabilities = useActingCapabilities({
  selectedDisplayModelId: () => props.selectedDisplayModelId,
  selectedSpeechProvider: () => props.selectedSpeechProvider,
})

const actingModelEmotionOptions = computed(() => props.actingModelEmotionOptions ?? capabilities.actingModelEmotionOptions.value)
const actingModelMotionOptions = computed(() => props.actingModelMotionOptions ?? capabilities.actingModelMotionOptions.value)
const actingIdleAnimationOptions = computed(() => props.actingIdleAnimationOptions ?? capabilities.actingIdleAnimationOptions.value)
const actingGroupedExpressionTags = computed(() => props.actingGroupedExpressionTags ?? capabilities.actingGroupedExpressionTags.value)
const actingMannerismOptions = computed(() => props.actingMannerismOptions ?? capabilities.actingMannerismOptions.value)
const actingSpeechCapabilitiesLoading = computed(() => props.actingSpeechCapabilitiesLoading ?? capabilities.actingSpeechCapabilitiesLoading.value)
const isLive2d = computed(() => props.isLive2d ?? capabilities.isLive2d.value)
const selectedSpeechProviderLabel = computed(() => props.selectedSpeechProviderLabel || props.selectedSpeechProvider || capabilities.defaultSpeechModel.value || 'none')

function insertModelEmotion(name: string) {
  if (props.insertModelEmotion) {
    props.insertModelEmotion(name)
  }
  else {
    capabilities.insertModelEmotion(selectedActingModelExpressionPrompt, name)
  }
}

function insertModelMotion(name: string) {
  if (props.insertModelMotion) {
    props.insertModelMotion(name)
  }
  else {
    capabilities.insertModelMotion(selectedActingModelExpressionPrompt, name)
  }
}

function insertSpeechTag(tag: string, description?: string) {
  if (props.insertSpeechTag) {
    props.insertSpeechTag(tag, description)
  }
  else {
    capabilities.insertSpeechTag(selectedActingSpeechExpressionPrompt, tag, description)
  }
}

function insertSpeechMannerism(id: string) {
  if (props.insertSpeechMannerism) {
    props.insertSpeechMannerism(id)
  }
  else {
    capabilities.insertSpeechMannerism(selectedActingSpeechMannerismPrompt, id)
  }
}

watch(() => props.selectedSpeechProvider, (newProvider) => {
  if (newProvider) {
    void capabilities.loadActingSpeechCapabilities(newProvider)
  }
}, { immediate: true })

// Existing Acting Models
const selectedActingModelExpressionPrompt = defineModel<string>('selectedActingModelExpressionPrompt', { required: true })
const selectedActingSpeechExpressionPrompt = defineModel<string>('selectedActingSpeechExpressionPrompt', { required: true })
const selectedActingSpeechMannerismPrompt = defineModel<string>('selectedActingSpeechMannerismPrompt', { required: true })
const selectedActingIdleAnimations = defineModel<string[]>('selectedActingIdleAnimations', { required: true })

// Autonomous Cues (System-1 Interceptor) & Allowlist Models
const selectedActingCueAllowlist = defineModel<CharacterCueAllowlist | undefined>('selectedActingCueAllowlist')
const autoCuesEnabled = defineModel<boolean>('autoCuesEnabled', { default: false })
const autoCueExpressions = defineModel<boolean>('autoCueExpressions', { default: true })
const autoCueMotions = defineModel<boolean>('autoCueMotions', { default: false })

// Conversational Pacing Models
const pacingEnabled = defineModel<boolean>('pacingEnabled', { default: false })
const pacingArmMinMs = defineModel<number>('pacingArmMinMs', { default: 1200 })
const pacingArmMaxMs = defineModel<number>('pacingArmMaxMs', { default: 3500 })
const pacingMaxFillerDurationMs = defineModel<number>('pacingMaxFillerDurationMs', { default: 3000 })
const pacingCategoryThreshold = defineModel<number>('pacingCategoryThreshold', { default: 1 })
const pacingMaxFillersPerTurn = defineModel<number>('pacingMaxFillersPerTurn', { default: 3 })
const pacingIntervalMs = defineModel<number>('pacingIntervalMs', { default: 15000 })
const pacingFillers = defineModel<ThinkingFillerPhrase[]>('pacingFillers', {
  default: () => [...DEFAULT_PACING_FILLERS],
})

// Phase 6 Dynamic Pacing Models
const pacingDynamicAsidesEnabled = defineModel<boolean>('pacingDynamicAsidesEnabled', { default: false })
const pacingSemanticExtractorEnabled = defineModel<boolean>('pacingSemanticExtractorEnabled', { default: false })
const pacingDynamicAfterMs = defineModel<number>('pacingDynamicAfterMs', { default: 15000 })
const pacingCandidateTtlMs = defineModel<number>('pacingCandidateTtlMs', { default: 15000 })
const pacingMaxFillerSynthesisBudgetMs = defineModel<number>('pacingMaxFillerSynthesisBudgetMs', { default: 3200 })
const pacingMaxSynthesisBudgetMs = defineModel<number>('pacingMaxSynthesisBudgetMs', { default: 3200 })
const pacingProfile = defineModel<string>('pacingProfile', { default: 'balanced' })
const pacingExperimentalOrganicPivots = defineModel<boolean>('pacingExperimentalOrganicPivots', { default: false })

// Sub-Tab Navigation (6 Hubs with separate Idling segment)
type ActingSubTabId = 'expressions' | 'idling' | 'speech' | 'pacing' | 'stickers' | 'playground'
const activeSubTab = ref<ActingSubTabId>('expressions')

const subTabs = [
  { id: 'expressions' as const, label: 'Cues', icon: 'i-solar:smile-circle-bold-duotone', desc: 'Avatar gestures, ACT directives, autonomous cues' },
  { id: 'idling' as const, label: 'Idling', icon: 'i-solar:running-bold-duotone', desc: 'Continuous idle loops, cycle motions & avatar customizer' },
  { id: 'speech' as const, label: 'Voice', icon: 'i-solar:soundwave-bold-duotone', desc: 'Voice acting, audio tags, vocal mannerisms & caption FX' },
  { id: 'pacing' as const, label: 'Thinking', icon: 'i-solar:hourglass-bold-duotone', desc: 'Thinking fillers, live spoken asides & deliberation cadence' },
  { id: 'stickers' as const, label: 'Stickers', icon: 'i-solar:sticker-smile-circle-bold-duotone', desc: 'Chibi reaction stickers & desktop stage slappers' },
  { id: 'playground' as const, label: 'Lab', icon: 'i-solar:test-tube-minimalistic-bold-duotone', desc: 'Interactive reasoning, latency & audio audition sandbox' },
]

function applyPacingProfile(profileId: 'snappy' | 'balanced' | 'deep_cot') {
  const profile = PACING_PROFILES[profileId]
  if (!profile)
    return
  pacingProfile.value = profileId
  const s = profile.settings
  pacingArmMinMs.value = s.armMinMs
  pacingArmMaxMs.value = s.armMaxMs
  pacingMaxFillerDurationMs.value = s.maxFillerDurationMs
  pacingIntervalMs.value = s.pacingIntervalMs
  pacingMaxFillersPerTurn.value = s.maxFillersPerTurn
  pacingMaxSynthesisBudgetMs.value = s.maxSynthesisBudgetMs
  pacingMaxFillerSynthesisBudgetMs.value = s.maxFillerSynthesisBudgetMs
  pacingDynamicAsidesEnabled.value = s.dynamicAsidesEnabled
  pacingSemanticExtractorEnabled.value = s.semanticExtractorEnabled
  pacingDynamicAfterMs.value = s.dynamicAfterMs
  pacingCandidateTtlMs.value = s.candidateTtlMs
}
</script>

<template>
  <div class="tab-content ml-auto mr-auto w-95%">
    <!-- Header Summary -->
    <div class="mb-4">
      <h3 class="text-sm text-neutral-800 font-semibold dark:text-neutral-100">
        Acting & Behavioral Performance
      </h3>
      <p class="text-xs text-neutral-500 dark:text-neutral-400">
        Configure avatar cues, idle motions, voice mannerisms, thinking pauses, and interactive performance simulation.
      </p>
    </div>

    <!-- Sub-Navigation Segmented Pill Bar -->
    <div class="mb-5 flex flex-wrap items-center gap-1.5 border border-neutral-200 rounded-xl bg-neutral-100/70 p-1.5 dark:border-neutral-800 dark:bg-neutral-900/60">
      <button
        v-for="tab in subTabs"
        :key="tab.id"
        type="button"
        :class="[
          'flex items-center gap-2 rounded-lg px-3 py-2 text-xs font-medium transition-all duration-150',
          activeSubTab === tab.id
            ? 'bg-white dark:bg-neutral-800 text-primary-600 dark:text-primary-400 shadow-sm border border-neutral-200/80 dark:border-neutral-700'
            : 'text-neutral-600 dark:text-neutral-400 hover:text-neutral-900 dark:hover:text-neutral-200 hover:bg-neutral-200/50 dark:hover:bg-neutral-800/50',
        ]"
        @click="activeSubTab = tab.id"
      >
        <span :class="[tab.icon, 'text-base']" />
        <span class="font-medium">{{ tab.label }}</span>
      </button>
    </div>

    <!-- Sub-Tab Panels Container -->
    <div class="border border-neutral-200/80 rounded-xl bg-white/70 p-5 shadow-sm dark:border-neutral-800 dark:bg-neutral-900/40">
      <!-- 0. CUES SUB-TAB -->
      <ActingSubTabCues
        v-if="activeSubTab === 'expressions'"
        v-model:selected-acting-model-expression-prompt="selectedActingModelExpressionPrompt"
        v-model:selected-acting-cue-allowlist="selectedActingCueAllowlist"
        v-model:auto-cues-enabled="autoCuesEnabled"
        v-model:auto-cue-expressions="autoCueExpressions"
        v-model:auto-cue-motions="autoCueMotions"
        :acting-model-emotion-options="actingModelEmotionOptions"
        :acting-model-motion-options="actingModelMotionOptions"
        :selected-display-model-id="props.selectedDisplayModelId || capabilities.activeModelId.value"
        :is-live2d="isLive2d"
        :insert-model-emotion="insertModelEmotion"
        :insert-model-motion="insertModelMotion"
        :insert-model-vfx="props.insertModelVfx"
        @sparkle-click="(fieldId) => emit('sparkle-click', fieldId)"
      />

      <!-- 1. IDLING SUB-TAB -->
      <ActingSubTabIdling
        v-else-if="activeSubTab === 'idling'"
        v-model:selected-acting-idle-animations="selectedActingIdleAnimations"
        :acting-idle-animation-options="actingIdleAnimationOptions"
        :selected-display-model-id="props.selectedDisplayModelId || capabilities.activeModelId.value"
      />

      <!-- 2. VOICE SUB-TAB -->
      <ActingSubTabVoice
        v-else-if="activeSubTab === 'speech'"
        v-model:selected-acting-speech-expression-prompt="selectedActingSpeechExpressionPrompt"
        :selected-speech-provider-label="selectedSpeechProviderLabel"
        :acting-speech-capabilities-loading="actingSpeechCapabilitiesLoading"
        :acting-grouped-expression-tags="actingGroupedExpressionTags"
        :acting-mannerism-options="actingMannerismOptions"
        :insert-speech-tag="insertSpeechTag"
        :insert-speech-mannerism="insertSpeechMannerism"
        @sparkle-click="(fieldId) => emit('sparkle-click', fieldId)"
      />

      <!-- 3. THINKING SUB-TAB -->
      <ActingSubTabThinking
        v-else-if="activeSubTab === 'pacing'"
        v-model:selected-acting-speech-mannerism-prompt="selectedActingSpeechMannerismPrompt"
        v-model:pacing-enabled="pacingEnabled"
        v-model:pacing-arm-min-ms="pacingArmMinMs"
        v-model:pacing-arm-max-ms="pacingArmMaxMs"
        v-model:pacing-max-filler-duration-ms="pacingMaxFillerDurationMs"
        v-model:pacing-category-threshold="pacingCategoryThreshold"
        v-model:pacing-max-fillers-per-turn="pacingMaxFillersPerTurn"
        v-model:pacing-interval-ms="pacingIntervalMs"
        v-model:pacing-fillers="pacingFillers"
        v-model:pacing-dynamic-asides-enabled="pacingDynamicAsidesEnabled"
        v-model:pacing-semantic-extractor-enabled="pacingSemanticExtractorEnabled"
        v-model:pacing-dynamic-after-ms="pacingDynamicAfterMs"
        v-model:pacing-candidate-ttl-ms="pacingCandidateTtlMs"
        v-model:pacing-max-filler-synthesis-budget-ms="pacingMaxFillerSynthesisBudgetMs"
        v-model:pacing-max-synthesis-budget-ms="pacingMaxSynthesisBudgetMs"
        v-model:pacing-profile="pacingProfile"
        v-model:pacing-experimental-organic-pivots="pacingExperimentalOrganicPivots"
        :selected-speech-provider="props.selectedSpeechProvider"
        :selected-speech-model="props.selectedSpeechModel"
        :selected-speech-voice-id="props.selectedSpeechVoiceId"
        :selected-speech-provider-label="selectedSpeechProviderLabel"
        :acting-mannerism-options="actingMannerismOptions"
        :insert-speech-mannerism="insertSpeechMannerism"
        @navigate-to-playground="activeSubTab = 'playground'"
        @sparkle-click="(fieldId) => emit('sparkle-click', fieldId)"
      />

      <!-- 4. STICKERS SUB-TAB -->
      <ActingSubTabStickers
        v-else-if="activeSubTab === 'stickers'"
        :card-id="props.cardId"
      />

      <!-- 5. LAB (PLAYGROUND) SUB-TAB -->
      <ActingSubTabPacingPlayground
        v-else-if="activeSubTab === 'playground'"
        :pacing-enabled="pacingEnabled"
        :selected-speech-provider="props.selectedSpeechProvider"
        :selected-speech-model="props.selectedSpeechModel"
        :selected-speech-voice-id="props.selectedSpeechVoiceId"
        @navigate-to-pacing="activeSubTab = 'pacing'"
        @apply-preset="applyPacingProfile"
      />
    </div>
  </div>
</template>
