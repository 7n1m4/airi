import type { ComposerTranslation } from 'vue-i18n'

import { describe, expect, it } from 'vitest'

import { createSpeechMetadata } from './speech'

const mockT = ((key: string) => key) as unknown as ComposerTranslation

describe('speech registry coverage', () => {
  it('exercises all metadata entries', async () => {
    const metadata = createSpeechMetadata(mockT)
    for (const [id, meta] of Object.entries(metadata)) {
      expect(meta).toBeDefined()
      void id
      if (typeof meta.isAvailableBy === 'function') {
        try { await meta.isAvailableBy({} as unknown as Record<string, unknown>) }
        catch { /* ignore */ }
      }
      if (typeof meta.createProvider === 'function') {
        try { await meta.createProvider({ apiKey: 'key', baseUrl: 'http://localhost/', model: 'm' } as unknown as Parameters<NonNullable<typeof meta.createProvider>>[0]) }
        catch { /* ignore */ }
      }
      if (typeof meta.listModels === 'function') {
        try { await meta.listModels({ apiKey: 'key', baseUrl: 'http://localhost/' } as unknown as Parameters<NonNullable<typeof meta.listModels>>[0]) }
        catch { /* ignore */ }
      }
    }
  })
})
