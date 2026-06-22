import { describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const { mockRecord } = vi.hoisted(() => ({ mockRecord: vi.fn().mockResolvedValue({ id: 'wf-1', occurredAt: new Date() }) }))

vi.mock('@/lib/workflow-events/record', () => ({ recordWorkflowEvent: mockRecord }))
vi.mock('next/headers', () => ({
  cookies: async () => ({
    get: (name: string) => (name === 'pap_session' ? { value: 'session-abc' } : undefined),
    set: vi.fn(),
  }),
}))

describe('POST /api/funnel/request-started', () => {
  it('writes a REQUEST_STARTED workflow event with the session id as entityId', async () => {
    const { POST } = await import('@/app/api/funnel/request-started/route')
    const req = new NextRequest('http://localhost/api/funnel/request-started', {
      method: 'POST',
      body: JSON.stringify({ serviceId: 'plumbing', source: 'pwa', landingPath: '/book/plumbing' }),
      headers: { 'content-type': 'application/json' },
    })

    const res = await POST(req)

    expect(res.status).toBe(204)
    expect(mockRecord).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: 'REQUEST_STARTED',
        actorType: 'anonymous',
        entityType: 'ANONYMOUS_SESSION',
        entityId: 'session-abc',
        source: 'pwa',
        metadata: expect.objectContaining({ serviceId: 'plumbing', landingPath: '/book/plumbing' }),
      }),
    )
  })

  it('ignores invalid payloads with 400', async () => {
    const { POST } = await import('@/app/api/funnel/request-started/route')
    const res = await POST(new NextRequest('http://localhost/api/funnel/request-started', {
      method: 'POST',
      body: '{"serviceId":""}',
      headers: { 'content-type': 'application/json' },
    }))
    expect(res.status).toBe(400)
  })
})
