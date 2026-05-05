import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const { mockGetUser, mockAdminUserFindFirst, mockProviderFindFirst } = vi.hoisted(() => ({
  mockGetUser: vi.fn(),
  mockAdminUserFindFirst: vi.fn(),
  mockProviderFindFirst: vi.fn(),
}))

vi.mock('@supabase/supabase-js', () => ({
  createClient: vi.fn(() => ({
    auth: {
      getUser: mockGetUser,
    },
  })),
}))

vi.mock('@/lib/db', () => ({
  db: {
    adminUser: {
      // proxy.ts calls findFirst (OR query by userId / email)
      findFirst: mockAdminUserFindFirst,
    },
    provider: {
      findFirst: mockProviderFindFirst,
    },
  },
}))

describe('proxy admin access', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockProviderFindFirst.mockResolvedValue(null)
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://localhost:54321'
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'anon-key'
  })

  it('allows active AdminUser roles onto admin routes even without legacy admin metadata', async () => {
    const { proxy } = await import('../proxy')

    mockGetUser.mockResolvedValue({
      data: {
        user: {
          id: 'user-ops-1',
          user_metadata: { role: 'customer' },
        },
      },
      error: null,
    })
    mockAdminUserFindFirst.mockResolvedValue({
      role: 'OPS',
      active: true,
    })

    const req = new NextRequest('http://localhost/admin/customers', {
      headers: { cookie: 'sb-access-token=test-token' },
    })

    const res = await proxy(req)

    expect(res.status).toBe(200)
    expect(res.headers.get('location')).toBeNull()
    expect(res.headers.get('x-user-id')).toBe('user-ops-1')
    expect(res.headers.get('x-user-role')).toBe('ops')
  })

  it('redirects inactive AdminUser accounts away from admin routes', async () => {
    const { proxy } = await import('../proxy')

    mockGetUser.mockResolvedValue({
      data: {
        user: {
          id: 'user-owner-1',
          user_metadata: { role: 'owner' },
        },
      },
      error: null,
    })
    mockAdminUserFindFirst.mockResolvedValue({
      role: 'OWNER',
      active: false,
    })

    const req = new NextRequest('http://localhost/admin/team', {
      headers: { cookie: 'sb-access-token=test-token' },
    })

    const res = await proxy(req)

    expect(res.status).toBe(307)
    expect(res.headers.get('location')).toBe(
      'http://localhost/admin-sign-in?callbackUrl=%2Fadmin%2Fteam&next=%2Fadmin%2Fteam'
    )
  })

  it('allows legacy metadata admins without an AdminUser row via metadata fallback', async () => {
    // No AdminUser row → proxy falls back to Supabase user_metadata.role
    // (transitional: run backfill-admin-users.ts to migrate these accounts to DB rows)
    const { proxy } = await import('../proxy')

    mockGetUser.mockResolvedValue({
      data: {
        user: {
          id: 'legacy-owner-1',
          user_metadata: { role: 'owner' },
        },
      },
      error: null,
    })
    mockAdminUserFindFirst.mockResolvedValue(null)

    const req = new NextRequest('http://localhost/admin/providers', {
      headers: { cookie: 'sb-access-token=test-token' },
    })

    const res = await proxy(req)

    expect(res.status).toBe(200)
    expect(res.headers.get('location')).toBeNull()
    expect(res.headers.get('x-user-role')).toBe('owner')
  })

  it('allows signed one-job WhatsApp routes without an OTP session', async () => {
    const { proxy } = await import('../proxy')

    const res = await proxy(new NextRequest('http://localhost/provider/jobs/jr-1/handover?token=signed-token'))

    expect(res.status).toBe(200)
    expect(res.headers.get('location')).toBeNull()
    expect(mockGetUser).not.toHaveBeenCalled()
  })

  it('keeps account-level provider routes behind OTP login', async () => {
    const { proxy } = await import('../proxy')

    const res = await proxy(new NextRequest('http://localhost/provider/credits'))

    expect(res.status).toBe(307)
    expect(res.headers.get('location')).toBe(
      'http://localhost/provider-sign-in?callbackUrl=%2Fprovider%2Fcredits&next=%2Fprovider%2Fcredits',
    )
  })

  it('sanitizes provider callback destination when unauthenticated provider routes include invalid next params', async () => {
    const { proxy } = await import('../proxy')

    const res = await proxy(new NextRequest('http://localhost/provider/jobs?next=%2Fadmin%2Fbookings'))

    expect(res.status).toBe(307)
    expect(res.headers.get('location')).toBe(
      'http://localhost/provider-sign-in?callbackUrl=%2Fprovider%2Fjobs&next=%2Fprovider%2Fjobs',
    )
  })

  it('redirects unauthenticated customer booking routes to customer sign-in', async () => {
    const { proxy } = await import('../proxy')

    const res = await proxy(new NextRequest('http://localhost/bookings'))

    expect(res.status).toBe(307)
    expect(res.headers.get('location')).toBe(
      'http://localhost/sign-in?callbackUrl=%2Fbookings&next=%2Fbookings',
    )
  })

  it('redirects unauthenticated customer profile routes to customer sign-in', async () => {
    const { proxy } = await import('../proxy')

    const res = await proxy(new NextRequest('http://localhost/profile'))

    expect(res.status).toBe(307)
    expect(res.headers.get('location')).toBe(
      'http://localhost/sign-in?callbackUrl=%2Fprofile&next=%2Fprofile',
    )
  })

  it('allows provider credit terms without an OTP session', async () => {
    const { proxy } = await import('../proxy')

    const res = await proxy(new NextRequest('http://localhost/provider/terms/credits'))

    expect(res.status).toBe(200)
    expect(res.headers.get('location')).toBeNull()
    expect(mockGetUser).not.toHaveBeenCalled()
  })

  it('allows provider verify-code API without an existing session cookie', async () => {
    const { proxy } = await import('../proxy')

    const res = await proxy(new NextRequest('http://localhost/api/auth/provider/verify-code'))

    expect(res.status).toBe(200)
    expect(res.headers.get('location')).toBeNull()
    expect(mockGetUser).not.toHaveBeenCalled()
  })

  it('allows approved linked providers onto provider routes even without legacy provider metadata', async () => {
    const { proxy } = await import('../proxy')

    mockGetUser.mockResolvedValue({
      data: {
        user: {
          id: 'user-provider-1',
          phone: '27823035070',
          user_metadata: { role: 'customer' },
        },
      },
      error: null,
    })
    mockProviderFindFirst.mockResolvedValue({
      id: 'provider-1',
      userId: 'user-provider-1',
      phone: '+27823035070',
      active: true,
      verified: true,
      status: 'ACTIVE',
    })

    const req = new NextRequest('http://localhost/provider', {
      headers: { cookie: 'sb-access-token=test-token' },
    })

    const res = await proxy(req)

    expect(res.status).toBe(200)
    expect(res.headers.get('location')).toBeNull()
    expect(res.headers.get('x-user-role')).toBe('provider')
  })

  it('marks authenticated non-provider sessions as role-mismatch at provider routes', async () => {
    const { proxy } = await import('../proxy')

    mockGetUser.mockResolvedValue({
      data: {
        user: {
          id: 'user-customer-2',
          phone: '27823035070',
          user_metadata: { role: 'customer' },
        },
      },
      error: null,
    })
    mockProviderFindFirst.mockResolvedValue(null)

    const req = new NextRequest('http://localhost/provider/jobs', {
      headers: { cookie: 'sb-access-token=test-token' },
    })

    const res = await proxy(req)

    expect(res.status).toBe(307)
    expect(res.headers.get('location')).toBe(
      'http://localhost/provider-sign-in?callbackUrl=%2Fprovider%2Fjobs&next=%2Fprovider%2Fjobs&error=unauthorized',
    )
  })

  it('blocks pending providers from provider routes after OTP', async () => {
    const { proxy } = await import('../proxy')

    mockGetUser.mockResolvedValue({
      data: {
        user: {
          id: 'user-provider-pending',
          phone: '27823035070',
          user_metadata: { role: 'provider' },
        },
      },
      error: null,
    })
    mockProviderFindFirst.mockResolvedValue({
      id: 'provider-pending',
      userId: 'user-provider-pending',
      phone: '+27823035070',
      active: true,
      verified: false,
      status: 'UNDER_REVIEW',
    })

    const req = new NextRequest('http://localhost/provider', {
      headers: { cookie: 'sb-access-token=test-token' },
    })

    const res = await proxy(req)

    expect(res.status).toBe(307)
    expect(res.headers.get('location')).toBe(
      'http://localhost/provider-sign-in?callbackUrl=%2Fprovider%2Fjobs&next=%2Fprovider%2Fjobs&error=unauthorized',
    )
  })

  it('allows signed provider contact-customer API without an OTP session', async () => {
    const { proxy } = await import('../proxy')

    const res = await proxy(new NextRequest('http://localhost/api/provider/leads/lead-1/contact-customer?leadToken=signed-token'))

    expect(res.status).toBe(200)
    expect(res.headers.get('location')).toBeNull()
    expect(mockGetUser).not.toHaveBeenCalled()
  })

  it('allows the attachment image proxy through so signed lead and ticket tokens can be validated by the route', async () => {
    const { proxy } = await import('../proxy')

    const res = await proxy(new NextRequest('http://localhost/api/attachments/att-1?leadToken=signed-token'))

    expect(res.status).toBe(200)
    expect(res.headers.get('location')).toBeNull()
    expect(mockGetUser).not.toHaveBeenCalled()
  })
})
