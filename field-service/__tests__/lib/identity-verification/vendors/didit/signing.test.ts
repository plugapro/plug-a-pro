import { createHmac } from 'crypto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { resetDiditConfigCacheForTests } from '../../../../../lib/identity-verification/vendors/didit/config'
import {
  canonicalJson,
  verifyDiditWebhookSignature,
} from '../../../../../lib/identity-verification/vendors/didit/signing'

const PRIMARY_SECRET = 'primary-secret-shared-key'
const SECONDARY_SECRET = 'previous-secret-still-valid-during-rotation'

function signV2(body: string, secret: string): string {
  return createHmac('sha256', secret).update(canonicalJson(body), 'utf8').digest('hex')
}

function signV1(body: string, secret: string): string {
  return createHmac('sha256', secret).update(body, 'utf8').digest('hex')
}

function nowSeconds(): number {
  return Math.floor(Date.now() / 1000)
}

const samplePayload = JSON.stringify({
  event_id: 'evt-1',
  webhook_type: 'status.updated',
  session_id: 'sess-1',
  status: 'Approved',
  timestamp: 1685162400,
})

describe('verifyDiditWebhookSignature', () => {
  beforeEach(() => {
    vi.stubEnv('DIDIT_API_KEY', 'k')
    vi.stubEnv('DIDIT_BASE_URL', 'https://verification.didit.me')
    vi.stubEnv('DIDIT_WEBHOOK_SECRET', `${PRIMARY_SECRET},${SECONDARY_SECRET}`)
    vi.stubEnv('DIDIT_PROVIDER_KYC_AUTHORITATIVE_WORKFLOW_ID', 'wf')
    resetDiditConfigCacheForTests()
  })

  afterEach(() => {
    vi.unstubAllEnvs()
    resetDiditConfigCacheForTests()
  })

  it('accepts a valid V2 canonical-JSON signature', () => {
    const headers = {
      'X-Timestamp': String(nowSeconds()),
      'X-Signature-V2': signV2(samplePayload, PRIMARY_SECRET),
    }
    const check = verifyDiditWebhookSignature(samplePayload, headers)
    expect(check.valid).toBe(true)
    expect(check.algorithm).toBe('V2_CANONICAL')
  })

  it('rejects a tampered V2 signature even when V1 header is absent', () => {
    const headers = {
      'X-Timestamp': String(nowSeconds()),
      'X-Signature-V2': signV2(samplePayload, 'wrong-secret'),
    }
    const check = verifyDiditWebhookSignature(samplePayload, headers)
    expect(check.valid).toBe(false)
    expect(check.reason).toBe('signature_mismatch')
  })

  it('rejects when timestamp header is missing', () => {
    const headers = {
      'X-Signature-V2': signV2(samplePayload, PRIMARY_SECRET),
    }
    const check = verifyDiditWebhookSignature(samplePayload, headers)
    expect(check.valid).toBe(false)
    expect(check.reason).toBe('no_timestamp')
  })

  it('rejects when timestamp is older than 300 seconds (replay protection)', () => {
    const stale = nowSeconds() - 400
    const headers = {
      'X-Timestamp': String(stale),
      'X-Signature-V2': signV2(samplePayload, PRIMARY_SECRET),
    }
    const check = verifyDiditWebhookSignature(samplePayload, headers)
    expect(check.valid).toBe(false)
    expect(check.reason).toBe('stale')
  })

  it('rejects when timestamp is in the far future (clock-skew defence)', () => {
    const futureMs = nowSeconds() + 600
    const headers = {
      'X-Timestamp': String(futureMs),
      'X-Signature-V2': signV2(samplePayload, PRIMARY_SECRET),
    }
    const check = verifyDiditWebhookSignature(samplePayload, headers)
    expect(check.valid).toBe(false)
    expect(check.reason).toBe('future_skew')
  })

  it('falls back to V1 raw-body signature when V2 header is absent', () => {
    const headers = {
      'X-Timestamp': String(nowSeconds()),
      'X-Signature': signV1(samplePayload, PRIMARY_SECRET),
    }
    const check = verifyDiditWebhookSignature(samplePayload, headers)
    expect(check.valid).toBe(true)
    expect(check.algorithm).toBe('V1_RAW')
  })

  it('rejects when neither V1 nor V2 headers are present', () => {
    const headers = { 'X-Timestamp': String(nowSeconds()) }
    const check = verifyDiditWebhookSignature(samplePayload, headers)
    expect(check.valid).toBe(false)
    expect(check.reason).toBe('no_signature_headers')
  })

  it('accepts a signature produced with the SECONDARY rotation secret', () => {
    const headers = {
      'X-Timestamp': String(nowSeconds()),
      'X-Signature-V2': signV2(samplePayload, SECONDARY_SECRET),
    }
    const check = verifyDiditWebhookSignature(samplePayload, headers)
    expect(check.valid).toBe(true)
  })

  it('returns no_secret when DIDIT_WEBHOOK_SECRET is unset', () => {
    vi.stubEnv('DIDIT_WEBHOOK_SECRET', '')
    resetDiditConfigCacheForTests()
    const headers = {
      'X-Timestamp': String(nowSeconds()),
      'X-Signature-V2': signV2(samplePayload, PRIMARY_SECRET),
    }
    const check = verifyDiditWebhookSignature(samplePayload, headers)
    expect(check.valid).toBe(false)
    expect(check.reason).toBe('no_secret')
  })

  it('refuses to evaluate a V2 signature when the body is not valid JSON', () => {
    // Even if an attacker computes the HMAC over the raw bytes and stamps
    // it into X-Signature-V2, V2 implies canonical JSON; malformed JSON
    // must fail closed rather than silently fall through to V1 semantics.
    const malformed = 'not-valid-json-body'
    const headers = {
      'X-Timestamp': String(nowSeconds()),
      'X-Signature-V2': signV1(malformed, PRIMARY_SECRET),
    }
    const check = verifyDiditWebhookSignature(malformed, headers)
    expect(check.valid).toBe(false)
    expect(check.reason).toBe('signature_mismatch')
  })
})

describe('canonicalJson', () => {
  it('sorts keys recursively so V2 hashes are stable regardless of input ordering', () => {
    const a = canonicalJson('{"b":1,"a":2,"c":{"y":3,"x":4}}')
    const b = canonicalJson('{"a":2,"c":{"x":4,"y":3},"b":1}')
    expect(a).toBe(b)
  })

  it('returns the raw body when input is not valid JSON', () => {
    expect(canonicalJson('not-json')).toBe('not-json')
  })
})
