// Defense-in-depth: when a customer submits a JobRequest with a preferred
// provider chosen from the browse list, the booking handler must validate that
// the provider is KYC-verified BEFORE persisting them as preferredProviderId.
// Today the legacy verified=true filter is transitively safe (PR #114 made
// provider approval KYC-aware), but the customer surface must enforce KYC
// explicitly so a future weakening of the approval pipeline can't leak.
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const {
  mockGetSession,
  mockCreateJobRequest,
  mockResolveStructuredAddressCapture,
  mockIsInActiveServiceArea,
  mockIsActiveRegion,
  mockAddToServiceAreaWaitlist,
  mockNotifyCustomerPwaRequestSubmitted,
  mockUploadJobRequestPhoto,
  mockProviderFindFirst,
  mockJobRequestCount,
  mockResolveCustomerForSession,
  mockIsEnabled,
} = vi.hoisted(() => ({
  mockGetSession: vi.fn(),
  mockCreateJobRequest: vi.fn(),
  mockResolveStructuredAddressCapture: vi.fn(),
  mockIsInActiveServiceArea: vi.fn(),
  mockIsActiveRegion: vi.fn(),
  mockAddToServiceAreaWaitlist: vi.fn(),
  mockNotifyCustomerPwaRequestSubmitted: vi.fn(),
  mockUploadJobRequestPhoto: vi.fn(),
  mockProviderFindFirst: vi.fn(),
  mockJobRequestCount: vi.fn().mockResolvedValue(0),
  mockResolveCustomerForSession: vi.fn(),
  mockIsEnabled: vi.fn(),
}))

vi.mock('@/lib/auth', () => ({ getSession: mockGetSession }))
vi.mock('@/lib/customer-session', () => ({
  resolveCustomerForSession: mockResolveCustomerForSession,
}))
vi.mock('@/lib/db', () => ({
  db: {
    provider: { findFirst: mockProviderFindFirst },
    jobRequest: { count: mockJobRequestCount },
  },
}))
vi.mock('@/lib/job-requests/create-job-request', () => ({
  createJobRequest: mockCreateJobRequest,
  DuplicateActiveRequestError: class DuplicateActiveRequestError extends Error {},
  CustomerBlockedError: class CustomerBlockedError extends Error {},
}))
vi.mock('@/lib/structured-address', () => ({
  InvalidStructuredAddressError: class InvalidStructuredAddressError extends Error {},
  resolveStructuredAddressCapture: mockResolveStructuredAddressCapture,
}))
vi.mock('@/lib/service-area-guard', () => ({
  isInActiveServiceArea: mockIsInActiveServiceArea,
  isActiveRegion: mockIsActiveRegion,
  addToServiceAreaWaitlist: mockAddToServiceAreaWaitlist,
}))
vi.mock('@/lib/client-pwa-submission-notifications', () => ({
  notifyCustomerPwaRequestSubmitted: mockNotifyCustomerPwaRequestSubmitted,
}))
vi.mock('@/lib/storage', () => ({ uploadJobRequestPhoto: mockUploadJobRequestPhoto }))
vi.mock('@/lib/flags', () => ({ isEnabled: mockIsEnabled }))

describe('POST /api/customer/bookings — preferred-provider KYC defense-in-depth', () => {
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
    mockIsActiveRegion.mockReturnValue(true)
    mockCreateJobRequest.mockResolvedValue({
      jobRequestId: 'jr-1',
      customerId: 'cust-1',
      ticketUrl: 'https://app.example/requests/access/token',
    })
    mockProviderFindFirst.mockResolvedValue({ id: 'provider-9' })
    mockUploadJobRequestPhoto.mockResolvedValue('https://blob.example/photo.png')
    mockNotifyCustomerPwaRequestSubmitted.mockResolvedValue({ sent: true })
    mockResolveCustomerForSession.mockResolvedValue({ id: 'cust-1', userId: 'customer-user-1' })
    mockIsEnabled.mockResolvedValue(false)
  })

  it('adds an explicit kycStatus=VERIFIED filter when grace is OFF', async () => {
    const formData = new FormData()
    formData.set('category', 'plumbing')
    formData.set('title', 'Fix leaking pipe')
    formData.set('addressLine1', '12 Main Road')
    formData.set('locationNodeId', 'node-1')
    formData.set('preferredProviderId', 'provider-9')

    const { POST } = await import('@/app/api/customer/bookings/route')
    const response = await POST(new NextRequest('http://localhost/api/customer/bookings', {
      method: 'POST',
      body: formData,
    }))

    expect(response.status).toBe(200)
    expect(mockProviderFindFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        active: true,
        verified: true,
        status: 'ACTIVE',
        AND: expect.arrayContaining([
          expect.objectContaining({ kycStatus: 'VERIFIED' }),
        ]),
      }),
    }))
  })

  it('switches to the grace OR when matching.kyc_grace_legacy_providers is ON', async () => {
    mockIsEnabled.mockImplementation(async (flag: string) =>
      flag === 'matching.kyc_grace_legacy_providers',
    )

    const formData = new FormData()
    formData.set('category', 'plumbing')
    formData.set('title', 'Fix leaking pipe')
    formData.set('addressLine1', '12 Main Road')
    formData.set('locationNodeId', 'node-1')
    formData.set('preferredProviderId', 'provider-9')

    const { POST } = await import('@/app/api/customer/bookings/route')
    const response = await POST(new NextRequest('http://localhost/api/customer/bookings', {
      method: 'POST',
      body: formData,
    }))

    expect(response.status).toBe(200)
    expect(mockProviderFindFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        AND: expect.arrayContaining([
          expect.objectContaining({
            OR: expect.arrayContaining([
              { kycStatus: 'VERIFIED' },
              expect.objectContaining({
                AND: expect.arrayContaining([
                  expect.objectContaining({ createdAt: { lt: expect.any(Date) } }),
                  expect.objectContaining({
                    kycStatus: { notIn: expect.arrayContaining(['REJECTED', 'EXPIRED']) },
                  }),
                ]),
              }),
            ]),
          }),
        ]),
      }),
    }))
  })
})
