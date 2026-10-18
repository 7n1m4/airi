import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { usePresenceStore } from './presence'

vi.mock('@proj-airi/electron-vueuse', () => ({
  useElectronEventaInvoke: () => async () => 1000,
}))

vi.mock('@proj-airi/stage-shared', async (importOriginal) => {
  const actual = await importOriginal()
  return {
    ...actual,
    debug: vi.fn(),
    isElectronWindow: () => true,
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
})
