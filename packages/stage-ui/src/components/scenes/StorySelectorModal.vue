<script setup lang="ts">
import type { StorylinePreset } from '../../constants/dating-sim/storylines'

import { ref } from 'vue'

import { STORYLINE_PRESETS } from '../../constants/dating-sim/storylines'

defineProps<{
  show: boolean
}>()

const emit = defineEmits<{
  (e: 'close'): void
  (e: 'select', storyline: StorylinePreset, customPrompt: string): void
}>()

const selectedStory = ref<StorylinePreset | null>(null)
const customScenarioPrompt = ref('')

function handleSelectCard(story: StorylinePreset) {
  selectedStory.value = story
  customScenarioPrompt.value = story.premise
}

function handleStartSession() {
  if (!selectedStory.value)
    return
  emit('select', selectedStory.value, customScenarioPrompt.value)
}
</script>

<template>
  <Transition name="fade">
    <div v-if="show" class="pointer-events-auto fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-6 backdrop-blur-[6px]">
      <div class="relative h-[85vh] max-w-5xl w-full flex flex-col border border-white/10 rounded-3xl bg-neutral-900/80 p-8 text-white shadow-2xl backdrop-blur-xl">
        <!-- Close Button -->
        <button
          class="absolute right-6 top-6 size-10 flex items-center justify-center rounded-full bg-white/10 transition active:scale-95 hover:bg-white/20"
          @click="emit('close')"
        >
          <div class="i-solar:close-circle-bold text-xl text-neutral-300" />
        </button>

        <!-- Header -->
        <div class="mb-6 flex flex-col gap-1">
          <div class="flex items-center gap-2">
            <div class="i-solar:heart-bold animate-pulse text-2xl text-rose-400" />
            <h2 class="text-2xl font-bold tracking-tight">
              Select Your Storyboard Campaign
            </h2>
          </div>
          <p class="text-sm text-neutral-400">
            Choose a curated storyline preset to seed your dating sim adventure, or write a custom scenario.
          </p>
        </div>

        <div class="min-h-0 flex flex-1 gap-6">
          <!-- Left side: Stories Grid -->
          <div class="scrollbar-thumb-white/15 min-h-0 flex-1 overflow-y-auto pr-2 scrollbar-thin">
            <div class="grid grid-cols-2 gap-4 pb-4">
              <div
                v-for="story in STORYLINE_PRESETS"
                :key="story.id"
                :class="[
                  'relative overflow-hidden aspect-video border rounded-2xl cursor-pointer transition-all duration-300 group',
                  selectedStory?.id === story.id
                    ? 'border-rose-400 ring-2 ring-rose-400/50 scale-[0.98]'
                    : 'border-white/10 hover:border-white/30 hover:scale-[1.01]',
                ]"
                @click="handleSelectCard(story)"
              >
                <!-- Cover Image -->
                <img
                  :src="story.coverImage"
                  class="absolute inset-0 h-full w-full object-cover transition-transform duration-500 group-hover:scale-105"
                  alt="Story Cover"
                >
                <div class="absolute inset-0 from-black/90 via-black/40 to-transparent bg-gradient-to-t" />

                <!-- Text Overlay -->
                <div class="absolute bottom-0 left-0 right-0 flex flex-col gap-1 p-4">
                  <h3 class="text-md text-white font-bold tracking-wide transition-colors group-hover:text-rose-300">
                    {{ story.title }}
                  </h3>
                  <p class="line-clamp-2 text-xs text-neutral-300">
                    {{ story.premise }}
                  </p>
                </div>
              </div>
            </div>
          </div>

          <!-- Right side: Detail Panel & Launcher Config -->
          <div class="w-[340px] flex flex-col border border-white/10 rounded-2xl bg-black/40 p-5">
            <div v-if="selectedStory" class="min-h-0 flex flex-1 flex-col gap-4">
              <!-- Selected Story Info -->
              <div class="flex flex-col gap-1">
                <span class="text-xs text-rose-400 font-semibold tracking-wider uppercase">Selected Scenario</span>
                <h4 class="text-lg font-bold">
                  {{ selectedStory.title }}
                </h4>
              </div>

              <!-- Scene Context Detail (Scrollable) -->
              <div class="min-h-0 flex-1 overflow-y-auto pr-1 text-sm text-neutral-300 leading-relaxed scrollbar-thin">
                <div class="flex flex-col gap-3">
                  <div>
                    <span class="text-xs text-white/50 font-medium">Setting / Location:</span>
                    <p class="mt-0.5 text-xs">
                      {{ selectedStory.scene }}
                    </p>
                  </div>
                  <div>
                    <span class="text-xs text-white/50 font-medium">Terms of Encounter:</span>
                    <p class="mt-0.5 text-xs">
                      {{ selectedStory.termsOfEncounter }}
                    </p>
                  </div>
                  <div>
                    <span class="text-xs text-white/50 font-medium">Target Appearances:</span>
                    <p class="mt-0.5 text-xs italic">
                      {{ selectedStory.appearances }}
                    </p>
                  </div>
                </div>
              </div>

              <!-- Textarea for Custom Tweaks -->
              <div class="flex flex-col gap-2">
                <label class="text-xs text-white/70 font-semibold">Customize Premise / Theme (Optional)</label>
                <textarea
                  v-model="customScenarioPrompt"
                  rows="3"
                  class="w-full border border-white/10 rounded-xl bg-neutral-800/80 p-2.5 text-xs text-white outline-none transition focus:border-rose-400"
                  placeholder="Alter the premise or context of the date..."
                />
              </div>

              <!-- Start Button -->
              <button
                class="w-full flex items-center justify-center gap-2 rounded-xl bg-rose-500 py-3 text-sm text-white font-bold transition active:scale-[0.98] hover:bg-rose-600"
                @click="handleStartSession"
              >
                <span>Launch Story Campaign</span>
                <div class="i-solar:play-bold text-xs" />
              </button>
            </div>

            <!-- Empty State -->
            <div v-else class="flex flex-1 flex-col items-center justify-center text-center">
              <div class="i-solar:heart-broken-bold mb-3 text-4xl text-neutral-600" />
              <p class="text-sm text-neutral-500">
                Select a storyboard card from the list to preview details and configure the session.
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  </Transition>
</template>

<style scoped>
.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.25s ease;
}

.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}
</style>
