import type { ElectronExecuteShellCommandPayload } from '@proj-airi/stage-shared'

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'

import { useProcessSpawner } from './use-process-spawner'

// Mirrors the allowlist in the main-process handler, so a rejection test proves
// the payload was built the way main will judge it.
const allowedBasenames = ['python3', 'npx', 'npm', 'pkill']
const invocations: ElectronExecuteShellCommandPayload[] = []

vi.mock('@proj-airi/electron-vueuse', () => ({
  useElectronEventaInvoke: () => async (payload: ElectronExecuteShellCommandPayload) => {
    invocations.push(payload)
    const bin = payload.argv[0].split('/').pop() || ''
    return allowedBasenames.includes(bin)
      ? { success: true, stdout: '', stderr: '', exitCode: 0 }
      : { success: false, stdout: '', stderr: `Executable not allowed: ${payload.argv[0]}`, exitCode: 1, error: `Executable not allowed: ${payload.argv[0]}` }
  },
}))

// `window.electron` is injected by the Electron preload script and is absent from
// the DOM lib typings; confine that cast to the one place the fixture needs it.
interface ElectronWindow {
  electron: unknown
}

describe('useProcessSpawner', () => {
  beforeEach(() => {
    localStorage.clear()
    invocations.length = 0
    ;(window as unknown as ElectronWindow).electron = {}
    vi.restoreAllMocks()
  })

  // Guards the electron branch: every spawn test below is vacuous without it.
  it('exposes the electron bridge in this environment', () => {
    expect(useProcessSpawner({ storageKeyPrefix: 'bridge-test' }).isElectron.value).toBe(true)
  })

  it('initializes with default options and storage keys', () => {
    const spawner = useProcessSpawner({
      storageKeyPrefix: 'test-spawner',
      defaultSpawnCommand: 'npm start',
      defaultStopCommand: 'npm stop',
      defaultAutoSpawn: true,
    })

    expect(spawner.spawnCommand.value).toBe('npm start')
    expect(spawner.stopCommand.value).toBe('npm stop')
    expect(spawner.autoSpawnOnLaunch.value).toBe(true)
    expect(spawner.isExecuting.value).toBe(false)
    expect(spawner.showLogs.value).toBe(false)
    expect(spawner.lastResult.value).toBeNull()
  })

  it('updates storage when reactive refs change', async () => {
    const spawner = useProcessSpawner({
      storageKeyPrefix: 'test-spawner',
    })

    spawner.spawnCommand.value = 'npx my-server'
    spawner.stopCommand.value = 'pkill -f my-server'
    spawner.autoSpawnOnLaunch.value = true
    await nextTick()

    expect(spawner.spawnCommand.value).toBe('npx my-server')
    expect(spawner.stopCommand.value).toBe('pkill -f my-server')
    expect(spawner.autoSpawnOnLaunch.value).toBe(true)
    expect(localStorage.getItem('test-spawner:spawn-command')).toBe('npx my-server')
    expect(localStorage.getItem('test-spawner:stop-command')).toBe('pkill -f my-server')
    expect(localStorage.getItem('test-spawner:auto-spawn')).toBe('true')
  })

  it('handles empty command gracefully on spawn and stop', async () => {
    const spawner = useProcessSpawner({
      storageKeyPrefix: 'empty-test',
    })

    const spawnRes = await spawner.handleSpawn()
    expect(spawnRes).toBeNull()
    expect(spawner.isExecuting.value).toBe(false)

    const stopRes = await spawner.handleStop()
    expect(stopRes).toBeNull()
    expect(spawner.isExecuting.value).toBe(false)
    expect(invocations).toHaveLength(0)
  })

  it('passes shell metacharacters literally as argv instead of executing them', async () => {
    const spawner = useProcessSpawner({
      storageKeyPrefix: 'metachar-test',
      defaultSpawnCommand: 'python3 -c print(1) && touch /tmp/pwned ; echo hi | rm',
    })

    const res = await spawner.handleSpawn()

    expect(res?.success).toBe(true)
    expect(invocations).toHaveLength(1)
    expect(invocations[0].argv).toEqual([
      'python3',
      '-c',
      'print(1)',
      '&&',
      'touch',
      '/tmp/pwned',
      ';',
      'echo',
      'hi',
      '|',
      'rm',
    ])
  })

  it('rejects a binary outside the allowlist', async () => {
    const spawner = useProcessSpawner({
      storageKeyPrefix: 'denied-test',
      defaultSpawnCommand: '/bin/sh -c whoami',
    })

    const res = await spawner.handleSpawn()

    expect(res?.success).toBe(false)
    expect(res?.stderr).toContain('Executable not allowed: /bin/sh')
    expect(invocations).toHaveLength(1)
    expect(invocations[0].argv).toEqual(['/bin/sh', '-c', 'whoami'])
  })

  it('handles browser mode (non-electron) by copying to clipboard', async () => {
    // `beforeEach` installs a stub `window.electron` for the desktop cases; browser
    // mode is the absence of that bridge, so remove it for this case only.
    delete (window as unknown as ElectronWindow).electron

    const writeTextMock = vi.fn().mockResolvedValue(undefined)
    Object.assign(navigator, {
      clipboard: {
        writeText: writeTextMock,
      },
    })

    const spawner = useProcessSpawner({
      storageKeyPrefix: 'browser-test',
      defaultSpawnCommand: 'docker run -p 8080:8080 my-image',
    })

    const result = await spawner.handleSpawn()
    expect(result).toBeNull()
    expect(writeTextMock).toHaveBeenCalledWith('docker run -p 8080:8080 my-image')
    expect(invocations).toHaveLength(0)
  })

  it('formats logs correctly when copyLogs is invoked', () => {
    const writeTextMock = vi.fn().mockResolvedValue(undefined)
    Object.assign(navigator, {
      clipboard: {
        writeText: writeTextMock,
      },
    })

    const spawner = useProcessSpawner({
      storageKeyPrefix: 'log-test',
    })

    spawner.lastResult.value = {
      action: 'spawn',
      success: true,
      exitCode: 0,
      stdout: 'Server listening on port 8095',
      stderr: '',
      timestamp: '12:00:00 PM',
    }

    spawner.copyLogs()
    expect(writeTextMock).toHaveBeenCalled()
    const copiedText = writeTextMock.mock.calls[0][0]
    expect(copiedText).toContain('Action: SPAWN')
    expect(copiedText).toContain('Exit Code: 0')
    expect(copiedText).toContain('Server listening on port 8095')
  })
})
