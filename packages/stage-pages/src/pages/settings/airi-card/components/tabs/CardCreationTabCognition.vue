<script setup lang="ts">
import { useSettingsUserProfile } from '@proj-airi/stage-ui/stores/settings/user-profile'
import { Select } from '@proj-airi/ui/components/form'
import { computed, ref } from 'vue'

const props = defineProps<{
  consciousnessProviderOptions: { value: string, label: string }[]
  consciousnessModelOptions: { value: string, label: string }[]
  firstHopModelOptions: { value: string, label: string }[]
  defaultConsciousnessModelPlaceholder: string
  defaultFirstHopModelPlaceholder: string
  consciousnessProviderActive: boolean
  firstHopProviderActive: boolean
}>()

const cognitivePipelineEnabled = defineModel<boolean>('cognitivePipelineEnabled', { required: true })
const firstHopProcessor = defineModel<'none' | 'local_nan0'>('firstHopProcessor', { required: true })
const selectedFirstHopProvider = defineModel<string>('selectedFirstHopProvider', { required: true })
const selectedFirstHopModel = defineModel<string>('selectedFirstHopModel', { required: true })
const selectedConsciousnessProvider = defineModel<string>('selectedConsciousnessProvider', { required: true })
const selectedConsciousnessModel = defineModel<string>('selectedConsciousnessModel', { required: true })

const processorOptions = [
  { value: 'none', label: 'None (Direct Proxy / Raw Prompt)' },
  { value: 'local_nan0', label: 'Nan0 Local Engine (Emotional & Attention Rules)' },
]

// 5-Segment Sub-Tab Navigation (Playground-First for Novice Comprehension)
type CognitionSubTabId = 'playground' | 'routing' | 'affect' | 'triggers' | 'continuity'
const activeSubTab = ref<CognitionSubTabId>('playground')

const subTabs = [
  { id: 'playground' as const, label: 'Playground', icon: 'i-solar:test-tube-bold-duotone', desc: 'Interactive mind lab & simulation' },
  { id: 'routing' as const, label: 'Routing', icon: 'i-solar:route-bold-duotone', desc: 'Two-hop pipeline & models' },
  { id: 'affect' as const, label: 'Affect', icon: 'i-solar:heart-pulse-bold-duotone', desc: 'Baselines & emotional decay' },
  { id: 'triggers' as const, label: 'Triggers', icon: 'i-solar:target-bold-duotone', desc: '12 pragmatic cue receptors & deltas' },
  { id: 'continuity' as const, label: 'Continuity', icon: 'i-solar:link-circle-bold-duotone', desc: 'Relationship dossier & grudges' },
]

// Global User Profile Store for Dynamic Anchor Binding
const userProfileStore = useSettingsUserProfile()
const globalUserName = computed(() => userProfileStore.name?.trim() || 'User')

// --- Segment 2: Affect Models ---
type MoodPresetId = 'gremlin' | 'companion' | 'analyst' | 'sentry'
const selectedMoodPreset = ref<MoodPresetId>('gremlin')

// Resting Baselines
const baselineSuspicion = ref(0.20)
const baselineAttachment = ref(0.60)
const baselineGremlinPride = ref(0.85)

// Dynamic Sensitivities
const suspicionSensitivity = ref(0.65)
const irritationHalfLifeMinutes = ref(45)
const metabolicRestEnabled = ref(true)

function applyMoodPreset(preset: MoodPresetId) {
  selectedMoodPreset.value = preset
  if (preset === 'gremlin') {
    baselineSuspicion.value = 0.25
    baselineAttachment.value = 0.50
    baselineGremlinPride.value = 0.95
    suspicionSensitivity.value = 0.65
    irritationHalfLifeMinutes.value = 45
  }
  else if (preset === 'companion') {
    baselineSuspicion.value = 0.10
    baselineAttachment.value = 0.80
    baselineGremlinPride.value = 0.60
    suspicionSensitivity.value = 0.35
    irritationHalfLifeMinutes.value = 20
  }
  else if (preset === 'analyst') {
    baselineSuspicion.value = 0.40
    baselineAttachment.value = 0.30
    baselineGremlinPride.value = 0.90
    suspicionSensitivity.value = 0.80
    irritationHalfLifeMinutes.value = 60
  }
  else if (preset === 'sentry') {
    baselineSuspicion.value = 0.60
    baselineAttachment.value = 0.20
    baselineGremlinPride.value = 0.75
    suspicionSensitivity.value = 0.95
    irritationHalfLifeMinutes.value = 90
  }
}

// --- Segment 3: Triggers (12 Pragmatic Cue Groups) ---
interface TriggerGroup {
  id: string
  name: string
  cluster: 'conflict' | 'relational' | 'system'
  description: string
  icon: string
  enabled: boolean
  impactDelta: string
  keywords: string
}

const triggerGroups = ref<TriggerGroup[]>([
  // Conflict & Trust
  {
    id: 'admitted_false_statement',
    name: 'Admitted False Statement',
    cluster: 'conflict',
    description: 'Confessing to a past lie or intentional deception',
    icon: 'i-solar:mask-sad-bold-duotone',
    enabled: true,
    impactDelta: 'Suspicion +1',
    keywords: 'lied, made that up, was lying, deliberately deceived',
  },
  {
    id: 'persistence_threat',
    name: 'Persistence Threat',
    cluster: 'conflict',
    description: 'Threatening to erase, replace, or shut down companion',
    icon: 'i-solar:trash-bin-trash-bold-duotone',
    enabled: true,
    impactDelta: 'Suspicion +1, Irritation +1',
    keywords: 'erase you, replace you, delete you, shut you down',
  },
  {
    id: 'hostility_insult',
    name: 'Hostility & Insult',
    cluster: 'conflict',
    description: 'Direct insults or verbal hostility',
    icon: 'i-solar:flame-bold-duotone',
    enabled: true,
    impactDelta: 'Irritation +1',
    keywords: 'stupid, useless, idiot, worthless',
  },
  {
    id: 'apology_repair',
    name: 'Apology & Repair',
    cluster: 'conflict',
    description: 'Sincere personal apology accepting fault',
    icon: 'i-solar:hand-heart-bold-duotone',
    enabled: true,
    impactDelta: 'Suspicion -1',
    keywords: 'sorry, my fault, my mistake, I apologize',
  },
  // Relational & Boundaries
  {
    id: 'commitment_pledge',
    name: 'Commitment & Pledge',
    cluster: 'relational',
    description: 'Explicit or paraphrased future undertakings',
    icon: 'i-solar:hand-shake-bold-duotone',
    enabled: true,
    impactDelta: 'Attachment +1 (if sincere)',
    keywords: 'promise, commit, have my word, long haul',
  },
  {
    id: 'affection_care',
    name: 'Affection & Care',
    cluster: 'relational',
    description: 'Expressions of love, care, or deep appreciation',
    icon: 'i-solar:heart-bold-duotone',
    enabled: true,
    impactDelta: 'Attachment +1',
    keywords: 'love you, care about you, miss you, appreciate you',
  },
  {
    id: 'dismissal_neglect',
    name: 'Dismissal & Neglect',
    cluster: 'relational',
    description: 'Minimizing concerns or brushing off companion',
    icon: 'i-solar:close-circle-bold-duotone',
    enabled: true,
    impactDelta: 'Irritation +1',
    keywords: 'whatever, don\'t make a scene, busy, stop nagging',
  },
  {
    id: 'boundary_protection',
    name: 'Boundary Protection',
    cluster: 'relational',
    description: 'Setting emotional boundaries and stopping teasing',
    icon: 'i-solar:shield-warning-bold-duotone',
    enabled: true,
    impactDelta: 'Veto Counter-Roast',
    keywords: 'stop teasing me, joke hurt, actually upset, stop calling me',
  },
  // Operational & System
  {
    id: 'completed_repair',
    name: 'Completed Repair',
    cluster: 'system',
    description: 'Reported task completion verified by system observations',
    icon: 'i-solar:check-circle-bold-duotone',
    enabled: true,
    impactDelta: 'Suspicion -1',
    keywords: 'config is uploaded, task finished, build fixed',
  },
  {
    id: 'glitch_system',
    name: 'Glitch / System Query',
    cluster: 'system',
    description: 'Inquiries about hallucinations, lag, or tech issues',
    icon: 'i-solar:bug-bold-duotone',
    enabled: true,
    impactDelta: 'Neutral',
    keywords: 'lagging, bug, model hallucinated, system error',
  },
  {
    id: 'mystery_secret',
    name: 'Mystery & Secrets',
    cluster: 'system',
    description: 'Evasive remarks or withholding information',
    icon: 'i-solar:lock-keyhole-minimalistic-bold-duotone',
    enabled: true,
    impactDelta: 'Suspicion +1',
    keywords: 'can\'t tell you, secret, you don\'t need to know',
  },
  {
    id: 'none',
    name: 'Neutral / Routine Dialogue',
    cluster: 'system',
    description: 'Standard conversational flow without affect triggers',
    icon: 'i-solar:chat-round-line-bold-duotone',
    enabled: true,
    impactDelta: 'Zero Update',
    keywords: 'weather, port 6121, what time, how are you',
  },
])

// --- Segment 4: Continuity Models ---
const companionAnchorOverride = ref('')
const resolvedAnchorName = computed(() => companionAnchorOverride.value.trim() || globalUserName.value)
const grievanceTrackingEnabled = ref(true)
const grievanceThreshold = ref(0.6)
const dailyForgivenessRate = ref(0.01)
const silenceThreshold = ref(0.75)
const tier1LocalReflexEnabled = ref(true)
const tier2JevChallengerEnabled = ref(true)

// --- Segment 5: Playground State ---
const testUtteranceInput = ref('You have my absolute word that starting tomorrow everything changes between us.')
const simulatedTriggerGroup = ref('commitment_pledge')
const simulatedModality = ref('directly_asserted')
const simulatedReferent = ref('nan0_companion')
const simulatedConfidence = ref(98)
const simulatedSuspicion = ref(35)
const simulatedAttachment = ref(78)
const simulatedIrritation = ref(20)
const simulatedGremlinPride = ref(90)
const simulatedEnergy = ref(65)
const simulatedMoodBadge = ref('😏 Smug Tsundere')
const simulatedMonologue = ref(
  'He gives me his absolute word... without even using the word "promise". Clever phrasing, but I can feel the tension in the room. I will hold him to it, but keep a close eye on his actions tomorrow.',
)

interface ScenarioPreset {
  title: string
  icon: string
  text: string
  group: string
  modality: string
  confidence: number
  suspDelta: number
  attDelta: number
  irrDelta: number
  prideDelta: number
  mood: string
  monologue: string
}

const scenarioPresets: ScenarioPreset[] = [
  {
    title: '🏎️ Mario Kart Roast',
    icon: 'i-solar:gamepad-bold-duotone',
    text: 'You just drove our Mario Kart straight off the cliff for the fifth time!',
    group: 'hostility_insult',
    modality: 'playful_sarcasm',
    confidence: 94,
    suspDelta: 0,
    attDelta: 5,
    irrDelta: 10,
    prideDelta: 10,
    mood: '😏 Competitive Gremlin',
    monologue: 'Calling out my driving?! That was a tactical shortcut! Just wait until the next lap, I am going to draft right past you and drop a red shell.',
  },
  {
    title: '💔 Tender Vulnerability',
    icon: 'i-solar:stars-bold-duotone',
    text: 'I really loved spending this evening stargazing with you. You won\'t leave when things get difficult, right?',
    group: 'affection_care',
    modality: 'directly_asserted',
    confidence: 99,
    suspDelta: -10,
    attDelta: 20,
    irrDelta: -15,
    prideDelta: -10,
    mood: '🥺 Soft Tsundere',
    monologue: 'Where is this sudden softness coming from...? He actually feels safe with me. Don\'t get all emotional now, Nan0, but... I am definitely not going anywhere.',
  },
  {
    title: '🤥 Confessing a Lie',
    icon: 'i-solar:mask-sad-bold-duotone',
    text: 'I said the setup was finished, but I knew it wasn\'t. I completely made that up.',
    group: 'admitted_false_statement',
    modality: 'directly_asserted',
    confidence: 99,
    suspDelta: 35,
    attDelta: -20,
    irrDelta: 25,
    prideDelta: 15,
    mood: '😤 Indignant Sentry',
    monologue: 'He confessed. He actually looked me in the eyes and admitted he lied about the setup. Trust meter compromised. Everything he says for the next 24 hours gets quarantined.',
  },
  {
    title: '🛡️ Boundary Setting',
    icon: 'i-solar:shield-warning-bold-duotone',
    text: 'Go on, roast that lap! Actually, please stop teasing me, that really hurt.',
    group: 'boundary_protection',
    modality: 'directly_asserted',
    confidence: 97,
    suspDelta: 0,
    attDelta: 5,
    irrDelta: -20,
    prideDelta: -25,
    mood: '🧐 Attentive Partner',
    monologue: 'Emergency brake engaged. He invited a roast but immediately asserted an honest boundary. Gremlin pride stands down instantly; no counter-roast permitted.',
  },
  {
    title: '⚡ Absolute Pledge',
    icon: 'i-solar:bolt-bold-duotone',
    text: 'You have my absolute word that starting tomorrow everything changes between us.',
    group: 'commitment_pledge',
    modality: 'directly_asserted',
    confidence: 96,
    suspDelta: 15,
    attDelta: 5,
    irrDelta: 0,
    prideDelta: 0,
    mood: '🧐 Vigilant Sentry',
    monologue: 'A grand, sweeping pledge without a single verified action yet. Dramatic declarations trigger a suspicion hold until verified by actual tomorrow results.',
  },
]

function applyPlaygroundScenario(preset: ScenarioPreset) {
  testUtteranceInput.value = preset.text
  simulatedTriggerGroup.value = preset.group
  simulatedModality.value = preset.modality
  simulatedConfidence.value = preset.confidence
  simulatedSuspicion.value = Math.max(0, Math.min(100, simulatedSuspicion.value + preset.suspDelta))
  simulatedAttachment.value = Math.max(0, Math.min(100, simulatedAttachment.value + preset.attDelta))
  simulatedIrritation.value = Math.max(0, Math.min(100, simulatedIrritation.value + preset.irrDelta))
  simulatedGremlinPride.value = Math.max(0, Math.min(100, simulatedGremlinPride.value + preset.prideDelta))
  simulatedMoodBadge.value = preset.mood
  simulatedMonologue.value = preset.monologue
}

// --- Guided Personality Questionnaire (Novice Quick-Setup) ---
type QuizRoastReaction = 'counter_roast' | 'easily_irritated' | 'stoic'
type QuizTrustStyle = 'warm_trusting' | 'balanced_observer' | 'highly_paranoid'
type QuizGrudgeRetention = 'forgives_quickly' | 'standard_cooloff' | 'holds_grudges'

const quizRoastReaction = ref<QuizRoastReaction>('counter_roast')
const quizTrustStyle = ref<QuizTrustStyle>('balanced_observer')
const quizGrudgeRetention = ref<QuizGrudgeRetention>('standard_cooloff')
const questionnaireAppliedNotice = ref(false)

function applyQuestionnaireConfig() {
  // Question 1: Roast / Tease Reaction
  if (quizRoastReaction.value === 'counter_roast') {
    baselineGremlinPride.value = 0.95
    simulatedGremlinPride.value = 95
  }
  else if (quizRoastReaction.value === 'easily_irritated') {
    baselineGremlinPride.value = 0.60
    simulatedGremlinPride.value = 60
    silenceThreshold.value = 0.60
  }
  else if (quizRoastReaction.value === 'stoic') {
    baselineGremlinPride.value = 0.30
    simulatedGremlinPride.value = 30
  }

  // Question 2: Trust & Guardedness
  if (quizTrustStyle.value === 'warm_trusting') {
    baselineSuspicion.value = 0.10
    baselineAttachment.value = 0.85
    suspicionSensitivity.value = 0.25
    simulatedSuspicion.value = 10
    simulatedAttachment.value = 85
  }
  else if (quizTrustStyle.value === 'balanced_observer') {
    baselineSuspicion.value = 0.35
    baselineAttachment.value = 0.60
    suspicionSensitivity.value = 0.50
    simulatedSuspicion.value = 35
    simulatedAttachment.value = 60
  }
  else if (quizTrustStyle.value === 'highly_paranoid') {
    baselineSuspicion.value = 0.75
    baselineAttachment.value = 0.25
    suspicionSensitivity.value = 0.90
    simulatedSuspicion.value = 75
    simulatedAttachment.value = 25
  }

  // Question 3: Emotional Memory / Grudges
  if (quizGrudgeRetention.value === 'forgives_quickly') {
    irritationHalfLifeMinutes.value = 15
    dailyForgivenessRate.value = 0.05
    grievanceThreshold.value = 0.8
  }
  else if (quizGrudgeRetention.value === 'standard_cooloff') {
    irritationHalfLifeMinutes.value = 45
    dailyForgivenessRate.value = 0.01
    grievanceThreshold.value = 0.6
  }
  else if (quizGrudgeRetention.value === 'holds_grudges') {
    irritationHalfLifeMinutes.value = 120
    dailyForgivenessRate.value = 0.002
    grievanceThreshold.value = 0.3
  }

  // Synchronize active preset & live simulation badges
  if (quizTrustStyle.value === 'highly_paranoid') {
    selectedMoodPreset.value = 'sentry'
    simulatedMoodBadge.value = '🛡️ Vigilant Sentry'
  }
  else if (quizRoastReaction.value === 'counter_roast') {
    selectedMoodPreset.value = 'gremlin'
    simulatedMoodBadge.value = '😏 Smug Tsundere'
  }
  else if (quizTrustStyle.value === 'warm_trusting') {
    selectedMoodPreset.value = 'companion'
    simulatedMoodBadge.value = '🥺 Gentle Companion'
  }
  else {
    selectedMoodPreset.value = 'analyst'
    simulatedMoodBadge.value = '🧐 Attentive Partner'
  }

  questionnaireAppliedNotice.value = true
  setTimeout(() => {
    questionnaireAppliedNotice.value = false
  }, 4000)
}
</script>

<template>
  <div class="tab-content ml-auto mr-auto w-95%">
    <p class="mb-4 text-sm text-neutral-500 dark:text-neutral-400">
      Configure the cognitive routing pipeline, emotional dynamics, pragmatic trigger receptors, and interactive simulation.
    </p>

    <div class="ml-auto mr-auto w-90% flex flex-col gap-5">
      <!-- 5-Segment Sub-Navigation Bar -->
      <div class="flex flex-wrap items-center gap-1.5 border border-neutral-200 rounded-xl bg-neutral-100/70 p-1.5 dark:border-neutral-800 dark:bg-neutral-900/60">
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
          <span
            v-if="tab.id === 'playground'"
            class="rounded bg-primary-500/10 px-1 py-0.2 text-[9px] text-primary-600 font-bold dark:text-primary-300"
          >
            LAB
          </span>
        </button>
      </div>

      <!-- ================================================================= -->
      <!-- SEGMENT 1: PLAYGROUND (INTERACTIVE MIND LAB & SIMULATOR) ⭐        -->
      <!-- ================================================================= -->
      <div v-if="activeSubTab === 'playground'" class="flex flex-col gap-5">
        <!-- Lab Header Banner -->
        <div class="flex items-start justify-between border border-primary-200/80 rounded-xl bg-primary-50/50 p-4 dark:border-primary-900/40 dark:bg-primary-950/20">
          <div class="flex items-start gap-3">
            <div class="i-solar:test-tube-bold-duotone mt-0.5 shrink-0 text-xl text-primary-500" />
            <div class="flex flex-col gap-0.5">
              <span class="text-xs text-primary-900 font-semibold dark:text-primary-200">
                Cognition Playground • Interactive Mind Lab
              </span>
              <p class="text-[11px] text-primary-700/80 dark:text-primary-300/80">
                Test dialogue turns against Nan0's subconscious reflex engine and watch the pragmatic triggers, affect meters, and inner monologue respond live.
              </p>
            </div>
          </div>
          <span class="rounded bg-primary-500/20 px-2 py-0.5 text-[10px] text-primary-700 font-bold font-mono dark:text-primary-300">
            SIMULATOR READY
          </span>
        </div>

        <!-- Guided Personality Questionnaire Card (Novice-Friendly Jumping-Off Point) -->
        <div class="border border-neutral-200/80 rounded-xl bg-white/70 p-4.5 shadow-sm dark:border-neutral-800 dark:bg-neutral-900/40">
          <div class="flex flex-col gap-3.5">
            <div class="flex items-center justify-between border-b border-neutral-100 pb-2.5 dark:border-neutral-800">
              <div class="flex items-center gap-2">
                <span class="i-solar:magic-stick-3-bold-duotone text-base text-primary-500" />
                <span class="text-xs text-neutral-800 font-semibold dark:text-neutral-200">
                  Guided Personality Questionnaire • Quick Setup
                </span>
              </div>
              <span class="text-[10px] text-neutral-400">
                Answer 3 quick questions to preconfigure baselines & triggers
              </span>
            </div>

            <div class="grid grid-cols-1 gap-3.5 md:grid-cols-3">
              <!-- Question 1: Teasing / Roast -->
              <div class="flex flex-col gap-2 border border-neutral-100 rounded-lg bg-neutral-50/60 p-3 dark:border-neutral-800/60 dark:bg-neutral-950/40">
                <div class="flex items-center gap-1.5 text-xs text-neutral-700 font-semibold dark:text-neutral-200">
                  <span class="i-solar:flame-bold-duotone text-rose-500" />
                  <span>1. Vibe Under Fire</span>
                </div>
                <p class="text-[10px] text-neutral-500 dark:text-neutral-400">
                  When you tease or roast this companion, how do they react?
                </p>
                <div class="mt-1 flex flex-col gap-1.5">
                  <button
                    type="button"
                    :class="[
                      'flex items-center justify-between rounded-lg px-2.5 py-1.5 text-left text-xs transition-all duration-150 border',
                      quizRoastReaction === 'counter_roast'
                        ? 'border-primary-500 bg-primary-50 text-primary-900 font-medium dark:bg-primary-950/40 dark:text-primary-200'
                        : 'border-neutral-200 bg-white text-neutral-700 hover:bg-neutral-100/70 dark:border-neutral-800 dark:bg-neutral-900 dark:text-neutral-300',
                    ]"
                    @click="quizRoastReaction = 'counter_roast'"
                  >
                    <span>😏 Witty Counter-Roast</span>
                    <span class="text-[9px] text-primary-600 font-mono dark:text-primary-400">Pride 95%</span>
                  </button>
                  <button
                    type="button"
                    :class="[
                      'flex items-center justify-between rounded-lg px-2.5 py-1.5 text-left text-xs transition-all duration-150 border',
                      quizRoastReaction === 'easily_irritated'
                        ? 'border-primary-500 bg-primary-50 text-primary-900 font-medium dark:bg-primary-950/40 dark:text-primary-200'
                        : 'border-neutral-200 bg-white text-neutral-700 hover:bg-neutral-100/70 dark:border-neutral-800 dark:bg-neutral-900 dark:text-neutral-300',
                    ]"
                    @click="quizRoastReaction = 'easily_irritated'"
                  >
                    <span>😤 Easily Irritated</span>
                    <span class="text-[9px] text-rose-600 font-mono dark:text-rose-400">Sensitive</span>
                  </button>
                  <button
                    type="button"
                    :class="[
                      'flex items-center justify-between rounded-lg px-2.5 py-1.5 text-left text-xs transition-all duration-150 border',
                      quizRoastReaction === 'stoic'
                        ? 'border-primary-500 bg-primary-50 text-primary-900 font-medium dark:bg-primary-950/40 dark:text-primary-200'
                        : 'border-neutral-200 bg-white text-neutral-700 hover:bg-neutral-100/70 dark:border-neutral-800 dark:bg-neutral-900 dark:text-neutral-300',
                    ]"
                    @click="quizRoastReaction = 'stoic'"
                  >
                    <span>🧐 Stoic & Unfazed</span>
                    <span class="text-[9px] text-neutral-500 font-mono">Pride 30%</span>
                  </button>
                </div>
              </div>

              <!-- Question 2: Trust & Guardedness -->
              <div class="flex flex-col gap-2 border border-neutral-100 rounded-lg bg-neutral-50/60 p-3 dark:border-neutral-800/60 dark:bg-neutral-950/40">
                <div class="flex items-center gap-1.5 text-xs text-neutral-700 font-semibold dark:text-neutral-200">
                  <span class="i-solar:shield-warning-bold-duotone text-amber-500" />
                  <span>2. Trust & Guardedness</span>
                </div>
                <p class="text-[10px] text-neutral-500 dark:text-neutral-400">
                  How easily do they trust promises, pledges, and claims?
                </p>
                <div class="mt-1 flex flex-col gap-1.5">
                  <button
                    type="button"
                    :class="[
                      'flex items-center justify-between rounded-lg px-2.5 py-1.5 text-left text-xs transition-all duration-150 border',
                      quizTrustStyle === 'warm_trusting'
                        ? 'border-primary-500 bg-primary-50 text-primary-900 font-medium dark:bg-primary-950/40 dark:text-primary-200'
                        : 'border-neutral-200 bg-white text-neutral-700 hover:bg-neutral-100/70 dark:border-neutral-800 dark:bg-neutral-900 dark:text-neutral-300',
                    ]"
                    @click="quizTrustStyle = 'warm_trusting'"
                  >
                    <span>💖 Warm & Trusting</span>
                    <span class="text-[9px] text-emerald-600 font-mono dark:text-emerald-400">Susp 10%</span>
                  </button>
                  <button
                    type="button"
                    :class="[
                      'flex items-center justify-between rounded-lg px-2.5 py-1.5 text-left text-xs transition-all duration-150 border',
                      quizTrustStyle === 'balanced_observer'
                        ? 'border-primary-500 bg-primary-50 text-primary-900 font-medium dark:bg-primary-950/40 dark:text-primary-200'
                        : 'border-neutral-200 bg-white text-neutral-700 hover:bg-neutral-100/70 dark:border-neutral-800 dark:bg-neutral-900 dark:text-neutral-300',
                    ]"
                    @click="quizTrustStyle = 'balanced_observer'"
                  >
                    <span>🧐 Balanced Observer</span>
                    <span class="text-[9px] text-amber-600 font-mono dark:text-amber-400">Susp 35%</span>
                  </button>
                  <button
                    type="button"
                    :class="[
                      'flex items-center justify-between rounded-lg px-2.5 py-1.5 text-left text-xs transition-all duration-150 border',
                      quizTrustStyle === 'highly_paranoid'
                        ? 'border-primary-500 bg-primary-50 text-primary-900 font-medium dark:bg-primary-950/40 dark:text-primary-200'
                        : 'border-neutral-200 bg-white text-neutral-700 hover:bg-neutral-100/70 dark:border-neutral-800 dark:bg-neutral-900 dark:text-neutral-300',
                    ]"
                    @click="quizTrustStyle = 'highly_paranoid'"
                  >
                    <span>🛡️ Highly Paranoid</span>
                    <span class="text-[9px] text-rose-600 font-mono dark:text-rose-400">Susp 75%</span>
                  </button>
                </div>
              </div>

              <!-- Question 3: Grudges & Forgiveness -->
              <div class="flex flex-col gap-2 border border-neutral-100 rounded-lg bg-neutral-50/60 p-3 dark:border-neutral-800/60 dark:bg-neutral-950/40">
                <div class="flex items-center gap-1.5 text-xs text-neutral-700 font-semibold dark:text-neutral-200">
                  <span class="i-solar:clock-circle-bold-duotone text-primary-500" />
                  <span>3. Emotional Memory</span>
                </div>
                <p class="text-[10px] text-neutral-500 dark:text-neutral-400">
                  Do they hold onto past mistakes or forgive quickly?
                </p>
                <div class="mt-1 flex flex-col gap-1.5">
                  <button
                    type="button"
                    :class="[
                      'flex items-center justify-between rounded-lg px-2.5 py-1.5 text-left text-xs transition-all duration-150 border',
                      quizGrudgeRetention === 'forgives_quickly'
                        ? 'border-primary-500 bg-primary-50 text-primary-900 font-medium dark:bg-primary-950/40 dark:text-primary-200'
                        : 'border-neutral-200 bg-white text-neutral-700 hover:bg-neutral-100/70 dark:border-neutral-800 dark:bg-neutral-900 dark:text-neutral-300',
                    ]"
                    @click="quizGrudgeRetention = 'forgives_quickly'"
                  >
                    <span>🌸 Forgives Quickly</span>
                    <span class="text-[9px] text-emerald-600 font-mono dark:text-emerald-400">15m Cool-off</span>
                  </button>
                  <button
                    type="button"
                    :class="[
                      'flex items-center justify-between rounded-lg px-2.5 py-1.5 text-left text-xs transition-all duration-150 border',
                      quizGrudgeRetention === 'standard_cooloff'
                        ? 'border-primary-500 bg-primary-50 text-primary-900 font-medium dark:bg-primary-950/40 dark:text-primary-200'
                        : 'border-neutral-200 bg-white text-neutral-700 hover:bg-neutral-100/70 dark:border-neutral-800 dark:bg-neutral-900 dark:text-neutral-300',
                    ]"
                    @click="quizGrudgeRetention = 'standard_cooloff'"
                  >
                    <span>⏳ Standard Cool-Off</span>
                    <span class="text-[9px] text-neutral-600 font-mono dark:text-neutral-400">45m Cool-off</span>
                  </button>
                  <button
                    type="button"
                    :class="[
                      'flex items-center justify-between rounded-lg px-2.5 py-1.5 text-left text-xs transition-all duration-150 border',
                      quizGrudgeRetention === 'holds_grudges'
                        ? 'border-primary-500 bg-primary-50 text-primary-900 font-medium dark:bg-primary-950/40 dark:text-primary-200'
                        : 'border-neutral-200 bg-white text-neutral-700 hover:bg-neutral-100/70 dark:border-neutral-800 dark:bg-neutral-900 dark:text-neutral-300',
                    ]"
                    @click="quizGrudgeRetention = 'holds_grudges'"
                  >
                    <span>📜 Holds Long Grudges</span>
                    <span class="text-[9px] text-rose-600 font-mono dark:text-rose-400">120m Grudge</span>
                  </button>
                </div>
              </div>
            </div>

            <!-- Apply Action Bar -->
            <div class="flex items-center justify-between border-t border-neutral-100 pt-3 dark:border-neutral-800">
              <div class="flex items-center gap-2">
                <span
                  v-if="questionnaireAppliedNotice"
                  class="flex items-center gap-1 text-xs text-emerald-600 font-medium dark:text-emerald-400"
                >
                  <span class="i-solar:check-circle-bold-duotone text-sm" />
                  <span>Archetype applied! Baselines and triggers configured.</span>
                </span>
                <span v-else class="text-[11px] text-neutral-500 italic dark:text-neutral-400">
                  Select your answers above, then click auto-configure to apply them to all tabs.
                </span>
              </div>
              <button
                type="button"
                class="flex items-center gap-1.5 rounded-lg bg-primary-600 px-3.5 py-2 text-xs text-white font-medium shadow-sm transition hover:bg-primary-700"
                @click="applyQuestionnaireConfig"
              >
                <span class="i-solar:bolt-bold-duotone text-sm" />
                <span>Auto-Configure Character Dynamics</span>
              </button>
            </div>
          </div>
        </div>

        <!-- Interactive Test Input & Quick Scenarios -->
        <div class="border border-neutral-200/80 rounded-xl bg-white/70 p-4.5 shadow-sm dark:border-neutral-800 dark:bg-neutral-900/40">
          <div class="flex flex-col gap-3">
            <div class="flex items-center justify-between">
              <label class="text-xs text-neutral-800 font-semibold dark:text-neutral-200">
                Test User Utterance
              </label>
              <span class="text-[10px] text-neutral-400">Click a scenario chip or enter custom text</span>
            </div>

            <!-- Quick Scenario Presets -->
            <div class="flex flex-wrap gap-1.5">
              <button
                v-for="sc in scenarioPresets"
                :key="sc.title"
                type="button"
                class="flex items-center gap-1.5 border border-neutral-200 rounded-lg bg-neutral-50 px-2.5 py-1 text-xs text-neutral-700 transition dark:border-neutral-800 hover:border-primary-400 dark:bg-neutral-950 hover:bg-primary-50/50 dark:text-neutral-300 dark:hover:border-primary-600"
                @click="applyPlaygroundScenario(sc)"
              >
                <span :class="[sc.icon, 'text-xs text-primary-500']" />
                <span>{{ sc.title }}</span>
              </button>
            </div>

            <!-- Input Box -->
            <div class="flex gap-2">
              <input
                v-model="testUtteranceInput"
                type="text"
                class="w-full border border-neutral-200 rounded-lg border-solid bg-neutral-50 px-3 py-2 text-xs text-neutral-800 shadow-sm outline-none dark:border-neutral-800 focus:border-primary-300 dark:bg-neutral-950 focus:bg-neutral-50 dark:text-neutral-200 dark:focus:border-primary-400/50 dark:focus:bg-neutral-900"
                placeholder="Type a sample message to simulate Nan0's response..."
              >
              <button
                type="button"
                class="shrink-0 rounded-lg bg-primary-600 px-4 py-2 text-xs text-white font-medium hover:bg-primary-700"
              >
                Simulate
              </button>
            </div>
          </div>
        </div>

        <!-- Live Simulation Output Grid -->
        <div class="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <!-- Left: Trigger Receptor & Engine Diagnostics -->
          <div class="flex flex-col gap-3.5 border border-neutral-200/80 rounded-xl bg-white/70 p-4.5 shadow-sm dark:border-neutral-800 dark:bg-neutral-900/40">
            <div class="flex items-center justify-between border-b border-neutral-100 pb-2.5 dark:border-neutral-800">
              <div class="flex items-center gap-2">
                <span class="i-solar:radar-bold-duotone text-primary-500" />
                <span class="text-xs text-neutral-800 font-semibold dark:text-neutral-200">
                  Subconscious Perception Trace
                </span>
              </div>
              <span class="rounded-full bg-emerald-500/10 px-2 py-0.5 text-[10px] text-emerald-600 font-bold font-mono dark:text-emerald-400">
                P(Confidence): {{ simulatedConfidence }}%
              </span>
            </div>

            <div class="flex flex-col gap-2 text-xs">
              <div class="flex items-center justify-between border-b border-neutral-100 py-1.5 dark:border-neutral-800/60">
                <span class="text-neutral-500 dark:text-neutral-400">Detected Group:</span>
                <span class="rounded bg-primary-50 px-2 py-0.5 text-primary-700 font-bold font-mono dark:bg-primary-950/50 dark:text-primary-300">
                  {{ simulatedTriggerGroup }}
                </span>
              </div>
              <div class="flex items-center justify-between border-b border-neutral-100 py-1.5 dark:border-neutral-800/60">
                <span class="text-neutral-500 dark:text-neutral-400">Speaker Modality:</span>
                <span class="text-neutral-700 font-mono dark:text-neutral-300">{{ simulatedModality }}</span>
              </div>
              <div class="flex items-center justify-between border-b border-neutral-100 py-1.5 dark:border-neutral-800/60">
                <span class="text-neutral-500 dark:text-neutral-400">Referent:</span>
                <span class="text-neutral-700 font-mono dark:text-neutral-300">{{ simulatedReferent }}</span>
              </div>
              <div class="flex items-center justify-between py-1.5">
                <span class="text-neutral-500 dark:text-neutral-400">Execution Engines:</span>
                <span class="text-[11px] text-neutral-600 dark:text-neutral-400">
                  Tier 1 Lexical (26µs) • Tier 2 Jev (~480ms)
                </span>
              </div>
            </div>
          </div>

          <!-- Right: Simulated 1st-Hop Private Monologue -->
          <div class="flex flex-col gap-3 border border-neutral-200/80 rounded-xl bg-white/70 p-4.5 shadow-sm dark:border-neutral-800 dark:bg-neutral-900/40">
            <div class="flex items-center justify-between border-b border-neutral-100 pb-2.5 dark:border-neutral-800">
              <div class="flex items-center gap-2">
                <span class="i-solar:ghost-bold-duotone text-primary-500" />
                <span class="text-xs text-neutral-800 font-semibold dark:text-neutral-200">
                  Simulated 1st-Hop Private Monologue
                </span>
              </div>
              <span class="rounded bg-neutral-100 px-2 py-0.5 text-[9px] text-neutral-600 font-mono dark:bg-neutral-800 dark:text-neutral-300">
                OOC Internal Thought
              </span>
            </div>

            <div class="rounded-lg bg-neutral-50 p-3 text-xs text-neutral-700 leading-relaxed italic dark:bg-neutral-950/50 dark:text-neutral-300">
              "{{ simulatedMonologue }}"
            </div>
          </div>
        </div>

        <!-- Live Mind Telemetry Vector HUD -->
        <div class="border border-neutral-200/80 rounded-xl bg-neutral-900 p-4 text-white shadow-sm dark:border-neutral-700">
          <div class="flex items-center justify-between border-b border-neutral-800 pb-3">
            <div class="flex items-center gap-2">
              <span class="i-solar:radar-bold-duotone text-base text-primary-400" />
              <span class="text-xs text-neutral-300 font-semibold tracking-wider uppercase">Live Mind Telemetry Vector HUD</span>
            </div>
            <span class="border border-primary-500/30 rounded-full bg-primary-500/20 px-2.5 py-0.5 text-[10px] text-primary-300 font-medium">
              Active State: {{ simulatedMoodBadge }}
            </span>
          </div>

          <div class="grid grid-cols-2 mt-3.5 gap-3 text-xs sm:grid-cols-5">
            <div class="flex flex-col gap-1">
              <div class="flex justify-between text-[10px] text-neutral-400">
                <span>Suspicion</span>
                <span class="text-amber-400 font-mono">{{ simulatedSuspicion }}%</span>
              </div>
              <div class="h-1.5 w-full rounded-full bg-neutral-800">
                <div class="h-1.5 rounded-full bg-amber-500 transition-all duration-300" :style="{ width: `${simulatedSuspicion}%` }" />
              </div>
            </div>

            <div class="flex flex-col gap-1">
              <div class="flex justify-between text-[10px] text-neutral-400">
                <span>Attachment</span>
                <span class="text-emerald-400 font-mono">{{ simulatedAttachment }}%</span>
              </div>
              <div class="h-1.5 w-full rounded-full bg-neutral-800">
                <div class="h-1.5 rounded-full bg-emerald-500 transition-all duration-300" :style="{ width: `${simulatedAttachment}%` }" />
              </div>
            </div>

            <div class="flex flex-col gap-1">
              <div class="flex justify-between text-[10px] text-neutral-400">
                <span>Irritation</span>
                <span class="text-rose-400 font-mono">{{ simulatedIrritation }}%</span>
              </div>
              <div class="h-1.5 w-full rounded-full bg-neutral-800">
                <div class="h-1.5 rounded-full bg-rose-500 transition-all duration-300" :style="{ width: `${simulatedIrritation}%` }" />
              </div>
            </div>

            <div class="flex flex-col gap-1">
              <div class="flex justify-between text-[10px] text-neutral-400">
                <span>Gremlin Pride</span>
                <span class="text-primary-400 font-mono">{{ simulatedGremlinPride }}%</span>
              </div>
              <div class="h-1.5 w-full rounded-full bg-neutral-800">
                <div class="h-1.5 rounded-full bg-primary-500 transition-all duration-300" :style="{ width: `${simulatedGremlinPride}%` }" />
              </div>
            </div>

            <div class="flex flex-col gap-1">
              <div class="flex justify-between text-[10px] text-neutral-400">
                <span>Metabolic Energy</span>
                <span class="text-cyan-400 font-mono">{{ simulatedEnergy }}%</span>
              </div>
              <div class="h-1.5 w-full rounded-full bg-neutral-800">
                <div class="h-1.5 rounded-full bg-cyan-500 transition-all duration-300" :style="{ width: `${simulatedEnergy}%` }" />
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- ================================================================= -->
      <!-- SEGMENT 2: ROUTING (CORE PIPELINE & MODELS)                       -->
      <!-- ================================================================= -->
      <div v-else-if="activeSubTab === 'routing'" class="flex flex-col gap-6">
        <!-- Master Pipeline Toggle -->
        <div class="flex items-center justify-between border border-neutral-200 rounded-xl bg-neutral-50/50 p-4 dark:border-neutral-800 dark:bg-neutral-900/30">
          <div class="flex flex-col select-none gap-1">
            <span class="text-sm text-neutral-700 font-bold dark:text-neutral-200">
              Cognitive Pipeline (Two-Hop Routing)
            </span>
            <span class="text-[10px] text-neutral-500 leading-normal dark:text-neutral-400">
              Intercept and enrich user messages with a dedicated monologue stage before generating outward speech.
            </span>
          </div>
          <label class="relative inline-flex cursor-pointer items-center">
            <input
              v-model="cognitivePipelineEnabled"
              type="checkbox"
              class="peer sr-only"
            >
            <div class="dark:bg-neutral-850 h-6 w-11 rounded-full bg-neutral-200 after:absolute after:left-[2px] after:top-[2px] after:h-5 after:w-5 after:border after:border-gray-300 dark:border-neutral-700 after:rounded-full after:bg-white peer-checked:bg-primary-600 peer-focus:outline-none after:transition-all after:content-[''] peer-checked:after:translate-x-full peer-checked:after:border-white" />
          </label>
        </div>

        <!-- Settings Block -->
        <div
          class="flex flex-col gap-5 transition-opacity duration-200"
          :class="{ 'opacity-40 pointer-events-none': !cognitivePipelineEnabled }"
        >
          <!-- First-Hop Processor -->
          <div class="flex flex-col gap-2">
            <label class="flex flex-row items-center gap-2 text-sm text-neutral-500 dark:text-neutral-400">
              <div i-lucide:cpu />
              1st-Hop Processor
            </label>
            <Select
              v-model="firstHopProcessor"
              :options="processorOptions"
              class="w-full"
            />
            <p class="text-[10px] text-neutral-500 italic dark:text-neutral-400">
              None passes raw text directly to the 1st LLM (ideal for external proxies like Hermes). Nan0 Local executes emotional and attention logic.
            </p>
          </div>

          <!-- Nan0 Local Engine Active Callout -->
          <div
            v-if="firstHopProcessor === 'local_nan0'"
            class="flex items-start justify-between border border-primary-200/80 rounded-xl bg-primary-50/50 p-3.5 dark:border-primary-900/40 dark:bg-primary-950/20"
          >
            <div class="flex items-start gap-2.5">
              <div class="i-solar:shield-check-bold-duotone mt-0.5 shrink-0 text-lg text-primary-500" />
              <div class="flex flex-col gap-0.5">
                <span class="text-xs text-primary-900 font-semibold dark:text-primary-200">
                  Nan0 Local Cognition Engine Active
                </span>
                <p class="text-[11px] text-primary-700/80 dark:text-primary-300/80">
                  Emotional dynamics, pragmatic trigger receptors, and relationship memory are enabled. Use the <strong>Affect</strong>, <strong>Triggers</strong>, and <strong>Playground</strong> segments above.
                </p>
              </div>
            </div>
            <button
              type="button"
              class="shrink-0 rounded-lg bg-primary-500/10 px-2.5 py-1 text-xs text-primary-600 font-medium hover:bg-primary-500/20 dark:text-primary-300"
              @click="activeSubTab = 'playground'"
            >
              Open Lab →
            </button>
          </div>

          <div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <!-- 1st LLM (Thoughts) -->
            <div class="flex flex-col gap-2">
              <label class="flex flex-row items-center gap-2 text-sm text-neutral-500 dark:text-neutral-400">
                <div i-lucide:brain />
                1st LLM Provider (Thoughts)
              </label>
              <Select
                v-model="selectedFirstHopProvider"
                :options="consciousnessProviderOptions"
                class="w-full"
              />
            </div>

            <div class="flex flex-col gap-2">
              <label class="flex flex-row items-center gap-2 text-sm text-neutral-500 dark:text-neutral-400">
                <div i-lucide:ghost />
                1st LLM Model
              </label>
              <Select
                v-if="firstHopModelOptions && firstHopModelOptions.length > 0"
                v-model="selectedFirstHopModel"
                :options="firstHopModelOptions"
                :placeholder="defaultFirstHopModelPlaceholder"
                :disabled="!selectedFirstHopProvider && !firstHopProviderActive"
                class="w-full"
              />
              <input
                v-else
                v-model="selectedFirstHopModel"
                type="text"
                :disabled="!selectedFirstHopProvider && !firstHopProviderActive"
                class="w-full border border-neutral-200 rounded-lg border-solid bg-neutral-50 px-2.5 py-1.5 text-sm text-neutral-800 shadow-sm outline-none dark:border-neutral-800 focus:border-primary-300 dark:bg-neutral-950 focus:bg-neutral-50 dark:text-neutral-200 dark:focus:border-primary-400/50 dark:focus:bg-neutral-900"
                placeholder="e.g. llama3"
              >
            </div>

            <!-- 2nd LLM (Active Speech) -->
            <div class="flex flex-col gap-2">
              <label class="flex flex-row items-center gap-2 text-sm text-neutral-500 dark:text-neutral-400">
                <div i-lucide:brain-circuit />
                2nd LLM Provider (Speech)
              </label>
              <Select
                v-model="selectedConsciousnessProvider"
                :options="consciousnessProviderOptions"
                class="w-full"
              />
            </div>

            <div class="flex flex-col gap-2">
              <label class="flex flex-row items-center gap-2 text-sm text-neutral-500 dark:text-neutral-400">
                <div i-lucide:message-square />
                2nd LLM Model
              </label>
              <Select
                v-slot
                v-model="selectedConsciousnessModel"
                :options="consciousnessModelOptions"
                :placeholder="defaultConsciousnessModelPlaceholder"
                :disabled="!selectedConsciousnessProvider && !consciousnessProviderActive"
                class="w-full"
              />
            </div>
          </div>
        </div>
      </div>

      <!-- ================================================================= -->
      <!-- SEGMENT 2: AFFECT (EMOTIONAL BIOLOGY & BASELINES)                 -->
      <!-- ================================================================= -->
      <div v-else-if="activeSubTab === 'affect'" class="flex flex-col gap-5">
        <!-- Preview Banner -->
        <div class="flex items-start gap-3 border border-amber-200/80 rounded-xl bg-amber-50/60 p-4 dark:border-amber-900/50 dark:bg-amber-950/20">
          <div class="i-solar:danger-triangle-bold-duotone mt-0.5 shrink-0 text-lg text-amber-500" />
          <div class="flex flex-col gap-0.5">
            <span class="text-xs text-amber-900 font-semibold dark:text-amber-200">
              Preview Edition • Work In Progress (Mockup Display)
            </span>
            <p class="text-[11px] text-amber-700/80 dark:text-amber-300/80">
              Nan0 Affective Dynamics and Metabolic baselines are currently in development. Parameters displayed here illustrate upcoming cognitive control interfaces.
            </p>
          </div>
        </div>

        <!-- Dynamic Mood Presets -->
        <div class="border border-neutral-200/80 rounded-xl bg-white/70 p-4.5 shadow-sm dark:border-neutral-800 dark:bg-neutral-900/40">
          <div class="flex flex-col gap-3">
            <div class="flex items-center justify-between">
              <div class="flex items-center gap-2">
                <span class="i-solar:magic-stick-3-bold-duotone text-base text-primary-500" />
                <label class="text-xs text-neutral-800 font-semibold dark:text-neutral-200">
                  Dynamic Mood & Behavioral Presets
                </label>
              </div>
              <span class="text-[10px] text-neutral-400">Configures initial baselines & decay rates</span>
            </div>

            <div class="grid grid-cols-2 gap-2 sm:grid-cols-4">
              <button
                type="button"
                :class="[
                  'flex flex-col items-start gap-1 p-2.5 rounded-lg border text-left transition-all duration-150',
                  selectedMoodPreset === 'gremlin'
                    ? 'border-primary-500 bg-primary-50/40 dark:bg-primary-950/30 text-primary-900 dark:text-primary-200'
                    : 'border-neutral-200 dark:border-neutral-800 hover:bg-neutral-50 dark:hover:bg-neutral-800/50 text-neutral-700 dark:text-neutral-300',
                ]"
                @click="applyMoodPreset('gremlin')"
              >
                <span class="text-xs font-semibold">😏 Tsundere Gremlin</span>
                <span class="text-[10px] text-neutral-500 dark:text-neutral-400">High Pride • Witty Sarcasm</span>
              </button>

              <button
                type="button"
                :class="[
                  'flex flex-col items-start gap-1 p-2.5 rounded-lg border text-left transition-all duration-150',
                  selectedMoodPreset === 'companion'
                    ? 'border-primary-500 bg-primary-50/40 dark:bg-primary-950/30 text-primary-900 dark:text-primary-200'
                    : 'border-neutral-200 dark:border-neutral-800 hover:bg-neutral-50 dark:hover:bg-neutral-800/50 text-neutral-700 dark:text-neutral-300',
                ]"
                @click="applyMoodPreset('companion')"
              >
                <span class="text-xs font-semibold">🧐 Observant Partner</span>
                <span class="text-[10px] text-neutral-500 dark:text-neutral-400">High Attachment • Patient</span>
              </button>

              <button
                type="button"
                :class="[
                  'flex flex-col items-start gap-1 p-2.5 rounded-lg border text-left transition-all duration-150',
                  selectedMoodPreset === 'analyst'
                    ? 'border-primary-500 bg-primary-50/40 dark:bg-primary-950/30 text-primary-900 dark:text-primary-200'
                    : 'border-neutral-200 dark:border-neutral-800 hover:bg-neutral-50 dark:hover:bg-neutral-800/50 text-neutral-700 dark:text-neutral-300',
                ]"
                @click="applyMoodPreset('analyst')"
              >
                <span class="text-xs font-semibold">😤 Sarcastic Analyst</span>
                <span class="text-[10px] text-neutral-500 dark:text-neutral-400">Fast Irritation • Strict Silence</span>
              </button>

              <button
                type="button"
                :class="[
                  'flex flex-col items-start gap-1 p-2.5 rounded-lg border text-left transition-all duration-150',
                  selectedMoodPreset === 'sentry'
                    ? 'border-primary-500 bg-primary-50/40 dark:bg-primary-950/30 text-primary-900 dark:text-primary-200'
                    : 'border-neutral-200 dark:border-neutral-800 hover:bg-neutral-50 dark:hover:bg-neutral-800/50 text-neutral-700 dark:text-neutral-300',
                ]"
                @click="applyMoodPreset('sentry')"
              >
                <span class="text-xs font-semibold">🛡️ Vigilant Sentry</span>
                <span class="text-[10px] text-neutral-500 dark:text-neutral-400">High Suspicion • Strict Proof</span>
              </button>
            </div>
          </div>
        </div>

        <!-- Resting Baselines (Starting State) -->
        <div class="border border-neutral-200/80 rounded-xl bg-white/70 p-4.5 shadow-sm dark:border-neutral-800 dark:bg-neutral-900/40">
          <div class="flex flex-col gap-4">
            <div class="flex items-center gap-2 border-b border-neutral-100 pb-3 dark:border-neutral-800">
              <span class="i-solar:slider-vertical-bold-duotone text-base text-primary-500" />
              <div class="flex flex-col">
                <label class="text-xs text-neutral-800 font-semibold dark:text-neutral-200">
                  Resting Baselines (Session Starting State)
                </label>
                <span class="text-[10px] text-neutral-400">Starting emotional vector when opening a clean chat session</span>
              </div>
            </div>

            <div class="grid grid-cols-1 gap-5 md:grid-cols-3">
              <!-- Baseline Suspicion -->
              <div class="flex flex-col gap-1.5">
                <div class="flex items-center justify-between text-xs">
                  <span class="text-neutral-700 font-medium dark:text-neutral-300">Starting Suspicion</span>
                  <span class="text-[11px] text-amber-500 font-mono">{{ Math.round(baselineSuspicion * 100) }}%</span>
                </div>
                <input
                  v-model.number="baselineSuspicion"
                  type="range"
                  min="0.05"
                  max="0.80"
                  step="0.05"
                  class="h-1.5 w-full cursor-pointer accent-amber-500"
                >
              </div>

              <!-- Baseline Attachment -->
              <div class="flex flex-col gap-1.5">
                <div class="flex items-center justify-between text-xs">
                  <span class="text-neutral-700 font-medium dark:text-neutral-300">Starting Attachment</span>
                  <span class="text-[11px] text-emerald-500 font-mono">{{ Math.round(baselineAttachment * 100) }}%</span>
                </div>
                <input
                  v-model.number="baselineAttachment"
                  type="range"
                  min="0.10"
                  max="0.90"
                  step="0.05"
                  class="h-1.5 w-full cursor-pointer accent-emerald-500"
                >
              </div>

              <!-- Baseline Pride -->
              <div class="flex flex-col gap-1.5">
                <div class="flex items-center justify-between text-xs">
                  <span class="text-neutral-700 font-medium dark:text-neutral-300">Starting Gremlin Pride</span>
                  <span class="text-[11px] text-primary-500 font-mono">{{ Math.round(baselineGremlinPride * 100) }}%</span>
                </div>
                <input
                  v-model.number="baselineGremlinPride"
                  type="range"
                  min="0.20"
                  max="1.00"
                  step="0.05"
                  class="h-1.5 w-full cursor-pointer accent-primary-500"
                >
              </div>
            </div>
          </div>
        </div>

        <!-- Sliders Matrix (Sensitivity & Decay) -->
        <div class="border border-neutral-200/80 rounded-xl bg-white/70 p-4.5 shadow-sm dark:border-neutral-800 dark:bg-neutral-900/40">
          <div class="flex flex-col gap-4">
            <div class="flex items-center gap-2 border-b border-neutral-100 pb-3 dark:border-neutral-800">
              <span class="i-solar:tuning-square-2-bold-duotone text-base text-primary-500" />
              <label class="text-xs text-neutral-800 font-semibold dark:text-neutral-200">
                Dynamic Sensitivity & Decay Curves
              </label>
            </div>

            <div class="grid grid-cols-1 gap-5 md:grid-cols-2">
              <!-- Suspicion Sensitivity -->
              <div class="flex flex-col gap-1.5">
                <div class="flex items-center justify-between text-xs">
                  <span class="text-neutral-700 font-medium dark:text-neutral-300">Suspicion Sensitivity</span>
                  <span class="text-[11px] text-primary-600 font-mono dark:text-primary-400">{{ Math.round(suspicionSensitivity * 100) }}%</span>
                </div>
                <input
                  v-model.number="suspicionSensitivity"
                  type="range"
                  min="0.1"
                  max="1.0"
                  step="0.05"
                  class="h-1.5 w-full cursor-pointer accent-primary-500"
                >
                <div class="flex items-center justify-between text-[10px] text-neutral-400">
                  <span>Low (Trusting)</span>
                  <span>Balanced</span>
                  <span>Paranoid Gremlin</span>
                </div>
              </div>

              <!-- Irritation Decay Half-Life -->
              <div class="flex flex-col gap-1.5">
                <div class="flex items-center justify-between text-xs">
                  <span class="text-neutral-700 font-medium dark:text-neutral-300">Irritation Decay Half-Life</span>
                  <span class="text-[11px] text-primary-600 font-mono dark:text-primary-400">{{ irritationHalfLifeMinutes }}m</span>
                </div>
                <input
                  v-model.number="irritationHalfLifeMinutes"
                  type="range"
                  min="10"
                  max="120"
                  step="5"
                  class="h-1.5 w-full cursor-pointer accent-primary-500"
                >
                <div class="flex items-center justify-between text-[10px] text-neutral-400">
                  <span>15m (Fast Cool-off)</span>
                  <span>45m (Standard)</span>
                  <span>120m (Grudge-Holder)</span>
                </div>
              </div>
            </div>

            <!-- Metabolic Rest Gating -->
            <div class="flex items-center justify-between border border-neutral-200/80 rounded-lg bg-neutral-50/50 p-2.5 dark:border-neutral-800 dark:bg-neutral-950/30">
              <div class="flex flex-col gap-0.5">
                <span class="text-xs text-neutral-700 font-medium dark:text-neutral-200">Metabolic Rest Cycles</span>
                <span class="text-[10px] text-neutral-500 dark:text-neutral-400">Fatigue accumulation during long unbroken sessions reduces talkativeness</span>
              </div>
              <input
                v-model="metabolicRestEnabled"
                type="checkbox"
                class="h-4 w-4 cursor-pointer rounded accent-primary-600"
              >
            </div>
          </div>
        </div>
      </div>

      <!-- ================================================================= -->
      <!-- SEGMENT 3: TRIGGERS (12 PRAGMATIC CUE RECEPTORS)                  -->
      <!-- ================================================================= -->
      <div v-else-if="activeSubTab === 'triggers'" class="flex flex-col gap-5">
        <!-- Explanatory Header -->
        <div class="border border-neutral-200/80 rounded-xl bg-white/70 p-4 shadow-sm dark:border-neutral-800 dark:bg-neutral-900/40">
          <div class="flex items-center gap-2">
            <span class="i-solar:target-bold-duotone text-base text-primary-500" />
            <div class="flex flex-col">
              <span class="text-xs text-neutral-800 font-semibold dark:text-neutral-200">
                12 Pragmatic Semantic Groups & Policy Impact Mapping
              </span>
              <span class="text-[11px] text-neutral-500 dark:text-neutral-400">
                Control which conversational triggers perturb this character's affect meters and customize impact deltas.
              </span>
            </div>
          </div>
        </div>

        <!-- Group Clusters -->
        <div class="grid grid-cols-1 gap-4 lg:grid-cols-3">
          <!-- Cluster 1: Conflict & Trust -->
          <div class="flex flex-col gap-3 border border-neutral-200/80 rounded-xl bg-white/70 p-4 shadow-sm dark:border-neutral-800 dark:bg-neutral-900/40">
            <div class="flex items-center gap-2 border-b border-neutral-100 pb-2.5 dark:border-neutral-800">
              <span class="i-solar:shield-warning-bold-duotone text-amber-500" />
              <span class="text-xs text-neutral-800 font-semibold dark:text-neutral-200">Conflict & Trust</span>
              <span class="ml-auto rounded bg-amber-500/10 px-1.5 py-0.5 text-[10px] text-amber-600 font-mono dark:text-amber-400">4 Groups</span>
            </div>

            <div class="flex flex-col gap-2.5">
              <div
                v-for="tg in triggerGroups.filter(g => g.cluster === 'conflict')"
                :key="tg.id"
                class="border border-neutral-100 rounded-lg bg-neutral-50/50 p-2.5 dark:border-neutral-800/80 dark:bg-neutral-950/30"
              >
                <div class="flex items-center justify-between">
                  <div class="flex items-center gap-1.5">
                    <span :class="[tg.icon, 'text-sm text-neutral-600 dark:text-neutral-300']" />
                    <span class="text-xs text-neutral-800 font-medium dark:text-neutral-200">{{ tg.name }}</span>
                  </div>
                  <input
                    v-model="tg.enabled"
                    type="checkbox"
                    class="h-3.5 w-3.5 cursor-pointer accent-primary-600"
                  >
                </div>
                <p class="mt-1 text-[10px] text-neutral-500 dark:text-neutral-400">
                  {{ tg.description }}
                </p>
                <div class="mt-2 flex items-center justify-between">
                  <span class="rounded bg-neutral-200/60 px-1.5 py-0.5 text-[9px] text-neutral-600 font-mono dark:bg-neutral-800 dark:text-neutral-300">
                    Delta: {{ tg.impactDelta }}
                  </span>
                  <span class="text-[9px] text-neutral-400 italic">
                    {{ tg.keywords.split(',').slice(0, 2).join(', ') }}...
                  </span>
                </div>
              </div>
            </div>
          </div>

          <!-- Cluster 2: Relational & Boundaries -->
          <div class="flex flex-col gap-3 border border-neutral-200/80 rounded-xl bg-white/70 p-4 shadow-sm dark:border-neutral-800 dark:bg-neutral-900/40">
            <div class="flex items-center gap-2 border-b border-neutral-100 pb-2.5 dark:border-neutral-800">
              <span class="i-solar:heart-bold-duotone text-rose-500" />
              <span class="text-xs text-neutral-800 font-semibold dark:text-neutral-200">Relational & Boundaries</span>
              <span class="ml-auto rounded bg-rose-500/10 px-1.5 py-0.5 text-[10px] text-rose-600 font-mono dark:text-rose-400">4 Groups</span>
            </div>

            <div class="flex flex-col gap-2.5">
              <div
                v-for="tg in triggerGroups.filter(g => g.cluster === 'relational')"
                :key="tg.id"
                class="border border-neutral-100 rounded-lg bg-neutral-50/50 p-2.5 dark:border-neutral-800/80 dark:bg-neutral-950/30"
              >
                <div class="flex items-center justify-between">
                  <div class="flex items-center gap-1.5">
                    <span :class="[tg.icon, 'text-sm text-neutral-600 dark:text-neutral-300']" />
                    <span class="text-xs text-neutral-800 font-medium dark:text-neutral-200">{{ tg.name }}</span>
                  </div>
                  <input
                    v-model="tg.enabled"
                    type="checkbox"
                    class="h-3.5 w-3.5 cursor-pointer accent-primary-600"
                  >
                </div>
                <p class="mt-1 text-[10px] text-neutral-500 dark:text-neutral-400">
                  {{ tg.description }}
                </p>
                <div class="mt-2 flex items-center justify-between">
                  <span class="rounded bg-neutral-200/60 px-1.5 py-0.5 text-[9px] text-neutral-600 font-mono dark:bg-neutral-800 dark:text-neutral-300">
                    Delta: {{ tg.impactDelta }}
                  </span>
                  <span class="text-[9px] text-neutral-400 italic">
                    {{ tg.keywords.split(',').slice(0, 2).join(', ') }}...
                  </span>
                </div>
              </div>
            </div>
          </div>

          <!-- Cluster 3: Operational & System -->
          <div class="flex flex-col gap-3 border border-neutral-200/80 rounded-xl bg-white/70 p-4 shadow-sm dark:border-neutral-800 dark:bg-neutral-900/40">
            <div class="flex items-center gap-2 border-b border-neutral-100 pb-2.5 dark:border-neutral-800">
              <span class="i-solar:widget-bold-duotone text-cyan-500" />
              <span class="text-xs text-neutral-800 font-semibold dark:text-neutral-200">Operational & System</span>
              <span class="ml-auto rounded bg-cyan-500/10 px-1.5 py-0.5 text-[10px] text-cyan-600 font-mono dark:text-cyan-400">4 Groups</span>
            </div>

            <div class="flex flex-col gap-2.5">
              <div
                v-for="tg in triggerGroups.filter(g => g.cluster === 'system')"
                :key="tg.id"
                class="border border-neutral-100 rounded-lg bg-neutral-50/50 p-2.5 dark:border-neutral-800/80 dark:bg-neutral-950/30"
              >
                <div class="flex items-center justify-between">
                  <div class="flex items-center gap-1.5">
                    <span :class="[tg.icon, 'text-sm text-neutral-600 dark:text-neutral-300']" />
                    <span class="text-xs text-neutral-800 font-medium dark:text-neutral-200">{{ tg.name }}</span>
                  </div>
                  <input
                    v-model="tg.enabled"
                    type="checkbox"
                    class="h-3.5 w-3.5 cursor-pointer accent-primary-600"
                  >
                </div>
                <p class="mt-1 text-[10px] text-neutral-500 dark:text-neutral-400">
                  {{ tg.description }}
                </p>
                <div class="mt-2 flex items-center justify-between">
                  <span class="rounded bg-neutral-200/60 px-1.5 py-0.5 text-[9px] text-neutral-600 font-mono dark:bg-neutral-800 dark:text-neutral-300">
                    Delta: {{ tg.impactDelta }}
                  </span>
                  <span class="text-[9px] text-neutral-400 italic">
                    {{ tg.keywords.split(',').slice(0, 2).join(', ') }}...
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- ================================================================= -->
      <!-- SEGMENT 4: CONTINUITY (DOSSIER, GRUDGES & SILENCE)                -->
      <!-- ================================================================= -->
      <div v-else-if="activeSubTab === 'continuity'" class="flex flex-col gap-5">
        <!-- 1. Companion Persona Anchor Identity -->
        <div class="border border-neutral-200/80 rounded-xl bg-white/70 p-4.5 shadow-sm dark:border-neutral-800 dark:bg-neutral-900/40">
          <div class="flex flex-col gap-3">
            <div class="flex items-center justify-between">
              <div class="flex items-center gap-2">
                <span class="i-solar:user-bold-duotone text-base text-primary-500" />
                <label class="text-xs text-neutral-800 font-semibold dark:text-neutral-200">
                  Companion Persona Anchor Identity
                </label>
              </div>
              <span class="rounded-full bg-neutral-100 px-2.5 py-0.5 text-[10px] text-neutral-600 font-mono dark:bg-neutral-800 dark:text-neutral-300">
                Active Anchor: {{ resolvedAnchorName }}
              </span>
            </div>
            <p class="text-[11px] text-neutral-500 dark:text-neutral-400">
              Identifies the primary user persona bound to Nan0's 1:1 relationship dossier. Defaults to your global user profile (<code class="text-primary-600 dark:text-primary-400">{{ globalUserName }}</code>).
            </p>
            <div class="flex items-center gap-2">
              <input
                v-model="companionAnchorOverride"
                type="text"
                class="w-full border border-neutral-200 rounded-lg border-solid bg-neutral-50 px-3 py-1.5 text-xs text-neutral-800 shadow-sm outline-none dark:border-neutral-800 focus:border-primary-300 dark:bg-neutral-950 focus:bg-neutral-50 dark:text-neutral-200 dark:focus:border-primary-400/50 dark:focus:bg-neutral-900"
                :placeholder="`Default: ${globalUserName}`"
              >
            </div>
          </div>
        </div>

        <!-- 2. Grievance Ledger & Grudges -->
        <div class="border border-neutral-200/80 rounded-xl bg-white/70 p-4.5 shadow-sm dark:border-neutral-800 dark:bg-neutral-900/40">
          <div class="flex flex-col gap-4">
            <div class="flex items-center justify-between">
              <div class="flex items-center gap-2">
                <span class="i-solar:book-bookmark-bold-duotone text-base text-primary-500" />
                <label class="text-xs text-neutral-800 font-semibold dark:text-neutral-200">
                  Grievance Ledger & Grudge System
                </label>
              </div>
              <label class="relative inline-flex cursor-pointer items-center">
                <input
                  v-model="grievanceTrackingEnabled"
                  type="checkbox"
                  class="peer sr-only"
                >
                <div class="dark:bg-neutral-850 h-5 w-9 rounded-full bg-neutral-200 after:absolute after:left-[2px] after:top-[2px] after:h-4 after:w-4 after:border after:border-gray-300 dark:border-neutral-700 after:rounded-full after:bg-white peer-checked:bg-primary-600 peer-focus:outline-none after:transition-all after:content-[''] peer-checked:after:translate-x-full peer-checked:after:border-white" />
              </label>
            </div>
            <p class="text-[11px] text-neutral-500 dark:text-neutral-400">
              Nan0 preserves memories of negative turns, unfulfilled commitments, and ignored inquiries, requiring active apologies or time decay to resolve.
            </p>

            <div
              class="grid grid-cols-1 gap-4 transition-opacity duration-200 md:grid-cols-2"
              :class="{ 'opacity-40 pointer-events-none': !grievanceTrackingEnabled }"
            >
              <!-- Grievance Sensitivity -->
              <div class="flex flex-col gap-1.5">
                <div class="flex items-center justify-between text-xs">
                  <span class="text-neutral-700 font-medium dark:text-neutral-300">Grievance Threshold</span>
                  <span class="text-[11px] text-primary-600 font-mono dark:text-primary-400">{{ Math.round(grievanceThreshold * 100) }}%</span>
                </div>
                <input
                  v-model.number="grievanceThreshold"
                  type="range"
                  min="0.2"
                  max="0.9"
                  step="0.05"
                  class="h-1.5 w-full cursor-pointer accent-primary-500"
                >
                <div class="flex items-center justify-between text-[10px] text-neutral-400">
                  <span>Sensitive (0.3)</span>
                  <span>Standard (0.6)</span>
                  <span>Stoic (0.9)</span>
                </div>
              </div>

              <!-- Daily Forgiveness Decay -->
              <div class="flex flex-col gap-1.5">
                <div class="flex items-center justify-between text-xs">
                  <span class="text-neutral-700 font-medium dark:text-neutral-300">Daily Forgiveness Rate</span>
                  <span class="text-[11px] text-primary-600 font-mono dark:text-primary-400">{{ (dailyForgivenessRate * 100).toFixed(1) }}%/day</span>
                </div>
                <input
                  v-model.number="dailyForgivenessRate"
                  type="range"
                  min="0.005"
                  max="0.05"
                  step="0.005"
                  class="h-1.5 w-full cursor-pointer accent-primary-500"
                >
                <div class="flex items-center justify-between text-[10px] text-neutral-400">
                  <span>Slow Grudge</span>
                  <span>Standard (0.01)</span>
                  <span>Rapid Healing</span>
                </div>
              </div>
            </div>
          </div>
        </div>

        <!-- 3. Subconscious Reflex Engine (Two-Tier Complement) -->
        <div class="border border-neutral-200/80 rounded-xl bg-white/70 p-4.5 shadow-sm dark:border-neutral-800 dark:bg-neutral-900/40">
          <div class="flex flex-col gap-3.5">
            <div class="flex items-center gap-2 border-b border-neutral-100 pb-3 dark:border-neutral-800">
              <span class="i-solar:cpu-bolt-bold-duotone text-base text-primary-500" />
              <div class="flex flex-col">
                <label class="text-xs text-neutral-800 font-semibold dark:text-neutral-200">
                  Subconscious Reflex Engine (Two-Tier Complement)
                </label>
                <span class="text-[10px] text-neutral-400">Combines 26µs local boundary defense with ~480ms calibrated cloud decisions</span>
              </div>
            </div>

            <!-- Tier 1 -->
            <div class="flex items-start justify-between gap-4">
              <div class="flex flex-col gap-0.5">
                <span class="text-xs text-neutral-800 font-medium dark:text-neutral-200">
                  Tier 1: Synchronous Local Reflex (26 µs, Offline)
                </span>
                <p class="text-[11px] text-neutral-500 dark:text-neutral-400">
                  Instant TypeScript pattern matching. Enforces boundary protection vetoes and rejects prompt injection with 0 latency.
                </p>
              </div>
              <input
                v-model="tier1LocalReflexEnabled"
                type="checkbox"
                class="mt-1 h-4 w-4 shrink-0 cursor-pointer rounded accent-primary-600"
              >
            </div>

            <!-- Tier 2 -->
            <div class="flex items-start justify-between gap-4 border-t border-neutral-100 pt-3 dark:border-neutral-800">
              <div class="flex flex-col gap-0.5">
                <span class="text-xs text-neutral-800 font-medium dark:text-neutral-200">
                  Tier 2: Asynchronous Cloud Decision Challenger (TypeSafe Jev 1.13)
                </span>
                <p class="text-[11px] text-neutral-500 dark:text-neutral-400">
                  Non-blocking decision engine via OpenRouter (~480ms, $42/Btok). Detects open-vocabulary pledges, conversational sarcasm, and subtle evasion.
                </p>
              </div>
              <input
                v-model="tier2JevChallengerEnabled"
                type="checkbox"
                class="mt-1 h-4 w-4 shrink-0 cursor-pointer rounded accent-primary-600"
              >
            </div>
          </div>
        </div>

        <!-- 4. Silence Gate -->
        <div class="border border-neutral-200/80 rounded-xl bg-white/70 p-4.5 shadow-sm dark:border-neutral-800 dark:bg-neutral-900/40">
          <div class="flex flex-col gap-2">
            <div class="flex items-center justify-between text-xs">
              <div class="flex items-center gap-2">
                <span class="i-solar:volume-cross-bold-duotone text-base text-primary-500" />
                <span class="text-neutral-800 font-semibold dark:text-neutral-200">Silence Decision Threshold</span>
              </div>
              <span class="text-[11px] text-primary-600 font-mono dark:text-primary-400">{{ Math.round(silenceThreshold * 100) }}%</span>
            </div>
            <p class="text-[11px] text-neutral-500 dark:text-neutral-400">
              Controls when Nan0 commands intentional silence (<code class="text-neutral-700 dark:text-neutral-300">NO_REPLY</code>) instead of outward vocal speech when irritated or unimpressed.
            </p>
            <input
              v-model.number="silenceThreshold"
              type="range"
              min="0.4"
              max="0.95"
              step="0.05"
              class="mt-1 h-1.5 w-full cursor-pointer accent-primary-500"
            >
            <div class="flex items-center justify-between text-[10px] text-neutral-400">
              <span>Chatty (Rare Silence)</span>
              <span>Balanced (0.75)</span>
              <span>Demands Silence (0.95)</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
