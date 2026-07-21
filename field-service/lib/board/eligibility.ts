// Provider lead board: pure eligibility query over job requests whose push
// offers all lapsed. Spec: docs/superpowers/specs/2026-07-21-provider-lead-board-design.md §1.
// READ-ONLY module: no writes of any kind live here (data-safety constraint).
import { pointFallsWithinRadius } from '@/lib/matching/geography'

const OPEN_INTEREST_STATUSES = ['INTERESTED', 'SHORTLISTED', 'CUSTOMER_SELECTED'] as const
export const BOARD_INTEREST_CAP = 3

export function boardEligibilityWhere(now: Date) {
  return {
    status: { in: ['OPEN', 'MATCHING'] },
    match: null,
    assignmentHolds: { none: { status: 'ACTIVE' } },
    leads: { none: { status: { in: ['SENT', 'VIEWED'] }, expiresAt: { gt: now } } },
    AND: [
      { OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] },
      { OR: [{ requestedWindowEnd: null }, { requestedWindowEnd: { gt: now } }] },
      { leads: { some: {} } }, // push was attempted at least once
    ],
  }
}

export type BoardJob = {
  id: string
  category: string
  title: string | null
  description: string | null
  suburbLabel: string | null
  requestedWindowStart: Date | null
  requestedWindowEnd: Date | null
  createdAt: Date
  interestCount: number
}

type BoardFilters = { category?: string; suburbQuery?: string }

export async function findBoardJobsForProvider(
  client: any, // TODO: narrow to the Prisma Pick actually used; kept wide for DI in unit tests
  providerId: string,
  filters: BoardFilters = {},
  now: Date = new Date(),
): Promise<BoardJob[]> {
  const provider = await client.provider.findUnique({
    where: { id: providerId },
    select: { id: true, active: true, verified: true, skills: true },
  })
  if (!provider?.active || !provider.verified) return []

  const areas = await client.technicianServiceArea.findMany({
    where: { providerId },
    select: { locationNodeId: true, suburbKey: true, areaType: true, lat: true, lng: true, radiusKm: true },
  })
  if (areas.length === 0) return []

  const nodeIds = new Set(areas.map((a: any) => a.locationNodeId).filter(Boolean))
  const suburbKeys = new Set(
    areas.map((a: any) => (a.suburbKey ?? '').toLowerCase()).filter(Boolean),
  )
  const radiusAreas = areas.filter(
    (a: any) => a.areaType === 'RADIUS' && a.lat != null && a.lng != null && a.radiusKm != null,
  )

  const skills = new Set((provider.skills ?? []).map((s: string) => s.toLowerCase()))

  const candidates = await client.jobRequest.findMany({
    where: {
      ...boardEligibilityWhere(now),
      ...(filters.category ? { category: filters.category } : {}),
    },
    select: {
      id: true, category: true, title: true, description: true,
      requestedWindowStart: true, requestedWindowEnd: true, createdAt: true,
      address: { select: { locationNodeId: true, suburb: true, lat: true, lng: true } },
      leads: { where: { status: { in: [...OPEN_INTEREST_STATUSES] } }, select: { status: true } },
    },
    orderBy: { createdAt: 'desc' },
    take: 100,
  })

  const q = (filters.suburbQuery ?? '').trim().toLowerCase()

  const categoryFilter = filters.category ? filters.category.toLowerCase() : null

  return candidates
    .filter((jr: any) => skills.has(String(jr.category ?? '').toLowerCase()))
    .filter((jr: any) => !categoryFilter || String(jr.category ?? '').toLowerCase() === categoryFilter)
    .filter((jr: any) => {
      const addr = jr.address
      if (!addr) return false
      if (addr.locationNodeId && nodeIds.has(addr.locationNodeId)) return true
      if (addr.suburb && suburbKeys.has(String(addr.suburb).toLowerCase())) return true
      if (addr.lat != null && addr.lng != null) {
        return radiusAreas.some((a: any) =>
          pointFallsWithinRadius({
            center: { lat: a.lat, lng: a.lng },
            point: { lat: addr.lat, lng: addr.lng },
            radiusKm: a.radiusKm,
          }),
        )
      }
      return false
    })
    .filter((jr: any) => jr.leads.length < BOARD_INTEREST_CAP)
    .filter((jr: any) => (q ? String(jr.address?.suburb ?? '').toLowerCase().includes(q) : true))
    .map((jr: any) => ({
      id: jr.id,
      category: jr.category,
      title: jr.title,
      description: jr.description,
      suburbLabel: jr.address?.suburb ?? null,
      requestedWindowStart: jr.requestedWindowStart,
      requestedWindowEnd: jr.requestedWindowEnd,
      createdAt: jr.createdAt,
      interestCount: jr.leads.length,
    }))
}
