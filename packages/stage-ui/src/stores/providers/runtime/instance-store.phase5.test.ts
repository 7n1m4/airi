import type { Ref } from 'vue'

import type { ProvidersConfigSelectorsState } from '../selectors/config'
import type { ProviderMetadata } from '../types'
import type { ProviderInstancesDeps } from './instances'

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'

import { createProvidersConfigSelectors } from '../selectors/config'
import { createProviderInstanceStore } from './instance-store'
import { createProviderInstances } from './instances'

function makeCloudProviderMetadata(id: string, requiresCredentials: boolean = true): ProviderMetadata {
  return {
    id,
    category: 'chat',
    tasks: [],
    nameKey: `test.providers.${id}.name`,
    name: id,
    descriptionKey: `test.providers.${id}.description`,
    description: id,
    requiresCredentials,
    defaultOptions: () => ({}),
    createProvider: vi.fn().mockResolvedValue({ stubProvider: id } as any),
    capabilities: {},
    validators: {
      validateProviderConfig: () => Promise.resolve({ errors: [], reason: '', valid: true }),
    },
  }
}

describe('phase 5: upstream migration compatibility & defensive validation', () => {
  const memoryStore = new Map<string, string>()

  const localStorageStub = {
    getItem: (key: string) => memoryStore.get(key) ?? null,
    setItem: (key: string, value: string) => { memoryStore.set(key, String(value)) },
    removeItem: (key: string) => { memoryStore.delete(key) },
    clear: () => { memoryStore.clear() },
    key: (index: number) => Array.from(memoryStore.keys())[index] ?? null,
    get length() { return memoryStore.size },
  }

  beforeEach(() => {
    memoryStore.clear()
    vi.stubGlobal('localStorage', localStorageStub)
  })

  describe('instance-store.ts upstream migration', () => {
    it('passes through an already-v2 snapshot unchanged', () => {
      const snapshot = {
        version: 2 as const,
        instancesByInstanceKey: {
          'openrouter-ai:*': {
            instanceId: 'openrouter-ai:*',
            id: '*',
            providerId: 'openrouter-ai',
            label: 'Default',
            options: { apiKey: 'sk-or-live' },
            isPrimary: true,
          },
        },
      }
      const store = createProviderInstanceStore(ref(snapshot))
      const rows = store.listInstances('openrouter-ai')
      expect(rows).toHaveLength(1)
      expect(rows[0].options.apiKey).toBe('sk-or-live')
    })

    it('converts upstream single-slot credentials to a v2 primary instance with label "Default"', () => {
      const legacyState = ref({
        'openrouter-ai': { apiKey: 'sk-or-v1-migrate' },
      })
      const store = createProviderInstanceStore(legacyState)
      const rows = store.listInstances('openrouter-ai')
      expect(rows).toHaveLength(1)
      expect(rows[0].id).toBe('*')
      expect(rows[0].providerId).toBe('openrouter-ai')
      expect(rows[0].isPrimary).toBe(true)
      expect(rows[0].label).toBe('Default')
      expect(rows[0].options.apiKey).toBe('sk-or-v1-migrate')

      // Verify on-disk shape is actually v2 after migration
      expect((store.state.value as any).version).toBe(2)
    })

    it('normalizes upstream snake_case aliases into camelCase keys when canonical is absent', () => {
      const store = createProviderInstanceStore(ref({
        'openrouter-ai': { api_key: 'sk-or-alias', base_url: 'https://openrouter.example/api' },
      }))
      const row = store.listInstances('openrouter-ai')[0]
      expect(row.options.apiKey).toBe('sk-or-alias')
      expect(row.options.baseUrl).toBe('https://openrouter.example/api')
      // Original snake_case keys are preserved untouched; we only fill absent
      // canonical keys.
      expect(row.options.api_key).toBe('sk-or-alias')
      expect(row.options.base_url).toBe('https://openrouter.example/api')
    })

    it('prefers existing camelCase canonical keys over snake_case aliases', () => {
      const store = createProviderInstanceStore(ref({
        'openrouter-ai': {
          apiKey: 'sk-or-canonical',
          api_key: 'sk-or-legacy-alias',
        },
      }))
      expect(store.listInstances('openrouter-ai')[0].options.apiKey).toBe('sk-or-canonical')
    })

    it('discards empty credential stubs instead of materializing them as primary rows', () => {
      const store = createProviderInstanceStore(ref({
        'nothing-here': {},
        'whitespace-only': { apiKey: '   ' },
        'null-only': { apiKey: null },
        'openrouter-ai': { apiKey: 'sk-or-preserved' },
      }))

      expect(store.listInstances('nothing-here')).toHaveLength(0)
      expect(store.listInstances('whitespace-only')).toHaveLength(0)
      expect(store.listInstances('null-only')).toHaveLength(0)
      expect(store.listInstances('openrouter-ai')).toHaveLength(1)
    })

    it('surfaces real migrated credentials via the providerCredentials projection', () => {
      const store = createProviderInstanceStore(ref({
        'openrouter-ai': { apiKey: 'sk-or-projection' },
      }))
      const projected = store.providerCredentials.value['openrouter-ai']
      expect(projected).toBeDefined()
      expect(projected?.apiKey).toBe('sk-or-projection')
    })

    it('resolves unconfigured providers to undefined (never a truthy {} fallback)', () => {
      const store = createProviderInstanceStore(ref({}))
      expect(store.providerCredentials.value['openrouter-ai']).toBeUndefined()
    })
  })

  describe('selectors/config.ts isProviderConfigured', () => {
    const openRouterMeta = makeCloudProviderMetadata('openrouter-ai')
    const ollamaMeta = makeCloudProviderMetadata('ollama', false)
    const browserSpeechMeta = makeCloudProviderMetadata('browser-web-speech-api', false)

    function makeSelectorState(overrides: {
      credentials?: Record<string, Record<string, unknown>>
      added?: Record<string, boolean>
    } = {}): ProvidersConfigSelectorsState {
      return {
        providerCredentials: ref(overrides.credentials ?? {}) as Ref<Record<string, Record<string, unknown>>>,
        addedProviders: ref(overrides.added ?? {}) as Ref<Record<string, boolean>>,
        providerMetadata: {
          'openrouter-ai': openRouterMeta,
          'ollama': ollamaMeta,
          'browser-web-speech-api': browserSpeechMeta,
        },
      }
    }

    it('returns true for providers that explicitly opt out of credentials', () => {
      const s = createProvidersConfigSelectors(makeSelectorState())
      expect(s.isProviderConfigured('ollama')).toBe(true)
      expect(s.isProviderConfigured('browser-web-speech-api')).toBe(true)
    })

    it('returns false for credential-requiring providers with no persisted options', () => {
      const s = createProvidersConfigSelectors(makeSelectorState())
      expect(s.isProviderConfigured('openrouter-ai')).toBe(false)
    })

    it('returns false when only a default baseUrl is persisted (Phase-3 regression)', () => {
      const s = createProvidersConfigSelectors(makeSelectorState({
        credentials: {
          'openrouter-ai': { baseUrl: 'https://openrouter.ai/api/v1' },
        },
      }))
      expect(s.isProviderConfigured('openrouter-ai')).toBe(false)
    })

    it('returns false when apiKey is present but whitespace-only', () => {
      const s = createProvidersConfigSelectors(makeSelectorState({
        credentials: { 'openrouter-ai': { apiKey: '   ' } },
      }))
      expect(s.isProviderConfigured('openrouter-ai')).toBe(false)
    })

    it('returns false when addedProviders marker is set but credentials are absent', () => {
      // The added-provider marker is a UI listing hint only; it must not
      // qualify a credentialed provider as "configured" — that path was the
      // second Phase-3 regression lever.
      const s = createProvidersConfigSelectors(makeSelectorState({
        credentials: { 'openrouter-ai': {} },
        added: { 'openrouter-ai': true },
      }))
      expect(s.isProviderConfigured('openrouter-ai')).toBe(false)
    })

    it('returns true when a non-empty apiKey is persisted', () => {
      const s = createProvidersConfigSelectors(makeSelectorState({
        credentials: { 'openrouter-ai': { apiKey: 'sk-or-live-key' } },
      }))
      expect(s.isProviderConfigured('openrouter-ai')).toBe(true)
    })

    it('returns true when AWS access keypair is persisted', () => {
      const s = createProvidersConfigSelectors(makeSelectorState({
        credentials: {
          'openrouter-ai': {
            accessKeyId: 'AKIAIOSFODNN7EXAMPLE',
            secretAccessKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
          },
        },
      }))
      expect(s.isProviderConfigured('openrouter-ai')).toBe(true)
    })

    it('returns false for unknown providers', () => {
      const s = createProvidersConfigSelectors(makeSelectorState())
      expect(s.isProviderConfigured('does-not-exist')).toBe(false)
    })
  })

  describe('runtime/instances.ts getProviderInstance fail-fast guard', () => {
    function makeDeps(overrides: Partial<ProviderInstancesDeps> = {}): ProviderInstancesDeps {
      const cache: Ref<Record<string, unknown>> = ref({})
      return {
        providerInstanceCache: cache,
        providerMetadata: {
          'openrouter-ai': makeCloudProviderMetadata('openrouter-ai'),
          'browser-web-speech-api': makeCloudProviderMetadata('browser-web-speech-api', false),
        },
        getProviderCredentials: () => ({}),
        setProviderCredentials: () => {},
        getDefaultProviderConfig: () => ({}),
        ...overrides,
      }
    }

    it('throws a localized client error before SDK instantiation when credentials are missing', async () => {
      const deps = makeDeps()
      const { getProviderInstance } = createProviderInstances(deps)
      const createProviderSpy = deps.providerMetadata['openrouter-ai'].createProvider

      await expect(getProviderInstance('openrouter-ai'))
        .rejects
        .toThrowError('Provider credentials for openrouter-ai are missing or incomplete.')
      expect(createProviderSpy).not.toHaveBeenCalled()
    })

    it('throws a localized client error when apiKey is present but whitespace-only', async () => {
      const deps = makeDeps({
        getProviderCredentials: () => ({ 'openrouter-ai': { apiKey: '   ' } }),
      })
      const { getProviderInstance } = createProviderInstances(deps)
      const createProviderSpy = deps.providerMetadata['openrouter-ai'].createProvider

      await expect(getProviderInstance('openrouter-ai'))
        .rejects
        .toThrowError('Provider credentials for openrouter-ai are missing or incomplete.')
      expect(createProviderSpy).not.toHaveBeenCalled()
    })

    it('materializes default options for no-credential providers without throwing', async () => {
      const deps = makeDeps()
      const { getProviderInstance } = createProviderInstances(deps)
      await expect(getProviderInstance('browser-web-speech-api')).resolves.toBeDefined()
      expect(deps.providerMetadata['browser-web-speech-api'].createProvider).toHaveBeenCalledOnce()
    })

    it('instantiates the provider when a live apiKey is persisted', async () => {
      const deps = makeDeps({
        getProviderCredentials: () => ({ 'openrouter-ai': { apiKey: 'sk-or-live-key' } }),
      })
      const { getProviderInstance } = createProviderInstances(deps)
      const instance = await getProviderInstance('openrouter-ai')
      expect(instance).toEqual({ stubProvider: 'openrouter-ai' })
      expect(deps.providerMetadata['openrouter-ai'].createProvider).toHaveBeenCalledOnce()
    })

    it('resolves composite provider keys like openrouter-ai:* using instance options', async () => {
      const deps = makeDeps({
        providerInstanceOptions: (providerId, instanceId) => {
          if (providerId === 'openrouter-ai' && instanceId === '*') {
            return { apiKey: 'sk-or-primary-key' }
          }
          return undefined
        },
      })
      const { getProviderInstance } = createProviderInstances(deps)
      const instance = await getProviderInstance('openrouter-ai:*')
      expect(instance).toEqual({ stubProvider: 'openrouter-ai' })
      expect(deps.providerMetadata['openrouter-ai'].createProvider).toHaveBeenCalledWith({
        apiKey: 'sk-or-primary-key',
      })
    })

    it('resolves named secondary instance keys like openrouter-ai:custom', async () => {
      const deps = makeDeps({
        providerInstanceOptions: (providerId, instanceId) => {
          if (providerId === 'openrouter-ai' && instanceId === 'custom') {
            return { apiKey: 'sk-or-custom-key', baseUrl: 'https://custom.endpoint/v1' }
          }
          return undefined
        },
      })
      const { getProviderInstance } = createProviderInstances(deps)
      const instance = await getProviderInstance('openrouter-ai:custom')
      expect(instance).toEqual({ stubProvider: 'openrouter-ai' })
      expect(deps.providerMetadata['openrouter-ai'].createProvider).toHaveBeenCalledWith({
        apiKey: 'sk-or-custom-key',
        baseUrl: 'https://custom.endpoint/v1',
      })
    })

    it('resolves double-prefixed composite provider keys like openai-compatible:openai-compatible:vllm resiliently', async () => {
      const deps = makeDeps({
        providerMetadata: {
          'openai-compatible': makeCloudProviderMetadata('openai-compatible'),
        },
        providerInstanceOptions: (providerId, instanceId) => {
          if (providerId === 'openai-compatible' && instanceId === 'vllm') {
            return { apiKey: 'sk-vllm-key', baseUrl: 'http://10.0.0.91:8000/v1' }
          }
          return undefined
        },
      })
      const { getProviderInstance } = createProviderInstances(deps)
      const instance = await getProviderInstance('openai-compatible:openai-compatible:vllm')
      expect(instance).toEqual({ stubProvider: 'openai-compatible' })
      expect(deps.providerMetadata['openai-compatible'].createProvider).toHaveBeenCalledWith({
        apiKey: 'sk-vllm-key',
        baseUrl: 'http://10.0.0.91:8000/v1',
      })
    })
  })

  describe('multi-instance slug normalization & redundant prefix resilience', () => {
    it('addInstance creates clean slug and does not duplicate providerId in id or instanceId', () => {
      const store = createProviderInstanceStore(ref({ version: 2 as const, instancesByInstanceKey: {} }))
      const row = store.addInstance('openai-compatible', 'vLLM Server', {
        apiKey: 'sk-test',
        baseUrl: 'http://10.0.0.91:8000/v1',
      })

      expect(row.id).toBe('vllm-server')
      expect(row.instanceId).toBe('openai-compatible:vllm-server')

      const instances = store.listInstances('openai-compatible')
      expect(instances).toHaveLength(1)
      expect(instances[0].id).toBe('vllm-server')

      // Resolves options via clean slug
      const opts = store.providerInstanceOptions('openai-compatible', 'vllm-server')
      expect(opts).toEqual({ apiKey: 'sk-test', baseUrl: 'http://10.0.0.91:8000/v1' })

      // Defensively resolves options even if passed with redundant providerId prefix
      const optsDefensive = store.providerInstanceOptions('openai-compatible', 'openai-compatible:vllm-server')
      expect(optsDefensive).toEqual({ apiKey: 'sk-test', baseUrl: 'http://10.0.0.91:8000/v1' })
    })

    it('healDirtySnapshot automatically heals existing double-prefixed storage keys and row IDs', () => {
      const dirtySnapshot = {
        version: 2 as const,
        instancesByInstanceKey: {
          'openai-compatible:openai-compatible:vllm': {
            instanceId: 'openai-compatible:openai-compatible:vllm',
            id: 'openai-compatible:vllm',
            providerId: 'openai-compatible',
            label: 'vllm',
            options: { apiKey: 'sk-vllm-persisted', baseUrl: 'http://10.0.0.91:8000/v1' },
            isPrimary: false,
          } as any,
        },
      }

      const store = createProviderInstanceStore(ref(dirtySnapshot))
      const instances = store.listInstances('openai-compatible')
      expect(instances).toHaveLength(1)
      expect(instances[0].id).toBe('vllm')
      expect(instances[0].instanceId).toBe('openai-compatible:vllm')

      // Options accessible through both clean and dirty lookup
      expect(store.providerInstanceOptions('openai-compatible', 'vllm')).toEqual({
        apiKey: 'sk-vllm-persisted',
        baseUrl: 'http://10.0.0.91:8000/v1',
      })
      expect(store.providerInstanceOptions('openai-compatible', 'openai-compatible:vllm')).toEqual({
        apiKey: 'sk-vllm-persisted',
        baseUrl: 'http://10.0.0.91:8000/v1',
      })
    })

    it('splitProviderKey correctly handles clean and double-prefixed composite keys', () => {
      const testCases = [
        { key: 'openai-compatible', expectedProv: 'openai-compatible', expectedInst: undefined },
        { key: 'openai-compatible:*', expectedProv: 'openai-compatible', expectedInst: '*' },
        { key: 'openai-compatible:vllm', expectedProv: 'openai-compatible', expectedInst: 'vllm' },
        { key: 'openai-compatible:openai-compatible:vllm', expectedProv: 'openai-compatible', expectedInst: 'vllm' },
      ]

      for (const tc of testCases) {
        const sel = createProvidersConfigSelectors({
          providerCredentials: ref({}),
          addedProviders: ref({}),
          providerMetadata: {
            'openai-compatible': makeCloudProviderMetadata('openai-compatible'),
          },
          providerInstanceOptions: (prov, inst) => {
            expect(prov).toBe(tc.expectedProv)
            expect(inst).toBe(tc.expectedInst)
            return { apiKey: 'sk-test' }
          },
        })
        expect(sel.isProviderConfigured(tc.key)).toBe(true)
      }
    })
  })
})
