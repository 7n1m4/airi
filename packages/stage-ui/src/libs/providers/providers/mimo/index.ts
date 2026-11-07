import z from 'zod'

import { createOpenAI } from '@xsai-ext/providers/create'

import { createOpenAICompatibleValidators } from '../../validators/openai-compatible'
import { defineProvider } from '../registry'

const mimoConfigSchema = z.object({
  apiKey: z
    .string('API Key'),
  baseUrl: z
    .string('Base URL')
    .optional()
    .default('https://api.xiaomimimo.com/v1'),
})

type MimoConfig = z.input<typeof mimoConfigSchema>

export const providerMimo = defineProvider<MimoConfig>({
  id: 'mimo',
  name: 'MiMo',
  nameLocalize: ({ t }) => t('settings.pages.providers.provider.mimo.title'),
  description: 'Xiaomi MiMo Open Platform - paid MiMo V2.6 series models',
  descriptionLocalize: ({ t }) => t('settings.pages.providers.provider.mimo.description'),
  tasks: ['chat'],
  icon: 'i-solar:cpu-bold',
  requiresCredentials: true,
  business: () => ({
    pricing: 'paid',
    deployment: 'cloud',
    consoleUrl: 'https://mimo.mi.com',
  }),

  createProviderConfig: ({ t }) => mimoConfigSchema.extend({
    apiKey: mimoConfigSchema.shape.apiKey.meta({
      labelLocalized: t('settings.pages.providers.catalog.edit.config.common.fields.field.api-key.label'),
      descriptionLocalized: t('settings.pages.providers.catalog.edit.config.common.fields.field.api-key.description'),
      placeholderLocalized: t('settings.pages.providers.catalog.edit.config.common.fields.field.api-key.placeholder'),
      type: 'password',
    }),
    baseUrl: mimoConfigSchema.shape.baseUrl.meta({
      labelLocalized: t('settings.pages.providers.catalog.edit.config.common.fields.field.base-url.label'),
      descriptionLocalized: t('settings.pages.providers.catalog.edit.config.common.fields.field.base-url.description'),
      placeholderLocalized: t('settings.pages.providers.catalog.edit.config.common.fields.field.base-url.placeholder'),
    }),
  }),
  createProvider(config) {
    return createOpenAI(config.apiKey, config.baseUrl)
  },

  validationRequiredWhen(config) {
    return !!config.apiKey?.trim()
  },
  validators: {
    ...createOpenAICompatibleValidators({
      checks: ['connectivity', 'model_list'],
    }),
  },
  extraMethods: {
    async listModels() {
      return [
        { id: 'mimo-v2.6-flash', name: 'MiMo-V2.6-Flash' },
        { id: 'mimo-v2.6-pro', name: 'MiMo-V2.6-Pro' },
        { id: 'mimo-v2.6-pro-ultraspeed', name: 'MiMo-V2.6-Pro-UltraSpeed' },
      ]
    },
  },
})
