// ─── GET /api/customer/serviceability ────────────────────────────────────────
// Powers the customer PWA home page autocomplete + active-providers count card.
// No auth required: skill availability + counts are public info, used pre-login
// so first-time visitors can see whether we cover their area.
//
//   GET /api/customer/serviceability
//     → platform-wide count + pilot category list (no per-area count)
//
//   GET /api/customer/serviceability?area=<LocationNode.slug>
//     → { area: { slug, label }, totalActive, categories: [...with counts] }
//
//   GET /api/customer/serviceability?area=<slug>&category=<tag>
//     → adds { selected: { tag, label, count } }
//
// Gated by feature flag `customer.home.serviceability_v2` — when disabled,
// returns 404 so old clients fall back to the existing platform-wide count
// query in the home page server component.

import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { isEnabled } from '@/lib/flags'
import {
  countActiveProvidersFor,
  listServiceableCategoriesForArea,
  resolveAreaScope,
} from '@/lib/customer-serviceability'
import { PILOT_SKILL_TAGS } from '@/lib/service-categories'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const flagOn = await isEnabled('customer.home.serviceability_v2')
  if (!flagOn) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  const { searchParams } = new URL(req.url)
  const areaSlug = searchParams.get('area')
  const categoryTag = searchParams.get('category')?.trim().toLowerCase() ?? null

  const area = await resolveAreaScope(areaSlug)
  const categories = await listServiceableCategoriesForArea(area)
  const totalActive = await countActiveProvidersFor({ area })

  const payload: {
    area: { slug: string; label: string } | null
    totalActive: number
    categories: Array<{ tag: string; label: string; activeProviderCount: number }>
    selected?: { tag: string; label: string; count: number; serviceable: boolean }
  } = {
    area: area ? { slug: area.node.slug, label: area.node.label } : null,
    totalActive,
    categories,
  }

  if (categoryTag) {
    if (!PILOT_SKILL_TAGS.has(categoryTag)) {
      payload.selected = { tag: categoryTag, label: categoryTag, count: 0, serviceable: false }
    } else {
      const count = await countActiveProvidersFor({ area, categoryTag })
      const fromList = categories.find((c) => c.tag === categoryTag)
      payload.selected = {
        tag: categoryTag,
        label: fromList?.label ?? categoryTag,
        count,
        serviceable: count > 0,
      }
    }
  }

  return NextResponse.json(payload, {
    // Light caching at the edge so a busy area doesn't slam Postgres with
    // duplicate counts. Browsers still see fresh data because we revalidate
    // every 30s and the area/category combo is short-list-cacheable.
    headers: { 'Cache-Control': 'public, max-age=15, s-maxage=30, stale-while-revalidate=60' },
  })
}
