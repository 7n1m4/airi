<script setup lang="ts">
import { estimateTokens } from '@proj-airi/stage-shared'
import {
  useAiriCardStore,
  useShortTermMemoryStore,
  useTextJournalStore,
} from '@proj-airi/stage-ui/stores'
import { useMemoryLifetimeStore } from '@proj-airi/stage-ui/stores/memory-lifetime'
import { storeToRefs } from 'pinia'
import { computed, onMounted } from 'vue'
import { useRouter } from 'vue-router'

const router = useRouter()

const cardStore = useAiriCardStore()
const textJournalStore = useTextJournalStore()
const shortTermMemoryStore = useShortTermMemoryStore()
const lifetimeStore = useMemoryLifetimeStore()

const { activeCardId } = storeToRefs(cardStore)
const { entries, loading: textJournalLoading } = storeToRefs(textJournalStore)
const { loading: stmmLoading } = storeToRefs(shortTermMemoryStore)
const { artifacts, isProvisioning } = storeToRefs(lifetimeStore)

onMounted(async () => {
  try {
    void textJournalStore.load()
    if (activeCardId.value) {
      void lifetimeStore.loadForCharacter(activeCardId.value)
    }
  }
  catch (err) {
    console.warn('[MemoryHub] Store init warning:', err)
  }
})

const totalDepthTokens = computed(() => {
  let total = 0
  const charId = activeCardId.value

  // 1. Short-term memory blocks tokens
  if (charId) {
    const blocks = shortTermMemoryStore.getCharacterBlocks(charId)
    for (const b of blocks) {
      total += b.estimatedTokens || estimateTokens(b.summary || '')
    }
  }

  // 2. Long-term episodic journal tokens
  const activeEntries = charId
    ? entries.value.filter(e => e.characterId === charId)
    : entries.value
  for (const e of activeEntries) {
    total += estimateTokens(e.content || '')
  }

  // 3. Lifetime distilled artifact tokens
  if (charId) {
    const artifact = artifacts.value.get(charId)
    if (artifact?.distilledContent) {
      total += estimateTokens(artifact.distilledContent)
    }
    else if (artifact?.baseContent) {
      total += estimateTokens(artifact.baseContent)
    }
  }

  return total
})

const formattedDepthTokens = computed(() => {
  return `${totalDepthTokens.value.toLocaleString()} Tokens`
})

const systemIntegrity = computed(() => {
  if (textJournalLoading.value || stmmLoading.value || isProvisioning.value) {
    return 'Syncing...'
  }
  return '100% Ready'
})

const memorySections = [
  {
    id: 'ephemeral',
    title: 'Daily Summaries',
    subtitle: 'Short-Term Memory (STMM)',
    description: 'Retains high-quality awareness and rich memories from the last few days—even after a session reset.',
    icon: 'i-solar:alarm-bold-duotone',
    accent: 'from-cyan-500/20 to-sky-500/10',
    route: '/settings/modules/memory-short-term',
    bullets: [
      'Preserve high quality situational awareness from recent days',
      'Seamless character reload by clearing history while retaining context',
      'Updates daily for active characters to maintain the current window',
      'Powers intelligent context compaction as your conversation grows',
    ],
  },
  {
    id: 'signals',
    title: 'The Echoes',
    subtitle: 'The Dream State (Chips)',
    description: 'AIRI consolidates long conversations into interpretive tags and highlights while you\'re away.',
    icon: 'i-solar:bolt-bold-duotone',
    accent: 'from-violet-500/20 to-indigo-500/10',
    route: '/settings/modules/memory-signals',
    bullets: [
      'Generates flavor tags and mood highlights when the character is idle',
      'Uses AFK gating so proactive runs do not interrupt active conversation',
      'Distills highlights after the 1-hour session timeout threshold',
      'Processes up to 4 core conversation sessions per day',
    ],
  },
  {
    id: 'episodic',
    title: 'The Sentinel\'s Journal',
    subtitle: 'Episodic Records (LTMM)',
    description: 'The Sacred Records. Ask your character to use their "text_journal" to preserve meaningful moments forever.',
    icon: 'i-solar:notebook-bookmark-bold-duotone',
    accent: 'from-emerald-500/20 to-teal-500/10',
    route: '/settings/modules/memory-long-term',
    bullets: [
      'A dedicated tool you can ask the character to use on-demand',
      'Record and search through durable, high-fidelity narrative memories',
      'Powerhouse for deep semantic recall and relational grounding',
      'Stores your personal "Sacred Records" in a human-readable format',
    ],
  },
  {
    id: 'relational',
    title: 'The Eternal Thread',
    subtitle: 'Lifetime Artifact',
    description: 'The long-term memory of the relationship. It keeps the bond stable across resets and slowly updates as new durable moments arrive.',
    icon: 'i-solar:dna-bold-duotone',
    accent: 'from-amber-500/20 to-orange-500/10',
    route: '/settings/modules/memory-lifetime',
    bullets: [
      'Stable base for long-horizon memory',
      'Incremental updates from new durable events',
      'Updates from a base plus daily changes',
      'Preserves relationship identity across resets',
    ],
  },
]
</script>

<template>
  <div class="font-urbanist flex flex-col gap-4">
    <!-- Neurological Header: Compact Single-Row Layout -->
    <div class="border border-neutral-200/80 rounded-2xl bg-neutral-100/40 p-5 backdrop-blur-sm dark:border-neutral-800 dark:bg-neutral-900/40">
      <div class="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <!-- Left: Branding & Intro Copy -->
        <div class="max-w-2xl flex items-start gap-3.5">
          <div class="h-11 w-11 flex shrink-0 items-center justify-center rounded-xl bg-primary-500/10 shadow-inner">
            <div class="i-solar:star-bold-duotone inline-block text-2xl text-primary-500" />
          </div>
          <div>
            <h1 class="text-xl text-neutral-800 font-bold dark:text-neutral-100">
              Memory Hub
            </h1>
            <p class="mt-0.5 text-xs text-neutral-500 line-height-relaxed dark:text-neutral-400">
              AIRI’s nervous system is split into four distinct temporal quadrants. By segmenting ephemeral reactions from the eternal relational thread, we ensure identity stays stable even as the conversation flows.
            </p>
          </div>
        </div>

        <!-- Right: The 2 Core Telemetry Tiles -->
        <div class="flex shrink-0 items-center gap-2.5">
          <div class="shadow-2xs min-w-32 border border-neutral-200/60 rounded-xl bg-white/60 px-3.5 py-2.5 transition-all dark:border-neutral-700/50 dark:bg-neutral-900/50">
            <div class="mb-0.5 text-[9px] text-neutral-400 font-bold tracking-widest uppercase dark:text-neutral-500">
              System Integrity
            </div>
            <div class="flex items-center gap-1.5 text-xs text-neutral-700 font-semibold dark:text-neutral-200">
              <div class="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-500" />
              {{ systemIntegrity }}
            </div>
          </div>
          <div class="shadow-2xs min-w-32 border border-neutral-200/60 rounded-xl bg-white/60 px-3.5 py-2.5 transition-all dark:border-neutral-700/50 dark:bg-neutral-900/50">
            <div class="mb-0.5 text-[9px] text-neutral-400 font-bold tracking-widest uppercase dark:text-neutral-500">
              Total Depth
            </div>
            <div class="text-xs text-neutral-700 font-semibold dark:text-neutral-200">
              {{ formattedDepthTokens }}
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- The Four Quads: Compact, Full-Card Clickable Tiles -->
    <div class="grid gap-3.5 lg:grid-cols-2 md:grid-cols-2">
      <section
        v-for="section in memorySections"
        :key="section.id"
        class="group shadow-2xs relative cursor-pointer overflow-hidden border border-neutral-200/80 rounded-2xl bg-white p-5 transition-all dark:border-neutral-800 hover:border-primary-500/40 dark:bg-neutral-900/60 hover:shadow-md"
        @click="router.push(section.route)"
      >
        <!-- Background Accent Glow -->
        <div :class="['absolute -right-4 -top-4 h-28 w-28 rounded-full bg-gradient-to-br blur-3xl opacity-15 transition-all group-hover:opacity-35', section.accent]" />

        <div class="relative z-10 flex flex-col gap-3">
          <!-- Inline Icon & Header Content (Vertically Centered) -->
          <div class="flex items-center gap-3.5">
            <div :class="['h-11 w-11 shrink-0 flex items-center justify-center rounded-xl bg-gradient-to-br shadow-sm transition-transform group-hover:scale-105', section.accent]">
              <div :class="[section.icon, 'text-xl text-primary-500 inline-block']" />
            </div>

            <div class="min-w-0 flex-1">
              <div class="flex items-center justify-between">
                <h3 class="text-[10px] text-neutral-400 font-bold tracking-wider uppercase dark:text-neutral-500">
                  {{ section.subtitle }}
                </h3>
                <div class="i-solar:arrow-right-up-linear text-neutral-400 opacity-0 transition-all group-hover:text-primary-500 group-hover:opacity-100" />
              </div>
              <h2 class="text-base text-neutral-800 font-bold dark:text-neutral-100">
                {{ section.title }}
              </h2>
              <p class="mt-0.5 text-xs text-neutral-500 line-height-relaxed dark:text-neutral-400">
                {{ section.description }}
              </p>
            </div>
          </div>

          <!-- Verbatim Bullet Points -->
          <ul class="grid gap-2 border-t border-neutral-100 pt-3 dark:border-neutral-800/80">
            <li
              v-for="bullet in section.bullets"
              :key="bullet"
              class="flex items-start gap-2 text-xs text-neutral-600 dark:text-neutral-300"
            >
              <div class="i-solar:check-circle-bold-duotone mt-0.5 shrink-0 text-sm text-primary-500/70" />
              <span class="line-height-tight">{{ bullet }}</span>
            </li>
          </ul>
        </div>
      </section>
    </div>
  </div>
</template>

<route lang="yaml">
meta:
  layout: settings
  titleKey: settings.pages.memory.title
  subtitleKey: settings.title
  descriptionKey: settings.pages.memory.description
  icon: i-solar:leaf-bold-duotone
  settingsEntry: true
  order: 5
  stageTransition:
    name: slide
</route>
