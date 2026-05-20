// ─── Internal Match Trigger ───────────────────────────────────────────────────
// Called fire-and-forget from job creation to trigger near real-time dispatch.
// Secured by CRON_SECRET - never exposed publicly.
//
// Also handles manual rematch from admin and cron-based retry.

import { NextResponse } from 'next/server'
import {
  type MatchOrchestrationResult,
  orchestrateMatch,
  type MatchOrchestrationOptions,
} from '@/lib/matching/orchestrator'
import { requireRoleApi } from '@/lib/auth'

export async function POST(request: Request) {
  const auth = request.headers.get('authorization')
  const cronAuthorized = Boolean(
    process.env.CRON_SECRET && auth === `Bearer ${process.env.CRON_SECRET}`,
  )

  let initiatedBy: MatchOrchestrationOptions['initiatedBy'] | undefined
  if (!cronAuthorized) {
    const actorOrError = await requireRoleApi(['ADMIN', 'OWNER'])
    if (actorOrError instanceof Response) return actorOrError
    initiatedBy = {
      actorId: actorOrError.id,
      actorRole: actorOrError.adminRole,
    }
  }

  const body = await request.json().catch(() => null)
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }

  const jobRequestId = typeof body.jobRequestId === 'string' ? body.jobRequestId.trim() : ''
  const triggeredBy = typeof body.triggeredBy === 'string' ? body.triggeredBy : 'manual'
  const cohortMode = typeof body.cohortMode === 'string' ? body.cohortMode : undefined

  const validTriggeredBy = ['job_creation', 'cron', 'manual', 'rematch'] as const
  const validCohortMode = ['AUTO', 'LIVE_ONLY', 'TEST_ONLY'] as const

  const isTriggeredByValid = (value: string): value is MatchOrchestrationOptions['triggeredBy'] =>
    (validTriggeredBy as readonly string[]).includes(value)
  const isCohortModeValid = (
    value: string,
  ): value is NonNullable<MatchOrchestrationOptions['cohortMode']> =>
    (validCohortMode as readonly string[]).includes(value)

  if (!isTriggeredByValid(triggeredBy)) {
    return NextResponse.json({ error: 'Invalid triggeredBy' }, { status: 400 })
  }

  if (cohortMode !== undefined && !isCohortModeValid(cohortMode)) {
    return NextResponse.json({ error: 'Invalid cohortMode' }, { status: 400 })
  }

  if (cohortMode && cohortMode !== 'AUTO' && !initiatedBy) {
    return NextResponse.json(
      { error: 'cohortMode override requires admin authorization' },
      { status: 403 },
    )
  }

  if (!jobRequestId) {
    return NextResponse.json({ error: 'jobRequestId required' }, { status: 400 })
  }

  const start = Date.now()
  const options: MatchOrchestrationOptions = {
    triggeredBy,
    ...(cohortMode ? { cohortMode } : {}),
    ...(initiatedBy ? { initiatedBy } : {}),
  }

  try {
    const result: MatchOrchestrationResult = await orchestrateMatch(jobRequestId, options)

    console.info('[internal/match]', {
      jobRequestId,
      triggeredBy,
      cohortMode: options.cohortMode ?? null,
      initiatedById: initiatedBy?.actorId ?? 'system',
      initiatedByRole: initiatedBy?.actorRole ?? 'system',
      status: result.status,
      latencyMs: Date.now() - start,
    })

    return NextResponse.json({ ok: true, jobRequestId, ...result })
  } catch (error) {
    console.error('[internal/match] invocation failed', {
      jobRequestId,
      triggeredBy,
      cohortMode: options.cohortMode ?? null,
      err: error instanceof Error ? error.message : String(error),
    })
    return NextResponse.json({ error: 'Match orchestration failed' }, { status: 500 })
  }
}
