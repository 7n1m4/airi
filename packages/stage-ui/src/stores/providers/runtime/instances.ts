import type {
  ChatProvider,
  ChatProviderWithExtraOptions,
  EmbedProvider,
  EmbedProviderWithExtraOptions,
  SpeechProvider,
  SpeechProviderWithExtraOptions,
  TranscriptionProvider,
  TranscriptionProviderWithExtraOptions,
} from '@xsai-ext/providers/utils'
import type { Ref } from 'vue'

import type { ProviderMetadata } from '../types'

import { keylessOrOptionalKey } from '../../../libs/providers/types'

export interface ProviderInstancesDeps {
  providerInstanceCache: Ref<Record<string, unknown>>
  providerMetadata: Record<string, ProviderMetadata>
  getProviderCredentials: () => Record<string, Record<string, unknown>>
  setProviderCredentials: (providerId: string, config: Record<string, unknown>) => void
  getDefaultProviderConfig: (providerId: string) => Record<string, unknown>
  providerInstanceOptions?: (providerId: string, instanceId?: string) => Record<string, unknown> | undefined
}

/**
 * Provider instance cache lifecycle.
 *
 * The singleton `providerInstanceCache` ref is owned and created by
 * `providers.ts` setup and injected here, so all consumers observe the same
 * underlying state. `getProviderCredentials`/`setProviderCredentials` are
 * injected closures instead of the raw ref so the Web Speech API special
 * case below can write back into `providerCredentials.value` without this
 * module owning that `useLocalStorage` singleton.
 */
export function createProviderInstances(deps: ProviderInstancesDeps) {
  const { providerInstanceCache, providerMetadata } = deps

  /**
   * Drop a redundant `providerId:` prefix so a composite key and its
   * double-prefixed alias resolve to the same instance the factory builds
   * (`openai-compatible:openai-compatible:vllm` → `openai-compatible:vllm`).
   */
  function cleanProviderKey(providerKey: string): string {
    if (!providerKey.includes(':'))
      return providerKey
    const [providerId, ...rest] = providerKey.split(':')
    const prefix = `${providerId}:`
    let instance = rest.join(':')
    while (instance.startsWith(prefix))
      instance = instance.slice(prefix.length)
    return instance ? `${providerId}:${instance}` : providerId
  }

  // Function to get provider object by provider id (or composite providerKey like "providerId:instanceId")
  async function getProviderInstance<R extends
  | ChatProvider
  | ChatProviderWithExtraOptions
  | EmbedProvider
  | EmbedProviderWithExtraOptions
  | SpeechProvider
  | SpeechProviderWithExtraOptions
  | TranscriptionProvider
  | TranscriptionProviderWithExtraOptions,
  >(providerKey: string): Promise<R> {
    if (!providerKey) {
      console.warn('getProviderInstance called with empty providerKey')
      return null as any
    }

    const cached = providerInstanceCache.value[providerKey] as R | undefined
    if (cached)
      return cached

    let providerId = providerKey
    let targetInstanceId: string | undefined

    if (providerKey.includes(':')) {
      const parts = providerKey.split(':')
      providerId = parts[0]
      let instance = parts.slice(1).join(':')
      const prefix = `${providerId}:`
      while (instance.startsWith(prefix)) {
        instance = instance.slice(prefix.length)
      }
      targetInstanceId = instance || undefined
    }

    const metadata = providerMetadata[providerId]
    if (!metadata) {
      console.warn(`Provider metadata for ${providerKey} (base: ${providerId}) not found`)
      return null as any
    }

    // Providers that explicitly require no credentials (local engines,
    // browser-native APIs) may safely construct with an empty config.
    // Everything else must present a non-empty credential BEFORE the SDK is
    // instantiated so client code receives an immediate, localized error
    // instead of a network round-trip that ends in a 401.
    const noCredentials = keylessOrOptionalKey(metadata.requiresCredentials) || metadata.deployment === 'local' || providerId === 'browser-web-speech-api'

    let config = deps.providerInstanceOptions?.(providerId, targetInstanceId)
      ?? deps.getProviderCredentials()[providerId]

    // Key inheritance for Google Gemini Audio Speech from Google Gemini chat provider
    if (!config && providerId === 'google-gemini-audio-speech') {
      const parentConfig = deps.getProviderCredentials()['google-generative-ai']
      const parentKey = parentConfig?.apiKey
      if (typeof parentKey === 'string' && parentKey.trim().length > 0) {
        config = { apiKey: parentKey.trim() }
      }
    }

    if (!config && noCredentials) {
      config = deps.getDefaultProviderConfig(providerId)
      deps.setProviderCredentials(providerId, config)
    }

    if (!config && !noCredentials)
      throw new Error(`Provider credentials for ${providerKey} are missing or incomplete.`)

    if (config && !noCredentials) {
      // Defensive check: an empty-but-truthy `{}` (or whitespace-only
      // apiKey) would pass `!config` but produces an unauthenticated
      // SDK that fails with a raw 401 at network time. Trap it here.
      const anyCfg = config as Record<string, any>
      let hasKey = typeof anyCfg.apiKey === 'string' && anyCfg.apiKey.trim().length > 0
      if (!hasKey && providerId === 'google-gemini-audio-speech') {
        const parentKey = deps.getProviderCredentials()['google-generative-ai']?.apiKey
        if (typeof parentKey === 'string' && parentKey.trim().length > 0)
          hasKey = true
      }
      const hasAwsKey = typeof anyCfg.accessKeyId === 'string' && anyCfg.accessKeyId.trim().length > 0
        && typeof anyCfg.secretAccessKey === 'string' && anyCfg.secretAccessKey.trim().length > 0
      if (!hasKey && !hasAwsKey)
        throw new Error(`Provider credentials for ${providerKey} are missing or incomplete.`)
    }

    try {
      const instance = await metadata.createProvider(config || {}) as R
      providerInstanceCache.value[providerKey] = instance
      return instance
    }
    catch (error) {
      console.error(`Error creating provider instance for ${providerKey}:`, error)
      throw error
    }
  }

  /**
   * Evict cached instances. A base provider id drops that provider and every
   * named instance below it (`providerId:slug`); a composite key drops that key
   * and its double-prefixed variants. Unknown keys are a no-op.
   */
  async function disposeProviderInstance(providerKey: string) {
    // Match every spelling of the instance: `slug`, `providerId:slug`, and the
    // base id that would drop the whole family.
    const candidates = new Set([providerKey, cleanProviderKey(providerKey)])
    const targets = Object.keys(providerInstanceCache.value)
      .filter(cached => [...candidates].some(key => cached === key || cached.startsWith(`${key}:`)))

    for (const key of targets) {
      const instance = providerInstanceCache.value[key] as { dispose?: () => Promise<void> | void } | undefined
      if (instance?.dispose)
        await instance.dispose()

      delete providerInstanceCache.value[key]
    }
  }

  return { getProviderInstance, disposeProviderInstance }
}
