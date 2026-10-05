<script setup lang="ts">
import { chatStickers } from '@proj-airi/stage-ui/assets/stickers'
import { useStickersStore } from '@proj-airi/stage-ui/stores/stickers'
import { ref } from 'vue'
import { toast } from 'vue-sonner'

defineProps<{
  cardId?: string
}>()

const stickersStore = useStickersStore()

// Settings state
const frequencyTier = ref<'off' | '25' | '50' | '75' | '100'>('50')
const destinationMode = ref<'hybrid' | 'chat' | 'screen'>('hybrid')

function testSlapSticker(stickerId: string, label: string) {
  const result = stickersStore.spawnSticker(stickerId)
  if (typeof result === 'object') {
    toast.success(`Slapped "${label}" on screen!`)
  }
  else {
    toast.error(String(result))
  }
}
</script>

<template>
  <div class="flex flex-col gap-6">
    <!-- Header Card -->
    <div class="border border-primary-500/20 rounded-2xl bg-primary-500/5 p-5">
      <div class="flex items-center gap-3">
        <div class="rounded-xl bg-primary-500/10 p-2.5 text-xl text-primary-500">
          <div class="i-solar:sticker-smile-circle-bold-duotone" />
        </div>
        <div>
          <h3 class="text-base text-neutral-800 font-semibold dark:text-neutral-100">
            Chibi Reaction Stickers & Desktop Slappers
          </h3>
          <p class="text-xs text-neutral-500 dark:text-neutral-400">
            Configure emotional stickers. The character can emit <code class="rounded bg-neutral-200/50 px-1 py-0.5 text-primary-600 dark:bg-neutral-800/50 dark:text-primary-400">&lt;|STICKER &lt;id&gt;|&gt;</code> tokens in chat replies or slap them directly onto the stage viewport.
          </p>
        </div>
      </div>

      <!-- Controls Grid -->
      <div class="grid grid-cols-1 mt-5 gap-4 md:grid-cols-2">
        <!-- Frequency Control -->
        <div class="flex flex-col gap-2 border border-neutral-200/50 rounded-xl bg-white/40 p-3.5 dark:border-neutral-800/50 dark:bg-black/20">
          <label class="text-xs text-neutral-700 font-medium dark:text-neutral-300">
            Reaction Frequency
          </label>
          <div class="grid grid-cols-5 gap-1 text-xs">
            <button
              v-for="tier in [
                { id: 'off', label: 'Off' },
                { id: '25', label: '25%' },
                { id: '50', label: '50%' },
                { id: '75', label: '75%' },
                { id: '100', label: '100%' },
              ]"
              :key="tier.id"
              :class="[
                'py-1.5 px-2 rounded-lg font-medium transition-all text-center',
                frequencyTier === tier.id
                  ? 'bg-primary-500 text-white shadow-sm'
                  : 'bg-neutral-100 dark:bg-neutral-800 text-neutral-600 dark:text-neutral-400 hover:bg-neutral-200 dark:hover:bg-neutral-700',
              ]"
              @click="frequencyTier = tier.id as any"
            >
              {{ tier.label }}
            </button>
          </div>
          <p class="text-[11px] text-neutral-400">
            Controls how often the character is eligible to punctuate messages with an emotion sticker.
          </p>
        </div>

        <!-- Destination Target -->
        <div class="flex flex-col gap-2 border border-neutral-200/50 rounded-xl bg-white/40 p-3.5 dark:border-neutral-800/50 dark:bg-black/20">
          <label class="text-xs text-neutral-700 font-medium dark:text-neutral-300">
            Manifestation Destination
          </label>
          <div class="grid grid-cols-3 gap-1 text-xs">
            <button
              v-for="dest in [
                { id: 'hybrid', label: 'Hybrid' },
                { id: 'chat', label: 'Chat Only' },
                { id: 'screen', label: 'Screen Only' },
              ]"
              :key="dest.id"
              :class="[
                'py-1.5 px-2 rounded-lg font-medium transition-all text-center',
                destinationMode === dest.id
                  ? 'bg-primary-500 text-white shadow-sm'
                  : 'bg-neutral-100 dark:bg-neutral-800 text-neutral-600 dark:text-neutral-400 hover:bg-neutral-200 dark:hover:bg-neutral-700',
              ]"
              @click="destinationMode = dest.id as any"
            >
              {{ dest.label }}
            </button>
          </div>
          <p class="text-[11px] text-neutral-400">
            Hybrid renders in chat bubbles during chat, and slaps onto the stage when the stage is visible.
          </p>
        </div>
      </div>
    </div>

    <!-- Gallery Card -->
    <div class="flex flex-col gap-3">
      <div class="flex items-center justify-between">
        <h4 class="flex items-center gap-2 text-sm text-neutral-800 font-semibold dark:text-neutral-200">
          <span>Bundled AIRI Reaction Pack</span>
          <span class="text-xs text-neutral-400 font-normal">({{ chatStickers.length }} built-in stickers)</span>
        </h4>
        <button
          class="flex items-center gap-1 text-xs text-primary-500 hover:underline"
          @click="stickersStore.clearPlacements()"
        >
          <div class="i-solar:trash-bin-trash-bold text-xs" />
          <span>Clear Screen Slaps</span>
        </button>
      </div>

      <div class="grid grid-cols-2 gap-3 lg:grid-cols-6 md:grid-cols-4 sm:grid-cols-3">
        <div
          v-for="sticker in chatStickers"
          :key="sticker.id"
          class="group relative flex flex-col items-center justify-between border border-neutral-200 rounded-xl bg-white/60 p-3 text-center transition-all dark:border-neutral-800 hover:border-primary-500/40 dark:bg-neutral-900/60 hover:shadow-md"
        >
          <div class="h-20 w-20 flex items-center justify-center overflow-hidden">
            <img
              :src="sticker.src"
              :alt="sticker.description"
              class="max-h-full max-w-full object-contain transition-transform group-hover:scale-110"
            >
          </div>
          <div class="mt-2 w-full">
            <div class="truncate text-xs text-neutral-700 font-semibold dark:text-neutral-200">
              {{ sticker.description }}
            </div>
            <div class="truncate text-[10px] text-neutral-400">
              {{ sticker.id }}
            </div>
          </div>
          <button
            class="mt-2 w-full flex items-center justify-center gap-1 rounded-lg bg-primary-500/10 py-1 text-[11px] text-primary-600 font-medium transition-colors hover:bg-primary-500 dark:text-primary-400 hover:text-white dark:hover:bg-primary-500 dark:hover:text-white"
            @click="testSlapSticker(sticker.id, sticker.description)"
          >
            <div class="i-solar:fire-bold text-xs" />
            <span>Test Slap</span>
          </button>
        </div>
      </div>
    </div>
  </div>
</template>
