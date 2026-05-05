// ─── Internal Match Trigger ───────────────────────────────────────────────────
// Called fire-and-forget from job creation to trigger near real-time dispatch.
// Secured by CRON_SECRET — never exposed publicly.
//
// Also handles manual rematch from admin and cron-based retry.

import { NextResponse } from 'next/server'
import { orchestrateMatch } from '@/lib/matching/orchestrator'

export async function POST(request: Request) {
  const auth = request.headers.get('authorization')
  if (!process.env.CRON_SECRET || auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return new NextResponse('Unauthorized', { status: 401 })
  }

  const body = await request.json().catch(() => null)
  const jobRequestId: string | undefined = body?.jobRequestId
  const triggeredBy: string = body?.triggeredBy ?? 'manual'

  if (!jobRequestId) {
    return NextResponse.json({ error: 'jobRequestId required' }, { status: 400 })
  }

  const start = Date.now()
  const result = await orchestrateMatch(jobRequestId, {
    triggeredBy: triggeredBy as 'job_creation' | 'cron' | 'manual' | 'rematch',
  })

  console.log('[internal/match]', {
    jobRequestId,
    triggeredBy,
    status: result.status,
    latencyMs: Date.now() - start,
  })

  return NextResponse.json({ ok: true, jobRequestId, ...result })
}
