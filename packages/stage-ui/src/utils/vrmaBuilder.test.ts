import { describe, expect, it } from 'vitest'

import { BONE_NAMES, buildVRMA, EXPRESSION_PRESETS, HIPS_HEIGHT, SKELETON } from './vrmaBuilder'

describe('vrmaBuilder constants', () => {
  it('sKELETON contains hips root', () => {
    expect(SKELETON.hips[0]).toBeNull()
    expect(SKELETON.hips[1]).toEqual([0, 0.9, 0])
  })

  it('hIPS_HEIGHT matches', () => {
    expect(HIPS_HEIGHT).toBe(0.9)
  })

  it('bONE_NAMES excludes finger bones', () => {
    expect(BONE_NAMES).toContain('hips')
    expect(BONE_NAMES.some(n => /Proximal|Intermediate|Distal/.test(n))).toBe(false)
  })

  it('eXPRESSION_PRESETS list', () => {
    expect(EXPRESSION_PRESETS).toContain('happy')
    expect(EXPRESSION_PRESETS).toHaveLength(18)
  })
})

describe('buildVRMA', () => {
  it('builds a GLB buffer with valid header', () => {
    const buf = buildVRMA({ name: 'm', duration: 1, loop: false, tracks: { hips: [{ t: 0, r: [0, 0, 0] }, { t: 1, r: [0, 0, 0] }] } })
    expect(buf).toBeInstanceOf(ArrayBuffer)
    const dv = new DataView(buf)
    expect(dv.getUint32(0, true)).toBe(0x46546C67)
    expect(dv.getUint32(4, true)).toBe(2)
    expect(dv.byteLength).toBeGreaterThan(12)
  })

  it('includes hips translation when provided', () => {
    const buf = buildVRMA({ name: 'm', duration: 2, loop: true, tracks: { leftUpperArm: [{ t: 0, r: [0, 0, 90] }] }, hips: [{ t: 0, p: [0, 0, 0] }] })
    expect(buf.byteLength).toBeGreaterThan(100)
  })

  it('filters unknown bones and invalid expressions', () => {
    const buf = buildVRMA({
      name: 'm',
      duration: 1,
      loop: false,
      tracks: { unknownBone: [{ t: 0, r: [0, 0, 0] }], hips: [{ t: 0, r: [0, 0, 0] }] },
      expressions: { notAPreset: [{ t: 0, w: 1 }], happy: [{ t: 0, w: 2 }] },
    })
    const jsonLen = new DataView(buf).getUint32(12, true)
    const json = new TextDecoder().decode(new Uint8Array(buf, 20, jsonLen))
    expect(json).toContain('hips')
    expect(json).not.toContain('notAPreset')
  })
  it('skips empty track arrays', () => {
    const buf = buildVRMA({ name: 'm', duration: 1, loop: false, tracks: { hips: [] } })
    expect(buf).toBeInstanceOf(ArrayBuffer)
  })
  it('generates shoulder follow tracks when upper arm raised', () => {
    const buf = buildVRMA({ name: 'm', duration: 1, loop: false, tracks: { leftUpperArm: [{ t: 0, r: [0, 0, 90] }, { t: 1, r: [0, 0, 90] }], rightUpperArm: [{ t: 0, r: [0, 0, -90] }, { t: 1, r: [0, 0, -90] }] } })
    const jsonLen = new DataView(buf).getUint32(12, true)
    const json = new TextDecoder().decode(new Uint8Array(buf, 20, jsonLen))
    expect(json).toContain('leftShoulder')
    expect(json).toContain('rightShoulder')
  })
  it('skips shoulder follow when lift is zero', () => {
    const buf = buildVRMA({ name: 'm', duration: 1, loop: false, tracks: { leftUpperArm: [{ t: 0, r: [0, 0, 30] }] } })
    expect(buf).toBeInstanceOf(ArrayBuffer)
  })
  it('sorts hips and expressions with multiple keys', () => {
    const buf = buildVRMA({ name: 'm', duration: 2, loop: true, tracks: { hips: [{ t: 0, r: [0, 0, 0] }] }, hips: [{ t: 1, p: [0, 0, 0] }, { t: 0, p: [1, 1, 1] }], expressions: { happy: [{ t: 1, w: 0.5 }, { t: 0, w: 1 }] } })
    expect(buf.byteLength).toBeGreaterThan(100)
  })
  it('throws when no tracks/channels', () => {
    const emptyTracks: Record<string, any[]> = {}
    for (const b of Object.keys(SKELETON)) emptyTracks[b] = []
    expect(() => buildVRMA({ name: 'm', duration: 1, loop: false, tracks: emptyTracks })).toThrow('モーションにトラックがありません')
  })
})
