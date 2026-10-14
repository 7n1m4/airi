import type { AiriCard } from './modules/airi-card'
import type { PresenceStore } from './presence'

import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { useAiriCardStore } from './modules/airi-card'
import { usePresenceStore } from './presence'

/**
 * Presence as the single source of truth for "is the user here".
 *
 * These tests exercise the store (not the pure `derivePresenceState`, which
 * `presence.test.ts` already covers): who may write the raw idle signal, how
 * registered providers resolve into one reading, and whether a consumer's call
 * stays stable while providers come and go.
 */

vi.mock('@proj-airi/electron-vueuse', () => ({
  useElectronEventaInvoke: () => async () => undefined,
}))

vi.mock('@proj-airi/stage-shared', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@proj-airi/stage-shared')>()
  return {
    ...actual,
    debug: vi.fn(),
    isElectronWindow: () => false,
    isWithinSchedule: vi.fn(() => true),
    sensorsGetActiveWindow: vi.fn(),
    sensorsGetActiveWindowHistory: vi.fn(() => []),
    sensorsGetIdleTime: vi.fn(async () => 0),
    sensorsGetLocalTime: vi.fn(() => '12:00'),
    sensorsGetSystemLoad: vi.fn(),
    sensorsGetVolumeLevel: vi.fn(() => 50),
    sensorsSetTrackingEnabled: vi.fn(),
  }
})

vi.mock('../database/repos/chat-sessions.repo', () => ({
  chatSessionsRepo: {
    getIndex: vi.fn(() => ({ characters: {} })),
    getSession: vi.fn(async () => null),
  },
}))

vi.mock('../database/storage', () => ({
  storage: {
    getItem: vi.fn(async () => null),
    setItem: vi.fn(async () => {}),
  },
}))

vi.mock('vue-i18n', () => ({
  useI18n: () => ({
    t: (key: string) => key,
  }),
}))

describe('presence store is the single writer of the raw idle signal', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    setActivePinia(createPinia())
  })

  it('exposes only a derived read of the raw signal, never a settable ref', () => {
    const presence = usePresenceStore()
    expect(presence.rawIdleTimeSec).toBeUndefined()
    expect(presence.idleTimeSec).toBeNull()

    const exposedKeys = Object.keys(presence)
    expect(exposedKeys).toContain('writeIdleTimeSec')
    expect(exposedKeys).toContain('refreshIdleTimeOnce')
    // A single writer means there is no other exported setter for the value.
    expect(exposedKeys.filter(key => /^set[A-Z].*Idle|^.*IdleTime$/.test(key))).toEqual([])
  })

  it('ignores a non-numeric reading rather than resetting presence to active', () => {
    const presence = usePresenceStore()
    presence.writeIdleTimeSec(120)
    expect(presence.rawIdleTimeSec).toBe(120)

    presence.writeIdleTimeSec(undefined)
    expect(presence.rawIdleTimeSec).toBe(120)
  })

  it('recomputes the snapshot from the resolved thresholds', () => {
    const presence = usePresenceStore()
    presence.writeIdleTimeSec(200)
    expect(presence.presenceState).toBe('idle')
    expect(presence.presence.signals.idleTimeSec).toBe(200)
  })

  it('resolves the AFK threshold from the active card', () => {
    const presence = usePresenceStore()
    expect(presence.afkThresholdMinutes).toBe(5)

    const cardStore = useAiriCardStore()
    const card: AiriCard = {
      name: 'Test',
      extensions: { airi: { heartbeats: { afkThresholdMinutes: 15 } } },
    } as AiriCard
    cardStore.cards.set('test-card', card)
    cardStore.activeCardId = 'test-card'

    expect(presence.afkThresholdMinutes).toBe(15)
    expect(presence.afk).toBe(false)
    expect(presence.isUserAway()).toBe(false)
  })

  it('isUserAway(minutes) falls back to 5 exactly as the old inline expression did', () => {
    const presence = usePresenceStore()
    presence.writeIdleTimeSec(299)

    // `0 || 5 === 5` and `NaN || 5 === 5` — the same fallback the old inline
    // expression `(config.afkThresholdMinutes || 5) * 60` applied. A negative
    // value is truthy so it *is* used verbatim, exactly as before.
    expect(presence.isUserAway(0)).toBe(false)
    expect(presence.isUserAway(Number.NaN)).toBe(false)
    // Below the reading (299s) clears; at or above it does not.
    expect(presence.isUserAway(3)).toBe(true)
    expect(presence.isUserAway(5)).toBe(false)
    expect(presence.isUserAway(15)).toBe(false)
    expect(presence.isUserAway(-3)).toBe(true)
  })

  it('isUserAway never asserts the user is gone without a reading', () => {
    const presence = usePresenceStore()
    expect(presence.isUserAway()).toBe(false)
    expect(presence.isUserAway(1)).toBe(false)
  })
})

describe('presence signal providers', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    setActivePinia(createPinia())
  })

  it('starts with no providers registered, so nothing reads the user', () => {
    const presence = usePresenceStore()
    expect(presence.signalProviders).toEqual([])
    expect(presence.presence.signals.hasIdleTime).toBe(false)
  })

  it('takes the largest idle reading when several providers answer', async () => {
    const presence = usePresenceStore()
    presence.addSignalProvider({ id: 'a', readIdleSec: () => 10 })
    presence.addSignalProvider({ id: 'b', readIdleSec: () => 90 })

    expect(typeof (await presence.readIdleTimeOnce())).toBe('number')
    expect(await presence.readIdleTimeOnce()).toBe(90)
  })

  it('skips providers that cannot answer', async () => {
    const presence = usePresenceStore()
    presence.addSignalProvider({ id: 'silent', readIdleSec: () => undefined })
    presence.addSignalProvider({ id: 'answerer', readIdleSec: () => 12 })

    expect(await presence.readIdleTimeOnce()).toBe(12)
  })

  it('does not duplicate a provider id', () => {
    const presence = usePresenceStore()
    const provider = { id: 'os-idle-time', readIdleSec: () => 1 }
    presence.addSignalProvider(provider)
    presence.addSignalProvider(provider)

    expect(presence.signalProviders).toHaveLength(1)
  })

  it('refreshIdleTimeOnce writes the provider reading into the single writer', async () => {
    const presence = usePresenceStore()
    presence.addSignalProvider({ id: 'os-idle-time', readIdleSec: () => 3 })

    await presence.refreshIdleTimeOnce()
    expect(presence.rawIdleTimeSec).toBe(3)
  })

  it('rejects when every provider throws and none answered', async () => {
    const presence = usePresenceStore()
    presence.addSignalProvider({
      id: 'boom',
      readIdleSec: async () => {
        throw new Error('nope')
      },
    })

    await expect(presence.readIdleTimeOnce()).rejects.toThrow('nope')
  })
})

describe('adding or removing a signal provider changes no consumer call', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    setActivePinia(createPinia())
  })

  /** The canonical consumer call: AFK predicate + snapshot state. */
  function readConsumerApi(presence: PresenceStore) {
    return {
      afk: presence.afk,
      isUserAway: presence.isUserAway(),
      state: presence.presenceState,
    }
  }

  it('keeps the consumer API shape stable across provider add/remove', async () => {
    const presence = usePresenceStore()
    const before = readConsumerApi(presence)
    expect(Object.keys(before)).toEqual(['afk', 'isUserAway', 'state'])

    presence.addSignalProvider({
      id: 'global-native-input',
      readIdleSec: () => 600,
      readLockState: () => 'unlocked',
      readSleepState: () => 'awake',
    })
    await presence.refreshIdleTimeOnce()

    presence.removeSignalProvider('global-native-input')

    // Same keys, same types — the new provider never reached into a consumer.
    const after = readConsumerApi(presence)
    expect(Object.keys(after)).toEqual(Object.keys(before))
    expect(typeof after.afk).toBe('boolean')
    expect(typeof after.isUserAway).toBe('boolean')
  })

  it('promotes lock/sleep from unavailable to derivable once a provider answers', () => {
    const presence = usePresenceStore()
    expect(presence.availability['screen-locked']).toBe('unavailable')
    expect(presence.availability.sleep).toBe('unavailable')
    expect(presence.derivableStates).toEqual(['active', 'idle', 'away'])

    presence.addSignalProvider({ id: 'power-events', readIdleSec: () => 0, readSleepState: () => 'awake' })
    presence.writeIdleTimeSec(60)

    expect(presence.availability.sleep).toBe('derivable')
    expect(presence.derivableStates).toContain('sleep')
  })
})
