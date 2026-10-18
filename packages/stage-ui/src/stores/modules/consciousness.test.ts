import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { useConsciousnessStore } from './consciousness'

vi.mock('vue-i18n', () => ({ useI18n: () => ({ t: (k: string) => k }) }))

describe('consciousness store', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    if (typeof localStorage !== 'undefined')
      localStorage.clear()
  })

  it('initializes with defaults', () => {
    const store = useConsciousnessStore()
    expect(store.activeProvider).toBe('')
    expect(store.activeModel).toBe('')
    expect(store.configured).toBe(false)
  })

  it('resetState clears selection', () => {
    const store = useConsciousnessStore()
    store.activeProvider = 'openai'
    store.activeModel = 'gpt-4'
    store.modelSearchQuery = 'foo'
    store.resetState()
    expect(store.activeProvider).toBe('')
    expect(store.activeModel).toBe('')
    expect(store.modelSearchQuery).toBe('')
  })

  it('filteredModels returns providerModels when query empty', () => {
    const store = useConsciousnessStore()
    expect(Array.isArray(store.filteredModels)).toBe(true)
  })

  it('getModelsForProvider returns array for unknown provider', async () => {
    const store = useConsciousnessStore()
    const models = await store.getModelsForProvider('unknown')
    expect(Array.isArray(models)).toBe(true)
  })
})
