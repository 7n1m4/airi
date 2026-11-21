<script setup lang="ts">
import { useSyncEngineStore } from '@proj-anima/stage-ui/stores/sync-engine'
import { FieldInput } from '@proj-anima/ui'
import { storeToRefs } from 'pinia'
import { ref } from 'vue'

const syncStore = useSyncEngineStore()
const { fsBackupPath } = storeToRefs(syncStore)

const validationStatus = ref<'idle' | 'success' | 'failed'>('idle')
const validationError = ref('')
const isValidating = ref(false)

async function handleValidate() {
  if (!fsBackupPath.value) {
    validationStatus.value = 'failed'
    validationError.value = 'Please enter a valid path.'
    return
  }

  isValidating.value = true
  validationStatus.value = 'idle'
  validationError.value = ''

  try {
    const res = await syncStore.validatePath(fsBackupPath.value)
    if (res.success) {
      validationStatus.value = 'success'
      syncStore.activeProvider = 'local-fs'
    }
    else {
      validationStatus.value = 'failed'
      validationError.value = res.error || 'Failed to access the path.'
    }
  }
  catch (err) {
    validationStatus.value = 'failed'
    validationError.value = String(err)
  }
  finally {
    isValidating.value = false
  }
}
</script>

<template>
  <div class="flex flex-col gap-6">
    <div>
      <h2 class="text-lg text-neutral-500 md:text-2xl dark:text-neutral-400">
        Local File System / Samba Share
      </h2>
      <div class="text-neutral-400 dark:text-neutral-500">
        Configure synchronization to a local path, network attached storage (NAS), or a mounted Samba/SMB network share.
      </div>
    </div>

    <div class="flex flex-col gap-4">
      <FieldInput
        v-model="fsBackupPath"
        label="Backup Directory Path"
        description="The absolute path to your local sync folder or mounted network drive."
        placeholder="/Volumes/AIRI-Backup-Share"
      />

      <div class="mt-2 flex items-center gap-4">
        <button
          class="flex items-center gap-2 rounded-xl bg-primary-500/10 px-4 py-2 text-sm text-primary-600 font-semibold outline-none transition-colors duration-200 dark:bg-primary-500/20 hover:bg-primary-500/20 dark:text-primary-300 dark:hover:bg-primary-500/30"
          :disabled="isValidating"
          @click="handleValidate"
        >
          <div v-if="isValidating" class="i-eos-icons:loading animate-spin" />
          <div v-else class="i-solar:shield-check-bold" />
          {{ isValidating ? 'Validating...' : 'Validate Connection' }}
        </button>

        <div v-if="validationStatus === 'success'" class="flex items-center gap-2 text-sm text-emerald-600 font-medium dark:text-emerald-400">
          <div class="size-2 animate-pulse rounded-full bg-emerald-500" />
          <span>Path accessible and writable!</span>
        </div>

        <div v-else-if="validationStatus === 'failed'" class="flex items-center gap-2 text-sm text-rose-600 font-medium dark:text-rose-400">
          <div class="size-2 rounded-full bg-rose-500" />
          <span>Validation failed: {{ validationError }}</span>
        </div>
      </div>
    </div>
  </div>
</template>

<route lang="yaml">
meta:
  layout: settings
  titleKey: settings.pages.providers.provider.local-fs.settings.title
  subtitleKey: settings.title
  stageTransition:
    name: slide
</route>
