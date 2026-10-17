import type { Mock } from 'vitest'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'

import { useAudioRecorder } from './audio-recorder'

describe('useAudioRecorder', () => {
  let originalAudioContext: unknown
  let latestProcessor: MockScriptProcessorNode | null = null

  interface MockScriptProcessorNode {
    connect: Mock
    disconnect: Mock
    onaudioprocess: ((event: unknown) => void) | null
  }

  class MockAudioContext {
    sampleRate = 16000
    state = 'running'
    destination = {}
    resume = vi.fn().mockResolvedValue(undefined)
    close = vi.fn().mockResolvedValue(undefined)
    createMediaStreamSource = vi.fn().mockReturnValue({
      connect: vi.fn(),
      disconnect: vi.fn(),
    })

    createScriptProcessor = vi.fn().mockImplementation(() => {
      const node = {
        connect: vi.fn(),
        disconnect: vi.fn(),
        onaudioprocess: null as ((e: unknown) => void) | null,
      }
      latestProcessor = node
      return node
    })
  }

  beforeEach(() => {
    originalAudioContext = (globalThis as Record<string, unknown>).AudioContext
    ;(globalThis as Record<string, unknown>).AudioContext = MockAudioContext
    latestProcessor = null
  })

  afterEach(() => {
    ;(globalThis as Record<string, unknown>).AudioContext = originalAudioContext
  })

  // NOTICE: `expect()` does not narrow `latestProcessor` or its handler, so resolve it through a helper that fails loudly.
  function requireAudioProcessHandler(): (event: unknown) => void {
    const handler = latestProcessor?.onaudioprocess
    if (typeof handler !== 'function')
      throw new Error('processor.onaudioprocess was never assigned by startRecord()')
    return handler
  }

  it('does not trigger onStopRecord hooks if startRecord() was never called', async () => {
    const streamRef = ref<MediaStream>({ id: 'stream-1' } as unknown as MediaStream)
    const recorder = useAudioRecorder(streamRef)
    const onStopHook = vi.fn()

    recorder.onStopRecord(onStopHook)

    expect(recorder.isRecording.value).toBe(false)

    // Call stopRecord without startRecord (the dropped start hook scenario)
    const result = await recorder.stopRecord()

    expect(result).toBeUndefined()
    expect(onStopHook).not.toHaveBeenCalled()
    expect(recorder.isRecording.value).toBe(false)
  })

  it('successfully starts recording, captures data, and fires onStopRecord hook on stop', async () => {
    const streamRef = ref<MediaStream>({ id: 'stream-1' } as unknown as MediaStream)
    const recorder = useAudioRecorder(streamRef)
    const onStopHook = vi.fn().mockResolvedValue(undefined)

    recorder.onStopRecord(onStopHook)

    await recorder.startRecord()
    expect(recorder.isRecording.value).toBe(true)

    // Simulate audio data arriving through the ScriptProcessorNode
    expect(latestProcessor?.onaudioprocess).toBeDefined()
    const mockChannelData = new Float32Array(4096).fill(0.1)
    requireAudioProcessHandler()({
      inputBuffer: {
        getChannelData: () => mockChannelData,
      },
    })

    // Stop recording
    const blob = await recorder.stopRecord()

    expect(recorder.isRecording.value).toBe(false)
    expect(blob).toBeDefined()
    expect(blob).toBeInstanceOf(Blob)
    expect(blob?.type).toBe('audio/wav')
    expect(onStopHook).toHaveBeenCalledTimes(1)
    expect(onStopHook).toHaveBeenCalledWith(blob)
  })

  it('allows unregistering onStopRecord listener', async () => {
    const streamRef = ref<MediaStream>({ id: 'stream-1' } as unknown as MediaStream)
    const recorder = useAudioRecorder(streamRef)
    const onStopHook = vi.fn()

    const unregister = recorder.onStopRecord(onStopHook)
    unregister()

    await recorder.startRecord()
    requireAudioProcessHandler()({
      inputBuffer: {
        getChannelData: () => new Float32Array(4096).fill(0.2),
      },
    })
    await recorder.stopRecord()

    expect(onStopHook).not.toHaveBeenCalled()
  })
})
