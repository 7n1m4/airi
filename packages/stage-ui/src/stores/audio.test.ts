import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'

import { useAudioContext, useAudioDevice, useSpeakingStore } from './audio'

const mockAudioInputs = ref<unknown[]>([])
const mockAudioOutputs = ref<unknown[]>([])
const mockEnsurePermissions = vi.fn().mockResolvedValue(true)
const mockStart = vi.fn()
const mockStop = vi.fn()
const mockStream = ref<unknown>(null)

vi.mock('@vueuse/core', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>()
  return {
    ...actual,
    useDevicesList: () => ({
      audioInputs: mockAudioInputs,
      audioOutputs: mockAudioOutputs,
      devices: ref([]),
      ensurePermissions: mockEnsurePermissions,
    }),
    useUserMedia: () => ({
      stream: mockStream,
      start: mockStart,
      stop: mockStop,
    }),
  }
})

function makeAnalyser(data: number[]) {
  const buf = new Uint8Array(data)
  return {
    frequencyBinCount: data.length,
    getByteFrequencyData: (target: Uint8Array) => {
      target.set(buf)
    },
  } as unknown as AnalyserNode
}

describe('audio store', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    mockAudioInputs.value = []
    mockAudioOutputs.value = []
    mockEnsurePermissions.mockClear()
    localStorage.clear()
  })

  it('calculateVolume linear', () => {
    const store = useAudioContext()
    const v = store.calculateVolume(makeAnalyser([10, 20, 30]), 'linear')
    expect(typeof v).toBe('number')
  })

  it('calculateVolume minmax', () => {
    const store = useAudioContext()
    const v = store.calculateVolume(makeAnalyser([10, 20, 30]), 'minmax')
    expect(typeof v).toBe('number')
  })

  it('calculateVolume minmax zero range', () => {
    const store = useAudioContext()
    const v = store.calculateVolume(makeAnalyser([5, 5, 5]), 'minmax')
    expect(v).toBe(0)
  })

  it('useAudioContext setSinkId no throw', async () => {
    const store = useAudioContext()
    await store.setSinkId('x')
    expect(true).toBe(true)
  })

  it('useSpeakingStore opacity', () => {
    const store = useSpeakingStore()
    expect(store.nowSpeakingAvatarBorderOpacity).toBe(30)
    store.mouthOpenSize = 1
    store.nowSpeaking = true
    expect(store.nowSpeakingAvatarBorderOpacity).toBe(1)
  })

  it('useAudioDevice basics', async () => {
    mockAudioInputs.value = [{ deviceId: 'default', label: 'default mic' }]
    const dev = useAudioDevice(false)
    expect(dev.audioInputs.value).toHaveLength(1)
    expect(dev.selectedAudioInputLabel.value).toBe('default mic')
    await dev.askPermission()
    expect(dev.selectedAudioInput.value).toBe('default')
  })

  it('useAudioDevice findBestDevice microphone array', async () => {
    mockAudioInputs.value = [
      { deviceId: 'a', label: 'Microphone Array' },
      { deviceId: 'default', label: 'Default' },
    ]
    const dev = useAudioDevice(false)
    await dev.askPermission()
    expect(dev.selectedAudioInput.value).toBe('a')
  })

  it('findBestDevice communications preference', async () => {
    mockAudioInputs.value = [
      { deviceId: 'comm', label: 'Microphone Array Communications' },
      { deviceId: 'arr', label: 'Microphone Array' },
    ]
    const dev = useAudioDevice(false)
    await dev.askPermission()
    expect(dev.selectedAudioInput.value).toBe('arr')
  })

  it('findBestDevice fallback first', async () => {
    mockAudioInputs.value = [{ deviceId: 'first', label: 'Plain Mic' }]
    const dev = useAudioDevice(false)
    await dev.askPermission()
    expect(dev.selectedAudioInput.value).toBe('first')
  })

  it('findBestDevice default mic', async () => {
    mockAudioInputs.value = [{ deviceId: 'default', label: 'Default Mic' }]
    const dev = useAudioDevice(false)
    await dev.askPermission()
    expect(dev.selectedAudioInput.value).toBe('default')
  })

  it('askPermission error', async () => {
    mockEnsurePermissions.mockRejectedValueOnce(new Error('nope'))
    const dev = useAudioDevice(false)
    await expect(dev.askPermission()).rejects.toThrow('nope')
  })

  it('useAudioDevice labels', () => {
    const dev = useAudioDevice(false)
    dev.selectedAudioOutput.value = 'out1'
    expect(dev.selectedAudioOutputLabel.value).toBe('out1')
    dev.selectedAudioOutput.value = ''
    expect(dev.selectedAudioOutputLabel.value).toBe('Default Output Device')
  })
})
