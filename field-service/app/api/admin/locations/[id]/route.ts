import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { requireAdmin } from '@/lib/auth'
import {
  updateLocationNode,
  deactivateLocationNode,
  deleteLocationNode,
  LocationNodeInUseError,
} from '@/lib/location-nodes'

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
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
    await updateLocationNode(id, body)
    return NextResponse.json({ ok: true })
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to update location' },
      { status: 400 },
    )
  }
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireAdmin()
  } catch {
    return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
  }

  const { id } = await params

  // Check for ?force=true to skip soft-delete attempt
  const force = new URL(req.url).searchParams.get('force') === 'true'

  try {
    await deleteLocationNode(id)
    return NextResponse.json({ ok: true, deleted: 'hard' })
  } catch (err) {
    if (err instanceof LocationNodeInUseError && !force) {
      try {
        await deactivateLocationNode(id)
        return NextResponse.json({ ok: true, deleted: 'soft' })
      } catch (deactivateErr) {
        return NextResponse.json(
          { error: deactivateErr instanceof Error ? deactivateErr.message : 'Failed' },
          { status: 400 },
        )
      }
    }
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to delete location' },
      { status: err instanceof LocationNodeInUseError ? 400 : 500 },
    )
  }
}
