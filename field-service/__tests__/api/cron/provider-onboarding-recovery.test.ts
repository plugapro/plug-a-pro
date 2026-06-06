import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockSendFollowUps, mockSummarizeRows, mockIsEnabled, mockSendTemplate } = vi.hoisted(() => ({
  mockSendFollowUps: vi.fn(),
  mockSummarizeRows: vi.fn(),
  mockIsEnabled: vi.fn(),
  mockSendTemplate: vi.fn(),
}))

vi.mock('@/lib/provider-onboarding-recovery', () => ({
  sendProviderOnboardingRecoveryFollowUps: mockSendFollowUps,
  summarizeProviderOnboardingRecoveryRows: mockSummarizeRows,
}))

vi.mock('@/lib/flags', () => ({
  isEnabled: mockIsEnabled,
}))

vi.mock('@/lib/whatsapp', () => ({
  sendTemplate: mockSendTemplate,
}))

import { GET } from '@/app/api/cron/provider-onboarding-recovery/route'

describe('GET /api/cron/provider-onboarding-recovery', () => {
  const CRON_SECRET = 'cron-secret'

  beforeEach(() => {
    vi.clearAllMocks()
    process.env.CRON_SECRET = CRON_SECRET
    mockIsEnabled.mockResolvedValue(false)
    const rows = [
      { stage: 'evidence_upload', followUpStatus: 'due' },
      { stage: 'approved', followUpStatus: 'submitted_excluded' },
    ]
    mockSendFollowUps.mockResolvedValue({
      total: rows.length,
      due: 1,
      sent: 1,
      skipped: 0,
      errors: 0,
      rows,
    })
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
    expect(mockSendFollowUps).not.toHaveBeenCalled()
  })

  it('sends due onboarding recovery nudges and reports the queue summary', async () => {
    const res = await GET(new Request('http://localhost/api/cron/provider-onboarding-recovery', {
      headers: { authorization: `Bearer ${CRON_SECRET}` },
    }))

    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body).toMatchObject({
      ok: true,
      mode: 'auto_nudge',
      total: 2,
      dueFollowUps: 1,
      sent: 1,
      skipped: 0,
      errors: 0,
    })
    expect(mockSendFollowUps).toHaveBeenCalledWith(expect.any(Object), expect.objectContaining({
      now: expect.any(Date),
      sendTemplate: mockSendTemplate,
      templateFlagEnabled: false,
    }))
    expect(mockSummarizeRows).toHaveBeenCalledWith([
      { stage: 'evidence_upload', followUpStatus: 'due' },
      { stage: 'approved', followUpStatus: 'submitted_excluded' },
    ])
  })
})
