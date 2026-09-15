<script setup lang="ts">
import type { CursorState } from '../../../types/arcade'

import { computed } from 'vue'

const props = defineProps<{
  cursorState: CursorState
  characterName?: string
}>()

const leftPercent = computed(() => `${(props.cursorState.x / 10).toFixed(2)}%`)
const topPercent = computed(() => `${(props.cursorState.y / 10).toFixed(2)}%`)
</script>

<template>
  <div
    v-if="cursorState.visible"
    class="pointer-events-none absolute inset-0 z-30 select-none overflow-hidden transition-opacity duration-300"
    :class="cursorState.visible ? 'opacity-100' : 'opacity-0'"
  >
    <!-- Ghost Cursor Container -->
    <div
      class="absolute transition-all duration-75 ease-out -translate-x-3 -translate-y-3"
      :style="{ left: leftPercent, top: topPercent }"
    >
      <!-- Click Ripple Effect -->
      <div
        v-if="cursorState.clicking"
        class="absolute animate-ping rounded-full bg-primary-500/40 -inset-4"
      />
      <div
        v-if="cursorState.clicking"
        class="absolute animate-pulse border-2 border-primary-400 rounded-full bg-primary-500/20 -inset-2"
      />

      <!-- Mascot Cursor Pointer Icon -->
      <div
        class="relative flex items-center justify-center transition-transform duration-100"
        :class="cursorState.clicking ? 'scale-90' : 'scale-100'"
      >
        <!-- Glowing drop shadow cursor ring -->
        <div class="h-7 w-7 flex items-center justify-center border-2 border-white rounded-full bg-primary-600/90 text-white shadow-lg backdrop-blur-sm dark:border-neutral-900">
          <div class="i-solar:gamepad-bold text-xs" />
        </div>

        <!-- Mini Direction Arrow Pointer -->
        <div class="absolute h-3 w-3 rotate-45 border-l-2 border-t-2 border-white bg-primary-600 -left-1 -top-1 dark:border-neutral-900" />
      </div>

      <!-- Action Intent Badge Tooltip -->
      <div
        v-if="cursorState.activeActionLabel"
        class="absolute left-8 top-1 whitespace-nowrap border border-white/20 rounded-md bg-neutral-900/90 px-2 py-0.5 text-[11px] text-white font-medium shadow-md backdrop-blur-md dark:bg-neutral-800/95"
      >
        <div class="flex items-center gap-1.5">
          <span class="text-primary-300 font-bold">{{ characterName || 'Airi' }}:</span>
          <span>{{ cursorState.activeActionLabel }}</span>
        </div>
      </div>
    </div>

    <!-- Center Screen Pulse for Global Key Presses / Swipes -->
    <div
      v-if="cursorState.pinging"
      class="absolute inset-0 flex items-center justify-center"
    >
      <div class="animate-ping border-2 border-primary-500/60 rounded-2xl bg-primary-500/20 p-8 shadow-2xl">
        <span class="text-lg text-white font-bold">{{ cursorState.activeActionLabel }}</span>
      </div>
    </div>
  </div>
</template>
