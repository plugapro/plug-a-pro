import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockAutoApprove } = vi.hoisted(() => ({
  mockAutoApprove: vi.fn(),
}))

vi.mock('@/lib/provider-auto-approve', () => ({
  autoApproveProviderApplications: mockAutoApprove,
}))

import { GET } from '@/app/api/cron/provider-auto-approve/route'

describe('GET /api/cron/provider-auto-approve', () => {
  const CRON_SECRET = 'cron-secret'

  beforeEach(() => {
    vi.clearAllMocks()
    process.env.CRON_SECRET = CRON_SECRET
    mockAutoApprove.mockResolvedValue({ approved: 2, skipped: 1, errors: 0 })
  })

  it('rejects requests without the correct CRON_SECRET', async () => {
    const res = await GET(new Request('http://localhost/api/cron/provider-auto-approve', {
      headers: { authorization: 'Bearer wrong' },
    }))

    expect(res.status).toBe(401)
    expect(mockAutoApprove).not.toHaveBeenCalled()
  })

  it('rejects requests when CRON_SECRET is not configured', async () => {
    delete process.env.CRON_SECRET

    const res = await GET(new Request('http://localhost/api/cron/provider-auto-approve', {
      headers: { authorization: `Bearer ${CRON_SECRET}` },
    }))

    expect(res.status).toBe(401)
    expect(mockAutoApprove).not.toHaveBeenCalled()
  })

  it('runs auto-approval with the current DB client when authorized', async () => {
    const res = await GET(new Request('http://localhost/api/cron/provider-auto-approve', {
      headers: { authorization: `Bearer ${CRON_SECRET}` },
    }))

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true, approved: 2, skipped: 1, errors: 0 })
    expect(mockAutoApprove).toHaveBeenCalledTimes(1)
  })
})
