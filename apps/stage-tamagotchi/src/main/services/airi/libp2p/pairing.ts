import type { Multiaddr } from '@multiformats/multiaddr'
import type { InferOutput } from 'valibot'

import { Buffer } from 'node:buffer'
import { randomBytes } from 'node:crypto'

import { peerIdFromString } from '@libp2p/peer-id'
import { multiaddr } from '@multiformats/multiaddr'
import { safeStorage } from 'electron'
import { array, boolean, number, object, string } from 'valibot'

import { createConfig } from '../../../libs/electron/persistence'

const PAIRING_NAMESPACE = 'libp2p-pairing'
const PAIRING_FILENAME = 'paired-devices.json'

const PairedDeviceSchema = object({
  peerId: string(),
  alias: string(),
  multiaddrs: array(string()),
  pairedAt: number(),
  lastSeen: number(),
  trusted: boolean(),
})

type PairedDevice = InferOutput<typeof PairedDeviceSchema>

const PairedDevicesSchema = object({
  devices: array(PairedDeviceSchema),
})

const pairedDevicesStore = createConfig(
  PAIRING_NAMESPACE,
  PAIRING_FILENAME,
  PairedDevicesSchema,
  { default: { devices: [] } },
)

const PAIRING_TOKEN_KEY = 'airi:libp2p:pairing-token'

/** GossipSub topic the inviter publishes invitations on, for discovery. */
export const PAIRING_INVITES_TOPIC = 'airi/pairing/invites'
/** GossipSub topic the accepter publishes pairing requests on. */
export const PAIRING_REQUESTS_TOPIC = 'airi/pairing/requests'

/** Wire payload the inviter publishes on `airi/pairing/invites`. */
interface InviteWirePayload {
  type: 'invite'
  magicCode: string
  /**
   * The invitation a discovering peer needs, and nothing that authorises a
   * pairing. `Omit` keeps the field list in sync with `PairingInvitation`
   * while the omitted `token` stays off the topic, so a token can only reach
   * this payload by being added to the wire type on purpose.
   */
  invite: Omit<PairingInvitation, 'token'>
}

/** Wire payload the accepter publishes on `airi/pairing/requests`. */
interface PairingRequestWirePayload {
  type: 'pairing-request'
  token: string
}

interface PairingInvitation {
  peerId: string
  multiaddrs: string[]
  token: string
  name: string
  expiresAt: number
}

/**
 * An invitation discovered on `airi/pairing/invites`: the wire fields minus the
 * token, which the inviter never publishes. Without it a discovered invite
 * names and locates the inviter but cannot authorise a pairing — the token
 * that completes one is handed over out of band as a QR payload, so a bare
 * magic code resolves here for discovery only.
 */
type DiscoveredInvite = Omit<PairingInvitation, 'token'>

interface MagicWormholeCode {
  code: string
  peerId: string
  token: string
  expiresAt: number
}

/**
 * The invitation as parsed from a QR payload. `token` and `multiaddrs` are
 * untrusted wire data: `multiaddrs` is dialled and so is validated by the
 * transport, and `token` is matched against the invitation this node actually
 * issued. A QR payload carries the token because it is handed over
 * out of band; an invite discovered on `airi/pairing/invites` never does, so
 * it is resolved through `DiscoveredInvite` and cannot be accepted on its own.
 */
export interface ParsedPairingInvitation {
  peerId: string
  token: string
  multiaddrs: string[]
  expiresAt?: number
  name?: string
}

/**
 * The narrow piece of the live libp2p node pairing needs to dial a peer.
 *
 * An invite carries multiaddrs, not a PeerId the peer store already knows, so
 * the accepter dials by address. `unknown` for the connection keeps the
 * interface free of the libp2p `Connection` type, which pairing never inspects.
 */
export interface PairingDialer {
  dial: (multiaddrs: Multiaddr[]) => Promise<unknown>
}

/** The narrow piece of the live libp2p node pairing needs to publish with. */
export interface PairingPublisher {
  publish: (topic: string, data: Uint8Array) => Promise<void>
}

/** Discriminated outcome of accepting a pairing, so the UI can say why. */
export type AcceptPairingResult
  = | { peerId: string, alias: string, multiaddrs: string[], token: string }
    | { error: string }

function generatePairingToken(): string {
  return randomBytes(16).toString('base64url')
}

function generateMagicCode(): string {
  const words = [
    'alpha',
    'bravo',
    'charlie',
    'delta',
    'echo',
    'foxtrot',
    'golf',
    'hotel',
    'india',
    'juliet',
    'kilo',
    'lima',
    'mike',
    'november',
    'oscar',
    'papa',
    'quebec',
    'romeo',
    'sierra',
    'tangon',
    'uniform',
    'victor',
    'whiskey',
    'xray',
    'yankee',
    'zulu',
    'atlas',
    'beacon',
    'cipher',
    'drift',
  ]
  const w1 = words[Math.floor(Math.random() * words.length)]
  const w2 = words[Math.floor(Math.random() * words.length)]
  const w3 = words[Math.floor(Math.random() * words.length)]
  const num = Math.floor(Math.random() * 1000).toString().padStart(3, '0')
  return `${w1}-${w2}-${w3}-${num}`
}

// NOTICE: Electron's SafeStorage exposes only encryptString/decryptString and has
// no key/value API, so pairing secrets live in this encrypted in-memory map for
// the duration of the invitation TTL instead of a fake key/value store.
const PAIRING_SECRETS = new Map<string, string>()

// NOTICE: invitations discovered on `airi/pairing/invites`, keyed by magic code
// and pruned as they expire. They are discovery hints only: no token is cached,
// because the topic never carries one, and a pairing is only completed by the
// inviter that issued the token — so a spoofed invite can neither pair nor dial
// at a trusted node.
const discoveredInvites = new Map<string, DiscoveredInvite>()

async function putPairingSecret(key: string, value: string): Promise<void> {
  PAIRING_SECRETS.set(key, safeStorage.encryptString(value).toString('base64'))
}

async function getPairingSecret(key: string): Promise<string | null> {
  const encrypted = PAIRING_SECRETS.get(key)
  if (encrypted === undefined) {
    return null
  }
  return safeStorage.decryptString(Buffer.from(encrypted, 'base64'))
}

async function deletePairingSecret(key: string): Promise<void> {
  PAIRING_SECRETS.delete(key)
}

async function storePairingToken(token: string, data: PairingInvitation): Promise<void> {
  await putPairingSecret(`${PAIRING_TOKEN_KEY}:${token}`, JSON.stringify(data))
}

async function getPairingToken(token: string): Promise<PairingInvitation | null> {
  try {
    const decrypted = await getPairingSecret(`${PAIRING_TOKEN_KEY}:${token}`)
    if (decrypted === null) {
      return null
    }
    return JSON.parse(decrypted)
  }
  catch {
    return null
  }
}

async function deletePairingToken(token: string): Promise<void> {
  try {
    await deletePairingSecret(`${PAIRING_TOKEN_KEY}:${token}`)
  }
  catch {
    // Ignore
  }
}

/** Drop discovered invites whose TTL has passed. */
function pruneDiscoveredInvites(): void {
  const now = Date.now()
  for (const [code, invite] of discoveredInvites) {
    if (invite.expiresAt <= now) {
      discoveredInvites.delete(code)
    }
  }
}

/**
 * Cache an invitation discovered on `airi/pairing/invites`, or ignore it when
 * malformed or already expired. The payload carries no token, so the cached
 * record is token-free and can only name and locate the inviter.
 */
export function rememberDiscoveredInvite(payload: unknown): DiscoveredInvite | null {
  if (typeof payload !== 'object' || payload === null) {
    return null
  }

  const { magicCode, invite } = payload as { magicCode?: unknown, invite?: unknown }
  if (typeof invite !== 'object' || invite === null) {
    return null
  }

  const { peerId, multiaddrs, expiresAt, name } = invite as Partial<Omit<PairingInvitation, 'token'>>
  if (typeof peerId !== 'string' || !Array.isArray(multiaddrs) || typeof expiresAt !== 'number') {
    return null
  }
  if (expiresAt <= Date.now()) {
    return null
  }

  const parsed: DiscoveredInvite = {
    peerId,
    multiaddrs: multiaddrs.filter((addr): addr is string => typeof addr === 'string'),
    name: typeof name === 'string' ? name : 'AIRI Node',
    expiresAt,
  }
  if (typeof magicCode === 'string') {
    pruneDiscoveredInvites()
    discoveredInvites.set(magicCode, parsed)
  }
  return parsed
}

/** Resolve an invitation a peer published, by its magic code. */
export function findDiscoveredInviteByMagicCode(code: string): DiscoveredInvite | null {
  pruneDiscoveredInvites()
  return discoveredInvites.get(code) ?? null
}

/**
 * Parse an `airi-pair://` QR payload into the wire fields it carries.
 *
 * Format: `airi-pair://<peerId>?token=<token>&addrs=<comma-separated urlencoded addrs>`.
 * Returns `null` when the input is not that shape, which is also how the caller
 * learns the input was a bare magic code instead of a QR payload.
 */
export function parsePairingInvitation(input: string): ParsedPairingInvitation | null {
  const PAIRING_SCHEME = 'airi-pair://'
  if (!input.startsWith(PAIRING_SCHEME)) {
    return null
  }

  // The authority is split off by hand rather than through `URL`: the only way
  // `URL` accepts this scheme is to rewrite it as `http`, and `URL.hostname`
  // then lowercases the host. The peerId is a case-sensitive base58btc multibase
  // string, so that rewrite silently corrupts it — `peerIdFromString` rejects
  // the lowercased form outright, the self-pair guard can never match the local
  // node's own id, and the accepter stores an id nobody else recognises. Taking
  // the head verbatim also stops a crafted authority from being reinterpreted
  // through host grammar.
  const rest = input.slice(PAIRING_SCHEME.length)
  const queryStart = rest.indexOf('?')
  const peerId = queryStart === -1 ? rest : rest.slice(0, queryStart)
  const query = queryStart === -1 ? '' : rest.slice(queryStart + 1)

  const token = new URLSearchParams(query).get('token')
  const addrsParam = new URLSearchParams(query).get('addrs')
  if (!peerId || !token || !addrsParam) {
    return null
  }

  // Reject a malformed or injected id here rather than storing it: every
  // consumer of the returned peerId hands it to `peerIdFromString`.
  try {
    peerIdFromString(peerId)
  }
  catch {
    return null
  }

  const multiaddrs = addrsParam
    .split(',')
    .map(addr => addr.trim())
    .filter(addr => addr.length > 0)
  if (multiaddrs.length === 0) {
    return null
  }

  return { peerId, token, multiaddrs }
}

/**
 * Publish the invitation on `airi/pairing/invites` so a peer can find it by
 * magic code without out-of-band address exchange. The payload carries the
 * invitation but never its token, so discovery alone cannot complete a pairing.
 */
async function publishPairingInvite(
  magicCode: string,
  invitation: PairingInvitation,
  publisher?: PairingPublisher,
): Promise<void> {
  if (!publisher) {
    return
  }
  // Token stripped before it reaches the wire: `invite` is the token-free
  // shape, so a token can only ride along if the field list is widened on
  // purpose. The accepter still needs one to pair, but out of band (QR) — the
  // inviter that issued it re-validates it before recording anything.
  const payload: InviteWirePayload = {
    type: 'invite',
    magicCode,
    invite: {
      peerId: invitation.peerId,
      multiaddrs: invitation.multiaddrs,
      name: invitation.name,
      expiresAt: invitation.expiresAt,
    },
  }
  await publisher.publish(PAIRING_INVITES_TOPIC, new TextEncoder().encode(JSON.stringify(payload)))
}

/**
 * Publish a `pairing-request` carrying the token of the invitation this node
 * accepted, so the inviter that owns the token can record the pair.
 */
export async function publishPairingRequest(
  token: string,
  publisher: PairingPublisher,
): Promise<void> {
  const payload: PairingRequestWirePayload = { type: 'pairing-request', token }
  await publisher.publish(PAIRING_REQUESTS_TOPIC, new TextEncoder().encode(JSON.stringify(payload)))
}

/**
 * Create a pairing invitation for this device.
 * Returns an object with the invitation data and a QR code string.
 */
export async function createPairingInvitation(
  multiaddrs: string[],
  peerId: string,
  name: string,
  ttlMinutes: number = 30,
  publisher?: PairingPublisher,
): Promise<{ invitation: PairingInvitation, qrCode: string, magicCode: string }> {
  const token = generatePairingToken()
  const magicCode = generateMagicCode()
  const expiresAt = Date.now() + ttlMinutes * 60 * 1000

  const invitation: PairingInvitation = {
    peerId,
    multiaddrs,
    token,
    name,
    expiresAt,
  }

  await storePairingToken(token, invitation)

  // Store magic code mapping
  const magicData: MagicWormholeCode = {
    code: magicCode,
    peerId,
    token,
    expiresAt,
  }
  await putPairingSecret(`${PAIRING_TOKEN_KEY}:magic:${magicCode}`, JSON.stringify(magicData))

  // QR code contains: airi-pair://<peerId>?token=<token>&addrs=<comma-separated-multiaddrs>
  const qrCode = `airi-pair://${peerId}?token=${token}&addrs=${multiaddrs.map(encodeURIComponent).join(',')}`

  try {
    await publishPairingInvite(magicCode, invitation, publisher)
  }
  catch {
    // An unpublishable invite is a discovery shortcut only — the QR payload
    // still works standalone, so the failure is not fatal to the invitation.
  }

  return { invitation, qrCode, magicCode }
}

/**
 * Accept a pairing invitation from another device.
 *
 * `parsed` is untrusted wire data, taken from the QR string or from an invite a
 * peer published. Expiry is checked against whatever TTL the source carried; the
 * token itself is validated by the inviter, which is the only node that issued
 * it, when the request arrives on `airi/pairing/requests`.
 */
export async function acceptPairingInvitation(
  parsed: ParsedPairingInvitation,
  localPeerId: string,
  alias: string | undefined,
  node: PairingDialer,
): Promise<AcceptPairingResult> {
  if (!parsed.token) {
    return { error: 'This pairing invitation does not carry a token and cannot be accepted.' }
  }
  if (parsed.multiaddrs.length === 0) {
    return { error: 'This pairing invitation carries no address, so this device cannot be reached.' }
  }
  if (parsed.expiresAt !== undefined && parsed.expiresAt < Date.now()) {
    return { error: 'This pairing invitation has expired.' }
  }
  if (parsed.peerId === localPeerId) {
    return { error: 'You cannot pair with this device itself.' }
  }

  try {
    await node.dial(parsed.multiaddrs.map(m => multiaddr(m)))
  }
  catch (err) {
    return {
      error: `Could not reach the other device: ${err instanceof Error ? err.message : String(err)}`,
    }
  }

  const resolvedAlias = alias || parsed.name || 'AIRI Node'

  await addPairedDevice({
    peerId: parsed.peerId,
    alias: resolvedAlias,
    multiaddrs: parsed.multiaddrs,
    pairedAt: Date.now(),
    lastSeen: Date.now(),
    trusted: true,
  })

  return { peerId: parsed.peerId, alias: resolvedAlias, multiaddrs: parsed.multiaddrs, token: parsed.token }
}

/**
 * Accept a pairing via magic code.
 *
 * The code only names an invitation this node issued, whose token is already
 * held locally. An invitation a peer published on `airi/pairing/invites` is
 * only discoverable by code — it carries no token, so it cannot be accepted
 * through this path: the accepter needs the QR payload, which carries the
 * token out of band.
 */
export async function acceptMagicCode(
  code: string,
  localPeerId: string,
  alias: string | undefined,
  node: PairingDialer,
): Promise<AcceptPairingResult> {
  const local = await getPairingSecret(`${PAIRING_TOKEN_KEY}:magic:${code}`)
  let parsed: ParsedPairingInvitation

  if (local !== null) {
    const magicData: MagicWormholeCode = JSON.parse(local)
    if (magicData.expiresAt < Date.now()) {
      await deletePairingSecret(`${PAIRING_TOKEN_KEY}:magic:${code}`)
      return { error: 'This pairing invitation has expired.' }
    }
    const stored = await getPairingToken(magicData.token)
    parsed = {
      peerId: magicData.peerId,
      token: magicData.token,
      multiaddrs: stored?.multiaddrs ?? [],
      expiresAt: magicData.expiresAt,
    }
  }
  else {
    const discovered = findDiscoveredInviteByMagicCode(code)
    if (!discovered) {
      return { error: 'No pairing invitation with that code was found.' }
    }
    // A discovered invite carries no token — the topic never carried one — so
    // discovery alone can only name and locate the inviter. The token that
    // authorises the pairing must arrive out of band: as a QR payload the user
    // pastes, which `parsePairingInvitation` reads before this function is
    // reached. Reaching this branch means the user typed the bare magic code
    // without one, so the pairing cannot be completed.
    return {
      error: 'That pairing invitation was discovered on the local network, so it carries no token. Scan or paste its QR payload to pair.',
    }
  }

  const result = await acceptPairingInvitation(parsed, localPeerId, alias, node)
  if ('error' in result) {
    return result
  }

  await deletePairingToken(parsed.token)
  await deletePairingSecret(`${PAIRING_TOKEN_KEY}:magic:${code}`)
  return result
}

/**
 * Record a peer that presented a valid token via `airi/pairing/requests`,
 * consuming the token so the invite cannot be replayed.
 *
 * Returns the recorded device, or `null` when the token was never issued by
 * this node, was already consumed, has expired, or names this node itself.
 */
export async function recordPairingRequest(
  token: string,
  senderPeerId: string,
  senderMultiaddrs: string[],
  alias?: string,
): Promise<PairedDevice | null> {
  const invitation = await getPairingToken(token)
  if (!invitation) {
    return null
  }
  if (invitation.expiresAt < Date.now()) {
    await deletePairingToken(token)
    return null
  }
  if (invitation.peerId === senderPeerId) {
    return null
  }

  const device: PairedDevice = {
    peerId: senderPeerId,
    alias: alias || invitation.name,
    multiaddrs: senderMultiaddrs.length > 0 ? senderMultiaddrs : invitation.multiaddrs,
    pairedAt: Date.now(),
    lastSeen: Date.now(),
    trusted: true,
  }

  await addPairedDevice(device)
  // One token, one pairing: the invite is spent.
  await deletePairingToken(token)

  return device
}

async function getPairedDevices(): Promise<PairedDevice[]> {
  const data = await pairedDevicesStore.get()
  return data?.devices ?? []
}

async function addPairedDevice(device: PairedDevice): Promise<void> {
  const devices = await getPairedDevices()
  const existingIndex = devices.findIndex(d => d.peerId === device.peerId)
  if (existingIndex >= 0) {
    devices[existingIndex] = { ...devices[existingIndex], ...device, lastSeen: Date.now() }
  }
  else {
    devices.push(device)
  }
  await pairedDevicesStore.update({ devices })
}

export async function listPairedDevices(): Promise<PairedDevice[]> {
  return getPairedDevices()
}

export async function removePairedDevice(peerId: string): Promise<void> {
  const devices = await getPairedDevices()
  const filtered = devices.filter(d => d.peerId !== peerId)
  await pairedDevicesStore.update({ devices: filtered })
}

export async function updatePairedDeviceAlias(peerId: string, alias: string): Promise<void> {
  const devices = await getPairedDevices()
  const device = devices.find(d => d.peerId === peerId)
  if (device) {
    device.alias = alias
    await pairedDevicesStore.update({ devices })
  }
}

export async function updatePairedDeviceLastSeen(peerId: string): Promise<void> {
  const devices = await getPairedDevices()
  const device = devices.find(d => d.peerId === peerId)
  if (device) {
    device.lastSeen = Date.now()
    await pairedDevicesStore.update({ devices })
  }
}

export async function getTrustedPeers(): Promise<string[]> {
  const devices = await getPairedDevices()
  return devices.filter(d => d.trusted).map(d => d.peerId)
}
