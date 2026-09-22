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

  validators: {
    validateConfig: [
      () => ({
        id: 'typesafe-ai:check-config',
        name: 'Check configuration',
        validator: async (config: TypeSafeConfig) => {
          const errors: Array<{ error: unknown }> = []
          if (!config.apiKey?.trim())
            errors.push({ error: new Error('API key is required.') })
          return {
            errors,
            reason: errors.map(e => (e.error as Error).message).join(', '),
            reasonKey: '',
            valid: errors.length === 0,
          }
        },
      }),
    ],
    validateProvider: [
      () => ({
        id: 'typesafe-ai:check-connectivity',
        name: 'Check TypeSafe AI connectivity',
        validator: async (config: TypeSafeConfig) => {
          const errors: Array<{ error: unknown }> = []
          const endpoint = config.baseUrl || 'https://api.typesafe.ai/v1/systemone'
          const controller = new AbortController()
          const timeout = setTimeout(() => controller.abort(), 10_000)
          try {
            // NOTICE: TypeSafe AI doesn't have a dedicated health endpoint, so we
            // send a minimal systemOne request to verify the key + connectivity.
            const res = await fetch(endpoint, {
              method: 'POST',
              headers: {
                'Authorization': `Bearer ${config.apiKey}`,
                'Content-Type': 'application/json',
              },
              body: JSON.stringify({
                model: 'jev-latest',
                state: 'ping',
                questions: { ping: { type: 'choice', instructions: 'Connectivity check.', criteria: { ok: 'ok' } } },
              }),
              signal: controller.signal,
            })
            if (res.status === 401 || res.status === 403) {
              errors.push({ error: new Error('Invalid API key — authentication rejected.') })
            }
            else if (res.status >= 500) {
              errors.push({ error: new Error(`TypeSafe AI server error: HTTP ${res.status}`) })
            }
          }
          catch (e: any) {
            if (e?.name !== 'AbortError') {
              errors.push({ error: new Error(`Connectivity check failed: ${e?.message || String(e)}`) })
            }
            else {
              errors.push({ error: new Error('Connectivity check timed out after 10s.') })
            }
          }
          finally {
            clearTimeout(timeout)
          }
          return {
            errors,
            reason: errors.map(e => (e.error as Error).message).join(', '),
            reasonKey: '',
            valid: errors.length === 0,
          }
        },
      }),
    ],
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
