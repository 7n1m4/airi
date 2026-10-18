import type { SpeechSegmentPlaybackPayload } from './playback-events'

import { afterEach, describe, expect, it } from 'vitest'

import { getSpeechBusContext, speechSegmentPlaybackEvent } from './playback-events'

describe('playback-events', () => {
  afterEach(() => {
    // no-op cleanup; context is module singleton
  })

  it('exports speechSegmentPlaybackEvent', () => {
    expect(speechSegmentPlaybackEvent).toBeDefined()
    expect(typeof speechSegmentPlaybackEvent).toBe('object')
  })

  it('getSpeechBusContext returns a context with emit/on', () => {
    const ctx = getSpeechBusContext()
    expect(ctx).toBeDefined()
    expect(typeof ctx.emit).toBe('function')
    expect(typeof ctx.on).toBe('function')
  })

  it('getSpeechBusContext is singleton', () => {
    const a = getSpeechBusContext()
    const b = getSpeechBusContext()
    expect(a).toBe(b)
  })

  it('can emit speechSegmentPlaybackEvent without throwing', () => {
    const ctx = getSpeechBusContext()
    const payload: SpeechSegmentPlaybackPayload = {
      originId: 'o',
      intentId: 'i',
      streamId: 's',
      segmentId: 'seg',
      text: 'hello',
    }
    expect(() => ctx.emit(speechSegmentPlaybackEvent, payload)).not.toThrow()
  })

  it('can subscribe and unsubscribe', () => {
    const ctx = getSpeechBusContext()
    const off = ctx.on(speechSegmentPlaybackEvent, () => {})
    expect(typeof off).toBe('function')
    off()
  })
})
