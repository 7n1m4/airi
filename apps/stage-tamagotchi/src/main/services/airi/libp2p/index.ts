import type { Lifecycle } from 'injeca'
import type { Multiaddr } from '@multiformats/multiaddr'
import type { PeerId } from '@libp2p/interface'

import { BrowserWindow } from 'electron'

import { createLibp2p } from 'libp2p'
import { tcp } from '@libp2p/tcp'
import { webSockets } from '@libp2p/websockets'
import { webRTC } from '@libp2p/webrtc'
import { webtransport } from '@libp2p/webtransport'
import { kadDHT } from '@libp2p/kad-dht'
import { gossipsub } from '@libp2p/gossipsub'
import { noise } from '@libp2p/noise'
import { mplex } from '@libp2p/mplex'
import { yamux } from '@libp2p/yamux'
import { mdns } from '@libp2p/mdns'
import { autoNAT } from '@libp2p/autonat'
import { identify } from '@libp2p/identify'
import { ping } from '@libp2p/ping'
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
  // NOTICE: `@libp2p/crypto@5.1.23` resolves its key types against
  // `@libp2p/interface@3.3.0` + `multiformats@14`, while `@libp2p/peer-id@5.1.9`
  // resolves against `@libp2p/interface@2.11.0` + `multiformats@13`, so the key
  // produced by `privateKeyFromRaw` cannot be passed to `peerIdFromPrivateKey`
  // directly. Round-tripping through the public key's base58btc multihash
  // string keeps the seam version-agnostic and yields the identical PeerId.
  const peerId = peerIdFromString(privateKeyFromRaw(privateKey).publicKey.toString())
  currentPeerId = peerId

  const transports = []
  if (config.transports.includes('tcp')) transports.push(tcp())
  if (config.transports.includes('websockets')) transports.push(webSockets())
  if (config.transports.includes('webrtc')) transports.push(webRTC())
  if (config.transports.includes('webtransport')) transports.push(webtransport())

  // mDNS provides LAN peer discovery and is always enabled alongside TCP
  if (config.transports.includes('tcp')) {
    transports.push(mdns())
  }

  const node = await createLibp2p({
    peerId,
    addresses: {
      listen: [
        '/ip4/0.0.0.0/tcp/0',
        '/ip4/0.0.0.0/tcp/0/ws',
      ],
    },
    transports,
    connectionEncryption: [noise()],
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
      minConnections: 10,
    },
  })

  // Subscribe to topics
  for (const topic of config.topics) {
    node.services.pubsub.subscribe(topic)
  }

  // Set up message handlers
  for (const topic of config.topics) {
    for await (const msg of node.services.pubsub.subscribe(topic)) {
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
    }
  }

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
      return peers.map((p: PeerId) => ({
        id: p.toString(),
        addresses: node.getPeerAddresses(p).map((ma: Multiaddr) => ma.toString()),
        connected: node.isConnected(p),
      }))
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