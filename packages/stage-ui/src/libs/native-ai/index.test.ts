import { describe, expect, it } from 'vitest'

import { formatBytes } from './index'

describe('formatBytes', () => {
  it('returns 0 B for falsy/invalid/negative', () => {
    expect(formatBytes(0)).toBe('0 B')
    expect(formatBytes(Number.NaN)).toBe('0 B')
    expect(formatBytes(-5)).toBe('0 B')
    expect(formatBytes(undefined as unknown as number)).toBe('0 B')
  })

  it('formats bytes', () => {
    expect(formatBytes(500)).toBe('500 B')
  })

  it('formats KB', () => {
    expect(formatBytes(1024)).toBe('1 KB')
  })

  it('formats MB', () => {
    expect(formatBytes(1024 * 1024)).toBe('1 MB')
  })

  it('formats GB', () => {
    expect(formatBytes(6 * 1024 * 1024 * 1024)).toBe('6 GB')
  })

  it('respects decimals', () => {
    expect(formatBytes(1536, 2)).toBe('1.5 KB')
    expect(formatBytes(1536, 0)).toBe('2 KB')
    expect(formatBytes(1536, -1)).toBe('2 KB')
  })

  it('clamps decimals negative to 0', () => {
    expect(formatBytes(1024, -5)).toBe('1 KB')
  })
})
