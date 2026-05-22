import { describe, it, expect, vi, beforeEach } from 'vitest'

// ── Module mocks (must appear before any imports that resolve these paths) ──

vi.mock('@/lib/db', () => ({
  db: {
    conversation: { findUnique: vi.fn(), upsert: vi.fn() },
    provider:     { findUnique: vi.fn() },
    customer:     { findUnique: vi.fn() },
    booking:      { findFirst: vi.fn() },
    match:        { findFirst: vi.fn() },
    job:          { findFirst: vi.fn() },
    lead:         { findMany: vi.fn(), findFirst: vi.fn(), findUnique: vi.fn(), updateMany: vi.fn() },
    jobRequest:   { findFirst: vi.fn(), findMany: vi.fn(), findUnique: vi.fn(), update: vi.fn() },
    auditLog:     { create: vi.fn() },
    messageEvent: { findFirst: vi.fn(), create: vi.fn() },
  },
}))

vi.mock('@/lib/whatsapp-interactive', () => ({
  parseInbound:                  vi.fn(),
  parseProviderLeadResponseAction: vi.fn(),
  sendText:    vi.fn().mockResolvedValue(undefined),
  sendButtons: vi.fn().mockResolvedValue(undefined),
  sendList:    vi.fn().mockResolvedValue(undefined),
  sendCtaUrl:  vi.fn().mockResolvedValue(undefined),
}))

vi.mock('@/lib/whatsapp-identity', () => ({
  phoneLookupVariants:        vi.fn((p: string) => [p]),
  resolveWhatsAppUserContext: vi.fn(),
}))

vi.mock('@/lib/whatsapp-flows/job-request', () => ({
  showMainMenu:      vi.fn().mockResolvedValue(undefined),
  handleJobRequestFlow: vi.fn().mockResolvedValue({ nextStep: 'welcome', nextData: {} }),
  handleRebookFlow:  vi.fn().mockResolvedValue({ nextStep: 'welcome', nextData: {} }),
}))

vi.mock('@/lib/whatsapp-flows/registration', () => ({
  handleRegistrationFlow: vi.fn().mockResolvedValue({ nextStep: 'welcome', nextData: {} }),
  REGISTRATION_TRIGGERS:  [],
}))

vi.mock('@/lib/whatsapp-flows/status', () => ({
  handleStatusFlow: vi.fn().mockResolvedValue({ nextStep: 'welcome', nextData: {} }),
}))

vi.mock('@/lib/whatsapp-flows/help', () => ({
  handleHelpFlow: vi.fn().mockResolvedValue({ nextStep: 'welcome', nextData: {} }),
  HELP_TRIGGERS:  [],
}))

vi.mock('@/lib/whatsapp-flows/provider-journey', () => ({
  handleProviderJourneyFlow: vi.fn().mockResolvedValue({ nextStep: 'welcome', nextData: {} }),
  handleRunningLateFlow:     vi.fn().mockResolvedValue({ nextStep: 'done' }),
  handleProviderDisputeFlow: vi.fn().mockResolvedValue({ nextStep: 'done' }),
  handleInvoiceFlow:         vi.fn().mockResolvedValue({ nextStep: 'done' }),
  PROVIDER_JOURNEY_TRIGGERS: [],
}))

vi.mock('@/lib/whatsapp-flows/rfp-lead', () => ({
  handleRfpLeadInterest: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('@/lib/whatsapp-batch', () => ({
  createBatchAccumulators: vi.fn().mockReturnValue({
    customerPhotoBatches:          new Map(),
    providerEvidenceBatches:       new Map(),
    pendingCityTextMessages:       new Map(),
    recentCityInteractiveSelections: new Map(),
  }),
}))

vi.mock('@/lib/internal-test-cohort', () => ({
  createTestCohortContext: vi.fn().mockReturnValue({ isTestUser: false, cohortName: null }),
}))

vi.mock('@/lib/provider-whatsapp-command-model', () => ({
  resolveProviderWhatsappCommand: vi.fn().mockReturnValue(null),
}))

vi.mock('@/lib/provider-whatsapp-job-commands', () => ({
  completeProviderJobFromWhatsApp:    vi.fn().mockResolvedValue(undefined),
  executeProviderJobCommand:          vi.fn().mockResolvedValue({ ok: false, reason: 'PROVIDER_NOT_FOUND', message: '' }),
  findSingleActiveJobForProviderPhone: vi.fn().mockResolvedValue({ state: 'none' }),
  parseProviderJobCommand:            vi.fn().mockReturnValue(null),
}))

vi.mock('@/lib/provider-whatsapp-interest-capture', () => ({
  parseProviderInterestRateText: vi.fn().mockReturnValue(null),
}))

vi.mock('@/lib/journey-recovery', () => ({
  resolveJourneyRecovery:        vi.fn().mockResolvedValue(null),
  sendWhatsAppJourneyRecovery:   vi.fn().mockResolvedValue(undefined),
}))

vi.mock('@/lib/whatsapp-policy', () => ({
  applyOptIn:  vi.fn().mockResolvedValue(undefined),
  applyOptOut: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('@/lib/flags', () => ({
  isEnabled: vi.fn().mockResolvedValue(false),
  FLAG_KEYS: { SHORTLIST_DISPATCH_V2: 'shortlist_dispatch_v2' },
}))

vi.mock('@/lib/support-diagnostics', () => ({
  createTraceId: vi.fn().mockReturnValue('trace_test_1'),
  maskPhone:     vi.fn((p: string) => p),
}))

vi.mock('@/lib/review-first', () => ({
  cascadeToNextShortlistedProvider: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('@/lib/whatsapp-copy', () => ({
  ctaLabelFor: vi.fn().mockReturnValue('Check status'),
}))

vi.mock('@/lib/client-request-data', () => ({
  preferenceLabel: vi.fn().mockReturnValue(''),
}))

// ── Imports ─────────────────────────────────────────────────────────────────

import { processInboundMessage } from '@/lib/whatsapp-bot'
import { db } from '@/lib/db'
import * as wa from '@/lib/whatsapp-interactive'
import * as identity from '@/lib/whatsapp-identity'
import { showMainMenu } from '@/lib/whatsapp-flows/job-request'

// ── Constants ────────────────────────────────────────────────────────────────

const CUSTOMER_PHONE = '+27600000001'
const PROVIDER_PHONE = '+27700000002'
const FUTURE_EXPIRY   = new Date(Date.now() + 30 * 60 * 1000)

// ── Fixtures ─────────────────────────────────────────────────────────────────

function makeTextMessage(from: string, body: string, id = 'wamid_test_1') {
  return {
    id,
    from: from.replace('+', ''), // Meta delivers without leading +
    type: 'text' as const,
    text: { body },
    timestamp: '1748800000',
  }
}

function makeIdleConversation(phone: string) {
  return {
    phone,
    flow: 'idle',
    step: 'welcome',
    data: {},
    expiresAt: FUTURE_EXPIRY,
    isTestSession: false,
    cohortName: null,
  }
}

function makeCustomerIdentity(overrides: Record<string, unknown> = {}) {
  return {
    role: 'customer',
    customerId: 'cust_1',
    normalizedPhone: CUSTOMER_PHONE,
    phoneVariants: [CUSTOMER_PHONE],
    savedAddresses: [],
    activeJobCount: 0,
    isPaused: false,
    conflict: false,
    traceId: 'trace_test_1',
    ...overrides,
  }
}

function makeProviderIdentity(overrides: Record<string, unknown> = {}) {
  return {
    role: 'provider',
    providerId: 'prov_1',
    normalizedPhone: PROVIDER_PHONE,
    phoneVariants: [PROVIDER_PHONE],
    savedAddresses: [],
    activeJobCount: 1,
    isPaused: false,
    conflict: false,
    traceId: 'trace_test_2',
    ...overrides,
  }
}

function makeActiveBookingWithJob(jobStatus = 'STARTED') {
  return {
    id: 'bk_1',
    status: 'SCHEDULED',
    updatedAt: new Date(),
    match: {
      provider: { id: 'prov_1', name: 'John Provider', phone: PROVIDER_PHONE },
      jobRequest: { id: 'jr_1', customerId: 'cust_1' },
    },
    job: { id: 'job_1', bookingId: 'bk_1', status: jobStatus },
  }
}

function makeActiveMatch() {
  return {
    id: 'match_1',
    status: 'MATCHED',
    updatedAt: new Date(),
    provider: { id: 'prov_1', name: 'John Provider', phone: PROVIDER_PHONE },
    jobRequest: { id: 'jr_1', customerId: 'cust_1' },
  }
}

function makeActiveJobForProvider() {
  return {
    id: 'job_1',
    bookingId: 'bk_1',
    providerId: 'prov_1',
    status: 'EN_ROUTE',
    updatedAt: new Date(),
    booking: {
      match: {
        jobRequest: {
          customer: { id: 'cust_1', name: 'Sarah Customer', phone: CUSTOMER_PHONE },
        },
      },
    },
  }
}

// ── Shared beforeEach ────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks()

  // By default: no existing conversation (delay-check returns false), upsert returns idle
  vi.mocked(db.conversation.findUnique).mockResolvedValue(null)
  vi.mocked(db.conversation.upsert).mockResolvedValue(makeIdleConversation(CUSTOMER_PHONE) as never)

  // parseInbound: reflect the actual message body so per-test text is not lost
  vi.mocked(wa.parseInbound).mockImplementation(
    (msg: any) => ({ type: 'text', text: msg.text?.body ?? '', id: undefined } as never),
  )

  // parseProviderLeadResponseAction: not a lead response — skip the early-return path
  vi.mocked(wa.parseProviderLeadResponseAction).mockReturnValue({
    ok: false,
    reason: { code: 'NO_CONTEXT', rawMessageType: 'text', inboundMessageId: 'wamid_test_1', contextMessageId: null },
  } as never)

  // Identity: customer by default
  vi.mocked(identity.resolveWhatsAppUserContext).mockResolvedValue(makeCustomerIdentity() as never)

  // DB: no provider at the customer phone, no booking, no match
  vi.mocked(db.provider.findUnique).mockResolvedValue(null)
  vi.mocked(db.customer.findUnique).mockResolvedValue(null)
  vi.mocked(db.booking.findFirst).mockResolvedValue(null)
  vi.mocked(db.match.findFirst).mockResolvedValue(null)
  vi.mocked(db.job.findFirst).mockResolvedValue(null)
})

// ── Customer relay — active booking path ─────────────────────────────────────

describe('tryMediatedRelay — customer has active booking with active job', () => {
  beforeEach(() => {
    vi.mocked(db.customer.findUnique).mockResolvedValue({
      id: 'cust_1', name: 'Sarah Customer', phone: CUSTOMER_PHONE,
    } as never)
    vi.mocked(db.booking.findFirst).mockResolvedValue(makeActiveBookingWithJob() as never)
  })

  it('sends the message text to the matched provider', async () => {
    await processInboundMessage(makeTextMessage(CUSTOMER_PHONE, 'Good'))

    expect(wa.sendText).toHaveBeenCalledWith(
      PROVIDER_PHONE,
      expect.stringContaining('Good'),
      expect.objectContaining({ templateName: 'interactive:relay_customer_to_provider' }),
    )
  })

  it('includes the customer name in the provider message', async () => {
    await processInboundMessage(makeTextMessage(CUSTOMER_PHONE, 'Gate code is 1234'))

    const [, body] = vi.mocked(wa.sendText).mock.calls[0]
    expect(body).toContain('Sarah Customer')
    expect(body).toContain('Gate code is 1234')
  })

  it('sends the relay ack back to the customer', async () => {
    await processInboundMessage(makeTextMessage(CUSTOMER_PHONE, 'Good'))

    expect(wa.sendText).toHaveBeenCalledWith(
      CUSTOMER_PHONE,
      '✅ We relayed your message to the provider.',
      expect.objectContaining({ templateName: 'interactive:relay_ack_customer' }),
    )
  })

  it('does not show the main menu when relay succeeds', async () => {
    await processInboundMessage(makeTextMessage(CUSTOMER_PHONE, 'Good'))

    expect(showMainMenu).not.toHaveBeenCalled()
  })

  it('attaches the bookingId to both relay sends', async () => {
    await processInboundMessage(makeTextMessage(CUSTOMER_PHONE, 'Good'))

    const calls = vi.mocked(wa.sendText).mock.calls
    expect(calls[0][2]).toMatchObject({ bookingId: 'bk_1' })
    expect(calls[1][2]).toMatchObject({ bookingId: 'bk_1' })
  })

  it('attaches the jobId in relay metadata', async () => {
    await processInboundMessage(makeTextMessage(CUSTOMER_PHONE, 'Good'))

    expect(wa.sendText).toHaveBeenCalledWith(
      PROVIDER_PHONE,
      expect.any(String),
      expect.objectContaining({ metadata: expect.objectContaining({ jobId: 'job_1', direction: 'customer_to_provider' }) }),
    )
  })

  it.each(['SCHEDULED', 'EN_ROUTE', 'ARRIVED', 'STARTED', 'PAUSED', 'AWAITING_APPROVAL', 'PENDING_COMPLETION_CONFIRMATION'])(
    'relays when job.status is %s (active)',
    async (jobStatus) => {
      vi.mocked(db.booking.findFirst).mockResolvedValue(makeActiveBookingWithJob(jobStatus) as never)

      await processInboundMessage(makeTextMessage(CUSTOMER_PHONE, 'Are you coming?'))

      expect(wa.sendText).toHaveBeenCalledWith(PROVIDER_PHONE, expect.any(String), expect.any(Object))
      expect(wa.sendText).toHaveBeenCalledWith(CUSTOMER_PHONE, expect.stringContaining('relayed'), expect.any(Object))
    },
  )
})

// ── Customer relay — active match path (no booking yet) ──────────────────────

describe('tryMediatedRelay — customer has active match but no confirmed booking', () => {
  beforeEach(() => {
    vi.mocked(db.customer.findUnique).mockResolvedValue({
      id: 'cust_1', name: 'Sarah Customer', phone: CUSTOMER_PHONE,
    } as never)
    vi.mocked(db.booking.findFirst).mockResolvedValue(null)
    vi.mocked(db.match.findFirst).mockResolvedValue(makeActiveMatch() as never)
  })

  it('relays to the provider via the match record', async () => {
    await processInboundMessage(makeTextMessage(CUSTOMER_PHONE, 'Can you start at 9am?'))

    expect(wa.sendText).toHaveBeenCalledWith(
      PROVIDER_PHONE,
      expect.stringContaining('Can you start at 9am?'),
      expect.objectContaining({ templateName: 'interactive:relay_customer_to_provider' }),
    )
  })

  it('sends the ack to the customer', async () => {
    await processInboundMessage(makeTextMessage(CUSTOMER_PHONE, 'Can you start at 9am?'))

    expect(wa.sendText).toHaveBeenCalledWith(
      CUSTOMER_PHONE,
      '✅ We relayed your message to the provider.',
      expect.objectContaining({ templateName: 'interactive:relay_ack_customer' }),
    )
  })

  it.each(['MATCHED', 'INSPECTION_SCHEDULED', 'INSPECTION_COMPLETE', 'QUOTED', 'QUOTE_DECLINED'])(
    'relays when match.status is %s',
    async (matchStatus) => {
      vi.mocked(db.match.findFirst).mockResolvedValue({ ...makeActiveMatch(), status: matchStatus } as never)

      await processInboundMessage(makeTextMessage(CUSTOMER_PHONE, 'ETA please?'))

      expect(wa.sendText).toHaveBeenCalledWith(PROVIDER_PHONE, expect.any(String), expect.any(Object))
    },
  )

  it('attaches the matchId in relay metadata when no booking', async () => {
    await processInboundMessage(makeTextMessage(CUSTOMER_PHONE, 'ETA please?'))

    expect(wa.sendText).toHaveBeenCalledWith(
      PROVIDER_PHONE,
      expect.any(String),
      expect.objectContaining({ metadata: expect.objectContaining({ matchId: 'match_1' }) }),
    )
  })
})

// ── Customer relay — no active context ───────────────────────────────────────

describe('tryMediatedRelay — customer has no active booking or match', () => {
  beforeEach(() => {
    vi.mocked(db.customer.findUnique).mockResolvedValue({
      id: 'cust_1', name: 'Sarah Customer', phone: CUSTOMER_PHONE,
    } as never)
    // booking and match mocks already return null from the shared beforeEach
  })

  it('does not relay the message', async () => {
    await processInboundMessage(makeTextMessage(CUSTOMER_PHONE, 'Good'))

    expect(wa.sendText).not.toHaveBeenCalledWith(
      expect.any(String),
      expect.stringContaining('relayed'),
      expect.any(Object),
    )
  })

  it('shows the main menu instead', async () => {
    await processInboundMessage(makeTextMessage(CUSTOMER_PHONE, 'Good'))

    expect(showMainMenu).toHaveBeenCalledWith(CUSTOMER_PHONE)
  })
})

// ── Relay blocked — job is terminal ──────────────────────────────────────────

describe('tryMediatedRelay — booking exists but job has ended', () => {
  beforeEach(() => {
    vi.mocked(db.customer.findUnique).mockResolvedValue({
      id: 'cust_1', name: 'Sarah Customer', phone: CUSTOMER_PHONE,
    } as never)
  })

  it.each(['COMPLETED', 'FAILED', 'CANCELLED'])(
    'does not relay when job.status is %s',
    async (terminalStatus) => {
      vi.mocked(db.booking.findFirst).mockResolvedValue(makeActiveBookingWithJob(terminalStatus) as never)
      vi.mocked(db.match.findFirst).mockResolvedValue(null)

      await processInboundMessage(makeTextMessage(CUSTOMER_PHONE, 'Thank you'))

      expect(wa.sendText).not.toHaveBeenCalledWith(
        PROVIDER_PHONE,
        expect.any(String),
        expect.any(Object),
      )
      expect(showMainMenu).toHaveBeenCalledWith(CUSTOMER_PHONE)
    },
  )

  it('falls through to the match check when job is terminal and match is active', async () => {
    vi.mocked(db.booking.findFirst).mockResolvedValue(makeActiveBookingWithJob('COMPLETED') as never)
    vi.mocked(db.match.findFirst).mockResolvedValue(makeActiveMatch() as never)

    await processInboundMessage(makeTextMessage(CUSTOMER_PHONE, 'ETA please?'))

    expect(wa.sendText).toHaveBeenCalledWith(
      PROVIDER_PHONE,
      expect.stringContaining('ETA please?'),
      expect.objectContaining({ templateName: 'interactive:relay_customer_to_provider' }),
    )
  })
})

// ── Relay blocked — booking has no job record ─────────────────────────────────

describe('tryMediatedRelay — booking exists but job record is missing', () => {
  it('falls through to the match check when booking.job is null', async () => {
    vi.mocked(db.customer.findUnique).mockResolvedValue({
      id: 'cust_1', name: 'Sarah Customer', phone: CUSTOMER_PHONE,
    } as never)
    vi.mocked(db.booking.findFirst).mockResolvedValue({
      ...makeActiveBookingWithJob(),
      job: null,
    } as never)
    vi.mocked(db.match.findFirst).mockResolvedValue(makeActiveMatch() as never)

    await processInboundMessage(makeTextMessage(CUSTOMER_PHONE, 'ETA please?'))

    expect(wa.sendText).toHaveBeenCalledWith(
      PROVIDER_PHONE,
      expect.stringContaining('ETA please?'),
      expect.objectContaining({ templateName: 'interactive:relay_customer_to_provider' }),
    )
  })
})

// ── Relay skipped — reset keyword ────────────────────────────────────────────

describe('tryMediatedRelay — customer sends a reset keyword', () => {
  it.each(['hi', 'hello', 'menu', 'start', 'hey', '0'])(
    'does not attempt relay for keyword "%s"',
    async (keyword) => {
      // parseInbound already reflects the message body via mockImplementation in beforeEach
      vi.mocked(db.customer.findUnique).mockResolvedValue({
        id: 'cust_1', name: 'Sarah Customer', phone: CUSTOMER_PHONE,
      } as never)
      vi.mocked(db.booking.findFirst).mockResolvedValue(makeActiveBookingWithJob() as never)

      await processInboundMessage(makeTextMessage(CUSTOMER_PHONE, keyword))

      // Reset keywords must never trigger relay — even with an active booking
      expect(wa.sendText).not.toHaveBeenCalledWith(
        CUSTOMER_PHONE,
        expect.stringContaining('relayed'),
        expect.any(Object),
      )
      expect(wa.sendText).not.toHaveBeenCalledWith(
        PROVIDER_PHONE,
        expect.any(String),
        expect.any(Object),
      )
    },
  )
})

// ── Relay skipped — message too short ────────────────────────────────────────

describe('tryMediatedRelay — message body is too short', () => {
  it('does not relay a single-character message', async () => {
    vi.mocked(wa.parseInbound).mockReturnValue({ type: 'text', text: 'x', id: undefined } as never)
    vi.mocked(db.customer.findUnique).mockResolvedValue({
      id: 'cust_1', name: 'Sarah Customer', phone: CUSTOMER_PHONE,
    } as never)
    vi.mocked(db.booking.findFirst).mockResolvedValue(makeActiveBookingWithJob() as never)

    await processInboundMessage(makeTextMessage(CUSTOMER_PHONE, 'x'))

    expect(wa.sendText).not.toHaveBeenCalledWith(
      CUSTOMER_PHONE,
      expect.stringContaining('relayed'),
      expect.any(Object),
    )
  })

  it('does not relay whitespace-only text after trim', async () => {
    // parseInbound reflects the message body via mockImplementation; '   ' passes the
    // rawText.length >= 2 gate in the router but tryMediatedRelay trims it to '' and returns false immediately
    vi.mocked(db.booking.findFirst).mockResolvedValue(makeActiveBookingWithJob() as never)

    // tryMediatedRelay trims the text first; empty string returns false immediately
    await processInboundMessage(makeTextMessage(CUSTOMER_PHONE, '   '))

    expect(wa.sendText).not.toHaveBeenCalledWith(
      CUSTOMER_PHONE,
      expect.stringContaining('relayed'),
      expect.any(Object),
    )
  })
})

// ── Multiple active bookings — ordering ──────────────────────────────────────

describe('tryMediatedRelay — multiple active bookings (ambiguity)', () => {
  it('routes to the most recently updated booking (findFirst with orderBy updatedAt desc)', async () => {
    const newerBooking = {
      ...makeActiveBookingWithJob(),
      id: 'bk_newer',
      updatedAt: new Date('2026-05-21T10:00:00Z'),
      match: {
        provider: { id: 'prov_2', name: 'Alice Provider', phone: '+27700000003' },
        jobRequest: { id: 'jr_2', customerId: 'cust_1' },
      },
      job: { id: 'job_2', bookingId: 'bk_newer', status: 'STARTED' },
    }

    vi.mocked(db.customer.findUnique).mockResolvedValue({
      id: 'cust_1', name: 'Sarah Customer', phone: CUSTOMER_PHONE,
    } as never)
    // findFirst returns only the first result — the mock simulates the DB returning the newest
    vi.mocked(db.booking.findFirst).mockResolvedValue(newerBooking as never)

    await processInboundMessage(makeTextMessage(CUSTOMER_PHONE, 'On my way'))

    expect(wa.sendText).toHaveBeenCalledWith(
      '+27700000003',
      expect.stringContaining('On my way'),
      expect.any(Object),
    )
    // The older booking's provider should NOT receive anything
    expect(wa.sendText).not.toHaveBeenCalledWith(
      PROVIDER_PHONE,
      expect.any(String),
      expect.objectContaining({ templateName: 'interactive:relay_customer_to_provider' }),
    )
  })
})

// ── Provider relay — active job path ─────────────────────────────────────────

describe('tryMediatedRelay — provider sends free text with active job', () => {
  beforeEach(() => {
    vi.mocked(identity.resolveWhatsAppUserContext).mockResolvedValue(makeProviderIdentity() as never)
    vi.mocked(db.conversation.upsert).mockResolvedValue(makeIdleConversation(PROVIDER_PHONE) as never)

    vi.mocked(db.provider.findUnique).mockResolvedValue({
      id: 'prov_1', name: 'John Provider', phone: PROVIDER_PHONE,
    } as never)
    vi.mocked(db.job.findFirst).mockResolvedValue(makeActiveJobForProvider() as never)
  })

  it('sends the message to the matched customer', async () => {
    await processInboundMessage(makeTextMessage(PROVIDER_PHONE, 'On my way'))

    expect(wa.sendText).toHaveBeenCalledWith(
      CUSTOMER_PHONE,
      expect.stringContaining('On my way'),
      expect.objectContaining({ templateName: 'interactive:relay_provider_to_customer' }),
    )
  })

  it('includes the provider name in the customer message', async () => {
    await processInboundMessage(makeTextMessage(PROVIDER_PHONE, 'On my way'))

    const [, body] = vi.mocked(wa.sendText).mock.calls[0]
    expect(body).toContain('John Provider')
  })

  it('sends the relay ack back to the provider', async () => {
    await processInboundMessage(makeTextMessage(PROVIDER_PHONE, 'On my way'))

    expect(wa.sendText).toHaveBeenCalledWith(
      PROVIDER_PHONE,
      '✅ We relayed your message to the customer.',
      expect.objectContaining({ templateName: 'interactive:relay_ack_provider' }),
    )
  })

  it('attaches the jobId in provider relay metadata', async () => {
    await processInboundMessage(makeTextMessage(PROVIDER_PHONE, 'On my way'))

    expect(wa.sendText).toHaveBeenCalledWith(
      CUSTOMER_PHONE,
      expect.any(String),
      expect.objectContaining({ metadata: expect.objectContaining({ jobId: 'job_1', direction: 'provider_to_customer' }) }),
    )
  })

  it.each(['SCHEDULED', 'EN_ROUTE', 'ARRIVED', 'STARTED', 'PAUSED', 'AWAITING_APPROVAL', 'PENDING_COMPLETION_CONFIRMATION'])(
    'relays when job.status is %s',
    async (jobStatus) => {
      vi.mocked(db.job.findFirst).mockResolvedValue({
        ...makeActiveJobForProvider(),
        status: jobStatus,
      } as never)

      await processInboundMessage(makeTextMessage(PROVIDER_PHONE, 'Running a bit late'))

      expect(wa.sendText).toHaveBeenCalledWith(CUSTOMER_PHONE, expect.any(String), expect.any(Object))
    },
  )
})

// ── Provider relay — no active job ───────────────────────────────────────────

describe('tryMediatedRelay — provider sends free text with no active job', () => {
  beforeEach(() => {
    vi.mocked(identity.resolveWhatsAppUserContext).mockResolvedValue(makeProviderIdentity() as never)
    vi.mocked(db.conversation.upsert).mockResolvedValue(makeIdleConversation(PROVIDER_PHONE) as never)

    vi.mocked(db.provider.findUnique).mockResolvedValue({
      id: 'prov_1', name: 'John Provider', phone: PROVIDER_PHONE,
    } as never)
    // No active job
    vi.mocked(db.job.findFirst).mockResolvedValue(null)
    // Provider phone is not a customer
    vi.mocked(db.customer.findUnique).mockResolvedValue(null)
  })

  it('does not relay the message', async () => {
    await processInboundMessage(makeTextMessage(PROVIDER_PHONE, 'Hello'))

    expect(wa.sendText).not.toHaveBeenCalledWith(
      expect.any(String),
      expect.stringContaining('relayed'),
      expect.any(Object),
    )
  })

  it('shows the main menu', async () => {
    await processInboundMessage(makeTextMessage(PROVIDER_PHONE, 'Hello'))

    expect(showMainMenu).toHaveBeenCalledWith(PROVIDER_PHONE)
  })
})

// ── Customer not in database ──────────────────────────────────────────────────

describe('tryMediatedRelay — phone number not found as customer or provider', () => {
  it('falls through to main menu when phone is unknown to the system', async () => {
    // provider.findUnique and customer.findUnique already return null from shared beforeEach
    await processInboundMessage(makeTextMessage(CUSTOMER_PHONE, 'Hello'))

    expect(wa.sendText).not.toHaveBeenCalledWith(
      expect.any(String),
      expect.stringContaining('relayed'),
      expect.any(Object),
    )
    expect(showMainMenu).toHaveBeenCalledWith(CUSTOMER_PHONE)
  })
})
