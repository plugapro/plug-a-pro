import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { searchNodes, searchSuburbNodes } from '@/lib/location-nodes'

// GET /api/locations/search?q=sand&provinceKey=gauteng
// Returns up to 20 matching SUBURB and REGION nodes.
//
// GET /api/locations/search?q=sand&mode=suburb&provinceKey=gauteng
// Returns up to 20 SUBURB-only nodes with full parent labels and postalCode,
// suitable for use in the booking address combobox.
//
// q must be at least 2 characters.
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const q = searchParams.get('q') ?? ''
  const provinceKey = searchParams.get('provinceKey') ?? undefined
  const mode = searchParams.get('mode') ?? ''

  if (q.length < 2) {
    return NextResponse.json({ error: 'Query must be at least 2 characters' }, { status: 400 })
  }

  try {
    if (mode === 'suburb') {
      // SUBURB-only search for the booking address combobox - includes structured
      // parent labels (region, city, province) and postalCode for the Selection interface.
      const results = await searchSuburbNodes(q, provinceKey)
      return NextResponse.json(results)
    }

    // Default: mixed SUBURB + REGION search (used by admin and other callers).
    const results = await searchNodes(q, provinceKey)
    return NextResponse.json(results)
  } catch {
    return NextResponse.json({ error: 'Search failed' }, { status: 500 })
  }
}
