// Architectural guard: the test cohort flag must propagate through every
// layer of the matching/dispatch chain. Customer.isTestUser ⇒ JobRequest.isTestRequest
// ⇒ Lead.isTestLead ⇒ MessageEvent.isTestEvent. A regression in any of these
// links is what produced the Tshepo/Lovemore notification miss in May 2026.

import { describe, expect, it, vi, beforeEach } from 'vitest'

const {
  mockDb,
  mockGeocodeAddress,
  mockResolveCategoryRequirements,
  mockGetJobRequestAccessUrl,
  mockOrchestrateMatch,
  mockDispatchLeads,
  mockGetWalletBalance,
  mockGetProviderLeadAccessUrl,
  mockNotifyZeroBalance,
  mockSendCtaUrl,
  mockSendButtons,
} = vi.hoisted(() => ({
  mockDb: {
    $transaction: vi.fn(),
    provider: { findFirst: vi.fn() },
    lead: { findUnique: vi.fn(), upsert: vi.fn() },
  },
  mockGeocodeAddress: vi.fn(),
  mockResolveCategoryRequirements: vi.fn(),
  mockGetJobRequestAccessUrl: vi.fn(),
  mockOrchestrateMatch: vi.fn(),
  mockDispatchLeads: vi.fn(),
  mockGetWalletBalance: vi.fn(),
  mockGetProviderLeadAccessUrl: vi.fn(),
  mockNotifyZeroBalance: vi.fn(),
  mockSendCtaUrl: vi.fn(),
  mockSendButtons: vi.fn(),
}))

vi.mock('@/lib/db', () => ({ db: mockDb }))
vi.mock('../../lib/db', () => ({ db: mockDb }))
vi.mock('../../lib/category-config', () => ({
  resolveCategoryRequirements: mockResolveCategoryRequirements,
}))
vi.mock('../../lib/geocoding', () => ({ geocodeAddress: mockGeocodeAddress }))
vi.mock('../../lib/job-request-access', () => ({
  getJobRequestAccessUrl: mockGetJobRequestAccessUrl,
}))
vi.mock('../../lib/matching/orchestrator', () => ({ orchestrateMatch: mockOrchestrateMatch }))
vi.mock('../../lib/matching-engine', () => ({ dispatchLeads: mockDispatchLeads }))
vi.mock('@/lib/provider-wallet', () => ({
  PROVIDER_CREDIT_PRICE_ZAR: 50,
  PROVIDER_CREDIT_PRICE_CENTS: 5_000,
  PLUG_A_PRO_CREDIT_VALUE_CENTS: 5_000,
  getProviderWalletBalanceReadOnly: mockGetWalletBalance,
}))
vi.mock('@/lib/provider-lead-access', () => ({ getProviderLeadAccessUrl: mockGetProviderLeadAccessUrl }))
vi.mock('@/lib/provider-wallet-notifications', () => ({
  notifyProviderZeroBalanceLeadAvailable: mockNotifyZeroBalance,
}))
vi.mock('@/lib/whatsapp-interactive', () => ({
  sendCtaUrl: mockSendCtaUrl,
  sendButtons: mockSendButtons,
}))
vi.mock('@/lib/message-events', () => ({
  hasSuccessfulMessageForRecipient: vi.fn().mockResolvedValue(false),
}))

vi.mock('next/server', async (importOriginal) => {
  const original = await importOriginal<typeof import('next/server')>()
  return {
    ...original,
    after: (fn: () => void | Promise<void>) => {
      void Promise.resolve().then(fn).catch(() => undefined)
    },
  }
})

const BASE_PARAMS = {
  phone: '+27773923802', // bootstrap-list test phone
  customerName: 'Test Staff',
  category: 'plumbing',
  title: 'Leaking pipe',
  description: 'urgent',
  street: '1 Main St',
  suburb: 'Randburg',
  city: 'Johannesburg',
  province: 'Gauteng',
}

function makeTx() {
  return {
    customer: {
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      upsert: vi.fn(),
    },
    address: {
      findFirst: vi.fn().mockResolvedValue(null),
      create: vi.fn(),
    },
    jobRequest: {
      findFirst: vi.fn().mockResolvedValue(null),
      create: vi.fn(),
    },
    attachment: { updateMany: vi.fn() },
  }
}

describe('test cohort propagation chain', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockResolveCategoryRequirements.mockResolvedValue({
      requiredCertificationCodes: [],
      requiredEquipmentTags: [],
      requiredVehicleTypes: [],
      policy: { bookingOnAssignment: false },
    })
    mockGeocodeAddress.mockResolvedValue({ lat: -26.1, lng: 27.9 })
    mockGetJobRequestAccessUrl.mockResolvedValue(null)
    mockDb.provider.findFirst.mockResolvedValue(null)
  })

  it('Customer.isTestUser → JobRequest.isTestRequest', async () => {
    const { createJobRequest } = await import('../../lib/job-requests/create-job-request')
    const tx = makeTx()
    tx.customer.upsert.mockResolvedValue({
      id: 'cust-test',
      isTestUser: true,
      cohortName: 'internal_staff_test',
    })
    tx.address.create.mockResolvedValue({ id: 'addr-test' })
    tx.jobRequest.create.mockResolvedValue({ id: 'jr-test' })
    mockDb.$transaction.mockImplementation(async (fn: (client: typeof tx) => Promise<unknown>) => fn(tx))

    await createJobRequest(BASE_PARAMS)

    expect(tx.jobRequest.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          customerId: 'cust-test',
          isTestRequest: true,
          cohortName: 'internal_staff_test',
        }),
      }),
    )
  })

  it('JR with non-test customer.isTestUser produces non-test JR (DB beats phone-only check)', async () => {
    const { createJobRequest } = await import('../../lib/job-requests/create-job-request')
    const tx = makeTx()
    // Bootstrap phone, but DB row says non-test (e.g. row predates the list flip)
    tx.customer.upsert.mockResolvedValue({
      id: 'cust-real',
      isTestUser: false,
      cohortName: null,
    })
    tx.address.create.mockResolvedValue({ id: 'addr-real' })
    tx.jobRequest.create.mockResolvedValue({ id: 'jr-real' })
    mockDb.$transaction.mockImplementation(async (fn: (client: typeof tx) => Promise<unknown>) => fn(tx))

    await createJobRequest(BASE_PARAMS)

    expect(tx.jobRequest.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          customerId: 'cust-real',
          isTestRequest: false,
          cohortName: null,
        }),
      }),
    )
  })

  it('JobRequest.isTestRequest → Lead.isTestLead via dispatch.dispatchMatchLead', async () => {
    const { dispatchMatchLead } = await import('../../lib/matching/dispatch')

    const upsertedLead: Record<string, unknown> = {}
    mockDb.lead.findUnique.mockResolvedValue(null)
    mockDb.lead.upsert.mockImplementation(async (args: { create: Record<string, unknown> }) => {
      Object.assign(upsertedLead, args.create)
      return { id: 'lead-1', isTestLead: args.create.isTestLead, ...args.create }
    })
    mockGetWalletBalance.mockResolvedValue({ totalCreditBalance: 5, paidCreditBalance: 0, promoCreditBalance: 5 })
    mockGetProviderLeadAccessUrl.mockResolvedValue('https://example.com/lead/x')
    mockNotifyZeroBalance.mockResolvedValue(undefined)
    mockSendCtaUrl.mockResolvedValue('msg-id')
    mockSendButtons.mockResolvedValue('msg-id-2')

    await dispatchMatchLead({
      jobRequest: {
        id: 'jr-1',
        category: 'plumbing',
        title: 'x',
        description: 'y',
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
        status: 'OPEN',
        expiresAt: new Date(Date.now() + 60 * 60 * 1000),
        isTestRequest: true,
        cohortName: 'internal_staff_test',
        address: { suburb: 'Randburg' },
      } as never,
      hold: { id: 'hold-1', expiresAt: new Date(Date.now() + 15 * 60 * 1000) },
      provider: {
        id: 'p-1',
        phone: '+27821111111',
        isTestUser: true,
        active: true,
        verified: true,
        availableNow: true,
        cohortName: 'internal_staff_test',
      } as never,
    })

    expect(upsertedLead).toMatchObject({
      jobRequestId: 'jr-1',
      providerId: 'p-1',
      isTestLead: true,
      cohortName: 'internal_staff_test',
    })
  })

  it('Lead.isTestLead → outbound MessageEvent.isTestEvent via msgMeta', async () => {
    const { dispatchMatchLead } = await import('../../lib/matching/dispatch')

    mockDb.lead.findUnique.mockResolvedValue(null)
    mockDb.lead.upsert.mockResolvedValue({ id: 'lead-2', isTestLead: true, jobRequestId: 'jr-2' })
    mockGetWalletBalance.mockResolvedValue({ totalCreditBalance: 5, paidCreditBalance: 0, promoCreditBalance: 5 })
    mockGetProviderLeadAccessUrl.mockResolvedValue('https://example.com/lead/y')
    mockNotifyZeroBalance.mockResolvedValue(undefined)
    mockSendCtaUrl.mockResolvedValue('msg-id')
    mockSendButtons.mockResolvedValue('msg-id-2')

    await dispatchMatchLead({
      jobRequest: {
        id: 'jr-2',
        category: 'plumbing',
        title: 't',
        description: 'd',
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
        status: 'OPEN',
        expiresAt: new Date(Date.now() + 60 * 60 * 1000),
        isTestRequest: true,
        cohortName: 'internal_staff_test',
        address: { suburb: 'Sandton' },
      } as never,
      hold: { id: 'hold-2', expiresAt: new Date(Date.now() + 15 * 60 * 1000) },
      provider: {
        id: 'p-2',
        phone: '+27822222222',
        isTestUser: true,
        active: true,
        verified: true,
        availableNow: true,
        cohortName: 'internal_staff_test',
      } as never,
    })

    // Both interactive sends should have been called with metadata carrying the test flags
    const ctaCall = mockSendCtaUrl.mock.calls[0]
    const buttonsCall = mockSendButtons.mock.calls[0]
    const ctaContext = ctaCall[ctaCall.length - 1]
    const buttonsContext = buttonsCall[buttonsCall.length - 1]

    expect(ctaContext.metadata).toMatchObject({
      isTestLead: true,
      isTestRequest: true,
      recipientIsTest: true,
    })
    expect(buttonsContext.metadata).toMatchObject({
      isTestLead: true,
      isTestRequest: true,
      recipientIsTest: true,
    })
  })
})
