import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

// ─── Mocks ────────────────────────────────────────────────────────────────────

vi.mock('@supabase/supabase-js', () => ({
  createClient: vi.fn(),
}))

vi.mock('../../lib/auth', () => ({
  getSession: vi.fn(),
  linkCustomerAccount: vi.fn(),
}))

// ─── /api/auth/session ────────────────────────────────────────────────────────

describe('POST /api/auth/session', () => {
  beforeEach(() => vi.clearAllMocks())

  it('rejects missing accessToken', async () => {
    const { POST } = await import('../../app/api/auth/session/route')
    const req = new NextRequest('http://localhost/api/auth/session', {
      method: 'POST',
      body: JSON.stringify({}),
      headers: { 'Content-Type': 'application/json' },
    })

    const res = await POST(req)
    expect(res.status).toBe(400)
  })

  it('rejects when Supabase returns an error (invalid token)', async () => {
    const { createClient } = await import('@supabase/supabase-js')
    ;(createClient as any).mockReturnValue({
      auth: {
        getUser: vi.fn().mockResolvedValue({ data: { user: null }, error: new Error('bad token') }),
      },
    })

    const { POST } = await import('../../app/api/auth/session/route')
    const req = new NextRequest('http://localhost/api/auth/session', {
      method: 'POST',
      body: JSON.stringify({ accessToken: 'bad-token' }),
      headers: { 'Content-Type': 'application/json' },
    })

    const res = await POST(req)
    expect(res.status).toBe(401)
  })

  it('sets HttpOnly cookie and returns userId on valid token', async () => {
    const { createClient } = await import('@supabase/supabase-js')
    ;(createClient as any).mockReturnValue({
      auth: {
        getUser: vi.fn().mockResolvedValue({
          data: { user: { id: 'user-123' } },
          error: null,
        }),
      },
    })

    const { POST } = await import('../../app/api/auth/session/route')
    const req = new NextRequest('http://localhost/api/auth/session', {
      method: 'POST',
      body: JSON.stringify({ accessToken: 'valid-token', expiresIn: 7200 }),
      headers: { 'Content-Type': 'application/json' },
    })

    const res = await POST(req)
    expect(res.status).toBe(200)

    const body = await res.json()
    expect(body.userId).toBe('user-123')

    const setCookie = res.headers.get('Set-Cookie') ?? ''
    expect(setCookie).toContain('HttpOnly')
    expect(setCookie).toContain('sb-access-token=valid-token')
    // HttpOnly presence is already asserted above — no further check needed
  })
})

describe('DELETE /api/auth/session', () => {
  it('clears the session cookie', async () => {
    const { DELETE } = await import('../../app/api/auth/session/route')
    const res = await DELETE()

    expect(res.status).toBe(200)
    const setCookie = res.headers.get('Set-Cookie') ?? ''
    expect(setCookie).toContain('sb-access-token=')
    expect(setCookie).toContain('Max-Age=0')
    expect(setCookie).toContain('HttpOnly')
  })
})

// ─── /api/auth/link ───────────────────────────────────────────────────────────

describe('POST /api/auth/link', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns 401 when no session cookie present', async () => {
    const { getSession } = await import('../../lib/auth')
    ;(getSession as any).mockResolvedValue(null)

    const { POST } = await import('../../app/api/auth/link/route')
    const req = new NextRequest('http://localhost/api/auth/link', {
      method: 'POST',
      body: JSON.stringify({ phone: '+27821234567' }),
      headers: { 'Content-Type': 'application/json' },
    })

    const res = await POST(req)
    expect(res.status).toBe(401)
  })

  it('rejects invalid phone format', async () => {
    const { getSession } = await import('../../lib/auth')
    ;(getSession as any).mockResolvedValue({ id: 'user-123', role: 'customer' })

    const { POST } = await import('../../app/api/auth/link/route')
    const req = new NextRequest('http://localhost/api/auth/link', {
      method: 'POST',
      body: JSON.stringify({ phone: 'not-a-phone' }),
      headers: { 'Content-Type': 'application/json' },
    })

    const res = await POST(req)
    expect(res.status).toBe(400)
  })

  it('uses session userId, not any client-supplied userId', async () => {
    const { getSession, linkCustomerAccount } = await import('../../lib/auth')
    ;(getSession as any).mockResolvedValue({ id: 'server-user-id', role: 'customer' })
    ;(linkCustomerAccount as any).mockResolvedValue({ id: 'cust-001', isNew: false })

    const { POST } = await import('../../app/api/auth/link/route')
    const req = new NextRequest('http://localhost/api/auth/link', {
      method: 'POST',
      // Attacker supplies a different userId — must be ignored
      body: JSON.stringify({ phone: '+27821234567', userId: 'attacker-user-id' }),
      headers: { 'Content-Type': 'application/json' },
    })

    const res = await POST(req)
    expect(res.status).toBe(200)

    expect(linkCustomerAccount).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'server-user-id' }),
    )
  })

  it('returns customerId on success', async () => {
    const { getSession, linkCustomerAccount } = await import('../../lib/auth')
    ;(getSession as any).mockResolvedValue({ id: 'user-123', role: 'customer' })
    ;(linkCustomerAccount as any).mockResolvedValue({ id: 'cust-001', isNew: true })

    const { POST } = await import('../../app/api/auth/link/route')
    const req = new NextRequest('http://localhost/api/auth/link', {
      method: 'POST',
      body: JSON.stringify({ phone: '+27821234567' }),
      headers: { 'Content-Type': 'application/json' },
    })

    const res = await POST(req)
    expect(res.status).toBe(200)

    const body = await res.json()
    expect(body.customerId).toBe('cust-001')
    expect(body.isNew).toBe(true)
  })
})
