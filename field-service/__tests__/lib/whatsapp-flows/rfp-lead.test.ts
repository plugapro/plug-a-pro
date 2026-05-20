import { describe, it, expect, vi, beforeEach } from 'vitest'

const {
  mockDb,
  mockSendText,
  mockSendButtons,
  mockCascadeToNext,
  mockNotifyCustomer,
} = vi.hoisted(() => {
  const mockDb = {
    lead: { findUnique: vi.fn() },
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

const PHONE = '+27820000001'
const PROVIDER_ID = 'prov-1'
const LEAD_ID = 'lead-abc123'
const TRACE_ID = 'trace-test-1'

const BASE_LEAD = {
  id: LEAD_ID,
  status: 'SENT',
  providerId: PROVIDER_ID,
  jobRequestId: 'req-1',
  expiresAt: null,
  jobRequest: { id: 'req-1', category: 'plumbing', status: 'MATCHING' },
}

const makeTx = () => ({
  lead: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
  providerLeadResponse: { create: vi.fn().mockResolvedValue({}) },
})

describe('handleRfpLeadInterest', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockDb.lead.findUnique.mockResolvedValue(BASE_LEAD)
    const tx = makeTx()
    mockDb.$transaction.mockImplementation(
      async (fn: (tx: ReturnType<typeof makeTx>) => Promise<unknown>) => fn(tx),
    )
  })

  it('sends availability confirmation on successful transaction', async () => {
    await handleRfpLeadInterest(PHONE, PROVIDER_ID, LEAD_ID, TRACE_ID)
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
    await handleRfpLeadInterest(PHONE, PROVIDER_ID, LEAD_ID, TRACE_ID)
    expect(mockDb.$transaction).toHaveBeenCalledTimes(2)
    expect(mockSendText).toHaveBeenCalledWith(PHONE, expect.stringContaining('Availability noted'))
  })

  it('sends retry button (not decline button) when P2024 persists after retry', async () => {
    mockDb.$transaction.mockRejectedValue(
      Object.assign(new Error('pool timeout'), { code: 'P2024' }),
    )
    await handleRfpLeadInterest(PHONE, PROVIDER_ID, LEAD_ID, TRACE_ID)
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
    await handleRfpLeadInterest(PHONE, PROVIDER_ID, LEAD_ID, TRACE_ID)
    expect(mockSendText).toHaveBeenCalledWith(PHONE, expect.stringContaining('already noted'))
  })

  it('returns early with error when lead not found', async () => {
    mockDb.lead.findUnique.mockResolvedValue(null)
    await handleRfpLeadInterest(PHONE, PROVIDER_ID, LEAD_ID, TRACE_ID)
    expect(mockSendText).toHaveBeenCalledWith(PHONE, expect.stringContaining('could not be found'))
    expect(mockDb.$transaction).not.toHaveBeenCalled()
  })

  it('returns early when lead is expired', async () => {
    mockDb.lead.findUnique.mockResolvedValue({
      ...BASE_LEAD,
      expiresAt: new Date(Date.now() - 1000),
    })
    await handleRfpLeadInterest(PHONE, PROVIDER_ID, LEAD_ID, TRACE_ID)
    expect(mockSendText).toHaveBeenCalledWith(PHONE, expect.stringContaining('expired'))
    expect(mockDb.$transaction).not.toHaveBeenCalled()
  })
})
