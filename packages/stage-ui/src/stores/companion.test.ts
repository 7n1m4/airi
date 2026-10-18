import { describe, expect, it } from 'vitest'

import { COMPANION_SCOPES, isNapChatEligibleModel, napTodayKey } from './companion'

describe('companion pure exports', () => {
  it('cOMPANION_SCOPES ordered narrowest first', () => {
    expect(COMPANION_SCOPES).toEqual(['card-only', 'card-and-echo-chips', 'card-and-lifetime'])
  })

  it('napTodayKey returns UTC date string', () => {
    expect(napTodayKey()).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })

  it('isNapChatEligibleModel refuses missing model', () => {
    expect(isNapChatEligibleModel({})).toEqual({ allowed: false, reason: 'model-gate: no active model' })
  })

  it('isNapChatEligibleModel allows local', () => {
    expect(isNapChatEligibleModel({ providerKey: 'p', modelId: 'm', deployment: 'local' })).toEqual({ allowed: true })
  })

  it('isNapChatEligibleModel allows free pricing', () => {
    expect(isNapChatEligibleModel({ providerKey: 'p', modelId: 'm', pricing: 'free' })).toEqual({ allowed: true })
  })

  it('isNapChatEligibleModel allows catalog hit', () => {
    expect(isNapChatEligibleModel({ providerKey: 'p', modelId: 'm', freeCatalogIds: ['p:m'] })).toEqual({ allowed: true })
    expect(isNapChatEligibleModel({ providerKey: 'p:i', modelId: 'm', freeCatalogIds: ['p:m'] })).toEqual({ allowed: true })
  })

  it('isNapChatEligibleModel refuses unknown', () => {
    const r = isNapChatEligibleModel({ providerKey: 'p', modelId: 'm' })
    expect(r.allowed).toBe(false)
    expect(r.reason).toContain('neither local nor known-free')
  })
})
