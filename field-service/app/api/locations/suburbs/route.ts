import { NextResponse } from 'next/server'
import { getSuburbs } from '@/lib/location-nodes'

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const regionId = searchParams.get('regionId')
  if (!regionId) return NextResponse.json({ error: 'regionId required' }, { status: 400 })
  try {
    const suburbs = await getSuburbs(regionId)
    return NextResponse.json(suburbs)
  } catch {
    return NextResponse.json({ error: 'Failed to load suburbs' }, { status: 500 })
  }
}
