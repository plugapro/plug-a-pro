// ─── Cron: Ops Agent Workflow Team ───────────────────────────────────────────
// Runs the Phase 1 ops agents on a schedule. Each agent runs independently; a
// failure in one MUST NOT block the others. Gated by the admin.ops_intelligence
// flag so it is a no-op until ops turns the surface on. Agents only ever produce
// recommendations and DRAFTS — nothing is sent here.

import { NextResponse } from 'next/server'

import { isEnabled } from '@/lib/flags'
import { runAgent } from '@/lib/ops-agents'
import { PHASE_1_AGENTS } from '@/lib/ops-agents/agents'
import { withCronHeartbeat } from '@/lib/cron-heartbeat'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

export async function GET(request: Request) {
  const authHeader = request.headers.get('authorization')
  if (!process.env.CRON_SECRET || authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return new NextResponse('Unauthorized', { status: 401 })
  }
  // Audit OBS-09: record heartbeats so a silently-dead cron is detectable.
  return withCronHeartbeat('ops-agents', () => runCron())
}

async function runCron() {

  const enabled = await isEnabled('admin.ops_intelligence')
  if (!enabled) {
    return NextResponse.json({ ok: true, skipped: 'flag_disabled' })
  }

  const startedAt = Date.now()
  const results: Array<{ agent: string; status: string; candidates: number; recommended: number; draftsCreated: number; error?: string }> = []

  for (const { key, agent } of PHASE_1_AGENTS) {
    try {
      const summary = await runAgent(agent, { trigger: 'cron' })
      results.push({
        agent: key,
        status: summary.status,
        candidates: summary.candidates,
        recommended: summary.recommended,
        draftsCreated: summary.draftsCreated,
      })
    } catch (err) {
      // runAgent never throws, but guard defensively so one agent can't sink the batch.
      results.push({
        agent: key,
        status: 'FAILED',
        candidates: 0,
        recommended: 0,
        draftsCreated: 0,
        error: err instanceof Error ? err.name : 'unknown',
      })
    }
  }

  return NextResponse.json({ ok: true, durationMs: Date.now() - startedAt, results })
}
