import { describe, it, expect } from 'vitest'
import {
  findRawSensitiveFields,
  redactMetadata,
  safeReference,
  hashIdentifier,
  maskEmail,
} from '../../../lib/ai-loop/redaction'

describe('findRawSensitiveFields', () => {
  it('flags government-id, biometric, token, secret and card keys', () => {
    const findings = findRawSensitiveFields({
      idNumber: '9001015009087',
      selfie: 'base64',
      accessToken: 'x',
      apiKey: 'y',
      cardNumber: '4111111111111111',
      nested: { refreshToken: 'z' },
    })
    const paths = findings.map((f) => f.path)
    expect(paths).toContain('idNumber')
    expect(paths).toContain('selfie')
    expect(paths).toContain('accessToken')
    expect(paths).toContain('apiKey')
    expect(paths).toContain('cardNumber')
    expect(paths).toContain('nested.refreshToken')
  })

  it('does not flag safe operational keys', () => {
    const findings = findRawSensitiveFields({ errorCode: 'SLOT_TAKEN', jobRequestId: 'creq_1', count: 3 })
    expect(findings).toHaveLength(0)
  })

  it('ignores present-but-empty sensitive values', () => {
    expect(findRawSensitiveFields({ token: '', secret: null })).toHaveLength(0)
  })
})

describe('redactMetadata', () => {
  it('masks phone numbers rather than dropping them', () => {
    const out = redactMetadata({ phone: '+27821234567' }) as Record<string, string>
    expect(out.phone).not.toContain('821234567')
    expect(out.phone).toMatch(/\*/)
  })

  it('masks emails', () => {
    const out = redactMetadata({ email: 'lovemore@example.com' }) as Record<string, string>
    expect(out.email).toBe('l***@example.com')
  })

  it('replaces deny-tier keys with [REJECTED] as defense in depth', () => {
    const out = redactMetadata({ secret: 'super', otp: '123456' }) as Record<string, string>
    expect(out.secret).toBe('[REJECTED]')
    expect(out.otp).toBe('[REJECTED]')
  })

  it('summarises long free text (potential message bodies)', () => {
    const long = 'a'.repeat(300)
    const out = redactMetadata({ body: long }) as Record<string, string>
    expect(out.body).toMatch(/text omitted: 300 chars/)
  })

  it('scrubs an embedded 13-digit ID number from free text', () => {
    const out = redactMetadata({ note: 'customer id 9001015009087 had issue' }) as Record<string, string>
    expect(out.note).toContain('[redacted-id]')
    expect(out.note).not.toContain('9001015009087')
  })

  it('scrubs an embedded long token from free text', () => {
    const token = 'abc' + 'X'.repeat(40)
    const out = redactMetadata({ reason: `failed with ${token}` }) as Record<string, string>
    expect(out.reason).toContain('[redacted-token]')
    expect(out.reason).not.toContain(token)
  })
})

describe('safeReference', () => {
  it('passes internal ids through unchanged', () => {
    expect(safeReference('creq_abc123')).toBe('creq_abc123')
  })

  it('hashes phone-like references', () => {
    const ref = safeReference('+27821234567')
    expect(ref).toMatch(/^phash_[0-9a-f]{16}$/)
    expect(ref).not.toContain('821234567')
  })

  it('returns null for empty input', () => {
    expect(safeReference('')).toBeNull()
    expect(safeReference(null)).toBeNull()
  })
})

describe('hashIdentifier / maskEmail', () => {
  it('hashIdentifier is stable and 16 hex chars', () => {
    expect(hashIdentifier('x')).toBe(hashIdentifier('x'))
    expect(hashIdentifier('x')).toMatch(/^[0-9a-f]{16}$/)
  })

  it('maskEmail keeps the domain but hides the local part', () => {
    expect(maskEmail('john@plugapro.co.za')).toBe('j***@plugapro.co.za')
  })
})
