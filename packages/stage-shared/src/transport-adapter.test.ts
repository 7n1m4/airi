import type {
  TransportAdapter,
  TransportCapabilities,
} from './transport-adapter'

import { describe, expectTypeOf, it } from 'vitest'

describe('transportCapabilities', () => {
  it('exposes the four capability flags from the RFC', () => {
    expectTypeOf<TransportCapabilities>().toHaveProperty('isLocalOnly')
    expectTypeOf<TransportCapabilities>().toHaveProperty('supportsMultiParty')
    expectTypeOf<TransportCapabilities>().toHaveProperty('supportsMeshGossip')
    expectTypeOf<TransportCapabilities>().toHaveProperty('requiresExternalRelay')

    expectTypeOf<TransportCapabilities['isLocalOnly']>().toEqualTypeOf<boolean>()
    expectTypeOf<TransportCapabilities['supportsMultiParty']>().toEqualTypeOf<boolean>()
    expectTypeOf<TransportCapabilities['supportsMeshGossip']>().toEqualTypeOf<boolean>()
    expectTypeOf<TransportCapabilities['requiresExternalRelay']>().toEqualTypeOf<boolean>()
  })
})

describe('transportAdapter', () => {
  it('exposes id, capabilities, lifecycle, and pub/sub', () => {
    expectTypeOf<TransportAdapter>().toHaveProperty('id')
    expectTypeOf<TransportAdapter>().toHaveProperty('capabilities')
    expectTypeOf<TransportAdapter>().toHaveProperty('initialize')
    expectTypeOf<TransportAdapter>().toHaveProperty('dispose')
    expectTypeOf<TransportAdapter>().toHaveProperty('publish')
    expectTypeOf<TransportAdapter>().toHaveProperty('subscribe')

    expectTypeOf<TransportAdapter['id']>().toEqualTypeOf<string>()
    expectTypeOf<TransportAdapter['capabilities']>().toEqualTypeOf<TransportCapabilities>()
    expectTypeOf<TransportAdapter['initialize']>().toEqualTypeOf<() => Promise<void>>()
    expectTypeOf<TransportAdapter['dispose']>().toEqualTypeOf<() => Promise<void>>()
    expectTypeOf<TransportAdapter['publish']>().toEqualTypeOf<(topic: string, payload: Uint8Array) => Promise<void>>()
    expectTypeOf<TransportAdapter['subscribe']>().toEqualTypeOf<(topic: string, handler: (payload: Uint8Array) => void) => () => void>()
  })

  it('is implementable by a plain object (structural typing)', () => {
    const mock: TransportAdapter = {
      id: 'mock',
      capabilities: {
        isLocalOnly: true,
        supportsMultiParty: false,
        supportsMeshGossip: false,
        requiresExternalRelay: false,
      },
      initialize: async () => {},
      dispose: async () => {},
      publish: async (_topic: string, _payload: Uint8Array) => {},
      subscribe: (_topic: string, _handler: (payload: Uint8Array) => void) => () => {},
    }
    // If this compiles, the interface is structurally satisfiable.
    expectTypeOf(mock).toMatchTypeOf<TransportAdapter>()
  })
})
