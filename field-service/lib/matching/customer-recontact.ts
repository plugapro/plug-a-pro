import { format } from 'date-fns'
import { db } from '../db'
import { normaliseLocationDisplayName } from '../location-format'
import { getJobRequestAccessUrl } from '../job-request-access'
import { normalizePhone } from '../utils'
import { sendSlotAvailable } from '../whatsapp'
import { sendButtons, sendText } from '../whatsapp-interactive'
import type { CandidatePoolEntry } from './candidate-pool'
import { MATCHING_CONFIG } from './config'
import { filterEligibleProviders } from './filter'

const RECENT_EXPIRED_REMATCH_DAYS = 14

type RequestTiming = {
  requestedWindowStart: Date | null
  requestedWindowEnd: Date | null
  requestedArrivalLatest: Date | null
}

type MatchableJobRequestRecord = RequestTiming & {
  id: string
  category: string
  title: string
  description: string
  customerId: string
  status: 'OPEN' | 'MATCHING' | 'MATCHED' | 'EXPIRED' | 'PENDING_VALIDATION'
  estimatedDurationMinutes: number | null
  requiredSkillTags: string[]
  requiredCertificationCodes: string[]
  requiredEquipmentTags: string[]
  requiredVehicleTypes: string[]
  preferredProviderId: string | null
  assignmentMode: 'AUTO_ASSIGN' | 'OPS_REVIEW'
  customerAcceptedAmount: unknown
  customerAcceptedScope: string | null
  autoCreateBookingOnAssignment: boolean
  expiresAt: Date | null
  customerNoMatchNotifiedAt: Date | null
  customerRematchCheckSentAt: Date | null
  customerRematchCheckRespondedAt: Date | null
  customerRematchCheckOutcome: string | null
  altSlotNegotiationSentAt: Date | null
  altSlotNegotiationOutcome: string | null
  dispatchDecisions?: Array<{
    failureClass: string | null
    primaryReason: string | null
  }>
  customer: {
    id: string
    name: string
    phone: string
  } | null
  address: {
    street: string
    suburb: string
    city: string
    province: string
    lat: number | null
    lng: number | null
    locationNodeId: string | null
    locationNode: {
      regionKey: string | null
      provinceKey: string | null
    } | null
  } | null
}

function firstName(name: string | null | undefined) {
  return (name?.trim() || 'there').split(/\s+/)[0]
}

function formatArea(jobRequest: Pick<MatchableJobRequestRecord, 'address'>) {
  if (!jobRequest.address) return 'your area'
  return [
    normaliseLocationDisplayName(jobRequest.address.suburb),
    normaliseLocationDisplayName(jobRequest.address.city),
  ].filter(Boolean).join(', ') || 'your area'
}

export function getRequestedMatchDeadline(jobRequest: RequestTiming) {
  const dates = [
    jobRequest.requestedWindowEnd,
    jobRequest.requestedArrivalLatest,
    jobRequest.requestedWindowStart,
  ].filter((value): value is Date => value instanceof Date)

  if (dates.length === 0) return null

  return new Date(Math.max(...dates.map((value) => value.getTime())))
}

export function hasFutureExplicitRequestWindow(jobRequest: RequestTiming, now = new Date()) {
  const deadline = getRequestedMatchDeadline(jobRequest)
  return deadline !== null && deadline > now
}

function formatRequestedTimeLabel(jobRequest: RequestTiming) {
  if (jobRequest.requestedWindowStart && jobRequest.requestedWindowEnd) {
    return `${format(jobRequest.requestedWindowStart, 'EEE d MMM, HH:mm')} - ${format(jobRequest.requestedWindowEnd, 'HH:mm')}`
  }
  const singlePoint = jobRequest.requestedArrivalLatest ?? jobRequest.requestedWindowStart ?? jobRequest.requestedWindowEnd
  if (!singlePoint) return 'as soon as possible'
  return format(singlePoint, 'EEE d MMM, HH:mm')
}

function latestPrimaryReason(jobRequest: MatchableJobRequestRecord) {
  return jobRequest.dispatchDecisions?.[0]?.primaryReason ?? null
}

const AREA_UNAVAILABLE_REASONS = new Set([
  'NO_LOCATION_MATCH',
  'OUTSIDE_SERVICE_AREA',
])

const SERVICE_UNAVAILABLE_REASONS = new Set([
  'NO_SKILL_MATCH_IN_LOCATION',
  'MISSING_REQUIRED_SKILL',
  'MISSING_REQUIRED_CERTIFICATION',
  'MISSING_REQUIRED_EQUIPMENT',
  'MISSING_REQUIRED_VEHICLE',
])

const PROVIDER_APPROVAL_GAP_REASONS = new Set([
  'CATEGORY_NOT_APPROVED',
  'TECHNICIAN_INACTIVE',
])

function buildReasonedExhaustedMessage(
  jobRequest: MatchableJobRequestRecord,
  primaryReason: string,
) {
  const name = firstName(jobRequest.customer?.name)
  const serviceName = jobRequest.title?.trim() || jobRequest.category
  const area = formatArea(jobRequest)

  if (AREA_UNAVAILABLE_REASONS.has(primaryReason)) {
    return (
      `😔 *Sorry, ${name}*.\n\n` +
      `Plug A Pro is not available in ${area} yet for *${serviceName}*.\n\n` +
      `Thank you for trying Plug A Pro. As we grow our provider base, we should be in a better position to help you in future.`
    )
  }

  if (SERVICE_UNAVAILABLE_REASONS.has(primaryReason)) {
    return (
      `😔 *Sorry, ${name}*.\n\n` +
      `We do not have a matching *${serviceName}* provider available in *${area}* yet.\n\n` +
      `Thank you for trying Plug A Pro. As we grow our provider base, we should be in a better position to help you in future.`
    )
  }

  if (PROVIDER_APPROVAL_GAP_REASONS.has(primaryReason)) {
    return (
      `😔 *Sorry, ${name}*.\n\n` +
      `The providers we found for *${serviceName}* in *${area}* are not approved for that service yet.\n\n` +
      `Thank you for trying Plug A Pro. As we grow our approved provider base, we should be in a better position to help you in future.`
    )
  }

  return null
}

// I5 (re-review fix): a job that expires WITH a PUBLISHED ProviderShortlist
// had a live, customer-visible shortlist of providers who had already
// offered to help. The genuine "no-match" copy below ("we were not able to
// match your request") is false in that case, and doubly confusing paired
// with a shortlist link the customer may still have open. Use closed-out
// copy instead: it acknowledges the reservation existed and invites a fresh
// request rather than implying providers were never found.
function buildShortlistClosedMessage(_jobRequest: MatchableJobRequestRecord) {
  return (
    `Your request has now closed. The providers who offered to help are no longer reserved. ` +
    `Reply *new request* anytime and we'll get you fresh options.`
  )
}

function buildExhaustedMessage(jobRequest: MatchableJobRequestRecord) {
  const primaryReason = latestPrimaryReason(jobRequest)
  const reasoned = primaryReason
    ? buildReasonedExhaustedMessage(jobRequest, primaryReason)
    : null
  if (reasoned) return reasoned

  const name = firstName(jobRequest.customer?.name)
  const serviceName = jobRequest.title?.trim() || jobRequest.category
  const area = formatArea(jobRequest)
  const deadline = getRequestedMatchDeadline(jobRequest)

  if (hasFutureExplicitRequestWindow(jobRequest)) {
    return (
      `😔 *Sorry, ${name}*.\n\n` +
      `We were not able to match your *${serviceName}* request in *${area}* just yet.\n\n` +
      `Because your requested time is still ahead, we will message you if a suitable provider becomes available in time and ask whether you still need help.\n\n` +
      `Thank you for trying Plug A Pro.`
    )
  }

  if (!deadline) {
    // ASAP request - no specific time window was set
    return (
      `😔 *Sorry, ${name}*.\n\n` +
      `We were not able to match your *${serviceName}* request in *${area}* at this time.\n\n` +
      `Thank you for trying Plug A Pro. As we continue growing our provider base, we should be in a better position to help you in future.`
    )
  }

  const requestedTimeLabel = formatRequestedTimeLabel(jobRequest)

  return (
    `😔 *Sorry, ${name}*.\n\n` +
    `We were not able to match your *${serviceName}* request in *${area}* before *${requestedTimeLabel}*.\n\n` +
    `Thank you for trying Plug A Pro. As we continue growing our provider base, we should be in a better position to help you in future.`
  )
}

function isSchemaCompatError(error: unknown) {
  if (!error || typeof error !== 'object') return false
  const code = 'code' in error ? (error as { code?: string }).code : undefined
  return code === 'P2021' || code === 'P2022'
}

function toCandidate(provider: {
  id: string
  name: string
  phone: string
  skills: string[]
  serviceAreas: string[]
  maxTravelMinutes: number
  reliabilityScore: number
  averageRating: number
  active: boolean
  verified: boolean
  kycStatus: string | null
  availableNow: boolean
  lastKnownLat: number | null
  lastKnownLng: number | null
  liveStatus: {
    isOnline: boolean
    lastLocationLat: number | null
    lastLocationLng: number | null
    lastHeartbeatAt: Date | null
  } | null
}): CandidatePoolEntry {
  return {
    id: provider.id,
    name: provider.name,
    phone: provider.phone,
    skills: provider.skills,
    serviceAreas: provider.serviceAreas,
    maxTravelMinutes: provider.maxTravelMinutes,
    reliabilityScore: provider.reliabilityScore,
    averageRating: provider.averageRating,
    active: provider.active,
    verified: provider.verified,
    kycStatus: provider.kycStatus ?? null,
    availableNow: provider.availableNow,
    lastKnownLat: provider.lastKnownLat,
    lastKnownLng: provider.lastKnownLng,
    isOnline: provider.liveStatus?.isOnline ?? null,
    liveLocationLat: provider.liveStatus?.lastLocationLat ?? null,
    liveLocationLng: provider.liveStatus?.lastLocationLng ?? null,
    lastHeartbeatAt: provider.liveStatus?.lastHeartbeatAt ?? null,
    scoreBase: provider.reliabilityScore * 0.6 + (provider.averageRating / 5) * 0.4,
    fromPool: false,
  }
}

function toFilterJobRequest(jobRequest: MatchableJobRequestRecord) {
  return {
    id: jobRequest.id,
    customerId: jobRequest.customerId,
    category: jobRequest.category,
    title: jobRequest.title,
    description: jobRequest.description,
    requestedWindowStart: jobRequest.requestedWindowStart,
    requestedWindowEnd: jobRequest.requestedWindowEnd,
    requestedArrivalLatest: jobRequest.requestedArrivalLatest,
    estimatedDurationMinutes: jobRequest.estimatedDurationMinutes,
    requiredSkillTags: jobRequest.requiredSkillTags,
    requiredCertificationCodes: jobRequest.requiredCertificationCodes,
    requiredEquipmentTags: jobRequest.requiredEquipmentTags,
    requiredVehicleTypes: jobRequest.requiredVehicleTypes,
    preferredProviderId: jobRequest.preferredProviderId,
    assignmentMode: jobRequest.assignmentMode,
    customerAcceptedAmount: jobRequest.customerAcceptedAmount,
    customerAcceptedScope: jobRequest.customerAcceptedScope,
    autoCreateBookingOnAssignment: jobRequest.autoCreateBookingOnAssignment,
    status: jobRequest.status,
    expiresAt: jobRequest.expiresAt,
    address: jobRequest.address
      ? {
          street: jobRequest.address.street,
          suburb: jobRequest.address.suburb,
          city: jobRequest.address.city,
          province: jobRequest.address.province,
          lat: jobRequest.address.lat,
          lng: jobRequest.address.lng,
          locationNodeId: jobRequest.address.locationNodeId,
          regionKey: jobRequest.address.locationNode?.regionKey ?? null,
          provinceKey: jobRequest.address.locationNode?.provinceKey ?? null,
        }
      : null,
  }
}

async function customerHasRecentCareWindow(phone: string) {
  const normalized = normalizePhone(phone)
  const metaPhone = normalized.startsWith('+') ? normalized.slice(1) : normalized
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000)

  const inbound = await db.inboundWhatsAppMessage.findFirst({
    where: {
      phone: metaPhone,
      lastSeenAt: { gte: since },
    },
    select: { id: true },
  })

  return Boolean(inbound)
}

async function loadJobRequestForCustomerMessaging(jobRequestId: string) {
  try {
    return await db.jobRequest.findUnique({
      where: { id: jobRequestId },
      select: {
        id: true,
        customerId: true,
        category: true,
        title: true,
        description: true,
        status: true,
        requestedWindowStart: true,
        requestedWindowEnd: true,
        requestedArrivalLatest: true,
        estimatedDurationMinutes: true,
        requiredSkillTags: true,
        requiredCertificationCodes: true,
        requiredEquipmentTags: true,
        requiredVehicleTypes: true,
        preferredProviderId: true,
        assignmentMode: true,
        customerAcceptedAmount: true,
        customerAcceptedScope: true,
        autoCreateBookingOnAssignment: true,
        customerNoMatchNotifiedAt: true,
        customerRematchCheckSentAt: true,
        customerRematchCheckRespondedAt: true,
        customerRematchCheckOutcome: true,
        altSlotNegotiationSentAt: true,
        altSlotNegotiationOutcome: true,
        expiresAt: true,
        dispatchDecisions: {
          orderBy: { createdAt: 'desc' },
          take: 1,
          select: { failureClass: true, primaryReason: true },
        },
        customer: {
          select: {
            id: true,
            name: true,
            phone: true,
          },
        },
        address: {
          select: {
            street: true,
            suburb: true,
            city: true,
            province: true,
            lat: true,
            lng: true,
            locationNodeId: true,
            locationNode: {
              select: {
                regionKey: true,
                provinceKey: true,
              },
            },
          },
        },
      },
    }) as MatchableJobRequestRecord | null
  } catch (error) {
    if (!isSchemaCompatError(error)) throw error

    const legacyRecord = await db.jobRequest.findUnique({
      where: { id: jobRequestId },
      select: {
        id: true,
        customerId: true,
        category: true,
        title: true,
        description: true,
        status: true,
        requestedWindowStart: true,
        requestedWindowEnd: true,
        requestedArrivalLatest: true,
        estimatedDurationMinutes: true,
        requiredSkillTags: true,
        requiredCertificationCodes: true,
        requiredEquipmentTags: true,
        requiredVehicleTypes: true,
        preferredProviderId: true,
        assignmentMode: true,
        customerAcceptedAmount: true,
        customerAcceptedScope: true,
        autoCreateBookingOnAssignment: true,
        expiresAt: true,
        customer: {
          select: {
            id: true,
            name: true,
            phone: true,
          },
        },
        address: {
          select: {
            street: true,
            suburb: true,
            city: true,
            province: true,
            lat: true,
            lng: true,
            locationNodeId: true,
            locationNode: {
              select: {
                regionKey: true,
                provinceKey: true,
              },
            },
          },
        },
      },
    })

    if (!legacyRecord) return null

    return {
      ...legacyRecord,
      customerNoMatchNotifiedAt: null,
      customerRematchCheckSentAt: null,
      customerRematchCheckRespondedAt: null,
      customerRematchCheckOutcome: null,
      altSlotNegotiationSentAt: null,
      altSlotNegotiationOutcome: null,
      expiresAt: null,
      dispatchDecisions: [],
    } as MatchableJobRequestRecord
  }
}

export async function notifyCustomerNoMatch(jobRequestId: string) {
  const jobRequest = await loadJobRequestForCustomerMessaging(jobRequestId)

  if (!jobRequest || jobRequest.status !== 'EXPIRED') return false
  if (!jobRequest.customer?.phone || jobRequest.customerNoMatchNotifiedAt) return false

  // Don't send the hard decline while alternative-slot negotiation is in flight -
  // the customer is currently being offered alternative times.
  if (jobRequest.altSlotNegotiationSentAt && !jobRequest.altSlotNegotiationOutcome) return false

  // I5 (re-review fix): the "genuine no-match" copy below is wrong for a job
  // that expired WITH a PUBLISHED ProviderShortlist - the customer had a real,
  // live shortlist of providers who offered to help, so telling them "we were
  // not able to match your request" is both false and jarring next to a
  // shortlist link they may still have open. Query for a PUBLISHED shortlist
  // and branch the copy. ProviderShortlist has @@unique([requestId, status]),
  // so at most one PUBLISHED row can exist per job request.
  const publishedShortlist = await db.providerShortlist.findFirst({
    where: { requestId: jobRequest.id, status: 'PUBLISHED' },
    select: { id: true },
  })
  const hadPublishedShortlist = publishedShortlist != null

  const message = hadPublishedShortlist
    ? buildShortlistClosedMessage(jobRequest)
    : buildExhaustedMessage(jobRequest)
  const primaryReason = latestPrimaryReason(jobRequest)
  await sendText(jobRequest.customer.phone, message, {
    templateName: hadPublishedShortlist
      ? 'interactive:job_request_shortlist_closed'
      : 'interactive:job_request_no_match',
    metadata: {
      jobRequestId: jobRequest.id,
      hasFutureWindow: hasFutureExplicitRequestWindow(jobRequest),
      hadPublishedShortlist,
      ...(primaryReason ? { primaryReason } : {}),
    },
  })

  try {
    await db.jobRequest.update({
      where: { id: jobRequest.id },
      data: { customerNoMatchNotifiedAt: new Date() },
    })
  } catch (error) {
    if (!isSchemaCompatError(error)) throw error
  }

  return true
}

export async function notifyExpiredJobParties(params: {
  jobRequestId: string
  lastProviderId?: string | null
}) {
  const jobRequest = await loadJobRequestForCustomerMessaging(params.jobRequestId)
  if (!jobRequest || jobRequest.status !== 'EXPIRED') {
    return { customerNotified: false, providerNotified: false }
  }

  let providerNotified = false
  if (params.lastProviderId) {
    const provider = await db.provider.findUnique({
      where: { id: params.lastProviderId },
      select: { phone: true },
    })

    if (provider?.phone) {
      const ref = jobRequest.id.slice(-8).toUpperCase()
      await sendText(
        provider.phone,
        `⏰ *Lead Expired*\n\n*${jobRequest.category}* · Ref: ${ref}\n\nThis lead expired without a response and the service request has been closed. No action needed.`,
      ).catch((err) => {
        console.error('[matching] Failed to send lead-expired notification:', err)
      })
      providerNotified = true
    }
  }

  const customerNotified = await notifyCustomerNoMatch(jobRequest.id).catch((err) => {
    console.error('[matching] Failed to notify customer about expired job request:', err)
    return false
  })

  return { customerNotified, providerNotified }
}

export async function promptCustomersForNewProviderAvailability(providerId: string) {
  const provider = await db.provider.findUnique({
    where: { id: providerId },
    select: {
      id: true,
      name: true,
      phone: true,
      skills: true,
      serviceAreas: true,
      maxTravelMinutes: true,
      reliabilityScore: true,
      averageRating: true,
      active: true,
      verified: true,
      kycStatus: true,
      status: true,
      availableNow: true,
      lastKnownLat: true,
      lastKnownLng: true,
      liveStatus: {
        select: {
          isOnline: true,
          lastLocationLat: true,
          lastLocationLng: true,
          lastHeartbeatAt: true,
        },
      },
    },
  })

  if (!provider || !provider.active || !provider.verified || provider.status !== 'ACTIVE' || !provider.availableNow) {
    return { prompted: 0, templateFallbacks: 0 }
  }

  const staleThreshold = new Date(Date.now() - MATCHING_CONFIG.heartbeatStaleMinutes * 60_000)
  if (
    provider.liveStatus?.lastHeartbeatAt &&
    provider.liveStatus.lastHeartbeatAt < staleThreshold &&
    provider.liveStatus.isOnline !== true
  ) {
    return { prompted: 0, templateFallbacks: 0 }
  }

  const candidate = toCandidate(provider)
  const now = new Date()
  const recentExpiredCutoff = new Date(now.getTime() - RECENT_EXPIRED_REMATCH_DAYS * 24 * 60 * 60 * 1000)
  const jobs = await db.jobRequest.findMany({
    where: {
      status: 'EXPIRED',
      customerRematchCheckSentAt: null,
      // Recently expired jobs remain useful rematch opportunities when supply
      // grows after the original request window.
      createdAt: { gte: recentExpiredCutoff },
    },
    select: {
      id: true,
      customerId: true,
      category: true,
      title: true,
      description: true,
      status: true,
      requestedWindowStart: true,
      requestedWindowEnd: true,
      requestedArrivalLatest: true,
      estimatedDurationMinutes: true,
      requiredSkillTags: true,
      requiredCertificationCodes: true,
      requiredEquipmentTags: true,
      requiredVehicleTypes: true,
      preferredProviderId: true,
      assignmentMode: true,
      customerAcceptedAmount: true,
      customerAcceptedScope: true,
      autoCreateBookingOnAssignment: true,
      customerNoMatchNotifiedAt: true,
      customerRematchCheckSentAt: true,
      customerRematchCheckRespondedAt: true,
      customerRematchCheckOutcome: true,
      customer: {
        select: {
          id: true,
          name: true,
          phone: true,
        },
      },
      address: {
        select: {
          street: true,
          suburb: true,
          city: true,
          province: true,
          lat: true,
          lng: true,
          locationNodeId: true,
          locationNode: {
            select: {
              regionKey: true,
              provinceKey: true,
            },
          },
        },
      },
    },
    orderBy: [
      { requestedWindowStart: 'asc' },
      { createdAt: 'asc' },
    ],
    take: 20,
  }) as MatchableJobRequestRecord[]

  let prompted = 0
  let templateFallbacks = 0

  for (const jobRequest of jobs) {
    if (!jobRequest.customer?.phone || !jobRequest.address) continue

    const { eligible } = await filterEligibleProviders([candidate], toFilterJobRequest(jobRequest) as Parameters<typeof filterEligibleProviders>[1])
    if (eligible.length === 0) continue

    const careWindowOpen = await customerHasRecentCareWindow(jobRequest.customer.phone)

    if (careWindowOpen) {
      await sendButtons(
        jobRequest.customer.phone,
        `👋🏽 *Hi ${firstName(jobRequest.customer.name)}*\n\nWe may now have a provider who can help with your *${jobRequest.title || jobRequest.category}* request in *${formatArea(jobRequest)}* for *${formatRequestedTimeLabel(jobRequest)}*.\n\nDo you still need help?`,
        [
          { id: `rematch_yes:${jobRequest.id}`, title: '✅ Yes, still do' },
          { id: `rematch_no:${jobRequest.id}`, title: '❌ No, not now' },
        ],
        undefined,
        {
          templateName: 'interactive:job_request_rematch_check',
          metadata: {
            jobRequestId: jobRequest.id,
            providerId: provider.id,
            providerName: provider.name,
          },
        },
      )
      prompted++
    } else {
      const ticketUrl = await getJobRequestAccessUrl(jobRequest.id)
      if (!ticketUrl) continue

      await sendSlotAvailable({
        customerPhone: jobRequest.customer.phone,
        customerName: firstName(jobRequest.customer.name),
        serviceName: jobRequest.title || jobRequest.category,
        slotLabel: formatRequestedTimeLabel(jobRequest),
        bookingUrl: ticketUrl,
      })
      templateFallbacks++
    }

    await db.jobRequest.update({
      where: { id: jobRequest.id },
      data: { customerRematchCheckSentAt: new Date() },
    })
  }

  return { prompted, templateFallbacks }
}

export async function checkJobsForNewProviderAvailability(providerId: string) {
  const openJobs = await db.jobRequest.findMany({
    where: { status: 'OPEN' },
    select: { id: true },
    orderBy: { createdAt: 'asc' },
    take: 10,
  })

  let dispatchedOpenJobs = 0
  const { orchestrateMatch } = await import('./orchestrator')

  for (const job of openJobs) {
    const result = await orchestrateMatch(job.id, { triggeredBy: 'cron' })
    if (result.status === 'DISPATCHED') dispatchedOpenJobs++
  }

  const rematch = await promptCustomersForNewProviderAvailability(providerId)

  return {
    dispatchedOpenJobs,
    promptedExpiredJobs: rematch.prompted,
    templateFallbacks: rematch.templateFallbacks,
  }
}
