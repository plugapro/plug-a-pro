import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const { mockGetUser, mockAdminUserFindUnique } = vi.hoisted(() => ({
  mockGetUser: vi.fn(),
  mockAdminUserFindUnique: vi.fn(),
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
      findUnique: mockAdminUserFindUnique,
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
    mockAdminUserFindUnique.mockResolvedValue({
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
    mockAdminUserFindUnique.mockResolvedValue({
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

  it('redirects legacy metadata admins without an AdminUser row away from admin routes', async () => {
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
    mockAdminUserFindUnique.mockResolvedValue(null)

    const req = new NextRequest('http://localhost/admin/providers', {
      headers: { cookie: 'sb-access-token=test-token' },
    })

    const res = await proxy(req)

    expect(res.status).toBe(307)
    expect(res.headers.get('location')).toBe(
      'http://localhost/admin-sign-in?callbackUrl=%2Fadmin%2Fproviders&next=%2Fadmin%2Fproviders'
    )
  })
})
