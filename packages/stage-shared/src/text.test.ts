import { describe, expect, it } from 'vitest'

import { normalizeSearchText, safeTruncate } from './text'

describe('normalizeSearchText', () => {
  it('handles null, undefined, and empty string', () => {
    expect(normalizeSearchText(undefined)).toBe('')
    expect(normalizeSearchText(null)).toBe('')
    expect(normalizeSearchText('')).toBe('')
    expect(normalizeSearchText('   ')).toBe('')
  })

  it('trims whitespace and converts to lowercase', () => {
    expect(normalizeSearchText('  Ichika  ')).toBe('ichika')
    expect(normalizeSearchText('ICHIKA')).toBe('ichika')
  })

  it('normalizes full-width Latin and digits via NFKC', () => {
    expect(normalizeSearchText('Ｉｃｈｉｋａ')).toBe('ichika')
    expect(normalizeSearchText('１２３')).toBe('123')
  })

  it('removes diacritical marks/accents via NFD', () => {
    expect(normalizeSearchText('Chloé')).toBe('chloe')
    expect(normalizeSearchText('Café')).toBe('cafe')
    expect(normalizeSearchText('München')).toBe('munchen')
  })

  it('enables substring matching for nicknames and names', () => {
    const targetNickname = normalizeSearchText('Ichika')
    const query = normalizeSearchText('  ICH  ')
    expect(targetNickname.includes(query)).toBe(true)
  })
})

describe('safeTruncate', () => {
  it('returns empty string for empty input or zero/negative limit', () => {
    expect(safeTruncate('', 10)).toBe('')
    expect(safeTruncate('hello', 0)).toBe('')
    expect(safeTruncate('hello', -1)).toBe('')
  })

  it('preserves text shorter than or equal to limit without appending ellipsis', () => {
    expect(safeTruncate('hello', 5, '...')).toBe('hello')
    expect(safeTruncate('hi', 5, '...')).toBe('hi')
  })

  it('truncates text exceeding limit and appends ellipsis', () => {
    expect(safeTruncate('hello world', 5, '...')).toBe('hello...')
    expect(safeTruncate('hello world', 5, '…')).toBe('hello…')
  })

  it('trims trailing whitespace before appending ellipsis', () => {
    expect(safeTruncate('hello   world', 5, '...')).toBe('hello...')
  })

  it('does not split astral-plane emoji surrogate pairs at the truncation boundary', () => {
    // 'a' repeated 10 times + emoji '😀' (U+1F600, 2 UTF-16 code units, 1 Unicode code point) + rest
    const text = `${'a'.repeat(10)}😀 more text`
    // Standard string.slice(0, 11) would bisect the surrogate pair of '😀', producing an ill-formed string.
    // safeTruncate operates on code points, preserving '😀' cleanly.
    const truncated = safeTruncate(text, 11, '...')
    expect(truncated).toBe(`${'a'.repeat(10)}😀...`)
    expect(truncated.isWellFormed()).toBe(true)
    expect(() => encodeURIComponent(truncated)).not.toThrow()
  })

  it('cleanly excludes an astral-plane emoji when limit falls before it', () => {
    const text = `${'a'.repeat(10)}😀 more text`
    const truncated = safeTruncate(text, 10, '...')
    expect(truncated).toBe(`${'a'.repeat(10)}...`)
    expect(truncated.isWellFormed()).toBe(true)
    expect(() => encodeURIComponent(truncated)).not.toThrow()
  })

  it('handles multilingual text and complex kaomoji safely', () => {
    const text = 'こんにちは世界！(｡•̀ᴗ-)✧ ✨'
    const truncated = safeTruncate(text, 8, '…')
    expect(truncated).toBe('こんにちは世界！…')
    expect(truncated.isWellFormed()).toBe(true)
  })
})
