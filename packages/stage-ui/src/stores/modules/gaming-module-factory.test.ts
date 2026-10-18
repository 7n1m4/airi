import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { createGamingModuleStore } from './gaming-module-factory'

const mockUpdateFor = vi.fn()

vi.mock('../configurator', () => ({
  useConfiguratorByModsChannelServer: () => ({
    updateFor: mockUpdateFor,
  }),
}))

describe('createGamingModuleStore', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    mockUpdateFor.mockClear()
    if (typeof localStorage !== 'undefined')
      localStorage.clear()
  })

  it('creates a store with defaults', () => {
    const useStore = createGamingModuleStore('testmod', 1234)
    const store = useStore()
    expect(store.enabled).toBe(false)
    expect(store.serverAddress).toBe('')
    expect(store.serverPort).toBe(1234)
    expect(store.username).toBe('')
    expect(store.configured).toBe(false)
  })

  it('configured becomes true when all fields set', () => {
    const useStore = createGamingModuleStore('testmod2', 1234)
    const store = useStore()
    store.serverAddress = 'localhost'
    store.username = 'user'
    store.serverPort = 9999
    expect(store.configured).toBe(true)
  })

  it('configured false when port null', () => {
    const useStore = createGamingModuleStore('testmod3', 1234)
    const store = useStore()
    store.serverAddress = 'localhost'
    store.username = 'user'
    store.serverPort = null
    expect(store.configured).toBe(false)
  })

  it('configured false when address empty', () => {
    const useStore = createGamingModuleStore('testmod4', 1234)
    const store = useStore()
    store.serverAddress = '   '
    store.username = 'user'
    store.serverPort = 9999
    expect(store.configured).toBe(false)
  })

  it('saveSettings calls configurator.updateFor with moduleName', () => {
    const useStore = createGamingModuleStore('testmod5', 1234)
    const store = useStore()
    store.enabled = true
    store.serverAddress = 'host'
    store.serverPort = 5555
    store.username = 'name'
    store.saveSettings()
    expect(mockUpdateFor).toHaveBeenCalledWith('testmod5', {
      enabled: true,
      serverAddress: 'host',
      serverPort: 5555,
      username: 'name',
    })
  })

  it('resetState resets and saves', () => {
    const useStore = createGamingModuleStore('testmod6', 1234)
    const store = useStore()
    store.enabled = true
    store.serverAddress = 'host'
    store.serverPort = 5555
    store.username = 'name'
    mockUpdateFor.mockClear()
    store.resetState()
    expect(store.enabled).toBe(false)
    expect(store.serverAddress).toBe('')
    expect(store.serverPort).toBe(1234)
    expect(store.username).toBe('')
    expect(mockUpdateFor).toHaveBeenCalled()
  })
})
