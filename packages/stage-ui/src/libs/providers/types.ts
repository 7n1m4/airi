import type {
  ChatProvider,
  ChatProviderWithExtraOptions,
  EmbedProvider,
  EmbedProviderWithExtraOptions,
  ModelProvider,
  ModelProviderWithExtraOptions,
  SpeechProvider,
  SpeechProviderWithExtraOptions,
  TranscriptionProvider,
  TranscriptionProviderWithExtraOptions,
} from '@xsai-ext/providers/utils'
import type { ProgressInfo } from '@xsai-transformers/shared/types'
import type { MaybePromise } from 'clustr'
import type { $ZodType } from 'zod/v4/core'

/**
 * Generic translation function signature for runtime-neutral provider definitions and validators.
 * Decouples provider metadata, schemas, and validators from framework-specific i18n libraries.
 */
export type ProviderTranslationFn = (key: string, ...args: any[]) => string

export interface System1Answer {
  type?: string
  choice?: string
  score?: number
  confidence?: number
  probabilities?: Record<string, number>
  noul?: number
  legend?: Record<string, string>
}

export interface System1Response {
  answers: Record<string, System1Answer>
  usage?: {
    input_tokens: number
    output_tokens: number
  }
}

export interface System1Provider {
  systemOne: (state: string | object, questions: Record<string, any>, model?: string) => Promise<System1Response>
}

export type ProviderInstance
  = | ChatProvider
    | ChatProviderWithExtraOptions
    | EmbedProvider
    | EmbedProviderWithExtraOptions
    | SpeechProvider
    | SpeechProviderWithExtraOptions
    | TranscriptionProvider
    | TranscriptionProviderWithExtraOptions
    | ModelProvider
    | ModelProviderWithExtraOptions
    | System1Provider

export function isModelProvider(providerInstance: ProviderInstance): providerInstance is ModelProvider | ModelProviderWithExtraOptions {
  if ('model' in providerInstance && typeof providerInstance.model === 'function') {
    return true
  }

  return false
}

/**
 * `false` only for a strictly keyless provider: one that accepts no API key at
 * all. An optional-key provider still takes a key, so UIs must keep the field.
 */
export function isKeylessProvider(requiresCredentials: ProviderDefinition['requiresCredentials']): boolean {
  return requiresCredentials === false
}

/**
 * Provider that runs without a key but accepts one to unlock paid models or
 * higher quotas (Kilo, and future free-tier gateways).
 */
export function isOptionalKeyProvider(requiresCredentials: ProviderDefinition['requiresCredentials']): boolean {
  return typeof requiresCredentials === 'object' && requiresCredentials !== null && 'optional' in requiresCredentials
}

/**
 * Whether a provider is usable without any key present: either strictly keyless
 * or optional-keyed. Used by every credential gate that must decide "can this
 * provider run right now?".
 */
export function keylessOrOptionalKey(requiresCredentials: ProviderDefinition['requiresCredentials']): boolean {
  return isKeylessProvider(requiresCredentials) || isOptionalKeyProvider(requiresCredentials)
}

export interface ProviderExtraMethods<TConfig> {
  listModels?: (config: TConfig, provider: ProviderInstance) => Promise<ModelInfo[]>
  listVoices?: (config: TConfig, provider: ProviderInstance) => Promise<VoiceInfo[]>
  loadModel?: (config: TConfig, provider: ProviderInstance, hooks?: { onProgress?: (progress: ProgressInfo) => Promise<void> | void }) => Promise<void>
}

export interface ProviderValidationResult {
  errors: Array<{ error: unknown, errorKey?: string }>
  reason: string
  reasonKey: string
  valid: boolean
}

export interface ProviderValidatorSchedule {
  mode: 'once' | 'interval'
  intervalMs?: number
}

export interface ProviderConfigValidator<TConfig> {
  id: string
  name: string
  validator: (config: TConfig, contextOptions: { t: ProviderTranslationFn }) => MaybePromise<ProviderValidationResult>
  schedule?: ProviderValidatorSchedule
}

export interface ProviderRuntimeValidator<TConfig> {
  id: string
  name: string
  validator: (config: TConfig, provider: ProviderInstance, providerExtra: ProviderExtraMethods<TConfig>, contextOptions: { t: ProviderTranslationFn }) => MaybePromise<ProviderValidationResult>
  schedule?: ProviderValidatorSchedule
  /**
   * Excluded from automatic validation runs.
   * Use for costly checks that should only run on explicit user action.
   */
  manualOnly?: boolean
}

export interface ModelInfo {
  id: string
  name: string
  provider: string
  description?: string
  capabilities?: string[]
  contextLength?: number
  deprecated?: boolean
}

export interface VoiceInfo {
  id: string
  name: string
  provider: string
  compatibleModels?: string[]
  description?: string
  gender?: string
  deprecated?: boolean
  previewURL?: string
  languages: {
    code: string
    title: string
  }[]
}

// eslint-disable-next-line ts/no-unnecessary-type-constraint
export interface ProviderDefinition<TConfig extends any = any> {
  id: string
  order?: number
  /**
   * Credential contract for this provider:
   * - `true` (default for cloud): an API key is required.
   * - `false`: keyless only, no key field is offered.
   * - `{ optional: true }`: works without a key, but a key unlocks paid/higher
   *   quotas. UIs offer the key field as optional instead of hiding it.
   */
  requiresCredentials?: boolean | { optional: true }
  tasks: string[]
  nameLocalize: (ctx: { t: (input: string) => string }) => string // i18n key for provider name
  name: string // Default name (fallback)
  descriptionLocalize: (ctx: { t: (input: string) => string }) => string // i18n key for provider description
  description: string // Default description (fallback)
  /**
   * Iconify JSON icon name for the provider.
   *
   * Icons are available for most of the AI provides under @proj-airi/lobe-icons.
   */
  icon?: string
  iconColor?: string
  /**
   * In case of having image instead of icon, you can specify the image URL here.
   */
  iconImage?: string

  /**
   * Indicates whether the provider is available.
   * If not specified, the provider is always available.
   *
   * May be specified when any of the following criteria is required:
   *
   * Platform requirements:
   *
   * - app-* providers are only available on desktop, this is responsible for Tauri runtime checks
   * - web-* providers are only available on web, this means Node.js and Tauri should not be imported or used
   *
   * System spec requirements:
   *
   * - may requires WebGPU / NVIDIA / other types of GPU,
   *   on Web, WebGPU will automatically compiled to use targeting GPU hardware
   * - may requires significant amount of GPU memory to run, especially for
   *   using of small language models within browser or Tauri app
   * - may requires significant amount of memory to run, especially for those
   *   non-WebGPU supported environments.
   */
  isAvailableBy?: () => Promise<boolean> | boolean

  createProviderConfig: (contextOptions: { t: ProviderTranslationFn }) => $ZodType<TConfig>
  createProvider: (config: TConfig) => MaybePromise<ProviderInstance>
  extraMethods?: ProviderExtraMethods<TConfig>
  validationRequiredWhen?: (config: TConfig) => boolean
  validators?: {
    validateConfig?: Array<(contextOptions: { t: ProviderTranslationFn }) => ProviderConfigValidator<TConfig>>
    validateProvider?: Array<(contextOptions: { t: ProviderTranslationFn }) => ProviderRuntimeValidator<TConfig>>
  }
  capabilities?: {
    transcription?: {
      protocol: 'websocket' | 'http'
      generateOutput: boolean
      streamOutput: boolean
      streamInput: boolean
    }
  }
  business?: (contextOptions: { t: ProviderTranslationFn }) => {
    pricing?: 'free' | 'paid'
    deployment?: 'local' | 'cloud'
    beginnerRecommended?: boolean
    consoleUrl?: string
    troubleshooting?: {
      validators?: {
        openaiCompatibleCheckConnectivity?: {
          label?: string
          content?: string
        }
      }
    }
  }
}

export enum ProviderValidationCheck {
  Health = 'health',
  Connectivity = 'connectivity',
  ModelList = 'model-list',
  ChatCompletions = 'chat-completions',
  Embeddings = 'embeddings',
  Speech = 'speech',
  Transcription = 'transcription',
  System1 = 'system1',
}
