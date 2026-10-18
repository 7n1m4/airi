import { describe, expect, it } from 'vitest'

import { listProvidersForPluginHost, shouldPublishPluginHostCapabilities } from './plugin-host-capabilities'

describe('store plugin-host-capabilities', () => {
  it('listProvidersForPluginHost returns provider summaries with names', () => {
    const result = listProvidersForPluginHost()
    expect(Array.isArray(result)).toBe(true)
    for (const entry of result) {
      expect(entry).toHaveProperty('name')
      expect(typeof entry.name).toBe('string')
    }
  })

  it('shouldPublishPluginHostCapabilities returns boolean', () => {
    const result = shouldPublishPluginHostCapabilities()
    expect(typeof result).toBe('boolean')
  })
})
