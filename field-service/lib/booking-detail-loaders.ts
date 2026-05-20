import { db } from '@/lib/db'
import type { Prisma } from '@prisma/client'

type DetailFailureReason = 'not_found' | 'unauthorized' | 'invalid_data' | 'query_failed'

const providerJobInclude = {
  booking: {
    include: {
      match: {
        include: {
          jobRequest: {
            include: {
              customer: { select: { id: true, name: true, phone: true } },
              address: true,
            },
          },
        },
      },
      payment: { select: { status: true } },
    },
  },
  statusHistory: { orderBy: { timestamp: 'asc' } },
  extras: { orderBy: { createdAt: 'desc' } },
  photos: { orderBy: { createdAt: 'asc' } },
} as const

const customerBookingInclude = {
  match: {
    include: {
      jobRequest: {
        include: {
          customer: { select: { id: true } },
          address: true,
        },
      },
      provider: { select: { id: true, name: true, phone: true } },
      quotes: { orderBy: { createdAt: 'desc' } },
    },
  },
  quote: true,
  job: {
    include: {
      statusHistory: { orderBy: { timestamp: 'asc' } },
      extras: { where: { status: 'PENDING' } },
      photos: true,
    },
  },
} as const

type ProviderJobRow = Prisma.JobGetPayload<{ include: typeof providerJobInclude }>
type CustomerBookingRow = Prisma.BookingGetPayload<{ include: typeof customerBookingInclude }>

type ProviderJobDetailData = {
  job: ProviderJobRow
  booking: ProviderJobRow['booking']
  match: ProviderJobRow['booking']['match']
  jobRequest: ProviderJobRow['booking']['match']['jobRequest']
  customer: ProviderJobRow['booking']['match']['jobRequest']['customer']
  address: ProviderJobRow['booking']['match']['jobRequest']['address']
  customerFirstName: string
  addressDisplay: string | null
  mapQuery: string | null
  scheduledDateLabel: string | null
}

type CustomerBookingDetailData = {
  booking: CustomerBookingRow
  jobRequest: CustomerBookingRow['match']['jobRequest']
  customerId: string
  addressDisplay: string | null
  providerDisplayName: string
  providerInitials: string
}

export type ProviderJobDetailLoadResult =
  | { ok: true; data: ProviderJobDetailData }
  | { ok: false; error: DetailFailureReason }

export type CustomerBookingDetailLoadResult =
  | { ok: true; data: CustomerBookingDetailData }
  | { ok: false; error: DetailFailureReason }

function nonEmpty(value: string | null | undefined, fallback: string) {
  const next = value?.trim()
  return next && next.length > 0 ? next : fallback
}

function initials(value: string) {
  const parts = value.trim().split(/\s+/).filter(Boolean)
  const two = parts.slice(0, 2).map((part) => part[0] ?? '').join('')
  return two.length > 0 ? two.toUpperCase() : 'P'
}

function firstName(value: string) {
  const normalized = nonEmpty(value, 'Customer')
  return normalized.split(/\s+/)[0] ?? 'Customer'
}

function safeDateLabel(date: Date | null, scheduledWindow: string | null) {
  if (!date || Number.isNaN(date.getTime())) return null
  const label = date.toLocaleDateString('en-ZA', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  })
  return scheduledWindow ? `${label} · ${scheduledWindow}` : label
}

function normalizeAddress(address: {
  street?: string | null
  suburb?: string | null
  city?: string | null
} | null | undefined) {
  if (!address) return null
  const parts = [address.street, address.suburb, address.city]
    .map((part) => part?.trim())
    .filter((part): part is string => Boolean(part && part.length > 0))

  if (parts.length === 0) return null
  return parts.join(', ')
}

function logDetailFailure(params: {
  route: string
  viewerRole: 'provider' | 'customer'
  viewerId: string
  id: string
  resolvedIdType: 'job_id' | 'booking_id'
  reason: DetailFailureReason
  stage: 'query' | 'resolve' | 'authorize'
  error?: unknown
}) {
  const payload = {
    route: params.route,
    viewerRole: params.viewerRole,
    viewerId: params.viewerId,
    id: params.id,
    resolvedIdType: params.resolvedIdType,
    reason: params.reason,
    stage: params.stage,
    error: params.error instanceof Error ? params.error.message : params.error ? String(params.error) : undefined,
  }

  if (params.reason === 'query_failed' || params.reason === 'invalid_data') {
    console.error('[booking-detail-loader] failed', payload)
  } else {
    console.warn('[booking-detail-loader] rejected', payload)
  }
}

export async function getProviderJobDetailForViewer(params: {
  route: string
  viewerUserId: string
  viewerProviderId: string
  jobId: string
}): Promise<ProviderJobDetailLoadResult> {
  try {
    const job = await db.job.findUnique({
      where: { id: params.jobId },
      include: providerJobInclude,
    })

    if (!job) {
      logDetailFailure({
        route: params.route,
        viewerRole: 'provider',
        viewerId: params.viewerUserId,
        id: params.jobId,
        resolvedIdType: 'job_id',
        reason: 'not_found',
        stage: 'resolve',
      })
      return { ok: false, error: 'not_found' }
    }

    if (job.providerId !== params.viewerProviderId) {
      logDetailFailure({
        route: params.route,
        viewerRole: 'provider',
        viewerId: params.viewerUserId,
        id: params.jobId,
        resolvedIdType: 'job_id',
        reason: 'unauthorized',
        stage: 'authorize',
      })
      return { ok: false, error: 'unauthorized' }
    }

    const booking = job.booking
    const match = booking?.match
    const jobRequest = match?.jobRequest
    const customer = jobRequest?.customer
    const address = jobRequest?.address ?? null

    if (!booking || !match || !jobRequest || !customer) {
      logDetailFailure({
        route: params.route,
        viewerRole: 'provider',
        viewerId: params.viewerUserId,
        id: params.jobId,
        resolvedIdType: 'job_id',
        reason: 'invalid_data',
        stage: 'resolve',
      })
      return { ok: false, error: 'invalid_data' }
    }

    const addressDisplay = normalizeAddress(address)
    const mapQuery = addressDisplay
    const scheduledDateLabel = safeDateLabel(booking.scheduledDate ?? null, booking.scheduledWindow ?? null)

    return {
      ok: true,
      data: {
        job,
        booking,
        match,
        jobRequest,
        customer,
        address,
        customerFirstName: firstName(customer.name),
        addressDisplay,
        mapQuery,
        scheduledDateLabel,
      },
    }
  } catch (error) {
    logDetailFailure({
      route: params.route,
      viewerRole: 'provider',
      viewerId: params.viewerUserId,
      id: params.jobId,
      resolvedIdType: 'job_id',
      reason: 'query_failed',
      stage: 'query',
      error,
    })
    return { ok: false, error: 'query_failed' }
  }
}

export async function getCustomerBookingDetailForViewer(params: {
  route: string
  viewerUserId: string
  viewerCustomerId: string
  bookingId: string
}): Promise<CustomerBookingDetailLoadResult> {
  try {
    const booking = await db.booking.findUnique({
      where: { id: params.bookingId },
      include: customerBookingInclude,
    })

    if (!booking) {
      logDetailFailure({
        route: params.route,
        viewerRole: 'customer',
        viewerId: params.viewerUserId,
        id: params.bookingId,
        resolvedIdType: 'booking_id',
        reason: 'not_found',
        stage: 'resolve',
      })
      return { ok: false, error: 'not_found' }
    }

    const jobRequest = booking.match?.jobRequest
    const bookingCustomerId = jobRequest?.customer?.id

    if (!jobRequest || !bookingCustomerId) {
      logDetailFailure({
        route: params.route,
        viewerRole: 'customer',
        viewerId: params.viewerUserId,
        id: params.bookingId,
        resolvedIdType: 'booking_id',
        reason: 'invalid_data',
        stage: 'resolve',
      })
      return { ok: false, error: 'invalid_data' }
    }

    if (bookingCustomerId !== params.viewerCustomerId) {
      logDetailFailure({
        route: params.route,
        viewerRole: 'customer',
        viewerId: params.viewerUserId,
        id: params.bookingId,
        resolvedIdType: 'booking_id',
        reason: 'unauthorized',
        stage: 'authorize',
      })
      return { ok: false, error: 'unauthorized' }
    }

    const providerDisplayName = nonEmpty(booking.match?.provider?.name, 'Assigned provider')
    const addressDisplay = normalizeAddress(jobRequest.address ?? null)

    return {
      ok: true,
      data: {
        booking,
        jobRequest,
        customerId: bookingCustomerId,
        addressDisplay,
        providerDisplayName,
        providerInitials: initials(providerDisplayName),
      },
    }
  } catch (error) {
    logDetailFailure({
      route: params.route,
      viewerRole: 'customer',
      viewerId: params.viewerUserId,
      id: params.bookingId,
      resolvedIdType: 'booking_id',
      reason: 'query_failed',
      stage: 'query',
      error,
    })
    return { ok: false, error: 'query_failed' }
  }
}
