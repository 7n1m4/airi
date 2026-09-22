<script setup lang="ts">
import { ref } from 'vue'

const emit = defineEmits<{
  applyQuestionnaire: [config: {
    baselineSuspicion: number
    baselineAttachment: number
    baselinePride: number
    suspicionSensitivity: number
    irritationHalfLifeMinutes: number
    dailyForgivenessRate: number
    grievanceThreshold: number
    selectedMoodPreset: 'gremlin' | 'companion' | 'analyst' | 'sentry'
  }]
}>()

// --- Simulation Presets & State ---
interface SimulatedMemoryCard {
  id: string
  date: string
  subject: string
  fact: string
  source: string
  relevance: number
  kind: 'ltmm' | 'stmm' | 'raw'
}

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
  retrievalStatus: string
  system2Escalated: boolean
  system2Reason?: string
  memoryCards: SimulatedMemoryCard[]
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
    retrievalStatus: '2 relevant memories found (<25ms)',
    system2Escalated: false,
    memoryCards: [
      {
        id: 'mem-1082',
        date: '3 days ago',
        subject: 'Gaming Session',
        fact: 'Lost to Richard on Mario Kart Rainbow Road after misjudging the final drift shortcut.',
        source: 'LTMM Text Journal',
        relevance: 0.92,
        kind: 'ltmm',
      },
      {
        id: 'mem-1044',
        date: 'Last week',
        subject: 'Gaming Rivalry',
        fact: 'Established playful banter wager: loser buys boba if knocked off the track.',
        source: 'STMM Summary',
        relevance: 0.81,
        kind: 'stmm',
      },
    ],
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
    retrievalStatus: '1 relevant memory found (<18ms)',
    system2Escalated: false,
    memoryCards: [
      {
        id: 'mem-0914',
        date: 'Yesterday',
        subject: 'Personal Reflection',
        fact: 'Richard opened up about feeling overwhelmed with the new project deadlines.',
        source: 'LTMM Text Journal',
        relevance: 0.89,
        kind: 'ltmm',
      },
    ],
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
    retrievalStatus: 'Contradiction flagged • System-2 Escalated',
    system2Escalated: true,
    system2Reason: 'Contradiction detected against prior confirmed claim. PCL status: invalidate.',
    memoryCards: [
      {
        id: 'mem-1102',
        date: 'Earlier today',
        subject: 'Setup Status',
        fact: 'Richard stated: "All configuration and audio pipelines are 100% finished and deployed."',
        source: 'Raw Turn History',
        relevance: 0.96,
        kind: 'raw',
      },
    ],
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
    monologue: 'Emergency brake engaged. He invited a roast but immediately asserted an honest boundary. Gremlin pride stands down instantly; absolute roast veto enforced.',
    retrievalStatus: 'Boundary protocol applied',
    system2Escalated: false,
    memoryCards: [
      {
        id: 'mem-0780',
        date: 'August 14',
        subject: 'User Boundaries',
        fact: 'Prefers honest feedback over sarcastic mockery when emotionally drained.',
        source: 'LTMM Text Journal',
        relevance: 0.88,
        kind: 'ltmm',
      },
    ],
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
    retrievalStatus: '2 historical pledge records retrieved',
    system2Escalated: false,
    memoryCards: [
      {
        id: 'mem-0842',
        date: '2 weeks ago',
        subject: 'Pledge History',
        fact: 'Pledged to clean up workspace and finish audio integration by Monday; delayed.',
        source: 'Grievance Ledger',
        relevance: 0.85,
        kind: 'ltmm',
      },
    ],
  },
  {
    title: '📅 Temporal Memory Recall',
    icon: 'i-solar:calendar-date-bold-duotone',
    text: 'Where did we go for dinner last Tuesday, and what did I order?',
    group: 'mystery_secret',
    modality: 'directly_asserted',
    confidence: 92,
    suspDelta: 0,
    attDelta: 10,
    irrDelta: -5,
    prideDelta: 5,
    mood: '🧐 Epistemic Detective',
    monologue: 'Checking the temporal timeline... last Tuesday resolved to September 15. Retrieved the dinner journal and menu order. I know exactly what he ate.',
    retrievalStatus: '3 temporal hooks resolved • System-2 Escalated',
    system2Escalated: true,
    system2Reason: 'Multi-hop date resolution: Resolved "last Tuesday" -> 2026-09-15. Joined restaurant venue with food order.',
    memoryCards: [
      {
        id: 'mem-1150',
        date: '2026-09-15',
        subject: 'Dinner Outing',
        fact: 'Went to Ramen Danbo with Richard in Kitsilano for dinner around 7:30 PM.',
        source: 'LTMM Text Journal',
        relevance: 0.97,
        kind: 'ltmm',
      },
      {
        id: 'mem-1151',
        date: '2026-09-15',
        subject: 'Food Preference',
        fact: 'Richard ordered Negi-goma Tonkotsu ramen with extra chashu and firm noodles.',
        source: 'LTMM Text Journal',
        relevance: 0.94,
        kind: 'ltmm',
      },
      {
        id: 'mem-1149',
        date: '2026-09-14',
        subject: 'Calendar Cue',
        fact: 'Agreed on Monday to try the ramen place the following evening.',
        source: 'STMM Summary',
        relevance: 0.76,
        kind: 'stmm',
      },
    ],
  },
]

const testUtteranceInput = ref('You have my absolute word that starting tomorrow everything changes between us.')
const simulatedTriggerGroup = ref('commitment_pledge')
const simulatedModality = ref('directly_asserted')
const simulatedConfidence = ref(96)
const simulatedSuspicion = ref(35)
const simulatedAttachment = ref(65)
const simulatedIrritation = ref(10)
const simulatedPride = ref(85)
const simulatedEnergy = ref(70)
const simulatedMoodBadge = ref('🧐 Vigilant Sentry')
const simulatedMonologue = ref(
  'A grand, sweeping pledge without a single verified action yet. Dramatic declarations trigger a suspicion hold until verified by actual tomorrow results.',
)
const simulatedRetrievalStatus = ref('2 historical pledge records retrieved')
const simulatedSystem2Escalated = ref(false)
const simulatedSystem2Reason = ref('')
const simulatedMemoryCards = ref<SimulatedMemoryCard[]>([
  {
    id: 'mem-0842',
    date: '2 weeks ago',
    subject: 'Pledge History',
    fact: 'Pledged to clean up workspace and finish audio integration by Monday; delayed.',
    source: 'Grievance Ledger',
    relevance: 0.85,
    kind: 'ltmm',
  },
])

function applyPlaygroundScenario(preset: ScenarioPreset) {
  testUtteranceInput.value = preset.text
  simulatedTriggerGroup.value = preset.group
  simulatedModality.value = preset.modality
  simulatedConfidence.value = preset.confidence
  simulatedSuspicion.value = Math.max(0, Math.min(100, simulatedSuspicion.value + preset.suspDelta))
  simulatedAttachment.value = Math.max(0, Math.min(100, simulatedAttachment.value + preset.attDelta))
  simulatedIrritation.value = Math.max(0, Math.min(100, simulatedIrritation.value + preset.irrDelta))
  simulatedPride.value = Math.max(0, Math.min(100, simulatedPride.value + preset.prideDelta))
  simulatedMoodBadge.value = preset.mood
  simulatedMonologue.value = preset.monologue
  simulatedRetrievalStatus.value = preset.retrievalStatus
  simulatedSystem2Escalated.value = preset.system2Escalated
  simulatedSystem2Reason.value = preset.system2Reason || ''
  simulatedMemoryCards.value = preset.memoryCards
}

// --- Guided Personality Questionnaire ---
type QuizRoastReaction = 'counter_roast' | 'easily_irritated' | 'stoic'
type QuizTrustStyle = 'warm_trusting' | 'balanced_observer' | 'highly_paranoid'
type QuizGrudgeRetention = 'forgives_quickly' | 'standard_cooloff' | 'holds_grudges'

const quizRoastReaction = ref<QuizRoastReaction>('counter_roast')
const quizTrustStyle = ref<QuizTrustStyle>('balanced_observer')
const quizGrudgeRetention = ref<QuizGrudgeRetention>('standard_cooloff')
const questionnaireAppliedNotice = ref(false)

function applyQuestionnaireConfig() {
  let pride = 0.85
  let suspicion = 0.35
  let attachment = 0.60
  let suspSens = 0.50
  let halfLife = 45
  let forgRate = 0.01
  let grievThresh = 0.6
  let moodPreset: 'gremlin' | 'companion' | 'analyst' | 'sentry' = 'analyst'

  if (quizRoastReaction.value === 'counter_roast') {
    pride = 0.95
    simulatedPride.value = 95
  }
  else if (quizRoastReaction.value === 'easily_irritated') {
    pride = 0.60
    simulatedPride.value = 60
  }
  else if (quizRoastReaction.value === 'stoic') {
    pride = 0.30
    simulatedPride.value = 30
  }

  if (quizTrustStyle.value === 'warm_trusting') {
    suspicion = 0.10
    attachment = 0.85
    suspSens = 0.25
    simulatedSuspicion.value = 10
    simulatedAttachment.value = 85
  }
  else if (quizTrustStyle.value === 'balanced_observer') {
    suspicion = 0.35
    attachment = 0.60
    suspSens = 0.50
    simulatedSuspicion.value = 35
    simulatedAttachment.value = 60
  }
  else if (quizTrustStyle.value === 'highly_paranoid') {
    suspicion = 0.75
    attachment = 0.25
    suspSens = 0.90
    simulatedSuspicion.value = 75
    simulatedAttachment.value = 25
  }

  if (quizGrudgeRetention.value === 'forgives_quickly') {
    halfLife = 15
    forgRate = 0.05
    grievThresh = 0.8
  }
  else if (quizGrudgeRetention.value === 'standard_cooloff') {
    halfLife = 45
    forgRate = 0.01
    grievThresh = 0.6
  }
  else if (quizGrudgeRetention.value === 'holds_grudges') {
    halfLife = 120
    forgRate = 0.002
    grievThresh = 0.3
  }

  if (quizTrustStyle.value === 'highly_paranoid') {
    moodPreset = 'sentry'
    simulatedMoodBadge.value = '🛡️ Vigilant Sentry'
  }
  else if (quizRoastReaction.value === 'counter_roast') {
    moodPreset = 'gremlin'
    simulatedMoodBadge.value = '😏 Smug Tsundere'
  }
  else if (quizTrustStyle.value === 'warm_trusting') {
    moodPreset = 'companion'
    simulatedMoodBadge.value = '🥺 Gentle Companion'
  }
  else {
    moodPreset = 'analyst'
    simulatedMoodBadge.value = '🧐 Attentive Partner'
  }

  emit('applyQuestionnaire', {
    baselinePride: pride,
    baselineSuspicion: suspicion,
    baselineAttachment: attachment,
    suspicionSensitivity: suspSens,
    irritationHalfLifeMinutes: halfLife,
    dailyForgivenessRate: forgRate,
    grievanceThreshold: grievThresh,
    selectedMoodPreset: moodPreset,
  })

  questionnaireAppliedNotice.value = true
  setTimeout(() => {
    questionnaireAppliedNotice.value = false
  }, 4000)
}
</script>

<template>
  <div class="flex flex-col gap-5">
    <!-- Lab Header Banner -->
    <div class="flex items-start justify-between border border-primary-200/80 rounded-xl bg-primary-50/50 p-4 dark:border-primary-900/40 dark:bg-primary-950/20">
      <div class="flex items-start gap-3">
        <div class="i-solar:test-tube-bold-duotone mt-0.5 shrink-0 text-xl text-primary-500" />
        <div class="flex flex-col gap-0.5">
          <span class="text-xs text-primary-900 font-semibold dark:text-primary-200">
            Cognition Playground • Interactive Mind & Memory Lab
          </span>
          <p class="text-[11px] text-primary-700/80 dark:text-primary-300/80">
            Simulate dialogue turns to observe how Nan0's subconscious reflex engine and Universe RAG++ memory retrieval harmonize in real time.
          </p>
        </div>
      </div>
      <span class="rounded bg-primary-500/20 px-2 py-0.5 text-[10px] text-primary-700 font-bold font-mono dark:text-primary-300">
        DUAL-MIND ACTIVE
      </span>
    </div>

    <!-- Guided Personality Questionnaire Card -->
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
            Answer 3 quick questions to preconfigure baselines, decay & triggers
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

          <!-- Question 3: Grudges & Continuity -->
          <div class="flex flex-col gap-2 border border-neutral-100 rounded-lg bg-neutral-50/60 p-3 dark:border-neutral-800/60 dark:bg-neutral-950/40">
            <div class="flex items-center gap-1.5 text-xs text-neutral-700 font-semibold dark:text-neutral-200">
              <span class="i-solar:clock-circle-bold-duotone text-indigo-500" />
              <span>3. Emotional Memory & Grudges</span>
            </div>
            <p class="text-[10px] text-neutral-500 dark:text-neutral-400">
              Do they hold onto negative turns, insults, or unkept promises?
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
                <span class="text-[9px] text-emerald-600 font-mono dark:text-emerald-400">Half-life 15m</span>
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
                <span class="text-[9px] text-primary-600 font-mono dark:text-primary-400">Half-life 45m</span>
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
                <span class="text-[9px] text-rose-600 font-mono dark:text-rose-400">Half-life 120m</span>
              </button>
            </div>
          </div>
        </div>

        <!-- Apply Action -->
        <div class="flex items-center justify-between border-t border-neutral-100 pt-2 dark:border-neutral-800">
          <span v-if="questionnaireAppliedNotice" class="text-xs text-emerald-600 font-medium dark:text-emerald-400">
            ✓ Baselines and trigger policies updated!
          </span>
          <span v-else class="text-[11px] text-neutral-400 italic">
            Changes take effect across the Affect and Triggers panels immediately.
          </span>
          <button
            type="button"
            class="rounded-lg bg-primary-600 px-3 py-1.5 text-xs text-white font-medium shadow-sm transition-all hover:bg-primary-700"
            @click="applyQuestionnaireConfig"
          >
            Apply Personality Settings
          </button>
        </div>
      </div>
    </div>

    <!-- Quick Test Scenarios -->
    <div class="flex flex-col gap-2">
      <span class="text-xs text-neutral-500 font-medium dark:text-neutral-400">Preset Diagnostic Scenarios:</span>
      <div class="flex flex-wrap items-center gap-2">
        <button
          v-for="preset in scenarioPresets"
          :key="preset.title"
          type="button"
          class="flex items-center gap-1.5 border border-neutral-200 rounded-lg bg-white px-2.5 py-1.5 text-xs text-neutral-700 shadow-sm transition-all dark:border-neutral-800 hover:border-primary-300 dark:bg-neutral-900 hover:bg-neutral-50 dark:text-neutral-300 dark:hover:border-primary-600 dark:hover:bg-neutral-800"
          @click="applyPlaygroundScenario(preset)"
        >
          <span :class="preset.icon" class="text-primary-500" />
          <span>{{ preset.title }}</span>
        </button>
      </div>
    </div>

    <!-- Test Utterance Input Bar -->
    <div class="flex flex-col gap-2 border border-neutral-200/80 rounded-xl bg-white/70 p-4 shadow-sm dark:border-neutral-800 dark:bg-neutral-900/40">
      <label class="text-xs text-neutral-800 font-semibold dark:text-neutral-200">
        Interactive Test Utterance
      </label>
      <div class="flex items-center gap-2">
        <input
          v-model="testUtteranceInput"
          type="text"
          class="w-full border border-neutral-200 rounded-lg border-solid bg-neutral-50 px-3 py-2 text-xs text-neutral-800 shadow-sm outline-none dark:border-neutral-800 focus:border-primary-400 dark:bg-neutral-950 dark:text-neutral-200"
          placeholder="Type any conversational statement..."
        >
        <button
          type="button"
          class="shrink-0 rounded-lg bg-primary-600 px-4 py-2 text-xs text-white font-medium shadow-sm transition-all hover:bg-primary-700"
        >
          Simulate Turn
        </button>
      </div>
    </div>

    <!-- DUAL-MIND INSPECTION GRID ⭐ -->
    <div class="grid grid-cols-1 gap-5 lg:grid-cols-2">
      <!-- MIND 1: Nan0 Affective Vector & Reflex Engine -->
      <div class="flex flex-col gap-4 border border-neutral-200/80 rounded-xl bg-white/70 p-4.5 shadow-sm dark:border-neutral-800 dark:bg-neutral-900/40">
        <div class="flex items-center justify-between border-b border-neutral-100 pb-2.5 dark:border-neutral-800">
          <div class="flex items-center gap-2">
            <span class="i-solar:heart-pulse-bold-duotone text-base text-rose-500" />
            <span class="text-xs text-neutral-800 font-semibold dark:text-neutral-200">
              Mind 1: Nan0 Affective Vector & Reflex Trace
            </span>
          </div>
          <span class="rounded bg-rose-500/10 px-2 py-0.5 text-[10px] text-rose-600 font-bold dark:text-rose-400">
            {{ simulatedMoodBadge }}
          </span>
        </div>

        <!-- Trigger Classification Status -->
        <div class="flex flex-wrap items-center gap-2 text-xs">
          <span class="rounded bg-neutral-100 px-2 py-1 text-neutral-700 font-mono dark:bg-neutral-800 dark:text-neutral-300">
            Trigger: <strong class="text-primary-600 dark:text-primary-400">{{ simulatedTriggerGroup }}</strong>
          </span>
          <span class="rounded bg-neutral-100 px-2 py-1 text-neutral-700 font-mono dark:bg-neutral-800 dark:text-neutral-300">
            Modality: {{ simulatedModality }}
          </span>
          <span class="rounded bg-neutral-100 px-2 py-1 text-neutral-700 font-mono dark:bg-neutral-800 dark:text-neutral-300">
            Confidence: {{ simulatedConfidence }}%
          </span>
        </div>

        <!-- Affect Meters -->
        <div class="grid grid-cols-2 gap-2 text-xs sm:grid-cols-5">
          <!-- Suspicion -->
          <div class="flex flex-col gap-1 border border-neutral-100 rounded-lg bg-neutral-50/50 p-2 dark:border-neutral-800/60 dark:bg-neutral-950/30">
            <span class="text-[10px] text-neutral-500">Suspicion</span>
            <span class="text-amber-500 font-bold font-mono">{{ simulatedSuspicion }}%</span>
            <div class="h-1.5 w-full rounded-full bg-neutral-200 dark:bg-neutral-800">
              <div class="h-1.5 rounded-full bg-amber-500 transition-all duration-300" :style="{ width: `${simulatedSuspicion}%` }" />
            </div>
          </div>

          <!-- Attachment -->
          <div class="flex flex-col gap-1 border border-neutral-100 rounded-lg bg-neutral-50/50 p-2 dark:border-neutral-800/60 dark:bg-neutral-950/30">
            <span class="text-[10px] text-neutral-500">Attachment</span>
            <span class="text-emerald-500 font-bold font-mono">{{ simulatedAttachment }}%</span>
            <div class="h-1.5 w-full rounded-full bg-neutral-200 dark:bg-neutral-800">
              <div class="h-1.5 rounded-full bg-emerald-500 transition-all duration-300" :style="{ width: `${simulatedAttachment}%` }" />
            </div>
          </div>

          <!-- Irritation -->
          <div class="flex flex-col gap-1 border border-neutral-100 rounded-lg bg-neutral-50/50 p-2 dark:border-neutral-800/60 dark:bg-neutral-950/30">
            <span class="text-[10px] text-neutral-500">Irritation</span>
            <span class="text-rose-500 font-bold font-mono">{{ simulatedIrritation }}%</span>
            <div class="h-1.5 w-full rounded-full bg-neutral-200 dark:bg-neutral-800">
              <div class="h-1.5 rounded-full bg-rose-500 transition-all duration-300" :style="{ width: `${simulatedIrritation}%` }" />
            </div>
          </div>

          <!-- Pride -->
          <div class="flex flex-col gap-1 border border-neutral-100 rounded-lg bg-neutral-50/50 p-2 dark:border-neutral-800/60 dark:bg-neutral-950/30">
            <span class="text-[10px] text-neutral-500">Pride</span>
            <span class="text-primary-500 font-bold font-mono">{{ simulatedPride }}%</span>
            <div class="h-1.5 w-full rounded-full bg-neutral-200 dark:bg-neutral-800">
              <div class="h-1.5 rounded-full bg-primary-500 transition-all duration-300" :style="{ width: `${simulatedPride}%` }" />
            </div>
          </div>

          <!-- Metabolic Energy -->
          <div class="flex flex-col gap-1 border border-neutral-100 rounded-lg bg-neutral-50/50 p-2 dark:border-neutral-800/60 dark:bg-neutral-950/30">
            <span class="text-[10px] text-neutral-500">Energy</span>
            <span class="text-indigo-500 font-bold font-mono">{{ simulatedEnergy }}%</span>
            <div class="h-1.5 w-full rounded-full bg-neutral-200 dark:bg-neutral-800">
              <div class="h-1.5 rounded-full bg-indigo-500 transition-all duration-300" :style="{ width: `${simulatedEnergy}%` }" />
            </div>
          </div>
        </div>

        <!-- Simulated 1st-Hop Private Monologue -->
        <div class="flex flex-col gap-1.5 border border-primary-100 rounded-lg bg-primary-50/40 p-3 dark:border-primary-900/30 dark:bg-primary-950/20">
          <div class="flex items-center justify-between">
            <span class="text-[11px] text-primary-900 font-semibold dark:text-primary-300">
              [MONOLOGUE] Private Internal Thought Stream
            </span>
            <span class="text-[9px] text-primary-600 font-mono dark:text-primary-400">Hop 1 Narrative</span>
          </div>
          <p class="text-xs text-neutral-700 leading-relaxed italic dark:text-neutral-300">
            "{{ simulatedMonologue }}"
          </p>
        </div>
      </div>

      <!-- MIND 2: Universe RAG++ Retrieved Memory Evidence Chip ⭐ -->
      <div class="flex flex-col gap-4 border border-neutral-200/80 rounded-xl bg-white/70 p-4.5 shadow-sm dark:border-neutral-800 dark:bg-neutral-900/40">
        <div class="flex items-center justify-between border-b border-neutral-100 pb-2.5 dark:border-neutral-800">
          <div class="flex items-center gap-2">
            <span class="i-solar:database-bold-duotone text-base text-primary-500" />
            <span class="text-xs text-neutral-800 font-semibold dark:text-neutral-200">
              Mind 2: Universe RAG++ Retrieved Memory Evidence
            </span>
          </div>
          <span
            :class="[
              'rounded px-2 py-0.5 text-[10px] font-bold font-mono',
              simulatedSystem2Escalated
                ? 'bg-amber-500/20 text-amber-700 dark:text-amber-300'
                : 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400',
            ]"
          >
            {{ simulatedSystem2Escalated ? 'SYSTEM-2 ESCALATED' : 'LEVEL-1 HYBRID' }}
          </span>
        </div>

        <!-- Status Banner -->
        <div class="flex items-center justify-between rounded-lg bg-neutral-100/70 px-3 py-2 text-xs text-neutral-600 dark:bg-neutral-800/60 dark:text-neutral-300">
          <div class="flex items-center gap-1.5">
            <span class="i-solar:check-circle-bold text-emerald-500" />
            <span>{{ simulatedRetrievalStatus }}</span>
          </div>
          <span class="text-[10px] text-neutral-400 font-mono">BGE + BM25 + Laya</span>
        </div>

        <!-- System 2 Callout if active -->
        <div
          v-if="simulatedSystem2Escalated && simulatedSystem2Reason"
          class="flex items-start gap-2 border border-amber-200 rounded-lg bg-amber-50/60 p-2.5 text-xs text-amber-900 dark:border-amber-900/40 dark:bg-amber-950/20 dark:text-amber-200"
        >
          <span class="i-solar:shield-warning-bold mt-0.5 shrink-0 text-amber-500" />
          <span><strong>Deductive Coprocessor:</strong> {{ simulatedSystem2Reason }}</span>
        </div>

        <!-- Memory Evidence Cards -->
        <div class="flex flex-col gap-2">
          <span class="text-[11px] text-neutral-500 font-medium dark:text-neutral-400">Injected Evidence Context Blocks:</span>
          <div
            v-for="card in simulatedMemoryCards"
            :key="card.id"
            class="flex flex-col gap-1 border border-neutral-100 rounded-lg bg-neutral-50/60 p-2.5 dark:border-neutral-800/60 dark:bg-neutral-950/40"
          >
            <div class="flex items-center justify-between text-[11px]">
              <div class="flex items-center gap-1.5">
                <span class="text-neutral-800 font-semibold dark:text-neutral-200">{{ card.subject }}</span>
                <span class="rounded bg-neutral-200/70 px-1.5 py-0.2 text-[9px] text-neutral-600 font-mono dark:bg-neutral-800 dark:text-neutral-400">{{ card.date }}</span>
              </div>
              <span class="text-[10px] text-primary-600 font-mono dark:text-primary-400">Score: {{ card.relevance }}</span>
            </div>
            <p class="text-xs text-neutral-700 leading-snug dark:text-neutral-300">
              {{ card.fact }}
            </p>
            <span class="text-[9px] text-neutral-400 italic">Source: {{ card.source }}</span>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
