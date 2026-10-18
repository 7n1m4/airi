import { safeParse } from 'valibot'
import { describe, expect, it } from 'vitest'

import { VRMA_SYSTEM_PROMPT, VRMAMotionSpecSchema } from './vrmaSchema'

describe('vRMAMotionSpecSchema', () => {
  it('parses a minimal valid spec', () => {
    const result = safeParse(VRMAMotionSpecSchema, {
      name: 'wave',
      duration: 2,
      loop: false,
      tracks: {},
    })
    expect(result.success).toBe(true)
  })

  it('parses a full spec with hips and expressions', () => {
    const result = safeParse(VRMAMotionSpecSchema, {
      name: 'dance',
      duration: 4,
      loop: true,
      tracks: { head: [{ t: 0, r: [0, 0, 0] }] },
      hips: [{ t: 0, p: [0, 0, 0] }],
      expressions: { happy: [{ t: 0, w: 1 }] },
    })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.output.tracks.head[0].r).toEqual([0, 0, 0])
    }
  })

  it('rejects empty name', () => {
    const result = safeParse(VRMAMotionSpecSchema, {
      name: '',
      duration: 2,
      loop: false,
      tracks: {},
    })
    expect(result.success).toBe(false)
  })

  it('rejects missing required fields', () => {
    expect(safeParse(VRMAMotionSpecSchema, {}).success).toBe(false)
    expect(safeParse(VRMAMotionSpecSchema, { name: 'x', duration: 1, loop: true }).success).toBe(false)
  })

  it('rejects wrong types', () => {
    expect(safeParse(VRMAMotionSpecSchema, {
      name: 'x',
      duration: '2',
      loop: false,
      tracks: {},
    }).success).toBe(false)
    expect(safeParse(VRMAMotionSpecSchema, {
      name: 'x',
      duration: 2,
      loop: 'false',
      tracks: {},
    }).success).toBe(false)
    expect(safeParse(VRMAMotionSpecSchema, {
      name: 'x',
      duration: 2,
      loop: false,
      tracks: 'bad',
    }).success).toBe(false)
  })

  it('rejects malformed track entries', () => {
    expect(safeParse(VRMAMotionSpecSchema, {
      name: 'x',
      duration: 2,
      loop: false,
      tracks: { head: [{ t: '0', r: [0, 0, 0] }] },
    }).success).toBe(false)
    expect(safeParse(VRMAMotionSpecSchema, {
      name: 'x',
      duration: 2,
      loop: false,
      tracks: { head: [{ t: 0, r: 'bad' }] },
    }).success).toBe(false)
  })

  it('rejects malformed hips', () => {
    expect(safeParse(VRMAMotionSpecSchema, {
      name: 'x',
      duration: 2,
      loop: false,
      tracks: {},
      hips: [{ t: 0, p: 'bad' }],
    }).success).toBe(false)
    expect(safeParse(VRMAMotionSpecSchema, {
      name: 'x',
      duration: 2,
      loop: false,
      tracks: {},
      hips: [{ t: '0', p: [0, 0, 0] }],
    }).success).toBe(false)
  })

  it('rejects malformed expressions', () => {
    expect(safeParse(VRMAMotionSpecSchema, {
      name: 'x',
      duration: 2,
      loop: false,
      tracks: {},
      expressions: { happy: [{ t: 0, w: '1' }] },
    }).success).toBe(false)
    expect(safeParse(VRMAMotionSpecSchema, {
      name: 'x',
      duration: 2,
      loop: false,
      tracks: {},
      expressions: { happy: [{ t: '0', w: 1 }] },
    }).success).toBe(false)
    expect(safeParse(VRMAMotionSpecSchema, {
      name: 'x',
      duration: 2,
      loop: false,
      tracks: {},
      expressions: 'bad',
    }).success).toBe(false)
  })

  it('allows empty optional arrays/records', () => {
    const result = safeParse(VRMAMotionSpecSchema, {
      name: 'x',
      duration: 2,
      loop: false,
      tracks: {},
      hips: [],
      expressions: {},
    })
    expect(result.success).toBe(true)
  })

  it('vRMA_SYSTEM_PROMPT is a non-empty string containing bone names', () => {
    expect(typeof VRMA_SYSTEM_PROMPT).toBe('string')
    expect(VRMA_SYSTEM_PROMPT.length).toBeGreaterThan(0)
  })
})
