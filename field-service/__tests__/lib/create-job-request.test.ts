import { beforeEach, describe, expect, it, vi } from 'vitest'

import { createJobRequest } from '../../lib/job-requests/create-job-request'

const {
  mockDb,
  mockResolveCategoryRequirements,
  mockDispatchLeads,
  mockOrchestrateMatch,
  mockGeocodeAddress,
  mockGetJobRequestAccessUrl,
} = vi.hoisted(() => ({
  mockDb: {
    $transaction: vi.fn(),
    provider: {
      findFirst: vi.fn(),
    },
  },
  mockResolveCategoryRequirements: vi.fn(),
  mockDispatchLeads: vi.fn(),
  mockOrchestrateMatch: vi.fn(),
  mockGeocodeAddress: vi.fn(),
  mockGetJobRequestAccessUrl: vi.fn(),
}))

vi.mock('../../lib/db', () => ({ db: mockDb }))

vi.mock('../../lib/category-config', () => ({
  resolveCategoryRequirements: mockResolveCategoryRequirements,
}))

vi.mock('../../lib/geocoding', () => ({
  geocodeAddress: mockGeocodeAddress,
}))

vi.mock('../../lib/matching-engine', () => ({
  dispatchLeads: mockDispatchLeads,
}))

vi.mock('../../lib/matching/orchestrator', () => ({
  orchestrateMatch: mockOrchestrateMatch,
}))

vi.mock('../../lib/job-request-access', () => ({
  getJobRequestAccessUrl: mockGetJobRequestAccessUrl,
}))

// after() from next/server requires a request scope; stub it in tests so
// the fire-and-forget block runs synchronously and does not throw.
vi.mock('next/server', async (importOriginal) => {
  const original = await importOriginal<typeof import('next/server')>()
  return {
    ...original,
    after: (fn: () => void | Promise<void>) => {
      // Execute immediately in test context — no request scope needed
      void Promise.resolve().then(fn).catch(() => undefined)
    },
  }
})

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
      findFirst: vi.fn().mockResolvedValue(null),
      create: vi.fn(),
    },
    jobRequest: {
      // Default: no existing active request — dedup guard passes through
      findFirst: vi.fn().mockResolvedValue(null),
      create: vi.fn(),
    },
  }
}

describe('createJobRequest', () => {
  beforeEach(() => {
    vi.clearAllMocks()

    mockResolveCategoryRequirements.mockResolvedValue({
      requiredCertificationCodes: [],
      requiredEquipmentTags: [],
      requiredVehicleTypes: [],
      policy: { bookingOnAssignment: false },
    })
    mockGeocodeAddress.mockResolvedValue({ lat: -26.1, lng: 27.9 })
    mockGetJobRequestAccessUrl.mockResolvedValue(null)
    mockDb.provider.findFirst.mockResolvedValue(null)
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
    expect(result).toEqual({ jobRequestId: 'jr-1', customerId: 'cust-1', ticketUrl: null })
  })

  it('blocks customer request creation when the phone belongs to a provider', async () => {
    mockDb.provider.findFirst.mockResolvedValue({ id: 'prv_1', status: 'ACTIVE' })

    await expect(createJobRequest(BASE_PARAMS)).rejects.toThrow('PHONE_ROLE_CONFLICT_PROVIDER')
    expect(mockDb.$transaction).not.toHaveBeenCalled()
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
    expect(result).toEqual({ jobRequestId: 'jr-1', customerId: 'cust-by-user', ticketUrl: null })
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
        isTestUser: false,
        cohortName: null,
      },
      select: { id: true },
    })
  })

  it('marks internal staff customer requests with the test cohort', async () => {
    const tx = makeTx()
    tx.customer.upsert.mockResolvedValue({ id: 'cust-test' })
    tx.address.create.mockResolvedValue({ id: 'addr-test' })
    tx.jobRequest.create.mockResolvedValue({ id: 'jr-test' })
    mockDb.$transaction.mockImplementation(async (fn: (client: typeof tx) => Promise<unknown>) => fn(tx))

    await createJobRequest({
      ...BASE_PARAMS,
      phone: '0823035070',
    })

    expect(tx.customer.upsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { phone: '+27823035070' },
      create: expect.objectContaining({
        phone: '+27823035070',
        isTestUser: true,
        cohortName: 'internal_staff_test',
      }),
    }))
    expect(tx.jobRequest.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        customerId: 'cust-test',
        isTestRequest: true,
        cohortName: 'internal_staff_test',
      }),
    }))
  })

  it('triggers orchestrateMatch fire-and-forget via after() after commit', async () => {
    const tx = makeTx()
    tx.customer.upsert.mockResolvedValue({ id: 'cust-1' })
    tx.address.create.mockResolvedValue({ id: 'addr-1' })
    tx.jobRequest.create.mockResolvedValue({ id: 'jr-1' })
    mockDb.$transaction.mockImplementation(async (fn: (client: typeof tx) => Promise<unknown>) => fn(tx))
    mockOrchestrateMatch.mockResolvedValue({ status: 'DISPATCHED', holdId: 'hold-1', providerId: 'p-1' })

    await createJobRequest(BASE_PARAMS)
    // Let the after() microtask queue drain
    await new Promise<void>((resolve) => setTimeout(resolve, 10))

    expect(mockOrchestrateMatch).toHaveBeenCalledWith('jr-1', { triggeredBy: 'job_creation' })
  })

  it('does not throw if orchestrateMatch fails — matching is non-blocking', async () => {
    const tx = makeTx()
    tx.customer.upsert.mockResolvedValue({ id: 'cust-1' })
    tx.address.create.mockResolvedValue({ id: 'addr-1' })
    tx.jobRequest.create.mockResolvedValue({ id: 'jr-1' })
    mockDb.$transaction.mockImplementation(async (fn: (client: typeof tx) => Promise<unknown>) => fn(tx))
    mockOrchestrateMatch.mockRejectedValue(new Error('Matching down'))

    await expect(createJobRequest(BASE_PARAMS)).resolves.toBeDefined()
  })

  it('returns a created request even if ticket URL generation fails', async () => {
    const tx = makeTx()
    tx.customer.upsert.mockResolvedValue({ id: 'cust-1' })
    tx.address.create.mockResolvedValue({ id: 'addr-1' })
    tx.jobRequest.create.mockResolvedValue({ id: 'jr-1' })
    mockDb.$transaction.mockImplementation(async (fn: (client: typeof tx) => Promise<unknown>) => fn(tx))
    mockGetJobRequestAccessUrl.mockRejectedValue(new Error('Token write failed'))

    await expect(createJobRequest(BASE_PARAMS)).resolves.toEqual({
      jobRequestId: 'jr-1',
      customerId: 'cust-1',
      ticketUrl: null,
    })
  })

  it('propagates transaction errors to the caller', async () => {
    mockDb.$transaction.mockRejectedValue(new Error('DB connection lost'))

    await expect(createJobRequest(BASE_PARAMS)).rejects.toThrow('DB connection lost')
  })

  // ── expiresAt computation ─────────────────────────────────────────────────

  it('sets expiresAt to jobRequestMaxAgeDays from now by default', async () => {
    const { MATCHING_CONFIG } = await import('../../lib/matching/config')
    const tx = makeTx()
    tx.customer.upsert.mockResolvedValue({ id: 'cust-1' })
    tx.address.create.mockResolvedValue({ id: 'addr-1' })
    tx.jobRequest.create.mockResolvedValue({ id: 'jr-1' })
    mockDb.$transaction.mockImplementation(async (fn: (client: typeof tx) => Promise<unknown>) => fn(tx))

    const before = Date.now()
    await createJobRequest(BASE_PARAMS)
    const after = Date.now()

    expect(tx.jobRequest.create).toHaveBeenCalledOnce()
    const { data } = (tx.jobRequest.create as ReturnType<typeof vi.fn>).mock.calls[0][0]
    expect(data.expiresAt).toBeInstanceOf(Date)

    const expiresMs = (data.expiresAt as Date).getTime()
    const defaultOffsetMs = MATCHING_CONFIG.jobRequestMaxAgeDays * 24 * 60 * 60 * 1000
    expect(expiresMs).toBeGreaterThanOrEqual(before + defaultOffsetMs - 500)
    expect(expiresMs).toBeLessThanOrEqual(after + defaultOffsetMs + 500)
  })

  it('uses requestedArrivalLatest + 24h when that falls before the 7-day default', async () => {
    const tx = makeTx()
    tx.customer.upsert.mockResolvedValue({ id: 'cust-1' })
    tx.address.create.mockResolvedValue({ id: 'addr-1' })
    tx.jobRequest.create.mockResolvedValue({ id: 'jr-1' })
    mockDb.$transaction.mockImplementation(async (fn: (client: typeof tx) => Promise<unknown>) => fn(tx))

    // 2 days from now → arrivalLatest + 24h = 3 days, well inside the 7-day default
    const requestedArrivalLatest = new Date(Date.now() + 2 * 24 * 60 * 60 * 1000)
    await createJobRequest({ ...BASE_PARAMS, requestedArrivalLatest })

    const { data } = (tx.jobRequest.create as ReturnType<typeof vi.fn>).mock.calls[0][0]
    const expiresMs = (data.expiresAt as Date).getTime()
    const expectedMs = requestedArrivalLatest.getTime() + 24 * 60 * 60 * 1000
    expect(expiresMs).toBeGreaterThanOrEqual(expectedMs - 500)
    expect(expiresMs).toBeLessThanOrEqual(expectedMs + 500)
  })

  it('keeps the 7-day default when requestedArrivalLatest + 24h would exceed it', async () => {
    const { MATCHING_CONFIG } = await import('../../lib/matching/config')
    const tx = makeTx()
    tx.customer.upsert.mockResolvedValue({ id: 'cust-1' })
    tx.address.create.mockResolvedValue({ id: 'addr-1' })
    tx.jobRequest.create.mockResolvedValue({ id: 'jr-1' })
    mockDb.$transaction.mockImplementation(async (fn: (client: typeof tx) => Promise<unknown>) => fn(tx))

    // 8 days from now → arrivalLatest + 24h = 9 days, exceeds the 7-day default
    const requestedArrivalLatest = new Date(Date.now() + 8 * 24 * 60 * 60 * 1000)
    const before = Date.now()
    await createJobRequest({ ...BASE_PARAMS, requestedArrivalLatest })
    const after = Date.now()

    const { data } = (tx.jobRequest.create as ReturnType<typeof vi.fn>).mock.calls[0][0]
    const expiresMs = (data.expiresAt as Date).getTime()
    const defaultOffsetMs = MATCHING_CONFIG.jobRequestMaxAgeDays * 24 * 60 * 60 * 1000
    expect(expiresMs).toBeGreaterThanOrEqual(before + defaultOffsetMs - 500)
    expect(expiresMs).toBeLessThanOrEqual(after + defaultOffsetMs + 500)
  })

  it('expiresAt is always a Date — never undefined or null', async () => {
    const tx = makeTx()
    tx.customer.upsert.mockResolvedValue({ id: 'cust-1' })
    tx.address.create.mockResolvedValue({ id: 'addr-1' })
    tx.jobRequest.create.mockResolvedValue({ id: 'jr-1' })
    mockDb.$transaction.mockImplementation(async (fn: (client: typeof tx) => Promise<unknown>) => fn(tx))

    await createJobRequest(BASE_PARAMS)

    const { data } = (tx.jobRequest.create as ReturnType<typeof vi.fn>).mock.calls[0][0]
    expect(data.expiresAt).toBeDefined()
    expect(data.expiresAt).not.toBeNull()
    expect(data.expiresAt).toBeInstanceOf(Date)
  })
})
