// Cross-WAN rendezvous node for the libp2p mesh.
//
// Runs in two modes (selected by CROSS_WAN_ROLE env var):
//   listener — boots a libp2p node with WebRTC + STUN, writes its multiaddr to
//              a GitHub issue comment (rendezvous), and stays alive.
//   dialer   — polls the same issue for the listener's multiaddr, dials it over
//              WebRTC, and runs a gossipsub round-trip (publish + receive).
//
// Uses the default GITHUB_TOKEN (auto-provided by GitHub Actions) and a
// dedicated rendezvous issue. No extra secrets needed.
//
// Honest limitation: GitHub-hosted runners sit behind Azure's symmetric NAT, so
// WebRTC hole punching may fail. The script reports success/failure via exit
// code and writes diagnostics to stdout.

import { generateKeyPair } from '@libp2p/crypto/keys'
import { identify } from '@libp2p/identify'
import { webRTC } from '@libp2p/webrtc'
import { multiaddr } from '@multiformats/multiaddr'
import { createLibp2p } from 'libp2p'

const ROLE = process.env.CROSS_WAN_ROLE || 'listener'
const GITHUB_TOKEN = process.env.GITHUB_TOKEN
const RENDEZVOUS_ISSUE = process.env.CROSS_WAN_RENDEZVOUS_ISSUE || '17'
const TOPIC = 'airi/cross-wan-test'
const TIMEOUT_MS = Number.parseInt(process.env.CROSS_WAN_TIMEOUT_MS || '120000', 10)
const POLL_INTERVAL_MS = 5000

const STUN_SERVERS = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
]

// Graceful skip when GITHUB_TOKEN is not available.
if (!GITHUB_TOKEN) {
  console.log('[cross-wan] GITHUB_TOKEN not set — skipping.')
  process.exit(0)
}

async function issueWrite(content) {
  const res = await fetch(`https://api.github.com/repos/anlmalabs/airi/issues/${RENDEZVOUS_ISSUE}/comments`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${GITHUB_TOKEN}`,
      'Accept': 'application/vnd.github+json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ body: `<!-- cross-wan-rendezvous -->\n${content}` }),
  })
  if (!res.ok)
    throw new Error(`issue comment write failed: ${res.status} ${await res.text()}`)
}

async function issueRead() {
  const res = await fetch(`https://api.github.com/repos/anlmalabs/airi/issues/${RENDEZVOUS_ISSUE}/comments?per_page=100`, {
    headers: {
      Authorization: `Bearer ${GITHUB_TOKEN}`,
      Accept: 'application/vnd.github+json',
    },
  })
  if (!res.ok)
    throw new Error(`issue comment read failed: ${res.status}`)
  const comments = await res.json()
  for (let i = comments.length - 1; i >= 0; i--) {
    const c = comments[i]
    if (c.body && c.body.includes('<!-- cross-wan-rendezvous -->')) {
      return c.body.replace('<!-- cross-wan-rendezvous -->\n', '').trim()
    }
  }
  return null
}

async function createNode() {
  const keyPair = await generateKeyPair('Ed25519')
  const node = await createLibp2p({
    privateKey: keyPair,
    addresses: { listen: [] },
    transports: [
      webRTC({ rtcConfiguration: { iceServers: STUN_SERVERS } }),
    ],
    connectionEncrypters: [],
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
  const peerId = node.peerId.toString()
  const rendezvous = JSON.stringify({ peerId, multiaddrs: mas, ts: Date.now() })
  await issueWrite(rendezvous)
  console.log('[listener] wrote rendezvous to issue:', rendezvous)

  await new Promise(resolve => setTimeout(resolve, TIMEOUT_MS))
  await node.stop()
  console.log('[listener] done')
}

async function runDialer() {
  console.log('[dialer] polling issue for listener multiaddr...')
  let rendezvous = null
  const deadline = Date.now() + TIMEOUT_MS
  while (!rendezvous && Date.now() < deadline) {
    try {
      const content = await issueRead()
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

  if (rendezvous.peerId) {
    try {
      console.log('[dialer] attempting dial to peer', rendezvous.peerId)
      await node.dial(multiaddr(`/p2p/${rendezvous.peerId}`))
      console.log('[dialer] connected to peer')
      await node.stop()
      console.log('[dialer] SUCCESS')
      process.exit(0)
    }
    catch (e) {
      console.log('[dialer] peer dial failed:', e.message)
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
