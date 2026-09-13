import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'

import { useProcessSpawner } from './use-process-spawner'

describe('useProcessSpawner', () => {
  beforeEach(() => {
    localStorage.clear()
    vi.restoreAllMocks()
  })

  afterEach(() => {
    localStorage.clear()
    vi.restoreAllMocks()
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
    spawner.stopCommand.value = 'killall my-server'
    spawner.autoSpawnOnLaunch.value = true
    await nextTick()

    expect(spawner.spawnCommand.value).toBe('npx my-server')
    expect(spawner.stopCommand.value).toBe('killall my-server')
    expect(spawner.autoSpawnOnLaunch.value).toBe(true)
    expect(localStorage.getItem('test-spawner:spawn-command')).toBe('npx my-server')
    expect(localStorage.getItem('test-spawner:stop-command')).toBe('killall my-server')
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
  })

  it('handles browser mode (non-electron) by copying to clipboard', async () => {
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
