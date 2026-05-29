import { createHmac } from 'crypto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { resetDiditConfigCacheForTests } from '../../../../../lib/identity-verification/vendors/didit/config'
import { parseDiditWebhook } from '../../../../../lib/identity-verification/vendors/didit/parse'
import { canonicalJson } from '../../../../../lib/identity-verification/vendors/didit/signing'

const WEBHOOK_SECRET = 'shared-secret'
const WORKFLOW_AUTH = 'wf-auth-uuid'

vi.mock('../../../../../lib/db', () => ({
  db: {
    providerIdentityVerification: {
      findFirst: vi.fn().mockResolvedValue(null),
    },
  },
}))

function signedHeaders(body: string): Record<string, string> {
  const sig = createHmac('sha256', WEBHOOK_SECRET).update(canonicalJson(body), 'utf8').digest('hex')
  return {
    'X-Timestamp': String(Math.floor(Date.now() / 1000)),
    'X-Signature-V2': sig,
  }
}

describe('parseDiditWebhook', () => {
  beforeEach(() => {
    vi.stubEnv('DIDIT_API_KEY', 'k')
    vi.stubEnv('DIDIT_BASE_URL', 'https://verification.didit.me')
    vi.stubEnv('DIDIT_WEBHOOK_SECRET', WEBHOOK_SECRET)
    vi.stubEnv('DIDIT_PROVIDER_KYC_AUTHORITATIVE_WORKFLOW_ID', WORKFLOW_AUTH)
    resetDiditConfigCacheForTests()
  })

  afterEach(() => {
    vi.unstubAllEnvs()
    resetDiditConfigCacheForTests()
  })

  it('returns signatureValid:true for a correctly-signed Approved webhook (spec §6.2)', async () => {
    const body = JSON.stringify({
      event_id: 'evt-approved',
      webhook_type: 'status.updated',
      session_id: 'sess-1',
      status: 'Approved',
      decision: {
        session_id: 'sess-1',
        status: 'Approved',
        liveness_checks: [{ status: 'Passed', score: 0.97 }],
        face_matches: [{ status: 'Passed', score: 0.95 }],
        id_verifications: [{ status: 'Passed', confidence: 0.93 }],
      },
    })
    const parsed = await parseDiditWebhook({ rawBody: body, headers: signedHeaders(body) })
    expect(parsed.signatureValid).toBe(true)
    expect(parsed.vendorReference).toBe('sess-1')
    expect(parsed.vendorEventId).toBe('evt-approved')
    expect(parsed.eventType).toBe('status.updated')
    expect(parsed.result?.decision).toBe('PASS')
    expect(parsed.result?.livenessVerified).toBe(true)
  })

  it('returns signatureValid:false for an invalid signature (spec §6.2)', async () => {
    const body = JSON.stringify({
      event_id: 'evt-bad',
      session_id: 'sess-2',
      status: 'Approved',
    })
    const headers = {
      'X-Timestamp': String(Math.floor(Date.now() / 1000)),
      'X-Signature-V2': 'deadbeef'.repeat(8), // 64 hex chars, wrong value
    }
    const parsed = await parseDiditWebhook({ rawBody: body, headers })
    expect(parsed.signatureValid).toBe(false)
    // payload metadata is still parsed for audit-row construction at the route
    // layer, but the route gates persistence behind signatureValid.
    expect(parsed.vendorReference).toBe('sess-2')
  })

  it('returns signatureValid:false for a missing timestamp header', async () => {
    const body = JSON.stringify({ session_id: 'sess-3', status: 'Approved' })
    const sig = createHmac('sha256', WEBHOOK_SECRET).update(canonicalJson(body), 'utf8').digest('hex')
    const parsed = await parseDiditWebhook({ rawBody: body, headers: { 'X-Signature-V2': sig } })
    expect(parsed.signatureValid).toBe(false)
  })

  it('parses non-decision events (In Progress, Expired) with result:null and a stored vendor_event_id', async () => {
    const body = JSON.stringify({
      event_id: 'evt-progress',
      webhook_type: 'status.updated',
      session_id: 'sess-4',
      status: 'In Progress',
    })
    const parsed = await parseDiditWebhook({ rawBody: body, headers: signedHeaders(body) })
    expect(parsed.signatureValid).toBe(true)
    expect(parsed.result).toBeNull()
    expect(parsed.vendorEventId).toBe('evt-progress')
  })

  it('exposes vendor_data as the internal verification id for Didit entity events without a session_id', async () => {
    const body = JSON.stringify({
      event_id: 'evt-user-status',
      webhook_type: 'user.status.updated',
      vendor_data: 'ver_from_vendor_data',
      status: 'APPROVED',
    })

    const parsed = await parseDiditWebhook({ rawBody: body, headers: signedHeaders(body) })

    expect(parsed.signatureValid).toBe(true)
    expect(parsed.vendorReference).toBeNull()
    expect((parsed as { verificationId?: string | null }).verificationId).toBe('ver_from_vendor_data')
    expect(parsed.result).toBeNull()
  })

  it('returns an empty result when the body is unparsable', async () => {
    const parsed = await parseDiditWebhook({ rawBody: 'not-json', headers: signedHeaders('{}') })
    expect(parsed.signatureValid).toBe(false)
    expect(parsed.vendorReference).toBeNull()
    expect(parsed.result).toBeNull()
  })

  it('stores a stable payloadHash for idempotency / duplicate detection', async () => {
    const body = JSON.stringify({
      event_id: 'evt-dup',
      session_id: 'sess-5',
      status: 'Approved',
      liveness_checks: [{ status: 'Passed', score: 0.99 }],
      face_matches: [{ status: 'Passed', score: 0.99 }],
      id_verifications: [{ status: 'Passed' }],
    })
    const a = await parseDiditWebhook({ rawBody: body, headers: signedHeaders(body) })
    const b = await parseDiditWebhook({ rawBody: body, headers: signedHeaders(body) })
    expect(a.payloadHash).toBe(b.payloadHash)
  })

  it('redacts unknown fields (PII safety) while preserving allowlisted decision data', async () => {
    const body = JSON.stringify({
      event_id: 'evt-redact',
      session_id: 'sess-6',
      status: 'Approved',
      FullName: 'Some Person',           // unknown -> REDACTED
      IDNumber: '8001015009087',          // unknown -> REDACTED
      Address: '1 Long Street',           // unknown -> REDACTED
      decision: {
        status: 'Approved',
        liveness_checks: [{ status: 'Passed' }],
      },
    })
    const parsed = await parseDiditWebhook({ rawBody: body, headers: signedHeaders(body) })
    const redacted = parsed.redactedPayload as Record<string, unknown>
    expect(redacted.FullName).toBe('[REDACTED]')
    expect(redacted.IDNumber).toBe('[REDACTED]')
    expect(redacted.Address).toBe('[REDACTED]')
    expect(redacted.status).toBe('Approved')
    expect(redacted.decision).toBeTruthy()
  })
})
