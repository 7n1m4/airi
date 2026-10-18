import { describe, expect, it } from 'vitest'

import { arcadeProfiles, game2048Profile, genericTurnBasedProfile, resolveArcadeProfile, simCityProfile } from './index'

describe('simCityProfile', () => {
  it('matches simcity titles', () => {
    expect(simCityProfile.matchGame('SimCity')).toBe(true)
    expect(simCityProfile.matchGame('SIM CITY 2000')).toBe(true)
    expect(simCityProfile.matchGame('simcity (dos)')).toBe(true)
  })

  it('does not match unrelated titles', () => {
    expect(simCityProfile.matchGame('2048')).toBe(false)
    expect(simCityProfile.matchGame('tetris')).toBe(false)
  })

  it('exposes metadata', () => {
    expect(simCityProfile.id).toBe('simcity')
    expect(simCityProfile.name).toBe('SimCity (DOS Classic)')
    expect(typeof simCityProfile.systemPromptAddendum).toBe('string')
  })
})

describe('game2048Profile', () => {
  it('matches 2048 titles', () => {
    expect(game2048Profile.matchGame('2048')).toBe(true)
    expect(game2048Profile.matchGame('play 2048 now')).toBe(true)
  })

  it('does not match unrelated titles', () => {
    expect(game2048Profile.matchGame('simcity')).toBe(false)
  })

  it('exposes metadata', () => {
    expect(game2048Profile.id).toBe('2048')
    expect(game2048Profile.name).toBe('2048 (Number Tile Merge)')
  })
})

describe('genericTurnBasedProfile', () => {
  it('always matches', () => {
    expect(genericTurnBasedProfile.matchGame('')).toBe(true)
    expect(genericTurnBasedProfile.matchGame('anything')).toBe(true)
  })

  it('exposes metadata', () => {
    expect(genericTurnBasedProfile.id).toBe('generic')
    expect(genericTurnBasedProfile.name).toBe('Generic Turn-Based & Point-and-Click')
  })
})

describe('arcadeProfiles', () => {
  it('contains all profiles in order', () => {
    expect(arcadeProfiles).toEqual([simCityProfile, game2048Profile, genericTurnBasedProfile])
  })
})

describe('resolveArcadeProfile', () => {
  it('resolves simcity profile', () => {
    expect(resolveArcadeProfile('SimCity')).toBe(simCityProfile)
    expect(resolveArcadeProfile('Sim City')).toBe(simCityProfile)
  })

  it('resolves 2048 profile', () => {
    expect(resolveArcadeProfile('2048')).toBe(game2048Profile)
  })

  it('falls back to generic for unknown', () => {
    expect(resolveArcadeProfile('unknown game')).toBe(genericTurnBasedProfile)
  })
})
