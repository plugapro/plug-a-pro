import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { requireAdmin } from '@/lib/auth'
import { createLocationNodeAction } from '@/app/(admin)/admin/locations/actions'
import { listLocationNodes } from '@/lib/location-nodes'
import { verifyRequestOrigin } from '@/lib/csrf'
import { apiError, createApiReferenceId } from '@/lib/api-response'
import { adminLocationMutationError } from '@/lib/admin-location-api-response'

export async function GET(req: NextRequest) {
  try {
    await requireAdmin()
  } catch {
    return apiError('UNAUTHENTICATED', 'Authentication required.', 401)
  }

  const { searchParams } = new URL(req.url)
  const nodeType = searchParams.get('nodeType') as 'PROVINCE' | 'CITY' | 'REGION' | 'SUBURB' | undefined ?? undefined
  const activeParam = searchParams.get('active')
  const active = activeParam === 'false' ? false : activeParam === 'true' ? true : undefined

  try {
    const nodes = await listLocationNodes({ nodeType, active })
    return NextResponse.json(nodes)
  } catch (error) {
    const referenceId = createApiReferenceId()
    console.error('[admin-location-api] list failed', {
      reference_id: referenceId,
      safeErrorMessage: error instanceof Error ? error.message : String(error),
    })
    return apiError('LOCATION_LIST_FAILED', 'Failed to list locations.', 500, referenceId, {
      context: { surface: 'admin_locations', action: 'list' },
    })
  }
}

export async function POST(req: NextRequest) {
  if (!verifyRequestOrigin(req, [])) {
    return apiError('FORBIDDEN', 'Origin not allowed', 403)
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
    return apiError('INVALID_REQUEST_BODY', 'Invalid request body.', 400, undefined, {
      context: { surface: 'admin_locations', action: 'create' },
    })
  }

  const { nodeType, slug, label, parentId, lat, lng, radiusKm } = body
  if (!nodeType || !slug || !label) {
    return apiError('VALIDATION', 'nodeType, slug, and label are required.', 400, undefined, {
      context: { surface: 'admin_locations', action: 'create' },
    })
  }

  const validTypes = ['PROVINCE', 'CITY', 'REGION', 'SUBURB']
  if (!validTypes.includes(nodeType)) {
    return apiError('VALIDATION', 'Invalid nodeType.', 400, undefined, {
      context: { surface: 'admin_locations', action: 'create' },
    })
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
    return NextResponse.json(result.data, { status: 201 })
  } catch (err) {
    return adminLocationMutationError(err, 'create')
  }
}
