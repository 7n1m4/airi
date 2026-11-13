import type { Server } from '@proj-airi/server-runtime/server'
import type { Lifecycle } from 'injeca'

import type { ElectronServerChannelConfig } from '../../../../shared/eventa'
import type { DaemonGatewayStatus } from '../daemon-gateway'

import { randomUUID, X509Certificate } from 'node:crypto'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { Socket } from 'node:net'
import { join } from 'node:path'
import { env, platform } from 'node:process'

import z from 'zod'

import { useLogg } from '@guiiai/logg'
import { defineInvokeHandler } from '@moeru/eventa'
import { createContext } from '@moeru/eventa/adapters/electron/main'
import { createServer, getLocalIPs } from '@proj-airi/server-runtime/server'
import { Mutex } from 'async-mutex'
import { app, ipcMain } from 'electron'
import { createCA, createCert } from 'mkcert'
import { x } from 'tinyexec'
import { nullable, object, optional, string } from 'valibot'

import {
  electronApplyServerChannelConfig,
  electronGetServerChannelConfig,
} from '../../../../shared/eventa'
import { createConfig } from '../../../libs/electron/persistence'
import {
  applyDaemonGatewayConfig,
  getDaemonGatewayStatus,
  parseServerChannelPort,
} from '../daemon-gateway'

// Canonical JSON (recursively key-sorted) so config comparison does not
// depend on object key order produced by the caller.
function stableStringify(value: unknown): string {
  if (Array.isArray(value))
    return `[${value.map(stableStringify).join(',')}]`
  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([key, val]) => `${JSON.stringify(key)}:${stableStringify(val)}`)
    return `{${entries.join(',')}}`
  }
  return JSON.stringify(value) ?? 'null'
}

// NOTICE: deliberately cheap loopback test — exact matches plus 127.0.0.0/8.
// Non-loopback + no TLS means the auth token crosses the wire in cleartext.
// (0.0.0.0/:: bind every interface, so they are not loopback.)
function isLoopbackHostname(hostname: string): boolean {
  const h = hostname.trim().toLowerCase().replace(/^\[|\]$/g, '')
  return h === 'localhost' || h === '::1' || h.startsWith('127.')
}

// S8: effective bind hostname non-loopback with no TLS => token on the wire in cleartext.
function warnIfCleartextLanBind(hostname: string, tlsConfig: unknown): void {
  if (!tlsConfig && !isLoopbackHostname(hostname)) {
    console.warn(`[Main/ServerChannel] In-app gateway binding ${hostname} WITHOUT TLS — auth token is transmitted in cleartext; enable TLS`)
  }
}

// In-app fallback state shared between setupServerChannel (bind side) and the
// get/apply handlers (surfacing). Daemon mode never touches these.
let activeHostname = '127.0.0.1'
let lastStartError: string | null = null

const channelServerConfigSchema = object({
  hostname: optional(string()),
  authToken: optional(string()),
  tlsConfig: optional(nullable(object({
    cert: optional(string()),
    key: optional(string()),
    passphrase: optional(string()),
  }))),
})

const channelServerInvokeConfigSchema = z.object({
  hostname: z.string().trim().min(1).max(253).refine(value => !/[\s\p{Cc}]/u.test(value), 'hostname must not contain whitespace or control characters').optional(),
  authToken: z.string().optional(),
  tlsConfig: z.object({ }).nullable().optional(),
}).strict()

const channelServerConfigStore = createConfig('server-channel', 'config.json', channelServerConfigSchema, {
  default: {
    hostname: '127.0.0.1',
    authToken: '',
    tlsConfig: null,
  },
  autoHeal: true,
})

function getServerChannelPort() {
  return parseServerChannelPort(env.SERVER_CHANNEL_PORT)
}

// Shared get-shape for daemon mode: same fields the in-app handler returns,
// sourced from the daemon's GetGatewayConfig instead of the local config store.
function daemonGetConfigShape(daemon: DaemonGatewayStatus): ElectronServerChannelConfig {
  return {
    websocketTlsConfig: daemon.tlsEnabled ? {} : null,
    authToken: daemon.authToken,
    hostname: daemon.hostname,
    port: daemon.port,
    tlsEnabled: daemon.tlsEnabled,
    bound: daemon.bound,
    lastError: daemon.lastError,
  }
}

async function getChannelServerConfig() {
  return channelServerConfigStore.get() as { hostname?: string, authToken?: string, tlsConfig?: any } || { hostname: '127.0.0.1', authToken: '', tlsConfig: null }
}

async function normalizeChannelServerOptions(payload: unknown, fallback?: any) {
  if (!fallback) {
    fallback = await getChannelServerConfig()
  }

  const parsed = channelServerInvokeConfigSchema.safeParse(payload)
  if (!parsed.success) {
    return fallback
  }

  const authToken = (parsed.data.authToken && parsed.data.authToken.trim().length > 0)
    ? parsed.data.authToken
    : fallback.authToken

  return {
    hostname: parsed.data.hostname ?? fallback.hostname,
    authToken,
    tlsConfig: parsed.data.tlsConfig === undefined ? (fallback?.tlsConfig ?? null) : parsed.data.tlsConfig,
  }
}

function getCertificateDomains(): string[] {
  const localIPs = getLocalIPs()
  const hostname = env.SERVER_RUNTIME_HOSTNAME
  return Array.from(new Set([
    'localhost',
    '127.0.0.1',
    '::1',
    ...(hostname ? [hostname] : []),
    ...localIPs,
  ]))
}

function certHasAllDomains(certPem: string, domains: string[]): boolean {
  try {
    const cert = new X509Certificate(certPem)
    const san = cert.subjectAltName || ''
    const entries = san.split(',').map(part => part.trim())
    const values = entries
      .map((entry) => {
        if (entry.startsWith('DNS:'))
          return entry.slice(4).trim()
        if (entry.startsWith('IP Address:'))
          return entry.slice(11).trim()
        return ''
      })
      .filter(Boolean)

    const sanSet = new Set(values)
    return domains.every(domain => sanSet.has(domain))
  }
  catch {
    return false
  }
}

async function installCACertificate(caCert: string) {
  const userDataPath = app.getPath('userData')
  const caCertPath = join(userDataPath, 'websocket-ca-cert.pem')
  writeFileSync(caCertPath, caCert)

  try {
    if (platform === 'darwin') {
      await x(`security`, ['add-trusted-cert', '-d', '-r', 'trustRoot', '-k', '/Library/Keychains/System.keychain', caCertPath], { nodeOptions: { stdio: 'ignore' } })
    }
    else if (platform === 'win32') {
      await x(`certutil`, ['-addstore', '-f', 'Root', caCertPath], { nodeOptions: { stdio: 'ignore' } })
    }
    else if (platform === 'linux') {
      const caDir = '/usr/local/share/ca-certificates'
      const caFileName = 'airi-websocket-ca.crt'
      try {
        writeFileSync(join(caDir, caFileName), caCert)
        await x('update-ca-certificates', [], { nodeOptions: { stdio: 'ignore' } })
      }
      catch {
        const userCaDir = join(env.HOME || '', '.local/share/ca-certificates')
        try {
          if (!existsSync(userCaDir)) {
            await x(`mkdir`, ['-p', userCaDir], { nodeOptions: { stdio: 'ignore' } })
          }
          writeFileSync(join(userCaDir, caFileName), caCert)
        }
        catch {
          // Ignore errors
        }
      }
    }
  }
  catch (error) {
    console.warn('[Main/ServerChannel] Failed to install WebSocket CA certificate (clients may need to trust it manually):', error instanceof Error ? error.message : String(error))
  }
}

async function generateCertificate() {
  const userDataPath = app.getPath('userData')
  const caCertPath = join(userDataPath, 'websocket-ca-cert.pem')
  const caKeyPath = join(userDataPath, 'websocket-ca-key.pem')

  let ca: { key: string, cert: string }

  if (existsSync(caCertPath) && existsSync(caKeyPath)) {
    ca = {
      cert: readFileSync(caCertPath, 'utf-8'),
      key: readFileSync(caKeyPath, 'utf-8'),
    }
  }
  else {
    ca = await createCA({
      organization: 'AIRI',
      countryCode: 'US',
      state: 'Development',
      locality: 'Local',
      validity: 365,
    })
    writeFileSync(caCertPath, ca.cert)
    writeFileSync(caKeyPath, ca.key)

    await installCACertificate(ca.cert)
  }

  const domains = getCertificateDomains()

  const cert = await createCert({
    ca: { key: ca.key, cert: ca.cert },
    domains,
    validity: 365,
  })

  return {
    cert: cert.cert,
    key: cert.key,
  }
}

async function getOrCreateCertificate() {
  const userDataPath = app.getPath('userData')
  const certPath = join(userDataPath, 'websocket-cert.pem')
  const keyPath = join(userDataPath, 'websocket-key.pem')
  const expectedDomains = getCertificateDomains()

  if (existsSync(certPath) && existsSync(keyPath)) {
    const cert = readFileSync(certPath, 'utf-8')
    const key = readFileSync(keyPath, 'utf-8')
    if (certHasAllDomains(cert, expectedDomains)) {
      return { cert, key }
    }
  }

  const { cert, key } = await generateCertificate()
  writeFileSync(certPath, cert)
  writeFileSync(keyPath, key)

  return { cert, key }
}

export async function setupServerChannel(params: { lifecycle: Lifecycle }): Promise<Server> {
  // Increment 2: when the Rust gateway daemon answers on the session bus it
  // owns port 6121 — never create the in-app server, never mint/flush the
  // token, never start health-check/retry. On macOS/Windows (and de-daemoned
  // Linux) busctl finds no daemon and we fall through to the in-app server.
  const daemon = await getDaemonGatewayStatus()
  if (daemon) {
    console.info(`[Main/ServerChannel] daemon gateway detected (port ${daemon.port}, tlsEnabled=${daemon.tlsEnabled}, bound=${daemon.bound}) — in-app channel server disabled`)
    const daemonLog = useLogg('main/server-runtime').useGlobalConfig()

    params.lifecycle.appHooks.onStart(async () => {
      daemonLog.log('daemon gateway owns port 6121; in-app channel server not started')
    })
    params.lifecycle.appHooks.onStop(async () => {
      daemonLog.log('daemon gateway owns port 6121; nothing to close')
    })

    return {
      async start() {
        daemonLog.warn('daemon gateway owns port 6121; ignoring start()')
      },
      async restart() {
        daemonLog.warn('daemon gateway owns port 6121; ignoring restart()')
      },
      async stop() {
        daemonLog.warn('daemon gateway owns port 6121; ignoring stop()')
      },
      async updateConfig(config) {
        const log = useLogg('main/server-runtime')
        // NOTICE: the daemon owns 6121 and does not accept a token over this
        // path — rotation goes through the gateway UI / RegenerateGatewayToken.
        // Surface the drop instead of silently ignoring it.
        if (config.auth?.token || (config as Record<string, unknown>).authToken) {
          log.warn('auth token rotation in daemon mode must go through the gateway UI / RegenerateGatewayToken — ignoring authToken in daemon updateConfig patch')
        }
        const extraFields = Object.keys(config).filter(key => !['tlsConfig', 'hostname', 'port'].includes(key) && key !== 'auth')
        if (extraFields.length > 0) {
          log.warn(`daemon updateConfig: fields not applied by the daemon gateway and ignored: ${extraFields.join(', ')}`)
        }
        // Only what the daemon applies rides the D-Bus patch — nothing else.
        await applyDaemonGatewayConfig({
          websocketTlsConfig: config.tlsConfig,
          hostname: config.hostname,
        })
      },
    }
  }

  channelServerConfigStore.setup()

  const storedConfig = await getChannelServerConfig()
  console.info('[Main/ServerChannel] Loaded stored config. Token exists:', !!storedConfig.authToken)

  if (!storedConfig.authToken) {
    storedConfig.authToken = randomUUID()
    channelServerConfigStore.update(storedConfig)
    channelServerConfigStore.flush()
    console.info('[Main/ServerChannel] authToken generated and flushed.')
  }
  else {
    console.info('[Main/ServerChannel] Using existing authToken. Token exists: true')
  }

  // Effective bind hostname — probed by health checks, updated by apply.
  // (0.0.0.0/:: bind every interface incl. loopback; keep the raw value for the bind.)
  activeHostname = storedConfig.hostname || env.SERVER_RUNTIME_HOSTNAME || '127.0.0.1'

  warnIfCleartextLanBind(activeHostname, storedConfig.tlsConfig)

  const serverChannel = createServer({
    ...storedConfig,
    auth: { token: storedConfig.authToken },
    port: getServerChannelPort(),
    hostname: storedConfig.hostname || env.SERVER_RUNTIME_HOSTNAME || '127.0.0.1',
    tlsConfig: storedConfig.tlsConfig ? await getOrCreateCertificate() : null,
  })

  const mutex = new Mutex()
  let startLoopTask: Promise<void> | null = null
  let healthCheckTimer: NodeJS.Timeout | null = null

  function getRuntimePort() {
    return getServerChannelPort()
  }

  function isPortListening(port: number, host: string = probeHost(activeHostname)) {
    return new Promise<boolean>((resolve) => {
      const socket = new Socket()
      let settled = false

      const settle = (value: boolean) => {
        if (settled)
          return
        settled = true
        socket.destroy()
        resolve(value)
      }

      socket.once('connect', () => settle(true))
      socket.once('error', () => settle(false))
      socket.setTimeout(1500, () => settle(false))
      socket.connect(port, host)
    })
  }

  // Binding to all interfaces is reachable on loopback — probe 127.0.0.1 there.
  function probeHost(hostname: string) {
    const h = hostname.trim()
    return (h === '0.0.0.0' || h === '::' || h === '[::]') ? '127.0.0.1' : h
  }

  async function ensureServerRunning(reason: string) {
    if (startLoopTask)
      return startLoopTask

    const log = useLogg('main/server-runtime').useGlobalConfig()
    const MAX_START_ATTEMPTS = 5
    startLoopTask = (async () => {
      let attempt = 0

      while (attempt < MAX_START_ATTEMPTS) {
        attempt += 1
        try {
          await serverChannel.start()
          if (await isPortListening(getRuntimePort())) {
            lastStartError = null
            log.withFields({ reason, attempt, port: getRuntimePort() }).log('WebSocket server confirmed ready')
            return
          }

          throw new Error(`WebSocket server was not listening on port ${getRuntimePort()} after start`)
        }
        catch (error) {
          if (attempt >= MAX_START_ATTEMPTS) {
            lastStartError = error instanceof Error ? error.message : String(error)
            log.withFields({ reason, attempt, port: getRuntimePort() }).withError(error as Error).error(`WebSocket server start failed ${attempt} times — giving up`)
            return
          }
          const delayMs = Math.min(1000 * 2 ** (attempt - 1), 10000)
          log.withFields({ reason, attempt, delayMs, port: getRuntimePort() }).withError(error as Error).error('WebSocket server start failed, retrying')
          await new Promise(resolve => setTimeout(resolve, delayMs))
        }
      }
    })().finally(() => {
      startLoopTask = null
    })

    return startLoopTask
  }

  params.lifecycle.appHooks.onStart(async () => {
    const release = await mutex.acquire()

    const log = useLogg('main/server-runtime').useGlobalConfig()

    try {
      await ensureServerRunning('app startup')
      healthCheckTimer = setInterval(async () => {
        if (!(await isPortListening(getRuntimePort()))) {
          log.withFields({ port: getRuntimePort() }).warn('WebSocket server is down while app is running, restarting')
          await ensureServerRunning('health check')
        }
      }, 5000)
      if (lastStartError)
        log.error(`WebSocket server did not start: ${lastStartError} (health check will keep retrying)`)
      else
        log.log('WebSocket server started')
    }
    catch (error) {
      log.withError(error).error('Error starting WebSocket server')
    }
    finally {
      release()
    }
  })
  params.lifecycle.appHooks.onStop(async () => {
    const release = await mutex.acquire()

    const log = useLogg('main/server-runtime').useGlobalConfig()
    if (!serverChannel) {
      return
    }

    try {
      if (healthCheckTimer) {
        clearInterval(healthCheckTimer)
        healthCheckTimer = null
      }
      await serverChannel.stop()
      log.log('WebSocket server closed')
    }
    catch (error) {
      log.withError(error).error('Error closing WebSocket server')
    }
    finally {
      release()
    }
  })

  return {
    async start() {
      const release = await mutex.acquire()
      try {
        await serverChannel.start()
      }
      finally {
        release()
      }
    },
    async restart() {
      const release = await mutex.acquire()
      try {
        await serverChannel.stop()
        await serverChannel.start()
      }
      finally {
        release()
      }
    },
    async stop() {
      const release = await mutex.acquire()
      try {
        await serverChannel.stop()
      }
      finally {
        release()
      }
    },
    async updateConfig(config) {
      const release = await mutex.acquire()
      try {
        await serverChannel.updateConfig(config)
      }
      finally {
        release()
      }
    },
  }
}

export async function createServerChannelService(params: { serverChannel: Server }) {
  const { context } = createContext(ipcMain)
  console.info('[Main/ServerChannel] Registering Eventa invoke handlers')

  defineInvokeHandler(context, electronGetServerChannelConfig, async () => {
    const startedAt = Date.now()
    console.info('[Main/ServerChannel] getServerChannelConfig invoked')
    const daemon = await getDaemonGatewayStatus()
    if (daemon) {
      console.info(`[Main/ServerChannel] getServerChannelConfig resolved via daemon in ${Date.now() - startedAt}ms`)
      return daemonGetConfigShape(daemon)
    }
    const config = await getChannelServerConfig()
    console.info(`[Main/ServerChannel] getServerChannelConfig resolved in ${Date.now() - startedAt}ms`)
    return {
      websocketTlsConfig: config.tlsConfig || null,
      authToken: config.authToken,
      hostname: config.hostname,
      port: getServerChannelPort(),
      tlsEnabled: !!config.tlsConfig,
      bound: lastStartError === null,
      lastError: lastStartError,
    }
  })

  defineInvokeHandler(context, electronApplyServerChannelConfig, async (req) => {
    try {
      // Daemon mode: the Rust gateway owns the port — forward the patch over
      // D-Bus and return a merged snapshot (daemon state + daemon's reply).
      const daemon = await getDaemonGatewayStatus()
      if (daemon) {
        const reply = await applyDaemonGatewayConfig({
          websocketTlsConfig: req?.websocketTlsConfig,
          authToken: req?.authToken,
          hostname: req?.hostname,
        })
        if (!reply) {
          const message = 'Daemon ApplyGatewayConfig failed (bus unreachable, timeout, or unreadable reply)'
          useLogg('main/server-runtime').error(`Daemon gateway config apply failed: ${message}`)
          const fresh = await getDaemonGatewayStatus()
          const base = fresh ? daemonGetConfigShape(fresh) : daemonGetConfigShape(daemon)
          return { ...base, ok: false, error: message } as ElectronServerChannelConfig
        }
        if (reply.ok === false)
          useLogg('main/server-runtime').error(`Daemon rejected gateway config apply: ${String(reply.error ?? 'unknown error')}`)

        const fresh = await getDaemonGatewayStatus()
        const base = fresh ? daemonGetConfigShape(fresh) : daemonGetConfigShape(daemon)
        // The daemon's reply ({ ok, ... }) rides along so the renderer can see
        // rejections; spread only adds/overrides keys, base keeps the shape valid.
        return { ...base, ...reply } as ElectronServerChannelConfig
      }

      const current = await getChannelServerConfig()
      const next = await normalizeChannelServerOptions({
        tlsConfig: req?.websocketTlsConfig,
        authToken: req?.authToken,
        hostname: req?.hostname,
      }, current)

      if (!next.authToken && current.authToken) {
        next.authToken = current.authToken
      }

      const effectiveHost = (value: string | undefined) => value || env.SERVER_RUNTIME_HOSTNAME || '127.0.0.1'
      const currentHost = effectiveHost(current.hostname)
      const nextHost = effectiveHost(next.hostname)
      const tlsChanged = stableStringify(next.tlsConfig) !== stableStringify(current.tlsConfig)
      const authChanged = (current.authToken ?? '') !== (next.authToken ?? '')
      const hostnameChanged = currentHost !== nextHost

      // Update and flush synchronously
      channelServerConfigStore.update(next)
      await channelServerConfigStore.flush()
      activeHostname = nextHost
      warnIfCleartextLanBind(nextHost, next.tlsConfig)

      if (tlsChanged || authChanged || hostnameChanged) {
        await params.serverChannel.stop()
        await params.serverChannel.updateConfig({
          port: getServerChannelPort(),
          hostname: nextHost,
          // Rotation never reaches the running listener without re-binding
          // with the new token — restart picks it up along with host/TLS.
          auth: { token: next.authToken },
          tlsConfig: next.tlsConfig ? await getOrCreateCertificate() : null,
        })
        await params.serverChannel.start()
      }
      else {
        // Ensure it's running
        await params.serverChannel.start()
      }
      lastStartError = null

      return {
        websocketTlsConfig: next.tlsConfig || null,
        authToken: next.authToken,
        hostname: next.hostname,
        port: getServerChannelPort(),
        tlsEnabled: !!next.tlsConfig,
        bound: true,
        lastError: null,
      }
    }
    catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      // An apply exception mid-restart can leave the listener down — report it
      // through get/apply config as bound:false + lastError, not just the log.
      lastStartError = message
      useLogg('main/server-runtime').withError(error).error('Failed to apply server channel configuration')
      const current = await getChannelServerConfig().catch(() => undefined)
      return {
        websocketTlsConfig: current?.tlsConfig || null,
        authToken: current?.authToken ?? '',
        hostname: current?.hostname || env.SERVER_RUNTIME_HOSTNAME || '127.0.0.1',
        port: getServerChannelPort(),
        tlsEnabled: !!current?.tlsConfig,
        bound: false,
        lastError: message,
        ok: false,
        error: message,
      } as ElectronServerChannelConfig
    }
  })
}

export type { Server as ServerChannel }
