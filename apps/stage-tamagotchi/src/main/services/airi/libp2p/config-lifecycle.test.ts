import type { Libp2pServiceConfig } from '../../../../../../../packages/stage-shared/src/libp2p'

import { Buffer } from 'node:buffer'

import { describe, expect, it, vi } from 'vitest'

/**
 * The config as the service's own schema types it. `discovery` is schema-only —
 * it is validated and merged but deliberately absent from the shared
 * `Libp2pServiceConfig` interface, which is the renderer-facing contract — so
 * reading it needs this shape.
 */
interface ConfigWithDiscovery extends Libp2pServiceConfig {
  discovery: { mdns: boolean }
}

/**
 * libp2p config lifecycle in
 * `apps/stage-tamagotchi/src/main/services/airi/libp2p/index.ts`.
 *
 * The two behaviours that fixed real regressions:
 *  1. `setupLibp2pService` calls the store's `setup()`, which runs the
 *     synchronous disk read that populates the in-memory map `loadConfig()`
 *     reads. Without it a real boot ignores the persisted file entirely,
 *     silently reverting to the default — which the auto-heal then writes back
 *     over the operator's settings.
 *  2. `loadConfig()` merges the defaults *over* the loaded record, so a config
 *     written before the mesh-sync fields existed still parses and `meshSync*`
 *     stays defined. That is what stops the auto-heal wipe discarding
 *     `enabled`/`bootstrapPeers`/`topics` on the first renderer patch after an
 *     upgrade.
 *
 * The eventa handler registered for `libp2pServiceGetConfig` is the public way
 * in, so `defineInvokeHandle` is mocked to record the handlers the service
 * registers and the tests call the real ones. Nothing of the config path is
 * stubbed: the mock exists only to reach the handler.
 *
 * NOTICE: the `transports` sanitisation (`mdns` is a discovery toggle, not a
 * transport kind) lives in the renderer store — `sanitizeTransports` in
 * `packages/stage-ui/src/stores/modules/libp2p.ts` — and is asserted there.
 * This file covers only the main-process lifecycle.
 */

interface StoredConfig {
  enabled?: boolean
  transports?: string[]
  bootstrapPeers?: string[]
  topics?: string[]
  discovery?: { mdns?: boolean }
  meshSyncEnabled?: boolean
  meshSyncTargets?: string[]
  allowedTopics?: string[]
}

/** Handlers the service registered, keyed by eventa contract id. */
type Handler = (payload?: unknown) => Promise<unknown>
/** The contract ids this suite calls; the rest of the surface is unused here. */
const GET_CONFIG_ID = 'eventa:invoke:electron:libp2p:get-config'

const h = vi.hoisted(() => ({
  record: undefined as StoredConfig | undefined,
  setupCalls: 0,
  flushCalls: 0,
  updateCalls: [] as StoredConfig[],
  handlers: {} as Record<string, Handler>,
}))

vi.mock('electron', () => ({
  app: {
    getPath: (name: string) => `/tmp/airi-libp2p-config-test/${name}`,
    on: () => {},
    whenReady: () => Promise.resolve(),
  },
  safeStorage: {
    isEncryptionAvailable: () => true,
    encryptString: (value: string) => Buffer.from(value),
    decryptString: (buf: Buffer) => buf.toString('utf8'),
  },
  BrowserWindow: { getAllWindows: () => [] },
}))

vi.mock('../../../libs/electron/persistence', () => ({
  createConfig: () => ({
    // The real store's `setup()` is the synchronous disk read. Recording calls is
    // the whole point: `loadConfig()` reads the in-memory map this populates.
    setup: () => { h.setupCalls++ },
    get: (): StoredConfig | undefined => h.record,
    update: (value: StoredConfig) => { h.updateCalls.push(value) },
    flush: () => { h.flushCalls++ },
    getDiagnostics: () => undefined,
  }),
}))

// NOTICE: `@moeru/eventa` is mocked to capture the handlers `index.ts` registers
// so the tests invoke the real handler bodies. A static import would register
// them against a context the tests cannot observe.
vi.mock('@moeru/eventa', () => ({
  defineInvokeHandler: (_context: unknown, contract: unknown, handler: Handler) => {
    // `defineInvokeEventa` is mocked to return the contract's id string, so the
    // value reaching here *is* the id.
    const id = typeof contract === 'string'
      ? contract
      : 'id' in (contract as object) && typeof (contract as { id: unknown }).id === 'string'
        ? (contract as { id: string }).id
        : ''
    h.handlers[id] = handler
  },
  defineInvokeEventa: (id: string) => id,
  defineEventa: (id: string) => id,
  createContext: () => ({ context: {} }),
}))

/** A fresh service, with the handler the real code registered for a contract. */
async function freshService() {
  // NOTICE: dynamic import, because the service module must be re-evaluated per
  // test so each one gets a clean module-level store. A static import would bind
  // the first instance's state for the whole file.
  vi.resetModules()
  h.handlers = {}
  const service = await import('./index')
  // `createLibp2pService` is where the invoke handlers are registered, so it has
  // to run for `get-config` to exist. The context comes from the mocked
  // `createContext`, which returns a plain object; the cast is the boundary
  // between that mock and the real handler registration.
  await service.createLibp2pService({ context: {} as never })
  const getConfig = h.handlers[GET_CONFIG_ID]
  expect(getConfig, 'the service must register a get-config handler').toBeTypeOf('function')

  return {
    service,
    /** Call the registered `libp2pServiceGetConfig` handler. */
    getConfig: async (): Promise<ConfigWithDiscovery> => {
      const handler = h.handlers[GET_CONFIG_ID]
      expect(handler).toBeTypeOf('function')
      return await handler!() as ConfigWithDiscovery
    },
  }
}

/** The lifecycle object `setupLibp2pService` stores its stop hook on. */
function lifecycleStub() {
  return {
    appHooks: {
      onStart: (_fn: () => void | Promise<void>) => {},
      onStop: (_fn: () => void | Promise<void>) => {},
    },
  }
}

describe('libp2p config lifecycle', () => {
  it('calls the store setup() from setupLibp2pService', async () => {
    // ROOT CAUSE:
    //
    // `loadConfig()` reads the store's in-memory map, which only
    // `libp2pConfigStore.setup()`'s synchronous disk read populates. The setup
    // function used to reach `loadConfig()` without it, so a real boot read an
    // empty map and silently reverted to the default — which the auto-heal then
    // wrote back over the operator's persisted settings.
    //
    // FIXED BY: calling `libp2pConfigStore.setup()` first, before `loadConfig()`.
    h.setupCalls = 0
    h.record = undefined
    const { service } = await freshService()
    await service.setupLibp2pService({ lifecycle: lifecycleStub() })
    expect(h.setupCalls, 'setupLibp2pService must run the store setup').toBeGreaterThan(0)
  }, 30_000)

  it('merges the defaults over the loaded record rather than replacing it', async () => {
    // A config written before `meshSync*` existed: `optional()` makes it still
    // parse, so the store keeps it verbatim and the keys are simply absent.
    // Merging the default *over* that record restores the missing sections while
    // keeping everything the operator already had.
    h.setupCalls = 0
    h.record = {
      enabled: true,
      transports: ['tcp'],
      topics: ['airi/companion'],
      bootstrapPeers: ['/ip4/10.0.0.1/tcp/4001/p2p/12D3KooTest'],
      discovery: { mdns: false },
    }
    const { service, getConfig } = await freshService()
    await service.setupLibp2pService({ lifecycle: lifecycleStub() })
    const config = await getConfig()
    // The operator's values survive untouched.
    expect(config.enabled).toBe(true)
    expect(config.transports).toEqual(['tcp'])
    expect(config.topics).toEqual(['airi/companion'])
    expect(config.bootstrapPeers).toEqual(['/ip4/10.0.0.1/tcp/4001/p2p/12D3KooTest'])
    expect(config.discovery).toEqual({ mdns: false })
    // The absent sections come from the default, so they are defined.
    expect(config.meshSyncEnabled).toBe(false)
    expect(config.meshSyncTargets).toEqual([])
  }, 30_000)

  it('returns the shipped defaults when no record exists', async () => {
    h.setupCalls = 0
    h.record = undefined
    const { service, getConfig } = await freshService()
    await service.setupLibp2pService({ lifecycle: lifecycleStub() })
    const config = await getConfig()
    expect(config.enabled).toBe(false)
    expect(config.transports).toEqual(['tcp', 'websockets'])
    expect(config.discovery).toEqual({ mdns: true })
    expect(config.topics.length).toBeGreaterThan(0)
    expect(config.meshSyncEnabled).toBe(false)
  }, 30_000)
})
