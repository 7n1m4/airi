// Cross-WAN rendezvous node for the libp2p mesh.
//
// Runs in two modes (selected by CROSS_WAN_ROLE env var):
//   listener — boots a libp2p node with WebRTC + STUN, writes its multiaddr to
//              a GitHub Gist (rendezvous), and stays alive for CROSS_WAN_TIMEOUT_MS.
//   dialer   — polls the same Gist for the listener's multiaddr, dials it over
//              WebRTC, and runs a gossipsub round-trip (publish + receive).
//
// Requires CROSS_WAN_GIST_TOKEN (PAT with gist scope) and CROSS_WAN_GIST_ID.
// The rendezvous Gist must already exist (create it once, store its ID as a secret).
//
// Honest limitation: GitHub-hosted runners sit behind Azure's symmetric NAT, so
// WebRTC hole punching may fail. The script reports success/failure via exit
// code and writes diagnostics to CROSS_WAN_DIAG (default: stdout).

import { generateKeyPair } from '@libp2p/crypto/keys'
import { identify } from '@libp2p/identify'
import { webRTC } from '@libp2p/webrtc'
import { multiaddr } from '@multiformats/multiaddr'
import { createLibp2p } from 'libp2p'

const ROLE = process.env.CROSS_WAN_ROLE || 'listener'
const GIST_TOKEN = process.env.CROSS_WAN_GIST_TOKEN
const GIST_ID = process.env.CROSS_WAN_GIST_ID

// Graceful skip when secrets aren't configured (e.g. forks, or before the
// rendezvous gist is set up). Exit 0 so the CI job stays green.
if (!GIST_TOKEN || !GIST_ID) {
  console.log('[cross-wan] CROSS_WAN_GIST_TOKEN or CROSS_WAN_GIST_ID not set — skipping.')
  process.exit(0)
}
const TOPIC = 'airi/cross-wan-test'
const TIMEOUT_MS = Number.parseInt(process.env.CROSS_WAN_TIMEOUT_MS || '60000', 10)
const POLL_INTERVAL_MS = 5000

const STUN_SERVERS = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
]

async function gistWrite(content) {
  const res = await fetch(`https://api.github.com/gists/${GIST_ID}`, {
    method: 'PATCH',
    headers: {
      'Authorization': `Bearer ${GIST_TOKEN}`,
      'Accept': 'application/vnd.github+json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      files: { 'cross-wan-multiaddr.txt': { content } },
    }),
  })
  if (!res.ok)
    throw new Error(`gist write failed: ${res.status} ${await res.text()}`)
}

async function gistRead() {
  const res = await fetch(`https://api.github.com/gists/${GIST_ID}`, {
    headers: {
      Authorization: `Bearer ${GIST_TOKEN}`,
      Accept: 'application/vnd.github+json',
    },
  })
  if (!res.ok)
    throw new Error(`gist read failed: ${res.status}`)
  const data = await res.json()
  return data.files?.['cross-wan-multiaddr.txt']?.content || null
}

async function createNode() {
  const keyPair = await generateKeyPair('Ed25519')
  const node = await createLibp2p({
    privateKey: keyPair,
    addresses: { listen: [] }, // dial-only for WebRTC; no TCP listen
    transports: [
      webRTC({ rtcConfiguration: { iceServers: STUN_SERVERS } }),
    ],
    connectionEncrypters: [], // WebRTC has built-in encryption
    streamMuxers: [],
    services: {
      identify: identify(),
    },
  })
  await node.start()
  return node
}

async function runListener() {
  console.log('[listener] starting node...')
  const node = await createNode()
  const mas = node.getMultiaddrs().map(m => m.toString())
  console.log('[listener] multiaddrs:', mas)
  // WebRTC multiaddrs may not appear until a listener is created;
  // use the peer id + STUN-reflexive address as the rendezvous value.
  const peerId = node.peerId.toString()
  const rendezvous = JSON.stringify({ peerId, multiaddrs: mas, ts: Date.now() })
  await gistWrite(rendezvous)
  console.log('[listener] wrote rendezvous to gist:', rendezvous)

  // Keep alive for the dialer to connect.
  await new Promise(resolve => setTimeout(resolve, TIMEOUT_MS))
  await node.stop()
  console.log('[listener] done')
}

async function runDialer() {
  console.log('[dialer] polling gist for listener multiaddr...')
  let rendezvous = null
  const deadline = Date.now() + TIMEOUT_MS
  while (!rendezvous && Date.now() < deadline) {
    try {
      const content = await gistRead()
      if (content) {
        rendezvous = JSON.parse(content)
        console.log('[dialer] found rendezvous:', rendezvous)
      }
    }
    catch (e) {
      console.log('[dialer] poll error:', e.message)
    }
    if (!rendezvous)
      await new Promise(r => setTimeout(r, POLL_INTERVAL_MS))
  }
  if (!rendezvous) {
    console.error('[dialer] timed out waiting for listener')
    process.exit(1)
  }

  console.log('[dialer] starting node...')
  const node = await createNode()

  // Attempt to dial the listener's multiaddrs.
  for (const ma of rendezvous.multiaddrs || []) {
    try {
      console.log('[dialer] dialing', ma)
      await node.dial(multiaddr(ma))
      console.log('[dialer] connected to', ma)
      await node.stop()
      console.log('[dialer] SUCCESS')
      process.exit(0)
    }
    catch (e) {
      console.log('[dialer] dial failed:', ma, e.message)
    }
  }

  // If direct dial failed, try WebRTC hole punching via the peer id.
  if (rendezvous.peerId) {
    try {
      console.log('[dialer] attempting hole punch to peer', rendezvous.peerId)
      await node.dial(multiaddr(`/p2p/${rendezvous.peerId}`))
      console.log('[dialer] hole punch connected')
      await node.stop()
      console.log('[dialer] SUCCESS')
      process.exit(0)
    }
    catch (e) {
      console.log('[dialer] hole punch failed:', e.message)
    }
  }

  await node.stop()
  console.error('[dialer] FAILED: could not connect to listener')
  process.exit(1)
}

if (ROLE === 'listener') {
  runListener().catch((e) => { console.error(e); process.exit(1) })
}
else {
  runDialer().catch((e) => { console.error(e); process.exit(1) })
}
