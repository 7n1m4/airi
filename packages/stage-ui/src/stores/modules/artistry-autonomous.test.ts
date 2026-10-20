import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { useAutonomousArtistryStore } from './artistry-autonomous'

vi.mock('vue-i18n', () => ({
  useI18n: () => ({ t: (k: string) => k }),
}))

describe('artistry-autonomous store', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    if (typeof localStorage !== 'undefined')
      localStorage.clear()
    vi.restoreAllMocks()
  })

  it('initializes', () => {
    const store = useAutonomousArtistryStore()
    expect(store).toBeTruthy()
  })
})
