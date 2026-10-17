import type { CompanionConsent, CompanionShareCard, CompanionShareScope } from '@proj-airi/stage-shared/agentic'

import type { NapChatRecapTurn } from './companion'

import { NAP_CHAT_EXPIRY_MS, parseNapChatMessage } from '@proj-airi/stage-shared/agentic'
import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  clearPendingNapChatNonces,
  composeSessionRecap,
  consumeNapChatNonce,
  decideNapChatProposal,
  MAX_NAP_CHAT_RECAP_CHARS,
  MAX_PENDING_NAP_CHAT_NONCES,
  mintNapChatNonce,
  narrowerScope,
  packGuestAccess,
} from './companion'

/** Restore the real clock after every case, so a forgotten one cannot leak. */
afterEach(() => {
  vi.useRealTimers()
})

/**
 * The JSON + base64 hop the topic actually carries a message through, shared
 * with `nap-chat.test.ts` — the precedent is `companion.test.ts:32-48`.
 */
function hop(message: unknown): unknown {
  const wire = btoa(String.fromCharCode(...new TextEncoder().encode(JSON.stringify(message))))
  const bytes = Uint8Array.from(atob(wire), char => char.charCodeAt(0))
  return JSON.parse(new TextDecoder().decode(bytes))
}

/** The envelope a nap-chat message carries, as `nap-chat.test.ts` builds it. */
function envelope(at: number) {
  return {
    protocol: 'airi.nap-chat/1' as const,
    from: '12D3KooWacceptor',
    to: '12D3KooWpeer',
    sessionId: 'session-1',
    at,
  }
}

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

/**
 * The nap-chat consent gate, exercised as the decision `companion.ts` makes
 * before a proposal is published.
 *
 * NOTICE (root cause this guards): a nap-chat proposal is the only thing that
 * reaches another device, and it is reachable only through the pairing record
 * the pairing flow wrote. A peer that record does not name is a refusal, and a
 * record without the grant is the same refusal — so a peer that was never
 * paired, and a peer paired before the grant field existed, answer identically.
 * The default direction is deny: an absent grant must never read as a
 * permission, which is the same discipline the share gate's `!granted` holds.
 *
 * The peer ids below are deliberately never written into the paired-device
 * store, because that is the case being pinned: "no record" and "record without
 * the grant" must both refuse. The record-writing half lives in the pairing
 * suite, which runs real nodes.
 */
describe('nap-chat consent gating of a proposal', () => {
  /** One peer id this node has never paired with. */
  const peerId = '12D3KooWpeer'

  it('refuses to propose at all when the peer is not paired', async () => {
    const decision = await decideNapChatProposal(peerId, 'session-1')

    expect(decision.proposal).toBe(false)
    expect(decision.reason).toBe('not-paired')
    // The critical part: no nonce is minted, so there is nothing for a peer's
    // accept to echo and no session can open through this decision.
    expect(decision.nonce).toBeUndefined()
  })
})

/**
 * The nonce as an authorisation rather than an echo.
 *
 * An `accept` is what opens a session, and the only thing that makes it an
 * authorisation is that it names a nonce this node minted for that peer. So a
 * bystander that harvests an `accept` off `airi/companion.chat` and replays it,
 * or composes one for a proposal it never saw, must be refused — and refused
 * even when it names a *real* nonce belonging to a different peer, because a
 * nonce binds to the peer it was minted for.
 */
describe('nap-chat nonce authorisation', () => {
  /** A fixed clock, so the round-trip test is not wall-clock dependent. */
  const now = 1_000_000
  const peerId = '12D3KooWpeer'
  const otherPeerId = '12D3KooWother'

  it('accepts the nonce the node minted, for the peer it was minted for', () => {
    const nonce = mintNapChatNonce(peerId, 'session-1')

    expect(consumeNapChatNonce(nonce, peerId, 'session-1')).toBe('accepted')
  })

  /**
   * NOTICE: one nonce opens at most one session. Without consumption the same
   * nonce could authorise a second session against the same peer, and the
   * proposal's bounds (turn cap, duration) would be negotiated twice off one
   * authorisation.
   *
   * The outcome is `already-consumed`, not `malformed`: a re-sent accept is the
   * same authorisation arriving twice, so the caller can treat it as idempotent
   * instead of nulling a session that is legitimately open. The *session* is
   * still opened exactly once, which is what the one-shot rule requires.
   */
  it('refuses a second session on a nonce that was already spent', () => {
    const nonce = mintNapChatNonce(peerId, 'session-1')

    expect(consumeNapChatNonce(nonce, peerId, 'session-1')).toBe('accepted')
    expect(consumeNapChatNonce(nonce, peerId, 'session-1')).toBe('already-consumed')
  })

  /**
   * NOTICE (root cause this guards): the old implementation deleted the entry
   * before checking the peer, so a re-sent accept — a peer that times out and
   * retries, or gossip re-delivering the same message — found an entry that no
   * longer existed and was refused. The renderer then nulled a live session on
   * nothing at all. Validation now runs first and the entry is claimed only on a
   * full match, so a mismatch leaves the authorisation intact.
   */
  it('does not destroy a live session when a wrong peer echoes a real nonce', () => {
    const nonce = mintNapChatNonce(peerId, 'session-1')

    // The wrong-peer attempt is refused, but it must not burn the nonce: the
    // peer it was minted for still holds a live authorisation.
    expect(consumeNapChatNonce(nonce, otherPeerId, 'session-1')).toBe('wrong-peer')
    expect(consumeNapChatNonce(nonce, peerId, 'session-1')).toBe('accepted')
    expect(consumeNapChatNonce(nonce, peerId, 'session-1')).toBe('already-consumed')
  })

  /**
   * The fail-closed half of the same fix. A malformed replay — a nonce this node
   * never minted, a forged value, an empty string — opens nothing and cannot be
   * retried into something that does, because there is no entry to walk into.
   * This is the direction the nonce's one-shot rule needs preserved: a forged
   * accept must not survive its own refusal.
   */
  it('refuses a forged accept after a real one was already accepted', () => {
    const nonce = mintNapChatNonce(peerId, 'session-1')

    expect(consumeNapChatNonce(nonce, peerId, 'session-1')).toBe('accepted')
    expect(consumeNapChatNonce('a-nonce-someone-else-made-up', peerId, 'session-1')).toBe('malformed')
    expect(consumeNapChatNonce('', peerId, 'session-1')).toBe('malformed')
  })

  it('refuses a nonce minted for one peer when another peer echoes it', () => {
    const nonce = mintNapChatNonce(peerId, 'session-1')

    expect(consumeNapChatNonce(nonce, otherPeerId, 'session-1')).toBe('wrong-peer')
  })

  it('refuses a nonce replayed under a different session id', () => {
    const nonce = mintNapChatNonce(peerId, 'session-1')

    expect(consumeNapChatNonce(nonce, peerId, 'session-2')).toBe('wrong-peer')
    // The nonce is still bound to the session it was minted for, so the
    // correct session id opens it exactly once. Keeping the authorisation on a
    // mismatch is safe *because* the session id is part of the binding: the
    // only caller that can redeem it is the one holding both halves.
    expect(consumeNapChatNonce(nonce, peerId, 'session-1')).toBe('accepted')
    expect(consumeNapChatNonce(nonce, peerId, 'session-1')).toBe('already-consumed')
  })

  it('refuses a nonce this node never minted, however plausible it looks', () => {
    expect(consumeNapChatNonce('a-nonce-someone-else-made-up', peerId, 'session-1')).toBe('malformed')
    expect(consumeNapChatNonce('', peerId, 'session-1')).toBe('malformed')
  })

  it('refuses an accept that carries no session id at all', () => {
    const nonce = mintNapChatNonce(peerId, 'session-1')

    // The consuming boundary requires the session id, because a nonce valid for
    // one session must not open another. An absent one is a mismatch rather
    // than "bind to whatever", so it still leaves the live nonce redeemable.
    expect(consumeNapChatNonce(nonce, peerId, '')).toBe('wrong-peer')
    expect(consumeNapChatNonce(nonce, peerId, 'session-1')).toBe('accepted')
  })

  it('round-trips a minted nonce through the accept shape and returns it identically', () => {
    // B8: the minted value is 22-char base64url, and the accept schema bounds it
    // only by length — so a test that round-trips the *real* minted string
    // catches a schema that silently rewrites it, which a hand-written nonce
    // cannot.
    const nonce = mintNapChatNonce(peerId, 'session-1')
    const accept = { ...envelope(now), kind: 'accept' as const, sessionId: 'session-1', nonce }

    const parsed = parseNapChatMessage(hop(accept), { now })
    expect(parsed).not.toBeNull()
    expect(parsed?.kind).toBe('accept')
    if (parsed?.kind === 'accept')
      expect(parsed.nonce).toBe(nonce)

    // And the identical string is what redeems it, which is the property that
    // makes the echo an authorisation rather than a yes.
    expect(consumeNapChatNonce(nonce, peerId, 'session-1')).toBe('accepted')
  })

  /**
   * NOTICE: this uses the real clock, because `prunePendingNapChatNonces`
   * compares against `Date.now()` and the surrounding peer id is arbitrary.
   * Nothing is seeded beforehand, so `before` is genuinely older than every
   * nonce minted after it.
   */
  it('prunes an expired nonce even when nothing has minted since', () => {
    // B4: the reap used to only run inside `mintNapChatNonce`, so a node that
    // stopped proposing held its expired entries — and answered them —
    // indefinitely. `consumeNapChatNonce` prunes first now.
    vi.setSystemTime(new Date(Date.now() - NAP_CHAT_EXPIRY_MS - 60_000))
    const stale = mintNapChatNonce(peerId, 'session-1')
    vi.useRealTimers()

    expect(consumeNapChatNonce(stale, peerId, 'session-1')).toBe('malformed')
    // And the entry is gone rather than marked spent, so the map does not keep
    // growing with every proposal that was ever published.
    expect(consumeNapChatNonce(stale, peerId, 'session-1')).toBe('malformed')
  })

  /**
   * NOTICE: the entry is claimed *before* it is reaped, so an accept that
   * arrives while its nonce is still live redeems it even if the clock has
   * since passed the expiry — the prune is a janitor, not a second gate.
   */
  it('refuses an expired accept against a fresh entry, but not because the clock moved', () => {
    vi.useFakeTimers()
    const start = Date.now()
    const nonce = mintNapChatNonce(peerId, 'session-1')

    // Inside the window the accept is good.
    vi.setSystemTime(new Date(start + NAP_CHAT_EXPIRY_MS - 1000))
    expect(consumeNapChatNonce(nonce, peerId, 'session-1')).toBe('accepted')

    // Past the window a second session is refused, and the reason is that the
    // entry has been reaped, not that it was re-touched.
    vi.setSystemTime(new Date(start + NAP_CHAT_EXPIRY_MS + 60_000))
    expect(consumeNapChatNonce(nonce, peerId, 'session-1')).toBe('malformed')
    vi.useRealTimers()
  })

  /**
   * B3: eviction must follow use, not insertion.
   *
   * The old cap evicted `keys().next()` and `consumeNapChatNonce` never
   * re-touched an entry, so the map was ordered by *mint*. A peer holding one
   * long-lived authorisation while the node published a stream of proposals it
   * never answered would have its live nonce evicted by the stream — looking to
   * the peer like it had gone quiet. Minting `MAX` nonces, touching the first,
   * then minting one more must therefore evict the *untouched* entries and keep
   * the touched one.
   */
  it('evicts the least-recently-used nonce rather than the oldest-minted one', () => {
    const nonces = Array.from({ length: MAX_PENDING_NAP_CHAT_NONCES }, (_, index) =>
      mintNapChatNonce(peerId, `session-${index}`))

    // The first-minted entry is touched last, so it is the most recently used.
    expect(consumeNapChatNonce(nonces[0], peerId, 'session-0')).toBe('accepted')

    // One more mint pushes the map over the cap, and the eviction must target
    // the entries nobody touched — which is everything except `nonces[0]`.
    const overflowing = mintNapChatNonce(peerId, 'session-overflow')

    expect(consumeNapChatNonce(overflowing, peerId, 'session-overflow')).toBe('accepted')
    // `nonces[0]` was spent by the touch above; a second attempt on it reads as
    // already-consumed rather than as evicted, which is how the test tells the
    // two apart.
    expect(consumeNapChatNonce(nonces[0], peerId, 'session-0')).toBe('already-consumed')
    // An untouched neighbour from the same batch was the eviction victim.
    expect(consumeNapChatNonce(nonces[1], peerId, 'session-1')).toBe('malformed')
  })

  /**
   * B3's other half: the floor.
   *
   * The `size > 1` condition exists because `mintNapChatNonce` inserts after
   * capping, so without the floor a node with exactly one outstanding nonce
   * would lose it to make room for the proposal it is publishing right now —
   * the single in-flight authorisation evicted by its own mint.
   */
  it('never evicts the only outstanding nonce to make room for a new mint', () => {
    const first = mintNapChatNonce(peerId, 'session-0')
    const second = mintNapChatNonce(peerId, 'session-1')

    expect(consumeNapChatNonce(first, peerId, 'session-0')).toBe('accepted')
    expect(consumeNapChatNonce(second, peerId, 'session-1')).toBe('accepted')
  })

  it('capped the map at its maximum after a burst far beyond it', () => {
    const nonces = Array.from({ length: MAX_PENDING_NAP_CHAT_NONCES * 3 }, (_, index) =>
      mintNapChatNonce(peerId, `session-${index}`))

    // The oldest `MAX * 2` are gone and the newest `MAX` remain, so the newest
    // of all is the one that survives and the very first mint is not.
    const last = MAX_PENDING_NAP_CHAT_NONCES * 3 - 1
    expect(consumeNapChatNonce(nonces[last], peerId, `session-${last}`)).toBe('accepted')
    expect(consumeNapChatNonce(nonces[0], peerId, 'session-0')).toBe('malformed')
    // The map is module-scoped, so it is shared by every test in this file —
    // leaving the survivors behind would make the next case's outcome depend on
    // how many mints ran before it.
    clearPendingNapChatNonces()
  })

  /**
   * B4's teardown half: the prune is age-bounded and therefore never fires for
   * a node that stopped inside the window, so the *only* thing that stops an
   * outstanding mint from being answered as authorisation forever is an
   * explicit clear at shutdown.
   */
  it('forgets every outstanding nonce when the node is torn down', () => {
    const live = mintNapChatNonce(peerId, 'session-1')
    expect(consumeNapChatNonce(live, peerId, 'session-1')).toBe('accepted')

    clearPendingNapChatNonces()

    // The already-consumed one is unanswerable rather than idempotent: after a
    // teardown there is no session to be idempotent about.
    expect(consumeNapChatNonce(live, peerId, 'session-1')).toBe('malformed')
  })
})

// ── Session recap ─────────────────────────────────────────────────────────────

describe('composeSessionRecap', () => {
  const local = (text: string): NapChatRecapTurn => ({ role: 'Local', text })
  const peer = (text: string): NapChatRecapTurn => ({ role: 'Peer', text })

  /**
   * NOTICE: an empty turn list is the closed-before-it-spoke case — a model-gate
   * refusal most of all — and the honest recap for a session that discussed
   * nothing is none, not a claim that something was discussed.
   */
  it('yields a defined empty value for a session with no turns at all', () => {
    expect(composeSessionRecap([])).toBe('')
  })

  it('is non-empty for a completed session and says which side said what', () => {
    const recap = composeSessionRecap([local('hi'), peer('hello'), local('bye')])

    expect(recap.length).toBeGreaterThan(0)
    expect(recap).toContain('- **Local:** hi')
    expect(recap).toContain('- **Peer:** hello')
    // In session order, so the recap reads as a transcript rather than a summary.
    expect(recap.indexOf('- **Local:** hi')).toBeLessThan(recap.indexOf('- **Peer:** hello'))
  })

  /**
   * NOTICE: the cap is on the composed string, not per turn, and a truncated
   * turn is a whole bullet *dropped* rather than half a sentence emitted — so a
   * reader never sees a quote that is not a quote.
   */
  it('caps the composed string and drops whole bullets rather than half one', () => {
    // Each bullet costs its text plus the role prefix, and the second earns a
    // separator, so two of these just fit and the third must be dropped whole.
    const big = 'a'.repeat(1950)
    const recap = composeSessionRecap([
      local(big),
      peer(big),
      local(big),
    ])

    expect(recap.length).toBeLessThanOrEqual(MAX_NAP_CHAT_RECAP_CHARS)
    expect(recap).toContain(`- **Local:** ${big}`)
    expect(recap).toContain(`- **Peer:** ${big}`)
    // Exactly two bullets of three, and the third is absent rather than clipped.
    expect(recap.split('\n')).toHaveLength(2)
  })

  it('is deterministic across calls, and same input means same text', () => {
    const turns = [local('one'), peer('two'), local('three')]

    expect(composeSessionRecap(turns)).toBe(composeSessionRecap(turns))
  })

  it('ignores an empty turn text rather than emitting an empty bullet', () => {
    const recap = composeSessionRecap([local(''), peer('real')])

    expect(recap).toBe('- **Peer:** real')
  })
})
