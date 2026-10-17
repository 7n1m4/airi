<script setup lang="ts">
defineProps<{
  show: boolean
}>()

const emit = defineEmits<{
  (e: 'close'): void
  (e: 'select', mode: 'open_ended' | 'goal_driven'): void
}>()

function selectMode(mode: 'open_ended' | 'goal_driven') {
  emit('select', mode)
}
</script>

<template>
  <Transition name="fade">
    <div v-if="show" class="pointer-events-auto fixed inset-0 z-[60] flex items-center justify-center bg-black/70 p-6 backdrop-blur-[6px]">
      <div class="relative max-w-xl w-full border border-white/10 rounded-3xl bg-neutral-900/80 p-8 text-white shadow-2xl backdrop-blur-xl">
        <!-- Close Button -->
        <button
          class="absolute right-6 top-6 size-10 flex items-center justify-center rounded-full bg-white/10 transition active:scale-95 hover:bg-white/20"
          @click="emit('close')"
        >
          <div class="i-solar:close-circle-bold text-xl text-neutral-300" />
        </button>

        <!-- Header -->
        <div class="mb-8 flex flex-col gap-1 text-center">
          <div class="flex items-center justify-center gap-2">
            <div class="i-solar:gamepad-bold text-2xl text-blue-400" />
            <h2 class="text-2xl font-bold tracking-tight">
              Select Encounter Mode
            </h2>
          </div>
          <p class="mt-1 text-sm text-neutral-400">
            Choose the style of interaction for this companion session.
          </p>
        </div>

        <!-- Mode Grid/Stack -->
        <div class="flex flex-col gap-4">
          <!-- Sandbox (Open-Ended) -->
          <button
            class="group relative flex items-start gap-5 border border-white/10 rounded-2xl bg-white/5 p-5 text-left transition-all duration-300 active:scale-[0.99] hover:scale-[1.02] hover:border-blue-400/50 hover:bg-white/10"
            @click="selectMode('open_ended')"
          >
            <div class="h-12 w-12 flex items-center justify-center rounded-xl bg-blue-500/20 text-blue-400 transition-transform group-hover:scale-110">
              <div class="i-solar:chat-round-dots-bold-duotone text-2xl" />
            </div>
            <div class="flex-1">
              <h3 class="text-lg text-white font-bold transition-colors group-hover:text-blue-300">
                Sandbox Mode (Open-Ended)
              </h3>
              <p class="mt-1 text-xs text-neutral-400 leading-relaxed">
                Chat freely without fixed turn limits or objectives. Track intimacy, spend Action Points to guide topics, and control the scene.
              </p>
            </div>
          </button>

          <!-- Date Session (Goal-Driven) -->
          <button
            class="group relative flex items-start gap-5 border border-white/10 rounded-2xl bg-white/5 p-5 text-left transition-all duration-300 active:scale-[0.99] hover:scale-[1.02] hover:border-rose-400/50 hover:bg-white/10"
            @click="selectMode('goal_driven')"
          >
            <div class="h-12 w-12 flex items-center justify-center rounded-xl bg-rose-500/20 text-rose-400 transition-transform group-hover:scale-110">
              <div class="i-solar:heart-bold animate-pulse text-2xl" />
            </div>
            <div class="flex-1">
              <h3 class="text-lg text-white font-bold transition-colors group-hover:text-rose-300">
                Date Session (Goal-Driven)
              </h3>
              <p class="mt-1 text-xs text-neutral-400 leading-relaxed">
                Play through a structured story campaign with setup premises, fixed turn limits, friction metrics, and a final scoring summary.
              </p>
            </div>
          </button>
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
