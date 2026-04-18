import { NextResponse } from 'next/server'
import { recordAuditLog } from '@/lib/audit'
import { detectQueueBreaches, getQueueHref } from '@/lib/ops-dashboard/alerts'
import { db } from '@/lib/db'
import { sendText } from '@/lib/whatsapp-interactive'

const ADMIN_PHONE = process.env.ADMIN_WHATSAPP_NUMBER ?? ''
const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? ''
const ALERT_COOLDOWN_MINUTES = 90

function formatAge(ageMinutes: number) {
  if (ageMinutes < 60) return `${ageMinutes}m`
  const hours = Math.floor(ageMinutes / 60)
  const minutes = ageMinutes % 60
  if (hours < 24) return `${hours}h ${minutes}m`
  const days = Math.floor(hours / 24)
  const remainingHours = hours % 24
  return `${days}d ${remainingHours}h`
}

export async function GET(request: Request) {
  const authHeader = request.headers.get('authorization')
  if (!process.env.CRON_SECRET || authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return new NextResponse('Unauthorized', { status: 401 })
  }

  const reqId = crypto.randomUUID().slice(0, 8)
  const breaches = await detectQueueBreaches(db)
  let notified = 0

  const recentAlertCutoff = new Date(Date.now() - ALERT_COOLDOWN_MINUTES * 60000)
  const recentAlerts = breaches.length
    ? await db.auditLog.findMany({
        where: {
          action: 'ops_alert.sent',
          entityType: 'ops_queue',
          entityId: { in: breaches.map((breach) => breach.queueKey) },
          timestamp: { gte: recentAlertCutoff },
        },
        select: { entityId: true, timestamp: true },
      }).catch((error) => {
        console.error(`[cron/ops-alerts:${reqId}] Failed to load recent alert cooldowns`, error)
        return []
      })
    : []
  const recentlyAlertedQueues = new Set(recentAlerts.map((entry) => entry.entityId))

  for (const breach of breaches) {
    if (recentlyAlertedQueues.has(breach.queueKey)) {
      console.log(`[cron/ops-alerts:${reqId}] Skipping cooldown-suppressed alert`, {
        queueKey: breach.queueKey,
      })
      continue
    }

    const link = `${APP_URL}${getQueueHref(breach.queueKey)}`
    const message =
      `⚠️ *Ops Alert — ${breach.label}*\n\n` +
      `${breach.overdueCount} item${breach.overdueCount === 1 ? '' : 's'} overdue.\n` +
      `Oldest age: ${formatAge(breach.oldestAgeMinutes)}.\n\n` +
      `Review: ${link}`

    const sent = ADMIN_PHONE
      ? await sendText(ADMIN_PHONE, message).catch((error) => {
          console.error(`[cron/ops-alerts:${reqId}] Failed to send WhatsApp alert`, {
            queueKey: breach.queueKey,
            error,
          })
          return null
        })
      : null

    if (sent) {
      notified += 1
    }

    await recordAuditLog({
      actorId: 'system',
      actorRole: 'system',
      action: 'ops_alert.sent',
      entityType: 'ops_queue',
      entityId: breach.queueKey,
      after: {
        label: breach.label,
        overdueCount: breach.overdueCount,
        oldestAgeMinutes: breach.oldestAgeMinutes,
        severity: breach.severity,
        delivered: Boolean(sent),
      },
    }).catch((error) => {
      console.error(`[cron/ops-alerts:${reqId}] Failed to record alert audit log`, {
        queueKey: breach.queueKey,
        error,
      })
    })
  }

  console.log(`[cron/ops-alerts:${reqId}]`, {
    breaches: breaches.length,
    notified,
  })

  return NextResponse.json({
    ok: true,
    breaches: breaches.length,
    notified,
  })
}
