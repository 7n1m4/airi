import { describe, expect, it } from 'vitest'

import { createTrainingSequence, neutralPose, poseFromValues, valuesFromPose } from './pose'

describe('pose coverage', () => {
  it('throws when frame length mismatches', () => {
    expect(() => poseFromValues([1, 2])).toThrow('must contain')
  })

  it('creates a training sequence', () => {
    const seq = createTrainingSequence({
      sampleRateHz: 30,
      sourceDurationMs: 1000,
      poses: [neutralPose],
    })
    expect(seq.frames).toHaveLength(1)
    expect(seq.sampleRateHz).toBe(30)
  })

  it('round-trips values', () => {
    expect(poseFromValues(valuesFromPose(neutralPose)).headX).toBe(0)
  })
})
