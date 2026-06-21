import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/flags', () => ({ isEnabled: vi.fn().mockResolvedValue(true) }))
vi.mock('@/lib/ops-agents', () => ({ runAgent: vi.fn() }))
vi.mock('@/lib/ops-agents/agents', () => ({
  PHASE_1_AGENTS: [
    { key: 'PROVIDER_APPLICATION_REVIEW', agent: { agentKey: 'PROVIDER_APPLICATION_REVIEW' } },
    { key: 'PROVIDER_PROFILE_COACH', agent: { agentKey: 'PROVIDER_PROFILE_COACH' } },
  ],
}))

process.env.CRON_SECRET = 'test-secret'

import { GET } from '@/app/api/cron/ops-agents/route'
import { isEnabled } from '@/lib/flags'
import { runAgent } from '@/lib/ops-agents'

const isEnabledMock = vi.mocked(isEnabled)
const runAgentMock = vi.mocked(runAgent)

function req(auth?: string): Request {
  return new Request('http://localhost/api/cron/ops-agents', {
    headers: auth ? { authorization: auth } : {},
  })
}

const okSummary = { runId: 'r', agentKey: 'X', status: 'SUCCESS', candidates: 1, recommended: 1, created: 1, updated: 0, draftsCreated: 0, errors: [] }

describe('GET /api/cron/ops-agents', () => {
  beforeEach(() => {
    isEnabledMock.mockReset()
    isEnabledMock.mockResolvedValue(true)
    runAgentMock.mockReset()
     
    runAgentMock.mockResolvedValue(okSummary as any)
  })

  it('rejects an unauthenticated caller with 401', async () => {
    const res = await GET(req())
    expect(res.status).toBe(401)
    expect(runAgentMock).not.toHaveBeenCalled()
  })

  it('rejects a wrong bearer token with 401', async () => {
    const res = await GET(req('Bearer wrong'))
    expect(res.status).toBe(401)
    expect(runAgentMock).not.toHaveBeenCalled()
  })

  it('short-circuits (no agents run) when the flag is disabled', async () => {
    isEnabledMock.mockResolvedValue(false)
    const res = await GET(req('Bearer test-secret'))
    const body = await res.json()
    expect(body).toMatchObject({ ok: true, skipped: 'flag_disabled' })
    expect(runAgentMock).not.toHaveBeenCalled()
  })

  it('runs every agent and isolates a single agent failure from the rest', async () => {
    runAgentMock.mockReset()
     
    runAgentMock.mockRejectedValueOnce(new Error('boom')).mockResolvedValue(okSummary as any)

    const res = await GET(req('Bearer test-secret'))
    const body = await res.json()

    expect(body.ok).toBe(true)
    expect(body.results).toHaveLength(2) // loop continued past the failure
    expect(runAgentMock).toHaveBeenCalledTimes(2)
    expect(body.results[0].status).toBe('FAILED')
    expect(body.results[1].status).toBe('SUCCESS')
  })
})
