import { describe, expect, it } from 'vitest'

import { getMossAdapterInstance, sanitizeMossInputText } from './moss-audio-utils'

describe('mOSS audio utilities unit tests', () => {
  it('instantiates MOSS adapter singleton lazily', async () => {
    const adapter1 = await getMossAdapterInstance()
    const adapter2 = await getMossAdapterInstance()

    expect(adapter1).toBeDefined()
    expect(adapter2).toBeDefined()
    expect(adapter1).toBe(adapter2) // Must be identical singleton instance
  })

  describe('sanitizeMossInputText', () => {
    it('handles empty or blank string gracefully', () => {
      expect(sanitizeMossInputText('')).toBe('')
      expect(sanitizeMossInputText('   ')).toBe('')
    })

    it('strips square brackets to protect MOSS tokenizer', () => {
      expect(sanitizeMossInputText('[whisper] Hello there [giggle]')).toBe('whisper Hello there giggle')
      expect(sanitizeMossInputText('[screaming] Help me!')).toBe('screaming Help me!')
      expect(sanitizeMossInputText('Hello [world]')).toBe('Hello world')
    })

    it('strips special token delimiters like <|...|>', () => {
      expect(sanitizeMossInputText('Hello <|ACT:happy|> world')).toBe('Hello world')
      expect(sanitizeMossInputText('<|ACTOR:narrator|> Once upon a time')).toBe('Once upon a time')
    })

    it('normalizes multi-spaces resulting from bracket removal', () => {
      expect(sanitizeMossInputText('This   is   [test]   speech')).toBe('This is test speech')
    })
  })
})
