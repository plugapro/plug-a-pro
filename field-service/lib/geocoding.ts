// ─── SA address geocoding ──────────────────────────────────────────────────────
// Resolves a street/suburb/city address to lat/lng.
//
// Strategy (in order):
//   1. Static SA suburb lookup (lib/service-areas/south-africa.ts) - instant, offline
//   2. Nominatim / OpenStreetMap API - free, covers any SA address
//
// The static lookup handles ~90% of SA urban addresses instantly.
// Nominatim is the fallback for townships, new developments and rural areas.
//
// Nominatim rate limit: 1 req/s. This is fine for WhatsApp-gated intake
// (one geocode per job request submission). Do NOT call this in a loop.

import { lookupSuburb } from './service-areas/south-africa'

export interface GeoPoint {
  lat: number
  lng: number
}

export interface ReverseGeocodeResult {
  street: string | null
  suburb: string | null
  city: string | null
  province: string | null
  postalCode: string | null
}

interface GeocodeInput {
  street?: string
  suburb: string
  city: string
  province?: string
  country?: string
}

// ─── 1. Static lookup ─────────────────────────────────────────────────────────

function staticLookup(input: GeocodeInput): GeoPoint | null {
  const scope = { province: input.province, city: input.city }

  // Try suburb first (most specific), then city. Both are disambiguated by the
  // submitted province/city so a duplicate suburb name (e.g. "Morningside" in
  // both Gauteng and KwaZulu-Natal) does not resolve to the wrong city/province
  // and misroute the customer's private job lead. When the suburb name exists in
  // the reference but only for a DIFFERENT province/city, lookupSuburb returns
  // null — we fall through to the city lookup and finally Nominatim rather than
  // storing conflicting coordinates.
  const suburbanResult = lookupSuburb(input.suburb, scope)
  if (suburbanResult) return { lat: suburbanResult.lat, lng: suburbanResult.lng }

  const cityResult = lookupSuburb(input.city, { province: input.province })
  if (cityResult) return { lat: cityResult.lat, lng: cityResult.lng }

  return null
}

// ─── 2. Nominatim fallback ────────────────────────────────────────────────────

const NOMINATIM_URL = 'https://nominatim.openstreetmap.org/search'
const NOMINATIM_REVERSE_URL = 'https://nominatim.openstreetmap.org/reverse'
const USER_AGENT = 'PlugAPro/1.0 (https://plugapro.co.za; contact@plugapro.co.za)'

async function nominatimLookup(input: GeocodeInput): Promise<GeoPoint | null> {
  const parts = [
    input.street,
    input.suburb,
    input.city,
    input.province,
    input.country ?? 'South Africa',
  ].filter(Boolean)

  const params = new URLSearchParams({
    q: parts.join(', '),
    format: 'json',
    limit: '1',
    countrycodes: 'za',
  })

  try {
    const res = await fetch(`${NOMINATIM_URL}?${params}`, {
      headers: { 'User-Agent': USER_AGENT },
      signal: AbortSignal.timeout(5000),
    })

    if (!res.ok) return null

    const data = await res.json() as Array<{ lat: string; lon: string }>
    if (!data.length) return null

    return { lat: parseFloat(data[0].lat), lng: parseFloat(data[0].lon) }
  } catch {
    return null
  }
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Resolve an SA address to lat/lng.
 * Returns null if both the static lookup and Nominatim fail.
 * Never throws - geocoding failure is non-fatal; text-based matching is the fallback.
 */
export async function geocodeAddress(input: GeocodeInput): Promise<GeoPoint | null> {
  try {
    const staticResult = staticLookup(input)
    if (staticResult) return staticResult

    return await nominatimLookup(input)
  } catch {
    return null
  }
}

export async function reverseGeocodeCoordinates(
  point: GeoPoint,
): Promise<ReverseGeocodeResult | null> {
  const params = new URLSearchParams({
    lat: String(point.lat),
    lon: String(point.lng),
    format: 'jsonv2',
    zoom: '18',
    addressdetails: '1',
  })

  try {
    const res = await fetch(`${NOMINATIM_REVERSE_URL}?${params}`, {
      headers: { 'User-Agent': USER_AGENT },
      signal: AbortSignal.timeout(5000),
    })

    if (!res.ok) return null

    const data = await res.json() as {
      address?: {
        road?: string
        house_number?: string
        suburb?: string
        neighbourhood?: string
        city?: string
        town?: string
        village?: string
        state?: string
        postcode?: string
      }
    }

    const address = data.address
    if (!address) return null

    return {
      street: [address.house_number, address.road].filter(Boolean).join(' ').trim() || null,
      suburb: address.suburb ?? address.neighbourhood ?? null,
      city: address.city ?? address.town ?? address.village ?? null,
      province: address.state ?? null,
      postalCode: address.postcode ?? null,
    }
  } catch {
    return null
  }
}
