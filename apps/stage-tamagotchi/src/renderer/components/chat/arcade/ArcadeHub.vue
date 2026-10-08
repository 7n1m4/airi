<script setup lang="ts">
import type {
  CatalogGame,
  GameplayPace,
  PrimaryController,
  RecommendedSystem,
  ScreenMotionArchitecture,
} from '@proj-airi/stage-ui/types'

import { useArcadeKnowledgeStore } from '@proj-airi/stage-ui/stores'
import { computed, onMounted, ref, watch } from 'vue'

const props = defineProps<{
  initialSelectedGameId?: string
}>()

const emit = defineEmits<{
  (e: 'selectGame', game: CatalogGame): void
  (e: 'uploadCustomFile', file: File): void
}>()

const knowledgeStore = useArcadeKnowledgeStore()

// --- Curated Hall of Fame with Pre-filled Facets ---
const HALL_OF_FAME: CatalogGame[] = [
  {
    identifier: '2048',
    title: '2048 Retro Canvas',
    year: 2014,
    downloads: 5000000,
    description: 'Tile-sliding mathematics puzzle with retro CRT scanline raster.',
    classification: {
      recommended_system: 'system1_reflex',
      screen_motion_architecture: 'fixed_single_screen',
      gameplay_pace: 'turn_based',
      primary_genre: 'puzzle',
      primary_controller: 'keyboard_only',
      companion_role: 'zen_co_pilot',
    },
  },
  {
    identifier: 'msdos_Doom_1993',
    title: 'Doom (Shareware 1993)',
    year: 1993,
    downloads: 12500000,
    description: 'The legendary first-person shooter that revolutionized 3D gaming.',
    thumbnailUrl: 'https://archive.org/services/img/msdos_Doom_1993',
    bundleUrl: 'https://v8.js-dos.com/bundles/doom.jsdos',
    classification: {
      recommended_system: 'system2_strategy',
      screen_motion_architecture: 'first_person_or_3d',
      gameplay_pace: 'real_time_intense',
      primary_genre: 'action_arcade',
      primary_controller: 'hybrid_keyboard_mouse',
      companion_role: 'hype_coach',
    },
  },
  {
    identifier: 'msdos_Prince_of_Persia_1990',
    title: 'Prince of Persia',
    year: 1990,
    downloads: 2164260,
    description: 'Cinematic platformer with fluid rotoscoped animation and swordplay.',
    thumbnailUrl: 'https://archive.org/services/img/msdos_Prince_of_Persia_1990',
    classification: {
      recommended_system: 'system1_reflex',
      screen_motion_architecture: 'flip_screen_rooms',
      gameplay_pace: 'real_time_fast',
      primary_genre: 'action_arcade',
      primary_controller: 'keyboard_only',
      companion_role: 'snarky_backseater',
    },
  },
  {
    identifier: 'digger_1983',
    title: 'Digger (1983)',
    year: 1983,
    downloads: 850000,
    description: 'Windmill Software arcade digging classic with iconic Popcorn synthesizer audio.',
    thumbnailUrl: 'https://archive.org/services/img/msdos_Digger_1983',
    bundleUrl: 'https://v8.js-dos.com/bundles/digger.jsdos',
    classification: {
      recommended_system: 'system1_reflex',
      screen_motion_architecture: 'smooth_scrolling_camera',
      gameplay_pace: 'real_time_fast',
      primary_genre: 'action_arcade',
      primary_controller: 'keyboard_only',
      companion_role: 'hype_coach',
    },
  },
  {
    identifier: 'msdos_Wolfenstein_3D_1992',
    title: 'Wolfenstein 3D',
    year: 1992,
    downloads: 1409250,
    description: 'Escape Castle Wolfenstein in id Software\'s seminal raycasted classic.',
    thumbnailUrl: 'https://archive.org/services/img/msdos_Wolfenstein_3D_1992',
    classification: {
      recommended_system: 'system2_strategy',
      screen_motion_architecture: 'first_person_or_3d',
      gameplay_pace: 'real_time_intense',
      primary_genre: 'action_arcade',
      primary_controller: 'keyboard_only',
      companion_role: 'hype_coach',
    },
  },
  {
    identifier: 'msdos_SimCity_1989',
    title: 'SimCity',
    year: 1989,
    downloads: 1060240,
    description: 'Design, build, and govern a living, growing urban metropolis.',
    thumbnailUrl: 'https://archive.org/services/img/msdos_SimCity_1989',
    classification: {
      recommended_system: 'system2_strategy',
      screen_motion_architecture: 'static_ui_or_turn_based',
      gameplay_pace: 'real_time_calm',
      primary_genre: 'strategy_simulation',
      primary_controller: 'mouse_only',
      companion_role: 'strategic_advisor',
    },
  },
  {
    identifier: 'CIVILIZATION_201902',
    title: 'Civilization (1991)',
    year: 1991,
    downloads: 870000,
    description: 'Build an empire to stand the test of time from antiquity to the space age.',
    thumbnailUrl: 'https://archive.org/services/img/CIVILIZATION_201902',
    classification: {
      recommended_system: 'system2_strategy',
      screen_motion_architecture: 'static_ui_or_turn_based',
      gameplay_pace: 'turn_based',
      primary_genre: 'strategy_simulation',
      primary_controller: 'mouse_only',
      companion_role: 'strategic_advisor',
    },
  },
  {
    identifier: 'msdos_Pac-Man_1983',
    title: 'Pac-Man',
    year: 1983,
    downloads: 1289420,
    description: 'Namco\'s timeless arcade maze chaser ported to MS-DOS.',
    thumbnailUrl: 'https://archive.org/services/img/msdos_Pac-Man_1983',
    classification: {
      recommended_system: 'system1_reflex',
      screen_motion_architecture: 'fixed_single_screen',
      gameplay_pace: 'real_time_fast',
      primary_genre: 'action_arcade',
      primary_controller: 'keyboard_only',
      companion_role: 'snarky_backseater',
    },
  },
]

// --- State ---
const searchQuery = ref('')
const activeTab = ref<'hall_of_fame' | 'acquired' | 'all_catalog'>('hall_of_fame')
const selectedTier = ref<ScreenMotionArchitecture | 'all'>('all')
const selectedSystem = ref<RecommendedSystem | 'all'>('all')
const selectedPace = ref<GameplayPace | 'all'>('all')
const selectedController = ref<PrimaryController | 'all'>('all')

const fullCatalog = ref<CatalogGame[]>([])
const isCatalogLoading = ref(false)
const catalogError = ref<string | null>(null)
const page = ref(1)
const pageSize = 24
const fileInputRef = ref<HTMLInputElement | null>(null)

// Lazy loader for 8,924 catalog
async function ensureCatalogLoaded(): Promise<void> {
  if (fullCatalog.value.length > 0 || isCatalogLoading.value)
    return

  isCatalogLoading.value = true
  catalogError.value = null
  try {
    const res = await fetch('./arcade/catalog-classified.json')
    if (!res.ok) {
      throw new Error(`Failed to load catalog asset: HTTP ${res.status}`)
    }
    const rawList: any[] = await res.json()
    fullCatalog.value = rawList.map((item) => {
      const answers = item.answers || {}
      return {
        identifier: item.identifier,
        title: item.title,
        year: item.year,
        downloads: item.downloads,
        description: item.description,
        thumbnailUrl: `https://archive.org/services/img/${item.identifier}`,
        classification: {
          recommended_system: answers.recommended_system,
          screen_motion_architecture: answers.screen_motion_architecture,
          gameplay_pace: answers.gameplay_pace,
          primary_genre: answers.primary_genre,
          primary_controller: answers.primary_controller,
          companion_role: answers.companion_role,
        },
      }
    })
  }
  catch (err: any) {
    console.error('[ArcadeHub] Failed to fetch catalog:', err)
    catalogError.value = err.message || 'Could not load full catalog.'
  }
  finally {
    isCatalogLoading.value = false
  }
}

watch(activeTab, (tab) => {
  if (tab === 'all_catalog') {
    void ensureCatalogLoaded()
  }
  page.value = 1
})

watch(searchQuery, (q) => {
  if (q.trim().length >= 2 && fullCatalog.value.length === 0) {
    void ensureCatalogLoaded()
  }
  page.value = 1
})

// --- Acquired Knowledge Conversion ---
const acquiredGames = computed<CatalogGame[]>(() => {
  return knowledgeStore.allProfiles.map((k) => {
    return {
      identifier: k.gameId,
      title: k.gameTitle,
      year: new Date(k.acquiredAt).getFullYear(),
      description: k.strategySummary || 'Learned mental model stored locally.',
      thumbnailUrl: `https://archive.org/services/img/${k.gameId}`,
      hasAcquiredKnowledge: true,
      classification: {
        recommended_system: k.recommendedSystem,
        screen_motion_architecture: k.motionArchitecture,
        gameplay_pace: k.gameplayPace,
        primary_genre: k.primaryGenre,
        primary_controller: k.primaryController,
      },
    }
  })
})

// --- Filtered Game List ---
const baseGamesList = computed<CatalogGame[]>(() => {
  if (activeTab.value === 'acquired')
    return acquiredGames.value
  if (activeTab.value === 'all_catalog' && fullCatalog.value.length > 0)
    return fullCatalog.value
  return HALL_OF_FAME
})

const filteredGames = computed<CatalogGame[]>(() => {
  const query = searchQuery.value.trim().toLowerCase()
  return baseGamesList.value.filter((game) => {
    // 1. Search Query
    if (query) {
      const matchTitle = game.title.toLowerCase().includes(query)
      const matchId = game.identifier.toLowerCase().includes(query)
      const matchDesc = (game.description || '').toLowerCase().includes(query)
      if (!matchTitle && !matchId && !matchDesc)
        return false
    }

    const cls = game.classification || {}

    // 2. Technology Tier Filter
    if (selectedTier.value !== 'all' && cls.screen_motion_architecture !== selectedTier.value) {
      return false
    }

    // 3. Recommended System Filter
    if (selectedSystem.value !== 'all' && cls.recommended_system !== selectedSystem.value) {
      return false
    }

    // 4. Gameplay Pace Filter
    if (selectedPace.value !== 'all' && cls.gameplay_pace !== selectedPace.value) {
      return false
    }

    // 5. Controller Filter
    if (selectedController.value !== 'all' && cls.primary_controller !== selectedController.value) {
      return false
    }

    return true
  })
})

const paginatedGames = computed<CatalogGame[]>(() => {
  return filteredGames.value.slice(0, page.value * pageSize)
})

const hasMore = computed(() => {
  return paginatedGames.value.length < filteredGames.value.length
})

function loadMore() {
  page.value++
}

function handleFileInput(e: Event) {
  const target = e.target as HTMLInputElement
  const file = target.files?.[0]
  if (file) {
    emit('uploadCustomFile', file)
  }
  target.value = ''
}

function formatDownloads(count?: number): string {
  if (!count)
    return ''
  if (count >= 1000000)
    return `${(count / 1000000).toFixed(1)}M`
  if (count >= 1000)
    return `${(count / 1000).toFixed(0)}K`
  return `${count}`
}

function tierLabel(tier?: ScreenMotionArchitecture): { label: string, color: string } {
  switch (tier) {
    case 'fixed_single_screen':
      return { label: 'Fixed Single Screen', color: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/30' }
    case 'flip_screen_rooms':
      return { label: 'Flip Screen Rooms', color: 'bg-sky-500/10 text-sky-600 dark:text-sky-400 border-sky-500/30' }
    case 'smooth_scrolling_camera':
      return { label: 'Smooth Scrolling', color: 'bg-purple-500/10 text-purple-600 dark:text-purple-400 border-purple-500/30' }
    case 'first_person_or_3d':
      return { label: '3D Raycast / FPS', color: 'bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/30' }
    case 'static_ui_or_turn_based':
      return { label: 'Static UI / Board', color: 'bg-neutral-500/10 text-neutral-600 dark:text-neutral-400 border-neutral-500/30' }
    default:
      return { label: 'Preserved Retro', color: 'bg-neutral-500/10 text-neutral-600 dark:text-neutral-400 border-neutral-500/30' }
  }
}

onMounted(() => {
  void knowledgeStore.initialize()
})
</script>

<template>
  <div :class="['h-full w-full flex flex-col overflow-hidden', 'bg-neutral-50 dark:bg-neutral-950']">
    <!-- Hidden input for custom ROM -->
    <input
      ref="fileInputRef"
      type="file"
      accept=".zip,.jsdos"
      class="hidden"
      @change="handleFileInput"
    >

    <!-- 1. TOP HEADER & SEARCH HERO -->
    <div
      :class="[
        'flex flex-col gap-3 border-b border-neutral-200/60 p-5',
        'bg-white/80 dark:border-neutral-800/60 dark:bg-neutral-900/80 backdrop-blur-md',
      ]"
    >
      <div class="flex items-center justify-between">
        <!-- Brand Title & Subtitle -->
        <div class="flex items-center gap-3">
          <div
            :class="[
              'h-10 w-10 flex items-center justify-center rounded-xl',
              'bg-primary-500/10 text-primary-500 ring-1 ring-primary-500/20',
            ]"
          >
            <div class="i-solar:gamepad-bold text-2xl" />
          </div>
          <div>
            <h1 class="text-base text-neutral-900 font-extrabold tracking-tight dark:text-neutral-50">
              AIRI Arcade Room &bull; Guided Gaming Studio
            </h1>
            <p class="text-xs text-neutral-500 dark:text-neutral-400">
              8,900+ Preserved MS-DOS titles with autonomous reflex training and live backseat backplay.
            </p>
          </div>
        </div>

        <!-- Custom Upload & Quick Preset Dropdown -->
        <div class="flex items-center gap-2.5">
          <button
            :class="[
              'flex items-center gap-1.5 border border-neutral-200/80 rounded-xl px-3 py-2 text-xs font-semibold',
              'bg-white dark:border-neutral-700/80 dark:bg-neutral-800 text-neutral-700 dark:text-neutral-200',
              'transition-all duration-150 hover:bg-neutral-100 dark:hover:bg-neutral-700 active:scale-95 shadow-sm',
            ]"
            title="Upload custom MS-DOS .zip or .jsdos game bundle"
            @click="fileInputRef?.click()"
          >
            <div class="i-solar:upload-track-2-bold text-xs text-primary-500" />
            <span>Load Custom .ZIP</span>
          </button>
        </div>
      </div>

      <!-- Search Input & Primary Tabs -->
      <div class="flex flex-wrap items-center justify-between gap-3 pt-1">
        <!-- Tabs -->
        <div
          :class="[
            'flex items-center gap-1 border border-neutral-200/70 rounded-xl p-1',
            'bg-neutral-100/80 dark:border-neutral-800 dark:bg-neutral-800/80',
          ]"
        >
          <button
            :class="[
              'flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-bold transition-all',
              activeTab === 'hall_of_fame'
                ? 'bg-white dark:bg-neutral-900 text-neutral-900 dark:text-white shadow-xs'
                : 'text-neutral-500 hover:text-neutral-900 dark:text-neutral-400 dark:hover:text-white',
            ]"
            @click="activeTab = 'hall_of_fame'"
          >
            <div class="i-solar:cup-star-bold text-xs text-amber-500" />
            <span>Curated Classics</span>
          </button>

          <button
            :class="[
              'flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-bold transition-all',
              activeTab === 'acquired'
                ? 'bg-white dark:bg-neutral-900 text-neutral-900 dark:text-white shadow-xs'
                : 'text-neutral-500 hover:text-neutral-900 dark:text-neutral-400 dark:hover:text-white',
            ]"
            @click="activeTab = 'acquired'"
          >
            <div class="i-solar:brain-bold text-xs text-primary-500" />
            <span>Acquired Knowledge</span>
            <span
              v-if="knowledgeStore.acquiredCount > 0"
              class="rounded-full bg-primary-500 px-1.5 py-0.2 text-[10px] text-white font-mono"
            >
              {{ knowledgeStore.acquiredCount }}
            </span>
          </button>

          <button
            :class="[
              'flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-bold transition-all',
              activeTab === 'all_catalog'
                ? 'bg-white dark:bg-neutral-900 text-neutral-900 dark:text-white shadow-xs'
                : 'text-neutral-500 hover:text-neutral-900 dark:text-neutral-400 dark:hover:text-white',
            ]"
            @click="activeTab = 'all_catalog'"
          >
            <div class="i-solar:layers-minimalistic-bold text-xs text-purple-500" />
            <span>8,000+ Preservation Catalog</span>
          </button>
        </div>

        <!-- Search Bar -->
        <div class="relative max-w-[420px] min-w-[280px] flex-1">
          <div class="pointer-events-none absolute inset-y-0 left-3 flex items-center text-neutral-400">
            <div class="i-solar:magnifer-linear text-sm" />
          </div>
          <input
            v-model="searchQuery"
            type="text"
            placeholder="Search by title, genre, or keyword..."
            :class="[
              'w-full border border-neutral-200/80 rounded-xl py-1.5 pl-9 pr-8 text-xs',
              'bg-white dark:border-neutral-700/80 dark:bg-neutral-900 text-neutral-800 dark:text-neutral-100',
              'outline-none focus:border-primary-500 focus:ring-2 focus:ring-primary-500/20 transition-all shadow-xs',
            ]"
          >
          <button
            v-if="searchQuery"
            class="absolute inset-y-0 right-2.5 flex items-center text-neutral-400 hover:text-neutral-600"
            @click="searchQuery = ''"
          >
            <div class="i-solar:close-circle-bold text-xs" />
          </button>
        </div>
      </div>
    </div>

    <!-- 2. FACETED FILTER CHIPS & DYNAMIC ADVISORY BANNER -->
    <div
      :class="[
        'flex flex-col gap-2.5 border-b border-neutral-200/50 px-5 py-3',
        'bg-neutral-100/50 dark:border-neutral-800/50 dark:bg-neutral-900/40',
      ]"
    >
      <!-- Filter Chips Row -->
      <div class="flex flex-wrap items-center gap-2 text-xs">
        <span class="text-[11px] text-neutral-400 font-bold tracking-wider uppercase">Tiers:</span>

        <!-- Screen Motion Tiers -->
        <button
          v-for="tier in [
            { id: 'all', label: 'All Tiers' },
            { id: 'fixed_single_screen', label: 'Fixed Single Screen' },
            { id: 'flip_screen_rooms', label: 'Flip Screen' },
            { id: 'smooth_scrolling_camera', label: 'Scrolling' },
            { id: 'first_person_or_3d', label: '3D Raycast' },
            { id: 'static_ui_or_turn_based', label: 'Static UI' },
          ]"
          :key="tier.id"
          :class="[
            'border rounded-lg px-2.5 py-1 text-[11px] font-semibold transition-all',
            selectedTier === tier.id
              ? 'border-primary-500/50 bg-primary-500/10 text-primary-600 dark:text-primary-400 shadow-2xs'
              : 'border-neutral-200/70 dark:border-neutral-800 bg-white/80 dark:bg-neutral-800/80 text-neutral-600 dark:text-neutral-400 hover:border-neutral-300',
          ]"
          @click="selectedTier = tier.id as any"
        >
          {{ tier.label }}
        </button>

        <span class="ml-2 text-[11px] text-neutral-400 font-bold tracking-wider uppercase">Engine:</span>

        <!-- System-1 vs System-2 -->
        <button
          v-for="sys in [
            { id: 'all', label: 'All Engines' },
            { id: 'system1_reflex', label: '⚡ S1 Reflex' },
            { id: 'system2_strategy', label: '🧠 S2 Strategy' },
          ]"
          :key="sys.id"
          :class="[
            'border rounded-lg px-2.5 py-1 text-[11px] font-semibold transition-all',
            selectedSystem === sys.id
              ? 'border-purple-500/50 bg-purple-500/10 text-purple-600 dark:text-purple-400 shadow-2xs'
              : 'border-neutral-200/70 dark:border-neutral-800 bg-white/80 dark:bg-neutral-800/80 text-neutral-600 dark:text-neutral-400 hover:border-neutral-300',
          ]"
          @click="selectedSystem = sys.id as any"
        >
          {{ sys.label }}
        </button>

        <!-- Reset Filters button -->
        <button
          v-if="selectedTier !== 'all' || selectedSystem !== 'all' || searchQuery"
          class="ml-auto text-[11px] text-neutral-500 font-semibold underline hover:text-neutral-800 dark:hover:text-neutral-200"
          @click="() => { selectedTier = 'all'; selectedSystem = 'all'; searchQuery = ''; }"
        >
          Clear Filters
        </button>
      </div>

      <!-- Reactive Tip / Warning Advisory Banner -->
      <div
        v-if="selectedTier === 'fixed_single_screen' || selectedSystem === 'system1_reflex'"
        :class="[
          'flex items-center gap-2 border border-emerald-500/30 rounded-xl px-3.5 py-2 text-xs',
          'bg-emerald-500/10 text-emerald-800 dark:text-emerald-300 shadow-2xs',
        ]"
      >
        <div class="i-solar:bolt-bold shrink-0 text-base text-emerald-500" />
        <span>
          <strong>System-1 Reflex Architecture:</strong> Fixed single-screen games achieve &lt;1ms deterministic reaction times using auto-synthesized Mini-Programs and zero-cost local inference ($0/token).
        </span>
      </div>

      <div
        v-else-if="selectedTier === 'first_person_or_3d'"
        :class="[
          'flex items-center gap-2 border border-amber-500/30 rounded-xl px-3.5 py-2 text-xs',
          'bg-amber-500/10 text-amber-800 dark:text-amber-300 shadow-2xs',
        ]"
      >
        <div class="i-solar:danger-triangle-bold shrink-0 text-base text-amber-500" />
        <span>
          <strong>3D Geometry Notice:</strong> First-person raycasting titles require System-2 VLM spatial bounding boxes and HUD attention gates. Average reaction latency: 800ms–1.5s per turn.
        </span>
      </div>

      <div
        v-else-if="activeTab === 'acquired'"
        :class="[
          'flex items-center gap-2 border border-primary-500/30 rounded-xl px-3.5 py-2 text-xs',
          'bg-primary-500/10 text-primary-800 dark:text-primary-300 shadow-2xs',
        ]"
      >
        <div class="i-solar:star-circle-bold shrink-0 text-base text-primary-500" />
        <span>
          <strong>Acquired Knowledge Shelf:</strong> These games have passed the 15-second calibration demonstration. Airi's synthesized mental model and reaction rules are loaded directly into local memory.
        </span>
      </div>
    </div>

    <!-- 3. MAIN GAME GRID VIEWPORT -->
    <div class="flex-1 overflow-y-auto p-5">
      <!-- Loading State -->
      <div
        v-if="isCatalogLoading"
        class="h-64 flex flex-col items-center justify-center gap-2 text-neutral-400"
      >
        <div class="i-solar:restart-bold animate-spin text-3xl text-primary-500" />
        <span class="text-xs font-semibold">Indexing 8,924 Preserved Classics...</span>
      </div>

      <!-- Empty State -->
      <div
        v-else-if="filteredGames.length === 0"
        class="h-64 flex flex-col items-center justify-center gap-2 text-neutral-400"
      >
        <div class="i-solar:box-minimalistic-linear text-4xl text-neutral-400" />
        <span class="text-sm font-semibold">No preserved titles match your filter criteria</span>
        <button
          class="text-xs text-primary-500 underline"
          @click="() => { selectedTier = 'all'; selectedSystem = 'all'; searchQuery = ''; activeTab = 'hall_of_fame'; }"
        >
          Reset to Hall of Fame
        </button>
      </div>

      <!-- Game Cards Grid -->
      <div
        v-else
        class="grid grid-cols-1 gap-4 lg:grid-cols-4 md:grid-cols-3 sm:grid-cols-2 xl:grid-cols-4"
      >
        <div
          v-for="game in paginatedGames"
          :key="game.identifier"
          :class="[
            'group relative flex flex-col overflow-hidden border border-neutral-200/70 rounded-2xl',
            'bg-white dark:border-neutral-800/80 dark:bg-neutral-900 transition-all duration-200',
            'hover:border-primary-500/40 hover:shadow-lg hover:-translate-y-0.5 cursor-pointer',
          ]"
          @click="emit('selectGame', game)"
        >
          <!-- Cover Screenshot / Thumbnail -->
          <div class="relative h-40 w-full overflow-hidden bg-neutral-950">
            <img
              v-if="game.thumbnailUrl"
              :src="game.thumbnailUrl"
              :alt="game.title"
              class="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
              loading="lazy"
              @error="(e: any) => { e.target.style.display = 'none' }"
            >
            <div
              v-else
              class="h-full w-full flex items-center justify-center text-neutral-600"
            >
              <div class="i-solar:gamepad-bold text-4xl" />
            </div>

            <!-- Gradient Shade -->
            <div class="absolute inset-0 from-black/80 via-transparent to-transparent bg-gradient-to-t" />

            <!-- Acquired Badge -->
            <div
              v-if="game.hasAcquiredKnowledge || knowledgeStore.hasKnowledge(game.identifier)"
              :class="[
                'absolute left-2.5 top-2.5 z-10 flex items-center gap-1 rounded-md px-2 py-0.5',
                'bg-emerald-500/90 text-[10px] text-white font-bold backdrop-blur-md shadow-md',
              ]"
            >
              <div class="i-solar:bolt-bold text-[11px]" />
              <span>Learned</span>
            </div>

            <!-- Download Counter Badge -->
            <div
              v-if="game.downloads"
              :class="[
                'absolute right-2.5 top-2.5 z-10 flex items-center gap-1 rounded-md px-2 py-0.5',
                'bg-black/70 text-[10px] text-neutral-300 font-mono backdrop-blur-md',
              ]"
            >
              <div class="i-solar:download-minimalistic-bold text-[11px] text-neutral-400" />
              <span>{{ formatDownloads(game.downloads) }}</span>
            </div>
          </div>

          <!-- Card Content Body -->
          <div class="flex flex-1 flex-col p-3.5">
            <!-- Badges: Tier & System -->
            <div class="mb-2 flex flex-wrap items-center gap-1.5">
              <span
                :class="[
                  'border rounded-md px-2 py-0.5 text-[10px] font-bold',
                  tierLabel(game.classification?.screen_motion_architecture).color,
                ]"
              >
                {{ tierLabel(game.classification?.screen_motion_architecture).label }}
              </span>

              <span
                v-if="game.classification?.recommended_system === 'system1_reflex'"
                class="border border-purple-500/30 rounded-md bg-purple-500/10 px-1.5 py-0.5 text-[10px] text-purple-600 font-bold dark:text-purple-400"
              >
                ⚡ S1
              </span>
              <span
                v-else-if="game.classification?.recommended_system === 'system2_strategy'"
                class="border border-sky-500/30 rounded-md bg-sky-500/10 px-1.5 py-0.5 text-[10px] text-sky-600 font-bold dark:text-sky-400"
              >
                🧠 S2
              </span>
            </div>

            <!-- Title & Year -->
            <div class="mb-1 flex items-baseline justify-between gap-1">
              <h3 class="line-clamp-1 text-xs text-neutral-900 font-bold dark:text-neutral-100 group-hover:text-primary-500">
                {{ game.title }}
              </h3>
              <span v-if="game.year" class="text-[10px] text-neutral-400 font-mono">
                {{ game.year }}
              </span>
            </div>

            <!-- Description -->
            <p class="line-clamp-2 text-[11px] text-neutral-500 leading-relaxed dark:text-neutral-400">
              {{ game.description || 'Preserved classic ready for launch in DOSBox WASM runner.' }}
            </p>

            <!-- Bottom Action Footer -->
            <div class="mt-auto flex items-center justify-between pt-3">
              <span class="text-[10px] text-neutral-400 font-mono">
                {{ game.classification?.gameplay_pace || 'realtime' }}
              </span>

              <button
                :class="[
                  'flex items-center gap-1 border border-primary-500/30 rounded-lg px-2.5 py-1 text-xs font-bold',
                  'bg-primary-500/10 text-primary-600 dark:text-primary-400 group-hover:bg-primary-500 group-hover:text-white',
                  'transition-all duration-150 active:scale-95',
                ]"
                @click.stop="emit('selectGame', game)"
              >
                <span>Select</span>
                <div class="i-solar:arrow-right-linear text-xs" />
              </button>
            </div>
          </div>
        </div>
      </div>

      <!-- Load More Button -->
      <div v-if="hasMore" class="mt-6 flex justify-center pb-4">
        <button
          :class="[
            'border border-neutral-300 dark:border-neutral-700 rounded-xl px-5 py-2 text-xs font-bold',
            'bg-white dark:bg-neutral-800 text-neutral-700 dark:text-neutral-200 shadow-sm',
            'hover:bg-neutral-100 dark:hover:bg-neutral-700 active:scale-95 transition-all',
          ]"
          @click="loadMore"
        >
          Load More Games (Showing {{ paginatedGames.length }} of {{ filteredGames.length }})
        </button>
      </div>
    </div>
  </div>
</template>
