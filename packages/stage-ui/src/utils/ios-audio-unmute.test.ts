import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

interface AudioMock {
  loop: boolean
  volume: number
  setAttribute: ReturnType<typeof vi.fn>
  play: ReturnType<typeof vi.fn>
  pause: ReturnType<typeof vi.fn>
  src: string
}

let audioInstances: AudioMock[] = []

class FakeAudio {
  loop = false
  volume = 1
  src = ''
  setAttribute = vi.fn()
  play = vi.fn().mockResolvedValue(undefined)
  pause = vi.fn()
  constructor(_src?: string) {
    audioInstances.push(this as unknown as AudioMock)
  }
}

function setNavigator(value: unknown) {
  Object.defineProperty(globalThis, 'navigator', {
    value,
    configurable: true,
    writable: true,
  })
}

beforeEach(() => {
  audioInstances = []
  vi.resetModules()
  ;(globalThis as unknown as Record<string, unknown>).Audio = FakeAudio
  setNavigator({ userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X)', platform: 'iPhone', maxTouchPoints: 0 })
})

afterEach(() => {
  vi.restoreAllMocks()
})

// Dynamic import is required to reset module-level state between tests.
async function loadModule() {
  return await import('./ios-audio-unmute')
}

describe('ios-audio-unmute', () => {
  it('no-op when navigator undefined', async () => {
    const desc = Object.getOwnPropertyDescriptor(globalThis, 'navigator')
    delete (globalThis as unknown as Record<string, unknown>).navigator
    const mod = await loadModule()
    mod.enableIOSPlayback()
    expect(audioInstances).toHaveLength(0)
    if (desc)
      Object.defineProperty(globalThis, 'navigator', desc)
  })

  it('no-op on non-iOS', async () => {
    setNavigator({ userAgent: 'Mozilla/5.0 (Windows NT 10.0)', platform: 'Win32', maxTouchPoints: 0 })
    const mod = await loadModule()
    mod.enableIOSPlayback()
    expect(audioInstances).toHaveLength(0)
  })

  it('macIntel with touch points counts as iOS', async () => {
    setNavigator({ userAgent: 'Mozilla/5.0 (Macintosh)', platform: 'MacIntel', maxTouchPoints: 2 })
    const mod = await loadModule()
    mod.enableIOSPlayback()
    expect(audioInstances).toHaveLength(1)
  })

  it('creates silent audio on iOS and plays', async () => {
    const mod = await loadModule()
    mod.enableIOSPlayback()
    expect(audioInstances).toHaveLength(1)
    const a = audioInstances[0]
    expect(a.loop).toBe(true)
    expect(a.volume).toBe(0)
    expect(a.setAttribute).toHaveBeenCalledWith('playsinline', 'true')
    expect(a.play).toHaveBeenCalled()
  })

  it('second enable is no-op while audio exists', async () => {
    const mod = await loadModule()
    mod.enableIOSPlayback()
    mod.enableIOSPlayback()
    expect(audioInstances).toHaveLength(1)
  })

  it('enable is no-op after dispose', async () => {
    const mod = await loadModule()
    mod.disposeIOSPlayback()
    mod.enableIOSPlayback()
    expect(audioInstances).toHaveLength(0)
  })

  it('dispose pauses and clears audio', async () => {
    const mod = await loadModule()
    mod.enableIOSPlayback()
    const a = audioInstances[0]
    mod.disposeIOSPlayback()
    expect(a.pause).toHaveBeenCalled()
    expect(a.src).toBe('')
    mod.enableIOSPlayback()
    expect(audioInstances).toHaveLength(1)
  })

  it('dispose without audio only sets disposed', async () => {
    const mod = await loadModule()
    mod.disposeIOSPlayback()
    expect(audioInstances).toHaveLength(0)
  })
})
