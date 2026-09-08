import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const {
  mockIsEnabled,
  mockCheckVodapayAuthLimit,
  mockTrustedClientIp,
  mockApplyToken,
  mockInquiryUserInfo,
  mockResolveVodapayCustomer,
  mockResolveVodapayAuthUser,
  mockCreateServiceClient,
  mockCreateClient,
  mockDb,
  MockVodapayApiError,
} = vi.hoisted(() => ({
  mockIsEnabled: vi.fn(),
  mockCheckVodapayAuthLimit: vi.fn(),
  mockTrustedClientIp: vi.fn(),
  mockApplyToken: vi.fn(),
  mockInquiryUserInfo: vi.fn(),
  mockResolveVodapayCustomer: vi.fn(),
  mockResolveVodapayAuthUser: vi.fn(),
  mockCreateServiceClient: vi.fn(),
  mockCreateClient: vi.fn(),
  mockDb: {
    adminUser: { findFirst: vi.fn() },
    provider: { findFirst: vi.fn() },
    customer: { findUnique: vi.fn(), update: vi.fn() },
  },
  MockVodapayApiError: class MockVodapayApiError extends Error {
    constructor(public resultCode: string) {
      super(`VodaPay API error: ${resultCode}`)
    }
  },
}))

vi.mock('@/lib/flags', () => ({ isEnabled: mockIsEnabled }))
vi.mock('@/lib/rate-limit', () => ({ checkVodapayAuthLimit: mockCheckVodapayAuthLimit }))
vi.mock('@/lib/request-ip', () => ({ trustedClientIp: mockTrustedClientIp }))
vi.mock('@/lib/db', () => ({ db: mockDb }))
vi.mock('@/lib/auth', () => ({ createServiceClient: mockCreateServiceClient }))
vi.mock('@supabase/supabase-js', () => ({ createClient: mockCreateClient }))
vi.mock('@/lib/vodapay/client', () => ({
  applyToken: mockApplyToken,
  inquiryUserInfo: mockInquiryUserInfo,
  VodapayApiError: MockVodapayApiError,
}))
vi.mock('@/lib/vodapay/identity', () => ({
  resolveVodapayCustomer: mockResolveVodapayCustomer,
  resolveVodapayAuthUser: mockResolveVodapayAuthUser,
}))

import { POST } from '@/app/api/auth/vodapay/route'

function makeReq(body: unknown) {
  return new NextRequest('http://localhost/api/auth/vodapay', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

let generateLink: ReturnType<typeof vi.fn>
let verifyOtp: ReturnType<typeof vi.fn>

describe('POST /api/auth/vodapay', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)

    mockIsEnabled.mockResolvedValue(true)
    mockCheckVodapayAuthLimit.mockResolvedValue({ ok: true })
    mockTrustedClientIp.mockReturnValue('1.2.3.4')
    mockApplyToken.mockResolvedValue({ accessToken: 'vp_token', customerId: 'vp_user_1' })
    mockInquiryUserInfo.mockResolvedValue({
      userId: 'vp_user_1',
      userName: { fullName: 'Thabo M' },
      mobileNumber: '0821234567',
    })
    mockResolveVodapayAuthUser.mockResolvedValue({
      userId: 'auth_1',
      email: 'vodapay-abc@vodapay.users.plugapro.co.za',
      source: 'created',
      metadataRole: 'customer',
    })
    mockResolveVodapayCustomer.mockResolvedValue({ customerId: 'cust_1', created: true })

    generateLink = vi.fn(async () => ({
      data: { properties: { hashed_token: 'hashed_1' } },
      error: null,
    }))
    verifyOtp = vi.fn(async () => ({
      data: { session: { access_token: 'sb_access_token', expires_in: 3600 } },
      error: null,
    }))
    mockCreateServiceClient.mockReturnValue({ auth: { admin: { generateLink } } })
    mockCreateClient.mockReturnValue({ auth: { verifyOtp } })

    mockDb.adminUser.findFirst.mockResolvedValue(null)
    mockDb.provider.findFirst.mockResolvedValue(null)
    // Two distinct lookups: by customer id (is it already linked?) and by userId
    // (does another customer already own this auth user?).
    mockDb.customer.findUnique.mockImplementation(async (args: { where: Record<string, unknown> }) =>
      'id' in args.where ? { id: 'cust_1', userId: null } : null,
    )
    mockDb.customer.update.mockResolvedValue({ id: 'cust_1' })
  })

  it('returns 404 while the flag is off so the mini-program cannot log anyone in', async () => {
    mockIsEnabled.mockResolvedValue(false)
    const res = await POST(makeReq({ authCode: 'code_1' }))
    expect(res.status).toBe(404)
    expect(mockApplyToken).not.toHaveBeenCalled()
  })

  it('returns 400 when authCode is missing', async () => {
    const res = await POST(makeReq({}))
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: 'auth_code_required' })
    expect(mockApplyToken).not.toHaveBeenCalled()
  })

  it('returns 401 when the VodaPay exchange fails', async () => {
    mockApplyToken.mockRejectedValue(new MockVodapayApiError('INVALID_AUTH_CODE'))
    const res = await POST(makeReq({ authCode: 'code_1' }))
    expect(res.status).toBe(401)
    expect(await res.json()).toEqual({ error: 'vodapay_auth_failed' })
    expect(res.headers.get('Set-Cookie')).toBeNull()
  })

  it('returns 429 when the per-IP limiter rejects the call', async () => {
    mockCheckVodapayAuthLimit.mockResolvedValue({ ok: false, code: 'ip_limit', retryAfterMs: 1000 })
    const res = await POST(makeReq({ authCode: 'code_1' }))
    expect(res.status).toBe(429)
    expect(mockApplyToken).not.toHaveBeenCalled()
  })

  it('returns 401 when VodaPay returns no usable mobile number', async () => {
    mockInquiryUserInfo.mockResolvedValue({ userId: 'vp_user_1', mobileNumber: undefined })
    const res = await POST(makeReq({ authCode: 'code_1' }))
    expect(res.status).toBe(401)
    expect(await res.json()).toEqual({ error: 'phone_unavailable' })
    expect(mockResolveVodapayCustomer).not.toHaveBeenCalled()
  })

  it('refuses to mint a session for a staff account', async () => {
    mockDb.adminUser.findFirst.mockResolvedValue({ id: 'admin_1' })
    const res = await POST(makeReq({ authCode: 'code_1' }))
    expect(res.status).toBe(403)
    expect(await res.json()).toEqual({ error: 'account_not_eligible' })
    expect(mockResolveVodapayCustomer).not.toHaveBeenCalled()
    expect(generateLink).not.toHaveBeenCalled()
  })

  it('refuses to mint a session for a provider phone', async () => {
    mockDb.provider.findFirst.mockResolvedValue({ id: 'prov_1' })
    const res = await POST(makeReq({ authCode: 'code_1' }))
    expect(res.status).toBe(403)
    expect(mockResolveVodapayCustomer).not.toHaveBeenCalled()
  })

  it('mints the session cookie and links the customer on the happy path', async () => {
    const res = await POST(makeReq({ authCode: 'code_1' }))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true })

    expect(mockResolveVodapayCustomer).toHaveBeenCalledWith(
      {},
      { externalId: 'vp_user_1', phone: '+27821234567', fullName: 'Thabo M' },
    )
    expect(generateLink).toHaveBeenCalledWith({
      type: 'magiclink',
      email: 'vodapay-abc@vodapay.users.plugapro.co.za',
    })
    expect(verifyOtp).toHaveBeenCalledWith({ token_hash: 'hashed_1', type: 'magiclink' })
    expect(mockDb.customer.update).toHaveBeenCalledWith({
      where: { id: 'cust_1' },
      data: { userId: 'auth_1' },
    })

    const cookie = res.headers.get('Set-Cookie')
    expect(cookie).toContain('sb-access-token=sb_access_token')
    expect(cookie).toContain('HttpOnly')
  })

  it('never overwrites a customer already linked to a different auth user', async () => {
    mockDb.customer.findUnique.mockImplementation(async () => ({ id: 'cust_1', userId: 'auth_other' }))
    const res = await POST(makeReq({ authCode: 'code_1' }))
    expect(res.status).toBe(200)
    expect(mockDb.customer.update).not.toHaveBeenCalled()
  })

  it('does not steal an auth user already linked to another customer', async () => {
    mockDb.customer.findUnique.mockImplementation(async (args: { where: Record<string, unknown> }) =>
      'id' in args.where ? { id: 'cust_1', userId: null } : { id: 'cust_other' },
    )
    const res = await POST(makeReq({ authCode: 'code_1' }))
    expect(res.status).toBe(200)
    expect(mockDb.customer.update).not.toHaveBeenCalled()
  })

  it('returns 500 without a cookie when the session mint fails', async () => {
    verifyOtp.mockResolvedValue({ data: { session: null }, error: { message: 'expired' } })
    const res = await POST(makeReq({ authCode: 'code_1' }))
    expect(res.status).toBe(500)
    expect(res.headers.get('Set-Cookie')).toBeNull()
  })
})
