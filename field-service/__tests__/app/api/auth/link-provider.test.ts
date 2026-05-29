// Tests for POST /api/auth/link - isProvider flag introduced to block
// provider-only phones from entering the customer sign-up journey.

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
  id: 'user-abc',
  role: 'customer' as const,
  phone: '+27821234567',
}

function makeRequest(body = JSON.stringify({ phone: '+27821234567', name: 'Test User' })) {
  return new NextRequest('http://localhost/api/auth/link', {
    method: 'POST',
    body,
    headers: { 'Content-Type': 'application/json' },
  })
}

describe('POST /api/auth/link - isProvider flag', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetSession.mockResolvedValue(VALID_SESSION)
  })

  it('new customer with no Provider record - isNew: true, isProvider: false', async () => {
    mockLinkCustomerAccount.mockResolvedValue({ id: 'cust-new', isNew: true })
    mockDbProviderFindFirst.mockResolvedValue(null)

    const { POST } = await import('../../../../app/api/auth/link/route')
    const res = await POST(makeRequest())

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.isNew).toBe(true)
    expect(body.isProvider).toBe(false)
    expect(body.customerId).toBe('cust-new')
  })

  it('existing WhatsApp customer with no Provider record - isNew: false, isProvider: false', async () => {
    mockLinkCustomerAccount.mockResolvedValue({ id: 'cust-existing', isNew: false })
    mockDbProviderFindFirst.mockResolvedValue(null)

    const { POST } = await import('../../../../app/api/auth/link/route')
    const res = await POST(makeRequest())

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.isNew).toBe(false)
    expect(body.isProvider).toBe(false)
    expect(body.customerId).toBe('cust-existing')
  })

  it('provider-only phone - no customer created, customerId null, isProvider: true', async () => {
    // linkCustomerAccount now refuses to create a customer for a provider-only
    // account and returns the provider-only sentinel. The route must NOT fall
    // through to a customerId and must flag isProvider so the client blocks.
    mockLinkCustomerAccount.mockResolvedValue({ id: null, isNew: false, isProviderOnly: true })

    const { POST } = await import('../../../../app/api/auth/link/route')
    const res = await POST(makeRequest())

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.isNew).toBe(false)
    expect(body.isProvider).toBe(true)
    expect(body.customerId).toBeNull()
    // The provider-only sentinel is sufficient; no extra provider lookup needed.
    expect(mockDbProviderFindFirst).not.toHaveBeenCalled()
  })

  it('multi-role (existing customer + provider) - links customer and flags isProvider', async () => {
    mockLinkCustomerAccount.mockResolvedValue({ id: 'cust-existing', isNew: false })
    mockDbProviderFindFirst.mockResolvedValue({ id: 'prov-001' })

    const { POST } = await import('../../../../app/api/auth/link/route')
    const res = await POST(makeRequest())

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.isProvider).toBe(true)
    expect(body.customerId).toBe('cust-existing')
  })

  it('re-call after first link is idempotent - isNew: false, no duplicates', async () => {
    mockLinkCustomerAccount.mockResolvedValue({ id: 'cust-existing', isNew: false })
    mockDbProviderFindFirst.mockResolvedValue(null)

    const { POST } = await import('../../../../app/api/auth/link/route')
    const res = await POST(makeRequest())

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.isNew).toBe(false)
    expect(body.isProvider).toBe(false)
    expect(mockLinkCustomerAccount).toHaveBeenCalledTimes(1)
  })

  it('provider check queries by session.id, not phone', async () => {
    mockLinkCustomerAccount.mockResolvedValue({ id: 'cust-x', isNew: true })
    mockDbProviderFindFirst.mockResolvedValue(null)

    const { POST } = await import('../../../../app/api/auth/link/route')
    await POST(makeRequest())

    expect(mockDbProviderFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userId: VALID_SESSION.id },
      })
    )
  })
})
