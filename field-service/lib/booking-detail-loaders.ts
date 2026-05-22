import { db } from '@/lib/db'
import { isKnownProviderJobStatus } from '@/lib/provider-job-status'
import type { Prisma } from '@prisma/client'

type DetailFailureReason =
  | 'not_found'
  | 'unauthorized'
  | 'invalid_id'
  | 'missing_related_data'
  | 'query_failed'
  | 'status_not_supported'

type ProviderResolvedIdType =
  | 'job_id'
  | 'booking_id'
  | 'job_request_id'
  | 'job_ref'
  | 'lead_id'
  | 'unknown'

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
  extras: {
    // Select only stable columns so detail hydration still works on environments
    // where newer optional columns (e.g. expiresAt) are not yet present.
    orderBy: { createdAt: 'desc' },
    select: {
      id: true,
      description: true,
      amount: true,
      status: true,
      createdAt: true,
    },
  },
  photos: { orderBy: { createdAt: 'asc' } },
} as const

const providerJobCoreInclude = {
  statusHistory: { orderBy: { timestamp: 'asc' } },
  extras: {
    orderBy: { createdAt: 'desc' },
    select: {
      id: true,
      description: true,
      amount: true,
      status: true,
      createdAt: true,
    },
  },
  photos: { orderBy: { createdAt: 'asc' } },
} as const

const providerBookingInclude = providerJobInclude.booking.include

const providerBookingSelect = {
  match: {
    include: providerBookingInclude.match.include,
  },
  payment: providerBookingInclude.payment,
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
type ProviderJobCoreRow = Prisma.JobGetPayload<{ include: typeof providerJobCoreInclude }>
type ProviderJobRowOrCore = ProviderJobRow | ProviderJobCoreRow
type CustomerBookingRow = Prisma.BookingGetPayload<{ include: typeof customerBookingInclude }>
type ProviderBookingRow = Prisma.BookingGetPayload<{ include: typeof providerBookingSelect }>

type ProviderJobDetailData = {
  job: ProviderJobRow
  booking: ProviderJobRow['booking']
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

function firstName(value: string | null | undefined) {
  const normalized = nonEmpty(value ?? null, 'Customer')
  return normalized.split(/\s+/)[0] ?? 'Customer'
}

function isValidDate(value: unknown): value is Date {
  return value instanceof Date && !Number.isNaN(value.getTime())
}

function formatTime(value: Date | null) {
  if (!value || !isValidDate(value)) return null
  return value.toLocaleTimeString('en-ZA', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  })
}

function safeDateLabel(params: {
  scheduledDate: Date | null
  scheduledWindow: string | null
  scheduledStartAt: Date | null
  scheduledEndAt: Date | null
}) {
  const baseDate = isValidDate(params.scheduledDate)
    ? params.scheduledDate
    : isValidDate(params.scheduledStartAt)
      ? params.scheduledStartAt
      : isValidDate(params.scheduledEndAt)
        ? params.scheduledEndAt
        : null

  if (!baseDate) return null

  const dateLabel = baseDate.toLocaleDateString('en-ZA', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  })

  const explicitWindow = params.scheduledWindow?.trim()
  if (explicitWindow) return `${dateLabel} · ${explicitWindow}`

  const startLabel = formatTime(params.scheduledStartAt)
  const endLabel = formatTime(params.scheduledEndAt)
  if (startLabel && endLabel) return `${dateLabel} · ${startLabel}–${endLabel}`
  if (startLabel) return `${dateLabel} · From ${startLabel}`
  if (endLabel) return `${dateLabel} · Until ${endLabel}`

  return dateLabel
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
  viewerProviderId?: string
  id: string
  resolvedIdType: ProviderResolvedIdType | 'booking_id'
  resolvedJobId?: string
  jobStatus?: string
  reason: DetailFailureReason
  stage: 'query' | 'resolve' | 'authorize' | 'validate'
  durationMs?: number
  error?: unknown
}) {
  const payload = {
    route: params.route,
    viewerRole: params.viewerRole,
    viewerId: params.viewerId,
    providerId: params.viewerProviderId,
    id: params.id,
    resolvedIdType: params.resolvedIdType,
    resolvedJobId: params.resolvedJobId,
    jobStatus: params.jobStatus,
    reason: params.reason,
    stage: params.stage,
    durationMs: params.durationMs,
    error: params.error instanceof Error ? params.error.message : params.error ? String(params.error) : undefined,
  }

  if (params.reason === 'query_failed' || params.reason === 'missing_related_data') {
    console.error('[provider-job-detail] failed', payload)
    return
  }

  if (params.reason === 'not_found' || params.reason === 'unauthorized' || params.reason === 'invalid_id') {
    console.warn('[provider-job-detail] rejected', payload)
    return
  }

  console.error('[provider-job-detail] unsupported', payload)
}

async function resolveProviderJobIdentifier(candidate: string): Promise<{
  resolvedIdType: ProviderResolvedIdType
  jobIdentity: { id: string; providerId: string; status: string } | null
}> {
  const byJobId = await db.job.findUnique({
    where: { id: candidate },
    select: { id: true, providerId: true, status: true },
  })
  if (byJobId) return { resolvedIdType: 'job_id', jobIdentity: byJobId }

  const byBookingId = await db.job.findUnique({
    where: { bookingId: candidate },
    select: { id: true, providerId: true, status: true },
  })
  if (byBookingId) return { resolvedIdType: 'booking_id', jobIdentity: byBookingId }

  const byJobRequestId = await db.job.findFirst({
    where: { booking: { match: { jobRequestId: candidate } } },
    select: { id: true, providerId: true, status: true },
  })
  if (byJobRequestId) return { resolvedIdType: 'job_request_id', jobIdentity: byJobRequestId }

  const byJobRef = await db.job.findUnique({
    where: { jobRef: candidate },
    select: { id: true, providerId: true, status: true },
  })
  if (byJobRef) return { resolvedIdType: 'job_ref', jobIdentity: byJobRef }

  const byLeadId = await db.job.findUnique({
    where: { selectedLeadInviteId: candidate },
    select: { id: true, providerId: true, status: true },
  })
  if (byLeadId) return { resolvedIdType: 'lead_id', jobIdentity: byLeadId }

  return { resolvedIdType: 'unknown', jobIdentity: null }
}

export async function getProviderJobDetailForViewer(params: {
  route: string
  viewerUserId: string
  viewerProviderId: string
  jobId: string
}): Promise<ProviderJobDetailLoadResult> {
  const startedAt = Date.now()
  const receivedId = params.jobId

  console.info('[provider-job-detail] load_started', {
    route: params.route,
    viewerUserId: params.viewerUserId,
    providerId: params.viewerProviderId,
    receivedId,
  })

  const trimmed = receivedId.trim()
  if (trimmed.length < 3 || trimmed.length > 128) {
    logDetailFailure({
      route: params.route,
      viewerRole: 'provider',
      viewerId: params.viewerUserId,
      viewerProviderId: params.viewerProviderId,
      id: receivedId,
      resolvedIdType: 'unknown',
      reason: 'invalid_id',
      stage: 'resolve',
      durationMs: Date.now() - startedAt,
    })
    return { ok: false, error: 'invalid_id' }
  }

  try {
    const resolution = await resolveProviderJobIdentifier(trimmed)
    const identity = resolution.jobIdentity

    if (!identity) {
      logDetailFailure({
        route: params.route,
        viewerRole: 'provider',
        viewerId: params.viewerUserId,
        viewerProviderId: params.viewerProviderId,
        id: receivedId,
        resolvedIdType: resolution.resolvedIdType,
        reason: 'not_found',
        stage: 'resolve',
        durationMs: Date.now() - startedAt,
      })
      return { ok: false, error: 'not_found' }
    }

    if (!isKnownProviderJobStatus(identity.status)) {
      logDetailFailure({
        route: params.route,
        viewerRole: 'provider',
        viewerId: params.viewerUserId,
        viewerProviderId: params.viewerProviderId,
        id: receivedId,
        resolvedIdType: resolution.resolvedIdType,
        resolvedJobId: identity.id,
        jobStatus: identity.status,
        reason: 'status_not_supported',
        stage: 'validate',
        durationMs: Date.now() - startedAt,
      })
      return { ok: false, error: 'status_not_supported' }
    }

    if (identity.providerId !== params.viewerProviderId) {
      logDetailFailure({
        route: params.route,
        viewerRole: 'provider',
        viewerId: params.viewerUserId,
        viewerProviderId: params.viewerProviderId,
        id: receivedId,
        resolvedIdType: resolution.resolvedIdType,
        resolvedJobId: identity.id,
        jobStatus: identity.status,
        reason: 'unauthorized',
        stage: 'authorize',
        durationMs: Date.now() - startedAt,
      })
      return { ok: false, error: 'unauthorized' }
    }

    let job: ProviderJobRowOrCore | null = null
    try {
      job = await db.job.findUnique({
        where: { id: identity.id },
        include: providerJobInclude,
      })
    } catch (error) {
      // Some scheduled jobs can fail deep include hydration even when the base job row exists
      // (e.g. partial relation cleanup/migration edge-cases).
      // Retry with the core execution rows first so the page can still render service/contact
      // details whenever possible.
      if (process.env.NODE_ENV !== 'production') {
        console.warn('[provider-job-detail] primary job hydrate failed, retrying with core row', {
          route: params.route,
          viewerRole: 'provider',
          viewerId: params.viewerUserId,
          viewerProviderId: params.viewerProviderId,
          receivedId,
          jobId: identity.id,
          error: error instanceof Error ? error.message : error ? String(error) : undefined,
        })
      }

      let coreQueryFailed = false
      const coreJob = await db.job
        .findFirst({
          where: { id: identity.id },
          include: providerJobCoreInclude,
        })
        .catch((coreError: unknown) => {
          coreQueryFailed = true
          logDetailFailure({
            route: params.route,
            viewerRole: 'provider',
            viewerId: params.viewerUserId,
            viewerProviderId: params.viewerProviderId,
            id: receivedId,
            resolvedIdType: resolution.resolvedIdType,
            resolvedJobId: identity.id,
            jobStatus: identity.status,
            reason: 'query_failed',
            stage: 'query',
            durationMs: Date.now() - startedAt,
            error: coreError,
          })
          return null
        })

      if (!coreJob) {
        if (coreQueryFailed) {
          return { ok: false, error: 'query_failed' }
        }
        logDetailFailure({
          route: params.route,
          viewerRole: 'provider',
          viewerId: params.viewerUserId,
          viewerProviderId: params.viewerProviderId,
          id: receivedId,
          resolvedIdType: resolution.resolvedIdType,
          resolvedJobId: identity.id,
          jobStatus: identity.status,
          reason: 'not_found',
          stage: 'query',
          durationMs: Date.now() - startedAt,
        })
        return { ok: false, error: 'not_found' }
      }

      job = {
        ...coreJob,
        booking: null,
      } as ProviderJobCoreRow
    }

    const bookingFromInclude = (job as ProviderJobRow | null)?.booking ?? null

    if (!job) {
      // We resolved a matching job row, but it disappeared before detail hydration.
      // This can happen under eventual consistency; treat it as a safe access denial.
      logDetailFailure({
        route: params.route,
        viewerRole: 'provider',
        viewerId: params.viewerUserId,
        viewerProviderId: params.viewerProviderId,
        id: receivedId,
        resolvedIdType: resolution.resolvedIdType,
        resolvedJobId: identity.id,
        jobStatus: identity.status,
        reason: 'not_found',
        stage: 'query',
        durationMs: Date.now() - startedAt,
      })
      return { ok: false, error: 'not_found' }
    }

    // Some scheduled jobs can arrive with an incomplete nested booking join depending on
    // the query planner / RLS behavior. Retry the booking row directly before
    // treating the transition to detail as a hard failure.
    let booking: ProviderBookingRow | null = bookingFromInclude ?? null
    if (!booking) {
      if (!job.bookingId) {
        logDetailFailure({
          route: params.route,
          viewerRole: 'provider',
          viewerId: params.viewerUserId,
          viewerProviderId: params.viewerProviderId,
          id: receivedId,
          resolvedIdType: resolution.resolvedIdType,
          resolvedJobId: identity.id,
          jobStatus: identity.status,
          reason: 'missing_related_data',
          stage: 'resolve',
          durationMs: Date.now() - startedAt,
        })
        return { ok: false, error: 'missing_related_data' }
      }

      if (process.env.NODE_ENV !== 'production') {
        console.info('[provider-job-detail] booking relationship missing in primary include; retrying booking lookup', {
          route: params.route,
          viewerRole: 'provider',
          viewerId: params.viewerUserId,
          viewerProviderId: params.viewerProviderId,
          receivedId,
          resolvedJobId: job.id,
          bookingId: job.bookingId,
        })
      }

      booking = await db.booking.findUnique({
        where: { id: job.bookingId },
        include: providerBookingSelect,
      })
    }

    if (!booking) {
      logDetailFailure({
        route: params.route,
        viewerRole: 'provider',
        viewerId: params.viewerUserId,
        viewerProviderId: params.viewerProviderId,
        id: receivedId,
        resolvedIdType: resolution.resolvedIdType,
        resolvedJobId: identity.id,
        jobStatus: identity.status,
        reason: 'missing_related_data',
        stage: 'resolve',
        durationMs: Date.now() - startedAt,
      })
      return { ok: false, error: 'missing_related_data' }
    }

    const hydratedJob = {
      ...job,
      booking,
    } as ProviderJobRow

    const bookingRow = hydratedJob.booking
    const customerName = bookingRow.match?.jobRequest?.customer?.name ?? 'Customer'
    const address = bookingRow.match?.jobRequest?.address ?? null

    const addressDisplay = normalizeAddress(address)
    const mapQuery = addressDisplay
    const scheduledDateLabel = safeDateLabel({
      scheduledDate: booking.scheduledDate ?? null,
      scheduledWindow: booking.scheduledWindow ?? null,
      scheduledStartAt: booking.scheduledStartAt ?? null,
      scheduledEndAt: booking.scheduledEndAt ?? null,
    })

    console.info('[provider-job-detail] load_succeeded', {
      route: params.route,
      viewerUserId: params.viewerUserId,
      providerId: params.viewerProviderId,
      receivedId,
      resolvedIdType: resolution.resolvedIdType,
      resolvedJobId: job.id,
      jobStatus: job.status,
      durationMs: Date.now() - startedAt,
    })

    return {
      ok: true,
      data: {
        job: hydratedJob,
        booking: bookingRow,
        customerFirstName: firstName(customerName),
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
      viewerProviderId: params.viewerProviderId,
      id: receivedId,
      resolvedIdType: 'unknown',
      reason: 'query_failed',
      stage: 'query',
      durationMs: Date.now() - startedAt,
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
        reason: 'missing_related_data',
        stage: 'resolve',
      })
      return { ok: false, error: 'missing_related_data' }
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
