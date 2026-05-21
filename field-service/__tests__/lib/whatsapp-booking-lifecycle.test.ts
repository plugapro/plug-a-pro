// field-service/__tests__/lib/whatsapp-booking-lifecycle.test.ts
//
// Asserts that WhatsApp notifications are wired to key booking lifecycle events.
//
// These are integration-level checks: we verify the send FUNCTION IS CALLED
// with the right arguments, not that the message was actually delivered.
//
// For real delivery verification: use the Meta WhatsApp Business sandbox.
// See: GAP-19 manual verification steps in the pre-launch QA checklist.

import { beforeEach, describe, expect, it, vi } from 'vitest'

// ─── Hoist mocks so they are available inside vi.mock factories ───────────────

const {
  mockSendProviderOnTheWay,
  mockSendJobCompleted,
  mockSendProviderArrived,
  mockSendText,
  mockSendCtaUrl,
  mockJob,
} = vi.hoisted(() => {
  const customerPhone = '+27821234567'
  const job = {
    id: 'job_1',
    bookingId: 'booking_1',
    providerId: 'provider_1',
    status: 'SCHEDULED' as const,
    arrivedAt: null,
    startedAt: null,
    completedAt: null,
    failureReason: null,
    booking: {
      matchId: 'match_1',
      status: 'CONFIRMED',
      match: {
        jobRequest: {
          id: 'request_1',
          category: 'Plumbing',
          customer: { id: 'customer_1', name: 'Alice Smith', phone: customerPhone },
          address: { street: '1 Main St', suburb: 'Sandton', city: 'Johannesburg' },
        },
      },
    },
    provider: { name: 'Bob Jones' },
  }
  return {
    mockSendProviderOnTheWay: vi.fn().mockResolvedValue(undefined),
    mockSendJobCompleted: vi.fn().mockResolvedValue(undefined),
    mockSendProviderArrived: vi.fn().mockResolvedValue(undefined),
    mockSendText: vi.fn().mockResolvedValue(undefined),
    mockSendCtaUrl: vi.fn().mockResolvedValue(undefined),
    mockJob: job,
  }
})

// ─── Shared customer fixture ──────────────────────────────────────────────────

const CUSTOMER_PHONE = '+27821234567'

// ─── Mock WhatsApp send modules ───────────────────────────────────────────────

vi.mock('@/lib/whatsapp', () => ({
  sendProviderOnTheWay: mockSendProviderOnTheWay,
  sendJobCompleted: mockSendJobCompleted,
  sendProviderArrived: mockSendProviderArrived,
  sendText: mockSendText,
}))

vi.mock('@/lib/whatsapp-interactive', () => ({
  sendCtaUrl: mockSendCtaUrl,
  sendButtons: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('@/lib/whatsapp-copy', () => ({
  ctaLabelFor: vi.fn().mockReturnValue('View details'),
  assertNoRawUrlsInWhatsAppBody: vi.fn(),
}))

// ─── Mock DB ──────────────────────────────────────────────────────────────────

vi.mock('@/lib/db', () => ({
  db: {
    job: {
      findUnique: vi.fn().mockResolvedValue(mockJob),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
    jobStatusEvent: {
      create: vi.fn().mockResolvedValue({}),
    },
    auditLog: {
      create: vi.fn().mockResolvedValue({}),
    },
    booking: {
      update: vi.fn().mockResolvedValue({}),
    },
    $transaction: vi.fn().mockImplementation(async (fn) =>
      fn({
        job: {
          updateMany: vi.fn().mockResolvedValue({ count: 1 }),
        },
        jobStatusEvent: { create: vi.fn().mockResolvedValue({}) },
        auditLog: { create: vi.fn().mockResolvedValue({}) },
        booking: { update: vi.fn().mockResolvedValue({}) },
      })
    ),
  },
}))

// ─── Mock supporting libs ─────────────────────────────────────────────────────

vi.mock('@/lib/audit', () => ({
  recordAuditLog: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('@/lib/job-request-access', () => ({
  getJobRequestAccessUrl: vi.fn().mockResolvedValue('https://app.plugapro.co.za/requests/access/abc'),
}))

vi.mock('@/lib/job-completion-access', () => ({
  getJobCompletionUrl: vi.fn().mockReturnValue('https://app.plugapro.co.za/jobs/job_1/complete/token'),
}))

vi.mock('@/lib/provider-credit-copy', () => ({
  getPublicAppUrl: vi.fn().mockReturnValue('https://app.plugapro.co.za'),
}))

vi.mock('@/lib/cases', () => ({
  openCase: vi.fn().mockResolvedValue(undefined),
}))

// ─── Import after all mocks ───────────────────────────────────────────────────

import { transitionJob } from '@/lib/jobs'
import { db } from '@/lib/db'

// ─── Helpers ──────────────────────────────────────────────────────────────────

function mockJobWithStatus(status: string) {
  return { ...mockJob, status: status as typeof mockJob.status }
}

// ─── Tests: job lifecycle → WhatsApp notification wiring ─────────────────────

describe('WhatsApp booking lifecycle notifications — wiring assertions (GAP-19)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('EN_ROUTE transition', () => {
    it('calls sendProviderOnTheWay with the customer phone number', async () => {
      ;(db.job.findUnique as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
        mockJobWithStatus('SCHEDULED')
      )

      await transitionJob({
        jobId: 'job_1',
        toStatus: 'EN_ROUTE',
        actorId: 'provider_1',
        actorRole: 'provider',
      })

      expect(mockSendProviderOnTheWay).toHaveBeenCalledOnce()
      expect(mockSendProviderOnTheWay).toHaveBeenCalledWith(
        expect.objectContaining({ customerPhone: CUSTOMER_PHONE })
      )
    })

    it('includes the provider name in the EN_ROUTE notification', async () => {
      ;(db.job.findUnique as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
        mockJobWithStatus('SCHEDULED')
      )

      await transitionJob({
        jobId: 'job_1',
        toStatus: 'EN_ROUTE',
        actorId: 'provider_1',
        actorRole: 'provider',
      })

      expect(mockSendProviderOnTheWay).toHaveBeenCalledWith(
        expect.objectContaining({ providerName: 'Bob Jones' })
      )
    })
  })

  describe('STARTED transition', () => {
    it('sends a work-started WhatsApp to the customer phone number', async () => {
      ;(db.job.findUnique as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
        mockJobWithStatus('ARRIVED')
      )

      await transitionJob({
        jobId: 'job_1',
        toStatus: 'STARTED',
        actorId: 'provider_1',
        actorRole: 'provider',
      })

      expect(mockSendText).toHaveBeenCalled()
      const textCall = mockSendText.mock.calls.find(
        (c: unknown[]) => typeof c[0] === 'object' && (c[0] as { to?: string }).to === CUSTOMER_PHONE
      )
      expect(textCall).toBeDefined()
      const payload = textCall![0] as { to: string; text: string; templateName: string }
      expect(payload.to).toBe(CUSTOMER_PHONE)
      expect(payload.text).toContain('Work has started')
      expect(payload.templateName).toBe('freeform:job_started')
    })
  })

  describe('PENDING_COMPLETION_CONFIRMATION transition', () => {
    it('sends a sign-off request WhatsApp to the customer phone number', async () => {
      ;(db.job.findUnique as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
        mockJobWithStatus('STARTED')
      )

      await transitionJob({
        jobId: 'job_1',
        toStatus: 'PENDING_COMPLETION_CONFIRMATION',
        actorId: 'provider_1',
        actorRole: 'provider',
      })

      expect(mockSendText).toHaveBeenCalled()
      const textCall = mockSendText.mock.calls.find(
        (c: unknown[]) => typeof c[0] === 'object' && (c[0] as { to?: string }).to === CUSTOMER_PHONE
      )
      expect(textCall).toBeDefined()
      const payload = textCall![0] as { to: string; text: string; templateName: string }
      expect(payload.to).toBe(CUSTOMER_PHONE)
      expect(payload.text).toContain('sign-off')
      expect(payload.templateName).toBe('freeform:completion_confirmation_request')
    })
  })

  describe('COMPLETED transition', () => {
    it('calls sendJobCompleted with the customer phone number', async () => {
      ;(db.job.findUnique as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
        mockJobWithStatus('PENDING_COMPLETION_CONFIRMATION')
      )

      await transitionJob({
        jobId: 'job_1',
        toStatus: 'COMPLETED',
        actorId: 'provider_1',
        actorRole: 'provider',
      })

      expect(mockSendJobCompleted).toHaveBeenCalledOnce()
      expect(mockSendJobCompleted).toHaveBeenCalledWith(
        expect.objectContaining({ customerPhone: CUSTOMER_PHONE })
      )
    })

    it('does NOT call sendProviderOnTheWay on COMPLETED transition', async () => {
      ;(db.job.findUnique as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
        mockJobWithStatus('PENDING_COMPLETION_CONFIRMATION')
      )

      await transitionJob({
        jobId: 'job_1',
        toStatus: 'COMPLETED',
        actorId: 'provider_1',
        actorRole: 'provider',
      })

      expect(mockSendProviderOnTheWay).not.toHaveBeenCalled()
    })
  })

  describe('no booking — no notification', () => {
    it('does not call any WhatsApp send when booking is null', async () => {
      ;(db.job.findUnique as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        ...mockJobWithStatus('SCHEDULED'),
        booking: null,
      })

      await transitionJob({
        jobId: 'job_1',
        toStatus: 'EN_ROUTE',
        actorId: 'provider_1',
        actorRole: 'provider',
      })

      expect(mockSendProviderOnTheWay).not.toHaveBeenCalled()
      expect(mockSendText).not.toHaveBeenCalled()
      expect(mockSendJobCompleted).not.toHaveBeenCalled()
    })
  })
})

// ─── Tests: notifyCustomerReviewRequested (post-job review request path) ──────

describe('notifyCustomerReviewRequested — WhatsApp wiring', () => {
  beforeEach(() => {
    vi.resetAllMocks()
  })

  it('calls sendText with the customer phone number on job completion review request', async () => {
    mockSendText.mockResolvedValue('wamid-review')

    const { notifyCustomerReviewRequested } = await import(
      '../../lib/client-pwa-submission-notifications'
    )

    const result = await notifyCustomerReviewRequested({
      customerPhone: CUSTOMER_PHONE,
      category: 'Plumbing',
      providerName: 'Bob Jones',
      requestId: 'request_1',
      reviewUrl: 'https://app.plugapro.co.za/review/token',
    })

    expect(result).toEqual({ sent: true })
    expect(mockSendText).toHaveBeenCalledOnce()
    const call = mockSendText.mock.calls[0][0] as { to: string; text: string; templateName: string }
    expect(call.to).toBe(CUSTOMER_PHONE)
    expect(call.templateName).toBe('interactive:client_review_requested')
    expect(call.text).toContain('Your Plumbing job is complete')
    expect(call.text).toContain('Bob Jones')
  })

  it('skips send when isAlreadySent is true (idempotency guard)', async () => {
    const { notifyCustomerReviewRequested } = await import(
      '../../lib/client-pwa-submission-notifications'
    )

    const result = await notifyCustomerReviewRequested({
      customerPhone: CUSTOMER_PHONE,
      category: 'Plumbing',
      providerName: 'Bob Jones',
      requestId: 'request_1',
      reviewUrl: null,
      isAlreadySent: true,
    })

    expect(result).toEqual({ sent: false, reason: 'already_sent' })
    expect(mockSendText).not.toHaveBeenCalled()
  })

  it('returns sent:false without throwing when customerPhone is null', async () => {
    const { notifyCustomerReviewRequested } = await import(
      '../../lib/client-pwa-submission-notifications'
    )

    const result = await notifyCustomerReviewRequested({
      customerPhone: null,
      category: 'Plumbing',
      providerName: 'Bob Jones',
      requestId: 'request_1',
      reviewUrl: null,
    })

    expect(result).toEqual({ sent: false, reason: 'no_customer_phone' })
    expect(mockSendText).not.toHaveBeenCalled()
  })
})

// ─── Tests: notifyCustomerPaymentFailed ───────────────────────────────────────

describe('notifyCustomerPaymentFailed — WhatsApp wiring', () => {
  beforeEach(() => {
    vi.resetAllMocks()
  })

  it('calls sendText with the customer phone number on payment failure', async () => {
    mockSendText.mockResolvedValue('wamid-payment-failed')

    const { notifyCustomerPaymentFailed } = await import(
      '../../lib/client-pwa-submission-notifications'
    )

    const result = await notifyCustomerPaymentFailed({
      customerPhone: CUSTOMER_PHONE,
      category: 'Plumbing',
      bookingRef: 'BK-0001',
    })

    expect(result).toEqual({ sent: true })
    expect(mockSendText).toHaveBeenCalledOnce()
    const call = mockSendText.mock.calls[0][0] as { to: string; text: string; templateName: string; metadata: { bookingRef: string } }
    expect(call.to).toBe(CUSTOMER_PHONE)
    expect(call.templateName).toBe('interactive:client_payment_failed')
    expect(call.text).toContain('BK-0001')
    expect(call.metadata).toEqual({ bookingRef: 'BK-0001' })
  })

  it('returns sent:false without throwing when WhatsApp API fails', async () => {
    mockSendText.mockRejectedValue(new Error('WhatsApp API timeout'))

    const { notifyCustomerPaymentFailed } = await import(
      '../../lib/client-pwa-submission-notifications'
    )

    const result = await notifyCustomerPaymentFailed({
      customerPhone: CUSTOMER_PHONE,
      category: 'Electrical',
      bookingRef: 'BK-0002',
    })

    expect(result.sent).toBe(false)
    expect(result.reason).toContain('WhatsApp API timeout')
  })
})
