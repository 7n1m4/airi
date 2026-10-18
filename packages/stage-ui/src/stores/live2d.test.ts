import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it } from 'vitest'

import { useLive2d } from './live2d'

describe('live2d re-export', () => {
  beforeEach(() => {
    localStorage.clear()
    setActivePinia(createPinia())
  })

  it('exports useLive2d', () => {
    const store = useLive2d()
    expect(store).toBeTruthy()
  })
})
