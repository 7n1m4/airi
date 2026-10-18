import { describe, expect, it } from 'vitest'

import { CUSTOMIZER_CATALOG } from './control-customizer'

describe('control-customizer', () => {
  it('catalog is non-empty array', () => {
    expect(Array.isArray(CUSTOMIZER_CATALOG)).toBe(true)
    expect(CUSTOMIZER_CATALOG.length).toBeGreaterThan(0)
  })

  it('each group has items', () => {
    for (const group of CUSTOMIZER_CATALOG) {
      expect(group.id).toBeTruthy()
      expect(group.name).toBeTruthy()
      expect(Array.isArray(group.items)).toBe(true)
      expect(group.items.length).toBeGreaterThan(0)
    }
  })

  it('item ids unique', () => {
    const ids = CUSTOMIZER_CATALOG.flatMap(g => g.items.map(i => i.id))
    const seen: Record<string, true> = {}
    let dup = false
    for (const id of ids) {
      if (seen[id]) { dup = true; break }
      seen[id] = true
    }
    expect(dup).toBe(false)
  })

  it('item types valid', () => {
    const valid: Record<string, true> = { toggle: true, cycler: true, action: true, menu: true }
    for (const group of CUSTOMIZER_CATALOG) {
      for (const item of group.items) {
        expect(valid[item.type]).toBe(true)
        expect(typeof item.defaultOnStrip).toBe('boolean')
      }
    }
  })
})
