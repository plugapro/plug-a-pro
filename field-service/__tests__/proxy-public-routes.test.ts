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
      findFirst: mockAdminUserFindFirst,
    },
    provider: {
      findFirst: mockProviderFindFirst,
    },
  },
}))

describe('proxy public route baseline', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockAdminUserFindFirst.mockResolvedValue(null)
    mockProviderFindFirst.mockResolvedValue(null)
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://localhost:54321'
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'anon-key'
  })

  it.each([
    ['/track', 'tracking page'],
    ['/api/track?ref=job-123', 'tracking API'],
    ['/for-providers', 'provider marketing page'],
    ['/credit-terms', 'credit terms page'],
    ['/api/locations/search?q=Roodepoort', 'location search API'],
  ])('allows unauthenticated access to %s (%s)', async (path) => {
    const { proxy } = await import('../proxy')

    const res = await proxy(new NextRequest(`http://localhost${path}`))

    expect(res.status).toBe(200)
    expect(res.headers.get('location')).toBeNull()
  })

  it.each([
    [
      '/bookings',
      'http://localhost/sign-in?callbackUrl=%2Fbookings&next=%2Fbookings',
      'customer route',
    ],
    [
      '/provider/credits',
      'http://localhost/provider-sign-in?callbackUrl=%2Fprovider%2Fcredits&next=%2Fprovider%2Fcredits',
      'provider route',
    ],
    [
      '/admin/team',
      'http://localhost/admin-sign-in?callbackUrl=%2Fadmin%2Fteam&next=%2Fadmin%2Fteam',
      'admin route',
    ],
    [
      '/api/auth/phone-exists',
      'http://localhost/sign-in?callbackUrl=%2Fbookings&next=%2Fbookings',
      'removed phone enumeration API',
    ],
  ])('keeps unauthenticated protected %s behind its auth redirect (%s)', async (path, location) => {
    const { proxy } = await import('../proxy')

    const res = await proxy(new NextRequest(`http://localhost${path}`))

    expect(res.status).toBe(307)
    expect(res.headers.get('location')).toBe(location)
  })
})
