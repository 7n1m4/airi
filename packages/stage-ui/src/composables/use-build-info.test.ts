import { describe, expect, it } from 'vitest'

import { useBuildInfo } from './use-build-info'

describe('useBuildInfo', () => {
  it('returns build metadata', () => {
    const info = useBuildInfo()
    expect(typeof info.version).toBe('string')
    expect(typeof info.commit).toBe('string')
    expect(typeof info.branch).toBe('string')
    expect(typeof info.builtOn).toBe('string')
    // builtOn must be a valid ISO date
    expect(Number.isNaN(Date.parse(info.builtOn))).toBe(false)
  })
})
