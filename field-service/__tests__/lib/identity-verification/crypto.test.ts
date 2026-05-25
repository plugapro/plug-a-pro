import { randomBytes } from 'crypto'
import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  decryptIdentifier,
  encryptIdentifier,
  hashIdentifier,
  identifierLast4,
  normalizeIdentifier,
} from '../../../lib/identity-verification/crypto'

describe('identity verification crypto helpers', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('normalizes identifiers before hashing', () => {
    expect(normalizeIdentifier(' ab 123 ')).toBe('AB123')
  })

  it('hashes the same identifier and namespace deterministically', () => {
    vi.stubEnv('IDENTITY_HASH_PEPPER', 'test-pepper')

    expect(hashIdentifier(' ab 123 ', 'provider-id')).toBe(
      hashIdentifier('AB123', 'provider-id'),
    )
  })

  it('uses namespace as part of the hash input', () => {
    vi.stubEnv('IDENTITY_HASH_PEPPER', 'test-pepper')

    expect(hashIdentifier('AB123', 'provider-id')).not.toBe(
      hashIdentifier('AB123', 'document-number'),
    )
  })

  it('returns only the final four characters when an identifier is longer than four characters', () => {
    expect(identifierLast4('A12345678')).toBe('5678')
  })

  it('returns the complete value when the identifier is four characters or shorter', () => {
    expect(identifierLast4('123')).toBe('123')
  })

  it('encrypts and decrypts identifiers with AES-256-GCM', () => {
    vi.stubEnv('IDENTITY_ENC_KEY', randomBytes(32).toString('base64'))

    const ciphertext = encryptIdentifier('8001015009087')

    expect(ciphertext).toMatch(/^v1:/)
    expect(ciphertext).not.toContain('8001015009087')
    expect(decryptIdentifier(ciphertext)).toBe('8001015009087')
  })

  it('does not require the encryption key for hashing', () => {
    vi.stubEnv('IDENTITY_HASH_PEPPER', 'test-pepper')
    vi.stubEnv('IDENTITY_ENC_KEY', '')

    expect(hashIdentifier('A12345678', 'provider-id')).toHaveLength(64)
  })

  it('throws a configuration error when encryption is called without a key', () => {
    vi.stubEnv('IDENTITY_ENC_KEY', '')

    expect(() => encryptIdentifier('8001015009087')).toThrow(
      'IDENTITY_ENC_KEY must be a 32-byte base64 or utf8 value',
    )
  })
})
