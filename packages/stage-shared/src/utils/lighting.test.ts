import { describe, expect, it } from 'vitest'

import { computeDirectionalLightOrbit } from './lighting'

describe('computeDirectionalLightOrbit', () => {
  it('positions light in front of target at (0, 0) rotation', () => {
    const result = computeDirectionalLightOrbit({ x: 0, y: 0 })
    expect(result.target).toEqual({ x: 0, y: 1.0, z: 0 })
    expect(result.position.x).toBeCloseTo(0, 3)
    expect(result.position.y).toBeCloseTo(1.0, 3)
    expect(result.position.z).toBeCloseTo(3.0, 3)
  })

  it('raises light position on positive pitch (rotation.x > 0)', () => {
    const result = computeDirectionalLightOrbit({ x: 30, y: 0 })
    // sin(30°) = 0.5 -> y = 1.0 + 3.0 * 0.5 = 2.5
    // cos(30°) = 0.8660 -> z = 0 + 3.0 * 0.8660 = 2.598
    expect(result.position.x).toBeCloseTo(0, 3)
    expect(result.position.y).toBeCloseTo(2.5, 3)
    expect(result.position.z).toBeCloseTo(2.598, 3)
  })

  it('lowers light position on negative pitch (rotation.x < 0)', () => {
    const result = computeDirectionalLightOrbit({ x: -30, y: 0 })
    expect(result.position.x).toBeCloseTo(0, 3)
    expect(result.position.y).toBeCloseTo(-0.5, 3)
    expect(result.position.z).toBeCloseTo(2.598, 3)
  })

  it('orbits right on positive yaw (rotation.y > 0)', () => {
    const result = computeDirectionalLightOrbit({ x: 0, y: 45 })
    // sin(45°) = 0.7071 -> x = 3.0 * 0.7071 = 2.1213
    // cos(45°) = 0.7071 -> z = 3.0 * 0.7071 = 2.1213
    expect(result.position.x).toBeCloseTo(2.121, 3)
    expect(result.position.y).toBeCloseTo(1.0, 3)
    expect(result.position.z).toBeCloseTo(2.121, 3)
  })

  it('orbits left on negative yaw (rotation.y < 0)', () => {
    const result = computeDirectionalLightOrbit({ x: 0, y: -45 })
    expect(result.position.x).toBeCloseTo(-2.121, 3)
    expect(result.position.y).toBeCloseTo(1.0, 3)
    expect(result.position.z).toBeCloseTo(2.121, 3)
  })

  it('orbits behind avatar on 180 degree yaw', () => {
    const result = computeDirectionalLightOrbit({ x: 0, y: 180 })
    expect(result.position.x).toBeCloseTo(0, 3)
    expect(result.position.y).toBeCloseTo(1.0, 3)
    expect(result.position.z).toBeCloseTo(-3.0, 3)
  })

  it('respects custom target and distance options', () => {
    const customTarget = { x: 1, y: 2, z: -1 }
    const result = computeDirectionalLightOrbit({ x: 0, y: 0 }, { target: customTarget, distance: 5.0 })
    expect(result.target).toEqual(customTarget)
    expect(result.position.x).toBeCloseTo(1, 3)
    expect(result.position.y).toBeCloseTo(2, 3)
    expect(result.position.z).toBeCloseTo(4, 3)
  })
})
