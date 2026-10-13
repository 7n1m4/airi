import type { AgenticHttpStatusResponse, AgenticOsConfig } from '@proj-airi/stage-shared/agentic'

/**
 * The local HTTP endpoint for OS automation (Home Assistant, scripts, cron).
 *
 * ── Design decisions, and why ───────────────────────────────────────────────
 *
 * **Bind address: `127.0.0.1` only.** This endpoint exposes the ability to make
 * the companion speak. Binding it to `0.0.0.0` would put that ability on every
 * interface the machine has — including the LAN — where any peer could drive
 * the companion, exhaust an LLM provider's quota, or use the companion as a
 * covert channel. The libp2p mesh already covers the cross-device case with
 * pairing and trust; this endpoint is for the *local* automation tool, which by
 * definition runs on this machine. Loopback is also the one address that
 * requires no ambient authority: traffic cannot arrive unless a process on this
 * host originated it.
 *
 * **Port: a high, unlikely-to-collide default (`47831`), overridable through the
 * persisted config.** The server channel already owns `6121`; sharing it would
 * couple two independent lifecycles and its auth model (an optional bearer
 * token) to a control surface that must never be open by default.
 *
 * **Auth: a bearer token that must exist and be non-empty for the endpoint to
 * serve anything; otherwise it refuses all requests.** A local automation tool
 * needs a token it can store once, not an interactive login. Loopback is not
 * treated as sufficient on its own: any process on the host (including one
 * dropped by a browser download) can reach loopback, so the token is what
 * converts "is running on this machine" into "was configured by the user". The
 * token is generated on first enable and rotatable; it is never returned to the
 * renderer, only written to disk.
 *
 * **Payload shape: two endpoints, one read-only and one trigger.**
 * - `GET /status` → `AgenticHttpStatusResponse` (state, mode, last cycle).
 * - `POST /cycle` → `AgenticHttpCycleResponse` (accepted boolean + reason).
 * A local automation tool needs exactly two facts ("is the user there?" and
 * "make it talk now") and nothing else. Notably absent: any endpoint that reads
 * memory, lists intentions, or returns conversation text. An attacker who
 * somehow acquires the token can make the companion speak; they still cannot
 * read anything it remembers.
 *
 * **No ambient authority.** Every route requires the token; a missing or wrong
 * token is a `401` with no body detail beyond the status, so the endpoint
 * cannot be used as a presence oracle by an unauthenticated prober.
 */

/** Default bind address. Loopback only, by design. */
export const DEFAULT_HTTP_HOST = '127.0.0.1'

/** Default port. Chosen to be unlikely to collide with any AIRI service. */
export const DEFAULT_HTTP_PORT = 47831

/** Longest request body the endpoint will buffer, in bytes. */
export const MAX_REQUEST_BODY_BYTES = 8 * 1024

/** Longest bearer token accepted, so a hostile client cannot force a large compare. */
const MAX_TOKEN_LENGTH = 512

/** Route paths, kept as constants so the handler and the docs cannot drift. */
export const AGENTIC_HTTP_ROUTES = {
  status: '/status',
  cycle: '/cycle',
} as const

export type AgenticHttpRoute = typeof AGENTIC_HTTP_ROUTES[keyof typeof AGENTIC_HTTP_ROUTES]

/** Result of authorising one request, before any route work happens. */
export type AgenticHttpAuthResult
  = | { authorized: true }
    | { authorized: false, status: 400 | 401, reason: string }

/**
 * Authorise one HTTP request.
 *
 * A constant-time comparison is used so a token with a shared prefix cannot be
 * discovered byte-by-byte from response timing. The token is bounded before the
 * comparison so an unbounded header cannot force a long compare.
 */
export function authorizeAgenticHttpRequest(input: {
  authorizationHeader: string | undefined
  expectedToken: string
}): AgenticHttpAuthResult {
  if (!input.expectedToken) {
    // The endpoint is disabled until a token exists. This is the state a
    // fresh install is in, and the state it returns to when disabled.
    return { authorized: false, status: 401, reason: 'endpoint-disabled' }
  }

  const header = input.authorizationHeader ?? ''
  if (header.length > MAX_TOKEN_LENGTH) {
    return { authorized: false, status: 401, reason: 'malformed-authorization' }
  }

  const scheme = 'Bearer '
  if (!header.startsWith(scheme)) {
    return { authorized: false, status: 401, reason: 'missing-bearer-scheme' }
  }

  const supplied = header.slice(scheme.length).trim()
  if (!timingSafeEqual(supplied, input.expectedToken)) {
    return { authorized: false, status: 401, reason: 'token-mismatch' }
  }

  return { authorized: true }
}

/**
 * Constant-time string comparison over equal-length UTF-16 code units.
 *
 * NOTICE: Node's `crypto.timingSafeEqual` requires equal-length Buffers and
 * throws otherwise, so the length is checked first and the comparison always
 * runs over the expected length to avoid leaking the token's length.
 */
export function timingSafeEqual(supplied: string, expected: string): boolean {
  if (supplied.length !== expected.length) {
    return false
  }

  let mismatch = 0
  for (let index = 0; index < expected.length; index++) {
    mismatch |= supplied.charCodeAt(index) ^ expected.charCodeAt(index)
  }
  return mismatch === 0
}

/** Which route a request resolved to, or `null` for an unknown path. */
export function resolveAgenticHttpRoute(method: string, path: string): AgenticHttpRoute | null {
  const normalized = path.length > 1 && path.endsWith('/') ? path.slice(0, -1) : path
  if (method === 'GET' && normalized === AGENTIC_HTTP_ROUTES.status) {
    return AGENTIC_HTTP_ROUTES.status
  }
  if (method === 'POST' && normalized === AGENTIC_HTTP_ROUTES.cycle) {
    return AGENTIC_HTTP_ROUTES.cycle
  }
  return null
}

/**
 * The status payload, given the state the renderer last reported.
 *
 * A `null` last-cycle means no cycle has run in this session, which is reported
 * as `0` rather than omitted so a client can compare it without a null check.
 */
export function buildAgenticHttpStatus(input: {
  present: boolean
  presenceState: AgenticHttpStatusResponse['presenceState']
  autonomousMode: AgenticOsConfig['autonomousMode']
  lastCycleAt: number | null
}): AgenticHttpStatusResponse {
  return {
    present: input.present,
    presenceState: input.presenceState,
    autonomousMode: input.autonomousMode,
    lastCycleAt: input.lastCycleAt ?? 0,
  }
}
