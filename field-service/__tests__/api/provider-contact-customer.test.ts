import { describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const { mockBuildAcceptedLeadContactUrl } = vi.hoisted(() => ({
  mockBuildAcceptedLeadContactUrl: vi.fn(),
}))

vi.mock('@/lib/post-match-communications', () => ({
  buildAcceptedLeadContactUrl: mockBuildAcceptedLeadContactUrl,
}))

describe('GET /api/provider/leads/[leadId]/contact-customer', () => {
  it('returns trace ID when signed contact handoff is denied', async () => {
    mockBuildAcceptedLeadContactUrl.mockResolvedValueOnce(null)
    const { GET } = await import('@/app/api/provider/leads/[leadId]/contact-customer/route')

    const response = await GET(
      new NextRequest('http://localhost/api/provider/leads/lead-1/contact-customer?leadToken=bad-token'),
      { params: Promise.resolve({ leadId: 'lead-1' }) },
    )
    const body = await response.json()

    expect(response.status).toBe(403)
    expect(response.headers.get('X-Trace-Id')).toBeTruthy()
    expect(body).toEqual(expect.objectContaining({
      error: 'Lead contact is not available',
      traceId: expect.any(String),
    }))
  })
})
