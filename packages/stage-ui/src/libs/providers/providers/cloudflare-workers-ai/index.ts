import { createWorkersAI } from '@xsai-ext/providers/special/create'
import { z } from 'zod'

import { defineProvider } from '../registry'

export const providerCloudflareWorkersAI = defineProvider({
  id: 'cloudflare-workers-ai',
  name: 'Cloudflare Workers AI',
  nameLocalize: ({ t }) => t('settings.pages.providers.provider.cloudflare-workers-ai.title'),
  description: 'AI on the Edge - 10k free Neurons/day across many models',
  descriptionLocalize: ({ t }) => t('settings.pages.providers.provider.cloudflare-workers-ai.description'),
  tasks: ['chat', 'vision'],
  icon: 'i-simple-icons:cloudflare',
  iconColor: 'i-lobe-icons:cloudflare-color',
  business: () => ({
    pricing: 'free',
    deployment: 'cloud',
    consoleUrl: 'https://dash.cloudflare.com/',
  }),

  createProviderConfig: ({ t }) => z.object({
    apiKey: z.string().meta({
      labelLocalized: t('settings.pages.providers.catalog.edit.config.common.fields.field.api-key.label'),
      descriptionLocalized: t('settings.pages.providers.catalog.edit.config.common.fields.field.api-key.description'),
      placeholderLocalized: t('settings.pages.providers.provider.cloudflare-workers-ai.fields.field.api-key.placeholder'),
      type: 'password',
    }),
    accountId: z.string().meta({
      labelLocalized: t('settings.pages.providers.provider.cloudflare-workers-ai.fields.field.account-id.label'),
      descriptionLocalized: t('settings.pages.providers.provider.cloudflare-workers-ai.fields.field.account-id.description'),
      placeholderLocalized: t('settings.pages.providers.provider.cloudflare-workers-ai.fields.field.account-id.placeholder'),
    }),
  }),
  createProvider(config) {
    const baseAI = createWorkersAI(config.apiKey, config.accountId) as any
    const rawChat = baseAI.chat.bind(baseAI)

    // Resilient Chat Provider with Transparent OAuth Token Auto-Refresh
    baseAI.chat = (model: string) => {
      const chatConfig = rawChat(model)
      const originalFetch = chatConfig.fetch ?? globalThis.fetch

      chatConfig.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
        let res = await originalFetch(input, init)

        // If Cloudflare returns 401 Unauthorized, attempt transparent OAuth refresh & retry
        if (res.status === 401) {
          try {
            const { useCloudflareStore } = await import('../../../../stores/modules/cloudflare')
            const { useProvidersStore } = await import('../../../../stores/providers')
            const cloudflareStore = useCloudflareStore()
            const providersStore = useProvidersStore()

            if (cloudflareStore.cfOAuthTokens?.refreshToken) {
              console.warn('[CloudflareWorkersAI] 401 encountered, attempting transparent OAuth token refresh...')
              const refreshed = await cloudflareStore.refreshOAuthTokens()
              if (refreshed?.accessToken) {
                // Update active credentials in memory & store
                if (providersStore.providers['cloudflare-workers-ai']) {
                  providersStore.providers['cloudflare-workers-ai'].apiKey = refreshed.accessToken
                }

                // Re-execute request with refreshed Authorization header
                const updatedHeaders = new Headers(init?.headers || {})
                updatedHeaders.set('Authorization', `Bearer ${refreshed.accessToken}`)

                res = await originalFetch(input, {
                  ...init,
                  headers: updatedHeaders,
                })
              }
            }
          }
          catch (refreshErr) {
            console.error('[CloudflareWorkersAI] Resilient OAuth refresh failed:', refreshErr)
          }
        }

        return res
      }

      return chatConfig
    }

    return baseAI
  },
  validationRequiredWhen: (config) => {
    return !!config.apiKey && !!config.accountId
  },
  validators: {
    validateConfig: [
      ({ t }) => ({
        id: 'cloudflare-workers-ai:check-config',
        name: t('settings.pages.providers.catalog.edit.validators.openai-compatible.check-config.title'),
        validator: async (config) => {
          const errors: Array<{ error: unknown }> = []
          const apiKey = typeof config.apiKey === 'string' ? config.apiKey.trim() : ''
          const accountId = typeof config.accountId === 'string' ? config.accountId.trim() : ''

          if (!apiKey)
            errors.push({ error: new Error('API token is required.') })
          if (!accountId)
            errors.push({ error: new Error('Account ID is required.') })

          return {
            errors,
            reason: errors.length > 0 ? errors.map(item => (item.error as Error).message).join(', ') : '',
            reasonKey: '',
            valid: errors.length === 0,
          }
        },
      }),
    ],
  },
})
