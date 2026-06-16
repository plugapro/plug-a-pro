// ─── Candidate Pool ───────────────────────────────────────────────────────────
// Loads provider candidates for a match from the precomputed candidate_pool table.
// Falls back to a direct provider scan if the pool is stale or empty.
//
// Pool is rebuilt by:
//   - Cron every 5 min: POST /api/internal/cron/rebuild-candidate-pool
//   - On provider profile update (skills, service areas, active status changes)
//
// Pool freshness: entries older than 10 min are treated as stale → direct scan.

import { db } from '@/lib/db'

export type CandidatePoolEntry = {
  id: string
  name: string
  phone: string
  skills: string[]
  serviceAreas: string[]
  maxTravelMinutes: number
  reliabilityScore: number
  averageRating: number
  active: boolean
  isTestUser?: boolean
  cohortName?: string | null
  verified: boolean
  kycStatus: string | null
  availableNow: boolean
  lastKnownLat: number | null
  lastKnownLng: number | null
  // Live status (joined from provider_live_status)
  isOnline: boolean | null
  liveLocationLat: number | null
  liveLocationLng: number | null
  lastHeartbeatAt: Date | null
  // Pool metadata
  scoreBase: number
  fromPool: boolean
}

type LoadCandidatePoolParams = {
  category: string
  address: {
    suburb: string | null
    city: string | null
    lat: number | null
    lng: number | null
    locationNodeId?: string | null
    provinceKey?: string | null
  }
  isTestRequest?: boolean
  limit?: number
  usePool?: boolean
}

const POOL_STALE_MINUTES = 10

export async function loadCandidatePool(
  params: LoadCandidatePoolParams
): Promise<CandidatePoolEntry[]> {
  const { category, address, limit = 30, usePool = true } = params
  const categorySlug = category.trim().toLowerCase()

  if (usePool) {
    const poolResults = await loadFromPool({ categorySlug, address, limit, isTestRequest: Boolean(params.isTestRequest) })
    if (poolResults.length > 0) {
      console.log('[candidate-pool] pool.hit', { categorySlug, count: poolResults.length })
      return poolResults
    }
    console.warn('[candidate-pool] pool.miss - falling back to direct scan', { categorySlug })
  }

  return loadFromDirectScan({ category, address, limit, isTestRequest: Boolean(params.isTestRequest) })
}

async function loadFromPool(params: {
  categorySlug: string
  address: LoadCandidatePoolParams['address']
  limit: number
  isTestRequest: boolean
}): Promise<CandidatePoolEntry[]> {
  const { categorySlug, address, limit, isTestRequest } = params
  const staleThreshold = new Date(Date.now() - POOL_STALE_MINUTES * 60_000)

  // Try suburb-level node first, then province-level fallback
  const locationNodeId = address.locationNodeId ?? null
  const provinceKey = address.provinceKey ?? null

  const rows = await db.$queryRaw<Array<{
    id: string; name: string; phone: string; skills: string[]; serviceAreas: string[]
    maxTravelMinutes: number; reliabilityScore: number; averageRating: number
    active: boolean; verified: boolean; kycStatus: string | null; availableNow: boolean; isTestUser: boolean; cohortName: string | null
    lastKnownLat: number | null; lastKnownLng: number | null
    isOnline: boolean | null; liveLocationLat: number | null; liveLocationLng: number | null
    lastHeartbeatAt: Date | null; scoreBase: number
  }>>`
    SELECT DISTINCT ON (p.id)
      p.id, p.name, p.phone, p.skills, p."serviceAreas",
      p."maxTravelMinutes", p."reliabilityScore", p."averageRating",
      p.active, p.verified, p."kycStatus", p."availableNow", p."isTestUser", p."cohortName",
      p."lastKnownLat", p."lastKnownLng",
      pls."isOnline", pls."lastLocationLat" AS "liveLocationLat",
      pls."lastLocationLng" AS "liveLocationLng", pls."lastHeartbeatAt",
      cp."scoreBase"
    FROM candidate_pool cp
    JOIN providers p ON p.id = cp."providerId"
    LEFT JOIN provider_live_status pls ON pls."providerId" = p.id
    WHERE
      cp."categorySlug" = ${categorySlug}
      AND cp."lastRefreshed" > ${staleThreshold}
      AND p.active = true
      AND p."isTestUser" = ${isTestRequest}
      AND p.verified = true
      AND p.status = 'ACTIVE'
      AND (
        (${locationNodeId}::text IS NOT NULL AND cp."locationNodeId" = ${locationNodeId})
        OR
        (${provinceKey}::text IS NOT NULL AND cp."provinceKey" = ${provinceKey})
      )
    ORDER BY p.id, cp."scoreBase" DESC
    LIMIT ${limit}
  `

  return rows.map((r) => ({ ...r, fromPool: true }))
}

async function loadFromDirectScan(params: {
  category: string
  address: LoadCandidatePoolParams['address']
  limit: number
  isTestRequest: boolean
}): Promise<CandidatePoolEntry[]> {
  const { category, address, limit } = params

  // Sequential fallback (per scope decision 2026-06-06):
  //   1. Try suburb-level conditions only (locationNodeId FK + legacy free-text).
  //   2. ONLY if that returns 0, retry with province-level conditions.
  //   3. If neither yields a query, return [] — never scan the world.
  // The previous "OR both at once" shape was effectively province-wide whenever
  // provinceKey was set, because providers with any service area in the province
  // would match. The sequential shape mirrors the user's explicit fallback choice.
  const suburbConditions = buildSuburbLevelConditions(address)
  if (suburbConditions.length > 0) {
    const suburbResults = await directScanWithConditions({
      category,
      conditions: suburbConditions,
      limit,
      isTestRequest: params.isTestRequest,
    })
    if (suburbResults.length > 0) return suburbResults
  }

  const provinceConditions = buildProvinceLevelConditions(address)
  if (provinceConditions.length === 0) return []

  return directScanWithConditions({
    category,
    conditions: provinceConditions,
    limit,
    isTestRequest: params.isTestRequest,
  })
}

async function directScanWithConditions(params: {
  category: string
  conditions: Array<Record<string, unknown>>
  limit: number
  isTestRequest: boolean
}): Promise<CandidatePoolEntry[]> {
  const { category, conditions, limit, isTestRequest } = params

  // Load active providers who serve the area AND list this category in their
  // skills. Marketplace review is not a hard MVP gate for odd-job lead matching.
  const providers = await (db as any).provider.findMany({
    where: {
      active: true,
      verified: true,
      status: 'ACTIVE',
      isTestUser: isTestRequest,
      skills: { has: category },
      OR: conditions,
    },
    select: {
      id: true, name: true, phone: true, skills: true, serviceAreas: true,
      isTestUser: true, cohortName: true,
      maxTravelMinutes: true, reliabilityScore: true, averageRating: true,
      active: true, verified: true, kycStatus: true, availableNow: true,
      lastKnownLat: true, lastKnownLng: true,
      liveStatus: {
        select: {
          isOnline: true,
          lastLocationLat: true,
          lastLocationLng: true,
          lastHeartbeatAt: true,
        },
      },
    },
    take: limit,
  }) as Array<{
    id: string; name: string; phone: string; skills: string[]; serviceAreas: string[]
    maxTravelMinutes: number; reliabilityScore: number; averageRating: number
    active: boolean; verified: boolean; kycStatus: string | null; availableNow: boolean; isTestUser: boolean; cohortName: string | null
    lastKnownLat: number | null; lastKnownLng: number | null
    liveStatus?: { isOnline: boolean; lastLocationLat: number | null; lastLocationLng: number | null; lastHeartbeatAt: Date | null } | null
  }>

  return providers.map((p) => ({
    id: p.id,
    name: p.name,
    phone: p.phone,
    skills: p.skills,
    serviceAreas: p.serviceAreas,
    maxTravelMinutes: p.maxTravelMinutes,
    reliabilityScore: p.reliabilityScore,
    averageRating: p.averageRating,
    active: p.active,
    isTestUser: p.isTestUser,
    cohortName: p.cohortName,
    verified: p.verified,
    kycStatus: p.kycStatus ?? null,
    availableNow: p.availableNow,
    lastKnownLat: p.lastKnownLat,
    lastKnownLng: p.lastKnownLng,
    isOnline: p.liveStatus?.isOnline ?? null,
    liveLocationLat: p.liveStatus?.lastLocationLat ?? null,
    liveLocationLng: p.liveStatus?.lastLocationLng ?? null,
    lastHeartbeatAt: p.liveStatus?.lastHeartbeatAt ?? null,
    scoreBase: p.reliabilityScore * 0.6 + (p.averageRating / 5) * 0.4,
    fromPool: false,
  }))
}

// ── Location conditions (shared by direct-scan + diagnostics) ────────────────
// Split into suburb-level and province-level so callers can choose between a
// tight scope (suburb only) and a fallback widening (province). Each function
// returns a list of WHERE conditions to OR together inside its own scope.

// Suburb-level: structured LocationNode FK match + legacy free-text suburb/city
// matches on the Provider.serviceAreas string[]. These represent providers who
// have explicitly listed THIS suburb/city in their coverage.
export function buildSuburbLevelConditions(
  address: LoadCandidatePoolParams['address']
): Array<Record<string, unknown>> {
  const conditions: Array<Record<string, unknown>> = []
  if (address.locationNodeId) {
    conditions.push({
      technicianServiceAreas: {
        some: { active: true, locationNodeId: address.locationNodeId },
      },
    })
  }
  if (address.suburb) conditions.push({ serviceAreas: { has: address.suburb } })
  if (address.city) conditions.push({ serviceAreas: { has: address.city } })
  return conditions
}

// Province-level fallback: provincKey FK match. This is the broadest tier we
// allow — it matches any provider with at least one active service area row
// anywhere in the province. Only run when suburb-level returned 0 results.
export function buildProvinceLevelConditions(
  address: LoadCandidatePoolParams['address']
): Array<Record<string, unknown>> {
  if (!address.provinceKey) return []
  return [
    {
      technicianServiceAreas: {
        some: { active: true, provinceKey: address.provinceKey },
      },
    },
  ]
}

// Backwards-compat union helper — convenience for diagnostic queries that just
// want to know "does ANY provider serve this address at any tier."
export function buildLocationConditions(
  address: LoadCandidatePoolParams['address']
): Array<Record<string, unknown>> {
  return [...buildSuburbLevelConditions(address), ...buildProvinceLevelConditions(address)]
}

// ── Diagnostic count (used by no-match reason classification) ────────────────
// Counts providers serving the address, IGNORING skill/category. Used to decide
// between NO_LOCATION_MATCH (count=0) and NO_SKILL_MATCH_IN_LOCATION (count>0,
// but candidate pool returned 0).
//
// Bounded by `take: COUNT_BOUND` so this never walks the full set on a
// province-fallback query. The classifier only needs 0 vs >0; ops dashboards
// see "100+" as a saturated value when the cap is hit.
const COUNT_BOUND = 101

export async function countProvidersInLocation(params: {
  address: LoadCandidatePoolParams['address']
  isTestRequest: boolean
}): Promise<number> {
  const conditions = buildLocationConditions(params.address)
  if (conditions.length === 0) return 0

  const rows = await db.provider.findMany({
    where: {
      active: true,
      verified: true,
      status: 'ACTIVE',
      isTestUser: params.isTestRequest,
      OR: conditions,
    },
    select: { id: true },
    take: COUNT_BOUND,
  })
  return rows.length
}

// ── Pool rebuild ──────────────────────────────────────────────────────────────

export async function rebuildCandidatePoolForProvider(providerId: string): Promise<void> {
  // Delete stale entries then rebuild inline
  await db.$executeRaw`DELETE FROM candidate_pool WHERE "providerId" = ${providerId}`
  await db.$executeRaw`
    INSERT INTO candidate_pool ("categorySlug", "locationNodeId", "provinceKey", "providerId", "scoreBase", "lastRefreshed")
    SELECT
      lower(trim(skill)),
      tsa."locationNodeId",
      ln."provinceKey",
      p.id,
      (COALESCE(p."reliabilityScore", 0.5) * 0.6 + COALESCE(p."averageRating", 3.0) / 5.0 * 0.4),
      now()
    FROM providers p
    CROSS JOIN LATERAL unnest(p.skills) AS skill
    JOIN technician_service_areas tsa ON tsa."providerId" = p.id AND tsa.active = true
    LEFT JOIN location_nodes ln ON ln.id = tsa."locationNodeId"
    WHERE p.id = ${providerId}
      AND p.active = true
    ON CONFLICT ("categorySlug", "locationNodeId", "providerId")
    DO UPDATE SET "scoreBase" = EXCLUDED."scoreBase", "lastRefreshed" = now()
  `
}

export async function rebuildCandidatePoolForCategory(categorySlug: string): Promise<number> {
  const result = await db.$executeRaw`
    INSERT INTO candidate_pool ("categorySlug", "locationNodeId", "provinceKey", "providerId", "scoreBase", "lastRefreshed")
    SELECT
      ${categorySlug}::text,
      tsa."locationNodeId",
      ln."provinceKey",
      p.id,
      (COALESCE(p."reliabilityScore", 0.5) * 0.6 + COALESCE(p."averageRating", 3.0) / 5.0 * 0.4),
      now()
    FROM providers p
    JOIN technician_service_areas tsa ON tsa."providerId" = p.id AND tsa.active = true
    LEFT JOIN location_nodes ln ON ln.id = tsa."locationNodeId"
    WHERE p.active = true
      AND ${categorySlug} = ANY(lower(p.skills::text)::text[])
    ON CONFLICT ("categorySlug", "locationNodeId", "providerId")
    DO UPDATE SET "scoreBase" = EXCLUDED."scoreBase", "lastRefreshed" = now()
  `
  return Number(result)
}
