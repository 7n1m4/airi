import type { Session, User } from 'better-auth'

import { createTestingPinia } from '@pinia/testing'
import { setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { nextTick, ref } from 'vue'

import { useAuthStore } from './auth'

const remoteSyncEnabledRef = ref(false)

vi.mock('../libs/auth', () => ({
  fetchSession: () => fetchSessionMock(),
}))

const fetchSessionMock = vi.fn(async () => true)

vi.mock('./settings', () => ({
  useSettingsGeneral: () => ({
    get remoteSyncEnabled() {
      return remoteSyncEnabledRef.value
    },
  }),
}))

const userValue = { id: 'u' } as unknown as User
const sessionValue = { id: 's' } as unknown as Session

function setSync(v: boolean) {
  remoteSyncEnabledRef.value = v
}

describe('auth store', () => {
  beforeEach(() => {
    remoteSyncEnabledRef.value = false
    fetchSessionMock.mockClear()
    fetchSessionMock.mockResolvedValue(true)
    setActivePinia(createTestingPinia({ createSpy: vi.fn, stubActions: false }))
  })

  it('initial state', () => {
    const store = useAuthStore()
    expect(store.user).toBeUndefined()
    expect(store.session).toBeUndefined()
    expect(store.isAuthenticated).toBe(false)
    expect(store.userId).toBe('local')
    expect(store.isLoginDrawerOpen).toBe(false)
  })

  it('initialize calls fetchSession when sync enabled', () => {
    setSync(true)
    fetchSessionMock.mockClear()
    setActivePinia(createTestingPinia({ createSpy: vi.fn, stubActions: false }))
    useAuthStore()
    expect(fetchSessionMock).toHaveBeenCalled()
  })

  it('initialize skips fetch when sync disabled', () => {
    setSync(false)
    fetchSessionMock.mockClear()
    setActivePinia(createTestingPinia({ createSpy: vi.fn, stubActions: false }))
    useAuthStore()
    expect(fetchSessionMock).not.toHaveBeenCalled()
  })

  it('watch disables clears user/session', async () => {
    setSync(true)
    fetchSessionMock.mockClear()
    setActivePinia(createTestingPinia({ createSpy: vi.fn, stubActions: false }))
    const store = useAuthStore()
    store.user = userValue
    store.session = sessionValue
    setSync(false)
    await nextTick()
    expect(store.user).toBeUndefined()
    expect(store.session).toBeUndefined()
  })

  it('watch enables calls fetchSession', async () => {
    setSync(false)
    fetchSessionMock.mockClear()
    setActivePinia(createTestingPinia({ createSpy: vi.fn, stubActions: false }))
    useAuthStore()
    fetchSessionMock.mockClear()
    setSync(true)
    await nextTick()
    expect(fetchSessionMock).toHaveBeenCalled()
  })

  it('isAuthenticated true when both set', () => {
    setActivePinia(createTestingPinia({ createSpy: vi.fn, stubActions: false }))
    const store = useAuthStore()
    store.user = userValue
    store.session = sessionValue
    expect(store.isAuthenticated).toBe(true)
    expect(store.userId).toBe('u')
  })

  it('isLoginDrawerOpen toggle', () => {
    setActivePinia(createTestingPinia({ createSpy: vi.fn, stubActions: false }))
    const store = useAuthStore()
    store.isLoginDrawerOpen = true
    expect(store.isLoginDrawerOpen).toBe(true)
  })

  it('initialize swallows fetchSession rejection', async () => {
    setSync(true)
    fetchSessionMock.mockRejectedValue(new Error('boom'))
    fetchSessionMock.mockClear()
    fetchSessionMock.mockRejectedValue(new Error('boom'))
    setActivePinia(createTestingPinia({ createSpy: vi.fn, stubActions: false }))
    expect(() => useAuthStore()).not.toThrow()
    await Promise.resolve()
  })

  it('watch enables swallows fetchSession rejection', async () => {
    setSync(false)
    fetchSessionMock.mockClear()
    fetchSessionMock.mockRejectedValue(new Error('boom'))
    setActivePinia(createTestingPinia({ createSpy: vi.fn, stubActions: false }))
    useAuthStore()
    fetchSessionMock.mockClear()
    fetchSessionMock.mockRejectedValue(new Error('boom'))
    setSync(true)
    await nextTick()
    await Promise.resolve()
    expect(fetchSessionMock).toHaveBeenCalled()
  })
})
