import { defineStore } from 'pinia'
import { computed, ref } from 'vue'

export interface Nan0ReflexInfo {
  group: string
  label: string
  confidence: number
  cluster: 'conflict' | 'relational' | 'system'
  icon: string
}

export const NAN0_DEFAULT_EMOTIONS: Readonly<Record<string, number>> = {
  suspicion: 0.35,
  attachment: 0.8,
  pride: 0.65,
  smugness: 0.25,
  irritation: 0.15,
  rage: 0.05,
  curiosity: 0.55,
  amusement: 0.3,
  possessiveness: 0.4,
  warmth: 0.1,
  boredom: 0.2,
  fear: 0.15,
}

export const useNan0Store = defineStore('nan0-cognition', () => {
  // 12 Canonical Emotional Dimensions
  const emotions = ref<Record<string, number>>({ ...NAN0_DEFAULT_EMOTIONS })

  // Last Reflex Trigger
  const lastReflex = ref<Nan0ReflexInfo | null>({
    group: 'apology_repair',
    label: 'Apology & Repair',
    confidence: 0.98,
    cluster: 'conflict',
    icon: 'i-solar:hand-heart-bold-duotone',
  })

  // Executive Decision State
  const decision = ref<'SPEAK' | 'SILENCE' | 'WAIT'>('SPEAK')
  const decisionReason = ref<string>('Balanced Affect')

  // Inner Monologue
  const innerMonologue = ref<string>(
    'User expressed an apology. Suspicion reduced slightly, but pride demands maintaining a guarded posture.',
  )

  // 1st-Hop Execution State
  const isProcessing = ref<boolean>(false)

  // Computed Helpers
  const demandsSilence = computed(() => decision.value === 'SILENCE')
  const isPouting = computed(() => demandsSilence.value && (emotions.value.pride ?? 0) >= 0.7)

  function updateEmotion(dimension: string, value: number) {
    emotions.value[dimension] = Math.min(1, Math.max(0, value))
  }

  function setEmotions(newEmotions: Record<string, number>) {
    emotions.value = {
      ...emotions.value,
      ...newEmotions,
    }
  }

  function setReflex(reflex: Nan0ReflexInfo | null) {
    lastReflex.value = reflex
  }

  function setExecutiveState(newDecision: 'SPEAK' | 'SILENCE' | 'WAIT', reason = '') {
    decision.value = newDecision
    if (reason)
      decisionReason.value = reason
  }

  function setInnerMonologue(text: string) {
    innerMonologue.value = text
  }

  function setProcessing(processing: boolean) {
    isProcessing.value = processing
  }

  function resetToBaseline() {
    emotions.value = { ...NAN0_DEFAULT_EMOTIONS }
    decision.value = 'SPEAK'
    decisionReason.value = 'Baseline Reset'
  }

  return {
    emotions,
    lastReflex,
    decision,
    decisionReason,
    innerMonologue,
    isProcessing,
    demandsSilence,
    isPouting,
    updateEmotion,
    setEmotions,
    setReflex,
    setExecutiveState,
    setInnerMonologue,
    setProcessing,
    resetToBaseline,
  }
})
