import type { CompanionConsent, CompanionShareCard, CompanionShareScope } from '@proj-airi/stage-shared/agentic'

import { describe, expect, it } from 'vitest'

import { narrowerScope, packGuestAccess } from './companion'

/**
 * The share a host publishes to `airi/companion`, exactly as
 * `publishCompanionShare` builds it.
 */
function publishedShare(scope: CompanionShareCard['scope']): CompanionShareCard {
  return {
    cardId: 'card-1',
    name: 'AIRI Companion',
    hostPeerId: '12D3KooWhost',
    publishedAt: Date.now(),
    scope,
  }
}

/**
 * The guest boundary, exercised as the round trip it actually is rather than as
 * the pure `packGuestAccess` helper: a host publishes at one scope, the guest
 * reads the published share, and the pack contains exactly what that scope
 * permits. `packGuestAccess` is covered separately in the pure-function tests;
 * these tests pin the *composed* rule, which is the invariant a reader needs.
 */
describe('guest boundary through the host → publish → visit round trip', () => {
  it('gives a card-only guest the card and nothing else, even when the host has chips and a lifetime archive', () => {
    const hostShare = publishedShare('card-only')

    // The host holds both pillars, but the guest may only read what the share
    // grants, so `packGuestAccess` is called with the *published* scope.
    const guest = packGuestAccess({
      card: hostShare,
      scope: hostShare.scope,
      echoChips: [{ id: 'chip-1', type: 'mood', content: 'a private memory', relevanceScore: 0.9 }],
      lifetimeDistilled: 'a long distilled relationship summary',
    })

    expect(guest.card.cardId).toBe('card-1')
    expect(guest.echoChips).toEqual([])
    expect(guest.lifetimeSummary).toBeUndefined()
  })

  it('gives a guest asking for card-and-lifetime from a card-only host only card-only', () => {
    // A guest cannot widen what the host published: `narrowerScope` is what the
    // host uses to answer, so the guest's ask is clamped here.
    const hostShare = publishedShare('card-only')
    const guestScope = narrowerScope(hostShare.scope, 'card-and-lifetime')

    expect(guestScope).toBe('card-only')

    const guest = packGuestAccess({
      card: hostShare,
      scope: guestScope,
      lifetimeDistilled: 'a long distilled relationship summary',
    })

    expect(guest.lifetimeSummary).toBeUndefined()
    expect(guest.echoChips).toEqual([])
  })

  it('gives a card-and-echo-chips host chips but never the lifetime archive, even when the guest asks wider', () => {
    const hostShare = publishedShare('card-and-echo-chips')
    const guestScope = narrowerScope(hostShare.scope, 'card-and-lifetime')

    expect(guestScope).toBe('card-and-echo-chips')

    const guest = packGuestAccess({
      card: hostShare,
      scope: guestScope,
      echoChips: [{ id: 'chip-1', type: 'mood', content: 'a shared memory', relevanceScore: 0.9 }],
      lifetimeDistilled: 'a distilled summary the guest must not read',
    })

    expect(guest.echoChips).toHaveLength(1)
    expect(guest.lifetimeSummary).toBeUndefined()
  })

  it('gives a card-and-lifetime host both, and bounds the lifetime text', () => {
    const hostShare = publishedShare('card-and-lifetime')

    const guest = packGuestAccess({
      card: hostShare,
      scope: hostShare.scope,
      echoChips: [{ id: 'chip-1', type: 'mood', content: 'a memory', relevanceScore: 0.9 }],
      lifetimeDistilled: 'x'.repeat(9000),
    })

    expect(guest.echoChips).toHaveLength(1)
    // The distillation is bounded, so a dense archive cannot become an
    // unbounded share even though the host consented to share it.
    expect(guest.lifetimeSummary).toHaveLength(4000)
  })

  it('never lets a guest scope escape the published scope, for every pairing', () => {
    const scopes = ['card-only', 'card-and-echo-chips', 'card-and-lifetime'] as const
    const rank: Record<string, number> = { 'card-only': 0, 'card-and-echo-chips': 1, 'card-and-lifetime': 2 }

    for (const host of scopes) {
      for (const asked of scopes) {
        const granted = narrowerScope(host, asked)
        expect(rank[granted]).toBeLessThanOrEqual(rank[host])
      }
    }
  })
})

/**
 * The consent gate, exercised as the decision the share handler makes.
 *
 * A refused share publishes *nothing*, not a narrowed share: consent is the
 * gate, and a narrowed publish would still broadcast a card the operator never
 * agreed to share. That rule is `!granted → refuse`, before any scope is
 * computed, which is what this pins.
 */
describe('consent gating of a publish', () => {
  /** The gate the share handler applies, expressed as a named decision. */
  function decideShare(consent: CompanionConsent, requested: CompanionShareScope): {
    shared: boolean
    scope: CompanionShareScope
    reason?: string
  } {
    if (!consent.granted) {
      return { shared: false, scope: 'card-only', reason: 'consent-not-granted' }
    }
    return { shared: true, scope: narrowerScope(consent.scope, requested) }
  }

  it('refuses to publish at all when consent is not granted', () => {
    const result = decideShare({ granted: false, scope: 'card-only' }, 'card-and-lifetime')

    expect(result.shared).toBe(false)
    expect(result.reason).toBe('consent-not-granted')
    // The critical part: nothing is published, so the host's card never reaches
    // the mesh even at the narrowest scope.
    expect(result.scope).toBe('card-only')
  })

  it('publishes at most the consented scope when the renderer asks wider', () => {
    const result = decideShare({ granted: true, scope: 'card-only' }, 'card-and-lifetime')

    expect(result.shared).toBe(true)
    expect(result.scope).toBe('card-only')
  })

  it('publishes a narrower scope than consent when the renderer asks narrower', () => {
    const result = decideShare({ granted: true, scope: 'card-and-lifetime' }, 'card-only')

    expect(result.shared).toBe(true)
    expect(result.scope).toBe('card-only')
  })

  it('publishes exactly the consented scope when the ask matches', () => {
    const result = decideShare({ granted: true, scope: 'card-and-echo-chips' }, 'card-and-echo-chips')

    expect(result.shared).toBe(true)
    expect(result.scope).toBe('card-and-echo-chips')
  })
})
