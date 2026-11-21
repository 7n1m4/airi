<script setup lang="ts">
import AudioStudio from '@proj-anima/stage-ui/components/scenarios/settings/model-settings/audio-studio.vue'
</script>

<template>
  <div class="flex flex-col gap-6 p-6">
    <div class="mb-4 flex flex-col gap-1">
      <h2 class="text-xl text-neutral-800 font-bold md:text-3xl dark:text-neutral-100">
        Audio Studio Console
      </h2>
      <p class="text-sm text-neutral-500 dark:text-neutral-400">
        Manage and build virtual voice bundles with custom post-processing effects and dialogue filters.
      </p>
    </div>

    <AudioStudio />
  </div>
</template>

<route lang="yaml">
  meta:
    layout: settings
    stageTransition:
      name: slide
</route>
