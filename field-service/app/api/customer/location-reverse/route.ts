import { type NextRequest, NextResponse } from 'next/server'
import { reverseGeocodeCoordinates } from '@/lib/geocoding'
import { resolveStructuredAddressFromReverse } from '@/lib/location-nodes'
import { checkLocationReverseLimit } from '@/lib/rate-limit'
import { trustedClientIp } from '@/lib/request-ip'

export const dynamic = 'force-dynamic'

// GET /api/customer/location-reverse?lat=..&lng=..
//
// Public: the booking address step is reachable anonymously (the funnel only
// requires auth at submit), so this must serve anonymous callers too. Previously
// it was auth-gated, so an anonymous "Use my current location" request was
// redirected to /sign-in by the proxy; the client then parsed that HTML as JSON
// and surfaced WebKit's opaque "The string did not match the expected pattern."
//
// Reverse-geocoding public coordinates exposes no user data; a per-IP rate limit
// protects the Nominatim dependency from a single source hammering it.
export async function GET(req: NextRequest) {
  const limit = await checkLocationReverseLimit({ ip: trustedClientIp(req) })
  if (!limit.ok) {
    return NextResponse.json(
      { error: 'Too many location lookups. Please wait a moment and try again.' },
      { status: 429 },
    )
  }

  const { searchParams } = new URL(req.url)
  const lat = Number(searchParams.get('lat'))
  const lng = Number(searchParams.get('lng'))

  if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) {
    return NextResponse.json({ error: 'Valid lat and lng are required' }, { status: 400 })
  }

  const result = await reverseGeocodeCoordinates({ lat, lng })
  if (!result) {
    return NextResponse.json({ error: 'Could not resolve address from location' }, { status: 404 })
  }

  // Resolve the service-area suburb using every reliable signal — not just the
  // OSM suburb name (which often doesn't match our taxonomy). Postal code and
  // the user's coordinates rescue the common "found your street, but couldn't
  // match the suburb" case.
  const selection = await resolveStructuredAddressFromReverse({
    suburb: result.suburb,
    city: result.city,
    province: result.province,
    postalCode: result.postalCode,
    lat,
    lng,
  })

  return NextResponse.json({
    street: result.street,
    selection,
  })
}
