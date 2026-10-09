import type { ChatProvider } from '@xsai-ext/providers/utils'

import { describe, expect, it } from 'vitest'
import { parse } from 'zod/v4/core'

import { getDefinedProvider } from '../registry'
import { providerLanlanFree } from './index'

const translate = (key: string) => key

describe('providerLanlanFree', () => {
  it('registers LanLan Free in the provider registry', () => {
    expect(getDefinedProvider('lanlan-free')).toEqual(providerLanlanFree)
  })

  it('fills the default base URL and apiKey when user provides nothing', async () => {
    const schema = await providerLanlanFree.createProviderConfig({ t: translate })

    expect(parse(schema, {})).toEqual({
      apiKey: 'free-access',
      baseUrl: 'https://www.lanlan.tech/text/v1/',
    })
  })

  it('allows overriding base URL while keeping default apiKey', async () => {
    const schema = await providerLanlanFree.createProviderConfig({ t: translate })

    expect(parse(schema, { baseUrl: 'https://custom.lanlan.tech/v1/' })).toEqual({
      apiKey: 'free-access',
      baseUrl: 'https://custom.lanlan.tech/v1/',
    })
  })

  it('creates an OpenAI-compatible provider with LanLan Free defaults', async () => {
    const provider = await providerLanlanFree.createProvider({
      apiKey: 'free-access',
      baseUrl: 'https://www.lanlan.tech/text/v1/',
    })

    expect((provider as ChatProvider).chat('free-model')).toMatchObject({
      apiKey: 'free-access',
      baseURL: 'https://www.lanlan.tech/text/v1/',
      model: 'free-model',
    })
  })

  it('always requires validation (keyless but connectivity check)', () => {
    expect(providerLanlanFree.validationRequiredWhen?.({})).toBe(true)
    expect(providerLanlanFree.validationRequiredWhen?.({ apiKey: 'custom-key' })).toBe(true)
  })

  it('has keyless provider configuration', () => {
    expect(providerLanlanFree.requiresCredentials).toBe(false)
    expect(providerLanlanFree.business!({ t: translate }).pricing).toBe('free')
  })

  it('lists default model via extraMethods', async () => {
    const config = { apiKey: 'free-access', baseUrl: 'https://www.lanlan.tech/text/v1/' }
    const provider = await providerLanlanFree.createProvider(config)
    const models = await providerLanlanFree.extraMethods?.listModels?.(config, provider)
    expect(models).toEqual([
      {
        id: 'free-model',
        name: 'free-model',
        provider: 'lanlan-free',
        description: 'Default free model (StepFun)',
      },
    ])
  })
})
