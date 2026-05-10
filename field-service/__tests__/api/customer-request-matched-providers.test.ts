import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const {
  mockGetSession,
  mockResolveCustomerForSession,
  mockGetMatchedProvidersForCustomerRequest,
} = vi.hoisted(() => ({
  mockGetSession: vi.fn(),
  mockResolveCustomerForSession: vi.fn(),
  mockGetMatchedProvidersForCustomerRequest: vi.fn(),
}))

vi.mock('@/lib/auth', () => ({
  getSession: mockGetSession,
}))

vi.mock('@/lib/customer-session', () => ({
  resolveCustomerForSession: mockResolveCustomerForSession,
}))

vi.mock('@/lib/db', () => ({
  db: {},
}))

vi.mock('@/lib/review-first', async () => {
  const actual = await vi.importActual<typeof import('@/lib/review-first')>('@/lib/review-first')
  return {
    ...actual,
    getMatchedProvidersForCustomerRequest: mockGetMatchedProvidersForCustomerRequest,
  }
})

describe('GET /api/customer/requests/[id]/matched-providers', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns 401 when unauthenticated', async () => {
    mockGetSession.mockResolvedValue(null)

    const { GET } = await import('@/app/api/customer/requests/[id]/matched-providers/route')
    const req = new NextRequest('http://localhost/api/customer/requests/jr-1/matched-providers')
    const res = await GET(req, { params: Promise.resolve({ id: 'jr-1' }) })
    expect(res.status).toBe(401)
  })

  it('returns safe fields only for a valid customer request', async () => {
    mockGetSession.mockResolvedValue({ id: 'user-1', role: 'customer' })
    mockResolveCustomerForSession.mockResolvedValue({ id: 'cust-1' })
    mockGetMatchedProvidersForCustomerRequest.mockResolvedValue({
      requestId: 'jr-1',
      batch: 1,
      hasMore: false,
      totalEligibleCount: 1,
      providers: [
        {
          providerId: 'p-1',
          displayName: 'Lovemore',
          profilePhotoUrl: null,
          mainSkill: 'plumbing',
          secondarySkills: ['handyman'],
          serviceArea: 'Bromhof',
          serviceZones: ['Bromhof', 'Roodepoort'],
          labourRateText: 'from R220/hr',
          trustLevel: 'reviewed',
          summary: 'Reliable service',
          availabilityIndicator: 'available_now',
          rank: 1,
          score: 0.92,
          whyMatched: 'Area + skill match',
          profileUrl: 'https://app.plugapro.co.za/provider-public-profile/token',
          // Internal/raw fields that should not leak in API response:
          name: 'Lovemore',
          bio: 'Reliable service',
          experience: '5+ years',
          skills: ['plumbing', 'handyman'],
          serviceAreas: ['Bromhof'],
          avatarUrl: null,
          verified: true,
          averageRating: 4.7,
          completedJobsCount: 12,
          portfolioUrls: [],
          callOutFee: 300,
          hourlyRate: 220,
          negotiable: true,
        },
      ],
    })

    const { GET } = await import('@/app/api/customer/requests/[id]/matched-providers/route')
    const req = new NextRequest('http://localhost/api/customer/requests/jr-1/matched-providers')
    const res = await GET(req, { params: Promise.resolve({ id: 'jr-1' }) })
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.providers).toHaveLength(1)
    expect(body.providers[0]).toMatchObject({
      providerId: 'p-1',
      displayName: 'Lovemore',
      mainSkill: 'plumbing',
      serviceArea: 'Bromhof',
    })
    expect(body.providers[0]).not.toHaveProperty('phone')
    expect(body.providers[0]).not.toHaveProperty('idNumber')
    expect(body.providers[0]).not.toHaveProperty('internalRiskFlags')
    expect(body.providers[0]).not.toHaveProperty('name')
    expect(body.providers[0]).not.toHaveProperty('hourlyRate')
  })

  it('returns useful empty state when no matches exist', async () => {
    mockGetSession.mockResolvedValue({ id: 'user-1', role: 'customer' })
    mockResolveCustomerForSession.mockResolvedValue({ id: 'cust-1' })
    mockGetMatchedProvidersForCustomerRequest.mockResolvedValue({
      requestId: 'jr-1',
      batch: 1,
      hasMore: false,
      totalEligibleCount: 0,
      providers: [],
    })

    const { GET } = await import('@/app/api/customer/requests/[id]/matched-providers/route')
    const req = new NextRequest('http://localhost/api/customer/requests/jr-1/matched-providers')
    const res = await GET(req, { params: Promise.resolve({ id: 'jr-1' }) })
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.count).toBe(0)
    expect(body.providers).toEqual([])
  })

  it('returns 403 when customer is not allowed to view the request', async () => {
    mockGetSession.mockResolvedValue({ id: 'user-1', role: 'customer' })
    mockResolveCustomerForSession.mockResolvedValue({ id: 'cust-1' })
    const { ReviewFirstError } = await import('@/lib/review-first')
    mockGetMatchedProvidersForCustomerRequest.mockRejectedValue(
      new ReviewFirstError('FORBIDDEN', 'Not allowed for this request.'),
    )

    const { GET } = await import('@/app/api/customer/requests/[id]/matched-providers/route')
    const req = new NextRequest('http://localhost/api/customer/requests/jr-2/matched-providers')
    const res = await GET(req, { params: Promise.resolve({ id: 'jr-2' }) })

    expect(res.status).toBe(403)
  })

  it('returns 400 when batch param is invalid', async () => {
    mockGetSession.mockResolvedValue({ id: 'user-1', role: 'customer' })
    mockResolveCustomerForSession.mockResolvedValue({ id: 'cust-1' })
    const { ReviewFirstError } = await import('@/lib/review-first')
    mockGetMatchedProvidersForCustomerRequest.mockRejectedValue(
      new ReviewFirstError('INVALID_BATCH', 'Invalid provider batch.'),
    )

    const { GET } = await import('@/app/api/customer/requests/[id]/matched-providers/route')
    const req = new NextRequest('http://localhost/api/customer/requests/jr-1/matched-providers?batch=abc')
    const res = await GET(req, { params: Promise.resolve({ id: 'jr-1' }) })

    expect(res.status).toBe(400)
  })
})
