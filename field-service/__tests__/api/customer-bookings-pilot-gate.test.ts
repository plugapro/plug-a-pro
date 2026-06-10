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
  mockIsEnabled,
  mockCheckPilotGate,
  mockResolveAreaScopeByNodeId,
  mockCountActiveProvidersFor,
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
  mockIsEnabled: vi.fn(),
  mockCheckPilotGate: vi.fn(),
  mockResolveAreaScopeByNodeId: vi.fn(),
  mockCountActiveProvidersFor: vi.fn(),
}))

vi.mock('@/lib/auth', () => ({ getSession: mockGetSession }))
vi.mock('@/lib/db', () => ({
  db: {
    provider: { findFirst: mockProviderFindFirst },
    jobRequest: { count: mockJobRequestCount },
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
vi.mock('@/lib/flags', () => ({ isEnabled: mockIsEnabled }))
vi.mock('@/lib/customer-serviceability', () => ({
  checkPilotGate: mockCheckPilotGate,
  resolveAreaScopeByNodeId: mockResolveAreaScopeByNodeId,
  countActiveProvidersFor: mockCountActiveProvidersFor,
}))

function buildRequest(body: Record<string, unknown>): NextRequest {
  const form = new FormData()
  for (const [key, value] of Object.entries(body)) {
    form.append(key, value as string)
  }
  return new NextRequest('http://localhost/api/customer/bookings', {
    method: 'POST',
    body: form,
  })
}

const VALID_BODY = {
  category: 'plumbing',
  title: 'Leaking tap',
  description: 'Kitchen tap drips',
  addressLine1: '12 Main Road',
  locationNodeId: 'node-1',
}

describe('POST /api/customer/bookings — west-rand pilot gate', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetSession.mockResolvedValue({
      id: 'customer-user-1',
      role: 'customer',
      phone: '+27821234567',
    })
    mockResolveStructuredAddressCapture.mockResolvedValue({
      street: '12 Main Road',
      addressLine1: '12 Main Road',
      addressLine2: null,
      complexName: null,
      unitNumber: null,
      suburb: 'Honeydew',
      region: 'JHB West',
      city: 'Johannesburg',
      province: 'Gauteng',
      postalCode: '2170',
      locationNodeId: 'node-1',
    })
    mockIsInActiveServiceArea.mockReturnValue(true)
    mockCreateJobRequest.mockResolvedValue({
      jobRequestId: 'jr-1',
      customerId: 'cust-1',
      ticketUrl: 'https://app.example/requests/access/token',
    })
    mockProviderFindFirst.mockResolvedValue(null)
    mockUploadJobRequestPhoto.mockResolvedValue(null)
    mockNotifyCustomerPwaRequestSubmitted.mockResolvedValue({ sent: true })
    mockResolveAreaScopeByNodeId.mockResolvedValue({
      node: {
        id: 'node-1',
        slug: 'gauteng__johannesburg__jhb_west__honeydew',
        label: 'Honeydew',
        nodeType: 'SUBURB',
        provinceKey: 'gauteng',
        cityKey: 'johannesburg',
        regionKey: 'jhb_west',
      },
    })
    mockCountActiveProvidersFor.mockResolvedValue(5)
    // Default: all flags off
    mockIsEnabled.mockResolvedValue(false)
    mockCheckPilotGate.mockResolvedValue({ ok: true })
  })

  it('passes through when pilot master flag is OFF (no behaviour change)', async () => {
    mockIsEnabled.mockResolvedValue(false)
    mockCheckPilotGate.mockResolvedValue({ ok: true })

    const { POST } = await import('@/app/api/customer/bookings/route')
    const res = await POST(buildRequest(VALID_BODY))

    expect(res.status).toBe(200)
    expect(mockCreateJobRequest).toHaveBeenCalledTimes(1)
  })

  it('rejects with 422 pilot.suburb_not_supported when checkPilotGate returns that code', async () => {
    mockCheckPilotGate.mockResolvedValue({
      ok: false,
      code: 'pilot.suburb_not_supported',
    })

    const { POST } = await import('@/app/api/customer/bookings/route')
    const res = await POST(buildRequest({
      ...VALID_BODY,
      // anywhere outside the pilot
    }))
    const body = await res.json()

    expect(res.status).toBe(422)
    expect(body.error?.code).toBe('pilot.suburb_not_supported')
    expect(body.error?.reference_id).toMatch(/^PAP-\d{8}-[A-Z0-9]{6}$/)
    expect(mockCreateJobRequest).not.toHaveBeenCalled()
  })

  it('rejects with 422 pilot.category_not_supported when checkPilotGate returns that code', async () => {
    mockCheckPilotGate.mockResolvedValue({
      ok: false,
      code: 'pilot.category_not_supported',
    })

    const { POST } = await import('@/app/api/customer/bookings/route')
    const res = await POST(buildRequest({
      ...VALID_BODY,
      category: 'electrical',
    }))
    const body = await res.json()

    expect(res.status).toBe(422)
    expect(body.error?.code).toBe('pilot.category_not_supported')
    expect(mockCreateJobRequest).not.toHaveBeenCalled()
  })

  it('passes the canonical category and resolved suburb slug to checkPilotGate', async () => {
    mockCheckPilotGate.mockResolvedValue({ ok: true })

    const { POST } = await import('@/app/api/customer/bookings/route')
    await POST(buildRequest({ ...VALID_BODY, category: 'Plumbing' }))

    expect(mockCheckPilotGate).toHaveBeenCalledWith({
      suburbSlug: 'gauteng__johannesburg__jhb_west__honeydew',
      rawCategory: 'plumbing',
    })
  })
})
