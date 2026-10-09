import type { ChatProvider } from '@xsai-ext/providers/utils'

import { describe, expect, it } from 'vitest'
import { parse } from 'zod/v4/core'

import { getDefinedProvider } from '../registry'
import { providerKilo } from './index'

const translate = (key: string) => key

describe('providerKilo', () => {
  it('registers Kilo in the provider registry', () => {
    expect(getDefinedProvider('kilo')).toEqual(providerKilo)
  })

  it('fills the default base URL and empty apiKey when user provides nothing', async () => {
    const schema = await providerKilo.createProviderConfig({ t: translate })

    expect(parse(schema, {})).toEqual({
      apiKey: '',
      baseUrl: 'https://api.kilo.ai/api/gateway/v1',
    })
  })

  it('allows overriding base URL while keeping empty apiKey', async () => {
    const schema = await providerKilo.createProviderConfig({ t: translate })

    expect(parse(schema, { baseUrl: 'https://custom.kilo.ai/v1/' })).toEqual({
      apiKey: '',
      baseUrl: 'https://custom.kilo.ai/v1/',
    })
  })

  it('creates an OpenAI-compatible provider with Kilo defaults', async () => {
    const provider = await providerKilo.createProvider({
      apiKey: '',
      baseUrl: 'https://api.kilo.ai/api/gateway/v1',
    })

    expect((provider as ChatProvider).chat('kilo-auto')).toMatchObject({
      apiKey: '',
      baseURL: 'https://api.kilo.ai/api/gateway/v1',
      model: 'kilo-auto',
    })
  })

  it('always requires validation (keyless but connectivity check)', () => {
    expect(providerKilo.validationRequiredWhen?.({})).toBe(true)
    expect(providerKilo.validationRequiredWhen?.({ apiKey: 'custom-key' })).toBe(true)
  })

  it('has keyless provider configuration', () => {
    expect(providerKilo.requiresCredentials).toBe(false)
    expect(providerKilo.business!({ t: translate }).pricing).toBe('free')
  })
})
