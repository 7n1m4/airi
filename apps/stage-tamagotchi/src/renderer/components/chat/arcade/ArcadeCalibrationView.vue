<script setup lang="ts">
import type {
  ArcadeProvisioningConfig,
  CalibrationTelemetryTrace,
  CatalogGame,
} from '@proj-airi/stage-ui/types'

import { ArcadeViewport } from '@proj-airi/stage-ui/components'
import { useArcadeCollector } from '@proj-airi/stage-ui/composables/arcade'
import { useCharacterStore } from '@proj-airi/stage-ui/stores/character'
import { computed, onMounted, ref } from 'vue'

const props = withDefaults(defineProps<{
  game: CatalogGame
  config: ArcadeProvisioningConfig
  engine?: 'jsdos' | 'canvas-2048'
  isGameReady?: boolean
  loading?: boolean
  loadingProgress?: string
  splashUrl?: string | null
  isPointerLocked?: boolean
  isFpsGame?: boolean
  characterName?: string
}>(), {
  engine: 'jsdos',
  isGameReady: false,
  loading: false,
  loadingProgress: '',
  splashUrl: null,
  isPointerLocked: false,
  isFpsGame: false,
  characterName: 'Airi',
})

const emit = defineEmits<{
  (e: 'completed', trace: CalibrationTelemetryTrace): void
  (e: 'cancel'): void
  (e: 'dosClick'): void
  (e: 'canvasClick'): void
  (e: 'canvasKeydown', event: KeyboardEvent): void
  (e: 'dropFiles', event: DragEvent): void
  (e: 'mountDosContainer', el: HTMLDivElement | null): void
  (e: 'mountCanvas', el: HTMLCanvasElement | null): void
}>()

const characterStore = useCharacterStore()
const collector = useArcadeCollector()

const calibrationDurationMs = 15000
const isAnalyzing = ref(false)
const analysisProgress = ref('Analyzing player controls and motion bounds...')
const viewportRef = ref<any>(null)

// Radial Timer Math
const radius = 18
const circumference = 2 * Math.PI * radius
const progressFraction = computed(() => {
  if (!collector.isRecording.value)
    return 1
  return Math.max(0, 1 - collector.elapsedMs.value / calibrationDurationMs)
})
const strokeDashoffset = computed(() => circumference * (1 - progressFraction.value))
const secondsRemaining = computed(() => {
  if (!collector.isRecording.value)
    return 15
  return Math.max(0, Math.ceil((calibrationDurationMs - collector.elapsedMs.value) / 1000))
})

function getActiveCanvas(): HTMLCanvasElement | null {
  if (props.engine === 'jsdos') {
    const container = viewportRef.value?.dosContainerEl as HTMLElement | null
    return container?.querySelector('canvas') || null
  }
  return viewportRef.value?.canvasEl || null
}

function handleStartCalibration() {
  collector.start(getActiveCanvas, calibrationDurationMs, (trace) => {
    isAnalyzing.value = true
    analysisProgress.value = 'Clustering pixel deltas & detecting player anchor...'

    setTimeout(() => {
      analysisProgress.value = 'Synthesizing JavaScript Mini-Program...'
      setTimeout(() => {
        isAnalyzing.value = false
        emit('completed', trace)
      }, 1000)
    }, 800)
  })
}

onMounted(() => {
  // Greet player with companion persona
  try {
    characterStore.emitTextOutput(
      `Help me help you! Play ${props.game.title} for 15 seconds so I can observe how the game moves and learn its physics!`,
    )
  }
  catch {}
})
</script>

<template>
  <div :class="['relative h-full w-full flex flex-col overflow-hidden', 'bg-neutral-950 text-white']">
    <!-- 1. FLOATING AIRI SPEECH BUBBLE -->
    <div
      :class="[
        'absolute left-1/2 top-4 z-40 max-w-xl w-[90%] -translate-x-1/2',
        'flex items-center gap-3 border border-white/15 rounded-2xl p-3 shadow-2xl',
        'bg-black/75 backdrop-blur-md transition-all duration-300',
      ]"
    >
      <div class="h-9 w-9 flex shrink-0 items-center justify-center rounded-xl bg-primary-500/20 text-primary-400 ring-1 ring-primary-500/30">
        <div class="i-solar:ghost-bold text-lg" />
      </div>

      <div class="min-w-0 flex-1">
        <div class="flex items-center gap-1.5 text-[11px] text-primary-300 font-bold tracking-wider uppercase">
          <span>{{ characterName }}'s Vision Academy</span>
          <span class="text-neutral-500">&bull;</span>
          <span class="text-neutral-400">15s Calibration Mode</span>
        </div>
        <p class="text-xs text-neutral-200 leading-snug">
          {{
            collector.isRecording.value
              ? 'Observing! Play normally—dodge hazards, score points, and show me how you move!'
              : `Hit "Start 15s Calibration" below and play for 15 seconds so I can learn ${game.title}'s mechanics!`
          }}
        </p>
      </div>

      <!-- Exit / Cancel button -->
      <button
        class="rounded-lg p-1.5 text-neutral-400 transition-colors hover:bg-white/10 hover:text-white"
        title="Cancel calibration and return to Hub"
        @click="emit('cancel')"
      >
        <div class="i-solar:close-circle-bold text-base" />
      </button>
    </div>

    <!-- 2. FULL VIEWPORT GAME CANVAS -->
    <div class="relative flex flex-1 items-center justify-center overflow-hidden p-6 pt-20">
      <ArcadeViewport
        ref="viewportRef"
        :engine="engine"
        :loading="loading"
        :loading-progress="loadingProgress"
        :splash-url="splashUrl"
        :game-title="game.title"
        :is-game-ready="isGameReady"
        :is-pointer-locked="isPointerLocked"
        :is-fps-game="isFpsGame"
        @dos-click="emit('dosClick')"
        @canvas-click="emit('canvasClick')"
        @canvas-keydown="(e) => emit('canvasKeydown', e)"
        @drop-files="(e) => emit('dropFiles', e)"
        @mount-dos-container="(el) => emit('mountDosContainer', el)"
        @mount-canvas="(el) => emit('mountCanvas', el)"
      />

      <!-- Transition Overlay (Synthesizing Mini Program) -->
      <div
        v-if="isAnalyzing"
        :class="[
          'absolute inset-0 z-50 flex flex-col items-center justify-center',
          'bg-black/85 backdrop-blur-md transition-all',
        ]"
      >
        <div class="relative flex items-center justify-center">
          <div class="i-solar:radar-2-bold animate-spin text-5xl text-primary-400" />
          <div class="i-solar:bolt-bold absolute animate-pulse text-2xl text-emerald-400" />
        </div>
        <h3 class="mt-4 text-sm text-white font-bold tracking-wide">
          Distilling Game Intelligence
        </h3>
        <p class="mt-1 text-xs text-neutral-400 font-mono">
          {{ analysisProgress }}
        </p>
      </div>
    </div>

    <!-- 3. BOTTOM CALIBRATION CONTROL DECK -->
    <div
      :class="[
        'flex items-center justify-between border-t border-white/10 px-6 py-3',
        'bg-black/80 backdrop-blur-md',
      ]"
    >
      <!-- Left: Back Button -->
      <button
        :class="[
          'flex items-center gap-1.5 border border-white/15 rounded-xl px-3 py-1.5 text-xs font-semibold',
          'bg-white/5 text-neutral-300 hover:bg-white/10 active:scale-95 transition-all',
        ]"
        @click="emit('cancel')"
      >
        <div class="i-solar:arrow-left-linear text-xs" />
        <span>Cancel</span>
      </button>

      <!-- Center: Start Button + Radial Timer -->
      <div class="flex items-center gap-4">
        <!-- Start Button -->
        <button
          v-if="!collector.isRecording.value"
          :class="[
            'flex items-center gap-2 rounded-xl px-5 py-2 text-xs font-extrabold text-white shadow-lg',
            'bg-emerald-600 hover:bg-emerald-500 active:scale-95 transition-all',
          ]"
          @click="handleStartCalibration"
        >
          <div class="i-solar:play-bold text-xs" />
          <span>Start 15s Calibration</span>
        </button>

        <!-- Radial Countdown Timer -->
        <div v-else class="flex items-center gap-3">
          <div class="relative h-10 w-10 flex items-center justify-center">
            <svg class="h-10 w-10 -rotate-90">
              <circle
                class="text-neutral-800"
                stroke-width="3"
                stroke="currentColor"
                fill="transparent"
                :r="radius"
                cx="20"
                cy="20"
              />
              <circle
                class="text-primary-500 transition-all duration-100 ease-linear"
                stroke-width="3"
                :stroke-dasharray="circumference"
                :stroke-dashoffset="strokeDashoffset"
                stroke-linecap="round"
                stroke="currentColor"
                fill="transparent"
                :r="radius"
                cx="20"
                cy="20"
              />
            </svg>
            <span class="absolute text-xs text-white font-bold font-mono">
              {{ secondsRemaining }}
            </span>
          </div>

          <div class="flex flex-col">
            <span class="text-xs text-emerald-400 font-bold">Recording Motion...</span>
            <span class="text-[10px] text-neutral-400">Keep playing until time expires</span>
          </div>
        </div>
      </div>

      <!-- Right: Live Telemetry HUD -->
      <div class="flex items-center gap-3 text-[11px] text-neutral-400 font-mono">
        <div class="flex items-center gap-1 border border-white/10 rounded-lg bg-white/5 px-2 py-1">
          <div class="i-solar:camera-bold text-xs text-primary-400" />
          <span>{{ collector.framesCaptured.value }} frames</span>
        </div>

        <div class="flex items-center gap-1 border border-white/10 rounded-lg bg-white/5 px-2 py-1">
          <div class="i-solar:keyboard-bold text-xs text-amber-400" />
          <span>{{ collector.keyEvents.value.length }} keys</span>
        </div>

        <div class="flex items-center gap-1 border border-white/10 rounded-lg bg-white/5 px-2 py-1">
          <div class="i-solar:activity-bold text-xs text-purple-400" />
          <span>{{ (collector.motionEntropy.value * 100).toFixed(0) }}% delta</span>
        </div>
      </div>
    </div>
  </div>
</template>
