import { evaluateLive2dBlend } from '@proj-airi/stage-ui-live2d'
import { describe, expect, it } from 'vitest'

describe('live2d: Cubism parameter blend mode math invariants', () => {
  describe('add blend mode', () => {
    it('adds value to zero baseline with full intensity', () => {
      // base + raw * intensity = 0 + 0.6 * 1.0 = 0.6
      expect(evaluateLive2dBlend(0, 0.6, 1.0, 'Add')).toBeCloseTo(0.6)
    })

    it('accumulates on non-zero baseline with scaled intensity', () => {
      // base + raw * intensity = 0.3 + 0.4 * 0.5 = 0.5
      expect(evaluateLive2dBlend(0.3, 0.4, 0.5, 'Add')).toBeCloseTo(0.5)
    })

    it('supports negative adjustments (subtractive parameter reduction)', () => {
      // base + raw * intensity = 0.8 + (-0.3) * 1.0 = 0.5
      expect(evaluateLive2dBlend(0.8, -0.3, 1.0, 'Add')).toBeCloseTo(0.5)
    })

    it('returns exact base value when intensity is zero', () => {
      expect(evaluateLive2dBlend(0.42, 0.8, 0, 'Add')).toBe(0.42)
    })
  })

  describe('multiply blend mode', () => {
    it('scales baseline value by raw value at full intensity', () => {
      // base * (raw * intensity) = 0.8 * (0.5 * 1.0) = 0.4
      expect(evaluateLive2dBlend(0.8, 0.5, 1.0, 'Multiply')).toBeCloseTo(0.4)
    })

    it('scales baseline with fractional intensity', () => {
      // base * (raw * intensity) = 0.8 * (0.5 * 0.5) = 0.8 * 0.25 = 0.2
      expect(evaluateLive2dBlend(0.8, 0.5, 0.5, 'Multiply')).toBeCloseTo(0.2)
    })

    it('yields 0 when base value is zero', () => {
      expect(evaluateLive2dBlend(0, 0.9, 1.0, 'Multiply')).toBe(0)
    })

    it('yields 0 when intensity is zero', () => {
      expect(evaluateLive2dBlend(0.75, 0.5, 0, 'Multiply')).toBe(0)
    })
  })

  describe('overwrite blend mode (default)', () => {
    it('replaces base value completely regardless of baseline', () => {
      // raw * intensity = 0.85 * 1.0 = 0.85
      expect(evaluateLive2dBlend(0.1, 0.85, 1.0, 'Overwrite')).toBeCloseTo(0.85)
      expect(evaluateLive2dBlend(0.9, 0.85, 1.0, 'Overwrite')).toBeCloseTo(0.85)
    })

    it('scales replacement by intensity', () => {
      expect(evaluateLive2dBlend(0.5, 0.8, 0.75, 'Overwrite')).toBeCloseTo(0.6)
    })

    it('defaults to Overwrite when blend mode string is unrecognized or omitted', () => {
      expect(evaluateLive2dBlend(0.2, 0.7, 1.0, undefined as any)).toBeCloseTo(0.7)
      expect(evaluateLive2dBlend(0.2, 0.7, 1.0, 'CustomUnknown')).toBeCloseTo(0.7)
    })
  })

  describe('parameter deformation & reset invariants', () => {
    it('restores exact baseline after applying any blend mode', () => {
      const modelParameters: Record<string, number> = {
        ParamEyeLOpen: 1.0,
        ParamMouthForm: 0.0,
        ParamCheek: 0.2,
      }

      // 1. Capture neutral baseline snapshot
      const originalBaseline = { ...modelParameters }

      // 2. Apply multi-parameter expression with different blend modes
      const expressionParams = [
        { id: 'ParamEyeLOpen', value: 0.2, blend: 'Multiply' },
        { id: 'ParamMouthForm', value: 0.8, blend: 'Add' },
        { id: 'ParamCheek', value: 1.0, blend: 'Overwrite' },
      ]

      for (const param of expressionParams) {
        const base = modelParameters[param.id]
        modelParameters[param.id] = evaluateLive2dBlend(base, param.value, 1.0, param.blend)
      }

      // Assert parameters changed according to their blend math
      expect(modelParameters.ParamEyeLOpen).toBeCloseTo(0.2) // 1.0 * 0.2
      expect(modelParameters.ParamMouthForm).toBeCloseTo(0.8) // 0.0 + 0.8
      expect(modelParameters.ParamCheek).toBeCloseTo(1.0) // overwrite 0.2 -> 1.0

      // 3. Execute reset
      for (const [id, origVal] of Object.entries(originalBaseline)) {
        modelParameters[id] = origVal
      }

      // Assert exact baseline is restored
      expect(modelParameters).toEqual({
        ParamEyeLOpen: 1.0,
        ParamMouthForm: 0.0,
        ParamCheek: 0.2,
      })
    })
  })
})
