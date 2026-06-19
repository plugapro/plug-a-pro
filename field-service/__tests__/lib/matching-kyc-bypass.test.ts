// Closes the two matching-side KYC bypasses identified in Phase 1:
//   1. acceptAssignmentOffer collapsed KYC_REQUIRED → PROVIDER_NOT_APPROVED,
//      so the provider couldn't tell whether to verify their identity or
//      contact support about an "unapproved" account. Now KYC_REQUIRED
//      propagates end-to-end.
//   2. manualOverrideAssignment did not check KYC, so an admin could
//      force-assign a REJECTED/EXPIRED-KYC provider; the lead offer would
//      fire before the unlock-time gate caught the issue.

import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockDb } = vi.hoisted(() => ({
  mockDb: {
    jobRequest: { findUnique: vi.fn(), findUniqueOrThrow: vi.fn(), update: vi.fn() },
    provider: { findMany: vi.fn(), findUnique: vi.fn(), findUniqueOrThrow: vi.fn() },
    dispatchDecision: { create: vi.fn(), update: vi.fn(), updateMany: vi.fn(), findMany: vi.fn(), findFirst: vi.fn(), findUnique: vi.fn() },
    matchAttempt: { create: vi.fn(), findFirst: vi.fn(), findFirstOrThrow: vi.fn(), findMany: vi.fn(), update: vi.fn() },
    assignmentHold: { create: vi.fn(), update: vi.fn(), updateMany: vi.fn(), findUnique: vi.fn(), findFirst: vi.fn() },
    lead: { upsert: vi.fn(), updateMany: vi.fn(), update: vi.fn(), findUnique: vi.fn(), findMany: vi.fn() },
    leadUnlock: { findUnique: vi.fn(), create: vi.fn(), update: vi.fn() },
    messageEvent: { findMany: vi.fn() },
    providerWallet: { findUnique: vi.fn(), upsert: vi.fn(), updateMany: vi.fn(), findUniqueOrThrow: vi.fn() },
    walletLedgerEntry: { create: vi.fn() },
    auditLog: { create: vi.fn() },
    quote: { create: vi.fn() },
    booking: { create: vi.fn() },
    job: { create: vi.fn(), findMany: vi.fn() },
    technicianScheduleItem: { create: vi.fn(), updateMany: vi.fn() },
    match: { findUnique: vi.fn(), findMany: vi.fn(), create: vi.fn(), update: vi.fn() },
    providerCapacity: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
    featureFlag: { findMany: vi.fn().mockResolvedValue([]) },
    $transaction: vi.fn(),
  },
}))

vi.mock('../../lib/db', () => ({ db: mockDb }))
vi.mock('../../lib/whatsapp-bot', () => ({ notifyProviderNewJob: vi.fn().mockResolvedValue(undefined) }))
vi.mock('../../lib/payments', () => ({
  initializeBookingPayment: vi.fn().mockResolvedValue({ mode: 'OFFLINE_RECORDED', status: 'PENDING', checkoutUrl: null }),
}))

import {
  acceptAssignmentOffer,
  ManualOverrideKycBlockedError,
  manualOverrideAssignment,
} from '../../lib/matching/service'

beforeEach(() => {
  vi.clearAllMocks()
  mockDb.$transaction.mockImplementation(async (cb: any) => cb(mockDb as any))
  mockDb.featureFlag.findMany.mockResolvedValue([])
})

describe('acceptAssignmentOffer — KYC_REQUIRED reason propagation', () => {
  it('returns KYC_REQUIRED (not PROVIDER_NOT_APPROVED) when an active+verified provider is missing KYC', async () => {
    mockDb.lead.findUnique.mockResolvedValue({
      id: 'lead-1',
      providerId: 'provider-no-kyc',
      jobRequestId: 'jr-1',
      dispatchDecisionId: 'd-1',
      matchAttemptId: 'a-1',
      expiresAt: new Date(Date.now() + 60_000),
      assignmentHoldId: 'h-1',
      assignmentHold: { id: 'h-1', status: 'ACTIVE' },
      matchAttempt: { id: 'a-1' },
    })
    mockDb.provider.findUnique.mockResolvedValue({
      id: 'provider-no-kyc',
      active: true,
      verified: true,
      status: 'ACTIVE',
      // post-cutoff sign-up so the legacy grace cannot grandfather them
      kycStatus: 'NOT_STARTED',
      createdAt: new Date('2026-09-01T00:00:00.000Z'),
    })
    mockDb.providerWallet.findUnique.mockResolvedValue({ paidCreditBalance: 0, promoCreditBalance: 0 })

    const result = await acceptAssignmentOffer({
      leadId: 'lead-1',
      providerId: 'provider-no-kyc',
      source: 'whatsapp',
    })

    expect(result).toMatchObject({ ok: false, reason: 'KYC_REQUIRED' })
    // Critical assertion: nothing was charged / no match was created.
    expect(mockDb.leadUnlock.create).not.toHaveBeenCalled()
    expect(mockDb.match.create).not.toHaveBeenCalled()
  })

  it('still passes VERIFIED providers through (regression)', async () => {
    mockDb.lead.findUnique.mockResolvedValue({
      id: 'lead-1',
      providerId: 'provider-verified',
      jobRequestId: 'jr-1',
      dispatchDecisionId: 'd-1',
      matchAttemptId: 'a-1',
      expiresAt: new Date(Date.now() + 60_000),
      assignmentHoldId: 'h-1',
      assignmentHold: { id: 'h-1', status: 'ACTIVE' },
      matchAttempt: { id: 'a-1' },
    })
    mockDb.provider.findUnique.mockResolvedValue({
      id: 'provider-verified',
      active: true,
      verified: true,
      status: 'ACTIVE',
      kycStatus: 'VERIFIED',
      createdAt: new Date('2026-09-01T00:00:00.000Z'),
    })
    // Force an early failure AFTER the KYC gate (existing test pattern) to
    // confirm we got past the gate without re-doing the full happy path.
    mockDb.providerWallet.findUnique.mockResolvedValue({ paidCreditBalance: 0, promoCreditBalance: 0 })
    mockDb.match.findUnique.mockResolvedValue(null)

    const result = await acceptAssignmentOffer({
      leadId: 'lead-1',
      providerId: 'provider-verified',
      source: 'whatsapp',
    })

    // Must NOT be KYC_REQUIRED. May be a different controlled failure further
    // down (INSUFFICIENT_CREDITS / LEAD_ACCEPTANCE_FAILED / etc), and that's
    // fine — the assertion here is specifically about the KYC gate.
    if (!result.ok) {
      expect(result.reason).not.toBe('KYC_REQUIRED')
    }
  })
})

describe('manualOverrideAssignment — KYC pre-flight', () => {
  it('throws ManualOverrideKycBlockedError for REJECTED provider', async () => {
    mockDb.provider.findUnique.mockResolvedValue({
      id: 'prov-rejected',
      active: true,
      verified: true,
      status: 'ACTIVE',
      kycStatus: 'REJECTED',
      createdAt: new Date('2026-05-01T00:00:00.000Z'), // pre-cutoff, but REJECTED never grandfathered
    })

    await expect(
      manualOverrideAssignment({
        jobRequestId: 'jr-1',
        providerId: 'prov-rejected',
        actor: { id: 'admin-1', role: 'ADMIN' } as any,
        overrideReason: 'admin override',
      }),
    ).rejects.toBeInstanceOf(ManualOverrideKycBlockedError)

    // Critical: no MatchAttempt and no AssignmentHold should be created.
    expect(mockDb.matchAttempt.create).not.toHaveBeenCalled()
    expect(mockDb.assignmentHold.create).not.toHaveBeenCalled()
  })

  it('throws ManualOverrideKycBlockedError for EXPIRED provider', async () => {
    mockDb.provider.findUnique.mockResolvedValue({
      id: 'prov-expired',
      active: true,
      verified: true,
      status: 'ACTIVE',
      kycStatus: 'EXPIRED',
      createdAt: new Date('2026-09-01T00:00:00.000Z'),
    })

    await expect(
      manualOverrideAssignment({
        jobRequestId: 'jr-1',
        providerId: 'prov-expired',
        actor: { id: 'admin-1', role: 'ADMIN' } as any,
        overrideReason: 'admin override',
      }),
    ).rejects.toBeInstanceOf(ManualOverrideKycBlockedError)
  })
})
