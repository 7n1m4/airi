import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { nextTick, ref, shallowRef } from 'vue'

import { useSettingsAudioDevice } from './audio-device'

const mockAudioOutputs = ref([
  { deviceId: 'default', label: 'Default - Built-in Speakers', kind: 'audiooutput', groupId: '' },
  { deviceId: 'vb-cable-id', label: 'CABLE Input (VB-Audio Virtual Cable)', kind: 'audiooutput', groupId: '' },
])

const mockAudioInputs = ref([
  { deviceId: 'default', label: 'Default - Built-in Microphone', kind: 'audioinput', groupId: '' },
])

const mockSetSinkId = vi.fn().mockResolvedValue(undefined)

vi.mock('@vueuse/core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@vueuse/core')>()
  return {
    ...actual,
    useDevicesList: () => ({
      audioInputs: mockAudioInputs,
      audioOutputs: mockAudioOutputs,
      devices: ref([]),
      ensurePermissions: vi.fn().mockResolvedValue(true),
    }),
    useUserMedia: () => ({
      stream: ref(null),
      start: vi.fn(),
      stop: vi.fn(),
    }),
  }
})

vi.mock('../audio', async () => {
  const actual = await vi.importActual<any>('../audio')
  return {
    ...actual,
    useAudioContext: () => ({
      audioContext: shallowRef({
        setSinkId: mockSetSinkId,
      }),
      setSinkId: mockSetSinkId,
    }),
  }
})

describe('useSettingsAudioDevice', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    localStorage.clear()
    mockSetSinkId.mockClear()
  })

  it('exposes audioOutputs and defaults selectedAudioOutput to empty string', () => {
    const store = useSettingsAudioDevice()
    expect(store.audioOutputs).toHaveLength(2)
    expect(store.selectedAudioOutput).toBe('')
    expect(store.selectedAudioOutputLabel).toBe('Default Output Device')
  })

  it('updates selectedAudioOutput and routes sinkId to audioContext', async () => {
    const store = useSettingsAudioDevice()
    store.selectedAudioOutput = 'vb-cable-id'
    await nextTick()
    expect(store.selectedAudioOutput).toBe('vb-cable-id')
    expect(store.selectedAudioOutputLabel).toBe('CABLE Input (VB-Audio Virtual Cable)')
    expect(mockSetSinkId).toHaveBeenCalledWith('vb-cable-id')
  })

  it('resets selectedAudioOutput and resets sinkId on resetState', async () => {
    const store = useSettingsAudioDevice()
    store.selectedAudioOutput = 'vb-cable-id'
    await nextTick()
    expect(mockSetSinkId).toHaveBeenCalledWith('vb-cable-id')

    store.resetState()
    await nextTick()
    expect(store.selectedAudioOutput).toBe('')
    expect(mockSetSinkId).toHaveBeenCalledWith('')
  })
})
