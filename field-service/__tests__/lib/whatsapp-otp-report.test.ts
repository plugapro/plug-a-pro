import { beforeEach, describe, expect, it, vi } from 'vitest'

const GENERIC_CONFIRMATION =
  "We've blocked that verification attempt. Your Plug A Pro account is protected. If you are trying to sign in, please start again from the app."

const {
  mockDb,
  mockReportUnrequestedOtpFromWhatsApp,
  mockReportUnrequestedOtpByWhatsAppMessageId,
  mockSendText,
  mockSendButtons,
  mockSendCtaUrl,
  mockShowMainMenu,
  mockHandleJobRequestFlow,
  mockHandleRegistrationFlow,
  mockHandleStatusFlow,
  mockHandleHelpFlow,
  mockHandleProviderJourneyFlow,
  mockSendJourneyRecovery,
} = vi.hoisted(() => ({
  mockDb: {
    conversation: { findUnique: vi.fn(), upsert: vi.fn() },
    otpChallenge: { findUnique: vi.fn() },
    provider: { findUnique: vi.fn(), findFirst: vi.fn(), findMany: vi.fn() },
    providerApplication: { findFirst: vi.fn(), findUnique: vi.fn(), update: vi.fn() },
    customer: { findFirst: vi.fn(), findUnique: vi.fn() },
    address: { findFirst: vi.fn() },
    jobRequest: { findFirst: vi.fn(), findUnique: vi.fn(), update: vi.fn() },
    lead: { findFirst: vi.fn(), findMany: vi.fn(), findUnique: vi.fn(), updateMany: vi.fn() },
    messageEvent: { findFirst: vi.fn(), create: vi.fn() },
    match: { findFirst: vi.fn() },
    booking: { findFirst: vi.fn() },
    providerWallet: { findUnique: vi.fn(), updateMany: vi.fn() },
    providerIdentityVerification: { findFirst: vi.fn() },
    attachment: { updateMany: vi.fn() },
  },
  mockReportUnrequestedOtpFromWhatsApp: vi.fn(),
  mockReportUnrequestedOtpByWhatsAppMessageId: vi.fn(),
  mockSendText: vi.fn(),
  mockSendButtons: vi.fn(),
  mockSendCtaUrl: vi.fn(),
  mockShowMainMenu: vi.fn(),
  mockHandleJobRequestFlow: vi.fn(),
  mockHandleRegistrationFlow: vi.fn(),
  mockHandleStatusFlow: vi.fn(),
  mockHandleHelpFlow: vi.fn(),
  mockHandleProviderJourneyFlow: vi.fn(),
  mockSendJourneyRecovery: vi.fn(),
}))

vi.mock('@/lib/db', () => ({ db: mockDb }))
vi.mock('@/lib/otp-security', () => ({
  reportUnrequestedOtpFromWhatsApp: mockReportUnrequestedOtpFromWhatsApp,
  reportUnrequestedOtpByWhatsAppMessageId: mockReportUnrequestedOtpByWhatsAppMessageId,
}))
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
  handleJobRequestFlow: mockHandleJobRequestFlow,
  handleRebookFlow: vi.fn(),
  showMainMenu: mockShowMainMenu,
}))
vi.mock('@/lib/whatsapp-flows/registration', () => ({
  handleRegistrationFlow: mockHandleRegistrationFlow,
  REGISTRATION_TRIGGERS: ['join'],
}))
vi.mock('@/lib/whatsapp-flows/status', () => ({ handleStatusFlow: mockHandleStatusFlow }))
vi.mock('@/lib/whatsapp-flows/help', () => ({
  handleHelpFlow: mockHandleHelpFlow,
  HELP_TRIGGERS: ['help'],
}))
vi.mock('@/lib/whatsapp-flows/provider-journey', () => ({
  handleProviderJourneyFlow: mockHandleProviderJourneyFlow,
  handleRunningLateFlow: vi.fn(),
  handleProviderDisputeFlow: vi.fn(),
  handleInvoiceFlow: vi.fn(),
  PROVIDER_JOURNEY_TRIGGERS: ['provider'],
}))
vi.mock('@/lib/matching-engine', () => ({ acceptLead: vi.fn(), declineLead: vi.fn() }))
vi.mock('@/lib/matching/service', () => ({ acceptAssignmentOffer: vi.fn() }))
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
  return {
    ...actual,
    sendWhatsAppJourneyRecovery: mockSendJourneyRecovery,
  }
})
vi.mock('@/lib/post-match-communications', () => ({
  buildAcceptedLeadContactUrlForProvider: vi.fn().mockResolvedValue(null),
  notifyPostMatchAcceptance: vi.fn(),
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

const RAW_WHATSAPP_PHONE = '27821234567'
const PHONE_E164 = '+27821234567'

function activeIdleConversation() {
  return {
    phone: PHONE_E164,
    flow: 'idle',
    step: 'welcome',
    data: {},
    expiresAt: new Date(Date.now() + 300_000),
  }
}

function buttonMessage(id: string, from = RAW_WHATSAPP_PHONE) {
  return {
    from,
    id: `wamid.${id}`,
    type: 'interactive',
    interactive: {
      type: 'button_reply',
      button_reply: { id, title: id },
    },
    timestamp: String(Date.now()),
  }
}

function rawButtonPayloadMessage(payload: string, from = RAW_WHATSAPP_PHONE) {
  return {
    from,
    id: `wamid.raw.${payload}`,
    type: 'button',
    button: { payload, text: payload },
    timestamp: String(Date.now()),
  }
}

function nativeDidNotRequestMessage(contextId = 'wamid.otp.1', from = RAW_WHATSAPP_PHONE) {
  return {
    from,
    id: 'wamid.native.report.1',
    context: { id: contextId, from },
    type: 'button',
    button: { payload: 'DID_NOT_REQUEST_CODE', text: "I didn't request a code" },
    timestamp: String(Date.now()),
  }
}

describe('WhatsApp OTP report button replies', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockReportUnrequestedOtpFromWhatsApp.mockResolvedValue({ ok: true })
    mockReportUnrequestedOtpByWhatsAppMessageId.mockResolvedValue({ ok: true })
    mockSendText.mockResolvedValue('wamid.confirmation')
    mockSendButtons.mockResolvedValue('wamid.buttons')
    mockSendCtaUrl.mockResolvedValue('wamid.cta')
    mockShowMainMenu.mockResolvedValue(undefined)
    mockHandleJobRequestFlow.mockResolvedValue(undefined)
    mockHandleRegistrationFlow.mockResolvedValue(undefined)
    mockHandleStatusFlow.mockResolvedValue(undefined)
    mockHandleHelpFlow.mockResolvedValue(undefined)
    mockHandleProviderJourneyFlow.mockResolvedValue(undefined)
    mockSendJourneyRecovery.mockResolvedValue(undefined)
    mockDb.conversation.findUnique.mockResolvedValue(null)
    mockDb.conversation.upsert.mockResolvedValue(activeIdleConversation())
    mockDb.provider.findUnique.mockResolvedValue(null)
    mockDb.provider.findFirst.mockResolvedValue(null)
    mockDb.provider.findMany.mockResolvedValue([])
    mockDb.providerApplication.findFirst.mockResolvedValue(null)
    mockDb.providerApplication.findUnique.mockResolvedValue(null)
    mockDb.customer.findFirst.mockResolvedValue(null)
    mockDb.customer.findUnique.mockResolvedValue(null)
    mockDb.address.findFirst.mockResolvedValue(null)
    mockDb.jobRequest.findFirst.mockResolvedValue(null)
    mockDb.jobRequest.findUnique.mockResolvedValue(null)
    mockDb.lead.findFirst.mockResolvedValue(null)
    mockDb.lead.findMany.mockResolvedValue([])
    mockDb.lead.findUnique.mockResolvedValue(null)
    mockDb.messageEvent.findFirst.mockResolvedValue(null)
    mockDb.match.findFirst.mockResolvedValue(null)
    mockDb.booking.findFirst.mockResolvedValue(null)
    mockDb.providerIdentityVerification.findFirst.mockResolvedValue(null)
    mockDb.otpChallenge.findUnique.mockResolvedValue(null)
  })

  it('handles otp_report_{signedToken} button replies through the WhatsApp report service', async () => {
    const token = 'signed.report.token'

    await processInboundMessage(buttonMessage(`otp_report_${token}`))

    expect(mockReportUnrequestedOtpFromWhatsApp).toHaveBeenCalledWith({
      token,
      fromPhoneE164: PHONE_E164,
    })
    expect(mockSendText).toHaveBeenCalledWith(PHONE_E164, GENERIC_CONFIRMATION)
    expect(mockDb.conversation.upsert).not.toHaveBeenCalled()
    expect(mockShowMainMenu).not.toHaveBeenCalled()
  })

  it('handles raw WhatsApp button payloads normalized by parseInbound', async () => {
    const token = 'signed.raw.button.token'

    await processInboundMessage(rawButtonPayloadMessage(`otp_report_${token}`))

    expect(mockReportUnrequestedOtpFromWhatsApp).toHaveBeenCalledWith({
      token,
      fromPhoneE164: PHONE_E164,
    })
    expect(mockSendText).toHaveBeenCalledWith(PHONE_E164, GENERIC_CONFIRMATION)
    expect(mockDb.conversation.upsert).not.toHaveBeenCalled()
  })

  it('handles Meta native DID_NOT_REQUEST_CODE button replies by OTP message context id', async () => {
    await processInboundMessage(nativeDidNotRequestMessage('wamid.otp.1'))

    expect(mockReportUnrequestedOtpByWhatsAppMessageId).toHaveBeenCalledWith({
      providerMessageId: 'wamid.otp.1',
      fromPhoneE164: PHONE_E164,
    })
    expect(mockReportUnrequestedOtpFromWhatsApp).not.toHaveBeenCalled()
    expect(mockSendText).toHaveBeenCalledWith(PHONE_E164, GENERIC_CONFIRMATION)
    expect(mockDb.conversation.upsert).not.toHaveBeenCalled()
  })

  it('passes normalized inbound from phone so wrong-sender rejection stays in the service', async () => {
    await processInboundMessage(buttonMessage('otp_report_signed-token', '082 123 4567'))

    expect(mockReportUnrequestedOtpFromWhatsApp).toHaveBeenCalledWith({
      token: 'signed-token',
      fromPhoneE164: PHONE_E164,
    })
  })

  it('handles malformed and challenge-id-only payloads generically without challenge-id fallback', async () => {
    await processInboundMessage(buttonMessage('otp_report_challenge_123'))
    await processInboundMessage(buttonMessage('otp_report_'))

    expect(mockReportUnrequestedOtpFromWhatsApp).toHaveBeenNthCalledWith(1, {
      token: 'challenge_123',
      fromPhoneE164: PHONE_E164,
    })
    expect(mockReportUnrequestedOtpFromWhatsApp).toHaveBeenNthCalledWith(2, {
      token: '',
      fromPhoneE164: PHONE_E164,
    })
    expect(mockDb.otpChallenge.findUnique).not.toHaveBeenCalled()
    expect(mockSendText).toHaveBeenCalledTimes(2)
    expect(mockSendText).toHaveBeenNthCalledWith(1, PHONE_E164, GENERIC_CONFIRMATION)
    expect(mockSendText).toHaveBeenNthCalledWith(2, PHONE_E164, GENERIC_CONFIRMATION)
  })

  it('keeps raw signed tokens out of fallback logs and user-visible messages', async () => {
    const token = 'signed.secret.token'
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    mockReportUnrequestedOtpFromWhatsApp.mockRejectedValueOnce(new Error(`database timeout for ${token}`))

    try {
      await processInboundMessage(buttonMessage(`otp_report_${token}`))
    } finally {
      errorSpy.mockRestore()
    }

    expect(mockReportUnrequestedOtpFromWhatsApp).toHaveBeenCalledWith({
      token,
      fromPhoneE164: PHONE_E164,
    })
    expect(mockSendText).toHaveBeenCalledWith(PHONE_E164, GENERIC_CONFIRMATION)
    expect(JSON.stringify(errorSpy.mock.calls)).not.toContain(token)
    expect(JSON.stringify(mockSendText.mock.calls)).not.toContain(token)
  })

  it('lets normal non-OTP button replies continue through existing routing', async () => {
    await processInboundMessage(buttonMessage('back_home'))

    expect(mockReportUnrequestedOtpFromWhatsApp).not.toHaveBeenCalled()
    expect(mockShowMainMenu).toHaveBeenCalledWith(PHONE_E164)
    expect(mockDb.conversation.upsert).toHaveBeenCalled()
  })
})
