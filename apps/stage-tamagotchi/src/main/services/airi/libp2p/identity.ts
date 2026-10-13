import type { MeshIdentityInfo } from '@proj-airi/stage-shared/libp2p'

import type { ConfigDiagnostics } from '../../../libs/electron/persistence'

import { Buffer } from 'node:buffer'
import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'node:crypto'

import { generateKeyPair, privateKeyFromRaw } from '@libp2p/crypto/keys'
import { peerIdFromString } from '@libp2p/peer-id'
import { safeStorage } from 'electron'

import * as v from 'valibot'

import { createConfig } from '../../../libs/electron/persistence'

const IDENTITY_NAMESPACE = 'libp2p-identity'
const IDENTITY_FILENAME = 'libp2p-identity.json'

/**
 * KDF parameters for the password-encrypted export bundle.
 *
 * NOTICE: explicit `maxmem` is required because Node's default `maxmem`
 * (32 MiB) is smaller than the memory scrypt allocates for N=32768, which
 * makes `scryptSync` throw `ERR_CRYPTO_INVALID_SCRYPT_PARAMS` at export time.
 * Reference: https://nodejs.org/api/crypto.html#cryptoscryptsyncpassword-salt-keylen-options
 */
const SCRYPT_PARAMS = { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 } as const

/** Key length in bytes for AES-256-GCM. */
const KEY_LENGTH = 32
/** Salt length in bytes for scrypt. */
const SALT_LENGTH = 16
/** IV length in bytes for AES-256-GCM. */
const IV_LENGTH = 12
/** Auth tag length in bytes for AES-256-GCM. */
const AUTH_TAG_LENGTH = 16

/** Minimum accepted length of an export/import passphrase. */
const MIN_PASSPHRASE_LENGTH = 8

/** Current export bundle format version; bumped whenever the envelope changes. */
const EXPORT_ENVELOPE_VERSION = 2

/** KDF identifier recorded in the bundle envelope. */
const SCRYPT_PARAMS_NAME = 'scrypt'

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

/**
 * Schema of the cleartext export envelope. Parsed before any key derivation, so
 * a bundle from an unsupported format never reaches the KDF: an unknown
 * `version` or mismatched KDF parameters are rejected here.
 */
const IdentityEnvelopeSchema = v.object({
  version: v.literal(EXPORT_ENVELOPE_VERSION),
  kdf: v.object({
    name: v.literal(SCRYPT_PARAMS_NAME),
    N: v.literal(SCRYPT_PARAMS.N),
    r: v.literal(SCRYPT_PARAMS.r),
    p: v.literal(SCRYPT_PARAMS.p),
  }),
  /** Base64 salt/IV/tag sizes this export used, recorded for forward compat. */
  saltLength: v.number(),
  ivLength: v.number(),
  authTagLength: v.number(),
  /** Base64 `salt.iv.authTag.ciphertext` payload. */
  payload: v.string(),
})

/**
 * Schema of the decrypted export bundle. Validated before the bundle is
 * trusted or re-persisted, so a malformed `createdAt`/`peerId`/`name` cannot
 * become trusted identity metadata.
 */
const IdentityBundleSchema = v.object({
  peerId: v.string(),
  publicKey: v.pipe(v.string(), v.base64()),
  /** Base64 of the raw private key. */
  privateKey: v.pipe(v.string(), v.base64()),
  name: v.string(),
  createdAt: v.number(),
})

type IdentityBundle = v.InferOutput<typeof IdentityBundleSchema>

/**
 * Thrown when the OS keychain is unavailable, so an identity cannot be sealed
 * with `safeStorage`. No key material is ever carried by this error.
 */
export class KeychainUnavailableError extends Error {
  constructor(message = 'OS keychain is unavailable, so the libp2p identity cannot be sealed') {
    super(message)
    this.name = 'KeychainUnavailableError'
  }
}

/**
 * Thrown when a stored identity exists but its encrypted private key could not
 * be read (corrupt entry, locked or rotated keychain). Distinguishable from an
 * absent identity, which is reported as `null` by the readers instead.
 */
export class IdentityDecryptError extends Error {
  peerId: string

  // NOTICE: only the PeerId is carried — never the ciphertext or plaintext key
  // — so log plumbing cannot leak the private key.
  constructor(peerId: string, options?: ErrorOptions) {
    super(`Failed to decrypt the stored private key for libp2p identity ${peerId}`, options)
    this.name = 'IdentityDecryptError'
    this.peerId = peerId
  }
}

/** Thrown when an export/import passphrase fails the shared minimum policy. */
export class InvalidPassphraseError extends Error {
  constructor(message = `Passphrase must be at least ${MIN_PASSPHRASE_LENGTH} characters and must not be blank`) {
    super(message)
    this.name = 'InvalidPassphraseError'
  }
}

/**
 * Thrown when an export bundle is structurally unusable: it is rejected before
 * any decryption is attempted, so a bundle carrying an unknown version is never
 * fed to a keychain or KDF.
 */
export class IdentityBundleFormatError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = 'IdentityBundleFormatError'
  }
}

const config = createConfig(IDENTITY_NAMESPACE, IDENTITY_FILENAME, IdentityConfigSchema)

let setupPromise: Promise<ConfigDiagnostics<IdentityConfig>> | undefined

function ensureSetup(): Promise<ConfigDiagnostics<IdentityConfig>> {
  setupPromise ??= Promise.resolve(config.setup())
  return setupPromise
}

function assertKeychainAvailable(context: string): void {
  if (!safeStorage.isEncryptionAvailable()) {
    throw new KeychainUnavailableError(`OS keychain is unavailable (${context}), so the libp2p identity private key cannot be sealed`)
  }
}

function encryptWithKeychain(plaintext: string, context: string): string {
  assertKeychainAvailable(context)
  return safeStorage.encryptString(plaintext).toString('base64')
}

function decryptWithKeychain(encryptedBase64: string, peerId: string, context: string): string {
  assertKeychainAvailable(context)
  try {
    return safeStorage.decryptString(Buffer.from(encryptedBase64, 'base64'))
  }
  catch (cause) {
    throw new IdentityDecryptError(peerId, { cause })
  }
}

/**
 * Apply the shared passphrase policy: never blank, never whitespace-only, never
 * shorter than the minimum length. Applied on both export and import so the two
 * sides cannot diverge.
 */
function assertPassphraseAllowed(password: string): void {
  if (password.length === 0 || password.trim().length === 0 || password.length < MIN_PASSPHRASE_LENGTH) {
    throw new InvalidPassphraseError()
  }
}

/**
 * Generate a new Ed25519 keypair and derive the PeerId.
 * Stores the private key in Electron safeStorage (OS keychain).
 * Persists the public metadata via createConfig.
 */
export async function generateIdentity(name: string = 'AIRI Node'): Promise<MeshIdentityInfo> {
  await ensureSetup()
  const privateKey = await generateKeyPair('Ed25519')

  // NOTICE: `@libp2p/crypto` and `@libp2p/peer-id` both resolve their key types
  // against `@libp2p/interface@2.11.0` + `multiformats@13`, and
  // `peerIdFromPrivateKey` is itself just `peerIdFromPublicKey`, so deriving the
  // PeerId from the public key's base58btc multihash string produces the
  // identical PeerId.
  const privateKeyBytes = privateKey.raw
  const peerId = peerIdFromString(privateKey.publicKey.toString())

  // Encrypt private key with the OS keychain (safeStorage)
  const privateKeyBase64 = Buffer.from(privateKeyBytes).toString('base64')
  const encryptedPrivateKey = encryptWithKeychain(privateKeyBase64, 'generating a libp2p identity')

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
 *
 * Returns `null` when no identity is stored at all. Throws `IdentityDecryptError`
 * when an identity exists but its private key cannot be read.
 */
export async function loadIdentity(): Promise<MeshIdentityInfo | null> {
  await ensureSetup()
  const cfg = config.get()
  if (!cfg)
    return null

  // An entry without an encrypted private key is genuinely absent, not unreadable
  if (!cfg.encryptedPrivateKey)
    return null

  decryptWithKeychain(cfg.encryptedPrivateKey, cfg.peerId, 'loading the libp2p identity')

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
  if (existing)
    return existing
  return generateIdentity(defaultName)
}

// NOTICE: Export bundles are encrypted with a user-supplied password using
// scrypt-derived AES-256-GCM. Format is salt.iv.authTag.ciphertext, all base64.
function encryptWithPassword(plaintext: string, password: string): string {
  assertPassphraseAllowed(password)

  const salt = randomBytes(SALT_LENGTH)
  const iv = randomBytes(IV_LENGTH)
  const key = scryptSync(password, salt, KEY_LENGTH, SCRYPT_PARAMS)
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  const authTag = cipher.getAuthTag()
  return [salt.toString('base64'), iv.toString('base64'), authTag.toString('base64'), ciphertext.toString('base64')].join('.')
}

function decryptWithPassword(payload: string, password: string): string {
  assertPassphraseAllowed(password)

  const parts = payload.split('.')
  if (parts.length !== 4) {
    throw new IdentityBundleFormatError('Malformed encrypted identity export bundle')
  }

  const [saltB64, ivB64, authTagB64, ciphertextB64] = parts
  const key = scryptSync(password, Buffer.from(saltB64, 'base64'), KEY_LENGTH, SCRYPT_PARAMS)
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
  assertPassphraseAllowed(password)

  const cfg = config.get()
  if (!cfg?.encryptedPrivateKey)
    throw new Error('No identity to export')

  const privateKeyBase64 = decryptWithKeychain(cfg.encryptedPrivateKey, cfg.peerId, 'exporting the libp2p identity')

  // The KDF parameters and record sizes travel in a cleartext envelope so an
  // incompatible bundle format is rejected before any key derivation runs.
  const envelope = {
    version: EXPORT_ENVELOPE_VERSION,
    kdf: {
      name: SCRYPT_PARAMS_NAME,
      N: SCRYPT_PARAMS.N,
      r: SCRYPT_PARAMS.r,
      p: SCRYPT_PARAMS.p,
    },
    saltLength: SALT_LENGTH,
    ivLength: IV_LENGTH,
    authTagLength: AUTH_TAG_LENGTH,
    payload: encryptWithPassword(JSON.stringify({
      peerId: cfg.peerId,
      publicKey: cfg.publicKey,
      privateKey: privateKeyBase64,
      name: cfg.name,
      createdAt: cfg.createdAt,
    }), password),
  }

  return JSON.stringify(envelope)
}

/**
 * Import an identity from an export bundle.
 * The bundle should be decrypted by the caller using the user's password.
 */
export async function importIdentity(bundleJson: string, password: string): Promise<MeshIdentityInfo> {
  await ensureSetup()
  assertPassphraseAllowed(password)

  const payload = readExportEnvelope(bundleJson)
  const bundle = parseImportBundle(decryptWithPassword(payload, password))

  // Persist identity with OS-keychain-encrypted private key
  const encryptedPrivateKey = encryptWithKeychain(bundle.privateKey, 'importing a libp2p identity')
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
 * Parse the cleartext export envelope, rejecting a bundle whose recorded
 * parameters this build does not implement. Runs before `decryptWithPassword`,
 * so an incompatible bundle never reaches the KDF.
 */
function readExportEnvelope(bundleJson: string): string {
  let decoded: unknown
  try {
    decoded = JSON.parse(bundleJson)
  }
  catch (cause) {
    throw new IdentityBundleFormatError('Malformed identity export bundle', { cause })
  }

  const parsed = v.safeParse(IdentityEnvelopeSchema, decoded)
  if (!parsed.success) {
    throw new IdentityBundleFormatError(`Unsupported identity export bundle: ${v.summarize(parsed.issues)}`)
  }

  return parsed.output.payload
}

/**
 * Validate a decrypted export bundle against `IdentityBundleSchema`, so a
 * malformed `createdAt`/`peerId`/`name` cannot be persisted as trusted identity
 * metadata.
 */
function parseImportBundle(decrypted: string): IdentityBundle {
  let decoded: unknown
  try {
    decoded = JSON.parse(decrypted)
  }
  catch (cause) {
    throw new IdentityBundleFormatError('Unsupported state or unable to authenticate data', { cause })
  }

  const parsed = v.safeParse(IdentityBundleSchema, decoded)
  if (!parsed.success) {
    throw new IdentityBundleFormatError(`Malformed identity export bundle: ${v.summarize(parsed.issues)}`)
  }

  return parsed.output
}

/**
 * Update the display name of the current identity.
 */
export async function setIdentityName(name: string): Promise<MeshIdentityInfo> {
  await ensureSetup()
  const cfg = config.get()
  if (!cfg?.encryptedPrivateKey)
    throw new Error('No identity to rename')

  decryptWithKeychain(cfg.encryptedPrivateKey, cfg.peerId, 'renaming the libp2p identity')

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
 * Returns the raw Uint8Array private key, or `null` when no identity exists.
 * Only use this in the main process when starting the libp2p node.
 */
export async function getPrivateKey(): Promise<Uint8Array | null> {
  await ensureSetup()
  const cfg = config.get()
  if (!cfg?.encryptedPrivateKey)
    return null

  const privateKeyBase64 = decryptWithKeychain(cfg.encryptedPrivateKey, cfg.peerId, 'reading the libp2p identity private key')
  return Buffer.from(privateKeyBase64, 'base64')
}

/**
 * Check if an identity exists.
 */
export async function hasIdentity(): Promise<boolean> {
  await ensureSetup()
  const cfg = config.get()
  if (!cfg)
    return false

  return Boolean(cfg.encryptedPrivateKey)
}

/**
 * Assert that a raw Ed25519 private key derives the PeerId it is claimed to
 * belong to.
 *
 * NOTICE: the PeerId is derived from the key with the era-2 construction
 * (`@libp2p/crypto/keys#privateKeyFromRaw` then `publicKey.toString()`), matching
 * `generateIdentity`'s workaround for `@libp2p/interface@2.11.0` +
 * `multiformats@13` type skew, rather than by comparing raw bytes.
 */
export async function assertIdentityMatchesKey(privateKey: Uint8Array, expectedPeerId: string): Promise<void> {
  let derived: string
  try {
    const key = privateKeyFromRaw(privateKey)
    derived = peerIdFromString(key.publicKey.toString()).toString()
  }
  catch (cause) {
    throw new IdentityBundleFormatError('Failed to derive a PeerId from the supplied private key', { cause })
  }

  if (derived !== expectedPeerId) {
    throw new IdentityBundleFormatError(`Private key does not match the expected PeerId ${expectedPeerId}`)
  }
}
