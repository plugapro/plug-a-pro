// ─── Service area guard ────────────────────────────────────────────────────────
// Controls which cities are currently active. Customers/providers outside active
// cities are captured on the waitlist and notified when the platform expands.

import { db } from './db'
import { normaliseLocationDisplayName } from './location-format'

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

export const ACTIVE_PILOT_REGION_LABEL = 'JHB West / Roodepoort'
export const ACTIVE_PILOT_CITY_LABEL = 'Johannesburg'

export type ServiceAreaStatus = 'active' | 'coming_soon'

export function normalizeLocationKey(value: string | null | undefined): string {
  return (value ?? '').trim().toLowerCase().replace(/[\s-]+/g, '_')
}

export function getRegionKeyFromSlug(slug: string | null | undefined): string {
  return normalizeLocationKey(slug?.split('__').at(-1) ?? '')
}

export function getRegionServiceStatus(input: {
  regionKey?: string | null
  slug?: string | null
}): ServiceAreaStatus {
  const regionKey = normalizeLocationKey(input.regionKey) || getRegionKeyFromSlug(input.slug)
  return isActiveRegion(regionKey) ? 'active' : 'coming_soon'
}

export function getCityServiceStatus(input: {
  cityKey?: string | null
}): ServiceAreaStatus {
  return isActiveCity(normalizeLocationKey(input.cityKey)) ? 'active' : 'coming_soon'
}

export function describeCityServiceStatus(input: { cityKey?: string | null }): string {
  return getCityServiceStatus(input) === 'active'
    ? `🟢 Active pilot — ${ACTIVE_PILOT_REGION_LABEL}`
    : '🔜 Coming soon — register now'
}

export function describeRegionServiceStatus(input: {
  regionKey?: string | null
  slug?: string | null
}): string {
  return getRegionServiceStatus(input) === 'active'
    ? '🟢 Active pilot'
    : '🔜 Coming soon — register now'
}

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
  const suburb = normaliseLocationDisplayName(params.suburb) || null
  const city = normaliseLocationDisplayName(params.city)
  const province = normaliseLocationDisplayName(params.province) || null
  await db.serviceAreaWaitlist.upsert({
    where: { phone_city: { phone: params.phone, city } },
    create: {
      phone: params.phone,
      name: params.name ?? null,
      category: params.category ?? null,
      suburb,
      city,
      province,
      source: params.source,
    },
    update: {
      // Update name/category in case they weren't captured the first time
      ...(params.name ? { name: params.name } : {}),
      ...(params.category ? { category: params.category } : {}),
    },
  })
}
