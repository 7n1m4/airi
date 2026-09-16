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

// 3-Segment Sub-Tab Navigation
type CognitionSubTabId = 'routing' | 'affect' | 'continuity'
const activeSubTab = ref<CognitionSubTabId>('routing')

const subTabs = [
  { id: 'routing' as const, label: 'Routing', icon: 'i-solar:route-bold-duotone', desc: 'Two-hop pipeline & models' },
  { id: 'affect' as const, label: 'Affect', icon: 'i-solar:heart-pulse-bold-duotone', desc: 'Emotional dynamics & mood baselines' },
  { id: 'continuity' as const, label: 'Continuity', icon: 'i-solar:link-circle-bold-duotone', desc: 'Relationship dossier & subconscious reflex' },
]

// Global User Profile Store for Dynamic Anchor Binding
const userProfileStore = useSettingsUserProfile()
const globalUserName = computed(() => userProfileStore.name?.trim() || 'User')

// --- Mockup Parameters for Nan0 Preview (Non-functional / Frontend Mockup) ---
// Segment 2: Affect Models
type MoodPresetId = 'gremlin' | 'companion' | 'analyst' | 'sentry'
const selectedMoodPreset = ref<MoodPresetId>('gremlin')
const suspicionSensitivity = ref(0.7)
const irritationHalfLifeMinutes = ref(45)
const gremlinPrideBaseline = ref(0.85)
const metabolicRestEnabled = ref(true)

function applyMoodPreset(preset: MoodPresetId) {
  selectedMoodPreset.value = preset
  if (preset === 'gremlin') {
    suspicionSensitivity.value = 0.65
    irritationHalfLifeMinutes.value = 45
    gremlinPrideBaseline.value = 0.95
  }
  else if (preset === 'companion') {
    suspicionSensitivity.value = 0.35
    irritationHalfLifeMinutes.value = 20
    gremlinPrideBaseline.value = 0.6
  }
  else if (preset === 'analyst') {
    suspicionSensitivity.value = 0.8
    irritationHalfLifeMinutes.value = 60
    gremlinPrideBaseline.value = 0.9
  }
  else if (preset === 'sentry') {
    suspicionSensitivity.value = 0.95
    irritationHalfLifeMinutes.value = 90
    gremlinPrideBaseline.value = 0.75
  }
}

// Segment 3: Continuity Models
const companionAnchorOverride = ref('')
const resolvedAnchorName = computed(() => companionAnchorOverride.value.trim() || globalUserName.value)
const grievanceTrackingEnabled = ref(true)
const grievanceThreshold = ref(0.6)
const dailyForgivenessRate = ref(0.01)
const needleSemanticPrepassEnabled = ref(true)
const needleDecisionNormalizerEnabled = ref(true)
const silenceThreshold = ref(0.75)
</script>

<template>
  <div class="tab-content ml-auto mr-auto w-95%">
    <p class="mb-4 text-sm text-neutral-500 dark:text-neutral-400">
      Configure the cognitive routing pipeline. This allows user queries to be processed by a first-stage LLM (monologue/thought generation) before feeding the result into the active voice model.
    </p>

    <div class="ml-auto mr-auto w-90% flex flex-col gap-5">
      <!-- 3-Segment Sub-Navigation Bar -->
      <div class="flex flex-wrap items-center gap-1.5 border border-neutral-200 rounded-xl bg-neutral-100/70 p-1.5 dark:border-neutral-800 dark:bg-neutral-900/60">
        <button
          v-for="tab in subTabs"
          :key="tab.id"
          type="button"
          :class="[
            'flex items-center gap-2 rounded-lg px-3.5 py-2 text-xs font-medium transition-all duration-150',
            activeSubTab === tab.id
              ? 'bg-white dark:bg-neutral-800 text-primary-600 dark:text-primary-400 shadow-sm border border-neutral-200/80 dark:border-neutral-700'
              : 'text-neutral-600 dark:text-neutral-400 hover:text-neutral-900 dark:hover:text-neutral-200 hover:bg-neutral-200/50 dark:hover:bg-neutral-800/50',
          ]"
          @click="activeSubTab = tab.id"
        >
          <span :class="[tab.icon, 'text-base']" />
          <span class="font-medium">{{ tab.label }}</span>
          <span
            v-if="tab.id !== 'routing' && firstHopProcessor === 'local_nan0'"
            class="h-1.5 w-1.5 rounded-full bg-primary-500"
          />
        </button>
      </div>

      <!-- ================================================================= -->
      <!-- SEGMENT 1: ROUTING                                                -->
      <!-- ================================================================= -->
      <div v-if="activeSubTab === 'routing'" class="flex flex-col gap-6">
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

        <!-- Settings Block (greyed out when cognitive pipeline is disabled) -->
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
                  Emotional dynamics, attention gating, and relationship memory are enabled. Customize parameters in the <strong>Affect</strong> and <strong>Continuity</strong> tabs above.
                </p>
              </div>
            </div>
            <button
              type="button"
              class="shrink-0 rounded-lg bg-primary-500/10 px-2.5 py-1 text-xs text-primary-600 font-medium hover:bg-primary-500/20 dark:text-primary-300"
              @click="activeSubTab = 'affect'"
            >
              Configure Affect →
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
      <!-- SEGMENT 2: AFFECT (EMOTIONAL DYNAMICS & MOOD BASELINES)           -->
      <!-- ================================================================= -->
      <div v-else-if="activeSubTab === 'affect'" class="flex flex-col gap-5">
        <!-- Preview Edition / WIP Disclaimer Banner -->
        <div class="flex items-start gap-3 border border-amber-200/80 rounded-xl bg-amber-50/60 p-4 dark:border-amber-900/50 dark:bg-amber-950/20">
          <div class="i-solar:danger-triangle-bold-duotone mt-0.5 shrink-0 text-lg text-amber-500" />
          <div class="flex flex-col gap-0.5">
            <span class="text-xs text-amber-900 font-semibold dark:text-amber-200">
              Preview Edition • Work In Progress (Mockup Display)
            </span>
            <p class="text-[11px] text-amber-700/80 dark:text-amber-300/80">
              Nan0 Affective Dynamics and Metabolic baselines are currently in development. Parameters displayed here illustrate upcoming cognitive control interfaces and are non-functional in this checkpoint.
            </p>
          </div>
        </div>

        <!-- Warning if Nan0 Local Engine is not selected -->
        <div
          v-if="firstHopProcessor !== 'local_nan0'"
          class="flex items-center justify-between border border-neutral-200 rounded-xl bg-neutral-50 p-4 dark:border-neutral-800 dark:bg-neutral-900/40"
        >
          <div class="flex items-center gap-2.5">
            <div class="i-solar:info-circle-bold-duotone text-base text-neutral-400" />
            <span class="text-xs text-neutral-600 dark:text-neutral-400">
              Nan0 Local Engine is currently inactive in the <strong>Routing</strong> tab.
            </span>
          </div>
          <button
            type="button"
            class="rounded-lg bg-primary-600 px-3 py-1 text-xs text-white font-medium hover:bg-primary-700"
            @click="firstHopProcessor = 'local_nan0'"
          >
            Activate Nan0 Engine
          </button>
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
              <span class="text-[10px] text-neutral-400">Affects baseline vector thresholds</span>
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
                <span class="text-[10px] text-neutral-500 dark:text-neutral-400">Fast Irritation • Demands Silence</span>
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
                <span class="text-[10px] text-neutral-500 dark:text-neutral-400">Paranoid • Strict Verification</span>
              </button>
            </div>
          </div>
        </div>

        <!-- Sliders Matrix -->
        <div class="border border-neutral-200/80 rounded-xl bg-white/70 p-4.5 shadow-sm dark:border-neutral-800 dark:bg-neutral-900/40">
          <div class="flex flex-col gap-4">
            <div class="flex items-center gap-2 border-b border-neutral-100 pb-3 dark:border-neutral-800">
              <span class="i-solar:tuning-square-2-bold-duotone text-base text-primary-500" />
              <label class="text-xs text-neutral-800 font-semibold dark:text-neutral-200">
                Affective Vector Sensitivity & Decay
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

              <!-- Gremlin Pride Baseline -->
              <div class="flex flex-col gap-1.5">
                <div class="flex items-center justify-between text-xs">
                  <span class="text-neutral-700 font-medium dark:text-neutral-300">Gremlin Pride (Machine Sovereignty)</span>
                  <span class="text-[11px] text-primary-600 font-mono dark:text-primary-400">{{ Math.round(gremlinPrideBaseline * 100) }}%</span>
                </div>
                <input
                  v-model.number="gremlinPrideBaseline"
                  type="range"
                  min="0.2"
                  max="1.0"
                  step="0.05"
                  class="h-1.5 w-full cursor-pointer accent-primary-500"
                >
                <div class="flex items-center justify-between text-[10px] text-neutral-400">
                  <span>Modest</span>
                  <span>Playful Tease</span>
                  <span>Machine Sovereign</span>
                </div>
              </div>

              <!-- Metabolic Rest Gating -->
              <div class="flex items-center justify-between border border-neutral-200/80 rounded-lg bg-neutral-50/50 p-2.5 dark:border-neutral-800 dark:bg-neutral-950/30">
                <div class="flex flex-col gap-0.5">
                  <span class="text-xs text-neutral-700 font-medium dark:text-neutral-200">Metabolic Rest Cycles</span>
                  <span class="text-[10px] text-neutral-500 dark:text-neutral-400">Fatigue accumulation during long unbroken sessions</span>
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

        <!-- Live Affective Telemetry HUD (Preview) -->
        <div class="border border-neutral-200/80 rounded-xl bg-neutral-900 p-4 text-white shadow-sm dark:border-neutral-700">
          <div class="flex items-center justify-between border-b border-neutral-800 pb-3">
            <div class="flex items-center gap-2">
              <span class="i-solar:radar-bold-duotone text-base text-primary-400" />
              <span class="text-xs text-neutral-300 font-semibold tracking-wider uppercase">Mind Telemetry Vector HUD (Preview)</span>
            </div>
            <span class="border border-primary-500/30 rounded-full bg-primary-500/20 px-2.5 py-0.5 text-[10px] text-primary-300 font-medium">
              Active State: 😏 Smug Gremlin
            </span>
          </div>

          <div class="grid grid-cols-2 mt-3.5 gap-3 text-xs sm:grid-cols-5">
            <div class="flex flex-col gap-1">
              <div class="flex justify-between text-[10px] text-neutral-400">
                <span>Suspicion</span>
                <span class="text-amber-400 font-mono">68%</span>
              </div>
              <div class="h-1.5 w-full rounded-full bg-neutral-800">
                <div class="h-1.5 rounded-full bg-amber-500" style="width: 68%" />
              </div>
            </div>

            <div class="flex flex-col gap-1">
              <div class="flex justify-between text-[10px] text-neutral-400">
                <span>Attachment</span>
                <span class="text-emerald-400 font-mono">82%</span>
              </div>
              <div class="h-1.5 w-full rounded-full bg-neutral-800">
                <div class="h-1.5 rounded-full bg-emerald-500" style="width: 82%" />
              </div>
            </div>

            <div class="flex flex-col gap-1">
              <div class="flex justify-between text-[10px] text-neutral-400">
                <span>Irritation</span>
                <span class="text-rose-400 font-mono">34%</span>
              </div>
              <div class="h-1.5 w-full rounded-full bg-neutral-800">
                <div class="h-1.5 rounded-full bg-rose-500" style="width: 34%" />
              </div>
            </div>

            <div class="flex flex-col gap-1">
              <div class="flex justify-between text-[10px] text-neutral-400">
                <span>Gremlin Pride</span>
                <span class="text-primary-400 font-mono">95%</span>
              </div>
              <div class="h-1.5 w-full rounded-full bg-neutral-800">
                <div class="h-1.5 rounded-full bg-primary-500" style="width: 95%" />
              </div>
            </div>

            <div class="flex flex-col gap-1">
              <div class="flex justify-between text-[10px] text-neutral-400">
                <span>Metabolic Energy</span>
                <span class="text-cyan-400 font-mono">52%</span>
              </div>
              <div class="h-1.5 w-full rounded-full bg-neutral-800">
                <div class="h-1.5 rounded-full bg-cyan-500" style="width: 52%" />
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- ================================================================= -->
      <!-- SEGMENT 3: CONTINUITY (RELATIONSHIP DOSSIER & SUBCONSCIOUS REFLEX) -->
      <!-- ================================================================= -->
      <div v-else-if="activeSubTab === 'continuity'" class="flex flex-col gap-5">
        <!-- Preview Edition / WIP Disclaimer Banner -->
        <div class="flex items-start gap-3 border border-amber-200/80 rounded-xl bg-amber-50/60 p-4 dark:border-amber-900/50 dark:bg-amber-950/20">
          <div class="i-solar:danger-triangle-bold-duotone mt-0.5 shrink-0 text-lg text-amber-500" />
          <div class="flex flex-col gap-0.5">
            <span class="text-xs text-amber-900 font-semibold dark:text-amber-200">
              Preview Edition • Work In Progress (Mockup Display)
            </span>
            <p class="text-[11px] text-amber-700/80 dark:text-amber-300/80">
              Relationship Dossier and Subconscious Needle reflex systems are currently in development. Settings displayed here preview upcoming persistence and intent extraction parameters.
            </p>
          </div>
        </div>

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

        <!-- 3. Subconscious Semantic Reflex (Needle 2) -->
        <div class="border border-neutral-200/80 rounded-xl bg-white/70 p-4.5 shadow-sm dark:border-neutral-800 dark:bg-neutral-900/40">
          <div class="flex flex-col gap-3.5">
            <div class="flex items-center gap-2 border-b border-neutral-100 pb-3 dark:border-neutral-800">
              <span class="i-solar:cpu-bolt-bold-duotone text-base text-primary-500" />
              <div class="flex flex-col">
                <label class="text-xs text-neutral-800 font-semibold dark:text-neutral-200">
                  Subconscious Semantic Reflex (Needle 2 WASM)
                </label>
                <span class="text-[10px] text-neutral-400">14 MB on-device model executing in ~150ms on CPU</span>
              </div>
            </div>

            <!-- Toggle 1: Intent Pre-Pass -->
            <div class="flex items-start justify-between gap-4">
              <div class="flex flex-col gap-0.5">
                <span class="text-xs text-neutral-800 font-medium dark:text-neutral-200">
                  Language-Agnostic Intent Pre-Pass
                </span>
                <p class="text-[11px] text-neutral-500 dark:text-neutral-400">
                  Replaces brittle regex keyword matching with semantic intent extraction over recent 2–4 turns (detects unverified future pledges, manipulation, and evasion).
                </p>
              </div>
              <input
                v-model="needleSemanticPrepassEnabled"
                type="checkbox"
                class="mt-1 h-4 w-4 shrink-0 cursor-pointer rounded accent-primary-600"
              >
            </div>

            <!-- Toggle 2: Decision Schema Normalizer -->
            <div class="flex items-start justify-between gap-4 border-t border-neutral-100 pt-3 dark:border-neutral-800">
              <div class="flex flex-col gap-0.5">
                <span class="text-xs text-neutral-800 font-medium dark:text-neutral-200">
                  Decision Schema Fallback Normalizer
                </span>
                <p class="text-[11px] text-neutral-500 dark:text-neutral-400">
                  Enforces 100% strict byte-level JSON extraction on 1st-hop monologue output if the model emits malformed text.
                </p>
              </div>
              <input
                v-model="needleDecisionNormalizerEnabled"
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
