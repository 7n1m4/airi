import type { Mock } from 'vitest'

import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { useBackupStore } from './backup'

vi.mock('../composables/use-data-maintenance', () => ({
  useDataMaintenance: () => ({
    exportChatSessions: vi.fn(async () => new Blob(['sessions'], { type: 'application/json' })),
    exportAllCharacters: vi.fn(async () => new Blob(['chars'], { type: 'application/json' })),
    exportMemory: vi.fn(async () => new Blob(['mem'], { type: 'application/json' })),
    importAllCharacters: vi.fn(async () => {}),
    importChatSessions: vi.fn(async () => {}),
    importMemory: vi.fn(async () => {}),
  }),
}))

interface ElectronIpc {
  invoke: Mock<(...args: unknown[]) => Promise<unknown>>
}

interface ElectronWindow {
  electron: { ipcRenderer: ElectronIpc }
}

// `window.electron` is injected by the Electron preload script and is absent from the DOM
// lib typings, so attaching the fixture requires this one cast. It is confined here so
// every test can use the returned mock without repeating the cast itself.
function installElectron(): ElectronIpc {
  const ipcRenderer: ElectronIpc = { invoke: vi.fn() }
  ;(window as unknown as ElectronWindow).electron = { ipcRenderer }
  return ipcRenderer
}

describe('useBackupStore', () => {
  beforeEach(() => {
    localStorage.clear()
    setActivePinia(createPinia())
  })

  it('initializes defaults', () => {
    const store = useBackupStore()
    expect(store.isBackupEnabled).toBe(true)
    expect(store.backupPath).toBe('')
    expect(store.lastBackupTime).toBe(0)
  })

  it('triggerBackup success', async () => {
    const store = useBackupStore()
    const { invoke } = installElectron()
    invoke.mockResolvedValue({ success: true, path: '/tmp/backup.zip' })
    localStorage.setItem('foo', 'bar')
    const path = await store.triggerBackup()
    expect(path).toBe('/tmp/backup.zip')
    expect(store.lastBackupTime).toBeGreaterThan(0)
  })

  it('triggerBackup excludes secret keys and keeps normal ones', async () => {
    const store = useBackupStore()
    const { invoke } = installElectron()
    invoke.mockResolvedValue({ success: true, path: '/tmp/backup.zip' })
    localStorage.setItem('settings/credentials/providers', '{"openai":{"apiKey":"sk-secret"}}')
    localStorage.setItem('settings/sync/s3-secret-access-key', 's3secretvalue')
    localStorage.setItem('settings/cloudflare/cfApiToken', 'cf-secret')
    localStorage.setItem('settings/free-hub/test-api-keys', '{"x":"sk-free"}')
    localStorage.setItem('settings/language', 'en')
    localStorage.setItem('settings/connection/hf-token', 'hf_secret')
    const path = await store.triggerBackup()
    expect(path).toBe('/tmp/backup.zip')

    const payload = invoke.mock.calls[0]![1] as { files: Record<string, string> }
    const file = Object.keys(payload.files).find(f => f.startsWith('airi-localstorage-'))!
    const raw = payload.files[file]
    const bundle = JSON.parse(raw) as Record<string, unknown>
    // Names are recorded so a restore knows what was left behind; values never are.
    for (const secret of ['sk-secret', 's3secretvalue', 'cf-secret', 'sk-free', 'hf_secret'])
      expect(raw).not.toContain(secret)
    expect(bundle.localStorageSkipped).toEqual(['settings/credentials/providers', 'settings/sync/s3-secret-access-key', 'settings/cloudflare/cfApiToken', 'settings/free-hub/test-api-keys', 'settings/connection/hf-token'])
    expect(bundle['settings/language']).toBe('en')
    expect(bundle['settings/credentials/providers']).toBeUndefined()
    expect(bundle['settings/sync/s3-secret-access-key']).toBeUndefined()
    expect(bundle['settings/cloudflare/cfApiToken']).toBeUndefined()
    expect(bundle['settings/free-hub/test-api-keys']).toBeUndefined()
    expect(bundle['settings/connection/hf-token']).toBeUndefined()
  })

  it('restoreBackup skips the localStorageSkipped marker', async () => {
    const store = useBackupStore()
    const files = {
      'airi-localstorage-1.json': JSON.stringify({ foo: 'bar', localStorageSkipped: ['settings/credentials/providers'] }),
    }
    const { invoke } = installElectron()
    invoke.mockResolvedValue({ success: true, files })
    localStorage.clear()
    expect(await store.restoreBackup('/dir', { characters: false, sessions: false, memory: false, localStorage: true })).toEqual({ success: true })
    expect(localStorage.getItem('foo')).toBe('bar')
    expect(localStorage.getItem('localStorageSkipped')).toBeNull()
    expect(localStorage.length).toBe(1)
  })

  it('triggerBackup covers null key branch', async () => {
    const store = useBackupStore()
    const { invoke } = installElectron()
    invoke.mockResolvedValue({ success: true, path: '/tmp/x.zip' })
    const original = localStorage
    const fake: Storage = {
      length: 1,
      key: () => null,
      getItem: () => null,
      setItem: () => {},
      removeItem: () => {},
      clear: () => {},
    }
    Object.defineProperty(window, 'localStorage', { value: fake, writable: true, configurable: true })
    Object.defineProperty(globalThis, 'localStorage', { value: fake, writable: true, configurable: true })
    await store.triggerBackup()
    Object.defineProperty(window, 'localStorage', { value: original, writable: true, configurable: true })
    Object.defineProperty(globalThis, 'localStorage', { value: original, writable: true, configurable: true })
  })

  it('triggerBackup failure returns null', async () => {
    const store = useBackupStore()
    const { invoke } = installElectron()
    invoke.mockRejectedValue(new Error('boom'))
    const path = await store.triggerBackup()
    expect(path).toBeNull()
  })

  it('listBackups success and failure', async () => {
    const store = useBackupStore()
    const { invoke } = installElectron()
    invoke.mockResolvedValue({ directories: ['a', 'b'] })
    expect(await store.listBackups()).toEqual(['a', 'b'])

    invoke.mockRejectedValue(new Error('x'))
    expect(await store.listBackups()).toEqual([])
  })

  it('listBackups handles missing directories', async () => {
    const store = useBackupStore()
    const { invoke } = installElectron()
    invoke.mockResolvedValue({})
    expect(await store.listBackups()).toEqual([])
  })

  it('restoreBackup read failure', async () => {
    const store = useBackupStore()
    const { invoke } = installElectron()
    invoke.mockResolvedValue({ success: false, error: 'nope' })
    const res = await store.restoreBackup('/dir', { characters: true, sessions: true, memory: true, localStorage: true })
    expect(res).toEqual({ success: false, error: 'nope' })
  })

  it('restoreBackup full success with skip airi_cc_', async () => {
    const store = useBackupStore()
    const files = {
      'airi-characters-1.json': JSON.stringify({ a: 1 }),
      'airi-chat-sessions-1.json': JSON.stringify({ b: 2 }),
      'airi-memory-1.json': JSON.stringify({ c: 3 }),
      'airi-localstorage-1.json': JSON.stringify({ foo: 'bar', airi_cc_x: 'big' }),
    }
    const { invoke } = installElectron()
    invoke.mockResolvedValue({ success: true, files })
    localStorage.clear()
    const res = await store.restoreBackup('/dir', { characters: true, sessions: true, memory: true, localStorage: true })
    expect(res).toEqual({ success: true })
    expect(localStorage.getItem('foo')).toBe('bar')
    expect(localStorage.getItem('airi_cc_x')).toBeNull()
  })

  it('restoreBackup options false skip', async () => {
    const store = useBackupStore()
    const files = {
      'airi-characters-1.json': JSON.stringify({ a: 1 }),
      'airi-localstorage-1.json': JSON.stringify({ foo: 'bar' }),
    }
    const { invoke } = installElectron()
    invoke.mockResolvedValue({ success: true, files })
    localStorage.clear()
    const res = await store.restoreBackup('/dir', { characters: false, sessions: false, memory: false, localStorage: false })
    expect(res).toEqual({ success: true })
    expect(localStorage.getItem('foo')).toBeNull()
  })

  it('restoreBackup missing matching files', async () => {
    const store = useBackupStore()
    const { invoke } = installElectron()
    invoke.mockResolvedValue({ success: true, files: {} })
    const res = await store.restoreBackup('/dir', { characters: true, sessions: true, memory: true, localStorage: true })
    expect(res).toEqual({ success: true })
  })

  it('restoreBackup invalid JSON throws returns failure', async () => {
    const store = useBackupStore()
    const files = { 'airi-characters-1.json': '{bad' }
    const { invoke } = installElectron()
    invoke.mockResolvedValue({ success: true, files })
    const res = await store.restoreBackup('/dir', { characters: true, sessions: false, memory: false, localStorage: false })
    expect(res.success).toBe(false)
  })

  it('restoreBackup non-Error throw', async () => {
    const store = useBackupStore()
    const { invoke } = installElectron()
    invoke.mockImplementation(async () => { throw 'str' })
    const res = await store.restoreBackup('/dir', { characters: false, sessions: false, memory: false, localStorage: false })
    expect(res).toEqual({ success: false, error: 'str' })
  })

  it('restoreBackup never re-injects secret bundle keys', async () => {
    const store = useBackupStore()
    const files = {
      'airi-localstorage-1.json': JSON.stringify({ 'settings/sync/s3-secret-access-key': 'planted-secret', 'settings/language': 'ja', 'foo': 'bar' }),
    }
    const { invoke } = installElectron()
    invoke.mockResolvedValue({ success: true, files })
    localStorage.clear()
    const res = await store.restoreBackup('/dir', { characters: false, sessions: false, memory: false, localStorage: true })
    expect(res).toEqual({ success: true })
    expect(localStorage.getItem('settings/sync/s3-secret-access-key')).toBeNull()
    expect(localStorage.getItem('settings/language')).toBe('ja')
    expect(localStorage.getItem('foo')).toBe('bar')
  })
})
