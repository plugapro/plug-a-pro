import { NextResponse } from 'next/server'
import { requireRoleApi } from '@/lib/auth'
import { getCorrelationId, logWithCorrelation } from '@/lib/correlation'
import { getDispatchHistory, getLeadNotificationSummaryForJobRequest } from '@/lib/matching/service'

const JobRequestIdSchema = /^[a-zA-Z0-9_-]{10,64}$/

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const actorOrError = await requireRoleApi(['OPS', 'ADMIN', 'OWNER'])
  if (actorOrError instanceof Response) return actorOrError
  const actor = actorOrError

  const { id } = await params
  const jobRequestId = id.trim()
  if (!JobRequestIdSchema.test(jobRequestId)) {
    return NextResponse.json({ error: 'Invalid jobRequestId' }, { status: 400 })
  }

  const correlationId = await getCorrelationId()
  const startedAt = Date.now()
  logWithCorrelation('info', correlationId, '[dispatch-history] invoked', {
    actorId: actor.id,
    jobRequestId,
  })

  try {
    const [history, notificationSummary] = await Promise.all([
      getDispatchHistory(jobRequestId),
      getLeadNotificationSummaryForJobRequest(jobRequestId),
    ])

    if (!notificationSummary) {
      logWithCorrelation('warn', correlationId, '[dispatch-history] job request not found', {
        actorId: actor.id,
        jobRequestId,
      })
      return NextResponse.json({ error: 'Job request not found' }, { status: 404 })
    }

    const tookMs = Date.now() - startedAt
    logWithCorrelation('info', correlationId, '[dispatch-history] success', {
      actorId: actor.id,
      jobRequestId,
      providerCount: notificationSummary.providers.length,
      dispatchHistorySize: history.length,
      durationMs: tookMs,
    })

    return NextResponse.json({
      jobRequestId,
      jobRequestStatus: notificationSummary.jobRequestStatus,
      assignmentMode: notificationSummary.assignmentMode,
      history,
      providerNotifications: notificationSummary.providers,
    })
  } catch (error) {
    const durationMs = Date.now() - startedAt
    logWithCorrelation('error', correlationId, '[dispatch-history] failed', {
      actorId: actor.id,
      jobRequestId,
      durationMs,
      error: error instanceof Error ? error.message : String(error),
    })
    return NextResponse.json({ error: 'Failed to load dispatch history' }, { status: 500 })
  }
}
