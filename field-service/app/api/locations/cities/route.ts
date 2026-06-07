import { NextResponse } from 'next/server'
import { getCities } from '@/lib/location-nodes'

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const provinceKey = searchParams.get('provinceKey') ?? undefined

  try {
    const cities = await getCities(provinceKey)
    return NextResponse.json(cities)
  } catch {
    return NextResponse.json({ error: 'Failed to load cities' }, { status: 500 })
  }
}
