/**
 * D-Bus control plane for the Rust gateway daemon (`airi-daemon`,
 * `org.moeru.airi.Daemon1`). Pure Node — no electron imports — so it stays
 * unit-testable and usable from any main-process context.
 *
 * When the daemon is not on the session bus (macOS/Windows, or Linux without
 * the daemon running), `getDaemonGatewayStatus` resolves to `undefined` and
 * callers are expected to fall back to the in-app channel server.
 */
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const BUS_DEST = 'org.moeru.airi.Daemon1'
const BUS_PATH = '/org/moeru/airi/Daemon1'
const BUS_IFACE = 'org.moeru.airi.Daemon1'

const execFileAsync = promisify(execFile) as (
  file: string,
  args: string[],
  options: { timeout?: number },
) => Promise<{ stdout: string, stderr: string }>

export interface DaemonGatewayStatus {
  hostname: string
  port: number
  tlsEnabled: boolean
  bound: boolean
  lastError: string | null
  adoptedFrom: string | null
  caCertPath: string | null
  authToken: string
}

/**
 * busctl `--json=short` prints a `{"type":"s","data":"..."}` envelope where
 * `data` is a JSON-encoded string (double-encoded). Returns the decoded inner
 * value, or `undefined` on any parse/shape failure. Tolerates a trailing
 * newline.
 */
export function parseBusctlStringReply(stdout: string): unknown | undefined {
  try {
    const outer = JSON.parse(stdout)
    if (!outer || typeof outer !== 'object')
      return undefined
    if ((outer as { type?: unknown }).type !== 's')
      return undefined
    const data = (outer as { data?: unknown }).data
    if (typeof data !== 'string')
      return undefined
    return JSON.parse(data)
  }
  catch {
    return undefined
  }
}

export function parseServerChannelPort(raw: string | undefined): number {
  if (raw === undefined)
    return 6121
  const trimmed = raw.trim()
  if (!/^\d+$/.test(trimmed))
    return 6121
  const port = Number(trimmed)
  return Number.isInteger(port) && port >= 1 && port <= 65535 ? port : 6121
}

export async function getDaemonGatewayStatus(timeoutMs = 1200): Promise<DaemonGatewayStatus | undefined> {
  try {
    const { stdout } = await execFileAsync('busctl', [
      '--user',
      '--json=short',
      'call',
      BUS_DEST,
      BUS_PATH,
      BUS_IFACE,
      'GetGatewayConfig',
    ], { timeout: timeoutMs })

    const inner = parseBusctlStringReply(stdout)
    if (!inner || typeof inner !== 'object')
      return undefined

    const value = inner as Record<string, unknown>
    if (typeof value.hostname !== 'string')
      return undefined
    if (typeof value.port !== 'number' || !Number.isInteger(value.port) || value.port < 0 || value.port > 65535)
      return undefined
    if (typeof value.authToken !== 'string')
      return undefined
    if (typeof value.tlsEnabled !== 'boolean' || typeof value.bound !== 'boolean')
      return undefined

    return {
      hostname: value.hostname,
      port: value.port,
      tlsEnabled: value.tlsEnabled,
      bound: value.bound,
      lastError: typeof value.lastError === 'string' ? value.lastError : null,
      adoptedFrom: typeof value.adoptedFrom === 'string' ? value.adoptedFrom : null,
      caCertPath: typeof value.caCertPath === 'string' ? value.caCertPath : null,
      authToken: value.authToken,
    }
  }
  catch {
    // Daemon not running, bus unavailable, timeout, or busctl missing — caller falls back.
    return undefined
  }
}

/**
 * Forward an ApplyGatewayConfig patch to the daemon. The patch is passed as a
 * single pre-serialized string argument (never shell-interpolated). Returns
 * whatever the daemon reports — `{ ok: true, ... }` or `{ ok: false, error }` —
 * or `undefined` on transport failure.
 */
export async function applyDaemonGatewayConfig(
  patch: { websocketTlsConfig?: unknown, authToken?: string, hostname?: string },
  // NOTICE: apply can mint a local CA + leaf cert (TLS enable), which is well
  // above the 1.2 s read budget — give it room before declaring failure.
  timeoutMs = 10000,
): Promise<Record<string, unknown> | undefined> {
  try {
    const { stdout } = await execFileAsync('busctl', [
      '--user',
      '--json=short',
      'call',
      BUS_DEST,
      BUS_PATH,
      BUS_IFACE,
      'ApplyGatewayConfig',
      's',
      JSON.stringify(patch),
    ], { timeout: timeoutMs })

    const inner = parseBusctlStringReply(stdout)
    if (!inner || typeof inner !== 'object' || Array.isArray(inner))
      return undefined
    return inner as Record<string, unknown>
  }
  catch {
    return undefined
  }
}
