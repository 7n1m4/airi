<script setup lang="ts">
import { useSyncEngineStore } from '@proj-airi/stage-ui/stores/sync-engine'
import { FieldInput } from '@proj-airi/ui'
import { storeToRefs } from 'pinia'
import { ref } from 'vue'

const syncStore = useSyncEngineStore()
const {
  s3Endpoint,
  s3Bucket,
  s3Region,
  s3AccessKeyId,
  s3SecretAccessKey,
} = storeToRefs(syncStore)

const validationStatus = ref<'idle' | 'success' | 'failed'>('idle')
const validationError = ref('')
const isValidating = ref(false)

async function handleValidate() {
  if (!s3Endpoint.value || !s3Bucket.value || !s3AccessKeyId.value || !s3SecretAccessKey.value) {
    validationStatus.value = 'failed'
    validationError.value = 'Please fill in all S3 fields.'
    return
  }

  isValidating.value = true
  validationStatus.value = 'idle'
  validationError.value = ''

  try {
    const res = await syncStore.validateConnection('s3')
    if (res.success) {
      validationStatus.value = 'success'
      syncStore.activeProvider = 's3'
    }
    else {
      validationStatus.value = 'failed'
      validationError.value = res.error || 'Failed to connect to S3.'
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
        S3-Compatible Cloud Storage
      </h2>
      <div class="text-neutral-400 dark:text-neutral-500">
        Configure synchronization to Amazon S3, Backblaze B2, or self-hosted MinIO.
      </div>
    </div>

    <div class="flex flex-col gap-4">
      <FieldInput
        v-model="s3Endpoint"
        label="Endpoint URL"
        description="The base endpoint URL of your S3 provider (e.g. https://s3.amazonaws.com)."
        placeholder="https://s3.amazonaws.com"
      />

      <FieldInput
        v-model="s3Bucket"
        label="Bucket Name"
        description="The name of your cloud bucket."
        placeholder="my-airi-sync"
      />

      <FieldInput
        v-model="s3Region"
        label="Region"
        description="The region of your bucket (defaults to us-east-1 if left blank)."
        placeholder="us-east-1"
      />

      <FieldInput
        v-model="s3AccessKeyId"
        label="Access Key ID"
        description="The S3 Access Key ID credential."
        placeholder="Enter Access Key ID"
        type="password"
      />

      <FieldInput
        v-model="s3SecretAccessKey"
        label="Secret Access Key"
        description="The S3 Secret Access Key credential."
        placeholder="Enter Secret Access Key"
        type="password"
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
          <span>Connected successfully! Bucket is accessible and writable.</span>
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
  titleKey: settings.pages.providers.provider.s3.settings.title
  subtitleKey: settings.title
  stageTransition:
    name: slide
</route>
