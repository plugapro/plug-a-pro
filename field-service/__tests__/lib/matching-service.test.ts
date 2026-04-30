import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  acceptAssignmentOffer,
  manualOverrideAssignment,
  rankCandidatesForJobRequest,
  runAssignmentForJobRequest,
} from '../../lib/matching/service'

const {
  mockDb,
  mockNotifyProviderNewJob,
  mockInitializeBookingPayment,
} = vi.hoisted(() => ({
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
    lead: { upsert: vi.fn(), updateMany: vi.fn(), update: vi.fn(), findUnique: vi.fn() },
    leadUnlock: { findUnique: vi.fn(), create: vi.fn(), update: vi.fn() },
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
    $transaction: vi.fn(),
  },
  mockNotifyProviderNewJob: vi.fn().mockResolvedValue(undefined),
  mockInitializeBookingPayment: vi.fn().mockResolvedValue({
    mode: 'OFFLINE_RECORDED',
    status: 'PENDING',
    checkoutUrl: null,
  }),
}))

vi.mock('../../lib/db', () => ({
  db: mockDb,
}))

vi.mock('../../lib/whatsapp-bot', () => ({
  notifyProviderNewJob: mockNotifyProviderNewJob,
}))

vi.mock('../../lib/payments', () => ({
  initializeBookingPayment: mockInitializeBookingPayment,
}))

describe('matching service', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockDb.$transaction.mockImplementation(async (callback: (tx: typeof mockDb) => unknown) =>
      callback(mockDb as any)
    )
    mockDb.dispatchDecision.create.mockResolvedValue({
      id: 'decision-1',
      status: 'RANKED',
    })
    mockDb.dispatchDecision.findFirst.mockResolvedValue(null)
    mockDb.dispatchDecision.findUnique.mockResolvedValue(null)
    mockDb.matchAttempt.create.mockResolvedValue({})
    mockDb.jobRequest.update.mockResolvedValue({})
    mockDb.jobRequest.findUnique.mockResolvedValue(makeJobRequest('AUTO_ASSIGN'))
    mockDb.assignmentHold.updateMany.mockResolvedValue({})
    mockDb.assignmentHold.update.mockResolvedValue({})
    mockDb.technicianScheduleItem.updateMany.mockResolvedValue({})
    mockDb.assignmentHold.create.mockResolvedValue({ id: 'hold-1' })
    mockDb.assignmentHold.findFirst.mockResolvedValue(null)
    mockDb.lead.upsert.mockResolvedValue({ id: 'lead-1' })
    mockDb.lead.update.mockResolvedValue({})
    mockDb.leadUnlock.findUnique.mockResolvedValue(null)
    mockDb.leadUnlock.create.mockResolvedValue({
      id: 'unlock-1',
      leadId: 'lead-1',
      providerId: 'provider-preferred',
      creditsCharged: 1,
      creditTypeBreakdown: {},
      status: 'UNLOCKED',
    })
    mockDb.leadUnlock.update.mockImplementation(async (args: any) => ({
      id: args.where.id,
      leadId: 'lead-1',
      providerId: 'provider-preferred',
      creditsCharged: 1,
      creditTypeBreakdown: args.data.creditTypeBreakdown,
      status: 'UNLOCKED',
    }))
    mockDb.providerWallet.findUnique.mockResolvedValue({
      id: 'wallet-1',
      providerId: 'provider-preferred',
      status: 'ACTIVE',
      paidCreditBalance: 0,
      promoCreditBalance: 1,
    })
    mockDb.providerWallet.upsert.mockResolvedValue({
      id: 'wallet-1',
      providerId: 'provider-preferred',
      status: 'ACTIVE',
      paidCreditBalance: 0,
      promoCreditBalance: 1,
    })
    mockDb.providerWallet.updateMany.mockResolvedValue({ count: 1 })
    mockDb.providerWallet.findUniqueOrThrow.mockResolvedValue({
      id: 'wallet-1',
      providerId: 'provider-preferred',
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
    mockDb.auditLog.create.mockResolvedValue({})
    mockDb.quote.create.mockResolvedValue({ id: 'quote-1' })
    mockDb.booking.create.mockResolvedValue({ id: 'booking-1' })
    mockDb.job.create.mockResolvedValue({})
    mockDb.job.findMany.mockResolvedValue([])
    mockDb.match.findMany.mockResolvedValue([])
    mockDb.match.update.mockResolvedValue({})
    mockDb.provider.findUniqueOrThrow.mockResolvedValue({
      id: 'provider-preferred',
      phone: '+27110000000',
      name: 'Preferred Pro',
    })
    mockDb.jobRequest.findUniqueOrThrow.mockResolvedValue({
      ...makeJobRequest('AUTO_ASSIGN'),
      address: {
        street: '1 Main St',
        suburb: 'Sandton',
        city: 'Johannesburg',
        province: 'Gauteng',
        lat: null,
        lng: null,
      },
      customer: { name: 'Alice Smith' },
    })
  })

  it('filters out technicians missing certification or service-area coverage', async () => {
    mockDb.jobRequest.findUnique.mockResolvedValue({
      id: 'jr-1',
      category: 'electrical',
      title: 'DB board issue',
      description: 'Need electrician',
      requestedWindowStart: new Date('2026-04-14T09:00:00.000Z'),
      requestedWindowEnd: new Date('2026-04-14T11:00:00.000Z'),
      requestedArrivalLatest: null,
      estimatedDurationMinutes: 120,
    requiredSkillTags: ['electrical'],
    requiredCertificationCodes: ['WIREMAN'],
    requiredEquipmentTags: [],
    requiredVehicleTypes: [],
    preferredProviderId: null,
    assignmentMode: 'AUTO_ASSIGN',
    customerAcceptedAmount: null,
    customerAcceptedScope: null,
    autoCreateBookingOnAssignment: false,
    status: 'OPEN',
      address: {
        street: '1 Main St',
        suburb: 'Sandton',
        city: 'Johannesburg',
        province: 'Gauteng',
        lat: null,
        lng: null,
      },
      customer: { id: 'customer-1', name: 'Alice', phone: '+27820000000' },
    })
    mockDb.provider.findMany.mockResolvedValue([
      {
        id: 'provider-good',
        name: 'Good Fit',
        phone: '+27110000001',
        active: true,
        availableNow: true,
        verified: true,
        skills: ['electrical'],
        serviceAreas: ['Sandton'],
        averageRating: 4.8,
        reliabilityScore: 0.9,
        completedJobsCount: 30,
        onTimeRate: 0.95,
        acceptanceRate: 0.92,
        complaintCount: 0,
        complaintRate: 0,
        providerCancellationCount: 0,
        cancellationRate: 0,
        lateArrivalCount: 0,
        punctualityScore: 0.98,
        maxTravelMinutes: 90,
        lastKnownLat: null,
        lastKnownLng: null,
        lastKnownLocationLabel: null,
        lastKnownLocationAt: null,
        equipmentTags: ['multimeter'],
        vehicleTypes: ['van'],
        technicianSkills: [{ skillTag: 'electrical' }],
        technicianCertifications: [{ certificationCode: 'WIREMAN', status: 'REVIEWED' }],
        technicianServiceAreas: [{ label: 'Sandton', city: 'Johannesburg', active: true }],
        technicianAvailability: { availabilityState: 'AVAILABLE', nextAvailableAt: null, breakUntil: null },
        schedule: [{ dayOfWeek: 1, startTime: '08:00', endTime: '17:00', active: true }],
        scheduleItems: [],
        matches: [],
        jobs: [],
      },
      {
        id: 'provider-missing-cert',
        name: 'No Cert',
        phone: '+27110000002',
        active: true,
        availableNow: true,
        verified: true,
        skills: ['electrical'],
        serviceAreas: ['Sandton'],
        averageRating: 4.4,
        reliabilityScore: 0.7,
        completedJobsCount: 8,
        onTimeRate: 0.85,
        acceptanceRate: 0.85,
        complaintCount: 0,
        complaintRate: 0,
        providerCancellationCount: 0,
        cancellationRate: 0,
        lateArrivalCount: 0,
        punctualityScore: 0.9,
        maxTravelMinutes: 90,
        lastKnownLat: null,
        lastKnownLng: null,
        lastKnownLocationLabel: null,
        lastKnownLocationAt: null,
        equipmentTags: ['multimeter'],
        vehicleTypes: ['van'],
        technicianSkills: [{ skillTag: 'electrical' }],
        technicianCertifications: [],
        technicianServiceAreas: [{ label: 'Sandton', city: 'Johannesburg', active: true }],
        technicianAvailability: { availabilityState: 'AVAILABLE', nextAvailableAt: null, breakUntil: null },
        schedule: [{ dayOfWeek: 1, startTime: '08:00', endTime: '17:00', active: true }],
        scheduleItems: [],
        matches: [],
        jobs: [],
      },
      {
        id: 'provider-outside-area',
        name: 'Outside Area',
        phone: '+27110000003',
        active: true,
        availableNow: true,
        verified: true,
        skills: ['electrical'],
        serviceAreas: ['Centurion'],
        averageRating: 4.4,
        reliabilityScore: 0.7,
        completedJobsCount: 8,
        onTimeRate: 0.85,
        acceptanceRate: 0.85,
        complaintCount: 0,
        complaintRate: 0,
        providerCancellationCount: 0,
        cancellationRate: 0,
        lateArrivalCount: 0,
        punctualityScore: 0.9,
        maxTravelMinutes: 90,
        lastKnownLat: null,
        lastKnownLng: null,
        lastKnownLocationLabel: null,
        lastKnownLocationAt: null,
        equipmentTags: ['multimeter'],
        vehicleTypes: ['van'],
        technicianSkills: [{ skillTag: 'electrical' }],
        technicianCertifications: [{ certificationCode: 'WIREMAN', status: 'REVIEWED' }],
        technicianServiceAreas: [{ label: 'Centurion', city: 'Pretoria', active: true }],
        technicianAvailability: { availabilityState: 'AVAILABLE', nextAvailableAt: null, breakUntil: null },
        schedule: [{ dayOfWeek: 1, startTime: '08:00', endTime: '17:00', active: true }],
        scheduleItems: [],
        matches: [],
        jobs: [],
      },
    ])

    const result = await rankCandidatesForJobRequest('jr-1')

    expect(result.eligibleCount).toBe(1)
    expect(result.candidates[0].providerId).toBe('provider-good')
    expect(result.filteredOut).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          providerId: 'provider-missing-cert',
          filteredReasonCodes: expect.arrayContaining([
            'MISSING_REQUIRED_CERTIFICATION:wireman',
          ]),
        }),
        expect.objectContaining({
          providerId: 'provider-outside-area',
          filteredReasonCodes: expect.arrayContaining(['OUTSIDE_SERVICE_AREA']),
        }),
      ]),
    )
  })

  it('scores a preferred repeat technician ahead of an equally feasible alternative', async () => {
    mockDb.jobRequest.findUnique.mockResolvedValue({
      id: 'jr-2',
      category: 'plumbing',
      title: 'Leak',
      description: 'Kitchen leak',
      requestedWindowStart: new Date('2026-04-14T09:00:00.000Z'),
      requestedWindowEnd: new Date('2026-04-14T11:00:00.000Z'),
      requestedArrivalLatest: null,
      estimatedDurationMinutes: 90,
      requiredSkillTags: ['plumbing'],
      requiredCertificationCodes: [],
      requiredEquipmentTags: [],
      requiredVehicleTypes: [],
      preferredProviderId: 'provider-preferred',
      assignmentMode: 'AUTO_ASSIGN',
      customerAcceptedAmount: null,
      customerAcceptedScope: null,
      autoCreateBookingOnAssignment: false,
      status: 'OPEN',
      address: {
        street: '1 Main St',
        suburb: 'Sandton',
        city: 'Johannesburg',
        province: 'Gauteng',
        lat: null,
        lng: null,
      },
      customer: { id: 'customer-1', name: 'Alice', phone: '+27820000000' },
    })
    mockDb.provider.findMany.mockResolvedValue([
      makeProvider('provider-alternative', 'Alternative Pro'),
      makeProvider('provider-preferred', 'Preferred Pro'),
    ])
    mockDb.provider.findUnique.mockResolvedValue({
      id: 'provider-preferred',
      active: true,
      verified: true,
      status: 'ACTIVE',
      kycStatus: 'VERIFIED',
    })

    const result = await rankCandidatesForJobRequest('jr-2')

    expect(result.candidates[0].providerId).toBe('provider-preferred')
    expect(result.candidates[0].scoreBreakdown.customerPreference).toBe(1)
  })

  it('excludes providers whose marketplace approval is still pending', async () => {
    mockDb.jobRequest.findUnique.mockResolvedValue(makeJobRequest('AUTO_ASSIGN'))
    mockDb.provider.findMany.mockResolvedValue([])

    const result = await rankCandidatesForJobRequest('jr-pending-review')

    expect(mockDb.provider.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          active: true,
          verified: true,
          status: 'ACTIVE',
        }),
      }),
    )
    expect(result.eligibleCount).toBe(0)
    expect(result.candidates).toEqual([])
  })

  it('emits specific equipment reason codes for missing requirements', async () => {
    mockDb.jobRequest.findUnique.mockResolvedValue({
      id: 'jr-equip-1',
      category: 'plumbing',
      title: 'Blocked drain',
      description: 'Need drain machine',
      requestedWindowStart: new Date('2026-04-14T09:00:00.000Z'),
      requestedWindowEnd: new Date('2026-04-14T11:00:00.000Z'),
      requestedArrivalLatest: null,
      estimatedDurationMinutes: 90,
      requiredSkillTags: ['plumbing'],
      requiredCertificationCodes: [],
      requiredEquipmentTags: ['drain_snake'],
      requiredVehicleTypes: [],
      preferredProviderId: null,
      assignmentMode: 'AUTO_ASSIGN',
      customerAcceptedAmount: null,
      customerAcceptedScope: null,
      autoCreateBookingOnAssignment: false,
      status: 'OPEN',
      address: {
        street: '1 Main St',
        suburb: 'Sandton',
        city: 'Johannesburg',
        province: 'Gauteng',
        lat: null,
        lng: null,
      },
      customer: { id: 'customer-1', name: 'Alice', phone: '+27820000000' },
    })
    mockDb.provider.findMany.mockResolvedValue([
      {
        ...makeProvider('provider-missing-equipment', 'Missing Equipment Pro'),
        skills: ['plumbing'],
        technicianSkills: [{ skillTag: 'plumbing' }],
        serviceAreas: ['Sandton'],
        technicianServiceAreas: [{ label: 'Sandton', city: 'Johannesburg', active: true }],
        equipmentTags: [],
      },
    ])

    const result = await rankCandidatesForJobRequest('jr-equip-1')

    expect(result.eligibleCount).toBe(0)
    expect(result.filteredOut).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          providerId: 'provider-missing-equipment',
          filteredReasonCodes: expect.arrayContaining([
            'MISSING_REQUIRED_EQUIPMENT:drain_snake',
          ]),
        }),
      ]),
    )
  })

  it('creates an assignment hold for the top ranked technician in auto-assign mode', async () => {
    mockDb.jobRequest.findUnique.mockResolvedValue(makeJobRequest('AUTO_ASSIGN'))
    mockDb.provider.findMany.mockResolvedValue([makeProvider('provider-preferred', 'Preferred Pro')])
    mockDb.matchAttempt.findFirstOrThrow.mockResolvedValue({ id: 'attempt-1', providerId: 'provider-preferred' })

    const result = await runAssignmentForJobRequest({ jobRequestId: 'jr-3' })

    expect(result.assignmentHoldId).toBe('hold-1')
    expect(mockNotifyProviderNewJob).toHaveBeenCalledTimes(1)
    expect(mockDb.assignmentHold.create).toHaveBeenCalled()
  })

  it('returns the active offer instead of creating a duplicate dispatch decision', async () => {
    mockDb.jobRequest.findUnique.mockResolvedValue(makeJobRequest('AUTO_ASSIGN'))
    mockDb.jobRequest.findUniqueOrThrow.mockResolvedValue(makeJobRequest('AUTO_ASSIGN'))
    mockDb.provider.findMany.mockResolvedValue([makeProvider('provider-preferred', 'Preferred Pro')])
    mockDb.match.findUnique.mockResolvedValue(null)
    mockDb.assignmentHold.findFirst.mockResolvedValue({
      id: 'hold-existing',
      dispatchDecisionId: 'decision-existing',
      providerId: 'provider-preferred',
    })
    mockDb.dispatchDecision.findUnique.mockResolvedValue({ id: 'decision-existing', status: 'OFFERING' })

    const result = await runAssignmentForJobRequest({ jobRequestId: 'jr-3' })

    expect(result.assignmentHoldId).toBe('hold-existing')
    expect(result.offeredProviderId).toBe('provider-preferred')
    expect(mockDb.dispatchDecision.create).not.toHaveBeenCalled()
  })

  it('creates a booking immediately when the category allows direct booking and the customer accepted the amount', async () => {
    mockDb.lead.findUnique.mockImplementation(async (args: any) => args.include?.provider ? {
      id: 'lead-1',
      providerId: 'provider-preferred',
      jobRequestId: 'jr-generic',
      status: 'SENT',
      expiresAt: new Date(Date.now() + 60_000),
      provider: {
        id: 'provider-preferred',
        active: true,
        verified: true,
        status: 'ACTIVE',
        kycStatus: 'VERIFIED',
      },
      jobRequest: {
        id: 'jr-generic',
        status: 'OPEN',
        match: null,
      },
    } : {
      id: 'lead-1',
      providerId: 'provider-preferred',
      jobRequestId: 'jr-generic',
      dispatchDecisionId: 'decision-1',
      matchAttemptId: 'attempt-1',
      expiresAt: new Date(Date.now() + 60_000),
      assignmentHoldId: 'hold-1',
      assignmentHold: { id: 'hold-1', status: 'ACTIVE' },
      matchAttempt: { id: 'attempt-1' },
    })
    mockDb.match.findUnique.mockResolvedValue(null)
    mockDb.match.create.mockResolvedValue({ id: 'match-1' })
    mockDb.jobRequest.findUniqueOrThrow.mockResolvedValue({
      ...makeJobRequest('AUTO_ASSIGN'),
      category: 'Handyman',
      customerAcceptedAmount: 850,
      customerAcceptedScope: 'Install shelves and hang curtain rails',
      autoCreateBookingOnAssignment: true,
    })
    mockDb.jobRequest.findUnique.mockResolvedValue({
      ...makeJobRequest('AUTO_ASSIGN'),
      category: 'Handyman',
      customerAcceptedAmount: 850,
      customerAcceptedScope: 'Install shelves and hang curtain rails',
      autoCreateBookingOnAssignment: true,
    })

    const result = await acceptAssignmentOffer({
      leadId: 'lead-1',
      providerId: 'provider-preferred',
    })

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.bookingId).toBe('booking-1')
    }
    expect(mockDb.quote.create).toHaveBeenCalled()
    expect(mockInitializeBookingPayment).toHaveBeenCalled()
  })

  it('does not call dispatchDecision.updateMany when lead has no dispatch decision', async () => {
    mockDb.lead.findUnique.mockImplementation(async (args: any) => args.include?.provider ? {
      id: 'lead-1',
      providerId: 'provider-preferred',
      jobRequestId: 'jr-generic',
      status: 'SENT',
      expiresAt: new Date(Date.now() + 60_000),
      provider: {
        id: 'provider-preferred',
        active: true,
        verified: true,
        status: 'ACTIVE',
        kycStatus: 'VERIFIED',
      },
      jobRequest: { id: 'jr-generic', status: 'OPEN', match: null },
    } : {
      id: 'lead-1',
      providerId: 'provider-preferred',
      jobRequestId: 'jr-generic',
      dispatchDecisionId: null,    // ← no dispatch decision
      matchAttemptId: null,
      expiresAt: new Date(Date.now() + 60_000),
      assignmentHoldId: 'hold-1',
      assignmentHold: { id: 'hold-1', status: 'ACTIVE' },
      matchAttempt: null,
    })
    mockDb.match.findUnique.mockResolvedValue(null)
    mockDb.match.create.mockResolvedValue({ id: 'match-1' })

    const result = await acceptAssignmentOffer({ leadId: 'lead-1', providerId: 'provider-preferred' })

    expect(result.ok).toBe(true)
    // Guard must prevent updateMany firing with an empty where clause
    expect(mockDb.dispatchDecision.updateMany).not.toHaveBeenCalled()
  })

  it('accepts the lead and returns ok: true even when post-commit payment init throws', async () => {
    mockInitializeBookingPayment.mockRejectedValueOnce(new Error('PSP timeout'))
    mockDb.lead.findUnique.mockImplementation(async (args: any) => args.include?.provider ? {
      id: 'lead-1',
      providerId: 'provider-preferred',
      jobRequestId: 'jr-generic',
      status: 'SENT',
      expiresAt: new Date(Date.now() + 60_000),
      provider: {
        id: 'provider-preferred',
        active: true,
        verified: true,
        status: 'ACTIVE',
        kycStatus: 'VERIFIED',
      },
      jobRequest: { id: 'jr-generic', status: 'OPEN', match: null },
    } : {
      id: 'lead-1',
      providerId: 'provider-preferred',
      jobRequestId: 'jr-generic',
      dispatchDecisionId: 'decision-1',
      matchAttemptId: 'attempt-1',
      expiresAt: new Date(Date.now() + 60_000),
      assignmentHoldId: 'hold-1',
      assignmentHold: { id: 'hold-1', status: 'ACTIVE' },
      matchAttempt: { id: 'attempt-1' },
    })
    mockDb.match.findUnique.mockResolvedValue(null)
    mockDb.match.create.mockResolvedValue({ id: 'match-1' })
    mockDb.jobRequest.findUniqueOrThrow.mockResolvedValue({
      ...makeJobRequest('AUTO_ASSIGN'),
      category: 'Handyman',
      customerAcceptedAmount: 850,
      customerAcceptedScope: 'Install shelves',
      autoCreateBookingOnAssignment: true,
    })
    mockDb.jobRequest.findUnique.mockResolvedValue({
      ...makeJobRequest('AUTO_ASSIGN'),
      category: 'Handyman',
      customerAcceptedAmount: 850,
      customerAcceptedScope: 'Install shelves',
      autoCreateBookingOnAssignment: true,
    })

    // Must not throw even though initializeBookingPayment rejects
    const result = await acceptAssignmentOffer({ leadId: 'lead-1', providerId: 'provider-preferred' })

    expect(result.ok).toBe(true)
    // Payment init was attempted (fire-and-forget)
    await vi.waitFor(() => expect(mockInitializeBookingPayment).toHaveBeenCalled())
  })

  it('blocks assignment acceptance when the provider has no lead credits', async () => {
    mockDb.lead.findUnique.mockImplementation(async (args: any) => args.include?.provider ? {
      id: 'lead-1',
      providerId: 'provider-preferred',
      jobRequestId: 'jr-generic',
      status: 'SENT',
      expiresAt: new Date(Date.now() + 60_000),
      provider: {
        id: 'provider-preferred',
        active: true,
        verified: true,
        status: 'ACTIVE',
        kycStatus: 'VERIFIED',
      },
      jobRequest: {
        id: 'jr-generic',
        status: 'OPEN',
        match: null,
      },
    } : {
      id: 'lead-1',
      providerId: 'provider-preferred',
      jobRequestId: 'jr-generic',
      dispatchDecisionId: 'decision-1',
      matchAttemptId: 'attempt-1',
      expiresAt: new Date(Date.now() + 60_000),
      assignmentHoldId: 'hold-1',
      assignmentHold: { id: 'hold-1', status: 'ACTIVE' },
      matchAttempt: { id: 'attempt-1' },
    })
    mockDb.providerWallet.findUnique.mockResolvedValue({
      id: 'wallet-1',
      providerId: 'provider-preferred',
      status: 'ACTIVE',
      paidCreditBalance: 0,
      promoCreditBalance: 0,
    })
    mockDb.match.findUnique.mockResolvedValue(null)

    const result = await acceptAssignmentOffer({
      leadId: 'lead-1',
      providerId: 'provider-preferred',
      source: 'whatsapp',
    })

    expect(result).toEqual({
      ok: false,
      reason: 'INSUFFICIENT_CREDITS',
      currentCreditBalance: 0,
    })
    expect(mockDb.leadUnlock.create).not.toHaveBeenCalled()
    expect(mockDb.match.create).not.toHaveBeenCalled()
    expect(mockInitializeBookingPayment).not.toHaveBeenCalled()
  })

  it('blocks assignment acceptance when the provider is not approved', async () => {
    mockDb.lead.findUnique.mockResolvedValue({
      id: 'lead-1',
      providerId: 'provider-preferred',
      jobRequestId: 'jr-generic',
      dispatchDecisionId: 'decision-1',
      matchAttemptId: 'attempt-1',
      expiresAt: new Date(Date.now() + 60_000),
      assignmentHoldId: 'hold-1',
      assignmentHold: { id: 'hold-1', status: 'ACTIVE' },
      matchAttempt: { id: 'attempt-1' },
    })
    mockDb.provider.findUnique.mockResolvedValue({
      id: 'provider-preferred',
      active: false,
      verified: false,
      status: 'APPLICATION_PENDING',
      kycStatus: 'NOT_STARTED',
    })

    const result = await acceptAssignmentOffer({
      leadId: 'lead-1',
      providerId: 'provider-preferred',
      source: 'whatsapp',
    })

    expect(result).toEqual({
      ok: false,
      reason: 'PROVIDER_NOT_APPROVED',
    })
    expect(mockDb.providerWallet.findUnique).not.toHaveBeenCalled()
    expect(mockDb.leadUnlock.create).not.toHaveBeenCalled()
    expect(mockDb.match.create).not.toHaveBeenCalled()
  })

  it('logs a manual override and still creates an assignment hold', async () => {
    mockDb.jobRequest.findUnique.mockResolvedValue(makeJobRequest('OPS_REVIEW'))
    mockDb.provider.findMany.mockResolvedValue([makeProvider('provider-preferred', 'Preferred Pro')])
    mockDb.matchAttempt.findFirst.mockResolvedValue({ id: 'attempt-override' })

    const result = await manualOverrideAssignment({
      jobRequestId: 'jr-4',
      providerId: 'provider-preferred',
      actor: { actorId: 'admin-1', actorRole: 'admin' },
      overrideReason: 'Customer asked for repeat technician',
    })

    expect(result.assignmentHoldId).toBe('hold-1')
    expect(mockDb.dispatchDecision.update).toHaveBeenCalledWith({
      where: { id: 'decision-1' },
      data: expect.objectContaining({
        status: 'OVERRIDDEN',
        selectedProviderId: 'provider-preferred',
        overrideReason: 'Customer asked for repeat technician',
      }),
    })
  })
})

function makeJobRequest(mode: 'AUTO_ASSIGN' | 'OPS_REVIEW') {
  return {
    id: 'jr-generic',
    category: 'plumbing',
    title: 'Leak',
    description: 'Kitchen leak',
    requestedWindowStart: new Date('2026-04-14T09:00:00.000Z'),
    requestedWindowEnd: new Date('2026-04-14T11:00:00.000Z'),
    requestedArrivalLatest: null,
    estimatedDurationMinutes: 90,
    requiredSkillTags: ['plumbing'],
    requiredCertificationCodes: [],
    requiredEquipmentTags: [],
    requiredVehicleTypes: [],
    preferredProviderId: 'provider-preferred',
    assignmentMode: mode,
    customerAcceptedAmount: null,
    customerAcceptedScope: null,
    autoCreateBookingOnAssignment: false,
    status: 'OPEN',
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

function makeProvider(
  id: string,
  name: string,
  overrides: Partial<ReturnType<typeof baseProvider>> = {},
) {
  return {
    ...baseProvider(id, name),
    ...overrides,
  }
}

function baseProvider(id: string, name: string) {
  return {
    id,
    name,
    phone: '+27110000000',
    active: true,
    availableNow: true,
    verified: true,
    skills: ['plumbing'],
    serviceAreas: ['Sandton'],
    averageRating: 4.8,
    reliabilityScore: 0.9,
    completedJobsCount: 30,
    onTimeRate: 0.95,
    acceptanceRate: 0.92,
    complaintCount: 0,
    complaintRate: 0,
    providerCancellationCount: 0,
    cancellationRate: 0,
    lateArrivalCount: 0,
    punctualityScore: 0.97,
    maxTravelMinutes: 90,
    lastKnownLat: null,
    lastKnownLng: null,
    lastKnownLocationLabel: null,
    lastKnownLocationAt: null,
    equipmentTags: ['plumbing-kit', 'basic-toolkit'],
    vehicleTypes: ['bakkie'],
    technicianSkills: [{ skillTag: 'plumbing' }],
    technicianCertifications: [],
    technicianServiceAreas: [{ label: 'Sandton', city: 'Johannesburg', active: true }],
    technicianAvailability: { availabilityState: 'AVAILABLE', nextAvailableAt: null, breakUntil: null },
    schedule: [{ dayOfWeek: 2, startTime: '08:00', endTime: '17:00', active: true }],
    scheduleItems: [],
    matches: [{ providerId: id }],
    jobs: [],
  }
}
