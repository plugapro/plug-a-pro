import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { parseSmileWebhook } from '../../../../../lib/identity-verification/vendors/smile-id/parse'
import { computeSmileSignature, currentIsoTimestamp } from '../../../../../lib/identity-verification/vendors/smile-id/signing'

const PARTNER_ID = '100'
const API_KEY = 'TEST_KEY'

function signedPayload(body: Record<string, unknown>) {
  const timestamp = currentIsoTimestamp()
  const signature = computeSmileSignature(timestamp)
  return JSON.stringify({ timestamp, signature, ...body })
}

describe('parseSmileWebhook', () => {
  beforeEach(() => {
    vi.stubEnv('SMILE_ID_PARTNER_ID', PARTNER_ID)
    vi.stubEnv('SMILE_ID_API_KEY', API_KEY)
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('marks signatureValid=true for a payload we just signed', async () => {
    const rawBody = signedPayload({ SmileJobID: 'x', ResultCode: '0810' })
    const r = await parseSmileWebhook({ headers: {}, rawBody })
    expect(r.signatureValid).toBe(true)
  })

  it('marks signatureValid=false for a tampered signature', async () => {
    const rawBody = signedPayload({ SmileJobID: 'x', ResultCode: '0810' })
    const tampered = rawBody.replace(/"signature":"[^"]+"/, '"signature":"DEADBEEF"')
    const r = await parseSmileWebhook({ headers: {}, rawBody: tampered })
    expect(r.signatureValid).toBe(false)
  })

  it('treats IsFinalResult="true" string as final', async () => {
    const rawBody = signedPayload({
      SmileJobID: 'x', ResultCode: '0810',
      IsFinalResult: 'true',
      PartnerParams: { user_id: 'u', job_id: 'j', job_type: 11, verification_id: 'v' },
      Actions: { Liveness_Check: 'Passed' },
    })
    const r = await parseSmileWebhook({ headers: {}, rawBody })
    expect(r.eventType).toBe('final')
    expect(r.result).not.toBeNull()
    expect(r.result?.decision).toBe('PASS')
    expect(r.result?.livenessVerified).toBe(true)
  })

  it('treats IsFinalResult=true boolean as final', async () => {
    const rawBody = signedPayload({
      SmileJobID: 'x', ResultCode: '0810',
      IsFinalResult: true,
      Actions: { Liveness_Check: 'Passed' },
    })
    const r = await parseSmileWebhook({ headers: {}, rawBody })
    expect(r.eventType).toBe('final')
  })

  it('falls back to terminal-code detection when IsFinalResult absent', async () => {
    const rawBody = signedPayload({ SmileJobID: 'x', ResultCode: '0810' })
    const r = await parseSmileWebhook({ headers: {}, rawBody })
    expect(r.eventType).toBe('final')
    expect(r.result?.decision).toBe('PASS')
  })

  it('returns eventType=interim and result=null for non-final + non-terminal', async () => {
    const rawBody = signedPayload({
      SmileJobID: 'x', ResultCode: '9999',
      IsFinalResult: 'false',
    })
    const r = await parseSmileWebhook({ headers: {}, rawBody })
    expect(r.eventType).toBe('interim')
    expect(r.result).toBeNull()
  })

  it('derives livenessVerified=true on Actions.Liveness_Check="Passed"', async () => {
    const rawBody = signedPayload({
      SmileJobID: 'x', ResultCode: '0810',
      IsFinalResult: 'true',
      Actions: { Liveness_Check: 'Passed' },
    })
    const r = await parseSmileWebhook({ headers: {}, rawBody })
    expect(r.result?.livenessVerified).toBe(true)
  })

  it('derives livenessVerified=false on Actions.Liveness_Check="Failed"', async () => {
    const rawBody = signedPayload({
      SmileJobID: 'x', ResultCode: '0810',
      IsFinalResult: 'true',
      Actions: { Liveness_Check: 'Failed' },
    })
    const r = await parseSmileWebhook({ headers: {}, rawBody })
    expect(r.result?.livenessVerified).toBe(false)
  })

  it('derives livenessVerified=null on "Under Review" or missing', async () => {
    const a = await parseSmileWebhook({ headers: {}, rawBody: signedPayload({
      SmileJobID: 'x', ResultCode: '0810', IsFinalResult: 'true',
      Actions: { Liveness_Check: 'Under Review' },
    }) })
    expect(a.result?.livenessVerified).toBeNull()
    const b = await parseSmileWebhook({ headers: {}, rawBody: signedPayload({
      SmileJobID: 'x', ResultCode: '0810', IsFinalResult: 'true', Actions: {},
    }) })
    expect(b.result?.livenessVerified).toBeNull()
  })

  it('binary confidence = 1.0 only when PASS+final+liveness Passed', async () => {
    const r = await parseSmileWebhook({ headers: {}, rawBody: signedPayload({
      SmileJobID: 'x', ResultCode: '0810', IsFinalResult: 'true',
      Actions: { Liveness_Check: 'Passed' },
    }) })
    expect(r.result?.confidence).toBe(1.0)
  })

  it('binary confidence = 0.0 when liveness not passed', async () => {
    const r = await parseSmileWebhook({ headers: {}, rawBody: signedPayload({
      SmileJobID: 'x', ResultCode: '0810', IsFinalResult: 'true',
      Actions: { Liveness_Check: 'Failed' },
    }) })
    expect(r.result?.confidence).toBe(0.0)
  })

  it('extracts vendorReference from PartnerParams.job_id', async () => {
    const rawBody = signedPayload({
      SmileJobID: 'smile-x', ResultCode: '0810', IsFinalResult: 'true',
      PartnerParams: { user_id: 'u', job_id: 'pap-uuid', job_type: 11, verification_id: 'v' },
      Actions: { Liveness_Check: 'Passed' },
    })
    const r = await parseSmileWebhook({ headers: {}, rawBody })
    expect(r.vendorReference).toBe('pap-uuid')
  })

  it('extracts livenessSessionReference from ref_id at top level', async () => {
    const rawBody = signedPayload({
      SmileJobID: 'x', ResultCode: '0810', IsFinalResult: 'true',
      ref_id: 'link-ref-abc',
      Actions: { Liveness_Check: 'Passed' },
    })
    const r = await parseSmileWebhook({ headers: {}, rawBody })
    expect(r.livenessSessionReference).toBe('link-ref-abc')
  })

  it('computes deterministic payloadHash that does not depend on key order', async () => {
    const a = await parseSmileWebhook({ headers: {}, rawBody: '{"a":1,"b":2}' })
    const b = await parseSmileWebhook({ headers: {}, rawBody: '{"b":2,"a":1}' })
    expect(a.payloadHash).toBe(b.payloadHash)
  })

  it('returns FAIL decision on codes 0811, 0812, 0816, 1014', async () => {
    for (const code of ['0811', '0812', '0816', '1014']) {
      const r = await parseSmileWebhook({ headers: {}, rawBody: signedPayload({
        SmileJobID: 'x', ResultCode: code, IsFinalResult: 'true',
      }) })
      expect(r.result?.decision).toBe('FAIL')
    }
  })

  it('does not include any raw PII in the redactedPayload', async () => {
    const r = await parseSmileWebhook({ headers: {}, rawBody: signedPayload({
      SmileJobID: 'x', ResultCode: '0810', IsFinalResult: 'true',
      FullName: 'JANE DOE', IDNumber: '8001015009087',
      Photo: 'BASE64', ImageLinks: { selfie_image: 'https://x' },
    }) })
    const ser = JSON.stringify(r.redactedPayload)
    expect(ser).not.toContain('JANE DOE')
    expect(ser).not.toContain('8001015009087')
    expect(ser).not.toContain('BASE64')
  })
})
