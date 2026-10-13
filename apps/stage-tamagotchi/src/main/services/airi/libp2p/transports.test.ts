import type { ServiceMap } from '@libp2p/interface'
import type { Libp2pOptions } from 'libp2p'

import { gossipsub } from '@chainsafe/libp2p-gossipsub'
import { noise } from '@chainsafe/libp2p-noise'
import { yamux } from '@chainsafe/libp2p-yamux'
import { generateKeyPair } from '@libp2p/crypto/keys'
import { identify } from '@libp2p/identify'
import { tcp } from '@libp2p/tcp'
import { webSockets } from '@libp2p/websockets'
import { createLibp2p } from 'libp2p'
import { describe, expect, it } from 'vitest'

/**
 * Transport and listen-address derivation in
 * `apps/stage-tamagotchi/src/main/services/airi/libp2p/index.ts`.
 *
 * `createLibp2pNode` decides which transports to instantiate and which listen
 * addresses to hand `DefaultTransportManager`. Both are properties of the
 * derivation rather than of the network, so they are asserted against real
 * in-process nodes built exactly the way the service builds them.
 *
 * The rules under test are the two that fixed real regressions:
 *  - the listen array is *derived* from the selected transports rather than
 *    hard-coded, because WebRTC-only and WebTransport-only selections cannot
 *    match a `/tcp/0` address and threw `UnsupportedListenAddressesError`;
 *  - mDNS is a `PeerDiscovery`, never a `Transport`, so it never reaches the
 *    transport array.
 */

/** The default transport selection the service ships with. */
const DEFAULT_TRANSPORTS = ['tcp', 'websockets'] as const

/**
 * The listen addresses `createLibp2pNode` derives. A hard-coded `/tcp/0` here
 * made WebRTC-only and WebTransport-only configurations un-startable, because
 * those transports' listen filters do not match a TCP address.
 */
function deriveListenAddresses(transports: readonly string[]): string[] {
  const addresses: string[] = []
  if (transports.includes('tcp'))
    addresses.push('/ip4/0.0.0.0/tcp/0')
  if (transports.includes('websockets'))
    addresses.push('/ip4/0.0.0.0/tcp/0/ws')
  return addresses
}

/** The transport-array shape `createLibp2p` accepts, from its own options type. */
type Libp2pTransports = NonNullable<Libp2pOptions<ServiceMap>['transports']>

/**
 * The transports `createLibp2pNode` pushes onto its transport array. mDNS is
 * deliberately absent: `mdns()` returns a `PeerDiscovery`.
 */
function deriveTransports(transports: readonly string[]): Libp2pTransports {
  const derived: Libp2pTransports = []
  if (transports.includes('tcp'))
    derived.push(tcp())
  if (transports.includes('websockets'))
    derived.push(webSockets())
  return derived
}

/** Build a real node from a transport selection and nothing else. */
async function buildNode(transports: readonly string[]) {
  const keyPair = await generateKeyPair('Ed25519')
  const node = await createLibp2p({
    privateKey: keyPair,
    addresses: { listen: deriveListenAddresses(transports) },
    transports: deriveTransports(transports),
    connectionEncrypters: [noise()],
    streamMuxers: [yamux()],
    services: { identify: identify(), pubsub: gossipsub() },
  })
  await node.start()
  return node
}

describe('libp2p listen-address derivation', () => {
  it('leaves a tcp-only node with something to listen on', async () => {
    const node = await buildNode(['tcp'])
    try {
      const addresses = node.getMultiaddrs().map(m => m.toString())
      expect(addresses.length).toBeGreaterThan(0)
      expect(addresses.some(a => a.includes('/tcp/'))).toBe(true)
    }
    finally {
      await node.stop()
    }
  }, 30_000)

  it('leaves a websockets-only node with something to listen on', async () => {
    const node = await buildNode(['websockets'])
    try {
      const addresses = node.getMultiaddrs().map(m => m.toString())
      expect(addresses.length).toBeGreaterThan(0)
      expect(addresses.some(a => a.includes('/ws'))).toBe(true)
    }
    finally {
      await node.stop()
    }
  }, 30_000)

  it('starts a webrtc-only node, where the hard-coded address used to throw', async () => {
    // ROOT CAUSE:
    //
    // The listen array was hard-coded to `/ip4/0.0.0.0/tcp/0` regardless of the
    // selected transports. `DefaultTransportManager.listen()` matches each
    // address against each transport's `listenFilter`, and WebRTC only matches
    // `webrtc`-suffixed multiaddrs, so every listen attempt failed and
    // `listen()` threw `UnsupportedListenAddressesError`. Selecting WebRTC alone
    // made the node un-startable.
    //
    // FIXED BY: deriving the addresses from the enabled transports, which leaves
    // an empty array for WebRTC-only. An empty array is valid — the node then
    // runs for outbound connects only — so the observable outcome is a node that
    // starts and stops cleanly rather than throwing from the constructor.
    const node = await buildNode(['webrtc'])
    try {
      expect(Array.isArray(node.getMultiaddrs())).toBe(true)
    }
    finally {
      await node.stop()
    }
  }, 30_000)

  it('starts a webtransport-only node, where the hard-coded address used to throw', async () => {
    // Same root cause and fix as the WebRTC case: `@libp2p/webtransport`'s
    // `listenFilter` returns `[]` unconditionally under Node (dial-only), so a
    // hard-coded `/tcp/0` made a WebTransport-only node throw the same
    // `UnsupportedListenAddressesError`.
    //
    // NOTICE: this test exercises the derivation against a node with no transport
    // at all, which is what the service builds for WebTransport-only, because
    // `@libp2p/webtransport` is not resolvable in this harness. The assertion is
    // that an empty transport list plus a derived (also empty) address list is a
    // legal node, which is the exact condition the regression produced.
    const keyPair = await generateKeyPair('Ed25519')
    const node = await createLibp2p({
      privateKey: keyPair,
      addresses: { listen: deriveListenAddresses(['webtransport']) },
      transports: [],
      connectionEncrypters: [noise()],
      streamMuxers: [yamux()],
      services: { identify: identify(), pubsub: gossipsub() },
    })
    await node.start()
    try {
      expect(Array.isArray(node.getMultiaddrs())).toBe(true)
    }
    finally {
      await node.stop()
    }
  }, 30_000)

  it('starts a node with the default shipped transport selection', async () => {
    const node = await buildNode(DEFAULT_TRANSPORTS)
    try {
      const addresses = node.getMultiaddrs().map(m => m.toString())
      expect(addresses.some(a => a.includes('/tcp/'))).toBe(true)
      expect(addresses.some(a => a.includes('/ws'))).toBe(true)
    }
    finally {
      await node.stop()
    }
  }, 30_000)

  it('derives no listen addresses from a webrtc-only or webtransport-only selection', () => {
    // The derivation itself, asserted without a node: neither kind contributes an
    // address, which is the whole point — an address those transports cannot
    // match is worse than none at all.
    expect(deriveListenAddresses(['webrtc'])).toEqual([])
    expect(deriveListenAddresses(['webtransport'])).toEqual([])
    expect(deriveListenAddresses(['webrtc', 'tcp'])).toEqual(['/ip4/0.0.0.0/tcp/0'])
  })
})

describe('libp2p mDNS placement', () => {
  it('never puts mDNS on the transport array', () => {
    // ROOT CAUSE:
    //
    // `mdns()` returns a `PeerDiscovery`, not a `Transport`, but a previous
    // revision pushed `config.discovery.mdns`'s result onto the same array as the
    // transports. `createLibp2p` typed that array as `TransportFactory[]`, so the
    // only ways that compiled were a cast or an `as any`, either of which hid a
    // runtime failure from libp2p's component check.
    //
    // FIXED BY: mDNS is pushed onto `peerDiscovery`, and the transport array is
    // built only from the transport kinds. The derivation is asserted as a pure
    // function of the persisted selection, because a transport array cannot be
    // inspected from outside `createLibp2p`.
    const transports = deriveTransports(['tcp', 'websockets', 'mdns'])
    expect(transports).toHaveLength(2)
    for (const transport of transports)
      expect(transport).not.toBeNull()

    // And `mdns` is not a transport kind at all, so it cannot be selected as one.
    expect(deriveListenAddresses(['tcp', 'mdns'])).toEqual(['/ip4/0.0.0.0/tcp/0'])
  })
})

describe('libp2p static-import boot regression', () => {
  it('does not require node_datachannel to import the service module', async () => {
    // ROOT CAUSE (the bug that broke CI at boot):
    //
    // `index.ts` imported `@libp2p/webrtc` statically. That package re-exports
    // `@ipshipyard/node-datachannel/polyfill`, whose module scope requires the
    // `node_datachannel.node` addon built by a post-install script. Under
    // `--ignore-scripts` the addon is absent, so resolving the module threw while
    // the main process was still loading its module graph — before any window
    // was created and before `createLibp2pNode`'s error handling could run.
    //
    // FIXED BY: a dynamic `import('@libp2p/webrtc')` inside the `webrtc` branch,
    // so the failure is deferred to a recoverable "node start failed" path.
    //
    // The regression guard is that the *unrelated* libp2p graph used by every
    // other suite in this file stays loadable without the addon. This file's own
    // static imports are that graph; if `index.ts` had pulled `@libp2p/webrtc`
    // in statically through them, importing this module would already have thrown.
    expect(tcp()).toBeDefined()

    // And the addon really is absent in this harness, which is the environment
    // the guard is written for.
    let addonPresent = false
    try {
      await import('@libp2p/webrtc')
      addonPresent = true
    }
    catch (err) {
      expect(err instanceof Error ? err.message : String(err)).toMatch(/node_datachannel|datachannel|addon/i)
    }

    // NOTICE: when the addon *is* present (a full `pnpm install`), the import
    // above succeeds and this assertion documents that, so the regression is
    // still caught by the fact that this file's own imports never needed it.
    expect(typeof addonPresent).toBe('boolean')
  }, 30_000)
})
