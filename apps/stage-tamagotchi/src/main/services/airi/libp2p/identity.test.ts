import { Buffer } from 'node:buffer'

import { describe, expect, it, vi } from 'vitest'

/**
 * The libp2p identity lives in the OS keychain through Electron's `safeStorage`
 * and is persisted through the `createConfig` store in
 * `apps/stage-tamagotchi/src/main/libs/electron/persistence.ts`.
 *
 * Both are platform boundaries, so they are mocked here. Everything asserted
 * below is behaviour of `identity.ts` itself: what it refuses to persist, how it
 * distinguishes an absent identity from an unreadable one, and what the
 * export/import envelope accepts before any key derivation runs.
 *
 * `app.getPath` is stubbed because `createConfig` builds its file path from it;
 * the store mock below replaces `createConfig` entirely, so the path is never
 * touched.
 */

/** Shape of the record `identity.ts` persists, mirroring `IdentityConfigSchema`. */
interface StoredIdentity {
  peerId: string
  publicKey: string
  name: string
  createdAt: number
  encryptedPrivateKey: string
}

/** An envelope with one field removed, as a genuinely malformed bundle would be. */
function withoutField(record: Record<string, unknown>, field: string): Record<string, unknown> {
  const { [field]: _removed, ...rest } = record
  return rest
}

interface Harness {
  cfg: StoredIdentity | undefined
  storage: {
    available: boolean
    failDecrypt: boolean
    encryptCalls: string[]
    decryptCalls: Buffer[]
  }
}

const h: Harness = vi.hoisted(() => ({
  cfg: undefined,
  storage: {
    available: true,
    failDecrypt: false,
    encryptCalls: [],
    decryptCalls: [],
  },
}))

vi.mock('electron', () => ({
  app: { getPath: () => '/tmp/airi-libp2p-identity-test' },
  safeStorage: {
    isEncryptionAvailable: () => h.storage.available,
    // A reversible stand-in so a stored identity can be read back: the module
    // under test only ever round-trips its own ciphertext, so the transform's
    // secrecy is irrelevant and its reversibility is what the assertions need.
    encryptString: (value: string): Buffer => {
      h.storage.encryptCalls.push(value)
      return Buffer.from(`enc:${value}`)
    },
    decryptString: (buf: Buffer): string => {
      h.storage.decryptCalls.push(buf)
      if (h.storage.failDecrypt)
        throw new Error('keychain locked')
      return buf.toString('utf8').replace(/^enc:/, '')
    },
  },
}))

vi.mock('../../../libs/electron/persistence', () => ({
  createConfig: () => ({
    setup: () => ({ status: 'ok', path: '/tmp/airi-libp2p-identity-test' }),
    get: (): StoredIdentity | undefined => h.cfg,
    update: (value: StoredIdentity) => { h.cfg = value },
    flush: () => {},
    getDiagnostics: () => undefined,
  }),
}))

/**
 * The record the store last wrote. A reader rather than a second binding on the
 * harness, because `vi.hoisted`'s type narrows on assignment and `h.cfg` is
 * typed `StoredIdentity | undefined` while `never` is what a post-clear read
 * would otherwise infer.
 */
function lastStoredIdentity(): StoredIdentity | undefined {
  return h.cfg
}

/** Fresh module instance with a clean store, so per-test state cannot leak. */
async function freshIdentity() {
  vi.resetModules()
  h.cfg = undefined
  h.storage.available = true
  h.storage.failDecrypt = false
  h.storage.encryptCalls = []
  h.storage.decryptCalls = []
  return import('./identity')
}

const PASSPHRASE = 'correct horse battery staple'

describe('libp2p identity — keychain refusal', () => {
  it('refuses to persist a private key when safeStorage encryption is unavailable', async () => {
    const identity = await freshIdentity()
    h.storage.available = false

    // ROOT CAUSE:
    //
    // `generateIdentity` base64'd the raw Ed25519 private key straight into
    // `libp2p-identity.json` whenever `safeStorage.isEncryptionAvailable()` was
    // false, because the encryption step had no guard of its own. On a machine
    // with no keychain service that wrote a plaintext private key to disk, where
    // it outlives the process and is readable by anything that can read the file.
    //
    // FIXED BY: `assertKeychainAvailable` throwing `KeychainUnavailableError`
    // before `encryptString` is reached, so no identity is created at all.
    await expect(identity.generateIdentity('No Keychain')).rejects.toMatchObject({
      name: 'KeychainUnavailableError',
    })

    // Nothing was written: a half-recorded identity is what made the old build
    // look like it had an identity while being unreadable.
    expect(h.cfg).toBeUndefined()
    expect(h.storage.encryptCalls).toHaveLength(0)
  })

  it('does not silently mint a replacement identity when a stored key cannot be decrypted', async () => {
    const identity = await freshIdentity()
    const original = await identity.generateIdentity('Original')
    expect(h.cfg).toMatchObject({ peerId: original.peerId })

    // A locked or rotated keychain is not the same as no identity: minting a new
    // keypair here would invalidate every paired device, because the PeerId the
    // other side recorded stops matching.
    h.storage.failDecrypt = true
    await expect(identity.loadIdentity()).rejects.toMatchObject({
      name: 'IdentityDecryptError',
      peerId: original.peerId,
    })

    // `getOrCreateIdentity` is what a boot path calls, and it must propagate the
    // failure rather than fall through to `generateIdentity`.
    await expect(identity.getOrCreateIdentity()).rejects.toMatchObject({ name: 'IdentityDecryptError' })

    // A failed read is not a clean slate: the stored record is untouched.
    expect(h.cfg?.peerId).toBe(original.peerId)
  })

  it('reports an absent identity as null rather than as a decrypt failure', async () => {
    const identity = await freshIdentity()

    expect(await identity.loadIdentity()).toBeNull()
    expect(await identity.hasIdentity()).toBe(false)
    expect(await identity.getPrivateKey()).toBeNull()

    // A record with no encrypted private key is genuinely absent too: it carries
    // no secret that could fail to decrypt.
    h.cfg = {
      peerId: '12D3KooWArVY9ACkibPyvWrQFJxhyRHrkonGkcnfs981mLJS5eEp',
      publicKey: 'AAAA',
      name: 'Half',
      createdAt: 1,
      encryptedPrivateKey: '',
    }
    expect(await identity.loadIdentity()).toBeNull()
    expect(await identity.hasIdentity()).toBe(false)
  })

  it('names the operation that found the keychain unavailable', async () => {
    const identity = await freshIdentity()
    await identity.generateIdentity('Named')
    h.storage.available = false

    await expect(identity.loadIdentity()).rejects.toThrow(/loading the libp2p identity/)
    await expect(identity.getPrivateKey()).rejects.toThrow(/reading the libp2p identity private key/)
    await expect(identity.exportIdentity(PASSPHRASE)).rejects.toThrow(/exporting the libp2p identity/)
  })

  it('never lets the private key cross into the error or the returned identity', async () => {
    const identity = await freshIdentity()
    const info = await identity.generateIdentity('No Leak')

    // ROOT CAUSE:
    //
    // `IdentityDecryptError` used to carry the whole stored config object, so
    // the ciphertext rode along into any log line that printed the error — and
    // the constructor's own message interpolated it. The private key is
    // sealable, not loggable.
    //
    // FIXED BY: the constructor carries only the PeerId.
    h.storage.failDecrypt = true
    let caught: Error | undefined
    try {
      await identity.loadIdentity()
    }
    catch (err) {
      caught = err as Error
    }
    expect(caught).toBeInstanceOf(identity.IdentityDecryptError)
    expect(caught).toMatchObject({ name: 'IdentityDecryptError', peerId: info.peerId })
    expect(JSON.stringify(caught)).not.toContain(h.cfg?.encryptedPrivateKey)

    // And the public info type has no field the secret could ride in.
    expect(Object.keys(info).sort()).toEqual(['createdAt', 'name', 'peerId', 'publicKey'])
  })
})

describe('libp2p identity — export/import envelope', () => {
  it('round-trips an exported bundle under its passphrase', async () => {
    const identity = await freshIdentity()
    const original = await identity.generateIdentity('Round Trip')

    const bundle = await identity.exportIdentity(PASSPHRASE)
    const envelope = JSON.parse(bundle) as Record<string, unknown>

    // ROOT CAUSE:
    //
    // The bundle used to be the bare `salt.iv.authTag.ciphertext` string with no
    // header, so a bundle from another build was indistinguishable from a
    // corrupted one and was fed to scrypt anyway. A wrong-format bundle surfaced
    // as "Unsupported state or unable to authenticate data" — an AES-GCM message
    // that says nothing about the actual problem.
    //
    // FIXED BY: a cleartext envelope carrying the version and the exact KDF
    // parameters, parsed before `decryptWithPassword` ever runs.
    expect(envelope).toMatchObject({
      version: 2,
      kdf: { name: 'scrypt', N: 32768, r: 8, p: 1 },
      saltLength: 16,
      ivLength: 12,
      authTagLength: 16,
    })
    expect(String(envelope.payload).split('.')).toHaveLength(4)

    // The payload is real AES-256-GCM under a scrypt-derived key, so the
    // plaintext identity is not recoverable from the bundle without it.
    expect(bundle).not.toContain(original.peerId)

    h.cfg = undefined
    const restored = await identity.importIdentity(bundle, PASSPHRASE)
    expect(restored).toEqual(original)
  })

  it('rejects an incompatible envelope before any key derivation runs', async () => {
    const identity = await freshIdentity()
    await identity.generateIdentity('Envelope')
    const good = JSON.parse(await identity.exportIdentity(PASSPHRASE)) as Record<string, unknown>

    const cases: Array<[string, unknown]> = [
      ['an unknown format version', { ...good, version: 99 }],
      ['a different KDF', { ...good, kdf: { name: 'argon2id', N: 32768, r: 8, p: 1 } }],
      ['a different scrypt cost', { ...good, kdf: { name: 'scrypt', N: 1024, r: 8, p: 1 } }],
      ['a different parallelism', { ...good, kdf: { name: 'scrypt', N: 32768, r: 8, p: 2 } }],
      ['a missing envelope field', withoutField(good, 'payload')],
      ['a non-JSON bundle', 'not-json-at-all'],
      ['a JSON array', [1, 2, 3]],
    ]

    for (const [label, candidate] of cases) {
      const before = h.cfg
      // ROOT CAUSE:
      //
      // `readExportEnvelope` parses the cleartext envelope against
      // `IdentityEnvelopeSchema` and hands `decryptWithPassword` only the
      // payload it returns. A mismatched envelope therefore never reaches
      // `scryptSync`, so the failure names the format instead of a KDF or
      // nonce error, and the record on disk is left exactly as it was.
      await expect(
        identity.importIdentity(JSON.stringify(candidate), PASSPHRASE),
        label,
      ).rejects.toMatchObject({ name: 'IdentityBundleFormatError' })

      // A rejected import must not overwrite the existing identity.
      expect(h.cfg, label).toBe(before)
    }

    expect(await identity.hasIdentity()).toBe(true)
  })

  it('applies the minimum passphrase policy on both export and import', async () => {
    const identity = await freshIdentity()
    await identity.generateIdentity('Policy')

    for (const passphrase of ['', '        ', 'short', 'seven77']) {
      // ROOT CAUSE:
      //
      // `assertPassphraseAllowed` ran only inside `encryptWithPassword`, so it
      // was enforced on export but never on import: an import with a
      // one-character passphrase ran scrypt, derived a key, and failed inside
      // AES-GCM instead of being refused up front.
      //
      // FIXED BY: both entry points call the same shared check.
      await expect(identity.exportIdentity(passphrase), JSON.stringify(passphrase))
        .rejects
        .toMatchObject({ name: 'InvalidPassphraseError' })
      await expect(identity.importIdentity('{}', passphrase), JSON.stringify(passphrase))
        .rejects
        .toMatchObject({ name: 'InvalidPassphraseError' })
    }

    const bundle = await identity.exportIdentity(PASSPHRASE)
    await expect(identity.importIdentity(bundle, '        '))
      .rejects
      .toMatchObject({ name: 'InvalidPassphraseError' })
  })

  it('rejects a wrong-passphrase import without touching the stored identity', async () => {
    const identity = await freshIdentity()
    const original = await identity.generateIdentity('Wrong Pass')

    const bundle = await identity.exportIdentity(PASSPHRASE)
    // A wrong passphrase is not a format error: the envelope is well-formed, and
    // the failure comes from AES-GCM's authentication tag rather than from the
    // schema. What matters is that it is refused rather than imported.
    await expect(identity.importIdentity(bundle, 'another passphrase entirely')).rejects.toThrow()

    // Note the asymmetry is deliberate and honest: an *incompatible envelope*
    // (previous test) is rejected before key derivation, whereas a wrong
    // passphrase can only be discovered by running the KDF and the GCM tag.
    expect(h.cfg?.peerId).toBe(original.peerId)
    expect(await identity.loadIdentity()).toEqual(original)
  })

  it('re-encrypts an imported private key under the local keychain', async () => {
    const identity = await freshIdentity()
    const original = await identity.generateIdentity('Source')

    const bundle = await identity.exportIdentity(PASSPHRASE)
    const sourceKey = await identity.getPrivateKey()

    // Simulate migrating to a second profile by clearing only the config store.
    h.cfg = undefined
    const restored = await identity.importIdentity(bundle, PASSPHRASE)

    // ROOT CAUSE:
    //
    // `importIdentity` used to write the decrypted plaintext private key
    // straight into the config object, so migrating between machines put the
    // key on disk in the clear — exactly what `safeStorage` exists to prevent.
    //
    // FIXED BY: the bundle's private key goes through `encryptWithKeychain`
    // before the record is persisted. The observable proof is that
    // `getPrivateKey` still resolves through the keychain and returns the very
    // same key the source identity had.
    // The stored ciphertext cannot be the raw key: it must have gone through the
    // keychain, whose mock prefixes `enc:`.
    const persisted = lastStoredIdentity()
    expect(persisted?.encryptedPrivateKey).toBeDefined()
    expect(persisted?.encryptedPrivateKey).not.toBe(Buffer.from(sourceKey ?? new Uint8Array()).toString('base64'))
    expect(await identity.getPrivateKey()).toEqual(sourceKey)
    expect(restored.peerId).toBe(original.peerId)
  })

  it('derives the PeerId from an imported key with the era-2 construction', async () => {
    const identity = await freshIdentity()
    const original = await identity.generateIdentity('Assert Match')
    const bundle = await identity.exportIdentity(PASSPHRASE)
    const key = await identity.getPrivateKey()

    // ROOT CAUSE:
    //
    // The check used to compare raw key bytes between two `@libp2p/crypto`
    // builds that resolve their key types against different
    // `@libp2p/interface`/`multiformats` eras, so a structurally identical key
    // failed the comparison and a legitimate import was rejected.
    //
    // FIXED BY: deriving through `privateKeyFromRaw` then
    // `peerIdFromPublicKey.toString()`, matching `generateIdentity`'s own route.
    await expect(identity.assertIdentityMatchesKey(key!, original.peerId)).resolves.toBeUndefined()
    await expect(identity.assertIdentityMatchesKey(key!, '12D3KooWArVY9ACkibPyvWrQFJxhyRHrkonGkcnfs981mLJS5eEp'))
      .rejects
      .toMatchObject({ name: 'IdentityBundleFormatError' })

    // And a garbage key is reported as a derivation failure, not a crash.
    await expect(identity.assertIdentityMatchesKey(new Uint8Array([1, 2, 3]), original.peerId))
      .rejects
      .toMatchObject({ name: 'IdentityBundleFormatError' })

    // The imported record still resolves to the same PeerId after a round trip.
    h.cfg = undefined
    await identity.importIdentity(bundle, PASSPHRASE)
    expect((await identity.getPrivateKey())).toEqual(key)
  })
})
