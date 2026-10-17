<script setup lang="ts">
import { useElectronEventaInvoke } from '@proj-airi/electron-vueuse'
import { useBackgroundStore } from '@proj-airi/stage-ui/stores'
import { useAnimaDexWizardStore } from '@proj-airi/stage-ui/stores/animadex-wizard'
import { useDisplayModelsStore } from '@proj-airi/stage-ui/stores/display-models'
import { useAiriCardStore } from '@proj-airi/stage-ui/stores/modules/airi-card'
import { storeToRefs } from 'pinia'
import { computed, onMounted, ref } from 'vue'

import { electronOpenSettings } from '../../../shared/eventa'

const airiCardStore = useAiriCardStore()
const backgroundStore = useBackgroundStore()
const displayModelsStore = useDisplayModelsStore()
const wizardStore = useAnimaDexWizardStore()
const openSettings = useElectronEventaInvoke(electronOpenSettings)

onMounted(async () => {
  if (wizardStore.characters.length === 0) {
    await wizardStore.loadCatalog()
  }
})

const { activeCard, activeCardId } = storeToRefs(airiCardStore)

function handleConfigureStudio() {
  if (!activeCardId.value)
    return
  void openSettings({
    route: `/settings/airi-card?cardId=${activeCardId.value}&tab=studio`,
  }).catch((err: any) => {
    console.error('Failed to open Studio settings:', err)
  })
}

// Expanded states for collapsible blocks
const expandedActors = ref<Record<string, boolean>>({})
const expandedPlaces = ref<Record<string, boolean>>({})

function toggleActor(key: string) {
  expandedActors.value[key] = !expandedActors.value[key]
}

function togglePlace(key: string) {
  expandedPlaces.value[key] = !expandedPlaces.value[key]
}

// Active concepts parsed from card extensions
const activeConceptsList = computed<string[]>(() => {
  return activeCard.value?.extensions?.airi?.active_concepts || []
})

// Get preview image URL for a given model ID
function getModelPreviewUrl(modelId?: string) {
  if (!modelId)
    return ''
  const model = displayModelsStore.displayModels.find(m => m.id === modelId)
  return model?.previewImage || ''
}

// Parsed prose helper from card description/systemPrompt
const parsedProseMap = computed(() => {
  const map: Record<string, { type: 'appearance' | 'setting', name: string, content: string }> = {}
  const desc = activeCard.value?.description || ''
  const promptText = activeCard.value?.systemPrompt || ''

  const combinedText = `${desc}\n\n${promptText}`

  // 1. Matches actor appearances: ### <|ACTOR:key|> Appearance or ### actorKey Appearance
  const actorRegex = /###\s+(?:<\|ACTOR:(\w+)\|>\s+Appearance|(\w+)\s+Appearance)\n([\s\S]*?)(?=\n###|$)/g
  let match
  while ((match = actorRegex.exec(combinedText)) !== null) {
    const actorKey = match[1] || match[2]
    const content = match[3].trim()
    if (actorKey && content) {
      map[`actor_${actorKey}`] = { type: 'appearance', name: actorKey, content }
    }
  }

  // 2. Matches place settings: ### Setting: name
  // NOTICE: the captured name starts with a non-space run so the preceding `\s+` cannot
  // be split across group 1 while backtracking (regexp/no-super-linear-backtracking).
  const placeRegex = /###\s+Setting:\s+(\S[^\n]*)\n([\s\S]*?)(?=\n###|$)/g
  let placeMatch
  while ((placeMatch = placeRegex.exec(combinedText)) !== null) {
    const rawName = placeMatch[1].trim()
    const content = placeMatch[2].trim()
    // Make a normalized slug that matches place_ prefix format
    const slug = rawName.toLowerCase().replace(/[^a-z0-9]/g, '_').replace(/_+/g, '_').replace(/^_+|_+$/g, '')
    map[`place_${slug}`] = { type: 'setting', name: rawName, content }
  }

  return map
})

// Parse visual assets and modules into characters list
const characters = computed(() => {
  if (!activeCard.value)
    return []

  const assets = (activeCard.value.extensions?.airi?.visual_assets || {}) as Record<string, any>
  const cardModules = (activeCard.value.extensions?.airi?.modules || {}) as Record<string, any>

  const list: Array<{
    key: string
    name: string
    description: string
    prompt: string
    isActive: boolean
    voiceProvider?: string
    voiceId?: string
    modelId?: string
    avatarUrl?: string
    longProse?: string
    actingInstructions?: string
    isFallback?: boolean
  }> = []

  // Check all asset keys from visual_assets ground truth
  const keys = Object.keys(assets)

  // Gen 1 detection: no actor_/actress_ prefixed keys AND no concept with a bound modelId
  // Gen 2 (hand-rolled multi): may have no actor_ prefix but DOES have modelId bindings on concepts
  // Gen 3 (deterministic multi): uses actor_/actress_ prefixes from the guided wizard
  const hasActorPrefixes = keys.some(k => k.startsWith('actor_') || k.startsWith('actress_'))
  const hasAnyModelBinding = keys.some((k) => {
    const asset = assets[k] || {}
    const mod = cardModules[k] || {}
    return (mod.manifestation?.modelId || asset.manifestation?.modelId)
  })
  const isGen1SingleCharacterCard = !hasActorPrefixes && !hasAnyModelBinding

  for (const key of keys) {
    const isActor = key.startsWith('actor_') || key.startsWith('actress_') || key === 'concept_user'
    const asset = assets[key] || {}
    const mod = cardModules[key] || {}

    // Check voice & model bindings
    const speech = mod.speech || asset.speech
    const manifestation = mod.manifestation || asset.manifestation
    const hasBindings = speech || manifestation?.modelId

    if (isActor || hasBindings) {
      // Normalize name
      let displayName = key
      if (key === 'concept_user') {
        displayName = 'User Entity'
      }
      else {
        displayName = key.replace(/^(actor_|actress_)/, '').replace(/_/g, ' ')
      }

      // Acting instructions regex extraction
      let actingInstructions = ''
      const systemPrompt = activeCard.value.systemPrompt || ''
      const actingKey = key.replace(/^(actor_|actress_)/, '')
      const actingRegex = new RegExp(`###\\s+${actingKey}\\n[\\s\\S]*?\\n([\\s\\S]*?)(?=\\n###|\\n##|$)`)
      const actMatch = systemPrompt.match(actingRegex)
      if (actMatch && actMatch[1]) {
        actingInstructions = actMatch[1].trim()
      }

      const boundModelId = manifestation?.modelId
      let avatarUrl = getModelPreviewUrl(boundModelId)
      if (!avatarUrl) {
        const rawPrompt = mod.prompt || asset.prompt || ''
        const match = wizardStore.findCatalogCharacter(rawPrompt)
        const canonicalTrigger = match ? match.trigger : rawPrompt.split(',')[0]?.trim()
        avatarUrl = wizardStore.getCharacterThumbUrl(canonicalTrigger) || ''
      }

      list.push({
        key,
        name: displayName.charAt(0).toUpperCase() + displayName.slice(1),
        description: mod.description || asset.description || 'Character entity description not set.',
        prompt: mod.prompt || asset.prompt || '',
        isActive: activeConceptsList.value.includes(key),
        voiceProvider: speech?.provider,
        voiceId: speech?.voice_id,
        modelId: boundModelId,
        avatarUrl,
        longProse: parsedProseMap.value[key]?.content,
        actingInstructions,
      })
    }
  }

  // Gen 1 Single Character Card fallback: coalesce using the card's root identity
  // Only inject when there are truly no actor-type concepts and no model bindings anywhere
  if (isGen1SingleCharacterCard) {
    const displayName = (activeCard.value as any).nickname || activeCard.value.name || 'Main Character'
    const mainModelId = cardModules.displayModelId
    const speech = cardModules.speech
    let avatarUrl = getModelPreviewUrl(mainModelId)
    if (!avatarUrl) {
      const rawPrompt = activeCard.value.systemPrompt || ''
      const match = wizardStore.findCatalogCharacter(rawPrompt)
      const canonicalTrigger = match ? match.trigger : rawPrompt.split(',')[0]?.trim()
      avatarUrl = wizardStore.getCharacterThumbUrl(canonicalTrigger) || ''
    }

    list.push({
      key: 'actor_primary',
      name: displayName.charAt(0).toUpperCase() + displayName.slice(1),
      description: activeCard.value.description || 'Main character identity.',
      prompt: '',
      isActive: true,
      voiceProvider: speech?.provider,
      voiceId: speech?.voice_id,
      modelId: mainModelId,
      avatarUrl,
      longProse: activeCard.value.description || '',
      actingInstructions: activeCard.value.systemPrompt || '',
      isFallback: true,
    })
  }

  return list
})

// Parse visual assets and modules into places list
const places = computed(() => {
  if (!activeCard.value)
    return []

  const assets = (activeCard.value.extensions?.airi?.visual_assets || {}) as Record<string, any>
  const cardModules = (activeCard.value.extensions?.airi?.modules || {}) as Record<string, any>

  const list: Array<{
    key: string
    name: string
    description: string
    prompt: string
    isActive: boolean
    longProse?: string
    thumbnailUrl?: string
  }> = []

  const keys = Object.keys(assets)

  for (const key of keys) {
    if (key.startsWith('place_')) {
      const asset = assets[key] || {}
      const mod = cardModules[key] || {}

      // Normalize setting display name
      const cleanName = key.replace(/^place_/, '').replace(/_/g, ' ')
      const displayName = cleanName.charAt(0).toUpperCase() + cleanName.slice(1)

      // Match background image in cache if generated
      let thumbnailUrl = ''
      const promptTrigger = (mod.prompt || asset.prompt || '').trim().toLowerCase()
      if (promptTrigger) {
        const matched = backgroundStore.journalEntries.find((entry) => {
          const entryTitle = (entry.title || '').trim().toLowerCase()
          return entryTitle && (promptTrigger.includes(entryTitle) || entryTitle.includes(promptTrigger))
        })
        if (matched) {
          thumbnailUrl = backgroundStore.getBackgroundUrl(matched.id) || ''
        }
      }

      list.push({
        key,
        name: displayName,
        description: mod.description || asset.description || 'Setting details not configured.',
        prompt: mod.prompt || asset.prompt || '',
        isActive: activeConceptsList.value.includes(key),
        longProse: parsedProseMap.value[key]?.content,
        thumbnailUrl,
      })
    }
  }

  return list
})

// Other active/inactive concepts
const otherConcepts = computed(() => {
  if (!activeCard.value)
    return []

  const assets = (activeCard.value.extensions?.airi?.visual_assets || {}) as Record<string, any>
  const cardModules = (activeCard.value.extensions?.airi?.modules || {}) as Record<string, any>

  const list: Array<{
    key: string
    description: string
    prompt: string
    isActive: boolean
  }> = []

  const keys = Object.keys(assets)

  for (const key of keys) {
    const isActor = key.startsWith('actor_') || key.startsWith('actress_') || key === 'concept_user'
    const isPlace = key.startsWith('place_')

    // Bindings check
    const asset = assets[key] || {}
    const mod = cardModules[key] || {}
    const speech = mod.speech || asset.speech
    const manifestation = mod.manifestation || asset.manifestation
    const hasBindings = speech || manifestation?.modelId

    if (!isActor && !isPlace && !hasBindings) {
      list.push({
        key,
        description: mod.description || asset.description || '',
        prompt: mod.prompt || asset.prompt || '',
        isActive: activeConceptsList.value.includes(key),
      })
    }
  }

  return list
})
</script>

<template>
  <div class="h-full w-full flex flex-col gap-6 overflow-y-auto bg-white p-6 font-urbanist dark:bg-neutral-900/10">
    <div v-if="activeCardId" class="flex flex-col gap-6">
      <!-- Section Header -->
      <div class="flex items-start justify-between border-b border-neutral-100 pb-4 dark:border-neutral-800/40">
        <div class="flex flex-col gap-0.5">
          <h3 class="text-sm text-neutral-800 font-bold dark:text-neutral-200">
            Studio Monitor
          </h3>
          <p class="mt-0.5 text-[10px] text-neutral-500">
            At-a-glance creator diagnostics of current concept states, outfit definitions, and actor alignments.
          </p>
        </div>
        <button
          class="flex shrink-0 items-center gap-1.5 border border-neutral-200/60 rounded-lg bg-neutral-50 px-2.5 py-1.5 text-[10px] text-neutral-600 font-bold transition-all dark:border-neutral-800 hover:border-primary-300/60 dark:bg-neutral-900 hover:bg-primary-50 dark:text-neutral-400 hover:text-primary-600 dark:hover:border-primary-700/40 dark:hover:bg-primary-950/20 dark:hover:text-primary-400"
          @click="handleConfigureStudio"
        >
          <div class="i-solar:clapperboard-play-bold-duotone text-xs" />
          Configure
        </button>
      </div>

      <!-- Cast Roster Billboard Centerpiece -->
      <div class="flex flex-col gap-2">
        <h4 class="text-[10px] text-neutral-400 font-bold tracking-wider uppercase">
          Cast Roster
        </h4>
        <div class="grid grid-cols-2 gap-3 border-b border-neutral-100 pb-6 lg:grid-cols-6 md:grid-cols-4 sm:grid-cols-3 dark:border-neutral-800/40">
          <div
            v-for="char in characters"
            :key="char.key"
            class="group relative h-64 w-full flex flex-col justify-end overflow-hidden border rounded-2xl p-3 shadow-sm transition-all duration-300"
            :class="char.isActive
              ? 'border-primary-500 ring-2 ring-primary-500/10 scale-100'
              : 'border-neutral-200 dark:border-neutral-850 opacity-60 scale-95 hover:opacity-85 hover:scale-98'"
          >
            <!-- Background Image -->
            <div class="absolute inset-0 bg-neutral-100 dark:bg-neutral-900">
              <img
                v-if="char.avatarUrl"
                :src="char.avatarUrl"
                class="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105"
              >
              <div v-else class="bg-neutral-150 text-neutral-455 h-full w-full flex items-center justify-center dark:bg-neutral-950 dark:text-neutral-700">
                <div class="i-solar:user-bold text-4xl" />
              </div>
            </div>

            <!-- Dark Vignette for Text Contrast -->
            <div class="absolute inset-0 from-black/90 via-black/30 to-transparent bg-gradient-to-t" />

            <!-- Active Glow Indicator -->
            <div
              v-if="char.isActive"
              class="absolute right-3 top-3 h-2 w-2 animate-pulse rounded-full bg-primary-500 ring-4 ring-primary-500/30"
            />

            <!-- Character Name overlay -->
            <div class="relative z-10 text-center">
              <span class="line-clamp-1 w-full truncate text-[10px] text-white font-bold tracking-tight drop-shadow-md">
                {{ char.name }}
              </span>
            </div>
          </div>
        </div>
      </div>

      <!-- Active Concept Stack -->
      <div class="dark:border-neutral-850 border border-neutral-200/60 rounded-2xl bg-neutral-50/50 p-4 dark:bg-neutral-950/20">
        <h4 class="mb-2 text-[10px] text-neutral-400 font-bold tracking-wider uppercase">
          Active Concept Stack
        </h4>
        <div class="flex flex-wrap gap-2">
          <span
            v-for="concept in activeConceptsList"
            :key="concept"
            class="border border-primary-100/35 rounded-lg bg-primary-50 px-2.5 py-1 text-[10px] text-primary-500 font-bold dark:bg-primary-950/30 dark:text-primary-400"
          >
            {{ concept }}
          </span>
          <span v-if="activeConceptsList.length === 0" class="text-[10px] text-neutral-400 italic">No concepts currently active in stack</span>
        </div>
      </div>

      <!-- A. Characters (Actors & Wardrobes) -->
      <div>
        <h4 class="mb-3 text-[10px] text-neutral-400 font-bold tracking-wider uppercase">
          Characters & Wardrobes
        </h4>
        <div class="space-y-4">
          <div
            v-for="char in characters"
            :key="char.key"
            class="overflow-hidden border border-neutral-200/60 rounded-2xl bg-white shadow-sm dark:border-neutral-800 dark:bg-neutral-950/10"
          >
            <!-- Header/Card Title -->
            <div class="flex items-center justify-between border-b border-neutral-100/60 bg-neutral-50/30 p-4 dark:border-neutral-900 dark:bg-neutral-950/5">
              <div class="min-w-0 flex items-center gap-2.5">
                <!-- Avatar Thumbnail -->
                <img
                  v-if="char.avatarUrl"
                  :src="char.avatarUrl"
                  class="h-6 w-6 border border-neutral-200 rounded-full bg-neutral-100 object-cover dark:border-neutral-800 dark:bg-neutral-900"
                >
                <div v-else class="h-6 w-6 flex items-center justify-center rounded-full bg-primary-500/10 text-primary-500">
                  <div class="i-solar:user-bold-duotone text-xs" />
                </div>
                <span class="truncate text-xs text-neutral-800 font-bold dark:text-neutral-200">{{ char.name }}</span>
                <span class="truncate text-[9px] text-neutral-400 font-mono opacity-85">&lt;{{ char.key }}&gt;</span>
              </div>
              <div class="flex shrink-0 items-center gap-1.5">
                <!-- Status Badge -->
                <span
                  class="rounded-full px-2 py-0.5 text-[8px] font-bold tracking-wider uppercase"
                  :class="char.isActive
                    ? 'bg-primary-50 text-primary-500 dark:bg-primary-950/30 dark:text-primary-400'
                    : 'bg-neutral-100 text-neutral-400 dark:bg-neutral-900 dark:text-neutral-500'"
                >
                  {{ char.isActive ? 'Active' : 'Standby' }}
                </span>
              </div>
            </div>

            <!-- Content Area -->
            <div class="flex flex-col gap-3 p-4">
              <!-- Director's View -->
              <div class="flex flex-col gap-1.5">
                <span class="text-[9px] text-neutral-400 font-bold tracking-wider uppercase">Director Context (Metadata)</span>
                <div class="border border-neutral-100/50 rounded-xl bg-neutral-50/50 p-3 text-[11px] text-neutral-700 leading-normal space-y-2 dark:border-neutral-900/60 dark:bg-neutral-950/20 dark:text-neutral-300">
                  <div>
                    <span class="block text-[9px] text-neutral-400 font-semibold tracking-wide uppercase">Orchestration Description</span>
                    <p>{{ char.description }}</p>
                  </div>
                  <div v-if="char.prompt">
                    <span class="block text-[9px] text-neutral-400 font-semibold tracking-wide uppercase">Image Gen Prompt</span>
                    <p class="select-all text-[10px] leading-normal font-mono">
                      {{ char.prompt }}
                    </p>
                  </div>
                </div>
              </div>

              <!-- Collapsible Actor's Prose (Long Prose & System prompt Instructions) -->
              <div v-if="char.longProse || char.actingInstructions" class="border-t border-neutral-100/60 pt-3 dark:border-neutral-900">
                <button
                  class="flex select-none items-center gap-1.5 text-[10px] text-primary-500 font-bold transition-all hover:text-primary-600"
                  @click="toggleActor(char.key)"
                >
                  <div
                    class="text-xs transition-transform duration-200"
                    :class="expandedActors[char.key] ? 'i-solar:alt-arrow-down-linear rotate-180' : 'i-solar:alt-arrow-down-linear'"
                  />
                  <span>{{ expandedActors[char.key] ? 'Hide Actor Perspective' : 'View Actor Perspective (Long Prose)' }}</span>
                </button>

                <div v-if="expandedActors[char.key]" class="mt-2 border border-amber-500/10 rounded-xl bg-amber-500/5 p-3 text-[11px] text-neutral-600 space-y-3 dark:text-neutral-400">
                  <div v-if="char.longProse">
                    <span class="block text-[9px] text-amber-600 font-bold tracking-wider uppercase">Appearance Details (Long Prose)</span>
                    <p class="mt-0.5 whitespace-pre-wrap leading-relaxed">
                      {{ char.longProse }}
                    </p>
                  </div>
                  <div v-if="char.actingInstructions">
                    <span class="block text-[9px] text-amber-600 font-bold tracking-wider uppercase">Personality & Acting Instructions</span>
                    <p class="mt-0.5 whitespace-pre-wrap leading-relaxed">
                      {{ char.actingInstructions }}
                    </p>
                  </div>
                </div>
              </div>

              <!-- Voice & Model Bindings -->
              <div class="flex flex-wrap gap-x-6 gap-y-2 border-t border-neutral-100/60 pt-3 text-[10px] dark:border-neutral-900">
                <div class="flex items-center gap-1.5">
                  <div class="i-solar:music-library-bold-duotone text-xs text-neutral-400" />
                  <span class="text-neutral-400">TTS Voice:</span>
                  <span class="text-neutral-700 font-bold dark:text-neutral-300">
                    {{ char.voiceProvider ? `${char.voiceProvider} (${char.voiceId})` : 'System Default' }}
                  </span>
                </div>
                <div class="flex items-center gap-1.5">
                  <div class="i-solar:users-group-two-rounded-bold-duotone text-xs text-neutral-400" />
                  <span class="text-neutral-400">Model:</span>
                  <span class="text-neutral-700 font-bold dark:text-neutral-300">
                    {{ char.modelId || 'None bound' }}
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- B. Settings & Places -->
      <div v-if="places.length > 0">
        <h4 class="mb-3 text-[10px] text-neutral-400 font-bold tracking-wider uppercase">
          Settings & Places
        </h4>
        <div class="space-y-4">
          <div
            v-for="place in places"
            :key="place.key"
            class="flex flex-col overflow-hidden border border-neutral-200/60 rounded-2xl bg-white shadow-sm md:flex-row dark:border-neutral-800 dark:bg-neutral-950/10"
          >
            <!-- Left Thumbnail Column -->
            <div class="relative aspect-video shrink-0 overflow-hidden border-r border-neutral-100/50 bg-neutral-100 md:aspect-auto md:w-32 dark:border-neutral-900/60 dark:bg-neutral-900">
              <img
                v-if="place.thumbnailUrl"
                :src="place.thumbnailUrl"
                class="h-full w-full object-cover"
              >
              <div v-else class="h-full w-full flex flex-col items-center justify-center p-3 text-neutral-400 dark:text-neutral-600">
                <div class="i-solar:gallery-wide-linear mb-1 text-xl" />
                <span class="text-[7px] text-neutral-400 font-bold tracking-wider uppercase opacity-60">No Scene Image</span>
              </div>
            </div>

            <!-- Right Details Area -->
            <div class="min-w-0 flex flex-1 flex-col gap-3 p-4">
              <div class="flex items-center justify-between gap-3">
                <div class="min-w-0 flex items-center gap-2 truncate">
                  <span class="truncate text-xs text-neutral-800 font-bold dark:text-neutral-200">{{ place.name }}</span>
                  <span class="truncate text-[9px] text-neutral-400 font-mono opacity-85">&lt;{{ place.key }}&gt;</span>
                </div>
                <span
                  class="shrink-0 rounded-full px-2 py-0.5 text-[8px] font-bold tracking-wider uppercase"
                  :class="place.isActive
                    ? 'bg-primary-50 text-primary-500 dark:bg-primary-950/30 dark:text-primary-400'
                    : 'bg-neutral-100 text-neutral-400 dark:bg-neutral-900 dark:text-neutral-500'"
                >
                  {{ place.isActive ? 'Active' : 'Standby' }}
                </span>
              </div>

              <!-- Director's View -->
              <div class="flex flex-col gap-1.5">
                <span class="text-[9px] text-neutral-400 font-bold tracking-wider uppercase">Director Context (Metadata)</span>
                <div class="border border-neutral-100/50 rounded-xl bg-neutral-50/50 p-3 text-[11px] text-neutral-700 leading-normal space-y-2 dark:border-neutral-900/60 dark:bg-neutral-950/20 dark:text-neutral-300">
                  <div>
                    <span class="block text-[9px] text-neutral-400 font-semibold tracking-wide uppercase">Orchestration Description</span>
                    <p>{{ place.description }}</p>
                  </div>
                  <div v-if="place.prompt">
                    <span class="block text-[9px] text-neutral-400 font-semibold tracking-wide uppercase">Image Gen Prompt</span>
                    <p class="select-all text-[10px] leading-normal font-mono">
                      {{ place.prompt }}
                    </p>
                  </div>
                </div>
              </div>

              <!-- Collapsible Surroundings Prose -->
              <div v-if="place.longProse" class="border-t border-neutral-100/60 pt-3 dark:border-neutral-900">
                <button
                  class="flex select-none items-center gap-1.5 text-[10px] text-primary-500 font-bold transition-all hover:text-primary-600"
                  @click="togglePlace(place.key)"
                >
                  <div
                    class="text-xs transition-transform duration-200"
                    :class="expandedPlaces[place.key] ? 'i-solar:alt-arrow-down-linear rotate-180' : 'i-solar:alt-arrow-down-linear'"
                  />
                  <span>{{ expandedPlaces[place.key] ? 'Hide Surroundings Lore' : 'View Surroundings Lore (Long Prose)' }}</span>
                </button>

                <div v-if="expandedPlaces[place.key]" class="mt-2 border border-amber-500/10 rounded-xl bg-amber-500/5 p-3 text-[11px] text-neutral-600 dark:text-neutral-400">
                  <span class="mb-1 block text-[9px] text-amber-600 font-bold tracking-wider uppercase">Actor Surroundings Details</span>
                  <p class="whitespace-pre-wrap leading-relaxed">
                    {{ place.longProse }}
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- C. Other Concepts -->
      <div v-if="otherConcepts.length > 0">
        <h4 class="mb-3 text-[10px] text-neutral-400 font-bold tracking-wider uppercase">
          Other Concepts
        </h4>
        <div class="space-y-3">
          <div
            v-for="concept in otherConcepts"
            :key="concept.key"
            class="flex flex-col gap-2 border border-neutral-200/60 rounded-xl bg-white p-3 dark:border-neutral-800 dark:bg-neutral-950/10"
          >
            <div class="flex items-center justify-between">
              <span class="text-[11px] text-neutral-800 font-bold dark:text-neutral-200">{{ concept.key }}</span>
              <span
                class="rounded-full px-2 py-0.5 text-[8px] font-bold tracking-wider uppercase"
                :class="concept.isActive
                  ? 'bg-primary-50 text-primary-500'
                  : 'bg-neutral-100 text-neutral-400'"
              >
                {{ concept.isActive ? 'Active' : 'Standby' }}
              </span>
            </div>
            <p v-if="concept.description" class="text-[11px] text-neutral-600 dark:text-neutral-400">
              {{ concept.description }}
            </p>
            <p v-if="concept.prompt" class="select-all text-[10px] text-neutral-500 leading-normal font-mono dark:text-neutral-400">
              {{ concept.prompt }}
            </p>
          </div>
        </div>
      </div>
    </div>
    <div v-else class="h-full w-full flex flex-col items-center justify-center p-8 text-neutral-500 dark:text-neutral-400">
      <div class="i-solar:layers-minimalistic-bold-duotone mb-4 text-5xl text-primary-500" />
      <h3 class="text-lg font-bold">
        Studio Monitor
      </h3>
      <p class="mt-1 text-sm opacity-70">
        Select a character session to inspect card configurations.
      </p>
    </div>
  </div>
</template>

<style scoped>
.font-urbanist {
  font-family: 'Urbanist', sans-serif;
  -webkit-font-smoothing: antialiased;
}
</style>
