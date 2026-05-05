// Regression tests for the provider-onboarding silent-failure incident:
//   - profile photo uploads were dropped at the dispatcher level because
//     `reg_collect_profile_photo` was missing from the media allow-list.
//   - "Hi"/"menu" mid-onboarding silently wiped registration state and
//     dumped the user at the main menu.
import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockDb,
  mockSendText,
  mockSendButtons,
  mockSendCtaUrl,
  mockHandleRegistrationFlow,
  mockShowMainMenu,
} = vi.hoisted(() => ({
  mockDb: {
    conversation: { findUnique: vi.fn(), upsert: vi.fn() },
    provider: { findUnique: vi.fn(), findFirst: vi.fn() },
    lead: { findFirst: vi.fn(), findUnique: vi.fn(), updateMany: vi.fn() },
    customer: { findUnique: vi.fn() },
    jobRequest: { findFirst: vi.fn(), findUnique: vi.fn(), update: vi.fn() },
    messageEvent: { create: vi.fn() },
    match: { findFirst: vi.fn() },
    booking: { findFirst: vi.fn() },
    providerApplication: { findFirst: vi.fn() },
    inboundWhatsAppMessage: { create: vi.fn() },
  },
  mockSendText: vi.fn(),
  mockSendButtons: vi.fn(),
  mockSendCtaUrl: vi.fn(),
  mockHandleRegistrationFlow: vi.fn(),
  mockShowMainMenu: vi.fn(),
}))

vi.mock('@/lib/db', () => ({ db: mockDb }))
vi.mock('@/lib/whatsapp-interactive', async () => {
  const actual = await vi.importActual<typeof import('@/lib/whatsapp-interactive')>(
    '@/lib/whatsapp-interactive',
  )
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
  showMainMenu: mockShowMainMenu,
}))
vi.mock('@/lib/whatsapp-flows/registration', () => ({
  handleRegistrationFlow: mockHandleRegistrationFlow,
  REGISTRATION_TRIGGERS: ['join'],
}))
vi.mock('@/lib/whatsapp-flows/status', () => ({ handleStatusFlow: vi.fn() }))
vi.mock('@/lib/whatsapp-flows/help', () => ({ handleHelpFlow: vi.fn(), HELP_TRIGGERS: ['help'] }))
vi.mock('@/lib/whatsapp-flows/provider-journey', () => ({
  handleProviderJourneyFlow: vi.fn(),
  PROVIDER_JOURNEY_TRIGGERS: ['provider'],
}))
vi.mock('@/lib/matching-engine', () => ({ acceptLead: vi.fn(), declineLead: vi.fn() }))
vi.mock('@/lib/quotes', () => ({ processQuoteDecision: vi.fn() }))
vi.mock('@/lib/matching/orchestrator', () => ({ orchestrateMatch: vi.fn() }))
vi.mock('@/lib/whatsapp', () => ({ sendProviderAssigned: vi.fn() }))
vi.mock('@/lib/post-match-communications', () => ({
  buildAcceptedLeadContactUrlForProvider: vi.fn(),
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

const PHONE = '+27821234567'

function activeRegistrationConversation(step: string) {
  mockDb.conversation.upsert.mockResolvedValue({
    phone: PHONE,
    flow: 'registration',
    step,
    data: { name: 'Lovemore', skills: ['plumbing'] },
    // 25 minutes in the future — well within the 30-minute TTL.
    expiresAt: new Date(Date.now() + 25 * 60_000),
  })
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

function textMessage(body: string) {
  return {
    from: PHONE,
    id: `wamid.text.${body}.${Math.random()}`,
    type: 'text',
    text: { body },
    timestamp: String(Date.now()),
  }
}

describe('provider onboarding dispatcher — profile photo + active-flow guards', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useRealTimers()
    mockSendText.mockResolvedValue('msg-text')
    mockSendButtons.mockResolvedValue('msg-buttons')
    mockSendCtaUrl.mockResolvedValue('msg-cta')
    mockHandleRegistrationFlow.mockResolvedValue({
      nextStep: 'reg_collect_bio',
      nextData: { profilePhotoAttachmentId: 'att_1' },
    })
  })

  it('routes an image to the registration handler when the user is at reg_collect_profile_photo', async () => {
    activeRegistrationConversation('reg_collect_profile_photo')

    await processInboundMessage(imageMessage('media_profile_xyz'))

    expect(mockHandleRegistrationFlow).toHaveBeenCalledTimes(1)
    const ctx = mockHandleRegistrationFlow.mock.calls[0][0]
    expect(ctx.flow).toBe('registration')
    expect(ctx.step).toBe('reg_collect_profile_photo')
    expect(ctx.reply.type).toBe('image')
    expect(ctx.reply.mediaId).toBe('media_profile_xyz')
  })

  it('still drops images at non-media steps (e.g. reg_collect_name)', async () => {
    activeRegistrationConversation('reg_collect_name')

    await processInboundMessage(imageMessage('media_stray'))

    expect(mockHandleRegistrationFlow).not.toHaveBeenCalled()
  })

  it('intercepts "Hi" mid-registration with a resume prompt instead of resetting to main menu', async () => {
    activeRegistrationConversation('reg_collect_profile_photo')

    await processInboundMessage(textMessage('Hi'))

    expect(mockShowMainMenu).not.toHaveBeenCalled()
    expect(mockHandleRegistrationFlow).not.toHaveBeenCalled()
    expect(mockSendButtons).toHaveBeenCalledWith(
      PHONE,
      expect.stringContaining('still completing your provider application'),
      expect.arrayContaining([
        expect.objectContaining({ id: 'reg_start', title: expect.stringContaining('Continue') }),
        expect.objectContaining({ id: 'session_restart' }),
      ]),
    )
    // Must NOT clobber the saved registration state.
    const wipedToIdle = mockDb.conversation.upsert.mock.calls.some((call) => {
      const update = call[0]?.update ?? call[0]?.create
      return update?.flow === 'idle' && update?.step === 'welcome'
    })
    expect(wipedToIdle).toBe(false)
  })
})
