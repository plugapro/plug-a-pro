import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const limitMock = vi.fn()

vi.mock('@upstash/ratelimit', () => {
  class MockRatelimit {
    static slidingWindow = vi.fn(() => ({ type: 'sliding-window' }))

    limit = limitMock
  }

  return { Ratelimit: MockRatelimit }
})

vi.mock('@upstash/redis', () => ({
  Redis: class MockRedis {
    type = 'redis-client'
  },
}))

vi.mock('@/lib/audit', () => ({
  recordAuditLog: vi.fn(),
}))

describe('OTP rate limiting', () => {
  const originalEnv = { ...process.env }

  beforeEach(async () => {
    vi.clearAllMocks()
    process.env = { ...originalEnv }
    const { resetRateLimitForTests } = await import('@/lib/rate-limit')
    resetRateLimitForTests()
  })

  afterEach(async () => {
    process.env = { ...originalEnv }
    const { resetRateLimitForTests } = await import('@/lib/rate-limit')
    resetRateLimitForTests()
  })

  it('fails closed in production when durable limiter env vars are missing', async () => {
    process.env.VERCEL_ENV = 'production'
    delete process.env.RATE_LIMIT_ALLOW_MEMORY_FALLBACK
    delete process.env.UPSTASH_REDIS_REST_URL
    delete process.env.UPSTASH_REDIS_REST_TOKEN
    delete process.env.UPSTASH_REDIS_KV_REST_API_URL
    delete process.env.UPSTASH_REDIS_KV_REST_API_TOKEN
    delete process.env.KV_REST_API_URL
    delete process.env.KV_REST_API_TOKEN

    const {
      checkOtpSendLimit,
      checkOtpReportLimit,
      checkOtpVerifyLimit,
      checkProviderRegistrationProfilePhotoLimit,
      checkProviderLookupLimit,
      checkPublicProviderSendCodeLimit,
    } = await import('@/lib/rate-limit')

    await expect(checkOtpSendLimit({ phone: '+27820000000', ip: '203.0.113.10' })).resolves.toEqual({
      ok: false,
      code: 'limiter_unavailable',
      retryAfterMs: 60_000,
    })
    await expect(checkOtpVerifyLimit({ phone: '+27820000000' })).resolves.toEqual({
      ok: false,
      code: 'limiter_unavailable',
      retryAfterMs: 60_000,
    })
    await expect(checkOtpReportLimit({ ip: '203.0.113.10' })).resolves.toEqual({
      ok: false,
      code: 'limiter_unavailable',
      retryAfterMs: 60_000,
    })
    await expect(checkProviderLookupLimit({ phone: '+27820000000', ip: '203.0.113.10' })).resolves.toEqual({
      ok: false,
      code: 'limiter_unavailable',
      retryAfterMs: 60_000,
    })
    await expect(checkPublicProviderSendCodeLimit({ phone: '+27820000000', ip: '203.0.113.10' })).resolves.toEqual({
      ok: false,
      code: 'limiter_unavailable',
      retryAfterMs: 60_000,
    })
    await expect(checkProviderRegistrationProfilePhotoLimit({ phone: '+27820000000', ip: '203.0.113.10' })).resolves.toEqual({
      ok: false,
      code: 'limiter_unavailable',
      retryAfterMs: 60_000,
    })
  })

  it('keeps non-production memory fallback explicit and bounded', async () => {
    process.env.RATE_LIMIT_ALLOW_MEMORY_FALLBACK = 'true'
    process.env.OTP_SEND_LIMIT_PER_PHONE_HOUR = '1'

    const { checkOtpSendLimit } = await import('@/lib/rate-limit')

    await expect(checkOtpSendLimit({ phone: '+27820000001' })).resolves.toEqual({ ok: true })
    await expect(checkOtpSendLimit({ phone: '+27820000001' })).resolves.toMatchObject({
      ok: false,
      code: 'phone_limit',
    })
  })

  it('fails closed when the durable limiter throws', async () => {
    process.env.UPSTASH_REDIS_REST_URL = 'https://upstash.example.test'
    process.env.UPSTASH_REDIS_REST_TOKEN = 'test-token'
    limitMock.mockRejectedValueOnce(new Error('redis unavailable'))

    const { checkOtpSendLimit } = await import('@/lib/rate-limit')

    await expect(checkOtpSendLimit({ phone: '+27820000002' })).resolves.toEqual({
      ok: false,
      code: 'limiter_unavailable',
      retryAfterMs: 60_000,
    })
  })

  it('limits provider lookup attempts before OTP delivery quotas are consumed', async () => {
    process.env.RATE_LIMIT_ALLOW_MEMORY_FALLBACK = 'true'
    process.env.PROVIDER_LOOKUP_LIMIT_PER_PHONE_HOUR = '1'

    const { checkProviderLookupLimit, checkOtpSendLimit } = await import('@/lib/rate-limit')

    await expect(checkProviderLookupLimit({ phone: '+27820000003', ip: '203.0.113.20' })).resolves.toEqual({ ok: true })
    await expect(checkProviderLookupLimit({ phone: '+27820000003', ip: '203.0.113.20' })).resolves.toMatchObject({
      ok: false,
      code: 'phone_limit',
    })
    await expect(checkOtpSendLimit({ phone: '+27820000003', ip: '203.0.113.20' })).resolves.toEqual({ ok: true })
  })

  it('limits public pre-lookup attempts by IP + normalized phone', async () => {
    process.env.RATE_LIMIT_ALLOW_MEMORY_FALLBACK = 'true'
    process.env.PROVIDER_SEND_CODE_PUBLIC_LIMIT_PER_IP_PHONE_HOUR = '1'

    const { checkPublicProviderSendCodeLimit } = await import('@/lib/rate-limit')

    await expect(checkPublicProviderSendCodeLimit({ phone: '+27820000004', ip: '203.0.113.21' })).resolves.toEqual({ ok: true })
    await expect(checkPublicProviderSendCodeLimit({ phone: '+27820000004', ip: '203.0.113.21' })).resolves.toMatchObject({
      ok: false,
      code: 'ip_phone_limit',
    })
    await expect(checkPublicProviderSendCodeLimit({ phone: '+27820000004', ip: '203.0.113.22' })).resolves.toEqual({ ok: true })
  })

  it('limits provider registration profile photo uploads by verified phone', async () => {
    process.env.RATE_LIMIT_ALLOW_MEMORY_FALLBACK = 'true'
    process.env.PROVIDER_REGISTRATION_PROFILE_PHOTO_LIMIT_PER_PHONE_HOUR = '1'

    const { checkProviderRegistrationProfilePhotoLimit } = await import('@/lib/rate-limit')

    await expect(checkProviderRegistrationProfilePhotoLimit({ phone: '+27820000005', ip: '203.0.113.23' })).resolves.toEqual({ ok: true })
    await expect(checkProviderRegistrationProfilePhotoLimit({ phone: '+27820000005', ip: '203.0.113.24' })).resolves.toMatchObject({
      ok: false,
      code: 'rate_limited',
    })
    await expect(checkProviderRegistrationProfilePhotoLimit({ phone: '+27820000006', ip: '203.0.113.24' })).resolves.toEqual({ ok: true })
  })

  it('keeps internal test phone bypasses away from public and verification abuse gates', async () => {
    process.env.RATE_LIMIT_ALLOW_MEMORY_FALLBACK = 'true'
    process.env.OTP_SEND_LIMIT_PER_PHONE_HOUR = '1'
    process.env.OTP_SEND_LIMIT_PER_IP_HOUR = '1'
    process.env.PROVIDER_LOOKUP_LIMIT_PER_PHONE_HOUR = '1'
    process.env.PROVIDER_LOOKUP_LIMIT_PER_IP_HOUR = '1'
    process.env.PROVIDER_SEND_CODE_PUBLIC_LIMIT_PER_IP_PHONE_HOUR = '1'
    process.env.OTP_VERIFY_LIMIT_PER_PHONE_HOUR = '1'

    const {
      checkOtpSendLimit,
      checkOtpVerifyLimit,
      checkProviderLookupLimit,
      checkPublicProviderSendCodeLimit,
    } = await import('@/lib/rate-limit')

    const phone = '+27000000002'

    await expect(checkOtpSendLimit({ phone, ip: '203.0.113.30' })).resolves.toEqual({ ok: true })
    await expect(checkOtpSendLimit({ phone, ip: '203.0.113.31' })).resolves.toEqual({ ok: true })
    await expect(checkOtpSendLimit({ phone, ip: '203.0.113.31' })).resolves.toMatchObject({
      ok: false,
      code: 'ip_limit',
    })

    await expect(checkProviderLookupLimit({ phone, ip: '203.0.113.40' })).resolves.toEqual({ ok: true })
    await expect(checkProviderLookupLimit({ phone, ip: '203.0.113.41' })).resolves.toEqual({ ok: true })
    await expect(checkProviderLookupLimit({ phone, ip: '203.0.113.41' })).resolves.toMatchObject({
      ok: false,
      code: 'ip_limit',
    })

    await expect(checkPublicProviderSendCodeLimit({ phone, ip: '203.0.113.50' })).resolves.toEqual({ ok: true })
    await expect(checkPublicProviderSendCodeLimit({ phone, ip: '203.0.113.50' })).resolves.toMatchObject({
      ok: false,
      code: 'ip_phone_limit',
    })

    await expect(checkOtpVerifyLimit({ phone })).resolves.toEqual({ ok: true })
    await expect(checkOtpVerifyLimit({ phone })).resolves.toMatchObject({
      ok: false,
      code: 'verify_limit',
    })
  })

  it('limits OTP report attempts by trusted IP', async () => {
    process.env.RATE_LIMIT_ALLOW_MEMORY_FALLBACK = 'true'
    process.env.OTP_REPORT_LIMIT_PER_IP_HOUR = '1'

    const { checkOtpReportLimit } = await import('@/lib/rate-limit')

    await expect(checkOtpReportLimit({ ip: '8.8.8.8', ua: 'vitest' })).resolves.toEqual({ ok: true })
    await expect(checkOtpReportLimit({ ip: '8.8.8.8', ua: 'vitest' })).resolves.toMatchObject({
      ok: false,
      code: 'ip_limit',
    })
    await expect(checkOtpReportLimit({ ip: '8.8.4.4', ua: 'vitest' })).resolves.toEqual({ ok: true })
  })
})

describe('voucher redemption rate limiting', () => {
  const originalEnv = { ...process.env }

  beforeEach(async () => {
    vi.clearAllMocks()
    process.env = { ...originalEnv }
    const { resetRateLimitForTests } = await import('@/lib/rate-limit')
    resetRateLimitForTests()
  })

  afterEach(async () => {
    process.env = { ...originalEnv }
    const { resetRateLimitForTests } = await import('@/lib/rate-limit')
    resetRateLimitForTests()
  })

  it('fails closed in production when durable limiter env vars are missing', async () => {
    process.env.VERCEL_ENV = 'production'
    delete process.env.RATE_LIMIT_ALLOW_MEMORY_FALLBACK
    delete process.env.UPSTASH_REDIS_REST_URL
    delete process.env.UPSTASH_REDIS_REST_TOKEN
    delete process.env.UPSTASH_REDIS_KV_REST_API_URL
    delete process.env.UPSTASH_REDIS_KV_REST_API_TOKEN
    delete process.env.KV_REST_API_URL
    delete process.env.KV_REST_API_TOKEN

    const { checkVoucherRedemptionLimit } = await import('@/lib/rate-limit')

    await expect(
      checkVoucherRedemptionLimit({
        providerId: 'provider-voucher-production',
        reason: 'malformed',
      }),
    ).resolves.toEqual({
      ok: false,
      code: 'limiter_unavailable',
      retryAfterMs: 60_000,
    })
  })

  it('memory fallback limits malformed voucher attempts after the default threshold', async () => {
    process.env.RATE_LIMIT_ALLOW_MEMORY_FALLBACK = 'true'

    const { checkVoucherRedemptionLimit } = await import('@/lib/rate-limit')
    const params = {
      providerId: 'provider-voucher-malformed',
      reason: 'malformed' as const,
    }

    for (let attempt = 0; attempt < 5; attempt++) {
      await expect(checkVoucherRedemptionLimit(params)).resolves.toEqual({ ok: true })
    }
    await expect(checkVoucherRedemptionLimit(params)).resolves.toMatchObject({
      ok: false,
      code: 'rate_limited',
    })
  })

  it('keeps malformed and failed voucher attempt buckets independent', async () => {
    process.env.RATE_LIMIT_ALLOW_MEMORY_FALLBACK = 'true'
    process.env.VOUCHER_REDEMPTION_MALFORMED_LIMIT_PER_PROVIDER_10_MINUTES = '1'
    process.env.VOUCHER_REDEMPTION_FAILED_LIMIT_PER_PROVIDER_HOUR = '1'

    const { checkVoucherRedemptionLimit } = await import('@/lib/rate-limit')

    await expect(
      checkVoucherRedemptionLimit({
        providerId: 'provider-voucher-independent',
        reason: 'malformed',
      }),
    ).resolves.toEqual({ ok: true })
    await expect(
      checkVoucherRedemptionLimit({
        providerId: 'provider-voucher-independent',
        reason: 'malformed',
      }),
    ).resolves.toMatchObject({
      ok: false,
      code: 'rate_limited',
    })
    await expect(
      checkVoucherRedemptionLimit({
        providerId: 'provider-voucher-independent',
        reason: 'failed',
      }),
    ).resolves.toEqual({ ok: true })
    await expect(
      checkVoucherRedemptionLimit({
        providerId: 'provider-voucher-independent',
        reason: 'failed',
      }),
    ).resolves.toMatchObject({
      ok: false,
      code: 'rate_limited',
    })
  })

  it('reset helper clears voucher rate limit buckets', async () => {
    process.env.RATE_LIMIT_ALLOW_MEMORY_FALLBACK = 'true'
    process.env.VOUCHER_REDEMPTION_MALFORMED_LIMIT_PER_PROVIDER_10_MINUTES = '1'

    const { checkVoucherRedemptionLimit, resetRateLimitForTests } = await import('@/lib/rate-limit')
    const params = {
      providerId: 'provider-voucher-reset',
      reason: 'malformed' as const,
    }

    await expect(checkVoucherRedemptionLimit(params)).resolves.toEqual({ ok: true })
    await expect(checkVoucherRedemptionLimit(params)).resolves.toMatchObject({
      ok: false,
      code: 'rate_limited',
    })

    resetRateLimitForTests()

    await expect(checkVoucherRedemptionLimit(params)).resolves.toEqual({ ok: true })
  })
})
