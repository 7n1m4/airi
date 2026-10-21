import type { TransportAdapter } from '@proj-airi/stage-shared/transport-adapter'

import { describe, expect, it, vi } from 'vitest'

import { createLibp2pTransportAdapter } from './transport-adapter'

describe('createLibp2pTransportAdapter', () => {
  it('delegates initialize/dispose/publish/subscribe to deps', async () => {
    const initialize = vi.fn(async () => {})
    const dispose = vi.fn(async () => {})
    const publish = vi.fn(async (_t: string, _d: Uint8Array) => {})
    const subscribe = vi.fn((_t: string, _h: (d: Uint8Array) => void) => () => {})
    const adapter = createLibp2pTransportAdapter({
      deps: { initialize, dispose, publish, subscribe },
    })

    expect(adapter.id).toBe('libp2p-mesh')

    await adapter.initialize()
    expect(initialize).toHaveBeenCalledOnce()

    const payload = new Uint8Array([1, 2, 3])
    await adapter.publish('airi/test', payload)
    expect(publish).toHaveBeenCalledWith('airi/test', payload)

    const handler = (d: Uint8Array) => void d
    const unsub = adapter.subscribe('airi/test', handler)
    expect(subscribe).toHaveBeenCalledWith('airi/test', handler)
    expect(typeof unsub).toBe('function')

    await adapter.dispose()
    expect(dispose).toHaveBeenCalledOnce()
  })

  it('defaults to local-only mesh capabilities', () => {
    const adapter = createLibp2pTransportAdapter({
      deps: {
        initialize: async () => {},
        dispose: async () => {},
        publish: async () => {},
        subscribe: () => () => {},
      },
    })
    expect(adapter.capabilities).toEqual({
      isLocalOnly: true,
      supportsMultiParty: true,
      supportsMeshGossip: true,
      requiresExternalRelay: false,
    })
  })

  it('allows capability overrides', () => {
    const adapter = createLibp2pTransportAdapter({
      deps: {
        initialize: async () => {},
        dispose: async () => {},
        publish: async () => {},
        subscribe: () => () => {},
      },
      capabilities: { requiresExternalRelay: true },
    })
    expect(adapter.capabilities.requiresExternalRelay).toBe(true)
    expect(adapter.capabilities.isLocalOnly).toBe(true)
  })

  it('satisfies the TransportAdapter contract', () => {
    const adapter: TransportAdapter = createLibp2pTransportAdapter({
      deps: {
        initialize: async () => {},
        dispose: async () => {},
        publish: async () => {},
        subscribe: () => () => {},
      },
    })
    expect(adapter).toBeDefined()
  })
})
