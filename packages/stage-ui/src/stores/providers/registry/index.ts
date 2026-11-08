import type { ComposerTranslation } from 'vue-i18n'

import type { ProviderMetadata } from '../types'

import { listProviders as listDefinedProviders } from '../../../libs/providers'
import { convertProviderDefinitionsToMetadata } from '../converters'
import { chatLocalMetadata } from './chat-local'
import { localEngineMetadata } from './local-engines'
import { createSpeechMetadata } from './speech'
import { transcriptionMetadata } from './transcription'

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

export function createProviderRegistry(
  t: ComposerTranslation,
  currentMetadata: Record<string, ProviderMetadata>,
): Record<string, ProviderMetadata> {
  const mergedMetadata: Record<string, ProviderMetadata> = {
    ...transcriptionMetadata,
    ...createSpeechMetadata(t),
    ...localEngineMetadata,
    ...chatLocalMetadata,
    ...currentMetadata,
  }

  const translatedProviderMetadata = convertProviderDefinitionsToMetadata(
    listDefinedProviders(),
    t,
    mergedMetadata,
  )

  const resolvedMetadata = { ...mergedMetadata }

  for (const [providerId, existing] of Object.entries(resolvedMetadata)) {
    if (existing.category !== 'speech' && existing.category !== 'transcription' && providerId !== 'web-rwkv' && providerId !== 'web-llm' && providerId !== 'blip-local' && providerId !== 'moondream-local' && providerId !== 'apple-core-ai') {
      delete resolvedMetadata[providerId]
    }
  }

  for (const [providerId, translated] of Object.entries(translatedProviderMetadata)) {
    if (translated.category === 'speech' || translated.category === 'transcription') {
      continue
    }
    if (!ARE_CLOUD_PROVIDERS_ENABLED && cloudProvidersDisabledByDefault[providerId]) {
      continue
    }
    resolvedMetadata[providerId] = translated
  }

  return resolvedMetadata
}
