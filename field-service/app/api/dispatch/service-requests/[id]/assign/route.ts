import { NextRequest, NextResponse } from 'next/server'
import { requireAdminApi, getSession } from '@/lib/auth'
import { runAssignmentForJobRequest } from '@/lib/matching/service'
import { getDispatchRouteError } from '@/lib/route-action-errors'

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const authError = await requireAdminApi()
  if (authError) return authError
  const admin = (await getSession())!
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
    const response = getDispatchRouteError({ action: 'assign', error })
    return NextResponse.json({ error: response.message }, { status: response.status })
  }
}
