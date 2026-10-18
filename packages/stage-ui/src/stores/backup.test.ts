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

interface ElectronWin { electron: { ipcRenderer: { invoke: (...args: unknown[]) => unknown } } }

describe('useBackupStore', () => {
  beforeEach(() => {
    localStorage.clear()
    setActivePinia(createPinia())
    ;(window as unknown as ElectronWin).electron = { ipcRenderer: { invoke: vi.fn() } }
  })

  it('initializes defaults', () => {
    const store = useBackupStore()
    expect(store.isBackupEnabled).toBe(true)
    expect(store.backupPath).toBe('')
    expect(store.lastBackupTime).toBe(0)
  })

  it('triggerBackup success', async () => {
    const store = useBackupStore()
    ;(window as unknown as ElectronWin).electron.ipcRenderer.invoke.mockResolvedValue({ success: true, path: '/tmp/backup.zip' })
    localStorage.setItem('foo', 'bar')
    const path = await store.triggerBackup()
    expect(path).toBe('/tmp/backup.zip')
    expect(store.lastBackupTime).toBeGreaterThan(0)
  })

  it('triggerBackup covers null key branch', async () => {
    const store = useBackupStore()
    ;(window as unknown as ElectronWin).electron.ipcRenderer.invoke.mockResolvedValue({ success: true, path: '/tmp/x.zip' })
    const original = localStorage
    const fake = {
      length: 1,
      key: () => null,
      getItem: () => null,
      setItem: () => {},
      removeItem: () => {},
      clear: () => {},
    } as unknown as Storage
    Object.defineProperty(window, 'localStorage', { value: fake, writable: true, configurable: true })
    Object.defineProperty(globalThis, 'localStorage', { value: fake, writable: true, configurable: true })
    await store.triggerBackup()
    Object.defineProperty(window, 'localStorage', { value: original, writable: true, configurable: true })
    Object.defineProperty(globalThis, 'localStorage', { value: original, writable: true, configurable: true })
  })

  it('triggerBackup failure returns null', async () => {
    const store = useBackupStore()
    ;(window as unknown as ElectronWin).electron.ipcRenderer.invoke.mockRejectedValue(new Error('boom'))
    const path = await store.triggerBackup()
    expect(path).toBeNull()
  })

  it('listBackups success and failure', async () => {
    const store = useBackupStore()
    ;(window as unknown as ElectronWin).electron.ipcRenderer.invoke.mockResolvedValue({ directories: ['a', 'b'] })
    expect(await store.listBackups()).toEqual(['a', 'b'])

    ;(window as unknown as ElectronWin).electron.ipcRenderer.invoke.mockRejectedValue(new Error('x'))
    expect(await store.listBackups()).toEqual([])
  })

  it('listBackups handles missing directories', async () => {
    const store = useBackupStore()
    ;(window as unknown as ElectronWin).electron.ipcRenderer.invoke.mockResolvedValue({})
    expect(await store.listBackups()).toEqual([])
  })

  it('restoreBackup read failure', async () => {
    const store = useBackupStore()
    ;(window as unknown as ElectronWin).electron.ipcRenderer.invoke.mockResolvedValue({ success: false, error: 'nope' })
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
    ;(window as unknown as ElectronWin).electron.ipcRenderer.invoke.mockResolvedValue({ success: true, files })
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
    ;(window as unknown as ElectronWin).electron.ipcRenderer.invoke.mockResolvedValue({ success: true, files })
    localStorage.clear()
    const res = await store.restoreBackup('/dir', { characters: false, sessions: false, memory: false, localStorage: false })
    expect(res).toEqual({ success: true })
    expect(localStorage.getItem('foo')).toBeNull()
  })

  it('restoreBackup missing matching files', async () => {
    const store = useBackupStore()
    ;(window as unknown as ElectronWin).electron.ipcRenderer.invoke.mockResolvedValue({ success: true, files: {} })
    const res = await store.restoreBackup('/dir', { characters: true, sessions: true, memory: true, localStorage: true })
    expect(res).toEqual({ success: true })
  })

  it('restoreBackup invalid JSON throws returns failure', async () => {
    const store = useBackupStore()
    const files = { 'airi-characters-1.json': '{bad' }
    ;(window as unknown as ElectronWin).electron.ipcRenderer.invoke.mockResolvedValue({ success: true, files })
    const res = await store.restoreBackup('/dir', { characters: true, sessions: false, memory: false, localStorage: false })
    expect(res.success).toBe(false)
  })

  it('restoreBackup non-Error throw', async () => {
    const store = useBackupStore()
    ;(window as unknown as ElectronWin).electron.ipcRenderer.invoke.mockImplementation(async () => { throw 'str' })
    const res = await store.restoreBackup('/dir', { characters: false, sessions: false, memory: false, localStorage: false })
    expect(res).toEqual({ success: false, error: 'str' })
  })
})
