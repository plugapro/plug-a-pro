import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { searchNodes } from '@/lib/location-nodes'

// GET /api/locations/search?q=sand&provinceKey=gauteng
// Returns up to 20 matching SUBURB and REGION nodes.
// q must be at least 2 characters.
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const q = searchParams.get('q') ?? ''
  const provinceKey = searchParams.get('provinceKey') ?? undefined

  if (q.length < 2) {
    return NextResponse.json({ error: 'Query must be at least 2 characters' }, { status: 400 })
  }

  try {
    const results = await searchNodes(q, provinceKey)
    return NextResponse.json(results)
  } catch {
    return NextResponse.json({ error: 'Search failed' }, { status: 500 })
  }
}
