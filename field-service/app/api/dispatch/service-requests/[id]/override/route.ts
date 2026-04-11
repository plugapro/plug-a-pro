import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/auth'
import { manualOverrideAssignment } from '@/lib/matching/service'

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
    const message = error instanceof Error ? error.message : 'Unable to override assignment'
    return NextResponse.json({ error: message }, { status: 422 })
  }
}

