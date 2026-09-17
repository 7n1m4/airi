<script setup lang="ts">
import { isStageTamagotchi } from '@proj-airi/stage-shared'
import { useDataMaintenance } from '@proj-airi/stage-ui/composables/use-data-maintenance'
import { useAiriCardStore } from '@proj-airi/stage-ui/stores/modules/airi-card'
import { useSyncEngineStore } from '@proj-airi/stage-ui/stores/sync-engine'
import { Button, DoubleCheckButton } from '@proj-airi/ui'
import {
  DialogContent,
  DialogOverlay,
  DialogPortal,
  DialogRoot,
  DialogTitle,
} from 'reka-ui'
import { computed, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'

import ExportVaultModal from './components/ExportVaultModal.vue'
import ImportVaultModal from './components/ImportVaultModal.vue'

const { t } = useI18n()

const {
  deleteAllModels,
  resetProvidersSettings,
  resetModulesSettings,
  deleteAllChatSessions,
  exportChatSessions,
  importChatSessions,
  exportAllCharacters,
  importAllCharacters,
  exportMemory,
  importMemory,
  exportBackgrounds,
  importBackgrounds,
  deleteAllData,
  resetDesktopApplicationState,
  getOrphanedGroups,
  nukeOrphanedGroups,
  restoreOrphanedGroups,
} = useDataMaintenance()

const syncEngineStore = useSyncEngineStore()

const statusMessage = ref('')
const statusTone = ref<'neutral' | 'success' | 'error'>('neutral')
const importError = ref('')
const importFileInput = ref<HTMLInputElement>()
const importType = ref<'chats' | 'characters' | 'memory' | 'backgrounds'>('chats')
const isDesktop = computed(() => isStageTamagotchi())

const isExportVaultOpen = ref(false)
const isImportVaultOpen = ref(false)
const showLegacyTools = ref(false)

async function onVaultImported() {
  setStatus(t('settings.pages.data.status.imported'))
  orphanedGroups.value = await getOrphanedGroups()
}

function setStatus(message: string, tone: 'neutral' | 'success' | 'error' = 'success') {
  statusMessage.value = message
  statusTone.value = tone
}

async function runAction(action: () => Promise<void> | void, successKey: string) {
  try {
    await action()
    setStatus(t(successKey), 'success')
  }
  catch (error) {
    console.error(error)
    setStatus(error instanceof Error ? error.message : String(error), 'error')
  }
}

async function triggerExport(type: 'chats' | 'characters' | 'memory' | 'backgrounds') {
  try {
    let blob: Blob
    let filename: string

    switch (type) {
      case 'characters':
        blob = await exportAllCharacters()
        filename = `airi-characters-${new Date().toISOString()}.json`
        break
      case 'memory':
        blob = await exportMemory()
        filename = `airi-memory-${new Date().toISOString()}.json`
        break
      case 'backgrounds':
        blob = await exportBackgrounds()
        filename = `airi-backgrounds-${new Date().toISOString()}.json`
        break
      default:
        blob = await exportChatSessions()
        filename = `airi-chat-sessions-${new Date().toISOString()}.json`
    }

    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = filename
    anchor.click()
    URL.revokeObjectURL(url)
    setStatus(t('settings.pages.data.status.exported'))
  }
  catch (error) {
    console.error(error)
    setStatus(error instanceof Error ? error.message : String(error), 'error')
  }
}

function triggerImportPicker(type: 'chats' | 'characters' | 'memory' | 'backgrounds') {
  importError.value = ''
  importType.value = type
  importFileInput.value?.click()
}

async function handleImport(event: Event) {
  const target = event.target as HTMLInputElement
  const file = target.files?.[0]
  if (!file)
    return

  try {
    const raw = await file.text()
    const parsed = JSON.parse(raw) as Record<string, unknown>

    switch (importType.value) {
      case 'characters':
        await importAllCharacters(parsed)
        break
      case 'memory':
        await importMemory(parsed)
        break
      case 'backgrounds':
        await importBackgrounds(parsed)
        break
      default:
        await importChatSessions(parsed)
    }

    setStatus(t('settings.pages.data.status.imported'))
    importError.value = ''
  }
  catch (error) {
    console.error(error)
    importError.value = t('settings.pages.data.status.import_error')
    setStatus(error instanceof Error ? error.message : String(error), 'error')
  }
  finally {
    target.value = ''
  }
}

const formattedBackupLocation = computed(() => {
  if (syncEngineStore.activeProvider === 'local-fs') {
    return syncEngineStore.fsBackupPath
  }
  return ''
})

const formattedLastSyncTime = computed(() => {
  if (!syncEngineStore.lastSyncTime)
    return 'Never'
  return new Date(syncEngineStore.lastSyncTime).toLocaleString()
})

async function handleTriggerBackup() {
  await syncEngineStore.triggerSync()
  if (!syncEngineStore.syncError) {
    setStatus(`Backup completed successfully!`)
  }
  else {
    setStatus(`Backup failed: ${syncEngineStore.syncError}`, 'error')
  }
}

const airiCardStore = useAiriCardStore()
const orphanedGroups = ref<{ characterId: string, messageCount: number, lastActive: number, preview: string }[]>([])
const isModalOpen = ref(false)
const selectedOrphans = ref<string[]>([])

const isRestoreMappingOpen = ref(false)
const restoreMappings = ref<Record<string, string>>({})

const existingCharacters = computed(() => {
  return Array.from(airiCardStore.cards.entries()).map(([id, card]) => ({
    id,
    name: card.nickname || card.name,
  }))
})

async function loadOrphans() {
  orphanedGroups.value = await getOrphanedGroups()
}

onMounted(() => {
  loadOrphans()
})

function openManageModal() {
  selectedOrphans.value = []
  isModalOpen.value = true
  loadOrphans()
}

function selectAll() {
  selectedOrphans.value = orphanedGroups.value.map(g => g.characterId)
}

function deselectAll() {
  selectedOrphans.value = []
}

async function confirmNuke() {
  if (confirm(`Are you sure you want to delete all sessions associated with the selected character IDs? This action is permanent and cannot be undone.`)) {
    try {
      await nukeOrphanedGroups(selectedOrphans.value)
      selectedOrphans.value = []
      setStatus(`Successfully nuked selected orphaned sessions!`)
      await loadOrphans()
    }
    catch (e) {
      console.error(e)
      setStatus(e instanceof Error ? e.message : String(e), 'error')
    }
  }
}

function handleRestore() {
  restoreMappings.value = {}
  selectedOrphans.value.forEach((id) => {
    restoreMappings.value[id] = 'new'
  })
  isRestoreMappingOpen.value = true
}

async function executeRestore() {
  try {
    await restoreOrphanedGroups(restoreMappings.value)
    const count = Object.keys(restoreMappings.value).length
    isRestoreMappingOpen.value = false
    selectedOrphans.value = []
    setStatus(`Successfully restored/merged ${count} companion(s)!`)
    await loadOrphans()
  }
  catch (e) {
    console.error(e)
    setStatus(e instanceof Error ? e.message : String(e), 'error')
  }
}
</script>

<template>
  <div class="flex flex-col gap-4 pb-4">
    <!-- Unified Data Vault Card -->
    <div class="border-2 border-primary/20 rounded-2xl bg-primary/5 p-6 shadow-sm dark:border-primary/30 dark:bg-primary/10">
      <div class="flex flex-col items-start justify-between gap-4 md:flex-row md:items-center">
        <div>
          <div class="text-xl text-neutral-900 font-bold dark:text-white">
            Data Vault: Archive & Universal Import
          </div>
          <p class="mt-1 text-sm text-neutral-600 dark:text-neutral-400">
            Create selective, human-readable ZIP archives across all memory pillars or restore data with automatic companion linking.
          </p>
        </div>
        <div class="flex flex-wrap gap-3">
          <Button variant="secondary" class="flex items-center gap-2" @click="isImportVaultOpen = true">
            <span>📥</span>
            <span>Universal Import</span>
          </Button>
          <Button variant="primary" class="flex items-center gap-2" @click="isExportVaultOpen = true">
            <span>📦</span>
            <span>Export Archive</span>
          </Button>
        </div>
      </div>
    </div>

    <!-- Collapsible Legacy Single-File Domain Tools -->
    <div class="border border-neutral-200/60 rounded-xl bg-white/40 p-4 dark:border-neutral-800/60 dark:bg-neutral-900/40">
      <button
        type="button"
        class="w-full flex items-center justify-between text-left text-sm text-neutral-700 font-semibold dark:text-neutral-300"
        @click="showLegacyTools = !showLegacyTools"
      >
        <span>Individual Domain Tools (Legacy Single-File JSON)</span>
        <span class="text-xs text-neutral-400">{{ showLegacyTools ? '▲ Hide' : '▼ Show' }}</span>
      </button>

      <div v-if="showLegacyTools" class="mt-4 flex flex-col gap-4">
        <!-- Chats -->
        <div class="border-2 border-neutral-200/50 rounded-xl bg-white/70 p-4 shadow-sm dark:border-neutral-800/60 dark:bg-neutral-900/60">
          <div class="grid grid-cols-1 items-start gap-3 md:grid-cols-[minmax(0,1fr)_auto]">
            <div class="flex flex-col gap-1 md:max-w-[560px]">
              <div class="text-lg font-medium">
                {{ t('settings.pages.data.sections.chats.title') }}
              </div>
              <p class="text-sm text-neutral-600 dark:text-neutral-400">
                {{ t('settings.pages.data.sections.chats.description') }}
              </p>
            </div>
            <div class="flex flex-col items-start gap-2 sm:items-end">
              <div class="flex flex-wrap gap-2">
                <Button variant="secondary" @click="triggerExport('chats')">
                  {{ t('settings.pages.data.sections.chats.export') }}
                </Button>
                <Button variant="primary" @click="triggerImportPicker('chats')">
                  {{ t('settings.pages.data.sections.chats.import') }}
                </Button>
              </div>
              <DoubleCheckButton
                variant="danger"
                @confirm="runAction(deleteAllChatSessions, 'settings.pages.data.status.chats_deleted')"
              >
                {{ t('settings.pages.data.sections.chats.delete') }}
                <template #confirm>
                  {{ t('settings.pages.data.confirmations.yes') }}
                </template>
                <template #cancel>
                  {{ t('settings.pages.card.cancel') }}
                </template>
              </DoubleCheckButton>
            </div>
          </div>
          <input ref="importFileInput" type="file" accept="application/json" class="hidden" @change="handleImport">
          <p v-if="importError" class="text-sm text-red-500">
            {{ importError }}
          </p>
        </div>

        <!-- Characters -->
        <div class="border-2 border-neutral-200/50 rounded-xl bg-white/70 p-4 shadow-sm dark:border-neutral-800/60 dark:bg-neutral-900/60">
          <div class="grid grid-cols-1 items-start gap-3 md:grid-cols-[minmax(0,1fr)_auto]">
            <div class="flex flex-col gap-1 md:max-w-[560px]">
              <div class="text-lg font-medium">
                {{ t('settings.pages.data.sections.characters.title') }}
              </div>
              <p class="text-sm text-neutral-600 dark:text-neutral-400">
                {{ t('settings.pages.data.sections.characters.description') }}
              </p>
            </div>
            <div class="flex flex-col items-start gap-2 sm:items-end">
              <div class="flex flex-wrap gap-2">
                <Button variant="secondary" @click="triggerExport('characters')">
                  {{ t('settings.pages.data.sections.characters.export') }}
                </Button>
                <Button variant="primary" @click="triggerImportPicker('characters')">
                  {{ t('settings.pages.data.sections.characters.import') }}
                </Button>
              </div>
            </div>
          </div>
        </div>

        <!-- Memory -->
        <div class="border-2 border-neutral-200/50 rounded-xl bg-white/70 p-4 shadow-sm dark:border-neutral-800/60 dark:bg-neutral-900/60">
          <div class="grid grid-cols-1 items-start gap-3 md:grid-cols-[minmax(0,1fr)_auto]">
            <div class="flex flex-col gap-1 md:max-w-[560px]">
              <div class="text-lg font-medium">
                {{ t('settings.pages.data.sections.memory.title') }}
              </div>
              <p class="text-sm text-neutral-600 dark:text-neutral-400">
                {{ t('settings.pages.data.sections.memory.description') }}
              </p>
            </div>
            <div class="flex flex-col items-start gap-2 sm:items-end">
              <div class="flex flex-wrap gap-2">
                <Button variant="secondary" @click="triggerExport('memory')">
                  {{ t('settings.pages.data.sections.memory.export') }}
                </Button>
                <Button variant="primary" @click="triggerImportPicker('memory')">
                  {{ t('settings.pages.data.sections.memory.import') }}
                </Button>
              </div>
            </div>
          </div>
        </div>

        <!-- Backgrounds -->
        <div class="border-2 border-neutral-200/50 rounded-xl bg-white/70 p-4 shadow-sm dark:border-neutral-800/60 dark:bg-neutral-900/60">
          <div class="grid grid-cols-1 items-start gap-3 md:grid-cols-[minmax(0,1fr)_auto]">
            <div class="flex flex-col gap-1 md:max-w-[560px]">
              <div class="text-lg font-medium">
                {{ t('settings.pages.data.sections.backgrounds.title') }}
              </div>
              <p class="text-sm text-neutral-600 dark:text-neutral-400">
                {{ t('settings.pages.data.sections.backgrounds.description') }}
              </p>
            </div>
            <div class="flex flex-col items-start gap-2 sm:items-end">
              <div class="flex flex-wrap gap-2">
                <Button variant="secondary" @click="triggerExport('backgrounds')">
                  {{ t('settings.pages.data.sections.backgrounds.export') }}
                </Button>
                <Button variant="primary" @click="triggerImportPicker('backgrounds')">
                  {{ t('settings.pages.data.sections.backgrounds.import') }}
                </Button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- Backup -->
    <div class="border-2 border-neutral-200/50 rounded-xl bg-white/70 p-4 shadow-sm dark:border-neutral-800/60 dark:bg-neutral-900/60">
      <div class="grid grid-cols-1 items-start gap-3 md:grid-cols-[minmax(0,1fr)_auto]">
        <div class="flex flex-col gap-1 md:max-w-[560px]">
          <div class="text-lg font-medium">
            Auto-Backup & Manual Backup
          </div>
          <p class="text-sm text-neutral-600 dark:text-neutral-400">
            Configure auto-backup or trigger a manual backup.
          </p>
          <div class="mt-2 text-sm text-neutral-500">
            <div>Backup Provider: <span class="font-semibold">{{ syncEngineStore.activeProvider === 'local-fs' ? 'Local File System / Samba' : syncEngineStore.activeProvider }}</span></div>
            <div v-if="formattedBackupLocation">
              Backup Location: <span class="font-mono">{{ formattedBackupLocation }}</span>
            </div>
            <div>Last Backup: <span class="font-mono">{{ formattedLastSyncTime }}</span></div>
          </div>
        </div>
        <div class="flex flex-col items-start gap-2 sm:items-end">
          <div class="flex flex-wrap gap-2">
            <Button :variant="syncEngineStore.syncEnabled ? 'primary' : 'secondary'" @click="syncEngineStore.syncEnabled = !syncEngineStore.syncEnabled">
              {{ syncEngineStore.syncEnabled ? 'Auto-Backup Enabled' : 'Auto-Backup Disabled' }}
            </Button>
            <Button variant="primary" :disabled="syncEngineStore.isSyncing" @click="handleTriggerBackup">
              Trigger Backup
            </Button>
          </div>
        </div>
      </div>
    </div>

    <!-- Orphaned Sessions Maintenance -->
    <div class="border-2 border-neutral-200/50 rounded-xl bg-white/70 p-4 shadow-sm dark:border-neutral-800/60 dark:bg-neutral-900/60">
      <div class="grid grid-cols-1 items-start gap-3 md:grid-cols-[minmax(0,1fr)_auto]">
        <div class="flex flex-col gap-1 md:max-w-[560px]">
          <div class="text-lg font-medium">
            Orphaned Sessions Maintenance
          </div>
          <p class="text-sm text-neutral-600 dark:text-neutral-400">
            Clean up or restore chat histories left behind by deleted characters.
          </p>
          <div class="mt-2 text-sm text-neutral-500">
            Orphaned Groups Found: <span class="font-semibold">{{ orphanedGroups.length }}</span>
          </div>
        </div>
        <div class="flex flex-col items-start gap-2 sm:items-end">
          <Button variant="secondary" @click="openManageModal">
            Manage Orphans
          </Button>
        </div>
      </div>
    </div>

    <div class="border-2 border-neutral-200/50 rounded-xl bg-white/70 p-4 shadow-sm dark:border-neutral-800/60 dark:bg-neutral-900/60">
      <div class="flex flex-col gap-3">
        <div class="grid grid-cols-1 items-start gap-3 md:grid-cols-[minmax(0,1fr)_auto]">
          <div class="flex flex-col gap-1 md:max-w-[560px]">
            <div class="text-lg font-medium">
              {{ t('settings.pages.data.sections.models.title') }}
            </div>
            <p class="text-sm text-neutral-600 dark:text-neutral-400">
              {{ t('settings.pages.data.sections.models.description') }}
            </p>
          </div>
          <div class="flex flex-col items-start gap-2">
            <DoubleCheckButton
              variant="danger"
              @confirm="runAction(deleteAllModels, 'settings.pages.data.status.models_deleted')"
            >
              {{ t('settings.pages.data.sections.models.delete') }}
              <template #confirm>
                {{ t('settings.pages.data.confirmations.yes') }}
              </template>
              <template #cancel>
                {{ t('settings.pages.card.cancel') }}
              </template>
            </DoubleCheckButton>
          </div>
        </div>

        <div class="grid grid-cols-1 items-start gap-3 md:grid-cols-[minmax(0,1fr)_auto]">
          <div class="flex flex-col gap-1 md:max-w-[560px]">
            <div class="text-lg font-medium">
              {{ t('settings.pages.data.sections.modules.title') }}
            </div>
            <p class="text-sm text-neutral-600 dark:text-neutral-400">
              {{ t('settings.pages.data.sections.modules.description') }}
            </p>
          </div>
          <div class="flex flex-col items-start gap-2">
            <DoubleCheckButton
              variant="caution"
              @confirm="runAction(resetModulesSettings, 'settings.pages.data.status.modules_reset')"
            >
              {{ t('settings.pages.data.sections.modules.reset') }}
              <template #confirm>
                {{ t('settings.pages.data.confirmations.yes') }}
              </template>
              <template #cancel>
                {{ t('settings.pages.card.cancel') }}
              </template>
            </DoubleCheckButton>
          </div>
        </div>
      </div>
    </div>

    <div class="border-2 border-neutral-200/50 rounded-xl bg-white/70 p-4 shadow-sm dark:border-neutral-800/60 dark:bg-neutral-900/60">
      <div class="flex flex-col gap-3">
        <div>
          <div class="text-lg text-red-600 font-semibold dark:text-red-300">
            {{ t('settings.pages.data.sections.danger.title') }}
          </div>
          <p class="text-sm text-red-600/80 dark:text-red-200/80">
            {{ t('settings.pages.data.sections.danger.description') }}
          </p>
        </div>

        <div class="flex flex-col gap-3">
          <div class="grid gap-3 md:grid-cols-2">
            <div class="rounded-lg bg-white/70 p-3 dark:bg-red-950/40">
              <div class="grid grid-cols-1 items-start gap-2 md:grid-cols-[minmax(0,1fr)_auto]">
                <div class="flex flex-col gap-1 md:max-w-[560px]">
                  <div class="text-sm text-red-700 font-medium dark:text-red-200">
                    {{ t('settings.pages.data.sections.providers.title') }}
                  </div>
                  <p class="text-xs text-red-700/80 dark:text-red-200/80">
                    {{ t('settings.pages.data.sections.providers.description') }}
                  </p>
                </div>
                <div class="flex flex-col items-start gap-2">
                  <DoubleCheckButton
                    variant="danger"
                    @confirm="runAction(resetProvidersSettings, 'settings.pages.data.status.providers_reset')"
                  >
                    {{ t('settings.pages.data.sections.providers.reset') }}
                    <template #confirm>
                      {{ t('settings.pages.data.confirmations.yes') }}
                    </template>
                    <template #cancel>
                      {{ t('settings.pages.card.cancel') }}
                    </template>
                  </DoubleCheckButton>
                </div>
              </div>
            </div>

            <div class="rounded-lg bg-white/70 p-3 dark:bg-red-950/40">
              <div class="grid grid-cols-1 items-start gap-2 md:grid-cols-[minmax(0,1fr)_auto]">
                <div class="flex flex-col gap-1 md:max-w-[560px]">
                  <div class="text-sm text-red-700 font-medium dark:text-red-200">
                    {{ t('settings.pages.data.sections.all.title') }}
                  </div>
                  <p class="text-xs text-red-700/80 dark:text-red-200/80">
                    {{ t('settings.pages.data.sections.all.description') }}
                  </p>
                </div>
                <div class="flex flex-col items-start gap-2">
                  <DoubleCheckButton
                    variant="danger"
                    @confirm="runAction(deleteAllData, 'settings.pages.data.status.all_deleted')"
                  >
                    {{ t('settings.pages.data.sections.all.delete') }}
                    <template #confirm>
                      {{ t('settings.pages.data.confirmations.yes') }}
                    </template>
                    <template #cancel>
                      {{ t('settings.pages.card.cancel') }}
                    </template>
                  </DoubleCheckButton>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>

    <div
      v-if="isDesktop"
      class="border-2 border-amber-300/80 rounded-xl bg-amber-50/80 p-4 shadow-sm dark:border-amber-500/60 dark:bg-amber-500/10"
    >
      <div class="grid grid-cols-1 items-start gap-3 md:grid-cols-[minmax(0,1fr)_auto]">
        <div class="flex flex-col gap-1 md:max-w-[560px]">
          <div class="text-lg text-amber-700 font-medium dark:text-amber-200">
            {{ t('settings.pages.data.sections.desktop.title') }}
          </div>
          <p class="text-sm text-amber-700/80 dark:text-amber-200/80">
            {{ t('settings.pages.data.sections.desktop.description') }}
          </p>
        </div>
        <div class="flex flex-col items-start gap-2">
          <DoubleCheckButton
            variant="caution"
            @confirm="runAction(resetDesktopApplicationState, 'settings.pages.data.status.desktop_reset')"
          >
            {{ t('settings.pages.data.sections.desktop.reset') }}
            <template #confirm>
              {{ t('settings.pages.data.confirmations.yes') }}
            </template>
            <template #cancel>
              {{ t('settings.pages.card.cancel') }}
            </template>
          </DoubleCheckButton>
        </div>
      </div>
    </div>
  </div>

  <DialogRoot :open="isModalOpen" @update:open="isModalOpen = $event">
    <DialogPortal>
      <DialogOverlay class="fixed inset-0 z-100 bg-black/50 backdrop-blur-sm data-[state=closed]:animate-fadeOut data-[state=open]:animate-fadeIn" />
      <DialogContent class="fixed left-1/2 top-1/2 z-100 m-0 max-h-[90vh] max-w-5xl w-[92vw] flex flex-col border border-neutral-200 rounded-2xl bg-white p-6 shadow-2xl -translate-x-1/2 -translate-y-1/2 data-[state=closed]:animate-contentHide data-[state=open]:animate-contentShow dark:border-neutral-700 dark:bg-neutral-800">
        <div class="h-full flex flex-col gap-6 overflow-hidden">
          <div class="flex items-center justify-between border-b border-neutral-200 pb-3 dark:border-neutral-700">
            <div>
              <DialogTitle class="from-primary-500 to-primary-400 bg-gradient-to-r bg-clip-text text-xl text-transparent font-bold">
                Manage Orphaned Sessions
              </DialogTitle>
              <p class="mt-1 text-xs text-neutral-500 dark:text-neutral-400">
                Preview, restore, or purge session histories from characters that have been deleted.
              </p>
            </div>
          </div>

          <div class="flex-1 overflow-y-auto pr-1">
            <div v-if="orphanedGroups.length === 0" class="flex flex-col items-center justify-center py-12 text-neutral-500 dark:text-neutral-400">
              <div class="mb-2 text-4xl">
                🎉
              </div>
              <p class="text-sm font-medium">
                No orphaned session groups found.
              </p>
              <p class="mt-1 text-xs text-neutral-400">
                Everything is clean!
              </p>
            </div>
            <div v-else class="flex flex-col gap-4">
              <div class="flex items-center gap-2">
                <Button variant="secondary" size="sm" @click="selectAll">
                  Select All
                </Button>
                <Button variant="secondary" size="sm" @click="deselectAll">
                  Deselect All
                </Button>
              </div>

              <div class="overflow-x-auto border border-neutral-200 rounded-xl dark:border-neutral-700">
                <table class="w-full border-collapse table-fixed text-left">
                  <thead>
                    <tr class="border-b border-neutral-200 bg-neutral-50 dark:border-neutral-700 dark:bg-neutral-900">
                      <th class="w-12 p-3" />
                      <th class="w-24 p-3 text-xs text-neutral-500 font-semibold uppercase dark:text-neutral-400">
                        Messages
                      </th>
                      <th class="w-44 p-3 text-xs text-neutral-500 font-semibold uppercase dark:text-neutral-400">
                        Last Active
                      </th>
                      <th class="p-3 text-xs text-neutral-500 font-semibold uppercase dark:text-neutral-400">
                        Preview
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr
                      v-for="group in orphanedGroups"
                      :key="group.characterId"
                      :class="['border-b border-neutral-100 dark:border-neutral-800 last:border-none', 'hover:bg-neutral-50/50 dark:hover:bg-neutral-900/30']"
                    >
                      <td class="p-3 text-center">
                        <input
                          v-model="selectedOrphans"
                          type="checkbox"
                          :value="group.characterId"
                          :class="['h-4 w-4 cursor-pointer accent-primary-500']"
                        >
                      </td>
                      <td :class="['p-3 text-sm text-neutral-600 dark:text-neutral-400']">
                        {{ group.messageCount }}
                      </td>
                      <td :class="['whitespace-nowrap p-3 text-sm text-neutral-600 dark:text-neutral-400']">
                        {{ group.lastActive ? new Date(group.lastActive).toLocaleString() : 'Never' }}
                      </td>
                      <td :class="['p-3 text-xs text-neutral-500 dark:text-neutral-400 font-normal line-clamp-3 whitespace-normal break-words']">
                        {{ group.preview || 'No messages' }}
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>
          </div>

          <div class="flex items-center justify-between border-t border-neutral-200 pt-4 dark:border-neutral-700">
            <Button
              variant="secondary"
              label="Close"
              @click="isModalOpen = false"
            />
            <div class="flex gap-2">
              <Button
                variant="danger"
                label="Nuke Selected"
                :disabled="selectedOrphans.length === 0"
                @click="confirmNuke"
              />
              <Button
                variant="primary"
                label="Restore Selected"
                :disabled="selectedOrphans.length === 0"
                @click="handleRestore"
              />
            </div>
          </div>
        </div>
      </DialogContent>
    </DialogPortal>
  </DialogRoot>

  <DialogRoot :open="isRestoreMappingOpen" @update:open="isRestoreMappingOpen = $event">
    <DialogPortal>
      <DialogOverlay class="fixed inset-0 z-110 bg-black/50 backdrop-blur-sm data-[state=closed]:animate-fadeOut data-[state=open]:animate-fadeIn" />
      <DialogContent class="fixed left-1/2 top-1/2 z-110 m-0 max-h-[80vh] max-w-lg w-[90vw] flex flex-col border border-neutral-200 rounded-2xl bg-white p-6 shadow-2xl -translate-x-1/2 -translate-y-1/2 data-[state=closed]:animate-contentHide data-[state=open]:animate-contentShow dark:border-neutral-700 dark:bg-neutral-800">
        <div class="h-full flex flex-col gap-5 overflow-hidden">
          <div class="border-b border-neutral-200 pb-3 dark:border-neutral-700">
            <DialogTitle class="from-primary-500 to-primary-400 bg-gradient-to-r bg-clip-text text-lg text-transparent font-bold">
              Restore Target Selection
            </DialogTitle>
            <p class="mt-1 text-xs text-neutral-500 dark:text-neutral-400">
              Map each orphaned session to a new companion card or merge into an existing companion.
            </p>
          </div>

          <div class="flex flex-1 flex-col gap-4 overflow-y-auto pr-1">
            <div v-for="orphanId in Object.keys(restoreMappings)" :key="orphanId" class="flex flex-col gap-2 rounded-lg bg-neutral-50 p-3 dark:bg-neutral-900/50">
              <span class="break-all text-xs text-neutral-800 font-semibold font-mono dark:text-neutral-200">
                {{ orphanId }}
              </span>
              <select
                v-model="restoreMappings[orphanId]"
                class="w-full border border-neutral-200 rounded-lg bg-white px-3 py-2 text-sm text-neutral-800 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-200 focus:outline-none focus:ring-2 focus:ring-primary-500"
              >
                <option value="new">
                  ✨ Create New Companion ({{ orphanId }})
                </option>
                <option v-for="char in existingCharacters" :key="char.id" :value="char.id">
                  🤝 Merge into {{ char.name }}
                </option>
              </select>
            </div>
          </div>

          <div class="flex items-center justify-between border-t border-neutral-200 pt-4 dark:border-neutral-700">
            <Button
              variant="secondary"
              label="Cancel"
              @click="isRestoreMappingOpen = false"
            />
            <Button
              variant="primary"
              label="Confirm Restore"
              @click="executeRestore"
            />
          </div>
        </div>
      </DialogContent>
    </DialogPortal>
  </DialogRoot>

  <!-- Export Vault Modal -->
  <ExportVaultModal v-model="isExportVaultOpen" />

  <!-- Universal Import Vault Modal -->
  <ImportVaultModal v-model="isImportVaultOpen" @imported="onVaultImported" />
</template>

<route lang="yaml">
meta:
  layout: settings
  titleKey: settings.pages.data.title
  subtitleKey: settings.title
  descriptionKey: settings.pages.data.description
  icon: i-solar:database-bold-duotone
  settingsEntry: true
  order: 11
  stageTransition:
    name: slide
    pageSpecificAvailable: true
</route>
