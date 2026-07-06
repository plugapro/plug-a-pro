import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { auditLocationReferenceData } from '@/lib/location-audit'
import { sendText } from '@/lib/whatsapp-interactive'
import { withCronHeartbeat } from '@/lib/cron-heartbeat'

export async function GET(request: Request) {
  const authHeader = request.headers.get('authorization')
  if (!process.env.CRON_SECRET || authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return new NextResponse('Unauthorized', { status: 401 })
  }
  // Audit OBS-09: record heartbeats so a silently-dead cron is detectable.
  return withCronHeartbeat('location-audit', () => runCron())
}

async function runCron() {

  const cronStart = Date.now()
  const cronName = 'location-audit'
  console.log(JSON.stringify({ event: 'cron_start', cron: cronName, timestamp: new Date().toISOString() }))

  try {
    const audit = await auditLocationReferenceData(db)
    if (!audit.ok) {
      console.error('[cron/location-audit] reference data audit failed', audit)
      await notifyOps(audit.failures).catch((error) => {
        console.error('[cron/location-audit] ops notification failed', error)
      })
      const duration = Date.now() - cronStart
      console.error(JSON.stringify({ event: 'cron_error', cron: cronName, durationMs: duration, error: 'audit_failed', timestamp: new Date().toISOString() }))
      return NextResponse.json(audit, { status: 500 })
    }

    console.log('[cron/location-audit] ok', audit.counts)
    const duration = Date.now() - cronStart
    console.log(JSON.stringify({ event: 'cron_complete', cron: cronName, durationMs: duration, timestamp: new Date().toISOString() }))
    return NextResponse.json({ ...audit, durationMs: duration })
  } catch (err) {
    const duration = Date.now() - cronStart
    console.error(JSON.stringify({ event: 'cron_error', cron: cronName, durationMs: duration, error: String(err), timestamp: new Date().toISOString() }))
    throw err
  }
}

async function notifyOps(failures: string[]) {
  const to = process.env.ADMIN_WHATSAPP_NUMBER
  if (!to) return
  await sendText(
    to,
    `Location data audit failed. ${failures.slice(0, 4).join(' | ')}`,
    { templateName: 'ops_location_audit_failed' },
  )
}
