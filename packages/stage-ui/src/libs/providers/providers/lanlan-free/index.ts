import { createOpenAI } from '@xsai-ext/providers/create'
import { z } from 'zod'

import { createOpenAICompatibleValidators } from '../../validators/openai-compatible'
import { defineProvider } from '../registry'

const lanlanFreeConfigSchema = z.object({
  apiKey: z
    .string('API Key')
    .optional()
    .default('free-access'),
  baseUrl: z
    .string('Base URL')
    .optional()
    .default('https://www.lanlan.tech/text/v1/'),
})

type LanlanFreeConfig = z.input<typeof lanlanFreeConfigSchema>

export const providerLanlanFree = defineProvider<LanlanFreeConfig>({
  id: 'lanlan-free',
  name: 'LanLan Free',
  nameLocalize: ({ t }) => t('settings.pages.providers.provider.lanlan-free.title'),
  description: 'Zero-setup free LLM endpoint sponsored by StepFun',
  descriptionLocalize: ({ t }) => t('settings.pages.providers.provider.lanlan-free.description'),
  tasks: ['chat', 'vision'],
  icon: 'i-solar:cloud-bold',
  requiresCredentials: false,
  business: () => ({
    pricing: 'free',
    deployment: 'cloud',
    consoleUrl: 'https://www.lanlan.tech',
  }),

  createProviderConfig: ({ t }) => lanlanFreeConfigSchema.extend({
    apiKey: lanlanFreeConfigSchema.shape.apiKey.meta({
      labelLocalized: t('settings.pages.providers.catalog.edit.config.common.fields.field.api-key.label'),
      descriptionLocalized: t('settings.pages.providers.catalog.edit.config.common.fields.field.api-key.description'),
      placeholderLocalized: t('settings.pages.providers.catalog.edit.config.common.fields.field.api-key.placeholder'),
      type: 'password',
    }),
    baseUrl: lanlanFreeConfigSchema.shape.baseUrl.meta({
      labelLocalized: t('settings.pages.providers.catalog.edit.config.common.fields.field.base-url.label'),
      descriptionLocalized: t('settings.pages.providers.catalog.edit.config.common.fields.field.base-url.description'),
      placeholderLocalized: t('settings.pages.providers.catalog.edit.config.common.fields.field.base-url.placeholder'),
    }),
  }),
  createProvider(config) {
    return createOpenAI(config.apiKey || 'free-access', config.baseUrl)
  },

  extraMethods: {
    listModels: async () => {
      return [
        {
          id: 'free-model',
          name: 'free-model',
          provider: 'lanlan-free',
          description: 'Default free model (StepFun)',
        },
      ]
    },
  },

  validationRequiredWhen() {
    return true
  },
  validators: {
    ...createOpenAICompatibleValidators({
      checks: ['connectivity'],
      skipApiKeyCheck: true,
    }),
  },
})
