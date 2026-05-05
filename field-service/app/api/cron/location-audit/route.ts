import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { auditLocationReferenceData } from '@/lib/location-audit'
import { sendText } from '@/lib/whatsapp-interactive'

export async function GET(request: Request) {
  const authHeader = request.headers.get('authorization')
  if (!process.env.CRON_SECRET || authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return new NextResponse('Unauthorized', { status: 401 })
  }

  const audit = await auditLocationReferenceData(db)
  if (!audit.ok) {
    console.error('[cron/location-audit] reference data audit failed', audit)
    await notifyOps(audit.failures).catch((error) => {
      console.error('[cron/location-audit] ops notification failed', error)
    })
    return NextResponse.json(audit, { status: 500 })
  }

  console.log('[cron/location-audit] ok', audit.counts)
  return NextResponse.json(audit)
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
