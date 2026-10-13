import type { IncomingMessage, Server, ServerResponse } from 'node:http'

import type { createContext } from '@moeru/eventa/adapters/electron/main'
import type { AgenticOsConfig, PresenceSnapshot } from '@proj-airi/stage-shared/agentic'
import type { Lifecycle } from 'injeca'

import { Buffer } from 'node:buffer'
import { randomBytes } from 'node:crypto'
import { createServer } from 'node:http'

import { useLogg } from '@guiiai/logg'
import { defineInvokeHandler } from '@moeru/eventa'
import {
  agenticServiceApplyConfig,
  agenticServiceConfigChanged,
  agenticServiceCycleRequested,
  agenticServiceGetConfig,
  agenticServiceGetHttpEndpoint,
  agenticServiceReportPresence,
  agenticServiceRotateHttpToken,
  agenticServiceTriggerCycle,
} from '@proj-airi/stage-shared/agentic'
import { BrowserWindow } from 'electron'
import { boolean, number, object, optional, picklist, pipe, safeParse, string } from 'valibot'

import { createConfig } from '../../../libs/electron/persistence'
import { createCompanionService, setupCompanionConsent } from './companion'
import {
  authorizeAgenticHttpRequest,
  buildAgenticHttpStatus,
  DEFAULT_HTTP_HOST,
  DEFAULT_HTTP_PORT,
  MAX_REQUEST_BODY_BYTES,
  resolveAgenticHttpRoute,
} from './http-endpoint'

/**
 * The eventa invoke context this service's handlers are bound to.
 *
 * NOTICE: `@moeru/eventa`'s main adapter does not export a context *type*
 * alongside `createContext`, so the alias is derived from the function's own
 * return type. Deriving it once, here, keeps every handler signature readable
 * and stops the raw return type from leaking across the module.
 */
export type AgenticInvokeContext = ReturnType<typeof createContext>['context']

const log = useLogg('agentic-service').useGlobalConfig()

// ── Config ────────────────────────────────────────────────────────────────────

const AUTONOMOUS_MODE_SCHEMA = picklist(['disabled', 'when-away', 'always'])

const AgenticServiceConfigSchema = object({
  /** Which autonomous behaviour mode the renderer cycle gates on. */
  autonomousMode: optional(AUTONOMOUS_MODE_SCHEMA, 'disabled'),
  /** Cooldown between autonomous cycles, in minutes. */
  cooldownMinutes: optional(pipe(number()), 15),
  /** Whether the local HTTP endpoint is bound. */
  httpEndpointEnabled: optional(boolean(), false),
  /** Bearer token for the HTTP endpoint. Empty until the endpoint is enabled. */
  httpAuthToken: optional(string(), ''),
  /** Loopback port the HTTP endpoint binds; `0` picks an ephemeral port. */
  httpPort: optional(pipe(number()), DEFAULT_HTTP_PORT),
})

const AGENTIC_NAMESPACE = 'agentic'
const AGENTIC_FILENAME = 'agentic-config.json'

const AgenticServiceConfigDefault: AgenticOsConfig = {
  autonomousMode: 'disabled',
  cooldownMinutes: 15,
  httpEndpointEnabled: false,
  httpAuthToken: '',
  httpPort: DEFAULT_HTTP_PORT,
}

const agenticConfigStore = createConfig(
  AGENTIC_NAMESPACE,
  AGENTIC_FILENAME,
  AgenticServiceConfigSchema,
  { default: AgenticServiceConfigDefault, autoHeal: true },
)

/** Merge a renderer patch over the stored config and validate the result. */
function mergeConfigPatch(base: AgenticOsConfig, patch: Partial<AgenticOsConfig>): AgenticOsConfig {
  const merged = { ...base, ...patch }
  const parsed = safeParse(AgenticServiceConfigSchema, merged)
  if (!parsed.success) {
    throw new Error('Invalid Agentic OS configuration')
  }
  return parsed.output
}

/** 32 bytes of CSPRNG entropy, hex-encoded. Not a password; it is a capability. */
function generateAuthToken(): string {
  return randomBytes(32).toString('hex')
}

// ── Lifecycle Integration ─────────────────────────────────────────────────────

/**
 * Load the persisted config and start the HTTP endpoint if it is enabled.
 *
 * NOTICE: `.setup()` must run first — `createConfig`'s in-memory map is only
 * populated by its synchronous disk read, exactly as `setupLibp2pService`
 * does. Without it a real boot ignores the persisted file entirely.
 */
export async function setupAgenticService(params: { lifecycle: Lifecycle }) {
  agenticConfigStore.setup()
  setupCompanionConsent()

  const config = agenticConfigStore.get() ?? AgenticServiceConfigDefault
  if (config.httpEndpointEnabled && config.httpAuthToken) {
    try {
      await startHttpServer(DEFAULT_HTTP_HOST, config.httpPort)
    }
    catch (err) {
      // A port already in use must not take the app down: the endpoint is an
      // convenience surface, and the user can change the port in settings.
      log.withError(err).error('Failed to start Agentic OS HTTP endpoint')
    }
  }

  params.lifecycle.appHooks.onStop(async () => {
    await stopHttpServer()
    agenticConfigStore.flush()
  })
}

// ── HTTP endpoint ──────────────────────────────────────────────────────────────

let httpServer: Server | null = null
let httpPort: number | null = null

// ── Renderer-reported state ────────────────────────────────────────────────────
//
// NOTICE: the renderer owns presence derivation and the memory scan; main only
// caches the last snapshot so the HTTP endpoint (which main serves) can answer
// `/status` without an IPC round-trip. These are written by the renderer
// through `agenticServiceTriggerCycle` / `agenticServiceGetPresence`, never
// derived in main.

let lastPresenceSnapshot: PresenceSnapshot | null = null
let lastCycleAt = 0

/**
 * Bind the loopback HTTP endpoint.
 *
 * NOTICE: this binds `127.0.0.1` and nothing else, deliberately. See the
 * design notes in `http-endpoint.ts` — cross-device automation belongs to the
 * paired libp2p mesh, not to an unauthenticated LAN listener.
 */
async function startHttpServer(host: string, port: number): Promise<void> {
  await stopHttpServer()

  const server = createServer((req: IncomingMessage, res: ServerResponse) => {
    void handleHttpRequest(req, res)
  })

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(port, host, () => {
      server.removeListener('error', reject)
      resolve()
    })
  })

  httpServer = server
  httpPort = port
  log.withFields({ host, port }).log('Agentic OS HTTP endpoint listening')
}

async function stopHttpServer(): Promise<void> {
  if (!httpServer) {
    httpPort = null
    return
  }

  const server = httpServer
  httpServer = null
  httpPort = null

  await new Promise<void>((resolve) => {
    server.close(() => resolve())
  })
}

/**
 * Handle one HTTP request: authorise, resolve the route, answer.
 *
 * Every response body is JSON and carries `Cache-Control: no-store` — the
 * status route reports whether the user is present, which is exactly the kind
 * of fact a browser cache must not retain.
 */
async function handleHttpRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = req.url ?? '/'
  const [path] = url.split('?')
  const method = (req.method ?? 'GET').toUpperCase()

  const auth = authorizeAgenticHttpRequest({
    authorizationHeader: req.headers.authorization,
    expectedToken: agenticConfigStore.get()?.httpAuthToken ?? '',
  })

  if (!auth.authorized) {
    res.writeHead(auth.status, { 'content-type': 'application/json', 'cache-control': 'no-store' })
    res.end(JSON.stringify({ error: auth.reason }))
    return
  }

  const route = resolveAgenticHttpRoute(method, path)
  if (!route) {
    res.writeHead(404, { 'content-type': 'application/json', 'cache-control': 'no-store' })
    res.end(JSON.stringify({ error: 'not-found' }))
    return
  }

  if (route === '/cycle') {
    // Cap the body before reading it: a hostile client must not be able to
    // force an unbounded buffer by simply not finishing the request.
    const body = await readBodyWithCap(req)
    if (body === null) {
      res.writeHead(413, { 'content-type': 'application/json', 'cache-control': 'no-store' })
      res.end(JSON.stringify({ accepted: false, reason: 'request-too-large' }))
      return
    }

    // The renderer drives the cycle; main only signals it, because the cycle
    // needs the renderer's memory stores and expression pipeline.
    emitCycleRequested()
    res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' })
    res.end(JSON.stringify({ accepted: true }))
    return
  }

  // `/status`
  const config = agenticConfigStore.get() ?? AgenticServiceConfigDefault
  const presence = lastPresenceSnapshot

  res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' })
  res.end(JSON.stringify(buildAgenticHttpStatus({
    present: presence?.state === 'active',
    presenceState: presence?.state ?? 'active',
    autonomousMode: config.autonomousMode,
    lastCycleAt,
  })))
}

/** Read a request body up to the cap; `null` when it exceeds it. */
async function readBodyWithCap(req: IncomingMessage): Promise<Buffer | null> {
  const chunks: Buffer[] = []
  let total = 0
  for await (const chunk of req) {
    const buf = chunk as Buffer
    total += buf.length
    if (total > MAX_REQUEST_BODY_BYTES) {
      return null
    }
    chunks.push(buf)
  }
  return Buffer.concat(chunks)
}

// ── Eventa Service ─────────────────────────────────────────────────────────────

function emitConfigChanged(config: AgenticOsConfig) {
  emitToAllWindows(agenticServiceConfigChanged, config)
}

function emitCycleRequested() {
  emitToAllWindows(agenticServiceCycleRequested, { source: 'http', at: Date.now() })
}

/**
 * Push an event to every window.
 *
 * eventa's electron renderer adapter only binds `ipcRenderer.on('eventa-message')`,
 * so a bare `webContents.send()` on a custom channel name reaches nothing;
 * pushes therefore go through a transient eventa context bound to each window,
 * the same helper `libp2p/index.ts` uses.
 */
function emitToAllWindows<P>(contract: { toString: () => string }, payload: P) {
  for (const window of BrowserWindow.getAllWindows()) {
    try {
      window.webContents.send(contract.toString(), payload)
    }
    catch (err) {
      log.withError(err).warn('Failed to push agentic event to a window')
    }
  }
}

export async function createAgenticService(params: { context: AgenticInvokeContext }) {
  const context = params.context
  void createCompanionService({ context })

  defineInvokeHandler(context, agenticServiceGetConfig, async (): Promise<AgenticOsConfig> => {
    return agenticConfigStore.get() ?? AgenticServiceConfigDefault
  })

  defineInvokeHandler(context, agenticServiceApplyConfig, async (patch: Partial<AgenticOsConfig>): Promise<AgenticOsConfig> => {
    const base = agenticConfigStore.get() ?? AgenticServiceConfigDefault

    let merged: AgenticOsConfig
    try {
      merged = mergeConfigPatch(base, patch)
    }
    catch (err) {
      throw err instanceof Error ? err : new Error(String(err))
    }

    // A first enable generates the bearer token; disabling clears it so the
    // endpoint cannot be re-enabled with a stale capability that may have
    // been copied out of a config file.
    if (patch.httpEndpointEnabled && !merged.httpAuthToken) {
      merged = { ...merged, httpAuthToken: generateAuthToken() }
    }
    if (!merged.httpEndpointEnabled) {
      merged = { ...merged, httpAuthToken: '' }
    }

    agenticConfigStore.update(merged)
    agenticConfigStore.flush()

    if (merged.httpEndpointEnabled && merged.httpAuthToken) {
      await startHttpServer(DEFAULT_HTTP_HOST, merged.httpPort)
    }
    else {
      await stopHttpServer()
    }

    emitConfigChanged(merged)
    return merged
  })

  defineInvokeHandler(context, agenticServiceRotateHttpToken, async (): Promise<AgenticOsConfig> => {
    const base = agenticConfigStore.get() ?? AgenticServiceConfigDefault
    const merged: AgenticOsConfig = { ...base, httpAuthToken: generateAuthToken() }

    agenticConfigStore.update(merged)
    agenticConfigStore.flush()
    emitConfigChanged(merged)
    return merged
  })

  defineInvokeHandler(context, agenticServiceReportPresence, async (snapshot: PresenceSnapshot): Promise<PresenceSnapshot> => {
    lastPresenceSnapshot = snapshot
    return snapshot
  })

  defineInvokeHandler(context, agenticServiceTriggerCycle, async (input: { force?: boolean }): Promise<{ accepted: boolean, reason?: string }> => {
    const config = agenticConfigStore.get() ?? AgenticServiceConfigDefault
    if (config.autonomousMode === 'disabled' && !input.force) {
      return { accepted: false, reason: 'autonomous-mode-disabled' }
    }

    lastCycleAt = Date.now()
    emitCycleRequested()
    return { accepted: true }
  })

  defineInvokeHandler(context, agenticServiceGetHttpEndpoint, async () => {
    if (!httpPort) {
      return null
    }
    return { host: DEFAULT_HTTP_HOST, port: httpPort }
  })
}
