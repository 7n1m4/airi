import { safeParse } from 'valibot'
import { describe, expect, it } from 'vitest'

import { AiriCardSchema, CharacterCueAllowlistSchema } from './card.schema'

describe('characterCueAllowlistSchema', () => {
  it('validates a well-formed CharacterCueAllowlist', () => {
    const allowlist = {
      version: 1,
      emotions: {
        Happy: { rawKey: 'Fcl_ALL_Joy', label: 'Joy' },
        Sad: { rawKey: 'Fcl_ALL_Sorrow', label: 'Sorrow' },
      },
      motions: {
        Wave: { rawKey: 'Wave_Hello', label: 'Wave Hello' },
      },
    }

    const result = safeParse(CharacterCueAllowlistSchema, allowlist)
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.output.version).toBe(1)
      expect(result.output.emotions?.Happy.rawKey).toBe('Fcl_ALL_Joy')
      expect(result.output.motions?.Wave.label).toBe('Wave Hello')
    }
  })

  it('rejects an invalid allowlist version', () => {
    const invalidAllowlist = {
      version: 2,
      emotions: {},
    }

    const result = safeParse(CharacterCueAllowlistSchema, invalidAllowlist)
    expect(result.success).toBe(false)
  })
})

describe('airiCardSchema with cueAllowlist & auto-cues', () => {
  it('successfully parses a character card with cueAllowlist and auto-cues enabled', () => {
    const cardData = {
      name: 'Test Character',
      version: '1.0.0',
      extensions: {
        airi: {
          acting: {
            modelExpressionPrompt: 'Test prompt',
            speechExpressionPrompt: '',
            speechMannerismPrompt: '',
            cueAllowlist: {
              version: 1,
              emotions: {
                Smile: { rawKey: 'Smile_01', label: 'Smile' },
              },
            },
            autoCuesEnabled: true,
            autoCueExpressions: true,
            autoCueMotions: false,
          },
        },
      },
    }

    const result = safeParse(AiriCardSchema, cardData)
    expect(result.success).toBe(true)
    if (result.success) {
      const acting = result.output.extensions?.airi?.acting
      expect(acting?.autoCuesEnabled).toBe(true)
      expect(acting?.autoCueExpressions).toBe(true)
      expect(acting?.autoCueMotions).toBe(false)
      expect(acting?.cueAllowlist?.emotions?.Smile.rawKey).toBe('Smile_01')
    }
  })

  it('accepts compiledWhitelist for backward compatibility on import', () => {
    const legacyCardData = {
      name: 'Legacy Character',
      version: '1.0.0',
      extensions: {
        airi: {
          acting: {
            modelExpressionPrompt: 'Legacy prompt',
            speechExpressionPrompt: '',
            speechMannerismPrompt: '',
            compiledWhitelist: {
              version: 1,
              emotions: {
                Cheer: { rawKey: 'Cheer_01', label: 'Cheer' },
              },
            },
          },
        },
      },
    }

    const result = safeParse(AiriCardSchema, legacyCardData)
    expect(result.success).toBe(true)
    if (result.success) {
      const acting = result.output.extensions?.airi?.acting
      expect(acting?.compiledWhitelist?.emotions?.Cheer.rawKey).toBe('Cheer_01')
    }
  })
})
