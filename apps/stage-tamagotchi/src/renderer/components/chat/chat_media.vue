<script setup lang="ts">
import { StageBackgroundPicker } from '@proj-anima/stage-ui/components'
import { useAiriCardStore } from '@proj-anima/stage-ui/stores/modules/airi-card'
import { storeToRefs } from 'pinia'

const airiCardStore = useAiriCardStore()
const { activeCardId } = storeToRefs(airiCardStore)
</script>

<template>
  <div class="h-full w-full overflow-hidden bg-white p-6 dark:bg-neutral-900/10">
    <div v-if="activeCardId" class="h-full w-full">
      <StageBackgroundPicker
        :card-id="activeCardId"
        grid-max-height-class="max-h-[calc(100vh-200px)]"
      />
    </div>
    <div v-else class="h-full w-full flex flex-col items-center justify-center p-8 text-neutral-500 dark:text-neutral-400">
      <div class="i-solar:gallery-bold-duotone mb-4 text-5xl text-primary-500" />
      <h3 class="text-lg font-bold">
        Media Library
      </h3>
      <p class="mt-1 text-sm opacity-70">
        Select a character session to view generated media.
      </p>
    </div>
  </div>
</template>
