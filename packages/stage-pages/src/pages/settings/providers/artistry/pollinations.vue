<script setup lang="ts">
import { useArtistryStore } from '@proj-anima/stage-ui/stores/modules/artistry'
import { FieldInput, FieldSelect } from '@proj-anima/ui'
import { storeToRefs } from 'pinia'
import { computed, onMounted, ref } from 'vue'

const artistryStore = useArtistryStore()

const {
  pollinationsApiKey,
  pollinationsModel,
  pollinationsWidth,
  pollinationsHeight,
  pollinationsCachedModels,
} = storeToRefs(artistryStore)

const isLoadingModels = ref(false)

const modelOptions = computed(() => {
  if (pollinationsCachedModels.value.length === 0) {
    return [
      { label: 'Free Router (Pollinations Auto) - Fastest available node', value: '' },
      { label: 'FLUX.1 Schnell (0.002 pollen)', value: 'flux' },
      { label: 'GPT Image 1.5 (0.000024 pollen)', value: 'gptimage-large' },
      { label: 'Nano Banana Pro (0.00012 pollen)', value: 'nanobanana-pro' },
      { label: 'Seedream 4.5 (0.04 pollen)', value: 'seedream-pro' },
    ]
  }
  return pollinationsCachedModels.value.map(m => ({
    label: m.price ? `${m.name} (${m.price})` : m.name,
    value: m.id,
  }))
})

const selectedModelDescription = computed(() => {
  const found = pollinationsCachedModels.value.find(m => m.id === pollinationsModel.value)
  return found?.description || 'Routes to the fastest available free cluster node automatically.'
})

const resolutionOptions = [
  { label: '1024 × 1024 (Square 1:1)', value: '1024x1024' },
  { label: '1280 × 720 (Landscape 16:9)', value: '1280x720' },
  { label: '720 × 1280 (Portrait 9:16)', value: '720x1280' },
  { label: '512 × 512 (Fast Preview 1:1)', value: '512x512' },
]

const currentResolution = computed({
  get: () => `${pollinationsWidth.value}x${pollinationsHeight.value}`,
  set: (val: string) => {
    const [w, h] = val.split('x').map(Number)
    if (w && h) {
      pollinationsWidth.value = w
      pollinationsHeight.value = h
    }
  },
})

async function refreshModels() {
  isLoadingModels.value = true
  try {
    await artistryStore.fetchPollinationsModels(true)
  }
  finally {
    isLoadingModels.value = false
  }
}

onMounted(() => {
  if (pollinationsCachedModels.value.length === 0) {
    refreshModels()
  }
})
</script>

<template>
  <div class="flex flex-col gap-6">
    <div
      class="border rounded-xl p-5 transition-colors"
      :class="pollinationsApiKey
        ? 'bg-purple-500/8 border-purple-500/20 dark:bg-purple-500/12'
        : 'bg-emerald-500/8 border-emerald-500/20 dark:bg-emerald-500/12'"
    >
      <div class="flex items-center justify-between">
        <div class="flex items-center gap-3">
          <div
            class="text-3xl"
            :class="pollinationsApiKey
              ? 'i-solar:crown-bold-duotone text-purple-500'
              : 'i-solar:magic-stick-3-bold-duotone text-emerald-500'"
          />
          <div>
            <h2 class="text-xl text-neutral-800 font-semibold dark:text-neutral-100">
              Pollinations AI
            </h2>
            <p class="text-sm text-neutral-500 dark:text-neutral-400">
              {{ pollinationsApiKey
                ? 'Authenticated Member Mode Active (Pollen Wallet Enabled)'
                : 'Free Anonymous Mode Active — Zero configuration, no API key required' }}
            </p>
          </div>
        </div>

        <div
          class="rounded-full px-3 py-1 text-xs font-semibold"
          :class="pollinationsApiKey
            ? 'bg-purple-500/20 text-purple-600 dark:text-purple-300'
            : 'bg-emerald-500/20 text-emerald-600 dark:text-emerald-300'"
        >
          {{ pollinationsApiKey ? 'Authenticated' : '100% Free' }}
        </div>
      </div>
    </div>

    <div class="flex flex-col gap-4">
      <FieldInput
        v-model="pollinationsApiKey"
        label="API Key (Optional)"
        description="Leave blank for free anonymous access. Paste your Pollen key to use premium models and priority queues."
        placeholder="Optional (leave empty for free tier)..."
        type="password"
      />

      <div class="flex flex-col gap-1.5">
        <div class="flex items-center justify-between">
          <label class="text-sm text-neutral-700 font-medium dark:text-neutral-300">
            Model Selection
          </label>
          <button
            type="button"
            class="flex items-center gap-1 text-xs text-neutral-500 transition-colors hover:text-neutral-800 dark:hover:text-neutral-200"
            :disabled="isLoadingModels"
            @click="refreshModels"
          >
            <div
              class="i-solar:refresh-bold-duotone text-sm"
              :class="{ 'animate-spin': isLoadingModels }"
            />
            <span>{{ isLoadingModels ? 'Refreshing...' : 'Refresh Catalog' }}</span>
          </button>
        </div>

        <FieldSelect
          v-model="pollinationsModel"
          label=""
          :description="selectedModelDescription"
          :options="modelOptions"
        />
      </div>

      <FieldSelect
        v-model="currentResolution"
        label="Default Resolution"
        description="The output dimensions for generated images"
        :options="resolutionOptions"
      />
    </div>
  </div>
</template>

<route lang="yaml">
meta:
  layout: settings
  titleKey: settings.pages.providers.provider.pollinations.settings.title
  subtitleKey: settings.title
  stageTransition:
    name: slide
</route>
