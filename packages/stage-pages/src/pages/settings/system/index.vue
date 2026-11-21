<script setup lang="ts">
import { isStageTamagotchi } from '@proj-anima/stage-shared'
import { IconItem, RippleGrid } from '@proj-anima/stage-ui/components'
import { useRippleGridState } from '@proj-anima/stage-ui/composables/use-ripple-grid-state'
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRoute } from 'vue-router'

import { SETTINGS_CATALOG_ITEMS } from '../../../composables/settings-topology/settings-catalog'

const { t } = useI18n()
const route = useRoute()
const { lastClickedIndex, setLastClickedIndex } = useRippleGridState()

const systemItems = computed(() => {
  const items = SETTINGS_CATALOG_ITEMS
    .filter(item => item.parentId === 'area-system')
    .filter(item => isStageTamagotchi() || !item.desktopOnly)
    .sort((a, b) => a.order - b.order)

  return items.map(item => ({
    id: item.id,
    title: item.titleKey ? t(item.titleKey, item.label) : item.label,
    description: item.descriptionKey ? t(item.descriptionKey, item.description || '') : (item.description || ''),
    icon: item.icon || 'i-solar:settings-bold-duotone',
    to: item.route || '/settings/system',
  }))
})

function isActive(to: string) {
  const currentPath = route.path.replace(/\/$/, '')
  const targetPath = to.replace(/\/$/, '')
  return currentPath === targetPath || currentPath.startsWith(`${targetPath}/`)
}
</script>

<template>
  <div :class="['w-full max-w-5xl mx-auto flex flex-col gap-6 p-4 sm:p-6 lg:p-8 pb-28']">
    <!-- Hero / Title Card -->
    <div
      :class="[
        'relative overflow-hidden rounded-3xl border border-neutral-200/80 dark:border-neutral-800',
        'bg-white/70 dark:bg-neutral-900/60 p-5 sm:p-6 backdrop-blur-xl shadow-sm',
        'flex items-center gap-4',
      ]"
    >
      <div :class="['size-12 rounded-2xl bg-primary-500/10 text-primary-500 dark:bg-primary-500/20 dark:text-primary-400 flex items-center justify-center text-2xl shrink-0']">
        <div :class="['i-solar:filters-bold-duotone']" />
      </div>
      <div>
        <h1 :class="['text-lg sm:text-xl font-bold text-neutral-900 dark:text-neutral-100']">
          {{ t('settings.pages.system.title', 'System Preferences') }}
        </h1>
        <p :class="['text-xs sm:text-sm text-neutral-500 dark:text-neutral-400']">
          {{ t('settings.pages.system.description', 'Customize app language, 24-color theme palette, vibrancy, identity, and dating sim rules.') }}
        </p>
      </div>
    </div>

    <!-- Subpage Cards Grid -->
    <div :class="['flex flex-col gap-3']">
      <RippleGrid
        :items="systemItems"
        :get-key="item => item.to"
        :columns="1"
        :origin-index="lastClickedIndex"
        @item-click="({ globalIndex }) => setLastClickedIndex(globalIndex)"
      >
        <template #item="{ item }">
          <IconItem
            :title="item.title"
            :description="item.description"
            :icon="item.icon"
            :to="item.to"
            :active="isActive(item.to)"
          />
        </template>
      </RippleGrid>
    </div>
  </div>
</template>

<route lang="yaml">
meta:
  layout: settings
  titleKey: settings.pages.system.title
  subtitleKey: settings.title
  descriptionKey: settings.pages.system.description
  icon: i-solar:filters-bold-duotone
  settingsEntry: true
  order: 8
  stageTransition:
    name: slide
    pageSpecificAvailable: true
</route>
