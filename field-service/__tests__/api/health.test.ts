import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// ─── Mocks ────────────────────────────────────────────────────────────────────

vi.mock('@/lib/db', () => ({
  db: {
    $queryRaw: vi.fn(),
  },
}))

vi.mock('@/lib/flags', () => ({
  FLAG_KEYS: { AUTH_OTP_WHATSAPP: 'auth.otp.whatsapp' },
  isEnabled: vi.fn(),
  validateFeatureFlagsEnv: vi.fn(() => ({ status: 'unset' as const })),
}))

// ─── GET /api/health ──────────────────────────────────────────────────────────

describe('GET /api/health', () => {
  const originalEnv = { ...process.env }

  beforeEach(() => {
    vi.clearAllMocks()
    vi.resetModules()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    process.env = { ...originalEnv }
  })

  it('returns 200 with sanitized public body (no build, no auth) when DB responds', async () => {
    const { db } = await import('@/lib/db')
    ;(db.$queryRaw as ReturnType<typeof vi.fn>).mockResolvedValue([{ '?column?': 1 }])
    const { GET } = await import('../../app/api/health/route')
    const res = await GET()
    const body = await res.json()
    expect(res.status).toBe(200)
    expect(body.status).toBe('ok')
    expect(body.db).toBe('ok')
    expect(typeof body.timestamp).toBe('string')
    expect(body).not.toHaveProperty('build')
    expect(body).not.toHaveProperty('auth')
    expect(body.payments).not.toBe('ok')
    expect(res.headers.get('cache-control')).toContain('s-maxage=15')
  })

  it('returns 503 with status degraded when DB throws', async () => {
    const { db } = await import('@/lib/db')
    ;(db.$queryRaw as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('connection refused'))

    const { GET } = await import('../../app/api/health/route')
    const res = await GET()
    const body = await res.json()

    expect(res.status).toBe(503)
    expect(body.status).toBe('degraded')
    expect(body.db).toBe('error')
    expect(typeof body.timestamp).toBe('string')
    expect(res.headers.get('cache-control')).toBe('no-store')
  })

  it('returns 200 with status maintenance and sanitized body when MAINTENANCE_MODE is set', async () => {
    process.env.MAINTENANCE_MODE = '1'
    const { db } = await import('@/lib/db')
    ;(db.$queryRaw as ReturnType<typeof vi.fn>).mockResolvedValue([{ '?column?': 1 }])

    const { GET } = await import('../../app/api/health/route')
    const res = await GET()
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.status).toBe('maintenance')
    expect(body).not.toHaveProperty('auth')
    expect(body).not.toHaveProperty('build')
  })

  it('includes whatsapp field in response (unknown when credentials not set)', async () => {
    const { db } = await import('@/lib/db')
    ;(db.$queryRaw as ReturnType<typeof vi.fn>).mockResolvedValue([{ '?column?': 1 }])

    const { GET } = await import('../../app/api/health/route')
    const res = await GET()
    const body = await res.json()

    expect(body).toHaveProperty('whatsapp')
    expect(['ok', 'error', 'unknown']).toContain(body.whatsapp as string)
  })

  it('checks WhatsApp health with an Authorization header instead of a tokenized URL', async () => {
    process.env.WHATSAPP_ACCESS_TOKEN = 'test-wa-token'
    process.env.WHATSAPP_PHONE_NUMBER_ID = 'phone-id-1'
    const fetchMock = vi.fn().mockResolvedValue({ ok: true })
    vi.stubGlobal('fetch', fetchMock)

    const { db } = await import('@/lib/db')
    ;(db.$queryRaw as ReturnType<typeof vi.fn>).mockResolvedValue([{ '?column?': 1 }])

    const { GET } = await import('../../app/api/health/route')
    const res = await GET()
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.whatsapp).toBe('ok')
    expect(fetchMock).toHaveBeenCalledWith(
      'https://graph.facebook.com/v21.0/phone-id-1?fields=display_phone_number',
      expect.objectContaining({
        headers: { Authorization: 'Bearer test-wa-token' },
      }),
    )
    expect(fetchMock.mock.calls[0]?.[0]).not.toContain('access_token=')
  })

  it('includes payments field in response (unknown when credentials not set)', async () => {
    const { db } = await import('@/lib/db')
    ;(db.$queryRaw as ReturnType<typeof vi.fn>).mockResolvedValue([{ '?column?': 1 }])

    const { GET } = await import('../../app/api/health/route')
    const res = await GET()
    const body = await res.json()

    expect(body).toHaveProperty('payments')
    expect(['ok', 'unknown']).toContain(body.payments as string)
  })

  // The public body intentionally omits the internal `auth` observability block
  // and never degrades on OTP/pepper config; those checks moved to the
  // CRON_SECRET-gated internal health route (Task 2).
  it('never exposes the internal auth block on the public body', async () => {
    const { db } = await import('@/lib/db')
    ;(db.$queryRaw as ReturnType<typeof vi.fn>).mockResolvedValue([{ '?column?': 1 }])
    const flags = await import('@/lib/flags')
    ;(flags.isEnabled as ReturnType<typeof vi.fn>).mockImplementation(
      async (key: string) => key === 'security.otp.report',
    )
    delete process.env.OTP_HASH_PEPPER

    const { GET } = await import('../../app/api/health/route')
    const res = await GET()
    const body = await res.json()

    // OTP/pepper posture no longer drives the public status; DB is fine → 200.
    expect(res.status).toBe(200)
    expect(body.status).toBe('ok')
    expect(body).not.toHaveProperty('auth')
    expect(body).not.toHaveProperty('build')
  })
})
