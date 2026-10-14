import type { GossipsubEvents, GossipsubMessage } from '@chainsafe/libp2p-gossipsub'
import type { Identify } from '@libp2p/identify'
import type { Message, PeerId, PeerInfo, PubSub } from '@libp2p/interface'
import type { KadDHT } from '@libp2p/kad-dht'
import type { Ping } from '@libp2p/ping'
import type { Eventa } from '@moeru/eventa'
import type { Multiaddr } from '@multiformats/multiaddr'
import type { Lifecycle } from 'injeca'
import type { InferOutput } from 'valibot'

import type { ParsedPairingInvitation } from './pairing'

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
import { webSockets } from '@libp2p/websockets'
import { webTransport } from '@libp2p/webtransport'
import { defineInvokeHandler } from '@moeru/eventa'
import { createContext } from '@moeru/eventa/adapters/electron/main'
import {
  electronMeshIdentityChanged,
  electronMeshIdentityGenerate,
  electronMeshIdentityGet,
  electronMeshIdentitySetName,
  libp2pMessageReceived,
  libp2pPeerDiscovered,
  libp2pPeerJoined,
  libp2pPeerLeft,
  libp2pServiceAcceptPairing,
  libp2pServiceApplyConfig,
  libp2pServiceCreatePairing,
  libp2pServiceEventLog,
  libp2pServiceGetConfig,
  libp2pServiceGetStatus,
  libp2pServiceListPairedDevices,
  libp2pServiceListPeers,
  libp2pServicePairedDevicesChanged,
  libp2pServicePing,
  libp2pServicePublish,
  libp2pServiceRemovePairedDevice,
  libp2pServiceStart,
  libp2pServiceStatusChanged,
  libp2pServiceStop,
  libp2pServiceUpdatePairedDeviceAlias,
} from '@proj-airi/stage-shared/libp2p'
import { BrowserWindow, ipcMain } from 'electron'
import { createLibp2p } from 'libp2p'
import { array, boolean, maxLength, object, optional, picklist, pipe, safeParse, string } from 'valibot'

import { createConfig } from '../../../libs/electron/persistence'
import { getOrCreateIdentity, getPrivateKey, hasIdentity, regenerateIdentity, setIdentityName } from './identity'
import {
  acceptPairingInvitation,
  createPairingInvitation,
  findDiscoveredInviteByMagicCode,
  handlePairingAccepted,
  listPairedDevices,
  PAIRING_ACCEPTED_TOPIC,
  parsePairingInvitation,
  publishPairingRequest,
  recordPairingRequest,
  registerPendingAcceptedConfirmation,
  rememberDiscoveredInvite,
  removePairedDevice,
  updatePairedDeviceAlias,
} from './pairing'

// ── Main → Renderer Push ──────────────────────────────────────────────────────
// eventa's electron renderer adapter only binds `ipcRenderer.on('eventa-message')`,
// so a bare `webContents.send()` on a custom channel name reaches nothing. Pushes
// therefore have to go through a transient eventa context bound to each window.

const log = useLogg('libp2p-service').useGlobalConfig()

function emitToAllWindows<P>(contract: Eventa<P>, payload: P) {
  for (const win of BrowserWindow.getAllWindows()) {
    if (win.isDestroyed() || win.webContents.isDestroyed())
      continue
    try {
      const { context: winContext, dispose } = createContext(ipcMain, win)
      winContext.emit(contract, payload)
      dispose()
    }
    catch (err) {
      // A window torn down between the iteration and the emit, or a payload the
      // structured-clone boundary rejects, must not take the caller down, but a
      // real serialization failure is a renderer-sync bug and has to be visible.
      log.withError(err).debug(`Failed to emit ${contract.id} to a window`)
    }
  }
}

// ── Pairing Topics ────────────────────────────────────────────────────────────
// `airi/pairing/invites` carries the inviter's invitation minus its token, so a
// peer can find it by magic code without out-of-band address exchange, and
// `airi/pairing/requests` carries the token the accepter was given out of band.
// The pairing is only completed by the inviter, which is the only node that
// issued the token, so the token the invitation authorises is never published
// with it.
const PAIRING_INVITES_TOPIC = 'airi/pairing/invites'
const PAIRING_REQUESTS_TOPIC = 'airi/pairing/requests'
const PAIRING_TOPICS: string[] = [PAIRING_INVITES_TOPIC, PAIRING_REQUESTS_TOPIC, PAIRING_ACCEPTED_TOPIC]

// ── Types ──────────────────────────────────────────────────────────────────────

// NOTICE: the persisted `discovery.mdns` flag is gated here at the point of
// use rather than validated up front, because
// `packages/stage-shared/src/libp2p.ts` does not yet declare a `discovery`
// field on `Libp2pServiceConfig` (the mesh-sync and `allowedTopics` fields
// below were since added there), so the flag is enforced locally through this
// schema shape and cannot reach the renderer contract.
//
// A renderer patch carrying an unknown key never persists: valibot's `object()`
// strips unknown keys and returns `success: true`, so `mergeConfigPatch` below
// parses them away silently. That is the security-relevant property here — an
// unrecognised field cannot widen the config — but it means a typo also vanishes
// without an error, which is why the patch is matched against the local schema
// instead of the rendered contract and the shared contract above stays needed.
//
// NOTICE: `topics` is length-bounded so a corrupt or hand-edited config cannot
// inflate the subscription set (and therefore the mesh/heartbeat state) without
// limit. The three pairing topics are always allowed on top of this budget.
// NOTICE: `allowedTopics` is deliberately `undefined` when absent rather than
// `[]`: an empty array is a real operator choice that pairs with nothing, while
// a missing key must not read as a reset signal. `createLibp2pNode` unions
// whatever is here into the allow-list, so the default cannot narrow it either.
const MAX_CONFIGURED_TOPICS = 32

/**
 * NOTICE: the three mesh-sync keys mirror the now-optional fields on
 * `Libp2pServiceConfig` in `packages/stage-shared/src/libp2p.ts`. Without them
 * here a renderer patch carrying them fails `safeParse`, which triggers
 * `createConfig`'s auto-heal: that rewrites the persisted file with the schema
 * default*, discarding `enabled`, `bootstrapPeers` and `topics` on disk.
 *
 * They are `optional` rather than required so a config file written before they
 * existed still parses, and so the default below supplies them rather than the
 * stored record having to.
 */
const Libp2pServiceConfigSchema = object({
  enabled: boolean(),
  transports: array(picklist(['tcp', 'websockets', 'webrtc', 'webtransport'])),
  bootstrapPeers: array(string()),
  topics: pipe(array(string()), maxLength(MAX_CONFIGURED_TOPICS)),
  discovery: object({ mdns: boolean() }),
  /**
   * Whether generated memories donate themselves to the public mesh. This node
   * decides that on its own; it is not derived from any peer's advertisement,
   * and a `false` here is the safe default.
   */
  meshSyncEnabled: optional(boolean()),
  /** Multiaddrs of the peers this node syncs its memory tables with. */
  meshSyncTargets: optional(array(string())),
  /**
   * Named locally by the operator to widen the topic allow-list. It is *not*
   * authoritative: `createLibp2pNode` recomputes the gossipsub allow-list from
   * the configured topics plus the pairing topics, so a malicious or corrupt
   * value here can add topics but never remove the pairing ones.
   */
  allowedTopics: optional(array(string())),
})

type Libp2pServiceConfig = InferOutput<typeof Libp2pServiceConfigSchema>

/**
 * The factories `createLibp2p` accepts for `transports` / `peerDiscovery`. Both
 * option types are internal to `libp2p` (`Libp2pInit` is not exported), so they
 * are read back off the options parameter so an element pushed from a factory
 * call site is checked against the real shape instead of collapsing to `any[]`.
 */
type Libp2pInit = NonNullable<Parameters<typeof createLibp2p>[0]>
type TransportFactory = NonNullable<Libp2pInit['transports']>[number]
type PeerDiscoveryFactory = NonNullable<Libp2pInit['peerDiscovery']>[number]

// ── Pairing Node Interfaces ───────────────────────────────────────────────────
// `pairing.ts` never touches the libp2p node itself; it gets only the three
// narrow shapes below, and `createLibp2pNode` returns one more wrapper (typed
// `Libp2pNode`) built on the same underlying node for the invoke handlers.
/**
 * The node's own `pubsub.publish` resolves with a `PublishResult`, not `void`,
 * so the publisher contract accepts any resolution and discards it.
 */
interface Libp2pNodePublisher {
  publish: (topic: string, data: Uint8Array) => Promise<unknown>
}

interface Libp2pNodeDialer {
  dialMultiaddrs: (multiaddrs: Multiaddr[]) => Promise<void>
}

/**
 * The slice of a live libp2p node the pairing handler needs: the peer store for
 * addresses, the open connections as a fallback, and the pubsub publisher that
 * completes a pairing on the accepter's side.
 */
interface Libp2pNodeAddresses {
  peerStore: { get: (peerId: PeerId) => Promise<{ addresses: Array<{ multiaddr: Multiaddr }> }> }
  getConnections: (peerId: PeerId) => Array<{ remoteAddr: Multiaddr }>
  services: {
    pubsub: {
      publish: (topic: string, data: Uint8Array) => Promise<unknown>
    }
  }
}

interface Libp2pNode {
  start: () => Promise<void>
  stop: () => Promise<void>
  getMultiaddrs: () => string[]
  getPeers: () => Promise<Array<{ id: string, addresses: string[], connected: boolean }>>
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
  topics: ['airi/presence', 'airi/memory', 'airi/vault', 'airi/companion', 'airi/companion.chat'],
  // mDNS is the only thing that makes two AIRI instances on a LAN find each
  // other, so it stays on by default to preserve the previous behaviour.
  discovery: { mdns: true },
  // Opt-in: donating memories to the mesh is not something a fresh install does
  // on its own, so it starts off and targets nothing.
  meshSyncEnabled: false,
  meshSyncTargets: [],
  // Left unset: the operator-facing list is additive only, and the effective
  // allow-list is recomputed server-side from `topics` + the pairing topics.
  allowedTopics: undefined,
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
  // NOTICE: `optional()` makes a config written before the mesh-sync fields
  // exist still parse, so `libp2pConfigStore.setup()` stores it verbatim and the
  // keys are simply absent rather than defaulted. Merging the default over the
  // loaded record keeps `config.meshSync*` defined, which is what stops the
  // auto-heal wipe from discarding `enabled`/`bootstrapPeers`/`topics` on the
  // first renderer patch after an upgrade.
  return { ...Libp2pServiceConfigDefault, ...(await libp2pConfigStore.get()) }
}

/**
 * Merge a renderer patch over the stored config and validate the result against
 * the schema, so the picklist/array guarantees hold on the write path too.
 * A patch that cannot start is rejected here rather than persisted and thrown at
 * the next boot. Only keys the schema knows are merged, so a renderer that grew
 * a field ahead of the shared contract cannot silently widen the config.
 */
function mergeConfigPatch(base: Libp2pServiceConfig, patch: Partial<Libp2pServiceConfig>): Libp2pServiceConfig {
  const merged: Record<string, unknown> = { ...base }
  for (const key of Object.keys(patch) as Array<keyof Libp2pServiceConfig>) {
    const value = patch[key]
    if (value !== undefined) {
      merged[key] = value
    }
  }
  // A patch that drops a whole section (e.g. `discovery: undefined` from an
  // older renderer) still has to merge onto a complete base, so known-missing
  // sections are filled from the default instead of failing validation.
  for (const [key, fallback] of Object.entries(Libp2pServiceConfigDefault)) {
    if (merged[key] === undefined) {
      merged[key] = fallback
    }
  }

  const parsed = safeParse(Libp2pServiceConfigSchema, merged)
  if (!parsed.success) {
    throw new Error(`Invalid libp2p config patch: ${parsed.issues.map(issue => issue.message).join(', ')}`)
  }

  return parsed.output
}

// ── libp2p Node Management ────────────────────────────────────────────────────

let libp2pNode: Libp2pNode | null = null
let currentPeerId: PeerId | null = null
let currentConfig: Libp2pServiceConfig | null = null

/**
 * The narrow publisher surface other AIRI services may use to talk to the mesh.
 *
 * NOTICE: this exists so the friendship-mesh service
 * (`services/airi/agentic/companion.ts`) can publish `airi/companion` shares
 * without importing this module's private node state, and without any service
 * being able to start or stop the node. `null` means the node is not running,
 * which every caller must treat as "mesh unavailable" rather than an error.
 */
export interface Libp2pMeshPublisher {
  /** Publish bytes to an already-allow-listed gossipsub topic. */
  publish: (topic: string, data: Uint8Array) => Promise<void>
  /** This node's peer id, used as the share's author. */
  getPeerId: () => string
}

/** The current mesh publisher, or `null` when the node is down. */
export function getLibp2pMeshPublisher(): Libp2pMeshPublisher | null {
  if (!libp2pNode)
    return null
  const node = libp2pNode
  return {
    publish: (topic, data) => node.publish(topic, data),
    getPeerId: () => node.getPeerId(),
  }
}

async function buildStatus(): Promise<{
  running: boolean
  peerId?: string
  listenAddresses: string[]
  connections: number
  startedAt?: number
  error?: string
}> {
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
    connections: (await libp2pNode.getPeers()).filter(p => p.connected).length,
  }
}

async function broadcastStatus() {
  emitToAllWindows(libp2pServiceStatusChanged, await buildStatus())
}

function broadcastEventLog(level: 'debug' | 'info' | 'warn' | 'error', message: string) {
  emitToAllWindows(libp2pServiceEventLog, { level, message, timestamp: Date.now() })
}

/** Push the paired-device list to the renderer after any pairing mutation. */
async function broadcastPairedDevices() {
  emitToAllWindows(libp2pServicePairedDevicesChanged, await listPairedDevices())
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
 */
async function handlePairingRequest(node: Libp2pNodeAddresses, payload: unknown, sender: string) {
  // NOTICE: `peerIdFromString` throws on a malformed `sender`, and the enclosing
  // `gossipsub:message` listener is invoked synchronously by main-event with no
  // try/catch, so it has to sit inside this block to stay a caught failure.
  try {
    if (typeof payload !== 'object' || payload === null) {
      return
    }
    const { token } = payload as { token?: unknown }
    if (typeof token !== 'string') {
      return
    }

    const senderPeerId = peerIdFromString(sender)
    const multiaddrs = await getPeerAddresses(node, senderPeerId)

    // NOTICE: the publisher is what completes the pairing on the accepter's
    // side: `recordPairingRequest` publishes the inviter's confirmation on
    // `airi/pairing/accepted` itself, which is what flips the accepter's record
    // to `trusted: true`. Without one the device is still recorded here, but the
    // accepter's record stays at `trusted: false` forever with no error anywhere
    // on either side — which is why this argument must not be dropped.
    const device = await recordPairingRequest(token, sender, multiaddrs, undefined, sender, publisherFor(node.services.pubsub))
    if (!device) {
      return
    }

    await broadcastPairedDevices()
    broadcastEventLog('info', `Paired with ${sender} (${device.device.alias})`)
  }
  catch {
    // A malformed or already-consumed request is not fatal: the inviter logs
    // nothing and simply does not record the peer.
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

  const transports: TransportFactory[] = []
  if (config.transports.includes('tcp')) {
    transports.push(tcp())
  }
  if (config.transports.includes('websockets')) {
    transports.push(webSockets())
  }
  if (config.transports.includes('webrtc')) {
    // Static import cannot work here: `@libp2p/webrtc` re-exports
    // `@ipshipyard/node-datachannel/polyfill`, whose module scope requires the
    // `node_datachannel.node` addon built by a post-install script. Under
    // `--ignore-scripts` (CI) that addon is absent, so a static import throws
    // during main-process module resolution — before `createLibp2pNode` and
    // its error handling — crashing the app with no window ever created.
    // Deferring keeps that a recoverable, reported node-start failure.
    const { webRTC } = await import('@libp2p/webrtc')
    transports.push(webRTC())
  }
  if (config.transports.includes('webtransport')) {
    transports.push(webTransport())
  }

  // NOTICE: mDNS is not pushed onto `transports` - `mdns()` returns a
  // `PeerDiscovery`, not a `Transport`, and LAN discovery is wired via
  // `peerDiscovery` below.

  // NOTICE: listen addresses are derived from the enabled transports instead of
  // being hard-coded. `DefaultTransportManager.listen()` matches each address
  // against each transport's `listenFilter`: WebRTC only matches `webrtc`-suffixed
  // multiaddrs and `@libp2p/webtransport`'s returns `[]` unconditionally (dial
  // only in Node), so a `/tcp/0` entry left in place with those transports
  // selected makes every listen attempt fail and `listen()` throw
  // `UnsupportedListenAddressesError`. An empty array is valid: the node then
  // runs for outbound connects only.
  const listenAddresses: string[] = []
  if (config.transports.includes('tcp')) {
    listenAddresses.push('/ip4/0.0.0.0/tcp/0')
  }
  if (config.transports.includes('websockets')) {
    listenAddresses.push('/ip4/0.0.0.0/tcp/0/ws')
  }

  const peerDiscovery: PeerDiscoveryFactory[] = []
  if (config.discovery.mdns) {
    peerDiscovery.push(mdns({ interval: 30000 }))
  }

  // Deduplicated topic allow-list: gossipsub's `allowedTopics` drops inbound
  // subscriptions and messages on any other topic, so the mesh only ever caches
  // what this node was configured to care about. The pairing topics are always
  // allowed because the wire protocol needs them.
  //
  // NOTICE: the persisted `config.allowedTopics` is an operator-authored
  // *widening* only. It is unioned in here and can never remove a configured or
  // pairing topic, so a renderer (or a hand-edited file) cannot narrow the
  // allow-list to suppress the pairing topics this node depends on. Since the
  // value reaching gossipsub is recomputed rather than copied, a patch cannot
  // install an arbitrary subscription set of its own either.
  const topicUnion = [...config.topics, ...PAIRING_TOPICS, ...(config.allowedTopics ?? [])]
  // The cap counts each source once: the configured topics, the always-allowed
  // pairing topics, and the operator widening. It is not doubled, so the
  // subscription set cannot grow past the budget the schema already bounds.
  const allowedTopics = topicUnion.filter((topic, index) => topicUnion.indexOf(topic) === index)
    .slice(0, MAX_CONFIGURED_TOPICS + PAIRING_TOPICS.length)

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
      listen: listenAddresses,
    },
    transports,
    connectionEncrypters: [noise()],
    streamMuxers: [yamux(), mplex()],
    peerDiscovery,
    services: {
      dht: kadDHT({ clientMode: true }),
      pubsub: gossipsub({
        allowPublishToZeroTopicPeers: true,
        emitSelf: true,
        allowedTopics,
      }),
      identify: identify(),
      autoNAT: autoNAT(),
      ping: ping(),
    },
    connectionManager: {
      maxConnections: 100,
    },
  })

  // Only published once the node exists, so a failed create cannot leave a bogus
  // PeerId behind for `buildStatus()` to report.
  currentPeerId = peerId

  for (const topic of allowedTopics) {
    node.services.pubsub.subscribe(topic)
  }

  // Set up message handlers.
  // NOTICE: `subscribe()` returns `void` in the libp2p v2 API, so messages are
  // delivered as `message` events on the router instead of an async iterable.
  // Since `emitSelf` is enabled, our own published messages are echoed back, so
  // the `from` guard below is what prevents an echo loop. `from` is a `PeerId`
  // on a signed message and absent on an unsigned one.
  node.services.pubsub.addEventListener('message', (evt: CustomEvent<Message>) => {
    const msg = evt.detail
    // NOTICE: `from` is a `PeerId` on a signed message and absent on an unsigned
    // one, and the renderer contract declares it a `string` (the store calls
    // `msg.from.slice(0, 12)`), so the object must never cross as-is. The string
    // form is also what makes the self-echo guard below actually fire.
    const from = msg.type === 'signed' ? msg.from.toString() : undefined
    if (from === undefined || from === peerId.toString()) {
      return
    }

    // Broadcast to renderer
    emitToAllWindows(libp2pMessageReceived, {
      topic: msg.topic,
      from,
      data: Buffer.from(msg.data).toString('base64'),
    })

    // Also emit peer discovered event
    emitToAllWindows(libp2pPeerDiscovered, {
      id: from,
      addresses: [],
      connected: false,
    })
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
  node.services.pubsub.addEventListener('gossipsub:message', (evt: CustomEvent<GossipsubMessage>) => {
    const { propagationSource, msg } = evt.detail
    const topic = msg.topic
    if (topic !== PAIRING_INVITES_TOPIC && topic !== PAIRING_REQUESTS_TOPIC && topic !== PAIRING_ACCEPTED_TOPIC) {
      return
    }

    const sender = propagationSource.toString()
    if (sender === peerId.toString()) {
      return
    }

    try {
      const payload = Buffer.from(msg.data ?? []).toString('utf-8')
      if (topic === PAIRING_INVITES_TOPIC) {
        rememberDiscoveredInvite(JSON.parse(payload))
      }
      else if (topic === PAIRING_ACCEPTED_TOPIC) {
        // Accepter side: the inviter confirmed the token this node spent, which
        // is the only thing that flips the recorded device to trusted.
        void handlePairingAccepted(JSON.parse(payload), peerId.toString()).then((device) => {
          if (device !== null) {
            void broadcastPairedDevices()
          }
        }, () => {
          // A malformed confirmation is ignored.
        })
      }
      else {
        // The listener is synchronous (main-event invokes it without awaiting),
        // so the awaitable handler is fired off here; it swallows its own
        // rejections, including a malformed sender.
        void handlePairingRequest(node, JSON.parse(payload), sender)
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
  //
  // NOTICE: mDNS emits `peer:discovery` once per interval per peer (and again on
  // `peer:update`), so dialing unconditionally fills the dial queue — default
  // `maxParallelDials: 100`, `maxDialQueueLength: 500` — with a fresh entry for
  // every failing peer. Dials are therefore tracked per PeerId, and dropped again
  // on `peer:disconnect` so a peer that comes back can be re-dialled.
  const dialedPeers = new Set<string>()
  node.addEventListener('peer:discovery', (evt: CustomEvent<PeerInfo>) => {
    const peer = evt.detail
    const peerIdStr = peer.id.toString()
    if (peer.multiaddrs.length === 0 || dialedPeers.has(peerIdStr)) {
      return
    }
    dialedPeers.add(peerIdStr)

    void node.dial(peer.multiaddrs).catch((err: unknown) => {
      // A peer going offline, or an unreachable interface, is expected on a LAN
      // and is retried on the next mDNS interval, but the failure has to be
      // visible instead of swallowed to be diagnosable at all.
      dialedPeers.delete(peerIdStr)
      log.withError(err).debug(`Failed to dial discovered peer ${peerIdStr}`)
    })
  })

  node.addEventListener('peer:connect', (evt: CustomEvent<PeerId>) => {
    const peer = evt.detail
    dialedPeers.add(peer.toString())
    emitToAllWindows(libp2pPeerJoined, {
      id: peer.toString(),
      addresses: [],
      connected: true,
    })
  })

  node.addEventListener('peer:disconnect', (evt: CustomEvent<PeerId>) => {
    const peer = evt.detail
    dialedPeers.delete(peer.toString())
    emitToAllWindows(libp2pPeerLeft, { id: peer.toString() })
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
    async getPeers() {
      const peers = node.getPeers()
      // NOTICE: `PeerId` carries no addresses, `peerStore.get()` is async and the
      // node API is sync, so the open connections are the only synchronous source
      // of per-peer multiaddrs; the peer store stays authoritative where it can
      // be awaited (the `libp2pPeerDiscovered` and pairing paths).
      return Promise.all(peers.map(async p => ({
        id: p.toString(),
        addresses: await getPeerAddresses(node, p),
        connected: node.getConnections(p).length > 0,
      })))
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
  // NOTICE: `loadConfig()` reads the in-memory map, which is only populated by
  // `libp2pConfigStore.setup()`'s synchronous disk read. Without this, a real
  // boot ignores the persisted file entirely (silently reverting to the
  // default, which auto-heal can then overwrite), so it must run first — the
  // other AIRI services call `.setup()` from their own setup functions too.
  libp2pConfigStore.setup()
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
        broadcastEventLog('error', `Failed to start libp2p: ${err instanceof Error ? err.message : String(err)}`)
        // `createLibp2pNode` only throws after the underlying `node.start()`
        // already failed and stopped its internals, so the half-built node is
        // not usable: dropping the reference keeps `buildStatus()` honest and
        // stops a later stop/start pair from touching a dead node.
        libp2pNode = null
        currentPeerId = null
      }
    }
    else {
      broadcastEventLog('warn', 'libp2p enabled but no identity found')
    }
  }

  params.lifecycle.appHooks.onStop(async () => {
    if (libp2pNode) {
      await libp2pNode.stop().then(() => {
        libp2pNode = null
        currentPeerId = null
      }, (err: unknown) => log.withError(err).error('Error stopping libp2p'))
    }
    libp2pConfigStore.flush()
  })
}

// ── Eventa Service ─────────────────────────────────────────────────────────────

export async function createLibp2pService(params: { context: ReturnType<typeof createContext>['context'] }) {
  const context = params.context

  // Start
  defineInvokeHandler(context, libp2pServiceStart, async (cfg: Partial<Libp2pServiceConfig>) => {
    let newConfig: Libp2pServiceConfig
    try {
      newConfig = mergeConfigPatch(await loadConfig(), cfg)
    }
    catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      broadcastEventLog('error', message)
      throw new Error(message)
    }

    if (libp2pNode) {
      await libp2pNode.stop().catch((err: unknown) => log.withError(err).error('Error stopping libp2p'))
      libp2pNode = null
      currentPeerId = null
    }

    currentConfig = newConfig
    libp2pConfigStore.update(newConfig)
    libp2pConfigStore.flush()

    if (newConfig.enabled) {
      const privateKey = await getPrivateKey()
      if (privateKey) {
        try {
          libp2pNode = await createLibp2pNode(newConfig, privateKey)
          await libp2pNode.start()
        }
        catch (err) {
          broadcastEventLog('error', `Failed to start libp2p: ${err instanceof Error ? err.message : String(err)}`)
          libp2pNode = null
          currentPeerId = null
          throw err
        }
      }
      else {
        broadcastEventLog('warn', 'libp2p enabled but no identity found')
      }
    }

    return await buildStatus()
  })

  // Stop
  defineInvokeHandler(context, libp2pServiceStop, async () => {
    if (libp2pNode) {
      await libp2pNode.stop()
      libp2pNode = null
      currentPeerId = null
    }
    return await buildStatus()
  })

  // Get Status
  defineInvokeHandler(context, libp2pServiceGetStatus, async () => {
    return await buildStatus()
  })

  // List Peers
  defineInvokeHandler(context, libp2pServiceListPeers, async () => {
    if (!libp2pNode) {
      return []
    }
    return await libp2pNode.getPeers()
  })

  // Get Config
  defineInvokeHandler(context, libp2pServiceGetConfig, async () => {
    return await loadConfig()
  })

  // Apply Config
  defineInvokeHandler(context, libp2pServiceApplyConfig, async (patch: Partial<Libp2pServiceConfig>) => {
    let newConfig: Libp2pServiceConfig
    try {
      newConfig = mergeConfigPatch(await loadConfig(), patch)
    }
    catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      broadcastEventLog('error', message)
      throw new Error(message)
    }

    if (libp2pNode) {
      await libp2pNode.stop().catch((err: unknown) => log.withError(err).error('Error stopping libp2p'))
      libp2pNode = null
      currentPeerId = null
    }

    currentConfig = newConfig
    libp2pConfigStore.update(newConfig)
    libp2pConfigStore.flush()

    if (newConfig.enabled) {
      const privateKey = await getPrivateKey()
      if (privateKey) {
        try {
          libp2pNode = await createLibp2pNode(newConfig, privateKey)
          await libp2pNode.start()
        }
        catch (err) {
          broadcastEventLog('error', `Failed to start libp2p: ${err instanceof Error ? err.message : String(err)}`)
          libp2pNode = null
          currentPeerId = null
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

      return { latencyMs: 0, error: err instanceof Error ? err.message : String(err) }
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
    emitToAllWindows(electronMeshIdentityChanged, identity)
    return identity
  })

  // Identity Set Name
  defineInvokeHandler(context, electronMeshIdentitySetName, async ({ name }) => {
    const identity = await setIdentityName(name)
    emitToAllWindows(electronMeshIdentityChanged, identity)
    return identity
  })

  // Pairing: create
  defineInvokeHandler(context, libp2pServiceCreatePairing, async ({ ttlMinutes, name, napChatGranted }: { ttlMinutes?: number, name?: string, napChatGranted?: boolean } = {}) => {
    if (!libp2pNode) {
      throw new Error('libp2p node not running')
    }

    // The invite's addresses have to be ones a peer can actually dial, so the
    // unspecified hosts the listeners bound (`0.0.0.0` and `::`) are dropped in
    // favour of the concrete loopback/LAN addresses that carry the
    // `/p2p/<peerId>` suffix. WebRTC and WebTransport are dial-only here, so they
    // never produce a listen address in the first place (see `listenAddresses`
    // above) and only contribute addresses from `identify`-observed connections.
    const multiaddrs = libp2pNode.getMultiaddrs().filter(addr => addr.includes('/p2p/')
      && !addr.startsWith('/ip4/0.0.0.0/')
      && !addr.startsWith('/ip6/::/'))
    const peerId = libp2pNode.getPeerId()

    // NOTICE: an explicitly-refused grant is answered *here*, before
    // `createPairingInvitation` issues anything. Refusal is the user declining
    // the nap-chat permission for the device being paired with, and it must not
    // persist a record that later reads as granted — `null`/absent stays
    // backwards compatible, so an existing caller that never passes the field
    // still pairs exactly as before, with no grant recorded.
    if (napChatGranted === false) {
      return { error: 'Nap-chat consent was declined, so this pairing did not happen. Pair again if you change your mind.' }
    }

    const { qrCode, magicCode, invitation } = await createPairingInvitation(multiaddrs, peerId, name || 'AIRI Node', ttlMinutes ?? 30, publisherFor(libp2pNode), napChatGranted)

    broadcastEventLog('info', `Pairing invitation created, magic code ${magicCode}`)

    return { qrCode, magicCode, expiresAt: new Date(invitation.expiresAt).toISOString() }
  })

  // Pairing: accept
  defineInvokeHandler(context, libp2pServiceAcceptPairing, async ({ input, alias, napChatGranted }: { input: string, alias?: string, napChatGranted?: boolean }) => {
    if (!libp2pNode) {
      throw new Error('libp2p node not running')
    }

    const localPeerId = libp2pNode.getPeerId()
    const dialer = dialerFor(libp2pNode)

    // NOTICE: an explicitly-refused grant is answered *here*, before the
    // invitation is even resolved or dialled. Refusal must stop before
    // `addPairedDevice` is reached — a record that exists but carries no grant
    // would still leave a paired-device row behind, and the design's rule is
    // "don't want it → don't pair". Absent means the pairing dialog has not
    // surfaced the grant yet, which is a walk-back compatible with an older
    // renderer; the record is then written without a grant, which reads as a
    // refusal anyway.
    if (napChatGranted === false) {
      return { error: 'Nap-chat consent was declined, so this pairing did not happen. Pair again if you change your mind.' }
    }

    // A QR payload carries the invitation inline; anything else is a bare magic
    // code, which only names an invitation that must be resolved from
    // `airi/pairing/invites` discovery (or from an invite this node itself
    // issued). A discovered invite carries no token, so it is passed with an
    // empty one and `acceptPairingInvitation` refuses it as not authorising.
    let parsed: ParsedPairingInvitation | null
    if (input.startsWith('airi-pair://')) {
      parsed = parsePairingInvitation(input)
    }
    else {
      const discovered = findDiscoveredInviteByMagicCode(input.trim())
      parsed = discovered ? { ...discovered, token: '' } : null
    }

    if (!parsed) {
      return { error: 'Not a pairing QR payload, and no matching invitation was discovered on the mesh — provide the QR payload or enter the code while the inviter is broadcasting' }
    }

    const result = await acceptPairingInvitation(parsed, localPeerId, alias, dialer, napChatGranted)

    if ('error' in result) {
      return result
    }

    // Register before publishing the request so an `accepted` confirmation that
    // races back cannot be rejected for having no pending entry.
    registerPendingAcceptedConfirmation(result.peerId, result.token)

    // The accepter only knows the token it was given; the inviter is the one
    // that issued it, so the request is what turns the dial into a pair.
    await publishPairingRequest(result.token, result.peerId, publisherFor(libp2pNode))
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
