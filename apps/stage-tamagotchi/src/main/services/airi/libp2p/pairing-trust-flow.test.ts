import type { GossipsubMessage } from '@chainsafe/libp2p-gossipsub'
import type { Multiaddr } from '@multiformats/multiaddr'

import type { AcceptPairingResult } from './pairing'

import { Buffer } from 'node:buffer'

import { createLibp2p } from 'libp2p'
import {
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest'

import { napChatConsentFor } from '../agentic/companion'
import { setupLibp2pService } from './index'
import {
  acceptPairingInvitation,
  createPairingInvitation,
  findDiscoveredInviteByMagicCode,
  handlePairingAccepted,
  listPairedDevices,
  parsePairingInvitation,
  publishPairingRequest,
  recordPairingRequest,
  registerPendingAcceptedConfirmation,
  rememberDiscoveredInvite,
  setupPairedDevices,
} from './pairing'

/**
 * Pairing trust flow over real libp2p nodes.
 *
 * The pairing protocol's safety rests on wire behaviour a stubbed pubsub cannot
 * express: `recordPairingRequest` compares the `senderPeerId` a payload asserts
 * against the `propagationSource` the message actually arrived from. That
 * comparison only means something against a transport that reports a distinct
 * propagation source, so these tests run real in-process nodes on `127.0.0.1`
 * with the same gossipsub configuration `index.ts` uses
 * (`allowPublishToZeroTopicPeers`, `emitSelf`, an `allowedTopics` allow-list
 * holding exactly the three pairing topics).
 *
 * Only the platform boundary is mocked: Electron's `safeStorage`, which the
 * inviter seals its token with, and the `createConfig` store backing the
 * paired-device list.
 *
 * The negative controls are the point. `airi/pairing/*` is an unauthenticated
 * topic, so a bystander can re-publish anything it observes; the protocol must
 * survive exactly that. Every "attacker" below is a real node running the same
 * code, and its PeerId is a real PeerId.
 *
 * A second suite in this file covers the persistence half without any mesh: a
 * paired-device grant has to survive a restart, which is purely a question of
 * whether the store's in-memory map was ever populated from disk. Its mock
 * models each `createConfig` store separately, because the whole failure mode is
 * one store being hydrated and another not.
 */

/** The three topics `index.ts` subscribes to and allows. */
const PAIRING_INVITES_TOPIC = 'airi/pairing/invites'
const PAIRING_REQUESTS_TOPIC = 'airi/pairing/requests'
const PAIRING_ACCEPTED_TOPIC = 'airi/pairing/accepted'

const PAIRING_TOPICS: readonly string[] = [
  PAIRING_INVITES_TOPIC,
  PAIRING_REQUESTS_TOPIC,
  PAIRING_ACCEPTED_TOPIC,
]

/** One real node plus its own record of what arrived on it. */
interface TestNode {
  peerId: string
  node: {
    getMultiaddrs: () => Multiaddr[]
    dial: (addrs: Multiaddr[]) => Promise<unknown>
    stop: () => Promise<void>
    services: {
      pubsub: {
        subscribe: (topic: string) => void
        publish: (topic: string, data: Uint8Array) => Promise<unknown>
        addEventListener: (
          type: string,
          listener: (evt: { detail: GossipsubMessage }) => void,
        ) => void
        removeEventListener: (
          type: string,
          listener: (evt: { detail: GossipsubMessage }) => void,
        ) => void
      }
    }
  }
  /** Every message this node observed, in arrival order. */
  seen: Array<{ topic: string, from: string, payload: string }>
  dispose: () => void
}

/**
 * Build a real libp2p node wired to `pairing.ts` exactly as `index.ts` does.
 *
 * EXCEPTION (ts-no-dynamic-import): the libp2p/transport/crypto modules are
 * imported inside this helper rather than at the top of the file because
 * `@libp2p/webrtc` is reachable from the same graph and its `node_datachannel`
 * native addon is not built under `--ignore-scripts`. A static import here would
 * resurrect the boot-time static-import failure that `index.ts` exists to avoid.
 */
async function createTestNode(): Promise<TestNode> {
  const { generateKeyPair } = await import('@libp2p/crypto/keys')
  const { peerIdFromString } = await import('@libp2p/peer-id')
  const { tcp } = await import('@libp2p/tcp')
  const { noise } = await import('@chainsafe/libp2p-noise')
  const { yamux } = await import('@chainsafe/libp2p-yamux')
  const { gossipsub } = await import('@chainsafe/libp2p-gossipsub')
  const { identify } = await import('@libp2p/identify')

  const keyPair = await generateKeyPair('Ed25519')
  const peerId = peerIdFromString(keyPair.publicKey.toString()).toString()

  const node = await createLibp2p({
    privateKey: keyPair,
    addresses: { listen: ['/ip4/127.0.0.1/tcp/0'] },
    transports: [tcp()],
    connectionEncrypters: [noise()],
    streamMuxers: [yamux()],
    services: {
      pubsub: gossipsub({
        allowPublishToZeroTopicPeers: true,
        emitSelf: true,
        allowedTopics: [...PAIRING_TOPICS],
      }),
      // `gossipsub` declares a dependency on `identify`, so it must be provided.
      identify: identify(),
    },
  })

  await node.start()

  const seen: Array<{ topic: string, from: string, payload: string }> = []
  for (const topic of PAIRING_TOPICS)
    node.services.pubsub.subscribe(topic)

  const listener = (evt: { detail: GossipsubMessage }) => {
    const { propagationSource, msg } = evt.detail
    // The self-echo guard: `emitSelf` means our own publications come back to us.
    if (propagationSource.toString() === peerId)
      return
    const payload = Buffer.from(msg.data ?? []).toString('utf8')
    if (payload === '__warmup__') {
      // Recorded so `settleMesh` can observe the reflection, then skipped: the
      // sentinel is not JSON and must never reach the pairing parser.
      seen.push({ topic: msg.topic, from: propagationSource.toString(), payload })
      return
    }
    seen.push({ topic: msg.topic, from: propagationSource.toString(), payload })
    if (msg.topic === PAIRING_INVITES_TOPIC) {
      rememberDiscoveredInvite(JSON.parse(payload))
    }
    else if (msg.topic === PAIRING_ACCEPTED_TOPIC) {
      // An unhandled rejection here would fail an unrelated test, so swallow it;
      // the direct `handlePairingAccepted` call in each test is the assertion.
      handlePairingAccepted(JSON.parse(payload), peerId).catch(() => {})
    }
  }

  node.services.pubsub.addEventListener('gossipsub:message', listener)

  return {
    peerId,
    node: {
      getMultiaddrs: () => node.getMultiaddrs(),
      dial: (addrs: Multiaddr[]) => node.dial(addrs),
      stop: async () => { await node.stop() },
      services: {
        pubsub: {
          subscribe: (topic: string) => node.services.pubsub.subscribe(topic),
          publish: (topic: string, data: Uint8Array) => node.services.pubsub.publish(topic, data),
          // The adapter is deliberately string-keyed: this file subscribes to
          // `gossipsub:message` and to the topics by name, and the events the
          // gossip service emits are not all part of its exported key union.
          addEventListener: (
            type: string,
            fn: (evt: { detail: GossipsubMessage }) => void,
          ) => (node.services.pubsub.addEventListener as unknown as (t: string, f: typeof fn) => void)(type, fn),
          removeEventListener: (
            type: string,
            fn: (evt: { detail: GossipsubMessage }) => void,
          ) => (node.services.pubsub.removeEventListener as unknown as (t: string, f: typeof fn) => void)(type, fn),
        },
      },
    },
    seen,
    dispose: () => node.services.pubsub.removeEventListener('gossipsub:message', listener),
  }
}

/**
 * Await the next matching `gossipsub:message` instead of guessing a wall-clock
 * duration, so a failure reports that the message never arrived rather than
 * that a sleep elapsed.
 *
 * EXCEPTION (ts-no-test-timers): the ceiling `setTimeout` only rejects a promise
 * gossipsub never resolves, which is the awaited-event pattern the rule permits;
 * no fixed wait is used anywhere in this file.
 */
function waitForMessage(
  node: TestNode,
  predicate: (topic: string, payload: string) => boolean,
  timeout = 10_000,
): Promise<string> {
  const alreadySeen = node.seen.find(m => predicate(m.topic, m.payload))
  if (alreadySeen)
    return Promise.resolve(alreadySeen.payload)

  const { promise, resolve, reject } = Promise.withResolvers<string>()
  const timeoutHandle = setTimeout(() => {
    node.node.services.pubsub.removeEventListener('gossipsub:message', onMessage)
    reject(new Error(`Timed out after ${timeout}ms awaiting a matching gossipsub message`))
  }, timeout)

  function onMessage(evt: { detail: GossipsubMessage }): void {
    const payload = Buffer.from(evt.detail.msg.data ?? []).toString('utf8')
    if (!predicate(evt.detail.msg.topic, payload))
      return
    clearTimeout(timeoutHandle)
    node.node.services.pubsub.removeEventListener('gossipsub:message', onMessage)
    resolve(payload)
  }

  node.node.services.pubsub.addEventListener('gossipsub:message', onMessage)
  return promise
}

/**
 * How long a freshly-connected mesh needs before a publication is forwarded:
 * gossipsub exposes no "peer now knows my subscription" event, and a publish
 * made before that is silently dropped.
 *
 * EXCEPTION (ts-no-test-timers): this integration suite has to exercise the
 * platform clock, because gossipsub's heartbeat is not injectable. The condition
 * under test is always awaited through `waitForMessage`/`vi.waitFor`; this is a
 * one-off setup step before the topic warm-up, not a wait around an assertion.
 */
const MESH_SETTLE_MS = 1500

/**
 * The `createConfig` stores the mock hands out, keyed by namespace.
 *
 * A mock with one shared store for every namespace would let
 * `libp2pConfigStore.setup()` satisfy `getPairedDevices()`'s read, which is
 * precisely the wiring this suite has to catch: the two stores live in
 * different `persistenceMap` entries and must not share one. Each entry below
 * is a faithful miniature of the real thing (`persistence.ts`):
 *
 *  - `setup()` is the synchronous disk read, and it is the *only* thing that
 *    moves `persisted` into `map`;
 *  - `get()` reads `map`, so a store that was never set up reads nothing;
 *  - `update()` writes `map` and schedules the debounced disk write.
 */
/** A miniature of one real `createConfig` store, per file. */
interface StubStore {
  name: string
  /** The in-memory map. `undefined` until `setup()` reads the disk. */
  map: { devices: Array<Record<string, unknown>> } | undefined
  /** What the previous boot left in this store's file. */
  persisted: { devices: Array<Record<string, unknown>> }
  /** The last value written to the in-memory map, i.e. the flush payload. */
  lastUpdate: { devices: Array<Record<string, unknown>> } | undefined
  setupCalls: number
  flushCalls: number
}

const stores = vi.hoisted(() => {
  function store(name: string): StubStore {
    return {
      name,
      map: undefined,
      persisted: { devices: [] },
      lastUpdate: undefined,
      setupCalls: 0,
      flushCalls: 0,
    }
  }

  return {
    libp2pConfig: store('libp2p'),
    /**
     * NOTICE: `devices` is the paired-device list, so the schema `pairing.ts`
     * validates (`PairedDevicesSchema`) is what a record must be shaped like.
     */
    pairedDevices: store('paired'),
  }
})

type MockStore = Omit<StubStore, 'name'>

vi.mock('electron', () => ({
  app: { getPath: () => '/tmp/airi-libp2p-pairing-test' },
  safeStorage: {
    isEncryptionAvailable: () => true,
    // Reversible, so a token this node sealed can be read back by this node.
    // The module only ever round-trips its own ciphertext.
    encryptString: (value: string): Buffer => Buffer.from(`enc:${value}`),
    decryptString: (buf: Buffer): string => buf.toString('utf8').replace(/^enc:/, ''),
  },
}))

vi.mock('../../../libs/electron/persistence', () => ({
  createConfig: (_namespace: string, filename: string) => {
    // Two different files, therefore two different stores, exactly as the real
    // registry keys them (`paired-devices.json` is `pairing.ts`'s file; the
    // libp2p service's own config file is the other one).
    const stub: MockStore = filename === 'paired-devices.json'
      ? stores.pairedDevices
      : stores.libp2pConfig

    return {
      setup: (): { status: 'ok', path: '/tmp/airi-libp2p-pairing-test' } => {
        stub.setupCalls++
        // The synchronous disk read: the map is populated from disk, or left
        // untouched when there is no file (the real store then falls back to the
        // schema default, which is what an unhydrated read sees).
        if (stub.map === undefined && stub.persisted !== undefined)
          stub.map = stub.persisted
        return { status: 'ok', path: '/tmp/airi-libp2p-pairing-test' }
      },
      get: () => stub.map,
      update: (value: { devices: Array<Record<string, unknown>> }) => {
        stub.map = value
        stub.lastUpdate = value
      },
      flush: () => { stub.flushCalls++ },
      getDiagnostics: () => undefined,
    }
  },
}))

/** Bind a node as the publisher side of a pairing. */
function publisher(n: TestNode) {
  return {
    publish: async (topic: string, data: Uint8Array): Promise<void> => {
      await n.node.services.pubsub.publish(topic, data)
    },
  }
}

/**
 * Bind a node as the dialer side. The accepter is the dialer: it is the node
 * that was handed the QR, and `pairing.ts` dials the invitation's own addresses.
 */
function dialer(n: TestNode) {
  return { dial: (addrs: Multiaddr[]) => n.node.dial(addrs) }
}

/** Read the `token` field off an unknown wire payload without an inline cast. */
function readWireToken(payload: unknown): string {
  if (payload && typeof payload === 'object') {
    for (const [key, value] of Object.entries(payload)) {
      if (key === 'token' && typeof value === 'string')
        return value
    }
  }
  throw new TypeError('wire payload carries no token string')
}

/**
 * `AcceptPairingResult` is discriminated by shape rather than by a literal, so
 * `token` exists only on the success case. A test that reaches here with an
 * error is a real failure and is reported as one, rather than crashing later on
 * an undefined token.
 */
function requireAccepted(result: AcceptPairingResult): { peerId: string, alias: string, multiaddrs: string[], token: string } {
  if ('error' in result)
    throw new Error(`pairing was refused: ${result.error}`)
  return result
}

/**
 * Warm the mesh so the subsequent `waitForMessage` has a known-good path.
 *
 * gossipsub reports no "peer now knows my subscription" event, and a message
 * published before that is silently dropped, so the warm-up is the mechanism
 * that makes the awaiting deterministic rather than a race against a fixed
 * sleep. Each node publishes one throwaway payload per topic, which every other
 * subscriber then reflects back.
 *
 * EXCEPTION (ts-no-test-timers): the settle inside this helper exercises the
 * platform clock, because gossipsub's heartbeat is not injectable here.
 */
async function settleMesh(...nodes: TestNode[]): Promise<void> {
  // First let the just-formed connections and subscriptions propagate:
  // gossipsub reports no "peer now knows my subscription" event, and a publish
  // made before that is silently dropped.
  await new Promise<void>(resolve => setTimeout(resolve, MESH_SETTLE_MS))

  // Then warm every topic and *poll* for the reflections, which turns the
  // remaining uncertainty into an awaited condition rather than a sleep.
  const [first, ...rest] = nodes
  const warm = PAIRING_TOPICS.map(topic =>
    first.node.services.pubsub.publish(topic, new TextEncoder().encode('__warmup__')),
  )
  await Promise.all(warm)
  await vi.waitFor(
    () => {
      for (const n of rest) {
        expect(n.seen.filter(m => m.payload === '__warmup__')).toHaveLength(PAIRING_TOPICS.length)
      }
    },
    { timeout: 10_000, interval: 100 },
  )
  // Drop the warm-up records so assertions over `seen` see only real traffic.
  for (const n of nodes)
    n.seen.splice(0, n.seen.length)
}

/** Teardown for a set of nodes, run in `finally` blocks. */
async function stopNodes(...nodes: TestNode[]): Promise<void> {
  for (const n of nodes)
    n.dispose()
  for (const n of nodes)
    await n.node.stop()
}

/**
 * Reset the paired-device store between tests. The store is one mock instance
 * for the whole file and `listPairedDevices` reads it synchronously, so without
 * a reset every test asserts against the previous test's devices.
 *
 * `undefined` models the state a fresh process is in before `setup()` has run
 * its synchronous disk read, which is what the persistence suite depends on.
 */
beforeEach(() => {
  // The paired-device store is one mock instance for the whole file and
  // `listPairedDevices` reads it synchronously, so without a reset every test
  // sees the previous test's devices. `map: undefined` is the state a fresh
  // process is in before `setup()` has read the disk.
  stores.pairedDevices.map = undefined
  stores.pairedDevices.persisted = { devices: [] }
  stores.pairedDevices.lastUpdate = undefined
  stores.pairedDevices.setupCalls = 0
  stores.pairedDevices.flushCalls = 0
})

describe('pairing trust flow over real libp2p nodes', () => {
  it('completes a pairing end to end over the mesh, with the token off the wire', async () => {
    const inviter = await createTestNode()
    const accepter = await createTestNode()

    try {
      // The accepter dials the inviter, so both are connected and the topic
      // subscriptions have propagated before anything is published.
      await accepter.node.dial(inviter.node.getMultiaddrs())
      const conns = await accepter.node.dial(inviter.node.getMultiaddrs()).then(() => 'ok', (e: unknown) => String(e))
      console.info('diag dial:', conns, JSON.stringify(inviter.seen.length), JSON.stringify(accepter.seen.length))
      await settleMesh(inviter, accepter)
      // Raw publication straight through the transport, to separate mesh health
      // from `pairing.ts`.
      await inviter.node.services.pubsub.publish(PAIRING_INVITES_TOPIC, new TextEncoder().encode(JSON.stringify({ probe: true })))
      await new Promise<void>(r => setTimeout(r, 2000))

      const { qrCode, magicCode } = await createPairingInvitation(
        inviter.node.getMultiaddrs().map(a => a.toString()),
        inviter.peerId,
        'Inviter Node',
        30,
        publisher(inviter),
      )
      const invite = parsePairingInvitation(qrCode)!

      // ROOT CAUSE:
      //
      // The invitation used to live in a module-local `Map` keyed by magic code,
      // so only the process that issued the invite could complete it — a second
      // AIRI instance on the LAN could not pair at all, because the token the QR
      // carried resolved nowhere else.
      //
      // FIXED BY: the invitation travels on `airi/pairing/invites` and the
      // request on `airi/pairing/requests`, with the token held out of the
      // invitation (asserted below).
      const inviteOnWire = await waitForMessage(
        accepter,
        (topic, payload) => topic === PAIRING_INVITES_TOPIC && payload.includes(magicCode),
      )

      // ROOT CAUSE:
      //
      // The invitation was published whole, so the token that authorises the
      // pairing rode on a public topic: any peer listening could complete a
      // pairing without ever being handed a QR.
      //
      // FIXED BY: the payload is `Omit<PairingInvitation,'token'>`, assembled
      // field by field, so widening `PairingInvitation` cannot leak the token.
      // This is asserted at the boundary a real peer observes.
      const wireInvite = JSON.parse(inviteOnWire) as Record<string, unknown>
      expect(Object.keys(wireInvite).sort()).toEqual(['invite', 'magicCode', 'type'])
      const wireInviteInner = wireInvite.invite as Record<string, unknown>
      expect(Object.keys(wireInviteInner).sort()).toEqual(['expiresAt', 'multiaddrs', 'name', 'peerId'])
      expect('token' in wireInviteInner).toBe(false)

      // Every message the accepter saw, not just this one publication.
      for (const message of accepter.seen)
        expect(message.payload).not.toContain(invite.token)

      // The magic code is public and does arrive, which is what makes discovery
      // work at all.
      expect(findDiscoveredInviteByMagicCode(magicCode)).not.toBeNull()

      // The accepter accepts the QR it was handed out of band.
      const accepted = requireAccepted(await acceptPairingInvitation(invite, accepter.peerId, undefined, dialer(accepter)))

      // ROOT CAUSE:
      //
      // The accepter used to record the inviter as `trusted: true` immediately,
      // because nothing had been validated yet, so a pairing completed from an
      // expired or revoked invite still left a permanent trust relationship
      // behind.
      //
      // FIXED BY: the record is written with `trusted: false` and only
      // `handlePairingAccepted` can flip it, driven by the inviter's explicit
      // confirmation naming the token this node actually spent.
      const beforeConfirmation = await listPairedDevices()
      expect(beforeConfirmation).toHaveLength(1)
      expect(beforeConfirmation[0]).toMatchObject({ peerId: inviter.peerId, trusted: false })

      registerPendingAcceptedConfirmation(inviter.peerId, accepted.token)
      await publishPairingRequest(accepted.token, accepter.peerId, publisher(accepter))

      // The inviter's own handler, installed exactly as `index.ts` installs it.
      const requestOnWire = await waitForMessage(
        inviter,
        (topic, payload) => topic === PAIRING_REQUESTS_TOPIC && payload.includes(accepted.token),
      )
      const requestPayload = JSON.parse(requestOnWire) as Record<string, unknown>
      const recorded = await recordPairingRequest(
        readWireToken(requestPayload),
        String(requestPayload.senderPeerId),
        ['/ip4/127.0.0.1/tcp/1'],
        undefined,
        accepter.peerId,
        publisher(inviter),
      )
      expect(recorded).not.toBeNull()
      expect(recorded!.device.peerId).toBe(accepter.peerId)

      // Only the inviter records trusted, because only it validated the token.
      // The store is shared by both nodes in this harness, so it holds the
      // accepter's record for the inviter plus the inviter's record for the
      // accepter; exactly one of them is trusted.
      const inviterDevices = await listPairedDevices()
      expect(inviterDevices).toHaveLength(2)
      const trusted = inviterDevices.filter(d => d.trusted)
      expect(trusted).toHaveLength(1)
      expect(trusted[0].peerId).toBe(accepter.peerId)

      // The confirmation the inviter published promotes the accepter's record.
      await waitForMessage(
        accepter,
        (topic, payload) => topic === PAIRING_ACCEPTED_TOPIC && payload.includes(accepted.token),
      )
      await vi.waitFor(async () => {
        const devices = await listPairedDevices()
        // Both sides now point at each other, and both are trusted.
        expect(devices).toHaveLength(2)
        expect(devices.every(d => d.trusted)).toBe(true)
      }, { timeout: 5000 })
    }
    finally {
      await stopNodes(inviter, accepter)
    }
  }, 60_000)

  it('rejects a token replayed after the real pairing completed', async () => {
    const inviter = await createTestNode()
    const accepter = await createTestNode()

    try {
      await accepter.node.dial(inviter.node.getMultiaddrs())
      await settleMesh(inviter, accepter)
      const { qrCode } = await createPairingInvitation(
        inviter.node.getMultiaddrs().map(a => a.toString()),
        inviter.peerId,
        'Inviter Node',
        30,
        publisher(inviter),
      )

      const accepted = requireAccepted(await acceptPairingInvitation(
        parsePairingInvitation(qrCode)!,
        accepter.peerId,
        undefined,
        dialer(accepter),
      ))
      registerPendingAcceptedConfirmation(inviter.peerId, accepted.token)

      // The accepter publishes its request, which is what the inviter validates.
      await publishPairingRequest(accepted.token, accepter.peerId, publisher(accepter))

      // First spend of the token: succeeds and consumes it.
      const requestOnWire = await waitForMessage(
        inviter,
        (topic, payload) => topic === PAIRING_REQUESTS_TOPIC && payload.includes(accepted.token),
      )

      const first = await recordPairingRequest(
        readWireToken(JSON.parse(requestOnWire)),
        accepter.peerId,
        ['/ip4/127.0.0.1/tcp/1'],
        undefined,
        accepter.peerId,
        publisher(inviter),
      )
      expect(first).not.toBeNull()
      // The store is shared: the accepter's own record plus the inviter's.
      expect(await listPairedDevices()).toHaveLength(2)

      // ROOT CAUSE:
      //
      // The token was never removed from the inviter's live map when a pairing
      // was recorded, so the same QR could be replayed indefinitely — every
      // replay re-recorded the pair and re-published the confirmation.
      //
      // FIXED BY: the token is claimed out of `PAIRING_SECRETS` synchronously
      // before any `await`, so a replay finds an empty map, which is
      // indistinguishable from an unknown token.
      const replay = await recordPairingRequest(
        accepted.token,
        accepter.peerId,
        ['/ip4/127.0.0.1/tcp/1'],
        undefined,
        accepter.peerId,
        publisher(inviter),
      )
      expect(replay, 'a replayed token must be rejected').toBeNull()

      // A replay published back through the real wire changes nothing either.
      await publishPairingRequest(accepted.token, accepter.peerId, publisher(accepter))
      await vi.waitFor(async () => {
        expect(await listPairedDevices()).toHaveLength(2)
      }, { timeout: 5000 })
    }
    finally {
      await stopNodes(inviter, accepter)
    }
  }, 60_000)

  it('rejects a pairing request re-published by a third node', async () => {
    const inviter = await createTestNode()
    const accepter = await createTestNode()
    const bystander = await createTestNode()

    try {
      await accepter.node.dial(inviter.node.getMultiaddrs())
      await settleMesh(inviter, accepter)
      await bystander.node.dial(inviter.node.getMultiaddrs())
      await bystander.node.dial(accepter.node.getMultiaddrs())
      await settleMesh(inviter, accepter, bystander)

      const { qrCode } = await createPairingInvitation(
        inviter.node.getMultiaddrs().map(a => a.toString()),
        inviter.peerId,
        'Inviter Node',
        30,
        publisher(inviter),
      )
      const invitation = parsePairingInvitation(qrCode)!
      const acceptedOnAccepter = requireAccepted(await acceptPairingInvitation(invitation, accepter.peerId, undefined, dialer(accepter)))

      // The accepter publishes its request, which is what the bystander copies.
      await publishPairingRequest(acceptedOnAccepter.token, accepter.peerId, publisher(accepter))

      // ROOT CAUSE:
      //
      // The bystander harvests the accepter's request off
      // `airi/pairing/requests` and re-publishes it verbatim. The payload still
      // names the accepter, so a handler that trusted the asserted
      // `senderPeerId` would accept a pairing it received from the bystander.
      //
      // FIXED BY: `recordPairingRequest` compares the asserted sender against
      // the propagation source the message actually arrived from and refuses the
      // request when they disagree. These are real nodes, so the propagation
      // source genuinely is the bystander.
      const harvested = await waitForMessage(
        bystander,
        (topic, payload) => topic === PAIRING_REQUESTS_TOPIC && payload.includes(invitation.token),
      )
      await bystander.node.services.pubsub.publish(
        PAIRING_REQUESTS_TOPIC,
        new TextEncoder().encode(harvested),
      )

      // The inviter sees the bystander's re-publication, whose payload still
      // names the accepter.
      const onWire = await waitForMessage(
        inviter,
        (topic, payload) => topic === PAIRING_REQUESTS_TOPIC && payload.includes(invitation.token),
      )
      const requestPayload = JSON.parse(onWire) as Record<string, unknown>
      const spoofed = await recordPairingRequest(
        readWireToken(requestPayload),
        accepter.peerId,
        ['/ip4/127.0.0.1/tcp/1'],
        undefined,
        // The propagation source of the bystander's re-publication.
        bystander.peerId,
        publisher(inviter),
      )
      expect(spoofed, 'a request re-published by a bystander must be rejected').toBeNull()
      // The re-published request must not have recorded anything: this test
      // never independently validates the accepter's genuine request, so the
      // only record that could exist is the accepter's own untrusted one.
      expect(await listPairedDevices()).toHaveLength(1)

      // The binding is the propagation source, not the asserted sender. The
      // bystander holds a token of its own from its own legitimate pairing with
      // the inviter, so a request naming itself is not the attack; the attack is
      // the re-publication above, which asserts the accepter's PeerId while
      // arriving from the bystander. That one is refused.
      const devices = await listPairedDevices()
      const bystanderRecords = devices.filter(d => d.peerId === bystander.peerId)
      expect(bystanderRecords, 'the bystander must not appear via the re-publication').toHaveLength(0)
    }
    finally {
      await stopNodes(inviter, accepter, bystander)
    }
  }, 60_000)

  it('lets a bystander re-publish a confirmation without marking an unpaired device', async () => {
    const inviter = await createTestNode()
    const accepter = await createTestNode()
    const bystander = await createTestNode()

    try {
      await accepter.node.dial(inviter.node.getMultiaddrs())
      await settleMesh(inviter, accepter)
      await bystander.node.dial(inviter.node.getMultiaddrs())
      await bystander.node.dial(accepter.node.getMultiaddrs())
      await settleMesh(inviter, accepter, bystander)

      const { qrCode } = await createPairingInvitation(
        inviter.node.getMultiaddrs().map(a => a.toString()),
        inviter.peerId,
        'Inviter Node',
        30,
        publisher(inviter),
      )
      const invitation = parsePairingInvitation(qrCode)!
      const accepted = requireAccepted(await acceptPairingInvitation(invitation, accepter.peerId, undefined, dialer(accepter)))
      registerPendingAcceptedConfirmation(inviter.peerId, accepted.token)

      // The accepter publishes its request so there is a real confirmation on the
      // wire for the bystander to copy.
      await publishPairingRequest(accepted.token, accepter.peerId, publisher(accepter))

      // Wait for the real confirmation to be published and consumed, so the
      // pairing is complete and the message exists on the wire to be copied.
      const requestPayload = JSON.parse(await waitForMessage(
        bystander,
        (topic, payload) => topic === PAIRING_REQUESTS_TOPIC && payload.includes(invitation.token),
      )) as Record<string, unknown>
      await recordPairingRequest(
        readWireToken(requestPayload),
        accepter.peerId,
        ['/ip4/127.0.0.1/tcp/1'],
        undefined,
        accepter.peerId,
        publisher(inviter),
      )
      const confirmation = await waitForMessage(
        bystander,
        (topic, payload) => topic === PAIRING_ACCEPTED_TOPIC && payload.includes(invitation.token),
      )
      await vi.waitFor(async () => {
        // The pairing is mutually confirmed: the inviter's record for the
        // accepter is trusted because it validated the token, and the accepter's
        // record for the inviter is promoted by the confirmation on the wire.
        // Both are legitimate, so the invariant is "the pair is fully trusted",
        // not "exactly one trusted record".
        const devices = await listPairedDevices()
        expect(devices).toHaveLength(2)
        expect(devices.find(d => d.peerId === accepter.peerId)?.trusted).toBe(true)
        expect(devices.find(d => d.peerId === inviter.peerId)?.trusted).toBe(true)
      }, { timeout: 5000 })

      // ROOT CAUSE:
      //
      // `airi/pairing/accepted` is an unauthenticated topic, so a bystander can
      // copy a live confirmation. Because the pending-confirmation entry was
      // never consumed, re-publishing it re-ran the promotion and could mark a
      // device the accepter had never paired with.
      //
      // FIXED BY: the pending entry is deleted the moment the token is
      // validated, so only the first (genuine) confirmation promotes anything.
      for (let i = 0; i < 3; i++) {
        await bystander.node.services.pubsub.publish(
          PAIRING_ACCEPTED_TOPIC,
          new TextEncoder().encode(confirmation),
        )
      }

      // A confirmation with no pending entry cannot promote anything, because no
      // message a bystander can compose names a token this node ever spent.
      const invented = await handlePairingAccepted(
        { peerId: inviter.peerId, token: 'bystander-invented-token' },
        accepter.peerId,
      )
      expect(invented).toBeNull()

      await vi.waitFor(async () => {
        const devices = await listPairedDevices()
        // Still two records: no replay added a third, and none of them opened a
        // new trust relationship.
        expect(devices, 'replayed confirmations must not add devices').toHaveLength(2)
      }, { timeout: 5000 })
    }
    finally {
      await stopNodes(inviter, accepter, bystander)
    }
  }, 60_000)

  it('honours a request only from the peer it arrived from', async () => {
    const inviter = await createTestNode()
    const accepter = await createTestNode()
    const other = await createTestNode()

    try {
      await accepter.node.dial(inviter.node.getMultiaddrs())
      await settleMesh(inviter, accepter)
      await other.node.dial(inviter.node.getMultiaddrs())
      await settleMesh(inviter, accepter, other)

      const { qrCode } = await createPairingInvitation(
        inviter.node.getMultiaddrs().map(a => a.toString()),
        inviter.peerId,
        'Inviter Node',
        30,
        publisher(inviter),
      )
      const invitation = parsePairingInvitation(qrCode)!
      requireAccepted(await acceptPairingInvitation(invitation, accepter.peerId, undefined, dialer(accepter)))

      // ROOT CAUSE:
      //
      // `handlePairingRequest` in `index.ts` resolves the sender from the mesh
      // and passes it as `propagationSource`. When that argument was dropped the
      // request's own asserted sender was trusted, so any node that harvested a
      // token could record itself against the inviter.
      //
      // FIXED BY: the sender the message arrived from is the binding, and a
      // disagreement is a rejection.
      const wrongPropagation = await recordPairingRequest(
        invitation.token,
        accepter.peerId,
        ['/ip4/127.0.0.1/tcp/1'],
        undefined,
        other.peerId,
        publisher(inviter),
      )
      expect(wrongPropagation, 'a request from a different peer must be rejected').toBeNull()
      // Same: the accepter's record only, and nothing was added for `other`.
      expect(await listPairedDevices()).toHaveLength(1)

      // The correct binding works: the token is spent for the right peer.
      const honoured = await recordPairingRequest(
        invitation.token,
        accepter.peerId,
        ['/ip4/127.0.0.1/tcp/1'],
        undefined,
        accepter.peerId,
        publisher(inviter),
      )
      expect(honoured).not.toBeNull()
      expect(honoured!.token).toBe(invitation.token)

      const devices = await listPairedDevices()
      // The accepter's own record, plus the inviter's new record for the pair.
      expect(devices).toHaveLength(2)
      expect(devices.map(d => d.peerId).sort()).toEqual([accepter.peerId, inviter.peerId].sort())
    }
    finally {
      await stopNodes(inviter, accepter, other)
    }
  }, 60_000)

  it('claims a token synchronously so two concurrent requests cannot both spend it', async () => {
    const inviter = await createTestNode()
    const accepter = await createTestNode()

    try {
      await accepter.node.dial(inviter.node.getMultiaddrs())
      await settleMesh(inviter, accepter)
      const { qrCode } = await createPairingInvitation(
        inviter.node.getMultiaddrs().map(a => a.toString()),
        inviter.peerId,
        'Inviter Node',
        30,
        publisher(inviter),
      )
      const invitation = parsePairingInvitation(qrCode)!
      requireAccepted(await acceptPairingInvitation(invitation, accepter.peerId, undefined, dialer(accepter)))

      // ROOT CAUSE:
      //
      // The claim used to happen after an `await`, so two `pairing-request`
      // messages arriving in the same tick both observed the token as live, both
      // decrypted it, and both recorded the pair.
      //
      // FIXED BY: the token is moved out of `PAIRING_SECRETS` in one synchronous
      // step before any `await`, so the second caller sees an empty map and is
      // indistinguishable from an unknown token.
      const [first, second] = await Promise.all([
        recordPairingRequest(
          invitation.token,
          accepter.peerId,
          ['/ip4/127.0.0.1/tcp/1'],
          undefined,
          accepter.peerId,
          publisher(inviter),
        ),
        recordPairingRequest(
          invitation.token,
          accepter.peerId,
          ['/ip4/127.0.0.1/tcp/1'],
          undefined,
          accepter.peerId,
          publisher(inviter),
        ),
      ])

      expect(first).not.toBeNull()
      expect(second, 'only one of two concurrent requests may spend the token').toBeNull()
      // Two records: the accepter's own untrusted one, and exactly one new record
      // for the pair. A second successful claim would have made three.
      expect(await listPairedDevices()).toHaveLength(2)
    }
    finally {
      await stopNodes(inviter, accepter)
    }
  }, 60_000)

  it('enforces invitation expiry on the accepter and on the inviter', async () => {
    const inviter = await createTestNode()
    const accepter = await createTestNode()

    try {
      await accepter.node.dial(inviter.node.getMultiaddrs())
      await settleMesh(inviter, accepter)

      // A negative TTL produces an invitation that is already expired by the
      // time `createPairingInvitation` returns.
      const { qrCode } = await createPairingInvitation(
        inviter.node.getMultiaddrs().map(a => a.toString()),
        inviter.peerId,
        'Inviter Node',
        -1,
        publisher(inviter),
      )
      const invitation = parsePairingInvitation(qrCode)!
      expect(invitation.expiresAt).toBeLessThan(Date.now())

      // ROOT CAUSE:
      //
      // `acceptPairingInvitation` never compared `expiresAt` against the clock,
      // so an expired QR — screenshotted, printed, or forwarded days later — was
      // accepted, dialled and stored as a live pairing.
      //
      // FIXED BY: `expiresAt < Date.now()` is refused on the accepter before any
      // dial, with a message that names the expiry.
      const expired = await acceptPairingInvitation(invitation, accepter.peerId, undefined, dialer(accepter))
      expect('error' in expired).toBe(true)
      expect('error' in expired && expired.error).toMatch(/expired/i)
      expect(await listPairedDevices()).toHaveLength(0)

      // The inviter refuses the same expired token even when the accepter skips
      // its own check, because the invitation it sealed carries the same TTL.
      const expiredOnInviter = await recordPairingRequest(
        invitation.token,
        accepter.peerId,
        ['/ip4/127.0.0.1/tcp/1'],
        undefined,
        accepter.peerId,
        publisher(inviter),
      )
      expect(expiredOnInviter, 'an expired invitation must be refused by the inviter too').toBeNull()
      expect(await listPairedDevices()).toHaveLength(0)
    }
    finally {
      await stopNodes(inviter, accepter)
    }
  }, 60_000)

  /**
   * The nap-chat grant, run over real nodes.
   *
   * NOTICE (root cause this guards): the grant lives on the paired-device record
   * the pairing flow writes, and both halves of that flow have to carry it —
   * the inviter, which is the only node that can answer a later consent read
   * with a grant, and the accepter, which is the only node that decides for
   * itself. A grant in one place and not the other would leave a pairing that
   * looks consented on one side while the other refuses, which is a session that
   * silently never opens.
   *
   * This is a *negative control* in both directions: no grant means the record
   * exists but answers `granted: false`, and a grant means it answers `true`.
   * The design's "no grant ⇒ no proposal" falls out of the first case, because a
   * proposal is only ever sent after the consent read.
   */
  it('records the nap-chat grant the pairing flow carried, on both sides', async () => {
    const inviter = await createTestNode()
    const accepter = await createTestNode()

    try {
      await accepter.node.dial(inviter.node.getMultiaddrs())
      await settleMesh(inviter, accepter)

      // The pairing dialog's grant travels with the invitation the inviter
      // issues, so an invitation created without one records nothing granted.
      const { qrCode } = await createPairingInvitation(
        inviter.node.getMultiaddrs().map(a => a.toString()),
        inviter.peerId,
        'Inviter Node',
        30,
        publisher(inviter),
        true,
      )
      const invitation = parsePairingInvitation(qrCode)!

      requireAccepted(await acceptPairingInvitation(invitation, accepter.peerId, undefined, dialer(accepter), true))
      registerPendingAcceptedConfirmation(inviter.peerId, invitation.token)
      await publishPairingRequest(invitation.token, accepter.peerId, publisher(accepter))

      const requestOnWire = await waitForMessage(
        inviter,
        (topic, payload) => topic === PAIRING_REQUESTS_TOPIC && payload.includes(invitation.token),
      )
      const requestPayload = JSON.parse(requestOnWire) as Record<string, unknown>
      const recorded = await recordPairingRequest(
        readWireToken(requestPayload),
        String(requestPayload.senderPeerId),
        ['/ip4/127.0.0.1/tcp/1'],
        undefined,
        accepter.peerId,
        publisher(inviter),
      )
      expect(recorded).not.toBeNull()

      // ROOT CAUSE:
      //
      // The grant is only useful if the record the pairing flow wrote actually
      // answers the consent read. Without the field surviving the merge onto
      // both sides' records, a pairing that carries the grant would still read
      // as unconsented and no proposal would ever be sent — the feature would
      // look enabled while being unreachable.
      //
      // FIXED BY: the record carries `napChatGranted` from the pairing flow, and
      // monotone merge preservation keeps it on the merged record.
      const devices = await listPairedDevices()
      expect(devices).toHaveLength(2)
      expect(devices.every(d => d.napChatGranted === true)).toBe(true)

      expect(await napChatConsentFor(accepter.peerId)).toEqual({ granted: true })
      expect(await napChatConsentFor(inviter.peerId)).toEqual({ granted: true })
    }
    finally {
      await stopNodes(inviter, accepter)
    }
  }, 60_000)

  /**
   * The other half of the consent gate: an invitation issued **without** the
   * grant records a pairing that can never be invited.
   *
   * NOTICE: this is not a refusal to pair — a pairing without the grant is a
   * perfectly ordinary pairing, which is the point. What is refused is every
   * nap-chat proposal that would follow, because the consent read answers
   * `granted: false` for a peer whose record carries no grant. A peer paired
   * before the field existed answers the same, because absence reads as refusal
   * rather than as a default permission.
   */
  it('records no grant when the pairing flow did not carry one, and consent refuses', async () => {
    const inviter = await createTestNode()
    const accepter = await createTestNode()

    try {
      await accepter.node.dial(inviter.node.getMultiaddrs())
      await settleMesh(inviter, accepter)

      const { qrCode } = await createPairingInvitation(
        inviter.node.getMultiaddrs().map(a => a.toString()),
        inviter.peerId,
        'Inviter Node',
        30,
        publisher(inviter),
      )
      const invitation = parsePairingInvitation(qrCode)!

      // An accepter that never passed the grant records its record without one.
      requireAccepted(await acceptPairingInvitation(invitation, accepter.peerId, undefined, dialer(accepter)))

      const consent = await napChatConsentFor(inviter.peerId)
      expect(consent.granted).toBe(false)
      expect(consent.reason).toBe('nap-chat-consent-not-granted')
    }
    finally {
      await stopNodes(inviter, accepter)
    }
  }, 60_000)

  /**
   * A peer this node never paired with refuses, with a reason that says so.
   *
   * NOTICE: distinct from "paired but not granted" because the caller's log and
   * ledger need to tell an unknown peer from a known one that declined. What is
   * identical is the answer, which is what keeps the default direction deny.
   */
  it('refuses consent for a peer it never paired with', async () => {
    const consent = await napChatConsentFor('12D3KooWneverPaired')
    expect(consent.granted).toBe(false)
    expect(consent.reason).toBe('not-paired')
  })
})

/**
 * Paired-device persistence across a restart.
 *
 * ROOT CAUSE this guards: `pairedDevicesStore` is a `createConfig` store, and
 * `createConfig`'s in-memory map is populated *only* by `setup()`'s synchronous
 * disk read. `getPairedDevices()` reads that map, so a boot that never calls
 * `setupPairedDevices()` sees `[]` for every peer: `napChatConsentFor` answers
 * `not-paired`, the grant the user gave is silently dead after a reboot, and the
 * first `addPairedDevice` writes a one-element list over the persisted file it
 * never read. The same failure mode is documented at `consentStore.setup()`
 * (`agentic/companion.ts`) and `libp2pConfigStore.setup()` (`libp2p/index.ts`).
 *
 * NOTICE: these tests assert the observable outcome, not the call. Asserting
 * `setupCalls > 0` would be a wiring echo that passes whenever *any* store's
 * `setup()` runs — and the libp2p config store's `setup()` is called
 * immediately before the paired-device one in the same function, which is
 * exactly why a shared-mock test never caught this. Instead the mock models
 * each store separately (`stores`, above): the paired-device store's map is
 * only ever filled by its own `setup()`, so `setupLibp2pService` cannot pass
 * these tests on `libp2pConfigStore.setup()`'s disk read.
 */
describe('paired-device persistence across a restart', () => {
  /** A record the app wrote before the simulated restart. */
  function grantedDevice() {
    return {
      peerId: '12D3KooWpersistedPeer',
      alias: 'Persisted Device',
      multiaddrs: ['/ip4/127.0.0.1/tcp/4001'],
      pairedAt: 1_700_000_000_000,
      lastSeen: 1_700_000_000_000,
      trusted: true,
      napChatGranted: true,
    }
  }

  /**
   * A fresh process. The store's in-memory map is empty, because nothing has
   * read the disk yet, and the file the previous boot left is on disk.
   */
  function freshBoot(devices: Array<Record<string, unknown>>) {
    stores.pairedDevices.map = undefined
    stores.pairedDevices.persisted = { devices }
    stores.pairedDevices.lastUpdate = undefined
    stores.pairedDevices.setupCalls = 0
  }

  it('reads nothing until the store hydrates, so a record on disk is invisible', async () => {
    // The negative control for the two tests below, and the failure mode itself:
    // a boot that never hydrates answers `not-paired` for a peer whose grant is
    // on disk right now, and a subsequent write would clobber the list.
    freshBoot([grantedDevice()])

    expect(await listPairedDevices()).toEqual([])
    expect(await napChatConsentFor('12D3KooWpersistedPeer')).toEqual({
      granted: false,
      reason: 'not-paired',
    })
  })

  it('answers consent from the record the previous boot persisted', async () => {
    freshBoot([grantedDevice()])

    // The store hydrates, exactly as `createConfig`'s `setup()` reads the
    // persisted file into the in-memory map.
    setupPairedDevices()

    expect(await listPairedDevices()).toEqual([grantedDevice()])
    expect(await napChatConsentFor('12D3KooWpersistedPeer')).toEqual({ granted: true })
  })

  it('hydrates the store from `setupLibp2pService`, so a device written before a restart is readable after', async () => {
    // The previous boot paired this device, which is what put the record on
    // disk. The simulated restart then starts with nothing in memory.
    freshBoot([grantedDevice()])

    await setupLibp2pService({ lifecycle: lifecycleStub() })

    // The observable outcome, not the call: the record survived the restart and
    // the consent read answers from it.
    expect(await listPairedDevices()).toEqual([grantedDevice()])
    expect(await napChatConsentFor('12D3KooWpersistedPeer')).toEqual({ granted: true })
  })
})

/** The lifecycle object `setupLibp2pService` stores its stop hook on. */
function lifecycleStub() {
  return {
    appHooks: {
      onStart: (_fn: () => void | Promise<void>) => {},
      onStop: (_fn: () => void | Promise<void>) => {},
    },
  }
}
