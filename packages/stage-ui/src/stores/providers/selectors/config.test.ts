import type { Ref } from 'vue'

import type { ProviderMetadata } from '../types'
import type { ProvidersConfigSelectorsState } from './config'

import { describe, expect, it } from 'vitest'
import { ref } from 'vue'

import { createProvidersConfigSelectors } from './config'

interface StateInput {
  providerCredentials?: Ref<Record<string, Record<string, unknown>>>
  addedProviders?: Ref<Record<string, boolean>>
  providerMetadata?: Record<string, ProviderMetadata>
  providerInstanceOptions?: (providerId: string, instanceId?: string) => Record<string, unknown> | undefined
}

function makeState(overrides: StateInput = {}) {
  return {
    providerCredentials: overrides.providerCredentials ?? ref({}),
    addedProviders: overrides.addedProviders ?? ref({}),
    providerMetadata: overrides.providerMetadata ?? {},
    providerInstanceOptions: overrides.providerInstanceOptions,
  }
}

describe('providers config selectors', () => {
  it('getProviderConfig on unknown returns empty', () => {
    const state = makeState()
    const sel = createProvidersConfigSelectors(state as unknown as ProvidersConfigSelectorsState)
    expect(sel.getProviderConfig('openai')).toEqual({})
  })

  it('getDefaultProviderConfig adds baseUrl when missing', () => {
    const state = makeState({
      providerMetadata: {
        p: { defaultOptions: () => ({ foo: 1 }) } as unknown as ProviderMetadata,
      },
    })
    const sel = createProvidersConfigSelectors(state as unknown as ProvidersConfigSelectorsState)
    expect(sel.getDefaultProviderConfig('p')).toEqual({ foo: 1, baseUrl: '' })
  })

  it('getDefaultProviderConfig keeps baseUrl if present', () => {
    const state = makeState({
      providerMetadata: {
        p: { defaultOptions: () => ({ baseUrl: 'http://x/' }) } as unknown as ProviderMetadata,
      },
    })
    const sel = createProvidersConfigSelectors(state as unknown as ProvidersConfigSelectorsState)
    expect(sel.getDefaultProviderConfig('p')).toEqual({ baseUrl: 'http://x/' })
  })

  it('getProviderConfig merges defaults and persisted', () => {
    const state = makeState({
      providerMetadata: { p: { defaultOptions: () => ({ a: 1, baseUrl: '' }) } as unknown as ProviderMetadata },
      providerCredentials: ref({ p: { a: 2 } }),
    })
    const sel = createProvidersConfigSelectors(state as unknown as ProvidersConfigSelectorsState)
    expect(sel.getProviderConfig('p')).toEqual({ a: 2, baseUrl: '' })
  })

  it('isProviderConfigDirty compares config to defaults', () => {
    const state = makeState({
      providerMetadata: { p: { defaultOptions: () => ({ baseUrl: '' }) } as unknown as ProviderMetadata },
      providerCredentials: ref({ p: { baseUrl: 'http://x/' } }),
    })
    const sel = createProvidersConfigSelectors(state as unknown as ProvidersConfigSelectorsState)
    expect(sel.isProviderConfigDirty('p')).toBe(true)
  })

  it('isProviderConfigured returns false for unknown', () => {
    const state = makeState()
    const sel = createProvidersConfigSelectors(state as unknown as ProvidersConfigSelectorsState)
    expect(sel.isProviderConfigured('nope')).toBe(false)
  })

  it('shouldListProvider uses addedProviders or dirty', () => {
    const state = makeState({
      providerMetadata: { p: { defaultOptions: () => ({ baseUrl: '' }), requiresCredentials: true, deployment: 'cloud' } as unknown as ProviderMetadata },
      addedProviders: ref({ p: true }),
    })
    const sel = createProvidersConfigSelectors(state as unknown as ProvidersConfigSelectorsState)
    expect(sel.shouldListProvider('p')).toBe(true)
  })
})
