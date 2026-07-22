import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  expireAssignmentOffer,
  processPendingAssignmentWorkflows,
  reconcileStaleAssignmentState,
  sendQuickMatchProgressUpdates,
} from '../../lib/matching/service'
import { notifyExpiredJobParties } from '../../lib/matching/customer-recontact'

// ── Hoisted mocks ─────────────────────────────────────────────────────────────
const { mockDb, mockEmitMatchEvent, mockSendText, mockSendProviderLeadExpired } = vi.hoisted(() => ({
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
    providerShortlist: {
      findFirst: vi.fn(),
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
    inboundWhatsAppMessage: {
      findFirst: vi.fn(),
    },
  },
  mockEmitMatchEvent: vi.fn(),
  mockSendText: vi.fn(),
  mockSendProviderLeadExpired: vi.fn(),
}))

vi.mock('../../lib/db', () => ({ db: mockDb }))
vi.mock('../../lib/matching/events', () => ({ emitMatchEvent: mockEmitMatchEvent }))
vi.mock('../../lib/whatsapp-interactive', () => ({
  sendText: mockSendText,
  sendButtons: vi.fn().mockResolvedValue(undefined),
  sendCtaUrl: vi.fn().mockResolvedValue(undefined),
}))
vi.mock(import('../../lib/whatsapp'), async (importOriginal) => ({
  ...(await importOriginal()),
  sendProviderLeadExpired: mockSendProviderLeadExpired,
}))

// ── Fixtures ──────────────────────────────────────────────────────────────────

function makeActiveHold(overrides: Partial<Record<string, unknown>> & Partial<{
  id: string
  status: string
  expiresAt: Date
  matchAttemptId: string
  dispatchDecisionId: string
  jobRequestId: string
  providerId: string
}> = {}) {
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
    ...overrides,
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
  mockDb.lead.updateMany.mockResolvedValue({ count: 1 })
  mockDb.lead.update.mockResolvedValue({})
  mockDb.lead.upsert.mockResolvedValue({ id: 'lead-new' })
  mockDb.matchAttempt.update.mockResolvedValue({})
  mockDb.technicianScheduleItem.updateMany.mockResolvedValue({ count: 0 })
  mockDb.technicianScheduleItem.deleteMany.mockResolvedValue({ count: 0 })
  mockDb.technicianScheduleItem.create.mockResolvedValue({})
  mockDb.matchAttempt.count.mockResolvedValue(1)
  mockDb.messageEvent.findFirst.mockResolvedValue(null)
  // Default: outside the 24h window (no recent inbound WhatsApp message).
  mockDb.inboundWhatsAppMessage.findFirst.mockResolvedValue(null)
  mockDb.dispatchDecision.update.mockResolvedValue({})
  mockDb.jobRequest.update.mockResolvedValue({})
  // loadMatchingJobRequest inside createOfferForAttempt
  mockDb.jobRequest.findUnique.mockResolvedValue(makeMatchingJobRequest())
  // I5: notifyCustomerNoMatch's PUBLISHED-shortlist check. Default no
  // shortlist so existing genuine-no-match-copy assertions are unaffected;
  // tests that need the shortlist-closed copy override this explicitly.
  mockDb.providerShortlist.findFirst.mockResolvedValue(null)
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

describe('expireAssignmentOffer', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.env.PROVIDER_LEAD_ACCESS_SECRET = 'test-provider-lead-secret'
    mockSendText.mockResolvedValue(undefined)
    mockSendProviderLeadExpired.mockResolvedValue('wamid.lead-expired')
    setupBaseTransaction()
  })

  it('returns expired:false when hold is not found', async () => {
    mockDb.assignmentHold.findUnique.mockResolvedValue(null)

    const result = await expireAssignmentOffer({ assignmentHoldId: 'hold-unknown' })

    expect(result.expired).toBe(false)
    expect(result.nextOfferedProviderId).toBeNull()
  })

  it('returns expired:false when hold is already resolved (ACCEPTED)', async () => {
    mockDb.assignmentHold.findUnique.mockResolvedValue(
      makeActiveHold({ status: 'ACCEPTED', expiresAt: new Date(Date.now() - 1_000) })
    )

    const result = await expireAssignmentOffer({ assignmentHoldId: 'hold-1' })

    expect(result.expired).toBe(false)
  })

  it('returns expired:false when hold has not yet expired', async () => {
    mockDb.assignmentHold.findUnique.mockResolvedValue(
      makeActiveHold({ expiresAt: new Date(Date.now() + 5 * 60_000) })
    )

    const result = await expireAssignmentOffer({ assignmentHoldId: 'hold-1' })

    expect(result.expired).toBe(false)
  })

  it('expires the hold and cascades to next ranked candidate', async () => {
    mockDb.assignmentHold.findUnique.mockResolvedValue(makeActiveHold())
    mockDb.matchAttempt.findMany.mockResolvedValue([
      { id: 'attempt-2', stage: 'RANKED', rankedPosition: 2, providerId: 'provider-2', hardFilterPassed: true },
    ])

    const result = await expireAssignmentOffer({ assignmentHoldId: 'hold-1' })

    expect(result.expired).toBe(true)
    expect(result.nextOfferedProviderId).toBe('provider-2')
    expect(mockEmitMatchEvent).toHaveBeenCalledWith(
      expect.objectContaining({ event: 'match.hold_expired', holdId: 'hold-1', cascaded: true })
    )
    expect(mockEmitMatchEvent).toHaveBeenCalledWith(
      expect.objectContaining({ event: 'match.rematch', jobRequestId: 'job-1' })
    )
  })

  it('notifies the timed-out provider once when an active sent lead expires and is reoffered', async () => {
    mockDb.assignmentHold.findUnique.mockResolvedValue(makeActiveHold())
    mockDb.matchAttempt.findMany.mockResolvedValue([
      { id: 'attempt-2', stage: 'RANKED', rankedPosition: 2, providerId: 'provider-2', hardFilterPassed: true },
    ])

    await expireAssignmentOffer({ assignmentHoldId: 'hold-1' })

    // Template-first: the UTILITY template reaches cold providers outside the
    // 24h window; the freeform interactive:lead_expired text is fallback-only.
    expect(mockSendProviderLeadExpired).toHaveBeenCalledTimes(1)
    expect(mockSendProviderLeadExpired).toHaveBeenCalledWith(expect.objectContaining({
      to: '+27764010810',
      firstName: 'Fannie',
      service: 'Handyman',
      area: 'Ruimsig, Johannesburg',
      metadata: expect.objectContaining({
        assignmentHoldId: 'hold-1',
        jobRequestId: 'job-1',
        providerId: 'provider-1',
        wasReassigned: true,
      }),
    }))
    // The street address must never leak into the notification.
    expect(mockSendProviderLeadExpired).not.toHaveBeenCalledWith(
      expect.objectContaining({ area: expect.stringContaining('42 Oak Avenue') }),
    )
    expect(mockSendText).not.toHaveBeenCalledWith(
      '+27764010810',
      expect.stringContaining('Lead expired'),
      expect.anything(),
    )
  })

  it('falls back to the freeform lead-expired text only when the template is unapproved and the provider is inside the 24h window', async () => {
    mockDb.assignmentHold.findUnique.mockResolvedValue(makeActiveHold())
    mockDb.matchAttempt.findMany.mockResolvedValue([
      { id: 'attempt-2', stage: 'RANKED', rankedPosition: 2, providerId: 'provider-2', hardFilterPassed: true },
    ])
    mockSendProviderLeadExpired.mockRejectedValue(
      new Error('[TEMPLATE_NOT_APPROVED] Template "provider_lead_expired" is not approved or does not exist in Meta Business Manager. Approve it before deploying. code=132000')
    )
    // hasRecentInboundWhatsappSession (real implementation) consults this table.
    mockDb.inboundWhatsAppMessage.findFirst.mockResolvedValue({ id: 'inb-recent' })

    await expireAssignmentOffer({ assignmentHoldId: 'hold-1' })

    expect(mockSendText).toHaveBeenCalledWith(
      '+27764010810',
      expect.stringContaining('Lead expired'),
      expect.objectContaining({
        templateName: 'interactive:lead_expired',
        metadata: expect.objectContaining({
          assignmentHoldId: 'hold-1',
          jobRequestId: 'job-1',
          providerId: 'provider-1',
          wasReassigned: true,
        }),
      }),
    )
    expect(mockSendText).toHaveBeenCalledWith(
      '+27764010810',
      expect.stringContaining('No credits were used'),
      expect.anything(),
    )
    expect(mockSendText).toHaveBeenCalledWith(
      '+27764010810',
      expect.stringContaining('This lead has now been offered to another provider.'),
      expect.anything(),
    )
    expect(mockSendText).toHaveBeenCalledWith(
      '+27764010810',
      expect.stringContaining('Handyman lead in Ruimsig, Johannesburg'),
      expect.anything(),
    )
    expect(mockSendText).not.toHaveBeenCalledWith(
      expect.any(String),
      expect.stringContaining('42 Oak Avenue'),
      expect.anything(),
    )
  })

  it('sends nothing when the template is unapproved and the provider is outside the 24h window', async () => {
    mockDb.assignmentHold.findUnique.mockResolvedValue(makeActiveHold())
    mockDb.matchAttempt.findMany.mockResolvedValue([
      { id: 'attempt-2', stage: 'RANKED', rankedPosition: 2, providerId: 'provider-2', hardFilterPassed: true },
    ])
    mockSendProviderLeadExpired.mockRejectedValue(
      new Error('[TEMPLATE_NOT_APPROVED] Template "provider_lead_expired" is not approved or does not exist in Meta Business Manager. Approve it before deploying. code=132000')
    )
    mockDb.inboundWhatsAppMessage.findFirst.mockResolvedValue(null)

    const result = await expireAssignmentOffer({ assignmentHoldId: 'hold-1' })

    expect(result.expired).toBe(true)
    expect(mockSendText).not.toHaveBeenCalledWith(
      '+27764010810',
      expect.stringContaining('Lead expired'),
      expect.anything(),
    )
  })

  it('does not send a duplicate expiry notification when one was already logged', async () => {
    mockDb.assignmentHold.findUnique.mockResolvedValue(makeActiveHold())
    mockDb.matchAttempt.findMany.mockResolvedValue([
      { id: 'attempt-2', stage: 'RANKED', rankedPosition: 2, providerId: 'provider-2', hardFilterPassed: true },
    ])
    mockDb.messageEvent.findFirst.mockResolvedValue({ id: 'message-1' })

    await expireAssignmentOffer({ assignmentHoldId: 'hold-1' })

    expect(mockSendText).not.toHaveBeenCalledWith(
      '+27764010810',
      expect.stringContaining('Lead expired'),
      expect.anything(),
    )
  })

  it('does not notify expiry when no sent or viewed lead was expired', async () => {
    mockDb.assignmentHold.findUnique.mockResolvedValue(makeActiveHold())
    mockDb.lead.updateMany.mockResolvedValue({ count: 0 })
    mockDb.matchAttempt.findMany.mockResolvedValue([
      { id: 'attempt-2', stage: 'RANKED', rankedPosition: 2, providerId: 'provider-2', hardFilterPassed: true },
    ])

    await expireAssignmentOffer({ assignmentHoldId: 'hold-1' })

    expect(mockSendText).not.toHaveBeenCalledWith(
      '+27764010810',
      expect.stringContaining('Lead expired'),
      expect.anything(),
    )
  })

  it('expires the hold and terminates Quick Match when no next candidate remains', async () => {
    mockDb.assignmentHold.findUnique.mockResolvedValue(makeActiveHold())
    // No RANKED attempts remaining
    mockDb.matchAttempt.findMany.mockResolvedValue([])
    mockDb.provider.findUnique.mockResolvedValue({ phone: '+27821234567' })
    // First call (inside expireOpenJobRequest tx) sees MATCHING → transitions it.
    // Subsequent calls (notifyExpiredJobParties) see EXPIRED → sends notifications.
    mockDb.jobRequest.findUnique
      .mockResolvedValueOnce(makeMatchingJobRequest())
      .mockResolvedValue({ ...makeMatchingJobRequest(), status: 'EXPIRED' })

    const result = await expireAssignmentOffer({ assignmentHoldId: 'hold-1' })

    expect(result.expired).toBe(true)
    expect(result.nextOfferedProviderId).toBeNull()
    expect(mockDb.jobRequest.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'EXPIRED' }) })
    )
    expect(mockEmitMatchEvent).toHaveBeenCalledWith(
      expect.objectContaining({ event: 'match.exhausted', jobRequestId: 'job-1' })
    )
    expect(mockSendText).toHaveBeenCalledWith(
      '+27831234567',
      expect.stringContaining('Thank you for trying Plug A Pro.'),
      expect.objectContaining({
        templateName: 'interactive:job_request_no_match',
        metadata: expect.objectContaining({ jobRequestId: 'job-1', hasFutureWindow: false }),
      })
    )
  })

  it('tells the customer we will recheck if their requested time is still in the future', async () => {
    mockDb.assignmentHold.findUnique.mockResolvedValue(makeActiveHold())
    mockDb.matchAttempt.findMany.mockResolvedValue([])
    mockDb.provider.findUnique.mockResolvedValue({ phone: '+27821234567' })
    const futureWindow = {
      requestedWindowStart: new Date(Date.now() + 2 * 60 * 60 * 1000),
      requestedWindowEnd: new Date(Date.now() + 4 * 60 * 60 * 1000),
    }
    // First call (inside expireOpenJobRequest tx) sees MATCHING → transitions it.
    // Subsequent calls (notifyExpiredJobParties) see EXPIRED with future window.
    mockDb.jobRequest.findUnique
      .mockResolvedValueOnce({ ...makeMatchingJobRequest(), ...futureWindow })
      .mockResolvedValue({ ...makeMatchingJobRequest(), status: 'EXPIRED', ...futureWindow })

    await expireAssignmentOffer({ assignmentHoldId: 'hold-1' })

    expect(mockSendText).toHaveBeenCalledWith(
      '+27831234567',
      expect.stringContaining('we will message you if a suitable provider becomes available in time'),
      expect.objectContaining({
        metadata: expect.objectContaining({ hasFutureWindow: true }),
      })
    )
  })

  it('uses latest no-match primaryReason to explain area unavailability', async () => {
    mockDb.jobRequest.findUnique.mockResolvedValue({
      ...makeMatchingJobRequest(),
      status: 'EXPIRED',
      dispatchDecisions: [{ failureClass: 'EMPTY_POOL', primaryReason: 'NO_LOCATION_MATCH' }],
    })

    await notifyExpiredJobParties({ jobRequestId: 'job-1' })

    expect(mockSendText).toHaveBeenCalledWith(
      '+27831234567',
      expect.stringContaining('Plug A Pro is not available in Sandton, Johannesburg yet'),
      expect.objectContaining({
        templateName: 'interactive:job_request_no_match',
        metadata: expect.objectContaining({
          jobRequestId: 'job-1',
          primaryReason: 'NO_LOCATION_MATCH',
        }),
      }),
    )
  })

  it('uses outside-service-area primaryReason to explain area unavailability', async () => {
    mockDb.jobRequest.findUnique.mockResolvedValue({
      ...makeMatchingJobRequest(),
      status: 'EXPIRED',
      dispatchDecisions: [{ failureClass: 'STRUCTURAL', primaryReason: 'OUTSIDE_SERVICE_AREA' }],
    })

    await notifyExpiredJobParties({ jobRequestId: 'job-1' })

    expect(mockSendText).toHaveBeenCalledWith(
      '+27831234567',
      expect.stringContaining('Plug A Pro is not available in Sandton, Johannesburg yet'),
      expect.objectContaining({
        templateName: 'interactive:job_request_no_match',
        metadata: expect.objectContaining({
          primaryReason: 'OUTSIDE_SERVICE_AREA',
        }),
      }),
    )
  })

  it('marks lead as EXPIRED in the same transaction as the hold', async () => {
    mockDb.assignmentHold.findUnique.mockResolvedValue(makeActiveHold())
    mockDb.matchAttempt.findMany.mockResolvedValue([])
    mockDb.provider.findUnique.mockResolvedValue(null)

    await expireAssignmentOffer({ assignmentHoldId: 'hold-1' })

    expect(mockDb.lead.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ assignmentHoldId: 'hold-1' }),
        data: expect.objectContaining({ status: 'EXPIRED' }),
      })
    )
  })

  it('includes INTERESTED leads in expiry sweep (dispatch_v2 regression)', async () => {
    // G1 regression: leads in INTERESTED status (Qualified Shortlist Model) must
    // be transitioned to EXPIRED when the assignment hold times out.
    // Previously the filter was { in: ['SENT', 'VIEWED'] }, which silently skipped
    // INTERESTED leads, leaving stale status in the DB.
    mockDb.assignmentHold.findUnique.mockResolvedValue(makeActiveHold())
    mockDb.matchAttempt.findMany.mockResolvedValue([])
    mockDb.provider.findUnique.mockResolvedValue(null)

    await expireAssignmentOffer({ assignmentHoldId: 'hold-1' })

    const leadUpdateCall = mockDb.lead.updateMany.mock.calls.find(
      (call: unknown[]) =>
        call[0] &&
        typeof call[0] === 'object' &&
        'where' in (call[0] as Record<string, unknown>) &&
        'data' in (call[0] as Record<string, unknown>)
    )
    expect(leadUpdateCall).toBeDefined()
    const where = (leadUpdateCall![0] as { where: { status: { in: string[] } } }).where
    expect(where.status?.in).toContain('INTERESTED')
    expect(where.status?.in).toContain('SENT')
    expect(where.status?.in).toContain('VIEWED')
  })

  it('temporarily auto-pauses a provider after three consecutive offer timeouts', async () => {
    mockDb.assignmentHold.findUnique.mockResolvedValue(makeActiveHold({ providerId: 'provider-timeout' }))
    mockDb.assignmentHold.count.mockResolvedValue(3)
    // First findMany: timeout holds (with distinct customers so the abuse guard passes).
    // Second findMany: recent resolved holds for the consecutive-timeout check.
    mockDb.assignmentHold.findMany
      .mockResolvedValueOnce([
        { jobRequest: { customerId: 'customer-a' } },
        { jobRequest: { customerId: 'customer-b' } },
        { jobRequest: { customerId: 'customer-c' } },
      ])
      .mockResolvedValueOnce([
        { status: 'EXPIRED', outcomeReasonCode: 'OFFER_TIMEOUT' },
        { status: 'EXPIRED', outcomeReasonCode: 'OFFER_TIMEOUT' },
        { status: 'EXPIRED', outcomeReasonCode: 'OFFER_TIMEOUT' },
      ])
    mockDb.matchAttempt.findMany.mockResolvedValue([])
    mockDb.provider.findUnique.mockResolvedValue(null)
    mockDb.provider.update.mockResolvedValue({
      id: 'provider-timeout',
      name: 'Seth Timeout',
      phone: '+27764010810',
    })

    await expireAssignmentOffer({ assignmentHoldId: 'hold-1' })

    expect(mockDb.provider.update).toHaveBeenCalledWith({
      where: { id: 'provider-timeout' },
      data: expect.objectContaining({ updatedAt: expect.any(Date) }),
      select: { id: true, phone: true, name: true },
    })
    expect(mockDb.provider.update).not.toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ availableNow: false }) }),
    )
    expect(mockDb.technicianAvailability.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { providerId: 'provider-timeout' },
        create: expect.objectContaining({
          availabilityState: 'PAUSED',
          breakUntil: expect.any(Date),
        }),
        update: expect.objectContaining({
          availabilityState: 'PAUSED',
          breakUntil: expect.any(Date),
        }),
      }),
    )
    expect(mockSendText).toHaveBeenCalledWith(
      '+27764010810',
      expect.stringContaining('Leads paused for 12 hours'),
      expect.objectContaining({
        templateName: 'interactive:provider_auto_paused_timeout',
        metadata: expect.objectContaining({
          providerId: 'provider-timeout',
          timeoutCount: 3,
          pauseType: 'temporary',
        }),
      }),
    )
    expect(mockEmitMatchEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'provider.auto_paused',
        providerId: 'provider-timeout',
        reason: 'consecutive_offer_timeouts',
        pauseType: 'temporary',
      }),
    )
  })

  it('hard-pauses a provider after six recent offer timeouts', async () => {
    mockDb.assignmentHold.findUnique.mockResolvedValue(makeActiveHold({ providerId: 'provider-hard-timeout' }))
    mockDb.assignmentHold.count.mockResolvedValue(6)
    // First findMany: 6 timeout holds across distinct customers (abuse guard passes,
    // hard-pause threshold met). Second findMany: recent resolved holds (mixed).
    mockDb.assignmentHold.findMany
      .mockResolvedValueOnce([
        { jobRequest: { customerId: 'customer-a' } },
        { jobRequest: { customerId: 'customer-b' } },
        { jobRequest: { customerId: 'customer-c' } },
        { jobRequest: { customerId: 'customer-d' } },
        { jobRequest: { customerId: 'customer-e' } },
        { jobRequest: { customerId: 'customer-f' } },
      ])
      .mockResolvedValueOnce([
        { status: 'REJECTED', outcomeReasonCode: 'TECHNICIAN_REJECTED_OFFER' },
        { status: 'EXPIRED', outcomeReasonCode: 'OFFER_TIMEOUT' },
        { status: 'EXPIRED', outcomeReasonCode: 'OFFER_TIMEOUT' },
      ])
    mockDb.matchAttempt.findMany.mockResolvedValue([])
    mockDb.provider.findUnique.mockResolvedValue(null)
    mockDb.provider.update.mockResolvedValue({
      id: 'provider-hard-timeout',
      name: 'Seth Timeout',
      phone: '+27764010810',
    })

    await expireAssignmentOffer({ assignmentHoldId: 'hold-1' })

    expect(mockDb.provider.update).toHaveBeenCalledWith({
      where: { id: 'provider-hard-timeout' },
      data: expect.objectContaining({ availableNow: false }),
      select: { id: true, phone: true, name: true },
    })
    expect(mockDb.technicianAvailability.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({ availabilityState: 'PAUSED', breakUntil: null }),
        update: expect.objectContaining({ availabilityState: 'PAUSED', breakUntil: null }),
      }),
    )
    expect(mockSendText).toHaveBeenCalledWith(
      '+27764010810',
      expect.stringContaining('Leads paused'),
      expect.objectContaining({
        metadata: expect.objectContaining({ pauseType: 'hard', timeoutCount: 6 }),
      }),
    )
    expect(mockEmitMatchEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'provider.auto_paused',
        providerId: 'provider-hard-timeout',
        reason: 'repeated_offer_timeouts_hard',
        pauseType: 'hard',
      }),
    )
  })

  it('does not auto-pause a provider below the timeout threshold', async () => {
    mockDb.assignmentHold.findUnique.mockResolvedValue(makeActiveHold({ providerId: 'provider-ok' }))
    mockDb.assignmentHold.count.mockResolvedValue(2)
    mockDb.assignmentHold.findMany.mockResolvedValue([
      { status: 'EXPIRED', outcomeReasonCode: 'OFFER_TIMEOUT' },
      { status: 'EXPIRED', outcomeReasonCode: 'OFFER_TIMEOUT' },
    ])
    mockDb.matchAttempt.findMany.mockResolvedValue([])
    mockDb.provider.findUnique.mockResolvedValue(null)

    await expireAssignmentOffer({ assignmentHoldId: 'hold-1' })

    expect(mockDb.provider.update).not.toHaveBeenCalled()
    expect(mockDb.technicianAvailability.upsert).not.toHaveBeenCalled()
    expect(mockSendText).not.toHaveBeenCalledWith(
      expect.any(String),
      expect.stringContaining('Leads paused'),
      expect.anything(),
    )
  })
})

// ── Quick Match customer progress updates ────────────────────────────────────

describe('sendQuickMatchProgressUpdates', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    setupBaseTransaction()
    mockSendText.mockResolvedValue(undefined)
  })

  it('sends a customer progress update for active Quick Match requests with no recent update', async () => {
    mockDb.jobRequest.findMany.mockResolvedValue([
      {
        id: 'job-1',
        category: 'DIY & Assembly',
        urgency: 'urgent',
        isTestRequest: true,
        cohortName: 'internal_staff_test',
        customer: { phone: '+27773923802', isTestUser: true },
        assignmentHolds: [{ id: 'hold-1' }],
        dispatchDecisions: [{ failureClass: 'TRANSIENT', primaryReason: 'RESERVATION_FAILED' }],
      },
    ])
    mockDb.messageEvent.findFirst.mockResolvedValue(null)

    const result = await sendQuickMatchProgressUpdates()

    expect(result.sent).toBe(1)
    expect(mockSendText).toHaveBeenCalledWith(
      '+27773923802',
      expect.stringContaining('Quick Match is still checking providers'),
      expect.objectContaining({
        templateName: 'interactive:quick_match_progress_update',
        metadata: expect.objectContaining({
          jobRequestId: 'job-1',
          isTestRequest: true,
          recipientIsTest: true,
        }),
      }),
    )
  })

  it('skips the customer progress update when one was sent inside the urgency interval', async () => {
    const now = new Date('2026-06-06T10:00:00.000Z')
    mockDb.jobRequest.findMany.mockResolvedValue([
      {
        id: 'job-1',
        category: 'DIY & Assembly',
        urgency: 'within_24h',
        isTestRequest: false,
        cohortName: null,
        customer: { phone: '+27773923802', isTestUser: false },
        assignmentHolds: [{ id: 'hold-1' }],
        dispatchDecisions: [],
      },
    ])
    mockDb.messageEvent.findFirst.mockResolvedValue({ id: 'message-1' })

    const result = await sendQuickMatchProgressUpdates(now)

    expect(result.sent).toBe(0)
    expect(result.skippedRecent).toBe(1)
    expect(mockDb.messageEvent.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          createdAt: { gte: new Date('2026-06-06T09:00:00.000Z') },
        }),
      }),
    )
    expect(mockSendText).not.toHaveBeenCalled()
  })

  it('scans the full flexible give-up window for progress-eligible requests', async () => {
    const now = new Date('2026-06-06T10:00:00.000Z')
    mockDb.jobRequest.findMany.mockResolvedValue([])

    await sendQuickMatchProgressUpdates(now)

    expect(mockDb.jobRequest.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          createdAt: { gte: new Date('2026-05-30T10:00:00.000Z') },
        }),
      }),
    )
  })

  it('skips progress updates when the latest decision is structural or empty-pool final', async () => {
    mockDb.jobRequest.findMany.mockResolvedValue([
      {
        id: 'job-1',
        category: 'DIY & Assembly',
        urgency: 'urgent',
        isTestRequest: false,
        cohortName: null,
        customer: { phone: '+27773923802', isTestUser: false },
        assignmentHolds: [{ id: 'hold-1' }],
        dispatchDecisions: [{ failureClass: 'STRUCTURAL', primaryReason: 'MISSING_REQUIRED_SKILL' }],
      },
      {
        id: 'job-2',
        category: 'Plumbing',
        urgency: 'asap',
        isTestRequest: false,
        cohortName: null,
        customer: { phone: '+27773923803', isTestUser: false },
        assignmentHolds: [{ id: 'hold-2' }],
        dispatchDecisions: [{ failureClass: 'EMPTY_POOL', primaryReason: 'NO_LOCATION_MATCH' }],
      },
    ])

    const result = await sendQuickMatchProgressUpdates()

    expect(result.sent).toBe(0)
    expect(result.skippedFinalNoMatch).toBe(2)
    expect(mockDb.messageEvent.findFirst).not.toHaveBeenCalled()
    expect(mockSendText).not.toHaveBeenCalled()
  })
})

// ── processPendingAssignmentWorkflows ─────────────────────────────────────────

describe('processPendingAssignmentWorkflows', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.env.PROVIDER_LEAD_ACCESS_SECRET = 'test-provider-lead-secret'
    setupBaseTransaction()
  })

  it('returns zero counts when no holds are expired', async () => {
    mockDb.assignmentHold.findMany.mockResolvedValue([])

    const result = await processPendingAssignmentWorkflows()

    expect(result.processed).toBe(0)
    expect(result.expiredOffers).toBe(0)
    expect(result.reoffered).toBe(0)
  })

  it('processes a single expired hold with no next candidate', async () => {
    mockDb.assignmentHold.findMany.mockResolvedValue([{ id: 'hold-1' }])
    mockDb.assignmentHold.findUnique.mockResolvedValue(makeActiveHold())
    mockDb.matchAttempt.findMany.mockResolvedValue([])
    mockDb.provider.findUnique.mockResolvedValue(null)

    const result = await processPendingAssignmentWorkflows()

    expect(result.processed).toBe(1)
    expect(result.expiredOffers).toBe(1)
    expect(result.reoffered).toBe(0)
  })

  it('counts reoffered when cascade succeeds', async () => {
    mockDb.assignmentHold.findMany.mockResolvedValue([{ id: 'hold-1' }])
    mockDb.assignmentHold.findUnique.mockResolvedValue(makeActiveHold())
    mockDb.matchAttempt.findMany.mockResolvedValue([
      { id: 'attempt-2', stage: 'RANKED', rankedPosition: 2, providerId: 'provider-2', hardFilterPassed: true },
    ])

    const result = await processPendingAssignmentWorkflows()

    expect(result.processed).toBe(1)
    expect(result.expiredOffers).toBe(1)
    expect(result.reoffered).toBe(1)
  })

  it('processes multiple expired holds in sequence', async () => {
    mockDb.assignmentHold.findMany.mockResolvedValue([
      { id: 'hold-1' },
      { id: 'hold-2' },
    ])

    // Both holds are expired but have no next candidate
    mockDb.assignmentHold.findUnique
      .mockResolvedValueOnce(makeActiveHold({ id: 'hold-1' }))
      .mockResolvedValueOnce(makeActiveHold({ id: 'hold-2', providerId: 'provider-2' }))

    mockDb.matchAttempt.findMany.mockResolvedValue([])
    mockDb.provider.findUnique.mockResolvedValue(null)

    const result = await processPendingAssignmentWorkflows()

    expect(result.processed).toBe(2)
    expect(result.expiredOffers).toBe(2)
    expect(result.reoffered).toBe(0)
  })
})

// ── reconcileStaleAssignmentState ─────────────────────────────────────────────

describe('reconcileStaleAssignmentState', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.env.PROVIDER_LEAD_ACCESS_SECRET = 'test-provider-lead-secret'
    mockDb.providerCapacity.update.mockResolvedValue({})
  })

  it('corrects a provider whose activeHolds counter is higher than actual count', async () => {
    mockDb.providerCapacity.findMany.mockResolvedValue([
      { providerId: 'provider-1', activeHolds: 3 },
    ])
    // Actual live holds = 1
    mockDb.assignmentHold.count.mockResolvedValue(1)

    const result = await reconcileStaleAssignmentState()

    expect(result.corrected).toBe(1)
    expect(mockDb.providerCapacity.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { providerId: 'provider-1' },
        data: expect.objectContaining({ activeHolds: 1 }),
      })
    )
  })

  it('does not update a provider whose counter is already correct', async () => {
    mockDb.providerCapacity.findMany.mockResolvedValue([
      { providerId: 'provider-1', activeHolds: 2 },
    ])
    // Actual matches the stored counter
    mockDb.assignmentHold.count.mockResolvedValue(2)

    const result = await reconcileStaleAssignmentState()

    expect(result.corrected).toBe(0)
    expect(mockDb.providerCapacity.update).not.toHaveBeenCalled()
  })

  it('returns corrected count reflecting total providers fixed', async () => {
    mockDb.providerCapacity.findMany.mockResolvedValue([
      { providerId: 'provider-1', activeHolds: 2 },
      { providerId: 'provider-2', activeHolds: 1 },
      { providerId: 'provider-3', activeHolds: 3 },
    ])
    // provider-1: drifted (actual=0), provider-2: correct (actual=1), provider-3: drifted (actual=1)
    mockDb.assignmentHold.count
      .mockResolvedValueOnce(0)
      .mockResolvedValueOnce(1)
      .mockResolvedValueOnce(1)

    const result = await reconcileStaleAssignmentState()

    expect(result.corrected).toBe(2)
  })
})
