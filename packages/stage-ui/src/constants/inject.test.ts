import { describe, expect, it } from 'vitest'

import { chromaticHue } from './inject'

describe('inject constants', () => {
  it('exports chromaticHue injection key', () => {
    expect(typeof chromaticHue).toBe('symbol')
    expect(chromaticHue.description).toBe('@proj-airi/chromatic-hue')
  })
})
