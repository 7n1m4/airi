import type { System1Response } from '../../types'

import { createOpenRouter } from '@xsai-ext/providers/create'
import { z } from 'zod'

import { createOpenAICompatibleValidators } from '../../validators/openai-compatible'
import { defineProvider } from '../registry'

const openRouterConfigSchema = z.object({
  apiKey: z
    .string('API Key'),
  baseUrl: z
    .string('Base URL')
    .optional()
    .default('https://openrouter.ai/api/v1/'),
})

type OpenRouterConfig = z.input<typeof openRouterConfigSchema>

export const providerOpenRouterAI = defineProvider<OpenRouterConfig>({
  id: 'openrouter-ai',
  order: 0,
  name: 'OpenRouter',
  nameLocalize: ({ t }) => t('settings.pages.providers.provider.openrouter.title'),
  description: 'The Unified Interface - Access dozens of free & paid models',
  descriptionLocalize: ({ t }) => t('settings.pages.providers.provider.openrouter.description'),
  tasks: ['chat', 'vision', 'system1'],
  icon: 'i-lobe-icons:openrouter',

  createProviderConfig: ({ t }) => openRouterConfigSchema.extend({
    apiKey: openRouterConfigSchema.shape.apiKey.meta({
      labelLocalized: t('settings.pages.providers.catalog.edit.config.common.fields.field.api-key.label'),
      descriptionLocalized: t('settings.pages.providers.catalog.edit.config.common.fields.field.api-key.description'),
      placeholderLocalized: t('settings.pages.providers.catalog.edit.config.common.fields.field.api-key.placeholder'),
      type: 'password',
    }),
    baseUrl: openRouterConfigSchema.shape.baseUrl.meta({
      labelLocalized: t('settings.pages.providers.catalog.edit.config.common.fields.field.base-url.label'),
      descriptionLocalized: t('settings.pages.providers.catalog.edit.config.common.fields.field.base-url.description'),
      placeholderLocalized: t('settings.pages.providers.catalog.edit.config.common.fields.field.base-url.placeholder'),
    }),
  }),
  createProvider(config) {
    const provider = createOpenRouter(config.apiKey, config.baseUrl)
    return Object.assign(provider, {
      systemOne: async (state: string | object, questions: Record<string, any>, model = 'typesafe/jev-1.13'): Promise<System1Response> => {
        let statePayload: string
        if (typeof state === 'string') {
          statePayload = state
        }
        else if (state && typeof state === 'object' && 'target_turn' in state && (state as any).target_turn?.text) {
          statePayload = (state as any).target_turn.text
        }
        else {
          statePayload = JSON.stringify(state)
        }

        // Strict boundary: Under no circumstances allow non-Jev models in Decisions API
        const targetModel = model?.startsWith('typesafe/jev') ? model : 'typesafe/jev-1.13'

        const decisionsUrl = 'https://openrouter.ai/api/alpha/decisions'
        const res = await fetch(decisionsUrl, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${config.apiKey}`,
            'Content-Type': 'application/json',
            'HTTP-Referer': 'https://github.com/dasilva333/airi',
            'X-Title': 'AIRI System 1 Coprocessor',
          },
          body: JSON.stringify({
            model: targetModel,
            state: statePayload,
            questions,
          }),
        })

        if (!res.ok) {
          const errText = await res.text()
          throw new Error(`[OpenRouter Decisions] API error ${res.status}: ${errText}`)
        }

        return await res.json() as System1Response
      },
    })
  },

  validationRequiredWhen(config) {
    return !!config.apiKey?.trim()
  },
  validators: {
    ...createOpenAICompatibleValidators({
      checks: ['connectivity', 'model_list'],
    }),
  },
  business: () => ({
    pricing: 'paid',
    deployment: 'cloud',
    beginnerRecommended: true,
    consoleUrl: 'https://openrouter.ai/keys',
  }),
})
