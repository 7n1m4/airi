// Cross-WAN rendezvous node for the libp2p mesh.
//
// Every runner plays the same role: it boots a libp2p node behind a public
// tunnel, publishes its public WSS multiaddr to the rendezvous issue, and then
// dials the other runners it finds there.
//
// Why every runner needs its own tunnel: a tunnel is an *outbound* connection
// to a public edge, and the edge dials back in. That is what makes a node
// reachable from a runner that sits behind a symmetric NAT and can only dial
// out. One tunnel per node also keeps every libp2p connection riding a
// single tunnel — a shared tunnel that has to carry two connections at once
// deadlocks the protocol negotiation.
//
// Why not WebRTC/STUN: GitHub-hosted runners sit behind Azure's symmetric
// NAT. No side can accept an inbound connection, and hole punching fails
// against a symmetric NAT, so STUN buys nothing.
//
// Tunnel backends, tried in the order listed in CROSS_WAN_TUNNEL until one
// actually routes to the node:
//   cloudflared — an anonymous cloudflared quick tunnel (trycloudflare.com).
//                 No account, no named tunnel. Its edge sometimes answers 530
//                 / error 1033 for a freshly created hostname, so it is probed
//                 before being trusted.
//   pinggy      — a reverse tunnel through pinggy (*.free.pinggy.net).
//   ssh         — a reverse tunnel through localhost.run (*.lhr.life).
//
// Rendezvous: a dedicated GitHub issue (see CROSS_WAN_RENDEZVOUS_ISSUE). The
// default GITHUB_TOKEN (auto-provided by GitHub Actions) is enough — no extra
// secrets, no cloud account, no named tunnel.

import process from 'node:process'

import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'

import { gossipsub } from '@chainsafe/libp2p-gossipsub'
import { noise } from '@chainsafe/libp2p-noise'
import { yamux } from '@chainsafe/libp2p-yamux'
import { generateKeyPair } from '@libp2p/crypto/keys'
import { identify } from '@libp2p/identify'
import { ping } from '@libp2p/ping'
import { webSockets } from '@libp2p/websockets'
import { multiaddr } from '@multiformats/multiaddr'
import { createLibp2p } from 'libp2p'

const ROLE = process.env.CROSS_WAN_ROLE || 'peer'
const CHANNEL = process.env.CROSS_WAN_CHANNEL || 'default'
const GITHUB_TOKEN = process.env.GITHUB_TOKEN
const REPO = process.env.CROSS_WAN_REPO || 'anlmalabs/airi'
const RENDEZVOUS_ISSUE = process.env.CROSS_WAN_RENDEZVOUS_ISSUE || '17'
const TOPIC = 'airi/cross-wan-test'
const TIMEOUT_MS = Number.parseInt(process.env.CROSS_WAN_TIMEOUT_MS || '240000', 10)
const ROUND_TRIP_TIMEOUT_MS = Number.parseInt(process.env.CROSS_WAN_ROUND_TRIP_TIMEOUT_MS || '120000', 10)
const POLL_INTERVAL_MS = Number.parseInt(process.env.CROSS_WAN_POLL_INTERVAL_MS || '5000', 10)
const EXPECTED_PEERS = Number.parseInt(process.env.CROSS_WAN_EXPECTED_PEERS || '1', 10)
const CLOUDFLARED_BIN = process.env.CLOUDFLARED_BIN || 'cloudflared'
const TUNNEL_BACKENDS = (process.env.CROSS_WAN_TUNNEL || 'cloudflared,pinggy,ssh')
  .split(',')
  .map(name => name.trim())
  .filter(Boolean)
const TUNNEL_PROBE_TIMEOUT_MS = Number.parseInt(process.env.CROSS_WAN_TUNNEL_PROBE_TIMEOUT_MS || '45000', 10)
const RUN_ID = process.env.GITHUB_RUN_ID || `local-${randomUUID().slice(0, 8)}`

const RENDEZVOUS_MARKER = '<!-- cross-wan-rendezvous -->'
const PUBLISH_INTERVAL_MS = 2000
const SETTLE_MS = 3000

if (!GITHUB_TOKEN) {
  console.info('[cross-wan] GITHUB_TOKEN not set — skipping.')
  process.exit(0)
}

async function githubApi(path, options = {}) {
  const res = await fetch(`https://api.github.com${path}`, {
    ...options,
    headers: {
      'Authorization': `Bearer ${GITHUB_TOKEN}`,
      'Accept': 'application/vnd.github+json',
      'Content-Type': 'application/json',
      ...options.headers,
    },
  })
  if (!res.ok)
    throw new Error(`github api ${path} failed: ${res.status} ${await res.text()}`)
  return res.json()
}

async function postComment(body) {
  await githubApi(`/repos/${REPO}/issues/${RENDEZVOUS_ISSUE}/comments`, {
    method: 'POST',
    body: JSON.stringify({ body }),
  })
}

/** Write this node's rendezvous record as a marked issue comment. */
async function writeRendezvous(record) {
  await postComment(`${RENDEZVOUS_MARKER}\n${JSON.stringify(record)}`)
}

/**
 * Read every rendezvous record on the issue, oldest first. Records are plain
 * JSON behind a marker so the issue stays readable in a browser while still
 * being machine-parseable.
 */
async function readRendezvous() {
  const records = []
  for (let page = 1; page <= 5; page++) {
    const comments = await githubApi(`/repos/${REPO}/issues/${RENDEZVOUS_ISSUE}/comments?per_page=100&page=${page}`)
    if (!Array.isArray(comments) || comments.length === 0)
      break
    for (const comment of comments) {
      const body = comment.body || ''
      const at = body.indexOf(RENDEZVOUS_MARKER)
      if (at === -1)
        continue
      try {
        const record = JSON.parse(body.slice(at + RENDEZVOUS_MARKER.length).trim())
        if (record && typeof record.peerId === 'string')
          records.push(record)
      }
      catch {
        // A hand-edited comment is not a rendezvous record — ignore it.
      }
    }
    if (comments.length < 100)
      break
  }
  return records
}

async function journal(body) {
  try {
    await postComment(body)
  }
  catch (error) {
    console.error('[cross-wan] journal post failed:', error.message)
  }
}

/** Match a CSI escape sequence without embedding a raw control character. */
const ANSI_ESCAPE = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*[a-z]`, 'gi')

/** Strip ANSI escapes so a URL can be matched out of a decorated banner. */
function stripAnsi(text) {
  return text.replace(ANSI_ESCAPE, '')
}

/**
 * Spawn a tunnel process and resolve once its banner advertises a public
 * hostname.
 */
function spawnTunnel(command, args, hostPattern) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'] })
    let buffer = ''
    let settled = false
    const onData = (chunk) => {
      buffer += stripAnsi(chunk.toString())
      const match = buffer.match(hostPattern)
      if (match && !settled) {
        settled = true
        resolve({ child, host: match[1] })
      }
    }
    child.stdout.on('data', onData)
    child.stderr.on('data', onData)
    child.on('error', (error) => {
      if (!settled) {
        settled = true
        reject(new Error(`failed to spawn ${command}: ${error.message}`))
      }
    })
    child.on('exit', (code) => {
      if (!settled) {
        settled = true
        reject(new Error(`${command} exited with code ${code} before advertising a hostname`))
      }
    })
  })
}

function startCloudflaredTunnel(originPort) {
  return spawnTunnel(
    CLOUDFLARED_BIN,
    ['tunnel', '--no-autoupdate', '--url', `http://127.0.0.1:${originPort}`],
    /https:\/\/([a-z0-9-]+\.trycloudflare\.com)/i,
  )
}

function startPinggyTunnel(originPort) {
  return spawnTunnel(
    'ssh',
    [
      '-p',
      '443',
      '-o',
      'StrictHostKeyChecking=no',
      '-o',
      'UserKnownHostsFile=/dev/null',
      '-o',
      'ExitOnForwardFailure=yes',
      '-o',
      'ServerAliveInterval=30',
      '-R',
      `0:localhost:${originPort}`,
      'a.pinggy.io',
    ],
    /https:\/\/([a-z0-9-]+\.free\.pinggy\.net)/i,
  )
}

function startSshTunnel(originPort) {
  return spawnTunnel(
    'ssh',
    [
      '-o',
      'StrictHostKeyChecking=no',
      '-o',
      'UserKnownHostsFile=/dev/null',
      '-o',
      'ExitOnForwardFailure=yes',
      '-o',
      'ServerAliveInterval=30',
      '-R',
      `80:localhost:${originPort}`,
      'nokey@localhost.run',
    ],
    /https:\/\/([a-z0-9.-]+\.lhr\.life)/i,
  )
}

const TUNNEL_FACTORIES = {
  cloudflared: startCloudflaredTunnel,
  pinggy: startPinggyTunnel,
  ssh: startSshTunnel,
}

/**
 * Probe the tunnel by asking the origin for a plain HTTP request. The libp2p
 * WebSockets listener answers anything that is not an upgrade with
 * `400 Only WebSocket connections are supported`, so a 400 proves the tunnel
 * is actually routing traffic to this node. A broken quick tunnel answers 530
 * / error 1033 from Cloudflare's edge instead, and a hostname that has not
 * propagated yet fails to resolve at all.
 */
async function probeTunnel(host, timeoutMs) {
  const deadline = Date.now() + timeoutMs
  let last = 'no attempt'
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`https://${host}/`, { signal: AbortSignal.timeout(10000) })
      last = `HTTP ${res.status}`
      if (res.status === 400) {
        console.info(`[tunnel] ${host} is routing to the node (${last})`)
        return true
      }
    }
    catch (error) {
      last = error.cause?.code || error.message
    }
    await new Promise(resolve => setTimeout(resolve, 3000))
  }
  console.error(`[tunnel] probe of ${host} failed (last: ${last})`)
  return false
}

/**
 * Bring up the first tunnel backend that actually routes to this node.
 * Backends that cannot be started or fail their probe are torn down and the
 * next one is tried.
 */
async function openTunnel(originPort) {
  for (const name of TUNNEL_BACKENDS) {
    const factory = TUNNEL_FACTORIES[name]
    if (!factory) {
      console.warn(`[tunnel] unknown backend "${name}" — skipping`)
      continue
    }
    console.info(`[tunnel] trying backend "${name}"...`)
    let tunnel = null
    try {
      tunnel = await factory(originPort)
    }
    catch (error) {
      console.error(`[tunnel] backend "${name}" failed to start: ${error.message}`)
      continue
    }
    console.info(`[tunnel] backend "${name}" advertised ${tunnel.host}`)
    if (await probeTunnel(tunnel.host, TUNNEL_PROBE_TIMEOUT_MS)) {
      return { ...tunnel, backend: name }
    }
    console.error(`[tunnel] backend "${name}" did not route to the node — trying the next one`)
    try {
      tunnel.child.kill('SIGTERM')
    }
    catch {
      // The tunnel process is already gone.
    }
  }
  throw new Error(`no tunnel backend could route to the node (tried: ${TUNNEL_BACKENDS.join(', ')})`)
}

async function createNode(listen) {
  const keyPair = await generateKeyPair('Ed25519')
  const node = await createLibp2p({
    privateKey: keyPair,
    addresses: { listen },
    transports: [webSockets()],
    connectionEncrypters: [noise()],
    streamMuxers: [yamux()],
    services: {
      pubsub: gossipsub({
        // Publishing before the peer's subscription propagates must not throw —
        // the round trip retries until the mesh forms.
        allowPublishToZeroTopicPeers: true,
        emitSelf: false,
      }),
      identify: identify(),
      // The connection monitor heartbeats over the ping protocol. Without a
      // ping service the heartbeat cannot be answered, and the monitor tears
      // the connection down mid-round-trip.
      ping: ping(),
    },
    connectionManager: { maxConnections: 10 },
  })
  await node.start()
  return node
}

/**
 * Publish on the topic until a peer answers, then resolve with that peer's
 * message. Gossipsub needs a heartbeat or two to build the mesh, so the
 * publish side retries rather than firing once and hoping.
 */
async function runRoundTrip(node, { ignore = [], timeoutMs }) {
  const pubsub = node.services.pubsub
  const encoder = new TextEncoder()
  const ignored = new Set([node.peerId.toString(), ...ignore])

  // Without an explicit subscription gossipsub never forms a mesh for the
  // topic and every published message is dropped on the floor.
  await pubsub.subscribe(TOPIC)

  return new Promise((resolve) => {
    let done = false
    let publisher = null
    let timer = null
    let onMessage = null
    const finish = (message) => {
      if (done)
        return
      done = true
      clearInterval(publisher)
      clearTimeout(timer)
      pubsub.removeEventListener('message', onMessage)
      resolve(message)
    }

    onMessage = (event) => {
      const message = event.detail
      if (message.topic !== TOPIC)
        return
      const from = message.from?.toString?.() ?? String(message.from)
      if (ignored.has(from))
        return
      console.info(`[round-trip] received from ${from}`)
      // The peer tears down as soon as it hears us, so our own message needs
      // one more publish cycle to land before we leave.
      setTimeout(() => finish(message), SETTLE_MS)
    }

    pubsub.addEventListener('message', onMessage)

    const publish = () => {
      pubsub.publish(TOPIC, encoder.encode(JSON.stringify({
        from: node.peerId.toString(),
        ts: Date.now(),
      }))).catch((error) => {
        console.warn('[round-trip] publish failed:', error.message)
      })
    }

    // Publish straight away: waiting a full interval would let the peer hear
    // us, answer, and hang up before our first message ever left.
    publish()
    publisher = setInterval(publish, PUBLISH_INTERVAL_MS)

    timer = setTimeout(() => finish(null), timeoutMs)
  })
}

async function runPeer() {
  console.info('[peer] starting node...')
  const node = await createNode(['/ip4/127.0.0.1/tcp/0/ws'])
  const peerId = node.peerId.toString()
  console.info('[peer] peerId:', peerId)

  const localMa = node.getMultiaddrs()[0]
  if (!localMa)
    throw new Error('libp2p node did not report a listen address')
  const { port } = localMa.toOptions()
  console.info('[peer] local websocket listener on port', port)

  console.info('[peer] starting tunnel...')
  const { child, host, backend } = await openTunnel(port)
  const stopTunnel = () => {
    try {
      child.kill('SIGTERM')
    }
    catch {
      // The tunnel is already gone; nothing to clean up.
    }
  }
  process.on('exit', stopTunnel)
  process.on('SIGINT', () => {
    stopTunnel()
    process.exit(130)
  })
  process.on('SIGTERM', () => {
    stopTunnel()
    process.exit(143)
  })

  const publicMa = `/dns4/${host}/tcp/443/wss/p2p/${peerId}`
  console.info('[peer] public multiaddr:', publicMa)

  await writeRendezvous({
    role: ROLE,
    channel: CHANNEL,
    runId: RUN_ID,
    peerId,
    multiaddrs: [publicMa],
    tunnel: backend,
    ts: Date.now(),
  })
  await journal([
    `📋 Cross-WAN journal: a peer booted behind a ${backend} tunnel.`,
    '',
    `- PeerId: \`${peerId}\``,
    `- Public multiaddr: \`${publicMa}\``,
    `- Channel: \`${CHANNEL}\``,
    `- Run: ${RUN_ID}`,
    `- Time: ${new Date().toISOString()}`,
  ].join('\n'))

  // Dial every other peer on the channel. Newest first: a stale record from an
  // earlier run points at a tunnel that is long gone, so the freshest one is
  // the best bet.
  //
  // Only one side of a pair dials. libp2p keeps at most one healthy gossipsub
  // stream per peer id, so when both sides dial each other the second
  // connection wins the slot and the first one is left dangling — the peer
  // then has no open stream to publish on. The rule has to be symmetric, so
  // the peer with the lower id is the one that dials.
  const connected = new Set()
  node.addEventListener('peer:connect', (event) => {
    connected.add(event.detail.toString())
    console.info('[peer] connected to', event.detail.toString())
  })
  const deadline = Date.now() + TIMEOUT_MS
  while (connected.size < EXPECTED_PEERS && Date.now() < deadline) {
    let records = []
    try {
      records = await readRendezvous()
    }
    catch (error) {
      console.error('[peer] poll error:', error.message)
    }

    const candidates = records
      .filter(record => (record.channel ?? 'default') === CHANNEL)
      .filter(record => record.peerId !== peerId && Array.isArray(record.multiaddrs))
      .sort((a, b) => (b.ts ?? 0) - (a.ts ?? 0))

    for (const candidate of candidates) {
      if (connected.has(candidate.peerId))
        continue
      if (peerId > candidate.peerId)
        continue
      for (const ma of candidate.multiaddrs) {
        if (!ma)
          continue
        try {
          console.info('[peer] dialing', ma)
          await node.dial(multiaddr(ma))
          console.info('[peer] dialed', candidate.peerId)
          break
        }
        catch (error) {
          console.info('[peer] dial failed:', ma, error.message)
        }
      }
    }

    if (connected.size < EXPECTED_PEERS)
      await new Promise(resolve => setTimeout(resolve, POLL_INTERVAL_MS))
  }

  if (connected.size < EXPECTED_PEERS) {
    await journal([
      `📋 Cross-WAN journal: a peer FAILED to reach any other peer on the rendezvous issue.`,
      '',
      `- Public multiaddr: \`${publicMa}\``,
      `- Run: ${RUN_ID}`,
      `- Time: ${new Date().toISOString()}`,
    ].join('\n'))
    await node.stop()
    stopTunnel()
    console.error(`[peer] FAILED: reached ${connected.size}/${EXPECTED_PEERS} peers`)
    process.exit(1)
  }

  const message = await runRoundTrip(node, { timeoutMs: ROUND_TRIP_TIMEOUT_MS })
  if (!message) {
    await journal([
      `📋 Cross-WAN journal: a peer reached another peer but never heard it back.`,
      '',
      `- Peers: ${[...connected].map(id => `\`${id}\``).join(', ')}`,
      `- Run: ${RUN_ID}`,
      `- Time: ${new Date().toISOString()}`,
    ].join('\n'))
    await node.stop()
    stopTunnel()
    console.error('[peer] FAILED: no message from another peer')
    process.exit(1)
  }

  const heardFrom = message.from?.toString?.() ?? String(message.from)
  await journal([
    `🐝 Cross-WAN rendezvous success! A peer completed a gossipsub round-trip with another peer across the WAN.`,
    '',
    `- Peer: \`${heardFrom}\``,
    `- Public multiaddr: \`${publicMa}\``,
    `- Run: ${RUN_ID}`,
    `- Time: ${new Date().toISOString()}`,
  ].join('\n'))
  await node.stop()
  stopTunnel()
  console.info('[peer] SUCCESS')
  process.exit(0)
}

runPeer().catch((error) => {
  console.error('[cross-wan] failed:', error)
  process.exit(1)
})
