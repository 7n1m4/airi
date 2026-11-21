<script setup lang="ts">
import { DirectorMonitorView } from '@proj-anima/stage-ui/components'
import { useChatSessionStore } from '@proj-anima/stage-ui/stores/chat/session-store'
import { storeToRefs } from 'pinia'

const chatSessionStore = useChatSessionStore()
const { activeSessionId } = storeToRefs(chatSessionStore)
</script>

<template>
  <div class="h-full w-full overflow-hidden bg-white p-6 dark:bg-neutral-900/10">
    <div v-if="activeSessionId" class="h-full w-full flex flex-col">
      <div class="mb-4">
        <h3 class="text-sm text-neutral-800 font-bold dark:text-neutral-200">
          Director's Monitor
        </h3>
        <p class="mt-0.5 text-[10px] text-neutral-500">
          Timeline track of director directives, visual parameters, and narrative pacing coefficients.
        </p>
      </div>
      <div class="flex-1 overflow-hidden">
        <DirectorMonitorView :session-id="activeSessionId" />
      </div>
    </div>
    <div v-else class="h-full w-full flex flex-col items-center justify-center p-8 text-neutral-500 dark:text-neutral-400">
      <div class="i-solar:videocamera-record-bold-duotone mb-4 text-5xl text-primary-500" />
      <h3 class="text-lg font-bold">
        Director's Monitor
      </h3>
      <p class="mt-1 text-sm opacity-70">
        Select a character session to view narrative feeds.
      </p>
    </div>
  </div>
</template>
