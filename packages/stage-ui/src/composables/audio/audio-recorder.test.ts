import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'

import { useAudioRecorder } from './audio-recorder'

describe('useAudioRecorder', () => {
  let originalAudioContext: any

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
        onaudioprocess: null as ((e: any) => void) | null,
      }
      latestProcessor = node
      return node
    })
  }

  let latestProcessor: any = null

  beforeEach(() => {
    originalAudioContext = (globalThis as any).AudioContext
    ;(globalThis as any).AudioContext = MockAudioContext
    latestProcessor = null
  })

  afterEach(() => {
    ;(globalThis as any).AudioContext = originalAudioContext
  })

  it('does not trigger onStopRecord hooks if startRecord() was never called', async () => {
    const streamRef = ref<MediaStream>({ id: 'stream-1' } as any)
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
    const streamRef = ref<MediaStream>({ id: 'stream-1' } as any)
    const recorder = useAudioRecorder(streamRef)
    const onStopHook = vi.fn().mockResolvedValue(undefined)

    recorder.onStopRecord(onStopHook)

    await recorder.startRecord()
    expect(recorder.isRecording.value).toBe(true)

    // Simulate audio data arriving through the ScriptProcessorNode
    expect(latestProcessor?.onaudioprocess).toBeDefined()
    const mockChannelData = new Float32Array(4096).fill(0.1)
    latestProcessor.onaudioprocess({
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
    const streamRef = ref<MediaStream>({ id: 'stream-1' } as any)
    const recorder = useAudioRecorder(streamRef)
    const onStopHook = vi.fn()

    const unregister = recorder.onStopRecord(onStopHook)
    unregister()

    await recorder.startRecord()
    latestProcessor.onaudioprocess({
      inputBuffer: {
        getChannelData: () => new Float32Array(4096).fill(0.2),
      },
    })
    await recorder.stopRecord()

    expect(onStopHook).not.toHaveBeenCalled()
  })
})
