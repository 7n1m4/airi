import type {
  TransportAdapter,
  TransportCapabilities,
} from '@proj-airi/stage-shared/transport-adapter'

/**
 * Dependencies the libp2p transport adapter delegates to. Injecting them keeps
 * the adapter pure and unit-testable without spinning up a real libp2p node;
 * production wiring supplies the live node's functions (see `index.ts`).
 */
/**
 * Dependencies the libp2p transport adapter delegates to. Each member MUST be
 * a closure or a bound method: the adapter stores the function references and
 * invokes them unbound, so passing an unbound method (e.g.
 * `deps: { initialize: node.start }`) loses `this` and throws in strict mode.
 * Wrap such calls in an arrow function when wiring production code.
 */
export interface Libp2pTransportAdapterDeps {
  initialize: () => Promise<void>
  dispose: () => Promise<void>
  publish: (topic: string, data: Uint8Array) => Promise<void>
  subscribe: (topic: string, handler: (data: Uint8Array) => void) => () => void
}

export interface Libp2pTransportAdapterOptions {
  /** Override the default capability flags (defaults: local-only mesh). */
  capabilities?: Partial<TransportCapabilities>
  deps: Libp2pTransportAdapterDeps
}

const DEFAULT_CAPABILITIES: TransportCapabilities = {
  isLocalOnly: true,
  supportsMultiParty: true,
  supportsMeshGossip: true,
  requiresExternalRelay: false,
}

/**
 * Wrap a live libp2p node behind the shared {@link TransportAdapter} contract.
 *
 * The adapter is the only place where libp2p-specific types cross the seam: it
 * converts the contract's `Uint8Array` payloads to/from whatever the node
 * speaks, and hides node lifecycle behind `initialize`/`dispose`. Consumers
 * depend on `TransportAdapter` and never on libp2p types.
 */
export function createLibp2pTransportAdapter(
  options: Libp2pTransportAdapterOptions,
): TransportAdapter {
  const capabilities: TransportCapabilities = Object.freeze({
    ...DEFAULT_CAPABILITIES,
    ...options.capabilities,
  })
  const { initialize, dispose, publish, subscribe } = options.deps

  return {
    id: 'libp2p-mesh',
    capabilities,
    initialize,
    dispose,
    publish,
    subscribe,
  }
}
