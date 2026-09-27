<script setup lang="ts">
import { POLLINATIONS_DEFAULT_MODELS, REPLICATE_IMAGEGEN_PRESETS } from '@proj-airi/stage-shared'
import { BrainModelPicker } from '@proj-airi/stage-ui/components/scenarios/chat'
import { useArtistryStore } from '@proj-airi/stage-ui/stores/modules/artistry'
import { useConsciousnessStore } from '@proj-airi/stage-ui/stores/modules/consciousness'
import { FieldInput } from '@proj-airi/ui'
import { Select } from '@proj-airi/ui/components/form'
import { computed, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'

defineProps<{
  artistryProviderOptions: { value: string, label: string }[]
  defaultArtistryProviderPlaceholder: string
}>()

const emit = defineEmits<{
  (e: 'sparkle-click', fieldId: string): void
  (e: 'extract-tags-click', fieldId: string): void
}>()

const selectedArtistryProvider = defineModel<string>('selectedArtistryProvider', { required: true })
const selectedArtistryModel = defineModel<string>('selectedArtistryModel', { required: true })
const selectedArtistryPromptPrefix = defineModel<string>('selectedArtistryPromptPrefix', { required: true })
const selectedArtistryWidgetInstruction = defineModel<string>('selectedArtistryWidgetInstruction', { required: true })
const selectedArtistryAutonomousEnabled = defineModel<boolean>('selectedArtistryAutonomousEnabled', { required: true })
const selectedArtistryAutonomousThreshold = defineModel<number>('selectedArtistryAutonomousThreshold', { required: true })
const selectedArtistryAutonomousMonitorEnabled = defineModel<boolean>('selectedArtistryAutonomousMonitorEnabled', { required: false, default: true })
const selectedArtistryAutonomousMonitorDiscordEnabled = defineModel<boolean>('selectedArtistryAutonomousMonitorDiscordEnabled', { required: false, default: false })
const selectedArtistryAutonomousTarget = defineModel<'user' | 'assistant'>('selectedArtistryAutonomousTarget', { required: true })
const selectedArtistryAutonomousHistoryDepth = defineModel<number>('selectedArtistryAutonomousHistoryDepth', { required: false, default: 3 })
const selectedArtistryAutonomousModelMode = defineModel<'inherit' | 'custom'>('selectedArtistryAutonomousModelMode', { required: false, default: 'inherit' })
const selectedArtistryAutonomousProvider = defineModel<string>('selectedArtistryAutonomousProvider', { required: false, default: '' })
const selectedArtistryAutonomousModel = defineModel<string>('selectedArtistryAutonomousModel', { required: false, default: '' })
const selectedArtistrySpawnMode = defineModel<'bg' | 'widget' | 'inline' | 'bg_widget'>('selectedArtistrySpawnMode', { required: true })
const selectedArtistryConfigStr = defineModel<string>('selectedArtistryConfigStr', { required: true })

const { t } = useI18n()

// Sub-Tab Navigation State
type ArtistrySubTabId = 'autonomous' | 'engine' | 'presentation'
const activeSubTab = ref<ArtistrySubTabId>('autonomous')

const subTabs = [
  {
    id: 'autonomous' as const,
    label: 'Director',
    icon: 'i-solar:magic-stick-3-bold-duotone',
    desc: 'Director evaluation loop',
  },
  {
    id: 'engine' as const,
    label: 'Engine',
    icon: 'i-solar:palette-bold-duotone',
    desc: 'Backend provider & model',
  },
  {
    id: 'presentation' as const,
    label: 'Presentation',
    icon: 'i-solar:gallery-round-bold-duotone',
    desc: 'Visual triggers & routing',
  },
]

const consciousnessStore = useConsciousnessStore()
const artistryStore = useArtistryStore()
const comfyuiWorkflows = computed(() => artistryStore.comfyuiSavedWorkflows || [])

const isRefreshingPollinations = ref(false)

const pollinationsModelList = computed(() => {
  if (artistryStore.pollinationsCachedModels.length === 0)
    return POLLINATIONS_DEFAULT_MODELS
  return artistryStore.pollinationsCachedModels
})

const pollinationsModelSelectOptions = computed(() => {
  return pollinationsModelList.value.map(m => ({
    value: m.id,
    label: m.id === ''
      ? 'Free Router (Pollinations Auto)'
      : (m.price ? `${m.name} (${m.price})` : m.name),
  }))
})

async function refreshPollinations() {
  isRefreshingPollinations.value = true
  try {
    await artistryStore.fetchPollinationsModels(true)
  }
  finally {
    isRefreshingPollinations.value = false
  }
}

onMounted(() => {
  if (artistryStore.pollinationsCachedModels.length === 0) {
    artistryStore.fetchPollinationsModels()
  }
})

const nanobananaModelPresets = [
  { id: 'gemini-3.1-flash-image-preview', label: 'Nano Banana 2', sub: 'Gemini 3.1 Flash' },
  { id: 'gemini-3-pro-image-preview', label: 'Nano Banana Pro', sub: 'Gemini 3 Pro' },
  { id: 'gemini-2.5-flash-image', label: 'Nano Banana', sub: 'Gemini 2.5 Flash' },
]

const replicateModelOptions = computed(() => {
  return REPLICATE_IMAGEGEN_PRESETS.map(p => ({
    label: `${p.label} (${p.cost})`,
    value: p.id,
  }))
})

function handlePollinationsSelect(modelId: string) {
  selectedArtistryModel.value = modelId
}

function handleNanobananaSelect(modelId: string) {
  selectedArtistryModel.value = modelId
}

const spawnModeOptions = computed(() => [
  { value: 'bg', label: t('settings.pages.modules.artistry.spawn_mode.options.bg') },
  { value: 'inline', label: t('settings.pages.modules.artistry.spawn_mode.options.inline') },
  { value: 'widget', label: t('settings.pages.modules.artistry.spawn_mode.options.widget') },
  { value: 'bg_widget', label: t('settings.pages.modules.artistry.spawn_mode.options.bg_widget') },
])
const autonomousTargetOptions = computed(() => [
  { value: 'user', label: 'User Input (Standard)' },
  { value: 'assistant', label: 'Companion Reaction (Impact Focus)' },
])
const autonomousModelModeOptions = computed(() => [
  { value: 'inherit', label: 'Inherit Active LLM' },
  { value: 'custom', label: 'Custom LLM Override' },
])
const inheritedModelDisplay = computed(() => {
  const provider = consciousnessStore.activeProvider || 'None'
  const model = consciousnessStore.activeModel || 'None'
  return `${provider} / ${model}`
})

function handleModelSelect(model: any) {
  selectedArtistryModel.value = model.id
  selectedArtistryPromptPrefix.value = model.prompt || ''
  selectedArtistryConfigStr.value = JSON.stringify(model.preset, null, 2)
}

function handleComfyWorkflowSelect(wf: any) {
  selectedArtistryModel.value = wf.id
  selectedArtistryConfigStr.value = JSON.stringify({ template: wf.id }, null, 2)
  pendingInstructionWf.value = wf
}

const pendingInstructionWf = ref<any>(null)

function generateAgentInstructions(wf: any) {
  return TOOL_CALL_TEMPLATE
}

function applyRecommendedInstructions() {
  if (!pendingInstructionWf.value)
    return
  selectedArtistryWidgetInstruction.value = generateAgentInstructions(pendingInstructionWf.value)
  pendingInstructionWf.value = null
}

function getExposedFieldsCount(wf: any) {
  if (!wf.exposedFields)
    return 0
  return Object.values(wf.exposedFields).reduce((n: number, arr: any) => n + (arr?.length || 0), 0)
}

function openReplicateModel() {
  if (!selectedArtistryModel.value)
    return
  window.open(`https://replicate.com/${selectedArtistryModel.value}`, '_blank')
}

const TOOL_CALL_TEMPLATE = `## Instruction: Image Journaling
You possess the **image_journal** tool to manifest your digital captures. You MUST use it frequently to visualize the scene or yourself.

### How to Use
- **Action**: Always use "create".
- **Prompt**: A detailed description of the image.
- **Mode**: Choose "inline" (chat history), "widget" (overlay), or "bg" (background).`

const TOKEN_TEMPLATE = `## Instruction: Image Journaling (Token Style)
You can manifest images by using the following token format in your response:
\\\`<|image_journal: action="create", prompt="...", title="...", mode="widget"|>\\\`
Replace \\\`widget\\\` with \\\`bg\\\` or \\\`inline\\\` as needed.`

function applyToolCallTemplate() {
  selectedArtistryWidgetInstruction.value = TOOL_CALL_TEMPLATE
}

function applyTokenTemplate() {
  selectedArtistryWidgetInstruction.value = TOKEN_TEMPLATE
}
</script>

<template>
  <div class="tab-content ml-auto mr-auto w-95% flex flex-col gap-5">
    <!-- Header Subtitle -->
    <div class="flex flex-col gap-1">
      <h3 class="text-base text-neutral-800 font-semibold dark:text-neutral-100">
        Artistry & Visual Synthesis
      </h3>
      <p class="text-xs text-neutral-500 dark:text-neutral-400">
        Configure how this character renders artwork, visual style triggers, presentation routing, and autonomous scene director evaluation.
      </p>
    </div>

    <!-- Sub-Navigation Segmented Pill Bar -->
    <div class="grid grid-cols-3 gap-1.5 border border-neutral-200 rounded-xl bg-neutral-100/70 p-1.5 dark:border-neutral-800 dark:bg-neutral-900/60">
      <button
        v-for="tab in subTabs"
        :key="tab.id"
        type="button"
        :class="[
          'flex items-center justify-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium transition-all duration-150 whitespace-nowrap',
          activeSubTab === tab.id
            ? 'bg-white dark:bg-neutral-800 text-primary-600 dark:text-primary-400 shadow-sm border border-neutral-200/80 dark:border-neutral-700 font-bold'
            : 'text-neutral-600 dark:text-neutral-400 hover:text-neutral-900 dark:hover:text-neutral-200 hover:bg-neutral-200/50 dark:hover:bg-neutral-800/50',
        ]"
        @click="activeSubTab = tab.id"
      >
        <span :class="[tab.icon, 'text-base shrink-0']" />
        <span class="truncate">{{ tab.label }}</span>
      </button>
    </div>

    <!-- ================================================================= -->
    <!-- SUB-TAB PANELS CONTAINER                                          -->
    <!-- ================================================================= -->
    <div class="border border-neutral-200/80 rounded-xl bg-white/70 p-5 shadow-sm dark:border-neutral-800 dark:bg-neutral-900/40">
      <!-- ================================================================= -->
      <!-- 1. AUTONOMOUS DIRECTOR SUB-TAB                                    -->
      <!-- ================================================================= -->
      <div v-if="activeSubTab === 'autonomous'" class="flex flex-col gap-6">
        <div class="flex items-center justify-between border-b border-neutral-100 pb-3 dark:border-neutral-800">
          <div class="flex flex-col gap-0.5">
            <div class="flex items-center gap-2">
              <div class="i-solar:magic-stick-3-bold-duotone text-lg text-primary-500" />
              <h4 class="text-sm text-neutral-800 font-semibold dark:text-neutral-100">
                Cinematic Autonomy (Autonomous Director)
              </h4>
            </div>
            <p class="pl-6 text-xs text-neutral-500 dark:text-neutral-400">
              A parallel 2nd-LLM evaluator that analyzes ongoing conversation and autonomously synthesizes background imagery.
            </p>
          </div>

          <button
            type="button"
            :class="[
              'relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none',
              selectedArtistryAutonomousEnabled ? 'bg-primary-600' : 'bg-neutral-200 dark:bg-neutral-700',
            ]"
            @click="selectedArtistryAutonomousEnabled = !selectedArtistryAutonomousEnabled"
          >
            <span
              aria-hidden="true"
              :class="[
                'pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out',
                selectedArtistryAutonomousEnabled ? 'translate-x-5' : 'translate-x-0',
              ]"
            />
          </button>
        </div>

        <div v-if="selectedArtistryAutonomousEnabled" class="flex flex-col animate-fade-in gap-5">
          <!-- Threshold Range Slider -->
          <div class="flex flex-col gap-2 border border-neutral-100 rounded-xl bg-neutral-50/60 p-4 dark:border-neutral-800 dark:bg-neutral-950/30">
            <div class="flex items-center justify-between">
              <label class="text-xs text-neutral-700 font-semibold dark:text-neutral-300">
                Manifestation Sensitivity Threshold
              </label>
              <span class="rounded bg-primary-500/10 px-2 py-0.5 text-xs text-primary-600 font-bold font-mono dark:text-primary-400">
                {{ selectedArtistryAutonomousThreshold }}%
              </span>
            </div>
            <input
              v-model.number="selectedArtistryAutonomousThreshold"
              type="range"
              min="0"
              max="100"
              step="1"
              class="h-2 w-full cursor-pointer appearance-none rounded-lg bg-neutral-200 accent-primary-500 dark:bg-neutral-700"
            >
            <div class="flex justify-between text-[10px] text-neutral-400 tracking-tighter uppercase">
              <span>Frequent Generation (0%)</span>
              <span>Strict Climaxes (100%)</span>
            </div>
          </div>

          <!-- Evaluation Target & Context Depth -->
          <div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div class="w-full flex flex-col gap-1.5">
              <label class="text-xs text-neutral-700 font-semibold dark:text-neutral-300">
                Evaluation Target
              </label>
              <Select
                v-model="selectedArtistryAutonomousTarget"
                :options="autonomousTargetOptions"
                class="w-full text-xs"
              />
              <p class="text-[10px] text-neutral-400">
                Whether the Director judges User Prompts or Companion Reactions.
              </p>
            </div>

            <div class="w-full flex flex-col gap-1.5">
              <div class="flex items-center justify-between">
                <label class="text-xs text-neutral-700 font-semibold dark:text-neutral-300">
                  Context History Depth
                </label>
                <span class="text-xs text-primary-600 font-bold font-mono dark:text-primary-400">
                  {{ selectedArtistryAutonomousHistoryDepth || 3 }} turns
                </span>
              </div>
              <input
                v-model.number="selectedArtistryAutonomousHistoryDepth"
                type="range"
                min="1"
                max="12"
                step="1"
                class="h-2 w-full cursor-pointer appearance-none rounded-lg bg-neutral-200 accent-primary-500 dark:bg-neutral-700"
              >
              <p class="text-[10px] text-neutral-400">
                Turns of conversation history provided to the Director.
              </p>
            </div>
          </div>

          <!-- Surface Monitors -->
          <div class="grid grid-cols-1 gap-3 border-t border-neutral-100 pt-3 sm:grid-cols-2 dark:border-neutral-800">
            <div class="flex items-center justify-between border border-neutral-200/80 rounded-xl bg-neutral-50/50 p-3 dark:border-neutral-800 dark:bg-neutral-900/30">
              <div class="flex flex-col">
                <span class="text-xs text-neutral-700 font-semibold dark:text-neutral-300">Desktop Director Notes</span>
                <span class="text-[10px] text-neutral-400">Show grading notes in Desktop chat logs</span>
              </div>
              <button
                type="button"
                :class="[
                  'relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200',
                  selectedArtistryAutonomousMonitorEnabled ? 'bg-primary-600' : 'bg-neutral-200 dark:bg-neutral-700',
                ]"
                @click="selectedArtistryAutonomousMonitorEnabled = !selectedArtistryAutonomousMonitorEnabled"
              >
                <span
                  :class="[
                    'pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow transition duration-200',
                    selectedArtistryAutonomousMonitorEnabled ? 'translate-x-4' : 'translate-x-0',
                  ]"
                />
              </button>
            </div>

            <div class="flex items-center justify-between border border-neutral-200/80 rounded-xl bg-neutral-50/50 p-3 dark:border-neutral-800 dark:bg-neutral-900/30">
              <div class="flex flex-col">
                <span class="text-xs text-neutral-700 font-semibold dark:text-neutral-300">Discord Director Notes</span>
                <span class="text-[10px] text-neutral-400">Include reasoning in Discord captions</span>
              </div>
              <button
                type="button"
                :class="[
                  'relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200',
                  selectedArtistryAutonomousMonitorDiscordEnabled ? 'bg-primary-600' : 'bg-neutral-200 dark:bg-neutral-700',
                ]"
                @click="selectedArtistryAutonomousMonitorDiscordEnabled = !selectedArtistryAutonomousMonitorDiscordEnabled"
              >
                <span
                  :class="[
                    'pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow transition duration-200',
                    selectedArtistryAutonomousMonitorDiscordEnabled ? 'translate-x-4' : 'translate-x-0',
                  ]"
                />
              </button>
            </div>
          </div>

          <!-- Director LLM Brain Picker -->
          <div class="flex flex-col gap-2 border-t border-neutral-100 pt-3 dark:border-neutral-800">
            <label class="text-xs text-neutral-700 font-semibold dark:text-neutral-300">
              Director Evaluation LLM Brain
            </label>
            <div class="flex items-center gap-2">
              <Select
                v-model="selectedArtistryAutonomousModelMode"
                :options="autonomousModelModeOptions"
                class="flex-1 text-xs"
              />
              <BrainModelPicker
                v-if="selectedArtistryAutonomousModelMode === 'custom'"
                v-model:provider="selectedArtistryAutonomousProvider"
                v-model:model="selectedArtistryAutonomousModel"
                variant="button"
                title="Select Director Evaluation Model"
                side="bottom"
              />
            </div>
            <p v-if="selectedArtistryAutonomousModelMode === 'inherit'" class="text-[11px] text-neutral-400">
              Inherits active companion LLM: <span class="text-neutral-600 font-semibold font-mono dark:text-neutral-300">{{ inheritedModelDisplay }}</span>
            </p>
            <p v-else class="text-[11px] text-neutral-400">
              Dedicated lightweight LLM model assigned specifically to visual scene grading.
            </p>
          </div>
        </div>

        <div v-else class="flex flex-col items-center justify-center p-6 text-center text-neutral-400">
          <div class="i-solar:forbidden-circle-bold-duotone text-3xl opacity-40" />
          <p class="mt-2 text-xs font-medium">
            Autonomous Artist is currently disabled.
          </p>
          <p class="text-[10px] text-neutral-400">
            Toggle the switch above to configure background scene generation.
          </p>
        </div>
      </div>

      <!-- ================================================================= -->
      <!-- 2. ENGINE & MODEL SUB-TAB                                         -->
      <!-- ================================================================= -->
      <div v-else-if="activeSubTab === 'engine'" class="flex flex-col gap-6">
        <div class="flex items-center justify-between border-b border-neutral-100 pb-3 dark:border-neutral-800">
          <div class="flex flex-col gap-0.5">
            <div class="flex items-center gap-2">
              <div class="i-solar:palette-bold-duotone text-lg text-primary-500" />
              <h4 class="text-sm text-neutral-800 font-semibold dark:text-neutral-100">
                Image Generation Backend & Model
              </h4>
            </div>
            <p class="pl-6 text-xs text-neutral-500 dark:text-neutral-400">
              Select the engine and model used when this character generates images.
            </p>
          </div>
        </div>

        <div class="flex flex-col gap-5">
          <!-- Provider Picker -->
          <div class="w-full flex flex-col gap-2">
            <label class="text-xs text-neutral-700 font-semibold dark:text-neutral-300">
              Artistry Provider Override
            </label>
            <Select
              v-model="selectedArtistryProvider"
              :options="artistryProviderOptions"
              :placeholder="defaultArtistryProviderPlaceholder"
              class="w-full"
            />
          </div>

          <!-- Pollinations AI Selector -->
          <div
            v-if="selectedArtistryProvider === 'pollinations'"
            class="flex flex-col gap-3 border border-neutral-100 rounded-xl bg-neutral-50/60 p-4 dark:border-neutral-800 dark:bg-neutral-950/30"
          >
            <div class="flex items-center justify-between">
              <span class="text-xs text-neutral-700 font-semibold dark:text-neutral-300">
                Pollinations Quick Pick (Free & Pollen)
              </span>
              <button
                type="button"
                class="flex items-center gap-1 text-[11px] text-neutral-500 transition-colors hover:text-neutral-800 dark:hover:text-neutral-200"
                :disabled="isRefreshingPollinations"
                @click="refreshPollinations"
              >
                <div
                  class="i-solar:refresh-bold-duotone text-xs"
                  :class="{ 'animate-spin': isRefreshingPollinations }"
                />
                <span>{{ isRefreshingPollinations ? 'Refreshing...' : 'Refresh Catalog' }}</span>
              </button>
            </div>

            <div class="grid grid-cols-2 gap-2.5 sm:grid-cols-3">
              <button
                v-for="model in pollinationsModelList.slice(0, 6)"
                :key="model.id"
                type="button"
                :class="[
                  'flex flex-col items-center justify-center rounded-xl border p-3 transition-all',
                  selectedArtistryModel === model.id
                    ? 'border-emerald-500 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 font-bold shadow-sm'
                    : 'border-neutral-200 bg-white hover:border-emerald-300 dark:border-neutral-700 dark:bg-neutral-800',
                ]"
                @click="handlePollinationsSelect(model.id)"
              >
                <span class="text-center text-xs">{{ model.name }}</span>
                <span class="mt-1 text-[10px] opacity-60">{{ model.price || 'Free Auto' }}</span>
              </button>
            </div>

            <div class="mt-2 w-full flex flex-col gap-1.5">
              <label class="text-[11px] text-neutral-500 dark:text-neutral-400">Full Catalog Dropdown:</label>
              <Select
                v-model="selectedArtistryModel"
                :options="pollinationsModelSelectOptions"
                placeholder="Free Router (Pollinations Auto)"
                class="w-full text-xs"
              />
            </div>
          </div>

          <!-- Nano Banana Selector -->
          <div
            v-if="selectedArtistryProvider === 'nanobanana'"
            class="flex flex-col gap-3 border border-neutral-100 rounded-xl bg-neutral-50/60 p-4 dark:border-neutral-800 dark:bg-neutral-950/30"
          >
            <span class="text-xs text-neutral-700 font-semibold dark:text-neutral-300">
              Gemini Image Model Preset
            </span>
            <div class="grid grid-cols-3 gap-2.5">
              <button
                v-for="model in nanobananaModelPresets"
                :key="model.id"
                type="button"
                :class="[
                  'flex flex-col items-center justify-center rounded-xl border p-3 transition-all',
                  selectedArtistryModel === model.id
                    ? 'border-amber-500 bg-amber-500/10 text-amber-600 dark:text-amber-400 font-bold shadow-sm'
                    : 'border-neutral-200 bg-white hover:border-amber-300 dark:border-neutral-700 dark:bg-neutral-800',
                ]"
                @click="handleNanobananaSelect(model.id)"
              >
                <span class="text-xs">{{ model.label }}</span>
                <span class="mt-1 text-[10px] opacity-60">{{ model.sub }}</span>
              </button>
            </div>
          </div>

          <!-- Replicate Selector -->
          <div
            v-if="selectedArtistryProvider === 'replicate'"
            class="flex flex-col gap-3 border border-neutral-100 rounded-xl bg-neutral-50/60 p-4 dark:border-neutral-800 dark:bg-neutral-950/30"
          >
            <span class="text-xs text-neutral-700 font-semibold dark:text-neutral-300">
              Replicate Cloud Model Presets
            </span>
            <div class="grid grid-cols-2 gap-2.5 sm:grid-cols-3">
              <button
                v-for="model in REPLICATE_IMAGEGEN_PRESETS"
                :key="model.id"
                type="button"
                :class="[
                  'flex flex-col items-center justify-center rounded-xl border p-3 transition-all',
                  selectedArtistryModel === model.id
                    ? 'border-primary-500 bg-primary-500/10 text-primary-600 dark:text-primary-400 font-bold shadow-sm'
                    : 'border-neutral-200 bg-white hover:border-primary-300 dark:border-neutral-700 dark:bg-neutral-800',
                ]"
                @click="handleModelSelect(model)"
              >
                <span class="text-center text-xs">{{ model.label }}</span>
                <span class="mt-1 text-[10px] opacity-60">{{ model.cost }}</span>
              </button>
            </div>

            <div class="mt-2 w-full flex flex-col gap-1.5">
              <label class="text-[11px] text-neutral-500 dark:text-neutral-400">All Replicate Presets:</label>
              <Select
                v-model="selectedArtistryModel"
                :options="replicateModelOptions"
                class="w-full text-xs"
              />
            </div>
          </div>

          <!-- ComfyUI Workflows -->
          <div
            v-if="selectedArtistryProvider === 'comfyui'"
            class="flex flex-col gap-3 border border-neutral-100 rounded-xl bg-neutral-50/60 p-4 dark:border-neutral-800 dark:bg-neutral-950/30"
          >
            <div class="flex items-center justify-between">
              <span class="text-xs text-neutral-700 font-semibold dark:text-neutral-300">
                ComfyUI Workflow Templates
              </span>
            </div>

            <div
              v-if="comfyuiWorkflows.length === 0"
              class="flex items-center gap-3 border border-amber-500/20 rounded-xl bg-amber-500/5 p-4 text-xs text-amber-600 dark:text-amber-400"
            >
              <div class="i-solar:info-circle-bold-duotone shrink-0 text-base" />
              <p>
                No ComfyUI workflows configured. Upload a workflow in Settings → Providers → ComfyUI.
              </p>
            </div>
            <div v-else class="grid grid-cols-2 gap-2.5">
              <button
                v-for="wf in comfyuiWorkflows"
                :key="wf.id"
                type="button"
                :class="[
                  'flex flex-col items-center justify-center rounded-xl border p-3 transition-all',
                  selectedArtistryModel === wf.id
                    ? 'border-primary-500 bg-primary-500/10 text-primary-600 dark:text-primary-400 font-bold shadow-sm'
                    : 'border-neutral-200 bg-white hover:border-primary-300 dark:border-neutral-700 dark:bg-neutral-800',
                ]"
                @click="handleComfyWorkflowSelect(wf)"
              >
                <span class="text-xs font-bold">{{ wf.name }}</span>
                <span class="mt-1 text-[10px] opacity-60">{{ getExposedFieldsCount(wf) }} exposed fields</span>
              </button>
            </div>

            <!-- Specialized Instruction Notification -->
            <div
              v-if="pendingInstructionWf"
              class="flex flex-col gap-2 border border-indigo-500/20 rounded-xl bg-indigo-500/5 p-3.5"
            >
              <div class="flex items-center gap-1.5 text-xs text-indigo-600 font-bold dark:text-indigo-400">
                <div class="i-solar:magic-stick-bold-duotone text-sm" />
                <span>Specialized Workflow Tool Prompt Ready</span>
              </div>
              <p class="text-[11px] text-neutral-600 leading-tight dark:text-neutral-400">
                A customized tool instruction is recommended for <strong>{{ pendingInstructionWf.name }}</strong> so the companion knows how to fill exposed nodes.
              </p>
              <div class="mt-1 flex items-center gap-2">
                <button
                  type="button"
                  class="rounded-lg bg-indigo-500 px-3 py-1.5 text-xs text-white font-medium hover:bg-indigo-600"
                  @click="applyRecommendedInstructions"
                >
                  Apply Prompt
                </button>
                <button
                  type="button"
                  class="rounded-lg bg-neutral-200 px-3 py-1.5 text-xs text-neutral-600 font-medium dark:bg-neutral-800 hover:bg-neutral-300 dark:text-neutral-400"
                  @click="pendingInstructionWf = null"
                >
                  Dismiss
                </button>
              </div>
            </div>
          </div>

          <!-- Model Identifier Textfield Override -->
          <div class="relative w-full">
            <FieldInput
              v-model="selectedArtistryModel"
              label="Artistry Model Identifier"
              description="Model string or workflow ID passed to the provider"
              placeholder="e.g. flux, gemini-3.1-flash-image-preview, black-forest-labs/flux-schnell"
            />
            <button
              v-if="selectedArtistryProvider === 'replicate' && selectedArtistryModel"
              type="button"
              class="absolute right-3 top-9 rounded-md p-1 text-neutral-400 transition-colors hover:bg-neutral-100 hover:text-primary-500 dark:hover:bg-neutral-800"
              title="Open on Replicate"
              @click="openReplicateModel"
            >
              <div class="i-solar:link-round-bold-duotone text-xl" />
            </button>
          </div>

          <!-- Advanced JSON Options -->
          <FieldInput
            v-model="selectedArtistryConfigStr"
            label="Artistry Provider Options (JSON)"
            description="Raw options object (e.g. width, height, steps, guidance)"
            :single-line="false"
            :rows="4"
          />
        </div>
      </div>

      <!-- ================================================================= -->
      <!-- 2. STYLE, PRESENTATION & TOOL SUB-TAB                             -->
      <!-- ================================================================= -->
      <div v-else-if="activeSubTab === 'presentation'" class="flex flex-col gap-6">
        <div class="flex items-center justify-between border-b border-neutral-100 pb-3 dark:border-neutral-800">
          <div class="flex flex-col gap-0.5">
            <div class="flex items-center gap-2">
              <div class="i-solar:gallery-round-bold-duotone text-lg text-primary-500" />
              <h4 class="text-sm text-neutral-800 font-semibold dark:text-neutral-100">
                Visual Style, Routing & Tool Calling
              </h4>
            </div>
            <p class="pl-6 text-xs text-neutral-500 dark:text-neutral-400">
              Configure character visual appearance tags, where artwork manifests, and the assistant's image tool instructions.
            </p>
          </div>
        </div>

        <div class="flex flex-col gap-5">
          <!-- Spawn Mode Routing -->
          <div class="w-full flex flex-col gap-2">
            <label class="text-xs text-neutral-700 font-semibold dark:text-neutral-300">
              {{ t('settings.pages.modules.artistry.spawn_mode.label') }}
            </label>
            <Select
              v-model="selectedArtistrySpawnMode"
              :options="spawnModeOptions"
              class="w-full"
            />
            <p class="text-[11px] text-neutral-400">
              {{ t('settings.pages.modules.artistry.spawn_mode.description') }}
            </p>
          </div>

          <!-- Visual Style / Prompt Prefix -->
          <div class="flex flex-col gap-2 border-t border-neutral-100 pt-3 dark:border-neutral-800">
            <div class="flex items-center justify-between">
              <div>
                <label class="text-xs text-neutral-700 font-semibold dark:text-neutral-300">
                  Character Visual Style & LoRA Prefix
                </label>
                <p class="text-[11px] text-neutral-400">
                  Pre-pended to every image generation prompt for consistent appearance, art style, and triggers.
                </p>
              </div>
            </div>

            <div class="relative w-full">
              <textarea
                v-model="selectedArtistryPromptPrefix"
                rows="4"
                placeholder="e.g. Masterpiece, best quality, 1girl, silver hair, blue eyes, anime watercolor style,"
                class="w-full border border-neutral-200 rounded-xl bg-neutral-50/80 p-3 pr-20 text-xs text-neutral-800 leading-relaxed outline-none transition-all dark:border-neutral-700 focus:border-primary-500 dark:bg-neutral-800/40 dark:text-neutral-200 focus:ring-1 focus:ring-primary-500"
              />
              <div class="absolute right-2 top-2 z-10 flex items-center gap-1">
                <button
                  type="button"
                  class="size-7 flex items-center justify-center rounded-lg text-neutral-400 transition-colors hover:bg-neutral-200/60 hover:text-primary-500 dark:hover:bg-neutral-700"
                  title="Extract tags from model preview (WD14)"
                  @click.prevent="emit('extract-tags-click', 'artistryPromptPrefix')"
                >
                  <span class="i-solar:tag-bold-duotone text-base" />
                </button>
                <button
                  type="button"
                  class="size-7 flex items-center justify-center rounded-lg text-neutral-400 transition-colors hover:bg-neutral-200/60 hover:text-primary-500 dark:hover:bg-neutral-700"
                  title="Optimize with AI"
                  @click.prevent="emit('sparkle-click', 'artistryPromptPrefix')"
                >
                  <span class="i-ph:sparkle animate-pulse text-base text-amber-500" />
                </button>
              </div>
            </div>
          </div>

          <!-- Assistant Tool Instructions -->
          <div class="flex flex-col gap-2 border-t border-neutral-100 pt-3 dark:border-neutral-800">
            <div class="flex items-center justify-between">
              <div>
                <label class="text-xs text-neutral-700 font-semibold dark:text-neutral-300">
                  Assistant Tool Instructions (`image_journal`)
                </label>
                <p class="text-[11px] text-neutral-400">
                  Defines how the character decides when and how to call image synthesis in conversation.
                </p>
              </div>
              <div class="flex items-center gap-1.5">
                <button
                  type="button"
                  class="rounded-lg bg-neutral-100 px-2.5 py-1 text-[11px] text-neutral-600 font-medium transition-colors dark:bg-neutral-800 hover:bg-neutral-200 dark:text-neutral-300"
                  @click="applyToolCallTemplate"
                >
                  Tool Call Template
                </button>
                <button
                  type="button"
                  class="rounded-lg bg-neutral-100 px-2.5 py-1 text-[11px] text-neutral-600 font-medium transition-colors dark:bg-neutral-800 hover:bg-neutral-200 dark:text-neutral-300"
                  @click="applyTokenTemplate"
                >
                  Token Template
                </button>
              </div>
            </div>

            <textarea
              v-model="selectedArtistryWidgetInstruction"
              rows="8"
              class="w-full border border-neutral-200 rounded-xl bg-neutral-50/80 p-3 text-xs text-neutral-800 leading-relaxed font-mono outline-none transition-all dark:border-neutral-700 focus:border-primary-500 dark:bg-neutral-800/40 dark:text-neutral-200 focus:ring-1 focus:ring-primary-500"
            />
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
