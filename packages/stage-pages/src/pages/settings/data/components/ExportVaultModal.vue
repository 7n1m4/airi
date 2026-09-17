<script setup lang="ts">
import { useDataMaintenance } from '@proj-airi/stage-ui/composables/use-data-maintenance'
import { Button } from '@proj-airi/ui'
import {
  DialogContent,
  DialogOverlay,
  DialogPortal,
  DialogRoot,
  DialogTitle,
} from 'reka-ui'
import { computed, reactive, ref, watch } from 'vue'

const props = defineProps<{
  modelValue: boolean
}>()

const emit = defineEmits<{
  (e: 'update:modelValue', value: boolean): void
}>()

const { getVaultStats, exportDataVaultArchive } = useDataMaintenance()

const loadingStats = ref(true)
const isExporting = ref(false)
const stats = ref<any>(null)

const selection = reactive({
  characters: true,
  chatSessions: true,
  memory: true,
  providers: true,
  settings: true,
  backgrounds: false,
})

function formatBytes(bytes?: number): string {
  if (!bytes || bytes === 0)
    return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return `${Number.parseFloat((bytes / k ** i).toFixed(1))} ${sizes[i]}`
}

async function loadStats() {
  loadingStats.value = true
  try {
    stats.value = await getVaultStats()
    // Auto-select backgrounds only if under 10MB
    if (stats.value?.backgrounds?.totalBytes && stats.value.backgrounds.totalBytes < 10 * 1024 * 1024) {
      selection.backgrounds = true
    }
  }
  catch (e) {
    console.error('Failed to load vault stats', e)
  }
  finally {
    loadingStats.value = false
  }
}

watch(() => props.modelValue, (open) => {
  if (open) {
    loadStats()
  }
})

const estimatedSize = computed(() => {
  if (!stats.value)
    return 'Calculating...'
  let total = 0
  if (selection.characters)
    total += stats.value.characters?.estimatedBytes || 0
  if (selection.chatSessions)
    total += stats.value.chatSessions?.estimatedBytes || 0
  if (selection.memory)
    total += stats.value.memory?.estimatedBytes || 0
  if (selection.providers)
    total += stats.value.providers?.estimatedBytes || 0
  if (selection.backgrounds)
    total += stats.value.backgrounds?.totalBytes || 0
  return formatBytes(total)
})

const hasChatOrMemoryWithoutCharacters = computed(() => {
  return (selection.chatSessions || selection.memory) && !selection.characters
})

async function handleExport() {
  isExporting.value = true
  try {
    const zipBlob = await exportDataVaultArchive(selection)
    const url = URL.createObjectURL(zipBlob)
    const a = document.createElement('a')
    a.href = url
    a.download = `airi-backup-${new Date().toISOString().replace(/[:.]/g, '-')}.zip`
    a.click()
    URL.revokeObjectURL(url)
    emit('update:modelValue', false)
  }
  catch (e) {
    console.error('Export failed', e)
  }
  finally {
    isExporting.value = false
  }
}
</script>

<template>
  <DialogRoot :open="modelValue" @update:open="emit('update:modelValue', $event)">
    <DialogPortal>
      <DialogOverlay class="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm" />
      <DialogContent class="fixed left-1/2 top-1/2 z-50 max-h-[85vh] max-w-lg w-full flex flex-col border border-neutral-200 rounded-2xl bg-white p-6 shadow-2xl -translate-x-1/2 -translate-y-1/2 dark:border-neutral-800 dark:bg-neutral-900">
        <DialogTitle class="text-xl text-neutral-900 font-bold dark:text-white">
          Export Data Archive
        </DialogTitle>
        <p class="mt-1 text-sm text-neutral-500 dark:text-neutral-400">
          Select data domains to package into a standard ZIP archive.
        </p>

        <div v-if="loadingStats" class="py-12 text-center text-sm text-neutral-500">
          <div class="inline-block animate-spin text-2xl">
            ◌
          </div>
          <p class="mt-2">
            Inspecting data stores...
          </p>
        </div>

        <div v-else class="mt-4 flex-1 overflow-y-auto pr-1 space-y-3">
          <!-- Domain: Characters -->
          <label class="flex cursor-pointer items-center justify-between border border-neutral-200 rounded-xl p-3 transition dark:border-neutral-800 hover:bg-neutral-50 dark:hover:bg-neutral-800/50">
            <div class="flex items-center gap-3">
              <input v-model="selection.characters" type="checkbox" class="h-4 w-4 rounded text-primary">
              <div>
                <div class="text-sm text-neutral-900 font-medium dark:text-white">
                  Companions & Cards
                </div>
                <div class="text-xs text-neutral-500">
                  {{ stats?.characters?.count || 0 }} companions (prompts, wardrobe, avatars)
                </div>
              </div>
            </div>
            <span class="text-xs text-neutral-400 font-mono">{{ formatBytes(stats?.characters?.estimatedBytes) }}</span>
          </label>

          <!-- Domain: Chat Sessions -->
          <label class="flex cursor-pointer items-center justify-between border border-neutral-200 rounded-xl p-3 transition dark:border-neutral-800 hover:bg-neutral-50 dark:hover:bg-neutral-800/50">
            <div class="flex items-center gap-3">
              <input v-model="selection.chatSessions" type="checkbox" class="h-4 w-4 rounded text-primary">
              <div>
                <div class="text-sm text-neutral-900 font-medium dark:text-white">
                  Chat Histories & Timelines
                </div>
                <div class="text-xs text-neutral-500">
                  {{ stats?.chatSessions?.sessionsCount || 0 }} sessions, {{ stats?.chatSessions?.messagesCount || 0 }} messages
                </div>
              </div>
            </div>
            <span class="text-xs text-neutral-400 font-mono">{{ formatBytes(stats?.chatSessions?.estimatedBytes) }}</span>
          </label>

          <!-- Domain: Memory -->
          <label class="flex cursor-pointer items-center justify-between border border-neutral-200 rounded-xl p-3 transition dark:border-neutral-800 hover:bg-neutral-50 dark:hover:bg-neutral-800/50">
            <div class="flex items-center gap-3">
              <input v-model="selection.memory" type="checkbox" class="h-4 w-4 rounded text-primary">
              <div>
                <div class="text-sm text-neutral-900 font-medium dark:text-white">
                  Memories & Journals
                </div>
                <div class="text-xs text-neutral-500">
                  {{ stats?.memory?.stmmCount || 0 }} daily recaps, {{ stats?.memory?.ltmmCount || 0 }} journal entries, lifetime cores
                </div>
              </div>
            </div>
            <span class="text-xs text-neutral-400 font-mono">{{ formatBytes(stats?.memory?.estimatedBytes) }}</span>
          </label>

          <!-- Domain: Providers & Settings -->
          <label class="flex cursor-pointer items-center justify-between border border-neutral-200 rounded-xl p-3 transition dark:border-neutral-800 hover:bg-neutral-50 dark:hover:bg-neutral-800/50">
            <div class="flex items-center gap-3">
              <input v-model="selection.providers" type="checkbox" class="h-4 w-4 rounded text-primary">
              <div>
                <div class="text-sm text-neutral-900 font-medium dark:text-white">
                  AI Providers & App Settings
                </div>
                <div class="text-xs text-neutral-500">
                  {{ stats?.providers?.count || 0 }} configured providers & preferences
                </div>
              </div>
            </div>
            <span class="text-xs text-neutral-400 font-mono">~2 KB</span>
          </label>

          <!-- Domain: Backgrounds -->
          <label class="flex cursor-pointer items-center justify-between border border-neutral-200 rounded-xl p-3 transition dark:border-neutral-800 hover:bg-neutral-50 dark:hover:bg-neutral-800/50">
            <div class="flex items-center gap-3">
              <input v-model="selection.backgrounds" type="checkbox" class="h-4 w-4 rounded text-primary">
              <div>
                <div class="text-sm text-neutral-900 font-medium dark:text-white">
                  Custom Scene Backgrounds
                </div>
                <div class="text-xs text-neutral-500">
                  {{ stats?.backgrounds?.count || 0 }} saved image wallpapers
                </div>
              </div>
            </div>
            <span class="rounded bg-neutral-100 px-2 py-0.5 text-xs text-neutral-600 font-mono dark:bg-neutral-800 dark:text-neutral-300">
              {{ formatBytes(stats?.backgrounds?.totalBytes) }}
            </span>
          </label>

          <div v-if="hasChatOrMemoryWithoutCharacters" class="rounded-xl bg-amber-500/10 p-3 text-xs text-amber-600 dark:text-amber-400">
            ⚠️ Tip: Companions & Cards is unselected. We recommend including it so chats and memories stay linked when restored.
          </div>
        </div>

        <div class="mt-6 flex items-center justify-between border-t border-neutral-200 pt-4 dark:border-neutral-800">
          <div class="text-xs text-neutral-500">
            Estimated Archive Size: <strong class="text-neutral-900 dark:text-white">{{ estimatedSize }}</strong>
          </div>
          <div class="flex gap-2">
            <Button variant="ghost" @click="emit('update:modelValue', false)">
              Cancel
            </Button>
            <Button variant="primary" :disabled="isExporting" @click="handleExport">
              {{ isExporting ? 'Packaging ZIP...' : 'Export Archive' }}
            </Button>
          </div>
        </div>
      </DialogContent>
    </DialogPortal>
  </DialogRoot>
</template>
