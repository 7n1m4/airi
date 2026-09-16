<script setup lang="ts">
import { SETTINGS_CATALOG_ITEMS } from '@proj-airi/stage-ui/constants'
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRoute, useRouter } from 'vue-router'

const route = useRoute()
const router = useRouter()
const { t } = useI18n()

interface NavItem {
  id: string
  title: string
  glyph?: string
  icon: string
  to: string
  order: number
}

interface NavGroup {
  id: string
  title: string
  glyph?: string
  items: NavItem[]
}

const navGroups = computed<NavGroup[]>(() => {
  const hubItems = SETTINGS_CATALOG_ITEMS.filter(item => item.parentId === 'hub')
  const groupsMap = new Map<string, NavGroup>()

  for (const item of hubItems) {
    const rawCluster = item.clusterGroup || 'SYSTEM 系'
    const glyphMatch = rawCluster.match(/[\u4E00-\u9FFF\u3040-\u309F\u30A0-\u30FF]/)
    const glyph = glyphMatch ? glyphMatch[0] : undefined
    const cleanTitle = rawCluster.replace(/[\u4E00-\u9FFF\u3040-\u309F\u30A0-\u30FF]/g, '').trim() || 'SYSTEM'
    const groupId = cleanTitle.toLowerCase().replace(/[^a-z0-9]+/g, '-')

    if (!groupsMap.has(groupId)) {
      groupsMap.set(groupId, {
        id: groupId,
        title: cleanTitle,
        glyph,
        items: [],
      })
    }

    groupsMap.get(groupId)!.items.push({
      id: item.id,
      title: item.titleKey ? t(item.titleKey, item.label) : item.label,
      glyph: item.glyph,
      icon: item.icon || 'i-solar:settings-bold-duotone',
      to: item.route || '/settings',
      order: item.order,
    })
  }

  return Array.from(groupsMap.values())
})

function isItemActive(to: string): boolean {
  const currentPath = route.path.replace(/\/$/, '') || '/'
  const targetPath = to.replace(/\/$/, '') || '/'

  if (targetPath === '/settings') {
    return currentPath === '/settings'
  }

  return currentPath === targetPath || currentPath.startsWith(`${targetPath}/`)
}

function navigateTo(to: string) {
  router.push(to)
}
</script>

<template>
  <nav class="h-full flex flex-col select-none justify-between overflow-hidden border-r border-neutral-200/70 bg-neutral-50/50 py-4 dark:border-neutral-800/70 dark:bg-neutral-950/40">
    <!-- Top Hub Header -->
    <div class="px-4 pb-3">
      <div
        class="group flex cursor-pointer items-center justify-between rounded-xl px-2.5 py-2 transition-all hover:bg-neutral-200/50 dark:hover:bg-neutral-800/50"
        @click="navigateTo('/settings')"
      >
        <div class="flex items-center gap-2.5">
          <div class="shadow-xs size-8 flex items-center justify-center rounded-lg bg-primary-500 text-white">
            <div class="i-solar:settings-bold-duotone size-4.5" />
          </div>
          <div class="flex flex-col">
            <span class="text-sm text-neutral-900 font-bold tracking-wider uppercase dark:text-neutral-100">
              Settings
            </span>
            <span class="text-xs text-neutral-400 font-mono dark:text-neutral-500">
              設定 · Hub
            </span>
          </div>
        </div>
        <div class="text-xs text-neutral-400 transition-transform group-hover:translate-x-0.5 dark:text-neutral-600">
          ◇
        </div>
      </div>
    </div>

    <!-- Scrollable Groups Area -->
    <div class="flex-1 overflow-y-auto px-3 scrollbar-none space-y-5">
      <div v-for="group in navGroups" :key="group.id" class="space-y-1.5">
        <!-- Section Header -->
        <div class="flex items-center justify-between px-3 text-xs text-neutral-400 font-bold tracking-wider uppercase dark:text-neutral-500">
          <span>{{ group.title }}</span>
          <span v-if="group.glyph" class="text-xs text-neutral-400 font-mono dark:text-neutral-500">{{ group.glyph }}</span>
        </div>

        <!-- Section Items -->
        <div class="space-y-0.5">
          <button
            v-for="item in group.items"
            :key="item.id"
            type="button"
            :class="[
              'group relative w-full flex items-center justify-between rounded-xl px-3 py-2 text-left text-sm font-medium transition-all duration-150 active:scale-[0.98]',
              isItemActive(item.to)
                ? 'bg-primary-500 text-white shadow-sm font-semibold'
                : 'text-neutral-600 dark:text-neutral-400 hover:bg-neutral-200/60 dark:hover:bg-neutral-800/60 hover:text-neutral-900 dark:hover:text-neutral-200',
            ]"
            @click="navigateTo(item.to)"
          >
            <div class="min-w-0 flex items-center gap-2.5">
              <div
                :class="[
                  item.icon,
                  'size-5 shrink-0 transition-transform group-hover:scale-110',
                  isItemActive(item.to)
                    ? 'text-white'
                    : 'text-neutral-500 dark:text-neutral-400 group-hover:text-neutral-900 dark:group-hover:text-neutral-100',
                ]"
              />
              <span class="truncate">{{ item.title }}</span>
            </div>

            <span
              v-if="item.glyph"
              :class="[
                'ml-1 text-xs font-mono shrink-0 transition-colors',
                isItemActive(item.to)
                  ? 'text-white/90 font-bold'
                  : 'text-neutral-400 dark:text-neutral-500 group-hover:text-primary-500 dark:group-hover:text-primary-400',
              ]"
            >
              {{ item.glyph }}
            </span>
          </button>
        </div>
      </div>
    </div>

    <!-- Bottom Footer -->
    <div class="border-t border-neutral-200/60 px-4 pt-3 dark:border-neutral-800/60">
      <button
        type="button"
        class="shadow-2xs w-full flex items-center justify-center gap-2 border border-neutral-200/60 rounded-xl bg-white/60 px-3 py-1.5 text-sm text-neutral-600 font-medium backdrop-blur-md transition-all active:scale-95 dark:border-neutral-800/60 dark:bg-neutral-900/60 hover:bg-neutral-100 dark:text-neutral-400 dark:hover:bg-neutral-800"
        @click="navigateTo('/')"
      >
        <div class="i-solar:arrow-left-line-duotone size-4" />
        <span>Return to Stage</span>
      </button>
    </div>
  </nav>
</template>
