<script setup lang="ts">
import { useNan0Store } from '@proj-airi/stage-ui/stores/modules/nan0'
import { computed, ref } from 'vue'

const nan0Store = useNan0Store()
const showInnerMonologue = ref(false)

// 12 Canonical Emotional Dimensions paired in 2-column x 6-row grid
interface EmotionConfig {
  key: string
  label: string
  barColor: string
}

const emotionPairs: [EmotionConfig, EmotionConfig][] = [
  // Row 1: Suspicion | Attachment
  [
    { key: 'suspicion', label: 'Suspicion', barColor: 'bg-amber-500' },
    { key: 'attachment', label: 'Attachment', barColor: 'bg-rose-500' },
  ],
  // Row 2: Pride | Smugness
  [
    { key: 'pride', label: 'Pride', barColor: 'bg-purple-500' },
    { key: 'smugness', label: 'Smugness', barColor: 'bg-indigo-500' },
  ],
  // Row 3: Irritation | Rage
  [
    { key: 'irritation', label: 'Irritation', barColor: 'bg-orange-500' },
    { key: 'rage', label: 'Rage', barColor: 'bg-red-500' },
  ],
  // Row 4: Curiosity | Amusement
  [
    { key: 'curiosity', label: 'Curiosity', barColor: 'bg-cyan-500' },
    { key: 'amusement', label: 'Amusement', barColor: 'bg-emerald-500' },
  ],
  // Row 5: Possessiveness | Warmth
  [
    { key: 'possessiveness', label: 'Possessiveness', barColor: 'bg-pink-500' },
    { key: 'warmth', label: 'Warmth', barColor: 'bg-amber-400' },
  ],
  // Row 6: Boredom | Fear
  [
    { key: 'boredom', label: 'Boredom', barColor: 'bg-slate-400' },
    { key: 'fear', label: 'Fear', barColor: 'bg-blue-500' },
  ],
]

function getEmotionValue(key: string): number {
  return nan0Store.emotions[key] ?? 0
}

function getEmotionPercent(key: string): number {
  return Math.round(getEmotionValue(key) * 100)
}

const clusterBadgeClass = computed(() => {
  const cluster = nan0Store.lastReflex?.cluster
  if (cluster === 'conflict')
    return 'bg-amber-50 text-amber-600 border-amber-200 dark:bg-amber-950/30 dark:text-amber-400 dark:border-amber-800/40'
  if (cluster === 'relational')
    return 'bg-rose-50 text-rose-600 border-rose-200 dark:bg-rose-950/30 dark:text-rose-400 dark:border-rose-800/40'
  return 'bg-cyan-50 text-cyan-600 border-cyan-200 dark:bg-cyan-950/30 dark:text-cyan-400 dark:border-cyan-800/40'
})
</script>

<template>
  <div class="flex flex-col gap-3">
    <!-- Processing banner (if 1st-hop LLM is active) -->
    <div
      v-if="nan0Store.isProcessing"
      class="flex items-center gap-1.5 border border-primary-200/50 rounded-lg bg-primary-50/40 px-2 py-1 text-[10px] text-primary-600 font-medium dark:border-primary-800/50 dark:bg-primary-950/30 dark:text-primary-400"
    >
      <span class="i-solar:refresh-circle-bold animate-spin text-xs" />
      <span>1st-Hop Cognition Processing...</span>
    </div>

    <!-- 2-Column x 6-Row Living Emotion Bars Grid -->
    <div class="flex flex-col gap-2">
      <div
        v-for="([col1, col2], rowIndex) in emotionPairs"
        :key="`row-${rowIndex}`"
        class="grid grid-cols-2 gap-2"
      >
        <!-- Column 1 -->
        <div class="flex flex-col gap-1">
          <div class="flex items-center justify-between">
            <span class="truncate text-[10px] text-neutral-600 font-medium dark:text-neutral-300">
              {{ col1.label }}
            </span>
            <span class="text-[9px] text-neutral-400 font-mono dark:text-neutral-500">
              {{ getEmotionPercent(col1.key) }}%
            </span>
          </div>
          <div class="h-1.5 w-full overflow-hidden rounded-full bg-neutral-200/60 dark:bg-neutral-800/60">
            <div
              :class="[col1.barColor, 'h-full rounded-full transition-all duration-500 ease-out']"
              :style="{ width: `${getEmotionPercent(col1.key)}%` }"
            />
          </div>
        </div>

        <!-- Column 2 -->
        <div class="flex flex-col gap-1">
          <div class="flex items-center justify-between">
            <span class="truncate text-[10px] text-neutral-600 font-medium dark:text-neutral-300">
              {{ col2.label }}
            </span>
            <span class="text-[9px] text-neutral-400 font-mono dark:text-neutral-500">
              {{ getEmotionPercent(col2.key) }}%
            </span>
          </div>
          <div class="h-1.5 w-full overflow-hidden rounded-full bg-neutral-200/60 dark:bg-neutral-800/60">
            <div
              :class="[col2.barColor, 'h-full rounded-full transition-all duration-500 ease-out']"
              :style="{ width: `${getEmotionPercent(col2.key)}%` }"
            />
          </div>
        </div>
      </div>
    </div>

    <!-- Executive State & Last Reflex Section -->
    <div class="flex flex-col gap-2 border-t border-neutral-200/50 pt-2.5 dark:border-neutral-800/50">
      <!-- Last Reflex Badge -->
      <div v-if="nan0Store.lastReflex" class="flex flex-col gap-1">
        <span class="text-[9px] text-neutral-400 font-bold tracking-wider uppercase">Last Reflex</span>
        <div
          :class="[
            'flex items-center justify-between gap-1.5 px-2 py-1 rounded-lg border text-[10px] font-medium transition-colors',
            clusterBadgeClass,
          ]"
        >
          <div class="min-w-0 flex items-center gap-1.5 truncate">
            <span :class="nan0Store.lastReflex.icon || 'i-solar:target-bold-duotone'" class="shrink-0 text-xs" />
            <span class="truncate">{{ nan0Store.lastReflex.label }}</span>
          </div>
          <span class="shrink-0 text-[9px] font-mono opacity-80">
            {{ Math.round(nan0Store.lastReflex.confidence * 100) }}%
          </span>
        </div>
      </div>

      <!-- Executive Decision Status Indicator -->
      <div class="flex flex-col gap-1">
        <span class="text-[9px] text-neutral-400 font-bold tracking-wider uppercase">Executive State</span>
        <div
          :class="[
            'flex items-center justify-between rounded-lg border px-2 py-1 text-[10px] font-medium transition-all',
            nan0Store.demandsSilence
              ? 'border-rose-200/70 bg-rose-50/60 text-rose-700 dark:border-rose-800/50 dark:bg-rose-950/30 dark:text-rose-300'
              : 'border-emerald-200/70 bg-emerald-50/60 text-emerald-700 dark:border-emerald-800/50 dark:bg-emerald-950/30 dark:text-emerald-300',
          ]"
        >
          <div class="flex items-center gap-1.5">
            <span :class="nan0Store.demandsSilence ? 'i-solar:muted-bold text-xs' : 'i-solar:chat-round-speak-bold text-xs'" />
            <span class="font-semibold">
              {{ nan0Store.isPouting ? 'Demands Silence (Pouting)' : nan0Store.demandsSilence ? 'Demands Silence' : 'Vocal Dialogue' }}
            </span>
          </div>
          <span class="max-w-[110px] truncate text-[9px] text-neutral-500 font-normal dark:text-neutral-400">
            {{ nan0Store.decisionReason }}
          </span>
        </div>
      </div>

      <!-- Collapsible Inner Monologue Drawer -->
      <div class="flex flex-col gap-1">
        <button
          type="button"
          class="flex items-center justify-between rounded-lg bg-neutral-100/50 px-2 py-1 text-[10px] text-neutral-500 font-medium transition-colors dark:bg-neutral-900/40 dark:text-neutral-400 hover:text-neutral-800 dark:hover:text-neutral-200"
          @click="showInnerMonologue = !showInnerMonologue"
        >
          <span class="flex items-center gap-1.5">
            <span class="i-solar:document-text-bold-duotone text-xs text-primary-500" />
            <span>Inner Monologue</span>
          </span>
          <span :class="showInnerMonologue ? 'i-solar:alt-arrow-up-bold' : 'i-solar:alt-arrow-down-bold'" class="text-[8px]" />
        </button>

        <div
          v-if="showInnerMonologue"
          class="flex flex-col gap-1 border border-neutral-200/50 rounded-lg bg-neutral-100/50 p-2 text-[10px] text-neutral-600 leading-relaxed font-mono italic dark:border-neutral-800/50 dark:bg-neutral-900/40 dark:text-neutral-400"
        >
          <p class="whitespace-pre-wrap">
            {{ nan0Store.innerMonologue || 'No subconscious thoughts recorded yet.' }}
          </p>
        </div>
      </div>
    </div>
  </div>
</template>
