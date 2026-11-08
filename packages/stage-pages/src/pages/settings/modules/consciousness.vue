<script setup lang="ts">
import { ConsciousnessWorkspace } from '@proj-airi/stage-ui/components'
import { useI18n } from 'vue-i18n'

const { t } = useI18n()
</script>

<template>
  <div :class="['w-full flex flex-col gap-6 p-4 sm:p-6 lg:p-8 max-w-[1400px] mx-auto animate-fadeIn select-none']">
    <!-- Header -->
    <div :class="['flex flex-col gap-1']">
      <h1 :class="['text-xl sm:text-2xl font-bold tracking-tight text-neutral-900 dark:text-white flex items-center gap-2.5']">
        <div :class="['i-solar:brain-bold-duotone text-primary-500 h-6 w-6 flex-shrink-0']" />
        <span>{{ t('settings.pages.consciousness.title', 'Consciousness (LLM)') }}</span>
      </h1>
      <p :class="['text-xs sm:text-sm text-neutral-500 dark:text-neutral-400']">
        {{ t('settings.pages.consciousness.description', 'Configure the language model brain driving your companion’s persona, reasoning, and dialogues.') }}
      </p>
    </div>

    <!-- Decomposed Canonical Consciousness Workspace in Settings Mode -->
    <ConsciousnessWorkspace mode="settings" />
  </div>
</template>

<style scoped>
@keyframes fadeIn {
  from {
    opacity: 0;
    transform: translateY(4px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

.animate-fadeIn {
  animation: fadeIn 0.2s cubic-bezier(0.16, 1, 0.3, 1) forwards;
}
</style>

<route lang="yaml">
meta:
  layout: settings
  titleKey: settings.pages.modules.consciousness.title
  subtitleKey: settings.title
  settingsEntry: true
  order: 7
  stageTransition:
    name: slide
</route>
