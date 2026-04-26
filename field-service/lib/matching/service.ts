import type {
  AssignmentHoldStatus,
  AssignmentMode,
  BookingStatus,
  DispatchDecisionStatus,
  JobStatus,
  MatchAttemptStage,
  Prisma,
} from '@prisma/client'
import { db } from '../db'
import { MATCHING_CONFIG, type MatchingWeights } from './config'
import { buildWorkingWindow, deriveRequestWindow, evaluateScheduleFit, normalizeCommitments } from './scheduling'
import { resolveCategoryRequirements } from '../category-config'
import { isLocationStale, pointFallsWithinRadius } from './geography'
import { createBookingArtifactsForApprovedQuote } from '../quotes'
import { initializeBookingPayment } from '../payments'
import { emitMatchEvent } from './events'
import { notifyExpiredJobParties } from './customer-recontact'
import { releaseProviderCapacity } from './reservation'
import type {
  CoverageTier,
  DispatchActor,
  DispatchHistoryResult,
  DispatchRunResult,
  MatchingAddress,
  MatchingJobRequest,
  MatchingProvider,
  OfferResolutionResult,
  RankedCandidate,
  RankingResult,
  ScoreBreakdown,
} from './types'

type ResolvedCategoryRequirements = Awaited<ReturnType<typeof resolveCategoryRequirements>>

function normalizeTag(tag: string) {
  return tag.trim().toLowerCase()
}

function isSchemaCompatError(error: unknown) {
  if (!error || typeof error !== 'object') return false
  const code = 'code' in error ? (error as { code?: string }).code : undefined
  return code === 'P2021' || code === 'P2022'
}

async function safeOptionalQuery<T>(factory: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await factory()
  } catch (error) {
    if (isSchemaCompatError(error)) {
      return fallback
    }
    throw error
  }
}

async function safeOptionalMutation<T>(factory: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await factory()
  } catch (error) {
    if (isSchemaCompatError(error)) {
      return fallback
    }
    throw error
  }
}

function buildMatchingJobRequest(record: {
  id: string
  customerId: string
  category: string
  title: string
  description: string
  requestedWindowStart: Date | null
  requestedWindowEnd: Date | null
  requestedArrivalLatest: Date | null
  estimatedDurationMinutes: number | null
  requiredSkillTags: string[]
  requiredCertificationCodes: string[]
  requiredEquipmentTags: string[]
  requiredVehicleTypes: string[]
  preferredProviderId: string | null
  assignmentMode: AssignmentMode
  customerAcceptedAmount: Prisma.Decimal | null
  customerAcceptedScope: string | null
  autoCreateBookingOnAssignment: boolean
  status: MatchingJobRequest['status']
  expiresAt?: Date | null
  customer?: { id: string; name: string; phone: string } | null
  address?: {
    street: string
    suburb: string
    city: string
    province: string
    lat: number | null
    lng: number | null
    locationNodeId: string | null
    locationNode: { regionKey: string | null; provinceKey: string | null } | null
  } | null
}) {
  return {
    id: record.id,
    customerId: record.customerId,
    category: record.category,
    title: record.title,
    description: record.description,
    requestedWindowStart: record.requestedWindowStart,
    requestedWindowEnd: record.requestedWindowEnd,
    requestedArrivalLatest: record.requestedArrivalLatest,
    estimatedDurationMinutes: record.estimatedDurationMinutes,
    requiredSkillTags: record.requiredSkillTags,
    requiredCertificationCodes: record.requiredCertificationCodes,
    preferredProviderId: record.preferredProviderId,
    assignmentMode: record.assignmentMode,
    requiredEquipmentTags: record.requiredEquipmentTags,
    requiredVehicleTypes: record.requiredVehicleTypes,
    customerAcceptedAmount: record.customerAcceptedAmount,
    customerAcceptedScope: record.customerAcceptedScope,
    autoCreateBookingOnAssignment: record.autoCreateBookingOnAssignment,
    status: record.status,
    expiresAt: record.expiresAt ?? null,
    customer: record.customer ?? { id: record.customerId, name: 'Customer', phone: '' },
    address: record.address
      ? {
          street: record.address.street,
          suburb: record.address.suburb,
          city: record.address.city,
          province: record.address.province,
          lat: record.address.lat,
          lng: record.address.lng,
          locationNodeId: record.address.locationNodeId ?? null,
          regionKey: record.address.locationNode?.regionKey ?? null,
          provinceKey: record.address.locationNode?.provinceKey ?? null,
        }
      : null,
  }
}

export async function loadMatchingJobRequest(client: any, jobRequestId: string) {
  const query = {
    where: { id: jobRequestId },
    select: {
      id: true,
      customerId: true,
      category: true,
      title: true,
      description: true,
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
      status: true,
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
            select: { regionKey: true, provinceKey: true },
          },
        },
      },
    },
  }

  const record =
    (await client.jobRequest.findUnique?.(query)) ??
    (await client.jobRequest.findUniqueOrThrow?.(query))

  if (!record) {
    throw new Error('JOB_REQUEST_NOT_FOUND')
  }

  return buildMatchingJobRequest(record)
}

async function releaseAssignmentHoldScheduleItems(
  client: any,
  where: Record<string, unknown>,
) {
  await safeOptionalMutation(
    () =>
      client.technicianScheduleItem.updateMany({
        where,
        data: {
          status: 'RELEASED',
          updatedAt: new Date(),
        },
      }),
    { count: 0 },
  )
}

async function createAssignmentHoldScheduleItem(
  client: any,
  data: Record<string, unknown>,
) {
  await safeOptionalMutation(
    () => client.technicianScheduleItem.create({ data }),
    null,
  )
}

async function loadProviderOfferContact(client: any, providerId: string) {
  return client.provider.findUniqueOrThrow({
    where: { id: providerId },
    select: {
      id: true,
      phone: true,
      name: true,
    },
  })
}

function getReliabilityScore(provider: MatchingProvider) {
  if (provider.completedJobsCount === 0) {
    return provider.reliabilityScore || 0.5
  }

  return Math.min(
    1,
    Math.max(
      0,
      provider.reliabilityScore * 0.3 +
        provider.onTimeRate * 0.2 +
        provider.punctualityScore * 0.2 +
        (1 - provider.cancellationRate) * 0.1 +
        (1 - provider.complaintRate) * 0.1 +
        provider.acceptanceRate * 0.05 +
        Math.min(provider.averageRating / 5, 1) * 0.05,
    ),
  )
}

function buildDispatchIdempotencyKey(params: {
  jobRequest: MatchingJobRequest
  mode: AssignmentMode
}) {
  return JSON.stringify({
    jobRequestId: params.jobRequest.id,
    category: normalizeTag(params.jobRequest.category),
    mode: params.mode,
    requestedWindowStart: params.jobRequest.requestedWindowStart?.toISOString() ?? null,
    requestedWindowEnd: params.jobRequest.requestedWindowEnd?.toISOString() ?? null,
    requestedArrivalLatest: params.jobRequest.requestedArrivalLatest?.toISOString() ?? null,
    estimatedDurationMinutes: params.jobRequest.estimatedDurationMinutes ?? null,
    requiredSkillTags: [...params.jobRequest.requiredSkillTags].sort(),
    requiredCertificationCodes: [...params.jobRequest.requiredCertificationCodes].sort(),
    requiredEquipmentTags: [...params.jobRequest.requiredEquipmentTags].sort(),
    requiredVehicleTypes: [...params.jobRequest.requiredVehicleTypes].sort(),
    preferredProviderId: params.jobRequest.preferredProviderId ?? null,
    autoCreateBookingOnAssignment: params.jobRequest.autoCreateBookingOnAssignment,
    customerAcceptedAmount: params.jobRequest.customerAcceptedAmount?.toString() ?? null,
  })
}

function hasRequiredSkills(jobRequest: MatchingJobRequest, provider: MatchingProvider) {
  const requiredSkills = new Set(
    (jobRequest.requiredSkillTags.length > 0
      ? jobRequest.requiredSkillTags
      : [jobRequest.category]
    ).map(normalizeTag),
  )

  const providerSkills = new Set(
    [
      ...provider.skills,
      ...provider.technicianSkills.map((skill) => skill.skillTag),
    ].map(normalizeTag),
  )

  return [...requiredSkills].every((skill) => providerSkills.has(skill))
}

function getMissingRequiredCertifications(
  requirements: ResolvedCategoryRequirements,
  provider: MatchingProvider,
) {
  if (requirements.requiredCertificationCodes.length === 0) return []

  // Legacy TechnicianCertification records (original model)
  const activeLegacyCerts = new Set(
    provider.technicianCertifications
      .filter((cert) => cert.status !== 'EXPIRED')
      .map((cert) => normalizeTag(cert.certificationCode)),
  )

  // WS-B.1 ProviderCertification records — verified (verifiedAt set) certs by name
  const adminVerifiedCerts = new Set(
    (provider.adminCertifications ?? [])
      .filter((cert) => cert.verifiedAt != null)
      .map((cert) => normalizeTag(cert.name)),
  )

  return requirements.requiredCertificationCodes
    .map(normalizeTag)
    .filter((code) => !activeLegacyCerts.has(code) && !adminVerifiedCerts.has(code))
}

function getMissingRequiredEquipmentTags(
  requirements: ResolvedCategoryRequirements,
  provider: MatchingProvider,
) {
  if (requirements.requiredEquipmentTags.length === 0) return []

  // Legacy equipmentTags string array (original model)
  const legacyEquipment = new Set(provider.equipmentTags.map(normalizeTag))

  // WS-B.1 ProviderEquipment records — active equipment by label and category
  const adminEquipment = new Set([
    ...(provider.equipment ?? [])
      .filter((eq) => eq.active)
      .flatMap((eq) => [
        normalizeTag(eq.label),
        ...(eq.category ? [normalizeTag(eq.category)] : []),
      ]),
  ])

  return requirements.requiredEquipmentTags
    .map(normalizeTag)
    .filter((tag) => !legacyEquipment.has(tag) && !adminEquipment.has(tag))
}

function hasRequiredVehicleTypes(
  requirements: ResolvedCategoryRequirements,
  provider: MatchingProvider,
) {
  if (requirements.requiredVehicleTypes.length === 0) return true

  const providerVehicles = new Set(provider.vehicleTypes.map(normalizeTag))
  return requirements.requiredVehicleTypes
    .map(normalizeTag)
    .some((vehicleType) => providerVehicles.has(vehicleType))
}

function providerCoversAddress(
  provider: MatchingProvider,
  address: MatchingAddress,
): { covers: boolean; tier: CoverageTier } {
  const activeAreas = provider.technicianServiceAreas.filter((a) => a.active)

  // Tier 1 — RADIUS: haversine check (unchanged from existing logic)
  if (address.lat != null && address.lng != null) {
    const radiusAreas = activeAreas.filter(
      (area) =>
        area.areaType === 'RADIUS' &&
        area.lat != null &&
        area.lng != null &&
        area.radiusKm != null &&
        pointFallsWithinRadius({
          center: { lat: area.lat!, lng: area.lng! },
          point: { lat: address.lat!, lng: address.lng! },
          radiusKm: area.radiusKm!,
        }),
    )
    if (radiusAreas.length > 0) return { covers: true, tier: 'RADIUS' }
  }

  // Tier 2 — structured path (only when address has a locationNodeId)
  if (address.locationNodeId != null) {
    // Tier 2a — SUBURB_EXACT: provider has a row with matching locationNodeId
    const exactMatch = activeAreas.some(
      (area) => area.locationNodeId === address.locationNodeId,
    )
    if (exactMatch) return { covers: true, tier: 'SUBURB_EXACT' }

    // Tier 2b — REGION_FALLBACK: provider covers the same region
    if (address.regionKey != null) {
      const regionMatch = activeAreas.some(
        (area) => area.regionKey === address.regionKey,
      )
      if (regionMatch) return { covers: true, tier: 'REGION_FALLBACK' }
    }

    // Structured address but no match found — do NOT fall through to string matching
    return { covers: false, tier: 'NO_MATCH' }
  }

  // Tier 3 — LEGACY_STRING: fallback for providers/addresses without structured areas
  // Only active during migration window (controlled by config flag)
  if (!MATCHING_CONFIG.allowLegacyStringFallback) {
    return { covers: false, tier: 'NO_MATCH' }
  }

  const addressTerms = [address.suburb, address.city]
    .map((value) => normalizeTag(value ?? ''))
    .filter(Boolean)

  const providerAreaTerms = [
    ...provider.serviceAreas,
    ...activeAreas.map((a) => a.label),
    ...activeAreas.map((a) => a.city).filter(Boolean),
  ].map((v) => normalizeTag(v ?? '')).filter(Boolean)

  const hasStringMatch = addressTerms.some((term) => providerAreaTerms.includes(term))
  if (hasStringMatch) return { covers: true, tier: 'LEGACY_STRING' }

  return { covers: false, tier: 'NO_MATCH' }
}

function buildScoreBreakdown(params: {
  jobRequest: MatchingJobRequest
  provider: MatchingProvider
  scheduleFitScore: number
  travelMinutes: number
  canMeetWindow: boolean
  coverageTier: CoverageTier  // NEW
  categoryPolicy: ResolvedCategoryRequirements['policy']
  weights?: MatchingWeights
}) {
  const weights = params.weights ?? MATCHING_CONFIG.weights
  const skillMatch = hasRequiredSkills(params.jobRequest, params.provider) ? 1 : 0
  const scheduleFit = params.scheduleFitScore
  const travelEfficiency = Math.max(
    0,
    1 - params.travelMinutes / Math.max(params.provider.maxTravelMinutes, 1),
  )
  const reliability = getReliabilityScore(params.provider)
  const customerPreference =
    params.jobRequest.preferredProviderId === params.provider.id ? 1 : 0
  const marginEfficiency = Math.max(
    0,
    Math.min(1, (params.provider.maxTravelMinutes - params.travelMinutes) / Math.max(params.provider.maxTravelMinutes, 1)),
  )

  const geographicPenalty =
    params.coverageTier === 'REGION_FALLBACK' ? MATCHING_CONFIG.regionFallbackPenalty : 0

  const total =
    (skillMatch * weights.skillMatch +
      scheduleFit * weights.scheduleFit +
      travelEfficiency * weights.travelEfficiency +
      reliability * weights.reliability +
      customerPreference * weights.customerPreference +
      marginEfficiency * weights.marginEfficiency)
    - geographicPenalty

  const reasons = [
    skillMatch === 1 ? 'Required skills matched' : 'Missing required skill coverage',
    params.canMeetWindow ? 'Can meet requested arrival window' : 'Window fit is weaker',
    `Estimated travel ${params.travelMinutes} minutes`,
    `Reliability score ${reliability.toFixed(2)}`,
  ]

  if (params.categoryPolicy.regulated) {
    reasons.push('Regulated service requirements checked')
  }

  if (!isLocationStale(params.provider.lastKnownLocationAt)) {
    reasons.push('Recent technician location available')
  }

  if (customerPreference > 0) {
    reasons.push('Preferred or repeat technician')
  }

  if (params.coverageTier === 'REGION_FALLBACK') {
    reasons.push('Matched on region — provider may not cover this exact suburb')
  }
  if (params.coverageTier === 'LEGACY_STRING') {
    reasons.push('Service area matched by name (legacy — structured areas not yet configured)')
  }

  reasons.push(
    params.provider.verified
      ? 'Marketplace-reviewed profile'
      : 'Profile pending marketplace review',
  )

  return {
    skillMatch,
    scheduleFit,
    travelEfficiency,
    reliability,
    customerPreference,
    marginEfficiency,
    geographicPenalty,
    workloadFairness: 1,
    total,
    reasons,
  } satisfies ScoreBreakdown
}

async function loadMatchingContext(jobRequestId: string) {
  const jobRequest = await loadMatchingJobRequest(db, jobRequestId)

  if (!jobRequest.address) {
    throw new Error('JOB_REQUEST_NOT_FOUND')
  }

  const baseProviders = await db.provider.findMany({
    where: { active: true },
    select: {
      id: true,
      name: true,
      phone: true,
      active: true,
      availableNow: true,
      verified: true,
      skills: true,
      serviceAreas: true,
    },
  })

  const providerIds = baseProviders.map((provider) => provider.id)
  type ScheduleRow = {
    providerId: string
    dayOfWeek: number
    startTime: string
    endTime: string
    active: boolean
  }
  type SkillRow = {
    providerId: string
    skillTag: string
  }
  type CertificationRow = {
    providerId: string
    certificationCode: string
    status: string
  }
  type ServiceAreaRow = {
    providerId: string
    label: string
    city: string | null
    active: boolean
    areaType: string
    lat: number | null
    lng: number | null
    radiusKm: number | null
    locationNodeId: string | null
    regionKey: string | null
  }
  type AvailabilityRow = {
    providerId: string
    availabilityState: string
    nextAvailableAt: Date | null
    breakUntil: Date | null
  }
  type ScheduleItemRow = {
    providerId: string
    id: string
    itemType: string
    title: string | null
    startAt: Date
    endAt: Date
    bufferBeforeMinutes: number
    bufferAfterMinutes: number
    locationLabel: string | null
    lat: number | null
    lng: number | null
    status: string
  }
  type MatchRow = {
    providerId: string
  }
  type ActiveJobRow = {
    providerId: string
    booking: {
      id: string
      scheduledDate: Date
      scheduledWindow: string | null
      status: string
    } | null
  }
  const activeStatuses: JobStatus[] = [
    'SCHEDULED',
    'EN_ROUTE',
    'ARRIVED',
    'STARTED',
    'PAUSED',
    'AWAITING_APPROVAL',
    'PENDING_COMPLETION_CONFIRMATION',
  ]

  const [scheduleRows, skillRows, certificationRows, areaRows, availabilityRows, scheduleItems, matchRows, activeJobs] =
    await Promise.all([
      safeOptionalQuery(
        () =>
          (db as any).providerSchedule?.findMany?.({
            where: { providerId: { in: providerIds }, active: true },
            select: { providerId: true, dayOfWeek: true, startTime: true, endTime: true, active: true },
          }) ?? Promise.resolve([]),
        [] as ScheduleRow[],
      ),
      safeOptionalQuery(
        () =>
          (db as any).technicianSkill?.findMany?.({
            where: { providerId: { in: providerIds } },
            select: { providerId: true, skillTag: true },
          }) ?? Promise.resolve([]),
        [] as SkillRow[],
      ),
      safeOptionalQuery(
        () =>
          (db as any).technicianCertification?.findMany?.({
            where: { providerId: { in: providerIds } },
            select: { providerId: true, certificationCode: true, status: true },
          }) ?? Promise.resolve([]),
        [] as CertificationRow[],
      ),
      safeOptionalQuery(
        () =>
          (db as any).technicianServiceArea?.findMany?.({
            where: { providerId: { in: providerIds } },
            select: {
              providerId: true,
              label: true,
              city: true,
              active: true,
              areaType: true,
              lat: true,
              lng: true,
              radiusKm: true,
              locationNodeId: true,
              regionKey: true,
            },
          }) ?? Promise.resolve([]),
        [] as ServiceAreaRow[],
      ),
      safeOptionalQuery(
        () =>
          (db as any).technicianAvailability?.findMany?.({
            where: { providerId: { in: providerIds } },
            select: { providerId: true, availabilityState: true, nextAvailableAt: true, breakUntil: true },
          }) ?? Promise.resolve([]),
        [] as AvailabilityRow[],
      ),
      safeOptionalQuery(
        () =>
          (db as any).technicianScheduleItem?.findMany?.({
            where: {
              providerId: { in: providerIds },
              status: 'ACTIVE',
            },
            select: {
              providerId: true,
              id: true,
              itemType: true,
              title: true,
              startAt: true,
              endAt: true,
              bufferBeforeMinutes: true,
              bufferAfterMinutes: true,
              locationLabel: true,
              lat: true,
              lng: true,
              status: true,
            },
          }) ?? Promise.resolve([]),
        [] as ScheduleItemRow[],
      ),
      safeOptionalQuery(
        () =>
          db.match.findMany?.({
            where: {
              providerId: { in: providerIds },
              jobRequest: { customerId: jobRequest.customerId },
            },
            select: { providerId: true },
          }) ?? Promise.resolve([]),
        [] as MatchRow[],
      ),
      safeOptionalQuery(
        () =>
          db.job.findMany?.({
            where: {
              providerId: { in: providerIds },
              status: { in: activeStatuses },
            },
            select: {
              providerId: true,
              booking: {
                select: {
                  id: true,
                  scheduledDate: true,
                  scheduledWindow: true,
                  status: true,
                },
              },
            },
          }) ?? Promise.resolve([]),
        [] as ActiveJobRow[],
      ),
    ])

  const schedulesByProvider = new Map<string, typeof scheduleRows>()
  for (const row of scheduleRows) {
    const list = schedulesByProvider.get(row.providerId) ?? []
    list.push(row)
    schedulesByProvider.set(row.providerId, list)
  }

  const skillsByProvider = new Map<string, typeof skillRows>()
  for (const row of skillRows) {
    const list = skillsByProvider.get(row.providerId) ?? []
    list.push(row)
    skillsByProvider.set(row.providerId, list)
  }

  const certsByProvider = new Map<string, typeof certificationRows>()
  for (const row of certificationRows) {
    const list = certsByProvider.get(row.providerId) ?? []
    list.push(row)
    certsByProvider.set(row.providerId, list)
  }

  const areasByProvider = new Map<string, typeof areaRows>()
  for (const row of areaRows) {
    const list = areasByProvider.get(row.providerId) ?? []
    list.push(row)
    areasByProvider.set(row.providerId, list)
  }

  const availabilityByProvider = new Map(
    availabilityRows.map((row: any) => [row.providerId, row]),
  )

  const scheduleItemsByProvider = new Map<string, typeof scheduleItems>()
  for (const row of scheduleItems) {
    const list = scheduleItemsByProvider.get(row.providerId) ?? []
    list.push(row)
    scheduleItemsByProvider.set(row.providerId, list)
  }

  const matchesByProvider = new Map<string, typeof matchRows>()
  for (const row of matchRows) {
    const list = matchesByProvider.get(row.providerId) ?? []
    list.push(row)
    matchesByProvider.set(row.providerId, list)
  }

  const jobsByProvider = new Map<string, typeof activeJobs>()
  for (const row of activeJobs) {
    const list = jobsByProvider.get(row.providerId) ?? []
    list.push(row)
    jobsByProvider.set(row.providerId, list)
  }

  // WS-B.1 ProviderCertification + ProviderEquipment batch fetch
  type AdminCertRow = { providerId: string; name: string; verifiedAt: Date | null }
  type AdminEquipRow = { providerId: string; label: string; category: string | null; active: boolean }

  const [adminCertRows, adminEquipRows] = await Promise.all([
    safeOptionalQuery(
      () =>
        (db as any).providerCertification?.findMany?.({
          where: { providerId: { in: providerIds } },
          select: { providerId: true, name: true, verifiedAt: true },
        }) ?? Promise.resolve([]),
      [] as AdminCertRow[],
    ),
    safeOptionalQuery(
      () =>
        (db as any).providerEquipment?.findMany?.({
          where: { providerId: { in: providerIds }, active: true },
          select: { providerId: true, label: true, category: true, active: true },
        }) ?? Promise.resolve([]),
      [] as AdminEquipRow[],
    ),
  ])

  const adminCertsByProvider = new Map<string, AdminCertRow[]>()
  for (const row of adminCertRows) {
    const list = adminCertsByProvider.get(row.providerId) ?? []
    list.push(row)
    adminCertsByProvider.set(row.providerId, list)
  }

  const adminEquipmentByProvider = new Map<string, AdminEquipRow[]>()
  for (const row of adminEquipRows) {
    const list = adminEquipmentByProvider.get(row.providerId) ?? []
    list.push(row)
    adminEquipmentByProvider.set(row.providerId, list)
  }

  const providers = baseProviders.map((provider) => {
    const hydratedProvider = provider as typeof provider & {
      averageRating?: number
      reliabilityScore?: number
      completedJobsCount?: number
      onTimeRate?: number
      acceptanceRate?: number
      complaintCount?: number
      complaintRate?: number
      providerCancellationCount?: number
      cancellationRate?: number
      lateArrivalCount?: number
      punctualityScore?: number
      maxTravelMinutes?: number
      lastKnownLat?: number | null
      lastKnownLng?: number | null
      lastKnownLocationLabel?: string | null
      lastKnownLocationAt?: Date | null
      equipmentTags?: string[]
      vehicleTypes?: string[]
      technicianSkills?: { skillTag: string }[]
      technicianCertifications?: { certificationCode: string; status: string }[]
      technicianServiceAreas?: {
        label: string
        city?: string | null
        active: boolean
        areaType?: string
        lat?: number | null
        lng?: number | null
        radiusKm?: number | null
        locationNodeId?: string | null
        regionKey?: string | null
      }[]
      technicianAvailability?: {
        availabilityState: string
        nextAvailableAt: Date | null
        breakUntil: Date | null
      } | null
      schedule?: { dayOfWeek: number; startTime: string; endTime: string; active: boolean }[]
      scheduleItems?: {
        id: string
        itemType: string
        title: string | null
        startAt: Date
        endAt: Date
        bufferBeforeMinutes: number
        bufferAfterMinutes: number
        locationLabel: string | null
        lat: number | null
        lng: number | null
        status: string
      }[]
      matches?: { providerId: string }[]
      jobs?: {
        booking: {
          id: string
          scheduledDate: Date
          scheduledStartAt?: Date | null
          scheduledEndAt?: Date | null
          scheduledWindow: string | null
          status: string
        } | null
      }[]
    }

    return {
      ...provider,
      averageRating: hydratedProvider.averageRating ?? 0,
      reliabilityScore: hydratedProvider.reliabilityScore ?? 0.5,
      completedJobsCount: hydratedProvider.completedJobsCount ?? 0,
      onTimeRate: hydratedProvider.onTimeRate ?? 1,
      acceptanceRate: hydratedProvider.acceptanceRate ?? 1,
      complaintCount: hydratedProvider.complaintCount ?? 0,
      complaintRate: hydratedProvider.complaintRate ?? 0,
      providerCancellationCount: hydratedProvider.providerCancellationCount ?? 0,
      cancellationRate: hydratedProvider.cancellationRate ?? 0,
      lateArrivalCount: hydratedProvider.lateArrivalCount ?? 0,
      punctualityScore: hydratedProvider.punctualityScore ?? 1,
      maxTravelMinutes: hydratedProvider.maxTravelMinutes ?? 90,
      lastKnownLat: hydratedProvider.lastKnownLat ?? null,
      lastKnownLng: hydratedProvider.lastKnownLng ?? null,
      lastKnownLocationLabel: hydratedProvider.lastKnownLocationLabel ?? null,
      lastKnownLocationAt: hydratedProvider.lastKnownLocationAt ?? null,
      equipmentTags: hydratedProvider.equipmentTags ?? [],
      vehicleTypes: hydratedProvider.vehicleTypes ?? [],
      technicianSkills: hydratedProvider.technicianSkills ?? skillsByProvider.get(provider.id) ?? [],
      technicianCertifications: hydratedProvider.technicianCertifications ?? certsByProvider.get(provider.id) ?? [],
      adminCertifications: adminCertsByProvider.get(provider.id) ?? [],
      equipment: adminEquipmentByProvider.get(provider.id) ?? [],
      technicianServiceAreas: hydratedProvider.technicianServiceAreas ?? areasByProvider.get(provider.id) ?? [],
      technicianAvailability: hydratedProvider.technicianAvailability ?? availabilityByProvider.get(provider.id) ?? null,
      schedule: schedulesByProvider.get(provider.id) ?? [],
      scheduleItems: hydratedProvider.scheduleItems ?? scheduleItemsByProvider.get(provider.id) ?? [],
      matches: hydratedProvider.matches ?? matchesByProvider.get(provider.id) ?? [],
      jobs: (hydratedProvider.jobs ?? jobsByProvider.get(provider.id) ?? []).map((job) => {
        const booking = job.booking as
          | {
              id: string
              scheduledDate: Date
              scheduledStartAt?: Date | null
              scheduledEndAt?: Date | null
              scheduledWindow: string | null
              status: string
            }
          | null

        return {
          booking: booking
            ? {
                ...booking,
                scheduledStartAt: booking.scheduledStartAt ?? null,
                scheduledEndAt: booking.scheduledEndAt ?? null,
              }
            : null,
        }
      }),
    }
  })

  return {
    jobRequest: jobRequest as MatchingJobRequest & {
      address: MatchingAddress
      customer: { id: string; name: string; phone: string }
    },
    providers: providers as unknown as (MatchingProvider & {
      schedule: { dayOfWeek: number; startTime: string; endTime: string; active: boolean }[]
      matches: { providerId: string }[]
      jobs: { booking: { id: string; scheduledDate: Date; scheduledStartAt: Date | null; scheduledEndAt: Date | null; scheduledWindow: string | null; status: string } | null }[]
    })[],
  }
}

export async function rankCandidatesForJobRequest(jobRequestId: string): Promise<RankingResult> {
  const { jobRequest, providers } = await loadMatchingContext(jobRequestId)
  const address = jobRequest.address
  const filteredOut: RankingResult['filteredOut'] = []
  const candidates: RankedCandidate[] = []
  const requestWindow = deriveRequestWindow(jobRequest)
  const categoryRequirements = await resolveCategoryRequirements({
    category: jobRequest.category,
    requiredCertificationCodes: jobRequest.requiredCertificationCodes,
    requiredEquipmentTags: jobRequest.requiredEquipmentTags,
    requiredVehicleTypes: jobRequest.requiredVehicleTypes,
  })

  for (const provider of providers) {
    const filteredReasonCodes: string[] = []

    if (!provider.active) filteredReasonCodes.push('TECHNICIAN_INACTIVE')
    if (!provider.availableNow) filteredReasonCodes.push('TECHNICIAN_NOT_AVAILABLE_NOW')
    if (provider.technicianAvailability?.availabilityState === 'OFFLINE') {
      filteredReasonCodes.push('TECHNICIAN_OFFLINE')
    }
    const areaCoverage = providerCoversAddress(provider, address)
    if (!areaCoverage.covers) {
      filteredReasonCodes.push('OUTSIDE_SERVICE_AREA')
    }
    if (!hasRequiredSkills(jobRequest, provider)) {
      filteredReasonCodes.push('MISSING_REQUIRED_SKILL')
    }
    const missingCertifications = getMissingRequiredCertifications(categoryRequirements, provider)
    filteredReasonCodes.push(
      ...missingCertifications.map((code) => `MISSING_REQUIRED_CERTIFICATION:${code}`),
    )

    const missingEquipmentTags = getMissingRequiredEquipmentTags(categoryRequirements, provider)
    filteredReasonCodes.push(
      ...missingEquipmentTags.map((tag) => `MISSING_REQUIRED_EQUIPMENT:${tag}`),
    )
    if (!hasRequiredVehicleTypes(categoryRequirements, provider)) {
      filteredReasonCodes.push('MISSING_REQUIRED_VEHICLE')
    }

    const scheduleRule =
      provider.schedule.find((rule) => rule.dayOfWeek === requestWindow.startAt.getDay()) ?? null

    const workingWindow = buildWorkingWindow({
      requestStartAt: requestWindow.startAt,
      schedule: scheduleRule,
    })

    const commitments = normalizeCommitments({
      bookings: provider.jobs
        .map((job) => job.booking)
        .filter((booking): booking is NonNullable<typeof booking> => Boolean(booking))
        .map((booking) => ({
          ...booking,
          status: booking.status as BookingStatus,
        })),
      scheduleItems: provider.scheduleItems,
    })

    const scheduleFit = evaluateScheduleFit({
      jobRequest,
      requestAddress: address,
      workingWindow,
      technicianAvailability: provider.technicianAvailability,
      commitments,
      technicianOrigin: {
        suburb: provider.technicianServiceAreas.find((area) => area.active)?.label ??
          provider.serviceAreas[0] ??
          null,
        city: provider.technicianServiceAreas.find((area) => area.city)?.city ?? address.city,
        lat: provider.lastKnownLat,
        lng: provider.lastKnownLng,
      },
      maxTravelMinutes: provider.maxTravelMinutes,
    })

    if (!scheduleFit.isAvailable) {
      filteredReasonCodes.push(
        scheduleFit.canMeetWindow ? 'SCHEDULE_CONFLICT' : 'WINDOW_NOT_FEASIBLE',
      )
    }

    if (filteredReasonCodes.length > 0) {
      filteredOut.push({
        providerId: provider.id,
        providerName: provider.name,
        filteredReasonCodes,
      })
      continue
    }

    const scoreBreakdown = buildScoreBreakdown({
      jobRequest,
      provider,
      scheduleFitScore: scheduleFit.score,
      travelMinutes: scheduleFit.travelMinutes,
      canMeetWindow: scheduleFit.canMeetWindow,
      coverageTier: areaCoverage.tier,
      categoryPolicy: categoryRequirements.policy,
    })

    candidates.push({
      providerId: provider.id,
      providerName: provider.name,
      score: scoreBreakdown.total,
      scoreBreakdown,
      filteredReasonCodes,
      feasibilityNotes: provider.verified
        ? scheduleFit.notes
        : [...scheduleFit.notes, 'Profile is still pending marketplace review'],
      travelMinutes: scheduleFit.travelMinutes,
      availabilityState:
        provider.technicianAvailability?.availabilityState ??
        (provider.availableNow ? 'AVAILABLE' : 'PAUSED'),
      canMeetWindow: scheduleFit.canMeetWindow,
      estimatedStartAt: scheduleFit.estimatedStartAt,
      estimatedEndAt: scheduleFit.estimatedEndAt,
      reliabilityIndicators: {
        reliabilityScore: provider.reliabilityScore,
        averageRating: provider.averageRating,
        completedJobsCount: provider.completedJobsCount,
        onTimeRate: provider.onTimeRate,
        acceptanceRate: provider.acceptanceRate,
        complaintRate: provider.complaintRate,
        cancellationRate: provider.cancellationRate,
        punctualityScore: provider.punctualityScore,
      },
      selectionReason: scoreBreakdown.reasons[0] ?? 'Best overall operational fit',
    })
  }

  candidates.sort((a, b) => b.score - a.score || a.travelMinutes - b.travelMinutes)

  return {
    jobRequestId,
    assignmentMode: jobRequest.assignmentMode,
    consideredCount: providers.length,
    eligibleCount: candidates.length,
    filteredOut,
    candidates,
  }
}

async function persistDispatchDecision(params: {
  ranking: RankingResult
  actor: DispatchActor
  mode: AssignmentMode | 'MANUAL_OVERRIDE'
  idempotencyKey?: string
  overrideProviderId?: string
  overrideReason?: string | null
}) {
  const decisionMode =
    params.mode === 'MANUAL_OVERRIDE' ? 'MANUAL_OVERRIDE' : params.mode
  const status =
    params.ranking.candidates.length === 0 ? 'NO_MATCH' : params.mode === 'OPS_REVIEW' ? 'RANKED' : 'OFFERING'

  const rankingSummary = params.ranking.candidates.map((candidate, index) => ({
    providerId: candidate.providerId,
    score: candidate.score,
    rankedPosition: index + 1,
    selectionReason: candidate.selectionReason,
    travelMinutes: candidate.travelMinutes,
    canMeetWindow: candidate.canMeetWindow,
  }))

  const filterSummary = params.ranking.filteredOut

  const decision = await db.dispatchDecision.create({
    data: {
      jobRequestId: params.ranking.jobRequestId,
      mode: decisionMode,
      status,
      initiatedById: params.actor.actorId,
      initiatedByRole: params.actor.actorRole,
      idempotencyKey: params.idempotencyKey,
      selectedProviderId: params.overrideProviderId,
      overrideReason: params.overrideReason ?? undefined,
      consideredCount: params.ranking.consideredCount,
      eligibleCount: params.ranking.eligibleCount,
      scoreWeights: MATCHING_CONFIG.weights as Prisma.InputJsonValue,
      rankingSummary: rankingSummary as Prisma.InputJsonValue,
      filterSummary: filterSummary as Prisma.InputJsonValue,
      explanation:
        params.ranking.candidates[0]?.selectionReason ??
        'No eligible technicians passed the matching filters',
    },
  })

  for (const [index, candidate] of params.ranking.candidates.entries()) {
    await db.matchAttempt.create({
      data: {
        jobRequestId: params.ranking.jobRequestId,
        providerId: candidate.providerId,
        dispatchDecisionId: decision.id,
        attemptNumber: index + 1,
        rankedPosition: index + 1,
        stage: 'RANKED',
        hardFilterPassed: true,
        filteredReasonCodes: [],
        feasibilityNotes: candidate.feasibilityNotes,
        score: candidate.score,
        scoreBreakdown: candidate.scoreBreakdown as Prisma.InputJsonValue,
      },
    })
  }

  for (const filtered of params.ranking.filteredOut) {
    await db.matchAttempt.create({
      data: {
        jobRequestId: params.ranking.jobRequestId,
        providerId: filtered.providerId,
        dispatchDecisionId: decision.id,
        attemptNumber: 0,
        stage: 'FILTERED_OUT',
        hardFilterPassed: false,
        filteredReasonCodes: filtered.filteredReasonCodes,
        feasibilityNotes: [],
      },
    })
  }

  await db.jobRequest.update({
    where: { id: params.ranking.jobRequestId },
    data: {
      latestDispatchDecisionId: decision.id,
      assignmentMode: params.mode === 'MANUAL_OVERRIDE' ? 'OPS_REVIEW' : params.mode,
      status: params.ranking.candidates.length > 0 ? 'MATCHING' : 'OPEN',
    },
  })

  return decision
}

async function createOfferForAttempt(params: {
  dispatchDecisionId: string
  jobRequestId: string
  matchAttemptId: string
  providerId: string
  actor: DispatchActor
}) {
  const expiresAt = new Date(Date.now() + MATCHING_CONFIG.offerTtlMinutes * 60_000)

  await db.assignmentHold.updateMany({
    where: {
      jobRequestId: params.jobRequestId,
      status: 'ACTIVE',
    },
    data: {
      status: 'RELEASED',
      releasedAt: new Date(),
      outcomeReasonCode: 'SUPERSEDED_BY_NEW_OFFER',
    },
  })

  await releaseAssignmentHoldScheduleItems(db, {
    jobRequestId: params.jobRequestId,
    itemType: 'ASSIGNMENT_HOLD',
    status: 'ACTIVE',
  })

  const hold = await db.assignmentHold.create({
    data: {
      jobRequestId: params.jobRequestId,
      providerId: params.providerId,
      dispatchDecisionId: params.dispatchDecisionId,
      matchAttemptId: params.matchAttemptId,
      status: 'ACTIVE',
      expiresAt,
    },
  })

  const jobRequest = await loadMatchingJobRequest(db, params.jobRequestId)

  const lead = await db.lead.upsert({
    where: {
      jobRequestId_providerId: {
        jobRequestId: params.jobRequestId,
        providerId: params.providerId,
      },
    },
    create: {
      jobRequestId: params.jobRequestId,
      providerId: params.providerId,
      dispatchDecisionId: params.dispatchDecisionId,
      matchAttemptId: params.matchAttemptId,
      assignmentHoldId: hold.id,
      status: 'SENT',
      expiresAt,
    },
    update: {
      dispatchDecisionId: params.dispatchDecisionId,
      matchAttemptId: params.matchAttemptId,
      assignmentHoldId: hold.id,
      status: 'SENT',
      sentAt: new Date(),
      respondedAt: null,
      expiresAt,
    },
  })

  await db.matchAttempt.update({
    where: { id: params.matchAttemptId },
    data: {
      stage: 'OFFERED',
      offeredAt: new Date(),
      reasonCode: 'TOP_RANKED_ACTIVE_OFFER',
    },
  })

  await db.dispatchDecision.update({
    where: { id: params.dispatchDecisionId },
    data: {
      status: 'OFFERING',
      selectedProviderId: params.providerId,
      selectedMatchAttemptId: params.matchAttemptId,
      nextRetryAt: expiresAt,
    },
  })

  const requestWindow = deriveRequestWindow(jobRequest)
  await createAssignmentHoldScheduleItem(db, {
    providerId: params.providerId,
    jobRequestId: params.jobRequestId,
    assignmentHoldId: hold.id,
    itemType: 'ASSIGNMENT_HOLD',
    status: 'ACTIVE',
    title: `${jobRequest.category} offer hold`,
    startAt: requestWindow.startAt,
    endAt: requestWindow.endAt,
    source: 'matching_engine',
    locationLabel: [jobRequest.address?.suburb, jobRequest.address?.city].filter(Boolean).join(', '),
    lat: jobRequest.address?.lat ?? undefined,
    lng: jobRequest.address?.lng ?? undefined,
  })

  const provider = await loadProviderOfferContact(db, params.providerId)

  const { notifyProviderNewJob } = await import('../whatsapp-bot')
  let interactiveDelivered = false
  await notifyProviderNewJob({
    providerPhone: provider.phone,
    leadId: lead.id,
    category: jobRequest.category,
    area: jobRequest.address?.suburb ?? jobRequest.address?.city ?? '',
    description: jobRequest.title || jobRequest.description || jobRequest.category,
    customerInitial: (jobRequest.customer?.name ?? 'Customer').split(' ')[0] ?? 'Customer',
    expiresInMinutes: MATCHING_CONFIG.offerTtlMinutes,
  }).then(() => {
    interactiveDelivered = true
  }).catch((error) => {
    console.error('[matching] Failed to notify provider of assignment offer:', error)
  })

  // Template fallback — only fires when the interactive CTA message fails (e.g. provider outside 24h session window).
  // Sending both would duplicate the notification; the interactive message is always preferred.
  if (!interactiveDelivered) {
    const { sendJobOffer } = await import('../whatsapp')
    const appUrl = (process.env.NEXT_PUBLIC_APP_URL ?? '').trim()
    const scheduledWindow = requestWindow.startAt.toLocaleDateString('en-ZA', {
      weekday: 'short', day: 'numeric', month: 'short',
    })
    sendJobOffer({
      providerPhone: provider.phone,
      providerFirstName: provider.name.split(' ')[0] ?? provider.name,
      serviceName: jobRequest.category,
      area: jobRequest.address?.suburb ?? jobRequest.address?.city ?? '',
      scheduledWindow,
      jobUrl: `${appUrl}/leads/${lead.id}`,
    }).catch((error) => {
      console.error('[matching] Failed to send job_offer template to provider:', error)
    })
  }

  return { hold, lead }
}

export async function runAssignmentForJobRequest(params: {
  jobRequestId: string
  actor?: DispatchActor
  mode?: AssignmentMode
}) : Promise<DispatchRunResult> {
  const actor = params.actor ?? { actorId: 'system', actorRole: 'system' as const }
  const jobRequestForKey = await loadMatchingJobRequest(db, params.jobRequestId)
  const mode = params.mode ?? jobRequestForKey.assignmentMode
  const idempotencyKey = buildDispatchIdempotencyKey({
    jobRequest: jobRequestForKey,
    mode,
  })
  const ranking = await rankCandidatesForJobRequest(params.jobRequestId)
  const existingMatch = await db.match.findUnique({
    where: { jobRequestId: params.jobRequestId },
  })

  if (existingMatch) {
    return {
      ...ranking,
      dispatchDecisionId: 'existing-match',
      status: 'ASSIGNED',
      offeredProviderId: existingMatch.providerId,
      assignmentHoldId: null,
    }
  }

  const activeHold = await db.assignmentHold.findFirst({
    where: {
      jobRequestId: params.jobRequestId,
      status: 'ACTIVE',
    },
    orderBy: { createdAt: 'desc' },
  })

  if (activeHold) {
    const activeDecision = await db.dispatchDecision.findUnique({
      where: { id: activeHold.dispatchDecisionId },
    })

    return {
      ...ranking,
      dispatchDecisionId: activeHold.dispatchDecisionId,
      status: activeDecision?.status ?? 'OFFERING',
      offeredProviderId: activeHold.providerId,
      assignmentHoldId: activeHold.id,
    }
  }

  const existingDecision = await db.dispatchDecision.findFirst({
    where: {
      jobRequestId: params.jobRequestId,
      idempotencyKey,
      status: mode === 'OPS_REVIEW' ? 'RANKED' : { in: ['RANKED', 'OFFERING'] },
    },
    orderBy: { createdAt: 'desc' },
  })

  if (existingDecision && mode === 'OPS_REVIEW') {
    return {
      ...ranking,
      dispatchDecisionId: existingDecision.id,
      status: existingDecision.status,
      offeredProviderId: existingDecision.selectedProviderId,
      assignmentHoldId: null,
    }
  }

  const dispatchDecision = await persistDispatchDecision({
    ranking,
    actor,
    mode,
    idempotencyKey,
  })

  if (mode === 'OPS_REVIEW' || ranking.candidates.length === 0) {
    return {
      ...ranking,
      dispatchDecisionId: dispatchDecision.id,
      status: dispatchDecision.status,
      offeredProviderId: null,
      assignmentHoldId: null,
    }
  }

  const topCandidate = ranking.candidates[0]
  const topAttempt = await db.matchAttempt.findFirstOrThrow({
    where: {
      dispatchDecisionId: dispatchDecision.id,
      providerId: topCandidate.providerId,
    },
  })
  const offer = await createOfferForAttempt({
    dispatchDecisionId: dispatchDecision.id,
    jobRequestId: ranking.jobRequestId,
    matchAttemptId: topAttempt.id,
    providerId: topCandidate.providerId,
    actor,
  })

  return {
    ...ranking,
    dispatchDecisionId: dispatchDecision.id,
    status: 'OFFERING',
    offeredProviderId: topCandidate.providerId,
    assignmentHoldId: offer.hold.id,
  }
}

async function offerNextRankedCandidate(params: {
  jobRequestId: string
  dispatchDecisionId: string
  actor?: DispatchActor
}) {
  const attempts = await db.matchAttempt.findMany({
    where: {
      dispatchDecisionId: params.dispatchDecisionId,
      hardFilterPassed: true,
    },
    orderBy: { rankedPosition: 'asc' },
  })

  const nextAttempt = attempts.find((attempt) => attempt.stage === 'RANKED')
  if (!nextAttempt) {
    await db.dispatchDecision.update({
      where: { id: params.dispatchDecisionId },
      data: { status: 'NO_MATCH', nextRetryAt: null },
    })
    await db.jobRequest.update({
      where: { id: params.jobRequestId },
      data: { status: 'EXPIRED' },
    })
    return { nextOfferedProviderId: null, assignmentHoldId: null }
  }

  await db.dispatchDecision.update({
    where: { id: params.dispatchDecisionId },
    data: {
      retryCount: { increment: 1 },
      nextRetryAt: new Date(Date.now() + MATCHING_CONFIG.retryDelayMinutes * 60_000),
    },
  })

  const offer = await createOfferForAttempt({
    dispatchDecisionId: params.dispatchDecisionId,
    jobRequestId: params.jobRequestId,
    matchAttemptId: nextAttempt.id,
    providerId: nextAttempt.providerId,
    actor: params.actor ?? { actorId: 'system', actorRole: 'system' },
  })

  return {
    nextOfferedProviderId: nextAttempt.providerId,
    assignmentHoldId: offer.hold.id,
  }
}

export async function acceptAssignmentOffer(params: {
  leadId: string
  providerId: string
  inspectionNeeded?: boolean
}): Promise<OfferResolutionResult> {
  const acceptStart = Date.now()
  const transactionResult = await db.$transaction(async (tx) => {
    const lead = await tx.lead.findUnique({
      where: { id: params.leadId },
      include: {
        assignmentHold: true,
        matchAttempt: true,
      },
    })

    if (!lead) return { ok: false as const, reason: 'NOT_FOUND' }
    if (lead.providerId !== params.providerId) return { ok: false as const, reason: 'FORBIDDEN' }
    if (!lead.assignmentHoldId || !lead.assignmentHold) {
      return { ok: false as const, reason: 'TAKEN' }
    }
    if (lead.assignmentHold.status !== 'ACTIVE') {
      return { ok: false as const, reason: 'TAKEN' }
    }
    if (lead.expiresAt && lead.expiresAt < new Date()) {
      await tx.lead.update({
        where: { id: lead.id },
        data: { status: 'EXPIRED', respondedAt: new Date() },
      })
      await tx.assignmentHold.update({
        where: { id: lead.assignmentHold.id },
        data: {
          status: 'EXPIRED',
          respondedAt: new Date(),
          releasedAt: new Date(),
          outcomeReasonCode: 'OFFER_EXPIRED_BEFORE_ACCEPT',
        },
      })
      await tx.matchAttempt.update({
        where: { id: lead.matchAttemptId ?? '' },
        data: {
          stage: 'TIMED_OUT',
          respondedAt: new Date(),
          responseOutcome: 'TIMED_OUT',
          reasonCode: 'OFFER_EXPIRED_BEFORE_ACCEPT',
        },
      }).catch(() => {})
      return { ok: false as const, reason: 'EXPIRED' }
    }

    const existingMatch = await tx.match.findUnique({
      where: { jobRequestId: lead.jobRequestId },
    })

    if (existingMatch && existingMatch.providerId !== params.providerId) {
      await tx.lead.update({
        where: { id: lead.id },
        data: { status: 'EXPIRED', respondedAt: new Date() },
      })
      await tx.assignmentHold.update({
        where: { id: lead.assignmentHold.id },
        data: {
          status: 'RELEASED',
          respondedAt: new Date(),
          releasedAt: new Date(),
          outcomeReasonCode: 'MATCH_ALREADY_TAKEN',
        },
      })
      return { ok: false as const, reason: 'TAKEN' }
    }

    if (existingMatch && existingMatch.providerId === params.providerId) {
      await tx.lead.update({
        where: { id: lead.id },
        data: { status: 'ACCEPTED', respondedAt: new Date() },
      })
      await tx.assignmentHold.update({
        where: { id: lead.assignmentHold.id },
        data: {
          status: 'ACCEPTED',
          respondedAt: new Date(),
          releasedAt: new Date(),
          outcomeReasonCode: 'MATCH_ALREADY_CONFIRMED',
        },
      })

      return {
        ok: true as const,
        responseOutcome: 'ACCEPTED',
        matchId: existingMatch.id,
        bookingId: null,
        assignmentHoldId: lead.assignmentHold.id,
        nextOfferedProviderId: null,
      }
    }

    const jobRequest = await loadMatchingJobRequest(tx, lead.jobRequestId)

    await tx.lead.update({
      where: { id: lead.id },
      data: { status: 'ACCEPTED', respondedAt: new Date() },
    })
    await tx.assignmentHold.update({
      where: { id: lead.assignmentHold.id },
      data: {
        status: 'ACCEPTED',
        respondedAt: new Date(),
        releasedAt: new Date(),
        outcomeReasonCode: 'ACCEPTED',
      },
    })
    if (lead.matchAttemptId) {
      await tx.matchAttempt.update({
        where: { id: lead.matchAttemptId },
        data: {
          stage: 'ACCEPTED',
          respondedAt: new Date(),
          responseOutcome: 'ACCEPTED',
          reasonCode: 'TECHNICIAN_ACCEPTED_OFFER',
        },
      })
    }

    const match = await tx.match.create({
      data: {
        jobRequestId: lead.jobRequestId,
        providerId: params.providerId,
        status: params.inspectionNeeded ? 'INSPECTION_SCHEDULED' : 'MATCHED',
        inspectionNeeded: params.inspectionNeeded === true,
      },
    })

    await tx.jobRequest.update({
      where: { id: lead.jobRequestId },
      data: { status: 'MATCHED' },
    })

    await tx.dispatchDecision.updateMany({
      where: {
        id: lead.dispatchDecisionId ?? undefined,
      },
      data: {
        status: 'ASSIGNED',
        selectedProviderId: params.providerId,
        selectedMatchAttemptId: lead.matchAttemptId ?? undefined,
      },
    })

    await tx.lead.updateMany({
      where: {
        jobRequestId: lead.jobRequestId,
        id: { not: lead.id },
        status: { in: ['SENT', 'VIEWED'] },
      },
      data: { status: 'EXPIRED', respondedAt: new Date() },
    })
    await tx.assignmentHold.updateMany({
      where: {
        jobRequestId: lead.jobRequestId,
        id: { not: lead.assignmentHold.id },
        status: 'ACTIVE',
      },
      data: {
        status: 'RELEASED',
        releasedAt: new Date(),
        outcomeReasonCode: 'MATCH_ASSIGNED_ELSEWHERE',
      },
    })
    await releaseAssignmentHoldScheduleItems(tx, {
      jobRequestId: lead.jobRequestId,
      itemType: 'ASSIGNMENT_HOLD',
      assignmentHoldId: { not: lead.assignmentHold.id },
    })

    let bookingId: string | null = null
    let paymentAmount: number | null = null
    if (
      jobRequest.autoCreateBookingOnAssignment &&
      jobRequest.customerAcceptedAmount != null
    ) {
      const requestWindow = deriveRequestWindow(jobRequest)
      const autoQuote = await tx.quote.create({
        data: {
          matchId: match.id,
          amount: jobRequest.customerAcceptedAmount,
          labourCost: jobRequest.customerAcceptedAmount,
          materialsCost: 0,
          estimatedHours:
            (jobRequest.estimatedDurationMinutes ?? MATCHING_CONFIG.defaultDurationMinutes) / 60,
          description:
            jobRequest.customerAcceptedScope ||
            jobRequest.description ||
            `Customer-approved ${jobRequest.category} scope`,
          preferredDate: requestWindow.startAt,
          approvalToken: crypto.randomUUID(),
          status: 'APPROVED',
          approvedAt: new Date(),
          notes: 'Auto-approved from customer accepted amount at assignment acceptance',
        },
      })

      await tx.match.update({
        where: { id: match.id },
        data: { status: 'QUOTE_APPROVED' },
      })

      const booking = await createBookingArtifactsForApprovedQuote(tx, {
        quoteId: autoQuote.id,
        matchId: match.id,
        providerId: params.providerId,
        category: jobRequest.category,
        jobRequestId: jobRequest.id,
        address: jobRequest.address,
        scheduledDate: requestWindow.startAt,
        estimatedDurationMinutes: jobRequest.estimatedDurationMinutes,
        source: 'assignment_acceptance',
      })

      bookingId = booking.bookingId
      paymentAmount = Number(jobRequest.customerAcceptedAmount)
    }

    return {
      ok: true as const,
      responseOutcome: 'ACCEPTED',
      matchId: match.id,
      jobRequestId: lead.jobRequestId,
      bookingId,
      paymentAmount,
      customerPhone: jobRequest.customer.phone,
      category: jobRequest.category,
      assignmentHoldId: lead.assignmentHold.id,
      nextOfferedProviderId: null,
    }
  })

  if (!transactionResult.ok) {
    return {
      ok: false,
      reason: transactionResult.reason as 'NOT_FOUND' | 'FORBIDDEN' | 'EXPIRED' | 'TAKEN',
    }
  }

  if (
    transactionResult.bookingId &&
    transactionResult.paymentAmount != null &&
    transactionResult.paymentAmount > 0
  ) {
    await initializeBookingPayment({
      bookingId: transactionResult.bookingId,
      amountRand: transactionResult.paymentAmount,
      customerEmail: null,
      customerPhone: transactionResult.customerPhone,
      description: `${transactionResult.category} booking`,
    })
  }

  if ('jobRequestId' in transactionResult && transactionResult.jobRequestId) {
    emitMatchEvent({
      event: 'match.accepted',
      jobRequestId: transactionResult.jobRequestId,
      providerId: params.providerId,
      bookingId: transactionResult.bookingId ?? '',
      latencyMs: Date.now() - acceptStart,
    })
  }

  return {
    ok: true,
    responseOutcome: transactionResult.responseOutcome as 'ACCEPTED' | 'REJECTED' | 'TIMED_OUT' | 'EXPIRED' | 'OVERRIDDEN' | 'CANCELLED',
    matchId: transactionResult.matchId,
    bookingId: transactionResult.bookingId ?? null,
    assignmentHoldId: transactionResult.assignmentHoldId,
    nextOfferedProviderId: transactionResult.nextOfferedProviderId,
  }
}

export async function processPendingAssignmentWorkflows() {
  const activeHolds = await safeOptionalQuery(
    () =>
      db.assignmentHold.findMany({
        where: {
          status: 'ACTIVE',
          expiresAt: { lte: new Date() },
        },
        select: { id: true },
      }),
    [] as Array<{ id: string }>,
  )

  let expiredOffers = 0
  let reoffered = 0

  for (const hold of activeHolds) {
    const result = await expireAssignmentOffer({ assignmentHoldId: hold.id })
    if (result.expired) {
      expiredOffers++
      if (result.nextOfferedProviderId) {
        reoffered++
      }
    }
  }

  return {
    processed: activeHolds.length,
    expiredOffers,
    reoffered,
  }
}

// ── Capacity reconciliation ────────────────────────────────────────────────────
// Safety net: recomputes provider_capacity.activeHolds from actual active holds.
// Corrects any drift caused by process crashes or legacy code paths.
// Called at the start of every match-leads cron run.
export async function reconcileStaleAssignmentState(): Promise<{ corrected: number }> {
  const capacityRows = await safeOptionalQuery(
    () =>
      (db as any).providerCapacity?.findMany?.({
        where: { activeHolds: { gt: 0 } },
        select: { providerId: true, activeHolds: true },
      }),
    [] as Array<{ providerId: string; activeHolds: number }>,
  )

  let corrected = 0

  for (const row of capacityRows) {
    const actualCount = await db.assignmentHold
      .count({
        where: {
          providerId: row.providerId,
          status: 'ACTIVE',
          expiresAt: { gt: new Date() },
        },
      })
      .catch(() => row.activeHolds) // If count fails, keep existing value — don't corrupt

    if (actualCount !== row.activeHolds) {
      await (db as any).providerCapacity
        ?.update?.({
          where: { providerId: row.providerId },
          data: { activeHolds: actualCount, updatedAt: new Date() },
        })
        .catch(() => {}) // Non-fatal

      console.warn('[reconcile] corrected activeHolds', {
        providerId: row.providerId,
        was: row.activeHolds,
        now: actualCount,
      })
      corrected++
    }
  }

  return { corrected }
}

export async function rejectAssignmentOffer(params: {
  leadId: string
  providerId: string
  reasonCode?: string
}): Promise<OfferResolutionResult> {
  const lead = await db.lead.findUnique({
    where: { id: params.leadId },
    include: { assignmentHold: true, matchAttempt: true },
  })

  if (!lead) return { ok: false, reason: 'NOT_FOUND' }
  if (lead.providerId !== params.providerId) return { ok: false, reason: 'FORBIDDEN' }
  if (!lead.assignmentHold) return { ok: false, reason: 'TAKEN' }
  if (lead.assignmentHold.status !== 'ACTIVE') {
    return { ok: false, reason: 'TAKEN' }
  }

  await db.$transaction(async (tx) => {
    await tx.lead.update({
      where: { id: lead.id },
      data: { status: 'DECLINED', respondedAt: new Date() },
    })
    await tx.assignmentHold.update({
      where: { id: lead.assignmentHold!.id },
      data: {
        status: 'REJECTED',
        respondedAt: new Date(),
        releasedAt: new Date(),
        outcomeReasonCode: params.reasonCode ?? 'TECHNICIAN_REJECTED_OFFER',
      },
    })
    if (lead.matchAttemptId) {
      await tx.matchAttempt.update({
        where: { id: lead.matchAttemptId },
        data: {
          stage: 'REJECTED',
          respondedAt: new Date(),
          responseOutcome: 'REJECTED',
          reasonCode: params.reasonCode ?? 'TECHNICIAN_REJECTED_OFFER',
        },
      })
    }
    await releaseAssignmentHoldScheduleItems(tx, {
      assignmentHoldId: lead.assignmentHold!.id,
      itemType: 'ASSIGNMENT_HOLD',
    })
  })

  const next = await offerNextRankedCandidate({
    jobRequestId: lead.jobRequestId,
    dispatchDecisionId: lead.dispatchDecisionId!,
  })

  emitMatchEvent({
    event: 'match.declined',
    jobRequestId: lead.jobRequestId,
    providerId: params.providerId,
    holdId: lead.assignmentHold.id,
    reason: params.reasonCode,
  })

  return {
    ok: true,
    responseOutcome: 'REJECTED',
    matchId: null,
    assignmentHoldId: lead.assignmentHold.id,
    nextOfferedProviderId: next.nextOfferedProviderId,
  }
}

export async function expireAssignmentOffer(params: {
  assignmentHoldId: string
}) {
  const hold = await db.assignmentHold.findUnique({
    where: { id: params.assignmentHoldId },
    select: {
      id: true,
      status: true,
      expiresAt: true,
      matchAttemptId: true,
      dispatchDecisionId: true,
      jobRequestId: true,
      providerId: true,
    },
  })

  if (!hold) return { expired: false, nextOfferedProviderId: null }
  if (hold.status !== 'ACTIVE' || hold.expiresAt > new Date()) {
    return { expired: false, nextOfferedProviderId: null }
  }

  await db.$transaction(async (tx) => {
    await tx.assignmentHold.update({
      where: { id: hold.id },
      data: {
        status: 'EXPIRED',
        respondedAt: new Date(),
        releasedAt: new Date(),
        outcomeReasonCode: 'OFFER_TIMEOUT',
      },
    })
    await tx.lead.updateMany({
      where: {
        assignmentHoldId: hold.id,
        status: { in: ['SENT', 'VIEWED'] },
      },
      data: { status: 'EXPIRED', respondedAt: new Date() },
    })
    await tx.matchAttempt.update({
      where: { id: hold.matchAttemptId },
      data: {
        stage: 'TIMED_OUT',
        respondedAt: new Date(),
        responseOutcome: 'TIMED_OUT',
        reasonCode: 'OFFER_TIMEOUT',
      },
    })
    await releaseAssignmentHoldScheduleItems(tx, {
      assignmentHoldId: hold.id,
      itemType: 'ASSIGNMENT_HOLD',
    })
  })

  // Decrement the provider's capacity counter — this must happen outside the
  // transaction so it runs even if offerNextRankedCandidate fails below.
  await releaseProviderCapacity(hold.providerId).catch((err) =>
    console.error('[expireAssignmentOffer] releaseProviderCapacity failed', { providerId: hold.providerId, err })
  )

  const next = await offerNextRankedCandidate({
    jobRequestId: hold.jobRequestId,
    dispatchDecisionId: hold.dispatchDecisionId,
  })

  // When all candidates exhausted the job is now EXPIRED — notify the customer and last provider
  if (!next.nextOfferedProviderId) {
    await notifyExpiredJobParties({
      jobRequestId: hold.jobRequestId,
      lastProviderId: hold.providerId,
    })
  }

  // Count how many candidates have been offered (non-RANKED = already attempted)
  const attemptsCompleted = hold.dispatchDecisionId
    ? await db.matchAttempt
        .count({ where: { dispatchDecisionId: hold.dispatchDecisionId, stage: { not: 'RANKED' } } })
        .catch(() => 0)
    : 0

  emitMatchEvent({
    event: 'match.hold_expired',
    jobRequestId: hold.jobRequestId,
    providerId: hold.providerId,
    holdId: hold.id,
    cascaded: next.nextOfferedProviderId !== null,
  })

  if (next.nextOfferedProviderId) {
    emitMatchEvent({
      event: 'match.rematch',
      jobRequestId: hold.jobRequestId,
      attempt: attemptsCompleted,
      triggeredBy: 'hold_expiry',
    })
  } else {
    emitMatchEvent({
      event: 'match.exhausted',
      jobRequestId: hold.jobRequestId,
      attempts: attemptsCompleted,
    })
  }

  return { expired: true, nextOfferedProviderId: next.nextOfferedProviderId }
}

export async function getDispatchHistory(jobRequestId: string): Promise<DispatchHistoryResult[]> {
  const dispatchDecisions = await db.dispatchDecision.findMany({
    where: { jobRequestId },
    include: {
      matchAttempts: {
        orderBy: [{ rankedPosition: 'asc' }, { createdAt: 'asc' }],
      },
    },
    orderBy: { createdAt: 'desc' },
  })

  return dispatchDecisions.map((dispatchDecision) => ({
    dispatchDecision,
    attempts: dispatchDecision.matchAttempts,
  }))
}

export async function manualOverrideAssignment(params: {
  jobRequestId: string
  providerId: string
  actor: DispatchActor
  overrideReason: string
}) {
  const ranking = await rankCandidatesForJobRequest(params.jobRequestId)
  const decision = await persistDispatchDecision({
    ranking,
    actor: params.actor,
    mode: 'MANUAL_OVERRIDE',
    overrideProviderId: params.providerId,
    overrideReason: params.overrideReason,
  })

  let attempt = await db.matchAttempt.findFirst({
    where: {
      dispatchDecisionId: decision.id,
      providerId: params.providerId,
    },
  })

  if (!attempt) {
    attempt = await db.matchAttempt.create({
      data: {
        jobRequestId: params.jobRequestId,
        providerId: params.providerId,
        dispatchDecisionId: decision.id,
        attemptNumber: ranking.candidates.length + 1,
        rankedPosition: ranking.candidates.length + 1,
        stage: 'OVERRIDDEN',
        hardFilterPassed: true,
        filteredReasonCodes: [],
        feasibilityNotes: ['Selected manually by admin override'],
        score: 0,
        scoreBreakdown: {
          overridden: true,
          reason: params.overrideReason,
        } as Prisma.InputJsonValue,
        reasonCode: 'ADMIN_OVERRIDE',
      },
    })
  } else {
    await db.matchAttempt.update({
      where: { id: attempt.id },
      data: {
        stage: 'OVERRIDDEN',
        responseOutcome: 'OVERRIDDEN',
        reasonCode: 'ADMIN_OVERRIDE',
      },
    })
  }

  const offer = await createOfferForAttempt({
    dispatchDecisionId: decision.id,
    jobRequestId: params.jobRequestId,
    matchAttemptId: attempt.id,
    providerId: params.providerId,
    actor: params.actor,
  })

  await db.dispatchDecision.update({
    where: { id: decision.id },
    data: {
      status: 'OVERRIDDEN',
      selectedProviderId: params.providerId,
      selectedMatchAttemptId: attempt.id,
      overrideReason: params.overrideReason,
    },
  })

  return {
    dispatchDecisionId: decision.id,
    assignmentHoldId: offer.hold.id,
  }
}
