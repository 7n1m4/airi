import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { useAutonomousArtistryStore } from './artistry-autonomous'

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
