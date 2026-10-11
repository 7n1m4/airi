import { generateKeyPair } from '@libp2p/crypto/keys'
import { peerIdFromString } from '@libp2p/peer-id'
import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'node:crypto'
import { safeStorage } from 'electron'
import { createConfig, type ConfigDiagnostics } from '../../../libs/electron/persistence'
import * as v from 'valibot'
import type { MeshIdentityInfo } from '@proj-airi/stage-shared/libp2p'

const IDENTITY_NAMESPACE = 'libp2p-identity'
const IDENTITY_FILENAME = 'libp2p-identity.json'

/**
 * Schema for the persisted identity config.
 * The private key is stored OS-keychain-encrypted (via safeStorage.encryptString)
 * as base64 in this JSON file; the raw private key is never persisted.
 */
const IdentityConfigSchema = v.object({
  peerId: v.string(),
  publicKey: v.string(), // base64
  name: v.string(),
  createdAt: v.number(),
  encryptedPrivateKey: v.string(), // base64 of safeStorage-encrypted private key
})

type IdentityConfig = v.InferOutput<typeof IdentityConfigSchema>

const config = createConfig(IDENTITY_NAMESPACE, IDENTITY_FILENAME, IdentityConfigSchema)

let setupPromise: Promise<ConfigDiagnostics<IdentityConfig>> | undefined

function ensureSetup(): Promise<ConfigDiagnostics<IdentityConfig>> {
  setupPromise ??= Promise.resolve(config.setup())
  return setupPromise
}

/**
 * Generate a new Ed25519 keypair and derive the PeerId.
 * Stores the private key in Electron safeStorage (OS keychain).
 * Persists the public metadata via createConfig.
 */
export async function generateIdentity(name: string = 'AIRI Node'): Promise<MeshIdentityInfo> {
  await ensureSetup()
  const privateKey = await generateKeyPair('Ed25519')

  // NOTICE: `@libp2p/crypto@5.1.23` resolves its key types against
  // `@libp2p/interface@3.3.0` + `multiformats@14` while
  // `@libp2p/peer-id@5.1.9` resolves against `@libp2p/interface@2.11.0` +
  // `multiformats@13`. The key interfaces are structurally identical but
  // nominally distinct (`MultihashDigest` / `CID` are imported from different
  // multiformats majors), so a key object produced here cannot be passed to
  // `peerIdFromPrivateKey` without failing overload resolution. Deriving the
  // PeerId from the public key's base58btc multihash string instead keeps the
  // seam version-agnostic while producing the identical PeerId, as
  // `peerIdFromPrivateKey` is itself just `peerIdFromPublicKey`.
  const privateKeyBytes = privateKey.raw
  const peerId = peerIdFromString(privateKey.publicKey.toString())

  // Encrypt private key with the OS keychain (safeStorage)
  const privateKeyBase64 = Buffer.from(privateKeyBytes).toString('base64')
  const encryptedPrivateKey = safeStorage.encryptString(privateKeyBase64).toString('base64')

  // Persist identity (private key only in OS-keychain-encrypted form)
  const createdAt = Date.now()
  const identity: IdentityConfig = {
    peerId: peerId.toString(),
    publicKey: Buffer.from(privateKey.publicKey.raw).toString('base64'),
    name,
    createdAt,
    encryptedPrivateKey,
  }
  config.update(identity)

  return {
    peerId: identity.peerId,
    publicKey: identity.publicKey,
    name: identity.name,
    createdAt: identity.createdAt,
  }
}

/**
 * Load the existing identity from config and safeStorage.
 * Returns null if no identity exists.
 */
export async function loadIdentity(): Promise<MeshIdentityInfo | null> {
  await ensureSetup()
  const cfg = config.get()
  if (!cfg) return null

  // Private key missing - identity is corrupted
  if (!cfg.encryptedPrivateKey) return null

  return {
    peerId: cfg.peerId,
    publicKey: cfg.publicKey,
    name: cfg.name,
    createdAt: cfg.createdAt,
  }
}

/**
 * Get the current identity, generating one if it doesn't exist.
 */
export async function getOrCreateIdentity(defaultName: string = 'AIRI Node'): Promise<MeshIdentityInfo> {
  await ensureSetup()
  const existing = await loadIdentity()
  if (existing) return existing
  return generateIdentity(defaultName)
}
// NOTICE: Export bundles are encrypted with a user-supplied password using
// scrypt-derived AES-256-GCM. Format is salt.iv.authTag.ciphertext, all base64.
function encryptWithPassword(plaintext: string, password: string): string {
  const salt = randomBytes(16)
  const iv = randomBytes(12)
  const key = scryptSync(password, salt, 32)
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  const authTag = cipher.getAuthTag()
  return [salt.toString('base64'), iv.toString('base64'), authTag.toString('base64'), ciphertext.toString('base64')].join('.')
}

function decryptWithPassword(payload: string, password: string): string {
  const parts = payload.split('.')
  if (parts.length !== 4) {
    throw new Error('Malformed encrypted identity export bundle')
  }

  const [saltB64, ivB64, authTagB64, ciphertextB64] = parts
  const key = scryptSync(password, Buffer.from(saltB64, 'base64'), 32)
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(ivB64, 'base64'))
  decipher.setAuthTag(Buffer.from(authTagB64, 'base64'))
  const plaintext = Buffer.concat([decipher.update(Buffer.from(ciphertextB64, 'base64')), decipher.final()])
  return plaintext.toString('utf8')
}

/**
 * Export the identity for device migration.
 * Returns a passphrase string containing the private key + metadata,
 * encrypted with the user-supplied password (AES-256-GCM via scrypt).
 */
export async function exportIdentity(password: string): Promise<string> {
  await ensureSetup()
  const cfg = config.get()
  if (!cfg) throw new Error('No identity to export')

  const privateKeyBase64 = safeStorage.decryptString(Buffer.from(cfg.encryptedPrivateKey, 'base64'))

  // Create export bundle
  const bundle = {
    peerId: cfg.peerId,
    publicKey: cfg.publicKey,
    privateKey: privateKeyBase64,
    name: cfg.name,
    createdAt: cfg.createdAt,
    version: 1,
  }

  // Encrypt with user password (AES-256-GCM via scrypt)
  return encryptWithPassword(JSON.stringify(bundle), password)
}

/**
 * Import an identity from an export bundle.
 * The bundle should be decrypted by the caller using the user's password.
 */
export async function importIdentity(bundleJson: string, password: string): Promise<MeshIdentityInfo> {
  await ensureSetup()
  const bundle = JSON.parse(decryptWithPassword(bundleJson, password)) as {
    peerId: string
    publicKey: string
    privateKey: string
    name: string
    createdAt: number
    version: number
  }

  if (bundle.version !== 1) {
    throw new Error(`Unsupported identity export version: ${bundle.version}`)
  }

  // Persist identity with OS-keychain-encrypted private key
  const encryptedPrivateKey = safeStorage.encryptString(bundle.privateKey).toString('base64')
  const identity: IdentityConfig = {
    peerId: bundle.peerId,
    publicKey: bundle.publicKey,
    name: bundle.name,
    createdAt: bundle.createdAt,
    encryptedPrivateKey,
  }
  config.update(identity)

  return {
    peerId: identity.peerId,
    publicKey: identity.publicKey,
    name: identity.name,
    createdAt: identity.createdAt,
  }
}

/**
 * Update the display name of the current identity.
 */
export async function setIdentityName(name: string): Promise<MeshIdentityInfo> {
  await ensureSetup()
  const cfg = config.get()
  if (!cfg) throw new Error('No identity to rename')

  const updated: IdentityConfig = { ...cfg, name }
  config.update(updated)

  return {
    peerId: updated.peerId,
    publicKey: updated.publicKey,
    name: updated.name,
    createdAt: updated.createdAt,
  }
}

/**
 * Regenerate the identity (destroys the old keypair).
 * Caller should confirm with user before calling.
 */
export async function regenerateIdentity(name: string = 'AIRI Node'): Promise<MeshIdentityInfo> {
  await ensureSetup()
  // generateIdentity overwrites the config, dropping the old keypair
  return generateIdentity(name)
}

/**
 * Get the private key for libp2p node initialization.
 * Returns the raw Uint8Array private key.
 * Only use this in the main process when starting the libp2p node.
 */
export async function getPrivateKey(): Promise<Uint8Array | null> {
  await ensureSetup()
  try {
    const cfg = config.get()
    if (!cfg?.encryptedPrivateKey) return null
    const privateKeyBase64 = safeStorage.decryptString(Buffer.from(cfg.encryptedPrivateKey, 'base64'))
    return Buffer.from(privateKeyBase64, 'base64')
  }
  catch {
    return null
  }
}

/**
 * Check if an identity exists.
 */
export async function hasIdentity(): Promise<boolean> {
  await ensureSetup()
  const cfg = config.get()
  if (!cfg) return false

  return Boolean(cfg.encryptedPrivateKey)
}