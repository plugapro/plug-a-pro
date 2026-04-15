import { NextResponse } from 'next/server'
import { getRegions } from '@/lib/location-nodes'

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const cityId = searchParams.get('cityId')
  if (!cityId) return NextResponse.json({ error: 'cityId required' }, { status: 400 })
  try {
    const regions = await getRegions(cityId)
    return NextResponse.json(regions)
  } catch {
    return NextResponse.json({ error: 'Failed to load regions' }, { status: 500 })
  }
}
