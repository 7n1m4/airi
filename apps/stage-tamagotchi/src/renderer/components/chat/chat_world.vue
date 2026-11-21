<script setup lang="ts">
import { CharacterContextView } from '@proj-anima/stage-ui/components'
import { useAiriCardStore } from '@proj-anima/stage-ui/stores/modules/airi-card'
import { storeToRefs } from 'pinia'

const airiCardStore = useAiriCardStore()
const { activeCardId } = storeToRefs(airiCardStore)
</script>

<template>
  <div class="h-full w-full overflow-hidden bg-white p-6 dark:bg-neutral-900/10">
    <div v-if="activeCardId" class="h-full w-full flex flex-col">
      <div class="mb-4">
        <h3 class="text-sm text-neutral-800 font-bold dark:text-neutral-200">
          World Bible
        </h3>
        <p class="mt-0.5 text-[10px] text-neutral-500">
          Explore active prompts, rules, acting hooks, and Dating Sim injections composed into this cast's runtime memory.
        </p>
      </div>
      <div class="flex-1 overflow-hidden">
        <CharacterContextView :character-id="activeCardId" />
      </div>
    </div>
    <div v-else class="h-full w-full flex flex-col items-center justify-center p-8 text-neutral-500 dark:text-neutral-400">
      <div class="i-solar:notes-bold-duotone mb-4 text-5xl text-primary-500" />
      <h3 class="text-lg font-bold">
        World Bible
      </h3>
      <p class="mt-1 text-sm opacity-70">
        Select a character session to view memory context.
      </p>
    </div>
  </div>
</template>
