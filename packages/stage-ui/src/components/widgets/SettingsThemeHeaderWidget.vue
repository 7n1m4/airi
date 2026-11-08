<script setup lang="ts">
import { useSettingsTheme } from '@proj-airi/stage-ui/stores/settings'
import { useTheme } from '@proj-airi/ui'
import { PopoverContent, PopoverPortal, PopoverRoot, PopoverTrigger } from 'reka-ui'

withDefaults(defineProps<{
  align?: 'start' | 'center' | 'end'
  side?: 'top' | 'right' | 'bottom' | 'left'
  sideOffset?: number
  collisionPadding?: number
}>(), {
  align: 'end',
  side: 'bottom',
  sideOffset: 8,
  collisionPadding: 12,
})

const { isDark, toggleDark } = useTheme()
const settingsTheme = useSettingsTheme()

// 24-color spectrum presets (grouped in 4 rows of 6)
const colorSpectrumRows = [
  // Warm & Fire
  [
    { name: 'Crimson', color: '#E11D48' },
    { name: 'Coral', color: '#F43F5E' },
    { name: 'Tangerine', color: '#EA580C' },
    { name: 'Marigold', color: '#F59E0B' },
    { name: 'Amber', color: '#EAB308' },
    { name: 'Lemon', color: '#84CC16' },
  ],
  // Earth & Flora
  [
    { name: 'Lime', color: '#65A30D' },
    { name: 'Emerald', color: '#16A34A' },
    { name: 'Mint', color: '#10B981' },
    { name: 'Jade', color: '#059669' },
    { name: 'Viridian', color: '#0D9488' },
    { name: 'Teal', color: '#0891B2' },
  ],
  // Ocean & Sky
  [
    { name: 'Turquoise', color: '#06B6D4' },
    { name: 'Cyan', color: undefined }, // AIRI Signature Cyan
    { name: 'Cerulean', color: '#2563EB' },
    { name: 'Cobalt', color: '#3B82F6' },
    { name: 'Sapphire', color: '#4F46E5' },
    { name: 'Denim', color: '#6366F1' },
  ],
  // Royal & Bloom
  [
    { name: 'Indigo', color: '#7C3AED' },
    { name: 'Amethyst', color: '#9333EA' },
    { name: 'Violet', color: '#A855F7' },
    { name: 'Fuchsia', color: '#C026D3' },
    { name: 'Magenta', color: '#DB2777' },
    { name: 'Rose', color: '#E11D74' },
  ],
]

function selectColor(color?: string) {
  settingsTheme.applyPrimaryColorFrom(color)
}

function resetToDefault() {
  settingsTheme.setThemeColorsHue()
}
</script>

<template>
  <div class="shadow-2xs flex items-center gap-1 border border-neutral-200/80 rounded-xl bg-white/70 p-1 backdrop-blur-md dark:border-neutral-800/80 dark:bg-neutral-900/70">
    <!-- Day / Night Toggle Button -->
    <button
      type="button"
      class="h-7 w-7 flex cursor-pointer items-center justify-center rounded-lg text-neutral-600 transition-all active:scale-95 hover:bg-black/5 dark:text-neutral-300 dark:hover:bg-white/10"
      :title="isDark ? 'Switch to Light Mode' : 'Switch to Dark Mode'"
      @click="toggleDark()"
    >
      <div
        :class="isDark ? 'i-solar:moon-bold-duotone text-indigo-400' : 'i-solar:sun-2-bold-duotone text-amber-500'"
        class="text-base transition-transform duration-200"
      />
    </button>

    <!-- Subtle Vertical Divider -->
    <div class="h-3.5 w-px bg-neutral-200 dark:bg-neutral-800" />

    <!-- Color Swatch Popover (Rounded Square) -->
    <PopoverRoot>
      <PopoverTrigger as-child>
        <button
          type="button"
          class="group flex cursor-pointer items-center gap-1.5 rounded-lg px-1.5 py-1 transition-all active:scale-95 hover:bg-black/5 dark:hover:bg-white/10"
          title="Quick Theme Accent"
        >
          <!-- Current Active Swatch (Rounded Square per User Request) -->
          <div
            class="shadow-xs h-4.5 w-4.5 rounded-md bg-primary-500 ring-1 ring-black/10 transition-transform group-hover:scale-105 dark:ring-white/20"
          />
          <div class="i-solar:alt-arrow-down-linear text-[10px] text-neutral-400 group-hover:text-neutral-600 dark:group-hover:text-neutral-200" />
        </button>
      </PopoverTrigger>

      <PopoverPortal>
        <PopoverContent
          :side="side"
          :align="align"
          :side-offset="sideOffset"
          :collision-padding="collisionPadding"
          :class="[
            'animate-in fade-in zoom-in-95 z-[10050] max-w-[280px] w-auto',
            'border border-neutral-200/90 dark:border-neutral-800/90 rounded-2xl',
            'bg-white/95 dark:bg-neutral-900/95 p-3 shadow-2xl backdrop-blur-xl duration-150',
          ]"
        >
          <!-- Popover Header -->
          <div class="mb-2.5 flex items-center justify-between border-b border-neutral-100 pb-2 dark:border-neutral-800">
            <div class="flex items-center gap-1.5">
              <div class="i-solar:palette-round-bold-duotone text-xs text-primary-500" />
              <span class="text-xs text-neutral-800 font-semibold dark:text-neutral-200">
                Accent Palette
              </span>
            </div>
            <button
              type="button"
              :class="[
                'flex items-center gap-1 px-2 py-0.5 rounded-lg text-[11px] font-medium transition-all cursor-pointer',
                'border border-amber-500/40 text-amber-600 dark:border-amber-400/40 dark:text-amber-400',
                'hover:bg-amber-500/10 active:scale-95',
              ]"
              @click="resetToDefault"
            >
              <div class="i-solar:restart-linear text-[10px]" />
              <span>Reset</span>
            </button>
          </div>

          <!-- 24 Swatches Grid (4 Rows x 6 Cols) -->
          <div class="flex flex-col gap-1.5">
            <div
              v-for="(row, rowIdx) in colorSpectrumRows"
              :key="rowIdx"
              class="grid grid-cols-6 gap-1.5"
            >
              <button
                v-for="swatch in row"
                :key="swatch.name"
                type="button"
                :title="swatch.name"
                :class="[
                  'relative h-6 w-6 rounded-md transition-all duration-150 cursor-pointer',
                  'hover:scale-115 hover:z-10 hover:shadow-md',
                  'focus:outline-none',
                  settingsTheme.isColorSelectedForPrimary(swatch.color)
                    ? 'ring-2 ring-primary-500 ring-offset-1 dark:ring-offset-neutral-900 scale-105 z-5 shadow-xs'
                    : 'ring-1 ring-black/10 dark:ring-white/10',
                ]"
                :style="{
                  backgroundColor: swatch.color || 'oklch(65% 0.18 220.44)',
                }"
                @click="selectColor(swatch.color)"
              >
                <!-- Active dot indicator -->
                <div
                  v-if="settingsTheme.isColorSelectedForPrimary(swatch.color)"
                  class="shadow-xs absolute inset-0 m-auto h-1.5 w-1.5 rounded-full bg-white"
                />
              </button>
            </div>
          </div>
        </PopoverContent>
      </PopoverPortal>
    </PopoverRoot>
  </div>
</template>
