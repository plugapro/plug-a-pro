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
  verified: boolean
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
    const poolResults = await loadFromPool({ categorySlug, address, limit })
    if (poolResults.length > 0) {
      console.log('[candidate-pool] pool.hit', { categorySlug, count: poolResults.length })
      return poolResults
    }
    console.warn('[candidate-pool] pool.miss — falling back to direct scan', { categorySlug })
  }

  return loadFromDirectScan({ category, address, limit })
}

async function loadFromPool(params: {
  categorySlug: string
  address: LoadCandidatePoolParams['address']
  limit: number
}): Promise<CandidatePoolEntry[]> {
  const { categorySlug, address, limit } = params
  const staleThreshold = new Date(Date.now() - POOL_STALE_MINUTES * 60_000)

  // Try suburb-level node first, then province-level fallback
  const locationNodeId = address.locationNodeId ?? null
  const provinceKey = address.provinceKey ?? null

  const rows = await db.$queryRaw<Array<{
    id: string; name: string; phone: string; skills: string[]; serviceAreas: string[]
    maxTravelMinutes: number; reliabilityScore: number; averageRating: number
    active: boolean; verified: boolean; availableNow: boolean
    lastKnownLat: number | null; lastKnownLng: number | null
    isOnline: boolean | null; liveLocationLat: number | null; liveLocationLng: number | null
    lastHeartbeatAt: Date | null; scoreBase: number
  }>>`
    SELECT DISTINCT ON (p.id)
      p.id, p.name, p.phone, p.skills, p."serviceAreas",
      p."maxTravelMinutes", p."reliabilityScore", p."averageRating",
      p.active, p.verified, p."availableNow",
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
}): Promise<CandidatePoolEntry[]> {
  const { category, limit } = params
  const categorySlug = category.trim().toLowerCase()

  // Load all active providers who list this category in their skills. Marketplace
  // review is not a hard MVP gate for odd-job lead matching.
  const providers = await (db as any).provider.findMany({
    where: {
      active: true,
      skills: { has: category },
    },
    select: {
      id: true, name: true, phone: true, skills: true, serviceAreas: true,
      maxTravelMinutes: true, reliabilityScore: true, averageRating: true,
      active: true, verified: true, availableNow: true,
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
    active: boolean; verified: boolean; availableNow: boolean
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
    verified: p.verified,
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
