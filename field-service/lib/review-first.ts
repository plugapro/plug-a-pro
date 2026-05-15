import { db } from './db'
import type { LeadStatus } from '@prisma/client'
import { rankCandidatesForJobRequest } from './matching/service'
import { getReviewProviderProfileUrl } from './review-provider-profile-access'
import { sendButtons, sendCtaUrl, sendText } from './whatsapp-interactive'
import { sendJobOffer } from './whatsapp'
import { getProviderLeadAccessUrl } from './provider-lead-access'
import { getJobRequestAccessUrl } from './job-request-access'
import { hasSuccessfulMessageForRecipient } from './message-events'
import { maskPhone } from './support-diagnostics'
import { ctaLabelFor } from './whatsapp-copy'

export const RFP_PROVIDER_RESPONSE_MINUTES = Math.max(
  1,
  Number.parseInt(process.env.RFP_PROVIDER_RESPONSE_MINUTES ?? '15', 10) || 15,
)
export const MAX_PROVIDER_REVIEW_BATCHES = Math.max(
  1,
  Number.parseInt(process.env.MAX_PROVIDER_REVIEW_BATCHES ?? '3', 10) || 3,
)
export const MAX_SHORTLISTED_PROVIDERS = Math.max(
  1,
  Number.parseInt(process.env.MAX_SHORTLISTED_PROVIDERS ?? '3', 10) || 3,
)
export const MIN_SHORTLISTED_PROVIDERS = Math.max(
  1,
  Number.parseInt(process.env.MIN_SHORTLISTED_PROVIDERS ?? '1', 10) || 1,
)
const PROVIDERS_PER_BATCH = 3
const MVP1_MATCH_RESULT_LIMIT = Math.min(
  5,
  Math.max(3, Number.parseInt(process.env.MVP1_MATCH_RESULT_LIMIT ?? '5', 10) || 5),
)
const REVIEW_FIRST_PROVIDER_NOTIFICATION_SOURCE = 'review_first_send_request'
const REVIEW_FIRST_PROVIDER_NOTIFICATION_FAILED_TEMPLATE = 'interactive:rfp_provider_notification_failed'
const REVIEW_FIRST_PROVIDER_NOTIFICATION_ACCEPTED_TEMPLATE = 'interactive:rfp_provider_notification_accepted'

type ProviderRfpSendResult =
  | {
      ok: true
      provider: 'whatsapp_cloud'
      messageId: string | null
    }
  | {
      ok: false
      provider: 'whatsapp_cloud'
      errorCode: string
      errorMessage: string
      retryable: boolean
    }

export class ReviewFirstError extends Error {
  constructor(
    public readonly code:
      | 'REQUEST_NOT_FOUND'
      | 'REQUEST_NOT_MATCHABLE'
      | 'MATCHING_FAILED'
      | 'REQUEST_MISSING_CATEGORY'
      | 'REQUEST_MISSING_LOCATION'
      | 'FORBIDDEN'
      | 'MATCHES_NOT_READY'
      | 'NO_CANDIDATES'
      | 'PROVIDER_NOT_ELIGIBLE'
      | 'PROVIDER_NOTIFICATION_FAILED'
      | 'SHORTLIST_LIMIT_REACHED'
      | 'SHORTLIST_EMPTY'
      | 'REQUEST_NOT_READY'
      | 'INVALID_BATCH',
    message: string,
  ) {
    super(message)
    this.name = 'ReviewFirstError'
  }
}

type MatchedProviderDisplay = {
  providerId: string
  displayName: string
  profilePhotoUrl: string | null
  mainSkill: string
  secondarySkills: string[]
  serviceArea: string | null
  serviceZones: string[]
  labourRateText: string | null
  trustLevel: 'reviewed' | 'profile_only'
  summary: string | null
  availabilityIndicator: 'available_now' | 'availability_not_confirmed'
  rank: number
  score: number | null
  whyMatched: string
  // Existing review-first UI contract (kept for backwards compatibility)
  name: string
  bio: string | null
  experience: string | null
  skills: string[]
  serviceAreas: string[]
  avatarUrl: string | null
  verified: boolean
  averageRating: number | null
  completedJobsCount: number
  portfolioUrls: string[]
  callOutFee: number | null
  hourlyRate: number | null
  negotiable: boolean
  profileUrl: string | null
}

type ReviewDisplayRequest = {
  id: string
  customerId?: string | null
  category: string
  status: string
  address: {
    suburb: string
    city: string
    region: string | null
    locationNodeId: string | null
    locationNode: { regionKey: string | null } | null
  } | null
  latestDispatchDecisionId: string | null
  leads: Array<{ providerId: string; status: string }>
}

type ReviewDisplayAttempt = {
  providerId: string
  rankedPosition: number | null
  createdAt: Date
  score: number | null
  feasibilityNotes: string[]
  provider: {
    id: string
    active: boolean
    status: string
    availableNow: boolean
    name: string
    bio: string | null
    experience: string | null
    skills: string[]
    serviceAreas: string[]
    avatarUrl: string | null
    verified: boolean
    averageRating: number | null
    completedJobsCount: number
    portfolioUrls: string[]
    technicianServiceAreas: Array<{
      active: boolean
      label: string | null
      city: string | null
      suburbKey: string | null
      regionKey: string | null
      locationNodeId: string | null
    }>
    providerRates: Array<{
      callOutFee: unknown
      hourlyRate: unknown
      rateNegotiable: boolean
    }>
  }
}

function isProviderDisplayEligible(provider: {
  active: boolean
  status: string
  availableNow: boolean
  name: string
  skills: string[]
  serviceAreas: string[]
  technicianServiceAreas: Array<{ active: boolean; label: string | null; city: string | null }>
}) {
  if (!provider.active) return false
  if (provider.status !== 'ACTIVE') return false
  if (!provider.name.trim()) return false
  if (!provider.availableNow) return false
  if (provider.skills.length === 0) return false
  const hasArea = provider.serviceAreas.length > 0 || provider.technicianServiceAreas.some((row) => row.active)
  if (!hasArea) return false
  return true
}

function pickMainSkill(skills: string[], requestCategory: string) {
  const normalizedRequestCategory = requestCategory.trim().toLowerCase()
  const requestSkill = skills.find((skill) => skill.trim().toLowerCase() === normalizedRequestCategory)
  return requestSkill ?? skills[0] ?? requestCategory
}

function buildServiceAreaLabel(provider: {
  serviceAreas: string[]
  technicianServiceAreas: Array<{ active: boolean; label: string | null; city: string | null }>
}) {
  const structured = provider.technicianServiceAreas
    .filter((row) => row.active)
    .map((row) => row.label ?? row.city)
    .filter((row): row is string => Boolean(row))
  const zones = [...structured, ...provider.serviceAreas].filter(Boolean)
  return zones[0] ?? null
}

function toLabourRateText(callOutFee: number | null, hourlyRate: number | null, negotiable: boolean) {
  if (hourlyRate != null) return `from R${Math.round(hourlyRate)}/hr`
  if (callOutFee != null) return `call-out from R${Math.round(callOutFee)}`
  if (negotiable) return 'rate negotiable'
  return null
}

async function resolveUsableReviewDecisionId(params: {
  requestId: string
  latestDispatchDecisionId?: string | null
}) {
  let decisionId = params.latestDispatchDecisionId ?? null
  if (decisionId) {
    const latestDecision = await db.dispatchDecision.findUnique({
      where: { id: decisionId },
      select: { id: true, mode: true, status: true },
    })
    const hasUsableCachedDecision =
      latestDecision?.mode === 'OPS_REVIEW' && (latestDecision.status === 'RANKED' || latestDecision.status === 'NO_MATCH')

    if (!hasUsableCachedDecision) {
      const fallbackDecision = await db.dispatchDecision.findFirst({
        where: { jobRequestId: params.requestId, mode: 'OPS_REVIEW', status: { in: ['RANKED', 'NO_MATCH'] } },
        orderBy: { createdAt: 'desc' },
        select: { id: true },
      })
      decisionId = fallbackDecision?.id ?? null
    }
  }

  if (!decisionId) {
    const fallbackDecision = await db.dispatchDecision.findFirst({
      where: { jobRequestId: params.requestId, mode: 'OPS_REVIEW', status: { in: ['RANKED', 'NO_MATCH'] } },
      orderBy: { createdAt: 'desc' },
      select: { id: true },
    })
    decisionId = fallbackDecision?.id ?? null
  }

  return decisionId
}

async function loadRankedDisplayAttempts(decisionId: string): Promise<ReviewDisplayAttempt[]> {
  return db.matchAttempt.findMany({
    where: { dispatchDecisionId: decisionId, stage: 'RANKED' },
    orderBy: [{ rankedPosition: 'asc' }, { createdAt: 'asc' }],
    include: {
      provider: {
        select: {
          id: true,
          active: true,
          status: true,
          availableNow: true,
          name: true,
          bio: true,
          experience: true,
          skills: true,
          serviceAreas: true,
          avatarUrl: true,
          verified: true,
          averageRating: true,
          completedJobsCount: true,
          portfolioUrls: true,
          technicianServiceAreas: {
            where: { active: true },
            select: {
              active: true,
              label: true,
              city: true,
              suburbKey: true,
              regionKey: true,
              locationNodeId: true,
            },
          },
          providerRates: {
            orderBy: { updatedAt: 'desc' },
            take: 1,
            select: {
              callOutFee: true,
              hourlyRate: true,
              rateNegotiable: true,
            },
          },
        },
      },
    },
  }) as Promise<ReviewDisplayAttempt[]>
}

function filterDisplayableReviewAttempts(
  rankedAttempts: ReviewDisplayAttempt[],
  request: ReviewDisplayRequest,
) {
  const normalizedRequestCategory = normalize(request.category)
  const engagedProviderIds = new Set(
    request.leads
      .filter((lead) => ['SHORTLISTED', 'SEND_PENDING', 'SEND_FAILED', 'SENT', 'VIEWED', 'INTERESTED'].includes(lead.status))
      .map((lead) => lead.providerId),
  )

  return rankedAttempts.filter((attempt) => {
    if (engagedProviderIds.has(attempt.providerId)) return false
    if (!isProviderDisplayEligible(attempt.provider)) return false
    if (!providerCoversRequestArea(attempt.provider, { address: request.address })) return false
    if (!attempt.provider.skills.map((skill) => normalize(skill)).includes(normalizedRequestCategory)) return false
    return true
  })
}

export async function getMatchedProvidersForCustomerRequest(params: {
  requestId: string
  customerId: string
  batch?: number
}) {
  const batch = params.batch ?? 1
  if (!Number.isFinite(batch) || !Number.isInteger(batch) || batch < 1 || batch > MAX_PROVIDER_REVIEW_BATCHES) {
    throw new ReviewFirstError('INVALID_BATCH', 'Invalid provider batch.')
  }

  console.info('[review-first.matches] retrieval_start', {
    requestId: params.requestId,
    customerId: params.customerId,
    batch,
  })

  const request = await db.jobRequest.findUnique({
    where: { id: params.requestId },
    select: {
      id: true,
      customerId: true,
      category: true,
      status: true,
      address: {
        select: {
          suburb: true,
          city: true,
          region: true,
          locationNodeId: true,
          locationNode: { select: { regionKey: true } },
        },
      },
      latestDispatchDecisionId: true,
      leads: { select: { providerId: true, status: true } },
    },
  })
  if (!request) {
    console.warn('[review-first.matches] request_not_found', { requestId: params.requestId })
    throw new ReviewFirstError('REQUEST_NOT_FOUND', 'Request not found.')
  }
  if (request.customerId !== params.customerId) {
    console.warn('[review-first.matches] forbidden', {
      requestId: params.requestId,
      customerId: params.customerId,
    })
    throw new ReviewFirstError('FORBIDDEN', 'Not allowed for this request.')
  }

  // In terminal or accepted states, matched providers should not be surfaced to
  // avoid exposing a stale, no longer-valid provider set after the request is closed.
  const nonDisplayableStatuses = new Set(['CANCELLED', 'EXPIRED', 'MATCHED', 'PROVIDER_CONFIRMATION_PENDING'])
  if (nonDisplayableStatuses.has(request.status)) {
    console.warn('[review-first.matches] request_not_matchable', {
      requestId: params.requestId,
      requestStatus: request.status,
    })
    throw new ReviewFirstError('REQUEST_NOT_MATCHABLE', 'Request is not in a valid state for provider matching view.')
  }

  if (!normalize(request.category)) {
    console.warn('[review-first.matches] missing_category', {
      requestId: params.requestId,
    })
    throw new ReviewFirstError('REQUEST_MISSING_CATEGORY', 'Request is missing a service category.')
  }

  const hasLocation = Boolean(
    normalize(request.address?.suburb) ||
      normalize(request.address?.city) ||
      normalize(request.address?.region) ||
      request.address?.locationNodeId,
  )
  if (!hasLocation) {
    console.warn('[review-first.matches] missing_location', {
      requestId: params.requestId,
    })
    throw new ReviewFirstError('REQUEST_MISSING_LOCATION', 'Request is missing location details.')
  }

  const decisionId = await resolveUsableReviewDecisionId({
    requestId: request.id,
    latestDispatchDecisionId: request.latestDispatchDecisionId,
  })

  if (!decisionId) {
    console.info('[review-first.matches] not_ready', {
      requestId: params.requestId,
      customerId: params.customerId,
      batch,
    })
    throw new ReviewFirstError('MATCHES_NOT_READY', 'Provider options are not ready yet.')
  }

  const rankedAttempts = await loadRankedDisplayAttempts(decisionId)
  const eligibleAttempts = filterDisplayableReviewAttempts(rankedAttempts, request)

  const offset = (batch - 1) * PROVIDERS_PER_BATCH
  const selected = eligibleAttempts.slice(offset, offset + PROVIDERS_PER_BATCH)

  const providers: MatchedProviderDisplay[] = selected.map((attempt, index) => {
    const rate = attempt.provider.providerRates[0] ?? null
    const callOutFee = rate?.callOutFee ? Number(rate.callOutFee) : null
    const hourlyRate = rate?.hourlyRate ? Number(rate.hourlyRate) : null
    const negotiable = rate?.rateNegotiable ?? true
    const mainSkill = pickMainSkill(attempt.provider.skills, request.category)
    const serviceArea = buildServiceAreaLabel(attempt.provider)
    const serviceZones = [
      ...attempt.provider.serviceAreas,
      ...attempt.provider.technicianServiceAreas
        .map((row) => row.label ?? row.city)
        .filter((row): row is string => Boolean(row)),
    ]
    const displayName = attempt.provider.name
    const whyMatched = attempt.feasibilityNotes?.[0] ?? 'Matches your service category and area.'

    return {
      providerId: attempt.provider.id,
      displayName,
      profilePhotoUrl: attempt.provider.avatarUrl,
      mainSkill,
      secondarySkills: attempt.provider.skills.filter((skill) => skill !== mainSkill).slice(0, 4),
      serviceArea,
      serviceZones,
      labourRateText: toLabourRateText(callOutFee, hourlyRate, negotiable),
      trustLevel: attempt.provider.verified ? 'reviewed' : 'profile_only',
      summary: attempt.provider.bio,
      availabilityIndicator: attempt.provider.availableNow ? 'available_now' : 'availability_not_confirmed',
      rank: offset + index + 1,
      score: attempt.score ?? null,
      whyMatched,
      // Backwards-compatible fields used by current PWA review-first screens.
      name: displayName,
      bio: attempt.provider.bio,
      experience: attempt.provider.experience,
      skills: attempt.provider.skills,
      serviceAreas: attempt.provider.serviceAreas,
      avatarUrl: attempt.provider.avatarUrl,
      verified: attempt.provider.verified,
      averageRating: attempt.provider.averageRating,
      completedJobsCount: attempt.provider.completedJobsCount,
      portfolioUrls: attempt.provider.portfolioUrls,
      callOutFee,
      hourlyRate,
      negotiable,
      profileUrl: getReviewProviderProfileUrl({
        requestId: request.id,
        providerId: attempt.provider.id,
      }),
    }
  })

  const filteredCount = rankedAttempts.length - eligibleAttempts.length
  if (providers.length === 0) {
    console.warn('[review-first.matches] retrieval_empty', {
      requestId: params.requestId,
      customerId: params.customerId,
      decisionId,
      batch,
      matchCount: providers.length,
      totalAttemptCount: rankedAttempts.length,
      totalEligibleCount: eligibleAttempts.length,
      filteredOutCount: filteredCount,
    })
  }

  console.info('[review-first.matches] retrieval_success', {
    requestId: params.requestId,
    customerId: params.customerId,
    decisionId,
    matchCount: providers.length,
    totalEligibleCount: eligibleAttempts.length,
  })

  return {
    requestId: request.id,
    batch,
    hasMore: offset + PROVIDERS_PER_BATCH < eligibleAttempts.length && batch < MAX_PROVIDER_REVIEW_BATCHES,
    totalEligibleCount: eligibleAttempts.length,
    providers,
  }
}

type Mvp1MatchProvider = {
  providerId: string
  name: string
  bio: string | null
  avatarUrl: string | null
  skills: string[]
  serviceAreas: string[]
  rank: number
  score: number | null
  whyMatched: string
}

function normalize(value: string | null | undefined) {
  return (value ?? '').trim().toLowerCase()
}

function normalizeAreaKey(value: string | null | undefined) {
  return normalize(value).replace(/\s+/g, '_')
}

function providerCoversRequestArea(
  provider: {
    serviceAreas: string[]
    technicianServiceAreas: Array<{
      active: boolean
      label: string | null
      city: string | null
      regionKey: string | null
      suburbKey: string | null
      locationNodeId: string | null
    }>
  },
  request: {
    address: {
      suburb: string
      city: string
      region: string | null
      locationNodeId: string | null
      locationNode: { regionKey: string | null } | null
    } | null
  },
) {
  const suburb = normalize(request.address?.suburb)
  const city = normalize(request.address?.city)
  const region = normalize(request.address?.region) || normalize(request.address?.locationNode?.regionKey)
  const locationNodeId = request.address?.locationNodeId ?? null

  const legacyAreas = new Set(provider.serviceAreas.map((area) => normalize(area)).filter(Boolean))
  if (suburb && legacyAreas.has(suburb)) return true
  if (city && legacyAreas.has(city)) return true
  if (region && legacyAreas.has(region)) return true

  const activeStructuredAreas = provider.technicianServiceAreas.filter((row) => row.active)
  if (locationNodeId && activeStructuredAreas.some((row) => row.locationNodeId === locationNodeId)) return true
  if (suburb && activeStructuredAreas.some((row) => normalizeAreaKey(row.suburbKey) === normalizeAreaKey(suburb))) return true
  if (region && activeStructuredAreas.some((row) => normalize(row.regionKey) === region)) return true
  if (city && activeStructuredAreas.some((row) => normalize(row.city) === city || normalize(row.label) === city)) return true

  return false
}

/**
 * MVP1 workflow 1:
 * request exists -> identify eligible providers -> persist reusable match results.
 *
 * Status mapping (without a large enum rename):
 * - MATCHING_PENDING => JobRequest.OPEN
 * - MATCHES_FOUND    => JobRequest.SHORTLIST_READY
 *
 * Auth: this function performs DB writes without an ownership check. It is intentionally
 * a system-level service callable only from trusted internal paths (matching-mode selection,
 * admin actions, background jobs). Never expose it directly to unauthenticated API routes.
 * Customer-facing callers must validate ownership before invoking this.
 */
export async function matchEligibleProvidersForServiceRequest(params: {
  serviceRequestId: string
  limit?: number
}) {
  const serviceRequestId = params.serviceRequestId
  const limit = Math.max(1, Math.min(5, params.limit ?? MVP1_MATCH_RESULT_LIMIT))
  console.info('[mvp1.match] start', { serviceRequestId, limit })

  const request = await db.jobRequest.findUnique({
    where: { id: serviceRequestId },
    select: {
      id: true,
      status: true,
      category: true,
      assignmentMode: true,
      latestDispatchDecisionId: true,
      address: {
        select: {
          suburb: true,
          city: true,
          region: true,
          locationNodeId: true,
          locationNode: { select: { regionKey: true } },
        },
      },
    },
  })

  if (!request) {
    console.warn('[mvp1.match] request_not_found', { serviceRequestId })
    throw new ReviewFirstError('REQUEST_NOT_FOUND', 'Request not found.')
  }

  // SHORTLIST_READY: customer is actively reviewing; re-matching would overwrite the decision they see.
  // PROVIDER_CONFIRMATION_PENDING: a provider has been selected and is awaiting acceptance.
  const nonRematchableStatuses = [
    'MATCHED',
    'CANCELLED',
    'EXPIRED',
    'SHORTLIST_READY',
    'PROVIDER_CONFIRMATION_PENDING',
  ] as const
  if (nonRematchableStatuses.includes(request.status as (typeof nonRematchableStatuses)[number])) {
    console.warn('[mvp1.match] request_not_matchable', { serviceRequestId, status: request.status })
    throw new ReviewFirstError(
      'REQUEST_NOT_MATCHABLE',
      request.status === 'MATCHED'
        ? 'Request is already accepted and cannot be rematched.'
        : request.status === 'CANCELLED'
          ? 'Request was cancelled and cannot be rematched.'
          : request.status === 'EXPIRED'
            ? 'Request has expired and cannot be rematched.'
            : 'Request is currently in a later matching state and cannot be rematched.',
    )
  }

  if (!normalize(request.category)) {
    console.warn('[mvp1.match] request_missing_category', { serviceRequestId })
    throw new ReviewFirstError('REQUEST_MISSING_CATEGORY', 'Request is missing a service category.')
  }

  const hasLocation =
    Boolean(normalize(request.address?.suburb)) ||
    Boolean(normalize(request.address?.city)) ||
    Boolean(normalize(request.address?.region)) ||
    Boolean(request.address?.locationNodeId)
  if (!hasLocation) {
    console.warn('[mvp1.match] request_missing_location', { serviceRequestId })
    throw new ReviewFirstError('REQUEST_MISSING_LOCATION', 'Request is missing location details.')
  }

  const cachedDecision = request.latestDispatchDecisionId
    ? await db.dispatchDecision.findUnique({
        where: { id: request.latestDispatchDecisionId },
        select: { id: true, mode: true, status: true },
      })
    : null

  const fallbackDecision = cachedDecision
    ? null
    : await db.dispatchDecision.findFirst({
        where: { jobRequestId: serviceRequestId, mode: 'OPS_REVIEW', status: { in: ['RANKED', 'NO_MATCH'] } },
        orderBy: { createdAt: 'desc' },
        select: { id: true, mode: true, status: true },
      })

  const resolvedDecision = cachedDecision ?? fallbackDecision

  if (
    resolvedDecision &&
    resolvedDecision.mode === 'OPS_REVIEW' &&
    (resolvedDecision.status === 'RANKED' || resolvedDecision.status === 'NO_MATCH')
  ) {
    const cachedAttempts = await db.matchAttempt.findMany({
      where: { dispatchDecisionId: resolvedDecision.id, stage: 'RANKED' },
      orderBy: [{ rankedPosition: 'asc' }, { createdAt: 'asc' }],
      include: {
        provider: {
          select: {
            id: true,
            active: true,
            status: true,
            availableNow: true,
            name: true,
            bio: true,
            experience: true,
            avatarUrl: true,
            verified: true,
            averageRating: true,
            completedJobsCount: true,
            portfolioUrls: true,
            skills: true,
            serviceAreas: true,
            technicianServiceAreas: {
              where: { active: true },
              select: {
                active: true,
                label: true,
                city: true,
                suburbKey: true,
                regionKey: true,
                locationNodeId: true,
              },
            },
            providerRates: {
              orderBy: { updatedAt: 'desc' },
              take: 1,
              select: {
                callOutFee: true,
                hourlyRate: true,
                rateNegotiable: true,
              },
            },
          },
        },
      },
    })

    const displayableCachedAttempts = filterDisplayableReviewAttempts(
      cachedAttempts as ReviewDisplayAttempt[],
      { ...request, leads: [] },
    ).slice(0, limit)

    const cachedProviders: Mvp1MatchProvider[] = displayableCachedAttempts.map((attempt, index) => ({
      providerId: attempt.provider.id,
      name: attempt.provider.name,
      bio: attempt.provider.bio,
      avatarUrl: attempt.provider.avatarUrl,
      skills: attempt.provider.skills,
      serviceAreas: attempt.provider.serviceAreas,
      rank: index + 1,
      score: attempt.score ?? null,
      whyMatched: attempt.feasibilityNotes?.[0] ?? 'Eligible by category, area, profile status, and availability.',
    }))

    console.info('[mvp1.match] success_cached', {
      serviceRequestId,
      decisionId: resolvedDecision.id,
      matchedProviders: cachedProviders.length,
    })
    return {
      serviceRequestId,
      decisionId: resolvedDecision.id,
      status: cachedProviders.length > 0 ? 'MATCHES_FOUND' as const : 'NO_MATCH' as const,
      providers: cachedProviders,
      wasCached: true,
    }
  }

  const runMatching = async () => {
    const ranking = await rankCandidatesForJobRequest(serviceRequestId)
    const providerIds = ranking.candidates.map((candidate) => candidate.providerId)

    const rankedProviders = providerIds.length
      ? await db.provider.findMany({
          where: { id: { in: providerIds } },
          select: {
            id: true,
            active: true,
            status: true,
            availableNow: true,
            verified: true,
            name: true,
            bio: true,
            avatarUrl: true,
            skills: true,
            serviceAreas: true,
            technicianServiceAreas: {
              where: { active: true },
              select: {
                active: true,
                label: true,
                city: true,
                regionKey: true,
                suburbKey: true,
                locationNodeId: true,
              },
            },
          },
        })
      : []

    const providersById = new Map(rankedProviders.map((provider) => [provider.id, provider]))
    const normalizedCategory = normalize(request.category)
    const finalCandidates = ranking.candidates
      .map((candidate, index) => ({ candidate, provider: providersById.get(candidate.providerId), rank: index + 1 }))
      .filter((row) => {
        if (!row.provider) return false
        // Defensive server-side eligibility checks for retry-safe matching.
        // This keeps request matching deterministic even if upstream ranking inputs drift.
        if (!row.provider.active || row.provider.status !== 'ACTIVE' || !row.provider.availableNow) return false
        // "Profile complete enough" for MVP1 match list visibility means at minimum
        // a non-empty display name, at least one published skill, and at least one service area.
        if (!row.provider.name.trim()) return false
        if (row.provider.skills.length === 0) return false
        const hasArea = row.provider.serviceAreas.length > 0 || row.provider.technicianServiceAreas.some((sa) => sa.active)
        if (!hasArea) return false
        if (!row.provider.skills.map((skill) => normalize(skill)).includes(normalizedCategory)) return false
        if (!providerCoversRequestArea(row.provider, request)) return false
        return true
      })
      .slice(0, limit)

    const rankingSummary = finalCandidates.map((row) => ({
      providerId: row.candidate.providerId,
      score: row.candidate.score,
      rankedPosition: row.rank,
      selectionReason: row.candidate.selectionReason,
      travelMinutes: row.candidate.travelMinutes,
      canMeetWindow: row.candidate.canMeetWindow,
    }))

    // Write the decision, all attempt rows, and the request pointer atomically.
    // A crash between decision.create and matchAttempt.create would leave
    // latestDispatchDecisionId pointing at a partially-populated decision; wrapping
    // in a transaction ensures the cache check always sees a consistent state.
    const decision = await db.$transaction(async (tx) => {
      const dec = await tx.dispatchDecision.create({
        data: {
          jobRequestId: serviceRequestId,
          mode: 'OPS_REVIEW',
          status: finalCandidates.length > 0 ? 'RANKED' : 'NO_MATCH',
          initiatedById: 'mvp1-matching',
          initiatedByRole: 'system',
          consideredCount: ranking.consideredCount,
          eligibleCount: finalCandidates.length,
          rankingSummary: rankingSummary as object[],
          filterSummary: ranking.filteredOut as object[],
          explanation: finalCandidates[0]?.candidate.selectionReason ?? 'No eligible providers passed MVP1 filters.',
        },
      })

      if (finalCandidates.length > 0) {
        await tx.matchAttempt.createMany({
          data: finalCandidates.map((row) => ({
            jobRequestId: serviceRequestId,
            providerId: row.provider!.id,
            dispatchDecisionId: dec.id,
            attemptNumber: row.rank,
            rankedPosition: row.rank,
            stage: 'RANKED' as const,
            hardFilterPassed: true,
            filteredReasonCodes: [],
            feasibilityNotes: row.candidate.feasibilityNotes,
            score: row.candidate.score,
            scoreBreakdown: row.candidate.scoreBreakdown as object,
          })),
        })
      }

      // Keep the persisted request status compatible with the existing review-first
      // flow: provider options are represented by a ranked dispatch decision while
      // the request remains in PENDING_VALIDATION until shortlist publication.
      await tx.jobRequest.update({
        where: { id: serviceRequestId },
        data: {
          latestDispatchDecisionId: dec.id,
          assignmentMode: 'OPS_REVIEW',
          status: 'PENDING_VALIDATION',
        },
      })

      return dec
    })

    const providers: Mvp1MatchProvider[] = finalCandidates.map((row) => ({
      providerId: row.provider!.id,
      name: row.provider!.name,
      bio: row.provider!.bio,
      avatarUrl: row.provider!.avatarUrl,
      skills: row.provider!.skills,
      serviceAreas: row.provider!.serviceAreas,
      rank: row.rank,
      score: row.candidate.score,
      whyMatched: row.candidate.feasibilityNotes?.[0] ?? 'Eligible by category, area, profile status, and availability.',
    }))

    if (providers.length === 0) {
      console.info('[mvp1.match] no_match', {
        serviceRequestId,
        decisionId: decision.id,
        matchedProviders: providers.length,
        consideredCount: ranking.consideredCount,
      })
      return {
        serviceRequestId,
        decisionId: decision.id,
        status: 'NO_MATCH' as const,
        providers,
        wasCached: false,
      }
    }

    console.info('[mvp1.match] success', {
      serviceRequestId,
      decisionId: decision.id,
      matchedProviders: providers.length,
    })
    return {
      serviceRequestId,
      decisionId: decision.id,
      status: 'MATCHES_FOUND' as const,
      providers,
      wasCached: false,
    }
  }

  try {
    return await runMatching()
  } catch (error) {
    if (error instanceof ReviewFirstError) throw error
    const errorMessage = error instanceof Error ? error.message : 'Unknown matching error'
    console.error('[mvp1.match] failed', {
      serviceRequestId,
      error: {
        name: error instanceof Error ? error.name : 'Error',
        message: errorMessage,
        code: error instanceof Error && 'code' in error ? (error as { code?: unknown }).code : undefined,
      },
    })
    throw new ReviewFirstError('MATCHING_FAILED', 'Matching failed. Please try again.')
  }
}

export async function getReviewFirstDisplayableCandidateCount(params: {
  requestId: string
  decisionId?: string | null
}) {
  const request = await db.jobRequest.findUnique({
    where: { id: params.requestId },
    select: {
      id: true,
      status: true,
      category: true,
      assignmentMode: true,
      latestDispatchDecisionId: true,
      address: {
        select: {
          suburb: true,
          city: true,
          region: true,
          locationNodeId: true,
          locationNode: { select: { regionKey: true } },
        },
      },
      leads: { select: { providerId: true, status: true } },
    },
  })
  if (!request) {
    throw new ReviewFirstError('REQUEST_NOT_FOUND', 'Request not found.')
  }

  const decisionId = params.decisionId ?? (await resolveUsableReviewDecisionId({
    requestId: request.id,
    latestDispatchDecisionId: request.latestDispatchDecisionId,
  }))

  if (!decisionId) {
    console.info('[review-first.matches] displayable_count_not_ready', {
      requestId: request.id,
      requestStatus: request.status,
      assignmentMode: request.assignmentMode,
    })
    return 0
  }

  const rankedAttempts = await loadRankedDisplayAttempts(decisionId)
  const eligibleAttempts = filterDisplayableReviewAttempts(rankedAttempts, request)

  console.info('[review-first.matches] displayable_count', {
    requestId: request.id,
    decisionId,
    rankedCount: rankedAttempts.length,
    displayableCount: eligibleAttempts.length,
    assignmentMode: request.assignmentMode,
    requestStatus: request.status,
  })

  return eligibleAttempts.length
}

export async function getProviderCandidatesForCustomerReview(params: {
  requestId: string
  customerId: string
  batch?: number
}) {
  const matches = await getMatchedProvidersForCustomerRequest({
    requestId: params.requestId,
    customerId: params.customerId,
    batch: params.batch,
  })

  return {
    requestId: matches.requestId,
    batch: matches.batch,
    hasMore: matches.hasMore,
    candidates: matches.providers.map((provider) => ({
      providerId: provider.providerId,
      rank: provider.rank,
      name: provider.name,
      bio: provider.bio,
      experience: provider.experience,
      skills: provider.skills,
      serviceAreas: provider.serviceAreas,
      avatarUrl: provider.avatarUrl,
      verified: provider.verified,
      averageRating: provider.averageRating,
      completedJobsCount: provider.completedJobsCount,
      portfolioUrls: provider.portfolioUrls,
      callOutFee: provider.callOutFee,
      hourlyRate: provider.hourlyRate,
      negotiable: provider.negotiable,
      whyMatched: provider.whyMatched,
      profileUrl: provider.profileUrl,
    })),
  }
}

export async function shortlistProviderForCustomerReview(params: {
  requestId: string
  customerId: string
  providerId: string
}) {
  const request = await db.jobRequest.findUnique({
    where: { id: params.requestId },
    select: {
      id: true,
      customerId: true,
      latestDispatchDecisionId: true,
      category: true,
      status: true,
    },
  })
  if (!request) throw new ReviewFirstError('REQUEST_NOT_FOUND', 'Request not found.')
  if (request.customerId !== params.customerId) {
    throw new ReviewFirstError('FORBIDDEN', 'Not allowed for this request.')
  }
  if (!request.latestDispatchDecisionId) {
    throw new ReviewFirstError('REQUEST_NOT_READY', 'Provider options are not ready yet.')
  }

  const rankedCandidate = await db.matchAttempt.findFirst({
    where: {
      dispatchDecisionId: request.latestDispatchDecisionId,
      providerId: params.providerId,
      stage: 'RANKED',
    },
    select: {
      id: true,
      score: true,
      rankedPosition: true,
    },
  })
  if (!rankedCandidate) {
    throw new ReviewFirstError('PROVIDER_NOT_ELIGIBLE', 'Provider is not eligible for this request.')
  }

  const shortlistLeadStatuses: LeadStatus[] = ['SHORTLISTED', 'SEND_PENDING', 'SEND_FAILED', 'SENT', 'VIEWED', 'INTERESTED', 'CUSTOMER_SELECTED', 'PROVIDER_ACCEPTED', 'CREDIT_REQUIRED', 'CREDIT_APPLIED']

  // Wrap count check + lead upsert + shortlist find/create in a single transaction
  // to prevent two concurrent taps exceeding MAX_SHORTLISTED_PROVIDERS (C2) and
  // to prevent duplicate DRAFT ProviderShortlist rows (C3).
  const { lead } = await db.$transaction(async (tx) => {
    const shortlistCount = await tx.lead.count({
      where: {
        jobRequestId: request.id,
        status: { in: shortlistLeadStatuses },
      },
    })

    const existingLead = await tx.lead.findUnique({
      where: {
        jobRequestId_providerId: {
          jobRequestId: request.id,
          providerId: params.providerId,
        },
      },
      select: {
        id: true,
        status: true,
      },
    })

    if (!existingLead && shortlistCount >= MAX_SHORTLISTED_PROVIDERS) {
      throw new ReviewFirstError('SHORTLIST_LIMIT_REACHED', `You can shortlist up to ${MAX_SHORTLISTED_PROVIDERS} providers.`)
    }

    const lead = await tx.lead.upsert({
      where: {
        jobRequestId_providerId: {
          jobRequestId: request.id,
          providerId: params.providerId,
        },
      },
      create: {
        jobRequestId: request.id,
        providerId: params.providerId,
        dispatchDecisionId: request.latestDispatchDecisionId,
        matchAttemptId: rankedCandidate.id,
        status: 'SHORTLISTED',
        matchScore: rankedCandidate.score ?? null,
        rankingPosition: rankedCandidate.rankedPosition ?? null,
        expiresAt: null,
      },
      update: {
        status: existingLead?.status === 'SHORTLISTED' || existingLead?.status === 'SEND_PENDING' || existingLead?.status === 'SEND_FAILED' || existingLead?.status === 'SENT' || existingLead?.status === 'VIEWED' || existingLead?.status === 'INTERESTED'
          ? existingLead.status
          : 'SHORTLISTED',
        dispatchDecisionId: request.latestDispatchDecisionId,
        matchAttemptId: rankedCandidate.id,
        matchScore: rankedCandidate.score ?? null,
        rankingPosition: rankedCandidate.rankedPosition ?? null,
        expiresAt: null,
      },
    })

    let shortlist = await tx.providerShortlist.findFirst({
      where: { requestId: request.id, status: 'DRAFT' },
      select: { id: true },
    })
    if (!shortlist) {
      try {
        shortlist = await tx.providerShortlist.create({
          data: { requestId: request.id, status: 'DRAFT' },
          select: { id: true },
        })
      } catch (err) {
        // P2002: a concurrent transaction created the DRAFT shortlist first.
        if ((err as { code?: string }).code === 'P2002') {
          shortlist = await tx.providerShortlist.findFirst({
            where: { requestId: request.id, status: 'DRAFT' },
            select: { id: true },
          })
          if (!shortlist) throw err
        } else {
          throw err
        }
      }
    }

    await tx.providerShortlistItem.upsert({
      where: {
        shortlistId_leadInviteId: {
          shortlistId: shortlist.id,
          leadInviteId: lead.id,
        },
      },
      create: {
        shortlistId: shortlist.id,
        leadInviteId: lead.id,
        providerId: params.providerId,
        rank: rankedCandidate.rankedPosition ?? 999,
        matchScore: rankedCandidate.score ?? null,
      },
      update: {},
    })

    return { lead }
  })

  const provider = await db.provider.findUnique({
    where: { id: params.providerId },
    select: { id: true, name: true },
  })

  return {
    requestId: request.id,
    providerId: params.providerId,
    providerName: provider?.name ?? 'Provider',
    leadId: lead.id,
  }
}

export async function getCustomerReviewShortlist(params: { requestId: string; customerId: string }) {
  const request = await db.jobRequest.findUnique({
    where: { id: params.requestId },
    select: { id: true, customerId: true },
  })
  if (!request) throw new ReviewFirstError('REQUEST_NOT_FOUND', 'Request not found.')
  if (request.customerId !== params.customerId) throw new ReviewFirstError('FORBIDDEN', 'Not allowed for this request.')

  const leads = await db.lead.findMany({
    where: {
      jobRequestId: params.requestId,
      status: {
        in: ['SHORTLISTED', 'SEND_PENDING', 'SEND_FAILED', 'SENT', 'VIEWED', 'INTERESTED', 'CUSTOMER_SELECTED', 'PROVIDER_ACCEPTED', 'CREDIT_REQUIRED', 'CREDIT_APPLIED', 'ACCEPTED_LOCKED', 'ACCEPTED'],
      },
    },
    orderBy: [{ rankingPosition: 'asc' }, { sentAt: 'asc' }],
    include: {
      provider: {
        select: {
          id: true,
          name: true,
          verified: true,
        },
      },
      providerResponses: {
        where: { response: 'INTERESTED' },
        orderBy: { createdAt: 'desc' },
        take: 1,
      },
    },
  })

  return {
    requestId: params.requestId,
    providers: leads.map((lead) => {
      const response = lead.providerResponses[0] ?? null
      return {
        providerId: lead.providerId,
        leadId: lead.id,
        name: lead.provider.name,
        verified: lead.provider.verified,
        status: lead.status,
        profileUrl: getReviewProviderProfileUrl({
          requestId: params.requestId,
          providerId: lead.providerId,
        }),
        callOutFee: response?.callOutFee ? Number(response.callOutFee) : null,
        estimatedArrivalAt: response?.estimatedArrivalAt ?? null,
        providerNote: response?.providerNote ?? null,
      }
    }),
  }
}

export async function sendRequestToShortlistedProviders(params: {
  requestId: string
  customerId: string
}) {
  const request = await db.jobRequest.findUnique({
    where: { id: params.requestId },
    select: {
      id: true,
      customerId: true,
      category: true,
      title: true,
      description: true,
      subcategory: true,
      urgency: true,
      requestedWindowStart: true,
      requestedArrivalLatest: true,
      providerPreference: true,
      budgetPreference: true,
      requestRef: true,
      address: { select: { suburb: true, city: true, province: true } },
      customer: { select: { phone: true } },
      leads: {
        where: {
          status: { in: ['SHORTLISTED', 'SEND_PENDING', 'SEND_FAILED', 'SENT', 'VIEWED', 'INTERESTED'] },
        },
        include: {
          provider: { select: { id: true, phone: true, name: true } },
        },
        orderBy: [{ rankingPosition: 'asc' }, { sentAt: 'asc' }],
      },
    },
  })
  if (!request) throw new ReviewFirstError('REQUEST_NOT_FOUND', 'Request not found.')
  if (request.customerId !== params.customerId) throw new ReviewFirstError('FORBIDDEN', 'Not allowed for this request.')

  const shortlisted = request.leads.filter((lead) => lead.status === 'SHORTLISTED')
  const failed = request.leads.filter((lead) => lead.status === 'SEND_FAILED')
  const pending = request.leads.filter((lead) => lead.status === 'SEND_PENDING')
  const alreadySent = request.leads.filter((lead) => lead.status === 'SENT' || lead.status === 'VIEWED' || lead.status === 'INTERESTED')
  const activeTargets = shortlisted.length > 0 ? shortlisted : failed

  if (activeTargets.length < MIN_SHORTLISTED_PROVIDERS) {
    if (pending.length > 0) {
      throw new ReviewFirstError('PROVIDER_NOTIFICATION_FAILED', 'We are still sending your request. Please check again shortly.')
    }
    if (alreadySent.length >= MIN_SHORTLISTED_PROVIDERS) {
      return {
        requestId: request.id,
        invitedCount: alreadySent.length,
        pendingCount: 0,
        failedCount: 0,
        expiresAt: alreadySent[0]?.expiresAt ?? null,
      }
    }
    throw new ReviewFirstError('SHORTLIST_EMPTY', `Please shortlist at least ${MIN_SHORTLISTED_PROVIDERS} provider first.`)
  }
  if (activeTargets.length > MAX_SHORTLISTED_PROVIDERS) {
    throw new ReviewFirstError('SHORTLIST_LIMIT_REACHED', `You can shortlist up to ${MAX_SHORTLISTED_PROVIDERS} providers.`)
  }

  const preferredTime = request.requestedWindowStart
    ? request.requestedWindowStart.toLocaleString('en-ZA', {
        weekday: 'short',
        day: 'numeric',
        month: 'short',
        hour: '2-digit',
        minute: '2-digit',
        timeZone: 'Africa/Johannesburg',
      })
    : request.requestedArrivalLatest
      ? `Before ${request.requestedArrivalLatest.toLocaleString('en-ZA', {
          weekday: 'short',
          day: 'numeric',
          month: 'short',
          hour: '2-digit',
          minute: '2-digit',
          timeZone: 'Africa/Johannesburg',
        })}`
      : 'Flexible'

  const area = [request.address?.suburb, request.address?.city].filter(Boolean).join(', ')

  let notifiedCount = 0
  let pendingCount = 0
  let failedCount = 0
  let firstExpiresAt: Date | null = null

  for (const lead of activeTargets) {
    const leadUrl = await getProviderLeadAccessUrl({
      leadId: lead.id,
      providerId: lead.provider.id,
    })

    if (leadUrl) {
      const notificationAttemptStartedAt = new Date()
      await db.lead.update({
        where: { id: lead.id },
        data: {
          status: 'SEND_PENDING',
          notificationAttemptedAt: notificationAttemptStartedAt,
          expiresAt: null,
          expiredAt: null,
          respondedAt: null,
          viewedAt: null,
          notifiedAt: null,
        },
      })
      // Provider selection can originate from the customer PWA long after the
      // provider last messaged us. Freeform WhatsApp text/buttons may be
      // accepted initially and then fail asynchronously as "Re-engagement
      // message". Start this provider contact with an approved template so the
      // selected provider reliably receives the signed lead URL.
      const sendResult = await attemptProviderRfpWhatsAppNotification({
        providerPhone: lead.provider.phone,
        providerFirstName: lead.provider.name.split(' ')[0] ?? lead.provider.name,
        serviceName: request.category,
        area: area || 'your area',
        scheduledWindow: preferredTime,
        jobUrl: leadUrl,
        metadata: {
          requestId: request.id,
          leadId: lead.id,
          providerId: lead.provider.id,
          source: REVIEW_FIRST_PROVIDER_NOTIFICATION_SOURCE,
        },
      })

      if (sendResult.ok) {
        await db.lead.update({
          where: { id: lead.id },
          data: {
            status: 'SEND_PENDING',
            expiresAt: null,
            respondedAt: null,
            viewedAt: null,
            // Meta can accept the send and later fail delivery asynchronously.
            // `notifiedAt` is set only from delivery/read webhooks so expiry
            // cannot turn an undelivered provider notification into a false
            // "provider did not respond" customer outcome.
            notifiedAt: null,
            notificationAttemptedAt: notificationAttemptStartedAt,
          },
        })
        pendingCount += 1
        notifiedCount++
        console.info('[review-first.send] provider_whatsapp_accepted', {
          requestId: request.id,
          requestRef: request.requestRef,
          leadId: lead.id,
          providerId: lead.provider.id,
          messageId: sendResult.messageId,
          statusBefore: lead.status,
          statusAfter: 'SEND_PENDING',
        })

        // Follow-up: native Accept/Decline buttons for providers on social-data bundles.
        // The template above is the reliable notification; these buttons are best-effort.
        // Uses ops_accept:{leadId} so the bot can accept directly without a hold lookup.
        const providerPhone = normaliseWhatsAppPhone(lead.provider.phone)
        if (providerPhone) {
          const actionsBody = [
            `📌 *${request.category}* in *${area || 'your area'}*`,
            preferredTime ? `Preferred time: *${preferredTime}*` : null,
            '',
            "Tap *I'm Available* if you can take this job. The customer reviews all responses and picks a provider — if selected, you'll get a confirmation here and full details unlock. Accepting uses 1 credit.",
          ].filter(Boolean).join('\n')
          sendButtons(
            providerPhone,
            actionsBody,
            [
              { id: `ops_accept:${lead.id}`, title: "I'm Available" },
              { id: `ops_decline:${lead.id}`, title: 'Not Available' },
            ],
            undefined,
            { templateName: 'rfp:job_lead_actions', metadata: { requestId: request.id, leadId: lead.id, providerId: lead.provider.id } },
          ).catch((err: unknown) => {
            console.warn('[review-first.send] action buttons failed (non-fatal)', {
              requestId: request.id,
              leadId: lead.id,
              error: err instanceof Error ? err.message : String(err),
            })
          })
        }
      } else {
        await db.lead.update({
          where: { id: lead.id },
          data: {
            status: 'SEND_FAILED',
            expiresAt: null,
            expiredAt: null,
            respondedAt: null,
            viewedAt: null,
            notifiedAt: null,
            notificationAttemptedAt: null,
          },
        }).catch(() => undefined)
        failedCount += 1
        console.error('[review-first.send] provider_whatsapp_failed', {
          requestId: request.id,
          requestRef: request.requestRef,
          leadId: lead.id,
          providerId: lead.provider.id,
          providerPhone: maskPhone(lead.provider.phone),
          errorCode: sendResult.errorCode,
          errorMessage: sendResult.errorMessage,
          retryable: sendResult.retryable,
          statusBefore: lead.status,
          statusAfter: 'SEND_FAILED',
        })
      }
    } else {
      await db.lead.update({
        where: { id: lead.id },
        data: {
          status: 'SEND_FAILED',
          expiresAt: null,
          expiredAt: null,
          respondedAt: null,
          viewedAt: null,
          notifiedAt: null,
          notificationAttemptedAt: null,
        },
      }).catch(() => undefined)
      failedCount += 1
      console.error('[review-first.send] provider_lead_url_missing', {
        requestId: request.id,
        requestRef: request.requestRef,
        leadId: lead.id,
        providerId: lead.provider.id,
      })
    }
  }

  if (notifiedCount + pendingCount < MIN_SHORTLISTED_PROVIDERS) {
    if (request.customer?.phone) {
      await sendText(
        request.customer.phone,
        activeTargets.length === 1
          ? `We couldn't notify ${activeTargets[0]?.provider.name ?? 'your selected provider'} right now.\n\nYour request is saved. Open your provider review to retry sending or choose another provider.`
          : `We couldn't notify the selected providers right now.\n\nYour request is saved. Open your provider review to retry sending or choose another provider.`,
        {
          templateName: 'interactive:rfp_send_failed',
          metadata: { requestId: request.id, failedCount },
        },
      ).catch(() => undefined)
    }
    throw new ReviewFirstError(
      'PROVIDER_NOTIFICATION_FAILED',
      'We could not notify your shortlisted provider. Please try again.',
    )
  }

  // pendingCount tracks API-accepted sends; notifiedCount tracks confirmed delivery
  // from webhooks, which cannot be known here. Use pendingCount to gate the
  // MATCHING transition so the status is set as soon as any send is accepted.
  if (pendingCount > 0) {
    await db.jobRequest.update({
      where: { id: request.id },
      data: {
        status: 'MATCHING',
        assignmentMode: 'OPS_REVIEW',
      },
    })
  }

  if (request.customer?.phone) {
    const customerText = pendingCount > 0
      ? `We're sending your request to your selected provider now.\n\nWe'll update you here once WhatsApp confirms the send.`
      : failedCount > 0
      ? `Your request was sent to ${notifiedCount} of ${activeTargets.length} selected provider${activeTargets.length === 1 ? '' : 's'}.\n\nWe couldn't notify ${failedCount} provider${failedCount === 1 ? '' : 's'}. Open your request to retry failed sends or choose another provider.`
      : `Your request has been sent to ${notifiedCount} selected provider${notifiedCount === 1 ? '' : 's'}.\n\nThey have ${RFP_PROVIDER_RESPONSE_MINUTES} minutes to respond. We'll update you as responses come in.`
    await sendText(
      request.customer.phone,
      customerText,
      {
        templateName: 'interactive:rfp_sent_to_shortlist',
        metadata: { requestId: request.id, count: notifiedCount, pendingCount, failedCount },
      },
    ).catch(() => undefined)
  }

  return {
    requestId: request.id,
    invitedCount: pendingCount,
    pendingCount,
    failedCount,
    expiresAt: firstExpiresAt,
  }
}

function metadataString(metadata: unknown, key: string) {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return null
  const value = (metadata as Record<string, unknown>)[key]
  return typeof value === 'string' && value.length > 0 ? value : null
}

function normaliseWhatsAppPhone(phone: string | null | undefined) {
  const digits = phone?.replace(/[^\d+]/g, '') ?? ''
  if (!digits) return null
  if (digits.startsWith('+')) return digits
  if (digits.startsWith('0')) return `+27${digits.slice(1)}`
  if (digits.startsWith('27')) return `+${digits}`
  return digits
}

function extractWhatsAppErrorCode(error: unknown) {
  const message = error instanceof Error ? error.message : String(error)
  const codeMatch = message.match(/"code"\s*:\s*([0-9]+)/)
  return codeMatch?.[1] ?? 'WHATSAPP_SEND_FAILED'
}

async function attemptProviderRfpWhatsAppNotification(params: {
  providerPhone: string | null
  providerFirstName: string
  serviceName: string
  area: string
  scheduledWindow: string
  jobUrl: string
  metadata: Record<string, unknown>
}): Promise<ProviderRfpSendResult> {
  const normalizedPhone = normaliseWhatsAppPhone(params.providerPhone)
  if (!normalizedPhone) {
    return {
      ok: false,
      provider: 'whatsapp_cloud',
      errorCode: 'PROVIDER_PHONE_MISSING',
      errorMessage: 'Provider WhatsApp phone is missing.',
      retryable: false,
    }
  }

  try {
    const messageId = await sendJobOffer({
      providerPhone: normalizedPhone,
      providerFirstName: params.providerFirstName,
      serviceName: params.serviceName,
      area: params.area,
      scheduledWindow: params.scheduledWindow,
      jobUrl: params.jobUrl,
      metadata: params.metadata,
    })
    if (!messageId) {
      return {
        ok: false,
        provider: 'whatsapp_cloud',
        errorCode: 'WHATSAPP_MESSAGE_ID_MISSING',
        errorMessage: 'WhatsApp accepted request without a message id.',
        retryable: true,
      }
    }
    return {
      ok: true,
      provider: 'whatsapp_cloud',
      messageId,
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error)
    return {
      ok: false,
      provider: 'whatsapp_cloud',
      errorCode: extractWhatsAppErrorCode(error),
      errorMessage,
      retryable: true,
    }
  }
}

export async function handleReviewFirstProviderNotificationStatus(params: {
  externalId: string
  status: 'sent' | 'delivered' | 'read' | 'failed'
  failureReason?: string | null
}) {
  const messageEvent = await db.messageEvent.findFirst({
    where: { externalId: params.externalId },
    select: {
      id: true,
      templateName: true,
      metadata: true,
    },
  })

  const metadata = messageEvent?.metadata
  if (metadataString(metadata, 'source') !== REVIEW_FIRST_PROVIDER_NOTIFICATION_SOURCE) {
    return { handled: false as const, reason: 'not_review_first_provider_notification' }
  }

  const requestId = metadataString(metadata, 'requestId')
  const leadId = metadataString(metadata, 'leadId')
  const providerId = metadataString(metadata, 'providerId')
  if (!requestId || !leadId || !providerId) {
    console.warn('[review-first.provider-notification] metadata_missing', {
      externalId: params.externalId,
      messageEventId: messageEvent?.id ?? null,
      status: params.status,
    })
    return { handled: false as const, reason: 'metadata_missing' }
  }

  if (params.status === 'sent' || params.status === 'delivered' || params.status === 'read') {
    const sentAt = new Date()
    const expiresAt = new Date(sentAt.getTime() + RFP_PROVIDER_RESPONSE_MINUTES * 60_000)
    const updated = await db.lead.updateMany({
      where: {
        id: leadId,
        jobRequestId: requestId,
        providerId,
        status: 'SEND_PENDING',
      },
      data: {
        status: 'SENT',
        sentAt,
        expiresAt,
        notifiedAt: sentAt,
        notificationAttemptedAt: null,
      },
    })

    if (updated.count > 0) {
      await db.jobRequest.updateMany({
        where: {
          id: requestId,
          assignmentMode: 'OPS_REVIEW',
          status: 'PENDING_VALIDATION',
        },
        data: { status: 'MATCHING' },
      }).catch(() => undefined)

      const lead = await db.lead.findUnique({
        where: { id: leadId },
        select: {
          provider: { select: { name: true } },
          jobRequest: {
            select: {
              customer: { select: { phone: true } },
            },
          },
        },
      }).catch(() => null)

      if (lead?.jobRequest.customer?.phone) {
        const alreadySent = await hasSuccessfulMessageForRecipient({
          to: lead.jobRequest.customer.phone,
          templateName: REVIEW_FIRST_PROVIDER_NOTIFICATION_ACCEPTED_TEMPLATE,
          metadataPath: ['leadId'],
          metadataEquals: leadId,
        }).catch(() => false)

        if (!alreadySent) {
          await sendText(
            lead.jobRequest.customer.phone,
            `Your request was sent to ${lead.provider.name}. They have ${RFP_PROVIDER_RESPONSE_MINUTES} minutes to respond.`,
            {
              templateName: REVIEW_FIRST_PROVIDER_NOTIFICATION_ACCEPTED_TEMPLATE,
              metadata: {
                requestId,
                leadId,
                providerId,
                idempotencyKey: `${REVIEW_FIRST_PROVIDER_NOTIFICATION_ACCEPTED_TEMPLATE}:${leadId}`,
              },
            },
          ).catch((error) => {
            console.warn('[review-first.provider-notification] customer_success_notice_failed', {
              requestId,
              leadId,
              providerId,
              error: error instanceof Error ? error.message : String(error),
            })
          })
        }
      }
    }

    console.info('[review-first.provider-notification] delivered', {
      requestId,
      leadId,
      providerId,
      status: params.status,
      updatedCount: updated.count,
    })
    return { handled: true as const, result: 'delivered', updatedCount: updated.count }
  }

  if (params.status !== 'failed') {
    return { handled: true as const, result: 'status_observed' }
  }

  const repair = await db.$transaction(async (tx) => {
    const lead = await tx.lead.findUnique({
      where: { id: leadId },
      select: {
        id: true,
        jobRequestId: true,
        providerId: true,
        status: true,
        notifiedAt: true,
        jobRequest: {
          select: {
            id: true,
            status: true,
            assignmentMode: true,
            customer: { select: { phone: true } },
          },
        },
      },
    })

    if (!lead || lead.jobRequestId !== requestId || lead.providerId !== providerId) {
      return { repaired: false as const, reason: 'lead_not_found_or_mismatch' }
    }

    if (!['SEND_PENDING', 'SENT', 'VIEWED', 'EXPIRED'].includes(lead.status)) {
      return { repaired: false as const, reason: 'lead_not_repairable', status: lead.status }
    }

    await tx.lead.update({
      where: { id: lead.id },
      data: {
        status: 'SEND_FAILED',
        expiresAt: null,
        expiredAt: null,
        respondedAt: null,
        viewedAt: null,
        notifiedAt: null,
        notificationAttemptedAt: null,
      },
    })

    const activeLeadCount = await tx.lead.count({
      where: {
        jobRequestId: requestId,
        id: { not: lead.id },
        status: { in: ['SEND_PENDING', 'SENT', 'VIEWED', 'INTERESTED', 'CUSTOMER_SELECTED', 'PROVIDER_ACCEPTED', 'CREDIT_REQUIRED', 'CREDIT_APPLIED', 'ACCEPTED_LOCKED', 'ACCEPTED'] },
      },
    })

    if (activeLeadCount === 0) {
      await tx.jobRequest.updateMany({
        where: {
          id: requestId,
          status: 'MATCHING',
          assignmentMode: 'OPS_REVIEW',
        },
        data: { status: 'PENDING_VALIDATION' },
      })
    }

    await tx.auditLog.create({
      data: {
        actorId: 'system',
        actorRole: 'system',
        action: 'review_first.provider_notification_failed',
        entityType: 'Lead',
        entityId: lead.id,
        before: {
          status: lead.status,
          notifiedAt: lead.notifiedAt?.toISOString() ?? null,
        },
        after: {
          status: 'SEND_FAILED',
          requestStatus: activeLeadCount === 0 ? 'PENDING_VALIDATION' : lead.jobRequest.status,
        },
        reason: params.failureReason ?? 'WhatsApp provider notification failed after API accept.',
      },
    })

    return {
      repaired: true as const,
      customerPhone: lead.jobRequest.customer?.phone ?? null,
      activeLeadCount,
    }
  })

  console.warn('[review-first.provider-notification] failed_repaired', {
    requestId,
    leadId,
    providerId,
    result: repair.repaired ? 'repaired' : 'skipped',
    reason: repair.repaired ? null : repair.reason,
    failureReason: params.failureReason ?? null,
  })

  if (repair.repaired && repair.customerPhone) {
    const alreadySent = await hasSuccessfulMessageForRecipient({
      to: repair.customerPhone,
      templateName: REVIEW_FIRST_PROVIDER_NOTIFICATION_FAILED_TEMPLATE,
      metadataPath: ['leadId'],
      metadataEquals: leadId,
    }).catch(() => false)

    if (!alreadySent) {
      const url = await getJobRequestAccessUrl(requestId, 'matching_status').catch(() => null)
      if (url?.startsWith('https://')) {
        await sendCtaUrl(
          repair.customerPhone,
          `We couldn't complete the WhatsApp notification to your selected provider.\n\nYour request is still saved. Open your provider review to retry sending the request or choose another provider.`,
          ctaLabelFor('view_request'),
          url,
          undefined,
          {
            templateName: REVIEW_FIRST_PROVIDER_NOTIFICATION_FAILED_TEMPLATE,
            metadata: {
              requestId,
              leadId,
              providerId,
              idempotencyKey: `${REVIEW_FIRST_PROVIDER_NOTIFICATION_FAILED_TEMPLATE}:${leadId}`,
            },
          },
        ).catch((error) => {
          console.warn('[review-first.provider-notification] customer_failure_notice_failed', {
            requestId,
            leadId,
            providerId,
            error: error instanceof Error ? error.message : String(error),
          })
        })
      }
    }
  }

  return repair.repaired
    ? { handled: true as const, result: 'failed_repaired' }
    : { handled: true as const, result: 'failed_skipped', reason: repair.reason }
}

export async function notifyCustomerRfpResponseSummary(requestId: string) {
  const request = await db.jobRequest.findUnique({
    where: { id: requestId },
    select: {
      id: true,
      status: true,
      customer: { select: { phone: true } },
      leads: {
        where: {
          status: { in: ['SENT', 'VIEWED', 'INTERESTED', 'DECLINED', 'EXPIRED', 'CUSTOMER_SELECTED', 'PROVIDER_ACCEPTED', 'CREDIT_REQUIRED', 'CREDIT_APPLIED', 'ACCEPTED_LOCKED', 'ACCEPTED'] },
        },
        select: {
          id: true,
          status: true,
          provider: { select: { name: true } },
          providerResponses: {
            where: { response: 'INTERESTED' },
            orderBy: { createdAt: 'desc' },
            take: 1,
            select: {
              callOutFee: true,
              estimatedArrivalAt: true,
              providerNote: true,
            },
          },
        },
      },
    },
  })
  if (!request?.customer?.phone) return
  // Don't send a summary if the customer has already progressed past the selection step —
  // it would confuse them to receive "X providers responded" after they've already chosen.
  if (['PROVIDER_CONFIRMATION_PENDING', 'MATCHED', 'CANCELLED', 'EXPIRED'].includes(request.status)) return

  // Dedup: if a summary was sent to this customer in the last 30 seconds, skip.
  // Prevents burst messages when multiple providers tap "I'm Available" simultaneously.
  const recentlySummarized = await hasSuccessfulMessageForRecipient({
    to: request.customer.phone,
    templateName: 'interactive:rfp_response_summary',
    metadataPath: ['requestId'],
    metadataEquals: requestId,
    since: new Date(Date.now() - 30_000),
  }).catch(() => false)
  if (recentlySummarized) return

  const total = request.leads.length
  if (total === 0) {
    console.warn('[review-first] notifyCustomerRfpResponseSummary: no active leads found', { requestId })
    return
  }
  const available = request.leads.filter((lead) => lead.providerResponses.length > 0)
  const declined = request.leads.filter((lead) => lead.status === 'DECLINED')
  const respondedIds = new Set([...available.map((l) => l.id), ...declined.map((l) => l.id)])
  const responded = respondedIds.size
  const pending = request.leads.filter(
    (lead) => (lead.status === 'SENT' || lead.status === 'VIEWED') && lead.providerResponses.length === 0,
  )

  if (available.length === 0 && pending.length === 0) {
    await sendText(
      request.customer.phone,
      `None of the selected providers responded in time.\n\nYou can show more providers, try Quick Match, edit the request, or cancel.`,
      {
        templateName: 'interactive:rfp_none_responded',
        metadata: { requestId: request.id, total },
      },
    ).catch(() => undefined)
    return
  }

  let body = `${responded} of ${total} selected provider${total === 1 ? '' : 's'} responded.\n\n`
  if (available.length > 0) {
    body += `Please review their responses and choose who you prefer.\n\n`
    body += available
      .slice(0, 3)
      .map((lead, idx) => {
        const response = lead.providerResponses[0]
        const fee = response?.callOutFee != null ? `R${Number(response.callOutFee).toFixed(0)}` : 'Not provided'
        const eta = response?.estimatedArrivalAt
          ? response.estimatedArrivalAt.toLocaleString('en-ZA', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
          : 'Not provided'
        return `${idx + 1}. ${lead.provider.name}\nCall-out fee: ${fee}\nEstimated arrival: ${eta}${response?.providerNote ? `\nNote: ${response.providerNote}` : ''}`
      })
      .join('\n\n')
  } else {
    body += `You can wait for more responses or show more providers.`
  }

  await sendText(
    request.customer.phone,
    body,
    {
      templateName: 'interactive:rfp_response_summary',
      metadata: { requestId: request.id, responded, total, available: available.length },
    },
  ).catch(() => undefined)

  if (available.length > 0) {
    const url = await getJobRequestAccessUrl(requestId, 'shortlist').catch(() => null)
    if (url?.startsWith('https://')) {
      await sendCtaUrl(
        request.customer.phone,
        'Tap to review and select your provider.',
        ctaLabelFor('view_request'),
        url,
        undefined,
        {
          templateName: 'interactive:rfp_response_summary_cta',
          metadata: { requestId: request.id, responded, total },
        },
      ).catch(() => undefined)
    }
  }
}

export async function expireRfpInvitations() {
  const now = new Date()
  const expired = await db.lead.findMany({
    where: {
      assignmentHoldId: null,
      status: { in: ['SENT', 'VIEWED'] },
      respondedAt: null,
      notifiedAt: { not: null },
      expiresAt: { lte: now },
      jobRequest: {
        status: 'MATCHING',
        assignmentMode: 'OPS_REVIEW',
      },
    },
    select: {
      id: true,
      jobRequestId: true,
      providerId: true,
    },
    take: 100,
  })

  if (expired.length === 0) return { expiredCount: 0 }

  await db.lead.updateMany({
    where: { id: { in: expired.map((lead) => lead.id) } },
    data: {
      status: 'EXPIRED',
      expiredAt: now,
    },
  })

  const requestIds = Array.from(new Set(expired.map((lead) => lead.jobRequestId)))
  for (const requestId of requestIds) {
    await notifyCustomerRfpResponseSummary(requestId).catch(() => undefined)
  }

  // Retry notification for CUSTOMER_SELECTED leads where the initial send failed
  const stuckSelected = await db.lead.findMany({
    where: {
      assignmentHoldId: null,
      status: 'CUSTOMER_SELECTED',
      notifiedAt: null,
      customerSelectedAt: { lte: new Date(now.getTime() - 5 * 60 * 1000) },
      jobRequest: { status: 'PROVIDER_CONFIRMATION_PENDING' },
    },
    select: { id: true, jobRequestId: true, providerId: true },
    take: 20,
  })

  for (const lead of stuckSelected) {
    const { notifySelectedProvider } = await import('./customer-shortlists')
    await notifySelectedProvider({ leadId: lead.id }).catch((err) => {
      console.warn('[expireRfpInvitations] stuck_customer_selected_retry_failed', {
        leadId: lead.id,
        error: err instanceof Error ? err.message : String(err),
      })
    })
  }

  return { expiredCount: expired.length }
}
