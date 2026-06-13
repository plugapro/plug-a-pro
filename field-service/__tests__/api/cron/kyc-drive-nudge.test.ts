import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockListCandidates, mockSendNudges, mockSummarize } = vi.hoisted(() => ({
  mockListCandidates: vi.fn(),
  mockSendNudges: vi.fn(),
  mockSummarize: vi.fn(),
}))
const { mockIsEnabled } = vi.hoisted(() => ({
  mockIsEnabled: vi.fn(),
}))
const { mockIssueLink, mockSendTemplate } = vi.hoisted(() => ({
  mockIssueLink: vi.fn(),
  mockSendTemplate: vi.fn(),
}))

vi.mock('@/lib/kyc-drive/nudge', () => ({
  KYC_DRIVE_TEMPLATE: 'provider_kyc_nudge',
  listKycNudgeCandidates: mockListCandidates,
  sendKycDriveNudges: mockSendNudges,
  summarizeKycNudgeRows: mockSummarize,
}))
vi.mock('@/lib/flags', async () => {
  const actual = await vi.importActual<typeof import('@/lib/flags')>('@/lib/flags')
  return {
    ...actual,
    isEnabled: mockIsEnabled,
  }
})
vi.mock('@/lib/identity-verification/link', () => ({
  issueProviderIdentityVerificationLink: mockIssueLink,
}))
vi.mock('@/lib/whatsapp', () => ({
  sendProviderKycNudge: mockSendTemplate,
}))

import { GET } from '@/app/api/cron/kyc-drive-nudge/route'

describe('GET /api/cron/kyc-drive-nudge', () => {
  const CRON_SECRET = 'cron-secret'

  beforeEach(() => {
    vi.clearAllMocks()
    process.env.CRON_SECRET = CRON_SECRET
    delete process.env.KYC_DRIVE_NUDGE_DEADLINE
    mockIsEnabled.mockResolvedValue(false)
    mockListCandidates.mockResolvedValue([])
    mockSummarize.mockReturnValue({ candidates: 3, eligibleNow: 2, exhausted: 1 })
    mockSendNudges.mockResolvedValue({ rows: [], sent: 2, skipped: 0, errors: 0 })
  })

  function request() {
    return new Request('http://localhost/api/cron/kyc-drive-nudge', {
      headers: { authorization: `Bearer ${CRON_SECRET}` },
    })
  }

  it('rejects requests without the configured CRON_SECRET', async () => {
    const res = await GET(new Request('http://localhost/api/cron/kyc-drive-nudge', {
      headers: { authorization: 'Bearer wrong' },
    }))
    expect(res.status).toBe(401)
    expect(mockSendNudges).not.toHaveBeenCalled()
  })

  it('is report-only by default: never sends while kyc_drive.auto_nudge is off', async () => {
    const res = await GET(request())
    const body = await res.json()
    expect(body.mode).toBe('report_only')
    expect(body.sent).toBe(0)
    expect(body.candidates).toBe(3)
    expect(mockSendNudges).not.toHaveBeenCalled()
  })

  it('fails closed when the flag is on but no deadline is configured', async () => {
    mockIsEnabled.mockResolvedValue(true)
    const res = await GET(request())
    const body = await res.json()
    expect(res.status).toBe(500)
    expect(body.mode).toBe('missing_deadline')
    expect(mockSendNudges).not.toHaveBeenCalled()
  })

  it('sends with the configured deadline when the flag is on', async () => {
    mockIsEnabled.mockResolvedValue(true)
    process.env.KYC_DRIVE_NUDGE_DEADLINE = '30 June 2026'
    const res = await GET(request())
    const body = await res.json()
    expect(body.mode).toBe('auto_nudge')
    expect(body.sent).toBe(2)
    expect(mockSendNudges).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      deadline: '30 June 2026',
      batchCap: 25,
    }))
  })
})
