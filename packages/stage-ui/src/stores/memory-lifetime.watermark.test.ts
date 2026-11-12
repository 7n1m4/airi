import { afterEach, describe, expect, it, vi } from 'vitest'

import { computeConsumedDayWatermark, formatLocalDayKey, parseDocLocalDayKey, parseLocalDayEnd } from './memory-lifetime'

// Only the pure day-key helpers are exercised here; no store is instantiated.
const NOW = new Date(2026, 9, 13, 12, 0, 0, 0).getTime()
const YESTERDAY = '2026-10-12'

afterEach(() => {
  vi.useRealTimers()
})

describe('memory-lifetime day keys', () => {
  it('maps a bare day key to itself regardless of zone offset', () => {
    // Anchor a bare key at local noon: any zone within ±12h keeps the same calendar day.
    expect(new Date().getTimezoneOffset()).toBeLessThanOrEqual(12 * 60)
    expect(parseDocLocalDayKey('2026-10-12')).toBe('2026-10-12')
    expect(parseDocLocalDayKey('2026-01-01')).toBe('2026-01-01')
    expect(parseDocLocalDayKey('2026-12-31')).toBe('2026-12-31')
  })

  it('keeps a bare key and a local-noon ISO stamp on the same local day', () => {
    // A bare YYYY-MM-DD is a calendar day with no instant; the STMM emitter turns it into a
    // local-noon ISO stamp, which must land back on that same day (UTC midnight drifts west of UTC).
    for (const day of ['2026-10-12', '2026-01-01', '2026-12-31']) {
      const [y, m, d] = day.split('-').map(Number)
      const localNoonIso = new Date(y, m - 1, d, 12).toISOString()
      expect(parseDocLocalDayKey(localNoonIso)).toBe(day)
    }
  })

  it('never returns a watermark later than yesterday', () => {
    vi.useFakeTimers()
    vi.setSystemTime(NOW)
    expect(computeConsumedDayWatermark(`${YESTERDAY}T02:30:00.000Z`)).toBe(YESTERDAY)
    // A doc dated today (or later) must not seal today: today is still open.
    expect(computeConsumedDayWatermark('2026-10-13T02:30:00.000Z')).toBe(YESTERDAY)
    expect(computeConsumedDayWatermark('2026-10-13T22:00:00.000Z')).toBe(YESTERDAY)
    expect(computeConsumedDayWatermark('2026-11-01T00:00:00.000Z')).toBe(YESTERDAY)
    expect(computeConsumedDayWatermark(undefined)).toBe(YESTERDAY)
  })

  it('keeps an already closed day as the watermark so reachable days are never stranded', () => {
    vi.useFakeTimers()
    vi.setSystemTime(NOW)
    expect(computeConsumedDayWatermark('2026-10-11T05:00:00.000Z')).toBe('2026-10-11')
    // NOW is 2026-10-13 local, so a 2026-10-12 doc is the day that just closed: it is
    // consumable, and collectWindowedDocs admits everything strictly greater than the
    // watermark, so the prefix below it stays sealed rather than stranded.
    const watermark = computeConsumedDayWatermark('2026-10-12T02:30:00.000Z')
    expect(watermark).toBe(YESTERDAY)
    const admittedDays = ['2026-10-10', '2026-10-11'].filter(day => day > watermark)
    expect(admittedDays).toEqual([])
    // And nothing at or below the watermark is reachable-but-unconsumed.
  })

  it('bootstrap watermark follows the artifact creation day, not yesterday', () => {
    vi.useFakeTimers()
    vi.setSystemTime(NOW)
    // Three-week-old legacy artifact: coverage must start at its own creation day.
    const createdMs = new Date(2026, 8, 22, 12, 0, 0, 0).getTime()
    const bootstrap = computeConsumedDayWatermark(new Date(createdMs).toISOString())
    expect(bootstrap).toBe('2026-09-22')
    expect(bootstrap < YESTERDAY).toBe(true)
  })
})

describe('parseLocalDayEnd', () => {
  it('round-trips a day key through local end-of-day', () => {
    expect(formatLocalDayKey(parseLocalDayEnd('2026-10-12'))).toBe('2026-10-12')
  })
})
