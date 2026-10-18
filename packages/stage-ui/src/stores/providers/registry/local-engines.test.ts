import { detectWebGPU } from '@proj-airi/stage-shared/webgpu'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { NativeAI } from '../../../libs/native-ai'
import { localEngineMetadata } from './local-engines'

vi.mock('@proj-airi/stage-shared', () => ({
  isApplePlatform: () => false,
  isStageTamagotchi: () => false,
  isStageWeb: () => true,
}))

vi.mock('@proj-airi/stage-shared/webgpu', () => ({
  detectWebGPU: vi.fn(async () => ({ fp16Supported: true })),
  isWebGPUSupported: vi.fn(() => true),
}))

vi.mock('../../../libs/inference', () => ({
  createLocalVisionAdapter: vi.fn(() => ({
    captionImage: () => {},
    loadModel: () => {},
    state: 'x',
    deviceLossCount: 0,
    terminate: () => {},
  })),
  DEFAULT_LOCAL_VISION_MODEL: '',
  LOCAL_VISION_MODELS: [{ id: 'm', name: 'M', description: 'd' }],
}))

vi.mock('../../../libs/inference/constants', () => ({
  DEFAULT_WEB_LLM_MODEL: 'default-llm',
  DEFAULT_WEB_RWKV_MODEL: 'default-rwkv',
  WEB_LLM_MODELS: [{ id: 'curated', name: 'C', description: 'D', fp16: false }],
  WEB_RWKV_MODELS: [{ id: 'r', name: 'R', badge: 'b', description: 'd' }],
}))

vi.mock('../../../libs/native-ai', () => ({
  NativeAI: { isNative: vi.fn(() => true), isModelCached: vi.fn(async () => true) },
}))

vi.mock('../apple-core-ai', () => ({
  createAppleCoreAIChatProvider: vi.fn(async () => ({})),
  DEFAULT_APPLE_CORE_AI_MODEL: '',
}))

vi.mock('../moondream', () => ({ createMoondreamChatProvider: vi.fn(async () => ({})) }))
vi.mock('../web-llm', () => ({ createWebLlmChatProvider: vi.fn(async () => ({})) }))
vi.mock('../web-rwkv', () => ({ createWebRwkvChatProvider: vi.fn(async () => ({})) }))

describe('localEngineMetadata', () => {
  it('exposes all entries', () => {
    expect(Object.keys(localEngineMetadata).sort()).toEqual([
      'apple-core-ai',
      'blip-local',
      'moondream-local',
      'web-llm',
      'web-rwkv',
    ])
  })

  it('runs isAvailableBy for all', () => {
    for (const m of Object.values(localEngineMetadata)) {
      expect(typeof m.isAvailableBy?.()).toBe('boolean')
    }
  })

  it('defaultOptions for all', () => {
    for (const m of Object.values(localEngineMetadata)) {
      expect(m.defaultOptions?.()).toBeTruthy()
    }
  })

  it('createProvider for all', async () => {
    for (const m of Object.values(localEngineMetadata)) {
      const p = await m.createProvider?.({ model: 'x' } as Record<string, unknown>)
      expect(p).toBeTruthy()
    }
  })

  it('reads blip provider computed state', async () => {
    const m = localEngineMetadata['blip-local']
    const p = await m.createProvider!({ model: 'm' } as Record<string, unknown>) as { state: unknown, deviceLossCount: unknown, terminate: () => void }
    expect(p.state).toBeTruthy()
    expect(p.deviceLossCount).toBeTruthy()
    p.terminate()
  })

  it('listModels for all', async () => {
    for (const m of Object.values(localEngineMetadata)) {
      const models = await m.capabilities?.listModels?.({ model: 'custom-x', modelUrl: 'http://u', modelLib: '' } as Record<string, unknown>)
      expect(Array.isArray(models)).toBe(true)
    }
  })

  it('web-rwkv listModels custom push branch', async () => {
    const m = localEngineMetadata['web-rwkv']
    const models = await m.capabilities!.listModels!({ model: 'http://custom' } as Record<string, unknown>)
    expect(models.some(x => x.id === 'http://custom')).toBe(true)
  })

  it('web-llm listModels fp16 false branch', async () => {
    vi.mocked(detectWebGPU).mockResolvedValueOnce({ fp16Supported: false } as never)
    const m = localEngineMetadata['web-llm']
    const models = await m.capabilities!.listModels!({} as Record<string, unknown>)
    expect(Array.isArray(models)).toBe(true)
  })

  it('web-llm listModels custom push branch', async () => {
    const m = localEngineMetadata['web-llm']
    const models = await m.capabilities!.listModels!({ model: 'custom-id', modelUrl: 'http://u' } as Record<string, unknown>)
    expect(models.some(x => x.id === 'custom-id')).toBe(true)
  })

  it('validators', async () => {
    const rwkv = localEngineMetadata['web-rwkv']
    expect(rwkv.validators!.validateProviderConfig!({ model: '' } as Record<string, unknown>).valid).toBe(true)
    expect(rwkv.validators!.validateProviderConfig!({ model: 'u' } as Record<string, unknown>).valid).toBe(true)

    const llm = localEngineMetadata['web-llm']
    expect(llm.validators!.validateProviderConfig!({ model: '' } as Record<string, unknown>).valid).toBe(true)
    expect(llm.validators!.validateProviderConfig!({ model: 'custom-id', modelUrl: 'http://u', modelLib: '' } as Record<string, unknown>).valid).toBe(false)
    expect(llm.validators!.validateProviderConfig!({ model: 'custom-id', modelUrl: 'http://u', modelLib: 'lib' } as Record<string, unknown>).valid).toBe(true)
    expect(llm.validators!.validateProviderConfig!({ model: 'curated' } as Record<string, unknown>).valid).toBe(true)

    const blip = localEngineMetadata['blip-local']
    expect(blip.validators!.validateProviderConfig!({ model: '' } as Record<string, unknown>).valid).toBe(false)
    expect(blip.validators!.validateProviderConfig!({ model: 'm' } as Record<string, unknown>).valid).toBe(true)
    const apple = localEngineMetadata['apple-core-ai']
    expect((await apple.validators!.validateProviderConfig!({ model: '' } as Record<string, unknown>)).valid).toBe(false)
    vi.mocked(NativeAI.isNative).mockReturnValueOnce(false)
    expect((await apple.validators!.validateProviderConfig!({ model: 'm' } as Record<string, unknown>)).valid).toBe(false)

    vi.mocked(NativeAI.isNative).mockReturnValue(true)
    vi.mocked(NativeAI.isModelCached).mockResolvedValueOnce(false)
    expect((await apple.validators!.validateProviderConfig!({ model: 'm' } as Record<string, unknown>)).valid).toBe(false)

    vi.mocked(NativeAI.isModelCached).mockResolvedValueOnce(true)
    expect((await apple.validators!.validateProviderConfig!({ model: 'm' } as Record<string, unknown>)).valid).toBe(true)
  })
})

afterEach(() => vi.unstubAllGlobals())
