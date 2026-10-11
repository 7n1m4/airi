import { safeStorage } from 'electron'
import { createConfig } from '../../../libs/electron/persistence'
import { randomBytes } from 'node:crypto'
import { array, boolean, type InferOutput, number, object, string } from 'valibot'

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

interface PairingInvitation {
  peerId: string
  multiaddrs: string[]
  token: string
  name: string
  expiresAt: number
}

interface MagicWormholeCode {
  code: string
  peerId: string
  token: string
  expiresAt: number
}

function generatePairingToken(): string {
  return randomBytes(16).toString('base64url')
}

function generateMagicCode(): string {
  const words = [
    'alpha', 'bravo', 'charlie', 'delta', 'echo', 'foxtrot', 'golf', 'hotel',
    'india', 'juliet', 'kilo', 'lima', 'mike', 'november', 'oscar', 'papa',
    'quebec', 'romeo', 'sierra', 'tango', 'uniform', 'victor', 'whiskey',
    'xray', 'yankee', 'zulu', 'atlas', 'beacon', 'cipher', 'drift', 'echo',
  ]
  const w1 = words[Math.floor(Math.random() * words.length)]
  const w2 = words[Math.floor(Math.random() * words.length)]
  const w3 = words[Math.floor(Math.random() * words.length)]
  const num = Math.floor(Math.random() * 1000).toString().padStart(3, '0')
  return `${w1}-${w2}-${w3}-${num}`
}
// NOTICE: Electron's SafeStorage exposes only encryptString/decryptString and has
// no key/value API, so pairing secrets live in this encrypted in-memory map for the
// duration of the invitation TTL instead of a fake key/value store.
const PAIRING_SECRETS = new Map<string, string>()

async function putPairingSecret(key: string, value: string): Promise<void> {
  PAIRING_SECRETS.set(key, safeStorage.encryptString(value).toString('base64'))
}

async function getPairingSecret(key: string): Promise<string | null> {
  const encrypted = PAIRING_SECRETS.get(key)
  if (encrypted === undefined) return null
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
    if (decrypted === null) return null
    return JSON.parse(decrypted)
  } catch {
    return null
  }
}

async function deletePairingToken(token: string): Promise<void> {
  try {
    await deletePairingSecret(`${PAIRING_TOKEN_KEY}:${token}`)
  } catch {
    // Ignore
  }
}

/**
 * Create a pairing invitation for this device.
 * Returns an object with the invitation data and a QR code string.
 */
export async function createPairingInvitation(
  multiaddrs: string[],
  peerId: string,
  name: string,
  ttlMinutes: number = 30
): Promise<{ invitation: PairingInvitation; qrCode: string; magicCode: string }> {
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
  const addrsParam = multiaddrs.map(encodeURIComponent).join(',')
  const qrCode = `airi-pair://${peerId}?token=${token}&addrs=${addrsParam}`

  return { invitation, qrCode, magicCode }
}

/**
 * Accept a pairing invitation from another device.
 * Validates the token, adds the peer to paired devices.
 */
export async function acceptPairingInvitation(
  token: string,
  localPeerId: string,
  alias?: string
): Promise<{ peerId: string; multiaddrs: string[]; alias: string } | null> {
  const invitation = await getPairingToken(token)
  if (!invitation) return null
  if (invitation.expiresAt < Date.now()) {
    await deletePairingToken(token)
    return null
  }
  if (invitation.peerId === localPeerId) {
    // Can't pair with self
    return null
  }

  // Add to paired devices
  await addPairedDevice({
    peerId: invitation.peerId,
    alias: alias || invitation.name,
    multiaddrs: invitation.multiaddrs,
    pairedAt: Date.now(),
    lastSeen: Date.now(),
    trusted: true,
  })

  await deletePairingToken(token)

  return {
    peerId: invitation.peerId,
    multiaddrs: invitation.multiaddrs,
    alias: alias || invitation.name,
  }
}

/**
 * Accept a pairing via magic wormhole code.
 */
export async function acceptMagicCode(
  code: string,
  localPeerId: string,
  alias?: string
): Promise<{ peerId: string; multiaddrs: string[]; alias: string } | null> {
  try {
    const decrypted = await getPairingSecret(`${PAIRING_TOKEN_KEY}:magic:${code}`)
    if (decrypted === null) return null
    const magicData: MagicWormholeCode = JSON.parse(decrypted)

    if (magicData.expiresAt < Date.now()) {
      await deletePairingSecret(`${PAIRING_TOKEN_KEY}:magic:${code}`)
      return null
    }
    if (magicData.peerId === localPeerId) return null

    // Use the token to get the full invitation
    const invitation = await getPairingToken(magicData.token)
    if (!invitation) return null

    await addPairedDevice({
      peerId: invitation.peerId,
      alias: alias || invitation.name,
      multiaddrs: invitation.multiaddrs,
      pairedAt: Date.now(),
      lastSeen: Date.now(),
      trusted: true,
    })

    await deletePairingToken(magicData.token)
    await deletePairingSecret(`${PAIRING_TOKEN_KEY}:magic:${code}`)

    return {
      peerId: invitation.peerId,
      multiaddrs: invitation.multiaddrs,
      alias: alias || invitation.name,
    }
  } catch {
    return null
  }
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
  } else {
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