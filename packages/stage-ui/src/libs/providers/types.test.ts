import type { ProviderInstance } from './types'

import { describe, expect, it } from 'vitest'

import {
  isKeylessProvider,
  isModelProvider,
  isOptionalKeyProvider,
  keylessOrOptionalKey,
} from './types'

describe('providers/types', () => {
  describe('isModelProvider', () => {
    it('returns true when object has model function', () => {
      expect(isModelProvider({ model: () => ({ baseURL: 'https://api.example.com/' }) })).toBe(true)
    })

    it('returns false otherwise', () => {
      expect(isModelProvider({} as ProviderInstance)).toBe(false)

      // Structurally a chat provider carrying a malformed, non-function `model` field.
      const withBogusModelField = { chat: (model: string) => ({ baseURL: 'https://api.example.com/', model }), model: 'x' }
      expect(isModelProvider(withBogusModelField)).toBe(false)
    })
  })

  describe('isKeylessProvider', () => {
    it('true only for false', () => {
      expect(isKeylessProvider(false)).toBe(true)
      expect(isKeylessProvider(true)).toBe(false)
      expect(isKeylessProvider(undefined)).toBe(false)
      expect(isKeylessProvider({ optional: true })).toBe(false)
    })
  })

  describe('isOptionalKeyProvider', () => {
    it('true for optional object', () => {
      expect(isOptionalKeyProvider({ optional: true })).toBe(true)
    })

    it('false otherwise', () => {
      expect(isOptionalKeyProvider(false)).toBe(false)
      expect(isOptionalKeyProvider(true)).toBe(false)
      expect(isOptionalKeyProvider(undefined)).toBe(false)
      expect(isOptionalKeyProvider(null as unknown as Parameters<typeof isOptionalKeyProvider>[0])).toBe(false)
      // Cast, not widening: `requiresCredentials` is `boolean | { optional: true } | undefined`, so an
      // object literal lacking `optional` is not expressible in that type — this asserts the guard's
      // defensive `'optional' in value` check against runtime junk.
      expect(isOptionalKeyProvider({} as Parameters<typeof isOptionalKeyProvider>[0])).toBe(false)
    })
  })

  describe('keylessOrOptionalKey', () => {
    it('combines both', () => {
      expect(keylessOrOptionalKey(false)).toBe(true)
      expect(keylessOrOptionalKey({ optional: true })).toBe(true)
      expect(keylessOrOptionalKey(true)).toBe(false)
      expect(keylessOrOptionalKey(undefined)).toBe(false)
    })
  })
})
