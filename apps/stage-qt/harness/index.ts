// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * stage-qt harness — standalone mock AIRI stage server for the Qt renderer.
 *
 * Mirrors the contract of `apps/stage-mate/harness/index.ts` (the Unity
 * sidecar harness) and the production server in
 * `apps/stage-tamagotchi/src/main/services/airi/stage-mate/index.ts`:
 * WebSocket server on `ws://localhost:<PORT>` that the stage-qt binary
 * connects to, authenticates against, then renders.
 *
 * Scripted demo loop (always on): cycles `happy` → `angry` expressions every
 * 5 s, sends a sine-wave `stage:vrm:lip-sync` rms at 20 Hz, and orbits
 * `stage:control:mouse` for the gaze controller.
 */
import type { WebSocket } from 'ws'

import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'

import { fileURLToPath } from 'node:url'

import { WebSocketServer } from 'ws'

const here = path.dirname(fileURLToPath(import.meta.url))

// 1. Source .env if present
const localEnvPath = path.join(here, '..', '.env')
if (fs.existsSync(localEnvPath)) {
  const raw = fs.readFileSync(localEnvPath, 'utf-8')
  for (const line of raw.split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z_]\w*)\s*=\s*(.*)?$/i)
    if (!m)
      continue
    const key = m[1]
    let value = (m[2] ?? '').trim()
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith('\'') && value.endsWith('\'')))
      value = value.slice(1, -1)
    if (process.env[key] == null)
      process.env[key] = value
  }
}

// 2. Source from AIRI stage-tamagotchi server-channel-config.json if not set
if (!process.env.AIRI_AUTH_TOKEN) {
  const configCandidates = [
    path.resolve(process.env.HOME ?? '', '.config/airi/stage-tamagotchi/store/server-channel-config.json'),
    path.resolve(process.env.HOME ?? '', '.config/electron/apps/stage-tamagotchi/store/server-channel-config.json'),
    path.resolve(process.env.HOME ?? '', '.local/share/airi/stage-tamagotchi/store/server-channel-config.json'),
    path.resolve(process.env.HOME ?? '', '.config/airi/store/server-channel-config.json'),
    path.resolve(process.env.HOME ?? '', '.config/airi/stage-tamagotchi/store/userData/store/server-channel-config.json'),
  ]
  for (const candidate of configCandidates) {
    if (!fs.existsSync(candidate))
      continue
    try {
      const json = JSON.parse(fs.readFileSync(candidate, 'utf-8'))
      if (typeof json.authToken === 'string' && json.authToken.length > 0) {
        process.env.AIRI_AUTH_TOKEN = json.authToken
        break
      }
    }
    catch {
      /* best effort */
    }
  }
}

const PORT = Number(process.env.MATE_HARNESS_PORT ?? 6171)
const AUTH_TOKEN = process.env.AIRI_AUTH_TOKEN ?? process.env.MATE_AUTH_TOKEN ?? 'mate-stage-dev-token'
const MODEL_PATH = process.env.MATE_MODEL_PATH ? path.resolve(process.env.MATE_MODEL_PATH) : path.resolve(here, '..', 'test-model.vrm')

const clients = new Set<WebSocket>()
const authenticatedClients = new Set<WebSocket>()

const wss = new WebSocketServer({ port: PORT })

function log(msg: string) {
  const now = new Date().toTimeString().split(' ')[0]
  console.info(`[harness ${now}] ${msg}`)
}

function broadcast(msg: object) {
  const json = JSON.stringify(msg)
  for (const client of authenticatedClients) {
    if (client.readyState === client.OPEN)
      client.send(json)
  }
}

// Scripted demo: expressions + lip-sync + gaze orbit.
const EXP_CYCLE = ['happy', 'angry', 'sad', 'relaxed']
let expIdx = 0
setInterval(() => {
  if (authenticatedClients.size === 0)
    return
  const name = EXP_CYCLE[expIdx++ % EXP_CYCLE.length]
  broadcast({ type: 'stage:vrm:expression', data: { name, weight: 1.0, durationMs: 500 } })
  log(`-> stage:vrm:expression ${name}`)
}, 5000)

let tick = 0
setInterval(() => {
  if (authenticatedClients.size === 0)
    return
  tick++
  const rms = Math.max(0, Math.min(1, Math.abs(Math.sin(tick * 0.4) * Math.sin(tick * 0.15) + (Math.random() * 0.2 - 0.1))))
  broadcast({ type: 'stage:vrm:lip-sync', data: { rms } })
}, 50)

setInterval(() => {
  if (authenticatedClients.size === 0)
    return
  const t = Date.now() / 1000
  broadcast({
    type: 'stage:control:mouse',
    data: {
      x: Math.floor(960 + 600 * Math.sin(t * 0.6)),
      y: Math.floor(540 + 300 * Math.cos(t * 0.6)),
      monitorWidth: 1920,
      monitorHeight: 1080,
    },
  })
}, 500)

wss.on('connection', (ws) => {
  clients.add(ws)
  log('Client socket connected, awaiting authentication...')

  const pingTimer = setInterval(() => {
    if (ws.readyState === ws.OPEN)
      ws.send(JSON.stringify({ type: 'ping', data: { t: Date.now() } }))
  }, 2000)

  ws.on('message', (data) => {
    try {
      const msg = JSON.parse(data.toString())

      if (msg.type === 'module:authenticate') {
        const token = msg.data?.token
        const caller = msg.data?.caller ?? 'stage-qt'
        const purpose = msg.data?.purpose ?? 'Native VRM Stage Renderer (Qt)'
        if (token === AUTH_TOKEN) {
          authenticatedClients.add(ws)
          ws.send(JSON.stringify({ type: 'module:authenticated', data: { authenticated: true } }))
          log(`Auth SUCCESS: ${caller} (${purpose})`)
        }
        else {
          ws.send(JSON.stringify({ type: 'module:authenticated', data: { authenticated: false, error: 'Invalid token' } }))
          log(`Auth REJECTED: invalid token from ${caller}`)
          ws.close()
        }
        return
      }

      if (msg.type === 'module:announce') {
        if (!authenticatedClients.has(ws)) {
          ws.close()
          return
        }
        const name = msg.data?.name ?? 'stage-qt'
        ws.send(JSON.stringify({ type: 'module:announced', data: { ok: true, name } }))
        log(`Announced: ${name}`)
        // Post-handshake state snapshot (mirrors production stage:state:sync)
        ws.send(JSON.stringify({
          type: 'stage:state:sync',
          data: {
            window: { x: 800, y: 400, width: 300, height: 450, alwaysOnTop: true },
            model: { modelId: 'harness', modelPath: MODEL_PATH },
            positioning: { x: 0, y: 0, scale: 1.0 },
            viewport: { mode: 'tactileMode' },
            stage: { enabled: true },
          },
        }))
        ws.send(JSON.stringify({ type: 'stage:vrm:load', data: { modelId: 'harness', modelPath: MODEL_PATH } }))
        return
      }

      if (!authenticatedClients.has(ws)) {
        log(`Blocked unauthenticated message: ${msg.type}`)
        return
      }

      if (msg.type === 'stage:vrm:ready')
        log(`Sidecar ready with: ${path.basename(msg.data?.modelPath ?? '')}`)
      else
        log(`rx: ${data.toString()}`)
    }
    catch {
      log(`rx: ${data.toString()}`)
    }
  })

  ws.on('close', () => {
    clients.delete(ws)
    authenticatedClients.delete(ws)
    clearInterval(pingTimer)
    log('Sidecar client disconnected')
  })

  ws.on('error', (err) => {
    log(`WS error: ${err.message}`)
  })
})

function cleanupAndExit() {
  wss.close(() => process.exit(0))
}
process.on('SIGINT', cleanupAndExit)
process.on('SIGTERM', cleanupAndExit)

if (process.stdout.isTTY) {
  process.stdin.setRawMode(true)
  process.stdin.resume()
  process.stdin.on('data', (chunk) => {
    const ch = chunk.toString()
    if (ch === 'q' || ch === '\x03')
      cleanupAndExit()
    if (ch === 'c') {
      broadcast({ type: 'stage:caption', data: { text: 'Hello from the stage-qt harness', isActive: true } })
      log('-> stage:caption Hello…')
    }
    if (ch === 'v') {
      const enabled = !Math.random()
      broadcast({ type: 'control:stage', data: { enabled } })
      log(`-> control:stage ${enabled}`)
    }
  })
}

console.info(`[harness] stage-qt mock stage server on ws://localhost:${PORT}`)
console.info(`[harness] model: ${MODEL_PATH} (exists: ${fs.existsSync(MODEL_PATH)})`)
console.info(`[harness] auth token: ${AUTH_TOKEN}`)
console.info(`[harness] press [c] caption · [v] visibility · [q] quit`)
