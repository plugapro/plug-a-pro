// ─── Customer home page: shared, cacheable data ──────────────────────────────
//
// The home page is where every paid ad click lands, and it was taking ~5s to
// finish on a 15KB response. TTFB was fine (~1.2s) — the rest was the response
// streaming slowly while the page awaited four sequential database round trips.
//
// None of that data is personal. resolveAreaScope, listServiceableCategoriesForArea
// and the two headline counts depend only on the selected area, so every visitor
// looking at the same area was paying to compute an identical answer. Caching it
// takes those round trips off the critical path without changing what anyone
// sees; the signed-in parts of the page (session, greeting, flags) stay dynamic.
//
// Deliberately short-lived: provider counts should track reality within minutes,
// and the tag lets an admin action revalidate immediately when it must.

import { unstable_cache } from 'next/cache'

import {
  countActiveProvidersFor,
  listServiceableCategoriesForArea,
  resolveAreaScope,
  type AreaScope,
  type ServiceableCategory,
} from './customer-serviceability'
import { db } from './db'

export interface CustomerHomeSnapshot {
  areaScope: AreaScope | null
  serviceableCategories: ServiceableCategory[]
  completedJobsCount: number
  verifiedProviderCount: number
}

export const CUSTOMER_HOME_SNAPSHOT_TAG = 'customer-home-snapshot'

/** Long enough to spare the database, short enough that coverage stays honest. */
export const CUSTOMER_HOME_SNAPSHOT_TTL_SECONDS = 300

const EMPTY_COUNTS = [0, 0] as const

export async function loadCustomerHomeSnapshot(
  areaSlug: string | null,
  serviceabilityV2Enabled: boolean,
): Promise<CustomerHomeSnapshot> {
  const areaScope = serviceabilityV2Enabled
    ? await resolveAreaScope(areaSlug).catch(() => null)
    : null

  const serviceableCategories = serviceabilityV2Enabled
    ? await listServiceableCategoriesForArea(areaScope).catch(() => [])
    : []

  const [completedJobsCount, verifiedProviderCount] = await Promise.all([
    db.job.count({ where: { status: 'COMPLETED' } }),
    serviceabilityV2Enabled && areaScope
      ? countActiveProvidersFor({ area: areaScope }).catch(() => 0)
      : db.provider.count({ where: { verified: true, active: true, status: 'ACTIVE' } }),
  ]).catch(() => EMPTY_COUNTS)

  return { areaScope, serviceableCategories, completedJobsCount, verifiedProviderCount }
}

/**
 * Cached read of the home page's shared data.
 *
 * Keyed by area and by whether serviceability v2 is on, because those are the
 * only two inputs that change the answer. A cache miss costs exactly what the
 * page used to cost every time.
 */
export async function getCustomerHomeSnapshot(
  areaSlug: string | null,
  serviceabilityV2Enabled: boolean,
): Promise<CustomerHomeSnapshot> {
  const variant = serviceabilityV2Enabled ? 'v2' : 'v1'
  const area = areaSlug?.trim().toLowerCase() || '_none'

  try {
    return await unstable_cache(
      () => loadCustomerHomeSnapshot(areaSlug, serviceabilityV2Enabled),
      ['customer-home-snapshot', variant, area],
      { revalidate: CUSTOMER_HOME_SNAPSHOT_TTL_SECONDS, tags: [CUSTOMER_HOME_SNAPSHOT_TAG] },
    )()
  } catch (error) {
    // unstable_cache needs Next's incremental cache, which is absent outside a
    // request scope (scripts, tests, and any future non-Next caller). A missing
    // cache should cost latency, never the whole page.
    console.warn('[customer-home-snapshot] cache unavailable, reading through', {
      area,
      variant,
      error: error instanceof Error ? error.message : String(error),
    })
    return loadCustomerHomeSnapshot(areaSlug, serviceabilityV2Enabled)
  }
}
