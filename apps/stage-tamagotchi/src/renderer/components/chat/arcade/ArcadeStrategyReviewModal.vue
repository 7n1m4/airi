<script setup lang="ts">
import type {
  AcquiredGameKnowledge,
  ArcadeProvisioningConfig,
  CalibrationTelemetryTrace,
  CatalogGame,
  MiniProgramDefinition,
} from '@proj-airi/stage-ui/types'

import { useArcadeSynthesizer } from '@proj-airi/stage-ui/composables'
import { DialogContent, DialogOverlay, DialogPortal, DialogRoot, DialogTitle } from 'reka-ui'
import { computed, ref, watch } from 'vue'
import { toast } from 'vue-sonner'

const props = defineProps<{
  open: boolean
  game: CatalogGame | null
  config: ArcadeProvisioningConfig | null
  trace: CalibrationTelemetryTrace | null
}>()

const emit = defineEmits<{
  (e: 'close'): void
  (e: 'recalibrate'): void
  (e: 'testLive', code: string): void
  (e: 'approve', knowledge: AcquiredGameKnowledge): void
}>()

const {
  isTesting,
  lastTestResult,
  synthesizeStrategy,
  synthesizeMiniProgram,
  runSandboxTest,
  buildAcquiredKnowledge,
} = useArcadeSynthesizer()

const strategy = ref<ReturnType<typeof synthesizeStrategy> | null>(null)
const miniProgram = ref<MiniProgramDefinition | null>(null)
const copiedCode = ref(false)

async function copyExtractorCode() {
  if (!miniProgram.value?.code)
    return
  try {
    await navigator.clipboard.writeText(miniProgram.value.code)
    copiedCode.value = true
    setTimeout(() => {
      copiedCode.value = false
    }, 2000)
    toast.success('State extractor code copied to clipboard!')
  }
  catch {
    toast.error('Failed to copy code to clipboard.')
  }
}

// Persona presentation mapping
const PERSONA_INFO: Record<string, { label: string, icon: string, color: string }> = {
  hype_coach: {
    label: 'Hype Coach',
    icon: 'i-solar:fire-bold',
    color: 'text-orange-500 bg-orange-500/10 border-orange-500/30',
  },
  strategic_advisor: {
    label: 'Strategic Advisor',
    icon: 'i-solar:diploma-verified-bold',
    color: 'text-sky-500 bg-sky-500/10 border-sky-500/30',
  },
  zen_co_pilot: {
    label: 'Zen Co-Pilot',
    icon: 'i-solar:leaf-bold',
    color: 'text-emerald-500 bg-emerald-500/10 border-emerald-500/30',
  },
  snarky_backseater: {
    label: 'Snarky Backseater',
    icon: 'i-solar:ghost-bold',
    color: 'text-purple-500 bg-purple-500/10 border-purple-500/30',
  },
}

const personaDetails = computed(() => {
  const p = props.config?.companionPersona || 'hype_coach'
  return PERSONA_INFO[p] || PERSONA_INFO.hype_coach
})

// Trigger synthesis when modal opens or trace changes
function runSynthesis() {
  if (!props.game || !props.config || !props.trace)
    return

  strategy.value = synthesizeStrategy(props.game, props.config, props.trace)
  miniProgram.value = synthesizeMiniProgram(props.game, props.trace)
  buildAcquiredKnowledge(props.game, props.config, props.trace, strategy.value, miniProgram.value)
}

watch(
  () => [props.open, props.trace, props.game],
  ([isOpen]) => {
    if (isOpen && props.game && props.config && props.trace) {
      runSynthesis()
    }
  },
  { immediate: true },
)

async function handleTestSandbox() {
  if (!miniProgram.value?.code)
    return
  await runSandboxTest(miniProgram.value.code, 60)
  emit('testLive', miniProgram.value.code)
}

function handleApprove() {
  if (!props.game || !props.config || !props.trace || !strategy.value)
    return

  const knowledge = buildAcquiredKnowledge(
    props.game,
    props.config,
    props.trace,
    strategy.value,
    miniProgram.value,
  )
  emit('approve', knowledge)
}
</script>

<template>
  <DialogRoot :open="open" @update:open="(val: boolean) => { if (!val) emit('close'); }">
    <DialogPortal>
      <DialogOverlay class="backdrop-blur-xs fixed inset-0 z-50 bg-black/60 transition-opacity" />

      <DialogContent
        :class="[
          'fixed left-1/2 top-1/2 z-50 max-h-[92vh] w-full max-w-2xl -translate-x-1/2 -translate-y-1/2',
          'flex flex-col overflow-hidden border border-neutral-200/80 rounded-2xl shadow-2xl',
          'bg-white dark:border-neutral-800/80 dark:bg-neutral-900 text-neutral-800 dark:text-neutral-100',
        ]"
      >
        <!-- Modal Header / Game Hero -->
        <div
          v-if="game"
          :class="[
            'relative flex items-center justify-between border-b border-neutral-200/60 p-4',
            'bg-neutral-50/80 dark:border-neutral-800/60 dark:bg-neutral-950/60',
          ]"
        >
          <div class="min-w-0 flex items-center gap-3.5">
            <!-- Thumbnail / Icon -->
            <div class="h-12 w-14 shrink-0 overflow-hidden border border-neutral-200/60 rounded-xl bg-black dark:border-neutral-800">
              <img
                v-if="game.thumbnailUrl"
                :src="game.thumbnailUrl"
                :alt="game.title"
                class="h-full w-full object-cover"
                @error="(e: any) => { e.target.style.display = 'none' }"
              >
              <div v-else class="h-full w-full flex items-center justify-center text-neutral-500">
                <div class="i-solar:gamepad-bold text-lg" />
              </div>
            </div>

            <!-- Title & Badges -->
            <div class="min-w-0 flex-1">
              <div class="flex items-center gap-2">
                <DialogTitle class="truncate text-sm text-neutral-900 font-extrabold dark:text-neutral-50">
                  {{ game.title }}
                </DialogTitle>
                <span class="rounded-md bg-primary-500/10 px-2 py-0.5 text-[10px] text-primary-600 font-bold dark:text-primary-400">
                  Phase 4 Review
                </span>
              </div>

              <div class="mt-1 flex flex-wrap items-center gap-1.5 text-[10px]">
                <span
                  v-if="trace?.identifiedArchitecture"
                  class="border border-neutral-200 rounded-md bg-white px-2 py-0.5 text-neutral-600 font-bold dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-300"
                >
                  {{ trace.identifiedArchitecture.replace(/_/g, ' ') }}
                </span>
                <span
                  :class="[
                    'flex items-center gap-1 border rounded-md px-2 py-0.5 font-bold',
                    personaDetails.color,
                  ]"
                >
                  <div :class="[personaDetails.icon, 'text-[11px]']" />
                  <span>{{ personaDetails.label }}</span>
                </span>
              </div>
            </div>
          </div>

          <!-- Close button -->
          <button
            class="rounded-lg p-1.5 text-neutral-400 hover:bg-neutral-200/60 hover:text-neutral-600 dark:hover:bg-neutral-800"
            @click="emit('close')"
          >
            <div class="i-solar:close-circle-bold text-lg" />
          </button>
        </div>

        <!-- Scrollable Body Content -->
        <div class="flex-1 overflow-y-auto p-5 space-y-4">
          <!-- 1. Telemetry Metrics Summary Bar -->
          <div
            v-if="trace"
            :class="[
              'grid grid-cols-3 gap-3 p-3.5 rounded-xl border',
              'bg-neutral-50/50 border-neutral-200/60 dark:bg-neutral-950/40 dark:border-neutral-800/60',
            ]"
          >
            <div class="flex flex-col gap-0.5">
              <span class="text-[11px] text-neutral-400 font-medium">Session Telemetry</span>
              <span class="text-xs text-neutral-800 font-bold dark:text-neutral-200">
                {{ trace.framesCaptured }} frames <span class="text-[10px] text-neutral-400 font-normal">({{ (trace.durationMs / 1000).toFixed(0) }}s)</span>
              </span>
            </div>

            <div class="flex flex-col gap-0.5">
              <span class="text-[11px] text-neutral-400 font-medium">Motion Entropy</span>
              <div class="flex items-center gap-1.5">
                <span class="text-xs text-neutral-800 font-bold dark:text-neutral-200">
                  {{ trace.motionEntropy.toFixed(2) }}
                </span>
                <span
                  :class="[
                    'text-[10px] font-bold px-1.5 py-0.2 rounded',
                    trace.motionEntropy > 0.35 ? 'bg-amber-500/15 text-amber-600' : 'bg-emerald-500/15 text-emerald-600',
                  ]"
                >
                  {{ trace.motionEntropy > 0.35 ? 'Dynamic' : 'Steady' }}
                </span>
              </div>
            </div>

            <div class="flex flex-col gap-0.5">
              <span class="text-[11px] text-neutral-400 font-medium">Player Inputs</span>
              <span class="text-xs text-neutral-800 font-bold dark:text-neutral-200">
                {{ trace.keyEvents.length }} keypresses
              </span>
            </div>
          </div>

          <!-- 2. Airi Persona Assessment & Strategy -->
          <div
            v-if="strategy"
            :class="[
              'flex flex-col gap-3 rounded-xl border p-4',
              'bg-primary-500/5 border-primary-500/20 dark:bg-primary-500/10 dark:border-primary-500/20',
            ]"
          >
            <div class="flex items-center gap-2">
              <div class="i-solar:chat-round-dots-bold text-sm text-primary-500" />
              <h4 class="text-xs text-neutral-900 font-bold tracking-wider uppercase dark:text-neutral-100">
                Airi's Strategic Assessment
              </h4>
            </div>

            <!-- Strategy narrative -->
            <p class="text-xs text-neutral-700 leading-relaxed dark:text-neutral-300">
              {{ strategy.summary }}
            </p>

            <!-- Key Tactics -->
            <div class="pt-1 space-y-1.5">
              <span class="text-[11px] text-neutral-500 font-bold tracking-wider uppercase dark:text-neutral-400">
                Tactical Directives
              </span>
              <ul class="space-y-1">
                <li
                  v-for="(tactic, idx) in strategy.tactics"
                  :key="idx"
                  class="flex items-start gap-2 text-xs text-neutral-700 dark:text-neutral-300"
                >
                  <div class="i-solar:check-circle-bold mt-0.5 shrink-0 text-xs text-primary-500" />
                  <span>{{ tactic }}</span>
                </li>
              </ul>
            </div>

            <!-- Hazard Rules -->
            <div v-if="strategy.hazardRules.length > 0" class="pt-1 space-y-1.5">
              <span class="text-[11px] text-amber-600 font-bold tracking-wider uppercase dark:text-amber-400">
                Hazard Avoidance Rules
              </span>
              <ul class="space-y-1">
                <li
                  v-for="(rule, idx) in strategy.hazardRules"
                  :key="idx"
                  class="flex items-start gap-2 text-xs text-amber-700 dark:text-amber-300/90"
                >
                  <div class="i-solar:danger-triangle-bold mt-0.5 shrink-0 text-xs text-amber-500" />
                  <span>{{ rule }}</span>
                </li>
              </ul>
            </div>
          </div>

          <!-- 3. Dynamic State Extractor (if synthesized) -->
          <div
            v-if="miniProgram"
            :class="[
              'flex flex-col gap-3 rounded-xl border p-4',
              'bg-neutral-50/50 border-neutral-200/60 dark:bg-neutral-950/40 dark:border-neutral-800/60',
            ]"
          >
            <div class="flex items-center justify-between">
              <div class="flex items-center gap-2">
                <div class="i-solar:code-square-bold text-sm text-sky-500" />
                <h4 class="text-xs text-neutral-900 font-bold tracking-wider uppercase dark:text-neutral-100">
                  Dynamic Game State Extractor
                </h4>
              </div>

              <div class="flex items-center gap-2">
                <button
                  class="shadow-2xs dark:hover:bg-neutral-750 flex items-center gap-1 border border-neutral-300 rounded-md bg-white px-2 py-1 text-[11px] text-neutral-600 font-semibold transition-all active:scale-95 dark:border-neutral-700 dark:bg-neutral-800 hover:bg-neutral-100 dark:text-neutral-300"
                  title="Copy synthesized extractGameState function to clipboard"
                  @click="copyExtractorCode"
                >
                  <div :class="copiedCode ? 'i-solar:check-circle-bold text-emerald-500' : 'i-solar:copy-bold text-neutral-500'" class="text-xs" />
                  <span>{{ copiedCode ? 'Copied!' : 'Copy Code' }}</span>
                </button>

                <span class="border border-sky-500/30 rounded bg-sky-500/10 px-2 py-0.5 text-[10px] text-sky-600 font-bold font-mono dark:text-sky-400">
                  Pure JS &bull; &lt;1ms
                </span>
              </div>
            </div>

            <p class="text-[11px] text-neutral-500 leading-normal dark:text-neutral-400">
              Evaluates 80&times;40 grid deltas to extract active entities, headings, hazards, and game-over state to feed Jev System 1.
            </p>

            <!-- Code block -->
            <div class="max-h-48 overflow-y-auto border border-neutral-800 rounded-lg bg-neutral-900 p-3 text-[11px] text-neutral-100 font-mono shadow-inner">
              <pre class="whitespace-pre-wrap">{{ miniProgram.code }}</pre>
            </div>

            <!-- Sandbox Testing Controls -->
            <div class="flex flex-wrap items-center justify-between gap-3 pt-1">
              <button
                :disabled="isTesting"
                :class="[
                  'flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-all shadow-sm',
                  'border border-sky-500/40 bg-sky-500/15 text-sky-600 hover:bg-sky-500/25 active:scale-95 dark:text-sky-300',
                  isTesting ? 'opacity-60 cursor-not-allowed' : '',
                ]"
                @click="handleTestSandbox"
              >
                <div v-if="isTesting" class="i-solar:restart-bold animate-spin text-xs" />
                <div v-else class="i-solar:play-bold text-xs" />
                <span>{{ isTesting ? 'Running 60 Ticks...' : 'Test Extractor (60s)' }}</span>
              </button>

              <!-- Test Result Readout -->
              <div v-if="lastTestResult" class="flex items-center gap-2 text-[11px]">
                <span
                  v-if="lastTestResult.status === 'completed'"
                  class="flex items-center gap-1 text-emerald-600 font-bold dark:text-emerald-400"
                >
                  <div class="i-solar:check-circle-bold text-xs" />
                  <span>{{ lastTestResult.ticksExecuted }} ticks verified</span>
                  <span class="text-neutral-400">({{ lastTestResult.avgLatencyMs }}ms/tick)</span>
                </span>
                <span
                  v-else-if="lastTestResult.status === 'error'"
                  class="flex items-center gap-1 text-red-500 font-bold"
                >
                  <div class="i-solar:close-circle-bold text-xs" />
                  <span>Sandbox Error: {{ lastTestResult.error }}</span>
                </span>
              </div>
            </div>
          </div>

          <!-- Fallback VLM Strategy Note for non-mini-program titles -->
          <div
            v-else
            :class="[
              'flex items-center gap-3 rounded-xl border p-3.5',
              'bg-sky-500/5 border-sky-500/20 text-sky-700 dark:bg-sky-500/10 dark:text-sky-300',
            ]"
          >
            <div class="i-solar:info-circle-bold shrink-0 text-lg" />
            <p class="text-xs leading-relaxed">
              This game's 3D/scrolling motion architecture leverages continuous Vision-Language Model (VLM) co-pilot reasoning rather than deterministic single-screen heuristics.
            </p>
          </div>
        </div>

        <!-- Footer / Action Deck -->
        <div
          :class="[
            'flex items-center justify-between border-t border-neutral-200/60 p-4',
            'bg-neutral-50/80 dark:border-neutral-800/60 dark:bg-neutral-950/60',
          ]"
        >
          <div class="flex items-center gap-2">
            <button
              class="border border-neutral-300 rounded-lg px-3 py-2 text-xs text-neutral-600 font-medium transition-all active:scale-95 dark:border-neutral-700 hover:bg-neutral-100 dark:text-neutral-300 dark:hover:bg-neutral-800"
              @click="emit('close')"
            >
              Exit to Hub
            </button>
            <button
              class="flex items-center gap-1.5 border border-neutral-300 rounded-lg px-3 py-2 text-xs text-neutral-600 font-medium transition-all active:scale-95 dark:border-neutral-700 hover:bg-neutral-100 dark:text-neutral-300 dark:hover:bg-neutral-800"
              @click="emit('recalibrate')"
            >
              <div class="i-solar:restart-bold text-xs" />
              <span>Re-calibrate (15s)</span>
            </button>
          </div>

          <div class="flex items-center gap-2">
            <button
              class="flex items-center gap-1.5 border border-neutral-300 rounded-lg px-3 py-2 text-xs text-neutral-600 font-medium transition-all active:scale-95 dark:border-neutral-700 hover:bg-neutral-100 dark:text-neutral-300 dark:hover:bg-neutral-800"
              title="Regenerate strategy with alternate tactics"
              @click="runSynthesis"
            >
              <div class="i-solar:refresh-bold text-xs" />
              <span>Regenerate</span>
            </button>

            <button
              :class="[
                'flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-bold transition-all shadow-md',
                'bg-primary-500 text-white hover:bg-primary-600 active:scale-95',
              ]"
              @click="handleApprove"
            >
              <div class="i-solar:shield-check-bold text-xs" />
              <span>Approve & Launch Arena</span>
            </button>
          </div>
        </div>
      </DialogContent>
    </DialogPortal>
  </DialogRoot>
</template>
