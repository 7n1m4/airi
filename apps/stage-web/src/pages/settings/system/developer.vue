<script setup lang="ts">
import { SETTINGS_CATALOG_ITEMS } from '@proj-anima/stage-pages/composables/settings-topology'
import { isStageTamagotchi } from '@proj-anima/stage-shared'
import { CheckBar, IconItem, RippleGrid } from '@proj-anima/stage-ui/components'
import { useRippleGridState } from '@proj-anima/stage-ui/composables/use-ripple-grid-state'
import { useSettings } from '@proj-anima/stage-ui/stores/settings'
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

const { t } = useI18n()
const settings = useSettings()
const { lastClickedIndex, setLastClickedIndex } = useRippleGridState()

interface ToolItem {
  id: string
  title: string
  description: string
  icon: string
  to: string
}

interface ToolGroup {
  id: string
  title: string
  items: ToolItem[]
}

const toolGroups = computed<ToolGroup[]>(() => {
  const items = SETTINGS_CATALOG_ITEMS
    .filter(item => item.parentId === 'sys-developer')
    .filter(item => isStageTamagotchi() || !item.desktopOnly)
    .sort((a, b) => a.order - b.order)

  const groupsMap = new Map<string, ToolGroup>()

  for (const item of items) {
    const rawCluster = item.clusterGroup || 'RUNTIME & NEURAL LABS'
    const cleanTitle = rawCluster.replace(/[\u4E00-\u9FFF\u3040-\u309F\u30A0-\u30FF]/g, '').trim() || 'DIAGNOSTICS'
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
      icon: item.icon || 'i-solar:code-bold-duotone',
      to: item.route || '/settings/system/developer',
    })
  }

  return Array.from(groupsMap.values())
})
</script>

<template>
  <div flex="~ col gap-8" pb-12 font-normal>
    <!-- Clustered Developer Instruments -->
    <div v-for="group in toolGroups" :key="group.id" flex="~ col gap-4">
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

    <!-- Developer Flags (Bottom Section) -->
    <div flex="~ col gap-3">
      <div px-4 text="xs neutral-400 dark:neutral-500" font-bold tracking-wider uppercase>
        Runtime Animation Flags
      </div>
      <div class="flex flex-col gap-2">
        <CheckBar
          v-model="settings.disableTransitions"
          icon-on="i-solar:people-nearby-bold-duotone"
          icon-off="i-solar:running-2-line-duotone"
          text="settings.animations.stage-transitions.title"
        />
        <CheckBar
          v-model="settings.usePageSpecificTransitions"
          :disabled="settings.disableTransitions"
          icon-on="i-solar:running-2-line-duotone"
          icon-off="i-solar:people-nearby-bold-duotone"
          text="settings.animations.use-page-specific-transitions.title"
          description="settings.animations.use-page-specific-transitions.description"
        />
      </div>
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
      <div text="60" i-solar:code-bold-duotone />
    </div>
  </div>
</template>

<route lang="yaml">
meta:
  layout: settings
  titleKey: settings.pages.system.developer.title
  subtitleKey: settings.title
  stageTransition:
    name: slide
</route>
