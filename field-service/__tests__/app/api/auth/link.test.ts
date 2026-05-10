// Tests for POST /api/auth/link — name forwarding behaviour added in WP2.
// The broader link route test suite lives in __tests__/api/auth.test.ts.
// These tests focus specifically on the optional `name` field introduced to
// support the sign-up flow.

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

const { mockGetSession, mockLinkCustomerAccount, mockDbProviderFindFirst } = vi.hoisted(() => ({
  mockGetSession: vi.fn(),
  mockLinkCustomerAccount: vi.fn(),
  mockDbProviderFindFirst: vi.fn(),
}))

vi.mock('@/lib/auth', () => ({
  getSession: mockGetSession,
  linkCustomerAccount: mockLinkCustomerAccount,
}))

vi.mock('@/lib/db', () => ({
  db: {
    provider: {
      findFirst: mockDbProviderFindFirst,
    },
  },
}))

const VALID_SESSION = {
  id: 'user-123',
  role: 'customer',
  phone: '+27821234567',
}

describe('POST /api/auth/link — name forwarding', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetSession.mockResolvedValue(VALID_SESSION)
    mockLinkCustomerAccount.mockResolvedValue({ id: 'cust-001', isNew: false })
  })

  it('forwards name to linkCustomerAccount when provided', async () => {
    const { POST } = await import('../../../../app/api/auth/link/route')
    const req = new NextRequest('http://localhost/api/auth/link', {
      method: 'POST',
      body: JSON.stringify({ phone: '+27821234567', name: 'Jane Doe' }),
      headers: { 'Content-Type': 'application/json' },
    })

    const res = await POST(req)
    expect(res.status).toBe(200)

    expect(mockLinkCustomerAccount).toHaveBeenCalledWith({
      userId: 'user-123',
      phone: '+27821234567',
      name: 'Jane Doe',
    })
  })

  it('omits name from linkCustomerAccount call when not provided (backward compatible)', async () => {
    const { POST } = await import('../../../../app/api/auth/link/route')
    const req = new NextRequest('http://localhost/api/auth/link', {
      method: 'POST',
      body: JSON.stringify({ phone: '+27821234567' }),
      headers: { 'Content-Type': 'application/json' },
    })

    const res = await POST(req)
    expect(res.status).toBe(200)

    // name should be undefined, not a string — linkCustomerAccount ignores undefined
    expect(mockLinkCustomerAccount).toHaveBeenCalledWith({
      userId: 'user-123',
      phone: '+27821234567',
      name: undefined,
    })
  })

  it('rejects name longer than 120 characters with 400', async () => {
    const { POST } = await import('../../../../app/api/auth/link/route')
    const req = new NextRequest('http://localhost/api/auth/link', {
      method: 'POST',
      body: JSON.stringify({ phone: '+27821234567', name: 'a'.repeat(121) }),
      headers: { 'Content-Type': 'application/json' },
    })

    const res = await POST(req)
    expect(res.status).toBe(400)
    expect(mockLinkCustomerAccount).not.toHaveBeenCalled()
  })

  it('still returns isNew in the response body', async () => {
    mockLinkCustomerAccount.mockResolvedValue({ id: 'cust-002', isNew: true })

    const { POST } = await import('../../../../app/api/auth/link/route')
    const req = new NextRequest('http://localhost/api/auth/link', {
      method: 'POST',
      body: JSON.stringify({ phone: '+27821234567', name: 'New User' }),
      headers: { 'Content-Type': 'application/json' },
    })

    const res = await POST(req)
    expect(res.status).toBe(200)

    const body = await res.json()
    expect(body.isNew).toBe(true)
    expect(body.customerId).toBe('cust-002')
  })
})
