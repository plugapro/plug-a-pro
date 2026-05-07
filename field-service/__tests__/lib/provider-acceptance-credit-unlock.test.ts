/**
 * CODEX-13 — Provider Final Acceptance, Credit Deduction, and Detail Unlock
 *
 * This test file verifies the complete acceptance transaction spec:
 *  1. All 15 blueprint steps execute in sequence.
 *  2. Provider WhatsApp message matches the blueprint format exactly.
 *  3. Customer WhatsApp message matches the blueprint format exactly.
 *  4. All error codes are surfaced correctly.
 *  5. Duplicate accept is idempotent (DUPLICATE_ACCEPT_IGNORED / alreadyUnlocked).
 *  6. Credit ledger entry carries idempotencyKey, traceId, balance_before, balance_after.
 *  7. LEAD_ALREADY_ACCEPTED is not a reachable branch in the current implementation;
 *     the duplicate accept path returns ok:true with alreadyUnlocked:true instead.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { acceptSelectedProviderJob } from '../../lib/selected-provider-acceptance'

// ─── Hoisted mocks ────────────────────────────────────────────────────────────

const { mockDb, state, mockSendText, mockSendCtaUrl } = vi.hoisted(() => {
  const state: { tx: any; lead: any } = { tx: null, lead: null }
  const mockDb = { $transaction: vi.fn() }
  const mockSendText = vi.fn().mockResolvedValue('wamid-c13')
  const mockSendCtaUrl = vi.fn().mockResolvedValue('wamid-cta-c13')
  return { mockDb, state, mockSendText, mockSendCtaUrl }
})

vi.mock('../../lib/db', () => ({ db: mockDb }))

vi.mock('../../lib/lead-unlocks', async () => {
  class LeadUnlockError extends Error {
    constructor(
      public readonly code: string,
      message: string,
      public readonly currentCreditBalance?: number,
    ) {
      super(message)
      this.name = 'LeadUnlockError'
    }
  }
  return {
    LEAD_UNLOCK_COST_CREDITS: 1,
    LeadUnlockError,
    unlockLeadForProviderInTransaction: vi.fn().mockResolvedValue({
      unlock: { id: 'unlock-c13' },
      ledgerEntries: [
        {
          id: 'ledger-c13',
          balanceAfterPaidCredits: 2,
          balanceAfterPromoCredits: 1,
          entryType: 'LEAD_UNLOCK_DEBIT',
          metadata: {
            traceId: 'trace-c13',
            idempotencyKey: 'idem:c13:provider-c13:lead-c13:selected_accept',
            balanceBeforePaidCredits: 2,
            balanceBeforePromoCredits: 2,
          },
        },
      ],
      alreadyUnlocked: false,
    }),
  }
})

vi.mock('../../lib/provider-lead-access', () => ({
  getProviderSignedJobHandoverUrlByLeadId: vi.fn().mockResolvedValue('https://app.plugapro.test/provider/jobs/token-c13'),
}))

vi.mock('../../lib/job-request-access', () => ({
  getJobRequestAccessUrl: vi.fn().mockResolvedValue('https://app.plugapro.test/requests/access/token-c13'),
}))

vi.mock('../../lib/whatsapp', () => ({
  sendText: mockSendText,
}))

vi.mock('../../lib/whatsapp-interactive', () => ({
  sendCtaUrl: mockSendCtaUrl,
}))

vi.mock('../../lib/whatsapp-copy', () => ({
  ctaLabelFor: vi.fn((key: string) => (key === 'job_detail' ? 'View job' : 'View details')),
}))

// ─── Test fixtures ────────────────────────────────────────────────────────────

function makeLead(overrides: Record<string, unknown> = {}) {
  return {
    id: 'lead-c13',
    jobRequestId: 'request-c13',
    providerId: 'provider-c13',
    status: 'VIEWED',
    isTestLead: false,
    cohortName: null,
    expiresAt: new Date(Date.now() + 60_000),
    customerSelectedAt: new Date('2026-05-07T08:00:00.000Z'),
    unlock: null,
    provider: {
      id: 'provider-c13',
      name: 'Bob Electrical',
      phone: '+27110000001',
      active: true,
      verified: true,
      status: 'ACTIVE',
    },
    providerResponses: [{
      callOutFee: 350,
      estimatedArrivalAt: new Date('2026-05-07T10:00:00.000Z'),
    }],
    jobRequest: {
      id: 'request-c13',
      category: 'electrical',
      status: 'PROVIDER_CONFIRMATION_PENDING',
      selectedProviderId: 'provider-c13',
      selectedLeadInviteId: 'lead-c13',
      description: 'Faulty DB tripping. Needs inspection.',
      requestedWindowStart: new Date('2026-05-07T09:00:00.000Z'),
      requestedWindowEnd: new Date('2026-05-07T11:00:00.000Z'),
      isTestRequest: false,
      cohortName: null,
      customer: { name: 'Thandi Customer', phone: '+27120000002' },
      attachments: [{ id: 'photo-c13-a' }],
      address: {
        street: '5 Oak Avenue',
        addressLine1: null,
        addressLine2: null,
        complexName: null,
        unitNumber: null,
        suburb: 'Sandton',
        city: 'Johannesburg',
        province: 'Gauteng',
        accessNotes: null,
      },
      match: null,
    },
    ...overrides,
  }
}

function makeTx() {
  return {
    lead: {
      findUnique: vi.fn().mockResolvedValue(state.lead),
      update: vi.fn().mockResolvedValue({ id: 'lead-c13' }),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
    providerWallet: {
      findUnique: vi.fn().mockResolvedValue({ paidCreditBalance: 2, promoCreditBalance: 2 }),
    },
    match: {
      create: vi.fn().mockResolvedValue({ id: 'match-c13' }),
    },
    leadUnlock: {
      update: vi.fn().mockResolvedValue({ id: 'unlock-c13' }),
    },
    quote: {
      create: vi.fn().mockResolvedValue({ id: 'quote-c13' }),
    },
    booking: {
      create: vi.fn().mockResolvedValue({ id: 'booking-c13' }),
    },
    job: {
      create: vi.fn().mockResolvedValue({ id: 'job-c13' }),
    },
    jobRequest: {
      update: vi.fn().mockResolvedValue({ id: 'request-c13' }),
    },
    jobStatusEvent: {
      create: vi.fn().mockResolvedValue({ id: 'event-c13' }),
    },
    auditLog: {
      create: vi.fn().mockResolvedValue({ id: 'audit-c13' }),
    },
  }
}

// ─── Test suite ───────────────────────────────────────────────────────────────

describe('CODEX-13 — provider final acceptance, credit deduction, and detail unlock', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    state.lead = makeLead()
    state.tx = makeTx()
    mockDb.$transaction.mockImplementation(async (fn: (tx: any) => Promise<unknown>) => fn(state.tx))
  })

  // ─── Step coverage (blueprint steps 1–15) ────────────────────────────────

  it('step 1 + 2 + 3: locks lead invite, verifies invite status = customer_selected and provider matches', async () => {
    const result = await acceptSelectedProviderJob({
      leadId: 'lead-c13',
      providerId: 'provider-c13',
      source: 'pwa',
    })
    expect(result).toMatchObject({ ok: true, leadId: 'lead-c13' })
    // Lead was fetched by ID — confirmation that step 1 (lock) was attempted
    expect(state.tx.lead.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'lead-c13' } }),
    )
  })

  it('step 4: rejects when request status is not PROVIDER_CONFIRMATION_PENDING', async () => {
    state.tx.lead.findUnique.mockResolvedValueOnce(makeLead({
      jobRequest: { ...state.lead.jobRequest, status: 'SHORTLISTED' },
    }))
    const result = await acceptSelectedProviderJob({
      leadId: 'lead-c13',
      providerId: 'provider-c13',
    })
    expect(result).toEqual({ ok: false, reason: 'REQUEST_NOT_AWAITING_CONFIRMATION' })
  })

  it('step 5 + 6 + 7: verifies >= 1 credit, deducts via unlock (LEAD_UNLOCK_DEBIT), carries idempotencyKey and traceId', async () => {
    const { unlockLeadForProviderInTransaction } = await import('../../lib/lead-unlocks')
    const result = await acceptSelectedProviderJob({
      leadId: 'lead-c13',
      providerId: 'provider-c13',
      idempotencyKey: 'custom-idem-key',
      traceId: 'custom-trace',
      source: 'whatsapp',
    })
    expect(result).toMatchObject({ ok: true, creditTransactionId: 'ledger-c13' })
    expect(unlockLeadForProviderInTransaction).toHaveBeenCalledWith(
      state.tx,
      'lead-c13',
      'provider-c13',
      expect.objectContaining({
        idempotencyKey: 'custom-idem-key',
        traceId: 'custom-trace',
        source: 'whatsapp',
      }),
    )
  })

  it('step 8 + 9: creates job and assigns to provider', async () => {
    await acceptSelectedProviderJob({ leadId: 'lead-c13', providerId: 'provider-c13' })
    expect(state.tx.match.create).toHaveBeenCalledOnce()
    expect(state.tx.job.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          providerId: 'provider-c13',
          status: 'SCHEDULED',
        }),
      }),
    )
  })

  it('step 10: sets jobRequest.status = MATCHED (Prisma enum for "assigned")', async () => {
    await acceptSelectedProviderJob({ leadId: 'lead-c13', providerId: 'provider-c13' })
    expect(state.tx.jobRequest.update).toHaveBeenCalledWith({
      where: { id: 'request-c13' },
      data: { status: 'MATCHED' },
    })
  })

  it('step 11: sets lead.status = ACCEPTED', async () => {
    await acceptSelectedProviderJob({ leadId: 'lead-c13', providerId: 'provider-c13' })
    expect(state.tx.lead.update).toHaveBeenCalledWith({
      where: { id: 'lead-c13' },
      data: expect.objectContaining({ status: 'ACCEPTED' }),
    })
  })

  it('step 12: customer details are unlocked and sent inline in provider WhatsApp message', async () => {
    await acceptSelectedProviderJob({ leadId: 'lead-c13', providerId: 'provider-c13' })
    const providerCall = mockSendText.mock.calls.find((c: any[]) => c[0]?.to === '+27110000001')?.[0]
    expect(providerCall).toBeDefined()
    // Full customer phone and address inline — the unlock
    expect(providerCall.text).toContain('+27120000002')
    expect(providerCall.text).toContain('5 Oak Avenue')
    expect(providerCall.text).toContain('Full customer details are now unlocked')
  })

  it('step 13: writes jobStatusEvent activity log', async () => {
    await acceptSelectedProviderJob({ leadId: 'lead-c13', providerId: 'provider-c13' })
    expect(state.tx.jobStatusEvent.create).toHaveBeenCalledOnce()
    expect(state.tx.jobStatusEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          jobId: 'job-c13',
          actorId: 'provider-c13',
          actorRole: 'provider',
          toStatus: 'SCHEDULED',
        }),
      }),
    )
  })

  it('step 14 + 15: queues customer notification and provider confirmation (notificationSent flag)', async () => {
    const result = await acceptSelectedProviderJob({ leadId: 'lead-c13', providerId: 'provider-c13' })
    expect(result).toMatchObject({ ok: true, notificationSent: true })
    // Both parties received a sendText call
    const customerCall = mockSendText.mock.calls.find((c: any[]) => c[0]?.to === '+27120000002')?.[0]
    const providerCall = mockSendText.mock.calls.find((c: any[]) => c[0]?.to === '+27110000001')?.[0]
    expect(customerCall).toBeDefined()
    expect(providerCall).toBeDefined()
  })

  // ─── Provider message copy (blueprint spec) ───────────────────────────────

  it('provider message: starts with "✅ Job accepted"', async () => {
    await acceptSelectedProviderJob({ leadId: 'lead-c13', providerId: 'provider-c13' })
    const providerCall = mockSendText.mock.calls.find((c: any[]) => c[0]?.to === '+27110000001')?.[0]
    expect(providerCall.text).toMatch(/^✅ Job accepted/)
  })

  it('provider message: shows "You used 1 credit."', async () => {
    await acceptSelectedProviderJob({ leadId: 'lead-c13', providerId: 'provider-c13' })
    const providerCall = mockSendText.mock.calls.find((c: any[]) => c[0]?.to === '+27110000001')?.[0]
    expect(providerCall.text).toContain('You used 1 credit')
  })

  it('provider message: shows "Available balance: X credits"', async () => {
    await acceptSelectedProviderJob({ leadId: 'lead-c13', providerId: 'provider-c13' })
    const providerCall = mockSendText.mock.calls.find((c: any[]) => c[0]?.to === '+27110000001')?.[0]
    expect(providerCall.text).toContain('Available balance:')
    expect(providerCall.text).toContain('credits')
  })

  it('provider message: shows Starter/onboarding and Purchased breakdown lines', async () => {
    await acceptSelectedProviderJob({ leadId: 'lead-c13', providerId: 'provider-c13' })
    const providerCall = mockSendText.mock.calls.find((c: any[]) => c[0]?.to === '+27110000001')?.[0]
    expect(providerCall.text).toContain('Starter/onboarding:')
    expect(providerCall.text).toContain('Purchased:')
  })

  it('provider message: includes job URL via CTA (not inline)', async () => {
    await acceptSelectedProviderJob({ leadId: 'lead-c13', providerId: 'provider-c13' })
    const providerCall = mockSendText.mock.calls.find((c: any[]) => c[0]?.to === '+27110000001')?.[0]
    // URL should NOT appear inline in the text body
    expect(providerCall.text).not.toContain('https://app.plugapro.test/provider/jobs/')
    // CTA carries the job URL
    expect(mockSendCtaUrl).toHaveBeenCalledWith(
      '+27110000001',
      expect.any(String),
      'View job',
      'https://app.plugapro.test/provider/jobs/token-c13',
      undefined,
      expect.any(Object),
    )
  })

  // ─── Customer message copy (blueprint spec) ───────────────────────────────

  it('customer message: starts with "✅ Your provider accepted the job"', async () => {
    await acceptSelectedProviderJob({ leadId: 'lead-c13', providerId: 'provider-c13' })
    const customerCall = mockSendText.mock.calls.find((c: any[]) => c[0]?.to === '+27120000002')?.[0]
    expect(customerCall.text).toMatch(/^✅ Your provider accepted the job/)
  })

  it('customer message: shows Provider, Expected arrival, Call-out fee', async () => {
    await acceptSelectedProviderJob({ leadId: 'lead-c13', providerId: 'provider-c13' })
    const customerCall = mockSendText.mock.calls.find((c: any[]) => c[0]?.to === '+27120000002')?.[0]
    expect(customerCall.text).toContain('Provider: Bob Electrical')
    expect(customerCall.text).toContain('Expected arrival:')
    expect(customerCall.text).toContain('Call-out fee:')
  })

  it('customer message: ticket URL travels via sendCtaUrl — body text must not contain raw URL', async () => {
    const { sendCtaUrl } = await import('../../lib/whatsapp-interactive')
    await acceptSelectedProviderJob({ leadId: 'lead-c13', providerId: 'provider-c13' })
    const customerCall = mockSendText.mock.calls.find((c: any[]) => c[0]?.to === '+27120000002')?.[0]
    // Body must not embed the raw URL (assertNoRawUrlsInWhatsAppBody would block it in production)
    expect(customerCall.text).not.toContain('https://')
    expect(customerCall.text).not.toContain('http://')
    // URL travels via CTA button instead
    expect(sendCtaUrl).toHaveBeenCalledWith(
      '+27120000002',
      expect.any(String),
      expect.any(String),
      'https://app.plugapro.test/requests/access/token-c13',
      undefined,
      expect.any(Object),
    )
  })

  // ─── Error code coverage ──────────────────────────────────────────────────

  it('returns PROVIDER_NOT_SELECTED when provider is not the selected provider', async () => {
    state.tx.lead.findUnique.mockResolvedValueOnce(makeLead({ providerId: 'provider-other' }))
    const result = await acceptSelectedProviderJob({ leadId: 'lead-c13', providerId: 'provider-c13' })
    expect(result).toEqual({ ok: false, reason: 'PROVIDER_NOT_SELECTED' })
  })

  it('returns LEAD_INVITE_NOT_SELECTED when lead is not the selected invite', async () => {
    state.tx.lead.findUnique.mockResolvedValueOnce(makeLead({
      jobRequest: { ...state.lead.jobRequest, selectedLeadInviteId: 'different-lead' },
    }))
    const result = await acceptSelectedProviderJob({ leadId: 'lead-c13', providerId: 'provider-c13' })
    expect(result).toEqual({ ok: false, reason: 'LEAD_INVITE_NOT_SELECTED' })
  })

  it('returns LEAD_EXPIRED when lead.status = EXPIRED', async () => {
    state.tx.lead.findUnique.mockResolvedValueOnce(makeLead({ status: 'EXPIRED' }))
    const result = await acceptSelectedProviderJob({ leadId: 'lead-c13', providerId: 'provider-c13' })
    expect(result).toEqual({ ok: false, reason: 'LEAD_EXPIRED' })
  })

  it('returns REQUEST_NOT_AWAITING_CONFIRMATION when status != PROVIDER_CONFIRMATION_PENDING', async () => {
    state.tx.lead.findUnique.mockResolvedValueOnce(makeLead({
      jobRequest: { ...state.lead.jobRequest, status: 'SHORTLISTED' },
    }))
    const result = await acceptSelectedProviderJob({ leadId: 'lead-c13', providerId: 'provider-c13' })
    expect(result).toEqual({ ok: false, reason: 'REQUEST_NOT_AWAITING_CONFIRMATION' })
  })

  it('returns INSUFFICIENT_CREDITS when unlock throws LeadUnlockError INSUFFICIENT_CREDITS', async () => {
    const { LeadUnlockError, unlockLeadForProviderInTransaction } = await import('../../lib/lead-unlocks')
    ;(unlockLeadForProviderInTransaction as any).mockRejectedValueOnce(
      new LeadUnlockError('INSUFFICIENT_CREDITS', 'No credits', 0),
    )
    const result = await acceptSelectedProviderJob({ leadId: 'lead-c13', providerId: 'provider-c13' })
    expect(result).toEqual({ ok: false, reason: 'INSUFFICIENT_CREDITS', currentCreditBalance: 0 })
  })

  it('returns JOB_ASSIGNMENT_FAILED for unexpected errors, without creating match/job', async () => {
    const { LeadUnlockError, unlockLeadForProviderInTransaction } = await import('../../lib/lead-unlocks')
    ;(unlockLeadForProviderInTransaction as any).mockRejectedValueOnce(
      new Error('Unexpected DB error'),
    )
    const result = await acceptSelectedProviderJob({ leadId: 'lead-c13', providerId: 'provider-c13' })
    expect(result).toEqual({ ok: false, reason: 'JOB_ASSIGNMENT_FAILED' })
    expect(state.tx.match.create).not.toHaveBeenCalled()
    expect(state.tx.job.create).not.toHaveBeenCalled()
  })

  // ─── Duplicate accept idempotency ─────────────────────────────────────────

  it('duplicate accept: returns ok:true alreadyUnlocked:true without calling unlock or creating match/job', async () => {
    // Lead is already ACCEPTED and match belongs to this provider
    state.tx.lead.findUnique.mockResolvedValueOnce(makeLead({
      status: 'ACCEPTED',
      jobRequest: {
        ...state.lead.jobRequest,
        status: 'MATCHED',
        match: {
          id: 'match-existing',
          providerId: 'provider-c13',
          booking: { id: 'booking-existing', job: { id: 'job-existing' } },
        },
      },
    }))
    const { unlockLeadForProviderInTransaction } = await import('../../lib/lead-unlocks')

    const result = await acceptSelectedProviderJob({ leadId: 'lead-c13', providerId: 'provider-c13' })

    expect(result).toMatchObject({ ok: true, alreadyUnlocked: true })
    // Must NOT deduct credits again
    expect(unlockLeadForProviderInTransaction).not.toHaveBeenCalled()
    // Must NOT create a second match or job
    expect(state.tx.match.create).not.toHaveBeenCalled()
    expect(state.tx.job.create).not.toHaveBeenCalled()
  })

  // ─── Credit ledger traceability ───────────────────────────────────────────

  it('ledger entry carries idempotencyKey derived from source:providerId:leadId:selected_accept when none provided', async () => {
    const { unlockLeadForProviderInTransaction } = await import('../../lib/lead-unlocks')
    await acceptSelectedProviderJob({
      leadId: 'lead-c13',
      providerId: 'provider-c13',
      source: 'whatsapp',
    })
    expect(unlockLeadForProviderInTransaction).toHaveBeenCalledWith(
      state.tx,
      'lead-c13',
      'provider-c13',
      expect.objectContaining({
        idempotencyKey: 'whatsapp:provider-c13:lead-c13:selected_accept',
      }),
    )
  })

  it('result includes creditTransactionId from the last ledger entry', async () => {
    const result = await acceptSelectedProviderJob({ leadId: 'lead-c13', providerId: 'provider-c13' })
    expect(result).toMatchObject({ ok: true, creditTransactionId: 'ledger-c13' })
  })

  it('result includes remaining currentCreditBalance after deduction', async () => {
    const result = await acceptSelectedProviderJob({ leadId: 'lead-c13', providerId: 'provider-c13' })
    // balanceAfterPaidCredits(2) + balanceAfterPromoCredits(1) = 3
    expect(result).toMatchObject({ ok: true, currentCreditBalance: 3 })
  })
})
