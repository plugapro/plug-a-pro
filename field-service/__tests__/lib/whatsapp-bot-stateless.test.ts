import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockDb,
  mockAcceptLead,
  mockProcessQuoteDecision,
  mockOrchestrateMatch,
  mockSendText,
  mockSendButtons,
  mockSendCtaUrl,
  mockBuildAcceptedLeadContactUrlForProvider,
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
  },
  mockAcceptLead: vi.fn(),
  mockProcessQuoteDecision: vi.fn(),
  mockOrchestrateMatch: vi.fn(),
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
vi.mock('@/lib/quotes', () => ({ processQuoteDecision: mockProcessQuoteDecision }))
vi.mock('@/lib/matching/orchestrator', () => ({ orchestrateMatch: mockOrchestrateMatch }))
vi.mock('@/lib/whatsapp', () => ({ sendProviderAssigned: vi.fn() }))
vi.mock('@/lib/post-match-communications', () => ({
  buildAcceptedLeadContactUrlForProvider: mockBuildAcceptedLeadContactUrlForProvider,
}))
vi.mock('@/lib/whatsapp-identity', () => ({
  resolveWhatsAppIdentity: vi.fn().mockResolvedValue({
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
import { handleJobRequestFlow } from '@/lib/whatsapp-flows/job-request'
import { handleRegistrationFlow } from '@/lib/whatsapp-flows/registration'

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
    mockBuildAcceptedLeadContactUrlForProvider.mockResolvedValue('https://wa.me/27820000001?text=hello')
    expiredMidFlowConversation()
  })

  it('processes assignment accept buttons even when the previous conversation session expired mid-flow', async () => {
    mockDb.provider.findUnique.mockResolvedValue({ id: 'provider-1', name: 'Sipho Dlamini' })
    mockDb.lead.findFirst.mockResolvedValue({ id: 'lead-1', jobRequestId: 'jr-1' })
    mockAcceptLead.mockResolvedValue({ ok: true, matchId: 'match-1' })
    mockDb.jobRequest.findUnique.mockResolvedValue(null)

    await processInboundMessage(buttonMessage('accept:hold-1'))

    expect(mockAcceptLead).toHaveBeenCalledWith({ leadId: 'lead-1', providerId: 'provider-1', source: 'whatsapp' })
    expect(mockSendButtons).not.toHaveBeenCalledWith(
      PHONE,
      expect.stringContaining('Your session timed out'),
      expect.any(Array),
    )
  })

  it('blocks WhatsApp assignment accept when the provider has zero credits', async () => {
    mockDb.provider.findUnique.mockResolvedValue({ id: 'provider-1', name: 'Sipho Dlamini' })
    mockDb.lead.findFirst.mockResolvedValue({ id: 'lead-1', jobRequestId: 'jr-1' })
    mockAcceptLead.mockResolvedValue({
      ok: false,
      reason: 'INSUFFICIENT_CREDITS',
      currentCreditBalance: 0,
    })

    await processInboundMessage(buttonMessage('accept:hold-1'))

    expect(mockAcceptLead).toHaveBeenCalledWith({
      leadId: 'lead-1',
      providerId: 'provider-1',
      source: 'whatsapp',
    })
    expect(mockSendButtons).toHaveBeenCalledWith(
      PHONE,
      expect.stringContaining('You need 1 credit to accept this lead'),
      expect.arrayContaining([
        expect.objectContaining({ id: 'provider_top_up_credits', title: 'Top Up Credits' }),
        expect.objectContaining({ id: 'match_inspect_lead-1', title: 'View Lead' }),
        expect.objectContaining({ id: 'back_home', title: 'Main Menu' }),
      ]),
    )
  })

  it('returns a traceable technical message when WhatsApp assignment accept throws unexpectedly', async () => {
    mockDb.provider.findUnique.mockResolvedValue({ id: 'provider-1', name: 'Sipho Dlamini' })
    mockDb.lead.findFirst.mockResolvedValue({ id: 'lead-1', jobRequestId: 'jr-1' })
    mockAcceptLead.mockRejectedValue(new Error('database timeout'))

    await processInboundMessage(buttonMessage('accept:hold-1'))

    expect(mockSendText).toHaveBeenCalledWith(
      PHONE,
      expect.stringContaining("Something went wrong processing your acceptance"),
    )
    expect(mockSendText).toHaveBeenCalledWith(
      PHONE,
      expect.stringContaining('_Ref:'),
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

  it('sends an expired-lead message when acceptLead returns EXPIRED', async () => {
    mockDb.provider.findUnique.mockResolvedValue({ id: 'provider-1', name: 'Sipho Dlamini' })
    mockDb.lead.findFirst.mockResolvedValue({ id: 'lead-1', jobRequestId: 'jr-1' })
    mockAcceptLead.mockResolvedValue({ ok: false, reason: 'EXPIRED' })

    await processInboundMessage(buttonMessage('accept:hold-1'))

    expect(mockAcceptLead).toHaveBeenCalledWith({ leadId: 'lead-1', providerId: 'provider-1', source: 'whatsapp' })
    expect(mockSendText).toHaveBeenCalledWith(
      PHONE,
      expect.stringContaining('⏰ This lead has expired'),
    )
  })

  it('sends a taken message when acceptLead returns TAKEN', async () => {
    mockDb.provider.findUnique.mockResolvedValue({ id: 'provider-1', name: 'Sipho Dlamini' })
    mockDb.lead.findFirst.mockResolvedValue({ id: 'lead-1', jobRequestId: 'jr-1' })
    mockAcceptLead.mockResolvedValue({ ok: false, reason: 'TAKEN' })

    await processInboundMessage(buttonMessage('accept:hold-1'))

    expect(mockAcceptLead).toHaveBeenCalledWith({ leadId: 'lead-1', providerId: 'provider-1', source: 'whatsapp' })
    expect(mockSendText).toHaveBeenCalledWith(
      PHONE,
      expect.stringContaining('⚡ This job was just assigned to another provider'),
    )
  })

  it('does not send an error message on successful accept — delegates success notification to acceptLead', async () => {
    mockDb.provider.findUnique.mockResolvedValue({ id: 'provider-1', name: 'Sipho Dlamini' })
    mockDb.lead.findFirst.mockResolvedValue({ id: 'lead-1', jobRequestId: 'jr-1' })
    mockAcceptLead.mockResolvedValue({ ok: true, matchId: 'match-1' })

    await processInboundMessage(buttonMessage('accept:hold-1'))

    expect(mockAcceptLead).toHaveBeenCalledWith({ leadId: 'lead-1', providerId: 'provider-1', source: 'whatsapp' })
    // Bot delegates success messaging (credit confirmation, job link) to acceptLead — no extra bot message
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
