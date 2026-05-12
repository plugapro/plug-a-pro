import { db } from './db'
import type { LeadStatus } from '@prisma/client'
import { rankCandidatesForJobRequest } from './matching/service'
import { getReviewProviderProfileUrl } from './review-provider-profile-access'
import { sendButtons, sendCtaUrl, sendText } from './whatsapp-interactive'
import { ctaLabelFor } from './whatsapp-copy'
import { buildProviderLeadActionsMessage, buildProviderLeadPreviewMessage } from './provider-credit-copy'
import { getProviderLeadAccessUrl } from './provider-lead-access'
import { getProviderWalletBalanceReadOnly } from './provider-wallet'

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
      .filter((lead) => lead.status === 'SHORTLISTED' || lead.status === 'SENT' || lead.status === 'VIEWED' || lead.status === 'INTERESTED')
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

  const shortlistLeadStatuses: LeadStatus[] = ['SHORTLISTED', 'SENT', 'VIEWED', 'INTERESTED', 'CUSTOMER_SELECTED', 'PROVIDER_ACCEPTED', 'CREDIT_REQUIRED', 'CREDIT_APPLIED']
  const shortlistCount = await db.lead.count({
    where: {
      jobRequestId: request.id,
      status: { in: shortlistLeadStatuses },
    },
  })

  const existingLead = await db.lead.findUnique({
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

  const lead = await db.lead.upsert({
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
      status: existingLead?.status === 'SHORTLISTED' || existingLead?.status === 'SENT' || existingLead?.status === 'VIEWED' || existingLead?.status === 'INTERESTED'
        ? existingLead.status
        : 'SHORTLISTED',
      dispatchDecisionId: request.latestDispatchDecisionId,
      matchAttemptId: rankedCandidate.id,
      matchScore: rankedCandidate.score ?? null,
      rankingPosition: rankedCandidate.rankedPosition ?? null,
      expiresAt: null,
    },
  })

  let shortlist = await db.providerShortlist.findFirst({
    where: { requestId: request.id, status: 'DRAFT' },
    select: { id: true },
  })
  if (!shortlist) {
    shortlist = await db.providerShortlist.create({
      data: { requestId: request.id, status: 'DRAFT' },
      select: { id: true },
    })
  }

  await db.providerShortlistItem.upsert({
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
        in: ['SHORTLISTED', 'SENT', 'VIEWED', 'INTERESTED', 'CUSTOMER_SELECTED', 'PROVIDER_ACCEPTED', 'CREDIT_REQUIRED', 'CREDIT_APPLIED', 'ACCEPTED_LOCKED', 'ACCEPTED'],
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
          status: { in: ['SHORTLISTED', 'SENT', 'VIEWED', 'INTERESTED'] },
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
  const alreadySent = request.leads.filter((lead) => lead.status === 'SENT' || lead.status === 'VIEWED' || lead.status === 'INTERESTED')
  const activeTargets = shortlisted.length > 0 ? shortlisted : alreadySent

  if (activeTargets.length < MIN_SHORTLISTED_PROVIDERS) {
    throw new ReviewFirstError('SHORTLIST_EMPTY', `Please shortlist at least ${MIN_SHORTLISTED_PROVIDERS} provider first.`)
  }
  if (activeTargets.length > MAX_SHORTLISTED_PROVIDERS) {
    throw new ReviewFirstError('SHORTLIST_LIMIT_REACHED', `You can shortlist up to ${MAX_SHORTLISTED_PROVIDERS} providers.`)
  }

  const expiresAt = new Date(Date.now() + RFP_PROVIDER_RESPONSE_MINUTES * 60_000)
  const deadlineTime = expiresAt.toLocaleTimeString('en-ZA', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Africa/Johannesburg',
  })
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

  await db.jobRequest.update({
    where: { id: request.id },
    data: {
      status: 'MATCHING',
      assignmentMode: 'OPS_REVIEW',
    },
  })

  for (const lead of activeTargets) {
    await db.lead.update({
      where: { id: lead.id },
      data: {
        status: 'SENT',
        sentAt: new Date(),
        expiresAt,
        respondedAt: null,
        viewedAt: null,
      },
    })

    const balance = await getProviderWalletBalanceReadOnly(lead.provider.id).catch(() => ({
      totalCreditBalance: 0,
      paidCreditBalance: 0,
      promoCreditBalance: 0,
    }))
    const body = buildProviderLeadPreviewMessage({
      category: request.category,
      area: area || 'your area',
      city: request.address?.city ?? null,
      province: request.address?.province ?? null,
      preferredTime,
      deadlineTime,
      responseWindowMinutes: RFP_PROVIDER_RESPONSE_MINUTES,
      balance,
      title: request.title,
      description: request.description,
      subcategory: request.subcategory,
      urgency: request.urgency,
      matchingPreference: request.providerPreference ?? request.budgetPreference,
    })
    const actionsBody = buildProviderLeadActionsMessage({
      category: request.category,
      area: area || 'your area',
      balance,
    })

    await sendText(
      lead.provider.phone,
      `You've been selected to respond to a customer request.\n\nRef: ${request.requestRef ?? request.id.slice(-8).toUpperCase()}`,
      {
        templateName: 'interactive:rfp_provider_selected',
        metadata: { requestId: request.id, leadId: lead.id },
      },
    ).catch(() => undefined)

    const leadUrl = await getProviderLeadAccessUrl({
      leadId: lead.id,
      providerId: lead.provider.id,
    })

    if (leadUrl) {
      await sendCtaUrl(
        lead.provider.phone,
        body,
        ctaLabelFor('generic_details'),
        leadUrl,
        undefined,
        {
          templateName: 'interactive:rfp_provider_preview_cta',
          metadata: { requestId: request.id, leadId: lead.id, providerId: lead.provider.id },
        },
      ).catch(() => undefined)
    }

    await sendButtons(
      lead.provider.phone,
      actionsBody,
      [
        { id: `interested:${lead.id}`, title: "I'm available" },
        { id: `not_interested:${lead.id}`, title: 'Not available' },
      ],
      undefined,
      {
        templateName: 'interactive:rfp_provider_response_buttons',
        metadata: { requestId: request.id, leadId: lead.id, providerId: lead.provider.id },
      },
    ).catch(() => undefined)
  }

  if (request.customer?.phone) {
    await sendText(
      request.customer.phone,
      `Your request has been sent to ${activeTargets.length} selected provider${activeTargets.length === 1 ? '' : 's'}.\n\nThey have ${RFP_PROVIDER_RESPONSE_MINUTES} minutes to respond. We'll update you as responses come in.`,
      {
        templateName: 'interactive:rfp_sent_to_shortlist',
        metadata: { requestId: request.id, count: activeTargets.length },
      },
    ).catch(() => undefined)
  }

  return {
    requestId: request.id,
    invitedCount: activeTargets.length,
    expiresAt,
  }
}

export async function notifyCustomerRfpResponseSummary(requestId: string) {
  const request = await db.jobRequest.findUnique({
    where: { id: requestId },
    select: {
      id: true,
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
}

export async function expireRfpInvitations() {
  const now = new Date()
  const expired = await db.lead.findMany({
    where: {
      assignmentHoldId: null,
      status: { in: ['SENT', 'VIEWED'] },
      respondedAt: null,
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

  return { expiredCount: expired.length }
}
