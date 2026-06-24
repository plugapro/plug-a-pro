import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockJobRequest,
  mockAssignmentHold,
  mockOrchestrateMatch,
  mockSendText,
  mockSendCtaUrl,
  mockSendButtons,
  mockMatchEligibleProviders,
  mockMessageEvent,
} = vi.hoisted(() => ({
  mockJobRequest: { findUnique: vi.fn(), update: vi.fn() },
  mockAssignmentHold: { findFirst: vi.fn() },
  mockOrchestrateMatch: vi.fn(),
  mockSendText: vi.fn(),
  mockSendCtaUrl: vi.fn(),
  mockSendButtons: vi.fn(),
  mockMatchEligibleProviders: vi.fn(),
  mockMessageEvent: { findFirst: vi.fn() },
}))

vi.mock('@/lib/db', () => ({
  db: {
    jobRequest: mockJobRequest,
    assignmentHold: mockAssignmentHold,
    messageEvent: mockMessageEvent,
  },
}))
vi.mock('@/lib/matching/orchestrator', () => ({ orchestrateMatch: mockOrchestrateMatch }))
vi.mock('@/lib/whatsapp', () => ({ sendText: mockSendText }))
vi.mock('@/lib/whatsapp-interactive', () => ({
  sendText: mockSendText,
  sendCtaUrl: mockSendCtaUrl,
  sendButtons: mockSendButtons,
}))
vi.mock('@/lib/job-request-access', () => ({ getJobRequestAccessUrl: vi.fn().mockResolvedValue('https://app.test/requests/access/token?view=matching_status') }))
vi.mock('@/lib/review-first', () => ({ matchEligibleProvidersForServiceRequest: mockMatchEligibleProviders }))

const BASE_REQUEST = {
  id: 'jr-fast-1',
  customerId: 'cust-1',
  status: 'PENDING_VALIDATION',
  source: 'pwa',
  assignmentMode: 'OPS_REVIEW',
  category: 'plumbing',
  customer: { phone: '+27821234567' },
}

describe('fast match regression sweep', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockJobRequest.update.mockResolvedValue({})
    mockOrchestrateMatch.mockResolvedValue(undefined)
    mockSendText.mockResolvedValue(undefined)
    mockSendCtaUrl.mockResolvedValue(undefined)
    mockSendButtons.mockResolvedValue(undefined)
    mockMessageEvent.findFirst.mockResolvedValue(null)
    mockMatchEligibleProviders.mockResolvedValue({
      status: 'MATCHES_FOUND',
      decisionId: 'dd-1',
      wasCached: false,
      providers: [{ providerId: 'provider-1', name: 'Lovemore' }],
    })
    mockAssignmentHold.findFirst.mockResolvedValue(null)
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('uses 60 minutes as default provider response window when env is missing/invalid (raised from 10 on 2026-06-24 — see plan 2026-06-24-pre-jhb-north-acquisition-fixes)', async () => {
    // Reset module cache so env parsing is re-evaluated for this test.
    vi.resetModules()
    vi.stubEnv('FAST_MATCH_PROVIDER_RESPONSE_MINUTES', '')
    const missingEnv = await import('@/lib/matching/config')
    expect(missingEnv.FAST_MATCH_PROVIDER_RESPONSE_MINUTES).toBe(60)
    expect(missingEnv.MATCHING_CONFIG.offerTtlMinutes).toBe(60)

    vi.resetModules()
    vi.stubEnv('FAST_MATCH_PROVIDER_RESPONSE_MINUTES', '0')
    const invalidEnv = await import('@/lib/matching/config')
    expect(invalidEnv.FAST_MATCH_PROVIDER_RESPONSE_MINUTES).toBe(60)
    expect(invalidEnv.MATCHING_CONFIG.offerTtlMinutes).toBe(60)
  })

  it('honors FAST_MATCH_PROVIDER_RESPONSE_MINUTES when configured', async () => {
    // Reset module cache so env parsing is re-evaluated for this test.
    vi.resetModules()
    vi.stubEnv('FAST_MATCH_PROVIDER_RESPONSE_MINUTES', '12')
    const config = await import('@/lib/matching/config')
    expect(config.FAST_MATCH_PROVIDER_RESPONSE_MINUTES).toBe(12)
    expect(config.MATCHING_CONFIG.offerTtlMinutes).toBe(12)
  })

  it('quick_match starts one-at-a-time matching and does not leak snake_case copy', async () => {
    mockJobRequest.findUnique.mockResolvedValue(BASE_REQUEST)

    const { selectCustomerRequestMatchingMode } = await import('@/lib/request-matching-mode')
    const result = await selectCustomerRequestMatchingMode({
      requestId: 'jr-fast-1',
      customerId: 'cust-1',
      mode: 'quick_match',
    })

    expect(result.status).toBe('matching_started')
    expect(mockJobRequest.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'OPEN', assignmentMode: 'AUTO_ASSIGN' }),
      }),
    )
    expect(mockOrchestrateMatch).toHaveBeenCalledWith(
      'jr-fast-1',
      expect.objectContaining({ triggeredBy: 'manual' }),
    )
    expect(mockMatchEligibleProviders).not.toHaveBeenCalled()

    const outboundMessage = mockSendText.mock.calls.at(-1)?.[1] as string
    expect(outboundMessage).toContain("We're checking with one suitable provider now")
    expect(outboundMessage).not.toContain('quick_match')
  })

  it('review_first never triggers fast-match orchestration directly', async () => {
    mockJobRequest.findUnique.mockResolvedValue(BASE_REQUEST)

    const { selectCustomerRequestMatchingMode } = await import('@/lib/request-matching-mode')
    const result = await selectCustomerRequestMatchingMode({
      requestId: 'jr-fast-1',
      customerId: 'cust-1',
      mode: 'review_first',
    })

    expect(result.status).toBe('review_options_ready')
    expect(mockOrchestrateMatch).not.toHaveBeenCalled()
    expect(mockMatchEligibleProviders).toHaveBeenCalledWith(
      expect.objectContaining({ serviceRequestId: 'jr-fast-1' }),
    )
  })

  it('provider lead preview copy enforces fast-match credit/privacy wording with no raw URL', async () => {
    const { buildProviderLeadPreviewMessage } = await import('@/lib/provider-credit-copy')
    const message = buildProviderLeadPreviewMessage({
      category: 'Plumbing',
      area: 'Soweto',
      city: 'Johannesburg',
      province: 'Gauteng',
      preferredTime: 'Today 15:00–17:00',
      deadlineTime: '15:10',
      responseWindowMinutes: 10,
      description: 'Leaking kitchen pipe.',
      matchingPreference: 'best_value',
      balance: {
        totalCreditBalance: 2,
        promoCreditBalance: 1,
        paidCreditBalance: 1,
      },
    })

    expect(message).toContain('Previewing and responding is free')
    expect(message).toContain('1 credit = R50')
    expect(message).toContain('customer selects you and you accept the selected job')
    expect(message).toContain('You have *10 minutes* to respond')
    expect(message).toContain('Matching preference: *Best value*')
    expect(message).not.toContain('best_value')
    expect(message).not.toMatch(/https?:\/\//)
  })
})
