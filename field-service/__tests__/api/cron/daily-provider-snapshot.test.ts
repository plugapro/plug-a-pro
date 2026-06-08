import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockDb, mockCollect, mockPersist, mockSendDigest, mockIsEnabled } =
  vi.hoisted(() => ({
    mockDb: {
      providerApplication: {
        groupBy: vi.fn(),
        count: vi.fn(),
      },
      provider: {
        count: vi.fn(),
      },
      providerApplicationDraft: {
        groupBy: vi.fn(),
      },
      messageEvent: {
        count: vi.fn(),
      },
      otpDeliveryAttempt: {
        count: vi.fn(),
      },
      providerWallet: {
        aggregate: vi.fn(),
      },
      leadUnlock: {
        count: vi.fn(),
      },
      jobRequest: {
        count: vi.fn(),
      },
      dailyProviderSnapshot: {
        upsert: vi.fn(),
      },
      $queryRaw: vi.fn(),
    },
    mockCollect: vi.fn(),
    mockPersist: vi.fn(),
    mockSendDigest: vi.fn(),
    mockIsEnabled: vi.fn(),
  }))

vi.mock('@/lib/db', () => ({ db: mockDb }))
vi.mock('@/lib/flags', () => ({ isEnabled: mockIsEnabled }))
vi.mock('@/lib/operational-snapshots/daily-provider-snapshot', () => ({
  collectDailyProviderSnapshot: mockCollect,
  persistDailyProviderSnapshot: mockPersist,
  sendDailySnapshotDigest: mockSendDigest,
}))

function cronRequest(authHeader?: string) {
  return new Request('http://localhost/api/internal/cron/daily-provider-snapshot', {
    method: 'GET',
    headers: authHeader ? { authorization: authHeader } : {},
  })
}

const SAMPLE_METRICS = {
  snapshotDate: new Date('2026-06-07T00:00:00Z'),
  appsApproved: 29,
  appsPending: 11,
  appsMoreInfo: 1,
  providersActive: 30,
  providersVerified: 30,
  pendingBreachingSla: 10,
  approvalP50Minutes: 16.1,
  approvalP90Minutes: 494.7,
  approvalSlaHitRate: 0.6897,
  whatsappOutbound30d: 619,
  otpAttempts30d: 9,
  promoCreditsHeld: 30,
  paidCreditsHeld: 0,
  leadUnlocks30d: 0,
  jobRequests30d: 1,
  applicationsLast7d: 41,
  approvedLast7d: 29,
  rawMetricsJson: {},
}

describe('GET /api/internal/cron/daily-provider-snapshot', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    vi.stubEnv('CRON_SECRET', 'test-cron-secret')
    mockCollect.mockResolvedValue(SAMPLE_METRICS)
    mockPersist.mockResolvedValue({
      id: 'snap_1',
      snapshotDate: SAMPLE_METRICS.snapshotDate,
    })
    // Default: flag OFF → digest path stays dormant unless a test opts in.
    mockIsEnabled.mockResolvedValue(false)
    mockSendDigest.mockResolvedValue({ sent: false, reason: 'no_admin_phone' })
  })

  it('rejects requests without an authorization header', async () => {
    const { GET } = await import(
      '@/app/api/internal/cron/daily-provider-snapshot/route'
    )
    const res = await GET(cronRequest())

    expect(res.status).toBe(401)
    expect(mockCollect).not.toHaveBeenCalled()
    expect(mockPersist).not.toHaveBeenCalled()
  })

  it('rejects requests with a wrong bearer token', async () => {
    const { GET } = await import(
      '@/app/api/internal/cron/daily-provider-snapshot/route'
    )
    const res = await GET(cronRequest('Bearer wrong-secret'))

    expect(res.status).toBe(401)
    expect(mockCollect).not.toHaveBeenCalled()
    expect(mockPersist).not.toHaveBeenCalled()
  })

  it('rejects when CRON_SECRET env is unset (no implicit allow)', async () => {
    vi.stubEnv('CRON_SECRET', '')
    const { GET } = await import(
      '@/app/api/internal/cron/daily-provider-snapshot/route'
    )
    const res = await GET(cronRequest('Bearer test-cron-secret'))

    expect(res.status).toBe(401)
    expect(mockCollect).not.toHaveBeenCalled()
    expect(mockPersist).not.toHaveBeenCalled()
  })

  it('writes a snapshot and returns top-line metrics on success', async () => {
    const { GET } = await import(
      '@/app/api/internal/cron/daily-provider-snapshot/route'
    )
    const res = await GET(cronRequest('Bearer test-cron-secret'))

    expect(res.status).toBe(200)
    expect(mockCollect).toHaveBeenCalledTimes(1)
    expect(mockPersist).toHaveBeenCalledTimes(1)
    expect(mockPersist).toHaveBeenCalledWith(mockDb, SAMPLE_METRICS)

    const body = await res.json()
    expect(body).toMatchObject({
      ok: true,
      cron: 'daily-provider-snapshot',
      snapshotDate: '2026-06-07',
      snapshotId: 'snap_1',
      metrics: {
        appsApproved: 29,
        appsPending: 11,
        appsMoreInfo: 1,
        providersActive: 30,
        providersVerified: 30,
        pendingBreachingSla: 10,
        approvalSlaHitRate: 0.6897,
        whatsappOutbound30d: 619,
        otpAttempts30d: 9,
        promoCreditsHeld: 30,
        leadUnlocks30d: 0,
        jobRequests30d: 1,
        applicationsLast7d: 41,
        approvedLast7d: 29,
      },
    })
    expect(typeof body.durationMs).toBe('number')
  })

  it('returns a 500 with a stable shape when collection fails', async () => {
    mockCollect.mockRejectedValueOnce(new Error('connection refused'))
    const { GET } = await import(
      '@/app/api/internal/cron/daily-provider-snapshot/route'
    )
    const res = await GET(cronRequest('Bearer test-cron-secret'))

    expect(res.status).toBe(500)
    const body = await res.json()
    expect(body).toEqual({
      ok: false,
      cron: 'daily-provider-snapshot',
      error: 'snapshot_failed',
    })
    expect(mockPersist).not.toHaveBeenCalled()
  })

  it('returns a 500 when persist fails (collection succeeded, no partial write leakage)', async () => {
    mockPersist.mockRejectedValueOnce(new Error('upsert race'))
    const { GET } = await import(
      '@/app/api/internal/cron/daily-provider-snapshot/route'
    )
    const res = await GET(cronRequest('Bearer test-cron-secret'))

    expect(res.status).toBe(500)
    expect(mockCollect).toHaveBeenCalledTimes(1)
    expect(mockPersist).toHaveBeenCalledTimes(1)
  })

  it('POST alias accepts the same auth and behaviour', async () => {
    const { POST } = await import(
      '@/app/api/internal/cron/daily-provider-snapshot/route'
    )
    const res = await POST(cronRequest('Bearer test-cron-secret'))

    expect(res.status).toBe(200)
    expect(mockCollect).toHaveBeenCalledTimes(1)
    expect(mockPersist).toHaveBeenCalledTimes(1)
  })

  // ─── WhatsApp digest (default-off, non-blocking) ────────────────────────────

  it('does NOT attempt to send the WhatsApp digest when the feature flag is disabled (default)', async () => {
    const { GET } = await import(
      '@/app/api/internal/cron/daily-provider-snapshot/route'
    )
    const res = await GET(cronRequest('Bearer test-cron-secret'))

    expect(res.status).toBe(200)
    expect(mockIsEnabled).toHaveBeenCalledWith('ops.daily_snapshot_whatsapp_digest')
    expect(mockSendDigest).not.toHaveBeenCalled()
    const body = await res.json()
    expect(body.digest).toEqual({ sent: false, reason: 'flag_disabled' })
  })

  it('attempts to send the digest and surfaces sent=true in the response when the flag is enabled', async () => {
    mockIsEnabled.mockResolvedValueOnce(true)
    mockSendDigest.mockResolvedValueOnce({ sent: true, messageId: 'wamid.test_1' })
    const { GET } = await import(
      '@/app/api/internal/cron/daily-provider-snapshot/route'
    )
    const res = await GET(cronRequest('Bearer test-cron-secret'))

    expect(res.status).toBe(200)
    expect(mockSendDigest).toHaveBeenCalledTimes(1)
    expect(mockSendDigest).toHaveBeenCalledWith(SAMPLE_METRICS)
    const body = await res.json()
    expect(body.digest).toEqual({ sent: true, messageId: 'wamid.test_1' })
  })

  it('still returns 200 + persists when the digest send fails (non-blocking)', async () => {
    mockIsEnabled.mockResolvedValueOnce(true)
    mockSendDigest.mockResolvedValueOnce({
      sent: false,
      reason: 'send_failed',
      error: 'template not approved',
    })
    const { GET } = await import(
      '@/app/api/internal/cron/daily-provider-snapshot/route'
    )
    const res = await GET(cronRequest('Bearer test-cron-secret'))

    expect(res.status).toBe(200)
    expect(mockPersist).toHaveBeenCalledTimes(1)
    const body = await res.json()
    expect(body.ok).toBe(true)
    expect(body.snapshotId).toBe('snap_1')
    expect(body.digest).toEqual({
      sent: false,
      reason: 'send_failed',
      error: 'template not approved',
    })
  })

  it('still returns 200 when the digest path is enabled but ADMIN_WHATSAPP_NUMBER is unset', async () => {
    mockIsEnabled.mockResolvedValueOnce(true)
    mockSendDigest.mockResolvedValueOnce({ sent: false, reason: 'no_admin_phone' })
    const { GET } = await import(
      '@/app/api/internal/cron/daily-provider-snapshot/route'
    )
    const res = await GET(cronRequest('Bearer test-cron-secret'))

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.digest).toEqual({ sent: false, reason: 'no_admin_phone' })
  })
})
