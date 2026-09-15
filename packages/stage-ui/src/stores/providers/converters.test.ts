import { describe, expect, it, vi } from 'vitest'
import { z } from 'zod'

import { convertProviderDefinitionToMetadata } from './converters'

vi.mock('@xsai/model', () => ({
  listModels: vi.fn(async () => [
    { id: 'test-model', name: 'Test Model', context_length: 8192 },
  ]),
}))

describe('providers converters', () => {
  it('keeps schema defaults when required fields are missing', () => {
    const definition = {
      id: 'test-provider',
      tasks: ['chat'],
      name: 'Test Provider',
      nameLocalize: ({ t }: { t: (input: string) => string }) => t('name.key'),
      description: 'test',
      descriptionLocalize: ({ t }: { t: (input: string) => string }) => t('description.key'),
      createProviderConfig: () => z.object({
        apiKey: z.string(),
        baseUrl: z.string().optional().default('https://example.com/v1/'),
      }),
      createProvider: () => ({}) as any,
    } as any

    const metadata = convertProviderDefinitionToMetadata(definition, ((key: string) => key) as any)

    expect(metadata.defaultOptions?.()).toMatchObject({
      baseUrl: 'https://example.com/v1/',
    })
  })

  it('provides generic model listing fallback for model providers', async () => {
    const definition = {
      id: 'test-provider',
      tasks: ['chat'],
      name: 'Test Provider',
      nameLocalize: ({ t }: { t: (input: string) => string }) => t('name.key'),
      description: 'test',
      descriptionLocalize: ({ t }: { t: (input: string) => string }) => t('description.key'),
      createProviderConfig: () => z.object({
        apiKey: z.string(),
        baseUrl: z.string().optional().default('https://example.com/v1/'),
      }),
      createProvider: () => ({
        model: () => ({ baseURL: 'https://example.com/v1/', apiKey: 'k' }),
      }),
      validators: {
        validateConfig: [
          () => ({
            id: 'openai-compatible:check-config',
            name: 'config',
            validator: async () => ({ errors: [], reason: '', reasonKey: '', valid: true }),
          }),
        ],
      },
      validationRequiredWhen: () => true,
    } as any

    const metadata = convertProviderDefinitionToMetadata(definition, ((key: string) => key) as any)
    const models = await metadata.capabilities.listModels?.({ apiKey: 'k', baseUrl: 'https://example.com/v1/' })

    expect(models).toMatchObject([
      {
        id: 'test-model',
        name: 'Test Model',
        provider: 'test-provider',
      },
    ])
  })

  it('adds default base url hint to validation reason when base url is missing', async () => {
    const definition = {
      id: 'test-provider',
      tasks: ['chat'],
      name: 'Test Provider',
      nameLocalize: ({ t }: { t: (input: string) => string }) => t('name.key'),
      description: 'test',
      descriptionLocalize: ({ t }: { t: (input: string) => string }) => t('description.key'),
      createProviderConfig: () => z.object({
        apiKey: z.string(),
        baseUrl: z.string().optional().default('https://example.com/v1/'),
      }),
      createProvider: () => ({
        model: () => ({ baseURL: 'https://example.com/v1/', apiKey: 'k' }),
      }),
      validators: {
        validateConfig: [
          () => ({
            id: 'openai-compatible:check-config',
            name: 'config',
            validator: async () => ({ errors: [{ error: new Error('Base URL is required.') }], reason: 'Base URL is required.', reasonKey: '', valid: false }),
          }),
        ],
      },
      validationRequiredWhen: () => true,
    } as any

    const metadata = convertProviderDefinitionToMetadata(definition, ((key: string) => key) as any)
    const result = await metadata.validators.validateProviderConfig({ apiKey: 'k' })

    expect(result.valid).toBe(false)
    expect(result.reason).toContain('Base URL is required.')
    expect(result.reason).toContain('Default to https://example.com/v1/.')
  })

  it('merges schema defaults into createProvider when optional config fields are omitted', async () => {
    let capturedConfig: any = null
    const definition = {
      id: 'test-provider',
      tasks: ['chat'],
      name: 'Test Provider',
      nameLocalize: ({ t }: { t: (input: string) => string }) => t('name.key'),
      description: 'test',
      descriptionLocalize: ({ t }: { t: (input: string) => string }) => t('description.key'),
      createProviderConfig: () => z.object({
        apiKey: z.string(),
        baseUrl: z.string().optional().default('https://integrate.api.nvidia.com/v1/'),
      }),
      createProvider: (cfg: any) => {
        capturedConfig = cfg
        return {
          model: () => ({ baseURL: cfg.baseUrl, apiKey: cfg.apiKey }),
        } as any
      },
    } as any

    const metadata = convertProviderDefinitionToMetadata(definition, ((key: string) => key) as any)

    // User only provides apiKey without baseUrl
    await metadata.createProvider({ apiKey: 'nvapi-12345' })

    expect(capturedConfig).toMatchObject({
      apiKey: 'nvapi-12345',
      baseUrl: 'https://integrate.api.nvidia.com/v1/',
    })
  })

  it('tags vision models using pattern matching when explicit modalities are absent', async () => {
    const definition = {
      id: 'opencode-go',
      tasks: ['chat', 'vision'],
      name: 'OpenCode Go',
      nameLocalize: ({ t }: { t: (input: string) => string }) => t('name.key'),
      description: 'test',
      descriptionLocalize: ({ t }: { t: (input: string) => string }) => t('description.key'),
      createProviderConfig: () => z.object({
        apiKey: z.string(),
        baseUrl: z.string().optional().default('https://opencode.ai/zen/go/v1/'),
      }),
      extraMethods: {
        listModels: async () => [
          { id: 'deepseek-v4-flash-vision-exp', name: 'DeepSeek Vision' },
          { id: 'deepseek-v4-flash', name: 'DeepSeek Flash' },
          { id: 'gpt-4o', name: 'GPT-4o' },
        ],
      },
      createProvider: () => ({}) as any,
    } as any

    const metadata = convertProviderDefinitionToMetadata(definition, ((key: string) => key) as any)
    const models = await metadata.capabilities.listModels?.({ apiKey: 'k' })

    const visionModel = models?.find(m => m.id === 'deepseek-v4-flash-vision-exp')
    const chatModel = models?.find(m => m.id === 'deepseek-v4-flash')
    const gpt4oModel = models?.find(m => m.id === 'gpt-4o')

    expect(visionModel?.capabilities).toContain('vision')
    expect(gpt4oModel?.capabilities).toContain('vision')
    expect(chatModel?.capabilities).not.toContain('vision')
  })
})
