import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { useFactorioStore } from './gaming-factorio'

const mockUpdateFor = vi.fn()

vi.mock('../configurator', () => ({
  useConfiguratorByModsChannelServer: () => ({
    updateFor: mockUpdateFor,
  }),
}))

describe('useFactorioStore', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    mockUpdateFor.mockClear()
    if (typeof localStorage !== 'undefined')
      localStorage.clear()
  })

  it('initializes with defaults', () => {
    const store = useFactorioStore()
    expect(store.enabled).toBe(false)
    expect(store.serverAddress).toBe('')
    expect(store.serverPort).toBe(34197)
    expect(store.username).toBe('')
    expect(store.configured).toBe(false)
  })

  it('saveSettings calls configurator.updateFor', () => {
    const store = useFactorioStore()
    store.saveSettings()
    expect(mockUpdateFor).toHaveBeenCalledWith('factorio', {
      enabled: false,
      serverAddress: '',
      serverPort: 34197,
      username: '',
    })
  })

  it('resetState resets and saves', () => {
    const store = useFactorioStore()
    mockUpdateFor.mockClear()
    store.resetState()
    expect(store.enabled).toBe(false)
    expect(store.serverAddress).toBe('')
    expect(store.serverPort).toBe(34197)
    expect(store.username).toBe('')
    expect(mockUpdateFor).toHaveBeenCalled()
  })
})
