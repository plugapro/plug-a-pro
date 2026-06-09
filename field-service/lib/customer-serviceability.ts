// ─── Customer serviceability ─────────────────────────────────────────────────
// Single source of truth for "is this skill bookable in this area?" used by:
//   - GET /api/customer/serviceability (powers the home autocomplete + counts)
//   - Customer PWA home page (count card + browse-tile gating)
//   - Customer request-creation handlers (server-side 422 enforcement)
//
// "Active" means the same set of provider predicates we already use elsewhere:
//   active = true AND verified = true AND status = 'ACTIVE'
//   AND isTestUser = false
//   AND (suspendedUntil IS NULL OR suspendedUntil < now)
//
// Skill → provider matching mirrors /providers route:
//   provider has either an APPROVED ProviderCategory for the slug,
//   or (legacy) Provider.skills contains the slug.
//
// Area → provider matching uses the structured TechnicianServiceArea FK first
// (locationNodeId match for SUBURB-scope nodes; provinceKey for broader scopes)
// and the legacy free-text Provider.serviceAreas slug match as a fallback. The
// /providers route currently only honours the legacy match — this module is
// purposely additive: structured + legacy together never reduce coverage.
//
// All public functions are pure reads. No writes, no side effects.

import { db } from '@/lib/db'
import { isEnabled } from '@/lib/flags'
import { getElectricalReadiness } from '@/lib/launch/electrical-readiness'
import { isPilotCategorySlug, isPilotSuburbSlug } from '@/lib/launch/west-rand-pilot'
import { canonicalizeServiceCategoryValue } from '@/lib/service-category-canonicalization'
import { PILOT_SKILL_TAGS, SERVICE_CATEGORY_OPTIONS } from '@/lib/service-categories'
import type { LocationNode, Prisma } from '@prisma/client'

export type AreaScope = {
  node: Pick<
    LocationNode,
    'id' | 'slug' | 'label' | 'nodeType' | 'provinceKey' | 'cityKey' | 'regionKey'
  >
}

export type ServiceableCategory = {
  tag: string
  label: string
  activeProviderCount: number // bounded by COUNT_BOUND
}

const COUNT_BOUND = 101

// Cap counter results so a popular area doesn't pull thousands of rows just for
// the UI badge. Mirrors candidate-pool.ts COUNT_BOUND.
function capped(n: number): number {
  return Math.min(n, COUNT_BOUND)
}

// Resolve a `?area=<slug>` URL parameter to a LocationNode. Returns null when
// the slug doesn't match any active node — callers should treat that as
// "no area selected" and surface the platform-wide default UX.
export async function resolveAreaScope(areaSlug: string | null | undefined): Promise<AreaScope | null> {
  const slug = areaSlug?.trim()
  if (!slug) return null
  const node = await db.locationNode.findUnique({
    where: { slug },
    select: {
      id: true,
      slug: true,
      label: true,
      nodeType: true,
      provinceKey: true,
      cityKey: true,
      regionKey: true,
      active: true,
    },
  })
  if (!node || !node.active) return null
  // Strip the active flag before exposing — callers never need it and TypeScript
  // shouldn't have to deal with the extra discriminator.
  const { active: _active, ...rest } = node
  return { node: rest }
}

// Same as resolveAreaScope but keyed by LocationNode.id. Used by the request
// creation handler which already has the FK in hand.
export async function resolveAreaScopeByNodeId(nodeId: string | null | undefined): Promise<AreaScope | null> {
  const id = nodeId?.trim()
  if (!id) return null
  const node = await db.locationNode.findUnique({
    where: { id },
    select: {
      id: true,
      slug: true,
      label: true,
      nodeType: true,
      provinceKey: true,
      cityKey: true,
      regionKey: true,
      active: true,
    },
  })
  if (!node || !node.active) return null
  const { active: _active, ...rest } = node
  return { node: rest }
}

// Predicate that matches providers serving the given area. Combined with the
// "active provider" predicate via Prisma AND in the count/list queries below.
//
// Strategy (additive, matches /providers route widening):
//   - if node is SUBURB: match TechnicianServiceArea.locationNodeId = node.id
//                        OR legacy Provider.serviceAreas contains node.label
//                        OR (denormalised) TechnicianServiceArea matches the
//                           regionKey / cityKey / provinceKey upward chain so
//                           a suburb-coverage selection still surfaces providers
//                           who only listed the region/city
//   - if node is REGION/CITY/PROVINCE: match via the appropriate *Key column
//     on TechnicianServiceArea + legacy Provider.serviceAreas free-text.
export function buildAreaProviderWhere(area: AreaScope): Prisma.ProviderWhereInput {
  const { node } = area
  const orConditions: Prisma.ProviderWhereInput[] = []

  // Always honour the structured FK if we have one.
  orConditions.push({
    technicianServiceAreas: { some: { active: true, locationNodeId: node.id } },
  })

  // Denormalised key match — covers the case where a provider listed a parent
  // (e.g. they cover the whole region) and the customer picked a child suburb.
  if (node.regionKey) {
    orConditions.push({
      technicianServiceAreas: { some: { active: true, regionKey: node.regionKey } },
    })
  }
  if (node.cityKey) {
    orConditions.push({
      technicianServiceAreas: { some: { active: true, cityKey: node.cityKey } },
    })
  }
  if (node.provinceKey) {
    orConditions.push({
      technicianServiceAreas: { some: { active: true, provinceKey: node.provinceKey } },
    })
  }

  // Legacy free-text — keep parity with /providers route's existing filter.
  orConditions.push({ serviceAreas: { has: node.label } })
  orConditions.push({ serviceAreas: { has: node.slug } })

  return { OR: orConditions }
}

// Predicate that matches providers offering the given category slug.
// Mirrors the /providers route logic: prefer ProviderCategory (APPROVED) and
// fall back to legacy Provider.skills for providers without ProviderCategory rows.
export function buildCategoryProviderWhere(categoryTag: string): Prisma.ProviderWhereInput {
  return {
    OR: [
      {
        providerCategories: {
          some: { categorySlug: categoryTag, approvalStatus: 'APPROVED' },
        },
      },
      {
        AND: [
          { providerCategories: { none: {} } },
          { skills: { has: categoryTag } },
        ],
      },
    ],
  }
}

// Base predicate for an "active" provider in business terms. Excludes test
// users from real customer-facing counts.
export function activeProviderWhere(now: Date): Prisma.ProviderWhereInput {
  return {
    active: true,
    verified: true,
    status: 'ACTIVE',
    isTestUser: false,
    OR: [{ suspendedUntil: null }, { suspendedUntil: { lt: now } }],
  }
}

// Count active providers either platform-wide (no area) or scoped to an area
// and an optional category tag. Returns a value bounded by COUNT_BOUND so the
// UI can render an "N+" indicator without scanning huge result sets.
export async function countActiveProvidersFor(params: {
  area?: AreaScope | null
  categoryTag?: string | null
}): Promise<number> {
  const { area, categoryTag } = params
  const now = new Date()

  const where: Prisma.ProviderWhereInput = {
    AND: [
      activeProviderWhere(now),
      ...(area ? [buildAreaProviderWhere(area)] : []),
      ...(categoryTag ? [buildCategoryProviderWhere(categoryTag)] : []),
    ],
  }

  // Use findMany with take=COUNT_BOUND + length so we don't walk past the cap.
  const rows = await db.provider.findMany({
    where,
    select: { id: true },
    take: COUNT_BOUND,
  })
  return capped(rows.length)
}

// Build the set of categories that have at least one active provider serving
// the area. When no area is supplied, returns the full pilot catalogue with
// platform-wide counts so the autocomplete still has something to show
// pre-area-selection (used in design-time mocks; production callers always
// scope by area before showing the typeahead).
export async function listServiceableCategoriesForArea(area: AreaScope | null): Promise<ServiceableCategory[]> {
  const now = new Date()

  // Pull the active DB categories — the source of truth for what's allowed —
  // intersected with PILOT_SKILL_TAGS so regulated trades stay hidden until
  // the vetting pipeline is ready.
  const dbCategories = await db.category.findMany({
    where: { active: true, slug: { in: Array.from(PILOT_SKILL_TAGS) } },
    select: { slug: true, label: true, sortOrder: true },
    orderBy: { sortOrder: 'asc' },
  })

  // Fallback labels when the DB category row exists but has an empty label, or
  // when the DB has fewer rows than the pilot catalogue. Mirrors the static
  // labels users see on the home page tiles.
  const fallbackLabels = new Map(
    SERVICE_CATEGORY_OPTIONS.map((option) => [option.tag, option.label]),
  )

  const baseCategories = dbCategories.length > 0
    ? dbCategories.map((c) => ({
        tag: c.slug,
        label: c.label?.trim() || fallbackLabels.get(c.slug) || c.slug,
      }))
    : Array.from(PILOT_SKILL_TAGS).map((tag) => ({
        tag,
        label: fallbackLabels.get(tag) ?? tag,
      }))

  // Count active providers per category in the area. Sequential awaits would
  // be fine but Promise.all keeps total latency to ~one round-trip on the pool.
  const results = await Promise.all(
    baseCategories.map(async (cat) => {
      const where: Prisma.ProviderWhereInput = {
        AND: [
          activeProviderWhere(now),
          ...(area ? [buildAreaProviderWhere(area)] : []),
          buildCategoryProviderWhere(cat.tag),
        ],
      }
      const rows = await db.provider.findMany({
        where,
        select: { id: true },
        take: COUNT_BOUND,
      })
      return { ...cat, activeProviderCount: capped(rows.length) } satisfies ServiceableCategory
    }),
  )

  // Sort: serviceable first, then by descending count, then alphabetically.
  return results.sort((a, b) => {
    if ((a.activeProviderCount > 0) !== (b.activeProviderCount > 0)) {
      return a.activeProviderCount > 0 ? -1 : 1
    }
    if (a.activeProviderCount !== b.activeProviderCount) {
      return b.activeProviderCount - a.activeProviderCount
    }
    return a.label.localeCompare(b.label)
  })
}

// Boolean convenience for backend enforcement at request-creation time:
// "is this (area, category) tuple something we can actually fulfil?"
export async function isAreaCategoryServiceable(params: {
  areaSlug: string | null | undefined
  categoryTag: string | null | undefined
}): Promise<boolean> {
  const { areaSlug, categoryTag } = params
  if (!categoryTag) return false
  if (!PILOT_SKILL_TAGS.has(categoryTag)) return false
  const area = await resolveAreaScope(areaSlug)
  if (!area) return false
  const count = await countActiveProvidersFor({ area, categoryTag })
  return count > 0
}

export { COUNT_BOUND as SERVICEABILITY_COUNT_BOUND }

// ─── West Rand pilot gate ────────────────────────────────────────────────────
// Layered defence on top of the existing isAreaCategoryServiceable check.
// Single source of truth used by the customer serviceability route, the
// bookings POST handler, the create-job-request persistence seam, and the
// quote-approve handler. Returns a discriminated union so callers can map to
// specific error codes (pilot.suburb_not_supported, pilot.category_not_supported,
// pilot.electrical_disabled) and return the standard API error envelope.

export type PilotGateResult =
  | { ok: true }
  | {
      ok: false
      code:
        | 'pilot.suburb_not_supported'
        | 'pilot.category_not_supported'
        | 'pilot.electrical_disabled'
    }

export async function checkPilotGate(params: {
  suburbSlug: string | null | undefined
  rawCategory: string | null | undefined
}): Promise<PilotGateResult> {
  const masterOn = await isEnabled('launch.west_rand_pilot.enabled')
  if (!masterOn) return { ok: true }

  if (!isPilotSuburbSlug(params.suburbSlug)) {
    return { ok: false, code: 'pilot.suburb_not_supported' }
  }

  const canonical = canonicalizeServiceCategoryValue(params.rawCategory).canonical
  if (!canonical || !isPilotCategorySlug(canonical)) {
    return { ok: false, code: 'pilot.category_not_supported' }
  }

  // Dead path in v1 — electrical is not in allowedCategorySlugs, so we never
  // reach here with canonical === 'electrical'. The branch is kept for when
  // electrical is re-introduced behind the readiness gate.
  if (canonical === 'electrical') {
    const electricalGateOn = await isEnabled('launch.west_rand_pilot.electrical_gate')
    if (electricalGateOn) {
      const readiness = await getElectricalReadiness()
      if (!readiness.ready) {
        return { ok: false, code: 'pilot.electrical_disabled' }
      }
    }
  }

  return { ok: true }
}
