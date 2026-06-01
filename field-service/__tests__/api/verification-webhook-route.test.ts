import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockAdapter,
  mockDb,
  mockApplyVendorVerdict,
  mockGetSessionDecision,
  mockIsEnabled,
  mockPersistDiditDecision,
  mockRaiseSecurityReviewEvent,
} = vi.hoisted(() => ({
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
    providerVerificationEvent: {
      create: vi.fn(),
    },
  },
  mockApplyVendorVerdict: vi.fn(),
  mockGetSessionDecision: vi.fn(),
  mockIsEnabled: vi.fn(),
  mockPersistDiditDecision: vi.fn(),
  mockRaiseSecurityReviewEvent: vi.fn(),
}))

vi.mock('@/lib/db', () => ({ db: mockDb }))
vi.mock('@/lib/flags', () => ({ isEnabled: mockIsEnabled }))
vi.mock('@/lib/identity-verification/vendors/registry', () => ({
  getAdapter: vi.fn(() => mockAdapter),
  toVendorKey: vi.fn((value: string) => value),
}))
vi.mock('@/lib/identity-verification/orchestrator', () => ({
  applyVendorVerdict: mockApplyVendorVerdict,
}))
vi.mock('@/lib/identity-verification/vendors/didit/client', () => ({
  getSessionDecision: mockGetSessionDecision,
}))
vi.mock('@/lib/identity-verification/vendors/didit/persist', () => ({
  isPersistableStatus: (status: string) => ['PASSED', 'FAILED', 'NEEDS_MANUAL_REVIEW'].includes(status),
  persistDiditDecision: mockPersistDiditDecision,
}))
vi.mock('@/lib/security/security-event-service', () => ({
  raiseSecurityReviewEvent: mockRaiseSecurityReviewEvent,
}))

function request(body = '{}', headers: Record<string, string> = {}) {
  return new NextRequest('http://localhost/api/webhooks/verification/smile_id', {
    method: 'POST',
    headers,
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
    mockDb.providerVerificationEvent.create.mockResolvedValue({ id: 'persist-failed-event' })
    mockDb.providerIdentityVerification.findMany.mockResolvedValue([{ id: 'ver-1' }])
    mockDb.providerIdentityVerification.findUniqueOrThrow.mockResolvedValue({ id: 'ver-1' })
    mockApplyVendorVerdict.mockResolvedValue({ verificationId: 'ver-1', status: 'PASSED', vendorReference: 'job-1' })
    mockGetSessionDecision.mockResolvedValue({ session_id: 'job-1', status: 'Approved' })
    mockIsEnabled.mockResolvedValue(false)
    mockPersistDiditDecision.mockResolvedValue({
      verificationId: 'ver-1',
      fieldsStamped: true,
      payloadRedacted: true,
      documentsStored: [],
      documentsSkipped: [],
      documentsFailed: [],
    })
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

  it('does not log Didit test-webhook payload bodies when rejecting invalid signatures', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined)
    mockAdapter.parseWebhook.mockResolvedValue({
      signatureValid: false,
      vendorEventId: 'evt-didit-test',
      vendorReference: 'sess-didit-test',
      livenessSessionReference: null,
      eventType: 'status.updated',
      payloadHash: 'hash-didit-test',
      redactedPayload: { event: 'status.updated' },
      result: null,
    })
    const { POST } = await import('@/app/api/webhooks/verification/[vendor]/route')

    const response = await POST(
      request('{"session_id":"sess-didit-test","FullName":"Sensitive Person"}', {
        'x-didit-test-webhook': 'true',
      }),
      { params: Promise.resolve({ vendor: 'didit' }) },
    )

    expect(response.status).toBe(401)
    expect(logSpy).not.toHaveBeenCalledWith(
      'TEMP-DIDIT-DEBUG',
      expect.stringContaining('Sensitive Person'),
    )
    logSpy.mockRestore()
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

  it('links valid Didit entity webhooks by the vendor_data verification id', async () => {
    mockAdapter.parseWebhook.mockResolvedValue({
      signatureValid: true,
      vendorEventId: 'evt-user-status',
      vendorReference: null,
      livenessSessionReference: null,
      verificationId: 'ver-from-vendor-data',
      eventType: 'user.status.updated',
      payloadHash: 'hash-user-status',
      redactedPayload: { event: 'user.status.updated' },
      result: null,
    })
    mockDb.providerVerificationWebhookEvent.create.mockResolvedValue({ id: 'wh-user-status' })
    mockDb.providerIdentityVerification.findMany.mockResolvedValue([{ id: 'ver-from-vendor-data' }])
    mockDb.providerIdentityVerification.findUniqueOrThrow.mockResolvedValue({ id: 'ver-from-vendor-data' })
    const { POST } = await import('@/app/api/webhooks/verification/[vendor]/route')

    const response = await POST(request('{"event_id":"evt-user-status"}'), { params: Promise.resolve({ vendor: 'didit' }) })

    expect(response.status).toBe(200)
    expect(mockDb.providerIdentityVerification.findMany).toHaveBeenCalledWith({
      where: {
        sourceCheckProvider: 'didit',
        OR: [{ id: 'ver-from-vendor-data' }],
      },
      select: { id: true },
    })
    expect(mockDb.providerVerificationWebhookEvent.update).toHaveBeenCalledWith({
      where: { id: 'wh-user-status' },
      data: {
        verificationId: 'ver-from-vendor-data',
        processedAt: expect.any(Date),
      },
    })
    expect(mockApplyVendorVerdict).not.toHaveBeenCalled()
  })

  it('persists the full Didit decision after a terminal applied verdict when the flag is enabled', async () => {
    mockIsEnabled.mockResolvedValue(true)
    mockAdapter.parseWebhook.mockResolvedValue({
      signatureValid: true,
      vendorEventId: 'evt-didit-approved',
      vendorReference: 'sess-parsed',
      livenessSessionReference: 'sess-parsed',
      verificationId: null,
      eventType: 'status.updated',
      payloadHash: 'hash-didit-approved',
      redactedPayload: { event: 'status.updated' },
      result: { decision: 'PASS', confidence: 0.99, livenessVerified: true },
    })
    mockDb.providerVerificationWebhookEvent.create.mockResolvedValue({ id: 'wh-didit-approved' })
    mockDb.providerIdentityVerification.findMany.mockResolvedValue([{ id: 'ver-1' }])
    mockDb.providerIdentityVerification.findUniqueOrThrow.mockResolvedValue({ id: 'ver-1' })
    mockApplyVendorVerdict.mockResolvedValue({
      verificationId: 'ver-1',
      status: 'PASSED',
      vendorReference: 'didit-pre:placeholder',
    })
    const fullDecision = { session_id: 'sess-parsed', status: 'Approved' }
    mockGetSessionDecision.mockResolvedValue(fullDecision)
    const { POST } = await import('@/app/api/webhooks/verification/[vendor]/route')

    const response = await POST(request('{"event_id":"evt-didit-approved"}'), { params: Promise.resolve({ vendor: 'didit' }) })

    expect(response.status).toBe(200)
    expect(mockIsEnabled).toHaveBeenCalledWith('provider.identity.vendor.didit.persist_documents')
    expect(mockGetSessionDecision).toHaveBeenCalledWith('sess-parsed')
    expect(mockPersistDiditDecision).toHaveBeenCalledWith('ver-1', fullDecision, { source: 'webhook' })
  })

  it('does not fetch or persist Didit decisions when the persistence flag is disabled', async () => {
    mockIsEnabled.mockResolvedValue(false)
    mockAdapter.parseWebhook.mockResolvedValue({
      signatureValid: true,
      vendorEventId: 'evt-didit-disabled',
      vendorReference: 'sess-disabled',
      livenessSessionReference: 'sess-disabled',
      verificationId: null,
      eventType: 'status.updated',
      payloadHash: 'hash-didit-disabled',
      redactedPayload: { event: 'status.updated' },
      result: { decision: 'PASS', confidence: 0.99, livenessVerified: true },
    })
    const { POST } = await import('@/app/api/webhooks/verification/[vendor]/route')

    const response = await POST(request('{"event_id":"evt-didit-disabled"}'), { params: Promise.resolve({ vendor: 'didit' }) })

    expect(response.status).toBe(200)
    expect(mockGetSessionDecision).not.toHaveBeenCalled()
    expect(mockPersistDiditDecision).not.toHaveBeenCalled()
  })

  it('does not persist Didit decisions when the webhook result is null', async () => {
    mockIsEnabled.mockResolvedValue(true)
    mockAdapter.parseWebhook.mockResolvedValue({
      signatureValid: true,
      vendorEventId: 'evt-didit-progress',
      vendorReference: 'sess-progress',
      livenessSessionReference: 'sess-progress',
      verificationId: null,
      eventType: 'status.updated',
      payloadHash: 'hash-didit-progress',
      redactedPayload: { event: 'status.updated' },
      result: null,
    })
    const { POST } = await import('@/app/api/webhooks/verification/[vendor]/route')

    const response = await POST(request('{"event_id":"evt-didit-progress"}'), { params: Promise.resolve({ vendor: 'didit' }) })

    expect(response.status).toBe(200)
    expect(mockApplyVendorVerdict).not.toHaveBeenCalled()
    expect(mockGetSessionDecision).not.toHaveBeenCalled()
    expect(mockPersistDiditDecision).not.toHaveBeenCalled()
  })

  it('logs Didit persistence failures and still acknowledges the webhook', async () => {
    mockIsEnabled.mockResolvedValue(true)
    mockAdapter.parseWebhook.mockResolvedValue({
      signatureValid: true,
      vendorEventId: 'evt-didit-persist-fails',
      vendorReference: 'sess-fail',
      livenessSessionReference: 'sess-fail',
      verificationId: null,
      eventType: 'status.updated',
      payloadHash: 'hash-didit-persist-fails',
      redactedPayload: { event: 'status.updated' },
      result: { decision: 'PASS', confidence: 0.99, livenessVerified: true },
    })
    mockApplyVendorVerdict.mockResolvedValue({
      verificationId: 'ver-1',
      status: 'PASSED',
      vendorReference: 'sess-fail',
    })
    mockPersistDiditDecision.mockRejectedValue(new Error('persist failed'))
    const { POST } = await import('@/app/api/webhooks/verification/[vendor]/route')

    const response = await POST(request('{"event_id":"evt-didit-persist-fails"}'), { params: Promise.resolve({ vendor: 'didit' }) })

    expect(response.status).toBe(200)
    expect(mockDb.providerVerificationEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        verificationId: 'ver-1',
        fromStatus: 'PASSED',
        toStatus: 'PASSED',
        reasonCode: 'DIDIT_PERSIST_FAILED',
        metadata: expect.objectContaining({
          source: 'webhook',
          error: 'persist failed',
          vendorReference: 'sess-fail',
        }),
      }),
    })
    expect(mockDb.providerVerificationWebhookEvent.update).toHaveBeenCalledWith({
      where: { id: 'wh-1' },
      data: {
        verificationId: 'ver-1',
        processedAt: expect.any(Date),
      },
    })
  })
})
