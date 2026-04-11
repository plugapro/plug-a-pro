// ─── Regression: create-job-request domain service ────────────────────────────
// Covers WS-A (unified creation path) and WS-B (transactional intake).

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createJobRequest } from '../../lib/job-requests/create-job-request'

const {
  mockDb,
  mockMergeCategoryRequirements,
  mockDispatchLeads,
} = vi.hoisted(() => ({
  mockDb: {
    $transaction: vi.fn(),
    customer: { upsert: vi.fn() },
    address: { create: vi.fn() },
    jobRequest: { create: vi.fn() },
  },
  mockMergeCategoryRequirements: vi.fn(),
  mockDispatchLeads: vi.fn(),
}))

vi.mock('../../lib/db', () => ({ db: mockDb }))

vi.mock('../../lib/service-category-policy', () => ({
  mergeCategoryRequirements: mockMergeCategoryRequirements,
}))

// Prevent the dynamic import inside createJobRequest from calling real matching
vi.mock('../../lib/matching-engine', () => ({
  dispatchLeads: mockDispatchLeads,
}))

const BASE_PARAMS = {
  phone: '+27821234567',
  customerName: 'Test Customer',
  category: 'plumbing',
  title: 'Plumbing',
  description: 'Burst pipe',
  street: '1 Main St',
  suburb: 'Randburg',
  city: 'Johannesburg',
  province: 'Gauteng',
}

describe('createJobRequest', () => {
  beforeEach(() => {
    vi.clearAllMocks()

    mockMergeCategoryRequirements.mockReturnValue({
      requiredCertificationCodes: [],
      requiredEquipmentTags: [],
      requiredVehicleTypes: [],
      policy: { bookingOnAssignment: false },
    })

    mockDispatchLeads.mockResolvedValue({ noMatch: false, leadsDispatched: 1, candidatesFound: 1, jobRequestId: 'jr-1' })

    // $transaction executes the callback immediately (synchronous mock)
    mockDb.$transaction.mockImplementation(
      async (fn: (tx: typeof mockDb) => Promise<unknown>) => fn(mockDb),
    )

    mockDb.customer.upsert.mockResolvedValue({ id: 'cust-1' })
    mockDb.address.create.mockResolvedValue({ id: 'addr-1' })
    mockDb.jobRequest.create.mockResolvedValue({ id: 'jr-1' })
  })

  it('creates customer + address + jobRequest inside a single transaction', async () => {
    const result = await createJobRequest(BASE_PARAMS)

    expect(mockDb.$transaction).toHaveBeenCalledOnce()
    expect(mockDb.customer.upsert).toHaveBeenCalledOnce()
    expect(mockDb.address.create).toHaveBeenCalledOnce()
    expect(mockDb.jobRequest.create).toHaveBeenCalledOnce()
    expect(result).toEqual({ jobRequestId: 'jr-1', customerId: 'cust-1' })
  })

  it('uses phone-only upsert for WhatsApp path (no userId)', async () => {
    await createJobRequest(BASE_PARAMS)

    expect(mockDb.customer.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ where: { phone: '+27821234567' } }),
    )
  })

  it('uses userId upsert for web path when userId is provided', async () => {
    await createJobRequest({ ...BASE_PARAMS, userId: 'user-abc' })

    expect(mockDb.customer.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: 'user-abc' } }),
    )
  })

  it('triggers dispatchLeads fire-and-forget after commit', async () => {
    await createJobRequest(BASE_PARAMS)

    // Flush microtasks so the dynamic-import chain resolves
    await new Promise<void>((resolve) => setTimeout(resolve, 0))

    expect(mockDispatchLeads).toHaveBeenCalledWith('jr-1')
  })

  it('does not throw if dispatchLeads fails — matching is non-blocking', async () => {
    mockDispatchLeads.mockRejectedValue(new Error('Matching down'))

    // Should resolve without throwing
    await expect(createJobRequest(BASE_PARAMS)).resolves.toBeDefined()
  })

  it('propagates transaction errors to the caller', async () => {
    mockDb.$transaction.mockRejectedValue(new Error('DB connection lost'))

    await expect(createJobRequest(BASE_PARAMS)).rejects.toThrow('DB connection lost')
  })
})
