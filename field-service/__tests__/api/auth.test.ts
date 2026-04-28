import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

// ─── Mocks ────────────────────────────────────────────────────────────────────

vi.mock('@supabase/supabase-js', () => ({
  createClient: vi.fn(),
}))

vi.mock('@/lib/db', () => ({
  db: {
    adminUser: {
      findFirst: vi.fn(),
      update: vi.fn(),
    },
    customer: {
      findUnique: vi.fn(),
    },
    provider: {
      findUnique: vi.fn(),
    },
  },
}))

vi.mock('../../lib/auth', () => ({
  getSession: vi.fn(),
  linkCustomerAccount: vi.fn(),
}))

// ─── /api/auth/session ────────────────────────────────────────────────────────

describe('POST /api/auth/session', () => {
  beforeEach(async () => {
    vi.clearAllMocks()

    const { db } = await import('@/lib/db')
    ;(db.adminUser.findFirst as any).mockResolvedValue(null)
    ;(db.adminUser.update as any).mockResolvedValue(null)
  })

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

  it('sets HttpOnly cookie and returns userId without admin access by default', async () => {
    const { createClient } = await import('@supabase/supabase-js')
    ;(createClient as any).mockReturnValue({
      auth: {
        getUser: vi.fn().mockResolvedValue({
          data: { user: { id: 'user-123', user_metadata: { role: 'admin' } } },
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
    expect(body.adminAccess).toBe(false)
    expect(body.adminRole).toBeNull()

    const setCookie = res.headers.get('Set-Cookie') ?? ''
    expect(setCookie).toContain('HttpOnly')
    expect(setCookie).toContain('sb-access-token=valid-token')
    // HttpOnly presence is already asserted above — no further check needed
  })

  it('clamps client-provided cookie max-age to a safe server-side ceiling', async () => {
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
      body: JSON.stringify({ accessToken: 'valid-token', expiresIn: 60 * 60 * 24 * 30 }),
      headers: { 'Content-Type': 'application/json' },
    })

    const res = await POST(req)
    expect(res.status).toBe(200)

    const setCookie = res.headers.get('Set-Cookie') ?? ''
    expect(setCookie).toContain('Max-Age=86400')
  })

  it('claims a pending AdminUser invite by email and returns DB-backed admin access', async () => {
    const { createClient } = await import('@supabase/supabase-js')
    const { db } = await import('@/lib/db')

    ;(createClient as any).mockReturnValue({
      auth: {
        getUser: vi.fn().mockResolvedValue({
          data: {
            user: {
              id: 'user-ops-1',
              email: 'ops@plugapro.co.za',
              user_metadata: { role: 'customer' },
            },
          },
          error: null,
        }),
      },
    })
    ;(db.adminUser.findFirst as any).mockResolvedValue({
      id: 'admin-ops-1',
      userId: 'pending:ops@plugapro.co.za',
      email: 'ops@plugapro.co.za',
      role: 'OPS',
      active: true,
      acceptedAt: null,
    })

    const { POST } = await import('../../app/api/auth/session/route')
    const req = new NextRequest('http://localhost/api/auth/session', {
      method: 'POST',
      body: JSON.stringify({ accessToken: 'valid-token' }),
      headers: { 'Content-Type': 'application/json' },
    })

    const res = await POST(req)
    expect(res.status).toBe(200)

    const body = await res.json()
    expect(body.adminAccess).toBe(true)
    expect(body.adminRole).toBe('ops')
    expect(db.adminUser.update).toHaveBeenCalledWith({
      where: { id: 'admin-ops-1' },
      data: {
        userId: 'user-ops-1',
        acceptedAt: expect.any(Date),
      },
    })
  })

  it('grants admin access from legacy metadata when no AdminUser row exists (backfill fallback)', async () => {
    // The session route intentionally honours Supabase user_metadata.role for accounts
    // that predate the AdminUser table (commits 9e08128 / c215e8e restored this fallback).
    // Run scripts/backfill-admin-users.ts to migrate these accounts to the DB table.
    const { createClient } = await import('@supabase/supabase-js')
    const { db } = await import('@/lib/db')

    ;(createClient as any).mockReturnValue({
      auth: {
        getUser: vi.fn().mockResolvedValue({
          data: {
            user: {
              id: 'legacy-admin-1',
              email: 'legacy-admin@plugapro.co.za',
              user_metadata: { role: 'owner' },
            },
          },
          error: null,
        }),
      },
    })
    ;(db.adminUser.findFirst as any).mockResolvedValue(null)

    const { POST } = await import('../../app/api/auth/session/route')
    const req = new NextRequest('http://localhost/api/auth/session', {
      method: 'POST',
      body: JSON.stringify({ accessToken: 'valid-token' }),
      headers: { 'Content-Type': 'application/json' },
    })

    const res = await POST(req)
    expect(res.status).toBe(200)

    const body = await res.json()
    // Legacy fallback is active — metadata role is honoured until backfill runs
    expect(body.adminAccess).toBe(true)
    expect(body.adminRole).toBe('owner')
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

// ─── /api/auth/phone-exists ───────────────────────────────────────────────────

describe('POST /api/auth/phone-exists', () => {
  beforeEach(async () => {
    vi.clearAllMocks()

    const { db } = await import('@/lib/db')
    ;(db.customer.findUnique as any).mockResolvedValue(null)
    ;(db.provider.findUnique as any).mockResolvedValue(null)
  })

  it('returns exists=true when a customer phone exists', async () => {
    const { db } = await import('@/lib/db')
    ;(db.customer.findUnique as any).mockResolvedValue({ id: 'cust-1' })

    const { POST } = await import('../../app/api/auth/phone-exists/route')
    const req = new NextRequest('http://localhost/api/auth/phone-exists', {
      method: 'POST',
      body: JSON.stringify({ phone: '0821234567', role: 'customer' }),
      headers: { 'Content-Type': 'application/json' },
    })

    const res = await POST(req)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ exists: true })
    expect(db.customer.findUnique).toHaveBeenCalledWith({
      where: { phone: '+27821234567' },
      select: { id: true },
    })
  })

  it('returns exists=false when a customer phone is unknown', async () => {
    const { POST } = await import('../../app/api/auth/phone-exists/route')
    const req = new NextRequest('http://localhost/api/auth/phone-exists', {
      method: 'POST',
      body: JSON.stringify({ phone: '+27821234567', role: 'customer' }),
      headers: { 'Content-Type': 'application/json' },
    })

    const res = await POST(req)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ exists: false })
  })

  it('returns exists=true only for active providers', async () => {
    const { db } = await import('@/lib/db')
    ;(db.provider.findUnique as any).mockResolvedValue({ id: 'prov-1', active: true })

    const { POST } = await import('../../app/api/auth/phone-exists/route')
    const req = new NextRequest('http://localhost/api/auth/phone-exists', {
      method: 'POST',
      body: JSON.stringify({ phone: '27821234567', role: 'provider' }),
      headers: { 'Content-Type': 'application/json' },
    })

    const res = await POST(req)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ exists: true })
    expect(db.provider.findUnique).toHaveBeenCalledWith({
      where: { phone: '+27821234567' },
      select: { id: true, active: true },
    })
  })

  it('returns exists=false for inactive providers', async () => {
    const { db } = await import('@/lib/db')
    ;(db.provider.findUnique as any).mockResolvedValue({ id: 'prov-1', active: false })

    const { POST } = await import('../../app/api/auth/phone-exists/route')
    const req = new NextRequest('http://localhost/api/auth/phone-exists', {
      method: 'POST',
      body: JSON.stringify({ phone: '+27821234567', role: 'provider' }),
      headers: { 'Content-Type': 'application/json' },
    })

    const res = await POST(req)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ exists: false })
  })

  it('rejects invalid lookup requests', async () => {
    const { POST } = await import('../../app/api/auth/phone-exists/route')
    const req = new NextRequest('http://localhost/api/auth/phone-exists', {
      method: 'POST',
      body: JSON.stringify({ phone: 'abc', role: 'customer' }),
      headers: { 'Content-Type': 'application/json' },
    })

    const res = await POST(req)
    expect(res.status).toBe(400)
  })
})

// ─── /api/auth/provider/send-code ─────────────────────────────────────────────

describe('POST /api/auth/provider/send-code', () => {
  beforeEach(async () => {
    vi.clearAllMocks()
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://supabase.test'
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'anon-key'

    const { db } = await import('@/lib/db')
    ;(db.provider.findUnique as any).mockResolvedValue(null)

    const { createClient } = await import('@supabase/supabase-js')
    ;(createClient as any).mockReturnValue({
      auth: {
        signInWithOtp: vi.fn().mockResolvedValue({ error: null }),
      },
    })
  })

  it.each([
    ['0823035070', '+27823035070'],
    ['27823035070', '+27823035070'],
    ['+27823035070', '+27823035070'],
  ])('normalizes %s and sends a provider login code', async (input, normalized) => {
    const { db } = await import('@/lib/db')
    const { createClient } = await import('@supabase/supabase-js')
    const signInWithOtp = vi.fn().mockResolvedValue({ error: null })
    ;(db.provider.findUnique as any).mockResolvedValue({ id: 'prov-1', active: true })
    ;(createClient as any).mockReturnValue({ auth: { signInWithOtp } })

    const { POST } = await import('../../app/api/auth/provider/send-code/route')
    const req = new NextRequest('http://localhost/api/auth/provider/send-code', {
      method: 'POST',
      body: JSON.stringify({ phone: input }),
      headers: { 'Content-Type': 'application/json' },
    })

    const res = await POST(req)
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ ok: true, phone: normalized })
    expect(db.provider.findUnique).toHaveBeenCalledWith({
      where: { phone: normalized },
      select: { id: true, active: true },
    })
    expect(signInWithOtp).toHaveBeenCalledWith({ phone: normalized })
  })

  it('returns PROVIDER_NOT_FOUND with a trace ID for unknown provider phones', async () => {
    const { POST } = await import('../../app/api/auth/provider/send-code/route')
    const req = new NextRequest('http://localhost/api/auth/provider/send-code', {
      method: 'POST',
      body: JSON.stringify({ phone: '0823035070' }),
      headers: { 'Content-Type': 'application/json' },
    })

    const res = await POST(req)
    const body = await res.json()

    expect(res.status).toBe(404)
    expect(body.error).toMatchObject({
      code: 'PROVIDER_NOT_FOUND',
      step: 'Worker portal send-code',
      phoneMasked: '082****070',
    })
    expect(body.error.traceId).toMatch(/^auth_/)
  })

  it('returns OTP_DELIVERY_FAILED when Supabase OTP delivery fails', async () => {
    const { db } = await import('@/lib/db')
    const { createClient } = await import('@supabase/supabase-js')
    ;(db.provider.findUnique as any).mockResolvedValue({ id: 'prov-1', active: true })
    ;(createClient as any).mockReturnValue({
      auth: {
        signInWithOtp: vi.fn().mockResolvedValue({ error: new Error('gateway rejected message') }),
      },
    })

    const { POST } = await import('../../app/api/auth/provider/send-code/route')
    const req = new NextRequest('http://localhost/api/auth/provider/send-code', {
      method: 'POST',
      body: JSON.stringify({ phone: '+27823035070' }),
      headers: { 'Content-Type': 'application/json' },
    })

    const res = await POST(req)
    const body = await res.json()

    expect(res.status).toBe(502)
    expect(body.error).toMatchObject({
      code: 'OTP_DELIVERY_FAILED',
      providerId: 'prov-1',
      step: 'Worker portal send-code',
    })
    expect(body.error.traceId).toMatch(/^auth_/)
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
    ;(getSession as any).mockResolvedValue({ id: 'user-123', role: 'customer', phone: '+27821234567' })

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
    ;(getSession as any).mockResolvedValue({
      id: 'server-user-id',
      role: 'customer',
      phone: '+27821234567',
    })
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

  it('rejects when the submitted phone does not match the verified session phone', async () => {
    const { getSession } = await import('../../lib/auth')
    ;(getSession as any).mockResolvedValue({
      id: 'server-user-id',
      role: 'customer',
      phone: '+27820000000',
    })

    const { POST } = await import('../../app/api/auth/link/route')
    const req = new NextRequest('http://localhost/api/auth/link', {
      method: 'POST',
      body: JSON.stringify({ phone: '+27821234567' }),
      headers: { 'Content-Type': 'application/json' },
    })

    const res = await POST(req)
    expect(res.status).toBe(403)
  })

  it('returns customerId on success', async () => {
    const { getSession, linkCustomerAccount } = await import('../../lib/auth')
    ;(getSession as any).mockResolvedValue({
      id: 'user-123',
      role: 'customer',
      phone: '+27821234567',
    })
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
