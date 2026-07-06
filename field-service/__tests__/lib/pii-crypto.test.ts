// SEC-01 / P0-7: at-rest encryption for ProviderApplication.idNumber (POPIA §26).

import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest'

import {
  PII_ENC_KEY_ENV,
  __resetPiiCryptoWarningForTests,
  decryptIdNumber,
  encryptIdNumber,
  encryptIdNumberIfConfigured,
  getApplicationIdNumber,
  isPiiEncryptionConfigured,
} from '@/lib/pii-crypto'
import {
  hasApplicationIdNumber,
  idNumberLast4,
  maskedIdNumberFromLast4,
  normalizeIdNumber,
} from '@/lib/pii-id-number'

const TEST_KEY = Buffer.alloc(32, 3).toString('base64')
const OTHER_KEY = Buffer.alloc(32, 9).toString('base64')
const SAMPLE_ID = '8001015009087'
const ORIGINAL_KEY = process.env[PII_ENC_KEY_ENV]

function setKey(value: string | undefined) {
  if (value === undefined) delete process.env[PII_ENC_KEY_ENV]
  else process.env[PII_ENC_KEY_ENV] = value
}

beforeEach(() => {
  setKey(TEST_KEY)
  __resetPiiCryptoWarningForTests()
  vi.restoreAllMocks()
})

afterAll(() => {
  setKey(ORIGINAL_KEY)
})

// ─── Round trip + format ──────────────────────────────────────────────────────

describe('encryptIdNumber / decryptIdNumber', () => {
  it('round-trips a plaintext ID number', () => {
    const ciphertext = encryptIdNumber(SAMPLE_ID)
    expect(decryptIdNumber(ciphertext)).toBe(SAMPLE_ID)
  })

  it('produces the versioned v1:<iv>:<tag>:<ct> format', () => {
    const ciphertext = encryptIdNumber(SAMPLE_ID)
    const parts = ciphertext.split(':')
    expect(parts).toHaveLength(4)
    expect(parts[0]).toBe('v1')
    expect(ciphertext).not.toContain(SAMPLE_ID)
  })

  it('uses a random IV: two encryptions of the same value differ', () => {
    expect(encryptIdNumber(SAMPLE_ID)).not.toBe(encryptIdNumber(SAMPLE_ID))
  })

  it('rejects tampered ciphertext (GCM auth failure)', () => {
    const ciphertext = encryptIdNumber(SAMPLE_ID)
    const parts = ciphertext.split(':')
    const body = Buffer.from(parts[3], 'base64')
    body[0] ^= 0xff
    const tampered = [parts[0], parts[1], parts[2], body.toString('base64')].join(':')
    expect(() => decryptIdNumber(tampered)).toThrow()
  })

  it('rejects an unknown ciphertext version', () => {
    const ciphertext = encryptIdNumber(SAMPLE_ID).replace(/^v1:/, 'v9:')
    expect(() => decryptIdNumber(ciphertext)).toThrow('Invalid encrypted idNumber format')
  })

  it('rejects malformed ciphertext', () => {
    expect(() => decryptIdNumber('not-a-ciphertext')).toThrow('Invalid encrypted idNumber format')
  })

  it('fails decryption under a different key', () => {
    const ciphertext = encryptIdNumber(SAMPLE_ID)
    setKey(OTHER_KEY)
    expect(() => decryptIdNumber(ciphertext)).toThrow()
  })

  it('throws when the key is missing', () => {
    const wellFormed = encryptIdNumber(SAMPLE_ID)
    setKey(undefined)
    expect(() => encryptIdNumber(SAMPLE_ID)).toThrow(`${PII_ENC_KEY_ENV} must be a 32-byte`)
    expect(() => decryptIdNumber(wellFormed)).toThrow(`${PII_ENC_KEY_ENV} must be a 32-byte`)
  })
})

// ─── Key validation ───────────────────────────────────────────────────────────

describe('isPiiEncryptionConfigured', () => {
  it('true for a 32-byte base64 key', () => {
    expect(isPiiEncryptionConfigured()).toBe(true)
  })

  it('true for a 32-char utf8 key', () => {
    setKey('a'.repeat(32))
    expect(isPiiEncryptionConfigured()).toBe(true)
  })

  it('false when absent or wrong length', () => {
    setKey(undefined)
    expect(isPiiEncryptionConfigured()).toBe(false)
    setKey('too-short')
    expect(isPiiEncryptionConfigured()).toBe(false)
  })
})

// ─── Degrade-safe dual-write helper ──────────────────────────────────────────

describe('encryptIdNumberIfConfigured', () => {
  it('returns ciphertext + last4 when the key is configured', () => {
    const result = encryptIdNumberIfConfigured(SAMPLE_ID)
    expect(result).not.toBeNull()
    expect(decryptIdNumber(result!.ciphertext)).toBe(SAMPLE_ID)
    expect(result!.last4).toBe('9087')
  })

  it('returns null for empty/absent input without warning', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    expect(encryptIdNumberIfConfigured(null)).toBeNull()
    expect(encryptIdNumberIfConfigured(undefined)).toBeNull()
    expect(encryptIdNumberIfConfigured('   ')).toBeNull()
    expect(warn).not.toHaveBeenCalled()
  })

  it('degrades to null when the key is missing and warns exactly once', () => {
    setKey(undefined)
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

    expect(encryptIdNumberIfConfigured(SAMPLE_ID)).toBeNull()
    expect(encryptIdNumberIfConfigured(SAMPLE_ID)).toBeNull()

    expect(warn).toHaveBeenCalledTimes(1)
    expect(String(warn.mock.calls[0][0])).toContain(PII_ENC_KEY_ENV)
    expect(String(warn.mock.calls[0][0])).not.toContain(SAMPLE_ID)
  })
})

// ─── Read accessor fallback ordering ─────────────────────────────────────────

describe('getApplicationIdNumber', () => {
  it('prefers decrypting the ciphertext column', () => {
    const app = {
      idNumber: 'stale-plaintext',
      idNumberCiphertext: encryptIdNumber(SAMPLE_ID),
    }
    expect(getApplicationIdNumber(app)).toBe(SAMPLE_ID)
  })

  it('falls back to plaintext when ciphertext is absent', () => {
    expect(getApplicationIdNumber({ idNumber: SAMPLE_ID, idNumberCiphertext: null })).toBe(SAMPLE_ID)
  })

  it('falls back to plaintext when decryption fails (tamper), logging no plaintext', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const app = { idNumber: SAMPLE_ID, idNumberCiphertext: 'v1:broken:broken:broken' }
    expect(getApplicationIdNumber(app)).toBe(SAMPLE_ID)
    expect(warn).toHaveBeenCalledTimes(1)
    expect(JSON.stringify(warn.mock.calls[0])).not.toContain(SAMPLE_ID)
  })

  it('falls back to plaintext when the key is missing', () => {
    const ciphertext = encryptIdNumber(SAMPLE_ID)
    setKey(undefined)
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    expect(getApplicationIdNumber({ idNumber: SAMPLE_ID, idNumberCiphertext: ciphertext })).toBe(SAMPLE_ID)
    expect(warn).toHaveBeenCalled()
  })

  it('returns null when neither column is populated', () => {
    expect(getApplicationIdNumber({ idNumber: null, idNumberCiphertext: null })).toBeNull()
    expect(getApplicationIdNumber({})).toBeNull()
  })
})

// ─── Pure presence/last4 helpers ─────────────────────────────────────────────

describe('pii-id-number helpers', () => {
  it('normalizeIdNumber strips whitespace and uppercases', () => {
    expect(normalizeIdNumber(' 80 0101 5009 087 ')).toBe('8001015009087')
    expect(normalizeIdNumber('ab123456')).toBe('AB123456')
  })

  it('idNumberLast4 returns the normalized tail', () => {
    expect(idNumberLast4(SAMPLE_ID)).toBe('9087')
    expect(idNumberLast4('80 0101 5009 087')).toBe('9087')
  })

  it('hasApplicationIdNumber is true for any of plaintext / ciphertext / last4', () => {
    expect(hasApplicationIdNumber({ idNumber: SAMPLE_ID })).toBe(true)
    expect(hasApplicationIdNumber({ idNumberCiphertext: 'v1:a:b:c' })).toBe(true)
    expect(hasApplicationIdNumber({ idNumberLast4: '9087' })).toBe(true)
    expect(hasApplicationIdNumber({ idNumber: '  ', idNumberCiphertext: null, idNumberLast4: null })).toBe(false)
    expect(hasApplicationIdNumber({})).toBe(false)
  })

  it('maskedIdNumberFromLast4 masks and never exposes more than 4 chars', () => {
    expect(maskedIdNumberFromLast4('9087')).toBe('*********9087')
    expect(maskedIdNumberFromLast4(null)).toBeNull()
    expect(maskedIdNumberFromLast4('')).toBeNull()
  })
})
