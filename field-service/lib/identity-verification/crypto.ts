import { createCipheriv, createDecipheriv, createHmac, randomBytes } from 'crypto'

const ENCRYPTION_VERSION = 'v1'

export function normalizeIdentifier(input: string): string {
  return input.replace(/\s+/g, '').trim().toUpperCase()
}

export function hashIdentifier(input: string, namespace: string): string {
  const pepper = process.env.IDENTITY_HASH_PEPPER
  if (!pepper) {
    throw new Error('IDENTITY_HASH_PEPPER is required for identifier hashing')
  }

  return createHmac('sha256', pepper)
    .update(`${namespace}:${normalizeIdentifier(input)}`)
    .digest('hex')
}

export function identifierLast4(input: string): string {
  return normalizeIdentifier(input).slice(-4)
}

export function encryptIdentifier(plaintext: string): string {
  const key = readEncryptionKey()
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  const ciphertext = Buffer.concat([
    cipher.update(plaintext, 'utf8'),
    cipher.final(),
  ])
  const authTag = cipher.getAuthTag()

  return [
    ENCRYPTION_VERSION,
    iv.toString('base64'),
    authTag.toString('base64'),
    ciphertext.toString('base64'),
  ].join(':')
}

export function decryptIdentifier(ciphertext: string): string {
  const [version, ivBase64, authTagBase64, encryptedBase64] = ciphertext.split(':')
  if (version !== ENCRYPTION_VERSION || !ivBase64 || !authTagBase64 || !encryptedBase64) {
    throw new Error('Invalid encrypted identifier format')
  }

  const decipher = createDecipheriv('aes-256-gcm', readEncryptionKey(), Buffer.from(ivBase64, 'base64'))
  decipher.setAuthTag(Buffer.from(authTagBase64, 'base64'))

  return Buffer.concat([
    decipher.update(Buffer.from(encryptedBase64, 'base64')),
    decipher.final(),
  ]).toString('utf8')
}

function readEncryptionKey(): Buffer {
  const raw = process.env.IDENTITY_ENC_KEY
  if (!raw) {
    throw new Error('IDENTITY_ENC_KEY must be a 32-byte base64 or utf8 value')
  }

  const base64Key = Buffer.from(raw, 'base64')
  if (base64Key.length === 32) {
    return base64Key
  }

  const utf8Key = Buffer.from(raw, 'utf8')
  if (utf8Key.length === 32) {
    return utf8Key
  }

  throw new Error('IDENTITY_ENC_KEY must be a 32-byte base64 or utf8 value')
}
