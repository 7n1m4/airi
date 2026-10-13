import { parseCompanionShare } from '@proj-airi/stage-shared/agentic'
import { describe, expect, it } from 'vitest'

import { narrowerScope, packGuestAccess } from './companion'

/**
 * A share exactly as `publishCompanionShare` builds it: `publishedAt` is
 * `Date.now()`, a **number** epoch.
 */
const publishedShare = {
  type: 'companion-share',
  cardId: 'card-1',
  name: 'AIRI Companion',
  description: 'a companion',
  portraitBase64: 'AAAA',
  hostPeerId: '12D3KooWpeer',
  publishedAt: Date.now(),
  scope: 'card-only',
}

describe('parseCompanionShare', () => {
  /**
   * NOTICE (root cause of the regression this guards): the wire schema declared
   * `publishedAt: string()` while `publishCompanionShare` sends
   * `Date.now()`, a number, and `CompanionShareCard.publishedAt` is also a
   * number. `safeParse` returns `{ success: false }` silently, so every share
   * this node published was dropped by every receiver with no error anywhere —
   * the mesh looked like it was sharing while nothing round-tripped. All three
   * sides now agree on `number`, and this test pins the published shape end to
   * end rather than pinning the schema's field list.
   */
  it('round-trips a share as the publisher actually emits it', () => {
    const parsed = parseCompanionShare(publishedShare)

    expect(parsed).not.toBeNull()
    expect(parsed?.publishedAt).toBe(publishedShare.publishedAt)
    expect(parsed?.cardId).toBe('card-1')
    expect(parsed?.name).toBe('AIRI Companion')
    expect(parsed?.hostPeerId).toBe('12D3KooWpeer')
    expect(parsed?.scope).toBe('card-only')
  })

  it('round-trips a published share through JSON, as the topic does', () => {
    const wire = JSON.stringify(publishedShare)
    const parsed = parseCompanionShare(JSON.parse(wire))

    expect(parsed?.publishedAt).toBe(publishedShare.publishedAt)
  })

  it('accepts a share without the optional fields', () => {
    const parsed = parseCompanionShare({
      type: 'companion-share',
      cardId: 'c',
      name: 'n',
      hostPeerId: 'p',
      publishedAt: 1,
      scope: 'card-only',
    })

    expect(parsed).not.toBeNull()
    expect(parsed?.description).toBeUndefined()
    expect(parsed?.portraitBase64).toBeUndefined()
  })

  it('rejects a publishedAt that is a string', () => {
    // The exact inversion of the original bug: a string must not silently
    // coerce, because the publisher must never emit this shape.
    expect(parseCompanionShare({ ...publishedShare, publishedAt: String(publishedShare.publishedAt) })).toBeNull()
  })

  it('rejects a non-finite publishedAt', () => {
    expect(parseCompanionShare({ ...publishedShare, publishedAt: Number.NaN })).toBeNull()
  })

  it('rejects an unknown scope rather than defaulting to a narrower one', () => {
    // A scope the host never consented to must not be accepted as `card-only`.
    expect(parseCompanionShare({ ...publishedShare, scope: 'card-and-everything' })).toBeNull()
  })

  it('rejects a payload that is not an object', () => {
    expect(parseCompanionShare(null)).toBeNull()
    expect(parseCompanionShare(undefined)).toBeNull()
    expect(parseCompanionShare('share')).toBeNull()
  })

  it('rejects a payload missing a required field', () => {
    expect(parseCompanionShare({ ...publishedShare, hostPeerId: undefined })).toBeNull()
    expect(parseCompanionShare({ ...publishedShare, name: undefined })).toBeNull()
  })
})

describe('narrowerScope', () => {
  it('returns the host scope when the guest asks for more', () => {
    // The guest boundary: a visit can only narrow, never widen.
    expect(narrowerScope('card-only', 'card-and-lifetime')).toBe('card-only')
  })

  it('returns the requested scope when the host consented to at least it', () => {
    expect(narrowerScope('card-and-lifetime', 'card-and-echo-chips')).toBe('card-and-echo-chips')
  })

  it('is symmetric in the sense that it always returns the minimum', () => {
    expect(narrowerScope('card-and-echo-chips', 'card-only')).toBe('card-only')
    expect(narrowerScope('card-only', 'card-only')).toBe('card-only')
  })
})

describe('packGuestAccess', () => {
  const card = { cardId: 'c', name: 'n', hostPeerId: 'p', publishedAt: 1, scope: 'card-only' as const }
  const chips = [{ id: 'chip-1', type: 'mood', content: 'a memory', relevanceScore: 0.9 }]
  const lifetime = 'a long distilled relationship summary'

  it('gives a card-only guest no memory at all', () => {
    const access = packGuestAccess({ card, scope: 'card-only', echoChips: chips, lifetimeDistilled: lifetime })

    expect(access.echoChips).toEqual([])
    expect(access.lifetimeSummary).toBeUndefined()
  })

  it('gives an echo-chip guest the chips but not the lifetime archive', () => {
    const access = packGuestAccess({ card, scope: 'card-and-echo-chips', echoChips: chips, lifetimeDistilled: lifetime })

    expect(access.echoChips).toEqual(chips)
    expect(access.lifetimeSummary).toBeUndefined()
  })

  it('gives a lifetime guest the distilled summary but never the raw archive', () => {
    const access = packGuestAccess({ card, scope: 'card-and-lifetime', echoChips: chips, lifetimeDistilled: lifetime })

    expect(access.echoChips).toEqual(chips)
    expect(access.lifetimeSummary).toBe(lifetime)
    // The point of the boundary: the distilled essence is bounded, so a dense
    // archive cannot become an unbounded share.
    expect((access.lifetimeSummary ?? '').length).toBeLessThanOrEqual(4000)
  })

  it('treats an unloaded pillar as empty rather than failing', () => {
    const access = packGuestAccess({ card, scope: 'card-and-echo-chips' })
    expect(access.echoChips).toEqual([])
  })

  it('omits the lifetime summary when the host has no artifact yet', () => {
    const access = packGuestAccess({ card, scope: 'card-and-lifetime' })
    expect(access.lifetimeSummary).toBeUndefined()
  })
})
