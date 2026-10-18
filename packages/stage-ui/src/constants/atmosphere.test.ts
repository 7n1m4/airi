import type { AtmosphereMeta } from './atmosphere'

import { describe, expect, it } from 'vitest'

import { ATMOSPHERE_PRESETS } from './atmosphere'

describe('atmosphere constants', () => {
  it('exports a non-empty preset list', () => {
    expect(Array.isArray(ATMOSPHERE_PRESETS)).toBe(true)
    expect(ATMOSPHERE_PRESETS.length).toBeGreaterThan(0)
  })

  it('each preset has the expected shape', () => {
    for (const preset of ATMOSPHERE_PRESETS) {
      expect(typeof preset.id).toBe('string')
      expect(typeof preset.name).toBe('string')
      expect(typeof preset.icon).toBe('string')
      expect(typeof preset.description).toBe('string')
      expect(preset.id.length).toBeGreaterThan(0)
      expect(preset.name.length).toBeGreaterThan(0)
      expect(preset.icon.length).toBeGreaterThan(0)
      expect(preset.description.length).toBeGreaterThan(0)
    }
  })

  it('has unique ids', () => {
    const ids = ATMOSPHERE_PRESETS.map(p => p.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('includes the none preset', () => {
    expect(ATMOSPHERE_PRESETS.some(p => p.id === 'none')).toBe(true)
  })

  it('atmosphereMeta type is usable', () => {
    const m: AtmosphereMeta = {
      id: 'none',
      name: 'None',
      icon: 'i-solar:close-circle-bold-duotone',
      description: 'desc',
    }
    expect(m.id).toBe('none')
  })
})
