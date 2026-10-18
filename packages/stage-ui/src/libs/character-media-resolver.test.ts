import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it } from 'vitest'

import { colorCache, extractComplementaryColors, extractModelIcon, getContrastingComplementaryColor, getLatestSelfie, iconCache } from './character-media-resolver'

describe('character-media-resolver', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    iconCache.clear()
    colorCache.clear()
    try { localStorage.clear() }
    catch {}
  })

  it('getContrastingComplementaryColor returns hex', () => {
    const res = getContrastingComplementaryColor(100, 150, 200)
    expect(res.light).toMatch(/^#[0-9a-f]{6}$/)
    expect(res.dark).toMatch(/^#[0-9a-f]{6}$/)
  })

  it('getLatestSelfie returns null on no store', () => {
    expect(getLatestSelfie('card')).toBeNull()
  })

  it('extractModelIcon missing model', async () => {
    const r = await extractModelIcon('missing')
    expect(r).toBeNull()
  })

  it('extractComplementaryColors cache hit', async () => {
    colorCache.set('u', { light: '#ffffff', dark: '#000000' })
    const r = await extractComplementaryColors('u')
    expect(r).toEqual({ light: '#ffffff', dark: '#000000' })
  })
})
