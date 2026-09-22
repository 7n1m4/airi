import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { nextTick, ref } from 'vue'

import { useHearingStore } from './hearing'

vi.mock('../providers', () => ({
  useProvidersStore: () => ({
    allAudioTranscriptionProvidersMetadata: ref([]),
    providerMetadata: {},
    isLoadingModels: {},
    modelLoadError: {},
    getProviderMetadata: vi.fn(),
    getModelsForProvider: vi.fn().mockResolvedValue([]),
    fetchModelsForProvider: vi.fn().mockResolvedValue(undefined),
    getTranscriptionFeatures: vi.fn().mockReturnValue({}),
  }),
}))

vi.mock('../onboarding', () => ({
  useOnboardingStore: () => ({
    needsOnboarding: false,
  }),
}))

describe('useHearingStore', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    localStorage.clear()
  })

  it('initializes vadThreshold with default 0.6 and persists changes', async () => {
    const store = useHearingStore()
    expect(store.vadThreshold).toBe(0.6)

    store.vadThreshold = 0.35
    await nextTick()

    expect(store.vadThreshold).toBe(0.35)
    expect(localStorage.getItem('settings/hearing/vad-threshold')).toBe('0.35')
  })

  it('resets vadThreshold on resetState', async () => {
    const store = useHearingStore()
    store.vadThreshold = 0.4
    await nextTick()
    expect(store.vadThreshold).toBe(0.4)

    store.resetState()
    await nextTick()
    expect(store.vadThreshold).toBe(0.6)
  })

  it('initializes hearingDetectionMode with default vad and persists changes', async () => {
    const store = useHearingStore()
    expect(store.hearingDetectionMode).toBe('vad')

    store.hearingDetectionMode = 'manual'
    await nextTick()

    expect(store.hearingDetectionMode).toBe('manual')
    expect(localStorage.getItem('settings/hearing/detection-mode')).toBe('manual')
  })

  it('resets hearingDetectionMode on resetState', async () => {
    const store = useHearingStore()
    store.hearingDetectionMode = 'manual'
    await nextTick()

    store.resetState()
    await nextTick()
    expect(store.hearingDetectionMode).toBe('vad')
  })
})
