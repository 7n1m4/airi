import type { TrainingSequence } from './types'

import { describe, expect, it } from 'vitest'

import { createArHmmModel } from './ar-hmm'
import { cholesky } from './shared/numeric'
import { sampleCategorical } from './shared/random'
import { fitVarParameters } from './shared/var'

describe('coverage extras', () => {
  it('ar-hmm throws on invalid options / short sequence', () => {
    const seq: TrainingSequence = { sampleRateHz: 30, sourceDurationMs: 0, frames: Array.from({ length: 5 }, () => [0, 1]) }
    expect(() => createArHmmModel(seq, { stateCount: 1, order: 1, ridge: 0.1, iterations: 2 })).toThrow()
    expect(() => createArHmmModel(seq, { stateCount: 2, order: 1, ridge: 0.1, iterations: 0 })).toThrow()
    expect(() => createArHmmModel(seq, { stateCount: 2, order: 1, ridge: 0.1, iterations: 2 })).toThrow()
  })

  it('var throws on invalid inputs', () => {
    const bad: TrainingSequence = { sampleRateHz: 0, sourceDurationMs: 0, frames: [[1, 2]] }
    expect(() => fitVarParameters(bad, { order: 1, ridge: 0.1 })).toThrow()
    const bad2: TrainingSequence = { sampleRateHz: 30, sourceDurationMs: 0, frames: [] }
    expect(() => fitVarParameters(bad2, { order: 1, ridge: 0.1 })).toThrow()
    const bad3: TrainingSequence = { sampleRateHz: 30, sourceDurationMs: 0, frames: [[1, 2], [3]] }
    expect(() => fitVarParameters(bad3, { order: 1, ridge: 0.1 })).toThrow()
    const constFrames: TrainingSequence = { sampleRateHz: 30, sourceDurationMs: 0, frames: Array.from({ length: 10 }, () => [5, 5]) }
    expect(() => fitVarParameters(constFrames, { order: 1, ridge: 0.1 })).toThrow()
    const short: TrainingSequence = { sampleRateHz: 30, sourceDurationMs: 0, frames: [[1, 2], [3, 4]] }
    expect(() => fitVarParameters(short, { order: 1, ridge: 0.1 })).toThrow()
    const orderBad: TrainingSequence = { sampleRateHz: 30, sourceDurationMs: 0, frames: Array.from({ length: 10 }, (_, i) => [i, i + 1]) }
    expect(() => fitVarParameters(orderBad, { order: 0, ridge: 0.1 })).toThrow()
  })

  it('numeric cholesky tiny pivot', () => {
    const L = cholesky([[1e-20]])
    expect(L[0][0]).toBeCloseTo(1e-6, 10)
  })

  it('random sampleCategorical fallback', () => {
    expect(sampleCategorical([0.5], () => 0.999)).toBe(0)
  })
})
