import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockPruneTerminalOtpChallenges,
  mockPruneStaleSecurityEvents,
  mockPruneClearedAccountSecurityStates,
} = vi.hoisted(() => ({
  mockPruneTerminalOtpChallenges: vi.fn(),
  mockPruneStaleSecurityEvents: vi.fn(),
  mockPruneClearedAccountSecurityStates: vi.fn(),
}))

vi.mock('@/lib/otp-security', () => ({
  pruneTerminalOtpChallenges: mockPruneTerminalOtpChallenges,
  pruneStaleSecurityEvents: mockPruneStaleSecurityEvents,
  pruneClearedAccountSecurityStates: mockPruneClearedAccountSecurityStates,
}))

describe('GET /api/cron/otp-security-prune', () => {
  const ORIGINAL_ENV = { ...process.env }
  const CRON_SECRET = 'cron-secret'
  let infoSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    vi.clearAllMocks()
    process.env = { ...ORIGINAL_ENV, CRON_SECRET }
    mockPruneTerminalOtpChallenges.mockResolvedValue({ deleted: 3 })
    mockPruneStaleSecurityEvents.mockResolvedValue({ deleted: 7 })
    mockPruneClearedAccountSecurityStates.mockResolvedValue({ deleted: 2 })
    infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.restoreAllMocks()
    process.env = ORIGINAL_ENV
  })

  it('rejects requests without CRON_SECRET bearer auth', async () => {
    const { GET } = await import('@/app/api/cron/otp-security-prune/route')

    const missing = await GET(new Request('http://localhost/api/cron/otp-security-prune'))
    const wrong = await GET(
      new Request('http://localhost/api/cron/otp-security-prune', {
        headers: { authorization: 'Bearer wrong-secret' },
      }),
    )

    expect(missing.status).toBe(401)
    expect(wrong.status).toBe(401)
    expect(mockPruneTerminalOtpChallenges).not.toHaveBeenCalled()
    expect(mockPruneStaleSecurityEvents).not.toHaveBeenCalled()
    expect(mockPruneClearedAccountSecurityStates).not.toHaveBeenCalled()
  })

  it('rejects requests when CRON_SECRET is not configured', async () => {
    delete process.env.CRON_SECRET
    const { GET } = await import('@/app/api/cron/otp-security-prune/route')

    const response = await GET(
      new Request('http://localhost/api/cron/otp-security-prune', {
        headers: { authorization: `Bearer ${CRON_SECRET}` },
      }),
    )

    expect(response.status).toBe(401)
    expect(mockPruneTerminalOtpChallenges).not.toHaveBeenCalled()
    expect(mockPruneStaleSecurityEvents).not.toHaveBeenCalled()
    expect(mockPruneClearedAccountSecurityStates).not.toHaveBeenCalled()
  })

  it('runs all three prunes and returns per-table deleted counts when authorized', async () => {
    vi.spyOn(Date, 'now').mockReturnValueOnce(1_000).mockReturnValueOnce(1_047)
    const { GET } = await import('@/app/api/cron/otp-security-prune/route')

    const response = await GET(
      new Request('http://localhost/api/cron/otp-security-prune', {
        headers: { authorization: `Bearer ${CRON_SECRET}` },
      }),
    )

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      ok: true,
      durationMs: 47,
      challenges: { deleted: 3, errored: null },
      securityEvents: { deleted: 7, errored: null },
      accountSecurityStates: { deleted: 2, errored: null },
    })
    expect(mockPruneTerminalOtpChallenges).toHaveBeenCalledTimes(1)
    expect(mockPruneStaleSecurityEvents).toHaveBeenCalledTimes(1)
    expect(mockPruneClearedAccountSecurityStates).toHaveBeenCalledTimes(1)
  })

  it('emits three structured log events, one per table', async () => {
    vi.spyOn(Date, 'now').mockReturnValueOnce(2_000).mockReturnValueOnce(2_015)
    const { GET } = await import('@/app/api/cron/otp-security-prune/route')

    await GET(
      new Request('http://localhost/api/cron/otp-security-prune', {
        headers: { authorization: `Bearer ${CRON_SECRET}` },
      }),
    )

    expect(infoSpy).toHaveBeenCalledTimes(3)
    const events = infoSpy.mock.calls.map((call: unknown[]) => JSON.parse(String(call[0])))
    expect(events[0]).toEqual({
      event: 'otp.challenge.pruned',
      deleted: 3,
      durationMs: 15,
      errored: null,
    })
    expect(events[1]).toEqual({
      event: 'otp.security_event.pruned',
      deleted: 7,
      errored: null,
    })
    expect(events[2]).toEqual({
      event: 'otp.account_security_state.pruned',
      deleted: 2,
      errored: null,
    })

    const all = JSON.stringify(events)
    expect(all).not.toContain('+27821234567')
    expect(all).not.toContain('987654')
    expect(all.toLowerCase()).not.toContain('token')
  })

  it('isolates failures - one prune throwing does not block the others', async () => {
    mockPruneStaleSecurityEvents.mockRejectedValueOnce(new TypeError('forced fail'))
    const { GET } = await import('@/app/api/cron/otp-security-prune/route')

    const response = await GET(
      new Request('http://localhost/api/cron/otp-security-prune', {
        headers: { authorization: `Bearer ${CRON_SECRET}` },
      }),
    )

    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.challenges.errored).toBeNull()
    expect(body.securityEvents.errored).toBe('TypeError')
    expect(body.securityEvents.deleted).toBe(0)
    expect(body.accountSecurityStates.errored).toBeNull()
    // The two surviving prunes still ran.
    expect(mockPruneTerminalOtpChallenges).toHaveBeenCalledTimes(1)
    expect(mockPruneClearedAccountSecurityStates).toHaveBeenCalledTimes(1)
  })
})
