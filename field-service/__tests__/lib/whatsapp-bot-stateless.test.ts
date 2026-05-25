import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockDb,
  mockAcceptLead,
  mockAcceptAssignmentOffer,
  mockNotifyPostMatchAcceptance,
  mockAcceptSelectedProviderJob,
  mockDeclineSelectedProviderJob,
  mockProcessQuoteDecision,
  mockOrchestrateMatch,
  mockSendJourneyRecovery,
  mockSendText,
  mockSendButtons,
  mockSendCtaUrl,
  mockBuildAcceptedLeadContactUrlForProvider,
} = vi.hoisted(() => ({
  mockDb: {
    conversation: { findUnique: vi.fn(), upsert: vi.fn() },
    provider: { findUnique: vi.fn(), findFirst: vi.fn() },
    lead: { findFirst: vi.fn(), findMany: vi.fn(), findUnique: vi.fn(), updateMany: vi.fn() },
    customer: { findUnique: vi.fn() },
    jobRequest: { findFirst: vi.fn(), findUnique: vi.fn(), update: vi.fn() },
    messageEvent: { create: vi.fn(), findFirst: vi.fn() },
    match: { findFirst: vi.fn() },
    booking: { findFirst: vi.fn() },
    providerWallet: { findUnique: vi.fn(), updateMany: vi.fn() },
    providerIdentityVerification: { findFirst: vi.fn() },
    providerApplication: {
      findFirst: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn(),
    },
  },
  mockAcceptLead: vi.fn(),
  mockAcceptAssignmentOffer: vi.fn(),
  mockNotifyPostMatchAcceptance: vi.fn(),
  mockAcceptSelectedProviderJob: vi.fn(),
  mockDeclineSelectedProviderJob: vi.fn(),
  mockProcessQuoteDecision: vi.fn(),
  mockOrchestrateMatch: vi.fn(),
  mockSendJourneyRecovery: vi.fn(),
  mockSendText: vi.fn(),
  mockSendButtons: vi.fn(),
  mockSendCtaUrl: vi.fn(),
  mockBuildAcceptedLeadContactUrlForProvider: vi.fn(),
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
vi.mock('@/lib/matching/service', () => ({ acceptAssignmentOffer: mockAcceptAssignmentOffer }))
vi.mock('@/lib/selected-provider-acceptance', () => ({
  acceptSelectedProviderJob: mockAcceptSelectedProviderJob,
}))
vi.mock('@/lib/customer-shortlists', () => ({
  declineSelectedProviderJob: mockDeclineSelectedProviderJob,
}))
vi.mock('@/lib/quotes', () => ({ processQuoteDecision: mockProcessQuoteDecision }))
vi.mock('@/lib/matching/orchestrator', () => ({ orchestrateMatch: mockOrchestrateMatch }))
vi.mock('@/lib/whatsapp', () => ({ sendProviderAssigned: vi.fn() }))
vi.mock('@/lib/journey-recovery', async () => {
  const actual = await vi.importActual<typeof import('@/lib/journey-recovery')>('@/lib/journey-recovery')
  return {
    ...actual,
    sendWhatsAppJourneyRecovery: mockSendJourneyRecovery,
  }
})
vi.mock('@/lib/post-match-communications', () => ({
  buildAcceptedLeadContactUrlForProvider: mockBuildAcceptedLeadContactUrlForProvider,
  notifyPostMatchAcceptance: mockNotifyPostMatchAcceptance,
}))
vi.mock('@/lib/whatsapp-identity', () => ({
  resolveWhatsAppUserContext: vi.fn().mockResolvedValue({
    role: 'unknown',
    normalizedPhone: '+27821234567',
    phoneVariants: ['+27821234567'],
    customerId: null,
    providerId: null,
    applicationId: null,
    displayName: null,
    firstName: null,
    savedAddresses: [],
    providerStatus: null,
    applicationStatus: null,
    activeJobCount: 0,
    isPaused: false,
    conflict: false,
    traceId: 'test-trace',
  }),
  phoneLookupVariants: (phone: string) => [phone],
}))

import { processInboundMessage } from '@/lib/whatsapp-bot'
import { handleJobRequestFlow, showMainMenu } from '@/lib/whatsapp-flows/job-request'
import { handleRegistrationFlow } from '@/lib/whatsapp-flows/registration'
import { handleStatusFlow } from '@/lib/whatsapp-flows/status'
import { handleProviderJourneyFlow } from '@/lib/whatsapp-flows/provider-journey'
import { resolveWhatsAppUserContext } from '@/lib/whatsapp-identity'

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

function imageMessage(mediaId: string) {
  return {
    from: PHONE,
    id: `wamid.${mediaId}`,
    type: 'image',
    image: { id: mediaId, mime_type: 'image/jpeg' },
    timestamp: String(Date.now()),
  }
}

function textMessage(id: string, body: string) {
  return {
    from: PHONE,
    id,
    type: 'text',
    text: { body },
    timestamp: String(Date.now()),
  }
}

function textMessageWithContext(id: string, body: string, contextId?: string) {
  return {
    from: PHONE,
    id,
    type: 'text',
    text: { body },
    timestamp: String(Date.now()),
    ...(contextId ? { context: { id: contextId, from: PHONE } } : {}),
  }
}

function buttonPayloadMessage(payload: string, title = payload, contextId?: string) {
  return {
    from: PHONE,
    id: `wamid.${payload}`,
    type: 'button',
    button: { payload, text: title },
    timestamp: String(Date.now()),
    ...(contextId ? { context: { id: contextId, from: PHONE } } : {}),
  }
}

function listReplyMessage(id: string, title = id) {
  return {
    from: PHONE,
    id: `wamid.${id}`,
    type: 'interactive',
    interactive: {
      type: 'list_reply',
      list_reply: { id, title },
    },
    timestamp: String(Date.now()),
  }
}

describe('processInboundMessage stateless notification replies', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useRealTimers()
    mockSendText.mockResolvedValue('msg-text')
    mockSendButtons.mockResolvedValue('msg-buttons')
    mockSendCtaUrl.mockResolvedValue('msg-cta')
    mockSendJourneyRecovery.mockResolvedValue(undefined)
    mockAcceptSelectedProviderJob.mockResolvedValue({
      ok: true,
      creditCheck: {
        ok: true,
        providerMessage: 'Accepted. Credit check passed.',
      },
      notificationSent: false,
    })
    mockDeclineSelectedProviderJob.mockResolvedValue({ ok: true })
    mockDb.lead.findFirst.mockReset()
    mockDb.lead.findFirst.mockResolvedValue(null)
    mockDb.lead.findMany.mockReset()
    mockDb.lead.findMany.mockResolvedValue([])
    mockDb.provider.findFirst.mockReset()
    mockDb.provider.findFirst.mockResolvedValue(null)
    mockDb.providerIdentityVerification.findFirst.mockReset()
    mockDb.providerIdentityVerification.findFirst.mockResolvedValue(null)
    mockDb.messageEvent.findFirst.mockReset()
    mockDb.messageEvent.findFirst.mockResolvedValue(null)
    mockDb.providerApplication.findFirst.mockResolvedValue(null)
    mockDb.providerApplication.findUnique.mockResolvedValue(null)
    mockDb.providerApplication.update.mockResolvedValue({})
    mockBuildAcceptedLeadContactUrlForProvider.mockResolvedValue('https://wa.me/27820000001?text=hello')
    expiredMidFlowConversation()
  })

  it('captures MORE_INFO_REQUIRED onboarding replies as more-info responses when no command is detected', async () => {
    // Use an idle (non-expired) conversation so the session-timeout early-return is skipped
    // and the MORE_INFO_REQUIRED recognizer at the bottom of processInboundMessageUnlocked is reached.
    mockDb.conversation.upsert.mockResolvedValueOnce({
      phone: PHONE,
      flow: 'idle',
      step: 'welcome',
      data: {},
      expiresAt: new Date(Date.now() + 60_000),
    })
    mockDb.providerApplication.findFirst.mockResolvedValue({
      id: 'more-info-app-1',
      phone: PHONE,
      status: 'MORE_INFO_REQUIRED',
      submittedAt: new Date(),
    } as any)
    mockDb.providerApplication.findUnique.mockResolvedValue({
      id: 'more-info-app-1',
      status: 'MORE_INFO_REQUIRED',
      notes: 'Previous verification request.',
    } as any)

    await processInboundMessage(textMessage('wamid.more-info-reply', 'I have uploaded my additional documents.'))

    expect(mockDb.providerApplication.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ status: 'MORE_INFO_REQUIRED' }),
      }),
    )
    expect(mockDb.providerApplication.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'more-info-app-1' },
      }),
    )
    expect(mockDb.providerApplication.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'more-info-app-1' },
        data: expect.objectContaining({ status: 'PENDING' }),
      }),
    )
    expect(mockSendText).toHaveBeenCalledWith(
      PHONE,
      expect.stringContaining('Thanks — your reply has been added to your application.'),
    )
    expect(handleJobRequestFlow).not.toHaveBeenCalled()
    expect(handleRegistrationFlow).not.toHaveBeenCalled()
  })

  it('processes assignment accept buttons even when the previous conversation session expired mid-flow', async () => {
    mockDb.provider.findUnique.mockResolvedValue({ id: 'provider-1', name: 'Sipho Dlamini' })
    mockDb.lead.findFirst.mockResolvedValue({ id: 'lead-1', jobRequestId: 'jr-1', providerId: 'provider-1' })
    mockAcceptAssignmentOffer.mockResolvedValue({ ok: true, matchId: 'match-1', creditTransactionId: null, currentCreditBalance: 2 })
    mockNotifyPostMatchAcceptance.mockResolvedValue({ providerNotified: true, customerNotified: true })
    mockDb.jobRequest.findUnique.mockResolvedValue(null)

    await processInboundMessage(buttonMessage('accept:hold-1'))

    expect(mockAcceptAssignmentOffer).toHaveBeenCalledWith({ leadId: 'lead-1', providerId: 'provider-1', source: 'whatsapp' })
    expect(mockSendButtons).not.toHaveBeenCalledWith(
      PHONE,
      expect.stringContaining('Your session timed out'),
      expect.any(Array),
    )
  })

  it('blocks WhatsApp assignment accept when the provider has zero credits', async () => {
    mockDb.provider.findUnique.mockResolvedValue({ id: 'provider-1', name: 'Sipho Dlamini' })
    mockDb.lead.findFirst.mockResolvedValue({ id: 'lead-1', jobRequestId: 'jr-1', providerId: 'provider-1' })
    mockAcceptAssignmentOffer.mockResolvedValue({
      ok: false,
      reason: 'INSUFFICIENT_CREDITS',
      currentCreditBalance: 0,
    })

    await processInboundMessage(buttonMessage('accept:hold-1'))

    expect(mockAcceptAssignmentOffer).toHaveBeenCalledWith({
      leadId: 'lead-1',
      providerId: 'provider-1',
      source: 'whatsapp',
    })
    expect(mockSendButtons).toHaveBeenCalledWith(
      PHONE,
      expect.stringContaining('You need 1 credit to continue with this job'),
      expect.arrayContaining([
        expect.objectContaining({ id: 'provider_top_up_credits', title: 'Top up credits' }),
        expect.objectContaining({ id: 'accept:hold-1', title: 'View lead' }),
        expect.objectContaining({ id: 'back_home', title: 'Main Menu' }),
      ]),
    )
  })

  it('returns a traceable technical message when WhatsApp assignment accept throws unexpectedly', async () => {
    mockDb.provider.findUnique.mockResolvedValue({ id: 'provider-1', name: 'Sipho Dlamini' })
    mockDb.lead.findFirst.mockResolvedValue({ id: 'lead-1', jobRequestId: 'jr-1', providerId: 'provider-1' })
    mockAcceptAssignmentOffer.mockRejectedValue(new Error('database timeout'))

    await processInboundMessage(buttonMessage('accept:hold-1'))

    expect(mockSendJourneyRecovery).toHaveBeenCalledWith(
      PHONE,
      expect.objectContaining({
        userRole: 'provider',
        flowName: 'provider_matching',
        currentStep: 'assignment_accept',
        failureType: 'dependency_failure',
        requestId: 'lead-1',
      }),
    )
  })

  it('uses journey recovery when match-level accept throws unexpectedly', async () => {
    mockDb.provider.findUnique.mockResolvedValue({ id: 'provider-1', name: 'Sipho Dlamini' })
    mockDb.lead.findUnique.mockResolvedValue({
      id: 'lead-101',
      providerId: 'provider-1',
      provider: { id: 'provider-1' },
      jobRequest: {
        address: { suburb: 'Rosebank' },
        category: 'Plumbing',
      },
    })
    mockAcceptLead.mockRejectedValue(new Error('matching timeout'))

    await processInboundMessage(buttonMessage('match_accept_lead-101'))

    expect(mockAcceptLead).toHaveBeenCalledWith({
      leadId: 'lead-101',
      providerId: 'provider-1',
      inspectionNeeded: false,
      source: 'whatsapp',
    })
    expect(mockSendJourneyRecovery).toHaveBeenCalledWith(
      PHONE,
      expect.objectContaining({
        userRole: 'provider',
        flowName: 'provider_matching',
        currentStep: 'match_accept',
        failureType: 'dependency_failure',
        requestId: 'lead-101',
      }),
    )
  })

  it('uses journey recovery when selected-provider confirmation fails unexpectedly', async () => {
    mockDb.provider.findUnique.mockResolvedValue({ id: 'provider-1', name: 'Sipho Dlamini' })
    mockAcceptSelectedProviderJob.mockResolvedValue({
      ok: false,
      reason: 'UNSUPPORTED_STATE',
      currentCreditBalance: 4,
    })

    await processInboundMessage(buttonMessage('confirm_accept:lead-short-1'))

    expect(mockAcceptSelectedProviderJob).toHaveBeenCalledWith({
      leadId: 'lead-short-1',
      providerId: 'provider-1',
      source: 'whatsapp',
      traceId: expect.any(String),
    })
    expect(mockSendJourneyRecovery).toHaveBeenCalledWith(
      PHONE,
      expect.objectContaining({
        userRole: 'provider',
        flowName: 'provider_shortlist',
        currentStep: 'confirm_accept',
        failureType: 'dependency_failure',
        requestId: 'lead-short-1',
      }),
    )
  })

  it('routes typed accept to the latest notified selected-provider lead', async () => {
    mockDb.provider.findUnique.mockResolvedValue({ id: 'provider-1', name: 'Sipho Dlamini' })
    mockDb.lead.findFirst.mockResolvedValueOnce({ id: 'lead-selected-1' })
    mockAcceptSelectedProviderJob.mockResolvedValue({
      ok: true,
      creditCheck: {
        ok: true,
        providerMessage: 'Accepted. Credit check passed.',
      },
      notificationSent: true,
    })

    await processInboundMessage(textMessage('wamid.typed-accept', 'accept'))

    expect(mockDb.lead.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          providerId: 'provider-1',
          status: { in: ['CUSTOMER_SELECTED', 'PROVIDER_ACCEPTED', 'CREDIT_REQUIRED'] },
          jobRequest: expect.objectContaining({
            status: 'PROVIDER_CONFIRMATION_PENDING',
            selectedProviderId: 'provider-1',
          }),
        }),
      }),
    )
    expect(mockAcceptSelectedProviderJob).toHaveBeenCalledWith({
      leadId: 'lead-selected-1',
      providerId: 'provider-1',
      source: 'whatsapp',
      traceId: expect.any(String),
    })
  })

  it('routes typed decline to the latest notified selected-provider lead', async () => {
    mockDb.provider.findUnique.mockResolvedValue({ id: 'provider-1', name: 'Sipho Dlamini' })
    mockDb.lead.findFirst.mockResolvedValueOnce({ id: 'lead-selected-2' })

    await processInboundMessage(textMessage('wamid.typed-decline', 'decline'))

    expect(mockDeclineSelectedProviderJob).toHaveBeenCalledWith({
      leadId: 'lead-selected-2',
      providerId: 'provider-1',
    })
    expect(mockSendText).toHaveBeenCalledWith(
      PHONE,
      expect.stringContaining('No problem'),
    )
  })

  it('rejects typed accept when the WhatsApp number is not a provider', async () => {
    mockDb.provider.findUnique.mockResolvedValue(null)
    ;(mockDb.provider as any).findFirst = vi.fn().mockResolvedValue(null)

    await processInboundMessage(textMessage('wamid.unknown-provider-accept', 'accept'))

    expect(mockAcceptSelectedProviderJob).not.toHaveBeenCalled()
    expect(mockSendText).toHaveBeenCalledWith(
      PHONE,
      expect.stringContaining("couldn't find your provider profile"),
    )
  })

  // Scenario 10: unknown provider phone sends confirm_accept button
  it('sends provider-not-found message when confirm_accept button comes from an unknown WhatsApp number', async () => {
    mockDb.provider.findUnique.mockResolvedValue(null)
    ;(mockDb.provider as any).findFirst = vi.fn().mockResolvedValue(null)

    await processInboundMessage(buttonMessage('confirm_accept:lead-scenario-10'))

    expect(mockAcceptSelectedProviderJob).not.toHaveBeenCalled()
    expect(mockSendText).toHaveBeenCalledWith(
      PHONE,
      expect.stringContaining("couldn't find your provider profile"),
    )
  })

  it('sends provider-not-found message when confirm_decline button comes from an unknown WhatsApp number', async () => {
    mockDb.provider.findUnique.mockResolvedValue(null)
    ;(mockDb.provider as any).findFirst = vi.fn().mockResolvedValue(null)

    await processInboundMessage(buttonMessage('confirm_decline:lead-scenario-10'))

    expect(mockDeclineSelectedProviderJob).not.toHaveBeenCalled()
    expect(mockSendText).toHaveBeenCalledWith(
      PHONE,
      expect.stringContaining("couldn't find your provider profile"),
    )
  })

  // Scenario 11: confirm_accept button arrives with an empty lead ID
  it('sends cannot-read-selection message when confirm_accept button has an empty lead ID', async () => {
    await processInboundMessage(buttonMessage('confirm_accept:'))

    expect(mockAcceptSelectedProviderJob).not.toHaveBeenCalled()
    expect(mockSendText).toHaveBeenCalledWith(
      PHONE,
      expect.stringContaining("couldn't read that selection"),
    )
  })

  it('sends a useful response for an invalid provider WhatsApp command', async () => {
    vi.mocked(resolveWhatsAppUserContext).mockResolvedValueOnce({
      role: 'provider',
      normalizedPhone: '+27821234567',
      phoneVariants: ['+27821234567'],
      customerId: undefined,
      providerId: 'provider-1',
      applicationId: undefined,
      displayName: 'Sipho',
      firstName: 'Sipho',
      savedAddresses: [],
      providerStatus: 'ACTIVE',
      applicationStatus: undefined,
      activeJobCount: 0,
      isPaused: false,
      conflict: false,
      traceId: 'provider-trace',
    })
    mockDb.conversation.upsert.mockResolvedValue({
      phone: PHONE,
      flow: 'idle',
      step: 'welcome',
      data: {},
      expiresAt: new Date(Date.now() + 120_000),
    })

    await processInboundMessage(textMessage('wamid.invalid-provider-command', 'banana'))

    expect(mockSendText).toHaveBeenCalledWith(
      PHONE,
      expect.stringContaining("Sorry, I didn't understand"),
    )
    expect(mockAcceptSelectedProviderJob).not.toHaveBeenCalled()
    expect(mockDeclineSelectedProviderJob).not.toHaveBeenCalled()
  })

  it('sends job-unavailable message with no-deduction confirmation when LEAD_EXPIRED on confirm_accept', async () => {
    mockDb.provider.findUnique.mockResolvedValue({ id: 'provider-1', name: 'Sipho Dlamini' })
    mockAcceptSelectedProviderJob.mockResolvedValue({
      ok: false,
      reason: 'LEAD_EXPIRED',
    })

    await processInboundMessage(buttonMessage('confirm_accept:lead-short-2'))

    expect(mockSendText).toHaveBeenCalledWith(
      PHONE,
      expect.stringContaining('This job is no longer available'),
    )
    expect(mockSendText).toHaveBeenCalledWith(
      PHONE,
      expect.stringContaining('No credit was deducted'),
    )
  })

  it('sends job-unavailable message with no-deduction confirmation when REQUEST_NOT_AWAITING_CONFIRMATION on confirm_accept', async () => {
    mockDb.provider.findUnique.mockResolvedValue({ id: 'provider-1', name: 'Sipho Dlamini' })
    mockAcceptSelectedProviderJob.mockResolvedValue({
      ok: false,
      reason: 'REQUEST_NOT_AWAITING_CONFIRMATION',
    })

    await processInboundMessage(buttonMessage('confirm_accept:lead-short-3'))

    expect(mockSendText).toHaveBeenCalledWith(
      PHONE,
      expect.stringContaining('This job is no longer available'),
    )
    expect(mockSendText).toHaveBeenCalledWith(
      PHONE,
      expect.stringContaining('No credit was deducted'),
    )
  })

  it('sends insufficient-credits message with no-deduction confirmation on confirm_accept', async () => {
    mockDb.provider.findUnique.mockResolvedValue({ id: 'provider-1', name: 'Sipho Dlamini' })
    mockAcceptSelectedProviderJob.mockResolvedValue({
      ok: true,
      creditCheck: {
        ok: false,
        reason: 'INSUFFICIENT_CREDITS',
        providerMessage: 'Not enough credits.\n\nNo credit was deducted.',
        requiredCredits: 1,
        currentCreditBalance: 0,
      },
      currentCreditBalance: 0,
      notificationSent: false,
    })

    await processInboundMessage(buttonMessage('confirm_accept:lead-short-4'))

    // When NEXT_PUBLIC_APP_URL is set (as in .env), the handler sends via sendCtaUrl.
    // When it is unset, it falls back to sendText. Accept either path by checking the
    // message body appears in at least one of the two send calls.
    const allBodies = [
      ...mockSendText.mock.calls
        .filter(([phone]) => phone === PHONE)
        .map(([, body]) => body as string),
      ...mockSendCtaUrl.mock.calls
        .filter(([phone]) => phone === PHONE)
        .map(([, body]) => body as string),
    ]
    expect(allBodies.some((b) => b.includes('Not enough credits'))).toBe(true)
    expect(allBodies.some((b) => b.includes('No credit was deducted'))).toBe(true)
  })

  it('uses MVP1 pilot-complete fallback copy when accepted-lock confirmation send fails', async () => {
    mockDb.provider.findUnique.mockResolvedValue({ id: 'provider-1', name: 'Sipho Dlamini' })
    mockAcceptSelectedProviderJob.mockResolvedValue({
      ok: true,
      creditApplied: true,
      creditCheck: {
        ok: true,
        providerMessage: 'Accepted. Credit check passed.',
      },
      notificationSent: false,
    })

    await processInboundMessage(buttonMessage('confirm_accept:lead-short-5'))

    const sentBodies = mockSendText.mock.calls
      .filter(([phone]) => phone === PHONE)
      .map(([, body]) => body as string)
      .join('\n')
    expect(sentBodies).toContain('Job accepted')
    expect(sentBodies).toContain('The customer details are now available')
    expect(sentBodies).not.toContain('MVP1 flow is complete')
    expect(sentBodies).not.toContain('current pilot operating process')
    expect(sentBodies).not.toContain('my jobs')
    expect(sentBodies).not.toContain('manage your assignments')
  })

  it('uses status-aware recovery when status flow throws before rendering', async () => {
    mockDb.conversation.upsert.mockResolvedValue({
      phone: PHONE,
      flow: 'status',
      step: 'status_show',
      data: {},
      expiresAt: new Date(Date.now() + 120_000),
    })
    ;(handleStatusFlow as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('dependency timeout'))

    await processInboundMessage(buttonMessage('status'))

    expect(mockSendJourneyRecovery).toHaveBeenCalledWith(
      PHONE,
      expect.objectContaining({
        userRole: 'unknown',
        flowName: 'status',
        currentStep: 'status_show',
        failureType: 'unexpected_error',
        recoveryClass: 'show_status',
      }),
    )
    expect(mockSendJourneyRecovery).toHaveBeenCalledTimes(1)
  })
  it('uses provider-aware recovery when provider journey flow throws before rendering', async () => {
    vi.mocked(resolveWhatsAppUserContext).mockResolvedValueOnce({
      role: 'provider',
      normalizedPhone: '+27821234567',
      phoneVariants: ['+27821234567'],
      customerId: undefined,
      providerId: 'provider-1',
      applicationId: undefined,
      displayName: 'Sipho',
      firstName: 'Sipho',
      savedAddresses: [],
      providerStatus: 'ACTIVE',
      applicationStatus: undefined,
      activeJobCount: 0,
      isPaused: false,
      conflict: false,
      traceId: 'provider-trace',
    })
    mockDb.conversation.upsert.mockResolvedValue({
      phone: PHONE,
      flow: 'provider_journey',
      step: 'pj_menu',
      data: {},
      expiresAt: new Date(Date.now() + 120_000),
    })
    ;(handleProviderJourneyFlow as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('provider journey timeout'))

    await processInboundMessage(buttonMessage('provider_my_jobs'))

    expect(mockSendJourneyRecovery).toHaveBeenCalledWith(
      PHONE,
      expect.objectContaining({
        userRole: 'provider',
        flowName: 'provider_journey',
        currentStep: 'pj_job_list',
        failureType: 'unexpected_error',
        recoveryClass: 'retry_same_step',
      }),
    )
    expect(mockSendJourneyRecovery).toHaveBeenCalledTimes(1)
  })

  it('routes the WhatsApp identity fallback button into the provider journey identity flow', async () => {
    vi.mocked(resolveWhatsAppUserContext).mockResolvedValueOnce({
      role: 'provider',
      normalizedPhone: '+27821234567',
      phoneVariants: ['+27821234567'],
      customerId: undefined,
      providerId: 'provider-1',
      applicationId: undefined,
      displayName: 'Sipho',
      firstName: 'Sipho',
      savedAddresses: [],
      providerStatus: 'ACTIVE',
      applicationStatus: undefined,
      activeJobCount: 0,
      isPaused: false,
      conflict: false,
      traceId: 'provider-trace',
    })
    ;(handleProviderJourneyFlow as ReturnType<typeof vi.fn>).mockResolvedValue({ nextStep: 'pj_identity_consent' })
    mockDb.conversation.upsert.mockResolvedValueOnce({
      phone: PHONE,
      flow: 'idle',
      step: 'welcome',
      data: {},
      expiresAt: new Date(Date.now() + 120_000),
    })

    await processInboundMessage(buttonMessage('iv_start_whatsapp'))

    expect(handleProviderJourneyFlow).toHaveBeenCalledWith(expect.objectContaining({
      flow: 'provider_journey',
      step: 'pj_identity_start',
      data: {},
      phone: PHONE,
    }))
  })

  it('routes typed Verify for a returning multi-role verification user before the mixed main menu', async () => {
    vi.mocked(resolveWhatsAppUserContext).mockResolvedValueOnce({
      role: 'customer',
      normalizedPhone: '+27821234567',
      phoneVariants: ['+27821234567', '27821234567', '0821234567'],
      customerId: 'customer-1',
      providerId: 'provider-1',
      applicationId: undefined,
      displayName: 'Lovemore Sibanda',
      firstName: 'Lovemore',
      savedAddresses: [],
      providerStatus: 'ACTIVE',
      applicationStatus: undefined,
      activeJobCount: 0,
      isPaused: false,
      conflict: true,
      traceId: 'verify-trace',
    })
    mockDb.providerIdentityVerification.findFirst.mockResolvedValueOnce({
      id: 'ver-1',
      status: 'CONSENTED',
      channel: 'PWA',
      providerId: 'provider-1',
      providerApplicationId: null,
      updatedAt: new Date(),
    })
    ;(handleProviderJourneyFlow as ReturnType<typeof vi.fn>).mockResolvedValue({ nextStep: 'done' })
    mockDb.conversation.upsert.mockResolvedValueOnce({
      phone: PHONE,
      flow: 'idle',
      step: 'welcome',
      data: {},
      expiresAt: new Date(Date.now() + 120_000),
    })

    await processInboundMessage(textMessage('wamid.verify-returning', 'Verify'))

    expect(mockDb.providerIdentityVerification.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          OR: expect.arrayContaining([
            expect.objectContaining({ providerId: 'provider-1' }),
            expect.objectContaining({ provider: { is: { phone: { in: ['+27821234567', '27821234567', '0821234567'] } } } }),
          ]),
        }),
      }),
    )
    expect(handleProviderJourneyFlow).toHaveBeenCalledWith(expect.objectContaining({
      flow: 'provider_journey',
      step: 'pj_verify_identity',
      phone: PHONE,
    }))
    expect(showMainMenu).not.toHaveBeenCalled()
    expect(mockSendText).not.toHaveBeenCalledWith(
      PHONE,
      expect.stringContaining('Welcome back, Customer'),
    )
  })

  it('keeps an expired session from breaking a typed Verify identity journey', async () => {
    vi.mocked(resolveWhatsAppUserContext).mockResolvedValueOnce({
      role: 'provider',
      normalizedPhone: '+27821234567',
      phoneVariants: ['+27821234567', '27821234567', '0821234567'],
      customerId: undefined,
      providerId: 'provider-1',
      applicationId: undefined,
      displayName: 'Lovemore Sibanda',
      firstName: 'Lovemore',
      savedAddresses: [],
      providerStatus: 'ACTIVE',
      applicationStatus: undefined,
      activeJobCount: 0,
      isPaused: false,
      conflict: false,
      traceId: 'expired-verify-trace',
    })
    mockDb.providerIdentityVerification.findFirst.mockResolvedValueOnce({
      id: 'ver-expired-session-1',
      status: 'AWAITING_DOCUMENT',
      channel: 'WHATSAPP',
      providerId: 'provider-1',
      providerApplicationId: null,
      updatedAt: new Date(),
    })
    ;(handleProviderJourneyFlow as ReturnType<typeof vi.fn>).mockResolvedValue({ nextStep: 'done' })
    mockDb.conversation.upsert.mockResolvedValueOnce({
      phone: PHONE,
      flow: 'registration',
      step: 'reg_collect_evidence',
      data: { otpStatus: 'expired' },
      expiresAt: new Date(Date.now() - 60_000),
    })

    await processInboundMessage(textMessage('wamid.verify-expired-session', 'Verify'))

    expect(handleProviderJourneyFlow).toHaveBeenCalledWith(expect.objectContaining({
      flow: 'provider_journey',
      step: 'pj_verify_identity',
    }))
    expect(showMainMenu).not.toHaveBeenCalled()
  })

  it('does not show the mixed menu when an unknown WhatsApp sender types Verify', async () => {
    vi.mocked(resolveWhatsAppUserContext).mockResolvedValueOnce({
      role: 'unknown',
      normalizedPhone: '+27821234567',
      phoneVariants: ['+27821234567', '27821234567', '0821234567'],
      customerId: undefined,
      providerId: undefined,
      applicationId: undefined,
      displayName: undefined,
      firstName: undefined,
      savedAddresses: [],
      providerStatus: undefined,
      applicationStatus: undefined,
      activeJobCount: 0,
      isPaused: false,
      conflict: false,
      traceId: 'unknown-verify-trace',
    })
    mockDb.conversation.upsert.mockResolvedValueOnce({
      phone: PHONE,
      flow: 'idle',
      step: 'welcome',
      data: {},
      expiresAt: new Date(Date.now() + 120_000),
    })

    await processInboundMessage(textMessage('wamid.verify-unknown', 'Verify'))

    expect(handleProviderJourneyFlow).not.toHaveBeenCalled()
    expect(showMainMenu).not.toHaveBeenCalled()
    expect(mockSendText).toHaveBeenCalledWith(
      PHONE,
      expect.stringContaining("couldn't find an active identity verification"),
    )
  })

  it('keeps customer-only Verify users out of restricted provider identity tools', async () => {
    vi.mocked(resolveWhatsAppUserContext).mockResolvedValueOnce({
      role: 'customer',
      normalizedPhone: '+27821234567',
      phoneVariants: ['+27821234567', '27821234567', '0821234567'],
      customerId: 'customer-1',
      providerId: undefined,
      applicationId: undefined,
      displayName: 'Sheila',
      firstName: 'Sheila',
      savedAddresses: [],
      providerStatus: undefined,
      applicationStatus: undefined,
      activeJobCount: 0,
      isPaused: false,
      conflict: false,
      traceId: 'customer-verify-trace',
    })
    mockDb.conversation.upsert.mockResolvedValueOnce({
      phone: PHONE,
      flow: 'idle',
      step: 'welcome',
      data: {},
      expiresAt: new Date(Date.now() + 120_000),
    })

    await processInboundMessage(textMessage('wamid.verify-customer-only', 'Verify'))

    expect(handleProviderJourneyFlow).not.toHaveBeenCalled()
    expect(showMainMenu).not.toHaveBeenCalled()
    expect(mockSendText).toHaveBeenCalledWith(
      PHONE,
      expect.stringContaining("couldn't find an active identity verification"),
    )
  })

  it('handles malformed WhatsApp accept payloads without falling through to the generic bot error', async () => {
    await processInboundMessage(buttonMessage('accept:'))

    expect(mockAcceptLead).not.toHaveBeenCalled()
    expect(mockSendText).toHaveBeenCalledWith(
      PHONE,
      expect.stringContaining("couldn't read that lead response"),
    )
  })

  it('routes matching-mode buttons to status flow even when the previous session is idle/expired', async () => {
    ;(handleStatusFlow as ReturnType<typeof vi.fn>).mockResolvedValue({ nextStep: 'done' })
    mockDb.conversation.upsert.mockResolvedValueOnce({
      phone: PHONE,
      flow: 'idle',
      step: 'welcome',
      data: {},
      expiresAt: new Date(Date.now() + 120_000),
    })

    await processInboundMessage(buttonMessage('status_mode_quick_jr_123'))

    expect(handleStatusFlow).toHaveBeenCalledWith(
      expect.objectContaining({
        flow: 'status',
        step: 'status_show',
        reply: expect.objectContaining({ id: 'status_mode_quick_jr_123' }),
      }),
    )
    expect(showMainMenu).not.toHaveBeenCalled()
  })

  it('routes status refresh buttons to status flow when tapped directly', async () => {
    ;(handleStatusFlow as ReturnType<typeof vi.fn>).mockResolvedValue({ nextStep: 'done' })
    mockDb.conversation.upsert.mockResolvedValueOnce({
      phone: PHONE,
      flow: 'idle',
      step: 'welcome',
      data: {},
      expiresAt: new Date(Date.now() + 120_000),
    })

    await processInboundMessage(buttonMessage('status_refresh_jr_123'))

    expect(handleStatusFlow).toHaveBeenCalledWith(
      expect.objectContaining({
        flow: 'status',
        step: 'status_show',
        reply: expect.objectContaining({ id: 'status_refresh_jr_123' }),
      }),
    )
    expect(showMainMenu).not.toHaveBeenCalled()
  })

  it('bypasses the active-flow guard and routes matching-mode buttons to status flow even when a job_request flow is in progress', async () => {
    ;(handleStatusFlow as ReturnType<typeof vi.fn>).mockResolvedValue({ nextStep: 'done' })
    mockDb.conversation.upsert.mockResolvedValueOnce({
      phone: PHONE,
      flow: 'job_request',
      step: 'confirm_details',
      data: {},
      expiresAt: new Date(Date.now() + 120_000),
    })

    await processInboundMessage(buttonMessage('status_mode_review_jr_456'))

    expect(handleStatusFlow).toHaveBeenCalledWith(
      expect.objectContaining({
        flow: 'status',
        step: 'status_show',
        reply: expect.objectContaining({ id: 'status_mode_review_jr_456' }),
      }),
    )
    // Must not show "Continue / Cancel" prompt
    expect(showMainMenu).not.toHaveBeenCalled()
  })

  it('blocks generic Hi from resetting an active customer request flow to the main menu', async () => {
    mockDb.conversation.upsert.mockResolvedValue({
      phone: PHONE,
      flow: 'job_request',
      step: 'collect_address_street',
      data: { selectedCategory: 'Plumbing', category: 'Plumbing' },
      expiresAt: new Date(Date.now() + 120_000),
    })

    await processInboundMessage(textMessage('wamid.active-hi', 'Hi'))

    expect(showMainMenu).not.toHaveBeenCalled()
    expect(handleJobRequestFlow).not.toHaveBeenCalled()
    expect(mockSendButtons).toHaveBeenCalledWith(
      PHONE,
      expect.stringContaining('street address step'),
      expect.arrayContaining([
        expect.objectContaining({ id: 'flow_continue', title: 'Continue' }),
        expect.objectContaining({ id: 'start_cancel', title: 'Cancel request' }),
        expect.objectContaining({ id: 'session_restart', title: 'Main menu' }),
      ]),
    )
  })

  it('does not use duplicate button IDs when a non-job_request flow is active', async () => {
    // Use reschedule — one of the flows covered by the generic guard (registration has its own)
    mockDb.conversation.upsert.mockResolvedValue({
      phone: PHONE,
      flow: 'reschedule',
      step: 'select_booking',
      data: {},
      expiresAt: new Date(Date.now() + 120_000),
    })

    await processInboundMessage(textMessage('wamid.reschedule-hi', 'Hi'))

    expect(showMainMenu).not.toHaveBeenCalled()
    const resumeCall = mockSendButtons.mock.calls.find(([, , btns]) =>
      Array.isArray(btns) && btns.some((b: { id: string }) => b.id === 'flow_continue'),
    )
    expect(resumeCall).toBeDefined()
    const buttons = resumeCall![2] as Array<{ id: string }>
    const ids = buttons.map((b) => b.id)
    expect(new Set(ids).size).toBe(ids.length)
    expect(ids).toContain('flow_continue')
    expect(ids).toContain('cancel_flow')
    expect(ids).toContain('session_restart')
  })

  it('does not show the active-flow resume prompt when the session has expired', async () => {
    mockDb.conversation.upsert.mockResolvedValue({
      phone: PHONE,
      flow: 'job_request',
      step: 'collect_address_street',
      data: { selectedCategory: 'Plumbing' },
      expiresAt: new Date(Date.now() - 60_000),
    })

    await processInboundMessage(textMessage('wamid.expired-hi', 'Hi'))

    const resumeCall = mockSendButtons.mock.calls.find(([, copy]) =>
      typeof copy === 'string' && copy.includes('still completing'),
    )
    expect(resumeCall).toBeUndefined()
  })

  it('sends an expired-lead message when acceptAssignmentOffer returns EXPIRED', async () => {
    mockDb.provider.findUnique.mockResolvedValue({ id: 'provider-1', name: 'Sipho Dlamini' })
    mockDb.lead.findFirst.mockResolvedValue({ id: 'lead-1', jobRequestId: 'jr-1', providerId: 'provider-1' })
    mockAcceptAssignmentOffer.mockResolvedValue({ ok: false, reason: 'EXPIRED' })

    await processInboundMessage(buttonMessage('accept:hold-1'))

    expect(mockAcceptAssignmentOffer).toHaveBeenCalledWith({ leadId: 'lead-1', providerId: 'provider-1', source: 'whatsapp' })
    expect(mockSendText).toHaveBeenCalledWith(
      PHONE,
      expect.stringContaining('⏰ This lead has expired'),
    )
  })

  it('sends a taken message when acceptAssignmentOffer returns TAKEN', async () => {
    mockDb.provider.findUnique.mockResolvedValue({ id: 'provider-1', name: 'Sipho Dlamini' })
    mockDb.lead.findFirst.mockResolvedValue({ id: 'lead-1', jobRequestId: 'jr-1', providerId: 'provider-1' })
    mockAcceptAssignmentOffer.mockResolvedValue({ ok: false, reason: 'TAKEN' })

    await processInboundMessage(buttonMessage('accept:hold-1'))

    expect(mockAcceptAssignmentOffer).toHaveBeenCalledWith({ leadId: 'lead-1', providerId: 'provider-1', source: 'whatsapp' })
    expect(mockSendText).toHaveBeenCalledWith(
      PHONE,
      expect.stringContaining('⚡ This job was just assigned to another provider'),
    )
  })

  it('calls notifyPostMatchAcceptance on successful accept and suppresses error messages', async () => {
    mockDb.provider.findUnique.mockResolvedValue({ id: 'provider-1', name: 'Sipho Dlamini' })
    mockDb.lead.findFirst.mockResolvedValue({ id: 'lead-1', jobRequestId: 'jr-1', providerId: 'provider-1' })
    mockAcceptAssignmentOffer.mockResolvedValue({ ok: true, matchId: 'match-1', creditTransactionId: null, currentCreditBalance: 2 })
    mockNotifyPostMatchAcceptance.mockResolvedValue({ providerNotified: true, customerNotified: true })

    await processInboundMessage(buttonMessage('accept:hold-1'))

    expect(mockAcceptAssignmentOffer).toHaveBeenCalledWith({ leadId: 'lead-1', providerId: 'provider-1', source: 'whatsapp' })
    expect(mockNotifyPostMatchAcceptance).toHaveBeenCalledWith(expect.objectContaining({ leadId: 'lead-1', providerId: 'provider-1' }))
    expect(mockSendText).not.toHaveBeenCalledWith(PHONE, expect.stringContaining('Something went wrong'))
    expect(mockSendText).not.toHaveBeenCalledWith(PHONE, expect.stringContaining('expired'))
    expect(mockSendText).not.toHaveBeenCalledWith(PHONE, expect.stringContaining('insufficient'))
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

  it('processes post-match contact customer buttons even when the previous conversation session expired mid-flow', async () => {
    await processInboundMessage(buttonMessage('post_match_contact:lead-1'))

    expect(mockBuildAcceptedLeadContactUrlForProvider).toHaveBeenCalledWith({
      leadId: 'lead-1',
      providerPhone: PHONE,
    })
    expect(mockSendCtaUrl).toHaveBeenCalledWith(
      PHONE,
      expect.stringContaining('Open the customer WhatsApp chat'),
      'Open Chat',
      'https://wa.me/27820000001?text=hello',
      expect.any(Object),
      expect.objectContaining({
        templateName: 'post_match_provider_contact_customer',
        metadata: { leadId: 'lead-1' },
      }),
    )
    expect(mockSendButtons).not.toHaveBeenCalledWith(
      PHONE,
      expect.stringContaining('Your session timed out'),
      expect.any(Array),
    )
  })
})

describe('processInboundMessage customer photo batching', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()
  })

  it('processes WhatsApp multi-photo batches sequentially and suppresses duplicate confirmations until the last image', async () => {
    let storedConversation = {
      phone: PHONE,
      flow: 'job_request',
      step: 'collect_photos',
      data: {
        selectedCategory: 'Plumbing',
        address: '14 Main Rd, Sandton',
        availabilityNote: 'As soon as possible',
        photoAttachmentIds: [],
        photoMediaIds: [],
      },
      expiresAt: new Date(Date.now() + 60_000),
    }

    mockDb.conversation.findUnique.mockImplementation(async () => storedConversation)
    mockDb.conversation.upsert.mockImplementation(async (args: any) => {
      if (args.update && ('flow' in args.update || 'step' in args.update || 'data' in args.update)) {
        storedConversation = {
          ...storedConversation,
          flow: args.update.flow,
          step: args.update.step,
          data: args.update.data,
          expiresAt: args.update.expiresAt,
        }
      }
      return storedConversation
    })

    ;(handleJobRequestFlow as ReturnType<typeof vi.fn>).mockImplementation(async (ctx: any) => {
      const mediaId = ctx.reply.mediaId
      const photoAttachmentIds = [...(ctx.data.photoAttachmentIds ?? []), `att-${mediaId}`]
      const photoMediaIds = [...(ctx.data.photoMediaIds ?? []), mediaId]
      return {
        nextStep: 'collect_photos',
        nextData: { photoAttachmentIds, photoMediaIds },
      }
    })

    const first = processInboundMessage(imageMessage('media-1'))
    const second = processInboundMessage(imageMessage('media-2'))
    const third = processInboundMessage(imageMessage('media-3'))

    // Customer photo batching uses the shared 3000 ms media debounce window so
    // WhatsApp can deliver batch-selected images before the confirmation flushes.
    await vi.advanceTimersByTimeAsync(3001)
    await Promise.all([first, second, third])

    expect(handleJobRequestFlow).toHaveBeenCalledTimes(3)
    const calls = (handleJobRequestFlow as ReturnType<typeof vi.fn>).mock.calls
    expect(calls[0][0]).toMatchObject({ suppressCustomerPhotoProgress: true, customerPhotoBatchSize: 3 })
    expect(calls[1][0]).toMatchObject({ suppressCustomerPhotoProgress: true, customerPhotoBatchSize: 3 })
    expect(calls[2][0]).toMatchObject({ suppressCustomerPhotoProgress: false, customerPhotoBatchSize: 3 })
    expect(storedConversation.data.photoAttachmentIds).toEqual(['att-media-1', 'att-media-2', 'att-media-3'])
    expect(storedConversation.data.photoMediaIds).toEqual(['media-1', 'media-2', 'media-3'])
  })

  it('keeps customer photos in one batch when the second webhook arrives after the old 800 ms window', async () => {
    let storedConversation = {
      phone: PHONE,
      flow: 'job_request',
      step: 'collect_photos',
      data: {
        selectedCategory: 'Plumbing',
        address: '14 Main Rd, Sandton',
        availabilityNote: 'As soon as possible',
        photoAttachmentIds: [],
        photoMediaIds: [],
      },
      expiresAt: new Date(Date.now() + 60_000),
    }

    mockDb.conversation.findUnique.mockImplementation(async () => storedConversation)
    mockDb.conversation.upsert.mockImplementation(async (args: any) => {
      if (args.update && ('flow' in args.update || 'step' in args.update || 'data' in args.update)) {
        storedConversation = {
          ...storedConversation,
          flow: args.update.flow,
          step: args.update.step,
          data: args.update.data,
          expiresAt: args.update.expiresAt,
        }
      }
      return storedConversation
    })

    ;(handleJobRequestFlow as ReturnType<typeof vi.fn>).mockImplementation(async (ctx: any) => {
      const mediaId = ctx.reply.mediaId
      const photoAttachmentIds = [...(ctx.data.photoAttachmentIds ?? []), `att-${mediaId}`]
      const photoMediaIds = [...(ctx.data.photoMediaIds ?? []), mediaId]
      return {
        nextStep: 'collect_photos',
        nextData: { photoAttachmentIds, photoMediaIds },
      }
    })

    const first = processInboundMessage(imageMessage('media-late-1'))
    await vi.advanceTimersByTimeAsync(1200)
    expect(handleJobRequestFlow).not.toHaveBeenCalled()

    const second = processInboundMessage(imageMessage('media-late-2'))
    await vi.advanceTimersByTimeAsync(2999)
    expect(handleJobRequestFlow).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(2)
    await Promise.all([first, second])

    expect(handleJobRequestFlow).toHaveBeenCalledTimes(2)
    const calls = (handleJobRequestFlow as ReturnType<typeof vi.fn>).mock.calls
    expect(calls[0][0]).toMatchObject({ suppressCustomerPhotoProgress: true, customerPhotoBatchSize: 2 })
    expect(calls[1][0]).toMatchObject({ suppressCustomerPhotoProgress: false, customerPhotoBatchSize: 2 })
    expect(storedConversation.data.photoAttachmentIds).toEqual(['att-media-late-1', 'att-media-late-2'])
  })
})

describe('processInboundMessage provider evidence batching', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()
  })

  function evidenceImageMessage(mediaId: string) {
    return {
      from: PHONE,
      id: `wamid.${mediaId}`,
      type: 'image',
      image: { id: mediaId, mime_type: 'image/jpeg' },
      timestamp: String(Date.now()),
    }
  }

  it('processes WhatsApp multi-file evidence batches sequentially and suppresses duplicate confirmations until the last file', async () => {
    let storedConversation = {
      phone: PHONE,
      flow: 'registration',
      step: 'reg_collect_evidence',
      data: {
        name: 'Sipho Dlamini',
        skills: ['plumbing'],
        evidenceFileUrls: [],
        evidenceMediaIds: [],
      },
      expiresAt: new Date(Date.now() + 60_000),
    }

    mockDb.conversation.findUnique.mockImplementation(async () => storedConversation)
    mockDb.conversation.upsert.mockImplementation(async (args: any) => {
      if (args.update && ('flow' in args.update || 'step' in args.update || 'data' in args.update)) {
        storedConversation = {
          ...storedConversation,
          flow: args.update.flow,
          step: args.update.step,
          data: args.update.data,
          expiresAt: args.update.expiresAt,
        }
      }
      return storedConversation
    })

    ;(handleRegistrationFlow as ReturnType<typeof vi.fn>).mockImplementation(async (ctx: any) => {
      const mediaId = ctx.reply.mediaId
      const evidenceFileUrls = [...(ctx.data.evidenceFileUrls ?? []), `att-${mediaId}`]
      const evidenceMediaIds = [...(ctx.data.evidenceMediaIds ?? []), mediaId]
      return {
        nextStep: 'reg_collect_evidence',
        nextData: { evidenceFileUrls, evidenceMediaIds },
      }
    })

    const first = processInboundMessage(evidenceImageMessage('ev-1'))
    const second = processInboundMessage(evidenceImageMessage('ev-2'))
    const third = processInboundMessage(evidenceImageMessage('ev-3'))

    // PROVIDER_EVIDENCE_BATCH_WINDOW_MS is 3000 ms (increased from 800 ms to
    // allow WhatsApp time to deliver all batch-selected images before flushing)
    await vi.advanceTimersByTimeAsync(3001)
    await Promise.all([first, second, third])

    expect(handleRegistrationFlow).toHaveBeenCalledTimes(3)
    const calls = (handleRegistrationFlow as ReturnType<typeof vi.fn>).mock.calls
    expect(calls[0][0]).toMatchObject({ suppressEvidenceFileProgress: true, evidenceFileBatchSize: 3 })
    expect(calls[1][0]).toMatchObject({ suppressEvidenceFileProgress: true, evidenceFileBatchSize: 3 })
    expect(calls[2][0]).toMatchObject({ suppressEvidenceFileProgress: false, evidenceFileBatchSize: 3 })
    expect(storedConversation.data.evidenceFileUrls).toEqual(['att-ev-1', 'att-ev-2', 'att-ev-3'])
    expect(storedConversation.data.evidenceMediaIds).toEqual(['ev-1', 'ev-2', 'ev-3'])
  })

  it('does not batch provider evidence when conversation is not on reg_collect_evidence step', async () => {
    mockDb.conversation.findUnique.mockResolvedValue({
      phone: PHONE,
      flow: 'registration',
      step: 'reg_collect_name',
      data: {},
      expiresAt: new Date(Date.now() + 60_000),
    })
    mockDb.conversation.upsert.mockResolvedValue({
      phone: PHONE,
      flow: 'registration',
      step: 'reg_collect_name',
      data: {},
      expiresAt: new Date(Date.now() + 60_000),
    })

    ;(handleRegistrationFlow as ReturnType<typeof vi.fn>).mockResolvedValue({
      nextStep: 'reg_collect_name',
    })

    await processInboundMessage(evidenceImageMessage('ev-off-step'))
    await vi.advanceTimersByTimeAsync(801)

    // Image sent on a non-media step is dropped by the whatsapp-bot media gate before the flow handler runs
    expect(handleRegistrationFlow).not.toHaveBeenCalled()
  })
})

describe('processInboundMessage customer city selection routing', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()
  })

  function setConversation(step: string) {
    let storedConversation = {
      phone: PHONE,
      flow: 'job_request',
      step,
      data: {
        selectedCategory: 'Plumbing',
        addrProvinceKey: 'gauteng',
        addrProvinceLabel: 'Gauteng',
        addrPage: 0,
      },
      expiresAt: new Date(Date.now() + 60_000),
    }

    mockDb.conversation.findUnique.mockImplementation(async () => storedConversation)
    mockDb.conversation.upsert.mockImplementation(async (args: any) => {
      if (args.update && ('flow' in args.update || 'step' in args.update || 'data' in args.update)) {
        storedConversation = {
          ...storedConversation,
          flow: args.update.flow,
          step: args.update.step,
          data: args.update.data,
          expiresAt: args.update.expiresAt,
        }
      }
      return storedConversation
    })
    return () => storedConversation
  }

  it('drops stale typed city text when the interactive city selection arrives immediately after it', async () => {
    setConversation('addr_select_city')
    ;(handleJobRequestFlow as ReturnType<typeof vi.fn>).mockResolvedValue({
      nextStep: 'addr_select_region',
      nextData: { addrCityId: 'city_jhb', addrCityLabel: 'Johannesburg' },
    })

    const typed = processInboundMessage(textMessage('wamid.text-city', 'Johannesburg'))
    const selected = processInboundMessage(listReplyMessage('city__city_jhb', 'Johannesburg'))

    await vi.advanceTimersByTimeAsync(801)
    await Promise.all([typed, selected])

    expect(handleJobRequestFlow).toHaveBeenCalledTimes(1)
    expect(handleJobRequestFlow).toHaveBeenCalledWith(expect.objectContaining({
      step: 'addr_select_city',
      reply: expect.objectContaining({ type: 'list_reply', id: 'city__city_jhb' }),
    }))
  })

  it('still routes typed city text to the city validation handler when no list selection follows', async () => {
    setConversation('addr_select_city')
    ;(handleJobRequestFlow as ReturnType<typeof vi.fn>).mockResolvedValue({
      nextStep: 'addr_select_city',
      nextData: { addrPage: 0 },
    })

    const typed = processInboundMessage(textMessage('wamid.text-city-only', 'Johannesburg'))

    await vi.advanceTimersByTimeAsync(801)
    await typed

    expect(handleJobRequestFlow).toHaveBeenCalledTimes(1)
    expect(handleJobRequestFlow).toHaveBeenCalledWith(expect.objectContaining({
      step: 'addr_select_city',
      reply: expect.objectContaining({ type: 'text', text: 'Johannesburg' }),
    }))
  })

  it('ignores stale city list replies after the conversation has moved to area selection', async () => {
    setConversation('addr_select_region')

    await processInboundMessage(listReplyMessage('city__city_jhb', 'Johannesburg'))

    expect(handleJobRequestFlow).not.toHaveBeenCalled()
  })
})

// ─── handleRfpLeadInterest (ops_accept button) ──────────────────────────────

describe('handleRfpLeadInterest (ops_accept button)', () => {
  function makeRfpLead(overrides: Record<string, unknown> = {}) {
    return {
      id: 'rfp-lead-1',
      status: 'SENT',
      providerId: 'provider-1',
      jobRequestId: 'jr-1',
      expiresAt: null,
      jobRequest: { id: 'jr-1', category: 'Plumbing', status: 'SHORTLIST_READY' },
      ...overrides,
    }
  }

  beforeEach(() => {
    vi.clearAllMocks()
    vi.useRealTimers()
    mockSendText.mockResolvedValue('msg-text')
    mockSendButtons.mockResolvedValue('msg-buttons')
    mockSendCtaUrl.mockResolvedValue('msg-cta')
    mockSendJourneyRecovery.mockResolvedValue(undefined)
    mockDb.providerApplication.findFirst.mockResolvedValue(null)
    mockDb.providerApplication.findUnique.mockResolvedValue(null)
    mockDb.providerApplication.update.mockResolvedValue({})
    expiredMidFlowConversation()
    mockDb.provider.findUnique.mockResolvedValue({ id: 'provider-1', name: 'Sipho Dlamini' })
    mockDb.provider.findFirst.mockResolvedValue(null)
    mockDb.messageEvent.findFirst.mockResolvedValue(null)
    mockDb.lead.findUnique.mockResolvedValue(makeRfpLead())
    mockDb.lead.updateMany.mockResolvedValue({ count: 1 })
    ;(mockDb as any).auditLog = { create: vi.fn().mockResolvedValue({}) }
    ;(mockDb as any).providerRate = { findFirst: vi.fn().mockResolvedValue(null) }
    ;(mockDb as any).providerLeadResponse = { create: vi.fn().mockResolvedValue({}) }
    ;(mockDb as any).$transaction = vi.fn().mockImplementation(
      async (fn: (tx: typeof mockDb) => Promise<unknown>) => fn(mockDb as any),
    )
  })

  it('registers interest from interactive button payload with lead+provider IDs', async () => {
    await processInboundMessage(buttonMessage('ops_accept:rfp-lead-1:provider-1'))

    expect(mockDb.lead.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: 'rfp-lead-1' }),
        data: expect.objectContaining({ status: 'INTERESTED' }),
      }),
    )
    expect(mockSendText).toHaveBeenCalledWith(
      PHONE,
      expect.stringContaining('Availability noted'),
    )
  })

  it('registers interest from button payload format used by older providers', async () => {
    await processInboundMessage(buttonPayloadMessage('ops_accept:rfp-lead-1:provider-1'))

    expect(mockDb.lead.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: 'rfp-lead-1' }),
        data: expect.objectContaining({ status: 'INTERESTED' }),
      }),
    )
    expect(mockSendText).toHaveBeenCalledWith(
      PHONE,
      expect.stringContaining('Availability noted'),
    )
  })

  it('registers interest from plain-text fallback using context message mapping', async () => {
    mockDb.messageEvent.findFirst.mockResolvedValueOnce({
      id: 'evt-ctx-1',
      metadata: {
        requestId: 'jr-1',
        leadId: 'rfp-lead-1',
        providerId: 'provider-1',
      },
    })

    await processInboundMessage(textMessageWithContext('wamid.text-ctx', 'I\'m Available', 'wamid.outbound-ctx'))

    expect(mockDb.lead.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: 'rfp-lead-1' }),
        data: expect.objectContaining({ status: 'INTERESTED' }),
      }),
    )
    expect(mockSendText).toHaveBeenCalledWith(
      PHONE,
      expect.stringContaining('Availability noted'),
    )
  })

  it('registers interest from interactive "ops_accept" without IDs via context mapping', async () => {
    mockDb.messageEvent.findFirst.mockResolvedValueOnce({
      id: 'evt-ctx-ops-accept',
      metadata: {
        requestId: 'jr-1',
        leadId: 'rfp-lead-1',
        providerId: 'provider-1',
      },
    })

    await processInboundMessage({
      from: PHONE,
      id: 'wamid.interactive-ops-accept-context',
      type: 'interactive',
      interactive: {
        type: 'button_reply',
        button_reply: { id: 'ops_accept', title: "I'm Available" },
      },
      context: { id: 'wamid.outbound-ctx-ops-accept', from: PHONE },
      timestamp: String(Date.now()),
    })

    expect(mockDb.lead.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: 'rfp-lead-1' }),
        data: expect.objectContaining({ status: 'INTERESTED' }),
      }),
    )
    expect(mockSendText).toHaveBeenCalledWith(
      PHONE,
      expect.stringContaining('Availability noted'),
    )
  })

  it('uses safe fallback only when exactly one active lead is available without context ID', async () => {
    mockDb.messageEvent.findFirst.mockResolvedValue(null)
    mockDb.lead.findMany.mockResolvedValueOnce([{ id: 'rfp-lead-1', jobRequestId: 'jr-1' }])

    await processInboundMessage(textMessage('wamid.text-fallback', 'I\'m Available'))

    expect(mockDb.lead.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: 'rfp-lead-1' }),
        data: expect.objectContaining({ status: 'INTERESTED' }),
      }),
    )
    expect(mockSendText).toHaveBeenCalledWith(
      PHONE,
      expect.stringContaining('Availability noted'),
    )
  })

  it('reports resolution failure when context cannot be resolved and no unique fallback lead exists', async () => {
    mockDb.messageEvent.findFirst.mockResolvedValue(null)
    mockDb.lead.findMany.mockResolvedValueOnce([])

    await processInboundMessage(textMessage('wamid.text-missing-context', 'I\'m Available'))

    expect(mockDb.lead.updateMany).not.toHaveBeenCalled()
    expect(mockSendText).toHaveBeenCalledWith(
      PHONE,
      expect.stringContaining('We couldn\'t find an open lead for that response'),
    )
  })

  it('reports resolution failure when missing context has multiple active lead candidates', async () => {
    mockDb.messageEvent.findFirst.mockResolvedValue(null)
    mockDb.lead.findMany.mockResolvedValueOnce([
      { id: 'rfp-lead-1', jobRequestId: 'jr-1' },
      { id: 'rfp-lead-2', jobRequestId: 'jr-2' },
    ])

    await processInboundMessage(textMessage('wamid.text-missing-context-multiple', 'I\'m Available'))

    expect(mockDb.lead.updateMany).not.toHaveBeenCalled()
    expect(mockSendText).toHaveBeenCalledWith(
      PHONE,
      expect.stringContaining('multiple open leads'),
    )
  })

  it('does not match unknown provider phone numbers for availability responses', async () => {
    mockDb.provider.findUnique.mockResolvedValueOnce(null)
    mockDb.provider.findFirst.mockResolvedValueOnce(null)

    await processInboundMessage(buttonMessage('ops_accept:rfp-lead-1:provider-1'))

    expect(mockSendText).toHaveBeenCalledWith(
      PHONE,
      expect.stringContaining("couldn't find your provider profile"),
    )
  })

  it('does not perform wallet credit checks for availability taps (zero-credit providers are still eligible)', async () => {
    await processInboundMessage(buttonMessage('ops_accept:rfp-lead-1:provider-1'))

    expect(mockDb.providerWallet.findUnique).not.toHaveBeenCalled()
    expect(mockDb.providerWallet.updateMany).not.toHaveBeenCalled()
    expect(mockSendText).toHaveBeenCalledWith(
      PHONE,
      expect.stringContaining('Availability noted'),
    )
  })

  it('works for legacy south-african phone formats when provider phone is normalised', async () => {
    const localPhone = '0821234567'
    mockDb.provider.findUnique.mockResolvedValueOnce(null)
    mockDb.provider.findFirst.mockResolvedValueOnce({ id: 'provider-1', name: 'Sipho Dlamini' })

    await processInboundMessage({
      from: localPhone,
      id: 'wamid.sa-phone-format',
      type: 'button',
      button: { payload: 'ops_accept:rfp-lead-1:provider-1', text: 'I\'m Available' },
      timestamp: String(Date.now()),
    })

    expect(mockDb.provider.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          phone: {
            in: expect.arrayContaining(['+27821234567']),
          },
        },
      }),
    )
    expect(mockSendText).toHaveBeenCalledWith(
      PHONE,
      expect.stringContaining('Availability noted'),
    )
  })

  it('records "Not Available" without charging credits', async () => {
    await processInboundMessage(buttonMessage('ops_decline:rfp-lead-1:provider-1'))

    expect(mockDb.lead.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: 'rfp-lead-1',
          providerId: 'provider-1',
        }),
      }),
    )
    expect((mockDb as any).providerLeadResponse.create).not.toHaveBeenCalled()
    expect(mockSendText).toHaveBeenCalledWith(
      PHONE,
      expect.stringContaining('Understood — noted as unavailable'),
    )
  })

    it('sends "already noted" idempotent response when updateMany returns count=0', async () => {
      mockDb.lead.updateMany.mockResolvedValue({ count: 0 })

      await processInboundMessage(buttonMessage('ops_accept:rfp-lead-1'))

      const texts = mockSendText.mock.calls.map(([, body]) => body as string).join('\n')
      expect(texts).toMatch(/already noted/i)
    })

    it('retries once on P2034 write conflict and sends success on second attempt', async () => {
      let callCount = 0
      ;(mockDb as any).$transaction = vi.fn().mockImplementation(
        async (fn: (tx: typeof mockDb) => Promise<unknown>) => {
          callCount++
          if (callCount === 1) {
            throw Object.assign(new Error('write conflict'), { code: 'P2034' })
          }
          return fn(mockDb as any)
        },
      )

      await processInboundMessage(buttonMessage('ops_accept:rfp-lead-1'))

      expect((mockDb as any).$transaction).toHaveBeenCalledTimes(2)
      expect(mockSendText).toHaveBeenCalledWith(PHONE, expect.stringContaining('Availability noted'))
    })

    it('re-sends only the "I\'m Available" retry button (not "Not Available") when P2034 persists', async () => {
      ;(mockDb as any).$transaction = vi.fn().mockRejectedValue(
        Object.assign(new Error('write conflict'), { code: 'P2034' }),
      )

      await processInboundMessage(buttonMessage('ops_accept:rfp-lead-1'))

      expect(mockSendButtons).toHaveBeenCalledWith(
        PHONE,
        expect.stringContaining("couldn't register your availability"),
        expect.arrayContaining([
          expect.objectContaining({ id: expect.stringContaining('ops_accept:rfp-lead-1:'), title: "I'm Available" }),
        ]),
      )
      const [, , buttons] = mockSendButtons.mock.calls.find(([p]) => p === PHONE) ?? []
      const declineButton = (buttons as Array<{ id: string }> | undefined)?.find((b) =>
        b.id.startsWith('ops_decline:'),
      )
      expect(declineButton).toBeUndefined()
    })

    it('retries once on P2024 connection pool timeout and sends success on second attempt', async () => {
      let callCount = 0
      ;(mockDb as any).$transaction = vi.fn().mockImplementation(
        async (fn: (tx: typeof mockDb) => Promise<unknown>) => {
          callCount++
          if (callCount === 1) {
            throw Object.assign(new Error('connection pool timeout'), { code: 'P2024' })
          }
          return fn(mockDb as any)
        },
      )

      await processInboundMessage(buttonMessage('ops_accept:rfp-lead-1'))

      expect((mockDb as any).$transaction).toHaveBeenCalledTimes(2)
      expect(mockSendText).toHaveBeenCalledWith(PHONE, expect.stringContaining('Availability noted'))
    })

    it('re-sends only the "I\'m Available" retry button (not "Not Available") when P2024 persists', async () => {
      ;(mockDb as any).$transaction = vi.fn().mockRejectedValue(
        Object.assign(new Error('connection pool timeout'), { code: 'P2024' }),
      )

      await processInboundMessage(buttonMessage('ops_accept:rfp-lead-1'))

      expect(mockSendButtons).toHaveBeenCalledWith(
        PHONE,
        expect.stringContaining("couldn't register your availability"),
        expect.arrayContaining([
          expect.objectContaining({ id: expect.stringContaining('ops_accept:rfp-lead-1:'), title: "I'm Available" }),
        ]),
      )
      const [, , buttons] = mockSendButtons.mock.calls.find(([p]) => p === PHONE) ?? []
      const declineButton = (buttons as Array<{ id: string }> | undefined)?.find((b) =>
        b.id.startsWith('ops_decline:'),
      )
      expect(declineButton).toBeUndefined()
    })

    it('treats P2002 unique constraint as concurrent dedup and sends "already noted"', async () => {
      ;(mockDb as any).$transaction = vi.fn().mockRejectedValue(
        Object.assign(new Error('unique constraint'), { code: 'P2002' }),
      )

      await processInboundMessage(buttonMessage('ops_accept:rfp-lead-1'))

      const texts = mockSendText.mock.calls.map(([, body]) => body as string).join('\n')
      expect(texts).toMatch(/already noted/i)
    })

    it('sends graceful response and does not update DB when lead status is unexpected', async () => {
      // MATCHED is not in the known-status list — triggers the unexpected_lead_status warn guard
      mockDb.lead.findUnique.mockResolvedValue(
        makeRfpLead({ status: 'MATCHED', jobRequest: { id: 'jr-1', category: 'Plumbing', status: 'SHORTLIST_READY' } }),
      )

      await processInboundMessage(buttonMessage('ops_accept:rfp-lead-1'))

      expect(mockDb.lead.updateMany).not.toHaveBeenCalled()
      expect(mockSendText).toHaveBeenCalledWith(PHONE, expect.stringContaining("couldn't process"))
    })

    it('sends expired message and does not update DB when lead.expiresAt is in the past', async () => {
      mockDb.lead.findUnique.mockResolvedValue(
        makeRfpLead({ expiresAt: new Date(Date.now() - 60_000) }),
      )

      await processInboundMessage(buttonMessage('ops_accept:rfp-lead-1'))

      expect(mockDb.lead.updateMany).not.toHaveBeenCalled()
      expect(mockSendText).toHaveBeenCalledWith(PHONE, expect.stringContaining('expired'))
    })

    it('reports unavailable if job request is no longer in the shortlist review window', async () => {
      mockDb.lead.findUnique.mockResolvedValue(
        makeRfpLead({ jobRequest: { id: 'jr-1', category: 'Plumbing', status: 'MATCHED' } }),
      )

      await processInboundMessage(buttonMessage('ops_accept:rfp-lead-1:provider-1'))

      expect(mockDb.lead.updateMany).not.toHaveBeenCalled()
      expect(mockSendText).toHaveBeenCalledWith(
        PHONE,
        expect.stringContaining('customer has moved forward with another provider'),
      )
    })
  })

// ─── handleSelectedProviderConfirmation — new failure branches ───────────────

describe('handleSelectedProviderConfirmation — new failure branches', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useRealTimers()
    mockSendText.mockResolvedValue('msg-text')
    mockSendButtons.mockResolvedValue('msg-buttons')
    mockSendCtaUrl.mockResolvedValue('msg-cta')
    mockSendJourneyRecovery.mockResolvedValue(undefined)
    mockDb.lead.findFirst.mockResolvedValue(null)
    mockDb.providerApplication.findFirst.mockResolvedValue(null)
    mockDb.providerApplication.findUnique.mockResolvedValue(null)
    mockDb.providerApplication.update.mockResolvedValue({})
    expiredMidFlowConversation()
  })

  it('sends support contact message when CREDIT_APPLICATION_FAILED on confirm_accept', async () => {
    mockDb.provider.findUnique.mockResolvedValue({ id: 'provider-1', name: 'Sipho Dlamini' })
    mockAcceptSelectedProviderJob.mockResolvedValue({
      ok: false,
      reason: 'CREDIT_APPLICATION_FAILED',
    })

    await processInboundMessage(buttonMessage('confirm_accept:lead-caf-1'))

    const texts = mockSendText.mock.calls
      .filter(([p]) => p === PHONE)
      .map(([, body]) => body as string)
      .join('\n')
    expect(texts).toMatch(/couldn't complete the job assignment/i)
    expect(texts).toMatch(/contact support/i)
    expect(texts).toMatch(/Ref:/i)
  })

  it('sends credit-deducted warning with support contact when JOB_ASSIGNMENT_FAILED on confirm_accept', async () => {
    mockDb.provider.findUnique.mockResolvedValue({ id: 'provider-1', name: 'Sipho Dlamini' })
    mockAcceptSelectedProviderJob.mockResolvedValue({
      ok: false,
      reason: 'JOB_ASSIGNMENT_FAILED',
    })

    await processInboundMessage(buttonMessage('confirm_accept:lead-jaf-1'))

    const texts = mockSendText.mock.calls
      .filter(([p]) => p === PHONE)
      .map(([, body]) => body as string)
      .join('\n')
    expect(texts).toMatch(/credit was applied/i)
    expect(texts).toMatch(/contact support/i)
  })

  it('sends job-not-found message when NOT_FOUND on confirm_decline', async () => {
    mockDb.provider.findUnique.mockResolvedValue({ id: 'provider-1', name: 'Sipho Dlamini' })
    mockDeclineSelectedProviderJob.mockResolvedValue({
      ok: false,
      reason: 'NOT_FOUND',
    })

    await processInboundMessage(buttonMessage('confirm_decline:lead-nf-1'))

    expect(mockSendText).toHaveBeenCalledWith(PHONE, expect.stringContaining('could not be found'))
  })
})
