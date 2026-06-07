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

  it('returns 200 with status ok when DB responds', async () => {
    const { db } = await import('@/lib/db')
    ;(db.$queryRaw as ReturnType<typeof vi.fn>).mockResolvedValue([{ '?column?': 1 }])

    const { GET } = await import('../../app/api/health/route')
    const res = await GET()
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.status).toBe('ok')
    expect(body.db).toBe('ok')
    expect(typeof body.timestamp).toBe('string')
    expect(body).toHaveProperty('build')
    expect(body.build).toMatchObject({
      commitSha: expect.toSatisfy((v: unknown) => v === null || typeof v === 'string'),
      commitShaShort: expect.toSatisfy((v: unknown) => v === null || typeof v === 'string'),
      commitRef: expect.toSatisfy((v: unknown) => v === null || typeof v === 'string'),
      builtAt: expect.toSatisfy((v: unknown) => v === null || typeof v === 'string'),
    })
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

  // ─── auth.* observational fields ────────────────────────────────────────────

  it('reports otp_whatsapp_flag: "enabled" when isEnabled resolves true', async () => {
    const { db } = await import('@/lib/db')
    ;(db.$queryRaw as ReturnType<typeof vi.fn>).mockResolvedValue([{ '?column?': 1 }])
    const flags = await import('@/lib/flags')
    ;(flags.isEnabled as ReturnType<typeof vi.fn>).mockImplementation(
      async (key: string) => key === 'auth.otp.whatsapp',
    )

    const { GET } = await import('../../app/api/health/route')
    const res = await GET()
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body).toHaveProperty('auth')
    expect(body.auth.otp_whatsapp_flag).toBe('enabled')
    expect(body.auth.otp_security_report_flag).toBe('disabled')
    expect(body.auth.otp_security_report_config).toBe('disabled')
  })

  it('reports otp_whatsapp_flag: "unknown" when isEnabled throws, response still 200', async () => {
    const { db } = await import('@/lib/db')
    ;(db.$queryRaw as ReturnType<typeof vi.fn>).mockResolvedValue([{ '?column?': 1 }])
    const flags = await import('@/lib/flags')
    ;(flags.isEnabled as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('db down'))

    const { GET } = await import('../../app/api/health/route')
    const res = await GET()
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.auth.otp_whatsapp_flag).toBe('unknown')
  })

  it('reports supabase_env_complete: false when supabase env vars are missing', async () => {
    delete process.env.NEXT_PUBLIC_SUPABASE_URL
    delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

    const { db } = await import('@/lib/db')
    ;(db.$queryRaw as ReturnType<typeof vi.fn>).mockResolvedValue([{ '?column?': 1 }])
    const flags = await import('@/lib/flags')
    ;(flags.isEnabled as ReturnType<typeof vi.fn>).mockResolvedValue(false)

    const { GET } = await import('../../app/api/health/route')
    const res = await GET()
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.auth.supabase_env_complete).toBe(false)
  })

  it('degrades when OTP security reporting is enabled without OTP_HASH_PEPPER', async () => {
    delete process.env.OTP_HASH_PEPPER

    const { db } = await import('@/lib/db')
    ;(db.$queryRaw as ReturnType<typeof vi.fn>).mockResolvedValue([{ '?column?': 1 }])
    const flags = await import('@/lib/flags')
    ;(flags.isEnabled as ReturnType<typeof vi.fn>).mockImplementation(
      async (key: string) => key === 'security.otp.report',
    )

    const { GET } = await import('../../app/api/health/route')
    const res = await GET()
    const body = await res.json()

    expect(res.status).toBe(503)
    expect(body.status).toBe('degraded')
    expect(body.db).toBe('ok')
    expect(body.auth.otp_security_report_flag).toBe('enabled')
    expect(body.auth.otp_security_report_config).toBe('missing_otp_hash_pepper')
  })

  it('reports OTP security reporting as ready when enabled with OTP_HASH_PEPPER', async () => {
    process.env.OTP_HASH_PEPPER = 'health-test-pepper'

    const { db } = await import('@/lib/db')
    ;(db.$queryRaw as ReturnType<typeof vi.fn>).mockResolvedValue([{ '?column?': 1 }])
    const flags = await import('@/lib/flags')
    ;(flags.isEnabled as ReturnType<typeof vi.fn>).mockImplementation(
      async (key: string) => key === 'security.otp.report',
    )

    const { GET } = await import('../../app/api/health/route')
    const res = await GET()
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.status).toBe('ok')
    expect(body.auth.otp_security_report_flag).toBe('enabled')
    expect(body.auth.otp_security_report_config).toBe('ready')
  })
})
