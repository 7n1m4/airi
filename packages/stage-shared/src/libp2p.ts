import { defineEventa, defineInvokeEventa } from '@moeru/eventa'

// ── Types ──────────────────────────────────────────────────────────────────────

/** Transport kinds the local libp2p node can listen on. */
export type Libp2pTransportKind
  = | 'tcp'
    | 'websockets'
    | 'webrtc'
    | 'webtransport'

/** One remote AIRI instance known to the local libp2p node. */
export interface Libp2pPeerInfo {
  /** Libp2p PeerId string (e.g. `12D3Koo...`). */
  id: string
  /** Multiaddrs we know for this peer. */
  addresses: string[]
  /** Whether there is an open connection right now. */
  connected: boolean
  /** Display name advertised by the remote instance, when known. */
  name?: string
}

/** Runtime snapshot of the libp2p node in the main process. */
export interface Libp2pServiceStatus {
  running: boolean
  /** Libp2p PeerId string once the node is up. */
  peerId?: string
  /** Multiaddrs the node is listening on. */
  listenAddresses: string[]
  /** Number of currently open connections. */
  connections: number
  /** `Date.now()` of the last successful start, if ever. */
  startedAt?: number
  /** Last error message if the node failed to start or stopped on error. */
  error?: string
}

/**
 * Configuration of the local libp2p node, persisted via `createConfig`.
 * Applying it restarts the node if it is running.
 */
export interface Libp2pServiceConfig {
  /** Whether the libp2p service should start automatically on app launch. */
  enabled: boolean
  /** Transports to listen on; `tcp` covers LAN discovery over mDNS. */
  transports: Libp2pTransportKind[]
  /** Extra multiaddrs to dial at startup (LAN or relay peers). */
  bootstrapPeers: string[]
  /** GossipSub topics to subscribe to for sync traffic. */
  topics: string[]
}

/** Public identity of this node; the private key never crosses IPC. */
export interface MeshIdentityInfo {
  /** Base58btc PeerId string (e.g. `12D3Koo...`). */
  peerId: string
  /** Base64-encoded public key. */
  publicKey: string
  /** Display/node nickname. */
  name: string
  /** Epoch ms when this identity was created. */
  createdAt: number
}

/** A message delivered over a subscribed gossipsub topic. */
export interface Libp2pMessage {
  topic: string
  /** PeerId of the sender. */
  from: string
  /** Base64-encoded message body (binary-safe across IPC). */
  data: string
}

/** A single log line from the libp2p service for the Developer Console. */
export interface Libp2pEventLogEntry {
  level: 'debug' | 'info' | 'warn' | 'error'
  message: string
  timestamp: number
}

// ── Invoke Contracts (Renderer → Main, request/response) ───────────────────────

/** Start the libp2p node with the given config. */
export const libp2pServiceStart = defineInvokeEventa<Libp2pServiceStatus, Libp2pServiceConfig>(
  'eventa:invoke:electron:libp2p:start',
)

/** Stop the libp2p node and close all connections. */
export const libp2pServiceStop = defineInvokeEventa<Libp2pServiceStatus>(
  'eventa:invoke:electron:libp2p:stop',
)

/** Poll the current runtime status of the libp2p node. */
export const libp2pServiceGetStatus = defineInvokeEventa<Libp2pServiceStatus>(
  'eventa:invoke:electron:libp2p:get-status',
)

/** List peers currently known to the node (connected or recently seen). */
export const libp2pServiceListPeers = defineInvokeEventa<Libp2pPeerInfo[]>(
  'eventa:invoke:electron:libp2p:list-peers',
)

/** Load the persisted libp2p configuration. */
export const libp2pServiceGetConfig = defineInvokeEventa<Libp2pServiceConfig>(
  'eventa:invoke:electron:libp2p:get-config',
)

/** Persist (and apply, restarting the node if needed) a config patch. */
export const libp2pServiceApplyConfig = defineInvokeEventa<Libp2pServiceConfig, Partial<Libp2pServiceConfig>>(
  'eventa:invoke:electron:libp2p:apply-config',
)

/** Ping a peer, returning the round-trip latency in milliseconds. */
export const libp2pServicePing = defineInvokeEventa<{ latencyMs: number, error?: string }, { peerId: string }>(
  'eventa:invoke:electron:libp2p:ping',
)

/** Publish a base64-encoded message to a gossipsub topic. */
export const libp2pServicePublish = defineInvokeEventa<void, { topic: string, data: string }>(
  'eventa:invoke:electron:libp2p:publish',
)

/** Load the public identity of this node. */
export const electronMeshIdentityGet = defineInvokeEventa<MeshIdentityInfo>(
  'eventa:invoke:electron:libp2p:identity:get',
)

/** Regenerate the node keypair (destructive; UI should confirm). */
export const electronMeshIdentityGenerate = defineInvokeEventa<MeshIdentityInfo>(
  'eventa:invoke:electron:libp2p:identity:generate',
)

/** Rename the node identity. */
export const electronMeshIdentitySetName = defineInvokeEventa<MeshIdentityInfo, { name: string }>(
  'eventa:invoke:electron:libp2p:identity:set-name',
)

// ── Event Contracts (Main → Renderer, push-based) ──────────────────────────────

/** Emitted when the node starts, stops, or changes listen addresses. */
export const libp2pServiceStatusChanged = defineEventa<Libp2pServiceStatus>(
  'eventa:event:electron:libp2p:status-changed',
)

/** Emitted when a peer establishes a connection with us. */
export const libp2pPeerJoined = defineEventa<Libp2pPeerInfo>(
  'eventa:event:electron:libp2p:peer-joined',
)

/** Emitted when a peer connection closes. */
export const libp2pPeerLeft = defineEventa<{ id: string }>(
  'eventa:event:electron:libp2p:peer-left',
)

/** Emitted when a peer is discovered but not necessarily connected yet. */
export const libp2pPeerDiscovered = defineEventa<Libp2pPeerInfo>(
  'eventa:event:electron:libp2p:peer-discovered',
)

/** Emitted when a message arrives on any subscribed topic. */
export const libp2pMessageReceived = defineEventa<Libp2pMessage>(
  'eventa:event:electron:libp2p:message-received',
)

/** Emitted when the node identity is generated or renamed. */
export const electronMeshIdentityChanged = defineEventa<MeshIdentityInfo>(
  'eventa:event:electron:libp2p:identity:changed',
)

/** Raw event log entries for the Developer Console. */
export const libp2pServiceEventLog = defineEventa<Libp2pEventLogEntry>(
  'eventa:event:electron:libp2p:event-log',
)
