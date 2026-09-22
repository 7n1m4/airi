import type { System1Response } from '../../types'

import { z } from 'zod'

import { defineProvider } from '../registry'

const typeSafeConfigSchema = z.object({
  apiKey: z.string('API Key'),
  baseUrl: z
    .string('Base URL')
    .optional()
    .default('https://api.typesafe.ai/v1/systemone'),
})

type TypeSafeConfig = z.input<typeof typeSafeConfigSchema>

export const providerTypeSafeAI = defineProvider<TypeSafeConfig>({
  id: 'typesafe-ai',
  order: 1,
  name: 'TypeSafe AI (Jev)',
  nameLocalize: ({ t }) => t('settings.pages.providers.provider.typesafe-ai.title'),
  description: 'Ultra-fast System-1 cognitive classification & batched decision engine',
  descriptionLocalize: ({ t }) => t('settings.pages.providers.provider.typesafe-ai.description'),
  tasks: ['system1'],
  icon: 'i-solar:cpu-bolt-bold-duotone',

  createProviderConfig: ({ t }) => typeSafeConfigSchema.extend({
    apiKey: typeSafeConfigSchema.shape.apiKey.meta({
      labelLocalized: t('settings.pages.providers.catalog.edit.config.common.fields.field.api-key.label'),
      descriptionLocalized: t('settings.pages.providers.catalog.edit.config.common.fields.field.api-key.description'),
      placeholderLocalized: t('settings.pages.providers.catalog.edit.config.common.fields.field.api-key.placeholder'),
      type: 'password',
    }),
    baseUrl: typeSafeConfigSchema.shape.baseUrl.meta({
      labelLocalized: t('settings.pages.providers.catalog.edit.config.common.fields.field.base-url.label'),
      descriptionLocalized: t('settings.pages.providers.catalog.edit.config.common.fields.field.base-url.description'),
      placeholderLocalized: 'https://api.typesafe.ai/v1/systemone',
    }),
  }),

  createProvider(config) {
    const endpoint = config.baseUrl || 'https://api.typesafe.ai/v1/systemone'
    return {
      systemOne: async (state: string | object, questions: Record<string, any>, model = 'jev-latest'): Promise<System1Response> => {
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

        const res = await fetch(endpoint, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${config.apiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            model,
            state: statePayload,
            questions,
          }),
        })

        if (!res.ok) {
          const errText = await res.text()
          throw new Error(`[TypeSafe AI] API error ${res.status}: ${errText}`)
        }

        return await res.json() as System1Response
      },
    }
  },

  validationRequiredWhen(config) {
    return !!config.apiKey?.trim()
  },

  extraMethods: {
    async listModels() {
      return [
        {
          id: 'jev-latest',
          name: 'TypeSafe Jev Latest',
          provider: 'typesafe-ai',
          description: 'TypeSafe Jev state-of-the-art fast decision classifier',
        },
        {
          id: 'jev-1.13',
          name: 'TypeSafe Jev 1.13',
          provider: 'typesafe-ai',
          description: 'TypeSafe Jev 1.13 deterministic classifier',
        },
      ]
    },
  },

  business: () => ({
    pricing: 'paid',
    deployment: 'cloud',
    beginnerRecommended: false,
    consoleUrl: 'https://typesafe.ai',
  }),
})
