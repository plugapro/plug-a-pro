import { describe, it, expect, vi, beforeEach } from 'vitest'

// ─── Mocks ────────────────────────────────────────────────────────────────────

vi.mock('@/lib/db', () => ({
  db: {
    $queryRaw: vi.fn(),
  },
}))

// ─── GET /api/health ──────────────────────────────────────────────────────────

describe('GET /api/health', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.resetModules()
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

  it('includes payments field in response (unknown when credentials not set)', async () => {
    const { db } = await import('@/lib/db')
    ;(db.$queryRaw as ReturnType<typeof vi.fn>).mockResolvedValue([{ '?column?': 1 }])

    const { GET } = await import('../../app/api/health/route')
    const res = await GET()
    const body = await res.json()

    expect(body).toHaveProperty('payments')
    expect(['ok', 'unknown']).toContain(body.payments as string)
  })
})
