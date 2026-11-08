import type { $ZodType } from 'zod/v4/core'

import type { ProviderDefinition, ProviderTranslationFn } from '../types'

import { orderBy } from 'es-toolkit'

const isTestRuntime = typeof process !== 'undefined'
  && typeof process.env === 'object'
  && (process.env.VITEST === 'true' || !!process.env.VITEST_WORKER_ID)

const ENABLE_CLOUD_PROVIDERS = typeof import.meta !== 'undefined'
  && typeof (import.meta as unknown as { env?: unknown }).env === 'object'
  && (import.meta as unknown as { env?: { VITE_ENABLE_CLOUD_PROVIDERS?: string } }).env?.VITE_ENABLE_CLOUD_PROVIDERS === '1'

// Providers hidden in prod behind a flag are still registered/validated in tests.
const ARE_CLOUD_PROVIDERS_ENABLED = ENABLE_CLOUD_PROVIDERS || isTestRuntime
const cloudProvidersDisabledByDefault: Record<string, true> = {
  'cloudflare-workers-ai': true,
}

const providerRegistry = new Map<string, ProviderDefinition>()

function isCloudProviderEnabled(id: string): boolean {
  return !(cloudProvidersDisabledByDefault[id] && !ARE_CLOUD_PROVIDERS_ENABLED)
}

export function listProviders(): ProviderDefinition[] {
  const providerDefs = Array.from(providerRegistry.values())
    .filter(def => isCloudProviderEnabled(def.id))
    .map(def => ({ order: 99999, ...def }))
  const sorted = orderBy(providerDefs, [p => p.order, 'name'], ['asc', 'asc'])
  return sorted
}

export function getDefinedProvider(id: string): ProviderDefinition | undefined {
  if (!isCloudProviderEnabled(id))
    return undefined
  return providerRegistry.get(id)
}

export function defineProvider<T>(definition: { createProviderConfig: (contextOptions: { t: ProviderTranslationFn }) => $ZodType<T> } & ProviderDefinition<T>): ProviderDefinition<T> {
  const provider = {
    ...definition,
  }

  providerRegistry.set(definition.id, definition)

  return provider
}
