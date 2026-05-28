import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { mockRequireRoleApi, mockRefreshAction } = vi.hoisted(() => {
  return {
    mockRequireRoleApi: vi.fn(),
    mockRefreshAction: vi.fn(),
  }
})

vi.mock('@/lib/auth', () => ({
  requireRoleApi: mockRequireRoleApi,
}))

vi.mock('@/app/(admin)/admin/verifications/actions', () => ({
  refreshDiditSessionAction: mockRefreshAction,
}))

// Imported AFTER the mocks above so the route picks up the stubs.
import { POST } from '../../../../app/api/provider-verifications/[id]/refresh/route'

const params = (id: string) => Promise.resolve({ id })

describe('POST /api/provider-verifications/[id]/refresh', () => {
  beforeEach(() => {
    mockRequireRoleApi.mockReset()
    mockRefreshAction.mockReset()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('rejects unauthenticated callers with the requireRoleApi response (spec §6.5)', async () => {
    const unauth = new Response('nope', { status: 401 })
    mockRequireRoleApi.mockResolvedValue(unauth)
    const res = await POST(new Request('http://localhost/refresh', { method: 'POST' }), { params: params('ver-1') })
    expect(res).toBe(unauth)
    expect(mockRefreshAction).not.toHaveBeenCalled()
  })

  it('calls refreshDiditSessionAction with the path param and forwards the result', async () => {
    mockRequireRoleApi.mockResolvedValue({ id: 'admin-1', adminRole: 'TRUST' })
    mockRefreshAction.mockResolvedValue({ ok: true, status: 'PASSED', decision: 'PASS' })

    const res = await POST(new Request('http://localhost/refresh', { method: 'POST' }), { params: params('ver-42') })
    expect(mockRefreshAction).toHaveBeenCalledWith({ verificationId: 'ver-42' })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toEqual({ status: 'PASSED', decision: 'PASS' })
  })

  it('returns 500 when the action fails', async () => {
    mockRequireRoleApi.mockResolvedValue({ id: 'admin-1', adminRole: 'TRUST' })
    mockRefreshAction.mockResolvedValue({ ok: false })

    const res = await POST(new Request('http://localhost/refresh', { method: 'POST' }), { params: params('ver-x') })
    expect(res.status).toBe(500)
    const body = await res.json()
    expect(body).toEqual({ error: 'refresh_failed' })
  })
})
