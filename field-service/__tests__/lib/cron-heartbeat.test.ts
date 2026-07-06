import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockDb } = vi.hoisted(() => ({
  mockDb: {
    cronHeartbeat: {
      upsert: vi.fn(),
      findMany: vi.fn(),
      update: vi.fn(),
    },
  },
}))

vi.mock('../../lib/db', () => ({ db: mockDb }))

import {
  ALERT_THROTTLE_MINUTES,
  CRON_EXPECTED_MAX_GAP_MINUTES,
  getCronHeartbeatSummary,
  isCronStale,
  selectStaleCrons,
  shouldAlertForStaleCron,
  staleThresholdMinutes,
  withCronHeartbeat,
} from '../../lib/cron-heartbeat'

const NOW = new Date('2026-07-06T12:00:00.000Z')

function minutesAgo(minutes: number, now: Date = NOW): Date {
  return new Date(now.getTime() - minutes * 60_000)
}

function heartbeatRow(overrides: Partial<{
  cronKey: string
  lastStartedAt: Date | null
  lastSucceededAt: Date | null
  lastFailedAt: Date | null
  lastError: string | null
  consecutiveFailures: number
  lastAlertAt: Date | null
}> = {}) {
  return {
    cronKey: 'match-leads',
    lastStartedAt: null,
    lastSucceededAt: null,
    lastFailedAt: null,
    lastError: null,
    consecutiveFailures: 0,
    lastAlertAt: null,
    ...overrides,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  mockDb.cronHeartbeat.upsert.mockResolvedValue({})
  mockDb.cronHeartbeat.findMany.mockResolvedValue([])
  mockDb.cronHeartbeat.update.mockResolvedValue({})
})

describe('staleness math', () => {
  it('threshold is 2x the expected max gap', () => {
    expect(staleThresholdMinutes('match-leads')).toBe(60)
    expect(staleThresholdMinutes('expire-payment-intents')).toBe(120)
    expect(staleThresholdMinutes('follow-up')).toBe(2880)
    expect(staleThresholdMinutes('slots')).toBe(20160)
  })

  it('returns null threshold for unknown crons', () => {
    expect(staleThresholdMinutes('not-a-cron')).toBeNull()
  })

  it('flags match-leads stale after 60 minutes without success', () => {
    expect(isCronStale('match-leads', minutesAgo(59), NOW)).toBe(false)
    expect(isCronStale('match-leads', minutesAgo(60), NOW)).toBe(false) // boundary: exactly 2x is allowed
    expect(isCronStale('match-leads', minutesAgo(61), NOW)).toBe(true)
  })

  it('does not flag a daily cron inside its 2x window', () => {
    expect(isCronStale('follow-up', minutesAgo(1440), NOW)).toBe(false)
    expect(isCronStale('follow-up', minutesAgo(2881), NOW)).toBe(true)
  })

  it('treats a row with no success ever as stale', () => {
    expect(isCronStale('match-leads', null, NOW)).toBe(true)
  })

  it('never flags crons without an interval mapping', () => {
    expect(isCronStale('mystery-cron', null, NOW)).toBe(false)
    expect(isCronStale('mystery-cron', minutesAgo(100_000), NOW)).toBe(false)
  })

  it('every cron key in the map yields a positive threshold', () => {
    for (const key of Object.keys(CRON_EXPECTED_MAX_GAP_MINUTES)) {
      expect(staleThresholdMinutes(key)).toBeGreaterThan(0)
    }
  })
})

describe('selectStaleCrons', () => {
  it('returns only stale rows, sorted by cronKey, with minutes since success', () => {
    const rows = [
      heartbeatRow({ cronKey: 'session-timeout', lastSucceededAt: minutesAgo(5) }),
      heartbeatRow({
        cronKey: 'match-leads',
        lastSucceededAt: minutesAgo(90),
        consecutiveFailures: 3,
        lastError: 'boom',
      }),
      heartbeatRow({ cronKey: 'expire-payment-intents', lastSucceededAt: null }),
      heartbeatRow({ cronKey: 'unmapped-cron', lastSucceededAt: null }),
    ]

    const stale = selectStaleCrons(rows, NOW)

    expect(stale.map((s) => s.cronKey)).toEqual(['expire-payment-intents', 'match-leads'])
    expect(stale[0].minutesSinceSuccess).toBeNull()
    expect(stale[1]).toMatchObject({
      cronKey: 'match-leads',
      minutesSinceSuccess: 90,
      thresholdMinutes: 60,
      consecutiveFailures: 3,
      lastError: 'boom',
    })
  })
})

describe('shouldAlertForStaleCron (6h throttle)', () => {
  it('allows the first alert', () => {
    expect(shouldAlertForStaleCron(null, NOW)).toBe(true)
  })

  it('suppresses re-alerts inside 6 hours and allows them after', () => {
    expect(shouldAlertForStaleCron(minutesAgo(ALERT_THROTTLE_MINUTES - 1), NOW)).toBe(false)
    expect(shouldAlertForStaleCron(minutesAgo(ALERT_THROTTLE_MINUTES), NOW)).toBe(true)
    expect(shouldAlertForStaleCron(minutesAgo(ALERT_THROTTLE_MINUTES + 1), NOW)).toBe(true)
  })
})

describe('withCronHeartbeat', () => {
  it('records start then success and returns the handler result', async () => {
    const result = await withCronHeartbeat('match-leads', async () => 'done')

    expect(result).toBe('done')
    expect(mockDb.cronHeartbeat.upsert).toHaveBeenCalledTimes(2)

    const startCall = mockDb.cronHeartbeat.upsert.mock.calls[0][0]
    expect(startCall.where).toEqual({ cronKey: 'match-leads' })
    expect(startCall.update.lastStartedAt).toBeInstanceOf(Date)

    const successCall = mockDb.cronHeartbeat.upsert.mock.calls[1][0]
    expect(successCall.update.lastSucceededAt).toBeInstanceOf(Date)
    expect(successCall.update.consecutiveFailures).toBe(0)
    expect(successCall.update.lastError).toBeNull()
  })

  it('records failure and rethrows when the handler throws', async () => {
    await expect(
      withCronHeartbeat('match-leads', async () => {
        throw new Error('cron exploded')
      }),
    ).rejects.toThrow('cron exploded')

    const failureCall = mockDb.cronHeartbeat.upsert.mock.calls[1][0]
    expect(failureCall.update.lastFailedAt).toBeInstanceOf(Date)
    expect(failureCall.update.lastError).toBe('cron exploded')
    expect(failureCall.update.consecutiveFailures).toEqual({ increment: 1 })
    expect(failureCall.create.consecutiveFailures).toBe(1)
  })

  it('treats a resolved 5xx Response as a failure', async () => {
    const response = new Response('nope', { status: 500 })
    const result = await withCronHeartbeat('match-leads', async () => response)

    expect(result).toBe(response)
    const failureCall = mockDb.cronHeartbeat.upsert.mock.calls[1][0]
    expect(failureCall.update.lastError).toBe('HTTP 500')
  })

  it('treats a resolved 2xx Response as a success', async () => {
    const response = new Response('ok', { status: 200 })
    await withCronHeartbeat('match-leads', async () => response)

    const successCall = mockDb.cronHeartbeat.upsert.mock.calls[1][0]
    expect(successCall.update.lastSucceededAt).toBeInstanceOf(Date)
  })

  it('never lets recorder failures break the handler', async () => {
    mockDb.cronHeartbeat.upsert.mockRejectedValue(new Error('db down'))
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    const result = await withCronHeartbeat('match-leads', async () => 'still ran')

    expect(result).toBe('still ran')
    expect(consoleSpy).toHaveBeenCalled()
    consoleSpy.mockRestore()
  })

  it('still rethrows the handler error when the failure recorder also fails', async () => {
    mockDb.cronHeartbeat.upsert.mockRejectedValue(new Error('db down'))
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    await expect(
      withCronHeartbeat('match-leads', async () => {
        throw new Error('handler error')
      }),
    ).rejects.toThrow('handler error')

    consoleSpy.mockRestore()
  })

  it('truncates very long error messages', async () => {
    const longMessage = 'x'.repeat(600)
    await expect(
      withCronHeartbeat('match-leads', async () => {
        throw new Error(longMessage)
      }),
    ).rejects.toThrow()

    const failureCall = mockDb.cronHeartbeat.upsert.mock.calls[1][0]
    expect((failureCall.update.lastError as string).length).toBeLessThanOrEqual(501)
  })
})

describe('getCronHeartbeatSummary', () => {
  it('queries only mapped cron keys and returns totals plus stale subset', async () => {
    mockDb.cronHeartbeat.findMany.mockResolvedValue([
      heartbeatRow({ cronKey: 'match-leads', lastSucceededAt: minutesAgo(120) }),
      heartbeatRow({ cronKey: 'reminders', lastSucceededAt: minutesAgo(60) }),
    ])

    const summary = await getCronHeartbeatSummary(NOW)

    expect(mockDb.cronHeartbeat.findMany).toHaveBeenCalledWith({
      where: { cronKey: { in: Object.keys(CRON_EXPECTED_MAX_GAP_MINUTES) } },
    })
    expect(summary.total).toBe(2)
    expect(summary.stale.map((s) => s.cronKey)).toEqual(['match-leads'])
  })
})
