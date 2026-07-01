import { beforeEach, describe, expect, it, vi } from 'vitest'
import { expireAssignmentOffer } from '../../lib/matching/service'

// Tier 1 funnel observability regression: the rotation/re-offer engine
// (createOfferForAttempt in lib/matching/service.ts) sends the provider a
// WhatsApp lead offer but historically emitted NO workflow event, so rotated
// offers were invisible in the PROVIDER_NOTIFIED funnel. This suite drives
// the expiry → cascade → createOfferForAttempt happy path and asserts the
// PROVIDER_NOTIFIED emit, mirroring the initial-dispatch emit in
// lib/matching/dispatch.ts.

// ── Hoisted mocks ─────────────────────────────────────────────────────────────
const {
  mockDb,
  mockEmitMatchEvent,
  mockSendText,
  mockRecordWorkflowEvent,
  mockSendJobOffer,
} = vi.hoisted(() => ({
  mockDb: {
    $transaction: vi.fn(),
    $queryRaw: vi.fn(),
    assignmentHold: {
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      findMany: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
      create: vi.fn(),
      count: vi.fn(),
    },
    lead: {
      findUnique: vi.fn(),
      updateMany: vi.fn(),
      update: vi.fn(),
      upsert: vi.fn(),
    },
    matchAttempt: {
      findMany: vi.fn(),
      update: vi.fn(),
      create: vi.fn(),
      findFirst: vi.fn(),
      count: vi.fn(),
    },
    dispatchDecision: {
      update: vi.fn(),
      findFirst: vi.fn(),
      create: vi.fn(),
    },
    jobRequest: {
      findUnique: vi.fn(),
      findUniqueOrThrow: vi.fn(),
      findMany: vi.fn(),
      update: vi.fn(),
    },
    provider: {
      findUnique: vi.fn(),
      findUniqueOrThrow: vi.fn(),
      update: vi.fn(),
    },
    providerCapacity: {
      findUnique: vi.fn(),
      findMany: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
      upsert: vi.fn(),
    },
    technicianAvailability: {
      upsert: vi.fn(),
    },
    technicianScheduleItem: {
      deleteMany: vi.fn(),
      updateMany: vi.fn(),
      create: vi.fn(),
    },
    scheduleItem: {
      updateMany: vi.fn(),
    },
    messageEvent: {
      findFirst: vi.fn(),
    },
  },
  mockEmitMatchEvent: vi.fn(),
  mockSendText: vi.fn(),
  mockRecordWorkflowEvent: vi.fn(),
  mockSendJobOffer: vi.fn(),
}))

vi.mock('../../lib/db', () => ({ db: mockDb }))
vi.mock('../../lib/matching/events', () => ({ emitMatchEvent: mockEmitMatchEvent }))
vi.mock('@/lib/workflow-events', () => ({ recordWorkflowEvent: mockRecordWorkflowEvent }))
vi.mock('../../lib/whatsapp-interactive', () => ({
  sendText: mockSendText,
  sendButtons: vi.fn().mockResolvedValue(undefined),
  sendCtaUrl: vi.fn().mockResolvedValue(undefined),
}))
vi.mock(import('../../lib/whatsapp'), async (importOriginal) => ({
  ...(await importOriginal()),
  sendJobOffer: mockSendJobOffer,
}))
vi.mock(import('../../lib/whatsapp-bot'), async (importOriginal) => ({
  ...(await importOriginal()),
  notifyProviderNewJob: vi.fn().mockResolvedValue(undefined),
}))
vi.mock(import('../../lib/provider-lead-access'), async (importOriginal) => ({
  ...(await importOriginal()),
  getProviderLeadAccessUrl: vi.fn().mockResolvedValue('https://example.test/leads/access/token-1'),
}))
vi.mock(import('../../lib/provider-wallet'), async (importOriginal) => ({
  ...(await importOriginal()),
  getProviderWalletBalanceReadOnly: vi.fn().mockResolvedValue(5),
}))

// ── Fixtures (mirrors __tests__/lib/matching-expiry.test.ts) ─────────────────

function makeActiveHold() {
  return {
    id: 'hold-1',
    status: 'ACTIVE',
    expiresAt: new Date(Date.now() - 1_000), // already expired
    matchAttemptId: 'attempt-1',
    dispatchDecisionId: 'decision-1',
    jobRequestId: 'job-1',
    providerId: 'provider-1',
    provider: { phone: '+27764010810', name: 'Fannie Provider' },
    jobRequest: {
      category: 'Handyman',
      address: { street: '42 Oak Avenue', suburb: 'ruimsig', city: 'johannesburg' },
    },
  }
}

function makeMatchingJobRequest() {
  return {
    id: 'job-1',
    customerId: 'customer-1',
    category: 'electrical',
    title: 'Fix lights',
    description: null,
    requestedWindowStart: null,
    requestedWindowEnd: null,
    requestedArrivalLatest: null,
    estimatedDurationMinutes: 60,
    requiredSkillTags: [],
    requiredCertificationCodes: [],
    requiredEquipmentTags: [],
    requiredVehicleTypes: [],
    preferredProviderId: null,
    assignmentMode: 'AUTO_ASSIGN',
    customerAcceptedAmount: null,
    customerAcceptedScope: null,
    autoCreateBookingOnAssignment: false,
    customerNoMatchNotifiedAt: null,
    customerRematchCheckSentAt: null,
    customerRematchCheckRespondedAt: null,
    customerRematchCheckOutcome: null,
    dispatchDecisions: [],
    status: 'MATCHING',
    customer: { id: 'customer-1', name: 'Bob', phone: '+27831234567' },
    address: {
      street: '1 Main St',
      suburb: 'Sandton',
      city: 'Johannesburg',
      province: 'Gauteng',
      lat: -26.1,
      lng: 28.05,
      locationNodeId: null,
      locationNode: null,
    },
  }
}

function setupBaseTransaction() {
  mockDb.$transaction.mockImplementation(async (callback: (tx: typeof mockDb) => unknown) =>
    callback(mockDb as any)
  )
  mockDb.assignmentHold.update.mockResolvedValue({})
  mockDb.assignmentHold.updateMany.mockResolvedValue({ count: 0 })
  mockDb.assignmentHold.create.mockResolvedValue({
    id: 'hold-new',
    expiresAt: new Date(Date.now() + 15 * 60_000),
  })
  mockDb.assignmentHold.count.mockResolvedValue(0)
  mockDb.assignmentHold.findMany.mockResolvedValue([])
  // Rotation eligibility gate (reserveRotationCandidateAtomically): provider is
  // lockable, holds no active offer, is under capacity and the job is negotiable.
  mockDb.assignmentHold.findFirst.mockResolvedValue(null)
  mockDb.$queryRaw.mockResolvedValue([{ id: 'provider-2' }])
  mockDb.providerCapacity.findUnique.mockResolvedValue({ activeHolds: 0, maxConcurrent: 2 })
  mockDb.providerCapacity.upsert.mockResolvedValue({})
  mockDb.lead.findUnique.mockResolvedValue(null)
  mockDb.lead.updateMany.mockResolvedValue({ count: 1 })
  mockDb.lead.update.mockResolvedValue({})
  mockDb.lead.upsert.mockResolvedValue({ id: 'lead-new' })
  mockDb.matchAttempt.update.mockResolvedValue({})
  mockDb.technicianScheduleItem.updateMany.mockResolvedValue({ count: 0 })
  mockDb.technicianScheduleItem.deleteMany.mockResolvedValue({ count: 0 })
  mockDb.technicianScheduleItem.create.mockResolvedValue({})
  mockDb.matchAttempt.count.mockResolvedValue(1)
  mockDb.messageEvent.findFirst.mockResolvedValue(null)
  mockDb.dispatchDecision.update.mockResolvedValue({})
  mockDb.jobRequest.update.mockResolvedValue({})
  // loadMatchingJobRequest inside createOfferForAttempt
  mockDb.jobRequest.findUnique.mockResolvedValue(makeMatchingJobRequest())
  // loadProviderOfferContact inside createOfferForAttempt
  mockDb.provider.findUniqueOrThrow.mockResolvedValue({
    id: 'provider-2', name: 'Bob', phone: '+27829876543',
    availableNow: true, serviceAreas: [], skills: [],
  })
  mockDb.provider.update.mockResolvedValue({
    id: 'provider-1',
    name: 'Seth',
    phone: '+27764010810',
  })
  mockDb.technicianAvailability.upsert.mockResolvedValue({})
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('rotation re-offer PROVIDER_NOTIFIED workflow event', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockSendText.mockResolvedValue(undefined)
    mockSendJobOffer.mockResolvedValue(undefined)
    setupBaseTransaction()
  })

  it('emits PROVIDER_NOTIFIED once when the rotation cascade offers the next candidate', async () => {
    mockDb.assignmentHold.findUnique.mockResolvedValue(makeActiveHold())
    mockDb.matchAttempt.findMany.mockResolvedValue([
      { id: 'attempt-2', stage: 'RANKED', rankedPosition: 2, providerId: 'provider-2', hardFilterPassed: true },
    ])

    const result = await expireAssignmentOffer({ assignmentHoldId: 'hold-1' })

    expect(result.expired).toBe(true)
    expect(result.nextOfferedProviderId).toBe('provider-2')

    expect(mockRecordWorkflowEvent).toHaveBeenCalledTimes(1)
    expect(mockRecordWorkflowEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: 'PROVIDER_NOTIFIED',
        entityType: 'LEAD',
        entityId: 'lead-new',
        metadata: expect.objectContaining({
          providerId: 'provider-2',
          jobRequestId: 'job-1',
        }),
      })
    )

    // PII guard: metadata must carry internal ids only — never phone/name keys.
    const metadata = mockRecordWorkflowEvent.mock.calls[0][0].metadata as Record<string, unknown>
    for (const forbidden of ['phone', 'phoneNumber', 'name', 'providerName', 'customerName', 'email']) {
      expect(metadata).not.toHaveProperty(forbidden)
    }
  })
})
