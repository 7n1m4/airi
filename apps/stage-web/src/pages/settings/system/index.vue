<script setup lang="ts">
import { SETTINGS_CATALOG_ITEMS } from '@proj-anima/stage-pages/composables/settings-topology'
import { isStageTamagotchi } from '@proj-anima/stage-shared'
import { IconItem, RippleGrid } from '@proj-anima/stage-ui/components'
import { useRippleGridState } from '@proj-anima/stage-ui/composables/use-ripple-grid-state'
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

const { t } = useI18n()
const { lastClickedIndex, setLastClickedIndex } = useRippleGridState()

const settings = computed(() => {
  return SETTINGS_CATALOG_ITEMS
    .filter(item => item.parentId === 'area-system')
    .filter(item => isStageTamagotchi() || !item.desktopOnly)
    .sort((a, b) => a.order - b.order)
    .map(item => ({
      title: item.titleKey ? t(item.titleKey, item.label) : item.label,
      description: item.descriptionKey ? t(item.descriptionKey, item.description || '') : (item.description || ''),
      icon: item.icon || 'i-solar:settings-bold-duotone',
      to: item.route || '/settings/system',
    }))
})
</script>

<template>
  <div flex="~ col gap-4" font-normal>
    <div />
    <div flex="~ col gap-4">
      <RippleGrid
        :items="settings"
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
          />
        </template>
      </RippleGrid>
    </div>
    <div
      v-motion
      text="neutral-200/50 dark:neutral-600/20" pointer-events-none
      fixed top="[calc(100dvh-12rem)]" bottom-0 right--10 z--1
      :initial="{ scale: 0.9, opacity: 0, rotate: 180 }"
      :enter="{ scale: 1, opacity: 1, rotate: 0 }"
      :duration="500"
      size-60
      flex items-center justify-center
    >
      <div v-motion text="60" i-solar:settings-bold-duotone />
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
  order: 10
  stageTransition:
    name: slide
    pageSpecificAvailable: true
</route>
