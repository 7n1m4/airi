import { describe, expect, it } from 'vitest'

import { MODEL_MARKETPLACES, SPOTLIGHT_MODELS } from './marketplaces'

describe('marketplaces constants', () => {
  it('exports spotlight models array', () => {
    expect(Array.isArray(SPOTLIGHT_MODELS)).toBe(true)
    expect(SPOTLIGHT_MODELS.length).toBeGreaterThan(0)
  })

  it('exports model marketplaces array', () => {
    expect(Array.isArray(MODEL_MARKETPLACES)).toBe(true)
    expect(MODEL_MARKETPLACES.length).toBeGreaterThan(0)
  })

  it('spotlight models have required fields', () => {
    for (const m of SPOTLIGHT_MODELS) {
      expect(typeof m.id).toBe('string')
      expect(typeof m.name).toBe('string')
      expect(['vrm', 'live2d', 'spine', 'mmd']).toContain(m.format)
      expect(typeof m.previewUrl).toBe('string')
      expect(typeof m.downloadUrl).toBe('string')
      expect(typeof m.sourceSiteName).toBe('string')
    }
  })

  it('marketplaces have required fields', () => {
    for (const m of MODEL_MARKETPLACES) {
      expect(typeof m.name).toBe('string')
      expect(typeof m.vrm).toBe('boolean')
      expect(typeof m.live2d).toBe('boolean')
      expect(typeof m.spine).toBe('boolean')
      expect(typeof m.mmd).toBe('boolean')
      expect(Array.isArray(m.languages)).toBe(true)
      expect(typeof m.origin).toBe('string')
      expect(typeof m.url).toBe('string')
    }
  })
})
