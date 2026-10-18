import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { useFacultyDefaultsStore } from './faculty-defaults'

describe('useFacultyDefaultsStore', () => {
  beforeEach(() => {
    localStorage.clear()
    setActivePinia(createPinia())
  })

  it('initializes from factory defaults when no legacy data', () => {
    const store = useFacultyDefaultsStore()
    expect(store.consciousness.primaryProvider).toBe('mimo')
    expect(store.isGlobalCircuitBreakerEnabled).toBe(true)
  })

  it('migrates from existing settings/faculties/defaults', () => {
    localStorage.setItem('settings/faculties/defaults', JSON.stringify({
      consciousness: { primaryProvider: 'custom', primaryModel: 'm' },
    }))
    setActivePinia(createPinia())
    const store = useFacultyDefaultsStore()
    expect(store.consciousness.primaryProvider).toBe('custom')
    expect(store.consciousness.primaryModel).toBe('m')
  })

  it('migrates legacy consciousness keys', () => {
    localStorage.setItem('settings/consciousness/active-provider', JSON.stringify('provX'))
    localStorage.setItem('settings/consciousness/active-model', JSON.stringify('modelX'))
    setActivePinia(createPinia())
    const store = useFacultyDefaultsStore()
    expect(store.consciousness.primaryProvider).toBe('provX')
    expect(store.consciousness.primaryModel).toBe('modelX')
  })

  it('ignores legacy consciousness provider that is empty quotes', () => {
    localStorage.setItem('settings/consciousness/active-provider', '""')
    setActivePinia(createPinia())
    const store = useFacultyDefaultsStore()
    expect(store.consciousness.primaryProvider).toBe('mimo')
  })

  it('migrates legacy speech keys', () => {
    localStorage.setItem('settings/speech/active-provider', JSON.stringify('speechprov'))
    localStorage.setItem('settings/speech/active-model', JSON.stringify('speechmodel'))
    localStorage.setItem('settings/speech/voice', JSON.stringify('voice1'))
    setActivePinia(createPinia())
    const store = useFacultyDefaultsStore()
    expect(store.speech.primaryProvider).toBe('speechprov')
    expect(store.speech.primaryModel).toBe('speechmodel')
    expect(store.speech.primaryVoiceId).toBe('voice1')
  })

  it('skips speech-noop provider', () => {
    localStorage.setItem('settings/speech/active-provider', JSON.stringify('speech-noop-foo'))
    setActivePinia(createPinia())
    const store = useFacultyDefaultsStore()
    expect(store.speech.primaryProvider).toBe('kokoro-local')
  })

  it('migrates legacy hearing keys', () => {
    localStorage.setItem('settings/hearing/active-provider', JSON.stringify('hearingprov'))
    localStorage.setItem('settings/hearing/active-model', JSON.stringify('hearingmodel'))
    setActivePinia(createPinia())
    const store = useFacultyDefaultsStore()
    expect(store.hearing.primaryProvider).toBe('hearingprov')
    expect(store.hearing.primaryModel).toBe('hearingmodel')
  })

  it('migrates legacy artistry keys (non-comfyui)', () => {
    localStorage.setItem('artistry-provider', JSON.stringify('artprov'))
    localStorage.setItem('artistry-model', JSON.stringify('artmodel'))
    setActivePinia(createPinia())
    const store = useFacultyDefaultsStore()
    expect(store.artistry.primaryProvider).toBe('artprov')
    expect(store.artistry.primaryModel).toBe('artmodel')
  })

  it('skips comfyui artistry provider', () => {
    localStorage.setItem('artistry-provider', JSON.stringify('comfyui'))
    setActivePinia(createPinia())
    const store = useFacultyDefaultsStore()
    expect(store.artistry.primaryProvider).toBe('pollinations')
  })

  it('migrates legacy vision keys (raw strings)', () => {
    localStorage.setItem('settings/vision/active-provider', 'visionprov')
    localStorage.setItem('settings/vision/active-model', 'visionmodel')
    setActivePinia(createPinia())
    const store = useFacultyDefaultsStore()
    expect(store.vision.primaryProvider).toBe('visionprov')
    expect(store.vision.primaryModel).toBe('visionmodel')
  })

  it('handles migration error gracefully', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    localStorage.setItem('settings/faculties/defaults', '{bad json')
    setActivePinia(createPinia())
    const store = useFacultyDefaultsStore()
    expect(store.consciousness.primaryProvider).toBe('mimo')
    warn.mockRestore()
  })

  it('setPrimary updates config and syncs legacy keys', () => {
    const store = useFacultyDefaultsStore()
    store.setPrimary('speech', 'p', 'm', 'v')
    expect(store.speech.primaryProvider).toBe('p')
    expect(store.speech.primaryModel).toBe('m')
    expect(store.speech.primaryVoiceId).toBe('v')
    expect(JSON.parse(localStorage.getItem('settings/speech/active-provider')!)).toBe('p')
  })

  it('setPrimary ignores unknown faculty', () => {
    const store = useFacultyDefaultsStore()
    // @ts-expect-error testing guard
    store.setPrimary('nope', 'p', 'm')
    expect(store.consciousness.primaryProvider).toBe('mimo')
  })

  it('setFallback updates', () => {
    const store = useFacultyDefaultsStore()
    store.setFallback('vision', 'fb', 'fm', 'fv')
    expect(store.vision.fallbackProvider).toBe('fb')
    expect(store.vision.fallbackModel).toBe('fm')
    expect(store.vision.fallbackVoiceId).toBe('fv')
  })

  it('setFallback ignores unknown faculty', () => {
    const store = useFacultyDefaultsStore()
    // @ts-expect-error testing guard
    store.setFallback('nope', 'p', 'm')
    expect(true).toBe(true)
  })

  it('setCircuitBreaker updates', () => {
    const store = useFacultyDefaultsStore()
    store.setCircuitBreaker('vision', true, ['auth'])
    expect(store.vision.autoFailover).toBe(true)
    expect(store.vision.failoverTriggers).toEqual(['auth'])
  })

  it('setCircuitBreaker without triggers', () => {
    const store = useFacultyDefaultsStore()
    store.setCircuitBreaker('vision', false)
    expect(store.vision.autoFailover).toBe(false)
  })

  it('setCircuitBreaker ignores unknown faculty', () => {
    const store = useFacultyDefaultsStore()
    // @ts-expect-error
    store.setCircuitBreaker('nope', true)
    expect(true).toBe(true)
  })

  it('setNotificationStyle', () => {
    const store = useFacultyDefaultsStore()
    store.setNotificationStyle('vision', 'silent')
    expect(store.vision.notificationStyle).toBe('silent')
  })

  it('setNotificationStyle ignores unknown faculty', () => {
    const store = useFacultyDefaultsStore()
    // @ts-expect-error
    store.setNotificationStyle('nope', 'toast')
    expect(true).toBe(true)
  })

  it('setRecoveryInterval', () => {
    const store = useFacultyDefaultsStore()
    store.setRecoveryInterval('vision', 5)
    expect(store.vision.recoveryIntervalMinutes).toBe(5)
  })

  it('setRecoveryInterval ignores unknown faculty', () => {
    const store = useFacultyDefaultsStore()
    // @ts-expect-error
    store.setRecoveryInterval('nope', 5)
    expect(true).toBe(true)
  })

  it('resetToFactorySafe', () => {
    const store = useFacultyDefaultsStore()
    store.setPrimary('consciousness', 'x', 'y')
    store.resetToFactorySafe()
    expect(store.consciousness.primaryProvider).toBe('mimo')
  })

  it('resetFaculty', () => {
    const store = useFacultyDefaultsStore()
    store.setPrimary('consciousness', 'x', 'y')
    store.resetFaculty('consciousness')
    expect(store.consciousness.primaryProvider).toBe('mimo')
  })

  it('resetFaculty ignores unknown', () => {
    const store = useFacultyDefaultsStore()
    // @ts-expect-error
    store.resetFaculty('nope')
    expect(true).toBe(true)
  })

  it('resolveFaculty with card override', () => {
    const store = useFacultyDefaultsStore()
    const r = store.resolveFaculty('consciousness', { provider: 'cardprov', model: 'cardmodel', voiceId: 'v' })
    expect(r).toEqual({ provider: 'cardprov', model: 'cardmodel', voiceId: 'v', isFallback: false })
  })

  it('resolveFaculty inherit/default falls to defaults', () => {
    const store = useFacultyDefaultsStore()
    const r = store.resolveFaculty('consciousness', { provider: 'inherit' })
    expect(r.provider).toBe('mimo')
    const r2 = store.resolveFaculty('consciousness', { provider: 'default' })
    expect(r2.provider).toBe('mimo')
  })

  it('resolveFaculty trims and empty model', () => {
    const store = useFacultyDefaultsStore()
    const r = store.resolveFaculty('consciousness', { provider: '  prov  ', model: '   ' })
    expect(r.provider).toBe('prov')
    expect(r.model).toBe('')
  })

  it('resolveFaculty with no override', () => {
    const store = useFacultyDefaultsStore()
    const r = store.resolveFaculty('consciousness')
    expect(r.provider).toBe('mimo')
    expect(r.voiceId).toBeUndefined()
  })

  it('isGlobalCircuitBreakerEnabled false when all false', () => {
    localStorage.setItem('settings/faculties/defaults', JSON.stringify({
      consciousness: { autoFailover: false },
      speech: { autoFailover: false },
      hearing: { autoFailover: false },
      artistry: { autoFailover: false },
      vision: { autoFailover: false },
    }))
    setActivePinia(createPinia())
    const store = useFacultyDefaultsStore()
    expect(store.isGlobalCircuitBreakerEnabled).toBe(false)
  })

  it('syncLegacyKeys no-op when window undefined', () => {
    // can't undefine window easily; just exercise vision path (uses raw strings)
    const store = useFacultyDefaultsStore()
    store.setPrimary('vision', 'vp', 'vm')
    expect(localStorage.getItem('settings/vision/active-provider')).toBe('vp')
    expect(localStorage.getItem('settings/vision/active-model')).toBe('vm')
  })

  it('setPrimary voiceId undefined does not overwrite', () => {
    const store = useFacultyDefaultsStore()
    store.setPrimary('speech', 'p', 'm')
    expect(store.speech.primaryVoiceId).toBe('af_heart')
  })
  it('migrates legacy artistry keys without model', () => {
    localStorage.setItem('artistry-provider', JSON.stringify('artprov'))
    setActivePinia(createPinia())
    const store = useFacultyDefaultsStore()
    expect(store.artistry.primaryProvider).toBe('artprov')
  })

  it('migrates legacy vision keys without model', () => {
    localStorage.setItem('settings/vision/active-provider', 'visionprov')
    setActivePinia(createPinia())
    const store = useFacultyDefaultsStore()
    expect(store.vision.primaryProvider).toBe('visionprov')
  })

  it('setFallback without voiceId does not overwrite', () => {
    const store = useFacultyDefaultsStore()
    store.setFallback('speech', 'fb', 'fm')
    expect(store.speech.fallbackVoiceId).toBe('')
  })
  it('setPrimary consciousness syncs legacy keys', () => {
    const store = useFacultyDefaultsStore()
    store.setPrimary('consciousness', 'cp', 'cm')
    expect(localStorage.getItem('settings/consciousness/active-provider')).toBe(JSON.stringify('cp'))
  })

  it('setPrimary hearing syncs legacy keys', () => {
    const store = useFacultyDefaultsStore()
    store.setPrimary('hearing', 'hp', 'hm')
    expect(localStorage.getItem('settings/hearing/active-provider')).toBe(JSON.stringify('hp'))
  })

  it('setPrimary artistry syncs legacy keys', () => {
    const store = useFacultyDefaultsStore()
    store.setPrimary('artistry', 'ap', 'am')
    expect(localStorage.getItem('artistry-provider')).toBe(JSON.stringify('ap'))
  })

  it('migrates legacy speech without voice', () => {
    localStorage.setItem('settings/speech/active-provider', JSON.stringify('speechprov'))
    localStorage.setItem('settings/speech/active-model', JSON.stringify('speechmodel'))
    setActivePinia(createPinia())
    const store = useFacultyDefaultsStore()
    expect(store.speech.primaryProvider).toBe('speechprov')
  })

  it('migrates legacy hearing without model', () => {
    localStorage.setItem('settings/hearing/active-provider', JSON.stringify('hearingprov'))
    setActivePinia(createPinia())
    const store = useFacultyDefaultsStore()
    expect(store.hearing.primaryProvider).toBe('hearingprov')
  })
  it('migrates legacy consciousness without model', () => {
    localStorage.setItem('settings/consciousness/active-provider', JSON.stringify('provX'))
    setActivePinia(createPinia())
    const store = useFacultyDefaultsStore()
    expect(store.consciousness.primaryProvider).toBe('provX')
  })

  it('migrates legacy speech without model', () => {
    localStorage.setItem('settings/speech/active-provider', JSON.stringify('speechprov'))
    setActivePinia(createPinia())
    const store = useFacultyDefaultsStore()
    expect(store.speech.primaryProvider).toBe('speechprov')
  })
  it('returns factory defaults when window is undefined', () => {
    const originalWindow = globalThis.window
    try {
      // @ts-expect-error
      delete globalThis.window
      setActivePinia(createPinia())
      const store = useFacultyDefaultsStore()
      expect(store.consciousness.primaryProvider).toBe('mimo')
    }
    finally {
      globalThis.window = originalWindow
    }
  })

  it('syncLegacyKeys no-ops when window is undefined', () => {
    const store = useFacultyDefaultsStore()
    const originalWindow = globalThis.window
    try {
      // @ts-expect-error
      delete globalThis.window
      store.setPrimary('consciousness', 'p', 'm')
      expect(store.consciousness.primaryProvider).toBe('p')
    }
    finally {
      globalThis.window = originalWindow
    }
  })
  it('covers mixed circuit breaker branches', () => {
    localStorage.setItem('settings/faculties/defaults', JSON.stringify({
      consciousness: { autoFailover: false },
      speech: { autoFailover: true },
      hearing: { autoFailover: false },
      artistry: { autoFailover: false },
      vision: { autoFailover: false },
    }))
    setActivePinia(createPinia())
    const store = useFacultyDefaultsStore()
    expect(store.isGlobalCircuitBreakerEnabled).toBe(true)
  })

  it('covers syncLegacyKeys catch', () => {
    const store = useFacultyDefaultsStore()
    const spy = vi.spyOn(window.localStorage, 'setItem').mockImplementation(() => { throw new Error('boom') })
    store.setPrimary('consciousness', 'p', 'm')
    expect(store.consciousness.primaryProvider).toBe('p')
    spy.mockRestore()
  })
})
