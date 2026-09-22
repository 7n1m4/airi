<script setup lang="ts">
import { useSettingsUserProfile } from '@proj-airi/stage-ui/stores/settings/user-profile'
import { computed } from 'vue'

const props = defineProps<{
  cognitivePipelineEnabled: boolean
  firstHopProcessor: 'none' | 'local_nan0' | 'universe_rag'
}>()

const emit = defineEmits<{
  navigateToRouting: []
}>()

type MoodPresetId = 'gremlin' | 'companion' | 'analyst' | 'sentry'
const selectedMoodPreset = defineModel<MoodPresetId>('selectedMoodPreset', { default: 'gremlin' })
const baselineSuspicion = defineModel<number>('baselineSuspicion', { default: 0.20 })
const baselineAttachment = defineModel<number>('baselineAttachment', { default: 0.60 })
const baselinePride = defineModel<number>('baselinePride', { default: 0.85 })
const suspicionSensitivity = defineModel<number>('suspicionSensitivity', { default: 0.65 })
const irritationHalfLifeMinutes = defineModel<number>('irritationHalfLifeMinutes', { default: 45 })
const metabolicRestEnabled = defineModel<boolean>('metabolicRestEnabled', { default: true })
const companionAnchorOverride = defineModel<string>('companionAnchorOverride', { default: '' })
const grievanceTrackingEnabled = defineModel<boolean>('grievanceTrackingEnabled', { default: true })
const grievanceThreshold = defineModel<number>('grievanceThreshold', { default: 0.6 })
const dailyForgivenessRate = defineModel<number>('dailyForgivenessRate', { default: 0.01 })
const silenceThreshold = defineModel<number>('silenceThreshold', { default: 0.75 })

const userProfileStore = useSettingsUserProfile()
const globalUserName = computed(() => userProfileStore.name?.trim() || 'User')
const resolvedAnchorName = computed(() => companionAnchorOverride.value.trim() || globalUserName.value)

const isNan0Active = computed(() => props.cognitivePipelineEnabled && props.firstHopProcessor === 'local_nan0')

function applyMoodPreset(preset: MoodPresetId) {
  selectedMoodPreset.value = preset
  if (preset === 'gremlin') {
    baselineSuspicion.value = 0.25
    baselineAttachment.value = 0.50
    baselinePride.value = 0.95
    suspicionSensitivity.value = 0.65
    irritationHalfLifeMinutes.value = 45
    silenceThreshold.value = 0.70
  }
  else if (preset === 'companion') {
    baselineSuspicion.value = 0.10
    baselineAttachment.value = 0.80
    baselinePride.value = 0.60
    suspicionSensitivity.value = 0.35
    irritationHalfLifeMinutes.value = 20
    silenceThreshold.value = 0.90
  }
  else if (preset === 'analyst') {
    baselineSuspicion.value = 0.40
    baselineAttachment.value = 0.30
    baselinePride.value = 0.90
    suspicionSensitivity.value = 0.80
    irritationHalfLifeMinutes.value = 60
    silenceThreshold.value = 0.60
  }
  else if (preset === 'sentry') {
    baselineSuspicion.value = 0.60
    baselineAttachment.value = 0.20
    baselinePride.value = 0.75
    suspicionSensitivity.value = 0.95
    irritationHalfLifeMinutes.value = 90
    silenceThreshold.value = 0.50
  }
}
</script>

<template>
  <div class="flex flex-col gap-5">
    <!-- Nan0 Inactive Warning Banner ⭐ -->
    <div
      v-if="!isNan0Active"
      class="flex items-start gap-3 border border-amber-200/80 rounded-xl bg-amber-50/80 p-4 shadow-sm dark:border-amber-900/40 dark:bg-amber-950/30"
    >
      <div class="i-solar:shield-warning-bold-duotone mt-0.5 shrink-0 text-xl text-amber-500" />
      <div class="flex flex-col gap-1">
        <div class="flex items-center gap-2">
          <span class="text-xs text-amber-900 font-bold dark:text-amber-200">
            Nan0 Local Engine is Inactive
          </span>
          <span class="rounded bg-amber-200/60 px-1.5 py-0.2 text-[9px] text-amber-800 font-bold font-mono dark:bg-amber-900/60 dark:text-amber-300">
            NO-OP
          </span>
        </div>
        <p class="text-[11px] text-amber-800/90 leading-relaxed dark:text-amber-300/90">
          These affective baselines and dynamic decay curves only take effect when the Cognitive Pipeline is enabled and the 1st-Hop Processor is set to <strong>Nan0 Local Engine</strong>. Under your current routing configuration, this companion uses direct prompt routing without affective modulation.
        </p>
        <button
          type="button"
          class="mt-1.5 inline-flex items-center self-start gap-1.5 rounded-lg bg-amber-600/10 px-2.5 py-1 text-xs text-amber-800 font-medium transition-colors hover:bg-amber-600/20 dark:text-amber-200"
          @click="emit('navigateToRouting')"
        >
          <span class="i-solar:route-bold" />
          <span>Switch 1st-Hop Processor in Routing</span>
          <span class="i-solar:arrow-right-linear text-xs" />
        </button>
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

    <!-- Resting Baselines (Session Starting State) -->
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
              <span class="text-neutral-700 font-medium dark:text-neutral-300">Starting Machine Pride</span>
              <span class="text-[11px] text-primary-500 font-mono">{{ Math.round(baselinePride * 100) }}%</span>
            </div>
            <input
              v-model.number="baselinePride"
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

    <!-- Sensitivity & Decay Curves -->
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
              <span>Paranoid</span>
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

        <!-- Metabolic Rest Gating (Upgraded to Pill Switch) ⭐ -->
        <div class="flex items-center justify-between border border-neutral-200/80 rounded-lg bg-neutral-50/50 p-3 dark:border-neutral-800 dark:bg-neutral-950/30">
          <div class="flex flex-col gap-0.5">
            <span class="text-xs text-neutral-700 font-medium dark:text-neutral-200">Metabolic Rest Cycles</span>
            <span class="text-[10px] text-neutral-500 dark:text-neutral-400">Fatigue accumulation during long unbroken sessions reduces conversational verbosity</span>
          </div>
          <label class="relative inline-flex shrink-0 cursor-pointer items-center">
            <input
              v-model="metabolicRestEnabled"
              type="checkbox"
              class="peer sr-only"
            >
            <div class="dark:bg-neutral-850 h-5 w-9 rounded-full bg-neutral-200 after:absolute after:left-[2px] after:top-[2px] after:h-4 after:w-4 after:border after:border-gray-300 dark:border-neutral-700 after:rounded-full after:bg-white peer-checked:bg-primary-600 peer-focus:outline-none after:transition-all after:content-[''] peer-checked:after:translate-x-full peer-checked:after:border-white" />
          </label>
        </div>
      </div>
    </div>

    <!-- Long-Term Relational Continuity (Folded from Continuity) -->
    <div class="border border-neutral-200/80 rounded-xl bg-white/70 p-4.5 shadow-sm dark:border-neutral-800 dark:bg-neutral-900/40">
      <div class="flex flex-col gap-4">
        <div class="flex items-center gap-2 border-b border-neutral-100 pb-3 dark:border-neutral-800">
          <span class="i-solar:user-hand-up-bold-duotone text-base text-primary-500" />
          <div class="flex flex-col">
            <label class="text-xs text-neutral-800 font-semibold dark:text-neutral-200">
              Long-Term Relational Continuity & Grudges
            </label>
            <span class="text-[10px] text-neutral-400">Binds 1:1 user profile identity and tracks historical unresolved transgressions</span>
          </div>
        </div>

        <!-- Companion Persona Anchor Identity -->
        <div class="flex flex-col gap-2">
          <div class="flex items-center justify-between">
            <span class="text-xs text-neutral-700 font-medium dark:text-neutral-300">Companion Anchor Identity</span>
            <span class="rounded-full bg-neutral-100 px-2 py-0.5 text-[10px] text-neutral-600 font-mono dark:bg-neutral-800 dark:text-neutral-300">
              Active: {{ resolvedAnchorName }}
            </span>
          </div>
          <input
            v-model="companionAnchorOverride"
            type="text"
            class="w-full border border-neutral-200 rounded-lg border-solid bg-neutral-50 px-3 py-1.5 text-xs text-neutral-800 shadow-sm outline-none dark:border-neutral-800 focus:border-primary-400 dark:bg-neutral-950 dark:text-neutral-200"
            :placeholder="`Default: ${globalUserName}`"
          >
        </div>

        <!-- Grievance Ledger (Upgraded to Pill Switch) ⭐ -->
        <div class="flex flex-col gap-3 border-t border-neutral-100 pt-3 dark:border-neutral-800">
          <div class="flex items-center justify-between">
            <div class="flex flex-col gap-0.5">
              <span class="text-xs text-neutral-700 font-medium dark:text-neutral-300">Grievance Ledger & Grudge Tracking</span>
              <span class="text-[10px] text-neutral-500 dark:text-neutral-400">Preserves memories of broken pledges and intentional insults across sessions</span>
            </div>
            <label class="relative inline-flex shrink-0 cursor-pointer items-center">
              <input
                v-model="grievanceTrackingEnabled"
                type="checkbox"
                class="peer sr-only"
              >
              <div class="dark:bg-neutral-850 h-5 w-9 rounded-full bg-neutral-200 after:absolute after:left-[2px] after:top-[2px] after:h-4 after:w-4 after:border after:border-gray-300 dark:border-neutral-700 after:rounded-full after:bg-white peer-checked:bg-primary-600 peer-focus:outline-none after:transition-all after:content-[''] peer-checked:after:translate-x-full peer-checked:after:border-white" />
            </label>
          </div>

          <div
            class="grid grid-cols-1 gap-4 transition-opacity duration-200 md:grid-cols-2"
            :class="{ 'opacity-40 pointer-events-none': !grievanceTrackingEnabled }"
          >
            <div class="flex flex-col gap-1">
              <div class="flex items-center justify-between text-xs">
                <span class="text-neutral-600 dark:text-neutral-400">Grievance Threshold</span>
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
            </div>

            <div class="flex flex-col gap-1">
              <div class="flex items-center justify-between text-xs">
                <span class="text-neutral-600 dark:text-neutral-400">Daily Forgiveness Rate</span>
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
            </div>
          </div>
        </div>

        <!-- Silence Gate -->
        <div class="flex flex-col gap-2 border-t border-neutral-100 pt-3 dark:border-neutral-800">
          <div class="flex items-center justify-between text-xs">
            <span class="text-neutral-700 font-medium dark:text-neutral-300">Silence Decision Threshold</span>
            <span class="text-[11px] text-primary-600 font-mono dark:text-primary-400">{{ Math.round(silenceThreshold * 100) }}%</span>
          </div>
          <p class="text-[10px] text-neutral-500 dark:text-neutral-400">
            Sensitivity for commanding intentional silence (<code class="text-neutral-700 dark:text-neutral-300">NO_REPLY</code>) instead of speech when irritated or unimpressed.
          </p>
          <input
            v-model.number="silenceThreshold"
            type="range"
            min="0.4"
            max="0.95"
            step="0.05"
            class="h-1.5 w-full cursor-pointer accent-primary-500"
          >
        </div>
      </div>
    </div>
  </div>
</template>
