<script setup lang="ts">
import type { EmotionStudioSyncPayload } from '@proj-airi/stage-ui/components/scenarios/acting/EmotionCalibrationStudio.vue'

import EmotionCalibrationStudio from '@proj-airi/stage-ui/components/scenarios/acting/EmotionCalibrationStudio.vue'

import { useDisplayModelsStore } from '@proj-airi/stage-ui/stores/display-models'
import { useAiriCardStore } from '@proj-airi/stage-ui/stores/modules/airi-card'
import { storeToRefs } from 'pinia'
import { computed, onMounted, ref } from 'vue'
import { useRoute } from 'vue-router'
import { toast } from 'vue-sonner'

// Standalone Emotion Calibration page.
// Hidden route (settingsEntry: false) — reach it via `#/settings/models/emotions`
// (or `?model=<displayModelId>` to target a specific model). The onboarding
// emotions step embeds the same studio component; fixes land once, benefit both.
const route = useRoute()
const cardStore = useAiriCardStore()
const displayModelsStore = useDisplayModelsStore()
const { activeCard, activeCardId } = storeToRefs(cardStore)

const queryModelId = computed(() => typeof route.query.model === 'string' ? route.query.model : '')
const cardModelId = computed(() => activeCard.value?.extensions?.airi?.active_state?.displayModelId
  ?? activeCard.value?.extensions?.airi?.modules?.displayModelId
  ?? '')

const resolvedModelId = ref('')
const initialMappings = ref<Record<string, string>>({})
const initialDirectives = ref('')
const isReady = ref(false)

onMounted(async () => {
  await resolveModel(queryModelId.value || cardModelId.value || 'preset-live2d-2')
})

async function resolveModel(modelId: string) {
  isReady.value = false
  resolvedModelId.value = modelId
  initialMappings.value = {}
  initialDirectives.value = ''

  try {
    const model = await displayModelsStore.getDisplayModel(modelId)
    if (model?.emotionMappings) {
      initialMappings.value = JSON.parse(JSON.stringify(model.emotionMappings))
    }
  }
  catch (err) {
    console.warn('[EmotionsPage] Failed to load stored emotion mappings:', err)
  }

  const actingPrompt = (activeCard.value?.extensions as any)?.airi?.acting?.modelExpressionPrompt
  if (typeof actingPrompt === 'string' && actingPrompt.trim()) {
    initialDirectives.value = actingPrompt
  }

  isReady.value = true
}

function handleRequestModel(modelId: string) {
  void resolveModel(modelId)
}

async function handleStudioSync(payload: EmotionStudioSyncPayload) {
  const modelId = resolvedModelId.value
  if (!modelId) {
    return
  }

  // Persist canonical mappings onto the display model record
  try {
    await displayModelsStore.updateDisplayModelMappings(modelId, {
      emotionMappings: payload.expressionMappings,
    })
  }
  catch (err) {
    console.warn('[EmotionsPage] Display model mappings update warning:', err)
  }

  // Persist acting directives onto the active card — but only when viewing
  // the card's own model (demo-model detours must not rewrite the card prompt)
  if (modelId !== cardModelId.value) {
    return
  }
  if (activeCard.value && activeCardId.value) {
    try {
      const updatedCard = JSON.parse(JSON.stringify(activeCard.value))
      if (!updatedCard.extensions)
        updatedCard.extensions = {}
      if (!updatedCard.extensions.airi)
        updatedCard.extensions.airi = {}
      if (!updatedCard.extensions.airi.acting) {
        updatedCard.extensions.airi.acting = {
          modelExpressionPrompt: '',
          speechExpressionPrompt: '',
          speechMannerismPrompt: '',
        }
      }
      updatedCard.extensions.airi.acting.modelExpressionPrompt = payload.actingModelExpressionPrompt
      await cardStore.updateCard(activeCardId.value, updatedCard)
    }
    catch (err) {
      console.warn('[EmotionsPage] Card acting prompt update warning:', err)
      toast.error('Failed to save acting directives to card.')
    }
  }
}
</script>

<template>
  <div class="mx-auto max-w-5xl w-full flex flex-col gap-3.5 px-4 py-4">
    <div>
      <div class="mb-0.5 flex items-center gap-2 text-xs text-neutral-400">
        <span class="text-primary-500 font-medium dark:text-primary-400">Models</span>
        <span>• 2-Pass ACT Expression Bridge</span>
      </div>
      <h2 class="text-2xl text-neutral-900 font-bold tracking-tight dark:text-white">
        Emotions & The ACT Bridge
      </h2>
      <p class="mt-0.5 text-xs text-neutral-500 dark:text-neutral-400">
        Connect emotional cues from dialogue to avatar facial morphs and body motions.
      </p>
    </div>

    <EmotionCalibrationStudio
      v-if="isReady"
      :key="resolvedModelId"
      :model-id="resolvedModelId"
      :initial-mappings="initialMappings"
      :initial-directives="initialDirectives"
      :initial-calibrated="Object.keys(initialMappings).length > 0"
      :companion-name="activeCard?.name"
      :persona-personality="activeCard?.personality"
      :persona-description="activeCard?.description"
      stage-update-reason="settings-models-emotions"
      content-height-class="min-h-[540px]"
      allow-model-switch
      @sync="handleStudioSync"
      @request-model="handleRequestModel"
    />
  </div>
</template>

<route lang="yaml">
meta:
  layout: settings
  titleKey: settings.pages.models.emotions.title
  subtitleKey: settings.pages.models.title
  descriptionKey: settings.pages.models.emotions.description
  icon: i-solar:face-smile-bold-duotone
  settingsEntry: false
  order: 5
  stageTransition:
    name: slide
    pageSpecificAvailable: true
</route>
