import { defineStore } from 'pinia'
import { computed, ref } from 'vue'

import baselineCatalog from '../../assets/free-ai-catalog-baseline.json'
import bundledPlatforms from '../../assets/free-ai-platforms.json'

export interface RemoteCatalogQuirk {
  slug: string
  title: string
  body: string
  severity: 'info' | 'warning' | 'blocker'
  targets?: Array<{
    platform: string
    modelGlob?: string | null
  }>
}

export interface RemoteCatalogLimits {
  rpm: number | null
  rpd: number | null
  tpm: number | null
  tpd: number | null
}

export interface RemoteCatalogModel {
  platform: string
  modelId: string
  displayName: string
  intelligenceRank: number
  speedRank: number
  sizeLabel: 'Frontier' | 'Large' | 'Medium' | 'Small'
  limits?: RemoteCatalogLimits | null
  monthlyTokenBudget: string
  contextWindow: number
  enabled: boolean
  supportsVision: boolean
  supportsTools: boolean
  quirks?: RemoteCatalogQuirk[]
}

export interface FreeAIPlatformMeta {
  id: string
  name: string
  baseUrl: string
  signupUrl: string
  keyless?: boolean
  validateUrl?: string | null
  extraHeaders?: Record<string, string> | null
  timeoutMs?: number | null
  note?: string | null
}

export interface FreeAICatalogModel extends RemoteCatalogModel {
  id: string
  modality: 'chat' | 'vision' | 'transcription' | 'embedding'
  allQuirks: RemoteCatalogQuirk[]
  platformDisplayName: string
  platformSignupUrl: string
  platformBaseUrl: string
}

const KNOWN_PLATFORM_META: Record<string, FreeAIPlatformMeta> = bundledPlatforms as unknown as Record<string, FreeAIPlatformMeta>

export { bundledPlatforms }

export const useFreeAICatalogStore = defineStore('free-ai-catalog', () => {
  // Raw parsed baseline catalog
  const rawCatalog = baselineCatalog as unknown as {
    version: string
    generatedAt: string
    tier: string
    models: RemoteCatalogModel[]
    transcriptionModels?: RemoteCatalogModel[]
    embeddings?: RemoteCatalogModel[]
    quirks: RemoteCatalogQuirk[]
  }

  // State
  const searchQuery = ref('')
  const selectedModality = ref<'all' | 'chat' | 'vision' | 'transcription' | 'embedding'>('all')
  const selectedPlatform = ref<string>('all')
  const filterOnlyTools = ref(false)
  const filterHighRpm = ref(false)
  const filterHighContext = ref(false)
  const sortBy = ref<'intelligence' | 'speed' | 'context' | 'rpm'>('intelligence')
  const sortDirection = ref<'asc' | 'desc'>('asc')
  const viewMode = ref<'cards' | 'table'>('table')
  const selectedModelId = ref<string | null>(null)

  // Normalize all models and merge platform-level quirks
  const allModels = computed<FreeAICatalogModel[]>(() => {
    const list: FreeAICatalogModel[] = []
    const rootQuirks = rawCatalog.quirks || []

    function normalizeItem(item: RemoteCatalogModel, modality: 'chat' | 'vision' | 'transcription' | 'embedding'): FreeAICatalogModel {
      const platformKey = item.platform.toLowerCase()
      const meta = KNOWN_PLATFORM_META[platformKey] || {
        name: item.platform.charAt(0).toUpperCase() + item.platform.slice(1),
        signupUrl: `https://${platformKey}.ai`,
        baseUrl: `https://api.${platformKey}.ai/v1`,
      }

      // Collect platform-level quirks targeting this platform
      const matchingRootQuirks = rootQuirks.filter((q) => {
        return q.targets?.some(t => t.platform.toLowerCase() === platformKey)
      })

      // Combine model-specific quirks with platform-level quirks (deduped by slug)
      const mergedQuirksMap = new Map<string, RemoteCatalogQuirk>()
      for (const q of matchingRootQuirks) mergedQuirksMap.set(q.slug, q)
      for (const q of (item.quirks || [])) mergedQuirksMap.set(q.slug, q)

      // Ensure limits is always safely defined
      const limits: RemoteCatalogLimits = {
        rpm: item.limits?.rpm ?? null,
        rpd: item.limits?.rpd ?? null,
        tpm: item.limits?.tpm ?? null,
        tpd: item.limits?.tpd ?? null,
      }

      return {
        ...item,
        id: `${item.platform}:${item.modelId}`,
        modality,
        limits,
        contextWindow: item.contextWindow || 0,
        monthlyTokenBudget: item.monthlyTokenBudget || 'Free Tier',
        allQuirks: Array.from(mergedQuirksMap.values()),
        platformDisplayName: meta.name,
        platformSignupUrl: meta.signupUrl || `https://${platformKey}.ai`,
        platformBaseUrl: meta.baseUrl || `https://api.${platformKey}.ai/v1`,
      }
    }

    for (const m of (rawCatalog.models || [])) {
      list.push(normalizeItem(m, m.supportsVision ? 'vision' : 'chat'))
    }
    for (const m of (rawCatalog.transcriptionModels || [])) {
      list.push(normalizeItem(m, 'transcription'))
    }
    for (const m of (rawCatalog.embeddings || [])) {
      list.push(normalizeItem(m, 'embedding'))
    }

    return list
  })

  // Catalog Metadata
  const catalogVersion = computed(() => rawCatalog.version || 'unknown')
  const catalogGeneratedAt = computed(() => rawCatalog.generatedAt || '')
  const totalModelsCount = computed(() => allModels.value.length)

  // Platform List with counts
  const availablePlatforms = computed(() => {
    const counts: Record<string, { count: number, name: string }> = {}
    for (const model of allModels.value) {
      if (!counts[model.platform]) {
        counts[model.platform] = {
          count: 0,
          name: model.platformDisplayName,
        }
      }
      counts[model.platform].count++
    }

    return Object.entries(counts)
      .map(([id, info]) => ({ id, name: info.name, count: info.count }))
      .sort((a, b) => b.count - a.count)
  })

  // Counts by modality
  const countsByModality = computed(() => {
    let chat = 0
    let vision = 0
    let transcription = 0
    let embedding = 0

    for (const m of allModels.value) {
      if (m.modality === 'chat')
        chat++
      else if (m.modality === 'vision')
        vision++
      else if (m.modality === 'transcription')
        transcription++
      else if (m.modality === 'embedding')
        embedding++
    }

    return {
      all: allModels.value.length,
      chat,
      vision,
      transcription,
      embedding,
    }
  })

  // Filtered & Sorted models
  const filteredModels = computed<FreeAICatalogModel[]>(() => {
    let result = allModels.value

    // Search query (matches model ID, display name, platform)
    if (searchQuery.value.trim()) {
      const q = searchQuery.value.toLowerCase().trim()
      result = result.filter(m =>
        m.displayName.toLowerCase().includes(q)
        || m.modelId.toLowerCase().includes(q)
        || m.platform.toLowerCase().includes(q)
        || m.platformDisplayName.toLowerCase().includes(q),
      )
    }

    // Modality filter
    if (selectedModality.value !== 'all') {
      if (selectedModality.value === 'vision') {
        result = result.filter(m => m.supportsVision)
      }
      else {
        result = result.filter(m => m.modality === selectedModality.value)
      }
    }

    // Platform filter
    if (selectedPlatform.value !== 'all') {
      result = result.filter(m => m.platform.toLowerCase() === selectedPlatform.value.toLowerCase())
    }

    // Capability filters
    if (filterOnlyTools.value) {
      result = result.filter(m => m.supportsTools)
    }
    if (filterHighRpm.value) {
      result = result.filter(m => (m.limits?.rpm ?? 0) >= 20)
    }
    if (filterHighContext.value) {
      result = result.filter(m => m.contextWindow >= 128_000)
    }

    // Sorting
    return [...result].sort((a, b) => {
      let comparison = 0
      if (sortBy.value === 'intelligence') {
        // Lower intelligenceRank means higher rank (1 = best)
        comparison = (a.intelligenceRank || 999) - (b.intelligenceRank || 999)
      }
      else if (sortBy.value === 'speed') {
        // Higher speedRank means faster (11 = fastest)
        comparison = (b.speedRank || 0) - (a.speedRank || 0)
      }
      else if (sortBy.value === 'context') {
        comparison = (b.contextWindow || 0) - (a.contextWindow || 0)
      }
      else if (sortBy.value === 'rpm') {
        comparison = (b.limits?.rpm || 0) - (a.limits?.rpm || 0)
      }

      return sortDirection.value === 'asc' ? comparison : -comparison
    })
  })

  // Selected model detail for drawer
  const selectedModelDetail = computed<FreeAICatalogModel | null>(() => {
    if (!selectedModelId.value)
      return null
    return allModels.value.find(m => m.id === selectedModelId.value) || null
  })

  function selectModel(id: string | null) {
    selectedModelId.value = id
  }

  function resetFilters() {
    searchQuery.value = ''
    selectedModality.value = 'all'
    selectedPlatform.value = 'all'
    filterOnlyTools.value = false
    filterHighRpm.value = false
    filterHighContext.value = false
    sortBy.value = 'intelligence'
    sortDirection.value = 'asc'
  }

  return {
    // State
    searchQuery,
    selectedModality,
    selectedPlatform,
    filterOnlyTools,
    filterHighRpm,
    filterHighContext,
    sortBy,
    sortDirection,
    viewMode,
    selectedModelId,

    // Computed
    catalogVersion,
    catalogGeneratedAt,
    totalModelsCount,
    availablePlatforms,
    countsByModality,
    filteredModels,
    selectedModelDetail,

    // Actions
    selectModel,
    resetFilters,
  }
})
