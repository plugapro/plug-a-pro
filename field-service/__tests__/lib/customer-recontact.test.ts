import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockDb,
  mockFilterEligibleProviders,
  mockSendButtons,
  mockSendSlotAvailable,
  mockOrchestrateMatch,
} = vi.hoisted(() => ({
  mockDb: {
    provider: { findUnique: vi.fn() },
    jobRequest: { findMany: vi.fn(), update: vi.fn() },
    inboundWhatsAppMessage: { findFirst: vi.fn() },
  },
  mockFilterEligibleProviders: vi.fn(),
  mockSendButtons: vi.fn(),
  mockSendSlotAvailable: vi.fn(),
  mockOrchestrateMatch: vi.fn(),
}))

vi.mock('@/lib/db', () => ({ db: mockDb }))
vi.mock('@/lib/matching/filter', () => ({ filterEligibleProviders: mockFilterEligibleProviders }))
vi.mock('@/lib/whatsapp-interactive', () => ({
  sendButtons: mockSendButtons,
  sendText: vi.fn(),
}))
vi.mock('@/lib/whatsapp', () => ({ sendSlotAvailable: mockSendSlotAvailable }))
vi.mock('@/lib/job-request-access', () => ({ getJobRequestAccessUrl: vi.fn().mockResolvedValue('https://app.example/ticket') }))
vi.mock('@/lib/matching/orchestrator', () => ({ orchestrateMatch: mockOrchestrateMatch }))

describe('new provider rematch checks', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockDb.jobRequest.findMany.mockResolvedValue([])
    mockDb.provider.findUnique.mockResolvedValue({
      id: 'provider-1',
      name: 'Sipho',
      phone: '+27820000000',
      skills: ['plumbing'],
      serviceAreas: ['Sandton'],
      maxTravelMinutes: 60,
      reliabilityScore: 0.5,
      averageRating: 0,
      active: true,
      verified: true,
      status: 'ACTIVE',
      availableNow: true,
      lastKnownLat: null,
      lastKnownLng: null,
      liveStatus: null,
    })
    mockDb.inboundWhatsAppMessage.findFirst.mockResolvedValue({ id: 'inbound-1' })
    mockFilterEligibleProviders.mockResolvedValue({ eligible: [{ id: 'provider-1' }], filteredOut: [], nearMiss: [] })
    mockDb.jobRequest.update.mockResolvedValue({})
  })

  it('prompts customers for recently expired jobs when the provider is approved', async () => {
    mockDb.jobRequest.findMany.mockResolvedValue([
      {
        id: 'jr-expired',
        customerId: 'customer-1',
        category: 'plumbing',
        title: 'Leaking tap',
        description: 'Tap is leaking',
        status: 'EXPIRED',
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
        customerNoMatchNotifiedAt: new Date(),
        customerRematchCheckSentAt: null,
        customerRematchCheckRespondedAt: null,
        customerRematchCheckOutcome: null,
        altSlotNegotiationSentAt: null,
        altSlotNegotiationOutcome: null,
        customer: { id: 'customer-1', name: 'Alice', phone: '+27821111111' },
        address: {
          street: '1 Main',
          suburb: 'Sandton',
          city: 'Johannesburg',
          province: 'Gauteng',
          lat: null,
          lng: null,
          locationNodeId: null,
          locationNode: null,
        },
      },
    ])

    const { promptCustomersForNewProviderAvailability } = await import('@/lib/matching/customer-recontact')
    const result = await promptCustomersForNewProviderAvailability('provider-1')

    expect(result).toEqual({ prompted: 1, templateFallbacks: 0 })
    expect(mockDb.jobRequest.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        status: 'EXPIRED',
        customerRematchCheckSentAt: null,
        createdAt: expect.objectContaining({ gte: expect.any(Date) }),
      }),
    }))
    expect(mockSendButtons).toHaveBeenCalledWith(
      '+27821111111',
      expect.stringContaining('Do you still need help?'),
      expect.arrayContaining([
        expect.objectContaining({ id: 'rematch_yes:jr-expired' }),
      ]),
      undefined,
      expect.any(Object),
    )
  })

  it('checks open jobs immediately when a new provider joins', async () => {
    mockDb.jobRequest.findMany
      .mockResolvedValueOnce([{ id: 'jr-open' }])
      .mockResolvedValueOnce([])
    mockOrchestrateMatch.mockResolvedValue({ status: 'DISPATCHED', holdId: 'hold-1', providerId: 'provider-1' })

    const { checkJobsForNewProviderAvailability } = await import('@/lib/matching/customer-recontact')
    const result = await checkJobsForNewProviderAvailability('provider-1')

    expect(result).toEqual({ dispatchedOpenJobs: 1, promptedExpiredJobs: 0, templateFallbacks: 0 })
    expect(mockOrchestrateMatch).toHaveBeenCalledWith('jr-open', { triggeredBy: 'cron' })
  })

  it('does not prompt customers for a pending provider profile', async () => {
    mockDb.provider.findUnique.mockResolvedValue({
      id: 'provider-pending',
      name: 'Pending Pro',
      phone: '+27820000000',
      skills: ['plumbing'],
      serviceAreas: ['Sandton'],
      maxTravelMinutes: 60,
      reliabilityScore: 0.5,
      averageRating: 0,
      active: false,
      verified: false,
      status: 'APPLICATION_PENDING',
      availableNow: false,
      lastKnownLat: null,
      lastKnownLng: null,
      liveStatus: null,
    })

    const { promptCustomersForNewProviderAvailability } = await import('@/lib/matching/customer-recontact')
    const result = await promptCustomersForNewProviderAvailability('provider-pending')

    expect(result).toEqual({ prompted: 0, templateFallbacks: 0 })
    expect(mockDb.jobRequest.findMany).not.toHaveBeenCalled()
  })
})
