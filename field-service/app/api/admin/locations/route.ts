import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { requireAdmin } from '@/lib/auth'
import { listLocationNodes } from '@/lib/location-nodes'
import { verifyRequestOrigin } from '@/lib/csrf'
import { apiError } from '@/lib/api-response'
import { createLocationNodeAction } from '@/app/(admin)/admin/locations/actions'

export async function GET(req: NextRequest) {
  try {
    await requireAdmin()
  } catch {
    return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
  }

  const { searchParams } = new URL(req.url)
  const nodeType = searchParams.get('nodeType') as 'PROVINCE' | 'CITY' | 'REGION' | 'SUBURB' | undefined ?? undefined
  const activeParam = searchParams.get('active')
  const active = activeParam === 'false' ? false : activeParam === 'true' ? true : undefined

  try {
    const nodes = await listLocationNodes({ nodeType, active })
    return NextResponse.json(nodes)
  } catch {
    return NextResponse.json({ error: 'Failed to list locations' }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  if (!verifyRequestOrigin(req, [])) {
    return apiError('FORBIDDEN', 'Origin not allowed', 403)
  }

  try {
    await requireAdmin()
  } catch {
    return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
  }

  let body: {
    nodeType: string
    slug: string
    label: string
    parentId?: string | null
    lat?: number | null
    lng?: number | null
    radiusKm?: number | null
  }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }

  const { nodeType, slug, label, parentId, lat, lng, radiusKm } = body
  if (!nodeType || !slug || !label) {
    return NextResponse.json({ error: 'nodeType, slug, and label are required' }, { status: 400 })
  }

  const validTypes = ['PROVINCE', 'CITY', 'REGION', 'SUBURB']
  if (!validTypes.includes(nodeType)) {
    return NextResponse.json({ error: 'Invalid nodeType' }, { status: 400 })
  }

  try {
    const result = await createLocationNodeAction({
      nodeType: nodeType as 'PROVINCE' | 'CITY' | 'REGION' | 'SUBURB',
      slug,
      label,
      parentId: parentId ?? null,
      lat: lat ?? undefined,
      lng: lng ?? undefined,
      radiusKm: radiusKm ?? undefined,
    })
    return NextResponse.json(result, { status: 201 })
  } catch (err) {
    const isValidationError =
      err instanceof Error &&
      (err.message.includes('require') ||
        err.message.includes('parent') ||
        err.message.includes('Invalid') ||
        err.message.includes('parentId'))
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to create location' },
      { status: isValidationError ? 400 : 500 },
    )
  }
}
