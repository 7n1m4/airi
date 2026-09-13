<script setup lang="ts">
import localforage from 'localforage'

import { DialogContent, DialogOverlay, DialogPortal, DialogRoot, DialogTitle } from 'reka-ui'
import { computed, onMounted, ref, watch } from 'vue'

export interface CatalogGame {
  identifier: string
  title: string
  year?: number | string
  downloads?: number
  description?: string
  thumbnailUrl?: string
  bundleUrl?: string
  isCached?: boolean
}

const props = defineProps<{
  open: boolean
}>()

const emit = defineEmits<{
  (e: 'close'): void
  (e: 'launch', game: CatalogGame): void
}>()

const arcadeStore = localforage.createInstance({
  name: 'airi-arcade-cache',
  storeName: 'games',
})

// Curated Hall of Fame
const HALL_OF_FAME: CatalogGame[] = [
  {
    identifier: 'msdos_Doom_1993',
    title: 'Doom (1993)',
    year: 1993,
    downloads: 1250000,
    description: 'The legendary first-person shooter that revolutionized 3D gaming.',
    thumbnailUrl: 'https://archive.org/services/img/msdos_Doom_1993',
    bundleUrl: 'https://v8.js-dos.com/bundles/doom.jsdos',
  },
  {
    identifier: 'msdos_Prince_of_Persia_1990',
    title: 'Prince of Persia',
    year: 1990,
    downloads: 2164260,
    description: 'Classic cinematic platformer with fluid rotoscoped animation.',
    thumbnailUrl: 'https://archive.org/services/img/msdos_Prince_of_Persia_1990',
  },
  {
    identifier: 'msdos_Oregon_Trail_The_1990',
    title: 'The Oregon Trail',
    year: 1990,
    downloads: 13973100,
    description: 'Guide your wagon party across 19th-century America.',
    thumbnailUrl: 'https://archive.org/services/img/msdos_Oregon_Trail_The_1990',
  },
  {
    identifier: 'msdos_Wolfenstein_3D_1992',
    title: 'Wolfenstein 3D',
    year: 1992,
    downloads: 1409250,
    description: 'Escape Castle Wolfenstein in id Software\'s seminal run-and-gun classic.',
    thumbnailUrl: 'https://archive.org/services/img/msdos_Wolfenstein_3D_1992',
  },
  {
    identifier: 'CIVILIZATION_201902',
    title: 'Civilization',
    year: 1991,
    downloads: 870000,
    description: 'Build an empire to stand the test of time from the Stone Age to the Space Age.',
    thumbnailUrl: 'https://archive.org/services/img/CIVILIZATION_201902',
  },
  {
    identifier: 'msdos_SimCity_1989',
    title: 'SimCity',
    year: 1989,
    downloads: 1060240,
    description: 'Design, build, and manage a living, growing urban metropolis.',
    thumbnailUrl: 'https://archive.org/services/img/msdos_SimCity_1989',
  },
  {
    identifier: 'msdos_Secret_of_Monkey_Island_The_1990',
    title: 'The Secret of Monkey Island',
    year: 1990,
    downloads: 720000,
    description: 'LucasArts point-and-click pirate adventure masterpiece.',
    thumbnailUrl: 'https://archive.org/services/img/msdos_Secret_of_Monkey_Island_The_1990',
  },
  {
    identifier: 'msdos_Pac-Man_1983',
    title: 'Pac-Man',
    year: 1983,
    downloads: 1289420,
    description: 'The arcade legend ported to IBM PC MS-DOS.',
    thumbnailUrl: 'https://archive.org/services/img/msdos_Pac-Man_1983',
  },
  {
    identifier: 'digger_1983',
    title: 'Digger',
    year: 1983,
    downloads: 500000,
    description: 'Windmill Software arcade classic with iconic Popcorn audio.',
    thumbnailUrl: 'https://archive.org/services/img/msdos_Digger_1983',
    bundleUrl: 'https://v8.js-dos.com/bundles/digger.jsdos',
  },
]

const searchQuery = ref('')
const isSearching = ref(false)
const searchResults = ref<CatalogGame[]>([])
const activeTag = ref<'all' | 'hall_of_fame' | 'cached'>('all')
const loadingIdentifier = ref<string | null>(null)
const cachedIdentifiers = ref<Set<string>>(new Set())

async function refreshCachedKeys() {
  try {
    const keys = await arcadeStore.keys()
    cachedIdentifiers.value = new Set(keys)
  }
  catch (err) {
    console.warn('[ArcadeCatalogModal] Failed to query cached games:', err)
  }
}

// Debounce timer
let searchTimeout: ReturnType<typeof setTimeout> | null = null

async function performSearch(query: string) {
  if (!query.trim()) {
    searchResults.value = []
    isSearching.value = false
    return
  }

  isSearching.value = true
  try {
    const sanitized = encodeURIComponent(query.trim())
    const url = `https://archive.org/advancedsearch.php?q=collection:(softwarelibrary_msdos_games)+AND+mediatype:(software)+AND+(${sanitized})&fl[]=identifier,title,downloads,year,description&sort[]=downloads+desc&rows=24&page=1&output=json`
    const res = await fetch(url)
    if (!res.ok)
      throw new Error(`Search failed: HTTP ${res.status}`)

    const data = await res.json()
    const docs = data?.response?.docs || []

    searchResults.value = docs.map((doc: any) => ({
      identifier: doc.identifier,
      title: doc.title || doc.identifier,
      year: doc.year,
      downloads: doc.downloads || 0,
      description: doc.description ? `${doc.description.replace(/<[^>]*>/g, '').slice(0, 140)}...` : undefined,
      thumbnailUrl: `https://archive.org/services/img/${doc.identifier}`,
    }))
  }
  catch (err) {
    console.error('[ArcadeCatalogModal] Search error:', err)
    searchResults.value = []
  }
  finally {
    isSearching.value = false
  }
}

function handleQueryChange() {
  if (searchTimeout)
    clearTimeout(searchTimeout)

  if (!searchQuery.value.trim()) {
    searchResults.value = []
    isSearching.value = false
    return
  }

  isSearching.value = true
  searchTimeout = setTimeout(() => {
    void performSearch(searchQuery.value)
  }, 400)
}

function selectPill(gameTitle: string) {
  searchQuery.value = gameTitle
  void performSearch(gameTitle)
}

const displayGames = computed<CatalogGame[]>(() => {
  if (searchQuery.value.trim()) {
    return searchResults.value
  }
  if (activeTag.value === 'cached') {
    return HALL_OF_FAME.filter(g => cachedIdentifiers.value.has(g.identifier))
  }
  return HALL_OF_FAME
})

function formatDownloads(count?: number) {
  if (!count)
    return '0'
  if (count >= 1000000)
    return `${(count / 1000000).toFixed(1)}M`
  if (count >= 1000)
    return `${(count / 1000).toFixed(0)}k`
  return `${count}`
}

function handleLaunch(game: CatalogGame) {
  loadingIdentifier.value = game.identifier
  emit('launch', {
    ...game,
    isCached: cachedIdentifiers.value.has(game.identifier),
  })
}

watch(() => props.open, (open) => {
  if (open) {
    loadingIdentifier.value = null
    void refreshCachedKeys()
  }
})

onMounted(() => {
  void refreshCachedKeys()
})
</script>

<template>
  <DialogRoot :open="props.open" @update:open="val => { if (!val) emit('close') }">
    <DialogPortal>
      <DialogOverlay class="fixed inset-0 z-[9998] bg-black/60 backdrop-blur-sm transition-opacity" />
      <DialogContent
        :class="[
          'fixed inset-0 m-auto z-[9999]',
          'h-[85dvh] max-w-4xl w-[94dvw]',
          'flex flex-col overflow-hidden',
          'border border-neutral-200/50 rounded-3xl bg-white/95 p-0 shadow-2xl outline-none backdrop-blur-2xl',
          'dark:border-neutral-800/50 dark:bg-neutral-900/95',
        ]"
      >
        <!-- Modal Header -->
        <div class="flex items-center justify-between border-b border-neutral-200/40 px-6 py-4 dark:border-neutral-800/40">
          <div class="flex items-center gap-3">
            <div class="h-10 w-10 flex items-center justify-center rounded-2xl bg-primary-500/10 text-primary-500 shadow-sm">
              <div class="i-solar:gamepad-bold-duotone text-2xl" />
            </div>
            <div>
              <DialogTitle class="text-base text-neutral-900 font-bold tracking-tight dark:text-neutral-100">
                Retro Arcade Catalog
              </DialogTitle>
              <p class="text-xs text-neutral-500 font-medium">
                Stream &amp; launch from 8,900+ classic MS-DOS preservation titles
              </p>
            </div>
          </div>

          <button
            class="rounded-xl p-2 text-neutral-400 transition-colors hover:bg-neutral-100 hover:text-neutral-700 dark:hover:bg-neutral-800 dark:hover:text-neutral-200"
            title="Close"
            @click="emit('close')"
          >
            <div class="i-solar:close-circle-bold text-xl" />
          </button>
        </div>

        <!-- Search Bar & Quick Filters -->
        <div class="border-b border-neutral-200/30 bg-neutral-50/50 p-4 dark:border-neutral-800/30 dark:bg-neutral-950/20">
          <!-- Search Input -->
          <div class="relative flex items-center">
            <div class="i-solar:magnifer-linear absolute left-3.5 text-base text-neutral-400" />
            <input
              v-model="searchQuery"
              type="text"
              placeholder="Search 8,000+ games (e.g. Wolfenstein, Civilization, SimCity, Monkey Island)..."
              class="w-full border border-neutral-200/60 rounded-xl bg-white py-2.5 pl-10 pr-10 text-xs text-neutral-800 shadow-sm outline-none transition-all dark:border-neutral-700/60 focus:border-primary-500 dark:bg-neutral-900 dark:text-neutral-100 placeholder:text-neutral-400 focus:ring-2 focus:ring-primary-500/20"
              @input="handleQueryChange"
            >
            <button
              v-if="searchQuery"
              class="absolute right-3 text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-200"
              @click="searchQuery = ''; performSearch('')"
            >
              <div class="i-solar:close-circle-bold text-base" />
            </button>
          </div>

          <!-- Quick-Pick Hall of Fame Pills -->
          <div class="mt-3 flex items-center gap-1.5 overflow-x-auto pb-1 text-xs">
            <span class="mr-1 text-[10px] text-neutral-400 font-bold tracking-wider uppercase">Classics:</span>
            <button
              v-for="hof in HALL_OF_FAME.slice(0, 7)"
              :key="hof.identifier"
              class="shadow-xs whitespace-nowrap border border-neutral-200/60 rounded-lg bg-white/80 px-2.5 py-1 text-[11px] text-neutral-600 font-medium transition-colors dark:border-neutral-800/60 hover:border-primary-400 dark:bg-neutral-800/70 hover:bg-primary-50 dark:text-neutral-300 hover:text-primary-600 dark:hover:bg-primary-950/40 dark:hover:text-primary-300"
              @click="selectPill(hof.title)"
            >
              {{ hof.title }}
            </button>
          </div>
        </div>

        <!-- Games Grid Feed -->
        <div class="flex-1 overflow-y-auto p-5">
          <!-- Loading State -->
          <div v-if="isSearching" class="flex flex-col items-center justify-center py-16 text-neutral-400">
            <div class="i-solar:restart-bold mb-2 animate-spin text-3xl text-primary-500" />
            <span class="text-xs font-medium">Searching Internet Archive preservation catalog...</span>
          </div>

          <!-- Empty State -->
          <div v-else-if="displayGames.length === 0" class="flex flex-col items-center justify-center py-16 text-neutral-400">
            <div class="i-solar:ghost-bold mb-2 text-4xl text-neutral-300 dark:text-neutral-700" />
            <span class="text-xs text-neutral-600 font-semibold dark:text-neutral-400">No games found for "{{ searchQuery }}"</span>
            <p class="mt-1 text-[11px] text-neutral-400">
              Try searching for broader keywords like "Doom", "SimCity", or "Racer"
            </p>
          </div>

          <!-- Cards Grid -->
          <div v-else class="grid grid-cols-1 gap-3.5 lg:grid-cols-3 sm:grid-cols-2">
            <div
              v-for="game in displayGames"
              :key="game.identifier"
              class="group shadow-xs relative flex flex-col overflow-hidden border border-neutral-200/70 rounded-2xl bg-white transition-all dark:border-neutral-800 hover:border-primary-500/50 dark:bg-neutral-800/80 hover:shadow-md dark:hover:border-primary-500/50"
            >
              <!-- Card Top Header / Thumbnail -->
              <div class="relative h-32 w-full overflow-hidden bg-neutral-100 dark:bg-neutral-950">
                <img
                  :src="game.thumbnailUrl"
                  :alt="game.title"
                  loading="lazy"
                  class="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105"
                  @error="(e: any) => { e.target.style.display = 'none' }"
                >
                <!-- Fallback Icon if image missing -->
                <div class="absolute inset-0 flex items-center justify-center text-neutral-300 -z-1 dark:text-neutral-700">
                  <div class="i-solar:gamepad-bold text-4xl" />
                </div>

                <!-- Cached Badge -->
                <div
                  v-if="cachedIdentifiers.has(game.identifier)"
                  class="backdrop-blur-xs absolute left-2.5 top-2.5 flex items-center gap-1 rounded-full bg-emerald-500/90 px-2 py-0.5 text-[9px] text-white font-bold shadow-sm"
                >
                  <span class="h-1.5 w-1.5 rounded-full bg-white" />
                  <span>Saved Offline</span>
                </div>

                <!-- Year Badge -->
                <div
                  v-if="game.year"
                  class="backdrop-blur-xs absolute right-2.5 top-2.5 rounded bg-black/60 px-1.5 py-0.5 text-[9px] text-white font-bold font-mono"
                >
                  {{ game.year }}
                </div>
              </div>

              <!-- Card Content -->
              <div class="flex flex-1 flex-col p-3.5">
                <div class="flex items-start justify-between gap-2">
                  <h4 class="line-clamp-1 text-xs text-neutral-900 font-bold dark:text-neutral-100" :title="game.title">
                    {{ game.title }}
                  </h4>
                </div>

                <p v-if="game.description" class="line-clamp-2 mt-1 flex-1 text-[11px] text-neutral-600 leading-relaxed dark:text-neutral-400">
                  {{ game.description }}
                </p>
                <div v-else class="flex-1" />

                <!-- Bottom Action Row -->
                <div class="mt-3 flex items-center justify-between border-t border-neutral-100 pt-2.5 dark:border-neutral-700/60">
                  <!-- Plays Count -->
                  <div class="flex items-center gap-1 text-[10px] text-neutral-400">
                    <div class="i-solar:fire-bold text-amber-500" />
                    <span>{{ formatDownloads(game.downloads) }} plays</span>
                  </div>

                  <!-- Launch Button -->
                  <button
                    :disabled="loadingIdentifier === game.identifier"
                    class="shadow-xs flex items-center gap-1.5 rounded-xl bg-primary-500 px-3 py-1.5 text-[11px] text-white font-bold transition-all active:scale-95 disabled:cursor-not-allowed hover:bg-primary-600 disabled:opacity-50"
                    @click="handleLaunch(game)"
                  >
                    <div
                      v-if="loadingIdentifier === game.identifier"
                      class="i-solar:restart-bold animate-spin text-xs"
                    />
                    <div
                      v-else
                      class="i-solar:play-bold text-xs"
                    />
                    <span>{{ loadingIdentifier === game.identifier ? 'Loading...' : 'Launch' }}</span>
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>

        <!-- Modal Footer -->
        <div class="flex items-center justify-between border-t border-neutral-200/40 bg-neutral-50/50 px-6 py-3 text-[11px] text-neutral-400 dark:border-neutral-800/40 dark:bg-neutral-950/20">
          <div class="flex items-center gap-2">
            <span class="inline-block h-2 w-2 rounded-full bg-emerald-500" />
            <span>Open Internet Archive MS-DOS Library &bull; Cached titles run offline</span>
          </div>
          <button
            class="text-neutral-500 font-semibold hover:text-neutral-800 dark:hover:text-neutral-200"
            @click="emit('close')"
          >
            Close
          </button>
        </div>
      </DialogContent>
    </DialogPortal>
  </DialogRoot>
</template>
