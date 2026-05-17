import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const {
  mockGetSession,
  mockCreateJobRequest,
  mockResolveStructuredAddressCapture,
  mockIsInActiveServiceArea,
  mockAddToServiceAreaWaitlist,
  mockNotifyCustomerPwaRequestSubmitted,
  mockUploadJobRequestPhoto,
  mockProviderFindFirst,
  mockJobRequestCount,
} = vi.hoisted(() => ({
  mockGetSession: vi.fn(),
  mockCreateJobRequest: vi.fn(),
  mockResolveStructuredAddressCapture: vi.fn(),
  mockIsInActiveServiceArea: vi.fn(),
  mockAddToServiceAreaWaitlist: vi.fn(),
  mockNotifyCustomerPwaRequestSubmitted: vi.fn(),
  mockUploadJobRequestPhoto: vi.fn(),
  mockProviderFindFirst: vi.fn(),
  mockJobRequestCount: vi.fn().mockResolvedValue(0),
}))

vi.mock('@/lib/auth', () => ({ getSession: mockGetSession }))
vi.mock('@/lib/db', () => ({
  db: {
    provider: {
      findFirst: mockProviderFindFirst,
    },
    jobRequest: {
      count: mockJobRequestCount,
    },
  },
}))
vi.mock('@/lib/job-requests/create-job-request', () => ({ createJobRequest: mockCreateJobRequest }))
vi.mock('@/lib/structured-address', () => ({
  InvalidStructuredAddressError: class InvalidStructuredAddressError extends Error {},
  resolveStructuredAddressCapture: mockResolveStructuredAddressCapture,
}))
vi.mock('@/lib/service-area-guard', () => ({
  isInActiveServiceArea: mockIsInActiveServiceArea,
  addToServiceAreaWaitlist: mockAddToServiceAreaWaitlist,
}))
vi.mock('@/lib/client-pwa-submission-notifications', () => ({
  notifyCustomerPwaRequestSubmitted: mockNotifyCustomerPwaRequestSubmitted,
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
    mockProviderFindFirst.mockResolvedValue(null)
    mockUploadJobRequestPhoto.mockResolvedValue('https://blob.example/photo.png')
    mockNotifyCustomerPwaRequestSubmitted.mockResolvedValue({ sent: true })
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
      assignmentMode: 'OPS_REVIEW',
      deferMatchingModeSelection: true,
    }))
    expect(mockUploadJobRequestPhoto).toHaveBeenCalledWith(expect.objectContaining({
      jobRequestId: 'jr-1',
      label: 'customer_photo',
      safeForPreview: true,
      uploadedBy: 'customer-user-1',
    }))
    expect(mockNotifyCustomerPwaRequestSubmitted).toHaveBeenCalledWith(expect.objectContaining({
      customerPhone: '+27821234567',
      category: 'plumbing',
      suburb: 'Sandton',
      city: 'Johannesburg',
      ticketUrl: 'https://app.example/requests/access/token',
      requestId: 'jr-1',
    }))
  })

  it('respects customer photo safe-for-preview setting via boolean-string', async () => {
    const formData = new FormData()
    formData.set('category', 'plumbing')
    formData.set('title', 'Fix leaking pipe')
    formData.set('addressLine1', '12 Main Road')
    formData.set('locationNodeId', 'node-1')
    formData.set('photoSafeForPreview', 'false')
    formData.append('photos', new File(['img'], 'leak.png', { type: 'image/png' }))
    formData.append('photos', new File(['img2'], 'leak2.png', { type: 'image/png' }))

    const { POST } = await import('@/app/api/customer/bookings/route')
    const response = await POST(new NextRequest('http://localhost/api/customer/bookings', {
      method: 'POST',
      body: formData,
    }))

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      jobRequestId: 'jr-1',
      ticketUrl: 'https://app.example/requests/access/token',
      uploadedPhotoCount: 2,
    })
    expect(mockUploadJobRequestPhoto).toHaveBeenCalledTimes(2)
    expect(mockUploadJobRequestPhoto).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ safeForPreview: false }),
    )
    expect(mockUploadJobRequestPhoto).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ safeForPreview: false }),
    )
  })

  it('respects safe-for-preview setting via JSON array', async () => {
    const formData = new FormData()
    formData.set('category', 'plumbing')
    formData.set('title', 'Fix leaking pipe')
    formData.set('addressLine1', '12 Main Road')
    formData.set('locationNodeId', 'node-1')
    formData.set('photoSafeForPreview', JSON.stringify([true, false]))
    formData.append('photos', new File(['img'], 'a.png', { type: 'image/png' }))
    formData.append('photos', new File(['img2'], 'b.png', { type: 'image/png' }))

    const { POST } = await import('@/app/api/customer/bookings/route')
    const response = await POST(new NextRequest('http://localhost/api/customer/bookings', {
      method: 'POST',
      body: formData,
    }))

    expect(response.status).toBe(200)
    expect(mockUploadJobRequestPhoto).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ safeForPreview: true }),
    )
    expect(mockUploadJobRequestPhoto).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ safeForPreview: false }),
    )
  })

  it('defaults safe-for-preview to true when JSON array is shorter than photo count', async () => {
    const formData = new FormData()
    formData.set('category', 'plumbing')
    formData.set('title', 'Fix leaking pipe')
    formData.set('addressLine1', '12 Main Road')
    formData.set('locationNodeId', 'node-1')
    formData.set('photoSafeForPreview', JSON.stringify([false]))
    formData.append('photos', new File(['img'], 'a.png', { type: 'image/png' }))
    formData.append('photos', new File(['img2'], 'b.png', { type: 'image/png' }))
    formData.append('photos', new File(['img3'], 'c.png', { type: 'image/png' }))

    const { POST } = await import('@/app/api/customer/bookings/route')
    const response = await POST(new NextRequest('http://localhost/api/customer/bookings', {
      method: 'POST',
      body: formData,
    }))

    expect(response.status).toBe(200)
    // First photo: explicitly false
    expect(mockUploadJobRequestPhoto).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ safeForPreview: false }),
    )
    // Photos 2 and 3: fall back to true (safe default for unspecified entries)
    expect(mockUploadJobRequestPhoto).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ safeForPreview: true }),
    )
    expect(mockUploadJobRequestPhoto).toHaveBeenNthCalledWith(
      3,
      expect.objectContaining({ safeForPreview: true }),
    )
  })

  it('treats non-boolean JSON values as not-safe (strict opt-in)', async () => {
    const formData = new FormData()
    formData.set('category', 'plumbing')
    formData.set('title', 'Fix leaking pipe')
    formData.set('addressLine1', '12 Main Road')
    formData.set('locationNodeId', 'node-1')
    formData.set('photoSafeForPreview', JSON.stringify([null, 1, 'true']))
    formData.append('photos', new File(['img'], 'a.png', { type: 'image/png' }))
    formData.append('photos', new File(['img2'], 'b.png', { type: 'image/png' }))
    formData.append('photos', new File(['img3'], 'c.png', { type: 'image/png' }))

    const { POST } = await import('@/app/api/customer/bookings/route')
    const response = await POST(new NextRequest('http://localhost/api/customer/bookings', {
      method: 'POST',
      body: formData,
    }))

    expect(response.status).toBe(200)
    // null, 1, and "true" are all non-boolean true — should NOT be treated as safe
    expect(mockUploadJobRequestPhoto).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ safeForPreview: false }),
    )
    expect(mockUploadJobRequestPhoto).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ safeForPreview: false }),
    )
    expect(mockUploadJobRequestPhoto).toHaveBeenNthCalledWith(
      3,
      expect.objectContaining({ safeForPreview: false }),
    )
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

  it('passes shortlist fields and access notes from multipart form to createJobRequest', async () => {
    mockProviderFindFirst.mockResolvedValue({ id: 'provider-9' })

    const formData = new FormData()
    formData.set('category', 'plumbing')
    formData.set('title', 'Fix leaking pipe')
    formData.set('subcategory', 'Kitchen plumbing')
    formData.set('description', 'Water under sink')
    formData.set('addressLine1', '12 Main Road')
    formData.set('locationNodeId', 'node-1')
    formData.set('urgency', 'asap')
    formData.set('providerPreference', 'verified_only')
    formData.set('budgetPreference', 'low_cost')
    formData.set('verifiedOnly', 'true')
    formData.set('maxCallOutFee', '400')
    formData.set('preferredProviderId', 'provider-9')
    formData.set('accessNotes', 'Gate code 4321, house alarm at entrance.')

    const { POST } = await import('@/app/api/customer/bookings/route')
    const response = await POST(new NextRequest('http://localhost/api/customer/bookings', {
      method: 'POST',
      body: formData,
    }))

    expect(response.status).toBe(200)
    expect(mockCreateJobRequest).toHaveBeenCalledWith(expect.objectContaining({
      category: 'plumbing',
      title: 'Fix leaking pipe',
      subcategory: 'Kitchen plumbing',
      urgency: 'asap',
      providerPreference: 'verified_only',
      budgetPreference: 'low_cost',
      verifiedOnly: true,
      maxCallOutFee: 400,
      preferredProviderId: 'provider-9',
      accessNotes: 'Gate code 4321, house alarm at entrance.',
    }))
  })

  it('drops preferredProviderId when provider is not eligible for discovery/request', async () => {
    mockProviderFindFirst.mockResolvedValue(null)

    const formData = new FormData()
    formData.set('category', 'plumbing')
    formData.set('title', 'Fix leaking pipe')
    formData.set('addressLine1', '12 Main Road')
    formData.set('locationNodeId', 'node-1')
    formData.set('preferredProviderId', 'provider-ineligible')

    const { POST } = await import('@/app/api/customer/bookings/route')
    const response = await POST(new NextRequest('http://localhost/api/customer/bookings', {
      method: 'POST',
      body: formData,
    }))

    expect(response.status).toBe(200)
    expect(mockCreateJobRequest).toHaveBeenCalledWith(expect.objectContaining({
      preferredProviderId: null,
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
