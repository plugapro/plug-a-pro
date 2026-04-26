import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const {
  mockGetSession,
  mockCreateJobRequest,
  mockResolveStructuredAddressCapture,
  mockIsInActiveServiceArea,
  mockAddToServiceAreaWaitlist,
  mockUploadJobRequestPhoto,
} = vi.hoisted(() => ({
  mockGetSession: vi.fn(),
  mockCreateJobRequest: vi.fn(),
  mockResolveStructuredAddressCapture: vi.fn(),
  mockIsInActiveServiceArea: vi.fn(),
  mockAddToServiceAreaWaitlist: vi.fn(),
  mockUploadJobRequestPhoto: vi.fn(),
}))

vi.mock('@/lib/auth', () => ({ getSession: mockGetSession }))
vi.mock('@/lib/job-requests/create-job-request', () => ({ createJobRequest: mockCreateJobRequest }))
vi.mock('@/lib/structured-address', () => ({
  InvalidStructuredAddressError: class InvalidStructuredAddressError extends Error {},
  resolveStructuredAddressCapture: mockResolveStructuredAddressCapture,
}))
vi.mock('@/lib/service-area-guard', () => ({
  isInActiveServiceArea: mockIsInActiveServiceArea,
  addToServiceAreaWaitlist: mockAddToServiceAreaWaitlist,
}))
vi.mock('@/lib/storage', () => ({ uploadJobRequestPhoto: mockUploadJobRequestPhoto }))

describe('POST /api/customer/bookings', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetSession.mockResolvedValue({ id: 'customer-user-1', role: 'customer', phone: '+27821234567' })
    mockResolveStructuredAddressCapture.mockResolvedValue({
      street: '12 Main Road',
      addressLine1: '12 Main Road',
      addressLine2: null,
      complexName: null,
      unitNumber: null,
      suburb: 'Sandton',
      region: 'JHB North',
      city: 'Johannesburg',
      province: 'Gauteng',
      postalCode: '2196',
      locationNodeId: 'node-1',
    })
    mockIsInActiveServiceArea.mockReturnValue(true)
    mockCreateJobRequest.mockResolvedValue({
      jobRequestId: 'jr-1',
      customerId: 'cust-1',
      ticketUrl: 'https://app.example/requests/access/token',
    })
    mockUploadJobRequestPhoto.mockResolvedValue('https://blob.example/photo.png')
  })

  it('creates a job request with optional customer photos attached to the request', async () => {
    const formData = new FormData()
    formData.set('category', 'plumbing')
    formData.set('title', 'Fix leaking pipe')
    formData.set('description', 'Water under the sink')
    formData.set('addressLine1', '12 Main Road')
    formData.set('locationNodeId', 'node-1')
    formData.append('photos', new File(['img'], 'leak.png', { type: 'image/png' }))

    const { POST } = await import('@/app/api/customer/bookings/route')
    const response = await POST(new NextRequest('http://localhost/api/customer/bookings', {
      method: 'POST',
      body: formData,
    }))

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      jobRequestId: 'jr-1',
      ticketUrl: 'https://app.example/requests/access/token',
      uploadedPhotoCount: 1,
    })
    expect(mockCreateJobRequest).toHaveBeenCalledWith(expect.objectContaining({
      category: 'plumbing',
      title: 'Fix leaking pipe',
      description: 'Water under the sink',
    }))
    expect(mockUploadJobRequestPhoto).toHaveBeenCalledWith(expect.objectContaining({
      jobRequestId: 'jr-1',
      label: 'evidence',
      uploadedBy: 'customer-user-1',
    }))
  })

  it('passes urgency timing fields from multipart FormData to createJobRequest', async () => {
    const windowEnd = new Date(Date.now() + 48 * 60 * 60 * 1000)
    const arrivalLatest = new Date(Date.now() + 24 * 60 * 60 * 1000)

    const formData = new FormData()
    formData.set('category', 'plumbing')
    formData.set('title', 'Fix leaking pipe')
    formData.set('addressLine1', '12 Main Road')
    formData.set('locationNodeId', 'node-1')
    formData.set('requestedWindowEnd', windowEnd.toISOString())
    formData.set('requestedArrivalLatest', arrivalLatest.toISOString())

    const { POST } = await import('@/app/api/customer/bookings/route')
    const response = await POST(new NextRequest('http://localhost/api/customer/bookings', {
      method: 'POST',
      body: formData,
    }))

    expect(response.status).toBe(200)
    expect(mockCreateJobRequest).toHaveBeenCalledWith(expect.objectContaining({
      requestedWindowEnd: new Date(windowEnd.toISOString()),
      requestedArrivalLatest: new Date(arrivalLatest.toISOString()),
    }))
  })

  it('omits timing fields when no urgency is sent (flexible — no deadline)', async () => {
    const formData = new FormData()
    formData.set('category', 'plumbing')
    formData.set('title', 'Fix leaking pipe')
    formData.set('addressLine1', '12 Main Road')
    formData.set('locationNodeId', 'node-1')
    // No requestedWindowEnd or requestedArrivalLatest

    const { POST } = await import('@/app/api/customer/bookings/route')
    const response = await POST(new NextRequest('http://localhost/api/customer/bookings', {
      method: 'POST',
      body: formData,
    }))

    expect(response.status).toBe(200)
    expect(mockCreateJobRequest).toHaveBeenCalledWith(expect.objectContaining({
      requestedWindowEnd: null,
      requestedArrivalLatest: null,
    }))
  })
})
