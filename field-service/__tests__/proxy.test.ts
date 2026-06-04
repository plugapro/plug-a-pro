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

  it('denies admin routes when no AdminUser row exists', async () => {
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

    expect(res.status).toBe(307)
    expect(res.headers.get('location')).toBe(
      'http://localhost/admin-sign-in?callbackUrl=%2Fadmin%2Fproviders&next=%2Fadmin%2Fproviders',
    )
  })

  it('allows signed one-job WhatsApp routes without an OTP session', async () => {
    const { proxy } = await import('../proxy')

    const res = await proxy(new NextRequest('http://localhost/provider/jobs/jr-1/handover?token=signed-token'))

    expect(res.status).toBe(200)
    expect(res.headers.get('location')).toBeNull()
    expect(mockGetUser).not.toHaveBeenCalled()
  })

  it('allows signed provider job alias routes without an OTP session', async () => {
    const { proxy } = await import('../proxy')

    const urls = [
      'http://localhost/provider/jobs/jr-1/execute?token=signed-token',
      'http://localhost/provider/jobs/jr-1/complete?token=signed-token',
      'http://localhost/provider/job/signed-token',
      'http://localhost/provider/lead/signed-token',
      'http://localhost/provider/handoff/signed-token',
    ]

    for (const url of urls) {
      const res = await proxy(new NextRequest(url))
      expect(res.status).toBe(200)
      expect(res.headers.get('location')).toBeNull()
    }
    expect(mockGetUser).not.toHaveBeenCalled()
  })

  it('allows unsigned legacy lead routes to render controlled recovery copy without forcing login', async () => {
    const { proxy } = await import('../proxy')

    const res = await proxy(new NextRequest('http://localhost/leads/legacy-lead-id'))

    expect(res.status).toBe(200)
    expect(res.headers.get('location')).toBeNull()
    expect(mockGetUser).not.toHaveBeenCalled()
  })

  it.each([
    '/track',
    '/track/JR-123',
    '/api/track',
    '/api/track/JR-123',
    '/for-providers',
    '/credit-terms',
    '/security/checkpoint',
    '/security/otp/report?token=report-token',
    '/api/security/otp/report',
    '/api/security/otp/verify-failed',
    '/api/locations/search?q=Roodepoort',
  ])('allows unauthenticated access to public baseline route %s', async (path) => {
    const { proxy } = await import('../proxy')

    const res = await proxy(new NextRequest(`http://localhost${path}`))

    expect(res.status).toBe(200)
    expect(res.headers.get('location')).toBeNull()
    expect(mockGetUser).not.toHaveBeenCalled()
  })

  it('does not expose the customer phone existence oracle as a public route', async () => {
    const { proxy } = await import('../proxy')

    const res = await proxy(new NextRequest('http://localhost/api/auth/phone-exists'))

    expect(res.status).toBe(307)
    expect(res.headers.get('location')).toBe(
      'http://localhost/sign-in?callbackUrl=%2Fbookings&next=%2Fbookings',
    )
  })

  it('keeps non-canonical nested legacy lead routes protected by login', async () => {
    const { proxy } = await import('../proxy')

    const res = await proxy(new NextRequest('http://localhost/leads/legacy-lead-id/extra'))

    expect(res.status).toBe(307)
    expect(res.headers.get('location')).toBe(
      'http://localhost/sign-in?callbackUrl=%2Fbookings&next=%2Fbookings',
    )
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

  it('allows provider identity verification guidance without an OTP session', async () => {
    const { proxy } = await import('../proxy')

    const res = await proxy(new NextRequest('http://localhost/provider/verification'))

    expect(res.status).toBe(200)
    expect(res.headers.get('location')).toBeNull()
    expect(mockGetUser).not.toHaveBeenCalled()
  })

  it('allows signed review-first provider profiles without an OTP session', async () => {
    const { proxy } = await import('../proxy')

    const res = await proxy(new NextRequest('http://localhost/provider-public-profile/signed-profile-token'))

    expect(res.status).toBe(200)
    expect(res.headers.get('location')).toBeNull()
    expect(mockGetUser).not.toHaveBeenCalled()
  })

  it('allows signed review-first shortlist action without an OTP session', async () => {
    const { proxy } = await import('../proxy')

    const res = await proxy(new NextRequest('http://localhost/api/review-first/provider-profile/shortlist'))

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

  it('allows unauthenticated users to open the public status dashboard', async () => {
    const { proxy } = await import('../proxy')

    const res = await proxy(new NextRequest('http://localhost/status'))

    expect(res.status).toBe(200)
    expect(res.headers.get('location')).toBeNull()
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

  it('allows public access to the status dashboard', async () => {
    const { proxy } = await import('../proxy')

    const res = await proxy(new NextRequest('http://localhost/status'))

    expect(res.status).toBe(200)
    expect(res.headers.get('location')).toBeNull()
    expect(mockGetUser).not.toHaveBeenCalled()
  })

  it('maps clean admin-domain routes to internal /admin paths and keeps admin callback', async () => {
    const { proxy } = await import('../proxy')

    const res = await proxy(new NextRequest('https://admin.plugapro.co.za/dispatch'))

    expect(res.status).toBe(307)
    expect(res.headers.get('location')).toBe(
      'https://admin.plugapro.co.za/admin-sign-in?callbackUrl=%2Fadmin%2Fdispatch&next=%2Fadmin%2Fdispatch',
    )
  })

  it('treats host headers with port as admin domain for clean-path routing', async () => {
    const { proxy } = await import('../proxy')

    const res = await proxy(new NextRequest('https://admin.plugapro.co.za/customers', {
      headers: { host: 'admin.plugapro.co.za:443' },
    }))

    expect(res.status).toBe(307)
    expect(res.headers.get('location')).toBe(
      'https://admin.plugapro.co.za/admin-sign-in?callbackUrl=%2Fadmin%2Fcustomers&next=%2Fadmin%2Fcustomers',
    )
  })

  it('keeps /sign-in public on admin domain', async () => {
    const { proxy } = await import('../proxy')

    const res = await proxy(new NextRequest('https://admin.plugapro.co.za/sign-in'))

    expect(res.status).toBe(200)
    expect(res.headers.get('location')).toBeNull()
    expect(mockGetUser).not.toHaveBeenCalled()
  })

  it('keeps /admin-sign-in public on admin domain', async () => {
    const { proxy } = await import('../proxy')

    const res = await proxy(new NextRequest('https://admin.plugapro.co.za/admin-sign-in?next=%2Fadmin'))

    expect(res.status).toBe(200)
    expect(res.headers.get('location')).toBeNull()
    expect(mockGetUser).not.toHaveBeenCalled()
  })

  it('keeps /security/checkpoint public on admin domain before clean-path rewriting', async () => {
    const { proxy } = await import('../proxy')

    const res = await proxy(new NextRequest('https://admin.plugapro.co.za/security/checkpoint'))

    expect(res.status).toBe(200)
    expect(res.headers.get('location')).toBeNull()
    expect(mockGetUser).not.toHaveBeenCalled()
  })

  it('keeps /security/otp/report public on admin domain before clean-path rewriting', async () => {
    const { proxy } = await import('../proxy')

    const res = await proxy(new NextRequest('https://admin.plugapro.co.za/security/otp/report?token=report-token'))

    expect(res.status).toBe(200)
    expect(res.headers.get('location')).toBeNull()
    expect(mockGetUser).not.toHaveBeenCalled()
  })

  it('keeps narrow OTP security telemetry APIs public on admin domain without opening broader security APIs', async () => {
    const { proxy } = await import('../proxy')

    const report = await proxy(new NextRequest('https://admin.plugapro.co.za/api/security/otp/report'))
    const verifyFailed = await proxy(new NextRequest('https://admin.plugapro.co.za/api/security/otp/verify-failed'))
    const stepUp = await proxy(new NextRequest('https://admin.plugapro.co.za/api/security/otp/step-up/ack'))
    const stepUpNormalHost = await proxy(new NextRequest('https://app.plugapro.co.za/api/security/otp/step-up/ack'))

    expect(report.status).toBe(200)
    expect(report.headers.get('location')).toBeNull()
    expect(verifyFailed.status).toBe(200)
    expect(verifyFailed.headers.get('location')).toBeNull()
    expect(stepUp.status).toBe(200)
    expect(stepUp.headers.get('location')).toBeNull()
    expect(stepUpNormalHost.status).toBe(200)
    expect(stepUpNormalHost.headers.get('location')).toBeNull()
    expect(mockGetUser).not.toHaveBeenCalled()
  })

  it('keeps /login alias public on admin domain', async () => {
    const { proxy } = await import('../proxy')

    const res = await proxy(new NextRequest('https://admin.plugapro.co.za/login?next=%2Fadmin'))

    expect(res.status).toBe(200)
    expect(res.headers.get('location')).toBeNull()
    expect(mockGetUser).not.toHaveBeenCalled()
  })

  it('keeps /signup alias public on admin domain', async () => {
    const { proxy } = await import('../proxy')

    const res = await proxy(new NextRequest('https://admin.plugapro.co.za/signup'))

    expect(res.status).toBe(200)
    expect(res.headers.get('location')).toBeNull()
    expect(mockGetUser).not.toHaveBeenCalled()
  })

  it('keeps /join provider flyer short URL public on app domain', async () => {
    const { proxy } = await import('../proxy')

    const res = await proxy(new NextRequest('https://app.plugapro.co.za/join'))

    expect(res.status).toBe(200)
    expect(res.headers.get('location')).toBeNull()
    expect(mockGetUser).not.toHaveBeenCalled()
  })

  it('allows unauthenticated access to /r/* short handoff links', async () => {
    const { proxy } = await import('../proxy')

    const res = await proxy(new NextRequest('http://localhost/r/signed-handoff-token'))

    expect(res.status).toBe(200)
    expect(res.headers.get('location')).toBeNull()
    expect(mockGetUser).not.toHaveBeenCalled()
  })

  it('allows unauthenticated access to /ticket/* public invoice pages', async () => {
    const { proxy } = await import('../proxy')

    const res = await proxy(new NextRequest('http://localhost/ticket/public-invoice-token'))

    expect(res.status).toBe(200)
    expect(res.headers.get('location')).toBeNull()
    expect(mockGetUser).not.toHaveBeenCalled()
  })

  it('allows unauthenticated access to /client/handoff/* WhatsApp deep-links', async () => {
    const { proxy } = await import('../proxy')

    const res = await proxy(new NextRequest('http://localhost/client/handoff/signed-wa-token'))

    expect(res.status).toBe(200)
    expect(res.headers.get('location')).toBeNull()
    expect(mockGetUser).not.toHaveBeenCalled()
  })

  // ─── WhatsApp deep-link public paths (added in the deep-link auth fix) ────────

  it('allows unauthenticated access to /requests/* so the page can redirect WhatsApp visitors to the tokenized route', async () => {
    const { proxy } = await import('../proxy')

    const res = await proxy(new NextRequest('http://localhost/requests/clnrz9kg10000qyvl7qox9w1m'))

    expect(res.status).toBe(200)
    expect(res.headers.get('location')).toBeNull()
    expect(mockGetUser).not.toHaveBeenCalled()
  })

  it('allows unauthenticated access to /confirm-completion/* HMAC-token job sign-off', async () => {
    const { proxy } = await import('../proxy')

    const res = await proxy(new NextRequest('http://localhost/confirm-completion/hmac-signed-token'))

    expect(res.status).toBe(200)
    expect(res.headers.get('location')).toBeNull()
    expect(mockGetUser).not.toHaveBeenCalled()
  })

  it('allows unauthenticated access to /review/* HMAC-token provider review', async () => {
    const { proxy } = await import('../proxy')

    const res = await proxy(new NextRequest('http://localhost/review/hmac-signed-review-token'))

    expect(res.status).toBe(200)
    expect(res.headers.get('location')).toBeNull()
    expect(mockGetUser).not.toHaveBeenCalled()
  })

  it('allows unauthenticated access to /quotes/* token-gated quote approval', async () => {
    const { proxy } = await import('../proxy')

    const res = await proxy(new NextRequest('http://localhost/quotes/uuid-approval-token'))

    expect(res.status).toBe(200)
    expect(res.headers.get('location')).toBeNull()
    expect(mockGetUser).not.toHaveBeenCalled()
  })

  it('keeps /bookings/* behind OTP login (not a WhatsApp-tokenized route)', async () => {
    const { proxy } = await import('../proxy')

    const res = await proxy(new NextRequest('http://localhost/bookings/booking-id-123'))

    expect(res.status).toBe(307)
    expect(res.headers.get('location')).toContain('/sign-in')
    expect(mockGetUser).not.toHaveBeenCalled()
  })
})
