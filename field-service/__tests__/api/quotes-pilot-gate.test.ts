import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const {
  mockQuoteFindUnique,
  mockProcessQuoteDecision,
  mockCheckPilotGate,
  mockResolveAreaScopeByNodeId,
} = vi.hoisted(() => ({
  mockQuoteFindUnique: vi.fn(),
  mockProcessQuoteDecision: vi.fn(),
  mockCheckPilotGate: vi.fn(),
  mockResolveAreaScopeByNodeId: vi.fn(),
}))

vi.mock('@/lib/db', () => ({
  db: {
    quote: { findUnique: mockQuoteFindUnique },
  },
}))
vi.mock('@/lib/quotes', () => ({
  processQuoteDecision: mockProcessQuoteDecision,
}))
vi.mock('@/lib/route-action-errors', () => ({
  getPublicQuoteDecisionError: ({ code }: { code: string }) => ({
    status: 410,
    message: `Quote decision error: ${code}`,
  }),
}))
vi.mock('@/lib/customer-serviceability', () => ({
  checkPilotGate: mockCheckPilotGate,
  resolveAreaScopeByNodeId: mockResolveAreaScopeByNodeId,
}))

const buildRequest = (action: 'approve' | 'decline'): NextRequest =>
  new NextRequest('http://localhost/api/quotes/test-token', {
    method: 'PATCH',
    body: JSON.stringify({ action }),
    headers: { 'content-type': 'application/json' },
  })

describe('PATCH /api/quotes/[token] — pilot gate re-check', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockQuoteFindUnique.mockResolvedValue({
      id: 'quote-1',
      match: {
        jobRequest: {
          category: 'electrical',
          address: { locationNodeId: 'node-1' },
        },
      },
    })
    mockResolveAreaScopeByNodeId.mockResolvedValue({
      node: {
        id: 'node-1',
        slug: 'gauteng__johannesburg__jhb_west__honeydew',
        label: 'Honeydew',
        nodeType: 'SUBURB',
        provinceKey: 'gauteng',
        cityKey: 'johannesburg',
        regionKey: 'jhb_west',
      },
    })
    mockProcessQuoteDecision.mockResolvedValue({
      action: 'approved',
      quoteId: 'quote-1',
      bookingId: 'booking-1',
      provider: { id: 'p1', phone: '+27821110001', name: 'P' },
      customer: { phone: '+27821110002', name: 'C' },
      category: 'plumbing',
      scheduledDate: new Date('2026-07-01T08:00:00.000Z'),
    })
  })

  it('rejects approve with 409 pilot.category_no_longer_supported when category falls outside pilot', async () => {
    mockCheckPilotGate.mockResolvedValue({
      ok: false,
      code: 'pilot.category_not_supported',
    })

    const { PATCH } = await import('@/app/api/quotes/[token]/route')
    const res = await PATCH(buildRequest('approve'), {
      params: Promise.resolve({ token: 'test-token' }),
    })
    const body = await res.json()

    expect(res.status).toBe(409)
    expect(body.error?.code).toBe('pilot.category_no_longer_supported')
    expect(body.error?.reference_id).toMatch(/^PAP-\d{8}-[A-Z0-9]{6}$/)
    expect(mockProcessQuoteDecision).not.toHaveBeenCalled()
  })

  it('proceeds to approve when checkPilotGate accepts', async () => {
    mockCheckPilotGate.mockResolvedValue({ ok: true })

    const { PATCH } = await import('@/app/api/quotes/[token]/route')
    const res = await PATCH(buildRequest('approve'), {
      params: Promise.resolve({ token: 'test-token' }),
    })

    expect(res.status).toBe(200)
    expect(mockProcessQuoteDecision).toHaveBeenCalled()
  })

  it('does not run the gate on decline action', async () => {
    mockProcessQuoteDecision.mockResolvedValue({
      action: 'declined',
      quoteId: 'quote-1',
      provider: { id: 'p1', phone: '+27821110001', name: 'P' },
      customer: { phone: '+27821110002', name: 'C' },
      category: 'plumbing',
      feedback: null,
    })

    const { PATCH } = await import('@/app/api/quotes/[token]/route')
    const res = await PATCH(buildRequest('decline'), {
      params: Promise.resolve({ token: 'test-token' }),
    })

    expect(res.status).toBe(200)
    expect(mockCheckPilotGate).not.toHaveBeenCalled()
  })
})
