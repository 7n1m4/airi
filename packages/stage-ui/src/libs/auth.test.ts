import { createTestingPinia } from '@pinia/testing'
import { setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { fetchSession, isRemoteSyncEnabled, listSessions as listSessionsFn, REMOTE_SYNC_STORAGE_KEY, SERVER_URL, signIn, signOut } from './auth'

const mocks = vi.hoisted(() => ({
  getSession: vi.fn(),
  listSessions: vi.fn(),
  signOutClient: vi.fn(),
  signInSocial: vi.fn(),
}))

vi.mock('better-auth/vue', () => ({
  createAuthClient: () => ({
    getSession: mocks.getSession,
    listSessions: mocks.listSessions,
    signOut: mocks.signOutClient,
    signIn: { social: mocks.signInSocial },
  }),
}))

const mockStore: { user: unknown, session: unknown } = { user: undefined, session: undefined }
vi.mock('../stores/auth', () => ({
  useAuthStore: () => mockStore,
}))

describe('auth lib', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    setActivePinia(createTestingPinia({ createSpy: vi.fn, stubActions: false }))
    localStorage.clear()
    mockStore.user = undefined
    mockStore.session = undefined
    const win = window as unknown as { electron?: unknown }
    delete win.electron
  })

  it('exports constants', () => {
    expect(SERVER_URL).toBeDefined()
    expect(REMOTE_SYNC_STORAGE_KEY).toBe('settings/privacy/remote-sync-enabled')
  })

  it('isRemoteSyncEnabled false when no localStorage', () => {
    const orig = globalThis.localStorage
    // @ts-expect-error testing undefined
    delete globalThis.localStorage
    expect(isRemoteSyncEnabled()).toBe(false)
    globalThis.localStorage = orig
  })

  it('isRemoteSyncEnabled reads localStorage', () => {
    expect(isRemoteSyncEnabled()).toBe(false)
    localStorage.setItem(REMOTE_SYNC_STORAGE_KEY, 'true')
    expect(isRemoteSyncEnabled()).toBe(true)
  })

  it('fetchSession skips when disabled', async () => {
    const res = await fetchSession()
    expect(res).toBe(false)
    expect(mocks.getSession).not.toHaveBeenCalled()
  })

  it('fetchSession success updates store', async () => {
    localStorage.setItem(REMOTE_SYNC_STORAGE_KEY, 'true')
    mocks.getSession.mockResolvedValue({ data: { user: { email: 'a@b.com' }, session: { id: 's' } } })
    const res = await fetchSession()
    expect(res).toBe(true)
    expect(mockStore.user).toEqual({ email: 'a@b.com' })
    expect(mockStore.session).toEqual({ id: 's' })
  })

  it('fetchSession no data returns false', async () => {
    localStorage.setItem(REMOTE_SYNC_STORAGE_KEY, 'true')
    mocks.getSession.mockResolvedValue({ data: null })
    const res = await fetchSession()
    expect(res).toBe(false)
  })

  it('fetchSession error returns false', async () => {
    localStorage.setItem(REMOTE_SYNC_STORAGE_KEY, 'true')
    mocks.getSession.mockRejectedValue(new Error('boom'))
    const res = await fetchSession()
    expect(res).toBe(false)
  })

  it('listSessions delegates', async () => {
    mocks.listSessions.mockResolvedValue('ok')
    expect(await listSessionsFn()).toBe('ok')
  })

  it('signOut clears store', async () => {
    mocks.signOutClient.mockResolvedValue(undefined)
    mockStore.user = { email: 'x' }
    mockStore.session = { id: 'y' }
    await signOut()
    expect(mocks.signOutClient).toHaveBeenCalled()
    expect(mockStore.user).toBeUndefined()
    expect(mockStore.session).toBeUndefined()
  })

  it('signIn non-electron uses social', async () => {
    mocks.signInSocial.mockResolvedValue('res')
    expect(await signIn('google')).toBe('res')
    expect(mocks.signInSocial).toHaveBeenCalledWith({ provider: 'google', callbackURL: window.location.origin })
  })

  it('signIn electron popup closed triggers fetchSession', async () => {
    const win = window as unknown as { electron?: unknown }
    win.electron = {}
    localStorage.setItem(REMOTE_SYNC_STORAGE_KEY, 'true')
    mocks.getSession.mockResolvedValue({ data: { user: { email: 'a@b.com' }, session: { id: 's' } } })
    const popup = { closed: true, close: vi.fn() }
    if (!window.open)
      (window as unknown as { open: unknown }).open = vi.fn()
    vi.spyOn(window, 'open').mockReturnValue(popup as unknown as Window)
    vi.useFakeTimers()
    const promise = signIn('google')
    await vi.advanceTimersByTimeAsync(1000)
    await promise
    vi.useRealTimers()
    expect(mocks.getSession).toHaveBeenCalled()
  })

  it('signIn electron popup success branch', async () => {
    const win = window as unknown as { electron?: unknown }
    win.electron = {}
    localStorage.setItem(REMOTE_SYNC_STORAGE_KEY, 'true')
    const popup = { closed: false, close: vi.fn() }
    if (!window.open)
      (window as unknown as { open: unknown }).open = vi.fn()
    vi.spyOn(window, 'open').mockReturnValue(popup as unknown as Window)
    mocks.getSession.mockResolvedValue({ data: { user: { email: 'a@b.com' }, session: { id: 's' } } })
    vi.useFakeTimers()
    const promise = signIn('github')
    await vi.advanceTimersByTimeAsync(1000)
    await promise
    vi.useRealTimers()
    expect(popup.close).toHaveBeenCalled()
  })

  it('signIn electron with no popup falls through to social', async () => {
    const win = window as unknown as { electron?: unknown }
    win.electron = {}
    if (!window.open)
      (window as unknown as { open: unknown }).open = vi.fn()
    const open = vi.spyOn(window, 'open').mockReturnValue(null)
    mocks.signInSocial.mockResolvedValue('res2')
    expect(await signIn('github')).toBe('res2')
    open.mockRestore()
  })
})
