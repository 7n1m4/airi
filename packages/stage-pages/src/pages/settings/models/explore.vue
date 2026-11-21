<script setup lang="ts">
import type { ModelMarketplace, SpotlightModel } from '@proj-anima/stage-ui/constants'

import { MODEL_MARKETPLACES, SPOTLIGHT_MODELS } from '@proj-anima/stage-ui/constants'
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'

import DiscoverCarousel from './components/DiscoverCarousel.vue'

const { t } = useI18n()

type FormatFilter = 'all' | 'vrm' | 'live2d' | 'spine' | 'mmd'

const activeFilter = ref<FormatFilter>('all')
const activeSpotlightId = ref<string>(
  activeFilter.value === 'vrm'
    ? 'vroid-you-canaria'
    : activeFilter.value === 'live2d'
      ? 'kofi-dg-sheli'
      : (SPOTLIGHT_MODELS[0]?.id || ''),
)

const filterTabs = [
  { id: 'all' as const, label: 'All Formats', icon: 'i-solar:box-minimalistic-bold-duotone' },
  { id: 'vrm' as const, label: 'VRM (3D)', icon: 'i-solar:cube-bold-duotone' },
  { id: 'live2d' as const, label: 'Live2D (2D)', icon: 'i-solar:square-academic-cap-bold-duotone' },
  { id: 'spine' as const, label: 'Spine (2D)', icon: 'i-solar:bone-bold-duotone' },
  { id: 'mmd' as const, label: 'MMD', icon: 'i-solar:music-note-bold-duotone' },
]

const filteredSpotlightModels = computed(() => {
  if (activeFilter.value === 'all')
    return SPOTLIGHT_MODELS
  return SPOTLIGHT_MODELS.filter(m => m.format === activeFilter.value)
})

watch(activeFilter, (newTab) => {
  if (newTab === 'vrm') {
    activeSpotlightId.value = 'vroid-you-canaria'
    return
  }
  if (newTab === 'live2d') {
    activeSpotlightId.value = 'kofi-dg-sheli'
    return
  }
  const models = newTab === 'all'
    ? SPOTLIGHT_MODELS
    : SPOTLIGHT_MODELS.filter(m => m.format === newTab)
  if (models[0]) {
    activeSpotlightId.value = models[0].id
  }
})

const activeSpotlightModel = computed(() => {
  return filteredSpotlightModels.value.find(m => m.id === activeSpotlightId.value)
    || filteredSpotlightModels.value[0]
    || null
})

function handleSpotlightSelect(model: SpotlightModel) {
  if (model.downloadUrl) {
    window.open(model.downloadUrl, '_blank', 'noopener,noreferrer')
  }
}

const filteredMarketplaces = computed(() => {
  let list: ModelMarketplace[] = MODEL_MARKETPLACES

  if (activeFilter.value === 'vrm') {
    list = list.filter(m => m.vrm)
  }
  else if (activeFilter.value === 'live2d') {
    list = list.filter(m => m.live2d)
  }
  else if (activeFilter.value === 'spine') {
    list = list.filter(m => m.spine)
  }
  else if (activeFilter.value === 'mmd') {
    list = list.filter(m => m.mmd)
  }

  return list
})

const freeArchives = computed(() => {
  return filteredMarketplaces.value.filter(m => m.pricing === 'free')
})

const creatorMarketplaces = computed(() => {
  return filteredMarketplaces.value.filter(m => m.pricing !== 'free')
})

function formatLanguage(lang: string): string {
  if (lang === 'jp')
    return '日本語'
  if (lang === 'cn')
    return '中文'
  return 'English'
}
</script>

<template>
  <div class="flex flex-col gap-6 pb-12 font-normal">
    <!-- Hero Header -->
    <div class="relative overflow-hidden border border-neutral-200/80 rounded-2xl bg-white/70 p-6 shadow-sm backdrop-blur-md dark:border-neutral-800/80 dark:bg-neutral-900/60">
      <div class="relative z-1 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div class="flex items-start gap-4">
          <div class="h-12 w-12 flex shrink-0 items-center justify-center rounded-xl bg-primary-500/10 text-primary-500 dark:bg-primary-500/15 dark:text-primary-400">
            <div class="i-solar:planet-3-bold-duotone text-2xl" />
          </div>
          <div>
            <h1 class="text-xl text-neutral-900 font-bold dark:text-neutral-50">
              {{ t('settings.pages.models.explore.title', 'Discover Avatars') }}
            </h1>
            <p class="mt-1 max-w-2xl text-xs text-neutral-500 leading-relaxed dark:text-neutral-400">
              {{ t('settings.pages.models.explore.description', 'Explore community archives, external repositories, and free model libraries for VRM, Live2D, Spine, and MMD.') }}
            </p>
          </div>
        </div>

        <a
          href="https://github.com/dasilva333/airi/issues"
          target="_blank"
          rel="noopener noreferrer"
          class="inline-flex shrink-0 items-center self-start gap-1.5 border border-primary-500/30 rounded-xl bg-primary-500/10 px-3.5 py-2 text-xs text-primary-600 font-semibold transition-colors sm:self-auto hover:bg-primary-500/20 dark:text-primary-400"
        >
          <div class="i-solar:add-circle-bold text-sm" />
          <span>Suggest a Site</span>
        </a>
      </div>

      <!-- Subtle background glow -->
      <div class="pointer-events-none absolute h-36 w-36 rounded-full bg-primary-500/10 blur-2xl -right-12 -top-12 dark:bg-primary-500/15" />
    </div>

    <!-- Format Filter Segment Control -->
    <div class="flex items-center">
      <div class="inline-flex flex-wrap gap-1.5 rounded-xl bg-neutral-100 p-1 dark:bg-neutral-800/80">
        <button
          v-for="tab in filterTabs"
          :key="tab.id"
          :class="[
            'px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-all flex items-center gap-1.5 cursor-pointer',
            activeFilter === tab.id
              ? 'bg-white text-neutral-900 shadow-2xs dark:bg-neutral-700 dark:text-neutral-50'
              : 'text-neutral-500 hover:text-neutral-900 dark:text-neutral-400 dark:hover:text-neutral-100',
          ]"
          @click="activeFilter = tab.id"
        >
          <div :class="[tab.icon, 'text-sm']" />
          <span>{{ tab.label }}</span>
        </button>
      </div>
    </div>

    <!-- Featured Free Avatars Showcase Section -->
    <div class="flex flex-col gap-3">
      <div class="flex items-center justify-between px-1">
        <div class="flex items-center gap-2">
          <div class="i-solar:stars-bold-duotone text-base text-primary-500" />
          <span class="text-xs text-neutral-700 font-bold tracking-wider uppercase dark:text-neutral-300">
            Featured Free Avatars
          </span>
        </div>
        <span class="text-[11px] text-neutral-400">
          Showing {{ filteredSpotlightModels.length }} models
        </span>
      </div>

      <!-- 3D Coverflow Carousel Stage -->
      <div class="shadow-2xs overflow-hidden border border-neutral-200/80 rounded-2xl bg-neutral-50/70 p-2 backdrop-blur-sm dark:border-neutral-800/80 dark:bg-neutral-900/50">
        <DiscoverCarousel
          v-model:active-id="activeSpotlightId"
          :models="filteredSpotlightModels"
          @select="handleSpotlightSelect"
        />

        <!-- Active Model Spotlight Detail Card -->
        <div
          v-if="activeSpotlightModel"
          class="dark:bg-neutral-850/90 mt-2 flex flex-col items-start justify-between gap-3.5 border border-neutral-200/80 rounded-xl bg-white/90 p-3.5 shadow-sm backdrop-blur-md sm:flex-row sm:items-center dark:border-neutral-800/80"
        >
          <div class="min-w-0 flex items-center gap-3">
            <!-- Mini Thumbnail / Silhouette Box -->
            <div class="h-11 w-11 flex shrink-0 items-center justify-center overflow-hidden border border-neutral-200/80 rounded-lg bg-neutral-100 dark:border-neutral-700/80 dark:bg-neutral-800">
              <img
                v-if="activeSpotlightModel.previewUrl"
                :src="activeSpotlightModel.previewUrl"
                :alt="activeSpotlightModel.name"
                class="h-full w-full object-cover"
                referrerpolicy="no-referrer"
                loading="lazy"
              >
              <div v-else class="i-solar:user-bold text-xl text-neutral-400 opacity-40" />
            </div>

            <!-- Avatar Metadata -->
            <div class="min-w-0 flex flex-col">
              <div class="flex flex-wrap items-center gap-2">
                <h2 class="truncate text-sm text-neutral-900 font-bold dark:text-neutral-100">
                  {{ activeSpotlightModel.name }}
                </h2>
                <span class="rounded bg-primary-500/10 px-2 py-0.5 text-[10px] text-primary-600 font-bold dark:text-primary-400">
                  {{ activeSpotlightModel.formatLabel || activeSpotlightModel.format.toUpperCase() }}
                </span>
                <a
                  v-if="activeSpotlightModel.sourceSiteUrl"
                  :href="activeSpotlightModel.sourceSiteUrl"
                  target="_blank"
                  rel="noopener noreferrer"
                  class="flex items-center gap-0.5 text-[11px] text-neutral-400 transition-colors hover:text-primary-600 dark:hover:text-primary-400"
                >
                  <span>via {{ activeSpotlightModel.sourceSiteName }}</span>
                  <div class="i-solar:arrow-up-right-linear text-[10px]" />
                </a>
              </div>

              <div class="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-neutral-500 dark:text-neutral-400">
                <span v-if="activeSpotlightModel.author" class="font-medium">
                  By {{ activeSpotlightModel.author }}
                </span>
                <span v-if="activeSpotlightModel.description" class="text-neutral-400 hidden sm:inline">•</span>
                <span v-if="activeSpotlightModel.description" class="truncate text-neutral-400 hidden sm:inline">
                  {{ activeSpotlightModel.description }}
                </span>
              </div>
            </div>
          </div>

          <!-- Primary CTA Button (Direct Download / Item Page) -->
          <div class="flex shrink-0 items-center self-end gap-2 sm:self-center">
            <a
              :href="activeSpotlightModel.downloadUrl"
              target="_blank"
              rel="noopener noreferrer"
              class="shadow-2xs inline-flex items-center gap-1.5 rounded-xl bg-primary-600 px-4 py-2 text-xs text-white font-bold transition-all active:scale-95 hover:bg-primary-700"
            >
              <span>Download Model</span>
              <div class="i-solar:arrow-up-right-linear text-xs" />
            </a>
          </div>
        </div>
      </div>
    </div>

    <!-- Free Community Archives Section -->
    <div class="mt-2 flex flex-col gap-3.5">
      <div class="flex items-center justify-between px-1">
        <div class="flex items-center gap-2">
          <div class="i-solar:gift-bold-duotone text-base text-emerald-500" />
          <div>
            <span class="text-xs text-neutral-800 font-bold tracking-wider uppercase dark:text-neutral-200">
              Free Community Archives
            </span>
            <span class="text-xs text-neutral-400 font-normal hidden sm:inline">
              — Curated open repositories, extracted game assets, and direct downloads
            </span>
          </div>
        </div>
        <span class="text-[11px] text-neutral-400">
          Showing {{ freeArchives.length }} archives
        </span>
      </div>

      <!-- Free Archives Grid -->
      <div v-if="freeArchives.length > 0" class="grid grid-cols-1 gap-3.5 lg:grid-cols-3 sm:grid-cols-2">
        <a
          v-for="site in freeArchives"
          :key="site.name"
          :href="site.url"
          target="_blank"
          rel="noopener noreferrer"
          class="group shadow-2xs relative flex flex-col justify-between border border-neutral-200/80 rounded-2xl bg-white/80 p-4.5 transition-all duration-200 dark:border-neutral-800/80 hover:border-emerald-500/40 dark:bg-neutral-900/60 hover:bg-white hover:shadow-md dark:hover:border-emerald-400/40 dark:hover:bg-neutral-900"
        >
          <div class="flex flex-col gap-2">
            <!-- Card Header -->
            <div class="flex items-start justify-between gap-2">
              <h3 class="text-sm text-neutral-900 font-bold transition-colors dark:text-neutral-100 group-hover:text-emerald-600 dark:group-hover:text-emerald-400">
                {{ site.name }}
              </h3>
              <div class="i-solar:arrow-up-right-linear text-base text-neutral-400 transition-all group-hover:translate-x-0.5 group-hover:translate-y--0.5 group-hover:text-emerald-500" />
            </div>

            <!-- Description -->
            <p v-if="site.description" class="text-xs text-neutral-500 leading-relaxed dark:text-neutral-400">
              {{ site.description }}
            </p>

            <!-- Badges (Pricing + Notice + Formats) -->
            <div class="mt-1 flex flex-wrap items-center gap-1.5">
              <span class="border border-emerald-500/25 rounded-md bg-emerald-500/10 px-2 py-0.5 text-[10px] text-emerald-600 font-bold dark:text-emerald-400">
                100% Free
              </span>
              <span v-if="site.notice" class="border border-blue-500/25 rounded-md bg-blue-500/10 px-2 py-0.5 text-[10px] text-blue-600 font-medium dark:text-blue-400">
                {{ site.notice }}
              </span>
              <span v-if="site.vrm" class="border border-blue-500/20 rounded-md bg-blue-500/10 px-2 py-0.5 text-[10px] text-blue-600 font-bold dark:text-blue-400">
                VRM
              </span>
              <span v-if="site.live2d" class="border border-teal-500/20 rounded-md bg-teal-500/10 px-2 py-0.5 text-[10px] text-teal-600 font-bold dark:text-teal-400">
                Live2D
              </span>
              <span v-if="site.spine" class="border border-purple-500/20 rounded-md bg-purple-500/10 px-2 py-0.5 text-[10px] text-purple-600 font-bold dark:text-purple-400">
                Spine
              </span>
              <span v-if="site.mmd" class="border border-pink-500/20 rounded-md bg-pink-500/10 px-2 py-0.5 text-[10px] text-pink-600 font-bold dark:text-pink-400">
                MMD
              </span>
            </div>
          </div>

          <!-- Card Footer -->
          <div class="mt-4 flex items-center justify-between border-t border-neutral-100 pt-2.5 text-[11px] text-neutral-400 dark:border-neutral-800">
            <div class="flex items-center gap-1.5">
              <div class="i-solar:globus-linear text-xs" />
              <span>{{ site.origin }}</span>
            </div>
            <div class="flex items-center gap-1">
              <span v-for="lang in site.languages" :key="lang" class="rounded bg-neutral-100 px-1.5 py-0.5 dark:bg-neutral-800">
                {{ formatLanguage(lang) }}
              </span>
            </div>
          </div>
        </a>
      </div>

      <!-- Empty State for Free Archives -->
      <div
        v-else
        class="flex flex-col items-center justify-center border border-neutral-200 rounded-2xl border-dashed py-8 text-center dark:border-neutral-800"
      >
        <p class="text-xs text-neutral-500 font-medium dark:text-neutral-400">
          No free community archives found for this format filter. Check creator marketplaces below.
        </p>
      </div>
    </div>

    <!-- Creator Marketplaces & Stores Section -->
    <div class="mt-2 flex flex-col gap-3.5">
      <div class="flex items-center justify-between px-1">
        <div class="flex items-center gap-2">
          <div class="i-solar:shop-bold-duotone text-base text-primary-500" />
          <div>
            <span class="text-xs text-neutral-800 font-bold tracking-wider uppercase dark:text-neutral-200">
              Creator Marketplaces & Stores
            </span>
            <span class="text-xs text-neutral-400 font-normal hidden sm:inline">
              — Independent storefronts, commercial asset hubs, and commission directories
            </span>
          </div>
        </div>
        <span class="text-[11px] text-neutral-400">
          Showing {{ creatorMarketplaces.length }} platforms
        </span>
      </div>

      <!-- Creator Marketplaces Grid -->
      <div v-if="creatorMarketplaces.length > 0" class="grid grid-cols-1 gap-3.5 lg:grid-cols-3 sm:grid-cols-2">
        <a
          v-for="site in creatorMarketplaces"
          :key="site.name"
          :href="site.url"
          target="_blank"
          rel="noopener noreferrer"
          class="group shadow-2xs relative flex flex-col justify-between border border-neutral-200/80 rounded-2xl bg-white/80 p-4.5 transition-all duration-200 dark:border-neutral-800/80 hover:border-primary-500/40 dark:bg-neutral-900/60 hover:bg-white hover:shadow-md dark:hover:border-primary-400/40 dark:hover:bg-neutral-900"
        >
          <div class="flex flex-col gap-2">
            <!-- Card Header -->
            <div class="flex items-start justify-between gap-2">
              <h3 class="text-sm text-neutral-900 font-bold transition-colors dark:text-neutral-100 group-hover:text-primary-600 dark:group-hover:text-primary-400">
                {{ site.name }}
              </h3>
              <div class="i-solar:arrow-up-right-linear text-base text-neutral-400 transition-all group-hover:translate-x-0.5 group-hover:translate-y--0.5 group-hover:text-primary-500" />
            </div>

            <!-- Description -->
            <p v-if="site.description" class="text-xs text-neutral-500 leading-relaxed dark:text-neutral-400">
              {{ site.description }}
            </p>

            <!-- Badges (Pricing + Notice + Formats) -->
            <div class="mt-1 flex flex-wrap items-center gap-1.5">
              <span
                v-if="site.pricing === 'paid'"
                class="border border-purple-500/25 rounded-md bg-purple-500/10 px-2 py-0.5 text-[10px] text-purple-600 font-bold dark:text-purple-400"
              >
                Paid / Commissions
              </span>
              <span
                v-else
                class="border border-amber-500/25 rounded-md bg-amber-500/10 px-2 py-0.5 text-[10px] text-amber-600 font-bold dark:text-amber-400"
              >
                Free & Paid
              </span>
              <span v-if="site.notice" class="border border-blue-500/25 rounded-md bg-blue-500/10 px-2 py-0.5 text-[10px] text-blue-600 font-medium dark:text-blue-400">
                {{ site.notice }}
              </span>
              <span v-if="site.vrm" class="border border-blue-500/20 rounded-md bg-blue-500/10 px-2 py-0.5 text-[10px] text-blue-600 font-bold dark:text-blue-400">
                VRM
              </span>
              <span v-if="site.live2d" class="border border-teal-500/20 rounded-md bg-teal-500/10 px-2 py-0.5 text-[10px] text-teal-600 font-bold dark:text-teal-400">
                Live2D
              </span>
              <span v-if="site.spine" class="border border-purple-500/20 rounded-md bg-purple-500/10 px-2 py-0.5 text-[10px] text-purple-600 font-bold dark:text-purple-400">
                Spine
              </span>
              <span v-if="site.mmd" class="border border-pink-500/20 rounded-md bg-pink-500/10 px-2 py-0.5 text-[10px] text-pink-600 font-bold dark:text-pink-400">
                MMD
              </span>
            </div>
          </div>

          <!-- Card Footer -->
          <div class="mt-4 flex items-center justify-between border-t border-neutral-100 pt-2.5 text-[11px] text-neutral-400 dark:border-neutral-800">
            <div class="flex items-center gap-1.5">
              <div class="i-solar:globus-linear text-xs" />
              <span>{{ site.origin }}</span>
            </div>
            <div class="flex items-center gap-1">
              <span v-for="lang in site.languages" :key="lang" class="rounded bg-neutral-100 px-1.5 py-0.5 dark:bg-neutral-800">
                {{ formatLanguage(lang) }}
              </span>
            </div>
          </div>
        </a>
      </div>

      <!-- Empty State for Creator Marketplaces -->
      <div
        v-else
        class="flex flex-col items-center justify-center border border-neutral-200 rounded-2xl border-dashed py-8 text-center dark:border-neutral-800"
      >
        <p class="text-xs text-neutral-500 font-medium dark:text-neutral-400">
          No marketplaces found for this format filter.
        </p>
      </div>
    </div>

    <!-- Community Contribution Footer Callout -->
    <div class="mt-4 flex flex-col items-center justify-between gap-4 border border-primary-500/15 rounded-2xl bg-primary-500/5 p-6 sm:flex-row dark:border-primary-500/20 dark:bg-primary-500/10">
      <div class="flex items-center gap-3.5 text-center sm:text-left">
        <div class="h-10 w-10 flex shrink-0 items-center justify-center rounded-xl bg-primary-500/15 text-primary-600 dark:text-primary-400">
          <div class="i-solar:heart-bold text-xl" />
        </div>
        <div>
          <div class="text-sm text-neutral-900 font-bold dark:text-neutral-100">
            Know another great model repository?
          </div>
          <div class="text-xs text-neutral-500 dark:text-neutral-400">
            Help the AIRI community grow by recommending more free repositories, tools, or archives.
          </div>
        </div>
      </div>
      <a
        href="https://github.com/dasilva333/airi/issues"
        target="_blank"
        rel="noopener noreferrer"
        class="shadow-xs inline-flex shrink-0 items-center gap-1.5 rounded-xl bg-primary-600 px-4 py-2 text-xs text-white font-bold transition-colors hover:bg-primary-700"
      >
        <span>Submit on GitHub</span>
        <div class="i-solar:arrow-right-linear text-xs" />
      </a>
    </div>
  </div>
</template>

<route lang="yaml">
meta:
  layout: settings
  titleKey: settings.pages.models.explore.title
  subtitleKey: settings.pages.models.title
  descriptionKey: settings.pages.models.explore.description
  icon: i-solar:planet-3-bold-duotone
  settingsEntry: false
  order: 1
  stageTransition:
    name: slide
    pageSpecificAvailable: true
</route>
