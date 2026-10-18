import { describe, expect, it } from 'vitest'

import { PRESETS } from './foundry-presets'

describe('foundry-presets', () => {
  it('exports 4 curated presets', () => {
    expect(PRESETS).toHaveLength(4)
  })

  it('has unique ids matching the union', () => {
    const ids = PRESETS.map(p => p.id)
    expect(new Set(ids).size).toBe(ids.length)
    expect(ids).toEqual(['glyph', 'mori', 'wired', 'sylvia'])
  })

  it('each preset has non-empty required fields', () => {
    for (const preset of PRESETS) {
      expect(preset.name.length).toBeGreaterThan(0)
      expect(preset.nickname.length).toBeGreaterThan(0)
      expect(preset.archetypeTitle.length).toBeGreaterThan(0)
      expect(preset.tag.length).toBeGreaterThan(0)
      expect(preset.icon.length).toBeGreaterThan(0)
      expect(['purple', 'emerald', 'amber', 'rose']).toContain(preset.color)
      expect(preset.description.length).toBeGreaterThan(0)
      expect(preset.goldenTurnsCount).toBeGreaterThan(0)
      expect(preset.goldenTurnsText.length).toBeGreaterThan(0)
      expect(preset.brevityScore.length).toBeGreaterThan(0)
      expect(preset.ttft.length).toBeGreaterThan(0)
      expect(preset.testedSample.length).toBeGreaterThan(0)
      expect(preset.testProbePrompt.length).toBeGreaterThan(0)
      expect(preset.testProbeResponse.length).toBeGreaterThan(0)
      expect(preset.temperature).toBeGreaterThanOrEqual(0)
      expect(preset.topP).toBeGreaterThan(0)
      expect(preset.topP).toBeLessThanOrEqual(1)
      expect(preset.greetings.length).toBeGreaterThan(0)
      expect(preset.personality.length).toBeGreaterThan(0)
      expect(preset.scenario.length).toBeGreaterThan(0)
      expect(preset.mannerisms.length).toBeGreaterThan(0)
      expect(preset.conditioningTurns.length).toBeGreaterThan(0)
    }
  })

  it('goldenTurnsText reflects goldenTurnsCount', () => {
    for (const preset of PRESETS) {
      expect(preset.goldenTurnsText).toContain(String(preset.goldenTurnsCount))
    }
  })
})
