import { beforeEach, describe, expect, it, vi } from 'vitest'
import { expireAssignmentOffer } from '../../lib/matching/service'

// Acceptance hardening: createOfferForAttempt (lib/matching/service.ts) always
// sends the approved WhatsApp TEMPLATE offer (works for cold providers), but it
// historically ALSO sent two session (interactive) messages unconditionally:
//   - notifyProviderNewJob  → interactive:new_lead_available
//   - sendButtons           → interactive:new_lead_actions
// Meta rejects both with "Re-engagement message" when the provider has not
// messaged us within 24h. This suite drives the expiry → cascade →
// createOfferForAttempt path (same as matching-rotation-provider-notified.test.ts)
// and asserts the interactive extras are gated on
// hasRecentInboundWhatsappSession (lib/whatsapp-policy.ts) while the template
// send and the PROVIDER_NOTIFIED emit are untouched.

// ── Hoisted mocks ─────────────────────────────────────────────────────────────
const {
  mockDb,
  mockEmitMatchEvent,
  mockSendText,
  mockRecordWorkflowEvent,
  mockSendJobOffer,
  mockNotifyProviderNewJob,
  mockSendButtons,
  mockHasRecentInboundWhatsappSession,
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
  mockNotifyProviderNewJob: vi.fn(),
  mockSendButtons: vi.fn(),
  mockHasRecentInboundWhatsappSession: vi.fn(),
}))

vi.mock('../../lib/db', () => ({ db: mockDb }))
vi.mock('../../lib/matching/events', () => ({ emitMatchEvent: mockEmitMatchEvent }))
vi.mock('@/lib/workflow-events', () => ({ recordWorkflowEvent: mockRecordWorkflowEvent }))
vi.mock('../../lib/whatsapp-interactive', () => ({
  sendText: mockSendText,
  sendButtons: mockSendButtons,
  sendCtaUrl: vi.fn().mockResolvedValue(undefined),
}))
vi.mock(import('../../lib/whatsapp'), async (importOriginal) => ({
  ...(await importOriginal()),
  sendJobOffer: mockSendJobOffer,
}))
vi.mock(import('../../lib/whatsapp-bot'), async (importOriginal) => ({
  ...(await importOriginal()),
  notifyProviderNewJob: mockNotifyProviderNewJob,
}))
vi.mock(import('../../lib/whatsapp-policy'), async (importOriginal) => ({
  ...(await importOriginal()),
  hasRecentInboundWhatsappSession: mockHasRecentInboundWhatsappSession,
}))
vi.mock(import('../../lib/provider-lead-access'), async (importOriginal) => ({
  ...(await importOriginal()),
  getProviderLeadAccessUrl: vi.fn().mockResolvedValue('https://example.test/leads/access/token-1'),
}))
vi.mock(import('../../lib/provider-wallet'), async (importOriginal) => ({
  ...(await importOriginal()),
  getProviderWalletBalanceReadOnly: vi.fn().mockResolvedValue(5),
}))

// ── Fixtures (mirrors __tests__/lib/matching-rotation-provider-notified.test.ts) ──

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

async function driveRotationOffer() {
  mockDb.assignmentHold.findUnique.mockResolvedValue(makeActiveHold())
  mockDb.matchAttempt.findMany.mockResolvedValue([
    { id: 'attempt-2', stage: 'RANKED', rankedPosition: 2, providerId: 'provider-2', hardFilterPassed: true },
  ])
  return expireAssignmentOffer({ assignmentHoldId: 'hold-1' })
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('rotation offer 24h-session-window gate for interactive extras', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockSendText.mockResolvedValue(undefined)
    mockSendJobOffer.mockResolvedValue(undefined)
    mockSendButtons.mockResolvedValue(undefined)
    mockNotifyProviderNewJob.mockResolvedValue(undefined)
    setupBaseTransaction()
  })

  it('skips both interactive sends when the provider is outside the 24h window', async () => {
    mockHasRecentInboundWhatsappSession.mockResolvedValue(false)

    const result = await driveRotationOffer()

    expect(result.expired).toBe(true)
    expect(result.nextOfferedProviderId).toBe('provider-2')

    // Template offer still goes out — it is the delivery guarantee.
    expect(mockSendJobOffer).toHaveBeenCalledTimes(1)
    // Interactive session messages are suppressed for cold providers.
    expect(mockNotifyProviderNewJob).not.toHaveBeenCalled()
    expect(mockSendButtons).not.toHaveBeenCalled()

    // PROVIDER_NOTIFIED funnel emit is untouched.
    expect(mockRecordWorkflowEvent).toHaveBeenCalledTimes(1)
    expect(mockRecordWorkflowEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: 'PROVIDER_NOTIFIED',
        entityType: 'LEAD',
        entityId: 'lead-new',
        metadata: expect.objectContaining({
          providerId: 'provider-2',
          interactiveSuppressed: true,
        }),
      })
    )
  })

  it('sends both interactive extras when the provider is inside the 24h window', async () => {
    mockHasRecentInboundWhatsappSession.mockResolvedValue(true)

    const result = await driveRotationOffer()

    expect(result.expired).toBe(true)
    expect(mockSendJobOffer).toHaveBeenCalledTimes(1)
    expect(mockNotifyProviderNewJob).toHaveBeenCalledTimes(1)
    expect(mockSendButtons).toHaveBeenCalledTimes(1)

    expect(mockRecordWorkflowEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: 'PROVIDER_NOTIFIED',
        metadata: expect.objectContaining({ interactiveSuppressed: false }),
      })
    )
  })

  it('treats a window-check failure as outside the window and does not throw', async () => {
    mockHasRecentInboundWhatsappSession.mockRejectedValue(new Error('db unavailable'))

    const result = await driveRotationOffer()

    expect(result.expired).toBe(true)
    expect(result.nextOfferedProviderId).toBe('provider-2')

    expect(mockSendJobOffer).toHaveBeenCalledTimes(1)
    expect(mockNotifyProviderNewJob).not.toHaveBeenCalled()
    expect(mockSendButtons).not.toHaveBeenCalled()
    expect(mockRecordWorkflowEvent).toHaveBeenCalledTimes(1)
  })
})
