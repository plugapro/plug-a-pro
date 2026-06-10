// ─── West Rand pilot — readiness counts loader ──────────────────────────────
// Fetches the data backing the /admin/launch-readiness page:
//   - electrical readiness (delegates to getElectricalReadiness)
//   - thin-coverage warnings per allowed category
//   - per-suburb × category approved-provider counts
//   - tier breakdown across all relevant providers
//
// Pure rolling-up of one DB query; no per-provider follow-up queries. Safe to
// run on every admin page load. If the pilot grows beyond a few hundred
// providers, swap to a Prisma groupBy or materialised view (out of scope).

import { db } from '@/lib/db'

import {
  classifyProviderTier,
  type ProviderTier,
  type ProviderTierInput,
} from '@/lib/provider-tier'

import { getElectricalReadiness, type ElectricalReadiness } from './electrical-readiness'
import { WEST_RAND_PILOT } from './west-rand-pilot'

const THIN_COVERAGE_THRESHOLD = 3

export type SuburbCategoryCount = {
  suburbSlug: string
  suburbLabel: string
  categorySlug: string
  approvedProviderCount: number
}

export type TierCount = {
  tier: ProviderTier
  count: number
}

export type LaunchReadiness = {
  electrical: ElectricalReadiness
  thinCoverageCategories: string[]
  suburbCategoryCounts: SuburbCategoryCount[]
  tierBreakdown: TierCount[]
}

type ProviderRow = ProviderTierInput & {
  id: string
  identityVerifications?: Array<{ assuranceLevel: 'LOW' | 'MEDIUM' | 'HIGH' | null }>
  applications?: Array<{ status: ProviderTierInput['applicationStatus'] }>
}

function toTierInput(row: ProviderRow): ProviderTierInput {
  // Latest verification's assurance (rows are ordered desc by createdAt in
  // the query below). Falls back to null which the classifier treats as R3.
  const latestAssurance = row.identityVerifications?.[0]?.assuranceLevel ?? null
  const latestApplication = row.applications?.[0]
  return {
    verified: row.verified,
    kycStatus: row.kycStatus,
    status: row.status,
    strikes: row.strikes,
    name: row.name,
    phone: row.phone,
    email: row.email,
    payoutVerifiedAt: row.payoutVerifiedAt,
    skills: row.skills,
    equipmentTags: row.equipmentTags,
    serviceAreas: row.serviceAreas,
    identityAssurance: latestAssurance,
    hasApplication: Boolean(latestApplication),
    applicationStatus: latestApplication?.status ?? null,
  }
}

export async function loadLaunchReadiness(): Promise<LaunchReadiness> {
  const [electrical, providerRows] = await Promise.all([
    getElectricalReadiness(),
    db.provider.findMany({
      select: {
        id: true,
        verified: true,
        kycStatus: true,
        status: true,
        strikes: true,
        name: true,
        phone: true,
        email: true,
        payoutVerifiedAt: true,
        skills: true,
        equipmentTags: true,
        serviceAreas: true,
        identityVerifications: {
          select: { assuranceLevel: true },
          orderBy: { createdAt: 'desc' },
          take: 1,
        },
        applications: {
          select: { status: true },
          orderBy: { submittedAt: 'desc' },
          take: 1,
        },
      },
    }) as unknown as Promise<ProviderRow[]>,
  ])

  // Build suburb-label lookup from the pilot config; falls back to the slug
  // tail when no label is available.
  const labelForSlug = (slug: string): string => {
    const tail = slug.split('__').pop() ?? slug
    return tail
      .split('_')
      .map((s) => s.charAt(0).toUpperCase() + s.slice(1))
      .join(' ')
  }

  // ── Per-suburb × category approved counts ─────────────────────────────────
  // "Approved provider for (suburb, category)" =
  //   status=ACTIVE && verified=true && skills includes category
  //                && serviceAreas includes suburb slug
  const suburbCategoryCounts: SuburbCategoryCount[] = []
  for (const suburbSlug of WEST_RAND_PILOT.activeSuburbSlugs) {
    for (const categorySlug of WEST_RAND_PILOT.allowedCategorySlugs) {
      const count = providerRows.filter(
        (p) =>
          p.status === 'ACTIVE' &&
          p.verified === true &&
          p.skills.includes(categorySlug) &&
          p.serviceAreas.includes(suburbSlug),
      ).length
      suburbCategoryCounts.push({
        suburbSlug,
        suburbLabel: labelForSlug(suburbSlug),
        categorySlug,
        approvedProviderCount: count,
      })
    }
  }

  // ── Thin coverage warnings ────────────────────────────────────────────────
  // Per spec: any allowed category with fewer than 3 approved providers across
  // the entire pilot footprint is "thin". Aggregated, not per-suburb.
  const thinCoverageCategories = WEST_RAND_PILOT.allowedCategorySlugs.filter(
    (categorySlug) => {
      const approvedForCategory = providerRows.filter(
        (p) =>
          p.status === 'ACTIVE' &&
          p.verified === true &&
          p.skills.includes(categorySlug),
      ).length
      return approvedForCategory < THIN_COVERAGE_THRESHOLD
    },
  )

  // ── Tier breakdown ────────────────────────────────────────────────────────
  const tierTallies: Partial<Record<ProviderTier, number>> = {}
  for (const row of providerRows) {
    const tier = classifyProviderTier(toTierInput(row))
    if (!tier) continue // excluded (suspended/banned/archived)
    tierTallies[tier] = (tierTallies[tier] ?? 0) + 1
  }
  const tierBreakdown: TierCount[] = (Object.keys(tierTallies) as ProviderTier[])
    .map((tier) => ({ tier, count: tierTallies[tier]! }))

  return {
    electrical,
    thinCoverageCategories,
    suburbCategoryCounts,
    tierBreakdown,
  }
}
