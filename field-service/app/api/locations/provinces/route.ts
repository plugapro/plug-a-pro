import { NextResponse } from 'next/server'
import { getProvinces } from '@/lib/location-nodes'

export async function GET() {
  try {
    const provinces = await getProvinces()
    return NextResponse.json(provinces)
  } catch {
    return NextResponse.json({ error: 'Failed to load provinces' }, { status: 500 })
  }
}
