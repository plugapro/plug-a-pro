import { describe, it, expect, vi, beforeEach } from 'vitest'
import { JobRequestStatus, LeadStatus } from '@prisma/client'

const {
  mockDb,
  mockSendText,
  mockSendButtons,
  mockCascadeToNext,
  mockNotifyCustomer,
} = vi.hoisted(() => {
  const mockDb = {
    auditLog: { create: vi.fn().mockResolvedValue({}) },
    providerRate: { findFirst: vi.fn().mockResolvedValue(null) },
    $transaction: vi.fn(),
  }
  return {
    mockDb,
    mockSendText: vi.fn(),
    mockSendButtons: vi.fn(),
    mockCascadeToNext: vi.fn().mockResolvedValue(undefined),
    mockNotifyCustomer: vi.fn().mockResolvedValue(undefined),
  }
})

vi.mock('@/lib/db', () => ({ db: mockDb }))
vi.mock('@/lib/whatsapp-interactive', () => ({
  sendText: mockSendText,
  sendButtons: mockSendButtons,
  sendCtaUrl: vi.fn().mockResolvedValue(undefined),
}))
vi.mock('@/lib/review-first', () => ({
  cascadeToNextShortlistedProvider: mockCascadeToNext,
  notifyCustomerRfpResponseSummary: mockNotifyCustomer,
}))
vi.mock('@/lib/provider-credit-copy', () => ({
  buildLeadAcceptedCreditLine: vi.fn().mockReturnValue('credit line'),
  buildInsufficientCreditsMessage: vi.fn().mockReturnValue('insufficient'),
  creditCountLabel: vi.fn().mockReturnValue('1 credit'),
  getPublicAppUrl: vi.fn().mockReturnValue('https://app.test'),
  getWorkerPortalUrl: vi.fn().mockReturnValue('https://portal.test'),
  providerCreditBreakdownLabel: vi.fn().mockReturnValue('breakdown'),
}))
vi.mock('@/lib/whatsapp-copy', () => ({ ctaLabelFor: vi.fn().mockReturnValue('View') }))
vi.mock('@/lib/lead-unlocks', () => ({ LEAD_UNLOCK_COST_CREDITS: 1 }))

import { handleRfpLeadInterest } from '@/lib/whatsapp-flows/rfp-lead'
import { type LeadWithJobRequest, createInMemoryLeadRepository } from '@/lib/lead-repository'

const PHONE = '+27820000001'
const PROVIDER_ID = 'prov-1'
const LEAD_ID = 'lead-abc123'
const TRACE_ID = 'trace-test-1'

const BASE_LEAD: LeadWithJobRequest = {
  id: LEAD_ID,
  status: LeadStatus.SENT,
  providerId: PROVIDER_ID,
  jobRequestId: 'req-1',
  expiresAt: null,
  jobRequest: { id: 'req-1', category: 'plumbing', status: JobRequestStatus.MATCHING },
}

const makeTx = () => ({
  lead: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
  providerLeadResponse: { create: vi.fn().mockResolvedValue({}) },
})

describe('handleRfpLeadInterest', () => {
  let defaultRepo: ReturnType<typeof createInMemoryLeadRepository>

  beforeEach(() => {
    vi.clearAllMocks()
    defaultRepo = createInMemoryLeadRepository([BASE_LEAD])
    const tx = makeTx()
    mockDb.$transaction.mockImplementation(
      async (fn: (tx: ReturnType<typeof makeTx>) => Promise<unknown>) => fn(tx),
    )
  })

  it('sends availability confirmation on successful transaction', async () => {
    await handleRfpLeadInterest(PHONE, PROVIDER_ID, LEAD_ID, TRACE_ID, { _repo: defaultRepo })
    expect(mockSendText).toHaveBeenCalledWith(PHONE, expect.stringContaining('Availability noted'))
  })

  it('retries once on P2024 connection pool timeout and succeeds on retry', async () => {
    let calls = 0
    const tx = makeTx()
    mockDb.$transaction.mockImplementation(
      async (fn: (tx: ReturnType<typeof makeTx>) => Promise<unknown>) => {
        calls++
        if (calls === 1) throw Object.assign(new Error('pool timeout'), { code: 'P2024' })
        return fn(tx)
      },
    )
    await handleRfpLeadInterest(PHONE, PROVIDER_ID, LEAD_ID, TRACE_ID, { _repo: defaultRepo })
    expect(mockDb.$transaction).toHaveBeenCalledTimes(2)
    expect(mockSendText).toHaveBeenCalledWith(PHONE, expect.stringContaining('Availability noted'))
  })

  it('sends retry button (not decline button) when P2024 persists after retry', async () => {
    mockDb.$transaction.mockRejectedValue(
      Object.assign(new Error('pool timeout'), { code: 'P2024' }),
    )
    await handleRfpLeadInterest(PHONE, PROVIDER_ID, LEAD_ID, TRACE_ID, { _repo: defaultRepo })
    expect(mockSendButtons).toHaveBeenCalledWith(
      PHONE,
      expect.stringContaining("couldn't register your availability"),
      expect.arrayContaining([
        expect.objectContaining({ id: `ops_accept:${LEAD_ID}:${PROVIDER_ID}`, title: "I'm Available" }),
      ]),
    )
    const [, , buttons] = mockSendButtons.mock.calls[0] as [string, string, Array<{ id: string }>]
    expect(buttons.some((b) => b.id.startsWith('ops_decline:'))).toBe(false)
  })

  it('deduplicates concurrent taps via P2002 unique constraint', async () => {
    mockDb.$transaction.mockRejectedValue(
      Object.assign(new Error('unique constraint'), { code: 'P2002' }),
    )
    await handleRfpLeadInterest(PHONE, PROVIDER_ID, LEAD_ID, TRACE_ID, { _repo: defaultRepo })
    expect(mockSendText).toHaveBeenCalledWith(PHONE, expect.stringContaining('already noted'))
  })

  it('returns early with error when lead not found', async () => {
    const emptyRepo = createInMemoryLeadRepository([])
    await handleRfpLeadInterest(PHONE, PROVIDER_ID, LEAD_ID, TRACE_ID, { _repo: emptyRepo })
    expect(mockSendText).toHaveBeenCalledWith(PHONE, expect.stringContaining('could not be found'))
    expect(mockDb.$transaction).not.toHaveBeenCalled()
  })

  it('returns early when lead is expired', async () => {
    const expiredRepo = createInMemoryLeadRepository([
      { ...BASE_LEAD, expiresAt: new Date(Date.now() - 1000) },
    ])
    await handleRfpLeadInterest(PHONE, PROVIDER_ID, LEAD_ID, TRACE_ID, { _repo: expiredRepo })
    expect(mockSendText).toHaveBeenCalledWith(PHONE, expect.stringContaining('expired'))
    expect(mockDb.$transaction).not.toHaveBeenCalled()
  })

  it('sends already-noted message when lead is already INTERESTED', async () => {
    const interestedRepo = createInMemoryLeadRepository([
      { ...BASE_LEAD, status: LeadStatus.INTERESTED },
    ])
    await handleRfpLeadInterest(PHONE, PROVIDER_ID, LEAD_ID, TRACE_ID, { _repo: interestedRepo })
    expect(mockSendText).toHaveBeenCalledWith(PHONE, expect.stringContaining('already noted'))
    expect(mockDb.$transaction).not.toHaveBeenCalled()
  })

  it('keeps already-interested retry idempotent even after the response window expires', async () => {
    const interestedRepo = createInMemoryLeadRepository([
      { ...BASE_LEAD, status: LeadStatus.INTERESTED, expiresAt: new Date(Date.now() - 1000) },
    ])
    await handleRfpLeadInterest(PHONE, PROVIDER_ID, LEAD_ID, TRACE_ID, { _repo: interestedRepo })
    expect(mockSendText).toHaveBeenCalledWith(PHONE, expect.stringContaining('already noted'))
    expect(mockSendText).not.toHaveBeenCalledWith(PHONE, expect.stringContaining('expired'))
    expect(mockDb.$transaction).not.toHaveBeenCalled()
  })
})
