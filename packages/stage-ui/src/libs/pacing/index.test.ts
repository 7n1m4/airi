import { describe, expect, it } from 'vitest'

import * as pacing from './index'

describe('pacing index barrel', () => {
  it('re-exports public pacing modules', () => {
    expect(Object.keys(pacing).length).toBeGreaterThan(0)
  })
})
