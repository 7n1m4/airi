import { describe, expect, it } from 'vitest'

import { resolveConfig } from './config'

describe('resolveConfig', () => {
  it('defaults', () => {
    expect(resolveConfig({})).toEqual({ url: 'ws://localhost:6121/ws' })
  })
  it('env overrides', () => {
    expect(resolveConfig({ AIRI_WS_URL: 'ws://x', AIRI_TOKEN: 't' })).toEqual({ url: 'ws://x/ws', token: 't' })
  })
  it('empty token omitted', () => {
    expect(resolveConfig({ AIRI_TOKEN: '' })).toEqual({ url: 'ws://localhost:6121/ws' })
  })
  it('host-only gets /ws', () => {
    expect(resolveConfig({ AIRI_WS_URL: 'ws://localhost:6122' })).toEqual({ url: 'ws://localhost:6122/ws' })
  })
  it('explicit /ws unchanged', () => {
    expect(resolveConfig({ AIRI_WS_URL: 'ws://localhost:6122/ws' })).toEqual({ url: 'ws://localhost:6122/ws' })
  })
  it('custom path unchanged', () => {
    expect(resolveConfig({ AIRI_WS_URL: 'ws://h:1/custom' })).toEqual({ url: 'ws://h:1/custom' })
  })
  it('trailing slash -> /ws', () => {
    expect(resolveConfig({ AIRI_WS_URL: 'ws://h:1/' })).toEqual({ url: 'ws://h:1/ws' })
  })
  it('garbage returned unchanged', () => {
    expect(resolveConfig({ AIRI_WS_URL: 'not a url' })).toEqual({ url: 'not a url' })
  })
})
