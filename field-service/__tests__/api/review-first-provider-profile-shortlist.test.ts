import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const {
  mockResolveReviewProviderProfileToken,
  mockShortlistProviderForCustomerReview,
} = vi.hoisted(() => ({
  mockResolveReviewProviderProfileToken: vi.fn(),
  mockShortlistProviderForCustomerReview: vi.fn(),
}))

vi.mock('@/lib/review-provider-profile-access', () => ({
  resolveReviewProviderProfileToken: mockResolveReviewProviderProfileToken,
}))

vi.mock('@/lib/review-first', () => ({
  shortlistProviderForCustomerReview: mockShortlistProviderForCustomerReview,
}))

describe('POST /api/review-first/provider-profile/shortlist', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('rejects cross-origin POST (CSRF check)', async () => {
    const { POST } = await import('@/app/api/review-first/provider-profile/shortlist/route')
    const formData = new FormData()
    formData.set('token', 'tok-1')
    const req = new NextRequest('http://localhost/api/review-first/provider-profile/shortlist', {
      method: 'POST',
      body: formData,
      headers: { origin: 'https://attacker.example.com' },
    })
    const response = await POST(req)
    expect(response.status).toBe(403)
    expect(mockResolveReviewProviderProfileToken).not.toHaveBeenCalled()
  })

  it('rejects POST with missing Origin and Referer (strict CSRF policy)', async () => {
    const { POST } = await import('@/app/api/review-first/provider-profile/shortlist/route')
    const formData = new FormData()
    formData.set('token', 'tok-1')
    const req = new NextRequest('http://localhost/api/review-first/provider-profile/shortlist', {
      method: 'POST',
      body: formData,
    })
    const response = await POST(req)
    expect(response.status).toBe(403)
    expect(mockResolveReviewProviderProfileToken).not.toHaveBeenCalled()
  })

  it('accepts same-origin Referer when Origin is missing', async () => {
    const { POST } = await import('@/app/api/review-first/provider-profile/shortlist/route')
    mockResolveReviewProviderProfileToken.mockResolvedValue({
      status: 'active',
      request: { id: 'req-1', customerId: 'cust-1' },
      provider: { id: 'prov-1' },
    })
    mockShortlistProviderForCustomerReview.mockResolvedValue({
      requestId: 'req-1',
      providerId: 'prov-1',
    })
    const formData = new FormData()
    formData.set('token', 'tok-1')
    const req = new NextRequest('http://localhost/api/review-first/provider-profile/shortlist', {
      method: 'POST',
      body: formData,
      headers: { referer: 'http://localhost/some-page' },
    })
    const response = await POST(req)
    expect(response.status).toBe(303)
    expect(mockShortlistProviderForCustomerReview).toHaveBeenCalledOnce()
  })

  it('rejects missing token', async () => {
    const { POST } = await import('@/app/api/review-first/provider-profile/shortlist/route')
    const req = new NextRequest('http://localhost/api/review-first/provider-profile/shortlist', {
      method: 'POST',
      body: new FormData(),
      headers: { origin: 'http://localhost' },
    })
    const response = await POST(req)
    expect(response.status).toBe(400)
  })

  it('shortlists provider and redirects to profile page', async () => {
    const { POST } = await import('@/app/api/review-first/provider-profile/shortlist/route')
    mockResolveReviewProviderProfileToken.mockResolvedValue({
      status: 'active',
      request: { id: 'req-1', customerId: 'cust-1' },
      provider: { id: 'prov-1' },
    })
    mockShortlistProviderForCustomerReview.mockResolvedValue({
      requestId: 'req-1',
      providerId: 'prov-1',
    })

    const formData = new FormData()
    formData.set('token', 'tok-1')
    const req = new NextRequest('http://localhost/api/review-first/provider-profile/shortlist', {
      method: 'POST',
      body: formData,
      headers: { origin: 'http://localhost' },
    })
    const response = await POST(req)
    expect(response.status).toBe(303)
    expect(mockShortlistProviderForCustomerReview).toHaveBeenCalledWith({
      requestId: 'req-1',
      customerId: 'cust-1',
      providerId: 'prov-1',
    })
  })
})
