/**
 * Tests draft-anchored completion logic added in Task 2.6 to the
 * verification webhook route. Extends the existing webhook test patterns.
 */
import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  afterCallbacks,
  mockAfter,
  mockAdapter,
  mockDb,
  mockApplyVendorVerdict,
  mockGetSessionDecision,
  mockIsEnabled,
  mockPersistDiditDecision,
  mockRaiseSecurityReviewEvent,
  mockCompleteApplication,
  mockRecordFailed,
  mockRecordManualReview,
} = vi.hoisted(() => ({
  afterCallbacks: [] as Array<() => void | Promise<void>>,
  mockAfter: vi.fn((callback: () => void | Promise<void>) => {
    afterCallbacks.push(callback)
  }),
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
  mockCompleteApplication: vi.fn(),
  mockRecordFailed: vi.fn(),
  mockRecordManualReview: vi.fn(),
}))

vi.mock('next/server', async (importOriginal) => {
  const original = await importOriginal<typeof import('next/server')>()
  return {
    ...original,
    after: mockAfter,
  }
})
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
vi.mock('@/lib/provider-onboarding/quality-gate-submission', () => ({
  completeApplicationForPassedVerification: mockCompleteApplication,
  recordFailedVerificationForApplication: mockRecordFailed,
  recordManualReviewForApplication: mockRecordManualReview,
}))

function request(body = '{}', headers: Record<string, string> = {}) {
  return new NextRequest('http://localhost/api/webhooks/verification/smile_id', {
    method: 'POST',
    headers,
    body,
  })
}

describe('verification webhook — draft-anchored completion (Task 2.6)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    afterCallbacks.splice(0)

    // Default: a valid PASSED webhook for a draft-anchored verification
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

    // Draft-anchored verification
    mockDb.providerIdentityVerification.findUniqueOrThrow.mockResolvedValue({
      id: 'ver-1',
      providerApplicationDraftId: 'draft-1',
      providerId: null,
    })

    mockApplyVendorVerdict.mockResolvedValue({ verificationId: 'ver-1', status: 'PASSED', vendorReference: 'job-1' })
    mockGetSessionDecision.mockResolvedValue({ session_id: 'job-1', status: 'Approved' })
    mockIsEnabled.mockResolvedValue(false)
    mockCompleteApplication.mockResolvedValue({ applicationId: 'app-1' })
    mockRecordFailed.mockResolvedValue(undefined)
    mockRecordManualReview.mockResolvedValue(undefined)
  })

  it('PASSED verdict for draft-anchored verification calls completeApplicationForPassedVerification', async () => {
    const { POST } = await import('@/app/api/webhooks/verification/[vendor]/route')

    const response = await POST(request('{"event_id":"evt-1"}'), {
      params: Promise.resolve({ vendor: 'smile_id' }),
    })

    expect(response.status).toBe(200)
    const json = await response.json()
    expect(json).toMatchObject({ ok: true })

    expect(mockCompleteApplication).toHaveBeenCalledWith(mockDb, { verificationId: 'ver-1' })
    expect(mockRecordFailed).not.toHaveBeenCalled()
  })

  it('FAILED verdict for draft-anchored verification calls recordFailedVerificationForApplication', async () => {
    mockApplyVendorVerdict.mockResolvedValue({ verificationId: 'ver-1', status: 'FAILED', vendorReference: 'job-1' })

    const { POST } = await import('@/app/api/webhooks/verification/[vendor]/route')

    const response = await POST(request('{"event_id":"evt-failed"}'), {
      params: Promise.resolve({ vendor: 'smile_id' }),
    })

    expect(response.status).toBe(200)
    expect(mockRecordFailed).toHaveBeenCalledWith(mockDb, { verificationId: 'ver-1' })
    expect(mockCompleteApplication).not.toHaveBeenCalled()
  })

  // Fix A: terminal-but-not-PASSED statuses must call recordManualReviewForApplication
  // so the applicant is never silently stranded with no application created.
  it.each([
    ['NEEDS_MANUAL_REVIEW', 'KYC needs manual review'],
    ['EXPIRED', 'KYC session expired'],
    ['CANCELLED', 'KYC session cancelled'],
  ] as const)(
    'Fix A: %s verdict for draft-anchored verification calls recordManualReviewForApplication with reason "%s"',
    async (status, expectedReason) => {
      mockApplyVendorVerdict.mockResolvedValue({ verificationId: 'ver-1', status, vendorReference: 'job-1' })

      const { POST } = await import('@/app/api/webhooks/verification/[vendor]/route')

      const response = await POST(request(`{"event_id":"evt-${status}"}`), {
        params: Promise.resolve({ vendor: 'smile_id' }),
      })

      expect(response.status).toBe(200)
      // Fix 1: the actual verdict is forwarded so the created provider's kycStatus
      // mapping (EXPIRED → EXPIRED; NEEDS_MANUAL_REVIEW/CANCELLED untouched) applies.
      expect(mockRecordManualReview).toHaveBeenCalledWith(mockDb, {
        verificationId: 'ver-1',
        reason: expectedReason,
        verdict: status,
      })
      expect(mockCompleteApplication).not.toHaveBeenCalled()
      expect(mockRecordFailed).not.toHaveBeenCalled()
    },
  )

  // Fix 2: manual-review redelivery idempotency. When the verification is already
  // in NEEDS_MANUAL_REVIEW and the vendor redelivers a manual-review-producing
  // verdict, applyVendorVerdict must be SKIPPED (a same-status transition would
  // throw → 500 loop) and the draft-anchored completion must still run.
  it('Fix 2: redelivery with verification already NEEDS_MANUAL_REVIEW skips applyVendorVerdict and completes (no 500 loop)', async () => {
    mockAdapter.parseWebhook.mockResolvedValue({
      signatureValid: true,
      vendorEventId: 'evt-redeliver',
      vendorReference: 'job-1',
      livenessSessionReference: null,
      eventType: 'verification.completed',
      payloadHash: 'hash-redeliver',
      redactedPayload: { event: 'ok' },
      result: { decision: 'INCONCLUSIVE', confidence: 0.4, livenessVerified: null },
    })
    // Verification already sitting in NEEDS_MANUAL_REVIEW from the first delivery.
    mockDb.providerIdentityVerification.findUniqueOrThrow.mockResolvedValue({
      id: 'ver-1',
      providerApplicationDraftId: 'draft-1',
      providerId: null,
      status: 'NEEDS_MANUAL_REVIEW',
      sourceCheckProvider: 'smile_id',
      vendorReference: 'job-1',
      livenessSessionExpiresAt: null,
    })

    const { POST } = await import('@/app/api/webhooks/verification/[vendor]/route')

    const response = await POST(request('{"event_id":"evt-redeliver"}'), {
      params: Promise.resolve({ vendor: 'smile_id' }),
    })

    expect(response.status).toBe(200)
    // applyVendorVerdict must NOT be invoked on the redelivery.
    expect(mockApplyVendorVerdict).not.toHaveBeenCalled()
    // Completion still runs with the current (manual-review) status.
    expect(mockRecordManualReview).toHaveBeenCalledWith(mockDb, {
      verificationId: 'ver-1',
      reason: 'KYC needs manual review',
      verdict: 'NEEDS_MANUAL_REVIEW',
    })
    // processedAt IS set (no retryable 500).
    const updateCalls = mockDb.providerVerificationWebhookEvent.update.mock.calls
    const hasProcessedAt = updateCalls.some(
      (call: unknown[]) =>
        (call[0] as { data?: { processedAt?: unknown } }).data?.processedAt instanceof Date,
    )
    expect(hasProcessedAt).toBe(true)
  })

  it('Fix 2: FAILED redelivery (already terminal) is handled by applyVendorVerdict idempotently — not skipped by the route guard', async () => {
    // A FAILED decision arriving while already NEEDS_MANUAL_REVIEW is NOT the
    // skip case (FAIL can transition out of manual review), so applyVendorVerdict
    // still runs and is idempotent there.
    mockAdapter.parseWebhook.mockResolvedValue({
      signatureValid: true,
      vendorEventId: 'evt-fail-redeliver',
      vendorReference: 'job-1',
      livenessSessionReference: null,
      eventType: 'verification.completed',
      payloadHash: 'hash-fail-redeliver',
      redactedPayload: { event: 'ok' },
      result: { decision: 'FAIL', confidence: 0.1, livenessVerified: null },
    })
    mockDb.providerIdentityVerification.findUniqueOrThrow.mockResolvedValue({
      id: 'ver-1',
      providerApplicationDraftId: 'draft-1',
      providerId: null,
      status: 'NEEDS_MANUAL_REVIEW',
      sourceCheckProvider: 'smile_id',
      vendorReference: 'job-1',
      livenessSessionExpiresAt: null,
    })
    mockApplyVendorVerdict.mockResolvedValue({ verificationId: 'ver-1', status: 'FAILED', vendorReference: 'job-1' })

    const { POST } = await import('@/app/api/webhooks/verification/[vendor]/route')

    const response = await POST(request('{"event_id":"evt-fail-redeliver"}'), {
      params: Promise.resolve({ vendor: 'smile_id' }),
    })

    expect(response.status).toBe(200)
    expect(mockApplyVendorVerdict).toHaveBeenCalledOnce()
    expect(mockRecordFailed).toHaveBeenCalledWith(mockDb, { verificationId: 'ver-1' })
  })

  it('PASSED verdict for non-draft verification (providerApplicationDraftId null): does NOT call completeApplicationForPassedVerification', async () => {
    // Non-draft verification (existing provider-centric flow)
    mockDb.providerIdentityVerification.findUniqueOrThrow.mockResolvedValue({
      id: 'ver-provider',
      providerApplicationDraftId: null,
      providerId: 'provider-existing',
    })

    const { POST } = await import('@/app/api/webhooks/verification/[vendor]/route')

    const response = await POST(request('{"event_id":"evt-provider"}'), {
      params: Promise.resolve({ vendor: 'smile_id' }),
    })

    expect(response.status).toBe(200)
    expect(mockCompleteApplication).not.toHaveBeenCalled()
    expect(mockRecordFailed).not.toHaveBeenCalled()
  })

  it('completion function throws: returns 500, records processingError, does NOT set processedAt (retryable)', async () => {
    mockCompleteApplication.mockRejectedValue(new Error('replay failed'))

    const { POST } = await import('@/app/api/webhooks/verification/[vendor]/route')

    const response = await POST(request('{"event_id":"evt-error"}'), {
      params: Promise.resolve({ vendor: 'smile_id' }),
    })

    // Must return 500 so the vendor retries delivery
    expect(response.status).toBe(500)
    const json = await response.json()
    expect(json).toMatchObject({ ok: false })

    // processingError recorded on the webhook event
    expect(mockDb.providerVerificationWebhookEvent.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'wh-1' },
        data: expect.objectContaining({
          processingError: 'replay failed',
        }),
      }),
    )

    // processedAt must NOT be set — the event must remain retryable
    const updateCalls = mockDb.providerVerificationWebhookEvent.update.mock.calls
    const hasProcessedAt = updateCalls.some(
      (call: unknown[]) =>
        (call[0] as { data?: { processedAt?: unknown } }).data?.processedAt instanceof Date,
    )
    expect(hasProcessedAt).toBe(false)
  })

  it('completion failure then retry: retry does not short-circuit (processedAt is null), re-runs completion on success', async () => {
    // First call: completion throws → processedAt not set
    mockCompleteApplication.mockRejectedValueOnce(new Error('transient error'))

    const { POST } = await import('@/app/api/webhooks/verification/[vendor]/route')

    const firstResponse = await POST(request('{"event_id":"evt-retry"}'), {
      params: Promise.resolve({ vendor: 'smile_id' }),
    })
    expect(firstResponse.status).toBe(500)

    // Retry: duplicate-webhook path finds the existing row with processedAt: null
    // → falls through to re-run completion (does NOT short-circuit with ok: true)
    mockDb.providerVerificationWebhookEvent.create.mockRejectedValueOnce(
      Object.assign(new Error('Unique constraint'), { code: 'P2002' }),
    )
    mockDb.providerVerificationWebhookEvent.findUnique.mockResolvedValueOnce({
      id: 'wh-1',
      signatureValid: true,
      processedAt: null, // not yet processed — must fall through
    })
    // On retry completion succeeds
    mockCompleteApplication.mockResolvedValueOnce({ applicationId: 'app-1' })

    const retryResponse = await POST(request('{"event_id":"evt-retry"}'), {
      params: Promise.resolve({ vendor: 'smile_id' }),
    })

    // Retry must succeed and call completion again
    expect(retryResponse.status).toBe(200)
    expect(mockCompleteApplication).toHaveBeenCalledTimes(2)

    // On success, processedAt IS set
    const updateCalls = mockDb.providerVerificationWebhookEvent.update.mock.calls
    const hasProcessedAt = updateCalls.some(
      (call: unknown[]) =>
        (call[0] as { data?: { processedAt?: unknown } }).data?.processedAt instanceof Date,
    )
    expect(hasProcessedAt).toBe(true)
  })
})
