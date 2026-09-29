<script setup lang="ts">
import type {
  ArcadeProvisioningConfig,
  CatalogGame,
  CompanionPersonaPreset,
  System1EngineChoice,
} from '@proj-airi/stage-ui/types'

import { useConsciousnessStore } from '@proj-airi/stage-ui/stores/modules/consciousness'
import { DialogContent, DialogOverlay, DialogPortal, DialogRoot, DialogTitle } from 'reka-ui'
import { computed, ref, watch } from 'vue'

const props = defineProps<{
  open: boolean
  game: CatalogGame | null
  hasAcquiredKnowledge?: boolean
}>()

const emit = defineEmits<{
  (e: 'close'): void
  (e: 'startCalibration', config: ArcadeProvisioningConfig): void
  (e: 'launchDirect', config: ArcadeProvisioningConfig): void
}>()

const consciousnessStore = useConsciousnessStore()

// State
const selectedSystem1 = ref<System1EngineChoice>('laya_local')
const selectedVlmModel = ref<string>('gemini-2.5-flash')
const selectedPersona = ref<CompanionPersonaPreset>('hype_coach')
const selectedVerbosity = ref<'quiet' | 'balanced' | 'chatty'>('balanced')

// Available Persona Presets
const PERSONA_OPTIONS: Array<{
  id: CompanionPersonaPreset
  name: string
  icon: string
  color: string
  description: string
}> = [
  {
    id: 'hype_coach',
    name: 'Hype Coach',
    icon: 'i-solar:fire-bold',
    color: 'text-orange-500 bg-orange-500/10 border-orange-500/30',
    description: 'Energetic, fast reactions and cheering for clutch moments.',
  },
  {
    id: 'strategic_advisor',
    name: 'Strategic Advisor',
    icon: 'i-solar:diploma-verified-bold',
    color: 'text-sky-500 bg-sky-500/10 border-sky-500/30',
    description: 'Calculated, forward-looking advice for tactical & sim games.',
  },
  {
    id: 'zen_co_pilot',
    name: 'Zen Co-Pilot',
    icon: 'i-solar:leaf-bold',
    color: 'text-emerald-500 bg-emerald-500/10 border-emerald-500/30',
    description: 'Calm, patient guidance for puzzles and relaxed exploration.',
  },
  {
    id: 'snarky_backseater',
    name: 'Snarky Backseater',
    icon: 'i-solar:ghost-bold',
    color: 'text-purple-500 bg-purple-500/10 border-purple-500/30',
    description: 'Teasing humor, retro gaming trivia, and playful commentary.',
  },
]

// Pre-fill intelligently whenever game changes
watch(() => props.game, (game) => {
  if (!game)
    return

  // 1. System 1 Coprocessor
  const recSys = game.classification?.recommended_system
  if (recSys === 'system1_reflex') {
    selectedSystem1.value = 'laya_local'
  }
  else if (recSys === 'system2_strategy') {
    selectedSystem1.value = 'disabled'
  }
  else {
    selectedSystem1.value = 'laya_local'
  }

  // 2. VLM Model (derive from global consciousness if available)
  if (consciousnessStore.activeModel) {
    selectedVlmModel.value = consciousnessStore.activeModel
  }

  // 3. Recommended Persona
  const role = game.classification?.companion_role || ''
  if (role.includes('adviser') || role.includes('strategic')) {
    selectedPersona.value = 'strategic_advisor'
  }
  else if (role.includes('cheerleader') || role.includes('hype')) {
    selectedPersona.value = 'hype_coach'
  }
  else if (role.includes('snark') || role.includes('gremlin')) {
    selectedPersona.value = 'snarky_backseater'
  }
  else if (game.classification?.primary_genre === 'puzzle') {
    selectedPersona.value = 'zen_co_pilot'
  }
  else {
    selectedPersona.value = 'hype_coach'
  }
}, { immediate: true })

const currentConfig = computed<ArcadeProvisioningConfig>(() => ({
  system1Engine: selectedSystem1.value,
  system2Model: selectedVlmModel.value,
  companionPersona: selectedPersona.value,
  commentaryVerbosity: selectedVerbosity.value,
}))

function handleStartCalibration() {
  emit('startCalibration', currentConfig.value)
}

function handleLaunchDirect() {
  emit('launchDirect', currentConfig.value)
}
</script>

<template>
  <DialogRoot :open="open" @update:open="(val: boolean) => { if (!val) emit('close'); }">
    <DialogPortal>
      <DialogOverlay class="backdrop-blur-xs fixed inset-0 z-50 bg-black/60 transition-opacity" />

      <DialogContent
        :class="[
          'fixed left-1/2 top-1/2 z-50 max-h-[90vh] w-full max-w-xl -translate-x-1/2 -translate-y-1/2',
          'flex flex-col overflow-hidden border border-neutral-200/80 rounded-2xl shadow-2xl',
          'bg-white dark:border-neutral-800/80 dark:bg-neutral-900 text-neutral-800 dark:text-neutral-100',
        ]"
      >
        <!-- Modal Header / Game Hero -->
        <div
          v-if="game"
          :class="[
            'relative flex items-center gap-4 border-b border-neutral-200/60 p-4',
            'bg-neutral-50/80 dark:border-neutral-800/60 dark:bg-neutral-950/60',
          ]"
        >
          <!-- Thumbnail -->
          <div class="h-16 w-20 shrink-0 overflow-hidden border border-neutral-200/60 rounded-xl bg-black dark:border-neutral-800">
            <img
              v-if="game.thumbnailUrl"
              :src="game.thumbnailUrl"
              :alt="game.title"
              class="h-full w-full object-cover"
              @error="(e: any) => { e.target.style.display = 'none' }"
            >
            <div v-else class="h-full w-full flex items-center justify-center text-neutral-500">
              <div class="i-solar:gamepad-bold text-xl" />
            </div>
          </div>

          <!-- Title & Classification Badges -->
          <div class="min-w-0 flex-1">
            <div class="flex items-center gap-2">
              <DialogTitle class="truncate text-sm text-neutral-900 font-extrabold dark:text-neutral-50">
                {{ game.title }}
              </DialogTitle>
              <span v-if="game.year" class="text-xs text-neutral-400 font-mono">
                ({{ game.year }})
              </span>
            </div>

            <!-- Facet Badges -->
            <div class="mt-1 flex flex-wrap items-center gap-1.5 text-[10px]">
              <span
                v-if="game.classification?.screen_motion_architecture"
                class="border border-neutral-200 rounded-md bg-white px-2 py-0.5 text-neutral-600 font-bold dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-300"
              >
                {{ game.classification.screen_motion_architecture.replace(/_/g, ' ') }}
              </span>

              <span
                v-if="hasAcquiredKnowledge"
                class="flex items-center gap-1 border border-emerald-500/40 rounded-md bg-emerald-500/10 px-2 py-0.5 text-emerald-600 font-bold dark:text-emerald-400"
              >
                <div class="i-solar:bolt-bold text-[11px]" />
                <span>Knowledge Calibrated</span>
              </span>
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

        <!-- Body Configuration Form -->
        <div class="flex-1 overflow-y-auto p-5 text-xs space-y-4">
          <!-- 1. Gaming System-1 Reflex Engine Override -->
          <div>
            <label class="mb-1.5 flex items-center justify-between text-neutral-700 font-bold dark:text-neutral-200">
              <span>System-1 Gaming Coprocessor</span>
              <span class="text-[10px] text-neutral-400 font-normal">Motor Reflexes (10–60 Hz)</span>
            </label>

            <div class="grid grid-cols-3 gap-2">
              <label
                :class="[
                  'flex flex-col cursor-pointer border rounded-xl p-2.5 transition-all',
                  selectedSystem1 === 'laya_local'
                    ? 'border-emerald-500/60 bg-emerald-500/10 shadow-xs text-emerald-800 dark:text-emerald-300'
                    : 'border-neutral-200/80 dark:border-neutral-800 bg-neutral-50 dark:bg-neutral-800/50 text-neutral-600 dark:text-neutral-400',
                ]"
              >
                <div class="flex items-center justify-between">
                  <span class="font-bold">Laya Local</span>
                  <input v-model="selectedSystem1" type="radio" value="laya_local" class="accent-emerald-500">
                </div>
                <span class="mt-1 text-[10px] text-emerald-600 font-semibold dark:text-emerald-400">$0 Free &bull; 15–35ms</span>
                <span class="mt-0.5 text-[9px] text-neutral-400 leading-tight">WebGPU ONNX runtime inside browser</span>
              </label>

              <label
                :class="[
                  'flex flex-col cursor-pointer border rounded-xl p-2.5 transition-all',
                  selectedSystem1 === 'jev_cloud'
                    ? 'border-purple-500/60 bg-purple-500/10 shadow-xs text-purple-800 dark:text-purple-300'
                    : 'border-neutral-200/80 dark:border-neutral-800 bg-neutral-50 dark:bg-neutral-800/50 text-neutral-600 dark:text-neutral-400',
                ]"
              >
                <div class="flex items-center justify-between">
                  <span class="font-bold">TypeSafe Jev</span>
                  <input v-model="selectedSystem1" type="radio" value="jev_cloud" class="accent-purple-500">
                </div>
                <span class="mt-1 text-[10px] text-purple-600 font-semibold dark:text-purple-400">$42/Btok &bull; 90–150ms</span>
                <span class="mt-0.5 text-[9px] text-neutral-400 leading-tight">Zero-shot discrete decision API</span>
              </label>

              <label
                :class="[
                  'flex flex-col cursor-pointer border rounded-xl p-2.5 transition-all',
                  selectedSystem1 === 'disabled'
                    ? 'border-neutral-400 bg-neutral-200/40 dark:border-neutral-600 dark:bg-neutral-800 text-neutral-800 dark:text-neutral-200'
                    : 'border-neutral-200/80 dark:border-neutral-800 bg-neutral-50 dark:bg-neutral-800/50 text-neutral-600 dark:text-neutral-400',
                ]"
              >
                <div class="flex items-center justify-between">
                  <span class="font-bold">Pure VLM</span>
                  <input v-model="selectedSystem1" type="radio" value="disabled" class="accent-neutral-500">
                </div>
                <span class="mt-1 text-[10px] text-neutral-500 font-semibold">Disabled</span>
                <span class="mt-0.5 text-[9px] text-neutral-400 leading-tight">Turn-based / Strategy only</span>
              </label>
            </div>
          </div>

          <!-- 2. System-2 VLM Strategy Model -->
          <div>
            <label class="mb-1.5 flex items-center justify-between text-neutral-700 font-bold dark:text-neutral-200">
              <span>System-2 VLM Model</span>
              <span class="text-[10px] text-neutral-400 font-normal">Spatial Perception & Strategy</span>
            </label>

            <select
              v-model="selectedVlmModel"
              :class="[
                'w-full border border-neutral-200/80 rounded-xl px-3 py-2 text-xs font-semibold',
                'bg-neutral-50 dark:border-neutral-700/80 dark:bg-neutral-800 text-neutral-800 dark:text-neutral-100 outline-none',
              ]"
            >
              <option value="gemini-2.5-flash">
                Google Gemini 2.5 Flash (Fast Multimodal)
              </option>
              <option value="gpt-4o">
                OpenAI GPT-4o (High-Precision Vision)
              </option>
              <option value="claude-3-5-sonnet">
                Anthropic Claude 3.5 Sonnet (Advanced Spatial)
              </option>
              <option value="moondream-webgpu">
                Moondream 2 (Local WebGPU $0)
              </option>
            </select>
          </div>

          <!-- 3. Companion Persona Recommendation -->
          <div>
            <label class="mb-1.5 flex items-center justify-between text-neutral-700 font-bold dark:text-neutral-200">
              <span>Airi Companion Persona</span>
              <span class="text-[10px] text-primary-500 font-semibold">Auto-recommended from genre</span>
            </label>

            <div class="grid grid-cols-2 gap-2">
              <label
                v-for="persona in PERSONA_OPTIONS"
                :key="persona.id"
                :class="[
                  'flex flex-col cursor-pointer border rounded-xl p-2.5 transition-all',
                  selectedPersona === persona.id
                    ? `${persona.color} shadow-xs font-bold`
                    : 'border-neutral-200/80 dark:border-neutral-800 bg-neutral-50 dark:bg-neutral-800/50 text-neutral-600 dark:text-neutral-400',
                ]"
              >
                <div class="flex items-center justify-between">
                  <div class="flex items-center gap-1.5">
                    <div :class="[persona.icon, 'text-sm']" />
                    <span>{{ persona.name }}</span>
                  </div>
                  <input v-model="selectedPersona" type="radio" :value="persona.id" class="accent-primary-500">
                </div>
                <span class="mt-1 text-[10px] font-normal leading-tight opacity-80">
                  {{ persona.description }}
                </span>
              </label>
            </div>
          </div>
        </div>

        <!-- Footer Actions -->
        <div
          :class="[
            'flex items-center justify-between border-t border-neutral-200/60 p-4',
            'bg-neutral-50/80 dark:border-neutral-800/60 dark:bg-neutral-950/60',
          ]"
        >
          <button
            class="text-xs text-neutral-500 font-semibold hover:text-neutral-800 dark:hover:text-neutral-200"
            @click="emit('close')"
          >
            Cancel
          </button>

          <div class="flex items-center gap-2">
            <!-- Direct Launch Button -->
            <button
              :class="[
                'border border-neutral-300 dark:border-neutral-700 rounded-xl px-3 py-2 text-xs font-bold',
                'bg-white dark:bg-neutral-800 text-neutral-700 dark:text-neutral-200 hover:bg-neutral-100',
                'active:scale-95 transition-all shadow-2xs',
              ]"
              title="Launch directly into the Arena without running calibration"
              @click="handleLaunchDirect"
            >
              <span>{{ hasAcquiredKnowledge ? 'Launch with Saved Knowledge' : 'Skip Calibration & Play' }}</span>
            </button>

            <!-- Calibration Button (Recommended for uncalibrated) -->
            <button
              :class="[
                'flex items-center gap-1.5 rounded-xl px-4 py-2 text-xs font-extrabold text-white',
                'bg-primary-500 hover:bg-primary-600 active:scale-95 transition-all shadow-md',
              ]"
              title="Record a 15-second human demonstration so Airi can learn game physics and synthesize a mini-program"
              @click="handleStartCalibration"
            >
              <div class="i-solar:radar-2-bold text-xs" />
              <span>Calibrate Airi (15s)</span>
            </button>
          </div>
        </div>
      </DialogContent>
    </DialogPortal>
  </DialogRoot>
</template>
