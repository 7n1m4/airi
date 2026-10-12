import type { Lifecycle } from 'injeca'
import type { Multiaddr } from '@multiformats/multiaddr'
import type { PeerId, PubSub } from '@libp2p/interface'

import { BrowserWindow } from 'electron'

import { createLibp2p } from 'libp2p'
import { tcp } from '@libp2p/tcp'
import { webSockets } from '@libp2p/websockets'
import { webRTC } from '@libp2p/webrtc'
import { webTransport } from '@libp2p/webtransport'
import { kadDHT, type KadDHT } from '@libp2p/kad-dht'
import { gossipsub, type GossipsubEvents } from '@chainsafe/libp2p-gossipsub'
import { noise } from '@chainsafe/libp2p-noise'
import { mplex } from '@libp2p/mplex'
import { yamux } from '@chainsafe/libp2p-yamux'
import { mdns } from '@libp2p/mdns'
import { autoNAT } from '@libp2p/autonat'
import { identify, type Identify } from '@libp2p/identify'
import { ping, type Ping } from '@libp2p/ping'
import { privateKeyFromRaw } from '@libp2p/crypto/keys'
import { peerIdFromString } from '@libp2p/peer-id'
import { createConfig } from '../../../libs/electron/persistence'
import { defineInvokeHandler } from '@moeru/eventa'
import { createContext } from '@moeru/eventa/adapters/electron/main'
import { useLogg } from '@guiiai/logg'
import { array, boolean, object, picklist, string, type InferOutput } from 'valibot'

import {
  libp2pServiceStart,
  libp2pServiceStop,
  libp2pServiceGetStatus,
  libp2pServiceListPeers,
  libp2pServiceGetConfig,
  libp2pServiceApplyConfig,
  libp2pServicePing,
  libp2pServicePublish,
  electronMeshIdentityGet,
  electronMeshIdentityGenerate,
  electronMeshIdentitySetName,
} from '@proj-airi/stage-shared/libp2p'
import { getOrCreateIdentity, getPrivateKey, hasIdentity, setIdentityName, regenerateIdentity } from './identity'

// Event channel names for main → renderer push events
const LIBP2P_STATUS_CHANGED_CHANNEL = 'eventa:event:electron:libp2p:status-changed'
const LIBP2P_PEER_JOINED_CHANNEL = 'eventa:event:electron:libp2p:peer-joined'
const LIBP2P_PEER_LEFT_CHANNEL = 'eventa:event:electron:libp2p:peer-left'
const LIBP2P_PEER_DISCOVERED_CHANNEL = 'eventa:event:electron:libp2p:peer-discovered'
const LIBP2P_MESSAGE_RECEIVED_CHANNEL = 'eventa:event:electron:libp2p:message-received'
const LIBP2P_IDENTITY_CHANGED_CHANNEL = 'eventa:event:electron:libp2p:identity:changed'
const LIBP2P_EVENT_LOG_CHANNEL = 'eventa:event:electron:libp2p:event-log'

const log = useLogg('libp2p-service').useGlobalConfig()

// ── Types ──────────────────────────────────────────────────────────────────────

const Libp2pServiceConfigSchema = object({
  enabled: boolean(),
  transports: array(picklist(['tcp', 'websockets', 'webrtc', 'webtransport'])),
  bootstrapPeers: array(string()),
  topics: array(string()),
})

type Libp2pServiceConfig = InferOutput<typeof Libp2pServiceConfigSchema>

interface Libp2pNode {
  start(): Promise<void>
  stop(): Promise<void>
  getMultiaddrs(): string[]
  getPeers(): Array<{ id: string; addresses: string[]; connected: boolean }>
  publish(topic: string, data: Uint8Array): Promise<void>
  dial(peerId: string): Promise<void>
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
    } catch {
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
    } catch {
      // Ignore
    }
  }
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
  if (config.transports.includes('tcp')) transports.push(tcp())
  if (config.transports.includes('websockets')) transports.push(webSockets())
  if (config.transports.includes('webrtc')) transports.push(webRTC())
  if (config.transports.includes('webtransport')) transports.push(webTransport())

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
  for (const topic of config.topics) {
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
        } catch {
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
        } catch {
          // Ignore
        }
      }
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
      } catch {
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
      } catch {
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
      } catch (err) {
        log.withError(err).error('Failed to start libp2p node')
        broadcastEventLog('error', `Failed to start libp2p: ${err}`)
      }
    } else {
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
        } catch (err) {
          broadcastEventLog('error', `Failed to start libp2p: ${err}`)
          throw err
        }
      } else {
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
    if (!libp2pNode) return []
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
        } catch (err) {
          broadcastEventLog('error', `Failed to start libp2p: ${err}`)
          throw err
        }
      }
    }

    return newConfig
  })

  // Ping
  defineInvokeHandler(context, libp2pServicePing, async ({ peerId }) => {
    if (!libp2pNode) throw new Error('libp2p node not running')
    const start = Date.now()
    try {
      await libp2pNode.dial(peerId)
      return { latencyMs: Date.now() - start }
    } catch (err) {
      return { latencyMs: 0, error: String(err) }
    }
  })

  // Publish
  defineInvokeHandler(context, libp2pServicePublish, async ({ topic, data }) => {
    if (!libp2pNode) throw new Error('libp2p node not running')
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
      } catch {
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
      } catch {
        // Ignore
      }
    }
    return identity
  })
}