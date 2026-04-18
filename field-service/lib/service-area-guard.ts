// ─── Service area guard ────────────────────────────────────────────────────────
// Controls which cities are currently active. Customers/providers outside active
// cities are captured on the waitlist and notified when the platform expands.

import { db } from './db'

// ─── Active area gates ─────────────────────────────────────────────────────────
// Expand these sets as the platform rolls out to new areas.
// Province slug must match the locationNode slug for the province.
// City/region keys must match the cityKey/regionKey stored on location nodes.

export const ACTIVE_PROVINCE_SLUGS = new Set([
  'gauteng',
])

export const ACTIVE_CITY_NODE_KEYS = new Set([
  'johannesburg',
])

export const ACTIVE_REGION_KEYS_SET = new Set([
  'jhb_west',
])

// Normalised city keys currently accepting new job requests (legacy guard — kept
// for the `handleCollectAddress` fallback path that checks city label free-text).
export const ACTIVE_CITY_KEYS = new Set([
  'johannesburg',
  'jhb',
  'joburg',
  'johanesburg', // common misspelling
])

export function isActiveProvince(slug: string): boolean {
  return ACTIVE_PROVINCE_SLUGS.has(slug.toLowerCase())
}

export function isActiveCity(cityKey: string): boolean {
  return ACTIVE_CITY_NODE_KEYS.has(cityKey.toLowerCase())
}

export function isActiveRegion(regionKey: string): boolean {
  return ACTIVE_REGION_KEYS_SET.has(regionKey.toLowerCase())
}

export class OutsideServiceAreaError extends Error {
  constructor(public readonly city: string) {
    super(`Service not yet available in ${city}`)
    this.name = 'OutsideServiceAreaError'
  }
}

/**
 * Returns true when the city is in an active service area.
 * Normalises to lowercase and collapses whitespace before checking.
 */
export function isInActiveServiceArea(cityLabel: string): boolean {
  const key = cityLabel.trim().toLowerCase().replace(/[\s_-]+/g, '')
  // Also check underscore-joined form for node slugs (e.g. "johannesburg")
  const keyUnderscored = cityLabel.trim().toLowerCase().replace(/[\s-]+/g, '_')
  return ACTIVE_CITY_KEYS.has(key) || ACTIVE_CITY_KEYS.has(keyUnderscored)
}

/**
 * Upserts a record in service_area_waitlist.
 * Safe to call twice — the @@unique([phone, city]) constraint makes it idempotent.
 */
export async function addToServiceAreaWaitlist(params: {
  phone: string
  name?: string | null
  category?: string | null
  suburb?: string | null
  city: string
  province?: string | null
  source: 'whatsapp' | 'pwa'
}): Promise<void> {
  await db.serviceAreaWaitlist.upsert({
    where: { phone_city: { phone: params.phone, city: params.city } },
    create: {
      phone: params.phone,
      name: params.name ?? null,
      category: params.category ?? null,
      suburb: params.suburb ?? null,
      city: params.city,
      province: params.province ?? null,
      source: params.source,
    },
    update: {
      // Update name/category in case they weren't captured the first time
      ...(params.name ? { name: params.name } : {}),
      ...(params.category ? { category: params.category } : {}),
    },
  })
}
