<script setup lang="ts">
import { isStageTamagotchi } from '@proj-anima/stage-shared'
import { IconItem, RippleGrid } from '@proj-anima/stage-ui/components'
import { useRippleGridState } from '@proj-anima/stage-ui/composables/use-ripple-grid-state'
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

import GlobalFacultiesMatrix from './components/GlobalFacultiesMatrix.vue'

import { SETTINGS_CATALOG_ITEMS } from '../../../composables/settings-topology/settings-catalog'

const { t } = useI18n()
const { lastClickedIndex, setLastClickedIndex } = useRippleGridState()

interface ModuleItem {
  id: string
  title: string
  description: string
  icon: string
  to: string
}

interface ModuleGroup {
  id: string
  title: string
  items: ModuleItem[]
}

const moduleGroups = computed<ModuleGroup[]>(() => {
  const items = SETTINGS_CATALOG_ITEMS
    .filter(item => item.parentId === 'area-modules')
    .filter(item => isStageTamagotchi() || !item.desktopOnly)
    .sort((a, b) => a.order - b.order)

  const groupsMap = new Map<string, ModuleGroup>()

  for (const item of items) {
    const rawCluster = item.clusterGroup || 'PERCEPTION & FACULTIES'
    const cleanTitle = rawCluster.replace(/[\u4E00-\u9FFF\u3040-\u309F\u30A0-\u30FF]/g, '').trim() || 'FACULTIES'
    const groupId = cleanTitle.toLowerCase().replace(/[^a-z0-9]+/g, '-')

    if (!groupsMap.has(groupId)) {
      groupsMap.set(groupId, {
        id: groupId,
        title: cleanTitle,
        items: [],
      })
    }

    groupsMap.get(groupId)!.items.push({
      id: item.id,
      title: item.titleKey ? t(item.titleKey, item.label) : item.label,
      description: item.descriptionKey ? t(item.descriptionKey, item.description || '') : (item.description || ''),
      icon: item.icon || 'i-solar:layers-bold-duotone',
      to: item.route || '/settings/modules',
    })
  }

  return Array.from(groupsMap.values())
})
</script>

<template>
  <div flex="~ col gap-8" pb-12 font-normal>
    <!-- Global Faculties & Resilient Fallbacks Matrix -->
    <GlobalFacultiesMatrix />

    <div v-for="group in moduleGroups" :key="group.id" flex="~ col gap-4">
      <div px-4 text="xs neutral-400 dark:neutral-500" font-bold tracking-wider uppercase>
        {{ group.title }}
      </div>
      <RippleGrid
        :items="group.items"
        :get-key="item => item.to"
        :columns="{ default: 1, sm: 2 }"
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
      fixed top="[calc(100dvh-15rem)]" bottom-0 right--5 z--1
      :initial="{ scale: 0.9, opacity: 0, y: 20 }"
      :enter="{ scale: 1, opacity: 1, y: 0 }"
      :duration="500"
      size-60
      flex items-center justify-center
    >
      <div text="60" i-solar:layers-bold-duotone />
    </div>
  </div>
</template>

<route lang="yaml">
meta:
  layout: settings
  titleKey: settings.pages.modules.title
  subtitleKey: settings.title
  descriptionKey: settings.pages.modules.description
  icon: i-solar:layers-bold-duotone
  settingsEntry: true
  order: 2
  stageTransition:
    name: slide
    pageSpecificAvailable: true
</route>
