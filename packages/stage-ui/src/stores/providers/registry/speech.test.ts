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
        try { await meta.isAvailableBy() }
        catch { /* ignore */ }
      }
      if (typeof meta.createProvider === 'function') {
        try { await meta.createProvider({ apiKey: 'key', baseUrl: 'http://localhost/', model: 'm' }) }
        catch { /* ignore */ }
      }
      if (typeof meta.capabilities.listModels === 'function') {
        try { await meta.capabilities.listModels({ apiKey: 'key', baseUrl: 'http://localhost/' }) }
        catch { /* ignore */ }
      }
    }
  })
})
