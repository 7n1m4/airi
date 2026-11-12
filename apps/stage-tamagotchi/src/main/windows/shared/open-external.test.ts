import { beforeEach, describe, expect, it, vi } from 'vitest'

import { openExternalSafely } from './open-external'

const { openExternal } = vi.hoisted(() => ({ openExternal: vi.fn() }))

vi.mock('electron', () => ({
  shell: { openExternal },
}))

describe('openExternalSafely', () => {
  beforeEach(() => {
    openExternal.mockClear()
    vi.spyOn(console, 'warn').mockImplementation(() => {})
  })

  it('opens http and https URLs', () => {
    openExternalSafely('https://example.com/a?b=1')
    openExternalSafely('http://example.com')
    expect(openExternal).toHaveBeenCalledTimes(2)
  })

  it('drops OS scheme URLs (ms-msdt, smb, file, mailto)', () => {
    openExternalSafely('ms-msdt:/id/../../')
    openExternalSafely('smb://169.254.169.254/x')
    openExternalSafely('file:///etc/passwd')
    openExternalSafely('mailto:someone@example.com')
    expect(openExternal).not.toHaveBeenCalled()
  })

  it('drops unparsable URLs without throwing', () => {
    expect(() => openExternalSafely('not a url')).not.toThrow()
    expect(openExternal).not.toHaveBeenCalled()
  })
})
