import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockDb,
  mockSendCtaUrl,
  mockSendButtons,
  mockNotifyZeroBalance,
} = vi.hoisted(() => ({
  mockDb: {
    provider: { findUnique: vi.fn() },
    lead: { findUnique: vi.fn(), upsert: vi.fn() },
    messageEvent: { findFirst: vi.fn(), create: vi.fn() },
    attachment: { count: vi.fn().mockResolvedValue(2) },
  },
  mockSendCtaUrl: vi.fn(),
  mockSendButtons: vi.fn(),
  mockNotifyZeroBalance: vi.fn(),
}))

vi.mock('@/lib/db', () => ({ db: mockDb }))
vi.mock('@/lib/whatsapp-interactive', () => ({
  sendCtaUrl: mockSendCtaUrl,
  sendButtons: mockSendButtons,
}))
vi.mock('@/lib/provider-wallet-notifications', () => ({
  notifyProviderZeroBalanceLeadAvailable: mockNotifyZeroBalance,
}))
vi.mock('@/lib/provider-wallet', () => ({
  PROVIDER_CREDIT_PRICE_ZAR: 50,
  PROVIDER_CREDIT_PRICE_CENTS: 5_000,
  PLUG_A_PRO_CREDIT_VALUE_CENTS: 5_000,
  getProviderWalletBalanceReadOnly: vi.fn().mockResolvedValue({
    providerId: 'provider-1',
    paidCreditBalance: 2,
    promoCreditBalance: 3,
    totalCreditBalance: 5,
    status: 'ACTIVE',
  }),
}))

describe('dispatchMatchLead WhatsApp notification', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.env.PROVIDER_LEAD_ACCESS_SECRET = 'test-provider-lead-secret'
    process.env.PROVIDER_LEAD_APP_URL = 'https://app.plugapro.co.za'
    mockDb.lead.findUnique.mockResolvedValue(null)   // no existing declined lead — proceed
    mockDb.lead.upsert.mockResolvedValue({ id: 'lead-1' })
    mockDb.messageEvent.findFirst.mockResolvedValue(null)
    mockDb.attachment.count.mockResolvedValue(2)
    mockDb.provider.findUnique.mockResolvedValue(null)
    mockSendCtaUrl.mockResolvedValue('wamid-cta')
    mockSendButtons.mockResolvedValue('wamid-buttons')
    mockNotifyZeroBalance.mockResolvedValue(undefined)
  })

  it('sends a clean CTA URL without exposing a raw URL in the body and preserves accept/decline actions', async () => {
    const { dispatchMatchLead } = await import('@/lib/matching/dispatch')
    const holdExpiresAt = new Date('2026-04-28T12:15:00.000Z')

    await dispatchMatchLead({
      jobRequest: {
        id: 'jr-1',
        category: 'plumbing',
        title: 'Leaking pipe',
        description: 'Pipe leaking under the sink',
        requestedWindowStart: null,
        requestedWindowEnd: null,
        requestedArrivalLatest: null,
        estimatedDurationMinutes: null,
        requiredSkillTags: [],
        requiredCertificationCodes: [],
        requiredEquipmentTags: [],
        requiredVehicleTypes: [],
        preferredProviderId: null,
        assignmentMode: 'AUTO_ASSIGN',
        customerAcceptedAmount: null,
        customerAcceptedScope: null,
        autoCreateBookingOnAssignment: false,
        status: 'OPEN',
        expiresAt: new Date('2026-05-05T12:00:00.000Z'),
        address: { suburb: 'ruimsig' },
      },
      hold: { id: 'hold-1', expiresAt: holdExpiresAt },
      provider: {
        id: 'provider-1',
        name: 'Sipho',
        phone: '+27820000000',
        skills: ['plumbing'],
        serviceAreas: ['Sandton'],
        maxTravelMinutes: 60,
        reliabilityScore: 0.8,
        averageRating: 4.5,
        active: true,
        verified: true,
        availableNow: true,
        lastKnownLat: null,
        lastKnownLng: null,
        isOnline: null,
        liveLocationLat: null,
        liveLocationLng: null,
        lastHeartbeatAt: null,
        scoreBase: 0.8,
        fromPool: true,
      },
    })

    expect(mockSendCtaUrl).toHaveBeenCalledWith(
      '+27820000000',
      expect.stringContaining('Area: *Ruimsig*'),
      'View lead',
      expect.stringMatching(/^https:\/\/app\.plugapro\.co\.za\/leads\/access\//),
      { footer: 'Preview first. Acceptance uses 1 credit.' },
      expect.objectContaining({
        templateName: 'dispatch:job_lead',
        metadata: expect.objectContaining({
          jobRequestId: 'jr-1',
          leadId: 'lead-1',
          holdId: 'hold-1',
          providerId: 'provider-1',
        }),
      }),
    )
    expect(mockSendCtaUrl).toHaveBeenCalledWith(
      '+27820000000',
      expect.not.stringContaining('Area: *ruimsig*'),
      'View lead',
      expect.any(String),
      expect.any(Object),
      expect.any(Object),
    )

    expect(mockSendButtons).toHaveBeenCalledWith(
      '+27820000000',
      expect.stringContaining('Quick response for *plumbing* in *Ruimsig*.'),
      [
        { id: 'accept:hold-1', title: 'Accept Lead' },
        { id: 'decline:hold-1', title: 'Decline' },
      ],
      undefined,
      expect.objectContaining({ templateName: 'dispatch:job_lead_actions' }),
    )
  })

  it('skips duplicate provider dispatch sends for the same lead', async () => {
    mockDb.messageEvent.findFirst.mockResolvedValue({ id: 'message-existing' })
    const { dispatchMatchLead } = await import('@/lib/matching/dispatch')

    await dispatchMatchLead({
      jobRequest: {
        id: 'jr-1',
        category: 'plumbing',
        title: 'Leaking pipe',
        description: 'Pipe leaking under the sink',
        requestedWindowStart: null,
        requestedWindowEnd: null,
        requestedArrivalLatest: null,
        estimatedDurationMinutes: null,
        requiredSkillTags: [],
        requiredCertificationCodes: [],
        requiredEquipmentTags: [],
        requiredVehicleTypes: [],
        preferredProviderId: null,
        assignmentMode: 'AUTO_ASSIGN',
        customerAcceptedAmount: null,
        customerAcceptedScope: null,
        autoCreateBookingOnAssignment: false,
        status: 'OPEN',
        expiresAt: new Date('2026-05-05T12:00:00.000Z'),
        address: { suburb: 'Sandton' },
      },
      hold: { id: 'hold-1', expiresAt: new Date('2026-04-28T12:15:00.000Z') },
      provider: {
        id: 'provider-1',
        name: 'Sipho',
        phone: '+27820000000',
        skills: ['plumbing'],
        serviceAreas: ['Sandton'],
        maxTravelMinutes: 60,
        reliabilityScore: 0.8,
        averageRating: 4.5,
        active: true,
        verified: true,
        availableNow: true,
        lastKnownLat: null,
        lastKnownLng: null,
        isOnline: null,
        liveLocationLat: null,
        liveLocationLng: null,
        lastHeartbeatAt: null,
        scoreBase: 0.8,
        fromPool: true,
      },
    })

    expect(mockDb.messageEvent.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        to: '+27820000000',
        templateName: 'dispatch:job_lead',
        metadata: {
          path: ['jobRequestId'],
          equals: 'jr-1',
        },
      }),
    }))
    expect(mockDb.messageEvent.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        to: '+27820000000',
        templateName: 'dispatch:job_lead_actions',
        metadata: {
          path: ['jobRequestId'],
          equals: 'jr-1',
        },
      }),
    }))
    expect(mockSendCtaUrl).not.toHaveBeenCalled()
    expect(mockSendButtons).not.toHaveBeenCalled()
  })

  it('falls back to the provider row for recipient test cohort when candidate metadata is missing', async () => {
    const { dispatchMatchLead } = await import('@/lib/matching/dispatch')
    mockDb.provider.findUnique.mockResolvedValue({ isTestUser: true })
    mockDb.lead.upsert.mockResolvedValue({ id: 'lead-1', isTestLead: true })

    await dispatchMatchLead({
      jobRequest: {
        id: 'jr-test',
        category: 'plumbing',
        title: 'Leaking pipe',
        description: 'Pipe leaking under the sink',
        requestedWindowStart: null,
        requestedWindowEnd: null,
        requestedArrivalLatest: null,
        estimatedDurationMinutes: null,
        requiredSkillTags: [],
        requiredCertificationCodes: [],
        requiredEquipmentTags: [],
        requiredVehicleTypes: [],
        preferredProviderId: null,
        assignmentMode: 'AUTO_ASSIGN',
        customerAcceptedAmount: null,
        customerAcceptedScope: null,
        autoCreateBookingOnAssignment: false,
        status: 'OPEN',
        expiresAt: new Date('2026-05-05T12:00:00.000Z'),
        isTestRequest: true,
        cohortName: 'internal_staff_test',
        address: { suburb: 'Ruimsig' },
      },
      hold: { id: 'hold-test', expiresAt: new Date('2026-04-28T12:15:00.000Z') },
      provider: {
        id: 'provider-1',
        name: 'Sipho',
        phone: '+27820000000',
        skills: ['plumbing'],
        serviceAreas: ['Sandton'],
        maxTravelMinutes: 60,
        reliabilityScore: 0.8,
        averageRating: 4.5,
        active: true,
        verified: true,
        availableNow: true,
        lastKnownLat: null,
        lastKnownLng: null,
        isOnline: null,
        liveLocationLat: null,
        liveLocationLng: null,
        lastHeartbeatAt: null,
        scoreBase: 0.8,
        fromPool: false,
      },
    })

    expect(mockDb.provider.findUnique).toHaveBeenCalledWith({
      where: { id: 'provider-1' },
      select: { isTestUser: true },
    })
    expect(mockSendCtaUrl).toHaveBeenCalledWith(
      '+27820000000',
      expect.any(String),
      'View lead',
      expect.any(String),
      expect.any(Object),
      expect.objectContaining({
        metadata: expect.objectContaining({
          isTestLead: true,
          isTestRequest: true,
          recipientIsTest: true,
        }),
      }),
    )
  })
})
