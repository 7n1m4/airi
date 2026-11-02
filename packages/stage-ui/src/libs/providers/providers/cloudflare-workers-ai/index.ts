import z from 'zod'

import { createOpenAI } from '@xsai-ext/providers/create'

import { createOpenAICompatibleValidators } from '../../validators/openai-compatible'
import { defineProvider } from '../registry'

const cloudflareWorkersAIConfigSchema = z.object({
  accountId: z
    .string('Account ID'),
  apiToken: z
    .string('API Token'),
  modelId: z
    .string('Model ID')
    .default('@cf/meta/llama-3.1-8b-instruct'),
})

type CloudflareWorkersAIConfig = z.input<typeof cloudflareWorkersAIConfigSchema>

export const providerCloudflareWorkersAI = defineProvider({
  id: 'cloudflare-workers-ai',
  order: 200,
  name: 'Cloudflare Workers AI',
  nameLocalize: ({ t }: any) => t('settings.pages.providers.provider.cloudflare-workers-ai.title'),
  description: 'Run models on Cloudflare\'s global network',
  descriptionLocalize: ({ t }: any) => t('settings.pages.providers.provider.cloudflare-workers-ai.description'),
  tasks: ['chat', 'vision'],
  icon: 'i-simple-icons:cloudflare',
  business: () => ({
    pricing: 'paid',
    deployment: 'cloud',
  }),

  createProviderConfig: ({ t }: any) => (cloudflareWorkersAIConfigSchema as any).extend({
    accountId: (cloudflareWorkersAIConfigSchema as any).shape.accountId.meta({
      labelLocalized: t('settings.pages.providers.catalog.edit.config.common.fields.field.account-id.label'),
      descriptionLocalized: t('settings.pages.providers.catalog.edit.config.common.fields.field.account-id.description'),
      placeholderLocalized: t('settings.pages.providers.catalog.edit.config.common.fields.field.account-id.placeholder'),
    }),
    apiToken: (cloudflareWorkersAIConfigSchema as any).shape.apiToken.meta({
      labelLocalized: t('settings.pages.providers.catalog.edit.config.common.fields.field.api-token.label'),
      descriptionLocalized: t('settings.pages.providers.catalog.edit.config.common.fields.field.api-token.description'),
      placeholderLocalized: t('settings.pages.providers.catalog.edit.config.common.fields.field.api-token.placeholder'),
      type: 'password',
    }),
    modelId: (cloudflareWorkersAIConfigSchema as any).shape.modelId.meta({
      labelLocalized: t('settings.pages.providers.catalog.edit.config.common.fields.field.model-id.label'),
      descriptionLocalized: t('settings.pages.providers.catalog.edit.config.common.fields.field.model-id.description'),
      placeholderLocalized: t('settings.pages.providers.catalog.edit.config.common.fields.field.model-id.placeholder'),
    }),
  }),
  createProvider(config: CloudflareWorkersAIConfig) {
    const baseUrl = `https://api.cloudflare.com/client/v4/accounts/${config.accountId}/ai/v1/`
    return createOpenAI(config.apiToken as string, baseUrl)
  },

  validationRequiredWhen(config: CloudflareWorkersAIConfig) {
    return !!config.apiToken?.trim() && !!config.accountId?.trim()
  },
  validators: {
    ...(createOpenAICompatibleValidators({
      checks: ['connectivity', 'model_list', 'chat_completions'],
    }) as any),
  },
} as any)
