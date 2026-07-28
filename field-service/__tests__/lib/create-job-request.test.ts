import { beforeEach, describe, expect, it, vi } from 'vitest'

import { createJobRequest } from '../../lib/job-requests/create-job-request'

const {
  mockDb,
  mockResolveCategoryRequirements,
  mockDispatchLeads,
  mockOrchestrateMatch,
  mockGeocodeAddress,
  mockGetJobRequestAccessUrl,
  mockSendText,
} = vi.hoisted(() => ({
  mockDb: {
    $transaction: vi.fn(),
    provider: {
      findFirst: vi.fn(),
    },
    customer: {
      findUnique: vi.fn(),
    },
  },
  mockResolveCategoryRequirements: vi.fn(),
  mockDispatchLeads: vi.fn(),
  mockOrchestrateMatch: vi.fn(),
  mockGeocodeAddress: vi.fn(),
  mockGetJobRequestAccessUrl: vi.fn(),
  mockSendText: vi.fn(),
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

vi.mock('../../lib/whatsapp-interactive', () => ({
  sendText: mockSendText,
}))

// after() from next/server requires a request scope; stub it in tests so
// the fire-and-forget block runs synchronously and does not throw.
vi.mock('next/server', async (importOriginal) => {
  const original = await importOriginal<typeof import('next/server')>()
  return {
    ...original,
    after: (fn: () => void | Promise<void>) => {
      // Execute immediately in test context - no request scope needed
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
    customerAddress: {
      findMany: vi.fn().mockResolvedValue([]),
      create: vi.fn().mockResolvedValue({
        id: 'site-1',
        customerId: 'cust-1',
        label: '1 Main St',
        street: '1 Main St',
        suburb: 'Randburg',
        city: 'Johannesburg',
        province: 'Gauteng',
        postalCode: null,
        lat: null,
        lng: null,
        locationNodeId: null,
        isDefault: true,
        createdAt: new Date(),
        locationNode: null,
      }),
      update: vi.fn().mockResolvedValue({
        id: 'site-1',
        customerId: 'cust-1',
        label: '1 Main St',
        street: '1 Main St',
        suburb: 'Randburg',
        city: 'Johannesburg',
        province: 'Gauteng',
        postalCode: null,
        lat: null,
        lng: null,
        locationNodeId: null,
        isDefault: true,
        createdAt: new Date(),
        locationNode: null,
      }),
    },
    jobRequest: {
      // Default: no existing active request - dedup guard passes through
      findFirst: vi.fn().mockResolvedValue(null),
      create: vi.fn(),
    },
    attachment: {
      updateMany: vi.fn(),
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
    mockDb.customer.findUnique.mockResolvedValue({
      phone: '+27821234567',
      name: 'Test Customer',
      isTestUser: false,
    })
    mockSendText.mockResolvedValue(undefined)
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
    tx.customerAddress.create.mockResolvedValue({
      id: 'site-1',
      customerId: 'cust-1',
      label: '1 Main St',
      street: '1 Main St',
      suburb: 'Randburg',
      city: 'Johannesburg',
      province: 'Gauteng',
      postalCode: null,
      lat: -26.1,
      lng: 27.9,
      locationNodeId: null,
      isDefault: true,
      createdAt: new Date(),
      locationNode: null,
    })
    tx.jobRequest.create.mockResolvedValue({ id: 'jr-1' })
    mockDb.$transaction.mockImplementation(async (fn: (client: typeof tx) => Promise<unknown>) => fn(tx))

    const result = await createJobRequest(BASE_PARAMS)

    expect(tx.customer.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ where: { phone: '+27821234567' } }),
    )
    expect(tx.customerAddress.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        customerId: 'cust-1',
        street: '1 Main St',
        suburb: 'Randburg',
        city: 'Johannesburg',
        province: 'Gauteng',
        isDefault: true,
      }),
    }))
    expect(tx.address.create).toHaveBeenCalledOnce()
    expect(tx.jobRequest.create).toHaveBeenCalledOnce()
    expect(result).toMatchObject({ jobRequestId: 'jr-1', customerId: 'cust-1', ticketUrl: null })
    expect(result.requestRef).toMatch(/^PAP-/)
  })

  it('canonicalizes category labels before policy lookup, duplicate guard and JobRequest create', async () => {
    const tx = makeTx()
    tx.customer.upsert.mockResolvedValue({ id: 'cust-1' })
    tx.address.create.mockResolvedValue({ id: 'addr-1' })
    tx.jobRequest.create.mockResolvedValue({ id: 'jr-1' })
    mockDb.$transaction.mockImplementation(async (fn: (client: typeof tx) => Promise<unknown>) => fn(tx))

    await createJobRequest({ ...BASE_PARAMS, category: 'Plumbing' })

    expect(mockResolveCategoryRequirements).toHaveBeenCalledWith(expect.objectContaining({
      category: 'plumbing',
    }))
    expect(tx.jobRequest.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ category: 'plumbing' }),
    }))
    expect(tx.jobRequest.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ category: 'plumbing' }),
    }))
  })

  it('stores customer address locality fields in display case while preserving matching lookup', async () => {
    const tx = makeTx()
    tx.customer.upsert.mockResolvedValue({ id: 'cust-1' })
    tx.address.create.mockResolvedValue({ id: 'addr-1' })
    tx.jobRequest.create.mockResolvedValue({ id: 'jr-1' })
    mockDb.$transaction.mockImplementation(async (fn: (client: typeof tx) => Promise<unknown>) => fn(tx))

    await createJobRequest({
      ...BASE_PARAMS,
      suburb: 'ruimsig',
      region: 'jhb west',
      city: 'johannesburg',
      province: 'gauteng',
    })

    expect(mockGeocodeAddress).toHaveBeenCalledWith(expect.objectContaining({
      suburb: 'Ruimsig',
      city: 'Johannesburg',
      province: 'Gauteng',
    }))
    expect(tx.address.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          suburb: 'Ruimsig',
          region: 'JHB West',
          city: 'Johannesburg',
          province: 'Gauteng',
        }),
      }),
    )
  })

  it('reuses an existing customer name when caller omits a placeholder name', async () => {
    const tx = makeTx()
    tx.customer.findUnique.mockResolvedValueOnce({
      id: 'cust-by-phone',
      userId: null,
      name: 'Sarah Sullivan',
      isTestUser: false,
      cohortName: null,
    })
    tx.customer.upsert.mockResolvedValue({ id: 'cust-by-phone' })
    tx.address.create.mockResolvedValue({ id: 'addr-1' })
    tx.jobRequest.create.mockResolvedValue({ id: 'jr-1' })
    mockDb.$transaction.mockImplementation(async (fn: (client: typeof tx) => Promise<unknown>) => fn(tx))

    await createJobRequest({
      ...BASE_PARAMS,
      customerName: 'WhatsApp Customer',
    })

    const upsertCall = (tx.customer.upsert as ReturnType<typeof vi.fn>).mock.calls[0][0]
    expect(upsertCall).toMatchObject({
      create: expect.objectContaining({
        name: 'Sarah Sullivan',
      }),
      update: expect.not.objectContaining({ name: 'WhatsApp Customer' }),
    })
  })

  it('links pre-uploaded WhatsApp customer photos inside the intake transaction', async () => {
    const tx = makeTx()
    tx.customer.upsert.mockResolvedValue({ id: 'cust-1' })
    tx.address.create.mockResolvedValue({ id: 'addr-1' })
    tx.jobRequest.create.mockResolvedValue({ id: 'jr-1' })
    tx.attachment.updateMany.mockResolvedValue({ count: 2 })
    mockDb.$transaction.mockImplementation(async (fn: (client: typeof tx) => Promise<unknown>) => fn(tx))

    await createJobRequest({ ...BASE_PARAMS, photoAttachmentIds: ['att-1', 'att-2', 'att-1'] })

    expect(tx.attachment.updateMany).toHaveBeenCalledWith({
      where: {
        id: { in: ['att-1', 'att-2'] },
        jobRequestId: null,
        jobId: null,
        providerApplicationId: null,
        label: 'customer_photo',
      },
      data: { jobRequestId: 'jr-1' },
    })
  })

  it('rolls back request creation when uploaded photos cannot all be linked', async () => {
    const tx = makeTx()
    tx.customer.upsert.mockResolvedValue({ id: 'cust-1' })
    tx.address.create.mockResolvedValue({ id: 'addr-1' })
    tx.jobRequest.create.mockResolvedValue({ id: 'jr-1' })
    tx.attachment.updateMany.mockResolvedValue({ count: 1 })
    mockDb.$transaction.mockImplementation(async (fn: (client: typeof tx) => Promise<unknown>) => fn(tx))

    await expect(
      createJobRequest({ ...BASE_PARAMS, photoAttachmentIds: ['att-1', 'att-2'] }),
    ).rejects.toThrow('JOB_REQUEST_PHOTO_LINK_FAILED')

    expect(tx.attachment.updateMany).toHaveBeenCalledOnce()
    expect(mockOrchestrateMatch).not.toHaveBeenCalled()
  })

  it('blocks customer request creation when the phone belongs to a provider', async () => {
    mockDb.provider.findFirst.mockResolvedValue({ id: 'prv_1', status: 'ACTIVE' })

    await expect(createJobRequest(BASE_PARAMS)).rejects.toThrow('PHONE_ROLE_CONFLICT_PROVIDER')
    expect(mockDb.$transaction).not.toHaveBeenCalled()
  })

  it('reuses an existing web customer by userId when present', async () => {
    const tx = makeTx()
    tx.customer.findUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: 'cust-by-user' })
    tx.address.create.mockResolvedValue({ id: 'addr-1' })
    tx.jobRequest.create.mockResolvedValue({ id: 'jr-1' })
    mockDb.$transaction.mockImplementation(async (fn: (client: typeof tx) => Promise<unknown>) => fn(tx))

    const result = await createJobRequest({ ...BASE_PARAMS, userId: 'user-abc' })

    expect(tx.customer.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: 'user-abc' } }),
    )
    expect(tx.customer.update).not.toHaveBeenCalled()
    expect(tx.customer.create).not.toHaveBeenCalled()
    expect(result).toMatchObject({ jobRequestId: 'jr-1', customerId: 'cust-by-user', ticketUrl: null })
    expect(result.requestRef).toMatch(/^PAP-/)
  })

  it('links an existing phone customer to the authenticated web user when userId lookup misses', async () => {
    const tx = makeTx()
    tx.customer.findUnique
      .mockResolvedValueOnce({ id: 'cust-by-phone', userId: null, name: 'WhatsApp Customer', isTestUser: false, cohortName: null })
      .mockResolvedValueOnce(null)
    tx.customer.update.mockResolvedValue({ id: 'cust-by-phone', isTestUser: false, cohortName: null })
    tx.address.create.mockResolvedValue({ id: 'addr-1' })
    tx.jobRequest.create.mockResolvedValue({ id: 'jr-1' })
    mockDb.$transaction.mockImplementation(async (fn: (client: typeof tx) => Promise<unknown>) => fn(tx))

    await createJobRequest({ ...BASE_PARAMS, userId: 'user-abc' })

    expect(tx.customer.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'cust-by-phone' },
      data: {
        userId: 'user-abc',
        name: 'Test Customer',
      },
    }))
  })

  it('creates a fresh linked customer when no existing userId or phone match exists', async () => {
    const tx = makeTx()
    tx.customer.findUnique.mockResolvedValueOnce(null).mockResolvedValueOnce(null)
    tx.customer.create.mockResolvedValue({ id: 'cust-new', isTestUser: false, cohortName: null })
    tx.address.create.mockResolvedValue({ id: 'addr-1' })
    tx.jobRequest.create.mockResolvedValue({ id: 'jr-1' })
    mockDb.$transaction.mockImplementation(async (fn: (client: typeof tx) => Promise<unknown>) => fn(tx))

    await createJobRequest({ ...BASE_PARAMS, userId: 'user-abc' })

    expect(tx.customer.create).toHaveBeenCalledWith(expect.objectContaining({
      data: {
        userId: 'user-abc',
        phone: '+27821234567',
        name: 'Test Customer',
        isTestUser: false,
        cohortName: null,
      },
    }))
  })

  it('marks internal staff customer requests with the test cohort', async () => {
    const tx = makeTx()
    tx.customer.upsert.mockResolvedValue({ id: 'cust-test', isTestUser: true, cohortName: 'internal_staff_test' })
    tx.address.create.mockResolvedValue({ id: 'addr-test' })
    tx.jobRequest.create.mockResolvedValue({ id: 'jr-test' })
    mockDb.$transaction.mockImplementation(async (fn: (client: typeof tx) => Promise<unknown>) => fn(tx))

    await createJobRequest({
      ...BASE_PARAMS,
      phone: '27000000001',
    })

    expect(tx.customer.upsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { phone: '+27000000001' },
      create: expect.objectContaining({
        phone: '+27000000001',
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

  it('does not trigger matching when matching-mode selection is deferred', async () => {
    const tx = makeTx()
    tx.customer.upsert.mockResolvedValue({ id: 'cust-1' })
    tx.address.create.mockResolvedValue({ id: 'addr-1' })
    tx.jobRequest.create.mockResolvedValue({ id: 'jr-1' })
    mockDb.$transaction.mockImplementation(async (fn: (client: typeof tx) => Promise<unknown>) => fn(tx))

    await createJobRequest({ ...BASE_PARAMS, deferMatchingModeSelection: true })
    await new Promise<void>((resolve) => setTimeout(resolve, 10))

    expect(tx.jobRequest.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: 'PENDING_VALIDATION',
          assignmentMode: 'OPS_REVIEW',
        }),
      }),
    )
    expect(mockOrchestrateMatch).not.toHaveBeenCalled()
  })

  it('does not trigger matching when created in non-auto mode', async () => {
    const tx = makeTx()
    tx.customer.upsert.mockResolvedValue({ id: 'cust-1' })
    tx.address.create.mockResolvedValue({ id: 'addr-1' })
    tx.jobRequest.create.mockResolvedValue({ id: 'jr-1' })
    mockDb.$transaction.mockImplementation(async (fn: (client: typeof tx) => Promise<unknown>) => fn(tx))

    await createJobRequest({ ...BASE_PARAMS, assignmentMode: 'OPS_REVIEW' })
    await new Promise<void>((resolve) => setTimeout(resolve, 10))

    expect(tx.jobRequest.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          assignmentMode: 'OPS_REVIEW',
        }),
      }),
    )
    expect(mockOrchestrateMatch).not.toHaveBeenCalled()
  })

  it('does not throw if orchestrateMatch fails - matching is non-blocking', async () => {
    const tx = makeTx()
    tx.customer.upsert.mockResolvedValue({ id: 'cust-1' })
    tx.address.create.mockResolvedValue({ id: 'addr-1' })
    tx.jobRequest.create.mockResolvedValue({ id: 'jr-1' })
    mockDb.$transaction.mockImplementation(async (fn: (client: typeof tx) => Promise<unknown>) => fn(tx))
    mockOrchestrateMatch.mockRejectedValue(new Error('Matching down'))

    await expect(createJobRequest(BASE_PARAMS)).resolves.toBeDefined()
  })

  it('does not send retry-style no-match copy when creation matching gives up structurally', async () => {
    const tx = makeTx()
    tx.customer.upsert.mockResolvedValue({ id: 'cust-1' })
    tx.address.create.mockResolvedValue({ id: 'addr-1' })
    tx.jobRequest.create.mockResolvedValue({ id: 'jr-1' })
    mockDb.$transaction.mockImplementation(async (fn: (client: typeof tx) => Promise<unknown>) => fn(tx))
    mockOrchestrateMatch.mockResolvedValue({
      status: 'NO_MATCH',
      filteredOut: [],
      consideredCount: 0,
      failureClass: 'EMPTY_POOL',
      primaryReason: 'NO_LOCATION_MATCH',
      evidence: ['considered_count=0'],
    })

    await createJobRequest(BASE_PARAMS)
    await new Promise<void>((resolve) => setTimeout(resolve, 10))

    expect(mockSendText).not.toHaveBeenCalledWith(
      '+27821234567',
      expect.stringContaining("We're searching for a suitable provider"),
      expect.objectContaining({
        templateName: 'interactive:request_received_no_match',
      }),
    )
  })

  it('keeps request-received no-match copy for transient creation matching failures', async () => {
    const tx = makeTx()
    tx.customer.upsert.mockResolvedValue({ id: 'cust-1' })
    tx.address.create.mockResolvedValue({ id: 'addr-1' })
    tx.jobRequest.create.mockResolvedValue({ id: 'jr-1' })
    mockDb.$transaction.mockImplementation(async (fn: (client: typeof tx) => Promise<unknown>) => fn(tx))
    mockOrchestrateMatch.mockResolvedValue({
      status: 'NO_MATCH',
      filteredOut: [],
      consideredCount: 10,
      failureClass: 'TRANSIENT',
      primaryReason: 'RESERVATION_FAILED',
      evidence: ['reservation_failures=10'],
    })

    await createJobRequest(BASE_PARAMS)
    await new Promise<void>((resolve) => setTimeout(resolve, 10))

    expect(mockSendText).toHaveBeenCalledWith(
      '+27821234567',
      expect.stringContaining("We're searching for a suitable provider"),
      expect.objectContaining({
        templateName: 'interactive:request_received_no_match',
      }),
    )
  })

  it('returns a created request even if ticket URL generation fails', async () => {
    const tx = makeTx()
    tx.customer.upsert.mockResolvedValue({ id: 'cust-1' })
    tx.address.create.mockResolvedValue({ id: 'addr-1' })
    tx.jobRequest.create.mockResolvedValue({ id: 'jr-1' })
    mockDb.$transaction.mockImplementation(async (fn: (client: typeof tx) => Promise<unknown>) => fn(tx))
    mockGetJobRequestAccessUrl.mockRejectedValue(new Error('Token write failed'))

    await expect(createJobRequest(BASE_PARAMS)).resolves.toMatchObject({
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

  it('normalizes WhatsApp and PWA urgency values into matching policies', async () => {
    const { getUrgencyMatchingPolicy, normalizeUrgency } = await import('../../lib/urgency')

    expect(normalizeUrgency('urgent')).toBe('asap')
    expect(normalizeUrgency('asap')).toBe('asap')
    expect(normalizeUrgency('avail_asap')).toBe('asap')
    expect(normalizeUrgency('soon')).toBe('within_24h')
    expect(normalizeUrgency('within_24h')).toBe('within_24h')
    expect(normalizeUrgency('this_week')).toBe('this_week')
    expect(normalizeUrgency('avail_this_week')).toBe('this_week')
    expect(normalizeUrgency('avail_weekend')).toBe('this_week')
    expect(normalizeUrgency(null)).toBe('flexible')
    expect(normalizeUrgency('unknown')).toBe('flexible')
    expect(getUrgencyMatchingPolicy('urgent')).toMatchObject({
      progressPingMinutes: 15,
      hardGiveUpMinutes: 120,
    })
  })

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

  it('uses requestedArrivalLatest as the explicit ceiling when it falls before the 7-day default', async () => {
    const tx = makeTx()
    tx.customer.upsert.mockResolvedValue({ id: 'cust-1' })
    tx.address.create.mockResolvedValue({ id: 'addr-1' })
    tx.jobRequest.create.mockResolvedValue({ id: 'jr-1' })
    mockDb.$transaction.mockImplementation(async (fn: (client: typeof tx) => Promise<unknown>) => fn(tx))

    // 2 days from now is well inside the 7-day flexible hard give-up.
    const requestedArrivalLatest = new Date(Date.now() + 2 * 24 * 60 * 60 * 1000)
    await createJobRequest({ ...BASE_PARAMS, requestedArrivalLatest })

    const { data } = (tx.jobRequest.create as ReturnType<typeof vi.fn>).mock.calls[0][0]
    const expiresMs = (data.expiresAt as Date).getTime()
    const expectedMs = requestedArrivalLatest.getTime()
    expect(expiresMs).toBeGreaterThanOrEqual(expectedMs - 500)
    expect(expiresMs).toBeLessThanOrEqual(expectedMs + 500)
  })

  it('uses the tighter urgency hard give-up for ASAP requests', async () => {
    const tx = makeTx()
    tx.customer.upsert.mockResolvedValue({ id: 'cust-1' })
    tx.address.create.mockResolvedValue({ id: 'addr-1' })
    tx.jobRequest.create.mockResolvedValue({ id: 'jr-1' })
    mockDb.$transaction.mockImplementation(async (fn: (client: typeof tx) => Promise<unknown>) => fn(tx))

    const before = Date.now()
    await createJobRequest({ ...BASE_PARAMS, urgency: 'asap' })
    const after = Date.now()

    const { data } = (tx.jobRequest.create as ReturnType<typeof vi.fn>).mock.calls[0][0]
    const expiresMs = (data.expiresAt as Date).getTime()
    const asapOffsetMs = 2 * 60 * 60 * 1000
    expect(expiresMs).toBeGreaterThanOrEqual(before + asapOffsetMs - 500)
    expect(expiresMs).toBeLessThanOrEqual(after + asapOffsetMs + 500)
  })

  it('keeps the 7-day flexible cap when requestedArrivalLatest would exceed it', async () => {
    const { MATCHING_CONFIG } = await import('../../lib/matching/config')
    const tx = makeTx()
    tx.customer.upsert.mockResolvedValue({ id: 'cust-1' })
    tx.address.create.mockResolvedValue({ id: 'addr-1' })
    tx.jobRequest.create.mockResolvedValue({ id: 'jr-1' })
    mockDb.$transaction.mockImplementation(async (fn: (client: typeof tx) => Promise<unknown>) => fn(tx))

    // 8 days from now exceeds the 7-day flexible hard give-up.
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

  it('expiresAt is always a Date - never undefined or null', async () => {
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
