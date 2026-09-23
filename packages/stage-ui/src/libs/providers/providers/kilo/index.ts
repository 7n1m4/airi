import { createOpenAI } from '@xsai-ext/providers/create'
import { z } from 'zod'

import { createOpenAICompatibleValidators } from '../../validators/openai-compatible'
import { defineProvider } from '../registry'

const kiloConfigSchema = z.object({
  apiKey: z
    .string('API Key')
    .optional()
    .default(''),
  baseUrl: z
    .string('Base URL')
    .optional()
    .default('https://api.kilo.ai/api/gateway/v1'),
})

type KiloConfig = z.input<typeof kiloConfigSchema>

export const providerKilo = defineProvider<KiloConfig>({
  id: 'kilo',
  name: 'Kilo',
  nameLocalize: ({ t }) => t('settings.pages.providers.provider.kilo.title'),
  description: 'Coding-optimized free gateway — auto-routes to best model',
  descriptionLocalize: ({ t }) => t('settings.pages.providers.provider.kilo.description'),
  tasks: ['chat', 'vision'],
  icon: 'i-solar:code-bold',
  requiresCredentials: false,
  business: () => ({
    pricing: 'free',
    deployment: 'cloud',
    consoleUrl: 'https://kilo.ai',
  }),

  createProviderConfig: ({ t }) => kiloConfigSchema.extend({
    apiKey: kiloConfigSchema.shape.apiKey.meta({
      labelLocalized: t('settings.pages.providers.catalog.edit.config.common.fields.field.api-key.label'),
      descriptionLocalized: t('settings.pages.providers.catalog.edit.config.common.fields.field.api-key.description'),
      placeholderLocalized: t('settings.pages.providers.catalog.edit.config.common.fields.field.api-key.placeholder'),
      type: 'password',
    }),
    baseUrl: kiloConfigSchema.shape.baseUrl.meta({
      labelLocalized: t('settings.pages.providers.catalog.edit.config.common.fields.field.base-url.label'),
      descriptionLocalized: t('settings.pages.providers.catalog.edit.config.common.fields.field.base-url.description'),
      placeholderLocalized: t('settings.pages.providers.catalog.edit.config.common.fields.field.base-url.placeholder'),
    }),
  }),
  createProvider(config) {
    return createOpenAI(config.apiKey || '', config.baseUrl)
  },

  extraMethods: {
    listModels: async () => {
      try {
        const response = await fetch('https://api.kilo.ai/api/gateway/models')
        if (!response.ok) {
          throw new Error(`Failed to fetch models: ${response.status}`)
        }
        const data = await response.json()
        // Expected format: { data: [{ id: string, ... }] } or array
        const models = Array.isArray(data) ? data : (data.data || [])
        return models
          .map((model: any) => ({
            id: model.id,
            name: model.id,
            provider: 'kilo',
            description: model.description || 'Kilo Gateway free model',
          }))
          .filter((m: any) => m.id && m.id.includes(':free'))
      }
      catch {
        // Fallback static models if dynamic fetch fails
        return [
          {
            id: 'kilo-auto',
            name: 'Kilo Auto (Best Free Model)',
            provider: 'kilo',
            description: 'Auto-routes to the best available free coding model',
          },
          {
            id: 'poolside/laguna-m.1:free',
            name: 'Poolside Laguna M.1 (Kilo)',
            provider: 'kilo',
            description: 'Free coding model via Kilo Gateway',
          },
          {
            id: 'poolside/laguna-xs.2:free',
            name: 'Poolside Laguna XS.2 (Kilo)',
            provider: 'kilo',
            description: 'Free coding model via Kilo Gateway',
          },
          {
            id: 'nvidia/nemotron-3-super-120b-a12b:free',
            name: 'Nemotron 3 Super 120B (Kilo)',
            provider: 'kilo',
            description: 'Free reasoning/coding model via Kilo Gateway (trial)',
          },
          {
            id: 'stepfun/step-3.7-flash:free',
            name: 'StepFun Step 3.7 Flash (Kilo)',
            provider: 'kilo',
            description: 'Free model via Kilo Gateway',
          },
        ]
      }
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
