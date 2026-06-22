import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const { mockRecord, mockCookieGet, mockCookieSet } = vi.hoisted(() => ({
  mockRecord: vi.fn().mockResolvedValue({ id: 'wf-1', occurredAt: new Date() }),
  mockCookieGet: vi.fn(),
  mockCookieSet: vi.fn(),
}))

vi.mock('@/lib/workflow-events/record', () => ({ recordWorkflowEvent: mockRecord }))
vi.mock('next/headers', () => ({
  cookies: async () => ({
    get: (name: string) => mockCookieGet(name),
    set: (name: string, value: string, options: unknown) => mockCookieSet(name, value, options),
  }),
}))

describe('POST /api/funnel/request-started', () => {
  beforeEach(() => {
    mockRecord.mockClear()
    mockCookieGet.mockReset()
    mockCookieSet.mockReset()
  })

  it('writes a REQUEST_STARTED workflow event with the session id as entityId', async () => {
    mockCookieGet.mockImplementation((name: string) =>
      name === 'pap_session' ? { value: 'session-abc' } : undefined,
    )
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
    // Existing session means we do NOT re-set the cookie.
    expect(mockCookieSet).not.toHaveBeenCalled()
  })

  it('generates and sets a pap_session cookie when none exists', async () => {
    mockCookieGet.mockReturnValue(undefined)
    const { POST } = await import('@/app/api/funnel/request-started/route')
    const req = new NextRequest('http://localhost/api/funnel/request-started', {
      method: 'POST',
      body: JSON.stringify({ serviceId: 'electrical' }),
      headers: { 'content-type': 'application/json' },
    })

    const res = await POST(req)

    expect(res.status).toBe(204)
    // 18 bytes → 24 base64url chars (no padding).
    expect(mockCookieSet).toHaveBeenCalledWith(
      'pap_session',
      expect.stringMatching(/^[A-Za-z0-9_-]{24}$/),
      expect.objectContaining({
        httpOnly: true,
        sameSite: 'lax',
        path: '/',
        maxAge: 60 * 60 * 24 * 30,
      }),
    )
    const [, generatedId] = mockCookieSet.mock.calls[0]!
    expect(mockRecord).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: 'REQUEST_STARTED',
        entityType: 'ANONYMOUS_SESSION',
        entityId: generatedId,
        metadata: expect.objectContaining({ serviceId: 'electrical' }),
      }),
    )
  })

  it('ignores invalid payloads with 400', async () => {
    mockCookieGet.mockImplementation((name: string) =>
      name === 'pap_session' ? { value: 'session-abc' } : undefined,
    )
    const { POST } = await import('@/app/api/funnel/request-started/route')
    const res = await POST(new NextRequest('http://localhost/api/funnel/request-started', {
      method: 'POST',
      body: '{"serviceId":""}',
      headers: { 'content-type': 'application/json' },
    }))
    expect(res.status).toBe(400)
  })
})
