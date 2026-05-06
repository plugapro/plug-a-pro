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
      findFirst: vi.fn(),
      findMany: vi.fn(),
      update: vi.fn(),
    },
    providerApplication: {
      findFirst: vi.fn(),
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

  it('denies admin access when no AdminUser row exists', async () => {
    // Admin access is now DB-only; metadata-only roles are rejected.
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
    expect(body.adminAccess).toBe(false)
    expect(body.adminRole).toBeNull()
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
    ;(db.provider.findFirst as any).mockResolvedValue(null)
    ;(db.providerApplication.findFirst as any).mockResolvedValue(null)

    const { createClient } = await import('@supabase/supabase-js')
    ;(createClient as any).mockReturnValue({
      auth: {
        signInWithOtp: vi.fn().mockResolvedValue({ error: null }),
      },
    })
  })

  it.each([
    ['0821234567', '+27821234567'],
    ['082 123 4567', '+27821234567'],
    ['82 123 4567', '+27821234567'],
    ['27821234567', '+27821234567'],
    ['+27821234567', '+27821234567'],
  ])('normalizes %s and sends a provider login code', async (input, normalized) => {
    const { db } = await import('@/lib/db')
    const { createClient } = await import('@supabase/supabase-js')
    const signInWithOtp = vi.fn().mockResolvedValue({ error: null })
    ;(db.provider.findUnique as any).mockResolvedValue({ id: 'prov-1', active: true, verified: true, status: 'ACTIVE' })
    ;(createClient as any).mockReturnValue({ auth: { signInWithOtp } })

    const { POST } = await import('../../app/api/auth/provider/send-code/route')
    const req = new NextRequest('http://localhost/api/auth/provider/send-code', {
      method: 'POST',
      body: JSON.stringify({ phone: input }),
      headers: { 'Content-Type': 'application/json' },
    })

    const res = await POST(req)
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ ok: true, nextStep: 'verify_otp', phone: normalized })
    expect(db.provider.findUnique).toHaveBeenCalledWith({
      where: { phone: normalized },
      select: { id: true, userId: true, phone: true, active: true, verified: true, status: true },
    })
    expect(signInWithOtp).toHaveBeenCalledWith({ phone: normalized })
  })

  it('returns INVALID_MOBILE_NUMBER before provider lookup for malformed numbers', async () => {
    const { db } = await import('@/lib/db')
    const { createClient } = await import('@supabase/supabase-js')

    const { POST } = await import('../../app/api/auth/provider/send-code/route')
    const req = new NextRequest('http://localhost/api/auth/provider/send-code', {
      method: 'POST',
      body: JSON.stringify({ phone: '12345', traceId: 'client_invalid_1' }),
      headers: { 'Content-Type': 'application/json' },
    })

    const res = await POST(req)
    const body = await res.json()

    expect(res.status).toBe(422)
    expect(body).toMatchObject({
      ok: false,
      code: 'INVALID_MOBILE_NUMBER',
      message: 'Enter a valid South African mobile number.',
      traceId: 'client_invalid_1',
    })
    expect(body.error).toMatchObject({
      code: 'INVALID_MOBILE_NUMBER',
      title: 'Check the mobile number.',
      step: 'Worker portal send-code',
    })
    expect(db.provider.findUnique).not.toHaveBeenCalled()
    expect(createClient).not.toHaveBeenCalled()
  })

  it('returns UNSUPPORTED_COUNTRY_CODE for non-SA OTP countries', async () => {
    const { db } = await import('@/lib/db')
    const { createClient } = await import('@supabase/supabase-js')

    const { POST } = await import('../../app/api/auth/provider/send-code/route')
    const req = new NextRequest('http://localhost/api/auth/provider/send-code', {
      method: 'POST',
      body: JSON.stringify({ phone: '+447700900123', countryCode: 'GB', traceId: 'client_gb_1' }),
      headers: { 'Content-Type': 'application/json' },
    })

    const res = await POST(req)
    const body = await res.json()

    expect(res.status).toBe(400)
    expect(body.error).toMatchObject({
      code: 'UNSUPPORTED_COUNTRY_CODE',
      traceId: 'client_gb_1',
      countryCode: 'GB',
    })
    expect(db.provider.findUnique).not.toHaveBeenCalled()
    expect(createClient).not.toHaveBeenCalled()
  })

  it('returns WORKER_NOT_FOUND with a trace ID for unknown provider phones', async () => {
    const { POST } = await import('../../app/api/auth/provider/send-code/route')
    const req = new NextRequest('http://localhost/api/auth/provider/send-code', {
      method: 'POST',
      body: JSON.stringify({ phone: '0821234567' }),
      headers: { 'Content-Type': 'application/json' },
    })

    const res = await POST(req)
    const body = await res.json()

    expect(res.status).toBe(404)
    expect(body).toMatchObject({
      ok: false,
      code: 'WORKER_NOT_FOUND',
      message: "We couldn't find a provider account for this number. If you're trying to view your customer bookings, sign in as a customer instead.",
    })
    expect(body.error).toMatchObject({
      code: 'WORKER_NOT_FOUND',
      title: 'Provider account not found.',
      step: 'Worker portal send-code',
      mobileChecked: '+27821234567',
      phoneMasked: '082****567',
    })
    expect(body.error.traceId).toMatch(/^auth_/)
  })

  it.each([
    ['27821234567', '+27821234567', 'without-plus prefix'],
    ['0821234567', '+27821234567', 'local SA format'],
  ])('finds provider stored as %s via variant fallback and repairs phone', async (storedPhone, e164, _label) => {
    const { db } = await import('@/lib/db')
    const { createClient } = await import('@supabase/supabase-js')
    const signInWithOtp = vi.fn().mockResolvedValue({ error: null })
    ;(db.provider.findUnique as any).mockResolvedValue(null)
    ;(db.provider.findFirst as any).mockResolvedValue({
      id: 'prov-1',
      userId: null,
      phone: storedPhone,
      active: true,
      verified: true,
      status: 'ACTIVE',
    })
    ;(db.provider.update as any).mockResolvedValue({})
    ;(createClient as any).mockReturnValue({ auth: { signInWithOtp } })

    const { POST } = await import('../../app/api/auth/provider/send-code/route')
    const req = new NextRequest('http://localhost/api/auth/provider/send-code', {
      method: 'POST',
      body: JSON.stringify({ phone: '0821234567' }),
      headers: { 'Content-Type': 'application/json' },
    })

    const res = await POST(req)
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ ok: true, phone: '+27821234567' })
    expect(signInWithOtp).toHaveBeenCalledWith({ phone: '+27821234567' })
    if (storedPhone !== e164) {
      expect(db.provider.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: { phone: '+27821234567' } }),
      )
    }
  })

  it('returns WORKER_NOT_APPROVED when no Provider row but a pending ProviderApplication exists', async () => {
    const { db } = await import('@/lib/db')
    ;(db.provider.findUnique as any).mockResolvedValue(null)
    ;(db.provider.findFirst as any).mockResolvedValue(null)
    ;(db.providerApplication.findFirst as any).mockResolvedValue({
      id: 'app-001',
      status: 'PENDING',
      providerId: null,
    })

    const { POST } = await import('../../app/api/auth/provider/send-code/route')
    const req = new NextRequest('http://localhost/api/auth/provider/send-code', {
      method: 'POST',
      body: JSON.stringify({ phone: '0821234567' }),
      headers: { 'Content-Type': 'application/json' },
    })

    const res = await POST(req)
    const body = await res.json()

    expect(res.status).toBe(403)
    expect(body).toMatchObject({ ok: false, code: 'WORKER_NOT_APPROVED' })
    expect(body.error.title).toBe('Application still under review.')
  })

  it('returns WORKER_NOT_APPROVED for MORE_INFO_REQUIRED application', async () => {
    const { db } = await import('@/lib/db')
    ;(db.provider.findUnique as any).mockResolvedValue(null)
    ;(db.provider.findFirst as any).mockResolvedValue(null)
    ;(db.providerApplication.findFirst as any).mockResolvedValue({
      id: 'app-002',
      status: 'MORE_INFO_REQUIRED',
      providerId: null,
    })

    const { POST } = await import('../../app/api/auth/provider/send-code/route')
    const req = new NextRequest('http://localhost/api/auth/provider/send-code', {
      method: 'POST',
      body: JSON.stringify({ phone: '0821234567' }),
      headers: { 'Content-Type': 'application/json' },
    })

    const res = await POST(req)
    expect(res.status).toBe(403)
    expect(await res.json()).toMatchObject({ ok: false, code: 'WORKER_NOT_APPROVED' })
  })

  it.each([
    ['UNDER_REVIEW', 'prov-under-review'],
    ['APPLICATION_PENDING', 'prov-pending'],
  ])('returns WORKER_NOT_APPROVED for provider with status %s', async (status, id) => {
    const { db } = await import('@/lib/db')
    ;(db.provider.findUnique as any).mockResolvedValue({ id, active: true, verified: false, status })

    const { POST } = await import('../../app/api/auth/provider/send-code/route')
    const req = new NextRequest('http://localhost/api/auth/provider/send-code', {
      method: 'POST',
      body: JSON.stringify({ phone: '0821234567' }),
      headers: { 'Content-Type': 'application/json' },
    })

    const res = await POST(req)
    const body = await res.json()

    expect(res.status).toBe(403)
    expect(body).toMatchObject({
      ok: false,
      code: 'WORKER_NOT_APPROVED',
      message: 'Your provider application must be approved before you can sign in to the Worker Portal.',
    })
    expect(body.error).toMatchObject({
      code: 'WORKER_NOT_APPROVED',
      title: 'Application still under review.',
      providerId: id,
      mobileChecked: '+27821234567',
    })
  })

  it('returns WORKER_INACTIVE for suspended provider accounts', async () => {
    const { db } = await import('@/lib/db')
    ;(db.provider.findUnique as any).mockResolvedValue({
      id: 'prov-suspended',
      active: true,
      status: 'SUSPENDED',
    })

    const { POST } = await import('../../app/api/auth/provider/send-code/route')
    const req = new NextRequest('http://localhost/api/auth/provider/send-code', {
      method: 'POST',
      body: JSON.stringify({ phone: '0821234567' }),
      headers: { 'Content-Type': 'application/json' },
    })

    const res = await POST(req)
    const body = await res.json()

    expect(res.status).toBe(423)
    expect(body.error).toMatchObject({
      code: 'WORKER_INACTIVE',
      title: 'Provider account inactive.',
      providerId: 'prov-suspended',
      mobileChecked: '+27821234567',
    })
  })

  it('returns OTP_DELIVERY_FAILED when Supabase OTP delivery fails', async () => {
    const { db } = await import('@/lib/db')
    const { createClient } = await import('@supabase/supabase-js')
    ;(db.provider.findUnique as any).mockResolvedValue({ id: 'prov-1', active: true, verified: true, status: 'ACTIVE' })
    ;(createClient as any).mockReturnValue({
      auth: {
        signInWithOtp: vi.fn().mockResolvedValue({ error: new Error('gateway rejected message') }),
      },
    })

    const { POST } = await import('../../app/api/auth/provider/send-code/route')
    const req = new NextRequest('http://localhost/api/auth/provider/send-code', {
      method: 'POST',
      body: JSON.stringify({ phone: '+27821234567' }),
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

  it('returns OTP_PROVIDER_TIMEOUT when Supabase OTP delivery times out', async () => {
    const { db } = await import('@/lib/db')
    const { createClient } = await import('@supabase/supabase-js')
    ;(db.provider.findUnique as any).mockResolvedValue({ id: 'prov-1', active: true, verified: true, status: 'ACTIVE' })
    ;(createClient as any).mockReturnValue({
      auth: {
        signInWithOtp: vi.fn().mockRejectedValue(new Error('request timeout')),
      },
    })

    const { POST } = await import('../../app/api/auth/provider/send-code/route')
    const req = new NextRequest('http://localhost/api/auth/provider/send-code', {
      method: 'POST',
      body: JSON.stringify({ phone: '+27821234567' }),
      headers: { 'Content-Type': 'application/json' },
    })

    const res = await POST(req)
    const body = await res.json()

    expect(res.status).toBe(504)
    expect(body.error).toMatchObject({
      code: 'OTP_PROVIDER_TIMEOUT',
      providerId: 'prov-1',
      step: 'Worker portal send-code',
    })
  })

  it('returns RATE_LIMITED when Supabase rejects with a rate limit error', async () => {
    const { db } = await import('@/lib/db')
    const { createClient } = await import('@supabase/supabase-js')
    ;(db.provider.findUnique as any).mockResolvedValue({ id: 'prov-1', active: true, verified: true, status: 'ACTIVE' })
    ;(createClient as any).mockReturnValue({
      auth: {
        signInWithOtp: vi.fn().mockResolvedValue({ error: new Error('rate limit exceeded: too many requests') }),
      },
    })

    const { POST } = await import('../../app/api/auth/provider/send-code/route')
    const req = new NextRequest('http://localhost/api/auth/provider/send-code', {
      method: 'POST',
      body: JSON.stringify({ phone: '+27821234567' }),
      headers: { 'Content-Type': 'application/json' },
    })

    const res = await POST(req)
    const body = await res.json()

    expect(res.status).toBe(429)
    expect(body.error).toMatchObject({
      code: 'RATE_LIMITED',
      providerId: 'prov-1',
      step: 'Worker portal send-code',
    })
  })

  it('returns OTP_PROVIDER_AUTH_FAILED when Supabase rejects credentials', async () => {
    const { db } = await import('@/lib/db')
    const { createClient } = await import('@supabase/supabase-js')
    ;(db.provider.findUnique as any).mockResolvedValue({ id: 'prov-1', active: true, verified: true, status: 'ACTIVE' })
    ;(createClient as any).mockReturnValue({
      auth: {
        signInWithOtp: vi.fn().mockResolvedValue({ error: new Error('invalid API key: unauthorized') }),
      },
    })

    const { POST } = await import('../../app/api/auth/provider/send-code/route')
    const req = new NextRequest('http://localhost/api/auth/provider/send-code', {
      method: 'POST',
      body: JSON.stringify({ phone: '+27821234567' }),
      headers: { 'Content-Type': 'application/json' },
    })

    const res = await POST(req)
    const body = await res.json()

    expect(res.status).toBe(401)
    expect(body.error).toMatchObject({
      code: 'OTP_PROVIDER_AUTH_FAILED',
      providerId: 'prov-1',
      step: 'Worker portal send-code',
    })
  })

  it('returns AUTH_CONFIG_MISSING when Supabase env vars are missing', async () => {
    const { db } = await import('@/lib/db')
    ;(db.provider.findUnique as any).mockResolvedValue({ id: 'prov-1', active: true, verified: true, status: 'ACTIVE' })

    const savedUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
    const savedKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
    delete process.env.NEXT_PUBLIC_SUPABASE_URL
    delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

    try {
      const { POST } = await import('../../app/api/auth/provider/send-code/route')
      const req = new NextRequest('http://localhost/api/auth/provider/send-code', {
        method: 'POST',
        body: JSON.stringify({ phone: '+27821234567' }),
        headers: { 'Content-Type': 'application/json' },
      })

      const res = await POST(req)
      const body = await res.json()

      expect(res.status).toBe(503)
      expect(body).toMatchObject({
        ok: false,
        code: 'AUTH_CONFIG_MISSING',
        message: "We couldn't send the code right now. Please try again shortly.",
      })
      expect(body.error).toMatchObject({
        code: 'AUTH_CONFIG_MISSING',
        title: "We couldn't send your login code.",
        providerId: 'prov-1',
        step: 'Worker portal send-code',
      })
    } finally {
      process.env.NEXT_PUBLIC_SUPABASE_URL = savedUrl
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = savedKey
    }
  })

  it('returns OTP_PROVIDER_BAD_RESPONSE when Supabase resolves with a malformed error message', async () => {
    const { db } = await import('@/lib/db')
    const { createClient } = await import('@supabase/supabase-js')
    ;(db.provider.findUnique as any).mockResolvedValue({ id: 'prov-1', active: true, verified: true, status: 'ACTIVE' })
    ;(createClient as any).mockReturnValue({
      auth: {
        signInWithOtp: vi.fn().mockResolvedValue({ error: new Error('malformed json response from upstream') }),
      },
    })

    const { POST } = await import('../../app/api/auth/provider/send-code/route')
    const req = new NextRequest('http://localhost/api/auth/provider/send-code', {
      method: 'POST',
      body: JSON.stringify({ phone: '+27821234567' }),
      headers: { 'Content-Type': 'application/json' },
    })

    const res = await POST(req)
    const body = await res.json()

    expect(res.status).toBe(502)
    expect(body.error).toMatchObject({
      code: 'OTP_PROVIDER_BAD_RESPONSE',
      providerId: 'prov-1',
      step: 'Worker portal send-code',
    })
  })

  it('returns OTP_PROVIDER_UNAVAILABLE when the provider DB lookup fails', async () => {
    const { db } = await import('@/lib/db')
    ;(db.provider.findUnique as any).mockRejectedValue(new Error('connection refused'))

    const { POST } = await import('../../app/api/auth/provider/send-code/route')
    const req = new NextRequest('http://localhost/api/auth/provider/send-code', {
      method: 'POST',
      body: JSON.stringify({ phone: '0821234567' }),
      headers: { 'Content-Type': 'application/json' },
    })

    const res = await POST(req)
    const body = await res.json()

    expect(res.status).toBe(503)
    expect(body.error).toMatchObject({
      code: 'OTP_PROVIDER_UNAVAILABLE',
      step: 'Worker portal send-code',
    })
  })

  it('does not return UNKNOWN_AUTH_ERROR for unmapped OTP provider failures', async () => {
    const { db } = await import('@/lib/db')
    const { createClient } = await import('@supabase/supabase-js')
    ;(db.provider.findUnique as any).mockResolvedValue({ id: 'prov-1', active: true, verified: true, status: 'ACTIVE' })
    ;(createClient as any).mockReturnValue({
      auth: {
        signInWithOtp: vi.fn().mockRejectedValue(new Error('some completely unrecognised internal error xyz_q7r')),
      },
    })

    const { POST } = await import('../../app/api/auth/provider/send-code/route')
    const req = new NextRequest('http://localhost/api/auth/provider/send-code', {
      method: 'POST',
      body: JSON.stringify({ phone: '+27821234567' }),
      headers: { 'Content-Type': 'application/json' },
    })

    const res = await POST(req)
    const body = await res.json()

    expect(body.error.code).not.toBe('UNKNOWN_AUTH_ERROR')
    expect(body.error.code).toBe('OTP_DELIVERY_FAILED')
    expect(res.status).toBe(502)
  })

  it('returns AUTH_RESPONSE_INVALID when Supabase returns an unusable response', async () => {
    const { db } = await import('@/lib/db')
    const { createClient } = await import('@supabase/supabase-js')
    ;(db.provider.findUnique as any).mockResolvedValue({ id: 'prov-1', active: true, verified: true, status: 'ACTIVE' })
    ;(createClient as any).mockReturnValue({
      auth: {
        signInWithOtp: vi.fn().mockResolvedValue(null),
      },
    })

    const { POST } = await import('../../app/api/auth/provider/send-code/route')
    const req = new NextRequest('http://localhost/api/auth/provider/send-code', {
      method: 'POST',
      body: JSON.stringify({ phone: '+27821234567' }),
      headers: { 'Content-Type': 'application/json' },
    })

    const res = await POST(req)
    const body = await res.json()

    expect(res.status).toBe(502)
    expect(body).toMatchObject({
      ok: false,
      code: 'AUTH_RESPONSE_INVALID',
      message: "We couldn't send the code right now. Please try again shortly.",
    })
    expect(body.error).toMatchObject({
      code: 'AUTH_RESPONSE_INVALID',
      providerId: 'prov-1',
      step: 'Worker portal send-code',
    })
  })

  it('returns AUTH_CONFIG_MISSING when Supabase client setup throws before OTP send', async () => {
    const { db } = await import('@/lib/db')
    const { createClient } = await import('@supabase/supabase-js')
    ;(db.provider.findUnique as any).mockResolvedValue({ id: 'prov-1', active: true, verified: true, status: 'ACTIVE' })
    ;(createClient as any).mockImplementation(() => {
      throw new Error('Invalid URL')
    })

    const { POST } = await import('../../app/api/auth/provider/send-code/route')
    const req = new NextRequest('http://localhost/api/auth/provider/send-code', {
      method: 'POST',
      body: JSON.stringify({ phone: '+27821234567' }),
      headers: { 'Content-Type': 'application/json' },
    })

    const res = await POST(req)
    const body = await res.json()

    expect(res.status).toBe(503)
    expect(body.error).toMatchObject({
      code: 'AUTH_CONFIG_MISSING',
      providerId: 'prov-1',
      step: 'Worker portal send-code',
    })
    expect(body.error.code).not.toBe('UNKNOWN_AUTH_ERROR')
  })
})

// ─── /api/auth/provider/verify-code ───────────────────────────────────────────

describe('POST /api/auth/provider/verify-code', () => {
  beforeEach(async () => {
    vi.clearAllMocks()
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://supabase.test'
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'anon-key'
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-key'

    const { db } = await import('@/lib/db')
    ;(db.provider.findMany as any).mockResolvedValue([])
    ;(db.provider.update as any).mockImplementation(async (args: any) => ({
      id: args.where.id,
      userId: args.data.userId,
      phone: '+27823035070',
      active: true,
      verified: true,
      status: 'ACTIVE',
      name: 'Approved Provider',
    }))
    ;(db.providerApplication.findFirst as any).mockResolvedValue(null)

    const { createClient } = await import('@supabase/supabase-js')
    ;(createClient as any).mockReturnValue({
      auth: {
        verifyOtp: vi.fn().mockResolvedValue({
          data: {
            user: {
              id: 'auth-user-1',
              phone: '27823035070',
              user_metadata: {},
            },
            session: {
              access_token: 'access-token-1',
              expires_in: 3600,
            },
          },
          error: null,
        }),
        admin: {
          updateUserById: vi.fn().mockResolvedValue({ error: null }),
        },
      },
    })
  })

  it.each([
    '0823035070',
    '823035070',
    '27823035070',
    '+27823035070',
    '+27 82 303 5070',
  ])('verifies OTP, resolves approved provider, and creates a session for %s', async (input) => {
    const { db } = await import('@/lib/db')
    ;(db.provider.findMany as any).mockResolvedValue([{
      id: 'provider-1',
      userId: null,
      phone: '+27823035070',
      active: true,
      verified: true,
      status: 'ACTIVE',
      name: 'Approved Provider',
    }])

    const { POST } = await import('../../app/api/auth/provider/verify-code/route')
    const req = new NextRequest('http://localhost/api/auth/provider/verify-code', {
      method: 'POST',
      body: JSON.stringify({ phone: input, code: '123456', traceId: 'client_verify_1' }),
      headers: { 'Content-Type': 'application/json' },
    })

    const res = await POST(req)
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body).toMatchObject({
      ok: true,
      code: 'OK',
      providerId: 'provider-1',
      linkedProviderNow: true,
    })
    expect(db.provider.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        OR: [
          { phone: '+27823035070' },
          { userId: 'auth-user-1' },
        ],
      },
    }))
    expect(db.provider.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'provider-1' },
      data: { userId: 'auth-user-1' },
    }))
    expect(res.headers.get('Set-Cookie')).toContain('sb-access-token=access-token-1')
  })

  it('returns WORKER_NOT_APPROVED only for truly pending providers', async () => {
    const { db } = await import('@/lib/db')
    ;(db.provider.findMany as any).mockResolvedValue([{
      id: 'provider-pending',
      userId: null,
      phone: '+27823035070',
      active: true,
      verified: false,
      status: 'UNDER_REVIEW',
      name: 'Pending Provider',
    }])

    const { POST } = await import('../../app/api/auth/provider/verify-code/route')
    const req = new NextRequest('http://localhost/api/auth/provider/verify-code', {
      method: 'POST',
      body: JSON.stringify({ phone: '0823035070', code: '123456' }),
      headers: { 'Content-Type': 'application/json' },
    })

    const res = await POST(req)
    const body = await res.json()

    expect(res.status).toBe(403)
    expect(body).toMatchObject({
      ok: false,
      code: 'WORKER_NOT_APPROVED',
      message: "Your provider application is still under review. We'll notify you on WhatsApp once it has been approved.",
    })
    expect(db.provider.update).not.toHaveBeenCalled()
  })

  it('returns WORKER_INACTIVE for rejected or suspended providers', async () => {
    const { db } = await import('@/lib/db')
    ;(db.provider.findMany as any).mockResolvedValue([{
      id: 'provider-suspended',
      userId: 'auth-user-1',
      phone: '+27823035070',
      active: false,
      verified: true,
      status: 'SUSPENDED',
      name: 'Suspended Provider',
    }])

    const { POST } = await import('../../app/api/auth/provider/verify-code/route')
    const req = new NextRequest('http://localhost/api/auth/provider/verify-code', {
      method: 'POST',
      body: JSON.stringify({ phone: '+27823035070', code: '123456' }),
      headers: { 'Content-Type': 'application/json' },
    })

    const res = await POST(req)
    const body = await res.json()

    expect(res.status).toBe(423)
    expect(body.code).toBe('WORKER_INACTIVE')
  })

  it('returns WORKER_NOT_FOUND for unknown mobile numbers', async () => {
    const { POST } = await import('../../app/api/auth/provider/verify-code/route')
    const req = new NextRequest('http://localhost/api/auth/provider/verify-code', {
      method: 'POST',
      body: JSON.stringify({ phone: '0823035070', code: '123456' }),
      headers: { 'Content-Type': 'application/json' },
    })

    const res = await POST(req)
    const body = await res.json()

    expect(res.status).toBe(404)
    expect(body.code).toBe('WORKER_NOT_FOUND')
  })

  it('returns WORKER_PROFILE_LINK_MISSING when auth identity belongs to another provider', async () => {
    const { db } = await import('@/lib/db')
    ;(db.provider.findMany as any).mockResolvedValue([{
      id: 'provider-1',
      userId: 'other-auth-user',
      phone: '+27823035070',
      active: true,
      verified: true,
      status: 'ACTIVE',
      name: 'Approved Provider',
    }])

    const { POST } = await import('../../app/api/auth/provider/verify-code/route')
    const req = new NextRequest('http://localhost/api/auth/provider/verify-code', {
      method: 'POST',
      body: JSON.stringify({ phone: '+27823035070', code: '123456' }),
      headers: { 'Content-Type': 'application/json' },
    })

    const res = await POST(req)
    const body = await res.json()

    expect(res.status).toBe(403)
    expect(body.code).toBe('WORKER_PROFILE_LINK_MISSING')
  })

  it('detects duplicate/conflicting provider links deterministically', async () => {
    const { db } = await import('@/lib/db')
    ;(db.provider.findMany as any).mockResolvedValue([
      {
        id: 'provider-approved-phone',
        userId: null,
        phone: '+27823035070',
        active: true,
        verified: true,
        status: 'ACTIVE',
        name: 'Approved Provider',
      },
      {
        id: 'provider-linked-other-phone',
        userId: 'auth-user-1',
        phone: '+27821111111',
        active: true,
        verified: true,
        status: 'ACTIVE',
        name: 'Other Provider',
      },
    ])

    const { POST } = await import('../../app/api/auth/provider/verify-code/route')
    const req = new NextRequest('http://localhost/api/auth/provider/verify-code', {
      method: 'POST',
      body: JSON.stringify({ phone: '+27823035070', code: '123456' }),
      headers: { 'Content-Type': 'application/json' },
    })

    const res = await POST(req)
    const body = await res.json()

    expect(res.status).toBe(409)
    expect(body.code).toBe('DUPLICATE_WORKER_PROFILE')
  })

  it('returns INVALID_OTP when Supabase rejects the code', async () => {
    const { createClient } = await import('@supabase/supabase-js')
    ;(createClient as any).mockReturnValue({
      auth: {
        verifyOtp: vi.fn().mockResolvedValue({
          data: { user: null, session: null },
          error: new Error('Invalid token'),
        }),
      },
    })

    const { POST } = await import('../../app/api/auth/provider/verify-code/route')
    const req = new NextRequest('http://localhost/api/auth/provider/verify-code', {
      method: 'POST',
      body: JSON.stringify({ phone: '+27823035070', code: '000000' }),
      headers: { 'Content-Type': 'application/json' },
    })

    const res = await POST(req)
    const body = await res.json()

    expect(res.status).toBe(401)
    expect(body.code).toBe('INVALID_OTP')
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
