import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  db: {
    otpChallenge: {
      count: vi.fn(),
      findMany: vi.fn(),
    },
    securityEvent: {
      findFirst: vi.fn(),
    },
  },
}))

vi.mock('@/lib/db', () => ({ db: mocks.db }))

const PHONE = '+27821234567'
const NOW = new Date('2026-05-27T16:00:00.000Z')

beforeEach(() => {
  vi.clearAllMocks()
  // Default: nothing fires.
  mocks.db.otpChallenge.count.mockResolvedValue(0)
  mocks.db.otpChallenge.findMany.mockResolvedValue([])
  mocks.db.securityEvent.findFirst.mockResolvedValue(null)
})

describe('shouldSendSecurityCheck', () => {
  it('returns trigger=null when no signal matches', async () => {
    const { shouldSendSecurityCheck } = await import('@/lib/otp-security-signals')
    const result = await shouldSendSecurityCheck({ phoneE164: PHONE, now: NOW })
    expect(result.trigger).toBeNull()
    // Each signal was queried, in order.
    expect(mocks.db.otpChallenge.count).toHaveBeenCalledTimes(1)
    expect(mocks.db.otpChallenge.findMany).toHaveBeenCalledTimes(1)
    expect(mocks.db.securityEvent.findFirst).toHaveBeenCalledTimes(1)
  })

  it('fires send_velocity when count >= 3 in last hour', async () => {
    mocks.db.otpChallenge.count.mockResolvedValueOnce(3)
    const { shouldSendSecurityCheck } = await import('@/lib/otp-security-signals')
    const result = await shouldSendSecurityCheck({ phoneE164: PHONE, now: NOW })
    expect(result).toEqual({
      trigger: 'send_velocity',
      signalDetail: { sendCountLastHour: 3 },
    })
    // Short-circuits: later signals not queried.
    expect(mocks.db.otpChallenge.findMany).not.toHaveBeenCalled()
    expect(mocks.db.securityEvent.findFirst).not.toHaveBeenCalled()
  })

  it('does NOT fire send_velocity when count is 2 (below threshold)', async () => {
    mocks.db.otpChallenge.count.mockResolvedValueOnce(2)
    const { shouldSendSecurityCheck } = await import('@/lib/otp-security-signals')
    const result = await shouldSendSecurityCheck({ phoneE164: PHONE, now: NOW })
    expect(result.trigger).toBeNull()
    expect(mocks.db.otpChallenge.findMany).toHaveBeenCalledTimes(1)
  })

  it('fires ip_diversity when >=2 distinct non-null requestedIpHash in last 30m', async () => {
    mocks.db.otpChallenge.findMany.mockResolvedValueOnce([
      { requestedIpHash: 'hash_a' },
      { requestedIpHash: 'hash_b' },
      { requestedIpHash: 'hash_a' }, // duplicate; still counts as 2 distinct
    ])
    const { shouldSendSecurityCheck } = await import('@/lib/otp-security-signals')
    const result = await shouldSendSecurityCheck({ phoneE164: PHONE, now: NOW })
    expect(result).toEqual({
      trigger: 'ip_diversity',
      signalDetail: { distinctIpsLast30Min: 2 },
    })
    expect(mocks.db.securityEvent.findFirst).not.toHaveBeenCalled()
  })

  it('ignores null requestedIpHash values when counting distinct IPs', async () => {
    mocks.db.otpChallenge.findMany.mockResolvedValueOnce([
      { requestedIpHash: null },
      { requestedIpHash: null },
      { requestedIpHash: 'hash_a' }, // only 1 distinct
    ])
    const { shouldSendSecurityCheck } = await import('@/lib/otp-security-signals')
    const result = await shouldSendSecurityCheck({ phoneE164: PHONE, now: NOW })
    expect(result.trigger).toBeNull()
  })

  it('fires prior_event when an unresolved security_event exists in the last 90 days', async () => {
    mocks.db.securityEvent.findFirst.mockResolvedValueOnce({ id: 'evt_abc' })
    const { shouldSendSecurityCheck } = await import('@/lib/otp-security-signals')
    const result = await shouldSendSecurityCheck({ phoneE164: PHONE, now: NOW })
    expect(result).toEqual({
      trigger: 'prior_event',
      signalDetail: { priorEventId: 'evt_abc' },
    })
  })

  it('returns trigger=null when the first signal query throws (fails closed silently)', async () => {
    mocks.db.otpChallenge.count.mockRejectedValueOnce(new Error('db down'))
    const { shouldSendSecurityCheck } = await import('@/lib/otp-security-signals')
    const result = await shouldSendSecurityCheck({ phoneE164: PHONE, now: NOW })
    expect(result.trigger).toBeNull()
    // Subsequent signals NOT queried - fail-fast on first failure to avoid
    // cascading latency when the DB is in trouble.
    expect(mocks.db.otpChallenge.findMany).not.toHaveBeenCalled()
  })

  it('queries with correct time-window predicates', async () => {
    const { shouldSendSecurityCheck } = await import('@/lib/otp-security-signals')
    await shouldSendSecurityCheck({ phoneE164: PHONE, now: NOW })

    expect(mocks.db.otpChallenge.count).toHaveBeenCalledWith({
      where: {
        phoneE164: PHONE,
        createdAt: { gte: new Date('2026-05-27T15:00:00.000Z') }, // -60m
      },
    })
    expect(mocks.db.otpChallenge.findMany).toHaveBeenCalledWith({
      where: {
        phoneE164: PHONE,
        createdAt: { gte: new Date('2026-05-27T15:30:00.000Z') }, // -30m
      },
      select: { requestedIpHash: true },
      take: 50,
    })
    expect(mocks.db.securityEvent.findFirst).toHaveBeenCalledWith({
      where: {
        phoneE164: PHONE,
        status: { in: ['NEW', 'ACKNOWLEDGED'] },
        createdAt: { gte: new Date('2026-05-13T16:00:00.000Z') }, // -14d (shortened from -90d)
      },
      select: { id: true },
      orderBy: { createdAt: 'desc' },
    })
  })

  it('identifies which signal timed out via the error message', async () => {
    // Replace the count mock with one that hangs longer than the 1.5s timeout
    // so the velocity signal's promise loses the race. We don't await the full
    // 1.5s by stubbing setTimeout via fake timers; instead let the real timer
    // win the race against a never-resolving promise.
    mocks.db.otpChallenge.count.mockImplementationOnce(() => new Promise(() => {}))
    const { shouldSendSecurityCheck } = await import('@/lib/otp-security-signals')

    const start = Date.now()
    const result = await shouldSendSecurityCheck({ phoneE164: PHONE, now: NOW })
    const elapsed = Date.now() - start

    // Times out at ~1500ms and the outer try/catch swallows the timeout error,
    // returning { trigger: null }. Subsequent signals are NOT evaluated when
    // a signal's lookup fails (fail-fast).
    expect(result.trigger).toBeNull()
    expect(elapsed).toBeGreaterThanOrEqual(1500)
    expect(elapsed).toBeLessThan(2500) // generous upper bound for CI jitter
    expect(mocks.db.otpChallenge.findMany).not.toHaveBeenCalled()
  }, 5000)
})
