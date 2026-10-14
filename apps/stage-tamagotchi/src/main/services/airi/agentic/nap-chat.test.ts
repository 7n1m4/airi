import type { NapChatMessage } from '@proj-airi/stage-shared/agentic'

import {
  isNapChatProposalFor,
  NAP_CHAT_DEFAULT_DURATION_MS,
  NAP_CHAT_EXPIRY_MS,
  NAP_CHAT_MAX_TURN_CAP,
  NAP_CHAT_TOPIC,
  parseNapChatMessage,
} from '@proj-airi/stage-shared/agentic'
import { describe, expect, it } from 'vitest'

/**
 * The wire hop a nap-chat message actually makes: JSON → UTF-8 bytes → base64
 * → the topic → back. `companion.test.ts:32-48` is the precedent, and it exists
 * because a schema that agrees with the publisher only until JSON touches it
 * looks healthy while every receiver drops the payload.
 */
function hop(message: unknown): unknown {
  const wire = btoa(String.fromCharCode(...new TextEncoder().encode(JSON.stringify(message))))
  const bytes = Uint8Array.from(atob(wire), char => char.charCodeAt(0))
  return JSON.parse(new TextDecoder().decode(bytes))
}

/** The envelope common to all five shapes, as a publisher emits it. */
function envelope(at: number) {
  return {
    protocol: 'airi.nap-chat/1' as const,
    from: '12D3KooWproposer',
    to: '12D3KooWacceptor',
    sessionId: 'session-1',
    at,
  }
}

/** A proposal as a publisher emits it, at a fixed instant. */
function proposal(at: number): NapChatMessage {
  return {
    ...envelope(at),
    kind: 'proposal',
    turnCap: 6,
    durationMs: NAP_CHAT_DEFAULT_DURATION_MS,
    nonce: 'nonce-abc',
  }
}

/** Any nap-chat message, with the field lists the five shapes actually use. */
function turn(at: number, seq = 0, text = 'hello there'): NapChatMessage {
  return {
    ...envelope(at),
    kind: 'turn',
    seq,
    text,
  }
}

describe('the nap-chat topic', () => {
  it('is the topic the design names, and not the share topic', () => {
    // The two topics must differ: reusing `airi/companion` for a directed
    // two-party session would put companion chatter in front of every peer.
    expect(NAP_CHAT_TOPIC).toBe('airi/companion.chat')
    expect(NAP_CHAT_TOPIC).not.toBe('airi/companion')
  })
})

describe('parseNapChatMessage', () => {
  const now = 1_000_000

  it('round-trips every shape through the JSON + base64 hop the topic uses', () => {
    const messages: NapChatMessage[] = [
      proposal(now),
      { ...envelope(now), kind: 'accept', nonce: 'nonce-abc' },
      { ...envelope(now), kind: 'decline', reason: 'not-napping' },
      turn(now, 1),
      { ...envelope(now), kind: 'close', reason: 'completed' },
    ]

    for (const message of messages) {
      const parsed = parseNapChatMessage(hop(message), { now })
      expect(parsed).not.toBeNull()
      expect(parsed).toEqual(message)
    }
  })

  it('round-trips a proposal as the publisher actually emits it', () => {
    const parsed = parseNapChatMessage(hop(proposal(now)), { now })

    expect(parsed).not.toBeNull()
    expect(parsed?.kind).toBe('proposal')
    // The bounds a peer must agree on before the first turn is generated, so
    // dropping or rewriting one of these is a contract break.
    expect(parsed).toMatchObject({
      turnCap: 6,
      durationMs: NAP_CHAT_DEFAULT_DURATION_MS,
      nonce: 'nonce-abc',
      from: '12D3KooWproposer',
      to: '12D3KooWacceptor',
    })
  })

  /**
   * NOTICE: the whole point of a single shared schema. `decline` and `close`
   * carry the same field list, so a parser that discriminates on anything but
   * `kind` accepts one as the other — and the wire then cannot tell "the peer
   * refused the invitation" from "the session ended".
   */
  it('tells a decline from a close by kind, not by field list', () => {
    const decline: NapChatMessage = { ...envelope(now), kind: 'decline', reason: 'not-napping' }
    const close: NapChatMessage = { ...envelope(now), kind: 'close', reason: 'not-napping' }

    expect(parseNapChatMessage(hop(decline), { now })).toEqual(decline)
    expect(parseNapChatMessage(hop(close), { now })).toEqual(close)
  })

  it('rejects a turn above the announced turnCap', () => {
    // `turnCap` is 6 turns total, 0-based, so `seq: 6` is the seventh turn.
    expect(parseNapChatMessage(hop(turn(now, NAP_CHAT_MAX_TURN_CAP - 1)), { now })).not.toBeNull()
    expect(parseNapChatMessage(hop(turn(now, NAP_CHAT_MAX_TURN_CAP)), { now })).toBeNull()
  })

  it('checks a turn against the session cap the caller passes, not the ceiling', () => {
    // A proposal may announce a narrower cap than the design's maximum, and every
    // later turn is then bounded by the announcement.
    expect(parseNapChatMessage(hop(turn(now, 2)), { now, maxSeq: 2 })).not.toBeNull()
    expect(parseNapChatMessage(hop(turn(now, 3)), { now, maxSeq: 2 })).toBeNull()
  })

  it('rejects a stale turn', () => {
    const staleAt = now - NAP_CHAT_EXPIRY_MS - 1
    expect(parseNapChatMessage(hop(turn(staleAt)), { now })).toBeNull()
    // Exactly on the bound is still live.
    expect(parseNapChatMessage(hop(turn(now - NAP_CHAT_EXPIRY_MS)), { now })).not.toBeNull()
  })

  it('rejects a turn stamped in the future', () => {
    // A peer that stamps `at` ahead of the local clock would otherwise keep its
    // own messages alive for that offset.
    expect(parseNapChatMessage(hop(turn(now + 1)), { now })).toBeNull()
  })

  it('rejects a non-finite at', () => {
    const parsed = parseNapChatMessage(hop({ ...turn(now), at: Number.NaN }), { now })
    expect(parsed).toBeNull()
  })

  it('rejects an unknown protocol version rather than parsing it as this one', () => {
    const future = { ...turn(now), protocol: 'airi.nap-chat/2' }
    expect(parseNapChatMessage(hop(future), { now })).toBeNull()
  })

  it('rejects an unknown kind', () => {
    const unknown = { ...turn(now), kind: 'replay' }
    expect(parseNapChatMessage(hop(unknown), { now })).toBeNull()
  })

  it('rejects a payload that is not an object', () => {
    expect(parseNapChatMessage(null, { now })).toBeNull()
    expect(parseNapChatMessage('proposal', { now })).toBeNull()
  })

  it('rejects a proposal missing the nonce an accept must echo', () => {
    const { nonce: _nonce, ...withoutNonce } = proposal(now)
    expect(parseNapChatMessage(hop(withoutNonce), { now })).toBeNull()
  })

  it('rejects an empty turn text rather than treating it as silence', () => {
    expect(parseNapChatMessage(hop(turn(now, 0, '')), { now })).toBeNull()
  })

  /**
   * NOTICE: the negative control for §5's leak boundary. The wire shape has no
   * memory field, and every member of the schema is a `strictObject`, so a peer
   * cannot widen the shape to carry one: an unknown key is a rejection, not a
   * field that is silently dropped and reported as a valid turn. Silently
   * dropping it would be the worse failure — it would look like the turn
   * round-tripped while the memory alongside it vanished.
   */
  it('rejects a turn carrying chip-, journal- or lifetime-shaped fields', () => {
    const withChips = {
      ...turn(now),
      chips: [{ id: 'chip-1', content: 'a private memory', relevanceScore: 0.9 }],
    }
    const withJournal = { ...turn(now), journalEntry: 'a journal entry body' }
    const withLifetime = { ...turn(now), lifetimeDistilled: 'a distilled lifetime summary' }
    const withEchoChips = { ...turn(now), echoChips: [{ id: 'e', content: 'c', type: 'mood', relevanceScore: 1 }] }
    const withSnapshot = { ...turn(now), guestSnapshot: { echoChips: [], lifetimeDistilled: 'd' } }

    for (const widened of [withChips, withJournal, withLifetime, withEchoChips, withSnapshot]) {
      expect(parseNapChatMessage(hop(widened), { now })).toBeNull()
    }
  })

  it('rejects a proposal widened with memory fields too, not only a turn', () => {
    const widened = {
      ...proposal(now),
      journalEntry: 'a journal entry body',
      distilledContent: 'the lifetime archive',
    }
    expect(parseNapChatMessage(hop(widened), { now })).toBeNull()
  })

  it('rejects an accept that drops the nonce it was supposed to echo', () => {
    const { nonce: _nonce, ...withoutNonce } = { ...envelope(now), kind: 'accept' as const, nonce: 'nonce-abc' }
    expect(parseNapChatMessage(hop(withoutNonce), { now })).toBeNull()
  })
})

/**
 * The narrow type guard over any parsed message.
 *
 * NOTICE: `airi/companion.chat` is one topic every subscribed peer sees, so the
 * question "did *this node* get invited" is not "is this a proposal" — it is
 * "is this a proposal whose `to` is my peer id". A peer that treated any
 * proposal on the topic as its own would answer invitations to other peers, and
 * the mesh would open sessions between nodes that never asked for one.
 */
describe('isNapChatProposalFor', () => {
  const now = 1_000_000

  it('answers true only for a proposal addressed to this node', () => {
    const parsed = parseNapChatMessage(hop(proposal(now)), { now })!
    expect(parsed).not.toBeNull()

    expect(isNapChatProposalFor(parsed, '12D3KooWacceptor')).toBe(true)
    expect(isNapChatProposalFor(parsed, '12D3KooWbystander')).toBe(false)
  })

  it('answers false for every other kind, even one addressed to this node', () => {
    const turnForMe: NapChatMessage = { ...turn(now), to: '12D3KooWacceptor' }
    const closeForMe: NapChatMessage = { ...envelope(now), to: '12D3KooWacceptor', kind: 'close' }

    expect(isNapChatProposalFor(turnForMe, '12D3KooWacceptor')).toBe(false)
    expect(isNapChatProposalFor(closeForMe, '12D3KooWacceptor')).toBe(false)
  })

  it('narrows the type so the proposal fields are reachable without a cast', () => {
    const parsed = parseNapChatMessage(hop(proposal(now)), { now })!

    if (isNapChatProposalFor(parsed, '12D3KooWacceptor')) {
      // Compiles only if the guard narrows to the proposal shape, which is what
      // lets a later phase read the announced bounds off the record without
      // re-deriving them from a union.
      expect(parsed.turnCap).toBe(6)
      expect(parsed.durationMs).toBe(NAP_CHAT_DEFAULT_DURATION_MS)
      expect(parsed.nonce).toBe('nonce-abc')
    }
  })
})
