<script setup lang="ts">
import type { ScrubReport } from '@proj-airi/stage-ui/composables/use-data-maintenance'

import { useDataMaintenance } from '@proj-airi/stage-ui/composables/use-data-maintenance'
import { Button } from '@proj-airi/ui'
import {
  DialogContent,
  DialogOverlay,
  DialogPortal,
  DialogRoot,
  DialogTitle,
} from 'reka-ui'
import { computed, ref, watch } from 'vue'

const props = defineProps<{
  modelValue: boolean
}>()

const emit = defineEmits<{
  (e: 'update:modelValue', value: boolean): void
  (e: 'scrub-complete', report: ScrubReport): void
}>()

const {
  calculateChatSessionsByteSize,
  scrubAndResolveSessionMedia,
  exportDataVaultArchive,
} = useDataMaintenance()

type StepState = 'prompt' | 'backing-up' | 'scrubbing' | 'complete'

const step = ref<StepState>('prompt')
const currentChatBytes = ref<number | null>(null)
const isLoadingInitialSize = ref(false)
const progress = ref({ current: 0, total: 0 })
const report = ref<ScrubReport | null>(null)
const errorMessage = ref('')

function formatBytes(bytes?: number): string {
  if (!bytes || bytes <= 0)
    return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return `${Number.parseFloat((bytes / k ** i).toFixed(2))} ${sizes[i]}`
}

async function loadInitialSize() {
  isLoadingInitialSize.value = true
  errorMessage.value = ''
  try {
    currentChatBytes.value = await calculateChatSessionsByteSize()
  }
  catch (e) {
    console.error('Failed to calculate chat size', e)
    currentChatBytes.value = 0
  }
  finally {
    isLoadingInitialSize.value = false
  }
}

watch(() => props.modelValue, (open) => {
  if (open) {
    step.value = 'prompt'
    report.value = null
    errorMessage.value = ''
    progress.value = { current: 0, total: 0 }
    loadInitialSize()
  }
})

async function runScrub() {
  step.value = 'scrubbing'
  errorMessage.value = ''
  try {
    const res = await scrubAndResolveSessionMedia({
      onProgress: (p) => {
        progress.value = p
      },
    })
    report.value = res
    step.value = 'complete'
    emit('scrub-complete', res)
  }
  catch (e) {
    console.error('Failed to scrub history', e)
    errorMessage.value = e instanceof Error ? e.message : String(e)
    step.value = 'prompt'
  }
}

async function handleBackupAndScrub() {
  step.value = 'backing-up'
  errorMessage.value = ''
  try {
    const zipBlob = await exportDataVaultArchive({
      chatSessions: true,
      characters: true,
      memory: true,
      backgrounds: true,
      providers: true,
      settings: true,
    })
    const url = URL.createObjectURL(zipBlob)
    const a = document.createElement('a')
    a.href = url
    a.download = `airi-pre-scrub-backup-${new Date().toISOString().replace(/[:.]/g, '-')}.zip`
    a.click()
    URL.revokeObjectURL(url)

    // Proceed to scrub
    await runScrub()
  }
  catch (e) {
    console.error('Backup before scrub failed', e)
    errorMessage.value = `Backup failed: ${e instanceof Error ? e.message : String(e)}`
    step.value = 'prompt'
  }
}

function handleClose() {
  if (step.value === 'scrubbing' || step.value === 'backing-up')
    return
  emit('update:modelValue', false)
}

const savedPercent = computed(() => {
  if (!report.value || report.value.beforeBytes === 0)
    return '0%'
  const pct = (report.value.bytesSaved / report.value.beforeBytes) * 100
  return `${pct.toFixed(1)}%`
})
</script>

<template>
  <DialogRoot :open="modelValue" @update:open="emit('update:modelValue', $event)">
    <DialogPortal>
      <DialogOverlay class="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm transition-opacity" />
      <DialogContent class="fixed left-1/2 top-1/2 z-50 max-h-[85vh] max-w-lg w-[92vw] flex flex-col border border-neutral-200/80 rounded-2xl bg-white p-6 shadow-2xl -translate-x-1/2 -translate-y-1/2 dark:border-neutral-800/80 dark:bg-neutral-900">
        <!-- Dialog Header -->
        <div class="flex items-start justify-between">
          <div class="flex items-center gap-3">
            <div class="size-10 flex items-center justify-center rounded-xl bg-primary/15 text-primary">
              <div class="i-solar:magic-stick-3-bold-duotone size-6" />
            </div>
            <div>
              <DialogTitle class="text-lg text-neutral-900 font-bold dark:text-white">
                Scrub & Resolve Session Media
              </DialogTitle>
              <p class="text-xs text-neutral-500 dark:text-neutral-400">
                Extract heavy inline images into storage to eliminate token blowup.
              </p>
            </div>
          </div>
          <button
            v-if="step !== 'scrubbing' && step !== 'backing-up'"
            type="button"
            class="text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-200"
            @click="handleClose"
          >
            ✕
          </button>
        </div>

        <!-- Error Message if present -->
        <div
          v-if="errorMessage"
          class="mt-4 flex items-center gap-2 border border-red-500/30 rounded-xl bg-red-500/10 px-3 py-2 text-xs text-red-600 dark:text-red-300"
        >
          <div class="i-solar:danger-triangle-bold size-4 shrink-0" />
          <span>{{ errorMessage }}</span>
        </div>

        <!-- STEP 1: PROMPT STATE -->
        <div v-if="step === 'prompt'" class="mt-4 flex flex-col gap-4">
          <div class="border border-neutral-200/80 rounded-xl bg-neutral-50/70 p-4 text-xs text-neutral-600 dark:border-neutral-800/80 dark:bg-neutral-800/40 dark:text-neutral-300">
            <p class="leading-relaxed">
              This process scans all chat conversations for embedded base64 image data URLs and raw tool image payloads.
              Each detected image is safely relocated to your local background gallery and replaced in your history with a lightweight asset pointer.
            </p>
            <div class="mt-3 flex items-center justify-between border-t border-neutral-200/60 pt-3 dark:border-neutral-700/60">
              <span class="text-neutral-500 dark:text-neutral-400">Current Total Chat Size:</span>
              <span class="text-neutral-900 font-semibold dark:text-white">
                {{ isLoadingInitialSize ? 'Measuring...' : formatBytes(currentChatBytes ?? 0) }}
              </span>
            </div>
          </div>

          <!-- Backup Reassurance Banner -->
          <div class="flex items-start gap-2.5 border border-amber-500/25 rounded-xl bg-amber-500/10 p-3.5 text-xs text-amber-800 dark:border-amber-500/30 dark:bg-amber-500/15 dark:text-amber-200">
            <div class="i-solar:shield-warning-bold mt-0.5 size-4 shrink-0 text-amber-600 dark:text-amber-400" />
            <div>
              <span class="font-semibold">Safety Confirmation:</span>
              Just to be safe, do you want to create a full backup archive of your companions and conversations before proceeding?
            </div>
          </div>

          <!-- Action Buttons -->
          <div class="mt-2 flex flex-col gap-2.5 sm:flex-row sm:justify-end">
            <Button
              variant="secondary"
              size="sm"
              @click="handleClose"
            >
              Cancel
            </Button>
            <Button
              variant="secondary"
              size="sm"
              class="border-neutral-300 dark:border-neutral-700"
              @click="runScrub"
            >
              Scrub Without Backup
            </Button>
            <Button
              variant="primary"
              size="sm"
              class="flex items-center gap-1.5 shadow-sm"
              @click="handleBackupAndScrub"
            >
              <div class="i-solar:box-minimalistic-bold size-4" />
              <span>Create Backup & Scrub</span>
            </Button>
          </div>
        </div>

        <!-- STEP 2: BACKING UP STATE -->
        <div v-else-if="step === 'backing-up'" class="my-8 flex flex-col items-center justify-center gap-3">
          <div class="i-solar:refresh-circle-bold size-10 animate-spin text-primary" />
          <div class="text-sm text-neutral-800 font-semibold dark:text-neutral-200">
            Creating full Data Vault backup...
          </div>
          <p class="text-xs text-neutral-500 dark:text-neutral-400">
            Packaging your chat sessions, characters, and memory pillars into a zip file.
          </p>
        </div>

        <!-- STEP 3: SCRUBBING IN PROGRESS -->
        <div v-else-if="step === 'scrubbing'" class="my-8 flex flex-col items-center justify-center gap-4">
          <div class="i-solar:magic-stick-3-bold-duotone size-10 animate-bounce text-primary" />
          <div class="text-center">
            <div class="text-sm text-neutral-800 font-semibold dark:text-neutral-200">
              Optimizing and resolving session media...
            </div>
            <div class="mt-1 text-xs text-neutral-500 dark:text-neutral-400">
              Scanned {{ progress.current }} of {{ progress.total }} session(s)
            </div>
          </div>
          <div class="h-2 max-w-xs w-full overflow-hidden rounded-full bg-neutral-200 dark:bg-neutral-800">
            <div
              class="h-full bg-primary transition-all duration-200"
              :style="{ width: `${progress.total > 0 ? (progress.current / progress.total) * 100 : 0}%` }"
            />
          </div>
        </div>

        <!-- STEP 4: COMPLETE STATE -->
        <div v-else-if="step === 'complete' && report" class="mt-4 flex flex-col gap-4">
          <div class="flex items-center gap-3 border border-emerald-500/25 rounded-xl bg-emerald-500/10 p-3.5 text-xs text-emerald-800 dark:border-emerald-500/30 dark:bg-emerald-500/15 dark:text-emerald-200">
            <div class="i-solar:check-circle-bold size-5 shrink-0 text-emerald-600 dark:text-emerald-400" />
            <div>
              <span class="font-semibold">Optimization Complete!</span>
              Your conversations are now lean and free of heavy base64 strings.
            </div>
          </div>

          <!-- Metric Cards Grid -->
          <div class="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <div class="border border-neutral-200/80 rounded-xl bg-neutral-50/70 p-3 text-center dark:border-neutral-800/80 dark:bg-neutral-800/40">
              <div class="text-[10px] text-neutral-500 font-medium tracking-wider uppercase dark:text-neutral-400">
                Before Size
              </div>
              <div class="mt-1 text-sm text-neutral-800 font-bold dark:text-neutral-200">
                {{ formatBytes(report.beforeBytes) }}
              </div>
            </div>

            <div class="border border-neutral-200/80 rounded-xl bg-neutral-50/70 p-3 text-center dark:border-neutral-800/80 dark:bg-neutral-800/40">
              <div class="text-[10px] text-neutral-500 font-medium tracking-wider uppercase dark:text-neutral-400">
                After Size
              </div>
              <div class="mt-1 text-sm text-neutral-800 font-bold dark:text-neutral-200">
                {{ formatBytes(report.afterBytes) }}
              </div>
            </div>

            <div class="border border-emerald-500/20 rounded-xl bg-emerald-500/5 p-3 text-center dark:border-emerald-500/30 dark:bg-emerald-500/10">
              <div class="text-[10px] text-emerald-600 font-medium tracking-wider uppercase dark:text-emerald-400">
                Saved ({{ savedPercent }})
              </div>
              <div class="mt-1 text-sm text-emerald-600 font-bold dark:text-emerald-400">
                {{ formatBytes(report.bytesSaved) }}
              </div>
            </div>

            <div class="border border-primary/20 rounded-xl bg-primary/5 p-3 text-center dark:border-primary/30 dark:bg-primary/10">
              <div class="text-[10px] text-primary font-medium tracking-wider uppercase">
                Images Relocated
              </div>
              <div class="mt-1 text-sm text-primary font-bold">
                {{ report.imagesExtracted }}
              </div>
            </div>
          </div>

          <p class="text-xs text-neutral-500 dark:text-neutral-400">
            Scanned {{ report.sessionsScanned }} chat sessions. All relocated images are safely accessible in your background and art gallery.
          </p>

          <div class="mt-2 flex justify-end">
            <Button
              variant="primary"
              size="sm"
              @click="handleClose"
            >
              Done
            </Button>
          </div>
        </div>
      </DialogContent>
    </DialogPortal>
  </DialogRoot>
</template>
