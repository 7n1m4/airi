import type { Multiaddr } from '@multiformats/multiaddr'
import type { GenericSchema, InferOutput } from 'valibot'

import { Buffer } from 'node:buffer'
import { randomBytes } from 'node:crypto'

import { peerIdFromString } from '@libp2p/peer-id'
import { multiaddr } from '@multiformats/multiaddr'
import { safeStorage } from 'electron'
import { array, boolean, finite, maxLength, minLength, number, object, optional, pipe, safeParse, strictObject, string } from 'valibot'

import { createConfig } from '../../../libs/electron/persistence'

const PAIRING_NAMESPACE = 'libp2p-pairing'
const PAIRING_FILENAME = 'paired-devices.json'

/**
 * Range limits for anything that reaches this module from the wire, a QR
 * payload, or a caller. Peer ids, aliases and multiaddrs end up in a
 * paired-device record that is JSON round-tripped to disk, so unbounded input
 * would become an unbounded store; capping the input bounds the store without
 * any code having to police it later.
 */
const MAX_TOKEN_LENGTH = 128
const MAX_PEER_ID_LENGTH = 128
const MAX_ALIAS_LENGTH = 256
const MAX_MULTIADDR_LENGTH = 512
const MAX_MULTIADDR_COUNT = 16
const MAX_PAIRED_DEVICES = 512
const MAX_DISCOVERED_INVITES = 128
/** Longest `airi-pair://` payload that will be parsed at all. */
const MAX_QR_CODE_LENGTH = 4096
/** Bound on a dial so a peer that never completes a handshake cannot leak a promise. */
const DIAL_TIMEOUT_MS = 15_000

/**
 * NOTICE: pairing secrets live under a versioned, distinct key prefix. Tokens
 * used to share `airi:libp2p:pairing-token` with magic records nested at
 * `airi:libp2p:pairing-token:magic:<code>`, and magic codes were published in
 * plaintext on `airi/pairing/invites` — so a pairing request whose token was
 * the literal string `magic:<code>` resolved a *magic* record, which has no
 * `multiaddrs`, and persisted a schema-invalid device. With the magic write path
 * gone (a code is now only a discovery hint) and a token-shaped key check on
 * read, that namespace cannot be reached from the wire.
 */
const PAIRING_TOKEN_KEY_PREFIX = 'airi:libp2p:pairing-token:v1'

/** GossipSub topic the inviter publishes invitations on, for network discovery. */
export const PAIRING_INVITES_TOPIC = 'airi/pairing/invites'
/** GossipSub topic the accepter publishes pairing requests on. */
export const PAIRING_REQUESTS_TOPIC = 'airi/pairing/requests'
/**
 * GossipSub topic the inviter publishes its confirmation of a completed pairing
 * on. The accepter dials and records the inviter *before* the inviter has seen
 * the request, so it must not treat that record as trusted; this topic is the
 * only thing that flips `trusted` to `true`.
 */
export const PAIRING_ACCEPTED_TOPIC = 'airi/pairing/accepted'

/** A multiaddr string, bounded before it is parsed or dialled. */
const multiaddrSchema = pipe(string(), minLength(1), maxLength(MAX_MULTIADDR_LENGTH))
const multiaddrArraySchema = pipe(array(multiaddrSchema), maxLength(MAX_MULTIADDR_COUNT))

/**
 * `strictObject` so an unknown key is an error rather than being silently
 * dropped, which is what let a `{ ...old, ...new }` merge lose an address list:
 * the merge now goes through a parse that refuses a missing `multiaddrs`.
 */
const PairedDeviceSchema = strictObject({
  peerId: pipe(string(), minLength(1), maxLength(MAX_PEER_ID_LENGTH)),
  alias: pipe(string(), minLength(1), maxLength(MAX_ALIAS_LENGTH)),
  multiaddrs: multiaddrArraySchema,
  pairedAt: number(),
  lastSeen: number(),
  trusted: boolean(),
})

type PairedDevice = InferOutput<typeof PairedDeviceSchema>

/** The persisted store; `array(..., maxLength)` bounds growth to 512 devices. */
const PairedDevicesSchema = object({
  devices: pipe(array(PairedDeviceSchema), maxLength(MAX_PAIRED_DEVICES)),
})

const pairedDevicesStore = createConfig(
  PAIRING_NAMESPACE,
  PAIRING_FILENAME,
  PairedDevicesSchema,
  { default: { devices: [] } },
)

interface PairingInvitation {
  peerId: string
  multiaddrs: string[]
  token: string
  name: string
  expiresAt: number
}

const PairingInvitationSchema = strictObject({
  peerId: pipe(string(), minLength(1), maxLength(MAX_PEER_ID_LENGTH)),
  multiaddrs: multiaddrArraySchema,
  token: pipe(string(), minLength(1), maxLength(MAX_TOKEN_LENGTH)),
  name: pipe(string(), maxLength(MAX_ALIAS_LENGTH)),
  expiresAt: pipe(number(), finite()),
})

/**
 * An invitation discovered on `airi/pairing/invites`: the wire fields minus the
 * token, which the inviter never publishes. Without it a discovered invite
 * names and locates the inviter but cannot authorise a pairing, so resolving a
 * magic code can only ever show a peer what to scan, never pair with it.
 */
type DiscoveredInvite = Omit<PairingInvitation, 'token'>

const DiscoveredInviteSchema = strictObject({
  peerId: pipe(string(), minLength(1), maxLength(MAX_PEER_ID_LENGTH)),
  multiaddrs: multiaddrArraySchema,
  name: optional(pipe(string(), maxLength(MAX_ALIAS_LENGTH)), 'AIRI Node'),
  expiresAt: pipe(number(), finite()),
})

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
  /**
   * The accepter's own PeerId, asserted (not proven) by the payload. The
   * inviter rejects a request whose `senderPeerId` disagrees with the
   * `propagationSource` of the message, so a harvested token cannot be
   * replayed from a different node without also being re-published by a node
   * that stole it. This is the strongest binding available on this transport:
   * `airi/pairing/requests` is published anonymously (gossipsub's
   * `getPublishConfigFromPeerId` signs only the envelope author, not the
   * payload fields), so the payload itself carries no signature an inviter
   * could verify against the token's recipient.
   */
  senderPeerId: string
}

/**
 * The invitation as parsed from a QR payload. `token` and `multiaddrs` are
 * untrusted wire data: `multiaddrs` is validated by `multiaddr()` before it is
 * dialled, and `token` is matched against the invitation this node actually
 * issued. A QR payload carries the token because it is handed over out of band;
 * an invite discovered on `airi/pairing/invites` never does, so it is resolved
 * through `DiscoveredInvite` and cannot be accepted on its own.
 *
 * `expiresAt` and `name` come from the payload and are enforced here, so an
 * expired invitation is refused by the accepter before it is stored.
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
export interface PairingDialer { dial: (multiaddrs: Multiaddr[]) => Promise<unknown> }

/** The narrow piece of the live libp2p node pairing needs to publish with. */
export interface PairingPublisher { publish: (topic: string, data: Uint8Array) => Promise<void> }

/** Discriminated outcome of accepting a pairing, so the UI can say why. */
export type AcceptPairingResult
  = | { peerId: string, alias: string, multiaddrs: string[], token: string }
    | { error: string }

/**
 * Thrown when a storage surface this module depends on fails instead of
 * returning a value. `safeStorage.encryptString` throws when keychain-backed
 * encryption is unavailable, and every caller of `createPairingInvitation` used
 * to see that as an unhandled rejection; the message says what is unavailable
 * so a handler can surface it instead of diagnosing a mystery crash.
 */
export class PairingStorageError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message)
    this.name = 'PairingStorageError'
    if (options?.cause !== undefined) {
      this.cause = options.cause
    }
  }
}

/**
 * `unknown` in, schema-checked output, or `null`. Used at every boundary where
 * a value arrives untyped (a gossip payload, a decrypted secret) so nothing
 * downstream ever has to trust a shape it did not check.
 */
function parseRecord<TSchema extends GenericSchema>(schema: TSchema, input: unknown): InferOutput<TSchema> | null {
  const result = safeParse(schema, input)
  return result.success ? result.output : null
}

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
  // A magic code is published in plaintext and used as a map key, so its
  // word/digit shape is drawn from a CSPRNG: `Math.random()` gave ~24.7 bits
  // from a seed anyone who can read JS process state can reproduce.
  const draw = (bound: number) => randomBytes(4).readUInt32BE() % bound
  const w1 = words[draw(words.length)]
  const w2 = words[draw(words.length)]
  const w3 = words[draw(words.length)]
  const num = draw(1000).toString().padStart(3, '0')
  return `${w1}-${w2}-${w3}-${num}`
}

// NOTICE: Electron's safeStorage exposes only encryptString/decryptString and
// has no key/value API, so pairing secrets live in this encrypted in-memory map
// for the duration of the invitation TTL instead of a fake key/value store.
const PAIRING_SECRETS = new Map<string, string>()

/**
 * NOTICE: a token is claimed synchronously so two concurrent `pairing-request`
 * messages, or an IPC call racing a pubsub message, cannot both spend the same
 * token. The encrypted value is moved out of `PAIRING_SECRETS` into the claims
 * map in one synchronous step — before any `await` — so the second caller
 * observes an empty map and is indistinguishable from an unknown token. Only
 * the winner decrypts and validates. A claim is released when nothing is
 * recorded, so a transport artefact cannot burn an otherwise live token, and
 * consumed when the pairing is recorded.
 */
const PAIRING_TOKEN_CLAIMS = new Map<string, string>()

/**
 * NOTICE: invitations discovered on `airi/pairing/invites`, keyed by magic code
 * and pruned as they expire. They are discovery hints only: no token is cached,
 * because the topic never carries one, and a pairing is only completed by the
 * inviter that issued the token — so a spoofed invite can neither pair nor dial
 * at a trusted node.
 */
const discoveredInvites = new Map<string, DiscoveredInvite>()

/**
 * Pairings this node started and is waiting for the inviter to confirm,
 * `token -> devicePeerId`. Only `acceptPairingInvitation` (via
 * `registerPendingAcceptedConfirmation`) can put an entry here, so the set of
 * devices a confirmation is able to promote is exactly the set this node just
 * paired with. Bounded for the same reason as the other caches.
 */
const pendingAcceptedConfirmations = new Map<string, string>()

function encryptSecret(value: string): string {
  try {
    return safeStorage.encryptString(value).toString('base64')
  }
  catch (err) {
    throw new PairingStorageError('Electron safeStorage is unavailable, so the pairing secret could not be encrypted', { cause: err })
  }
}

function decryptSecret(encrypted: string): string | null {
  try {
    return safeStorage.decryptString(Buffer.from(encrypted, 'base64'))
  }
  catch {
    // A record that no longer decrypts (keychain rotated, process restarted
    // under a different profile) is treated as absent rather than as an error:
    // the pairing it belonged to is simply dead.
    return null
  }
}

function pairingTokenKey(token: string): string {
  return `${PAIRING_TOKEN_KEY_PREFIX}:${token}`
}

function issuePairingToken(token: string, data: PairingInvitation): void {
  PAIRING_SECRETS.set(pairingTokenKey(token), encryptSecret(JSON.stringify(data)))
}

/**
 * A token is usable as a map key only if it cannot reach another namespace: it
 * must be the base64url the issuer produced, so the namespace separator and any
 * other character that could alias a key is rejected up front. This is what
 * keeps a wire-supplied `magic:<code>` out of the magic namespace.
 */
function isTokenKeySafe(token: string): boolean {
  return token.length > 0 && token.length <= MAX_TOKEN_LENGTH && /^[\w-]+$/.test(token)
}

/** Take the token out of the live map, leaving a single copy in the claims map. */
function claimPairingToken(token: string): string | null {
  const key = pairingTokenKey(token)
  const encrypted = PAIRING_SECRETS.get(key)
  if (encrypted === undefined) {
    return null
  }
  PAIRING_SECRETS.delete(key)
  PAIRING_TOKEN_CLAIMS.set(key, encrypted)
  return encrypted
}

/** Undo a claim, so a request that recorded nothing leaves the token live for a retry. */
function releasePairingToken(token: string): void {
  const key = pairingTokenKey(token)
  const encrypted = PAIRING_TOKEN_CLAIMS.get(key)
  if (encrypted !== undefined) {
    PAIRING_SECRETS.set(key, encrypted)
    PAIRING_TOKEN_CLAIMS.delete(key)
  }
}

/** Finish a claim: the token is spent and its encrypted value is discarded. */
function consumePairingToken(token: string): void {
  PAIRING_TOKEN_CLAIMS.delete(pairingTokenKey(token))
}

async function getPairedDevices(): Promise<PairedDevice[]> {
  // `createConfig().get()` is synchronous and returns the in-memory value; the
  // throttle only debounces the on-disk write, so there is no `await` here.
  const data = pairedDevicesStore.get()
  return data?.devices ?? []
}

/**
 * Write the paired-device list, refusing anything that fails the schema instead
 * of storing a truncated or partial record. `strictObject` plus bounded lengths
 * mean an unknown key or an oversized string is a rejection, not a silent
 * rewrite, so a bad caller cannot corrupt the store. A rejected write leaves the
 * previous store intact — the caller's mutation does not land, which is the
 * intended "reject, do not repair" behaviour, not a swallowed error.
 */
async function writePairedDevices(devices: PairedDevice[]): Promise<void> {
  const parsed = parseRecord(PairedDevicesSchema, { devices })
  if (parsed === null) {
    return
  }
  pairedDevicesStore.update(parsed)
}

/**
 * Merge a new record over an existing one without letting the new record's
 * blanks erase good data: `trusted` is preserved unless the pairing flow newly
 * confirmed it, and an empty address list never overwrites a real one. Re-pair
 * used to spread the new record over the old, which re-trusted a device the
 * user had untrusted and dropped a working address list.
 */
function mergePairedDevice(existing: PairedDevice, incoming: PairedDevice, trustConfirmed: boolean): PairedDevice {
  return {
    peerId: existing.peerId,
    alias: incoming.alias.length > 0 ? incoming.alias : existing.alias,
    multiaddrs: incoming.multiaddrs.length > 0 ? incoming.multiaddrs : existing.multiaddrs,
    pairedAt: existing.pairedAt,
    lastSeen: incoming.lastSeen,
    trusted: existing.trusted || trustConfirmed,
  }
}

/**
 * Persist a device. `trustConfirmed` is the only way a device becomes trusted
 * through a pairing flow: the accepter passes `false` (nothing has been
 * validated yet at that point) and the inviter passes `true` (it validated the
 * token the accepter spent).
 */
async function addPairedDevice(device: PairedDevice, trustConfirmed: boolean): Promise<void> {
  const devices = await getPairedDevices()
  const existingIndex = devices.findIndex(d => d.peerId === device.peerId)
  if (existingIndex >= 0) {
    const existing = devices[existingIndex]
    devices[existingIndex] = mergePairedDevice(existing, device, trustConfirmed)
  }
  else {
    devices.push(device)
  }
  await writePairedDevices(devices)
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
 * Evict oldest-inserted invites until the cache is within its cap: pruning only
 * removes entries that already expired, and `expiresAt` is peer-controlled, so
 * without a cap a burst of far-future values grows the map without bound.
 */
function capDiscoveredInvites(): void {
  while (discoveredInvites.size > MAX_DISCOVERED_INVITES) {
    const oldest = discoveredInvites.keys().next()
    if (oldest.done) {
      return
    }
    discoveredInvites.delete(oldest.value)
  }
}

/**
 * Cache an invitation discovered on `airi/pairing/invites`, or ignore it when
 * malformed or already expired. The payload carries no token, so the cached
 * record is token-free and can only name and locate the inviter. Everything in
 * the payload is peer-controlled, so the code, the address count, the address
 * length, the id length and the TTL are all bounded here, and a non-finite
 * `expiresAt` is rejected because `NaN` compares false and would otherwise
 * survive every prune forever.
 */
export function rememberDiscoveredInvite(payload: unknown): DiscoveredInvite | null {
  if (typeof payload !== 'object' || payload === null) {
    return null
  }
  if (!('magicCode' in payload) || !('invite' in payload)) {
    return null
  }
  const magicCode: unknown = payload.magicCode
  const invite: unknown = payload.invite
  if (typeof magicCode !== 'string' || magicCode.length === 0 || magicCode.length > MAX_TOKEN_LENGTH) {
    return null
  }
  if (typeof invite !== 'object' || invite === null) {
    return null
  }

  const parsed = parseRecord(DiscoveredInviteSchema, invite)
  if (parsed === null) {
    return null
  }
  if (parsed.expiresAt <= Date.now()) {
    return null
  }
  if (parsed.multiaddrs.length === 0) {
    return null
  }

  pruneDiscoveredInvites()
  discoveredInvites.set(magicCode, parsed)
  capDiscoveredInvites()
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
 * Format:
 * `airi-pair://<peerId>?token=<token>&addrs=<urlencoded,comma-separated addrs>&exp=<epoch-ms>&name=<name>`
 *
 * `exp` and `name` are both optional for compatibility with a payload produced
 * before they were encoded. Returns `null` when the input is not that shape,
 * which is also how a caller learns it was a bare magic code rather than a QR
 * payload.
 */
export function parsePairingInvitation(input: string): ParsedPairingInvitation | null {
  const PAIRING_SCHEME = 'airi-pair://'
  if (input.length > MAX_QR_CODE_LENGTH || !input.startsWith(PAIRING_SCHEME)) {
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

  const params = new URLSearchParams(query)
  const token = params.get('token')
  const addrsParam = params.get('addrs')
  const expiresAtParam = params.get('exp')
  const nameParam = params.get('name')
  if (peerId.length === 0 || peerId.length > MAX_PEER_ID_LENGTH) {
    return null
  }
  if (token === null || token.length > MAX_TOKEN_LENGTH) {
    return null
  }
  if (addrsParam === null) {
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

  // The address list was percent-encoded when the payload was built, so each
  // element is decoded before it is length-checked and dialled.
  const multiaddrs: string[] = []
  for (const rawAddr of addrsParam.split(',')) {
    let addr: string
    try {
      addr = decodeURIComponent(rawAddr.trim())
    }
    catch {
      return null
    }
    if (addr.length === 0) {
      continue
    }
    if (addr.length > MAX_MULTIADDR_LENGTH) {
      return null
    }
    multiaddrs.push(addr)
  }
  if (multiaddrs.length === 0 || multiaddrs.length > MAX_MULTIADDR_COUNT) {
    return null
  }

  // Optional TTL: a payload that carries a bogus one is rejected rather than
  // parsed as `NaN`, which would compare false against every expiry check and
  // let an expired QR be accepted indefinitely.
  let expiresAt: number | undefined
  if (expiresAtParam !== null) {
    const parsedExpiry = Number(expiresAtParam)
    if (!Number.isFinite(parsedExpiry)) {
      return null
    }
    expiresAt = parsedExpiry
  }

  // Optional display name, used as the accepter's default alias for the device.
  let name: string | undefined
  if (nameParam !== null) {
    if (nameParam.length > MAX_ALIAS_LENGTH) {
      return null
    }
    name = nameParam
  }

  return { peerId, token, multiaddrs, expiresAt, name }
}

/**
 * Publish the invitation on `airi/pairing/invites` so a peer can find it by
 * magic code without out-of-band address exchange. The payload carries the
 * invitation but never its token, so discovery alone cannot complete a pairing.
 */
async function publishPairingInvite(
  magicCode: string,
  invitation: PairingInvitation,
  publisher: PairingPublisher,
): Promise<void> {
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
 *
 * `senderPeerId` must be the accepter's **own** PeerId: the inviter compares it
 * against the `propagationSource` the message arrived from. The payload also
 * names that PeerId so the comparison is possible at all.
 */
export async function publishPairingRequest(
  token: string,
  senderPeerId: string,
  publisher: PairingPublisher,
): Promise<void> {
  if (!isTokenKeySafe(token) || senderPeerId.length === 0 || senderPeerId.length > MAX_PEER_ID_LENGTH) {
    return
  }
  const payload: PairingRequestWirePayload = { type: 'pairing-request', token, senderPeerId }
  await publisher.publish(PAIRING_REQUESTS_TOPIC, new TextEncoder().encode(JSON.stringify(payload)))
}

/**
 * Publish confirmation that a pairing completed, on `airi/pairing/accepted`.
 *
 * The accepter dials and records the inviter with `trusted: false`, because at
 * that point nothing has been validated; this message is the only thing that
 * flips it, and it is published only after the token has been consumed. It names
 * both the accepter's PeerId and the consumed token so the accepter can check
 * the token is the one it just spent — a bystander that re-publishes someone
 * else's accepted message cannot mark a device the accepter never paired with.
 */
async function publishPairingAccepted(
  accepterPeerId: string,
  token: string,
  publisher: PairingPublisher,
): Promise<void> {
  const payload = { type: 'pairing-accepted', peerId: accepterPeerId, token }
  try {
    await publisher.publish(PAIRING_ACCEPTED_TOPIC, new TextEncoder().encode(JSON.stringify(payload)))
  }
  catch {
    // A missing confirmation leaves the accepter untrusted rather than wrongly
    // trusted: the pairing itself already succeeded, so this is not fatal, and
    // the accepter can be re-paired to get a second confirmation.
  }
}

/**
 * Create a pairing invitation for this device.
 *
 * The magic code stays purely a discovery hint: it is published on
 * `airi/pairing/invites` and resolved by `findDiscoveredInviteByMagicCode`,
 * carries no token, and can show a peer what to scan but never pair with it.
 * The token that authorises the pairing only leaves this node as the QR payload.
 */
export async function createPairingInvitation(
  localMultiaddrs: string[],
  peerId: string,
  name: string,
  ttlMinutes: number,
  publisher: PairingPublisher,
): Promise<{ invitation: PairingInvitation, qrCode: string, magicCode: string }> {
  const token = generatePairingToken()
  const magicCode = generateMagicCode()
  const expiresAt = Date.now() + ttlMinutes * 60 * 1000

  const invitation: PairingInvitation = {
    peerId,
    multiaddrs: localMultiaddrs,
    token,
    name,
    expiresAt,
  }

  issuePairingToken(token, invitation)

  // QR code contains:
  // airi-pair://<peerId>?token=<token>&addrs=<comma-separated multiaddrs>&exp=<epoch-ms>&name=<name>
  //
  // `exp` and `name` are encoded so the accepter can enforce the TTL and offer a
  // default alias: without them the expiry check in `acceptPairingInvitation`
  // could never fire, because no producer set them and an expired QR was
  // accepted, dialled and stored indefinitely.
  const qrCode = `airi-pair://${peerId}?token=${token}&addrs=${localMultiaddrs.map(encodeURIComponent).join(',')}&exp=${expiresAt}&name=${encodeURIComponent(name)}`

  await publishPairingInvite(magicCode, invitation, publisher)

  return { invitation, qrCode, magicCode }
}

/**
 * Dial the addresses of an invitation under a bounded timeout, so a peer that
 * accepts the connection and never completes the handshake cannot leak the
 * promise out of the invoke handler that is waiting on it.
 */
async function dialWithinTimeout(node: PairingDialer, multiaddrs: string[]): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    await Promise.race([
      node.dial(multiaddrs.map(m => multiaddr(m))),
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error('dialling the other device timed out')), DIAL_TIMEOUT_MS)
      }),
    ])
  }
  finally {
    clearTimeout(timer)
  }
}

/**
 * Accept a pairing invitation from another device.
 *
 * `parsed` is untrusted wire data, taken from the QR string or from an invite a
 * peer published. Expiry is checked against the TTL the source carried; the
 * token itself is validated by the inviter, which is the only node that issued
 * it, when the request arrives on `airi/pairing/requests`.
 *
 * The device is persisted with `trusted: false`. The accepter has neither seen
 * the inviter validate the token nor had any confirmation that the inviter
 * still honours the invite, so recording it as trusted immediately left a
 * permanent trust relationship behind on an expired or revoked invite; the flip
 * to `true` is `handlePairingAccepted`, driven by the inviter's explicit
 * confirmation on `airi/pairing/accepted`, keyed by the token registered through
 * `registerPendingAcceptedConfirmation`.
 */
export async function acceptPairingInvitation(
  parsed: ParsedPairingInvitation,
  localPeerId: string,
  alias: string | undefined,
  node: PairingDialer,
): Promise<AcceptPairingResult> {
  if (parsed.token.length === 0) {
    return { error: 'This pairing invitation carries no token, so it cannot be accepted. A QR payload is required.' }
  }
  if (parsed.multiaddrs.length === 0) {
    return { error: 'This pairing invitation carries no address, so the other device cannot be reached.' }
  }
  if (parsed.expiresAt !== undefined && !Number.isFinite(parsed.expiresAt)) {
    return { error: 'This pairing invitation carries a malformed expiry and cannot be accepted.' }
  }
  if (parsed.expiresAt !== undefined && parsed.expiresAt < Date.now()) {
    return { error: 'This pairing invitation has expired.' }
  }
  if (parsed.peerId === localPeerId) {
    return { error: 'You cannot pair with this device itself.' }
  }

  // Validate before dialling: a malformed address is rejected here rather than
  // thrown from inside the transport, where the failure is opaque.
  for (const addr of parsed.multiaddrs) {
    try {
      multiaddr(addr)
    }
    catch {
      return { error: `"${addr}" is not a valid multiaddr, so the other device cannot be dialled.` }
    }
  }

  try {
    await dialWithinTimeout(node, parsed.multiaddrs)
  }
  catch (err) {
    return { error: `Could not reach the other device: ${err instanceof Error ? err.message : String(err)}` }
  }

  const resolvedAlias = alias?.length ? alias : (parsed.name?.length ? parsed.name : 'AIRI Node')

  await addPairedDevice({
    peerId: parsed.peerId,
    alias: resolvedAlias,
    multiaddrs: parsed.multiaddrs,
    pairedAt: Date.now(),
    lastSeen: Date.now(),
    trusted: false,
  }, false)

  return { peerId: parsed.peerId, alias: resolvedAlias, multiaddrs: parsed.multiaddrs, token: parsed.token }
}

/**
 * Arm the trust confirmation for a pairing this node just started: only an
 * `airi/pairing/accepted` message naming both `devicePeerId` and `token` can
 * flip the record, and only while this entry is live.
 *
 * The accepter calls this with the inviter's PeerId (the device it just
 * recorded) and the token it just spent, immediately after
 * `acceptPairingInvitation`, so a confirmation that races back on the wire is
 * not rejected for having no pending entry.
 */
export function registerPendingAcceptedConfirmation(devicePeerId: string, token: string): void {
  if (devicePeerId.length === 0 || devicePeerId.length > MAX_PEER_ID_LENGTH || !isTokenKeySafe(token)) {
    return
  }
  if (pendingAcceptedConfirmations.size >= MAX_PAIRED_DEVICES) {
    pendingAcceptedConfirmations.clear()
  }
  pendingAcceptedConfirmations.set(token, devicePeerId)
}

/**
 * The accepter's half of the trust confirmation on `airi/pairing/accepted`.
 *
 * A device flips to `trusted: true` only when the message names a token this
 * node actually spent in a pairing flow it performed, and the pending entry for
 * that token resolves to the recorded device. Both conditions rest on state
 * only this node holds, so an attacker who harvests a token from
 * `airi/pairing/requests` cannot cause an arbitrary PeerId to become trusted:
 * there is no message they can compose that names a token this node did not
 * spend.
 *
 * What remains unauthenticated, stated plainly: `airi/pairing/accepted` is an
 * unauthenticated topic, so a bystander can copy a live (token) value and replay
 * it. Replaying it only promotes the device *this* node paired with for that
 * token — an inviter the accepter already dialed, stored and chose to pair with
 * — and the pending entry is deleted once consumed, so a replay after the real
 * confirmation is a no-op. It cannot promote any device this node did not just
 * pair with. When `localPeerId` is supplied the message must also be addressed
 * to this node; without it the token check above is the whole of the binding.
 *
 * Returns the promoted device, or `null` when the message names no token this
 * node spent, or names a device that is no longer recorded.
 */
export async function handlePairingAccepted(payload: unknown, localPeerId?: string): Promise<PairedDevice | null> {
  if (typeof payload !== 'object' || payload === null) {
    return null
  }
  if (!('peerId' in payload) || !('token' in payload)) {
    return null
  }
  const peerId: unknown = payload.peerId
  const token: unknown = payload.token
  if (typeof peerId !== 'string' || typeof token !== 'string') {
    return null
  }
  // The confirmation is only actionable if the inviter is answering this node.
  if (localPeerId !== undefined && peerId !== localPeerId) {
    return null
  }
  if (!isTokenKeySafe(token)) {
    return null
  }

  const devicePeerId = pendingAcceptedConfirmations.get(token)
  if (devicePeerId === undefined) {
    // Not a confirmation for a pairing this node started: an attacker
    // re-publishing someone else's accepted message cannot get past here.
    return null
  }
  pendingAcceptedConfirmations.delete(token)

  const devices = await getPairedDevices()
  const index = devices.findIndex(d => d.peerId === devicePeerId)
  if (index < 0) {
    return null
  }

  const device: PairedDevice = { ...devices[index], trusted: true }
  devices[index] = device
  await writePairedDevices(devices)

  return device
}

/**
 * Record a peer that presented a valid token via `airi/pairing/requests`,
 * consuming the token so the invite cannot be replayed.
 *
 * Returns the recorded device and the consumed token, or `null` when the token
 * was never issued by this node, was already consumed, has expired, names this
 * node itself, or was asserted by a sender other than the peer the message
 * actually arrived from.
 *
 * `publisher` is what completes the pairing on the accepter's side: this node
 * confirms the pair on `airi/pairing/accepted` after recording it, which is what
 * flips the accepter's `trusted: false` record to `trusted: true`. Passing
 * nothing skips that confirmation, which leaves the pairing one-sided.
 */
export async function recordPairingRequest(
  token: string,
  senderPeerId: string,
  senderMultiaddrs: string[],
  alias?: string,
  propagationSource?: string,
  publisher?: PairingPublisher,
): Promise<{ device: PairedDevice, token: string } | null> {
  if (!isTokenKeySafe(token)) {
    return null
  }
  if (senderPeerId.length === 0 || senderPeerId.length > MAX_PEER_ID_LENGTH) {
    return null
  }
  // A request is only honoured from the peer the message actually arrived from:
  // a token harvested from `airi/pairing/requests` and re-published by a third
  // node fails here, because the asserted sender is the original accepter while
  // the propagation source is the bystander.
  if (propagationSource !== undefined && propagationSource !== senderPeerId) {
    return null
  }
  if (senderMultiaddrs.length === 0 || senderMultiaddrs.length > MAX_MULTIADDR_COUNT) {
    return null
  }
  if (senderMultiaddrs.some(addr => addr.length === 0 || addr.length > MAX_MULTIADDR_LENGTH)) {
    return null
  }

  // Claim before anything else so the first caller wins and every later one sees
  // nothing. There is no `await` between the claim and the record below, so no
  // two requests can both observe this token as live.
  const encrypted = claimPairingToken(token)
  if (encrypted === null) {
    return null
  }

  let accepted = false
  let device: PairedDevice | null = null
  try {
    const decrypted = decryptSecret(encrypted)
    if (decrypted === null) {
      return null
    }
    let unvalidated: unknown
    try {
      unvalidated = JSON.parse(decrypted)
    }
    catch {
      // A secret that is not JSON cannot become an invitation.
      return null
    }
    const invitation = parseRecord(PairingInvitationSchema, unvalidated)
    if (invitation === null) {
      return null
    }
    if (invitation.expiresAt < Date.now()) {
      return null
    }
    if (invitation.peerId === senderPeerId) {
      return null
    }

    device = {
      peerId: senderPeerId,
      alias: alias?.length ? alias : invitation.name,
      multiaddrs: senderMultiaddrs,
      pairedAt: Date.now(),
      lastSeen: Date.now(),
      trusted: true,
    }

    await addPairedDevice(device, true)
    accepted = true
    // The accepter recorded this device untrusted, so the pairing is not complete
    // until it hears this. Published after the record so a subscriber cannot act
    // on a confirmation for a pairing that has not landed yet.
    if (publisher !== undefined) {
      await publishPairingAccepted(senderPeerId, token, publisher)
    }
    return { device, token }
  }
  finally {
    if (accepted) {
      consumePairingToken(token)
    }
    else {
      // Nothing was recorded: put the token back so a transport artefact cannot
      // burn an otherwise live invitation.
      releasePairingToken(token)
    }
  }
}

export async function listPairedDevices(): Promise<PairedDevice[]> {
  return getPairedDevices()
}

export async function removePairedDevice(peerId: string): Promise<void> {
  const devices = await getPairedDevices()
  const remaining = devices.filter(device => device.peerId !== peerId)
  if (remaining.length !== devices.length) {
    await writePairedDevices(remaining)
  }
}

export async function updatePairedDeviceAlias(peerId: string, alias: string): Promise<void> {
  if (alias.length === 0 || alias.length > MAX_ALIAS_LENGTH) {
    return
  }
  const devices = await getPairedDevices()
  const device = devices.find(d => d.peerId === peerId)
  if (device !== undefined && device.alias !== alias) {
    device.alias = alias
    await writePairedDevices(devices)
  }
}

export async function updatePairedDeviceLastSeen(peerId: string): Promise<void> {
  const devices = await getPairedDevices()
  const device = devices.find(d => d.peerId === peerId)
  if (device !== undefined) {
    device.lastSeen = Date.now()
    await writePairedDevices(devices)
  }
}

export async function getTrustedPeers(): Promise<string[]> {
  const devices = await getPairedDevices()
  return devices.filter(d => d.trusted).map(d => d.peerId)
}
