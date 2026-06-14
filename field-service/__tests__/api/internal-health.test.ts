import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/db', () => ({ db: { $queryRaw: vi.fn() } }))
vi.mock('@/lib/flags', () => ({
  FLAG_KEYS: { AUTH_OTP_WHATSAPP: 'auth.otp.whatsapp' },
  isEnabled: vi.fn().mockResolvedValue(false),
}))

function req(secret?: string) {
  return new NextRequest('http://localhost/api/internal/health', {
    headers: secret ? { authorization: `Bearer ${secret}` } : {},
  })
}

describe('GET /api/internal/health', () => {
  const originalEnv = { ...process.env }
  beforeEach(() => { vi.clearAllMocks(); vi.resetModules(); process.env.CRON_SECRET = 'test-secret' })
  afterEach(() => { process.env = { ...originalEnv } })

  it('returns 401 without a valid CRON_SECRET', async () => {
    const { GET } = await import('../../app/api/internal/health/route')
    expect((await GET(req())).status).toBe(401)
    expect((await GET(req('wrong'))).status).toBe(401)
  })

  it('returns full diagnostics (auth + build) with a valid CRON_SECRET', async () => {
    const { db } = await import('@/lib/db')
    ;(db.$queryRaw as ReturnType<typeof vi.fn>).mockResolvedValue([{ '?column?': 1 }])
    const { GET } = await import('../../app/api/internal/health/route')
    const res = await GET(req('test-secret'))
    const body = await res.json()
    expect(res.status).toBe(200)
    expect(body).toHaveProperty('auth')
    expect(body).toHaveProperty('build')
    expect(body.db).toBe('ok')
  })
})
