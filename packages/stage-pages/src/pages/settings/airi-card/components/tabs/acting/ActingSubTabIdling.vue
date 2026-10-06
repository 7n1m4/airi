<script setup lang="ts">
import { useRouter } from 'vue-router'

interface Props {
  actingIdleAnimationOptions: { label: string, value: string }[]
  selectedDisplayModelId?: string
}

const props = defineProps<Props>()

const selectedActingIdleAnimations = defineModel<string[]>('selectedActingIdleAnimations', { required: true })

const router = useRouter()

function toggleIdleAnimation(name: string) {
  if (selectedActingIdleAnimations.value.includes(name)) {
    selectedActingIdleAnimations.value = selectedActingIdleAnimations.value.filter(n => n !== name)
  }
  else {
    selectedActingIdleAnimations.value = [...selectedActingIdleAnimations.value, name]
  }
}

function navigateToModels() {
  const modelId = props.selectedDisplayModelId
  router.push({
    path: '/settings/models',
    query: modelId ? { model: modelId } : {},
  })
}
</script>

<template>
  <div class="flex flex-col gap-6">
    <!-- Header -->
    <div class="flex items-center justify-between border-b border-neutral-100 pb-4 dark:border-neutral-800">
      <div class="flex flex-col gap-0.5">
        <div class="flex items-center gap-2">
          <div class="i-solar:running-bold-duotone text-lg text-primary-500" />
          <h4 class="text-sm text-neutral-800 font-semibold dark:text-neutral-100">
            Idle & Cycle Animations
          </h4>
        </div>
        <p class="pl-6 text-xs text-neutral-500 dark:text-neutral-400">
          Configure continuous background avatar animations that play automatically when your companion is idle or speaking.
        </p>
      </div>
    </div>

    <!-- Companion Avatars Info & Navigation Card -->
    <div class="border border-primary-500/20 rounded-2xl bg-primary-500/5 p-4.5">
      <div class="flex items-start justify-between gap-4">
        <div class="flex items-start gap-3">
          <div class="shrink-0 rounded-xl bg-primary-500/10 p-2.5 text-xl text-primary-500">
            <div class="i-solar:infinity-bold-duotone" />
          </div>
          <div class="flex flex-col gap-1">
            <h5 class="text-xs text-neutral-800 font-semibold dark:text-neutral-100">
              Preview & Assign Motions in Model Customizer
            </h5>
            <p class="text-xs text-neutral-600 leading-relaxed dark:text-neutral-300">
              Want to see what each motion looks like or assign new idle animations? Visit the
              <button
                type="button"
                class="text-primary-600 font-semibold underline underline-offset-2 transition dark:text-primary-400 hover:text-primary-700 dark:hover:text-primary-300"
                @click="navigateToModels"
              >
                Companion Avatars
              </button>
              settings page where you can preview 3D and 2D animations live. Click the infinity (<span class="i-solar:infinity-bold-duotone inline-block translate-y-0.5 text-xs text-primary-500" />) icon on any motion track in the Model Customizer to designate it as an idle loop.
            </p>
          </div>
        </div>

        <button
          type="button"
          class="shadow-xs flex shrink-0 items-center gap-1.5 border border-primary-500/30 rounded-xl bg-white px-3 py-1.5 text-xs text-primary-600 font-medium transition dark:border-primary-500/30 dark:bg-neutral-800 hover:bg-primary-50/50 dark:text-primary-300 dark:hover:bg-neutral-700"
          @click="navigateToModels"
        >
          <span>Open Avatars</span>
          <div class="i-solar:arrow-right-up-bold text-xs" />
        </button>
      </div>
    </div>

    <!-- Animation Picker Grid -->
    <div class="border border-neutral-200 rounded-xl bg-neutral-50/50 p-4 dark:border-neutral-700/70 dark:bg-neutral-950/30">
      <div class="mb-1 flex items-center justify-between">
        <div class="text-sm text-neutral-800 font-medium dark:text-neutral-200">
          Selected Idle Cycle
        </div>
        <span class="text-xs text-neutral-400">
          {{ selectedActingIdleAnimations.length }} selected
        </span>
      </div>
      <div class="mb-3 text-xs text-neutral-500">
        Choose which animations your character will cycle through at rest. If none are selected, the model's default idle pose is used.
      </div>

      <div v-if="actingIdleAnimationOptions.length > 0" class="flex flex-wrap gap-2">
        <button
          v-for="opt in actingIdleAnimationOptions"
          :key="opt.value"
          type="button"
          class="flex items-center gap-1.5 border rounded-full px-3 py-1 text-xs outline-none transition-all duration-150"
          :class="[
            selectedActingIdleAnimations.includes(opt.value)
              ? 'bg-primary-50 text-primary-700 dark:bg-primary-900/30 dark:text-primary-300 border-primary-300 dark:border-primary-700 font-medium shadow-xs'
              : 'border-neutral-200 dark:border-neutral-700 text-neutral-600 dark:text-neutral-300 hover:border-primary-300 hover:text-primary-600 dark:hover:border-primary-600 dark:hover:text-primary-300',
          ]"
          @click="toggleIdleAnimation(opt.value)"
        >
          <div
            :class="[
              selectedActingIdleAnimations.includes(opt.value)
                ? 'i-solar:check-circle-bold text-primary-500'
                : 'i-solar:running-bold-duotone text-neutral-400',
              'text-[12px]',
            ]"
          />
          {{ opt.label }}
        </button>
      </div>

      <div v-else class="border border-neutral-200 rounded-lg border-dashed py-6 text-center text-xs text-neutral-400 italic dark:border-neutral-800">
        No idle animations surfaced for the current avatar model. You can import animations or assign custom VRMA motions in Companion Avatars.
      </div>
    </div>
  </div>
</template>
