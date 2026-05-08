import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockAutoApprove, mockIsEnabled } = vi.hoisted(() => ({
  mockAutoApprove: vi.fn(),
  mockIsEnabled: vi.fn(),
}))

vi.mock('@/lib/provider-auto-approve', () => ({
  autoApproveProviderApplications: mockAutoApprove,
}))

vi.mock('@/lib/flags', () => ({
  isEnabled: mockIsEnabled,
}))

import { GET } from '@/app/api/cron/provider-auto-approve/route'

describe('GET /api/cron/provider-auto-approve', () => {
  const CRON_SECRET = 'cron-secret'

  beforeEach(() => {
    vi.clearAllMocks()
    process.env.CRON_SECRET = CRON_SECRET
    mockIsEnabled.mockResolvedValue(true)
    mockAutoApprove.mockResolvedValue({
      attempted: 2,
      approved: 2,
      skipped: 0,
      errors: 0,
      txAborts: 0,
      sideEffectSummary: {
        promoAwarded: 2,
        promoFailed: 0,
        notifyQueued: 2,
        queueReleased: 2,
        enrichmentQueued: 2,
      },
      reconciliation: { scanned: 0, replayed: 0, skipped: 0, hardFailed: 0 },
      skippedReasons: [],
    })
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

  it('skips auto-approval when provider.onboarding.auto_approve flag is disabled', async () => {
    mockIsEnabled.mockResolvedValue(false)

    const res = await GET(new Request('http://localhost/api/cron/provider-auto-approve', {
      headers: { authorization: `Bearer ${CRON_SECRET}` },
    }))

    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body).toMatchObject({ ok: true, skipped: true, reason: 'FEATURE_FLAG_DISABLED' })
    expect(mockAutoApprove).not.toHaveBeenCalled()
  })

  it('runs auto-approval with the current DB client when authorized', async () => {
    const res = await GET(new Request('http://localhost/api/cron/provider-auto-approve', {
      headers: { authorization: `Bearer ${CRON_SECRET}` },
    }))

    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body).toMatchObject({
      ok: true,
      attempted: 2,
      approved: 2,
      errors: 0,
    })
    expect(mockAutoApprove).toHaveBeenCalledTimes(1)
    expect(mockAutoApprove).toHaveBeenCalledWith(expect.any(Object), expect.objectContaining({
      runId: expect.any(String),
    }))
  })
})
