import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { requireAdmin } from '@/lib/auth'
import { verifyRequestOrigin } from '@/lib/csrf'
import { apiError } from '@/lib/api-response'
import {
  deleteLocationNodeAction,
  updateLocationNodeAction,
} from '@/app/(admin)/admin/locations/actions'

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!verifyRequestOrigin(req, [])) {
    return apiError('FORBIDDEN', 'Origin not allowed', 403)
  }

  try {
    await requireAdmin()
  } catch {
    return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
  }

  const { id } = await params

  let body: { label?: string; lat?: number | null; lng?: number | null; radiusKm?: number | null }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }

  try {
    const result = await updateLocationNodeAction({ id, ...body })
    return NextResponse.json(result)
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to update location' },
      { status: 400 },
    )
  }
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!verifyRequestOrigin(req, [])) {
    return apiError('FORBIDDEN', 'Origin not allowed', 403)
  }

  try {
    await requireAdmin()
  } catch {
    return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
  }

  const { id } = await params
  const force = new URL(req.url).searchParams.get('force') === 'true'

  try {
    const result = await deleteLocationNodeAction(id, { allowSoftDelete: !force })
    return NextResponse.json(result)
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to delete location' },
      { status: 500 },
    )
  }
}
