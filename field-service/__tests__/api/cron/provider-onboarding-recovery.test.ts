import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockListRows, mockSummarizeRows } = vi.hoisted(() => ({
  mockListRows: vi.fn(),
  mockSummarizeRows: vi.fn(),
}))

vi.mock('@/lib/provider-onboarding-recovery', () => ({
  listProviderOnboardingRecoveryRows: mockListRows,
  summarizeProviderOnboardingRecoveryRows: mockSummarizeRows,
}))

import { GET } from '@/app/api/cron/provider-onboarding-recovery/route'

describe('GET /api/cron/provider-onboarding-recovery', () => {
  const CRON_SECRET = 'cron-secret'

  beforeEach(() => {
    vi.clearAllMocks()
    process.env.CRON_SECRET = CRON_SECRET
    const rows = [
      { stage: 'evidence_upload', followUpStatus: 'due' },
      { stage: 'approved', followUpStatus: 'submitted_excluded' },
    ]
    mockListRows.mockResolvedValue(rows)
    mockSummarizeRows.mockReturnValue({
      total: rows.length,
      byStage: { evidence_upload: 1, approved: 1 },
      dueFollowUps: 1,
      submitted: 1,
      approved: 1,
      pending: 0,
    })
  })

  it('rejects requests without the configured CRON_SECRET', async () => {
    const res = await GET(new Request('http://localhost/api/cron/provider-onboarding-recovery', {
      headers: { authorization: 'Bearer wrong' },
    }))

    expect(res.status).toBe(401)
    expect(mockListRows).not.toHaveBeenCalled()
  })

  it('reports due onboarding recovery rows without sending WhatsApp messages', async () => {
    const res = await GET(new Request('http://localhost/api/cron/provider-onboarding-recovery', {
      headers: { authorization: `Bearer ${CRON_SECRET}` },
    }))

    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body).toMatchObject({
      ok: true,
      mode: 'manual_queue_only',
      total: 2,
      dueFollowUps: 1,
    })
    expect(body).not.toHaveProperty('sent')
    expect(mockListRows).toHaveBeenCalledWith(expect.any(Object), expect.objectContaining({
      now: expect.any(Date),
    }))
    expect(mockSummarizeRows).toHaveBeenCalledWith([
      { stage: 'evidence_upload', followUpStatus: 'due' },
      { stage: 'approved', followUpStatus: 'submitted_excluded' },
    ])
  })
})
