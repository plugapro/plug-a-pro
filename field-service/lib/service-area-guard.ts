// ─── Service-area helpers ─────────────────────────────────────────────────────
// Liveness is no longer decided here. Since the national rollout
// (docs/superpowers/specs/2026-10-03-national-rollout-design.md) a location is
// live if and only if its LocationNode is active; pickers, registration,
// provider service-area rows and customer intake all read `LocationNode.active`.
// This module keeps the two key-normalisation helpers and the waitlist upsert
// used by the "my area isn't listed" / notify-me paths.

import { db } from './db'
import { normaliseLocationDisplayName } from './location-format'

export function normalizeLocationKey(value: string | null | undefined): string {
  return (value ?? '').trim().toLowerCase().replace(/[\s-]+/g, '_')
}

export function getRegionKeyFromSlug(slug: string | null | undefined): string {
  return normalizeLocationKey(slug?.split('__').at(-1) ?? '')
}

/**
 * Upserts a record in service_area_waitlist.
 * Safe to call twice - the @@unique([phone, city]) constraint makes it idempotent.
 */
export async function addToServiceAreaWaitlist(params: {
  phone: string
  name?: string | null
  category?: string | null
  suburb?: string | null
  city: string
  province?: string | null
  source: 'whatsapp' | 'pwa' | 'vodapay'
}): Promise<void> {
  const suburb = normaliseLocationDisplayName(params.suburb) || null
  const city = normaliseLocationDisplayName(params.city)
  const province = normaliseLocationDisplayName(params.province) || null
  // Use case-insensitive findFirst so that existing rows stored with lowercase city
  // (before normalisation was introduced) are matched correctly - the @@unique([phone, city])
  // constraint is case-sensitive by default in Postgres.
  const existing = await db.serviceAreaWaitlist.findFirst({
    where: {
      phone: params.phone,
      city: { equals: city, mode: 'insensitive' },
    },
    select: { id: true },
  })
  if (existing) {
    await db.serviceAreaWaitlist.update({
      where: { id: existing.id },
      data: {
        city, // normalise the stored city on touch
        ...(params.name ? { name: params.name } : {}),
        ...(params.category ? { category: params.category } : {}),
      },
    })
  } else {
    await db.serviceAreaWaitlist.create({
      data: {
        phone: params.phone,
        name: params.name ?? null,
        category: params.category ?? null,
        suburb,
        city,
        province,
        source: params.source,
      },
    })
  }
}
