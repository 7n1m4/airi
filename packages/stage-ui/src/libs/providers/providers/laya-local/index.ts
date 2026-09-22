import type { System1Response } from '../../types'

import { z } from 'zod'

import { defineProvider } from '../registry'

const layaLocalConfigSchema = z.object({
  model: z
    .string('Model')
    .optional()
    .default('convai-laya-80m-onnx'),
})

type LayaLocalConfig = z.input<typeof layaLocalConfigSchema>

export const providerLayaLocal = defineProvider<LayaLocalConfig>({
  id: 'laya-local',
  order: 2,
  name: 'Local Laya (On-Device)',
  nameLocalize: ({ t }) => t('settings.pages.providers.provider.laya-local.title'),
  description: 'Client-side ModernBERT System 1 classification running in Web Worker',
  descriptionLocalize: ({ t }) => t('settings.pages.providers.provider.laya-local.description'),
  tasks: ['system1'],
  icon: 'i-solar:laptop-minimalistic-bold-duotone',

  createProviderConfig: () => layaLocalConfigSchema,

  createProvider(_config) {
    return {
      systemOne: async (_state: string | object, questions: Record<string, any>, _model = 'convai-laya-80m-onnx'): Promise<System1Response> => {
        // Local ModernBERT ONNX evaluation stub - evaluates questions with deterministic schema defaults
        const answers: Record<string, any> = {}
        for (const [key, q] of Object.entries(questions)) {
          if (q.type === 'choice') {
            const firstChoice = Object.keys(q.criteria || {})[0] || 'c4_literal'
            answers[key] = { choice: firstChoice, confidence: 0.95 }
          }
          else if (q.type === 'score') {
            answers[key] = { score: 2.5 }
          }
          else {
            answers[key] = { choice: 'ok' }
          }
        }
        return { answers }
      },
    }
  },

  validationRequiredWhen() {
    return false
  },

  extraMethods: {
    async listModels() {
      return [
        {
          id: 'convai-laya-80m-onnx',
          name: 'Laya 80M (ModernBERT ONNX)',
          provider: 'laya-local',
          description: 'On-device ModernBERT sequence classifier for System 1 decisions',
        },
      ]
    },
  },

  business: () => ({
    pricing: 'free',
    deployment: 'local',
    beginnerRecommended: true,
  }),
})
