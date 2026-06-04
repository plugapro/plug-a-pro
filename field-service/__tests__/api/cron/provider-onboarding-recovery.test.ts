import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockListRows, mockSummarizeRows, mockSendFollowUps } = vi.hoisted(() => ({
  mockListRows: vi.fn(),
  mockSummarizeRows: vi.fn(),
  mockSendFollowUps: vi.fn(),
}))

vi.mock('@/lib/provider-onboarding-recovery', () => ({
  listProviderOnboardingRecoveryRows: mockListRows,
  sendProviderOnboardingRecoveryFollowUps: mockSendFollowUps,
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
    mockSendFollowUps.mockResolvedValue({
      total: rows.length,
      due: 1,
      sent: 1,
      skipped: 0,
      errors: 0,
      rows,
      sentRefs: ['wa_sent'],
      skippedRefs: [],
      errorRefs: [],
    })
  })

  it('rejects requests without the configured CRON_SECRET', async () => {
    const res = await GET(new Request('http://localhost/api/cron/provider-onboarding-recovery', {
      headers: { authorization: 'Bearer wrong' },
    }))

    expect(res.status).toBe(401)
    expect(mockListRows).not.toHaveBeenCalled()
  })

  it('sends audited onboarding recovery nudges on scheduled runs', async () => {
    const res = await GET(new Request('http://localhost/api/cron/provider-onboarding-recovery', {
      headers: { authorization: `Bearer ${CRON_SECRET}` },
    }))

    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body).toMatchObject({
      ok: true,
      mode: 'automated_nudges',
      total: 2,
      dueFollowUps: 1,
      sent: 1,
      skipped: 0,
      errors: 0,
    })
    expect(body.sentRefs).toEqual(['wa_sent'])
    expect(mockSendFollowUps).toHaveBeenCalledWith(expect.any(Object), expect.objectContaining({
      now: expect.any(Date),
    }))
    expect(mockSummarizeRows).toHaveBeenCalledWith([
      { stage: 'evidence_upload', followUpStatus: 'due' },
      { stage: 'approved', followUpStatus: 'submitted_excluded' },
    ])
  })

  it('supports dry-run reporting without sending WhatsApp messages', async () => {
    const res = await GET(new Request('http://localhost/api/cron/provider-onboarding-recovery?dryRun=1', {
      headers: { authorization: `Bearer ${CRON_SECRET}` },
    }))

    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body).toMatchObject({
      ok: true,
      mode: 'dry_run',
      total: 2,
      dueFollowUps: 1,
      sent: 0,
    })
    expect(mockSendFollowUps).not.toHaveBeenCalled()
    expect(mockListRows).toHaveBeenCalledWith(expect.any(Object), expect.objectContaining({
      now: expect.any(Date),
    }))
  })
})
