import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { mockPruneTerminalOtpChallenges } = vi.hoisted(() => ({
  mockPruneTerminalOtpChallenges: vi.fn(),
}))

vi.mock('@/lib/otp-security', () => ({
  pruneTerminalOtpChallenges: mockPruneTerminalOtpChallenges,
}))

describe('GET /api/cron/otp-security-prune', () => {
  const ORIGINAL_ENV = { ...process.env }
  const CRON_SECRET = 'cron-secret'
  let infoSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    vi.clearAllMocks()
    process.env = { ...ORIGINAL_ENV, CRON_SECRET }
    mockPruneTerminalOtpChallenges.mockResolvedValue({ deleted: 3 })
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
  })

  it('runs pruneTerminalOtpChallenges and returns deleted count when authorized', async () => {
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
      deleted: 3,
      durationMs: 47,
    })
    expect(mockPruneTerminalOtpChallenges).toHaveBeenCalledTimes(1)
  })

  it('logs only low-cardinality prune metadata', async () => {
    vi.spyOn(Date, 'now').mockReturnValueOnce(2_000).mockReturnValueOnce(2_015)
    const { GET } = await import('@/app/api/cron/otp-security-prune/route')

    await GET(
      new Request('http://localhost/api/cron/otp-security-prune', {
        headers: { authorization: `Bearer ${CRON_SECRET}` },
      }),
    )

    expect(infoSpy).toHaveBeenCalledTimes(1)
    const payload = JSON.parse(String(infoSpy.mock.calls[0]?.[0]))
    expect(payload).toEqual({
      event: 'otp.challenge.pruned',
      deleted: 3,
      durationMs: 15,
    })
    expect(JSON.stringify(payload)).not.toContain('+27821234567')
    expect(JSON.stringify(payload)).not.toContain('987654')
    expect(JSON.stringify(payload).toLowerCase()).not.toContain('token')
  })
})
