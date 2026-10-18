import { describe, expect, it, vi } from 'vitest'

import { exportFlowMDMToVRMA } from './vrmaExporter'

describe('exportFlowMDMToVRMA', () => {
  it('returns a GLB Uint8Array for zero-filled motion data', () => {
    const data = new Float32Array(263 * 60)
    const out = exportFlowMDMToVRMA(data)
    expect(out).toBeInstanceOf(Uint8Array)
    expect(out.length).toBeGreaterThan(0)
    // GLB magic
    const view = new DataView(out.buffer)
    expect(view.getUint32(0, true)).toBe(0x46546C67)
    expect(view.getUint32(4, true)).toBe(2)
  })

  it('invokes onLog callback', () => {
    const data = new Float32Array(263 * 60)
    const onLog = vi.fn()
    exportFlowMDMToVRMA(data, 60, onLog)
    expect(onLog).toHaveBeenCalled()
  })

  it('supports custom seqLen', () => {
    const seqLen = 5
    const data = new Float32Array(263 * seqLen)
    const out = exportFlowMDMToVRMA(data, seqLen)
    expect(out).toBeInstanceOf(Uint8Array)
    expect(out.length).toBeGreaterThan(0)
  })

  it('handles non-zero input data', () => {
    const data = new Float32Array(263 * 10)
    for (let i = 0; i < data.length; i++) data[i] = (i % 7) * 0.1 - 0.3
    const out = exportFlowMDMToVRMA(data, 10)
    expect(out).toBeInstanceOf(Uint8Array)
  })
  it('exercises hemisphere continuity with randomized data', () => {
    for (let r = 0; r < 50; r++) {
      const data = new Float32Array(263 * 12)
      for (let i = 0; i < data.length; i++) data[i] = (Math.random() - 0.5) * 2
      const out = exportFlowMDMToVRMA(data, 12)
      expect(out).toBeInstanceOf(Uint8Array)
    }
  })
})
