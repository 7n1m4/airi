import { describe, expect, it } from 'vitest'

import { nlsMetaEndpointFromRegion, nlsWebSocketEndpointFromRegion } from './utils'

describe('nlsMetaEndpointFromRegion', () => {
  it('builds meta endpoint URL from region', () => {
    const url = nlsMetaEndpointFromRegion('cn-shanghai')
    expect(url.href).toBe('http://nls-meta.cn-shanghai.aliyuncs.com/')
    expect(url.hostname).toBe('nls-meta.cn-shanghai.aliyuncs.com')
  })
})

describe('nlsWebSocketEndpointFromRegion', () => {
  it('defaults to cn-shanghai', () => {
    const url = nlsWebSocketEndpointFromRegion()
    expect(url.protocol).toBe('wss:')
    expect(url.hostname).toBe('nls-gateway-cn-shanghai.aliyuncs.com')
    expect(url.pathname).toBe('/ws/v1')
  })

  it.each(['cn-shanghai', 'cn-beijing', 'cn-shenzhen'])('handles public region %s', (region) => {
    const url = nlsWebSocketEndpointFromRegion(region)
    expect(url.protocol).toBe('wss:')
    expect(url.hostname).toBe(`nls-gateway-${region}.aliyuncs.com`)
  })

  it.each(['cn-shanghai-internal', 'cn-beijing-internal', 'cn-shenzhen-internal'])('handles internal region %s', (region) => {
    const url = nlsWebSocketEndpointFromRegion(region)
    expect(url.protocol).toBe('wss:')
    expect(url.hostname).toBe('example.com')
  })

  it('falls through to example.com for unknown region', () => {
    const url = nlsWebSocketEndpointFromRegion('cn-unknown')
    expect(url.protocol).toBe('https:')
    expect(url.hostname).toBe('example.com')
    expect(url.pathname).toBe('/ws/v1')
  })
})
