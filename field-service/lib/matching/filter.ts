// ─── Provider Filter ──────────────────────────────────────────────────────────
// Applies hard eligibility checks to the raw candidate shortlist:
//   area coverage, skills, certifications, equipment, vehicle types, live status,
//   and schedule fit.
//
// All DB fetching happens here so that scoreAndRankCandidates can be pure.
// Returns { eligible: EligibleProvider[], filteredOut: FilteredCandidate[] }.

import { db } from '@/lib/db'
import { resolveCategoryRequirements } from '@/lib/category-config'
import { MATCHING_CONFIG } from './config'
import { pointFallsWithinRadius } from './geography'
import {
  buildWorkingWindow,
  deriveRequestWindow,
  evaluateScheduleFit,
  normalizeCommitments,
} from './scheduling'
import type { CandidatePoolEntry } from './candidate-pool'
import type { CoverageTier, MatchingAddress, MatchingJobRequest } from './types'

// ── Exported types ────────────────────────────────────────────────────────────

export type EligibleProvider = CandidatePoolEntry & {
  // Computed during the filter pass — scoring is pure once these are attached
  scheduleFitScore: number
  travelMinutes: number
  canMeetWindow: boolean
  estimatedStartAt: Date | null
  estimatedEndAt: Date | null
  feasibilityNotes: string[]
  coverageTier: CoverageTier
  availabilityState: string
  // Metrics hydrated from DB
  completedJobsCount: number
  onTimeRate: number
  acceptanceRate: number
  complaintCount: number
  complaintRate: number
  cancellationRate: number
  punctualityScore: number
  lastKnownLocationAt: Date | null
  // Relations hydrated from DB
  technicianSkills: SkillRow[]
  technicianCertifications: CertRow[]
  technicianServiceAreas: ServiceAreaRow[]
  technicianAvailability: AvailabilityRow | null
  scheduleItems: ScheduleItemRow[]
  schedule: ScheduleRow[]
  adminCertifications: AdminCertRow[]
  equipment: AdminEquipRow[]
}

export type FilteredCandidate = {
  providerId: string
  providerName?: string
  filteredReasonCodes: string[]
}

// ── Internal row types ────────────────────────────────────────────────────────

type ServiceAreaRow = {
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
  availabilityState: string
  nextAvailableAt: Date | null
  breakUntil: Date | null
}

type ScheduleItemRow = {
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

type ScheduleRow = {
  dayOfWeek: number
  startTime: string
  endTime: string
  active: boolean
}

type SkillRow = { skillTag: string }
type CertRow = { certificationCode: string; status: string }
type AdminCertRow = { name: string; verifiedAt: Date | null }
type AdminEquipRow = { label: string; category: string | null; active: boolean }

type MetricsRow = {
  id: string
  completedJobsCount: number
  onTimeRate: number
  acceptanceRate: number
  complaintCount: number
  complaintRate: number
  cancellationRate: number
  punctualityScore: number
  lastKnownLocationAt: Date | null
  equipmentTags: string[]
  vehicleTypes: string[]
}

// ── Eligibility helpers ───────────────────────────────────────────────────────

function normalizeTag(tag: string) {
  return tag.trim().toLowerCase()
}

function hasRequiredSkills(
  jobRequest: MatchingJobRequest,
  provider: { skills: string[]; technicianSkills: SkillRow[] }
) {
  const required = new Set(
    (jobRequest.requiredSkillTags.length > 0
      ? jobRequest.requiredSkillTags
      : [jobRequest.category]
    ).map(normalizeTag)
  )
  const has = new Set(
    [...provider.skills, ...provider.technicianSkills.map((s) => s.skillTag)].map(normalizeTag)
  )
  return [...required].every((skill) => has.has(skill))
}

function getMissingCertifications(
  requiredCodes: string[],
  provider: {
    technicianCertifications: CertRow[]
    adminCertifications: AdminCertRow[]
  }
) {
  if (requiredCodes.length === 0) return []
  const activeLegacy = new Set(
    provider.technicianCertifications
      .filter((c) => c.status !== 'EXPIRED')
      .map((c) => normalizeTag(c.certificationCode))
  )
  const adminVerified = new Set(
    provider.adminCertifications
      .filter((c) => c.verifiedAt != null)
      .map((c) => normalizeTag(c.name))
  )
  return requiredCodes.map(normalizeTag).filter((code) => !activeLegacy.has(code) && !adminVerified.has(code))
}

function getMissingEquipment(
  requiredTags: string[],
  provider: { equipmentTags: string[]; equipment: AdminEquipRow[] }
) {
  if (requiredTags.length === 0) return []
  const legacyEquip = new Set(provider.equipmentTags.map(normalizeTag))
  const adminEquip = new Set(
    provider.equipment
      .filter((e) => e.active)
      .flatMap((e) => [normalizeTag(e.label), ...(e.category ? [normalizeTag(e.category)] : [])])
  )
  return requiredTags.map(normalizeTag).filter((t) => !legacyEquip.has(t) && !adminEquip.has(t))
}

function hasRequiredVehicles(requiredTypes: string[], vehicleTypes: string[]) {
  if (requiredTypes.length === 0) return true
  const has = new Set(vehicleTypes.map(normalizeTag))
  return requiredTypes.map(normalizeTag).some((vt) => has.has(vt))
}

function providerCoversAddress(
  serviceAreas: ServiceAreaRow[],
  address: MatchingAddress
): { covers: boolean; tier: CoverageTier } {
  const activeAreas = serviceAreas.filter((a) => a.active)

  // Tier 1 — RADIUS: haversine check
  if (address.lat != null && address.lng != null) {
    const radiusMatch = activeAreas.some(
      (area) =>
        area.areaType === 'RADIUS' &&
        area.lat != null &&
        area.lng != null &&
        area.radiusKm != null &&
        pointFallsWithinRadius({
          center: { lat: area.lat!, lng: area.lng! },
          point: { lat: address.lat!, lng: address.lng! },
          radiusKm: area.radiusKm!,
        })
    )
    if (radiusMatch) return { covers: true, tier: 'RADIUS' }
  }

  // Tier 2 — structured path
  if (address.locationNodeId != null) {
    if (activeAreas.some((a) => a.locationNodeId === address.locationNodeId)) {
      return { covers: true, tier: 'SUBURB_EXACT' }
    }
    if (address.regionKey != null && activeAreas.some((a) => a.regionKey === address.regionKey)) {
      return { covers: true, tier: 'REGION_FALLBACK' }
    }
    return { covers: false, tier: 'NO_MATCH' }
  }

  // Tier 3 — LEGACY_STRING fallback
  if (!MATCHING_CONFIG.allowLegacyStringFallback) {
    return { covers: false, tier: 'NO_MATCH' }
  }

  const addressTerms = [address.suburb, address.city]
    .map((v) => normalizeTag(v ?? ''))
    .filter(Boolean)
  const providerAreaTerms = [
    ...activeAreas.map((a) => a.label),
    ...activeAreas.map((a) => a.city).filter(Boolean),
  ].map((v) => normalizeTag(v ?? '')).filter(Boolean)

  if (addressTerms.some((t) => providerAreaTerms.includes(t))) {
    return { covers: true, tier: 'LEGACY_STRING' }
  }
  return { covers: false, tier: 'NO_MATCH' }
}

// ── Main export ───────────────────────────────────────────────────────────────

export async function filterEligibleProviders(
  rawCandidates: CandidatePoolEntry[],
  jobRequest: MatchingJobRequest & { address: MatchingAddress }
): Promise<{ eligible: EligibleProvider[]; filteredOut: FilteredCandidate[] }> {
  if (rawCandidates.length === 0) {
    return { eligible: [], filteredOut: [] }
  }

  const providerIds = rawCandidates.map((c) => c.id)
  const address = jobRequest.address
  const requestWindow = deriveRequestWindow(jobRequest)

  // ── Batch-fetch all detail tables in parallel ─────────────────────────────
  const [
    metricsRows,
    skillRows,
    certRows,
    areaRows,
    availabilityRows,
    scheduleRows,
    scheduleItemRows,
    adminCertRows,
    adminEquipRows,
  ] = await Promise.all([
    (db as any).provider?.findMany?.({
      where: { id: { in: providerIds } },
      select: {
        id: true,
        completedJobsCount: true,
        onTimeRate: true,
        acceptanceRate: true,
        complaintCount: true,
        complaintRate: true,
        cancellationRate: true,
        punctualityScore: true,
        lastKnownLocationAt: true,
        equipmentTags: true,
        vehicleTypes: true,
      },
    }).catch(() => []) as Promise<MetricsRow[]>,
    (db as any).technicianSkill?.findMany?.({
      where: { providerId: { in: providerIds } },
      select: { providerId: true, skillTag: true },
    }).catch(() => []) as Promise<Array<{ providerId: string } & SkillRow>>,
    (db as any).technicianCertification?.findMany?.({
      where: { providerId: { in: providerIds } },
      select: { providerId: true, certificationCode: true, status: true },
    }).catch(() => []) as Promise<Array<{ providerId: string } & CertRow>>,
    (db as any).technicianServiceArea?.findMany?.({
      where: { providerId: { in: providerIds } },
      select: {
        providerId: true, label: true, city: true, active: true,
        areaType: true, lat: true, lng: true, radiusKm: true,
        locationNodeId: true, regionKey: true,
      },
    }).catch(() => []) as Promise<Array<{ providerId: string } & ServiceAreaRow>>,
    (db as any).technicianAvailability?.findMany?.({
      where: { providerId: { in: providerIds } },
      select: { providerId: true, availabilityState: true, nextAvailableAt: true, breakUntil: true },
    }).catch(() => []) as Promise<Array<{ providerId: string } & AvailabilityRow>>,
    (db as any).providerSchedule?.findMany?.({
      where: { providerId: { in: providerIds }, active: true },
      select: { providerId: true, dayOfWeek: true, startTime: true, endTime: true, active: true },
    }).catch(() => []) as Promise<Array<{ providerId: string } & ScheduleRow>>,
    (db as any).technicianScheduleItem?.findMany?.({
      where: { providerId: { in: providerIds }, status: 'ACTIVE' },
      select: {
        providerId: true, id: true, itemType: true, title: true,
        startAt: true, endAt: true, bufferBeforeMinutes: true, bufferAfterMinutes: true,
        locationLabel: true, lat: true, lng: true, status: true,
      },
    }).catch(() => []) as Promise<Array<{ providerId: string } & ScheduleItemRow>>,
    (db as any).providerCertification?.findMany?.({
      where: { providerId: { in: providerIds } },
      select: { providerId: true, name: true, verifiedAt: true },
    }).catch(() => []) as Promise<Array<{ providerId: string } & AdminCertRow>>,
    (db as any).providerEquipment?.findMany?.({
      where: { providerId: { in: providerIds }, active: true },
      select: { providerId: true, label: true, category: true, active: true },
    }).catch(() => []) as Promise<Array<{ providerId: string } & AdminEquipRow>>,
  ])

  // ── Index by providerId ───────────────────────────────────────────────────
  const metricsById = new Map(metricsRows.map((r) => [r.id, r]))
  const skillsById = indexByProvider(skillRows)
  const certsById = indexByProvider(certRows)
  const areasById = indexByProvider(areaRows)
  const availabilityById = new Map(availabilityRows.map((r) => [r.providerId, r as AvailabilityRow]))
  const scheduleById = indexByProvider(scheduleRows)
  const scheduleItemsById = indexByProvider(scheduleItemRows)
  const adminCertsById = indexByProvider(adminCertRows)
  const adminEquipById = indexByProvider(adminEquipRows)

  // ── Category requirements (one call, shared across all providers) ─────────
  const categoryRequirements = await resolveCategoryRequirements({
    category: jobRequest.category,
    requiredCertificationCodes: jobRequest.requiredCertificationCodes,
    requiredEquipmentTags: jobRequest.requiredEquipmentTags,
    requiredVehicleTypes: jobRequest.requiredVehicleTypes,
  })

  const eligible: EligibleProvider[] = []
  const filteredOut: FilteredCandidate[] = []

  for (const candidate of rawCandidates) {
    const metrics = metricsById.get(candidate.id)
    const techSkills = skillsById.get(candidate.id) ?? []
    const techCerts = certsById.get(candidate.id) ?? []
    const serviceAreas = areasById.get(candidate.id) ?? []
    const availability = availabilityById.get(candidate.id) ?? null
    const schedule = scheduleById.get(candidate.id) ?? []
    const scheduleItems = scheduleItemsById.get(candidate.id) ?? []
    const adminCerts = adminCertsById.get(candidate.id) ?? []
    const adminEquip = adminEquipById.get(candidate.id) ?? []
    const equipmentTags = metrics?.equipmentTags ?? []
    const vehicleTypes = metrics?.vehicleTypes ?? []

    const filteredReasonCodes: string[] = []

    if (!candidate.active) filteredReasonCodes.push('TECHNICIAN_INACTIVE')
    if (!candidate.availableNow) filteredReasonCodes.push('TECHNICIAN_NOT_AVAILABLE_NOW')
    if (availability?.availabilityState === 'OFFLINE') {
      filteredReasonCodes.push('TECHNICIAN_OFFLINE')
    }

    const areaCoverage = providerCoversAddress(serviceAreas, address)
    if (!areaCoverage.covers) filteredReasonCodes.push('OUTSIDE_SERVICE_AREA')

    if (!hasRequiredSkills(jobRequest, { skills: candidate.skills, technicianSkills: techSkills })) {
      filteredReasonCodes.push('MISSING_REQUIRED_SKILL')
    }

    const missingCerts = getMissingCertifications(
      categoryRequirements.requiredCertificationCodes,
      { technicianCertifications: techCerts, adminCertifications: adminCerts }
    )
    filteredReasonCodes.push(...missingCerts.map((code) => `MISSING_REQUIRED_CERTIFICATION:${code}`))

    const missingEquip = getMissingEquipment(
      categoryRequirements.requiredEquipmentTags,
      { equipmentTags, equipment: adminEquip }
    )
    filteredReasonCodes.push(...missingEquip.map((tag) => `MISSING_REQUIRED_EQUIPMENT:${tag}`))

    if (!hasRequiredVehicles(categoryRequirements.requiredVehicleTypes, vehicleTypes)) {
      filteredReasonCodes.push('MISSING_REQUIRED_VEHICLE')
    }

    // ── Schedule fit ────────────────────────────────────────────────────────
    const scheduleRule =
      schedule.find((rule) => rule.dayOfWeek === requestWindow.startAt.getDay()) ?? null

    const workingWindow = buildWorkingWindow({
      requestStartAt: requestWindow.startAt,
      schedule: scheduleRule,
    })

    const commitments = normalizeCommitments({
      bookings: [],
      scheduleItems: scheduleItems as Parameters<typeof normalizeCommitments>[0]['scheduleItems'],
    })

    const scheduleFit = evaluateScheduleFit({
      jobRequest,
      requestAddress: address,
      workingWindow,
      technicianAvailability: availability as Parameters<typeof evaluateScheduleFit>[0]['technicianAvailability'],
      commitments,
      technicianOrigin: {
        suburb: serviceAreas.find((a) => a.active)?.label ?? candidate.serviceAreas[0] ?? null,
        city: serviceAreas.find((a) => a.city != null)?.city ?? address.city,
        lat: candidate.liveLocationLat ?? candidate.lastKnownLat,
        lng: candidate.liveLocationLng ?? candidate.lastKnownLng,
      },
      maxTravelMinutes: candidate.maxTravelMinutes,
    })

    if (!scheduleFit.isAvailable) {
      filteredReasonCodes.push(
        scheduleFit.canMeetWindow ? 'SCHEDULE_CONFLICT' : 'WINDOW_NOT_FEASIBLE'
      )
    }

    if (filteredReasonCodes.length > 0) {
      filteredOut.push({ providerId: candidate.id, providerName: candidate.name, filteredReasonCodes })
      continue
    }

    eligible.push({
      ...candidate,
      scheduleFitScore: scheduleFit.score,
      travelMinutes: scheduleFit.travelMinutes,
      canMeetWindow: scheduleFit.canMeetWindow,
      estimatedStartAt: scheduleFit.estimatedStartAt,
      estimatedEndAt: scheduleFit.estimatedEndAt,
      feasibilityNotes: candidate.verified
        ? scheduleFit.notes
        : [...scheduleFit.notes, 'Profile is still pending marketplace review'],
      coverageTier: areaCoverage.tier,
      availabilityState:
        availability?.availabilityState ?? (candidate.availableNow ? 'AVAILABLE' : 'PAUSED'),
      completedJobsCount: metrics?.completedJobsCount ?? 0,
      onTimeRate: metrics?.onTimeRate ?? 1,
      acceptanceRate: metrics?.acceptanceRate ?? 1,
      complaintCount: metrics?.complaintCount ?? 0,
      complaintRate: metrics?.complaintRate ?? 0,
      cancellationRate: metrics?.cancellationRate ?? 0,
      punctualityScore: metrics?.punctualityScore ?? 1,
      lastKnownLocationAt: metrics?.lastKnownLocationAt ?? null,
      technicianSkills: techSkills as SkillRow[],
      technicianCertifications: techCerts as CertRow[],
      technicianServiceAreas: serviceAreas as ServiceAreaRow[],
      technicianAvailability: availability,
      scheduleItems: scheduleItems as ScheduleItemRow[],
      schedule: schedule as ScheduleRow[],
      adminCertifications: adminCerts as AdminCertRow[],
      equipment: adminEquip as AdminEquipRow[],
    })
  }

  return { eligible, filteredOut }
}

// ── Utility ───────────────────────────────────────────────────────────────────

function indexByProvider<T extends { providerId: string }>(rows: T[]): Map<string, Omit<T, 'providerId'>[]> {
  const map = new Map<string, Omit<T, 'providerId'>[]>()
  for (const { providerId, ...rest } of rows) {
    const list = map.get(providerId) ?? []
    list.push(rest as Omit<T, 'providerId'>)
    map.set(providerId, list)
  }
  return map
}
