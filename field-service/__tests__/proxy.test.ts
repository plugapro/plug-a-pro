import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const { mockGetUser, mockAdminUserFindFirst } = vi.hoisted(() => ({
  mockGetUser: vi.fn(),
  mockAdminUserFindFirst: vi.fn(),
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
  },
}))

describe('proxy admin access', () => {
  beforeEach(() => {
    vi.clearAllMocks()
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
})
