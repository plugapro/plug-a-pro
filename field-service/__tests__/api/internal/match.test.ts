import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockOrchestrateMatch } = vi.hoisted(() => ({
  mockOrchestrateMatch: vi.fn(),
}))
const { mockRequireRoleApi } = vi.hoisted(() => ({
  mockRequireRoleApi: vi.fn(),
}))

const unauthorizedAuthResponse = new Response(
  JSON.stringify({ error: { code: 'UNAUTHORIZED', message: 'Authentication required' } }),
  { status: 401 },
)
const forbiddenAuthResponse = new Response(
  JSON.stringify({ error: { code: 'FORBIDDEN', message: 'Insufficient permissions' } }),
  { status: 403 },
)

const adminActor = {
  id: 'admin-user-id',
  email: 'ops@example.com',
  phone: null,
  role: 'admin',
  adminRole: 'ADMIN',
  adminUserId: 'admin-db-id',
}

vi.mock('@/lib/matching/orchestrator', () => ({
  orchestrateMatch: mockOrchestrateMatch,
}))

vi.mock('@/lib/auth', () => ({
  requireRoleApi: mockRequireRoleApi,
}))

import { POST } from '@/app/api/internal/match/route'

const CRON_SECRET = 'test-secret'

function makeRequest(
  body: Record<string, unknown> | string | null,
  useCronSecret = true,
) {
  return new Request('http://localhost/api/internal/match', {
    method: 'POST',
    ...(useCronSecret ? { headers: { authorization: `Bearer ${CRON_SECRET}` } } : {}),
    body: typeof body === 'string' ? body : JSON.stringify(body),
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  process.env.CRON_SECRET = CRON_SECRET
  mockRequireRoleApi.mockResolvedValue(unauthorizedAuthResponse)
  mockOrchestrateMatch.mockResolvedValue({
    status: 'NO_MATCH',
    filteredOut: [],
    consideredCount: 0,
  })
})

describe('POST /api/internal/match', () => {
  it('returns 401 when CRON_SECRET is missing or wrong', async () => {
    const resWrongSecret = await POST(
      new Request('http://localhost/api/internal/match', {
        method: 'POST',
        headers: { authorization: 'Bearer wrong' },
        body: JSON.stringify({ jobRequestId: 'job-1' }),
      }),
    )
    const resMissingSecret = await POST(
      new Request('http://localhost/api/internal/match', {
        method: 'POST',
        body: JSON.stringify({ jobRequestId: 'job-1' }),
      }),
    )

    expect(resWrongSecret.status).toBe(401)
    expect(resMissingSecret.status).toBe(401)
  })

  it('returns 400 when body is invalid', async () => {
    const res = await POST(makeRequest('not-json'))

    expect(res.status).toBe(400)
    expect(await res.json()).toMatchObject({ error: 'Invalid request body' })
  })

  it('returns 400 when jobRequestId is missing', async () => {
    const res = await POST(makeRequest({}))

    expect(res.status).toBe(400)
    expect(await res.json()).toMatchObject({ error: 'jobRequestId required' })
    expect(mockOrchestrateMatch).not.toHaveBeenCalled()
  })

  it('returns 400 when triggeredBy is invalid', async () => {
    const res = await POST(makeRequest({ jobRequestId: 'job-1', triggeredBy: 'bad-trigger' }))

    expect(res.status).toBe(400)
    expect(await res.json()).toMatchObject({ error: 'Invalid triggeredBy' })
    expect(mockOrchestrateMatch).not.toHaveBeenCalled()
  })

  it('returns 400 when cohortMode is invalid', async () => {
    const res = await POST(makeRequest({ jobRequestId: 'job-1', cohortMode: 'bad-mode' }))

    expect(res.status).toBe(400)
    expect(await res.json()).toMatchObject({ error: 'Invalid cohortMode' })
    expect(mockOrchestrateMatch).not.toHaveBeenCalled()
  })

  it('requires admin auth for cohortMode overrides when not cron-authenticated', async () => {
    const res = await POST(makeRequest({ jobRequestId: 'job-1', cohortMode: 'LIVE_ONLY' }, false))

    expect(res.status).toBe(401)
    expect(await res.json()).toMatchObject({
      error: { code: 'UNAUTHORIZED', message: 'Authentication required' },
    })
    expect(mockOrchestrateMatch).not.toHaveBeenCalled()
  })

  it('forwards admin actor metadata for cohortMode override', async () => {
    mockRequireRoleApi.mockResolvedValue(adminActor)

    const res = await POST(
      makeRequest(
        {
          jobRequestId: 'job-1',
          triggeredBy: 'manual',
          cohortMode: 'LIVE_ONLY',
        },
        false,
      ),
    )
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body).toMatchObject({ ok: true, jobRequestId: 'job-1', status: 'NO_MATCH' })
    expect(mockOrchestrateMatch).toHaveBeenCalledWith('job-1', {
      triggeredBy: 'manual',
      cohortMode: 'LIVE_ONLY',
      initiatedBy: { actorId: adminActor.id, actorRole: adminActor.adminRole },
    })
  })

  it('returns 403 when admin is authorized but lacks required privilege', async () => {
    mockRequireRoleApi.mockResolvedValue(forbiddenAuthResponse)

    const res = await POST(makeRequest({ jobRequestId: 'job-1', cohortMode: 'TEST_ONLY' }, false))

    expect(res.status).toBe(403)
    expect(await res.json()).toMatchObject({
      error: { code: 'FORBIDDEN', message: 'Insufficient permissions' },
    })
  })

  it('allows admin auth without CRON secret for default matching', async () => {
    mockRequireRoleApi.mockResolvedValue(adminActor)

    const res = await POST(makeRequest({ jobRequestId: 'job-1' }, false))
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body).toMatchObject({ ok: true, jobRequestId: 'job-1', status: 'NO_MATCH' })
    expect(mockOrchestrateMatch).toHaveBeenCalledWith('job-1', {
      triggeredBy: 'manual',
      initiatedBy: { actorId: adminActor.id, actorRole: adminActor.adminRole },
    })
  })

  it('passes default options to orchestrateMatch for cron requests', async () => {
    const res = await POST(makeRequest({ jobRequestId: 'job-1' }))
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body).toMatchObject({ ok: true, jobRequestId: 'job-1', status: 'NO_MATCH' })
    expect(mockOrchestrateMatch).toHaveBeenCalledWith('job-1', {
      triggeredBy: 'manual',
    })
  })

  it('passes cohortMode override and triggeredBy to orchestrateMatch for admin requests', async () => {
    mockRequireRoleApi.mockResolvedValue(adminActor)

    const res = await POST(
      makeRequest(
        {
          jobRequestId: 'job-1',
          triggeredBy: 'cron',
          cohortMode: 'LIVE_ONLY',
        },
        false,
      ),
    )
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body).toMatchObject({ ok: true, jobRequestId: 'job-1', status: 'NO_MATCH' })
    expect(mockOrchestrateMatch).toHaveBeenCalledWith('job-1', {
      triggeredBy: 'cron',
      cohortMode: 'LIVE_ONLY',
      initiatedBy: { actorId: adminActor.id, actorRole: adminActor.adminRole },
    })
  })

  it('passes cron-authenticated manual request with override blocked', async () => {
    const res = await POST(makeRequest({ jobRequestId: 'job-1', triggeredBy: 'manual', cohortMode: 'LIVE_ONLY' }))

    expect(res.status).toBe(403)
    expect(await res.json()).toMatchObject({
      error: 'cohortMode override requires admin authorization',
    })
    expect(mockOrchestrateMatch).not.toHaveBeenCalled()
  })

  it('returns 500 when orchestration throws', async () => {
    mockOrchestrateMatch.mockRejectedValueOnce(new Error('boom'))

    const res = await POST(makeRequest({ jobRequestId: 'job-1' }))

    expect(res.status).toBe(500)
    expect(await res.json()).toMatchObject({ error: 'Match orchestration failed' })
  })
})
