import { describe, expect, it } from 'vitest'
import { parse } from 'zod/v4/core'

import { getDefinedProvider } from '../registry'
import { OPPER_DEFAULT_BASE_URL, providerOpper } from './index'

const translate = (key: string) => key

describe('providerOpper', () => {
  it('registers Opper in the provider registry', () => {
    expect(getDefinedProvider('opper')).toEqual(providerOpper)
  })

  it('fills the default base URL when the user enters only an API key', async () => {
    const schema = await providerOpper.createProviderConfig({ t: translate })

    expect(parse(schema, { apiKey: 'test-key' })).toEqual({
      apiKey: 'test-key',
      baseUrl: OPPER_DEFAULT_BASE_URL,
    })
  })

  it('creates an OpenAI-compatible provider with Opper base URL', async () => {
    const provider = (await providerOpper.createProvider({ apiKey: 'test-key', baseUrl: OPPER_DEFAULT_BASE_URL })) as any

    expect(provider.chat('claude-sonnet-4-6')).toMatchObject({
      apiKey: 'test-key',
      baseURL: OPPER_DEFAULT_BASE_URL,
      model: 'claude-sonnet-4-6',
    })
  })

  it('requires validation when apiKey is provided', () => {
    expect(providerOpper.validationRequiredWhen?.({ apiKey: 'test-key' })).toBe(true)
    expect(providerOpper.validationRequiredWhen?.({ apiKey: '' })).toBe(false)
  })
})
