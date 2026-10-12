import type { GossipsubEvents } from '@chainsafe/libp2p-gossipsub'
import type { Identify } from '@libp2p/identify'
import type { PeerId, PeerInfo, PubSub } from '@libp2p/interface'
import type { KadDHT } from '@libp2p/kad-dht'
import type { Ping } from '@libp2p/ping'
import type { createContext } from '@moeru/eventa/adapters/electron/main'
import type { Multiaddr } from '@multiformats/multiaddr'
import type { Lifecycle } from 'injeca'
import type { InferOutput } from 'valibot'

import { Buffer } from 'node:buffer'

import { gossipsub } from '@chainsafe/libp2p-gossipsub'
import { noise } from '@chainsafe/libp2p-noise'
import { yamux } from '@chainsafe/libp2p-yamux'
import { useLogg } from '@guiiai/logg'
import { autoNAT } from '@libp2p/autonat'
import { privateKeyFromRaw } from '@libp2p/crypto/keys'
import { identify } from '@libp2p/identify'
import { kadDHT } from '@libp2p/kad-dht'
import { mdns } from '@libp2p/mdns'
import { mplex } from '@libp2p/mplex'
import { peerIdFromString } from '@libp2p/peer-id'
import { ping } from '@libp2p/ping'
import { tcp } from '@libp2p/tcp'
import { webRTC } from '@libp2p/webrtc'
import { webSockets } from '@libp2p/websockets'
import { webTransport } from '@libp2p/webtransport'
import { defineInvokeHandler } from '@moeru/eventa'
import {
  electronMeshIdentityGenerate,
  electronMeshIdentityGet,
  electronMeshIdentitySetName,
  libp2pServiceAcceptPairing,
  libp2pServiceApplyConfig,
  libp2pServiceCreatePairing,
  libp2pServiceGetConfig,
  libp2pServiceGetStatus,
  libp2pServiceListPairedDevices,
  libp2pServiceListPeers,
  libp2pServicePing,
  libp2pServicePublish,
  libp2pServiceRemovePairedDevice,
  libp2pServiceStart,
  libp2pServiceStop,
  libp2pServiceUpdatePairedDeviceAlias,
} from '@proj-airi/stage-shared/libp2p'
import { BrowserWindow } from 'electron'
import { createLibp2p } from 'libp2p'
import { array, boolean, object, picklist, string } from 'valibot'

import { createConfig } from '../../../libs/electron/persistence'
import { getOrCreateIdentity, getPrivateKey, hasIdentity, regenerateIdentity, setIdentityName } from './identity'
import {
  acceptMagicCode,
  acceptPairingInvitation,
  createPairingInvitation,
  listPairedDevices,
  parsePairingInvitation,
  publishPairingRequest,
  recordPairingRequest,
  rememberDiscoveredInvite,
  removePairedDevice,
  updatePairedDeviceAlias,
} from './pairing'

// Event channel names for main → renderer push events
const LIBP2P_STATUS_CHANGED_CHANNEL = 'eventa:event:electron:libp2p:status-changed'
const LIBP2P_PEER_JOINED_CHANNEL = 'eventa:event:electron:libp2p:peer-joined'
const LIBP2P_PEER_LEFT_CHANNEL = 'eventa:event:electron:libp2p:peer-left'
const LIBP2P_PEER_DISCOVERED_CHANNEL = 'eventa:event:electron:libp2p:peer-discovered'
const LIBP2P_MESSAGE_RECEIVED_CHANNEL = 'eventa:event:electron:libp2p:message-received'
const LIBP2P_IDENTITY_CHANGED_CHANNEL = 'eventa:event:electron:libp2p:identity:changed'
const LIBP2P_EVENT_LOG_CHANNEL = 'eventa:event:electron:libp2p:event-log'
const LIBP2P_PAIRED_DEVICES_CHANGED_CHANNEL = 'eventa:event:electron:libp2p:paired-devices-changed'

const log = useLogg('libp2p-service').useGlobalConfig()

// ── Pairing Topics ────────────────────────────────────────────────────────────
// `airi/pairing/invites` carries the inviter's invitation minus its token, so a
// peer can find it by magic code without out-of-band address exchange, and
// `airi/pairing/requests` carries the token the accepter was given out of band.
// The pairing is only completed by the inviter, which is the only node that
// issued the token, so the token the invitation authorises is never published
// with it.
const PAIRING_INVITES_TOPIC = 'airi/pairing/invites'
const PAIRING_REQUESTS_TOPIC = 'airi/pairing/requests'
const PAIRING_TOPICS: string[] = [PAIRING_INVITES_TOPIC, PAIRING_REQUESTS_TOPIC]

// ── Types ──────────────────────────────────────────────────────────────────────

const Libp2pServiceConfigSchema = object({
  enabled: boolean(),
  transports: array(picklist(['tcp', 'websockets', 'webrtc', 'webtransport'])),
  bootstrapPeers: array(string()),
  topics: array(string()),
})

type Libp2pServiceConfig = InferOutput<typeof Libp2pServiceConfigSchema>

// ── Pairing Node Interfaces ───────────────────────────────────────────────────
// `pairing.ts` never touches the libp2p node itself; it gets only the three
// narrow shapes below, and `createLibp2pNode` returns one more wrapper (typed
// `Libp2pNode`) built on the same underlying node for the invoke handlers.
interface Libp2pNodePublisher {
  publish: (topic: string, data: Uint8Array) => Promise<void>
}

interface Libp2pNodeDialer {
  dialMultiaddrs: (multiaddrs: Multiaddr[]) => Promise<void>
}

interface Libp2pNodeAddresses {
  peerStore: { get: (peerId: PeerId) => Promise<{ addresses: Array<{ multiaddr: Multiaddr }> }> }
  getConnections: (peerId: PeerId) => Array<{ remoteAddr: Multiaddr }>
}

interface Libp2pNode {
  start: () => Promise<void>
  stop: () => Promise<void>
  getMultiaddrs: () => string[]
  getPeers: () => Array<{ id: string, addresses: string[], connected: boolean }>
  publish: (topic: string, data: Uint8Array) => Promise<void>
  /**
   * Dial a peer by its PeerId string, connecting it if it is not already
   * connected. `node.dial` reuses an existing non-limited connection, so this is
   * idempotent. Throws with an unhelpful error when the peer is unknown and has
   * no address in the peer store — prefer `hasKnownAddresses` first when the
   * caller needs a clear diagnostic for that case.
   */
  dial: (peerId: string) => Promise<void>
  /**
   * Dial a peer by multiaddr list. Unlike the `PeerId` form this reaches a peer
   * that is not yet in the peer store, which is exactly what a pairing invite
   * needs: the accepter has never seen the inviter before.
   */
  dialMultiaddrs: (multiaddrs: Multiaddr[]) => Promise<void>
  /** Dialable addresses known for a peer: peer store first, live connections as a fallback. */
  getPeerAddresses: (peerId: PeerId) => Promise<string[]>
  /** The PeerId of this node. */
  getPeerId: () => string
  /** True when the peer store holds at least one dialable address for the peer. */
  hasKnownAddresses: (peerId: string) => Promise<boolean>
  /** Dial the peer if needed, then measure the ping round-trip time in ms. */
  ping: (peerId: string) => Promise<number>
}

// ── Config Persistence ─────────────────────────────────────────────────────────

const Libp2pServiceConfigDefault: Libp2pServiceConfig = {
  enabled: false,
  transports: ['tcp', 'websockets'],
  bootstrapPeers: [],
  topics: ['airi/presence', 'airi/memory', 'airi/vault', 'airi/companion'],
}

const libp2pConfigStore = createConfig(
  'libp2p',
  'libp2p-config.json',
  Libp2pServiceConfigSchema,
  {
    default: Libp2pServiceConfigDefault,
  },
)

async function loadConfig(): Promise<Libp2pServiceConfig> {
  return libp2pConfigStore.get() ?? Libp2pServiceConfigDefault
}

// ── libp2p Node Management ────────────────────────────────────────────────────

let libp2pNode: Libp2pNode | null = null
let currentPeerId: PeerId | null = null
let currentConfig: Libp2pServiceConfig | null = null

function buildStatus(): {
  running: boolean
  peerId?: string
  listenAddresses: string[]
  connections: number
  startedAt?: number
  error?: string
} {
  if (!libp2pNode || !currentPeerId) {
    return {
      running: false,
      listenAddresses: [],
      connections: 0,
      error: currentConfig?.enabled ? 'Node not initialized' : undefined,
    }
  }

  return {
    running: true,
    peerId: currentPeerId.toString(),
    listenAddresses: libp2pNode.getMultiaddrs(),
    connections: libp2pNode.getPeers().filter(p => p.connected).length,
  }
}

function broadcastStatus() {
  const status = buildStatus()
  for (const win of BrowserWindow.getAllWindows()) {
    try {
      if (!win.isDestroyed() && !win.webContents.isDestroyed()) {
        win.webContents.send(LIBP2P_STATUS_CHANGED_CHANNEL, status)
      }
    }
    catch {
      // Ignore
    }
  }
}

function broadcastEventLog(level: 'debug' | 'info' | 'warn' | 'error', message: string) {
  const entry = { level, message, timestamp: Date.now() }
  for (const win of BrowserWindow.getAllWindows()) {
    try {
      if (!win.isDestroyed() && !win.webContents.isDestroyed()) {
        win.webContents.send(LIBP2P_EVENT_LOG_CHANNEL, entry)
      }
    }
    catch {
      // Ignore
    }
  }
}

/** Push the paired-device list to the renderer after any pairing mutation. */
async function broadcastPairedDevices() {
  const devices = await listPairedDevices()
  for (const win of BrowserWindow.getAllWindows()) {
    try {
      if (!win.isDestroyed() && !win.webContents.isDestroyed()) {
        win.webContents.send(LIBP2P_PAIRED_DEVICES_CHANGED_CHANNEL, devices)
      }
    }
    catch {
      // Ignore
    }
  }
}

/**
 * Bind a pairing publisher to the live node so `pairing.ts` can stay free of
 * any node reference: the invitation has to reach the mesh from the same node
 * that issued it, which only `index.ts` knows about.
 */
function publisherFor(node: Libp2pNodePublisher) {
  return {
    async publish(topic: string, data: Uint8Array) {
      await node.publish(topic, data)
    },
  }
}

/** Bind the dialer pairing needs: an invite carries multiaddrs, not a PeerId. */
function dialerFor(node: Libp2pNodeDialer) {
  return {
    async dial(multiaddrs: Multiaddr[]) {
      await node.dialMultiaddrs(multiaddrs)
    },
  }
}

/**
 * Resolve the dialable addresses for a peer: the peer store holds the clean
 * addresses `identify` collected on connect, and the open connections are the
 * fallback for a peer that connected but whose identify has not landed yet.
 */
async function getPeerAddresses(node: Libp2pNodeAddresses, peerId: PeerId): Promise<string[]> {
  try {
    const peer = await node.peerStore.get(peerId)
    if (peer.addresses.length > 0) {
      return peer.addresses.map(address => address.multiaddr.toString())
    }
  }
  catch {
    // A peer that was never merged into the store rejects with `NotFoundError`;
    // the connection fallback below still applies.
  }

  return node.getConnections(peerId).map(conn => conn.remoteAddr.toString())
}

/**
 * Inviter side of the pairing handshake.
 *
 * A `pairing-request` arrives on the wire carrying only a token, so the sender
 * is resolved from the mesh: `propagationSource` is the peer the message came
 * from, and its addresses come from the peer store (populated by `identify` on
 * connect) with the open connections as a fallback. The token is what authorises
 * the pairing — it is the invitation this node issued and not spent — so an
 * unknown or consumed token records nothing.
 *
 * Exported for the throwaway wire-path harness in `/tmp/pairing-main/`, which
 * drives the inviter through the real handler instead of a local reimplementation.
 */
export async function handlePairingRequest(node: Libp2pNodeAddresses, payload: unknown, sender: string) {
  if (typeof payload !== 'object' || payload === null) {
    return
  }
  const { token } = payload as { token?: unknown }
  if (typeof token !== 'string') {
    return
  }

  const senderPeerId = peerIdFromString(sender)
  const multiaddrs = await getPeerAddresses(node, senderPeerId)

  const device = await recordPairingRequest(token, sender, multiaddrs)
  if (!device) {
    return
  }

  await broadcastPairedDevices()
  broadcastEventLog('info', `Paired with ${sender} (${device.alias})`)
}

async function createLibp2pNode(config: Libp2pServiceConfig, privateKey: Uint8Array): Promise<Libp2pNode> {
  // NOTICE: `@libp2p/crypto` and `@libp2p/peer-id` both resolve their key types
  // against `@libp2p/interface@2.11.0` + `multiformats@13`, and
  // `peerIdFromPrivateKey` is itself just `peerIdFromPublicKey`, so deriving the
  // PeerId from the public key's base58btc multihash string produces the
  // identical PeerId.
  const pk = privateKeyFromRaw(privateKey)
  const peerId = peerIdFromString(pk.publicKey.toString())
  currentPeerId = peerId

  const transports = []
  if (config.transports.includes('tcp')) {
    transports.push(tcp())
  }
  if (config.transports.includes('websockets')) {
    transports.push(webSockets())
  }
  if (config.transports.includes('webrtc')) {
    transports.push(webRTC())
  }
  if (config.transports.includes('webtransport')) {
    transports.push(webTransport())
  }

  // NOTICE: mDNS is not pushed onto `transports` - `mdns()` returns a
  // `PeerDiscovery`, not a `Transport`, and LAN discovery is already wired via
  // `peerDiscovery` below.

  // NOTICE: every service used in `services` below must be declared in this
  // generic - it drives both `ServiceFactoryMap` (so extra keys error) and
  // `node.services`, so an omitted key is an excess-property error. The KadDHT
  // service declares `ping: Ping` in its own components, hence `ping` here;
  // `@libp2p/autonat` does not export its service type, so it stays `unknown`.
  const node = await createLibp2p<{
    dht: KadDHT
    pubsub: PubSub<GossipsubEvents>
    identify: Identify
    autoNAT: unknown
    ping: Ping
  }>({
    privateKey: pk,
    addresses: {
      listen: [
        '/ip4/0.0.0.0/tcp/0',
        '/ip4/0.0.0.0/tcp/0/ws',
      ],
    },
    transports,
    connectionEncrypters: [noise()],
    streamMuxers: [yamux(), mplex()],
    peerDiscovery: [
      mdns({ interval: 30000 }),
    ],
    services: {
      dht: kadDHT({ clientMode: true }),
      pubsub: gossipsub({
        allowPublishToZeroTopicPeers: true,
        emitSelf: true,
      }),
      identify: identify(),
      autoNAT: autoNAT(),
      ping: ping(),
    },
    connectionManager: {
      maxConnections: 100,
    },
  })

  // Subscribe to topics
  for (const topic of [...config.topics, ...PAIRING_TOPICS]) {
    node.services.pubsub.subscribe(topic)
  }

  // Set up message handlers.
  // NOTICE: `subscribe()` returns `void` in the libp2p v2 API, so messages are
  // delivered as `message` events on the router instead of an async iterable.
  // Since `emitSelf` is enabled, our own published messages are echoed back, so
  // the `from` guard below is what prevents an echo loop.
  node.services.pubsub.addEventListener('message', (evt: CustomEvent) => {
    const msg = evt.detail
    if (msg.from !== peerId.toString()) {
      // Broadcast to renderer
      const message = {
        topic: msg.topic,
        from: msg.from,
        data: Buffer.from(msg.data).toString('base64'),
      }
      for (const win of BrowserWindow.getAllWindows()) {
        try {
          if (!win.isDestroyed() && !win.webContents.isDestroyed()) {
            win.webContents.send(LIBP2P_MESSAGE_RECEIVED_CHANNEL, message)
          }
        }
        catch {
          // Ignore
        }
      }

      // Also emit peer discovered event
      for (const win of BrowserWindow.getAllWindows()) {
        try {
          if (!win.isDestroyed() && !win.webContents.isDestroyed()) {
            win.webContents.send(LIBP2P_PEER_DISCOVERED_CHANNEL, {
              id: msg.from,
              addresses: [],
              connected: false,
            })
          }
        }
        catch {
          // Ignore
        }
      }
    }
  })

  // Pairing wire protocol.
  // NOTICE: pairing has its own listener rather than reusing the `message` one
  // because the sender of a pairing request must be resolved from the mesh, not
  // from the message payload: the accepter only sends a token, and the inviter
  // needs the sender's PeerId to record the pair. `gossipsub:message` carries
  // `propagationSource` — the PeerId the message actually arrived from — while
  // `message` (`Message`) only carries `from`, the message's author, which on
  // an unsigned publish path is the same PeerId but not the connection we can
  // read addresses off. This listener also runs for our own publications
  // (`emitSelf`), so every pairing handler is written to be a no-op on self.
  node.services.pubsub.addEventListener('gossipsub:message', (evt: CustomEvent) => {
    const { propagationSource, msg } = evt.detail as { propagationSource?: PeerId, msg?: { topic?: string, data?: Uint8Array } }
    const topic = msg?.topic
    if (topic !== PAIRING_INVITES_TOPIC && topic !== PAIRING_REQUESTS_TOPIC) {
      return
    }
    if (!propagationSource) {
      return
    }

    const sender = propagationSource.toString()
    if (sender === peerId.toString()) {
      return
    }

    try {
      const payload = Buffer.from(msg?.data ?? []).toString('utf-8')
      if (topic === PAIRING_INVITES_TOPIC) {
        rememberDiscoveredInvite(JSON.parse(payload))
      }
      else {
        void handlePairingRequest(node, JSON.parse(payload), sender).catch(() => {
          // A malformed or already-consumed request is not fatal: the inviter
          // logs nothing and simply does not record the peer.
        })
      }
    }
    catch {
      // Ignore malformed pairing traffic.
    }
  })

  // libp2p v2 removed auto-dial of discovered peers: the base node only merges
  // the discovered multiaddrs into the peer store (`#onDiscoveryPeer` in
  // `libp2p/dist/src/libp2p.js`) and never dials them, and the `autoDial` option
  // no longer exists. Without the dial below, two AIRI instances on the same LAN
  // see each other via mDNS but never form a connection, so the GossipSub mesh
  // never forms, `publish()` only self-echoes via `emitSelf` and ping fails.
  node.addEventListener('peer:discovery', (evt: CustomEvent<PeerInfo>) => {
    const peer = evt.detail
    if (peer.multiaddrs.length > 0) {
      void node.dial(peer.multiaddrs).catch(() => {
        // The peer may be going offline, or the discovered addresses may be
        // unreachable from this interface; discovery retries on the next mDNS
        // interval, so a swallowed dial failure is expected and harmless.
      })
    }
  })

  // Track peer connections
  node.addEventListener('peer:connect', (evt: CustomEvent) => {
    const peer = evt.detail
    const peerInfo = {
      id: peer.toString(),
      addresses: peer.multiaddrs.map((ma: Multiaddr) => ma.toString()),
      connected: true,
    }
    for (const win of BrowserWindow.getAllWindows()) {
      try {
        if (!win.isDestroyed() && !win.webContents.isDestroyed()) {
          win.webContents.send(LIBP2P_PEER_JOINED_CHANNEL, peerInfo)
        }
      }
      catch {
        // Ignore
      }
    }
  })

  node.addEventListener('peer:disconnect', (evt: CustomEvent) => {
    const peer = evt.detail
    for (const win of BrowserWindow.getAllWindows()) {
      try {
        if (!win.isDestroyed() && !win.webContents.isDestroyed()) {
          win.webContents.send(LIBP2P_PEER_LEFT_CHANNEL, { id: peer.toString() })
        }
      }
      catch {
        // Ignore
      }
    }
  })

  return {
    async start() {
      await node.start()
      broadcastStatus()
      broadcastEventLog('info', `libp2p node started: ${peerId.toString()}`)
    },
    async stop() {
      await node.stop()
      broadcastStatus()
      broadcastEventLog('info', 'libp2p node stopped')
    },
    getMultiaddrs() {
      return node.getMultiaddrs().map((ma: Multiaddr) => ma.toString())
    },
    getPeers() {
      const peers = node.getPeers()
      return peers.map((p: PeerId) => {
        // NOTICE: the libp2p v2 node API does not expose per-peer multiaddrs -
        // `PeerId` carries no addresses and `node.getPeerAddresses()` does not
        // exist, while `peerStore.get()` is async and cannot be awaited here.
        // Connectivity is derived from the open connections instead.
        const connected = node.getConnections(p).length > 0
        return {
          id: p.toString(),
          addresses: [],
          connected,
        }
      })
    },
    async publish(topic: string, data: Uint8Array) {
      await node.services.pubsub.publish(topic, data)
    },
    async dial(peerIdStr: string) {
      const targetPeerId = peerIdFromString(peerIdStr)
      await node.dial(targetPeerId)
    },
    async dialMultiaddrs(multiaddrs: Multiaddr[]) {
      await node.dial(multiaddrs)
    },
    async getPeerAddresses(peerId: PeerId) {
      return getPeerAddresses(node, peerId)
    },
    getPeerId() {
      return peerId.toString()
    },
    async hasKnownAddresses(peerIdStr: string) {
      const targetPeerId = peerIdFromString(peerIdStr)
      try {
        const peer = await node.peerStore.get(targetPeerId)
        return peer.addresses.length > 0
      }
      catch (err) {
        // A peer that was never merged into the store (never discovered or
        // dialled) rejects with `NotFoundError`, which just means "unknown".
        if (err instanceof Error && err.name === 'NotFoundError') {
          return false
        }
        throw err
      }
    },
    async ping(peerIdStr: string) {
      const targetPeerId = peerIdFromString(peerIdStr)
      return node.services.ping.ping(targetPeerId)
    },
  }
}

// ── Lifecycle Integration ──────────────────────────────────────────────────────

export async function setupLibp2pService(params: { lifecycle: Lifecycle }) {
  const config = await loadConfig()
  currentConfig = config

  if (config.enabled) {
    const privateKey = await getPrivateKey()
    if (privateKey) {
      try {
        libp2pNode = await createLibp2pNode(config, privateKey)
        await libp2pNode.start()
      }
      catch (err) {
        log.withError(err).error('Failed to start libp2p node')
        broadcastEventLog('error', `Failed to start libp2p: ${err}`)
      }
    }
    else {
      broadcastEventLog('warn', 'libp2p enabled but no identity found')
    }
  }

  params.lifecycle.appHooks.onStop(async () => {
    if (libp2pNode) {
      libp2pNode.stop().catch((err: unknown) => log.withError(err).error('Error stopping libp2p'))
    }
  })
}

// ── Eventa Service ─────────────────────────────────────────────────────────────

export async function createLibp2pService(params: { context: ReturnType<typeof createContext>['context'] }) {
  const context = params.context

  // Start
  defineInvokeHandler(context, libp2pServiceStart, async (cfg: Partial<Libp2pServiceConfig>) => {
    const config = await loadConfig()
    const newConfig = { ...config, ...cfg }

    if (libp2pNode) {
      await libp2pNode.stop()
      libp2pNode = null
    }

    currentConfig = newConfig
    await libp2pConfigStore.update(newConfig)

    if (newConfig.enabled) {
      const privateKey = await getPrivateKey()
      if (privateKey) {
        try {
          libp2pNode = await createLibp2pNode(newConfig, privateKey)
          await libp2pNode.start()
        }
        catch (err) {
          broadcastEventLog('error', `Failed to start libp2p: ${err}`)
          throw err
        }
      }
      else {
        broadcastEventLog('warn', 'libp2p enabled but no identity found')
      }
    }

    return buildStatus()
  })

  // Stop
  defineInvokeHandler(context, libp2pServiceStop, async () => {
    if (libp2pNode) {
      await libp2pNode.stop()
      libp2pNode = null
      currentPeerId = null
    }
    return buildStatus()
  })

  // Get Status
  defineInvokeHandler(context, libp2pServiceGetStatus, async () => {
    return buildStatus()
  })

  // List Peers
  defineInvokeHandler(context, libp2pServiceListPeers, async () => {
    if (!libp2pNode) {
      return []
    }
    return libp2pNode.getPeers()
  })

  // Get Config
  defineInvokeHandler(context, libp2pServiceGetConfig, async () => {
    return await loadConfig()
  })

  // Apply Config
  defineInvokeHandler(context, libp2pServiceApplyConfig, async (patch: Partial<Libp2pServiceConfig>) => {
    const config = await loadConfig()
    const newConfig = { ...config, ...patch }
    currentConfig = newConfig
    await libp2pConfigStore.update(newConfig)

    if (libp2pNode) {
      await libp2pNode.stop()
      libp2pNode = null
    }

    if (newConfig.enabled) {
      const privateKey = await getPrivateKey()
      if (privateKey) {
        try {
          libp2pNode = await createLibp2pNode(newConfig, privateKey)
          await libp2pNode.start()
        }
        catch (err) {
          broadcastEventLog('error', `Failed to start libp2p: ${err}`)
          throw err
        }
      }
    }

    return newConfig
  })

  // Ping
  defineInvokeHandler(context, libp2pServicePing, async ({ peerId }) => {
    if (!libp2pNode) {
      throw new Error('libp2p node not running')
    }
    try {
      // A peer that was discovered by mDNS has its multiaddrs merged into the
      // peer store but no connection, so an explicit dial is required (libp2p v2
      // removed the old auto-dial). Dialing is idempotent: the connection
      // manager returns the existing non-limited connection when one is open.
      if (!(await libp2pNode.hasKnownAddresses(peerId))) {
        return {
          latencyMs: 0,
          error: `peer "${peerId}" is unknown — no address is known for it, so it cannot be dialled; it must first be discovered via mDNS, identify or a bootstrap peer`,
        }
      }

      await libp2pNode.dial(peerId)
      return { latencyMs: await libp2pNode.ping(peerId) }
    }
    catch (err) {
      // `NoValidAddressesError` (libp2p/dist/src/errors.js) carries only `name`,
      // no `code`, and is not re-exported from the package root (the exports map
      // holds only `.`, `./user-agent` and `./version`), so it is matched by
      // name. The pre-check above catches the common case first, which also
      // avoids the ~10s peer-routing lookup timeout that libp2p otherwise spends
      // before failing on a peer whose address is not known.
      if (err instanceof Error && err.name === 'NoValidAddressesError') {
        return {
          latencyMs: 0,
          error: `peer "${peerId}" is unknown — no address is known for it, so it cannot be dialled; it must first be discovered via mDNS, identify or a bootstrap peer`,
        }
      }

      return { latencyMs: 0, error: String(err) }
    }
  })

  // Publish
  defineInvokeHandler(context, libp2pServicePublish, async ({ topic, data }) => {
    if (!libp2pNode) {
      throw new Error('libp2p node not running')
    }
    const buf = Buffer.from(data, 'base64')
    await libp2pNode.publish(topic, buf)
  })

  // Identity Get
  defineInvokeHandler(context, electronMeshIdentityGet, async () => {
    const identity = await hasIdentity() ? await getOrCreateIdentity() : null
    return identity
  })

  // Identity Generate
  defineInvokeHandler(context, electronMeshIdentityGenerate, async () => {
    const identity = await regenerateIdentity()
    for (const win of BrowserWindow.getAllWindows()) {
      try {
        if (!win.isDestroyed() && !win.webContents.isDestroyed()) {
          win.webContents.send(LIBP2P_IDENTITY_CHANGED_CHANNEL, identity)
        }
      }
      catch {
        // Ignore
      }
    }
    return identity
  })

  // Identity Set Name
  defineInvokeHandler(context, electronMeshIdentitySetName, async ({ name }) => {
    const identity = await setIdentityName(name)
    for (const win of BrowserWindow.getAllWindows()) {
      try {
        if (!win.isDestroyed() && !win.webContents.isDestroyed()) {
          win.webContents.send(LIBP2P_IDENTITY_CHANGED_CHANNEL, identity)
        }
      }
      catch {
        // Ignore
      }
    }
    return identity
  })

  // Pairing: create
  defineInvokeHandler(context, libp2pServiceCreatePairing, async ({ ttlMinutes, name }: { ttlMinutes?: number, name?: string } = {}) => {
    if (!libp2pNode) {
      throw new Error('libp2p node not running')
    }

    // The invite's addresses have to be ones a peer can actually dial, so the
    // unspecified host (`0.0.0.0`) the listener bound is dropped in favour of
    // the concrete loopback/LAN addresses that carry the `/p2p/<peerId>` suffix.
    const multiaddrs = libp2pNode.getMultiaddrs().filter(addr => !addr.startsWith('/ip4/0.0.0.0/'))
    const peerId = libp2pNode.getPeerId()

    const { qrCode, magicCode, invitation } = await createPairingInvitation(multiaddrs, peerId, name || 'AIRI Node', ttlMinutes, publisherFor(libp2pNode))

    broadcastEventLog('info', `Pairing invitation created, magic code ${magicCode}`)

    return { qrCode, magicCode, expiresAt: new Date(invitation.expiresAt).toISOString() }
  })

  // Pairing: accept
  defineInvokeHandler(context, libp2pServiceAcceptPairing, async ({ input, alias }: { input: string, alias?: string }) => {
    if (!libp2pNode) {
      throw new Error('libp2p node not running')
    }

    const localPeerId = libp2pNode.getPeerId()
    const dialer = dialerFor(libp2pNode)

    // A QR payload carries the invitation inline; anything else is a bare magic
    // code, which only names an invitation and has to be resolved from the wire
    // (or from an invite this node itself issued).
    const parsed = parsePairingInvitation(input)
    const result = parsed
      ? await acceptPairingInvitation(parsed, localPeerId, alias, dialer)
      : await acceptMagicCode(input.trim(), localPeerId, alias, dialer)

    if ('error' in result) {
      return result
    }

    // The accepter only knows the token it was given; the inviter is the one
    // that issued it, so the request is what turns the dial into a pair.
    await publishPairingRequest(result.token, publisherFor(libp2pNode))
    await broadcastPairedDevices()

    return { peerId: result.peerId, alias: result.alias }
  })

  // Pairing: list
  defineInvokeHandler(context, libp2pServiceListPairedDevices, async () => listPairedDevices())

  // Pairing: remove
  defineInvokeHandler(context, libp2pServiceRemovePairedDevice, async (peerId: string) => {
    await removePairedDevice(peerId)
    await broadcastPairedDevices()
    return true
  })

  // Pairing: rename
  defineInvokeHandler(context, libp2pServiceUpdatePairedDeviceAlias, async ([peerId, alias]: [string, string]) => {
    await updatePairedDeviceAlias(peerId, alias)
    await broadcastPairedDevices()
    return true
  })
}
