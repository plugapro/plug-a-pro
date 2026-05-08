import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const {
  mockGetSession,
  mockResolveCustomerForSession,
  mockSelectCustomerRequestMatchingMode,
} = vi.hoisted(() => ({
  mockGetSession: vi.fn(),
  mockResolveCustomerForSession: vi.fn(),
  mockSelectCustomerRequestMatchingMode: vi.fn(),
}))

vi.mock('@/lib/auth', () => ({ getSession: mockGetSession }))
vi.mock('@/lib/customer-session', () => ({ resolveCustomerForSession: mockResolveCustomerForSession }))
vi.mock('@/lib/db', () => ({ db: {} }))
vi.mock('@/lib/request-matching-mode', () => ({
  RequestMatchingModeError: class RequestMatchingModeError extends Error {
    constructor(public readonly code: string, message: string) {
      super(message)
      this.name = 'RequestMatchingModeError'
    }
  },
  selectCustomerRequestMatchingMode: mockSelectCustomerRequestMatchingMode,
}))

describe('POST /api/customer/requests/[id]/matching-mode', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetSession.mockResolvedValue({ id: 'user-1', role: 'customer', phone: '+27821234567' })
    mockResolveCustomerForSession.mockResolvedValue({ id: 'cust-1' })
    mockSelectCustomerRequestMatchingMode.mockResolvedValue({
      requestId: 'req-1',
      mode: 'quick_match',
      status: 'matching_started',
    })
  })

  it('returns 401 when session is missing', async () => {
    mockGetSession.mockResolvedValue(null)
    const { POST } = await import('@/app/api/customer/requests/[id]/matching-mode/route')
    const response = await POST(
      new NextRequest('http://localhost/api/customer/requests/req-1/matching-mode', {
        method: 'POST',
        body: JSON.stringify({ mode: 'quick_match' }),
      }),
      { params: Promise.resolve({ id: 'req-1' }) },
    )
    expect(response.status).toBe(401)
  })

  it('starts quick match for an owned request', async () => {
    const { POST } = await import('@/app/api/customer/requests/[id]/matching-mode/route')
    const response = await POST(
      new NextRequest('http://localhost/api/customer/requests/req-1/matching-mode', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ mode: 'quick_match' }),
      }),
      { params: Promise.resolve({ id: 'req-1' }) },
    )
    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      requestId: 'req-1',
      mode: 'quick_match',
      status: 'matching_started',
    })
    expect(mockSelectCustomerRequestMatchingMode).toHaveBeenCalledWith({
      requestId: 'req-1',
      customerId: 'cust-1',
      mode: 'quick_match',
    })
  })
})
