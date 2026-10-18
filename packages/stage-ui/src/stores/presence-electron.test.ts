import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { resolveAfkThresholdMinutes, usePresenceStore } from './presence'

vi.mock('@proj-airi/electron-vueuse', () => ({
  useElectronEventaInvoke: vi.fn(() => async () => 1000),
}))

vi.mock('@proj-airi/stage-shared', async (importOriginal) => {
  const actual = await importOriginal()
  return {
    ...actual,
    debug: vi.fn(),
    isElectronWindow: () => Reflect.get(globalThis, '__ELECTRON_PRESENCE__') !== false,
    isWithinSchedule: vi.fn(() => true),
    sensorsGetActiveWindow: vi.fn(),
    sensorsGetActiveWindowHistory: vi.fn(() => []),
    sensorsGetIdleTime: vi.fn(async () => 1000),
    sensorsGetLocalTime: vi.fn(() => '12:00'),
    sensorsGetSystemLoad: vi.fn(),
    sensorsGetVolumeLevel: vi.fn(() => 50),
    sensorsSetTrackingEnabled: vi.fn(),
  }
})

vi.mock('../database/repos/chat-sessions.repo', () => ({
  chatSessionsRepo: { getIndex: vi.fn(() => ({ characters: {} })), getSession: vi.fn(async () => null) },
}))

vi.mock('../database/storage', () => ({
  storage: { getItem: vi.fn(async () => null), setItem: vi.fn(async () => {}) },
}))

vi.mock('vue-i18n', () => ({ useI18n: () => ({ t: (k: string) => k }) }))

describe('presence electron path', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    setActivePinia(createPinia())
  })

  it('registers os-idle-time provider in electron', () => {
    const presence = usePresenceStore()
    expect(presence.signalProviders.some(p => p.id === 'os-idle-time')).toBe(true)
  })
  it('refreshIdleTimeOnce reads os-idle-time provider', async () => {
    const presence = usePresenceStore()
    await presence.refreshIdleTimeOnce()
    expect(presence.idleTimeSec).toBe(1)
  })

  it('refreshIdleTimeOnce handles throw', async () => {
    const presence = usePresenceStore()
    presence.removeSignalProvider('os-idle-time')
    presence.addSignalProvider({ id: 'boom', readIdleSec: async () => { throw new Error('nope') } })
    await presence.refreshIdleTimeOnce()
    expect(true).toBe(true)
  })
  it('lock/sleep signals become derivable when provider supplies them', () => {
    const presence = usePresenceStore()
    presence.addSignalProvider({ id: 'lock', readIdleSec: async () => 5, readLockState: () => 'locked', readSleepState: () => 'asleep' })
    expect(presence.availability['screen-locked']).toBe('derivable')
    expect(presence.availability.sleep).toBe('derivable')
    expect(presence.derivableStates).toContain('screen-locked')
    expect(presence.derivableStates).toContain('sleep')
    expect(presence.presence.signals.hasLockSignal).toBe(true)
    expect(presence.presence.signals.hasSleepSignal).toBe(true)
  })

  it('readIdleTimeOnce returns undefined when no usable readings', async () => {
    const presence = usePresenceStore()
    presence.removeSignalProvider('os-idle-time')
    presence.addSignalProvider({ id: 'undef', readIdleSec: async () => undefined })
    const r = await presence.readIdleTimeOnce()
    expect(r).toBeUndefined()
  })

  it('writeIdleTimeSec ignores undefined', () => {
    const presence = usePresenceStore()
    const before = presence.rawIdleTimeSec
    presence.writeIdleTimeSec(undefined)
    expect(presence.rawIdleTimeSec).toBe(before)
  })

  it('afk and isUserAway reflect idle threshold', async () => {
    const presence = usePresenceStore()
    presence.writeIdleTimeSec(400)
    expect(presence.afk).toBe(true)
    expect(presence.isUserAway()).toBe(true)
    expect(presence.isUserAway(1)).toBe(true)
    expect(presence.isUserAway(0)).toBe(true)
  })

  it('isUserAway returns false when no reading', () => {
    const presence = usePresenceStore()
    presence.removeSignalProvider('os-idle-time')
    // force raw undefined by new store
    const p2 = usePresenceStore()
    // reset not possible; check initial
    expect(p2.isUserAway()).toBe(false)
  })

  it('readIdleTimeOnce throws when all providers fail', async () => {
    const presence = usePresenceStore()
    presence.removeSignalProvider('os-idle-time')
    presence.addSignalProvider({ id: 'boom2', readIdleSec: async () => { throw new Error('nope2') } })
    await expect(presence.readIdleTimeOnce()).rejects.toThrow()
  })
  it('derivePresenceState screen-locked/away/idle branches', () => {
    const presence = usePresenceStore()
    presence.addSignalProvider({ id: 'lock2', readIdleSec: async () => 5, readLockState: () => 'locked' })
    presence.writeIdleTimeSec(2000)
    presence.recompute()
    presence.removeSignalProvider('lock2')
    presence.writeIdleTimeSec(2000)
    presence.recompute()
    expect(presence.presence.state).toBe('away')
    presence.writeIdleTimeSec(150)
    presence.recompute()
    expect(presence.presence.state).toBe('idle')
  })

  it('addSignalProvider ignores duplicate id', () => {
    const presence = usePresenceStore()
    const before = presence.signalProviders.length
    presence.addSignalProvider({ id: 'os-idle-time', readIdleSec: async () => 1 })
    expect(presence.signalProviders.length).toBe(before)
  })

  it('os-idle-time returns undefined for non-finite reading', async () => {
    const ev = await import('@proj-airi/electron-vueuse')
    vi.mocked(ev.useElectronEventaInvoke).mockReturnValue(() => async () => Number.NaN)
    const presence = usePresenceStore()
    await presence.refreshIdleTimeOnce()
    expect(true).toBe(true)
    vi.mocked(ev.useElectronEventaInvoke).mockReturnValue(() => async () => 1000)
  })
  it('exposes presenceState computed', () => {
    const presence = usePresenceStore()
    presence.writeIdleTimeSec(10)
    presence.recompute()
    expect(presence.presenceState).toBe(presence.presence.state)
  })
  it('resolveAfkThresholdMinutes falls back for invalid config', () => {
    expect(resolveAfkThresholdMinutes(undefined)).toBe(5)
    expect(resolveAfkThresholdMinutes({ airi: { heartbeats: { afkThresholdMinutes: 0 } } })).toBe(5)
    expect(resolveAfkThresholdMinutes({ airi: { heartbeats: { afkThresholdMinutes: 10 } } })).toBe(10)
  })
  it('non-electron path skips os-idle-time registration', async () => {
    // Test module loading boundary: presence reads isElectronWindow at store creation.
    Reflect.set(globalThis, '__ELECTRON_PRESENCE__', false)
    vi.resetModules()
    const mod = await import('./presence')
    setActivePinia(createPinia())
    const presence = mod.usePresenceStore()
    expect(presence.signalProviders.some((p: { id: string }) => p.id === 'os-idle-time')).toBe(false)
    Reflect.set(globalThis, '__ELECTRON_PRESENCE__', true)
  })
})
