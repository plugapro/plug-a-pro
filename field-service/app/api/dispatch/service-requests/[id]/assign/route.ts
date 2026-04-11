import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/auth'
import { runAssignmentForJobRequest } from '@/lib/matching/service'

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const admin = await requireAdmin()
  const { id } = await params
  const body = await request.json().catch(() => ({})) as { mode?: 'AUTO_ASSIGN' | 'OPS_REVIEW' }

  try {
    const result = await runAssignmentForJobRequest({
      jobRequestId: id,
      actor: { actorId: admin.id, actorRole: 'admin' },
      mode: body.mode ?? 'OPS_REVIEW',
    })
    return NextResponse.json(result)
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unable to run assignment'
    return NextResponse.json({ error: message }, { status: 422 })
  }
}

