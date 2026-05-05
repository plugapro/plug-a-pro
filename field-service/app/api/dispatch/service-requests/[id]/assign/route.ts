import { NextRequest, NextResponse } from 'next/server'
import { requireAdminApi, getSession } from '@/lib/auth'
import { runAssignmentForJobRequest } from '@/lib/matching/service'
import { orchestrateMatch } from '@/lib/matching/orchestrator'
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
  const mode = body.mode ?? 'OPS_REVIEW'

  try {
    if (mode === 'AUTO_ASSIGN') {
      // Atomic orchestrator path — same reservation logic used by job creation and cron
      const result = await orchestrateMatch(id, { triggeredBy: 'manual' })
      return NextResponse.json(result)
    }

    // OPS_REVIEW: rank candidates and record a DispatchDecision for admin to review,
    // but do NOT dispatch a WhatsApp lead. orchestrateMatch() always dispatches,
    // so the service layer remains responsible for the ranked-review flow.
    const result = await runAssignmentForJobRequest({
      jobRequestId: id,
      actor: { actorId: admin.id, actorRole: 'admin' },
      mode: 'OPS_REVIEW',
    })
    return NextResponse.json(result)
  } catch (error) {
    const response = getDispatchRouteError({ action: 'assign', error })
    return NextResponse.json({ error: response.message }, { status: response.status })
  }
}
