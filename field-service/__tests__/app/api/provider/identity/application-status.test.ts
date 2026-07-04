import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

// ── Hoist the mock fn so it is initialised before vi.mock is hoisted ─────────
const { mockFindUnique } = vi.hoisted(() => ({
  mockFindUnique: vi.fn(),
}))

vi.mock('@/lib/db', () => ({
  db: {
    providerIdentityVerification: {
      findUnique: mockFindUnique,
    },
  },
}))

// Import the REAL handler after mocks are in place.
import { GET } from '../../../../../app/api/provider/identity/application-status/route'

function makeRequest(token?: string): NextRequest {
  const url = token
    ? `http://localhost/api/provider/identity/application-status?token=${token}`
    : 'http://localhost/api/provider/identity/application-status'
  return new NextRequest(url)
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('GET /api/provider/identity/application-status', () => {
  it('returns 200 with { status, decision } for a valid token', async () => {
    mockFindUnique.mockResolvedValue({ status: 'SUBMITTED', decision: null })

    const res = await GET(makeRequest('valid-token-abc123'))
    expect(res.status).toBe(200)

    const body = await res.json()
    expect(body).toEqual({ status: 'SUBMITTED', decision: null })
    // No PII or extra fields
    expect(body).not.toHaveProperty('phone')
    expect(body).not.toHaveProperty('name')
    expect(body).not.toHaveProperty('accessTokenHash')
    expect(Object.keys(body).sort()).toEqual(['decision', 'status'])
  })

  it('returns 200 with decision PASS when verification is complete', async () => {
    mockFindUnique.mockResolvedValue({ status: 'PASSED', decision: 'PASS' })

    const res = await GET(makeRequest('valid-token-passed'))
    expect(res.status).toBe(200)

    const body = await res.json()
    expect(body).toEqual({ status: 'PASSED', decision: 'PASS' })
  })

  it('returns 404 for an unknown token', async () => {
    mockFindUnique.mockResolvedValue(null)

    const res = await GET(makeRequest('unknown-token-xyz'))
    expect(res.status).toBe(404)

    const body = await res.json()
    expect(body).toHaveProperty('error')
  })

  it('returns 400 when token query param is missing', async () => {
    const res = await GET(makeRequest()) // no token
    expect(res.status).toBe(400)

    const body = await res.json()
    expect(body).toHaveProperty('error')
    // db must not be touched when token is missing
    expect(mockFindUnique).not.toHaveBeenCalled()
  })

  it('does not write to the database — handler is non-mutating', async () => {
    mockFindUnique.mockResolvedValue({ status: 'SUBMITTED', decision: null })

    await GET(makeRequest('read-only-check-token'))

    // Only findUnique should have been called — no create/update/delete
    expect(mockFindUnique).toHaveBeenCalledTimes(1)
    // Confirm db mock exposes no mutating methods
    const { db } = await import('@/lib/db')
    const model = (db as any).providerIdentityVerification
    expect(model.create).toBeUndefined()
    expect(model.update).toBeUndefined()
    expect(model.delete).toBeUndefined()
  })
})
