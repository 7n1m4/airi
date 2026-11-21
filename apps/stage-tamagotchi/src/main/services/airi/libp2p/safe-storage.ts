/**
 * Electrobun port: explicit platform boundary for OS-keychain-backed secrets.
 *
 * Electron's `safeStorage` has no Electrobun equivalent (design doc §1.2 / §3.1).
 * `isEncryptionAvailable()` deliberately stays false — Electron itself reports
 * false when no keychain backend exists — so callers refuse to persist rather than
 * write a plaintext private key. The transform calls raise through `notImplemented()`
 * so any ported-away call site fails loudly instead of silently doing nothing.
 */

import type { Buffer } from 'node:buffer'

import { notImplemented } from '../../../rpc'

export interface SafeStorageLike {
  isEncryptionAvailable: () => boolean
  encryptString: (plainText: string) => Buffer
  decryptString: (encrypted: Buffer) => string
}

export const safeStorage: SafeStorageLike = {
  isEncryptionAvailable: () => false,
  encryptString: (_plainText: string): Buffer => notImplemented('safeStorage.encryptString'),
  decryptString: (_encrypted: Buffer): string => notImplemented('safeStorage.decryptString'),
}
