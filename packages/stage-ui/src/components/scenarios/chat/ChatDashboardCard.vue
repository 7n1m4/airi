<script setup lang="ts">
defineProps<{
  title: string
  icon?: string
  image?: string
  iconColorClass?: string
  badge?: string | number
  collapsed?: boolean
  bodyClass?: string
}>()

const emit = defineEmits<{
  (e: 'toggle'): void
}>()
</script>

<template>
  <div
    :class="[
      'flex flex-col border border-neutral-200/60 dark:border-neutral-800/60 rounded-2xl',
      'bg-white/70 dark:bg-neutral-900/60 shadow-xs backdrop-blur-sm transition-all duration-200',
    ]"
  >
    <!-- Card Header Row -->
    <div
      class="flex cursor-pointer select-none items-center justify-between py-1.5 pl-3 pr-2"
      @click="emit('toggle')"
    >
      <!-- Title & Icon -->
      <div class="flex items-center gap-2">
        <img
          v-if="image"
          :src="image"
          class="size-4 shrink-0 rounded object-contain"
        >
        <div
          v-else-if="icon"
          :class="[icon, iconColorClass || 'text-primary-500 dark:text-primary-400', 'text-base shrink-0']"
        />
        <span class="text-xs text-neutral-800 font-bold dark:text-neutral-100">
          {{ title }}
        </span>
        <span
          v-if="badge !== undefined && badge !== ''"
          class="rounded-full bg-primary-500/15 px-2 py-0.2 text-[10px] text-primary-600 font-bold font-mono dark:text-primary-400"
        >
          {{ badge }}
        </span>
        <slot name="title-extra" />
      </div>

      <!-- Actions & Chevron -->
      <div class="flex items-center gap-1.5" @click.stop>
        <slot name="actions" />

        <button
          type="button"
          :class="[
            'size-6 flex cursor-pointer items-center justify-center rounded-lg',
            'text-neutral-400 hover:text-neutral-700 dark:hover:text-neutral-200',
            'hover:bg-neutral-100 dark:hover:bg-neutral-800/50 transition-colors',
          ]"
          :title="collapsed ? 'Expand module' : 'Collapse module'"
          @click.stop="emit('toggle')"
        >
          <div
            :class="collapsed ? 'i-solar:alt-arrow-down-linear' : 'i-solar:alt-arrow-up-linear'"
            class="text-xs"
          />
        </button>
      </div>
    </div>

    <!-- Collapsible Body (v-show preserves iframe & terminal lifecycles) -->
    <div v-show="!collapsed" :class="bodyClass || 'mt-1.5 flex flex-col p-1'">
      <slot />
    </div>
  </div>
</template>
