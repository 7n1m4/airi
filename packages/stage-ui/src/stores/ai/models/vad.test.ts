import { beforeEach, describe, expect, it, vi } from 'vitest'

const vadMocks = vi.hoisted(() => {
  const handlers = new Map<string, (event?: unknown) => void>()

  return {
    handlers,
    createVAD: vi.fn(async () => ({
      on: vi.fn((name: string, handler: (event?: unknown) => void) => handlers.set(name, handler)),
      updateConfig: vi.fn(),
    })),
    initialize: vi.fn(async () => undefined),
    start: vi.fn(async () => undefined),
    stop: vi.fn(),
    dispose: vi.fn(),
  }
})

vi.mock('../../../workers/vad', () => ({
  createVAD: vadMocks.createVAD,
  createVADStates: () => ({
    initialize: vadMocks.initialize,
    start: vadMocks.start,
    stop: vadMocks.stop,
    dispose: vadMocks.dispose,
  }),
}))

describe('useVAD', () => {
  beforeEach(() => {
    vadMocks.handlers.clear()
    vi.clearAllMocks()
  })

  it('triggers onSpeechStart and onSpeechEnd callbacks', async () => {
    const onSpeechStart = vi.fn()
    const onSpeechEnd = vi.fn()
    const { useVAD } = await import('./vad')
    const vad = useVAD('vad-worker-url', { onSpeechStart, onSpeechEnd })

    await vad.init()
    vadMocks.handlers.get('speech-start')?.()
    expect(onSpeechStart).toHaveBeenCalledOnce()
    expect(vad.isSpeech.value).toBe(true)

    vadMocks.handlers.get('speech-end')?.()
    expect(onSpeechEnd).toHaveBeenCalledOnce()
    expect(vad.isSpeech.value).toBe(false)
  })

  it('waits for the same initialization when two consumers start together', async () => {
    let releaseInitialize!: () => void
    vadMocks.initialize.mockImplementationOnce(() => new Promise<undefined>((resolve) => {
      releaseInitialize = () => resolve(undefined)
    }))

    const { useVAD } = await import('./vad')
    const vad = useVAD('vad-worker-url')
    const first = vad.init()
    const second = vad.init()
    let secondCompleted = false
    void second.then(() => {
      secondCompleted = true
    })

    await vi.waitFor(() => expect(vadMocks.initialize).toHaveBeenCalledOnce())
    expect(secondCompleted).toBe(false)

    releaseInitialize()
    await Promise.all([first, second])

    expect(vad.loaded.value).toBe(true)
    expect(vadMocks.createVAD).toHaveBeenCalledOnce()
  })

  it('does not install a VAD manager after disposal during initialization', async () => {
    let releaseInitialize!: () => void
    vadMocks.initialize.mockImplementationOnce(() => new Promise<undefined>((resolve) => {
      releaseInitialize = () => resolve(undefined)
    }))

    const { useVAD } = await import('./vad')
    const vad = useVAD('vad-worker-url')
    const initialization = vad.init()
    await vi.waitFor(() => expect(vadMocks.initialize).toHaveBeenCalledOnce())

    vad.dispose()
    releaseInitialize()
    await initialization

    expect(vad.loaded.value).toBe(false)
    expect(vadMocks.dispose).toHaveBeenCalledOnce()
  })

  it('releases a VAD input graph that starts after disposal', async () => {
    let releaseStart!: () => void
    vadMocks.start.mockImplementationOnce(() => new Promise<undefined>((resolve) => {
      releaseStart = () => resolve(undefined)
    }))

    const { useVAD } = await import('./vad')
    const vad = useVAD('vad-worker-url')
    await vad.init()
    const starting = vad.start({} as MediaStream)
    await vi.waitFor(() => expect(vadMocks.start).toHaveBeenCalledOnce())

    vad.dispose()
    releaseStart()
    await starting

    expect(vadMocks.dispose).toHaveBeenCalledTimes(2)
  })
})
