import { beforeEach, describe, expect, it, vi } from 'vitest'

import { createJobRequest } from '../../lib/job-requests/create-job-request'

const {
  mockDb,
  mockMergeCategoryRequirements,
  mockDispatchLeads,
  mockGeocodeAddress,
} = vi.hoisted(() => ({
  mockDb: {
    $transaction: vi.fn(),
  },
  mockMergeCategoryRequirements: vi.fn(),
  mockDispatchLeads: vi.fn(),
  mockGeocodeAddress: vi.fn(),
}))

vi.mock('../../lib/db', () => ({ db: mockDb }))

vi.mock('../../lib/service-category-policy', () => ({
  mergeCategoryRequirements: mockMergeCategoryRequirements,
}))

vi.mock('../../lib/geocoding', () => ({
  geocodeAddress: mockGeocodeAddress,
}))

vi.mock('../../lib/matching-engine', () => ({
  dispatchLeads: mockDispatchLeads,
}))

const BASE_PARAMS = {
  phone: '+27821234567',
  customerName: 'Test Customer',
  category: 'plumbing',
  title: 'Fix leaking pipe',
  description: 'Burst pipe in kitchen',
  street: '1 Main St',
  suburb: 'Randburg',
  city: 'Johannesburg',
  province: 'Gauteng',
}

function makeTx() {
  return {
    customer: {
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      upsert: vi.fn(),
    },
    address: {
      create: vi.fn(),
    },
    jobRequest: {
      create: vi.fn(),
    },
  }
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
    mockGeocodeAddress.mockResolvedValue({ lat: -26.1, lng: 27.9 })
    mockDispatchLeads.mockResolvedValue({
      noMatch: false,
      leadsDispatched: 1,
      candidatesFound: 1,
      jobRequestId: 'jr-1',
    })
  })

  it('creates phone-only WhatsApp customers via upsert and completes the intake transaction', async () => {
    const tx = makeTx()
    tx.customer.upsert.mockResolvedValue({ id: 'cust-1' })
    tx.address.create.mockResolvedValue({ id: 'addr-1' })
    tx.jobRequest.create.mockResolvedValue({ id: 'jr-1' })
    mockDb.$transaction.mockImplementation(async (fn: (client: typeof tx) => Promise<unknown>) => fn(tx))

    const result = await createJobRequest(BASE_PARAMS)

    expect(tx.customer.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ where: { phone: '+27821234567' } }),
    )
    expect(tx.address.create).toHaveBeenCalledOnce()
    expect(tx.jobRequest.create).toHaveBeenCalledOnce()
    expect(result).toEqual({ jobRequestId: 'jr-1', customerId: 'cust-1' })
  })

  it('reuses an existing web customer by userId when present', async () => {
    const tx = makeTx()
    tx.customer.findUnique.mockResolvedValueOnce({ id: 'cust-by-user' })
    tx.address.create.mockResolvedValue({ id: 'addr-1' })
    tx.jobRequest.create.mockResolvedValue({ id: 'jr-1' })
    mockDb.$transaction.mockImplementation(async (fn: (client: typeof tx) => Promise<unknown>) => fn(tx))

    const result = await createJobRequest({ ...BASE_PARAMS, userId: 'user-abc' })

    expect(tx.customer.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: 'user-abc' } }),
    )
    expect(tx.customer.update).not.toHaveBeenCalled()
    expect(tx.customer.create).not.toHaveBeenCalled()
    expect(result).toEqual({ jobRequestId: 'jr-1', customerId: 'cust-by-user' })
  })

  it('links an existing phone customer to the authenticated web user when userId lookup misses', async () => {
    const tx = makeTx()
    tx.customer.findUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: 'cust-by-phone', userId: null, name: 'WhatsApp Customer' })
    tx.customer.update.mockResolvedValue({ id: 'cust-by-phone' })
    tx.address.create.mockResolvedValue({ id: 'addr-1' })
    tx.jobRequest.create.mockResolvedValue({ id: 'jr-1' })
    mockDb.$transaction.mockImplementation(async (fn: (client: typeof tx) => Promise<unknown>) => fn(tx))

    await createJobRequest({ ...BASE_PARAMS, userId: 'user-abc' })

    expect(tx.customer.update).toHaveBeenCalledWith({
      where: { id: 'cust-by-phone' },
      data: {
        userId: 'user-abc',
        name: 'Test Customer',
      },
      select: { id: true },
    })
  })

  it('creates a fresh linked customer when no existing userId or phone match exists', async () => {
    const tx = makeTx()
    tx.customer.findUnique.mockResolvedValueOnce(null).mockResolvedValueOnce(null)
    tx.customer.create.mockResolvedValue({ id: 'cust-new' })
    tx.address.create.mockResolvedValue({ id: 'addr-1' })
    tx.jobRequest.create.mockResolvedValue({ id: 'jr-1' })
    mockDb.$transaction.mockImplementation(async (fn: (client: typeof tx) => Promise<unknown>) => fn(tx))

    await createJobRequest({ ...BASE_PARAMS, userId: 'user-abc' })

    expect(tx.customer.create).toHaveBeenCalledWith({
      data: {
        userId: 'user-abc',
        phone: '+27821234567',
        name: 'Test Customer',
      },
      select: { id: true },
    })
  })

  it('triggers dispatchLeads fire-and-forget after commit', async () => {
    const tx = makeTx()
    tx.customer.upsert.mockResolvedValue({ id: 'cust-1' })
    tx.address.create.mockResolvedValue({ id: 'addr-1' })
    tx.jobRequest.create.mockResolvedValue({ id: 'jr-1' })
    mockDb.$transaction.mockImplementation(async (fn: (client: typeof tx) => Promise<unknown>) => fn(tx))

    await createJobRequest(BASE_PARAMS)
    await new Promise<void>((resolve) => setTimeout(resolve, 0))

    expect(mockDispatchLeads).toHaveBeenCalledWith('jr-1')
  })

  it('does not throw if dispatchLeads fails — matching is non-blocking', async () => {
    const tx = makeTx()
    tx.customer.upsert.mockResolvedValue({ id: 'cust-1' })
    tx.address.create.mockResolvedValue({ id: 'addr-1' })
    tx.jobRequest.create.mockResolvedValue({ id: 'jr-1' })
    mockDb.$transaction.mockImplementation(async (fn: (client: typeof tx) => Promise<unknown>) => fn(tx))
    mockDispatchLeads.mockRejectedValue(new Error('Matching down'))

    await expect(createJobRequest(BASE_PARAMS)).resolves.toBeDefined()
  })

  it('propagates transaction errors to the caller', async () => {
    mockDb.$transaction.mockRejectedValue(new Error('DB connection lost'))

    await expect(createJobRequest(BASE_PARAMS)).rejects.toThrow('DB connection lost')
  })
})
