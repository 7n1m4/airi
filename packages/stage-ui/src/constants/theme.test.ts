import { describe, expect, it } from 'vitest'

import { chromaticHueDefault } from './theme'

describe('theme constants', () => {
  it('exports chromaticHueDefault', () => {
    expect(chromaticHueDefault).toBe(220.44)
  })
})
