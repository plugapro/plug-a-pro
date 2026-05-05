import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { reverseGeocodeCoordinates } from '@/lib/geocoding'
import { resolveStructuredAddressByLabels } from '@/lib/location-nodes'

export async function GET(req: NextRequest) {
  const session = await getSession()
  if (!session || session.role !== 'customer') {
    return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
  }

  const { searchParams } = new URL(req.url)
  const lat = Number(searchParams.get('lat'))
  const lng = Number(searchParams.get('lng'))

  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return NextResponse.json({ error: 'Valid lat and lng are required' }, { status: 400 })
  }

  const result = await reverseGeocodeCoordinates({ lat, lng })
  if (!result) {
    return NextResponse.json({ error: 'Could not resolve address from location' }, { status: 404 })
  }

  const selection =
    result.suburb
      ? await resolveStructuredAddressByLabels({
          suburb: result.suburb,
          city: result.city,
          province: result.province,
        })
      : null

  return NextResponse.json({
    street: result.street,
    selection,
  })
}
