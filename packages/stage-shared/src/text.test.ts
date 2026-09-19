import { describe, expect, it } from 'vitest'

import { normalizeSearchText } from './text'

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
