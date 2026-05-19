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
      checkOtpVerifyLimit,
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
})
