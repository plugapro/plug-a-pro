import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockDb,
  mockSendCtaUrl,
  mockSendButtons,
  mockNotifyZeroBalance,
} = vi.hoisted(() => ({
  mockDb: {
    lead: { findUnique: vi.fn(), upsert: vi.fn() },
    messageEvent: { findFirst: vi.fn(), create: vi.fn() },
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
        address: { suburb: 'Sandton' },
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
      expect.not.stringContaining('http'),
      'View Lead',
      expect.stringMatching(/^https:\/\/app\.plugapro\.co\.za\/leads\/access\//),
      { footer: 'Accept, inspect, or decline from the lead page' },
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

    expect(mockSendButtons).toHaveBeenCalledWith(
      '+27820000000',
      expect.stringContaining('Accepting this lead will use 1 credit.\nAvailable balance: 5 credits (Promo: 3 · Purchased: 2).'),
      [
        { id: 'accept:hold-1', title: 'Unlock & Accept' },
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
})
