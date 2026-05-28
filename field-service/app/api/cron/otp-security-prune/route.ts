import { NextResponse } from 'next/server'
import {
  pruneClearedAccountSecurityStates,
  pruneStaleSecurityEvents,
  pruneTerminalOtpChallenges,
} from '@/lib/otp-security'

export async function GET(request: Request) {
  const authHeader = request.headers.get('authorization')
  if (!process.env.CRON_SECRET || authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return new NextResponse('Unauthorized', { status: 401 })
  }

  const startedAt = Date.now()

  // Run all three prunes independently — a failure in one MUST NOT block the
  // others. Each gets its own try/catch and surfaces partial results so the
  // response (and structured logs) capture what succeeded vs what errored.
  let challengesDeleted = 0
  let challengesErrored: string | null = null
  try {
    challengesDeleted = (await pruneTerminalOtpChallenges()).deleted
  } catch (err) {
    challengesErrored = err instanceof Error ? err.name : 'unknown'
  }

  let eventsDeleted = 0
  let eventsErrored: string | null = null
  try {
    eventsDeleted = (await pruneStaleSecurityEvents()).deleted
  } catch (err) {
    eventsErrored = err instanceof Error ? err.name : 'unknown'
  }

  let statesDeleted = 0
  let statesErrored: string | null = null
  try {
    statesDeleted = (await pruneClearedAccountSecurityStates()).deleted
  } catch (err) {
    statesErrored = err instanceof Error ? err.name : 'unknown'
  }

  const durationMs = Date.now() - startedAt

  // Preserve the legacy structured log so existing log-pipeline alerts keyed
  // on `otp.challenge.pruned` keep working. Add separate events for the two
  // new tables so each has its own grep target.
  console.info(JSON.stringify({
    event: 'otp.challenge.pruned',
    deleted: challengesDeleted,
    durationMs,
    errored: challengesErrored,
  }))
  console.info(JSON.stringify({
    event: 'otp.security_event.pruned',
    deleted: eventsDeleted,
    errored: eventsErrored,
  }))
  console.info(JSON.stringify({
    event: 'otp.account_security_state.pruned',
    deleted: statesDeleted,
    errored: statesErrored,
  }))

  return NextResponse.json({
    ok: true,
    durationMs,
    challenges: { deleted: challengesDeleted, errored: challengesErrored },
    securityEvents: { deleted: eventsDeleted, errored: eventsErrored },
    accountSecurityStates: { deleted: statesDeleted, errored: statesErrored },
  })
}
