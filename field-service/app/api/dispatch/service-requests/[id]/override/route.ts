import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/auth'
import { manualOverrideAssignment } from '@/lib/matching/service'
import { getDispatchRouteError } from '@/lib/route-action-errors'

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const admin = await requireAdmin()
  const { id } = await params
  const body = await request.json().catch(() => ({})) as {
    providerId?: string
    overrideReason?: string
  }

  if (!body.providerId || !body.overrideReason?.trim()) {
    return NextResponse.json(
      { error: 'providerId and overrideReason are required' },
      { status: 400 },
    )
  }

  try {
    const result = await manualOverrideAssignment({
      jobRequestId: id,
      providerId: body.providerId,
      actor: { actorId: admin.id, actorRole: 'admin' },
      overrideReason: body.overrideReason.trim(),
    })
    return NextResponse.json(result)
  } catch (error) {
    const response = getDispatchRouteError({ action: 'override', error })
    return NextResponse.json({ error: response.message }, { status: response.status })
  }
}
