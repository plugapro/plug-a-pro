import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockDb = vi.hoisted(() => ({
  job: {
    findUnique: vi.fn(),
    findFirst: vi.fn(),
  },
  booking: {
    findUnique: vi.fn(),
  },
}))

vi.mock('@/lib/db', () => ({ db: mockDb }))

function makeProviderJobDetailRow(overrides?: Record<string, unknown>) {
  return {
    id: 'job_1',
    providerId: 'provider_1',
    status: 'SCHEDULED',
    bookingId: 'booking_1',
    booking: {
      id: 'booking_1',
      scheduledDate: new Date('2026-05-23T00:00:00.000Z'),
      scheduledWindow: '00:00–04:00',
      scheduledStartAt: null,
      scheduledEndAt: null,
      notes: null,
      match: {
        id: 'match_1',
        jobRequest: {
          id: 'request_1',
          category: 'DIY & Assembly',
          customer: { id: 'customer_1', name: 'Sarah Sullivan', phone: '+27700000000' },
          address: { street: '1 Main', suburb: 'Constantia Kloof', city: 'Johannesburg' },
        },
      },
      payment: null,
    },
    statusHistory: [],
    extras: [],
    photos: [],
    ...overrides,
  } as any
}

describe('booking detail loaders', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('loads provider job detail with normalized fields using job id', async () => {
    mockDb.job.findUnique
      .mockResolvedValueOnce({ id: 'job_1', providerId: 'provider_1', status: 'SCHEDULED' })
      .mockResolvedValueOnce(makeProviderJobDetailRow())

    const { getProviderJobDetailForViewer } = await import('@/lib/booking-detail-loaders')
    const result = await getProviderJobDetailForViewer({
      route: '/provider/jobs/[jobId]',
      viewerUserId: 'user_1',
      viewerProviderId: 'provider_1',
      jobId: 'job_1',
    })

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.data.customerFirstName).toBe('Sarah')
      expect(result.data.addressDisplay).toContain('Constantia Kloof')
      expect(result.data.scheduledDateLabel).toContain('00:00–04:00')
    }
  })

  it('resolves provider job detail when route receives booking id', async () => {
    mockDb.job.findUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: 'job_1', providerId: 'provider_1', status: 'SCHEDULED' })
      .mockResolvedValueOnce(makeProviderJobDetailRow())

    const { getProviderJobDetailForViewer } = await import('@/lib/booking-detail-loaders')
    const result = await getProviderJobDetailForViewer({
      route: '/provider/jobs/[jobId]',
      viewerUserId: 'user_1',
      viewerProviderId: 'provider_1',
      jobId: 'booking_1',
    })

    expect(result.ok).toBe(true)
  })

  it('blocks provider access when job belongs to another provider', async () => {
    mockDb.job.findUnique.mockResolvedValueOnce({
      id: 'job_1',
      providerId: 'provider_other',
      status: 'STARTED',
    })

    const { getProviderJobDetailForViewer } = await import('@/lib/booking-detail-loaders')
    const result = await getProviderJobDetailForViewer({
      route: '/provider/jobs/[jobId]',
      viewerUserId: 'user_1',
      viewerProviderId: 'provider_1',
      jobId: 'job_1',
    })

    expect(result).toEqual({ ok: false, error: 'unauthorized' })
  })

  it('returns invalid_id when provider job id is blank', async () => {
    const { getProviderJobDetailForViewer } = await import('@/lib/booking-detail-loaders')
    const result = await getProviderJobDetailForViewer({
      route: '/provider/jobs/[jobId]',
      viewerUserId: 'user_1',
      viewerProviderId: 'provider_1',
      jobId: '  ',
    })

    expect(result).toEqual({ ok: false, error: 'invalid_id' })
    expect(mockDb.job.findUnique).not.toHaveBeenCalled()
  })

  it('returns not_found when no supported id type resolves', async () => {
    mockDb.job.findUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null)
    mockDb.job.findFirst.mockResolvedValueOnce(null)

    const { getProviderJobDetailForViewer } = await import('@/lib/booking-detail-loaders')
    const result = await getProviderJobDetailForViewer({
      route: '/provider/jobs/[jobId]',
      viewerUserId: 'user_1',
      viewerProviderId: 'provider_1',
      jobId: 'missing-id',
    })

    expect(result).toEqual({ ok: false, error: 'not_found' })
  })

  it('returns status_not_supported when a legacy status is encountered', async () => {
    mockDb.job.findUnique.mockResolvedValueOnce({ id: 'job_1', providerId: 'provider_1', status: 'LEGACY_UNKNOWN' })

    const { getProviderJobDetailForViewer } = await import('@/lib/booking-detail-loaders')
    const result = await getProviderJobDetailForViewer({
      route: '/provider/jobs/[jobId]',
      viewerUserId: 'user_1',
      viewerProviderId: 'provider_1',
      jobId: 'job_1',
    })

    expect(result).toEqual({ ok: false, error: 'status_not_supported' })
  })

  it('returns missing_related_data when required booking relation is missing', async () => {
    mockDb.job.findUnique
      .mockResolvedValueOnce({ id: 'job_1', providerId: 'provider_1', status: 'SCHEDULED' })
      .mockResolvedValueOnce({
        id: 'job_1',
        providerId: 'provider_1',
        status: 'SCHEDULED',
        booking: null,
      })

    const { getProviderJobDetailForViewer } = await import('@/lib/booking-detail-loaders')
    const result = await getProviderJobDetailForViewer({
      route: '/provider/jobs/[jobId]',
      viewerUserId: 'user_1',
      viewerProviderId: 'provider_1',
      jobId: 'job_1',
    })

    expect(result).toEqual({ ok: false, error: 'missing_related_data' })
  })

  it('keeps rendering when optional nested data is missing', async () => {
    mockDb.job.findUnique
      .mockResolvedValueOnce({ id: 'job_1', providerId: 'provider_1', status: 'SCHEDULED' })
      .mockResolvedValueOnce(
        makeProviderJobDetailRow({
          booking: {
            id: 'booking_1',
            scheduledDate: new Date('2026-05-23T00:00:00.000Z'),
            scheduledWindow: null,
            scheduledStartAt: null,
            scheduledEndAt: null,
            notes: null,
            match: null,
            payment: null,
          },
        })
      )

    const { getProviderJobDetailForViewer } = await import('@/lib/booking-detail-loaders')
    const result = await getProviderJobDetailForViewer({
      route: '/provider/jobs/[jobId]',
      viewerUserId: 'user_1',
      viewerProviderId: 'provider_1',
      jobId: 'job_1',
    })

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.data.customerFirstName).toBe('Customer')
      expect(result.data.addressDisplay).toBeNull()
    }
  })

  it('formats date safely when scheduledWindow is missing and start time exists', async () => {
    mockDb.job.findUnique
      .mockResolvedValueOnce({ id: 'job_1', providerId: 'provider_1', status: 'SCHEDULED' })
      .mockResolvedValueOnce(
        makeProviderJobDetailRow({
          booking: {
            id: 'booking_1',
            scheduledDate: new Date('2026-05-23T00:00:00.000Z'),
            scheduledWindow: null,
            scheduledStartAt: new Date('2026-05-23T00:00:00.000Z'),
            scheduledEndAt: null,
            notes: null,
            match: {
              id: 'match_1',
              jobRequest: {
                id: 'request_1',
                category: 'DIY & Assembly',
                customer: { id: 'customer_1', name: 'Sarah Sullivan', phone: '+27700000000' },
                address: { street: '1 Main', suburb: 'Constantia Kloof', city: 'Johannesburg' },
              },
            },
            payment: null,
          },
        })
      )

    const { getProviderJobDetailForViewer } = await import('@/lib/booking-detail-loaders')
    const result = await getProviderJobDetailForViewer({
      route: '/provider/jobs/[jobId]',
      viewerUserId: 'user_1',
      viewerProviderId: 'provider_1',
      jobId: 'job_1',
    })

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.data.scheduledDateLabel).toContain('From')
    }
  })

  it('returns query_failed when provider job query throws', async () => {
    mockDb.job.findUnique.mockRejectedValue(new Error('db unavailable'))

    const { getProviderJobDetailForViewer } = await import('@/lib/booking-detail-loaders')
    const result = await getProviderJobDetailForViewer({
      route: '/provider/jobs/[jobId]',
      viewerUserId: 'user_1',
      viewerProviderId: 'provider_1',
      jobId: 'job_1',
    })

    expect(result).toEqual({ ok: false, error: 'query_failed' })
  })

  it('loads customer booking detail and normalizes provider display', async () => {
    mockDb.booking.findUnique.mockResolvedValue({
      id: 'booking_1',
      status: 'SCHEDULED',
      scheduledDate: new Date('2026-05-23T00:00:00.000Z'),
      scheduledWindow: '00:00–04:00',
      match: {
        jobRequest: {
          customer: { id: 'customer_1' },
          category: 'DIY & Assembly',
          address: { street: null, suburb: 'Constantia Kloof', city: 'Johannesburg' },
        },
        provider: { id: 'provider_1', name: 'Lovemore Sibanda', phone: '+27700000000' },
        quotes: [],
      },
      quote: null,
      job: null,
    } as any)

    const { getCustomerBookingDetailForViewer } = await import('@/lib/booking-detail-loaders')
    const result = await getCustomerBookingDetailForViewer({
      route: '/bookings/[id]',
      viewerUserId: 'user_1',
      viewerCustomerId: 'customer_1',
      bookingId: 'booking_1',
    })

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.data.providerDisplayName).toBe('Lovemore Sibanda')
      expect(result.data.providerInitials).toBe('LS')
      expect(result.data.addressDisplay).toBe('Constantia Kloof, Johannesburg')
    }
  })

  it('blocks customer access when booking belongs to another customer', async () => {
    mockDb.booking.findUnique.mockResolvedValue({
      id: 'booking_1',
      match: {
        jobRequest: { customer: { id: 'customer_other' }, address: null },
        provider: { id: 'provider_1', name: 'Lovemore', phone: '+27700000000' },
        quotes: [],
      },
      quote: null,
      job: null,
    } as any)

    const { getCustomerBookingDetailForViewer } = await import('@/lib/booking-detail-loaders')
    const result = await getCustomerBookingDetailForViewer({
      route: '/bookings/[id]',
      viewerUserId: 'user_1',
      viewerCustomerId: 'customer_1',
      bookingId: 'booking_1',
    })

    expect(result).toEqual({ ok: false, error: 'unauthorized' })
  })

  it('returns missing_related_data when booking relation graph is incomplete', async () => {
    mockDb.booking.findUnique.mockResolvedValue({
      id: 'booking_1',
      match: null,
      quote: null,
      job: null,
    } as any)

    const { getCustomerBookingDetailForViewer } = await import('@/lib/booking-detail-loaders')
    const result = await getCustomerBookingDetailForViewer({
      route: '/bookings/[id]',
      viewerUserId: 'user_1',
      viewerCustomerId: 'customer_1',
      bookingId: 'booking_1',
    })

    expect(result).toEqual({ ok: false, error: 'missing_related_data' })
  })

  it('returns query_failed when booking query throws', async () => {
    mockDb.booking.findUnique.mockRejectedValue(new Error('db failed'))

    const { getCustomerBookingDetailForViewer } = await import('@/lib/booking-detail-loaders')
    const result = await getCustomerBookingDetailForViewer({
      route: '/bookings/[id]',
      viewerUserId: 'user_1',
      viewerCustomerId: 'customer_1',
      bookingId: 'booking_1',
    })

    expect(result).toEqual({ ok: false, error: 'query_failed' })
  })
})
