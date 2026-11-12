import type { ProviderMetadata } from '../types'
import type { ProviderInstancesDeps } from './instances'

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { nextTick, ref } from 'vue'

import { createProviderInstances } from './instances'
import { createProviderLifecycle } from './lifecycle'

// The registry localizes every provider entry through `useI18n`; the store is
// mounted without a Vue app here, so stub the composer.
vi.mock('vue-i18n', () => ({
  useI18n: () => ({
    t: (key: string) => key,
    d: (value: unknown) => value,
    n: (value: unknown) => value,
  }),
}))

/**
 * Credential-cache eviction regressions (two bugs):
 *
 * 1. `registerCredentialWatch` disposed `providerInstanceCache[providerId]`
 *    (base id only), but the cache is keyed by what the caller passed to
 *    `getProviderInstance` — `openai-compatible:vllm` for a named instance.
 *    Rotating credentials therefore left named instances serving the OLD
 *    client, and a *deleted* provider was never evicted at all (the watcher only
 *    iterates the new key set).
 * 2. `removeInstance` / `removeAllInstances` built their eviction prefix with a
 *    trailing colon (`` `${providerId}:${instanceId ?? '*'}:` ``) and filtered
 *    `k.startsWith(prefix)`; cache keys carry no trailing segment, so the loop
 *    body was dead and deleting an instance was cosmetic.
 *
 * The cache ref is store-private, so eviction is observed through the only
 * honest public signal: whether reading a key again constructs a new client.
 * `boot()` swaps the SDK factory for a counting recorder, so a build count that
 * does not move on a re-read proves the entry was cached (and vice versa).
 */

const PROVIDER = 'openai-compatible'
const PRIMARY_KEY = `${PROVIDER}:*`
const VLLM_KEY = `${PROVIDER}:vllm`
const LM_KEY = `${PROVIDER}:lm`

const vllmOptions = { apiKey: 'sk-v1', baseUrl: 'http://vllm/v1' }
const lmOptions = { apiKey: 'sk-l1', baseUrl: 'http://lm/v1' }

interface Client {
  config: Record<string, unknown>
}

interface ProvidersStoreLike {
  providerMetadata: Record<string, ProviderMetadata>
  /** Primary-instance credential facade: what the settings page writes. */
  providers: Record<string, Record<string, unknown>>
  addInstance: (providerId: string, label: string, template?: Record<string, unknown>) => unknown
  removeInstance: (providerId: string, instanceId?: string) => void
  removeAllInstances: (providerId: string) => void
  listInstances: (providerId: string) => Array<{ id: string, instanceId: string }>
  deleteProvider: (providerId: string) => void
  getProviderInstance: (providerKey: string) => Promise<Client>
}

interface Harness {
  store: ProvidersStoreLike
  /** Configs handed to the provider factory, in construction order. */
  built: Array<Record<string, unknown>>
  /** Number of provider constructions so far. */
  count: () => number
  /** Read `providerKey` and return the config its client was built with. */
  read: (providerKey: string) => Promise<Record<string, unknown>>
  /** Let the credential watcher run its (synchronous) disposal pass. */
  flush: () => Promise<void>
  /** Read `providerKey`, asserting no client is built (served from cache). */
  expectCached: (providerKey: string, expected: Record<string, unknown>) => Promise<void>
  /** Read `providerKey`, asserting a client is built (entry was evicted). */
  expectRebuilt: (providerKey: string, expected: Record<string, unknown>) => Promise<void>
}

/** Replace the SDK factory with a recorder and return the build log. */
function recordBuilds(store: ProvidersStoreLike): Array<Record<string, unknown>> {
  const built: Array<Record<string, unknown>> = []
  const metadata = store.providerMetadata[PROVIDER]
  // The recorder hands back a stand-in, not a real SDK client: the provider union
  // has no structural member for it, so the assignment is asserted at this one seam.
  store.providerMetadata[PROVIDER] = {
    ...metadata,
    createProvider: async (config: Record<string, unknown>) => {
      built.push({ ...config })
      return { config: { ...config } }
    },
  } as unknown as ProviderMetadata
  return built
}

async function boot(): Promise<Harness> {
  // `useLocalStorage` caches its ref per module instance under a fixed key, so
  // reset both or every case would inherit the previous case's snapshot.
  globalThis.localStorage?.clear()

  // Fresh Pinia per test: the store reads persisted state once at setup.
  const { createPinia, setActivePinia } = await import('pinia')
  setActivePinia(createPinia())

  // Static import cannot work here: the store must be evaluated after
  // `vi.resetModules()` so each test gets its own module instance.
  const { useProvidersStore } = await import('../../providers')
  const store = useProvidersStore() as unknown as ProvidersStoreLike
  const built = recordBuilds(store)

  const count = () => built.length
  const read = async (providerKey: string) => {
    const client = await store.getProviderInstance(providerKey)
    return client.config
  }

  return {
    store,
    built,
    count,
    read,
    flush: async () => {
      // The watcher callback is synchronous; `nextTick` drains the scheduler.
      await nextTick()
    },
    expectCached: async (providerKey, expected) => {
      const before = count()
      const config = await read(providerKey)
      expect(config).toEqual(expected)
      expect(count()).toBe(before)
    },
    expectRebuilt: async (providerKey, expected) => {
      const before = count()
      const config = await read(providerKey)
      expect(config).toEqual(expected)
      expect(count()).toBe(before + 1)
    },
  }
}

describe('credential cache eviction', () => {
  beforeEach(() => {
    vi.resetModules()
  })

  it('evicts named instances when a provider credential is edited, leaving siblings cached', async () => {
    const credentials = ref<Record<string, Record<string, unknown>>>({ [PROVIDER]: { apiKey: 'sk-first' } })
    const cache = ref<Record<string, unknown>>({})
    const createProvider = vi.fn(async (config: Record<string, unknown>) => ({ config }))

    const metadata: ProviderMetadata = {
      id: PROVIDER,
      category: 'chat',
      tasks: [],
      nameKey: `test.providers.${PROVIDER}.name`,
      name: PROVIDER,
      descriptionKey: `test.providers.${PROVIDER}.description`,
      description: PROVIDER,
      requiresCredentials: true,
      defaultOptions: () => ({}),
      createProvider: createProvider as unknown as ProviderMetadata['createProvider'],
      capabilities: {},
      validators: {
        validateProviderConfig: () => Promise.resolve({ errors: [], reason: '', valid: true }),
      },
    }

    const optionsFor = (instanceId?: string) => (instanceId === 'lm' ? lmOptions : vllmOptions)
    const deps: ProviderInstancesDeps = {
      providerInstanceCache: cache,
      providerMetadata: { [PROVIDER]: metadata },
      getProviderCredentials: () => credentials.value,
      setProviderCredentials: (providerId, config) => { credentials.value[providerId] = config },
      getDefaultProviderConfig: () => ({}),
      providerInstanceOptions: (providerId, instanceId) => (providerId === PROVIDER ? optionsFor(instanceId) : undefined),
    }
    const instances = createProviderInstances(deps)
    createProviderLifecycle({
      providerCredentials: credentials,
      addedProviders: ref({}),
      providerRuntimeState: ref({}),
      providerMetadata: deps.providerMetadata,
      disposeProviderInstance: instances.disposeProviderInstance,
    }).registerCredentialWatch()
    await nextTick()

    // Warm two different cache keys: the base id and a named instance.
    await instances.getProviderInstance(PROVIDER)
    await instances.getProviderInstance(VLLM_KEY)
    await instances.getProviderInstance(LM_KEY)
    expect(createProvider).toHaveBeenCalledTimes(3)

    // Rotate the provider credential: the watcher must drop every cached key
    // for that provider, not just the base id.
    credentials.value = { [PROVIDER]: { apiKey: 'sk-rotated' } }
    await nextTick()
    expect(Object.keys(cache.value)).toEqual([])

    // Each key rebuilds with its own options, so the new key takes effect.
    await instances.getProviderInstance(VLLM_KEY)
    expect(createProvider).toHaveBeenLastCalledWith(vllmOptions)
    await instances.getProviderInstance(LM_KEY)
    expect(createProvider).toHaveBeenLastCalledWith(lmOptions)
    expect(createProvider).toHaveBeenCalledTimes(5)
  })

  it('evicts the cached client of a deleted provider', async () => {
    const { store, count, flush, expectRebuilt } = await boot()

    store.providers[PROVIDER] = { apiKey: 'sk-first' }
    store.addInstance(PROVIDER, 'vllm', vllmOptions)
    await flush()

    expect((await store.getProviderInstance(PRIMARY_KEY)).config).toEqual({ apiKey: 'sk-first' })
    expect((await store.getProviderInstance(VLLM_KEY)).config).toEqual(vllmOptions)
    expect(count()).toBe(2)

    store.deleteProvider(PROVIDER)
    await flush()

    // Re-add credentials for the same provider: the deleted entry must not be
    // reused, so the primary is rebuilt with the new key.
    store.providers[PROVIDER] = { apiKey: 'sk-again' }
    await flush()
    await expectRebuilt(PRIMARY_KEY, { apiKey: 'sk-again' })

    // The deleted entry was dropped too: a read of it builds a new client.
    await expectRebuilt(VLLM_KEY, vllmOptions)
  })

  it('removeInstance evicts the named instance and keeps siblings', async () => {
    const { store, built, flush, expectCached, expectRebuilt } = await boot()

    store.providers[PROVIDER] = { apiKey: 'sk-first' }
    store.addInstance(PROVIDER, 'vllm', vllmOptions)
    store.addInstance(PROVIDER, 'lm', lmOptions)
    await flush()

    expect((await store.getProviderInstance(VLLM_KEY)).config).toEqual(vllmOptions)
    expect((await store.getProviderInstance(LM_KEY)).config).toEqual(lmOptions)

    store.removeInstance(PROVIDER, 'vllm')
    await flush()
    expect(store.listInstances(PROVIDER).map(row => row.id)).toEqual(['*', 'lm'])

    // Re-creating the same slug with a new key: the evicted entry is rebuilt
    // with it (the user-visible "my new key took effect").
    const nextVllm = { apiKey: 'sk-v2', baseUrl: 'http://vllm/v1' }
    store.addInstance(PROVIDER, 'vllm', nextVllm)
    await flush()
    await expectRebuilt(VLLM_KEY, nextVllm)

    // The sibling was never evicted: still served from cache, built exactly once.
    await expectCached(LM_KEY, lmOptions)
    expect(built.filter(config => config.apiKey === 'sk-l1')).toHaveLength(1)
  })

  it('removeAllInstances evicts the primary and every named instance', async () => {
    const { store, count, flush, expectRebuilt } = await boot()

    store.providers[PROVIDER] = { apiKey: 'sk-first' }
    store.addInstance(PROVIDER, 'vllm', vllmOptions)
    store.addInstance(PROVIDER, 'lm', lmOptions)
    await flush()

    await store.getProviderInstance(PRIMARY_KEY)
    await store.getProviderInstance(VLLM_KEY)
    await store.getProviderInstance(LM_KEY)
    expect(count()).toBe(3)

    store.removeAllInstances(PROVIDER)
    await flush()
    expect(store.listInstances(PROVIDER)).toHaveLength(0)

    // Re-add the primary and a named instance: both shapes come back.
    const nextVllm = { apiKey: 'sk-v2', baseUrl: 'http://vllm/v1' }
    store.providers[PROVIDER] = { apiKey: 'sk-first' }
    store.addInstance(PROVIDER, 'vllm', nextVllm)
    await flush()

    // The primary was evicted too, so it is rebuilt rather than served from cache.
    await expectRebuilt(PRIMARY_KEY, { apiKey: 'sk-first' })
    await expectRebuilt(VLLM_KEY, nextVllm)

    // `lm` was evicted as well; its row is gone, so it can no longer be built.
    await expect(store.getProviderInstance(LM_KEY)).rejects.toThrow(/missing or incomplete/)

    // Warm reads after that build nothing new.
    const warm = count()
    await store.getProviderInstance(PRIMARY_KEY)
    await store.getProviderInstance(VLLM_KEY)
    expect(count()).toBe(warm)
  })

  it('does not evict when the credential object is unchanged', async () => {
    const { store, count, flush, expectCached } = await boot()

    store.addInstance(PROVIDER, 'vllm', vllmOptions)
    store.providers[PROVIDER] = { apiKey: 'sk-stable' }
    await flush()

    const primary = { apiKey: 'sk-stable' }
    expect((await store.getProviderInstance(VLLM_KEY)).config).toEqual(vllmOptions)
    expect((await store.getProviderInstance(PRIMARY_KEY)).config).toEqual(primary)
    expect(count()).toBe(2)

    // Rewrite the facade with an identical payload: a no-op write must not
    // dispose anything, otherwise every keystroke thrashes the cache.
    store.providers[PROVIDER] = { apiKey: 'sk-stable' }
    await flush()

    await expectCached(VLLM_KEY, vllmOptions)
    await expectCached(PRIMARY_KEY, primary)
    expect(count()).toBe(2)
  })
})
