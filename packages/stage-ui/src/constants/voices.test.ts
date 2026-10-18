import type { VoicePreset } from './voices'

import { describe, expect, it } from 'vitest'

import { voicePresets } from './voices'

describe('voices constants', () => {
  it('exports voicePresets array', () => {
    expect(Array.isArray(voicePresets)).toBe(true)
    expect(voicePresets.length).toBeGreaterThan(0)
  })

  it('every preset has required fields with correct types', () => {
    for (const v of voicePresets) {
      expect(typeof v.id).toBe('string')
      expect(typeof v.name).toBe('string')
      expect(typeof v.gender).toBe('string')
      expect(typeof v.accent).toBe('string')
      expect(typeof v.description).toBe('string')
    }
  })

  it('ids are unique', () => {
    const ids = voicePresets.map(v => v.id)
    const seen: Record<string, true> = {}
    for (const id of ids) {
      expect(seen[id]).toBeUndefined()
      seen[id] = true
    }
    expect(ids.length).toBe(Object.keys(seen).length)
  })

  it('voicePreset interface is exported', () => {
    const sample: VoicePreset = {
      id: 'x',
      name: 'X',
      gender: 'Female',
      accent: 'US',
      description: 'd',
    }
    expect(sample.id).toBe('x')
  })
})
