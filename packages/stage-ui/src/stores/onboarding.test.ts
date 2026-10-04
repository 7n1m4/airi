import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'

import { useOnboardingStore } from './onboarding'

vi.mock('vue-i18n', () => ({
  useI18n: () => ({
    t: (key: string) => key,
  }),
}))

describe('useOnboardingStore', () => {
  beforeEach(() => {
    localStorage.clear()
    setActivePinia(createPinia())
  })

  it('initializes with needsOnboarding = true when neither completed nor skipped', () => {
    const store = useOnboardingStore()

    expect(store.hasCompletedSetup).toBe(false)
    expect(store.hasSkippedSetup).toBe(false)
    expect(store.needsOnboarding).toBe(true)
  })

  it('marks setup skipped and transitions needsOnboarding to false', async () => {
    const store = useOnboardingStore()

    store.markSetupSkipped()
    await nextTick()

    expect(store.hasSkippedSetup).toBe(true)
    expect(store.hasCompletedSetup).toBe(false)
    expect(store.needsOnboarding).toBe(false)
    expect(localStorage.getItem('onboarding/skipped')).toBe('true')
  })

  it('marks setup completed and clears skipped state', async () => {
    const store = useOnboardingStore()

    store.markSetupSkipped()
    await nextTick()
    expect(store.hasSkippedSetup).toBe(true)

    store.markSetupCompleted()
    await nextTick()
    expect(store.hasCompletedSetup).toBe(true)
    expect(store.hasSkippedSetup).toBe(false)
    expect(store.needsOnboarding).toBe(false)
    expect(localStorage.getItem('onboarding/completed')).toBe('true')
    expect(localStorage.getItem('onboarding/skipped')).toBe('false')
  })

  it('resets setup state when explicitly requested', async () => {
    const store = useOnboardingStore()

    store.markSetupSkipped()
    await nextTick()
    expect(store.needsOnboarding).toBe(false)

    store.resetSetupState()
    await nextTick()
    expect(store.hasCompletedSetup).toBe(false)
    expect(store.hasSkippedSetup).toBe(false)
    expect(store.needsOnboarding).toBe(true)
  })
})
