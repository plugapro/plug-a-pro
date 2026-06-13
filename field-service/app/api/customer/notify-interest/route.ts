// ─── POST /api/customer/notify-interest ──────────────────────────────────────
// Public capture endpoint behind `customer.home.notify_interest`. Records demand
// when a visitor taps a "Coming soon" category tile on the customer home page and
// leaves their WhatsApp number to be notified once a provider covers that
// service in their area.
//
// No auth: the whole point is to capture people who do NOT yet have an account.
// Defence in depth lives here, not in the proxy:
//   - feature flag gate (404 when off so old clients no-op),
//   - SA phone validation,
//   - per-IP + per-phone rate limiting (fails closed when the limiter is down),
//   - category must be a known pilot skill, area must resolve to a live node.
//
// Persistence reuses the existing service-area waitlist (addToServiceAreaWaitlist),
// which is idempotent on (phone, city) — so repeat taps update rather than
// duplicate. Recruitment/ops query that table to see unmet demand by area + skill.

import type { NextRequest } from 'next/server'
import { isEnabled } from '@/lib/flags'
import { normalizeOtpPhoneNumber } from '@/lib/phone-normalization'
import { checkNotifyInterestLimit } from '@/lib/rate-limit'
import { trustedClientIp } from '@/lib/request-ip'
import { resolveAreaScope } from '@/lib/customer-serviceability'
import { PILOT_SKILL_TAGS, getServiceCategoryLabel } from '@/lib/service-categories'
import { canonicalizeServiceCategoryValue } from '@/lib/service-category-canonicalization'
import { addToServiceAreaWaitlist } from '@/lib/service-area-guard'
import { apiError, apiSuccess } from '@/lib/api-response'

export const dynamic = 'force-dynamic'

// Title-case a normalized location key (e.g. "cape_town" → "Cape Town") for a
// human-readable waitlist label without an extra DB round-trip.
function titleCaseKey(key: string | null | undefined): string | null {
  if (!key) return null
  return key
    .split(/[_\s-]+/)
    .filter(Boolean)
    .map((word) => word[0].toUpperCase() + word.slice(1))
    .join(' ')
}

export async function POST(req: NextRequest) {
  const flagOn = await isEnabled('customer.home.notify_interest')
  if (!flagOn) {
    return apiError('not_found', 'Not found', 404)
  }

  let body: { phone?: unknown; category?: unknown; area?: unknown }
  try {
    body = await req.json()
  } catch {
    return apiError('invalid_body', 'Request body must be valid JSON.', 400)
  }

  const rawPhone = typeof body.phone === 'string' ? body.phone : ''
  const rawCategory = typeof body.category === 'string' ? body.category : ''
  const areaSlug = typeof body.area === 'string' ? body.area : ''

  const phoneResult = normalizeOtpPhoneNumber(rawPhone)
  if (!phoneResult.ok) {
    return apiError('invalid_phone', 'Enter a valid South African mobile number.', 422)
  }
  const phone = phoneResult.e164

  // Rate-limit before doing any DB work. IP first, then phone.
  const limit = await checkNotifyInterestLimit({
    phone,
    ip: trustedClientIp(req),
  })
  if (!limit.ok) {
    return apiError(
      'rate_limited',
      'Too many requests. Please wait a little and try again.',
      429,
      undefined,
      { retryable: true, context: { retry_after_ms: limit.retryAfterMs } },
    )
  }

  const category = canonicalizeServiceCategoryValue(rawCategory).canonical
  if (!category || !PILOT_SKILL_TAGS.has(category)) {
    return apiError('invalid_category', 'That service is not available to register interest for.', 422)
  }

  const area = await resolveAreaScope(areaSlug).catch(() => null)
  if (!area) {
    return apiError('invalid_area', 'Choose a valid area before registering interest.', 422)
  }

  const city = titleCaseKey(area.node.cityKey) ?? area.node.label
  const province = titleCaseKey(area.node.provinceKey)
  const suburb = area.node.nodeType === 'SUBURB' ? area.node.label : null

  try {
    await addToServiceAreaWaitlist({
      phone,
      category,
      suburb,
      city,
      province,
      source: 'pwa',
    })
  } catch {
    return apiError('persist_failed', 'We could not register your interest. Please try again.', 500)
  }

  return apiSuccess({
    queued: true,
    category,
    categoryLabel: getServiceCategoryLabel(category),
    area: area.node.label,
  })
}
