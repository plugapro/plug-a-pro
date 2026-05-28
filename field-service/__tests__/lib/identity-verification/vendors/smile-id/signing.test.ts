import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  computeSmileSignature,
  verifySmileSignature,
} from '../../../../../lib/identity-verification/vendors/smile-id/signing'

const TEST_PARTNER_ID = '100'
const TEST_API_KEY = 'TEST_API_KEY_DO_NOT_USE_IN_PROD'

describe('Smile ID signing', () => {
  beforeEach(() => {
    vi.stubEnv('SMILE_ID_PARTNER_ID', TEST_PARTNER_ID)
    vi.stubEnv('SMILE_ID_API_KEY', TEST_API_KEY)
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('computeSmileSignature returns the same signature for the same timestamp', () => {
    const ts = '2026-05-27T10:00:00.000Z'
    const a = computeSmileSignature(ts)
    const b = computeSmileSignature(ts)
    expect(a).toEqual(b)
  })

  it('computeSmileSignature returns a base64-shaped string', () => {
    const sig = computeSmileSignature('2026-05-27T10:00:00.000Z')
    expect(sig).toMatch(/^[A-Za-z0-9+/]+=*$/)
    expect(Buffer.from(sig, 'base64').length).toBe(32) // SHA-256 digest
  })

  it('computeSmileSignature differs across timestamps', () => {
    const a = computeSmileSignature('2026-05-27T10:00:00.000Z')
    const b = computeSmileSignature('2026-05-27T10:00:01.000Z')
    expect(a).not.toEqual(b)
  })

  it('verifySmileSignature accepts a signature it just generated', () => {
    const ts = '2026-05-27T10:00:00.000Z'
    const sig = computeSmileSignature(ts)
    expect(verifySmileSignature(ts, sig)).toBe(true)
  })

  it('verifySmileSignature rejects a tampered signature', () => {
    const ts = '2026-05-27T10:00:00.000Z'
    const sig = computeSmileSignature(ts)
    const tampered = sig.replace(/.$/, sig.endsWith('A') ? 'B' : 'A')
    expect(verifySmileSignature(ts, tampered)).toBe(false)
  })

  it('verifySmileSignature rejects when API_KEY env differs', () => {
    const ts = '2026-05-27T10:00:00.000Z'
    const sig = computeSmileSignature(ts)
    vi.stubEnv('SMILE_ID_API_KEY', 'DIFFERENT_KEY')
    expect(verifySmileSignature(ts, sig)).toBe(false)
  })

  it('verifySmileSignature returns false when env not set', () => {
    vi.unstubAllEnvs()
    expect(verifySmileSignature('2026-05-27T10:00:00.000Z', 'anything')).toBe(false)
  })

  it('verifySmileSignature returns false for malformed input', () => {
    expect(verifySmileSignature('', 'sig')).toBe(false)
    expect(verifySmileSignature('ts', '')).toBe(false)
  })
})
