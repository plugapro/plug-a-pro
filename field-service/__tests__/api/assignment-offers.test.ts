import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

// ── Mocks ─────────────────────────────────────────────────────────────────────

vi.mock('@/lib/auth', () => ({
  getSession: vi.fn(),
}))

vi.mock('@/lib/db', () => ({
  db: {
    provider: { findUnique: vi.fn() },
  },
}))

vi.mock('@/lib/matching/service', () => ({
  acceptAssignmentOffer: vi.fn(),
  rejectAssignmentOffer: vi.fn(),
}))

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeProviderSession() {
  return { id: 'user-1', role: 'provider' }
}

function makeProvider(id = 'provider-1') {
  return { id, userId: 'user-1', name: 'Alice' }
}

function makeRequest(body: object = {}) {
  return new NextRequest('http://localhost/api/provider/assignment-offers/lead-1/accept', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  })
}

function makeParams(id = 'lead-1') {
  return { params: Promise.resolve({ id }) }
}

// ── Accept route ──────────────────────────────────────────────────────────────

describe('POST /api/provider/assignment-offers/[id]/accept', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns 401 when no session', async () => {
    const { getSession } = await import('@/lib/auth')
    ;(getSession as any).mockResolvedValue(null)

    const { POST } = await import(
      '../../app/api/provider/assignment-offers/[id]/accept/route'
    )

    const res = await POST(makeRequest(), makeParams())
    expect(res.status).toBe(401)
    await expect(res.json()).resolves.toEqual({ error: 'Unauthorized' })
  })

  it('returns 401 when session role is not provider', async () => {
    const { getSession } = await import('@/lib/auth')
    ;(getSession as any).mockResolvedValue({ id: 'admin-1', role: 'admin' })

    const { POST } = await import(
      '../../app/api/provider/assignment-offers/[id]/accept/route'
    )

    const res = await POST(makeRequest(), makeParams())
    expect(res.status).toBe(401)
  })

  it('returns 403 when provider record is not found', async () => {
    const { getSession } = await import('@/lib/auth')
    const { db } = await import('@/lib/db')
    ;(getSession as any).mockResolvedValue(makeProviderSession())
    ;(db.provider.findUnique as any).mockResolvedValue(null)

    const { POST } = await import(
      '../../app/api/provider/assignment-offers/[id]/accept/route'
    )

    const res = await POST(makeRequest(), makeParams())
    expect(res.status).toBe(403)
  })

  it('returns 200 and the result when acceptance succeeds', async () => {
    const { getSession } = await import('@/lib/auth')
    const { db } = await import('@/lib/db')
    const { acceptAssignmentOffer } = await import('@/lib/matching/service')
    ;(getSession as any).mockResolvedValue(makeProviderSession())
    ;(db.provider.findUnique as any).mockResolvedValue(makeProvider())
    ;(acceptAssignmentOffer as any).mockResolvedValue({
      ok: true,
      responseOutcome: 'ACCEPTED',
      matchId: 'match-1',
      assignmentHoldId: 'hold-1',
      nextOfferedProviderId: null,
    })

    const { POST } = await import(
      '../../app/api/provider/assignment-offers/[id]/accept/route'
    )

    const res = await POST(makeRequest({ inspectionNeeded: false }), makeParams('lead-1'))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.ok).toBe(true)
    expect(body.matchId).toBe('match-1')
    expect(acceptAssignmentOffer).toHaveBeenCalledWith({
      leadId: 'lead-1',
      providerId: 'provider-1',
      inspectionNeeded: false,
    })
  })

  it('returns 409 when offer is already taken', async () => {
    const { getSession } = await import('@/lib/auth')
    const { db } = await import('@/lib/db')
    const { acceptAssignmentOffer } = await import('@/lib/matching/service')
    ;(getSession as any).mockResolvedValue(makeProviderSession())
    ;(db.provider.findUnique as any).mockResolvedValue(makeProvider())
    ;(acceptAssignmentOffer as any).mockResolvedValue({
      ok: false,
      reason: 'TAKEN',
    })

    const { POST } = await import(
      '../../app/api/provider/assignment-offers/[id]/accept/route'
    )

    const res = await POST(makeRequest(), makeParams())
    expect(res.status).toBe(409)
    const body = await res.json()
    expect(body.ok).toBe(false)
    expect(body.reason).toBe('TAKEN')
  })

  it('returns 409 when lead is not found', async () => {
    const { getSession } = await import('@/lib/auth')
    const { db } = await import('@/lib/db')
    const { acceptAssignmentOffer } = await import('@/lib/matching/service')
    ;(getSession as any).mockResolvedValue(makeProviderSession())
    ;(db.provider.findUnique as any).mockResolvedValue(makeProvider())
    ;(acceptAssignmentOffer as any).mockResolvedValue({
      ok: false,
      reason: 'NOT_FOUND',
    })

    const { POST } = await import(
      '../../app/api/provider/assignment-offers/[id]/accept/route'
    )

    const res = await POST(makeRequest(), makeParams('lead-unknown'))
    expect(res.status).toBe(409)
  })

  it('passes inspectionNeeded from request body', async () => {
    const { getSession } = await import('@/lib/auth')
    const { db } = await import('@/lib/db')
    const { acceptAssignmentOffer } = await import('@/lib/matching/service')
    ;(getSession as any).mockResolvedValue(makeProviderSession())
    ;(db.provider.findUnique as any).mockResolvedValue(makeProvider())
    ;(acceptAssignmentOffer as any).mockResolvedValue({
      ok: true,
      responseOutcome: 'ACCEPTED',
      matchId: 'match-1',
      assignmentHoldId: 'hold-1',
      nextOfferedProviderId: null,
    })

    const { POST } = await import(
      '../../app/api/provider/assignment-offers/[id]/accept/route'
    )

    await POST(makeRequest({ inspectionNeeded: true }), makeParams())
    expect(acceptAssignmentOffer).toHaveBeenCalledWith(
      expect.objectContaining({ inspectionNeeded: true })
    )
  })
})

// ── Reject route ──────────────────────────────────────────────────────────────

describe('POST /api/provider/assignment-offers/[id]/reject', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns 401 when no session', async () => {
    const { getSession } = await import('@/lib/auth')
    ;(getSession as any).mockResolvedValue(null)

    const { POST } = await import(
      '../../app/api/provider/assignment-offers/[id]/reject/route'
    )

    const res = await POST(
      new NextRequest('http://localhost/api/provider/assignment-offers/lead-1/reject', {
        method: 'POST',
        body: JSON.stringify({}),
      }),
      makeParams()
    )
    expect(res.status).toBe(401)
  })

  it('returns 200 and result when rejection succeeds', async () => {
    const { getSession } = await import('@/lib/auth')
    const { db } = await import('@/lib/db')
    const { rejectAssignmentOffer } = await import('@/lib/matching/service')
    ;(getSession as any).mockResolvedValue(makeProviderSession())
    ;(db.provider.findUnique as any).mockResolvedValue(makeProvider())
    ;(rejectAssignmentOffer as any).mockResolvedValue({
      ok: true,
      responseOutcome: 'REJECTED',
      matchId: null,
      assignmentHoldId: 'hold-1',
      nextOfferedProviderId: 'provider-2',
    })

    const { POST } = await import(
      '../../app/api/provider/assignment-offers/[id]/reject/route'
    )

    const res = await POST(
      new NextRequest('http://localhost/api/provider/assignment-offers/lead-1/reject', {
        method: 'POST',
        body: JSON.stringify({ reasonCode: 'TOO_FAR' }),
        headers: { 'Content-Type': 'application/json' },
      }),
      makeParams('lead-1')
    )

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.ok).toBe(true)
    expect(body.nextOfferedProviderId).toBe('provider-2')
    expect(rejectAssignmentOffer).toHaveBeenCalledWith({
      leadId: 'lead-1',
      providerId: 'provider-1',
      reasonCode: 'TOO_FAR',
    })
  })

  it('returns 409 when offer is already resolved', async () => {
    const { getSession } = await import('@/lib/auth')
    const { db } = await import('@/lib/db')
    const { rejectAssignmentOffer } = await import('@/lib/matching/service')
    ;(getSession as any).mockResolvedValue(makeProviderSession())
    ;(db.provider.findUnique as any).mockResolvedValue(makeProvider())
    ;(rejectAssignmentOffer as any).mockResolvedValue({
      ok: false,
      reason: 'TAKEN',
    })

    const { POST } = await import(
      '../../app/api/provider/assignment-offers/[id]/reject/route'
    )

    const res = await POST(
      new NextRequest('http://localhost/api/provider/assignment-offers/lead-1/reject', {
        method: 'POST',
        body: JSON.stringify({}),
      }),
      makeParams()
    )
    expect(res.status).toBe(409)
  })

  it('passes undefined reasonCode when not provided in body', async () => {
    const { getSession } = await import('@/lib/auth')
    const { db } = await import('@/lib/db')
    const { rejectAssignmentOffer } = await import('@/lib/matching/service')
    ;(getSession as any).mockResolvedValue(makeProviderSession())
    ;(db.provider.findUnique as any).mockResolvedValue(makeProvider())
    ;(rejectAssignmentOffer as any).mockResolvedValue({
      ok: true,
      responseOutcome: 'REJECTED',
      matchId: null,
      assignmentHoldId: 'hold-1',
      nextOfferedProviderId: null,
    })

    const { POST } = await import(
      '../../app/api/provider/assignment-offers/[id]/reject/route'
    )

    await POST(
      new NextRequest('http://localhost/api/provider/assignment-offers/lead-1/reject', {
        method: 'POST',
        body: JSON.stringify({}),
      }),
      makeParams()
    )

    expect(rejectAssignmentOffer).toHaveBeenCalledWith(
      expect.objectContaining({ reasonCode: undefined })
    )
  })
})
