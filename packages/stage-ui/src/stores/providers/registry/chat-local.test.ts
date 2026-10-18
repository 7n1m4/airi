import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { chatLocalMetadata } from './chat-local'

const mockFetch = vi.fn()

beforeEach(() => {
  vi.stubGlobal('fetch', mockFetch)
})

afterEach(() => {
  vi.unstubAllGlobals()
  mockFetch.mockReset()
})

describe('chatLocalMetadata', () => {
  it('exposes vllm and player2 entries', () => {
    expect(Object.keys(chatLocalMetadata)).toEqual(['vllm', 'player2'])
    expect(chatLocalMetadata.vllm.id).toBe('vllm')
    expect(chatLocalMetadata.player2.id).toBe('player2')
  })

  it('vllm createProvider returns a provider', async () => {
    const provider = await chatLocalMetadata.vllm.createProvider?.({ baseUrl: 'http://localhost:8000/v1/' })
    expect(provider).toBeDefined()
  })

  it('vllm listModels returns models', async () => {
    const models = await chatLocalMetadata.vllm.capabilities?.listModels?.()
    expect(Array.isArray(models)).toBe(true)
    expect(models?.length).toBeGreaterThan(0)
  })

  it('vllm validator requires baseUrl', async () => {
    const result = await chatLocalMetadata.vllm.validators?.validateProviderConfig?.({})
    expect(result?.valid).toBe(false)
  })

  it('vllm validator rejects invalid url', async () => {
    const result = await chatLocalMetadata.vllm.validators?.validateProviderConfig?.({ baseUrl: 'not-a-url' })
    expect(result?.valid).toBe(false)
  })

  it('vllm validator handles ok fetch', async () => {
    mockFetch.mockResolvedValue({ ok: true, statusText: 'OK' })
    const result = await chatLocalMetadata.vllm.validators?.validateProviderConfig?.({ baseUrl: 'http://localhost:8000/v1/' })
    expect(result?.valid).toBe(true)
  })

  it('vllm validator handles non-ok fetch', async () => {
    mockFetch.mockResolvedValue({ ok: false, statusText: 'Bad Gateway' })
    const result = await chatLocalMetadata.vllm.validators?.validateProviderConfig?.({ baseUrl: 'http://localhost:8000/v1/' })
    expect(result?.valid).toBe(false)
  })

  it('vllm validator handles fetch failure', async () => {
    mockFetch.mockRejectedValue(new Error('boom'))
    const result = await chatLocalMetadata.vllm.validators?.validateProviderConfig?.({ baseUrl: 'http://localhost:8000/v1/' })
    expect(result?.valid).toBe(false)
  })

  it('player2 defaultOptions', () => {
    expect(chatLocalMetadata.player2.defaultOptions?.()).toEqual({ baseUrl: 'http://localhost:4315/v1/' })
  })

  it('player2 createProvider returns a provider', () => {
    const provider = chatLocalMetadata.player2.createProvider?.({ baseUrl: 'http://localhost:4315/v1/' })
    expect(provider).toBeDefined()
  })

  it('player2 listModels returns models', async () => {
    const models = await chatLocalMetadata.player2.capabilities?.listModels?.()
    expect(Array.isArray(models)).toBe(true)
  })

  it('player2 validator requires baseUrl', async () => {
    const result = await chatLocalMetadata.player2.validators?.validateProviderConfig?.({})
    expect(result?.valid).toBe(false)
  })

  it('player2 validator rejects invalid url', async () => {
    const result = await chatLocalMetadata.player2.validators?.validateProviderConfig?.({ baseUrl: 'not-a-url' })
    expect(result?.valid).toBe(false)
  })

  it('player2 validator handles ok fetch', async () => {
    mockFetch.mockResolvedValue({ ok: true, statusText: 'OK' })
    const result = await chatLocalMetadata.player2.validators?.validateProviderConfig?.({ baseUrl: 'http://localhost:4315/v1/' })
    expect(result?.valid).toBe(true)
  })

  it('player2 validator handles non-ok fetch', async () => {
    mockFetch.mockResolvedValue({ ok: false, statusText: 'Bad' })
    const result = await chatLocalMetadata.player2.validators?.validateProviderConfig?.({ baseUrl: 'http://localhost:4315/v1/' })
    expect(result?.valid).toBe(false)
  })

  it('player2 validator handles fetch failure', async () => {
    mockFetch.mockRejectedValue(new Error('boom'))
    const result = await chatLocalMetadata.player2.validators?.validateProviderConfig?.({ baseUrl: 'http://localhost:4315/v1/' })
    expect(result?.valid).toBe(false)
  })
})
