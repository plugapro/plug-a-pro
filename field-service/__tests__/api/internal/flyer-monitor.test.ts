import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockBuildFlyerMonitorReport, mockGetFlyerMonitorReport } = vi.hoisted(() => ({
  mockBuildFlyerMonitorReport: vi.fn(),
  mockGetFlyerMonitorReport: vi.fn(),
}))

vi.mock('@/lib/flyer-monitor', () => ({
  buildFlyerMonitorReport: mockBuildFlyerMonitorReport,
  getFlyerMonitorReport: mockGetFlyerMonitorReport,
}))

import { GET } from '@/app/api/internal/flyer-monitor/route'

describe('GET /api/internal/flyer-monitor', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.env.CRON_SECRET = 'cron-secret'
    mockGetFlyerMonitorReport.mockResolvedValue({
      subject: 'PlugAPro flyer monitor — 0 prospect(s) — 2026-05-29 12:13 SAST',
      generatedAtIso: '2026-05-29T10:13:00.000Z',
      generatedAtSast: '2026-05-29 12:13 SAST',
      prospectCount: 0,
      alertLines: [],
      prospects: [],
      frictionSummary: {
        providerAppPending: 0,
        otpEntry: 0,
        identityLink: 0,
        moreInfoRequired: 0,
        whatsappWelcomeIdle: 0,
        otpDeliveryFailed: 0,
      },
      lifetimeCounts: { customers: 1, providers: 2, providerApplications: 3 },
      securityEvents: [],
      window: {
        startIso: '2026-05-29T04:13:00.000Z',
        endIso: '2026-05-29T10:13:00.000Z',
        nextPollIso: '2026-05-29T16:13:00.000Z',
        startSast: '2026-05-29 06:13 SAST',
        endSast: '2026-05-29 12:13 SAST',
        nextPollSast: '2026-05-29 18:13 SAST',
        baselineApplied: false,
        mode: 'stateless_scheduled_slot',
      },
    })
    mockBuildFlyerMonitorReport.mockReturnValue('## Plug A Pro flyer monitor')
  })

  it('rejects requests without the correct CRON_SECRET', async () => {
    const res = await GET(new Request('http://localhost/api/internal/flyer-monitor', {
      headers: { authorization: 'Bearer wrong' },
    }))

    expect(res.status).toBe(401)
    expect(mockGetFlyerMonitorReport).not.toHaveBeenCalled()
  })

  it('rejects requests when CRON_SECRET is not configured', async () => {
    delete process.env.CRON_SECRET

    const res = await GET(new Request('http://localhost/api/internal/flyer-monitor', {
      headers: { authorization: 'Bearer cron-secret' },
    }))

    expect(res.status).toBe(401)
    expect(mockGetFlyerMonitorReport).not.toHaveBeenCalled()
  })

  it('returns the structured report and markdown when authorized', async () => {
    const res = await GET(new Request('http://localhost/api/internal/flyer-monitor', {
      headers: { authorization: 'Bearer cron-secret' },
    }))
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.ok).toBe(true)
    expect(body.subject).toContain('PlugAPro flyer monitor')
    expect(body.markdown).toContain('Plug A Pro flyer monitor')
    expect(body.report.prospectCount).toBe(0)
    expect(mockBuildFlyerMonitorReport).toHaveBeenCalledWith(body.report)
  })
})
