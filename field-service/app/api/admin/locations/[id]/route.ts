import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import {
  updateLocationNodeAction,
  deleteLocationNodeAction,
} from '@/app/(admin)/admin/locations/actions'
import { verifyRequestOrigin } from '@/lib/csrf'
import { apiError } from '@/lib/api-response'
import { adminLocationMutationError } from '@/lib/admin-location-api-response'

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!verifyRequestOrigin(req, [])) {
    return apiError('FORBIDDEN', 'Origin not allowed', 403)
  }

  const { id } = await params

  let body: { label?: string; lat?: number | null; lng?: number | null; radiusKm?: number | null }
  try {
    body = await req.json()
  } catch {
    return apiError('INVALID_REQUEST_BODY', 'Invalid request body.', 400, undefined, {
      context: { surface: 'admin_locations', action: 'update' },
    })
  }

  try {
    await updateLocationNodeAction({ id, ...body })
    return NextResponse.json({ ok: true })
  } catch (err) {
    return adminLocationMutationError(err, 'update')
  }
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!verifyRequestOrigin(req, [])) {
    return apiError('FORBIDDEN', 'Origin not allowed', 403)
  }

  const { id } = await params
  const force = new URL(req.url).searchParams.get('force') === 'true'

  try {
    const result = await deleteLocationNodeAction(id, { force })
    return NextResponse.json({
      ok: true,
      deleted: result.data.softDeleted || process.env.ALLOW_LOCATION_HARD_DELETE !== 'true'
        ? 'soft'
        : 'hard',
    })
  } catch (err) {
    return adminLocationMutationError(err, 'delete')
  }
}
