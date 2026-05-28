import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockAdapter, mockDb, mockApplyVendorVerdict, mockRaiseSecurityReviewEvent } = vi.hoisted(() => ({
  mockAdapter: {
    parseWebhook: vi.fn(),
  },
  mockDb: {
    providerVerificationWebhookEvent: {
      create: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    providerIdentityVerification: {
      findMany: vi.fn(),
      findUniqueOrThrow: vi.fn(),
    },
  },
  mockApplyVendorVerdict: vi.fn(),
  mockRaiseSecurityReviewEvent: vi.fn(),
}))

vi.mock('@/lib/db', () => ({ db: mockDb }))
vi.mock('@/lib/identity-verification/vendors/registry', () => ({
  getAdapter: vi.fn(() => mockAdapter),
  toVendorKey: vi.fn((value: string) => value),
}))
vi.mock('@/lib/identity-verification/orchestrator', () => ({
  applyVendorVerdict: mockApplyVendorVerdict,
}))
vi.mock('@/lib/security/security-event-service', () => ({
  raiseSecurityReviewEvent: mockRaiseSecurityReviewEvent,
}))

function request(body = '{}') {
  return new NextRequest('http://localhost/api/webhooks/verification/smile_id', {
    method: 'POST',
    body,
  })
}

describe('verification provider webhook route', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockAdapter.parseWebhook.mockResolvedValue({
      signatureValid: true,
      vendorEventId: 'evt-1',
      vendorReference: 'job-1',
      livenessSessionReference: null,
      eventType: 'verification.completed',
      payloadHash: 'hash-1',
      redactedPayload: { event: 'ok' },
      result: { decision: 'PASS', confidence: 0.99, livenessVerified: true },
    })
    mockDb.providerVerificationWebhookEvent.create.mockResolvedValue({ id: 'wh-1' })
    mockDb.providerVerificationWebhookEvent.update.mockResolvedValue({ id: 'wh-1' })
    mockDb.providerIdentityVerification.findMany.mockResolvedValue([{ id: 'ver-1' }])
    mockDb.providerIdentityVerification.findUniqueOrThrow.mockResolvedValue({ id: 'ver-1' })
    mockApplyVendorVerdict.mockResolvedValue({ verificationId: 'ver-1', status: 'PASSED' })
  })

  it('applies a valid webhook verdict resolved by vendor reference', async () => {
    const { POST } = await import('@/app/api/webhooks/verification/[vendor]/route')

    const response = await POST(request('{"event_id":"evt-1"}'), { params: Promise.resolve({ vendor: 'smile_id' }) })

    expect(response.status).toBe(200)
    expect(mockDb.providerVerificationWebhookEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        vendorKey: 'smile_id',
        vendorReference: 'job-1',
        idempotencyKey: 'smile_id:evt-1',
      }),
    })
    expect(mockApplyVendorVerdict).toHaveBeenCalledWith('ver-1', expect.objectContaining({ decision: 'PASS' }), 'webhook')
  })

  it('returns 401 without writing to the webhook audit table for invalid-signature payloads', async () => {
    mockAdapter.parseWebhook.mockResolvedValue({
      signatureValid: false,
      vendorEventId: 'evt-forged',
      vendorReference: 'attacker-supplied-ref',
      livenessSessionReference: null,
      eventType: 'verification.completed',
      payloadHash: 'hash-forged',
      redactedPayload: { event: 'forged' },
      result: null,
    })
    const { POST } = await import('@/app/api/webhooks/verification/[vendor]/route')

    const response = await POST(request('{"event_id":"evt-forged"}'), { params: Promise.resolve({ vendor: 'smile_id' }) })
    const json = await response.json()

    expect(response.status).toBe(401)
    expect(json).toMatchObject({ ok: false, code: 'INVALID_SIGNATURE' })
    expect(mockDb.providerVerificationWebhookEvent.create).not.toHaveBeenCalled()
    expect(mockDb.providerVerificationWebhookEvent.update).not.toHaveBeenCalled()
    expect(mockApplyVendorVerdict).not.toHaveBeenCalled()
  })

  it('does not apply a verdict when vendor and liveness references resolve to different verifications', async () => {
    mockAdapter.parseWebhook.mockResolvedValue({
      signatureValid: true,
      vendorEventId: 'evt-ambiguous',
      vendorReference: 'job-1',
      livenessSessionReference: 'live-2',
      eventType: 'verification.completed',
      payloadHash: 'hash-ambiguous',
      redactedPayload: { event: 'ambiguous' },
      result: { decision: 'PASS', confidence: 0.99, livenessVerified: true },
    })
    mockDb.providerVerificationWebhookEvent.create.mockResolvedValue({ id: 'wh-ambiguous' })
    mockDb.providerIdentityVerification.findMany.mockResolvedValue([{ id: 'ver-a' }, { id: 'ver-b' }])
    const { POST } = await import('@/app/api/webhooks/verification/[vendor]/route')

    const response = await POST(request('{"event_id":"evt-ambiguous"}'), { params: Promise.resolve({ vendor: 'smile_id' }) })

    expect(response.status).toBe(200)
    expect(mockApplyVendorVerdict).not.toHaveBeenCalled()
    expect(mockDb.providerVerificationWebhookEvent.update).toHaveBeenCalledWith({
      where: { id: 'wh-ambiguous' },
      data: expect.objectContaining({
        processingError: 'AMBIGUOUS_REFERENCE_RESOLUTION',
        processedAt: expect.any(Date),
      }),
    })
    expect(mockRaiseSecurityReviewEvent).toHaveBeenCalledWith(expect.objectContaining({
      eventType: 'WEBHOOK_AMBIGUOUS_REFERENCE_RESOLUTION',
      severity: 'HIGH',
      subjectWebhookEventId: 'wh-ambiguous',
      metadata: expect.objectContaining({
        matchedVerificationIds: ['ver-a', 'ver-b'],
      }),
    }))
  })
})
