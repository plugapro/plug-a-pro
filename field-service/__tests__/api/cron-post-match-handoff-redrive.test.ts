import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockDb } = vi.hoisted(() => ({
  mockDb: {
    lead: { findMany: vi.fn() },
    messageEvent: { findFirst: vi.fn() },
  },
}))
vi.mock('@/lib/db', () => ({ db: mockDb }))

const mockIsEnabled = vi.fn()
vi.mock('@/lib/flags', () => ({ isEnabled: mockIsEnabled }))

const mockNotifyPostMatchAcceptance = vi.fn()
vi.mock('@/lib/post-match-communications', () => ({
  notifyPostMatchAcceptance: mockNotifyPostMatchAcceptance,
}))

function cronRequest(authHeader: string | null) {
  return new Request('http://localhost/api/cron/post-match-handoff-redrive', {
    method: 'GET',
    headers: authHeader ? { authorization: authHeader } : {},
  })
}

function strandedLead(overrides: Record<string, unknown> = {}) {
  return {
    id: 'lead-1',
    providerId: 'provider-1',
    jobRequestId: 'request-1',
    providerAcceptedAt: new Date('2026-09-08T10:00:00Z'),
    ...overrides,
  }
}

async function run(authHeader: string | null = 'Bearer cron-secret') {
  const { GET } = await import('@/app/api/cron/post-match-handoff-redrive/route')
  return GET(cronRequest(authHeader))
}

describe('GET /api/cron/post-match-handoff-redrive', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    vi.stubEnv('CRON_SECRET', 'cron-secret')
    mockIsEnabled.mockResolvedValue(true)
    mockDb.lead.findMany.mockResolvedValue([])
    mockDb.messageEvent.findFirst.mockResolvedValue(null)
    mockNotifyPostMatchAcceptance.mockResolvedValue({ providerNotified: true, customerNotified: true })
  })

  it('rejects a request without the cron secret', async () => {
    const response = await run(null)
    expect(response.status).toBe(401)
    expect(mockDb.lead.findMany).not.toHaveBeenCalled()
  })

  it('does nothing while the flag is off', async () => {
    mockIsEnabled.mockResolvedValue(false)
    const body = await (await run()).json()
    expect(body).toMatchObject({ ok: true, redriven: 0, disabled: true })
    expect(mockDb.lead.findMany).not.toHaveBeenCalled()
  })

  it('re-sends the handoff for an acceptance that was never followed up', async () => {
    mockDb.lead.findMany.mockResolvedValue([strandedLead()])

    const body = await (await run()).json()

    expect(mockNotifyPostMatchAcceptance).toHaveBeenCalledWith({
      leadId: 'lead-1',
      providerId: 'provider-1',
    })
    expect(body).toMatchObject({ ok: true, scanned: 1, redriven: 1, alreadyHandled: 0, failed: 0 })
  })

  it('leaves an acceptance alone once a handoff message has landed', async () => {
    mockDb.lead.findMany.mockResolvedValue([strandedLead()])
    mockDb.messageEvent.findFirst.mockResolvedValue({ id: 'evt-1' })

    const body = await (await run()).json()

    expect(mockNotifyPostMatchAcceptance).not.toHaveBeenCalled()
    expect(body).toMatchObject({ redriven: 0, alreadyHandled: 1 })
  })

  it('only counts a delivered handoff template as proof', async () => {
    mockDb.lead.findMany.mockResolvedValue([strandedLead()])
    await run()

    expect(mockDb.messageEvent.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          leadId: 'lead-1',
          templateName: { in: ['provider_job_accepted_next_steps', 'post_match_provider_job_accepted'] },
          status: { in: ['SENT', 'DELIVERED', 'READ'] },
        }),
      }),
    )
  })

  it('scans only recent, non-test acceptances', async () => {
    await run()
    const where = mockDb.lead.findMany.mock.calls[0]![0].where

    expect(where.isTestLead).toBe(false)
    const { gte, lte } = where.providerAcceptedAt
    const windowHours = (lte.getTime() - gte.getTime()) / 3_600_000
    // 48h upper bound minus the 10-minute settling period.
    expect(windowHours).toBeCloseTo(48 - 10 / 60, 5)
    expect(lte.getTime()).toBeLessThan(Date.now())
  })

  it('keeps going when one lead fails and reports the failure', async () => {
    mockDb.lead.findMany.mockResolvedValue([
      strandedLead({ id: 'lead-1' }),
      strandedLead({ id: 'lead-2', providerId: 'provider-2' }),
    ])
    mockNotifyPostMatchAcceptance
      .mockRejectedValueOnce(new Error('whatsapp timeout'))
      .mockResolvedValueOnce({ providerNotified: true, customerNotified: false })
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)

    const body = await (await run()).json()

    expect(body).toMatchObject({ scanned: 2, redriven: 1, failed: 1 })
    expect(mockNotifyPostMatchAcceptance).toHaveBeenCalledTimes(2)
    consoleError.mockRestore()
  })
})
