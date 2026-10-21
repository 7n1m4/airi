/**
 * Pluggable transport boundary (RFC: dasilva333/airi#28, re-homed in
 * anlmalabs/airi#1 comment 3).
 *
 * This is the seam that lets this fork (libp2p local mesh) and upstream
 * (server-channel cloud relay) share the contract + cognition layer while each
 * keeps its own transport implementation. Identity, pairing, discovery and trust
 * stay implementation-specific and are reached through the concrete adapter or
 * the underlying service — they are deliberately NOT part of this contract,
 * because upstream has no libp2p identity model to abstract behind them.
 *
 * Sovereignty invariant (RFC #3): the contract lives types-only here in
 * `packages/stage-shared`; adapters live in packages AnimaOS does not depend on;
 * plus a runtime gate (see `transport-registry.ts`) that refuses to initialize
 * any adapter with `requiresExternalRelay: true` in a sovereign build. This is
 * what keeps Phase 1's Cloudflare purge from being undone by the seam itself.
 *
 * Naming: kept as `TransportAdapter` (matches the RFC; searchable; clear).
 * The libp2p `Transport` (`@libp2p/interface` — dial/createListener/listenFilter)
 * is a different concept and is never re-exported from `@proj-airi/stage-shared`,
 * so the two cannot be confused at an import site. Document the distinction
 * whenever both appear in the same file.
 */

// ── Capabilities ──────────────────────────────────────────────────────────────

/**
 * Static capability flags advertised by an adapter. Consumers gate features on
 * these rather than on `id` string matching, so a new adapter automatically
 * opts into the features it supports.
 */
export interface TransportCapabilities {
  /** True when the transport never leaves the local machine/network. */
  readonly isLocalOnly: boolean
  /** True when the transport supports more than two parties in one session. */
  readonly supportsMultiParty: boolean
  /** True when the transport supports gossip-style pub/sub fan-out. */
  readonly supportsMeshGossip: boolean
  /** True when the transport needs an external relay to cross networks. */
  readonly requiresExternalRelay: boolean
}

// ── TransportAdapter ──────────────────────────────────────────────────────────

/**
 * Pluggable transport boundary. An adapter wraps one concrete transport
 * (libp2p mesh, server-channel relay, direct WebSocket, …) and exposes the
 * shared pub/sub + lifecycle surface. Payloads are `Uint8Array` so they are
 * binary-safe across IPC and network boundaries; adapters that speak strings
 * (e.g. base64 over eventa) convert at the seam.
 */
export interface TransportAdapter {
  /** Stable adapter identifier, e.g. `'libp2p-mesh'`, `'server-channel'`. */
  readonly id: string
  /** Static capability flags for this adapter. */
  readonly capabilities: TransportCapabilities

  /** Bring the transport up (open listeners, dial bootstrap peers, …). */
  initialize: () => Promise<void>
  /** Tear the transport down and release all resources. */
  dispose: () => Promise<void>

  /** Publish a binary payload to a topic. */
  publish: (topic: string, payload: Uint8Array) => Promise<void>
  /** Subscribe to a topic; returns an unsubscribe function. */
  subscribe: (topic: string, handler: (payload: Uint8Array) => void) => () => void
}
