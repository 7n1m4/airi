<script setup lang="ts">
import { useMemoryLifetimeStore } from '@proj-airi/stage-ui/stores/memory-lifetime'
import { useAiriCardStore } from '@proj-airi/stage-ui/stores/modules/airi-card'
import { Button } from '@proj-airi/ui'
import { storeToRefs } from 'pinia'
import { DialogContent, DialogOverlay, DialogPortal, DialogRoot } from 'reka-ui'
import { computed, ref, watch } from 'vue'

const props = withDefaults(defineProps<{
  characterId: string
  universeId?: string
  open: boolean
}>(), {
  universeId: 'global',
})

const emit = defineEmits<{
  (e: 'update:open', value: boolean): void
  (e: 'completed'): void
}>()

const store = useMemoryLifetimeStore()
const airiCardStore = useAiriCardStore()
const { isProvisioning, progress, error, activeSession } = storeToRefs(store)

const sourceDocs = ref<any[]>([])
const sourceCounts = ref({ raw: 0, stmm: 0, ltmm: 0 })
const isLoadingCounts = ref(false)

// Detail presets
type PresetKey = 'essential' | 'balanced' | 'detailed'

interface DetailPreset {
  key: PresetKey
  tokenValue: number
  title: string
  tokensLabel: string
  description: string
  isRecommended?: boolean
}

const detailPresets: DetailPreset[] = [
  {
    key: 'essential',
    tokenValue: 500,
    title: 'Essential',
    tokensLabel: '500 tokens',
    description: 'Essential details.',
  },
  {
    key: 'balanced',
    tokenValue: 1000,
    title: 'Balanced',
    tokensLabel: '1,000 tokens',
    description: 'Balanced detail.',
    isRecommended: true,
  },
  {
    key: 'detailed',
    tokenValue: 3000,
    title: 'Detailed',
    tokensLabel: '3,000 tokens',
    description: 'More nuance.',
  },
]

const selectedPresetKey = ref<PresetKey>('balanced')
const selectedPreset = computed(() => {
  return detailPresets.find(p => p.key === selectedPresetKey.value) || detailPresets[1]
})

// Advanced parameters
const isAdvancedOpen = ref(false)
const requestInterval = ref(0)
const contextLimitTokens = ref(64) // 64K Tokens

// Post-creation toggle
const useInFutureChats = ref(true)

const totalAvailableUnits = computed(() => {
  return sourceCounts.value.raw + sourceCounts.value.stmm + sourceCounts.value.ltmm
})

const estimatedChunks = computed(() => {
  if (!sourceDocs.value.length)
    return 1
  const contextLimitChars = contextLimitTokens.value * 1024 * 4
  let chunks = 0
  let currentChars = 0
  let docsInChunk = 0
  for (const doc of sourceDocs.value) {
    const docChars = doc.text.length
    if (currentChars + docChars > contextLimitChars && docsInChunk > 0) {
      chunks++
      currentChars = 0
      docsInChunk = 0
    }
    docsInChunk++
    currentChars += docChars
  }
  if (docsInChunk > 0)
    chunks++
  return Math.max(1, chunks)
})

const estimatedCalls = computed(() => {
  return estimatedChunks.value + 3 // N chunk calls + 1 base synthesis + 2 distill passes
})

const estimatedDuration = computed(() => {
  const totalCalls = estimatedCalls.value
  const totalCooldown = totalCalls * requestInterval.value
  const totalSeconds = totalCooldown + (totalCalls * 10)
  const mins = Math.floor(totalSeconds / 60)
  return mins > 0 ? `${mins}m ${totalSeconds % 60}s` : `about ${totalSeconds} seconds`
})

async function loadCounts() {
  if (!props.characterId)
    return
  isLoadingCounts.value = true
  try {
    const docs = await store.collectSourceDocs(props.characterId, props.universeId)
    sourceDocs.value = docs
    sourceCounts.value = {
      raw: docs.filter(d => d.layer === 'raw').length,
      stmm: docs.filter(d => d.layer === 'stmm').length,
      ltmm: docs.filter(d => d.layer === 'ltmm').length,
    }
    await store.loadForCharacter(props.characterId, props.universeId)
  }
  finally {
    isLoadingCounts.value = false
  }
}

const initiatedInModal = ref(false)

async function startProvisioning() {
  initiatedInModal.value = true
  await store.provision(
    props.characterId,
    props.universeId,
    false,
    requestInterval.value,
    contextLimitTokens.value,
    selectedPreset.value.tokenValue,
  )
}

async function resumeProvisioning() {
  initiatedInModal.value = true
  await store.provision(
    props.characterId,
    props.universeId,
    true,
    requestInterval.value,
    contextLimitTokens.value,
    selectedPreset.value.tokenValue,
  )
}

async function restartProvisioning() {
  initiatedInModal.value = true
  await store.restart(
    props.characterId,
    props.universeId,
    contextLimitTokens.value,
    selectedPreset.value.tokenValue,
  )
}

function handleDone() {
  if (useInFutureChats.value && props.characterId) {
    void airiCardStore.toggleLifetimeMemory(props.characterId, true)
  }
  initiatedInModal.value = false
  progress.value.phase = 'idle'
  emit('completed')
  emit('update:open', false)
}

function close() {
  if (!isProvisioning.value) {
    initiatedInModal.value = false
    progress.value.phase = 'idle'
  }
  emit('update:open', false)
}

watch(() => props.open, (isOpen) => {
  if (isOpen) {
    if (!isProvisioning.value) {
      initiatedInModal.value = false
      progress.value.phase = 'idle'
    }
    loadCounts()
  }
}, { immediate: true })

// Automatically enable only when an interactive modal provisioning run reaches success
watch(() => progress.value.phase, (phase) => {
  if (phase === 'success' && initiatedInModal.value && useInFutureChats.value && props.characterId) {
    void airiCardStore.toggleLifetimeMemory(props.characterId, true)
  }
})

const progressPercent = computed(() => {
  if (progress.value.totalCalls > 0) {
    return (progress.value.completedCalls / progress.value.totalCalls) * 100
  }
  return 0
})

const phaseLabel = computed(() => {
  switch (progress.value.phase) {
    case 'aggregating': return 'Phase 1/4: Gathering Conversation History'
    case 'chunking': return `Phase 1/4: Analyzing Chunks (${progress.value.currentChunk}/${progress.value.totalChunks})`
    case 'synthesizing': return 'Phase 2/4: Synthesizing Base Archive'
    case 'distill_pass_1': return 'Phase 3/4: Deduplication Pass'
    case 'distill_pass_2': return 'Phase 4/4: Dense Distill Pass'
    case 'success': return 'Memory Weaving Complete'
    default: return 'Preparing'
  }
})

const canResume = computed(() => !!activeSession.value)
</script>

<template>
  <DialogRoot :open="open" @update:open="emit('update:open', $event)">
    <DialogPortal>
      <DialogOverlay class="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm" />
      <DialogContent
        class="fixed left-1/2 top-1/2 z-50 max-h-[92vh] max-w-lg w-[92vw] flex flex-col overflow-hidden border border-neutral-200 rounded-3xl bg-white shadow-2xl transition-all -translate-x-1/2 -translate-y-1/2 dark:border-neutral-800 dark:bg-neutral-900"
      >
        <!-- Header (Mockup B style) -->
        <header class="flex items-start justify-between border-b border-neutral-100 p-6 pb-4 dark:border-neutral-800">
          <div class="flex items-center gap-3">
            <div class="h-10 w-10 flex shrink-0 items-center justify-center rounded-2xl bg-amber-500/10 text-amber-500 dark:bg-amber-400/10 dark:text-amber-400">
              <div class="i-solar:infinity-bold-duotone text-2xl" />
            </div>
            <div>
              <span class="block text-[10px] text-amber-600 font-bold tracking-widest uppercase dark:text-amber-400">
                Eternal Thread
              </span>
              <h2 class="text-lg text-neutral-800 font-bold leading-tight dark:text-neutral-100">
                Preserve your shared story
              </h2>
              <p class="text-xs text-neutral-500 dark:text-neutral-400">
                Turn past conversations into a lasting reference for your companion.
              </p>
            </div>
          </div>
          <button class="text-neutral-400 transition hover:text-neutral-600 dark:hover:text-neutral-200" @click="close">
            <div class="i-solar:close-circle-bold-duotone text-2xl" />
          </button>
        </header>

        <div class="custom-scrollbar flex flex-1 flex-col gap-4.5 overflow-y-auto p-6 pt-4">
          <!-- Pre-provisioning View -->
          <div v-if="(progress.phase === 'idle' || progress.phase === 'error') && !isProvisioning" class="flex flex-col gap-4.5">
            <!-- Resume Prompt -->
            <div v-if="canResume" class="border border-primary-500/20 rounded-2xl bg-primary-500/5 p-4 dark:border-primary-400/20 dark:bg-primary-400/5">
              <div class="flex items-center gap-2 text-primary-600 dark:text-primary-400">
                <div class="i-solar:restart-bold-duotone text-lg" />
                <span class="text-xs font-bold tracking-tight uppercase">Incomplete Session Found</span>
              </div>
              <p class="mt-2 text-xs text-neutral-600 leading-relaxed dark:text-neutral-400">
                A previous memory creation was interrupted at <strong>{{ activeSession?.phase }}</strong>. Would you like to resume?
              </p>
              <div class="mt-3 flex gap-2">
                <Button label="Resume Session" variant="primary" size="sm" @click="resumeProvisioning" />
                <Button label="Restart from Scratch" variant="secondary" size="sm" @click="restartProvisioning" />
              </div>
            </div>

            <!-- What this memory can capture (Mockup B callout) -->
            <div class="border border-amber-500/20 rounded-2xl bg-amber-500/5 p-4 dark:border-amber-400/20 dark:bg-amber-400/5">
              <div class="mb-2 flex items-center gap-2 text-amber-600 dark:text-amber-400">
                <div class="i-solar:notes-bold-duotone text-base" />
                <span class="text-xs font-bold tracking-tight">What this memory can capture</span>
              </div>
              <ul class="flex flex-col gap-1.5 text-xs text-neutral-700 dark:text-neutral-300">
                <li class="flex items-center gap-2">
                  <div class="i-solar:check-circle-bold-duotone text-amber-500" />
                  <span>Important moments you shared</span>
                </li>
                <li class="flex items-center gap-2">
                  <div class="i-solar:check-circle-bold-duotone text-amber-500" />
                  <span>Preferences and familiar habits</span>
                </li>
                <li class="flex items-center gap-2">
                  <div class="i-solar:check-circle-bold-duotone text-amber-500" />
                  <span>Relationship context worth keeping</span>
                </li>
              </ul>
            </div>

            <!-- History Available Pill -->
            <div class="flex flex-col gap-1.5">
              <span class="text-[11px] text-neutral-400">
                Created from your available conversation history.
              </span>
              <div class="flex items-center gap-2 border border-neutral-100 rounded-xl bg-neutral-50 px-3.5 py-2.5 dark:border-neutral-800 dark:bg-neutral-800/40">
                <div class="i-solar:database-bold-duotone text-neutral-400" />
                <span v-if="isLoadingCounts" class="text-xs text-neutral-500">Scanning conversations...</span>
                <span v-else class="text-xs text-neutral-700 font-semibold dark:text-neutral-300">
                  {{ sourceCounts.raw }} turns · {{ sourceCounts.stmm }} summaries · {{ sourceCounts.ltmm }} memories
                </span>
              </div>
            </div>

            <!-- How much detail? (Radio Preset Cards) -->
            <div class="flex flex-col gap-2">
              <span class="text-xs text-neutral-800 font-bold dark:text-neutral-200">
                How much detail?
              </span>
              <div class="grid grid-cols-3 gap-2.5">
                <div
                  v-for="preset in detailPresets"
                  :key="preset.key"
                  class="relative flex flex-col cursor-pointer items-center border rounded-2xl p-3 text-center transition-all"
                  :class="[
                    selectedPresetKey === preset.key
                      ? 'border-primary-500 bg-primary-500/5 shadow-sm dark:border-primary-400 dark:bg-primary-400/5'
                      : 'border-neutral-200/80 bg-white hover:border-neutral-300 dark:border-neutral-800 dark:bg-neutral-800/40 dark:hover:border-neutral-700',
                  ]"
                  @click="selectedPresetKey = preset.key"
                >
                  <!-- Radio Circle Indicator -->
                  <div
                    class="mb-2 size-4.5 flex items-center justify-center rounded-full"
                    :class="selectedPresetKey === preset.key
                      ? 'text-primary-500 i-solar:record-circle-bold-duotone'
                      : 'text-neutral-300 dark:text-neutral-600 i-solar:circle-linear'"
                  />
                  <span class="text-xs text-neutral-800 font-bold dark:text-neutral-100">
                    {{ preset.title }}
                  </span>
                  <span class="text-[10px] text-neutral-500 font-medium dark:text-neutral-400">
                    {{ preset.tokensLabel }}
                  </span>
                  <span class="mt-1 text-[9px] text-neutral-400 leading-tight">
                    {{ preset.description }}
                  </span>

                  <!-- Recommended Badge -->
                  <span
                    v-if="preset.isRecommended"
                    class="mt-2 border border-primary-500/30 rounded-full bg-primary-500/10 px-2 py-0.5 text-[8px] text-primary-600 font-bold tracking-tight uppercase dark:text-primary-400"
                  >
                    Recommended
                  </span>
                </div>
              </div>
              <span class="text-center text-[10px] text-neutral-400">
                {{ selectedPreset.title }} · about {{ selectedPreset.tokensLabel }}
              </span>
            </div>

            <!-- Collapsible Advanced Settings -->
            <div class="border border-neutral-100 rounded-2xl bg-neutral-50/50 p-3 dark:border-neutral-800 dark:bg-neutral-800/20">
              <button
                type="button"
                class="w-full flex items-center justify-between text-xs text-neutral-600 font-semibold transition dark:text-neutral-400 hover:text-neutral-900 dark:hover:text-neutral-200"
                @click="isAdvancedOpen = !isAdvancedOpen"
              >
                <div class="flex items-center gap-2">
                  <div class="i-solar:settings-minimalistic-bold-duotone text-base text-neutral-400" />
                  <span>Advanced settings</span>
                </div>
                <div
                  class="i-solar:alt-arrow-down-linear text-sm transition-transform duration-200"
                  :class="{ 'rotate-180': isAdvancedOpen }"
                />
              </button>

              <div v-if="isAdvancedOpen" class="mt-3 flex flex-col gap-3.5 border-t border-neutral-200/40 pt-3 dark:border-neutral-700/40">
                <!-- Request Interval -->
                <div>
                  <div class="mb-1.5 flex items-center justify-between text-xs">
                    <span class="text-neutral-600 font-medium dark:text-neutral-300">Request Cooldown</span>
                    <span class="text-primary-500 font-bold">{{ requestInterval }}s Cooldown</span>
                  </div>
                  <input
                    v-model.number="requestInterval"
                    type="range"
                    min="0"
                    max="600"
                    step="10"
                    class="h-1.5 w-full cursor-pointer appearance-none rounded-lg bg-neutral-200 accent-primary-500 dark:bg-neutral-700"
                  >
                  <div class="mt-1 flex justify-between text-[9px] text-neutral-400">
                    <span>0s (Instant)</span>
                    <span>10m (Safe)</span>
                  </div>
                </div>

                <!-- Chunk Context Limit -->
                <div>
                  <div class="mb-1.5 flex items-center justify-between text-xs">
                    <span class="text-neutral-600 font-medium dark:text-neutral-300">Chunk Context Limit</span>
                    <span class="text-primary-500 font-bold">{{ contextLimitTokens }}K Tokens</span>
                  </div>
                  <input
                    v-model.number="contextLimitTokens"
                    type="range"
                    min="8"
                    max="1024"
                    step="8"
                    class="h-1.5 w-full cursor-pointer appearance-none rounded-lg bg-neutral-200 accent-primary-500 dark:bg-neutral-700"
                  >
                  <div class="mt-1 flex justify-between text-[9px] text-neutral-400">
                    <span>8K (Fast)</span>
                    <span>1M (Heavy)</span>
                  </div>
                </div>
              </div>
            </div>

            <!-- Reassurance Note -->
            <div class="flex items-center gap-1.5 text-[11px] text-neutral-400">
              <div class="i-solar:shield-check-bold-duotone text-emerald-500" />
              <span>Your original history stays unchanged.</span>
            </div>

            <!-- Estimates Box -->
            <div class="flex items-start gap-2.5 border border-primary-500/20 rounded-2xl bg-primary-500/5 p-3.5 dark:border-primary-400/20 dark:bg-primary-400/5">
              <div class="i-solar:clock-circle-bold-duotone mt-0.5 shrink-0 text-base text-primary-500" />
              <div class="flex flex-col">
                <span class="text-xs text-primary-700 font-bold dark:text-primary-300">
                  Estimated {{ estimatedDuration }} · {{ estimatedCalls }} model requests
                </span>
                <span class="text-[10px] text-primary-600/80 leading-tight dark:text-primary-400/80">
                  Uses your connected AI provider. Actual time and usage may vary.
                </span>
              </div>
            </div>

            <!-- Use in future chats toggle -->
            <div
              class="flex cursor-pointer items-center justify-between rounded-xl px-1 py-1 transition"
              @click="useInFutureChats = !useInFutureChats"
            >
              <div class="flex items-center gap-2.5">
                <div class="i-solar:chat-round-line-bold-duotone text-lg text-neutral-400" />
                <div class="flex flex-col">
                  <span class="text-xs text-neutral-800 font-semibold dark:text-neutral-200">
                    Use in future chats
                  </span>
                  <span class="text-[10px] text-neutral-400">
                    Turns on after the memory is created.
                  </span>
                </div>
              </div>
              <div
                :class="useInFutureChats ? 'bg-primary-500' : 'bg-neutral-200 dark:bg-neutral-700'"
                class="relative h-4 w-7 inline-flex shrink-0 cursor-pointer items-center border border-transparent rounded-full transition-colors duration-200 ease-in-out"
              >
                <span
                  :class="useInFutureChats ? 'translate-x-3.5' : 'translate-x-0.5'"
                  class="pointer-events-none inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out"
                />
              </div>
            </div>

            <div v-if="error" class="border border-red-500/20 rounded-xl bg-red-500/5 p-3 text-xs text-red-500">
              {{ error }}
            </div>

            <!-- Footer Buttons -->
            <div v-if="!canResume" class="flex gap-2.5 pt-1">
              <Button label="Cancel" variant="secondary" block @click="close" />
              <Button
                label="Create lifetime memory"
                variant="primary"
                block
                :disabled="isLoadingCounts || totalAvailableUnits === 0"
                @click="startProvisioning"
              />
            </div>
          </div>

          <!-- Progress View -->
          <div v-else-if="progress.phase !== 'success'" class="flex flex-col items-center gap-6 py-8">
            <div class="relative h-24 w-24 flex items-center justify-center">
              <div class="absolute inset-0 animate-spin border-4 border-amber-500/20 border-t-amber-500 rounded-full" />
              <div class="i-solar:infinity-bold-duotone text-4xl text-amber-500" />
            </div>

            <div class="w-full text-center space-y-2">
              <h3 class="text-lg text-neutral-800 font-bold transition-all dark:text-neutral-100">
                {{ phaseLabel }}
              </h3>
              <p class="min-h-[1.25rem] text-sm text-neutral-500">
                {{ progress.message || 'Distilling relational motifs and shared experiences...' }}
              </p>
            </div>

            <div class="w-full space-y-2">
              <div class="h-2 w-full overflow-hidden rounded-full bg-neutral-100 dark:bg-neutral-800">
                <div
                  class="h-full bg-amber-500 transition-all duration-500 ease-out"
                  :style="{ width: `${progressPercent}%` }"
                />
              </div>
              <div class="flex justify-between text-[10px] text-neutral-400 font-bold tracking-widest uppercase">
                <span>Progress</span>
                <span>{{ Math.round(progressPercent) }}%</span>
              </div>
            </div>
          </div>

          <!-- Success View -->
          <div v-else class="flex flex-col items-center gap-5 py-8 text-center">
            <div class="size-16 flex items-center justify-center rounded-full bg-emerald-500/10 text-emerald-500 dark:bg-emerald-400/10 dark:text-emerald-400">
              <div class="i-solar:check-circle-bold-duotone text-4xl" />
            </div>
            <div class="space-y-1">
              <h3 class="text-lg text-neutral-800 font-bold dark:text-neutral-100">
                Soul-Bond Preserved
              </h3>
              <p class="text-xs text-neutral-500 dark:text-neutral-400">
                The canonical Eternal Thread has been distilled and bound to this companion.
              </p>
            </div>
            <Button label="Done" variant="primary" block @click="handleDone" />
          </div>
        </div>
      </DialogContent>
    </DialogPortal>
  </DialogRoot>
</template>

<style scoped>
.custom-scrollbar::-webkit-scrollbar {
  width: 4px;
}
.custom-scrollbar::-webkit-scrollbar-track {
  background: transparent;
}
.custom-scrollbar::-webkit-scrollbar-thumb {
  background: #e5e5e5;
  border-radius: 10px;
}
.dark .custom-scrollbar::-webkit-scrollbar-thumb {
  background: #333;
}
</style>
