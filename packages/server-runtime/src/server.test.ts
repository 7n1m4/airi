import { describe, expect, it } from 'vitest'

import { getLocalIPs } from './server'

describe('server', () => {
  it('getLocalIPs returns array', () => {
    const ips = getLocalIPs()
    expect(Array.isArray(ips)).toBe(true)
  })
})
