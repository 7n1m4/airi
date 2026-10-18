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

  // additional coverage
  it('split instance key and instance options', () => {
    const state = makeState({
      providerMetadata: { p: { defaultOptions: () => ({ a: 1 }) } as unknown as ProviderMetadata },
      providerInstanceOptions: (pid, iid) => (iid ? { a: 9 } : undefined),
    })
    const sel = createProvidersConfigSelectors(state as unknown as ProvidersConfigSelectorsState)
    expect(sel.getProviderConfig('p:inst')).toEqual({ a: 9 })
    expect(sel.getDefaultProviderConfig('p:inst')).toEqual({ a: 1, baseUrl: '' })
  })

  it('getProviderConfig instance fallback to credentials', () => {
    const state = makeState({
      providerMetadata: { p: { defaultOptions: () => ({}) } as unknown as ProviderMetadata },
      providerCredentials: ref({ p: { x: 1 } }),
    })
    const sel = createProvidersConfigSelectors(state as unknown as ProvidersConfigSelectorsState)
    expect(sel.getProviderConfig('p')).toEqual({ x: 1 })
  })

  it('isProviderConfigDirty instance and missing config false', () => {
    const state = makeState({
      providerMetadata: { p: { defaultOptions: () => ({}) } as unknown as ProviderMetadata },
    })
    const sel = createProvidersConfigSelectors(state as unknown as ProvidersConfigSelectorsState)
    expect(sel.isProviderConfigDirty('p')).toBe(false)
    expect(sel.isProviderConfigDirty('p:x')).toBe(false)
  })

  it('isProviderConfigDirty true for instance', () => {
    const state = makeState({
      providerMetadata: { p: { defaultOptions: () => ({ baseUrl: '' }) } as unknown as ProviderMetadata },
      providerInstanceOptions: () => ({ baseUrl: 'x' }),
    })
    const sel = createProvidersConfigSelectors(state as unknown as ProvidersConfigSelectorsState)
    expect(sel.isProviderConfigDirty('p:i')).toBe(true)
  })

  it('isProviderConfigured apple-core-ai requires added', () => {
    const meta = { defaultOptions: () => ({}), requiresCredentials: true, deployment: 'cloud' } as unknown as ProviderMetadata
    const state = makeState({ providerMetadata: { 'apple-core-ai': meta } })
    const sel = createProvidersConfigSelectors(state as unknown as ProvidersConfigSelectorsState)
    expect(sel.isProviderConfigured('apple-core-ai')).toBe(false)
    const state2 = makeState({ providerMetadata: { 'apple-core-ai': meta }, addedProviders: ref({ 'apple-core-ai': true }) })
    const sel2 = createProvidersConfigSelectors(state2 as unknown as ProvidersConfigSelectorsState)
    expect(sel2.isProviderConfigured('apple-core-ai')).toBe(true)
  })

  it('isProviderConfigured keyless/local true', () => {
    const meta = { defaultOptions: () => ({}), requiresCredentials: false, deployment: 'cloud' } as unknown as ProviderMetadata
    const state = makeState({ providerMetadata: { p: meta } })
    const sel = createProvidersConfigSelectors(state as unknown as ProvidersConfigSelectorsState)
    expect(sel.isProviderConfigured('p')).toBe(true)
  })

  it('isProviderConfigured browser-web-speech-api true', () => {
    const meta = { defaultOptions: () => ({}), requiresCredentials: true, deployment: 'cloud' } as unknown as ProviderMetadata
    const state = makeState({ providerMetadata: { 'browser-web-speech-api': meta } })
    const sel = createProvidersConfigSelectors(state as unknown as ProvidersConfigSelectorsState)
    expect(sel.isProviderConfigured('browser-web-speech-api')).toBe(true)
  })

  it('isProviderConfigured gemini audio no parent key', () => {
    const meta = { defaultOptions: () => ({}), requiresCredentials: true, deployment: 'cloud' } as unknown as ProviderMetadata
    const state = makeState({ providerMetadata: { 'google-gemini-audio-speech': meta }, providerCredentials: ref({ 'google-generative-ai': { apiKey: '   ' } }) })
    const sel = createProvidersConfigSelectors(state as unknown as ProvidersConfigSelectorsState)
    expect(sel.isProviderConfigured('google-gemini-audio-speech')).toBe(false)
  })

  it('isProviderConfigured gemini audio parent key', () => {
    const meta = { defaultOptions: () => ({}), requiresCredentials: true, deployment: 'cloud' } as unknown as ProviderMetadata
    const state = makeState({ providerMetadata: { 'google-gemini-audio-speech': meta }, providerCredentials: ref({ 'google-generative-ai': { apiKey: 'k' } }) })
    const sel = createProvidersConfigSelectors(state as unknown as ProvidersConfigSelectorsState)
    expect(sel.isProviderConfigured('google-gemini-audio-speech')).toBe(true)
  })

  it('isProviderConfigured credentialed apiKey/aws', () => {
    const meta = { defaultOptions: () => ({}), requiresCredentials: true, deployment: 'cloud' } as unknown as ProviderMetadata
    const state = makeState({ providerMetadata: { p: meta }, providerCredentials: ref({ p: { apiKey: ' k ' } }) })
    const sel = createProvidersConfigSelectors(state as unknown as ProvidersConfigSelectorsState)
    // trimmed length >0? ' k '.trim() = 'k' yes
    expect(sel.isProviderConfigured('p')).toBe(true)

    const state2 = makeState({ providerMetadata: { p: meta }, providerCredentials: ref({ p: { accessKeyId: 'a', secretAccessKey: 's' } }) })
    const sel2 = createProvidersConfigSelectors(state2 as unknown as ProvidersConfigSelectorsState)
    expect(sel2.isProviderConfigured('p')).toBe(true)

    const state3 = makeState({ providerMetadata: { p: meta }, providerCredentials: ref({ p: { apiKey: '   ' } }) })
    const sel3 = createProvidersConfigSelectors(state3 as unknown as ProvidersConfigSelectorsState)
    expect(sel3.isProviderConfigured('p')).toBe(false)

    const state4 = makeState({ providerMetadata: { p: meta } })
    const sel4 = createProvidersConfigSelectors(state4 as unknown as ProvidersConfigSelectorsState)
    expect(sel4.isProviderConfigured('p')).toBe(false)
  })

  it('isProviderConfigured instance options path', () => {
    const meta = { defaultOptions: () => ({}), requiresCredentials: true, deployment: 'cloud' } as unknown as ProviderMetadata
    const state = makeState({ providerMetadata: { p: meta }, providerInstanceOptions: () => ({ apiKey: 'k' }) })
    const sel = createProvidersConfigSelectors(state as unknown as ProvidersConfigSelectorsState)
    expect(sel.isProviderConfigured('p:i')).toBe(true)
  })

  it('shouldListProvider false when not added/dirty', () => {
    const meta = { defaultOptions: () => ({ baseUrl: '' }), requiresCredentials: true, deployment: 'cloud' } as unknown as ProviderMetadata
    const state = makeState({ providerMetadata: { p: meta } })
    const sel = createProvidersConfigSelectors(state as unknown as ProvidersConfigSelectorsState)
    expect(sel.shouldListProvider('p')).toBe(false)
  })

  it('instance id strips repeated provider prefix', () => {
    const meta = { defaultOptions: () => ({}) } as unknown as ProviderMetadata
    const state = makeState({ providerMetadata: { p: meta }, providerInstanceOptions: (pid, iid) => ({ iid }) })
    const sel = createProvidersConfigSelectors(state as unknown as ProvidersConfigSelectorsState)
    expect(sel.getProviderConfig('p:p:inst')).toEqual({ iid: 'inst' })
  })

  it('split key with nested colon', () => {
    const meta = { defaultOptions: () => ({}) } as unknown as ProviderMetadata
    const state = makeState({ providerMetadata: { p: meta } })
    const sel = createProvidersConfigSelectors(state as unknown as ProvidersConfigSelectorsState)
    // instance id with colon
    expect(sel.getProviderConfig('p:a:b')).toBeDefined()
  })
})
