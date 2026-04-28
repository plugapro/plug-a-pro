import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockDb,
  mockAcceptLead,
  mockProcessQuoteDecision,
  mockOrchestrateMatch,
  mockSendText,
  mockSendButtons,
  mockSendCtaUrl,
} = vi.hoisted(() => ({
  mockDb: {
    conversation: { upsert: vi.fn() },
    provider: { findUnique: vi.fn() },
    lead: { findFirst: vi.fn(), findUnique: vi.fn(), updateMany: vi.fn() },
    customer: { findUnique: vi.fn() },
    jobRequest: { findFirst: vi.fn(), findUnique: vi.fn(), update: vi.fn() },
    messageEvent: { create: vi.fn() },
    match: { findFirst: vi.fn() },
    booking: { findFirst: vi.fn() },
  },
  mockAcceptLead: vi.fn(),
  mockProcessQuoteDecision: vi.fn(),
  mockOrchestrateMatch: vi.fn(),
  mockSendText: vi.fn(),
  mockSendButtons: vi.fn(),
  mockSendCtaUrl: vi.fn(),
}))

vi.mock('@/lib/db', () => ({ db: mockDb }))
vi.mock('@/lib/whatsapp-interactive', async () => {
  const actual = await vi.importActual<typeof import('@/lib/whatsapp-interactive')>('@/lib/whatsapp-interactive')
  return {
    ...actual,
    sendText: mockSendText,
    sendButtons: mockSendButtons,
    sendCtaUrl: mockSendCtaUrl,
    sendList: vi.fn(),
  }
})
vi.mock('@/lib/whatsapp-policy', () => ({ applyOptIn: vi.fn(), applyOptOut: vi.fn() }))
vi.mock('@/lib/whatsapp-flows/job-request', () => ({
  handleJobRequestFlow: vi.fn(),
  showMainMenu: vi.fn(),
}))
vi.mock('@/lib/whatsapp-flows/registration', () => ({
  handleRegistrationFlow: vi.fn(),
  REGISTRATION_TRIGGERS: ['join'],
}))
vi.mock('@/lib/whatsapp-flows/status', () => ({ handleStatusFlow: vi.fn() }))
vi.mock('@/lib/whatsapp-flows/help', () => ({ handleHelpFlow: vi.fn(), HELP_TRIGGERS: ['help'] }))
vi.mock('@/lib/whatsapp-flows/provider-journey', () => ({
  handleProviderJourneyFlow: vi.fn(),
  PROVIDER_JOURNEY_TRIGGERS: ['provider'],
}))
vi.mock('@/lib/matching-engine', () => ({ acceptLead: mockAcceptLead, declineLead: vi.fn() }))
vi.mock('@/lib/quotes', () => ({ processQuoteDecision: mockProcessQuoteDecision }))
vi.mock('@/lib/matching/orchestrator', () => ({ orchestrateMatch: mockOrchestrateMatch }))
vi.mock('@/lib/whatsapp', () => ({ sendProviderAssigned: vi.fn() }))

import { processInboundMessage } from '@/lib/whatsapp-bot'

const PHONE = '+27821234567'

function expiredMidFlowConversation() {
  mockDb.conversation.upsert.mockResolvedValue({
    phone: PHONE,
    flow: 'job_request',
    step: 'collect_address_street',
    data: { selectedCategory: 'Plumbing', category: 'Plumbing' },
    expiresAt: new Date(Date.now() - 60_000),
  })
}

function buttonMessage(id: string) {
  return {
    from: PHONE,
    id: `wamid.${id}`,
    type: 'interactive',
    interactive: {
      type: 'button_reply',
      button_reply: { id, title: id },
    },
    timestamp: String(Date.now()),
  }
}

describe('processInboundMessage stateless notification replies', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockSendText.mockResolvedValue('msg-text')
    mockSendButtons.mockResolvedValue('msg-buttons')
    mockSendCtaUrl.mockResolvedValue('msg-cta')
    expiredMidFlowConversation()
  })

  it('processes assignment accept buttons even when the previous conversation session expired mid-flow', async () => {
    mockDb.provider.findUnique.mockResolvedValue({ id: 'provider-1', name: 'Sipho Dlamini' })
    mockDb.lead.findFirst.mockResolvedValue({ id: 'lead-1', jobRequestId: 'jr-1' })
    mockAcceptLead.mockResolvedValue({ ok: true, matchId: 'match-1' })
    mockDb.jobRequest.findUnique.mockResolvedValue(null)

    await processInboundMessage(buttonMessage('accept:hold-1'))

    expect(mockAcceptLead).toHaveBeenCalledWith({ leadId: 'lead-1', providerId: 'provider-1' })
    expect(mockSendButtons).not.toHaveBeenCalledWith(
      PHONE,
      expect.stringContaining('Your session timed out'),
      expect.any(Array),
    )
  })

  it('processes quote acceptance buttons even when the previous conversation session expired mid-flow', async () => {
    mockProcessQuoteDecision.mockResolvedValue({ error: 'EXPIRED' })

    await processInboundMessage(buttonMessage('quote_accept_quote-1'))

    expect(mockProcessQuoteDecision).toHaveBeenCalledWith('quote-1', 'approve', { verifyCustomerPhone: PHONE })
    expect(mockSendButtons).not.toHaveBeenCalledWith(
      PHONE,
      expect.stringContaining('Your session timed out'),
      expect.any(Array),
    )
  })

  it('processes rematch buttons even when the previous conversation session expired mid-flow', async () => {
    mockDb.customer.findUnique.mockResolvedValue({ id: 'customer-1', name: 'Alice' })
    mockDb.jobRequest.findFirst.mockResolvedValue({
      id: 'jr-1',
      category: 'plumbing',
      title: 'Leaking pipe',
      status: 'EXPIRED',
      requestedWindowStart: null,
      requestedWindowEnd: null,
      requestedArrivalLatest: null,
    })
    mockDb.jobRequest.update.mockResolvedValue({})
    mockOrchestrateMatch.mockResolvedValue({ status: 'NO_MATCH' })

    await processInboundMessage(buttonMessage('rematch_yes:jr-1'))

    expect(mockDb.jobRequest.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'jr-1' },
      data: expect.objectContaining({
        status: 'OPEN',
        customerRematchCheckOutcome: 'YES',
      }),
    }))
    expect(mockOrchestrateMatch).toHaveBeenCalledWith('jr-1', { triggeredBy: 'rematch' })
    expect(mockSendButtons).not.toHaveBeenCalledWith(
      PHONE,
      expect.stringContaining('Your session timed out'),
      expect.any(Array),
    )
  })
})
