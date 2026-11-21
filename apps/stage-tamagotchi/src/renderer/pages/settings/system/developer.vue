<script setup lang="ts">
import { useElectronEventaInvoke } from '@proj-anima/electron-vueuse'
import { SETTINGS_CATALOG_ITEMS } from '@proj-anima/stage-pages/composables/settings-topology'
import { isStageTamagotchi } from '@proj-anima/stage-shared'
import { CheckBar, IconItem, RippleGrid } from '@proj-anima/stage-ui/components'
import { useRippleGridState } from '@proj-anima/stage-ui/composables/use-ripple-grid-state'
import { useSettings } from '@proj-anima/stage-ui/stores/settings'
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

import { electronOpenMainDevtools } from '../../../../shared/eventa'

const { t } = useI18n()
const settings = useSettings()
const { lastClickedIndex, setLastClickedIndex } = useRippleGridState()

const openDevTools = useElectronEventaInvoke(electronOpenMainDevtools)

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
    <!-- Quick Actions -->
    <div
      v-if="isStageTamagotchi()"
      class="flex items-center justify-between border border-neutral-200/80 rounded-2xl bg-white/70 p-4 shadow-sm backdrop-blur-md dark:border-neutral-800/80 dark:bg-neutral-900/70"
    >
      <div class="flex items-center gap-3">
        <div class="size-10 flex shrink-0 items-center justify-center rounded-xl bg-primary-500/10 text-primary-600 dark:bg-primary-400/15 dark:text-primary-400">
          <div class="i-solar:bug-bold-duotone size-5" />
        </div>
        <div>
          <div class="text-sm text-neutral-800 font-bold dark:text-neutral-200">
            Chrome DevTools Console
          </div>
          <div class="text-xs text-neutral-500 dark:text-neutral-400">
            Open the Electron main inspector window
          </div>
        </div>
      </div>
      <button
        class="flex items-center gap-1.5 border border-primary-500/30 rounded-xl bg-primary-500/10 px-3.5 py-2 text-xs text-primary-700 font-semibold transition-all active:scale-95 dark:border-primary-400/30 dark:bg-primary-400/15 hover:bg-primary-500/20 dark:text-primary-300 dark:hover:bg-primary-400/25"
        @click="() => openDevTools()"
      >
        <div class="i-solar:tuning-2-bold-duotone size-4" />
        <span>Open Console</span>
      </button>
    </div>

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
