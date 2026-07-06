// SRE-03: cron route wrapper for the inbound WhatsApp dead-letter re-drive.
// Auth (CRON_SECRET) + delegation to the lib sweep.

import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockRun } = vi.hoisted(() => ({ mockRun: vi.fn() }))

vi.mock('@/lib/inbound-whatsapp-redrive', () => ({
  runInboundWhatsappRedrive: mockRun,
}))

import { GET } from '@/app/api/cron/inbound-whatsapp-redrive/route'

describe('GET /api/cron/inbound-whatsapp-redrive', () => {
  const CRON_SECRET = 'cron-secret'

  beforeEach(() => {
    vi.clearAllMocks()
    process.env.CRON_SECRET = CRON_SECRET
    mockRun.mockResolvedValue({ skipped: false, considered: 2, reprocessed: 1, failed: 1, skippedClaim: 0 })
  })

  function request(auth?: string) {
    return new Request('http://localhost/api/cron/inbound-whatsapp-redrive', {
      headers: auth ? { authorization: auth } : {},
    })
  }

  it('rejects requests without the configured CRON_SECRET', async () => {
    const res = await GET(request('Bearer wrong'))
    expect(res.status).toBe(401)
    expect(mockRun).not.toHaveBeenCalled()
  })

  it('rejects when CRON_SECRET is unset (fail closed)', async () => {
    delete process.env.CRON_SECRET
    const res = await GET(request(`Bearer ${CRON_SECRET}`))
    expect(res.status).toBe(401)
    expect(mockRun).not.toHaveBeenCalled()
  })

  it('runs the sweep and returns its summary', async () => {
    const res = await GET(request(`Bearer ${CRON_SECRET}`))
    const body = await res.json()
    expect(res.status).toBe(200)
    expect(mockRun).toHaveBeenCalledTimes(1)
    expect(body).toMatchObject({ skipped: false, considered: 2, reprocessed: 1, failed: 1 })
  })

  it('surfaces the flag-off no-op summary', async () => {
    mockRun.mockResolvedValue({ skipped: true, reason: 'flag_disabled', considered: 0, reprocessed: 0, failed: 0, skippedClaim: 0 })
    const res = await GET(request(`Bearer ${CRON_SECRET}`))
    const body = await res.json()
    expect(body).toMatchObject({ skipped: true, reason: 'flag_disabled' })
  })
})
