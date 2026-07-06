// lib/pii-crypto.ts — at-rest encryption for POPIA §26 special personal info.
// Audit finding SEC-01 / backlog P0-7: ProviderApplication.idNumber (SA
// government ID) was stored plaintext past GA.
//
// Mirrors the AES-256-GCM construction in lib/identity-verification/crypto.ts
// but is keyed from a DEDICATED env var (PII_ENC_KEY) so the two secrets can
// be provisioned and rotated independently.
//
// Ciphertext format (versioned for future key rotation):
//   v1:<iv base64>:<authTag base64>:<ciphertext base64>
//
// Degrade-safe by design: when PII_ENC_KEY is absent or malformed, the write
// path keeps persisting plaintext exactly as before (a single warning is
// logged per process), so deploy order can never corrupt or lose data.
// Rollout sequence: docs/security/id-number-encryption.md.
//
// NEVER log plaintext ID numbers or ciphertext contents from this module.

import { createCipheriv, createDecipheriv, randomBytes } from 'crypto'

import { idNumberLast4 } from './pii-id-number'

const ENCRYPTION_VERSION = 'v1'

/** Name of the env var carrying the dedicated PII encryption key (32-byte base64 or utf8). */
export const PII_ENC_KEY_ENV = 'PII_ENC_KEY'

// ─── Key handling ─────────────────────────────────────────────────────────────

function readEncryptionKey(): Buffer {
  const raw = process.env[PII_ENC_KEY_ENV]
  if (!raw) {
    throw new Error(`${PII_ENC_KEY_ENV} must be a 32-byte base64 or utf8 value`)
  }

  const base64Key = Buffer.from(raw, 'base64')
  if (base64Key.length === 32) {
    return base64Key
  }

  const utf8Key = Buffer.from(raw, 'utf8')
  if (utf8Key.length === 32) {
    return utf8Key
  }

  throw new Error(`${PII_ENC_KEY_ENV} must be a 32-byte base64 or utf8 value`)
}

/** True when a valid 32-byte PII_ENC_KEY is present in the environment. */
export function isPiiEncryptionConfigured(): boolean {
  try {
    readEncryptionKey()
    return true
  } catch {
    return false
  }
}

// ─── Encrypt / decrypt (strict: throw when the key is missing) ───────────────

/** Encrypt a plaintext ID number. Throws when PII_ENC_KEY is missing/invalid. */
export function encryptIdNumber(plain: string): string {
  const key = readEncryptionKey()
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  const ciphertext = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()])
  const authTag = cipher.getAuthTag()

  return [
    ENCRYPTION_VERSION,
    iv.toString('base64'),
    authTag.toString('base64'),
    ciphertext.toString('base64'),
  ].join(':')
}

/**
 * Decrypt a `v1:` ciphertext produced by encryptIdNumber. Throws on missing
 * key, unknown version, malformed payload, or GCM auth-tag failure (tamper).
 */
export function decryptIdNumber(ciphertext: string): string {
  const [version, ivBase64, authTagBase64, encryptedBase64] = ciphertext.split(':')
  if (version !== ENCRYPTION_VERSION || !ivBase64 || !authTagBase64 || !encryptedBase64) {
    throw new Error('Invalid encrypted idNumber format')
  }

  const authTag = Buffer.from(authTagBase64, 'base64')
  if (authTag.length !== 16) {
    throw new Error('Invalid encrypted idNumber format')
  }

  const decipher = createDecipheriv(
    'aes-256-gcm',
    readEncryptionKey(),
    Buffer.from(ivBase64, 'base64'),
    { authTagLength: 16 },
  )
  decipher.setAuthTag(authTag)

  return Buffer.concat([
    decipher.update(Buffer.from(encryptedBase64, 'base64')),
    decipher.final(),
  ]).toString('utf8')
}

// ─── Degrade-safe write helper (dual-write bridge) ────────────────────────────

let warnedKeyUnavailable = false

/** Test hook: reset the warn-once latch. */
export function __resetPiiCryptoWarningForTests(): void {
  warnedKeyUnavailable = false
}

export interface EncryptedIdNumber {
  ciphertext: string
  last4: string
}

/**
 * Encrypt an ID number for the dual-write path. Returns null (and logs a
 * single warning per process) when the key is not configured, so callers keep
 * writing the plaintext column unchanged — deploy order can't corrupt data.
 * Returns null for empty/absent input without warning.
 */
export function encryptIdNumberIfConfigured(
  plain: string | null | undefined,
): EncryptedIdNumber | null {
  if (plain == null || plain.trim() === '') return null

  if (!isPiiEncryptionConfigured()) {
    if (!warnedKeyUnavailable) {
      console.warn(
        `[pii-crypto] ${PII_ENC_KEY_ENV} not configured — idNumber persisted plaintext only (encrypted dual-write disabled). See docs/security/id-number-encryption.md`,
      )
      warnedKeyUnavailable = true
    }
    return null
  }

  return {
    ciphertext: encryptIdNumber(plain),
    last4: idNumberLast4(plain),
  }
}

// ─── Read accessor ────────────────────────────────────────────────────────────

export interface ApplicationIdNumberFields {
  idNumber?: string | null
  idNumberCiphertext?: string | null
}

/**
 * Resolve the full ID number for an application row. Prefers decrypting the
 * ciphertext column; falls back to the plaintext column when the ciphertext is
 * absent or cannot be decrypted (missing key, tamper, format drift). During
 * the dual-write window the fallback guarantees reads never break; after the
 * manual plaintext retirement, the ciphertext is the only source.
 *
 * Never logs plaintext or ciphertext contents.
 */
export function getApplicationIdNumber(app: ApplicationIdNumberFields): string | null {
  const ciphertext = app.idNumberCiphertext
  if (ciphertext && ciphertext.trim() !== '') {
    try {
      return decryptIdNumber(ciphertext)
    } catch (err) {
      console.warn('[pii-crypto] idNumber ciphertext decrypt failed — falling back to plaintext column', {
        reason: err instanceof Error ? err.message : String(err),
      })
    }
  }
  return app.idNumber ?? null
}
