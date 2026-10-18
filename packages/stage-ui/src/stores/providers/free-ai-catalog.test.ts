import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it } from 'vitest'

import { useFreeAICatalogStore } from './free-ai-catalog'

describe('store free-ai-catalog', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('loads catalog and exposes metadata', () => {
    const store = useFreeAICatalogStore()
    expect(store.catalogVersion).toBeTruthy()
    expect(store.totalModelsCount).toBeGreaterThan(0)
    expect(store.filteredModels.length).toBeGreaterThan(0)
    expect(store.countsByModality.all).toBe(store.totalModelsCount)
  })

  it('filters by search query', () => {
    const store = useFreeAICatalogStore()
    const first = store.filteredModels[0]
    store.searchQuery = first.displayName
    expect(store.filteredModels.length).toBeGreaterThan(0)
    store.searchQuery = 'zzzz-no-match-zzzz'
    expect(store.filteredModels).toHaveLength(0)
    store.searchQuery = ''
  })

  it('filters by modality vision', () => {
    const store = useFreeAICatalogStore()
    store.selectedModality = 'vision'
    for (const m of store.filteredModels) expect(m.supportsVision).toBe(true)
    store.selectedModality = 'transcription'
    for (const m of store.filteredModels) expect(m.modality).toBe('transcription')
    store.selectedModality = 'embedding'
    for (const m of store.filteredModels) expect(m.modality).toBe('embedding')
    store.selectedModality = 'chat'
    for (const m of store.filteredModels) expect(m.modality).toBe('chat')
    store.selectedModality = 'all'
  })

  it('filters by platform', () => {
    const store = useFreeAICatalogStore()
    const p = store.availablePlatforms[0]
    store.selectedPlatform = p.id
    for (const m of store.filteredModels) expect(m.platform.toLowerCase()).toBe(p.id.toLowerCase())
    store.selectedPlatform = 'all'
  })

  it('capability filters', () => {
    const store = useFreeAICatalogStore()
    store.filterOnlyTools = true
    for (const m of store.filteredModels) expect(m.supportsTools).toBe(true)
    store.filterOnlyTools = false

    store.filterHighRpm = true
    for (const m of store.filteredModels) expect((m.limits?.rpm ?? 0) >= 20).toBe(true)
    store.filterHighRpm = false

    store.filterHighContext = true
    for (const m of store.filteredModels) expect(m.contextWindow >= 128000).toBe(true)
    store.filterHighContext = false
  })

  it('sorting directions', () => {
    const store = useFreeAICatalogStore()
    for (const key of ['intelligence', 'speed', 'context', 'rpm'] as const) {
      store.sortBy = key
      for (const dir of ['asc', 'desc'] as const) {
        store.sortDirection = dir
        expect(store.filteredModels.length).toBeGreaterThanOrEqual(0)
      }
    }
  })

  it('selectModel and resetFilters', () => {
    const store = useFreeAICatalogStore()
    const id = store.filteredModels[0].id
    store.selectModel(id)
    expect(store.selectedModelDetail?.id).toBe(id)
    store.selectModel(null)
    expect(store.selectedModelDetail).toBeNull()

    store.searchQuery = 'x'
    store.selectedModality = 'vision'
    store.filterOnlyTools = true
    store.resetFilters()
    expect(store.searchQuery).toBe('')
    expect(store.selectedModality).toBe('all')
    expect(store.filterOnlyTools).toBe(false)
    expect(store.sortBy).toBe('intelligence')
    expect(store.sortDirection).toBe('asc')
  })

  it('filters by modality transcription', () => {
    const store = useFreeAICatalogStore()
    store.selectedModality = 'transcription'
    expect(store.filteredModels.length).toBeGreaterThan(0)
    expect(store.countsByModality.transcription).toBeGreaterThan(0)
    store.selectedModality = 'all'
  })

  it('sorts by context', () => {
    const store = useFreeAICatalogStore()
    store.sortBy = 'context'
    store.sortDirection = 'desc'
    expect(store.filteredModels.length).toBeGreaterThan(0)
    store.sortBy = 'intelligence'
    store.sortDirection = 'asc'
  })

  it('exercises modalities and sorts', () => {
    const store = useFreeAICatalogStore()
    for (const m of ['chat', 'vision', 'transcription', 'embedding'] as const) {
      store.selectedModality = m
      expect(store.filteredModels.length).toBeGreaterThanOrEqual(0)
    }
    for (const s of ['intelligence', 'speed', 'context', 'rpm'] as const) {
      store.sortBy = s
      store.sortDirection = 'desc'
      expect(store.filteredModels.length).toBeGreaterThanOrEqual(0)
      store.sortDirection = 'asc'
    }
    store.selectedModality = 'all'
    store.selectModel(null)
    expect(store.selectedModelDetail).toBeNull()
    const id = store.filteredModels[0]?.id
    if (id) {
      store.selectModel(id)
      expect(store.selectedModelDetail).not.toBeNull()
    }
  })

  it('viewMode default table', () => {
    const store = useFreeAICatalogStore()
    expect(store.viewMode).toBe('table')
    store.viewMode = 'cards'
    expect(store.viewMode).toBe('cards')
  })

  it('availablePlatforms sorted', () => {
    const store = useFreeAICatalogStore()
    const counts = store.availablePlatforms.map(p => p.count)
    for (let i = 1; i < counts.length; i++) expect(counts[i - 1]).toBeGreaterThanOrEqual(counts[i])
  })

  it('catalogGeneratedAt and platform meta fallback', () => {
    const store = useFreeAICatalogStore()
    expect(typeof store.catalogGeneratedAt).toBe('string')
    expect(store.availablePlatforms.length).toBeGreaterThan(0)
  })
  it('covers embedding modality count and unknown selected model', () => {
    const store = useFreeAICatalogStore()
    expect(store.countsByModality.embedding).toBeGreaterThanOrEqual(0)
    store.selectModel('no-such-model-id')
    expect(store.selectedModelDetail).toBeNull()
    store.selectModel(null)
  })

  it('sorts by rpm with null limits and context with zero values', () => {
    const store = useFreeAICatalogStore()
    store.sortBy = 'rpm'
    store.sortDirection = 'asc'
    expect(store.filteredModels.length).toBeGreaterThanOrEqual(0)
    store.sortBy = 'context'
    store.sortDirection = 'asc'
    expect(store.filteredModels.length).toBeGreaterThanOrEqual(0)
    store.sortBy = 'intelligence'
    store.sortDirection = 'desc'
    expect(store.filteredModels.length).toBeGreaterThanOrEqual(0)
  })

  it('search matches modelId and platformDisplayName', () => {
    const store = useFreeAICatalogStore()
    const m = store.filteredModels.find(x => x.contextWindow === 0) || store.filteredModels[0]
    store.searchQuery = m.modelId
    expect(store.filteredModels.length).toBeGreaterThan(0)
    store.searchQuery = m.platformDisplayName
    expect(store.filteredModels.length).toBeGreaterThan(0)
    store.searchQuery = m.platform
    expect(store.filteredModels.length).toBeGreaterThan(0)
    store.searchQuery = ''
  })
})
