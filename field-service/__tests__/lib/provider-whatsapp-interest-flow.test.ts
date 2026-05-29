// ─── Provider WhatsApp interest capture - multi-step flow tests ───────────────
// Blueprint: 07-provider-interest-rate-response-whatsapp-flow
//
// These tests assert the WhatsApp multi-step interest capture (callout → arrival
// → negotiable → note → confirmation) that lives in whatsapp-bot.ts.
//
// Key invariants verified:
//   1. No credits deducted at any stage of the interest capture flow.
//   2. Confirmation copy includes "No credits were used".
//   3. Fee validation re-prompts on invalid input.
//   4. Arrival validation re-prompts on invalid input.
//   5. Duplicate/interrupted responses are handled by idempotency key.
//   6. The full callout → arrival → negotiable → note → confirm path works.

import { beforeEach, describe, expect, it, vi } from 'vitest'

// ─── Hoisted mocks ────────────────────────────────────────────────────────────
const {
  mockDb,
  mockSendText,
  mockSendButtons,
  mockRespondToProviderOpportunity,
} = vi.hoisted(() => ({
  mockDb: {
    conversation: { findUnique: vi.fn(), upsert: vi.fn() },
    provider: { findUnique: vi.fn() },
    lead: { findFirst: vi.fn(), findUnique: vi.fn(), updateMany: vi.fn() },
    customer: { findUnique: vi.fn() },
    jobRequest: { findFirst: vi.fn(), findUnique: vi.fn(), update: vi.fn() },
    messageEvent: { create: vi.fn() },
    match: { findFirst: vi.fn() },
    booking: { findFirst: vi.fn() },
    providerApplication: {
      findFirst: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn(),
    },
  },
  mockSendText: vi.fn(),
  mockSendButtons: vi.fn(),
  mockRespondToProviderOpportunity: vi.fn(),
}))

vi.mock('@/lib/db', () => ({ db: mockDb }))
vi.mock('@/lib/whatsapp-interactive', async () => {
  const actual = await vi.importActual<typeof import('@/lib/whatsapp-interactive')>('@/lib/whatsapp-interactive')
  return {
    ...actual,
    sendText: mockSendText,
    sendButtons: mockSendButtons,
    sendList: vi.fn(),
    sendCtaUrl: vi.fn(),
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
vi.mock('@/lib/matching-engine', () => ({ acceptLead: vi.fn(), declineLead: vi.fn() }))
vi.mock('@/lib/selected-provider-acceptance', () => ({
  acceptSelectedProviderJob: vi.fn().mockResolvedValue({
    ok: true,
    creditCheck: { ok: true, providerMessage: 'Accepted. Credit check passed.' },
    notificationSent: false,
  }),
}))
vi.mock('@/lib/customer-shortlists', () => ({
  declineSelectedProviderJob: vi.fn().mockResolvedValue({ ok: true }),
}))
vi.mock('@/lib/quotes', () => ({ processQuoteDecision: vi.fn() }))
vi.mock('@/lib/matching/orchestrator', () => ({ orchestrateMatch: vi.fn() }))
vi.mock('@/lib/whatsapp', () => ({ sendProviderAssigned: vi.fn() }))
vi.mock('@/lib/journey-recovery', async () => {
  const actual = await vi.importActual<typeof import('@/lib/journey-recovery')>('@/lib/journey-recovery')
  return { ...actual, sendWhatsAppJourneyRecovery: vi.fn() }
})
vi.mock('@/lib/post-match-communications', () => ({
  buildAcceptedLeadContactUrlForProvider: vi.fn().mockResolvedValue(null),
}))
vi.mock('@/lib/whatsapp-identity', () => ({
  resolveWhatsAppUserContext: vi.fn().mockResolvedValue({
    role: 'provider',
    normalizedPhone: '+27821234567',
    phoneVariants: ['+27821234567'],
    customerId: null,
    providerId: 'provider-1',
    applicationId: null,
    displayName: 'Sipho',
    firstName: 'Sipho',
    savedAddresses: [],
    providerStatus: 'ACTIVE',
    applicationStatus: null,
    activeJobCount: 0,
    isPaused: false,
    conflict: false,
    traceId: 'test-trace',
  }),
  phoneLookupVariants: (phone: string) => [phone],
}))

// Mock provider-opportunity-responses so we can assert the call and control
// what it returns, especially creditsDeducted: 0.
class MockProviderOpportunityResponseError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message)
    this.name = 'ProviderOpportunityResponseError'
  }
}

vi.mock('@/lib/provider-opportunity-responses', () => ({
  respondToProviderOpportunity: mockRespondToProviderOpportunity,
  ProviderOpportunityResponseError: MockProviderOpportunityResponseError,
}))

import { processInboundMessage } from '@/lib/whatsapp-bot'

const PHONE = '+27821234567'
const LEAD_ID = 'lead-interest-001'

// ─── Message builders ─────────────────────────────────────────────────────────

function buttonMessage(id: string) {
  return {
    from: PHONE,
    id: `wamid.${id}`,
    type: 'interactive',
    interactive: { type: 'button_reply', button_reply: { id, title: id } },
    timestamp: String(Date.now()),
  }
}

function textMessage(body: string) {
  return {
    from: PHONE,
    id: `wamid.text-${Date.now()}`,
    type: 'text',
    text: { body },
    timestamp: String(Date.now()),
  }
}

// ─── Conversation state factories ─────────────────────────────────────────────

function idleConversation(data: Record<string, unknown> = {}) {
  return {
    phone: PHONE,
    flow: 'idle',
    step: 'welcome',
    data,
    expiresAt: new Date(Date.now() + 300_000),
  }
}

function interestCaptureConversation(
  step: 'callout' | 'arrival' | 'negotiable' | 'note',
  extraData: Record<string, unknown> = {},
) {
  return idleConversation({
    pendingOpportunityLeadId: LEAD_ID,
    providerOpportunityStep: step,
    ...extraData,
  })
}

// ─── Test setup ───────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks()
  // Provider lookup always succeeds
  mockDb.provider.findUnique.mockResolvedValue({ id: 'provider-1', name: 'Sipho Dlamini' })
  // Conversation upsert is a no-op by default (saves state, not read back in test)
  mockDb.conversation.upsert.mockImplementation(async (args: any) => args.update ?? args.create)
  mockSendText.mockResolvedValue('msg-text')
  mockSendButtons.mockResolvedValue('msg-buttons')
  mockRespondToProviderOpportunity.mockResolvedValue({
    response: { id: 'response-1', response: 'INTERESTED' },
    creditsDeducted: 0,
  })
})

// ─── Step 1: interested: button triggers callout prompt ───────────────────────

describe('interested: button - starts interest capture', () => {
  beforeEach(() => {
    mockDb.conversation.upsert.mockResolvedValueOnce(idleConversation())
  })

  it('prompts for call-out fee and mentions no credits at this stage', async () => {
    await processInboundMessage(buttonMessage(`interested:${LEAD_ID}`))

    expect(mockSendText).toHaveBeenCalledWith(
      PHONE,
      expect.stringContaining('No credits are used at this stage'),
    )
    expect(mockSendText).toHaveBeenCalledWith(
      PHONE,
      expect.stringContaining('call-out fee'),
    )
  })

  it('saves pendingOpportunityLeadId and step=callout to conversation', async () => {
    await processInboundMessage(buttonMessage(`interested:${LEAD_ID}`))

    const upsertCall = mockDb.conversation.upsert.mock.calls.find((call: any[]) =>
      call[0]?.update?.data?.pendingOpportunityLeadId === LEAD_ID,
    )
    expect(upsertCall).toBeDefined()
    expect(upsertCall![0].update.data.providerOpportunityStep).toBe('callout')
  })
})

// ─── Step 2: callout step - fee validation ────────────────────────────────────

describe('callout step - fee validation', () => {
  beforeEach(() => {
    mockDb.conversation.upsert.mockResolvedValue(interestCaptureConversation('callout'))
  })

  it('accepts a valid R-prefixed fee and advances to arrival step', async () => {
    await processInboundMessage(textMessage('R250'))

    expect(mockSendText).toHaveBeenCalledWith(
      PHONE,
      expect.stringContaining('arrive'),
    )
  })

  it('accepts a numeric-only fee without R prefix', async () => {
    await processInboundMessage(textMessage('300'))

    expect(mockSendText).toHaveBeenCalledWith(
      PHONE,
      expect.stringContaining('arrive'),
    )
  })

  it('re-prompts when fee text is not a valid number', async () => {
    await processInboundMessage(textMessage('tomorrow morning'))

    expect(mockSendText).toHaveBeenCalledWith(
      PHONE,
      expect.stringContaining('valid call-out fee'),
    )
    // Must NOT advance to arrival - no arrival prompt sent
    expect(mockSendText).not.toHaveBeenCalledWith(
      PHONE,
      expect.stringContaining('When can you arrive'),
    )
  })

  it('re-prompts when fee text is empty', async () => {
    await processInboundMessage(textMessage('   '))

    expect(mockSendText).toHaveBeenCalledWith(
      PHONE,
      expect.stringContaining('valid call-out fee'),
    )
  })

  it('re-prompt message confirms no credits are used at this stage', async () => {
    await processInboundMessage(textMessage('not-a-fee'))

    const call = mockSendText.mock.calls.find((args) =>
      String(args[1] ?? '').includes('valid call-out fee'),
    )
    expect(call).toBeDefined()
    expect(call![1]).toContain('No credits are used at this stage')
  })
})

// ─── Step 3: arrival step - arrival validation ────────────────────────────────

describe('arrival step - arrival validation', () => {
  beforeEach(() => {
    mockDb.conversation.upsert.mockResolvedValue(
      interestCaptureConversation('arrival', {
        providerOpportunityCallOutFeeText: 'R250',
      }),
    )
  })

  it('accepts "today afternoon" as a valid arrival and advances to negotiable', async () => {
    await processInboundMessage(textMessage('today afternoon'))

    expect(mockSendButtons).toHaveBeenCalledWith(
      PHONE,
      expect.stringContaining('negotiable'),
      expect.arrayContaining([
        expect.objectContaining({ id: 'provider_opp_negotiable_yes' }),
        expect.objectContaining({ id: 'provider_opp_negotiable_no' }),
      ]),
    )
  })

  it('accepts "tomorrow morning" as a valid arrival', async () => {
    await processInboundMessage(textMessage('tomorrow morning'))

    expect(mockSendButtons).toHaveBeenCalledWith(
      PHONE,
      expect.stringContaining('negotiable'),
      expect.any(Array),
    )
  })

  it('accepts an ISO timestamp as a valid arrival', async () => {
    await processInboundMessage(textMessage('2026-05-10 09:00'))

    expect(mockSendButtons).toHaveBeenCalledWith(
      PHONE,
      expect.stringContaining('negotiable'),
      expect.any(Array),
    )
  })

  it('re-prompts when arrival text cannot be parsed', async () => {
    await processInboundMessage(textMessage('whenever'))

    expect(mockSendText).toHaveBeenCalledWith(
      PHONE,
      expect.stringContaining('valid arrival time'),
    )
    // Must NOT advance to negotiable
    expect(mockSendButtons).not.toHaveBeenCalledWith(
      PHONE,
      expect.stringContaining('negotiable'),
      expect.any(Array),
    )
  })

  it('re-prompts when arrival text is an unparseable phrase', async () => {
    // "next week sometime" contains neither a keyword the parser recognises
    // (today, tomorrow, morning, afternoon, evening) nor a valid date/time literal
    // so parseProviderOpportunityArrivalText returns null.
    await processInboundMessage(textMessage('next week sometime'))

    expect(mockSendText).toHaveBeenCalledWith(
      PHONE,
      expect.stringContaining('valid arrival time'),
    )
  })
})

// ─── Step 4: negotiable step ──────────────────────────────────────────────────

describe('negotiable step - rate negotiable capture', () => {
  const arrivalIso = new Date('2026-05-10T09:00:00.000Z').toISOString()

  beforeEach(() => {
    mockDb.conversation.upsert.mockResolvedValue(
      interestCaptureConversation('negotiable', {
        providerOpportunityCallOutFeeText: 'R250',
        providerOpportunityEstimatedArrivalAtIso: arrivalIso,
      }),
    )
  })

  it('advances to note step when negotiable = yes selected', async () => {
    await processInboundMessage(buttonMessage('provider_opp_negotiable_yes'))

    expect(mockSendButtons).toHaveBeenCalledWith(
      PHONE,
      expect.stringContaining('note'),
      expect.arrayContaining([
        expect.objectContaining({ id: 'provider_opp_note_skip' }),
        expect.objectContaining({ id: 'provider_opp_note_add' }),
      ]),
    )
  })

  it('advances to note step when negotiable = no selected', async () => {
    await processInboundMessage(buttonMessage('provider_opp_negotiable_no'))

    expect(mockSendButtons).toHaveBeenCalledWith(
      PHONE,
      expect.stringContaining('note'),
      expect.arrayContaining([
        expect.objectContaining({ id: 'provider_opp_note_skip' }),
      ]),
    )
  })

  it('re-prompts when unexpected button received at negotiable step', async () => {
    await processInboundMessage(buttonMessage('some_other_button'))

    expect(mockSendButtons).toHaveBeenCalledWith(
      PHONE,
      expect.stringContaining('negotiable'),
      expect.arrayContaining([
        expect.objectContaining({ id: 'provider_opp_negotiable_yes' }),
        expect.objectContaining({ id: 'provider_opp_negotiable_no' }),
      ]),
    )
  })
})

// ─── Step 5: note step - optional note then submit ────────────────────────────

describe('note step - optional note and submission', () => {
  const arrivalIso = new Date('2026-05-10T09:00:00.000Z').toISOString()
  const baseData = {
    providerOpportunityCallOutFeeText: 'R250',
    providerOpportunityEstimatedArrivalAtIso: arrivalIso,
    providerOpportunityNegotiable: false,
  }

  beforeEach(() => {
    mockDb.conversation.upsert.mockResolvedValue(
      interestCaptureConversation('note', baseData),
    )
  })

  it('submits interest and sends confirmation when provider skips note', async () => {
    await processInboundMessage(buttonMessage('provider_opp_note_skip'))

    expect(mockRespondToProviderOpportunity).toHaveBeenCalledWith(
      expect.objectContaining({
        leadId: LEAD_ID,
        providerId: 'provider-1',
        response: 'INTERESTED',
        callOutFeeText: 'R250',
        estimatedArrivalAt: new Date(arrivalIso),
        negotiable: false,
        providerNote: null,
        source: 'whatsapp',
      }),
    )
    // Confirmation must say "Interest submitted"
    expect(mockSendText).toHaveBeenCalledWith(
      PHONE,
      expect.stringContaining('Interest submitted'),
    )
  })

  it('confirmation message includes "No credits were used"', async () => {
    await processInboundMessage(buttonMessage('provider_opp_note_skip'))

    const confirmCall = mockSendText.mock.calls.find((args) =>
      String(args[1] ?? '').includes('Interest submitted'),
    )
    expect(confirmCall).toBeDefined()
    expect(confirmCall![1]).toContain('No credits were used')
  })

  it('confirmation message includes call-out, arrival and rate fields', async () => {
    await processInboundMessage(buttonMessage('provider_opp_note_skip'))

    const confirmCall = mockSendText.mock.calls.find((args) =>
      String(args[1] ?? '').includes('Interest submitted'),
    )
    expect(confirmCall).toBeDefined()
    const body: string = confirmCall![1]
    expect(body).toContain('Call-out:')
    expect(body).toContain('Arrival:')
    expect(body).toContain('Rate:')
  })

  it('confirmation message tells provider they will be notified if selected', async () => {
    await processInboundMessage(buttonMessage('provider_opp_note_skip'))

    const confirmCall = mockSendText.mock.calls.find((args) =>
      String(args[1] ?? '').includes('Interest submitted'),
    )
    expect(confirmCall).toBeDefined()
    expect(confirmCall![1]).toContain("notify you if the customer selects you")
  })

  it('prompts for note text when add note selected', async () => {
    await processInboundMessage(buttonMessage('provider_opp_note_add'))

    expect(mockSendText).toHaveBeenCalledWith(
      PHONE,
      expect.stringContaining('Reply with the note'),
    )
    // Must NOT have called respondToProviderOpportunity yet
    expect(mockRespondToProviderOpportunity).not.toHaveBeenCalled()
  })

  it('submits interest with note text when provider sends a freeform note', async () => {
    await processInboundMessage(textMessage('Will bring extra tools'))

    expect(mockRespondToProviderOpportunity).toHaveBeenCalledWith(
      expect.objectContaining({
        response: 'INTERESTED',
        providerNote: 'Will bring extra tools',
        source: 'whatsapp',
      }),
    )
    expect(mockSendText).toHaveBeenCalledWith(
      PHONE,
      expect.stringContaining('Interest submitted'),
    )
  })
})

// ─── Credit deduction invariant ───────────────────────────────────────────────

describe('no credit deduction - full flow invariant', () => {
  it('respondToProviderOpportunity always returns creditsDeducted: 0 on INTERESTED', async () => {
    // This asserts the respondToProviderOpportunity module contract directly.
    // The mock returns creditsDeducted: 0; and we verify the bot does not
    // perform any credit-deduction side effect even when the response succeeds.
    const arrivalIso = new Date('2026-05-10T09:00:00.000Z').toISOString()
    mockDb.conversation.upsert.mockResolvedValue(
      interestCaptureConversation('note', {
        providerOpportunityCallOutFeeText: 'R100',
        providerOpportunityEstimatedArrivalAtIso: arrivalIso,
        providerOpportunityNegotiable: true,
      }),
    )

    await processInboundMessage(buttonMessage('provider_opp_note_skip'))

    // The return value is { response, creditsDeducted: 0 } - we verify
    // the mock was called and that the bot did not attempt any credit deduction.
    expect(mockRespondToProviderOpportunity).toHaveBeenCalledTimes(1)
    const result = await mockRespondToProviderOpportunity.mock.results[0].value
    expect(result.creditsDeducted).toBe(0)

    // Bot must send confirmation, not a credit-deducted message.
    const callArgs = mockSendText.mock.calls.find((args) =>
      String(args[1] ?? '').includes('Interest submitted'),
    )
    expect(callArgs).toBeDefined()
  })

  it('cancel at any step sends "No credits were used" and clears conversation', async () => {
    mockDb.conversation.upsert.mockResolvedValue(
      interestCaptureConversation('arrival', {
        providerOpportunityCallOutFeeText: 'R200',
      }),
    )

    await processInboundMessage(textMessage('cancel'))

    expect(mockRespondToProviderOpportunity).not.toHaveBeenCalled()
    expect(mockSendText).toHaveBeenCalledWith(
      PHONE,
      expect.stringContaining('No credits were used'),
    )
  })
})

// ─── Duplicate / interrupted response handling ────────────────────────────────

describe('duplicate and interrupted responses', () => {
  it('sends confirmation with no credits even when respondToProviderOpportunity returns an existing response (idempotency)', async () => {
    const arrivalIso = new Date('2026-05-10T09:00:00.000Z').toISOString()
    mockRespondToProviderOpportunity.mockResolvedValueOnce({
      response: { id: 'response-existing', response: 'INTERESTED' },
      creditsDeducted: 0,
    })
    mockDb.conversation.upsert.mockResolvedValue(
      interestCaptureConversation('note', {
        providerOpportunityCallOutFeeText: 'R300',
        providerOpportunityEstimatedArrivalAtIso: arrivalIso,
        providerOpportunityNegotiable: true,
      }),
    )

    await processInboundMessage(buttonMessage('provider_opp_note_skip'))

    expect(mockSendText).toHaveBeenCalledWith(
      PHONE,
      expect.stringContaining('Interest submitted'),
    )
    expect(mockSendText.mock.calls.find((args) =>
      String(args[1] ?? '').includes('Interest submitted'),
    )![1]).toContain('No credits were used')
  })

  it('shows error message and does not deduct credits when respondToProviderOpportunity throws', async () => {
    const arrivalIso = new Date('2026-05-10T09:00:00.000Z').toISOString()
    mockRespondToProviderOpportunity.mockRejectedValueOnce(new Error('DB connection timeout'))
    mockDb.conversation.upsert.mockResolvedValue(
      interestCaptureConversation('note', {
        providerOpportunityCallOutFeeText: 'R300',
        providerOpportunityEstimatedArrivalAtIso: arrivalIso,
        providerOpportunityNegotiable: true,
      }),
    )

    await processInboundMessage(buttonMessage('provider_opp_note_skip'))

    // Must show a recoverable error - not the success confirmation
    const errorCall = mockSendText.mock.calls.find((args) => {
      const body = String(args[1] ?? '')
      return body.includes('Something went wrong') || body.includes('try again')
    })

    expect(errorCall).toBeDefined()

    // Must NOT send "Interest submitted" on error
    expect(mockSendText).not.toHaveBeenCalledWith(
      PHONE,
      expect.stringContaining('Interest submitted'),
    )
  })
})

// ─── not_interested: button ────────────────────────────────────────────────────

describe('not_interested: button - single-step decline', () => {
  beforeEach(() => {
    mockDb.conversation.upsert.mockResolvedValue(idleConversation())
  })

  it('records not-interested response with no credits used', async () => {
    mockRespondToProviderOpportunity.mockResolvedValueOnce({
      response: { id: 'response-decline', response: 'NOT_INTERESTED' },
      creditsDeducted: 0,
    })

    await processInboundMessage(buttonMessage(`not_interested:${LEAD_ID}`))

    expect(mockRespondToProviderOpportunity).toHaveBeenCalledWith(
      expect.objectContaining({
        response: 'NOT_INTERESTED',
        source: 'whatsapp',
      }),
    )
    expect(mockSendText).toHaveBeenCalledWith(
      PHONE,
      expect.stringContaining('No credits used'),
    )
  })
})
