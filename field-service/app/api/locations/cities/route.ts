import { NextResponse } from 'next/server'
import { getCities } from '@/lib/location-nodes'

export async function GET() {
  try {
    const cities = await getCities()
    return NextResponse.json(cities)
  } catch {
    return NextResponse.json({ error: 'Failed to load cities' }, { status: 500 })
  }
}
