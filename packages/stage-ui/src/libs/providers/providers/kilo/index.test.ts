import type { ChatProvider } from '@xsai-ext/providers/utils'

import z from 'zod'

import { describe, expect, it } from 'vitest'
import { parse } from 'zod/v4/core'

import { isKeylessProvider, isOptionalKeyProvider, keylessOrOptionalKey } from '../../types'
import { getDefinedProvider } from '../registry'
import { KILO_GATEWAY_MODELS_URL, providerKilo } from './index'

const translate = (key: string) => key

// NOTICE: Mirrors index.ts's kiloGatewayModelSchema so the live expectations
// discard exactly the same malformed rows the production fetch discards. Kept
// local to the test instead of exported to avoid widening the module surface.
const gatewayModelSchema = z.object({
  id: z.string(),
  name: z.string().optional(),
  description: z.string().optional(),
  isFree: z.boolean().optional(),
  context_length: z.number().int().nonnegative().nullable().optional(),
  top_provider: z.object({ context_length: z.number().int().nonnegative().nullable().optional() }).optional(),
  architecture: z.object({ input_modalities: z.array(z.string()).optional() }).optional(),
})

// NOTICE: Mirrors index.ts's isFreeGatewayModel exactly (including the two
// fallback checks for free ids that do not end in :free).
function isFreeGatewayModel(model: z.infer<typeof gatewayModelSchema>): boolean {
  return model.isFree === true || model.id.includes(':free') || /(^|\/)free$/.test(model.id)
}

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

    expect((provider as ChatProvider).chat('kilo-auto/free')).toMatchObject({
      apiKey: '',
      baseURL: 'https://api.kilo.ai/api/gateway/v1',
      model: 'kilo-auto/free',
    })
  })

  it('always requires validation (keyless but connectivity check)', () => {
    expect(providerKilo.validationRequiredWhen?.({})).toBe(true)
    expect(providerKilo.validationRequiredWhen?.({ apiKey: 'custom-key' })).toBe(true)
  })

  it('runs keyless but accepts an optional key', () => {
    expect(providerKilo.requiresCredentials).toEqual({ optional: true })
    expect(providerKilo.business!({ t: translate }).pricing).toBe('free')
    expect(isOptionalKeyProvider(providerKilo.requiresCredentials)).toBe(true)
    expect(isKeylessProvider(providerKilo.requiresCredentials)).toBe(false)
    expect(keylessOrOptionalKey(providerKilo.requiresCredentials)).toBe(true)
  })

  it('lists every gateway free model once the live listing is used', async (ctx) => {
    // NOTICE: An external outage must not make CI red, but it must not look like
    // the live path passed either — skip with the reason instead.
    let response: Response
    try {
      response = await fetch(KILO_GATEWAY_MODELS_URL)
    }
    catch (error) {
      ctx.skip(`live Kilo gateway unreachable: ${error instanceof Error ? error.message : String(error)}`)
      return
    }
    if (!response.ok) {
      ctx.skip(`live Kilo gateway unreachable: HTTP ${response.status} ${response.statusText}`)
      return
    }
    let payload: unknown
    try {
      payload = await response.json()
    }
    catch (error) {
      ctx.skip(`live Kilo gateway response unreadable: ${error instanceof Error ? error.message : String(error)}`)
      return
    }

    const envelope = z.union([
      z.array(z.unknown()),
      z.object({ data: z.array(z.unknown()) }),
    ]).safeParse(payload)
    const rows = envelope.success
      ? (Array.isArray(envelope.data) ? envelope.data : envelope.data.data)
      : []
    const gatewayRows = rows.flatMap((row) => {
      const parsed = gatewayModelSchema.safeParse(row)
      return parsed.success ? [parsed.data] : []
    })
    const expectedFreeIds = gatewayRows.filter(isFreeGatewayModel).map(model => model.id)
    const expectedNonFreeIds = gatewayRows.filter(model => !isFreeGatewayModel(model)).map(model => model.id)

    if (expectedFreeIds.length === 0) {
      ctx.skip('live Kilo gateway returned no parseable free models')
      return
    }

    const config = { apiKey: '', baseUrl: 'https://api.kilo.ai/api/gateway/v1' }
    const provider = await providerKilo.createProvider(config)
    const models = await providerKilo.extraMethods?.listModels?.(config, provider)
    const actualIds = (models ?? []).map(model => model.id)

    // Expectations come from the live payload, so catalog churn cannot stale
    // this test — only a real divergence from the production path can.
    expect(actualIds.length).toBeGreaterThan(0)
    for (const id of expectedFreeIds) {
      expect(actualIds).toContain(id)
    }
    // arrayContaining([]) matches every array, so negate it only when there
    // are non-free ids to check against.
    if (expectedNonFreeIds.length > 0) {
      expect(actualIds).toEqual(expect.not.arrayContaining(expectedNonFreeIds))
    }
    expect(new Set(actualIds).size).toBe(actualIds.length)
  })

  it('keeps preset metadata when a live row matches a preset id', async () => {
    const config = { apiKey: '', baseUrl: 'https://api.kilo.ai/api/gateway/v1' }
    const provider = await providerKilo.createProvider(config)
    const models = await providerKilo.extraMethods?.listModels?.(config, provider)
    const dots = (models ?? []).find(m => m.id === 'dots-studio/dots-3-note-preview:free')

    expect(dots?.name).toBe('Dots3-Note Preview')
    expect(dots?.contextLength).toBe(512_000)
  })

  it('falls back to the preset list when the live fetch fails', async () => {
    const originalFetch = globalThis.fetch
    globalThis.fetch = (async () => {
      throw new Error('offline')
    }) as typeof fetch
    try {
      const config = { apiKey: '', baseUrl: 'https://api.kilo.ai/api/gateway/v1' }
      const provider = await providerKilo.createProvider(config)
      const models = await providerKilo.extraMethods?.listModels?.(config, provider)

      expect((models ?? []).length).toBeGreaterThan(0)
      // The fallback is the gateway's isFree set: the four suffix-less free
      // entries must be present, and no paid/stale ID may survive.
      const ids = (models ?? []).map(m => m.id)
      expect(ids).toEqual(expect.arrayContaining(['kilo-auto/free', 'reflection/beam-free', 'openrouter/free', 'stealth/glyph-cluster']))
      expect(ids).toEqual(
        expect.not.arrayContaining(['kilo-auto', 'poolside/laguna-m.1:free', 'poolside/laguna-xs.2:free', 'stepfun/step-3.7-flash:free', 'nvidia/nemotron-3-super-120b-a12b:free', 'nvidia/nemotron-3.5-content-safety:free', 'xingchen-agi/xing4.0-29b-a4b:free', 'thinkingmachines/inkling-small:free', 'poolside/laguna-s-2.1:free', 'poolside/laguna-xs-2.1:free', 'liquid/lfm-2.5-2.6b:free']),
      )
    }
    finally {
      globalThis.fetch = originalFetch
    }
  })
})
