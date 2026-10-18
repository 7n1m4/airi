import type { Generator } from '@proj-airi/motion-driver-magic'

import { describe, expect, it, vi } from 'vitest'

import { createDriver } from './driver'
import { neutralPose, valuesFromPose } from './pose'

function createGenerator(): Generator<number> {
  let state = 0
  return {
    sampleRateHz: 30,
    next: vi.fn(() => {
      state += 1
      return { state, values: valuesFromPose({ ...neutralPose, headX: state * 0.1 }) }
    }),
  }
}

describe('driver coverage', () => {
  it('throws when starting an already playing driver', () => {
    const callbacks: FrameRequestCallback[] = []
    const driver = createDriver({
      target: { apply: vi.fn(), release: vi.fn() },
      requestFrame: cb => (callbacks.push(cb), 1),
      cancelFrame: vi.fn(),
      now: () => 0,
    })
    driver.start(createGenerator())
    expect(() => driver.start(createGenerator())).toThrow('already playing')
  })

  it('throws when replacing a stopped driver', () => {
    const driver = createDriver({
      target: { apply: vi.fn(), release: vi.fn() },
      requestFrame: () => 1,
      cancelFrame: vi.fn(),
      now: () => 0,
    })
    expect(() => driver.replace(createGenerator())).toThrow('not playing')
  })

  it('is a no-op when stopping a stopped driver', () => {
    const release = vi.fn()
    const driver = createDriver({
      target: { apply: vi.fn(), release },
      requestFrame: () => 1,
      cancelFrame: vi.fn(),
      now: () => 0,
    })
    driver.stop()
    expect(release).not.toHaveBeenCalled()
  })

  it('returns early when a scheduled frame runs after stop', () => {
    const callbacks: FrameRequestCallback[] = []
    const driver = createDriver({
      target: { apply: vi.fn(), release: vi.fn() },
      requestFrame: cb => (callbacks.push(cb), 1),
      cancelFrame: vi.fn(),
      now: () => 0,
    })
    driver.start(createGenerator())
    driver.stop()
    // invoke the originally scheduled callback path via a new frame after stop
    callbacks.forEach(cb => cb(10))
    // no throw
  })

  it('calls setFilterOptions and resetFilter paths', () => {
    const apply = vi.fn()
    const onOutput = vi.fn()
    const callbacks: FrameRequestCallback[] = []
    const driver = createDriver({
      target: { apply, release: vi.fn() },
      onOutput,
      requestFrame: cb => (callbacks.push(cb), 1),
      cancelFrame: vi.fn(),
      now: () => 0,
    })
    driver.start(createGenerator())
    driver.setFilterOptions({ enabled: false, smoothing: 0.5, cutoff: 0.1 })
    driver.resetFilter()
    // resetFilter with no input pose (already cleared) is no-op apply
  })

  it('resetFilter applies the latest input pose when present', () => {
    const apply = vi.fn()
    const callbacks: FrameRequestCallback[] = []
    const driver = createDriver({
      target: { apply, release: vi.fn() },
      requestFrame: cb => (callbacks.push(cb), 1),
      cancelFrame: vi.fn(),
      now: () => 0,
    })
    driver.start(createGenerator())
    apply.mockClear()
    driver.resetFilter()
    expect(apply).toHaveBeenCalled()
  })
})
