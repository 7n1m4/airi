<script setup lang="ts">
import { isStageTamagotchi } from '@proj-airi/stage-shared'
import { useMotion } from '@vueuse/motion'
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import { useRoute } from 'vue-router'

import SettingsSearchBar from '../widgets/SettingsSearchBar.vue'
import SettingsThemeHeaderWidget from '../widgets/SettingsThemeHeaderWidget.vue'

const props = withDefaults(defineProps<{
  title: string
  subtitle?: string
  showBackButton?: boolean
  disableBackButton?: boolean
  showSearch?: boolean
  showThemeControls?: boolean
}>(), {
  showBackButton: true,
  disableBackButton: false,
  showSearch: true,
  showThemeControls: true,
})

const emit = defineEmits<{
  (e: 'back'): void
}>()
const route = useRoute()

const finalizedDisableBackButton = ref(props.disableBackButton)

const isRootOfSettings = computed(() => {
  return route.path === '/settings' || route.path === '/settings/' || Boolean(route.meta?.rootOfSettings)
})

// In Electron desktop settings window, hide the back button at root since settings is a standalone window
// In Web stage, preserve back button so users can return to the desktop stage canvas (/)
const shouldShowBackButton = computed(() => {
  if (isStageTamagotchi() && isRootOfSettings.value)
    return false
  if (props.disableBackButton || finalizedDisableBackButton.value)
    return false
  return props.showBackButton
})

function handleBack() {
  if (!shouldShowBackButton.value)
    return

  emit('back')
}

const pageHeaderRef = ref<HTMLElement>()
const title = ref(props.title)
const subtitle = ref(props.subtitle)

const { apply } = useMotion(pageHeaderRef, {
  initial: { opacity: 0, x: 10, transition: { duration: 50 } },
  enter: { opacity: 1, x: 0, transition: { duration: 250 } },
  leave: { opacity: 0, x: -5, transition: { duration: 25 } },
})

onMounted(async () => {
  await apply('initial')
  await apply('enter')
})

onUnmounted(async () => {
  await apply('leave')
  finalizedDisableBackButton.value = true
})

watch([() => props.title, () => props.subtitle, () => props.disableBackButton, route], async () => {
  await apply('leave')
  await nextTick()

  finalizedDisableBackButton.value = props.disableBackButton
  title.value = props.title
  subtitle.value = props.subtitle

  await nextTick()
  await apply('initial')
  await apply('enter')
})
</script>

<template>
  <div
    ref="pageHeaderRef"
    :style="{
      top: 'env(safe-area-inset-top, 0px)',
      right: 'env(safe-area-inset-right, 0px)',
      left: 'env(safe-area-inset-left, 0px)',
    }"
    sticky inset-x-0 top-0 z-99 w-full pb-6 pt-10
    flex="~ row items-center justify-between gap-2"
    bg="$bg-color"
  >
    <div flex="~ row items-center gap-2" min-w-0 shrink-0>
      <button
        v-if="shouldShowBackButton"
        type="button"
        class="flex items-center justify-center transition-transform active:scale-90"
        @click="handleBack()"
      >
        <div
          i-solar:alt-arrow-left-line-duotone text-2xl
        />
      </button>
      <h1 relative min-w-0>
        <div v-if="subtitle" absolute left-0 top-0 translate-y="[-80%]">
          <span text="neutral-300 dark:neutral-500" text-nowrap>{{ subtitle }}</span>
        </div>
        <div text-nowrap text-3xl font-normal>
          {{ title }}
        </div>
      </h1>
    </div>

    <!-- Actions / Search & Theme Controls -->
    <div flex="~ row items-center gap-2.5 sm:gap-3" min-w-0 flex-1 justify-end>
      <slot name="actions">
        <SettingsSearchBar v-if="showSearch" />
        <SettingsThemeHeaderWidget v-if="showThemeControls" shrink-0 />
      </slot>
    </div>
  </div>
</template>
