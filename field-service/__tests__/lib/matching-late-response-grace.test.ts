// Late-response grace window for acceptAssignmentOffer.
//
// Production incident (2026-07-01): a provider tapped "Accept" ~30 seconds
// after lead.expiresAt. The rotation cron had already flipped his
// assignmentHold to EXPIRED and dispatched the next provider. His accept was
// rejected, he lost the job, and the job took another hour to fill.
//
// Rule under test: a late accept is HONORED iff ALL of
//   (a) grace enabled (MATCHING_CONFIG.lateResponseGraceMinutes > 0) and
//       now <= lead.expiresAt + grace
//   (b) no Match row exists for the jobRequest
//   (c) jobRequest.status is OPEN or MATCHING
//   (d) no OTHER lead on the same jobRequest is ACCEPTED
//   (e) the lead's own status is EXPIRED/SENT/VIEWED and its hold is
//       EXPIRED/ACTIVE (DECLINED/CANCELLED leads are never resurrected)
//   (f) every other precondition (ownership, approval, KYC, credit) passes —
//       the grace bypasses only the hold-ACTIVE and expiry guards.
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { acceptAssignmentOffer } from '../../lib/matching/service'

const { mockDb, mutableMatchingConfig } = vi.hoisted(() => ({
  mockDb: {
    jobRequest: {
      findUnique: vi.fn(),
      findUniqueOrThrow: vi.fn(),
      update: vi.fn(),
    },
    provider: { findMany: vi.fn(), findUnique: vi.fn(), findUniqueOrThrow: vi.fn() },
    dispatchDecision: {
      create: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
      findMany: vi.fn(),
      findFirst: vi.fn(),
      findUnique: vi.fn(),
    },
    matchAttempt: {
      create: vi.fn(),
      findFirst: vi.fn(),
      findFirstOrThrow: vi.fn(),
      findMany: vi.fn(),
      update: vi.fn(),
    },
    assignmentHold: {
      create: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
      findUnique: vi.fn(),
      findFirst: vi.fn(),
    },
    lead: {
      upsert: vi.fn(),
      updateMany: vi.fn(),
      update: vi.fn(),
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      findMany: vi.fn(),
    },
    leadUnlock: { findUnique: vi.fn(), create: vi.fn(), update: vi.fn() },
    messageEvent: { findMany: vi.fn() },
    providerWallet: {
      findUnique: vi.fn(),
      upsert: vi.fn(),
      updateMany: vi.fn(),
      findUniqueOrThrow: vi.fn(),
    },
    walletLedgerEntry: { create: vi.fn() },
    auditLog: { create: vi.fn() },
    quote: { create: vi.fn() },
    booking: { create: vi.fn() },
    job: { create: vi.fn(), findMany: vi.fn() },
    technicianScheduleItem: { create: vi.fn(), updateMany: vi.fn() },
    match: { findUnique: vi.fn(), findMany: vi.fn(), create: vi.fn(), update: vi.fn() },
    providerCapacity: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
    $transaction: vi.fn(),
  },
  mutableMatchingConfig: {} as Record<string, unknown>,
}))

vi.mock('../../lib/db', () => ({
  db: mockDb,
}))

vi.mock('../../lib/whatsapp-bot', () => ({
  notifyProviderNewJob: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('../../lib/payments', () => ({
  initializeBookingPayment: vi.fn().mockResolvedValue({
    mode: 'OFFLINE_RECORDED',
    status: 'PENDING',
    checkoutUrl: null,
  }),
}))

// Mutable MATCHING_CONFIG so each test can flip lateResponseGraceMinutes.
vi.mock(import('../../lib/matching/config'), async (importOriginal) => {
  const actual = await importOriginal()
  Object.assign(mutableMatchingConfig, actual.MATCHING_CONFIG)
  return {
    ...actual,
    MATCHING_CONFIG: mutableMatchingConfig as typeof actual.MATCHING_CONFIG,
  }
})

const PROVIDER_ID = 'provider-1'
const LEAD_ID = 'lead-1'
const HOLD_ID = 'hold-1'
const JOB_REQUEST_ID = 'jr-1'

function makeJobRequestRecord(status: string) {
  return {
    id: JOB_REQUEST_ID,
    category: 'plumbing',
    title: 'Leak',
    description: 'Kitchen leak',
    requestedWindowStart: new Date('2026-07-01T09:00:00.000Z'),
    requestedWindowEnd: new Date('2026-07-01T11:00:00.000Z'),
    requestedArrivalLatest: null,
    estimatedDurationMinutes: 90,
    requiredSkillTags: ['plumbing'],
    requiredCertificationCodes: [],
    requiredEquipmentTags: [],
    requiredVehicleTypes: [],
    preferredProviderId: null,
    assignmentMode: 'AUTO_ASSIGN',
    customerAcceptedAmount: null,
    customerAcceptedScope: null,
    autoCreateBookingOnAssignment: false,
    status,
    address: {
      street: '1 Main St',
      suburb: 'Sandton',
      city: 'Johannesburg',
      province: 'Gauteng',
      lat: null,
      lng: null,
    },
    customer: { id: 'customer-1', name: 'Alice', phone: '+27820000000' },
  }
}

// Primes every mock the accept transaction touches. `expiresAt` in the past +
// `holdStatus: 'EXPIRED'` reproduces the incident state (cron already rotated).
function primeAcceptFixture(opts: {
  leadStatus?: string
  holdStatus?: string
  expiresAt?: Date
  jobRequestStatus?: string
  otherAcceptedLead?: { id: string } | null
} = {}) {
  const {
    leadStatus = 'EXPIRED',
    holdStatus = 'EXPIRED',
    expiresAt = new Date(Date.now() - 30_000), // 30s past expiry
    jobRequestStatus = 'MATCHING',
    otherAcceptedLead = null,
  } = opts

  mockDb.lead.findUnique.mockImplementation(async (args: { include?: { provider?: unknown } }) =>
    args.include?.provider
      ? {
          // lead-unlocks.ts load (credit spend inside the same transaction)
          id: LEAD_ID,
          providerId: PROVIDER_ID,
          jobRequestId: JOB_REQUEST_ID,
          status: leadStatus,
          expiresAt,
          provider: {
            id: PROVIDER_ID,
            active: true,
            verified: true,
            status: 'ACTIVE',
            kycStatus: 'VERIFIED',
            createdAt: new Date('2026-01-01T00:00:00.000Z'),
            isTestUser: false,
          },
          jobRequest: {
            id: JOB_REQUEST_ID,
            status: jobRequestStatus,
            isTestRequest: false,
            cohortName: null,
            category: 'plumbing',
            title: 'Leak',
            match: null,
          },
        }
      : {
          // matching/service.ts load (assignmentHold + matchAttempt included)
          id: LEAD_ID,
          providerId: PROVIDER_ID,
          jobRequestId: JOB_REQUEST_ID,
          status: leadStatus,
          dispatchDecisionId: 'decision-1',
          matchAttemptId: 'attempt-1',
          expiresAt,
          assignmentHoldId: HOLD_ID,
          assignmentHold: { id: HOLD_ID, status: holdStatus },
          matchAttempt: { id: 'attempt-1' },
        },
  )
  mockDb.provider.findUnique.mockResolvedValue({
    id: PROVIDER_ID,
    active: true,
    verified: true,
    status: 'ACTIVE',
    kycStatus: 'VERIFIED',
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    kycOverriddenAt: null,
  })
  mockDb.match.findUnique.mockResolvedValue(null)
  mockDb.match.create.mockResolvedValue({ id: 'match-1' })
  mockDb.lead.findFirst.mockResolvedValue(otherAcceptedLead)
  mockDb.jobRequest.findUnique.mockResolvedValue(makeJobRequestRecord(jobRequestStatus))
  mockDb.jobRequest.findUniqueOrThrow.mockResolvedValue(makeJobRequestRecord(jobRequestStatus))
}

describe('acceptAssignmentOffer late-response grace', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mutableMatchingConfig.lateResponseGraceMinutes = 30
    mockDb.$transaction.mockImplementation(async (callback: (tx: typeof mockDb) => unknown) =>
      callback(mockDb),
    )
    mockDb.jobRequest.update.mockResolvedValue({})
    mockDb.lead.update.mockResolvedValue({})
    mockDb.lead.updateMany.mockResolvedValue({ count: 0 })
    mockDb.assignmentHold.update.mockResolvedValue({})
    mockDb.assignmentHold.updateMany.mockResolvedValue({ count: 0 })
    mockDb.matchAttempt.update.mockResolvedValue({})
    mockDb.dispatchDecision.updateMany.mockResolvedValue({ count: 1 })
    mockDb.technicianScheduleItem.updateMany.mockResolvedValue({ count: 0 })
    mockDb.auditLog.create.mockResolvedValue({})
    mockDb.leadUnlock.findUnique.mockResolvedValue(null)
    mockDb.leadUnlock.create.mockResolvedValue({
      id: 'unlock-1',
      leadId: LEAD_ID,
      providerId: PROVIDER_ID,
      creditsCharged: 1,
      creditTypeBreakdown: {},
      status: 'UNLOCKED',
    })
    mockDb.leadUnlock.update.mockImplementation(async (args: { where: { id: string }; data: { creditTypeBreakdown: unknown } }) => ({
      id: args.where.id,
      leadId: LEAD_ID,
      providerId: PROVIDER_ID,
      creditsCharged: 1,
      creditTypeBreakdown: args.data.creditTypeBreakdown,
      status: 'UNLOCKED',
    }))
    mockDb.providerWallet.findUnique.mockResolvedValue({
      id: 'wallet-1',
      providerId: PROVIDER_ID,
      status: 'ACTIVE',
      paidCreditBalance: 0,
      promoCreditBalance: 1,
    })
    mockDb.providerWallet.upsert.mockResolvedValue({
      id: 'wallet-1',
      providerId: PROVIDER_ID,
      status: 'ACTIVE',
      paidCreditBalance: 0,
      promoCreditBalance: 1,
    })
    mockDb.providerWallet.updateMany.mockResolvedValue({ count: 1 })
    mockDb.providerWallet.findUniqueOrThrow.mockResolvedValue({
      id: 'wallet-1',
      providerId: PROVIDER_ID,
      status: 'ACTIVE',
      paidCreditBalance: 0,
      promoCreditBalance: 0,
    })
    mockDb.walletLedgerEntry.create.mockResolvedValue({
      id: 'ledger-1',
      entryType: 'LEAD_UNLOCK_DEBIT',
      creditType: 'PROMO',
      amountCredits: 1,
    })
  })

  it('honors an accept 30s after expiry (hold EXPIRED, job still unmatched) and cleans up the newer sibling offer', async () => {
    primeAcceptFixture()

    const result = await acceptAssignmentOffer({ leadId: LEAD_ID, providerId: PROVIDER_ID, source: 'whatsapp' })

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.matchId).toBe('match-1')
      expect(result.lateAccepted).toBe(true)
    }

    // Match created for the late acceptor
    expect(mockDb.match.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        jobRequestId: JOB_REQUEST_ID,
        providerId: PROVIDER_ID,
        status: 'MATCHED',
      }),
    })

    // EXPIRED hold reactivated to ACCEPTED (plain by-id update, no ACTIVE filter)
    expect(mockDb.assignmentHold.update).toHaveBeenCalledWith({
      where: { id: HOLD_ID },
      data: expect.objectContaining({ status: 'ACCEPTED' }),
    })

    // TIMED_OUT matchAttempt tolerated: flipped to ACCEPTED
    expect(mockDb.matchAttempt.update).toHaveBeenCalledWith({
      where: { id: 'attempt-1' },
      data: expect.objectContaining({ stage: 'ACCEPTED', responseOutcome: 'ACCEPTED' }),
    })

    // Lead itself flipped to ACCEPTED with acceptance timestamps
    expect(mockDb.lead.update).toHaveBeenCalledWith({
      where: { id: LEAD_ID },
      data: expect.objectContaining({
        status: 'ACCEPTED',
        respondedAt: expect.any(Date),
        providerAcceptedAt: expect.any(Date),
      }),
    })

    // Sibling cleanup: the NEWER provider's SENT/VIEWED lead is expired…
    expect(mockDb.lead.updateMany).toHaveBeenCalledWith({
      where: {
        jobRequestId: JOB_REQUEST_ID,
        id: { not: LEAD_ID },
        status: { in: ['SENT', 'VIEWED'] },
      },
      data: expect.objectContaining({ status: 'EXPIRED' }),
    })
    // …and their ACTIVE hold is released (filter is jobRequestId + status, so
    // holds created AFTER this lead are covered too).
    expect(mockDb.assignmentHold.updateMany).toHaveBeenCalledWith({
      where: {
        jobRequestId: JOB_REQUEST_ID,
        id: { not: HOLD_ID },
        status: 'ACTIVE',
      },
      data: expect.objectContaining({
        status: 'RELEASED',
        outcomeReasonCode: 'MATCH_ASSIGNED_ELSEWHERE',
      }),
    })

    // Job request moved to MATCHED
    expect(mockDb.jobRequest.update).toHaveBeenCalledWith({
      where: { id: JOB_REQUEST_ID },
      data: { status: 'MATCHED' },
    })
  })

  it('rejects the late accept when another lead on the job is already ACCEPTED', async () => {
    primeAcceptFixture({ otherAcceptedLead: { id: 'lead-2' } })

    const result = await acceptAssignmentOffer({ leadId: LEAD_ID, providerId: PROVIDER_ID, source: 'whatsapp' })

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(['EXPIRED', 'TAKEN']).toContain(result.reason)
    }
    expect(mockDb.match.create).not.toHaveBeenCalled()
    expect(mockDb.leadUnlock.create).not.toHaveBeenCalled()
  })

  it('rejects an accept beyond the grace window (31+ minutes past expiry)', async () => {
    primeAcceptFixture({ expiresAt: new Date(Date.now() - 31 * 60_000) })

    const result = await acceptAssignmentOffer({ leadId: LEAD_ID, providerId: PROVIDER_ID, source: 'whatsapp' })

    expect(result).toMatchObject({ ok: false })
    if (!result.ok) {
      // Hold is EXPIRED so guard A (TAKEN) fires before guard B (EXPIRED);
      // either way the accept must NOT be honored.
      expect(['EXPIRED', 'TAKEN']).toContain(result.reason)
    }
    expect(mockDb.match.create).not.toHaveBeenCalled()
  })

  it('keeps exact current behavior when grace is disabled (config 0): EXPIRED with expiry marking', async () => {
    mutableMatchingConfig.lateResponseGraceMinutes = 0
    // Hold still ACTIVE (cron has not run yet) but lead is 30s past expiry —
    // this is the pre-grace guard-B path and must be byte-for-byte preserved.
    primeAcceptFixture({ leadStatus: 'SENT', holdStatus: 'ACTIVE' })

    const result = await acceptAssignmentOffer({ leadId: LEAD_ID, providerId: PROVIDER_ID, source: 'whatsapp' })

    expect(result).toMatchObject({ ok: false, reason: 'EXPIRED' })
    expect(mockDb.lead.update).toHaveBeenCalledWith({
      where: { id: LEAD_ID },
      data: { status: 'EXPIRED', respondedAt: expect.any(Date) },
    })
    expect(mockDb.assignmentHold.update).toHaveBeenCalledWith({
      where: { id: HOLD_ID },
      data: expect.objectContaining({
        status: 'EXPIRED',
        outcomeReasonCode: 'OFFER_EXPIRED_BEFORE_ACCEPT',
      }),
    })
    expect(mockDb.match.create).not.toHaveBeenCalled()
  })

  it('never resurrects a DECLINED lead, even inside the grace window', async () => {
    primeAcceptFixture({ leadStatus: 'DECLINED' })

    const result = await acceptAssignmentOffer({ leadId: LEAD_ID, providerId: PROVIDER_ID, source: 'whatsapp' })

    expect(result.ok).toBe(false)
    expect(mockDb.match.create).not.toHaveBeenCalled()
    expect(mockDb.leadUnlock.create).not.toHaveBeenCalled()
  })

  it('leaves the non-expired happy path unchanged (regression pin, no extra grace queries)', async () => {
    primeAcceptFixture({
      leadStatus: 'SENT',
      holdStatus: 'ACTIVE',
      expiresAt: new Date(Date.now() + 60_000),
      jobRequestStatus: 'OPEN',
    })

    const result = await acceptAssignmentOffer({ leadId: LEAD_ID, providerId: PROVIDER_ID })

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.matchId).toBe('match-1')
      expect(result.lateAccepted ?? false).toBe(false)
    }
    // The grace verdict must be lazy: the common (non-expired) path must not
    // pay for the other-accepted-lead lookup.
    expect(mockDb.lead.findFirst).not.toHaveBeenCalled()
  })
})
