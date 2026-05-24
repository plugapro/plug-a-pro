import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/csrf', () => ({
  verifyRequestOrigin: vi.fn(() => true),
}))

vi.mock('@/app/(admin)/admin/locations/actions', () => ({
  createLocationNodeAction: vi.fn().mockResolvedValue({
    ok: true,
    data: { id: 'loc-1', slug: 'johannesburg', label: 'Johannesburg', nodeType: 'CITY' },
  }),
  updateLocationNodeAction: vi.fn().mockResolvedValue({ ok: true, data: { id: 'loc-1' } }),
  deleteLocationNodeAction: vi.fn().mockResolvedValue({ ok: true, data: { id: 'loc-1' } }),
}))

vi.mock('@/lib/location-nodes', () => ({
  listLocationNodes: vi.fn().mockResolvedValue([]),
  createLocationNode: vi.fn(),
  updateLocationNode: vi.fn(),
  deactivateLocationNode: vi.fn(),
  deleteLocationNode: vi.fn(),
  LocationNodeInUseError: class LocationNodeInUseError extends Error {},
}))

beforeEach(async () => {
  vi.clearAllMocks()
  const actions = await import('@/app/(admin)/admin/locations/actions')
  vi.mocked(actions.createLocationNodeAction).mockResolvedValue({
    ok: true,
    data: { id: 'loc-1', slug: 'johannesburg', label: 'Johannesburg', nodeType: 'CITY' } as any,
  })
  vi.mocked(actions.updateLocationNodeAction).mockResolvedValue({ ok: true, data: { id: 'loc-1' } })
  vi.mocked(actions.deleteLocationNodeAction).mockResolvedValue({ ok: true, data: { id: 'loc-1' } })
})

function jsonRequest(url: string, body: unknown) {
  return new NextRequest(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: 'http://localhost' },
    body: JSON.stringify(body),
  })
}

describe('admin location API policy', () => {
  it('delegates create/update/delete mutations to audited location actions', async () => {
    const actions = await import('@/app/(admin)/admin/locations/actions')
    const locationNodes = await import('@/lib/location-nodes')
    const { POST } = await import('../../app/api/admin/locations/route')
    const { PATCH, DELETE } = await import('../../app/api/admin/locations/[id]/route')

    const createResponse = await POST(jsonRequest('http://localhost/api/admin/locations', {
      nodeType: 'CITY',
      slug: 'johannesburg',
      label: 'Johannesburg',
    }))
    const createBody = await createResponse.json()

    await PATCH(jsonRequest('http://localhost/api/admin/locations/loc-1', {
      label: 'Joburg',
    }), { params: Promise.resolve({ id: 'loc-1' }) })

    await DELETE(new NextRequest('http://localhost/api/admin/locations/loc-1?force=true', {
      method: 'DELETE',
      headers: { origin: 'http://localhost' },
    }), { params: Promise.resolve({ id: 'loc-1' }) })

    expect(actions.createLocationNodeAction).toHaveBeenCalledWith({
      nodeType: 'CITY',
      slug: 'johannesburg',
      label: 'Johannesburg',
      parentId: null,
      lat: undefined,
      lng: undefined,
      radiusKm: undefined,
    })
    expect(actions.updateLocationNodeAction).toHaveBeenCalledWith({
      id: 'loc-1',
      label: 'Joburg',
    })
    expect(actions.deleteLocationNodeAction).toHaveBeenCalledWith('loc-1', { force: true })
    expect(createBody).toMatchObject({
      id: 'loc-1',
      slug: 'johannesburg',
      label: 'Johannesburg',
      nodeType: 'CITY',
    })

    expect(locationNodes.createLocationNode).not.toHaveBeenCalled()
    expect(locationNodes.updateLocationNode).not.toHaveBeenCalled()
    expect(locationNodes.deactivateLocationNode).not.toHaveBeenCalled()
    expect(locationNodes.deleteLocationNode).not.toHaveBeenCalled()
  })

  it('returns a safe API envelope when the audited action rejects authorization', async () => {
    const actions = await import('@/app/(admin)/admin/locations/actions')
    const { CrudActionError } = await import('../../lib/crud-action')
    const { POST } = await import('../../app/api/admin/locations/route')

    vi.mocked(actions.createLocationNodeAction).mockRejectedValueOnce(
      new CrudActionError('UNAUTHORIZED', 'Requires one of [OPS, ADMIN, OWNER]. Actor has: none.'),
    )

    const response = await POST(jsonRequest('http://localhost/api/admin/locations', {
      nodeType: 'CITY',
      slug: 'johannesburg',
      label: 'Johannesburg',
    }))

    expect(response.status).toBe(403)
    const body = await response.json()
    expect(body.error).toMatchObject({
      code: 'UNAUTHORIZED',
      category: 'authorization',
      message: 'Insufficient permissions.',
      retryable: false,
      context: { surface: 'admin_locations', action: 'create' },
    })
    expect(body.error.reference_id).toMatch(/^PAP-\d{8}-[A-Z0-9]{6}$/)
    expect(JSON.stringify(body)).not.toContain('Actor has')
  })
})
