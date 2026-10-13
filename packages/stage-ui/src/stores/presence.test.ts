import { describe, expect, it } from 'vitest'

import { AWAY_THRESHOLD_MINUTES, derivePresenceState, IDLE_THRESHOLD_MINUTES, resolveAfkThresholdMinutes } from './presence'

const MINUTE = 60

function derive(overrides: { idleTimeSec?: number | null | undefined, afkThresholdMinutes?: number, lockSignal?: 'locked' | 'unlocked' | null, sleepSignal?: 'awake' | 'asleep' | null } = {}) {
  return derivePresenceState({
    afkThresholdMinutes: AWAY_THRESHOLD_MINUTES,
    idleTimeSec: overrides.idleTimeSec === undefined ? 0 : overrides.idleTimeSec,
    lockSignal: overrides.lockSignal,
    sleepSignal: overrides.sleepSignal,
    ...(overrides.afkThresholdMinutes !== undefined ? { afkThresholdMinutes: overrides.afkThresholdMinutes } : {}),
  }).state
}

describe('derivePresenceState', () => {
  it('reports active while there is recent input', () => {
    expect(derive({ idleTimeSec: 10 })).toBe('active')
  })

  it('reports idle at the card AFK threshold', () => {
    // The AFK value is the *same* field the heartbeat gate reads, so presence
    // and heartbeats cannot disagree about when the user stepped away.
    expect(derive({ idleTimeSec: 5 * MINUTE })).toBe('idle')
  })

  it('reports idle at the quiet-input floor, below the card AFK threshold', () => {
    expect(derive({ idleTimeSec: IDLE_THRESHOLD_MINUTES * MINUTE, afkThresholdMinutes: 5 })).toBe('idle')
  })

  it('does not report idle before the quiet-input floor', () => {
    expect(derive({ idleTimeSec: (IDLE_THRESHOLD_MINUTES - 1) * MINUTE })).toBe('active')
  })

  it('honours a stricter card AFK threshold', () => {
    expect(derive({ idleTimeSec: 10 * MINUTE, afkThresholdMinutes: 12 })).toBe('idle')
  })

  it('still reports idle at the quiet-input floor long before a stricter card AFK threshold', () => {
    // `idle` is a pre-AFK state, so a stricter card threshold cannot suspend it:
    // while the user may still be reading, the companion must not act.
    expect(derive({ idleTimeSec: 5 * MINUTE, afkThresholdMinutes: 12 })).toBe('idle')
  })

  it('keeps idle below the away threshold', () => {
    // AFK and away are different claims: the card tunes the first, the second is
    // a fixed unattended floor so a companion cannot be configured to treat a
    // busy desk as away.
    expect(derive({ idleTimeSec: (AWAY_THRESHOLD_MINUTES - 5) * MINUTE })).toBe('idle')
  })

  it('reports away at the away threshold', () => {
    expect(derive({ idleTimeSec: AWAY_THRESHOLD_MINUTES * MINUTE })).toBe('away')
  })

  it('keeps a card-configured long AFK threshold from widening the away floor', () => {
    expect(derive({ idleTimeSec: 20 * MINUTE, afkThresholdMinutes: 45 })).toBe('idle')
  })

  it('reports screen-locked when the OS lock signal is present', () => {
    expect(derive({ idleTimeSec: 10, lockSignal: 'locked' })).toBe('screen-locked')
  })

  it('ignores an unlocked lock signal and defers to idle time', () => {
    expect(derive({ idleTimeSec: 10, lockSignal: 'unlocked' })).toBe('active')
  })

  it('prefers sleep over screen-locked because a suspended machine is also locked', () => {
    expect(derive({ idleTimeSec: 10, lockSignal: 'locked', sleepSignal: 'asleep' })).toBe('sleep')
  })

  it('prefers sleep over a long idle time', () => {
    expect(derive({ idleTimeSec: 4 * 60 * MINUTE, sleepSignal: 'asleep' })).toBe('sleep')
  })

  it('falls back to active when no idle signal exists', () => {
    // Honest default: an unobserved machine counts as active, so absence of
    // telemetry never grants unattended authority.
    expect(derive({ idleTimeSec: null })).toBe('active')
  })

  it('never clamps the away threshold below one minute', () => {
    // A hostile or corrupt card config must not collapse every state to idle
    // and make the companion treat a busy desk as away.
    expect(derive({ idleTimeSec: 0, afkThresholdMinutes: 0 })).toBe('active')
  })

  it('exposes a reason for the chosen state', () => {
    expect(derivePresenceState({ idleTimeSec: null, afkThresholdMinutes: 5 }).reason).toBeTruthy()
  })
})

describe('resolveAfkThresholdMinutes', () => {
  it('reads the same field the heartbeat gate uses', () => {
    expect(resolveAfkThresholdMinutes({ airi: { heartbeats: { afkThresholdMinutes: 12 } } })).toBe(12)
  })

  it('falls back when the card omits the extension', () => {
    expect(resolveAfkThresholdMinutes(undefined)).toBe(5)
    expect(resolveAfkThresholdMinutes(null)).toBe(5)
    expect(resolveAfkThresholdMinutes({})).toBe(5)
    expect(resolveAfkThresholdMinutes({ airi: {} })).toBe(5)
  })

  it('falls back when the card value is non-finite or non-positive', () => {
    expect(resolveAfkThresholdMinutes({ airi: { heartbeats: { afkThresholdMinutes: Number.NaN } } })).toBe(5)
    expect(resolveAfkThresholdMinutes({ airi: { heartbeats: { afkThresholdMinutes: 0 } } })).toBe(5)
    expect(resolveAfkThresholdMinutes({ airi: { heartbeats: { afkThresholdMinutes: -3 } } })).toBe(5)
  })
})
