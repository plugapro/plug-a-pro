import { beforeEach, describe, expect, it, vi } from 'vitest'

import { createJobRequest } from '../../../lib/job-requests/create-job-request'
import { PilotGateError } from '../../../lib/launch/errors'

const {
  mockDb,
  mockResolveCategoryRequirements,
  mockOrchestrateMatch,
  mockGeocodeAddress,
  mockGetJobRequestAccessUrl,
  mockSendText,
  mockCheckPilotGate,
  mockResolveAreaScopeByNodeId,
} = vi.hoisted(() => ({
  mockDb: {
    $transaction: vi.fn(),
    provider: { findFirst: vi.fn() },
    customer: { findUnique: vi.fn() },
  },
  mockResolveCategoryRequirements: vi.fn(),
  mockOrchestrateMatch: vi.fn(),
  mockGeocodeAddress: vi.fn(),
  mockGetJobRequestAccessUrl: vi.fn(),
  mockSendText: vi.fn(),
  mockCheckPilotGate: vi.fn(),
  mockResolveAreaScopeByNodeId: vi.fn(),
}))

vi.mock('../../../lib/db', () => ({ db: mockDb }))
vi.mock('../../../lib/category-config', () => ({
  resolveCategoryRequirements: mockResolveCategoryRequirements,
}))
vi.mock('../../../lib/geocoding', () => ({
  geocodeAddress: mockGeocodeAddress,
}))
vi.mock('../../../lib/matching-engine', () => ({
  dispatchLeads: vi.fn(),
}))
vi.mock('../../../lib/matching/orchestrator', () => ({
  orchestrateMatch: mockOrchestrateMatch,
}))
vi.mock('../../../lib/job-request-access', () => ({
  getJobRequestAccessUrl: mockGetJobRequestAccessUrl,
}))
vi.mock('../../../lib/whatsapp-interactive', () => ({
  sendText: mockSendText,
}))
vi.mock('../../../lib/customer-serviceability', () => ({
  checkPilotGate: mockCheckPilotGate,
  resolveAreaScopeByNodeId: mockResolveAreaScopeByNodeId,
}))

vi.mock('next/server', async (importOriginal) => {
  const original = await importOriginal<typeof import('next/server')>()
  return {
    ...original,
    after: (fn: () => void | Promise<void>) => {
      void Promise.resolve().then(fn).catch(() => undefined)
    },
  }
})

const BASE_PARAMS = {
  phone: '+27821234567',
  customerName: 'Test Customer',
  category: 'electrical',
  title: 'Wiring issue',
  description: 'Plug socket sparking',
  street: '1 Main St',
  suburb: 'Honeydew',
  city: 'Johannesburg',
  province: 'Gauteng',
  locationNodeId: 'node-1',
}

describe('createJobRequest — West Rand pilot gate (persistence seam)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockDb.provider.findFirst.mockResolvedValue(null)
    mockResolveCategoryRequirements.mockResolvedValue({
      requiredSkillTags: [],
      requiredCertificationCodes: [],
      requiredEquipmentTags: [],
      requiredVehicleTypes: [],
      policy: { bookingOnAssignment: false },
    })
    mockGeocodeAddress.mockResolvedValue({ lat: null, lng: null })
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
  })

  it('throws PilotGateError before opening the transaction when checkPilotGate rejects', async () => {
    mockCheckPilotGate.mockResolvedValue({
      ok: false,
      code: 'pilot.category_not_supported',
    })

    await expect(createJobRequest(BASE_PARAMS as any)).rejects.toBeInstanceOf(PilotGateError)

    expect(mockCheckPilotGate).toHaveBeenCalledWith({
      suburbSlug: 'gauteng__johannesburg__jhb_west__honeydew',
      rawCategory: 'electrical',
    })
    expect(mockDb.$transaction).not.toHaveBeenCalled()
  })

  it('passes through to the transaction when checkPilotGate accepts', async () => {
    mockCheckPilotGate.mockResolvedValue({ ok: true })
    mockDb.$transaction.mockResolvedValue({
      jobRequestId: 'jr-1',
      customerId: 'cust-1',
      ticketUrl: 'https://example.com/access',
    })
    mockGetJobRequestAccessUrl.mockResolvedValue('https://example.com/access')

    // We expect this to either succeed or fail downstream — we only care that
    // the gate was invoked and the transaction was reached.
    await createJobRequest({ ...BASE_PARAMS, category: 'plumbing' } as any).catch(() => undefined)

    expect(mockCheckPilotGate).toHaveBeenCalled()
    expect(mockDb.$transaction).toHaveBeenCalled()
  })
})
