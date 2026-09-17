<script setup lang="ts">
import type { CompanionAlignmentConfig, VaultInspectionReport } from '@proj-airi/stage-ui/utils/data-vault'

import { useDataMaintenance } from '@proj-airi/stage-ui/composables/use-data-maintenance'
import { useAiriCardStore } from '@proj-airi/stage-ui/stores/modules/airi-card'
import { Button } from '@proj-airi/ui'
import {
  DialogContent,
  DialogOverlay,
  DialogPortal,
  DialogRoot,
  DialogTitle,
} from 'reka-ui'
import { computed, reactive, ref } from 'vue'

const props = defineProps<{
  modelValue: boolean
}>()

const emit = defineEmits<{
  (e: 'update:modelValue', value: boolean): void
  (e: 'imported'): void
}>()

const { inspectVaultImport, applyCompanionAlignment, commitVaultImport } = useDataMaintenance()
const airiCardStore = useAiriCardStore()

type Step = 'dropzone' | 'inspecting' | 'aligning' | 'ready' | 'importing' | 'done'
const step = ref<Step>('dropzone')
const fileInput = ref<HTMLInputElement>()
const isDragging = ref(false)
const errorMessage = ref('')

const inspectionReport = ref<VaultInspectionReport | null>(null)
const alignments = reactive<CompanionAlignmentConfig>({})

const installedCompanions = computed(() => {
  return Array.from(airiCardStore.cards.entries()).map(([id, card]) => ({
    id,
    name: card.nickname || card.name || id,
  }))
})

function resetState() {
  step.value = 'dropzone'
  errorMessage.value = ''
  inspectionReport.value = null
  for (const key in alignments) {
    delete alignments[key]
  }
}

async function processFiles(files: FileList | File[]) {
  if (!files || files.length === 0)
    return

  step.value = 'inspecting'
  errorMessage.value = ''

  try {
    const fileArray = Array.from(files)
    const report = await inspectVaultImport(fileArray)
    inspectionReport.value = report

    if (report.unalignedCompanions.length > 0) {
      for (const orphan of report.unalignedCompanions) {
        alignments[orphan.characterId] = {
          action: 'recreate',
          name: orphan.suggestedName,
          targetId: installedCompanions.value[0]?.id || '',
        }
      }
      step.value = 'aligning'
    }
    else {
      step.value = 'ready'
    }
  }
  catch (e) {
    console.error('Failed to inspect import payload', e)
    errorMessage.value = e instanceof Error ? e.message : 'Failed to parse import files'
    step.value = 'dropzone'
  }
}

function handleFileInput(e: Event) {
  const target = e.target as HTMLInputElement
  if (target.files) {
    processFiles(target.files)
  }
}

function handleDrop(e: DragEvent) {
  isDragging.value = false
  if (e.dataTransfer?.files) {
    processFiles(e.dataTransfer.files)
  }
}

function handleConfirmAlignments() {
  if (!inspectionReport.value)
    return
  const alignedPayload = applyCompanionAlignment(inspectionReport.value.payload, alignments)
  inspectionReport.value.payload = alignedPayload
  step.value = 'ready'
}

async function handleCommit() {
  if (!inspectionReport.value)
    return
  step.value = 'importing'
  try {
    await commitVaultImport(inspectionReport.value.payload)
    step.value = 'done'
    emit('imported')
  }
  catch (e) {
    console.error('Import commit failed', e)
    errorMessage.value = e instanceof Error ? e.message : 'Import failed'
    step.value = 'ready'
  }
}
</script>

<template>
  <DialogRoot :open="modelValue" @update:open="emit('update:modelValue', $event); if (!$event) resetState()">
    <DialogPortal>
      <DialogOverlay class="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm" />
      <DialogContent class="fixed left-1/2 top-1/2 z-50 max-h-[85vh] max-w-xl w-full flex flex-col border border-neutral-200 rounded-2xl bg-white p-6 shadow-2xl -translate-x-1/2 -translate-y-1/2 dark:border-neutral-800 dark:bg-neutral-900">
        <DialogTitle class="text-xl text-neutral-900 font-bold dark:text-white">
          Universal Data Import
        </DialogTitle>
        <p class="mt-1 text-sm text-neutral-500 dark:text-neutral-400">
          Restore from a ZIP archive, legacy backup JSON, or character card.
        </p>

        <!-- Step: Dropzone -->
        <div v-if="step === 'dropzone'" class="mt-4 flex flex-col items-center">
          <input
            ref="fileInput"
            type="file"
            multiple
            accept=".zip,.json,.png"
            class="hidden"
            @change="handleFileInput"
          >

          <div
            :class="[
              'w-full cursor-pointer flex flex-col items-center justify-center rounded-2xl border-2 border-dashed p-10 text-center transition',
              isDragging ? 'border-primary bg-primary/5' : 'border-neutral-200 hover:border-primary/50 dark:border-neutral-800',
            ]"
            @dragover.prevent="isDragging = true"
            @dragleave.prevent="isDragging = false"
            @drop.prevent="handleDrop"
            @click="fileInput?.click()"
          >
            <div class="mb-3 text-4xl">
              📦
            </div>
            <div class="text-sm text-neutral-900 font-semibold dark:text-white">
              Click or drag files here to import
            </div>
            <div class="mt-1 text-xs text-neutral-500">
              Supports .zip archives, chat/memory JSONs, and PNG cards (multi-file drop supported)
            </div>
          </div>

          <div v-if="errorMessage" class="mt-3 w-full rounded-xl bg-red-500/10 p-3 text-xs text-red-600 dark:text-red-400">
            {{ errorMessage }}
          </div>
        </div>

        <!-- Step: Inspecting -->
        <div v-else-if="step === 'inspecting'" class="py-16 text-center text-sm text-neutral-500">
          <div class="inline-block animate-spin text-3xl">
            ◌
          </div>
          <p class="mt-3 font-medium">
            Analyzing backup & validating companion bindings...
          </p>
        </div>

        <!-- Step: Aligning (Orphan Resolution) -->
        <div v-else-if="step === 'aligning'" class="mt-4 flex-1 overflow-y-auto pr-1 space-y-4">
          <div class="border border-amber-500/20 rounded-xl bg-amber-500/10 p-4 text-xs text-amber-700 dark:text-amber-300">
            <div class="font-bold">
              Unmatched Companion Data Detected
            </div>
            <div class="mt-1">
              Some conversations or memories reference companion IDs not installed on this device. Choose how to handle them:
            </div>
          </div>

          <div v-for="orphan in inspectionReport?.unalignedCompanions" :key="orphan.characterId" class="border border-neutral-200 rounded-xl p-4 dark:border-neutral-800">
            <div class="flex items-center justify-between">
              <div>
                <span class="text-neutral-900 font-semibold dark:text-white">{{ orphan.suggestedName }}</span>
                <span class="ml-2 text-xs text-neutral-400 font-mono">({{ orphan.characterId }})</span>
              </div>
              <div class="text-xs text-neutral-500">
                {{ orphan.messageCount }} messages · {{ orphan.memoryCount }} memories
              </div>
            </div>

            <div v-if="orphan.previewText" class="mt-2 rounded bg-neutral-100 p-2 text-xs text-neutral-600 italic dark:bg-neutral-800 dark:text-neutral-400">
              "{{ orphan.previewText }}"
            </div>

            <div class="mt-3 space-y-2">
              <label class="flex cursor-pointer items-center gap-2 text-sm">
                <input
                  v-model="alignments[orphan.characterId].action"
                  type="radio"
                  value="recreate"
                  class="text-primary"
                >
                <span>✨ Create New Companion Card</span>
              </label>
              <div v-if="alignments[orphan.characterId].action === 'recreate'" class="ml-6">
                <input
                  v-model="alignments[orphan.characterId].name"
                  type="text"
                  placeholder="Companion Name"
                  class="w-full border border-neutral-200 rounded-lg bg-transparent px-3 py-1.5 text-xs text-neutral-900 dark:border-neutral-700 dark:text-white"
                >
              </div>

              <label class="flex cursor-pointer items-center gap-2 text-sm">
                <input
                  v-model="alignments[orphan.characterId].action"
                  type="radio"
                  value="link"
                  class="text-primary"
                >
                <span>🤝 Link to Installed Companion</span>
              </label>
              <div v-if="alignments[orphan.characterId].action === 'link'" class="ml-6">
                <select
                  v-model="alignments[orphan.characterId].targetId"
                  class="w-full border border-neutral-200 rounded-lg bg-white px-3 py-1.5 text-xs text-neutral-900 dark:border-neutral-700 dark:bg-neutral-800 dark:text-white"
                >
                  <option v-for="c in installedCompanions" :key="c.id" :value="c.id">
                    {{ c.name }}
                  </option>
                </select>
              </div>
            </div>
          </div>

          <div class="flex justify-end pt-2">
            <Button variant="primary" @click="handleConfirmAlignments">
              Confirm & Continue
            </Button>
          </div>
        </div>

        <!-- Step: Ready -->
        <div v-else-if="step === 'ready'" class="mt-4 flex-1 space-y-4">
          <div class="border border-neutral-200 rounded-xl p-4 dark:border-neutral-800">
            <div class="text-xs text-neutral-500 font-semibold tracking-wider uppercase">
              Ready to Import
            </div>
            <div class="grid grid-cols-2 mt-3 gap-3">
              <div v-if="inspectionReport?.domains.includes('characters')" class="rounded-lg bg-neutral-50 p-3 dark:bg-neutral-800/50">
                <div class="text-xs text-neutral-500">
                  Companions
                </div>
                <div class="text-lg text-neutral-900 font-bold dark:text-white">
                  {{ inspectionReport.payload.characters?.length || 0 }} cards
                </div>
              </div>

              <div v-if="inspectionReport?.domains.includes('chat-sessions')" class="rounded-lg bg-neutral-50 p-3 dark:bg-neutral-800/50">
                <div class="text-xs text-neutral-500">
                  Chat Sessions
                </div>
                <div class="text-lg text-neutral-900 font-bold dark:text-white">
                  {{ inspectionReport.sessionsCount }} sessions
                </div>
              </div>

              <div v-if="inspectionReport?.domains.includes('memory')" class="rounded-lg bg-neutral-50 p-3 dark:bg-neutral-800/50">
                <div class="text-xs text-neutral-500">
                  Memory & Logs
                </div>
                <div class="text-lg text-neutral-900 font-bold dark:text-white">
                  {{ inspectionReport.memoryCount }} entries
                </div>
              </div>

              <div v-if="inspectionReport?.domains.includes('backgrounds')" class="rounded-lg bg-neutral-50 p-3 dark:bg-neutral-800/50">
                <div class="text-xs text-neutral-500">
                  Backgrounds
                </div>
                <div class="text-lg text-neutral-900 font-bold dark:text-white">
                  {{ inspectionReport.backgroundsCount }} images
                </div>
              </div>
            </div>
          </div>

          <div v-if="errorMessage" class="rounded-xl bg-red-500/10 p-3 text-xs text-red-600 dark:text-red-400">
            {{ errorMessage }}
          </div>

          <div class="flex justify-end gap-2 pt-2">
            <Button variant="ghost" @click="resetState">
              Cancel
            </Button>
            <Button variant="primary" @click="handleCommit">
              Import All Data
            </Button>
          </div>
        </div>

        <!-- Step: Importing -->
        <div v-else-if="step === 'importing'" class="py-16 text-center text-sm text-neutral-500">
          <div class="inline-block animate-spin text-3xl">
            ◌
          </div>
          <p class="mt-3 font-medium">
            Writing data to IndexedDB...
          </p>
        </div>

        <!-- Step: Done -->
        <div v-else-if="step === 'done'" class="py-12 text-center">
          <div class="text-4xl text-green-500">
            ✓
          </div>
          <div class="mt-2 text-lg text-neutral-900 font-bold dark:text-white">
            Data Imported Successfully!
          </div>
          <p class="mt-1 text-xs text-neutral-500">
            All conversations, cards, and memory pillars have been restored.
          </p>
          <div class="mt-6 flex justify-center">
            <Button variant="primary" @click="emit('update:modelValue', false); resetState()">
              Done
            </Button>
          </div>
        </div>
      </DialogContent>
    </DialogPortal>
  </DialogRoot>
</template>
