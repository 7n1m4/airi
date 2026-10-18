import { describe, expect, it } from 'vitest'

import { models } from './list-models'

describe('elevenlabs list-models', () => {
  it('exports a non-empty models array', () => {
    expect(Array.isArray(models)).toBe(true)
    expect(models.length).toBeGreaterThan(0)
  })
})
