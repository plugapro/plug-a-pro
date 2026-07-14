// ─── Immediate no-supply notice (CJ-09) ───────────────────────────────────────
// Platform audit 2026-07-06: on an EMPTY_POOL / STRUCTURAL NO_MATCH the
// customer heard NOTHING until expiresAt — and when a prior dispatch decision
// existed, even the immediate-expiry path was skipped, leaving hours of
// silence in out-of-supply areas.
//
// sendNoSupplyImmediateNotice() sends an immediate, honest "no providers
// available right now" WhatsApp message with a waitlist capture (the existing
// ServiceAreaWaitlist upsert — same promise the out-of-fence intake flow
// already makes). The request itself is NOT terminated: matching keeps
// retrying via cron, and the normal expiry notification still runs later.
//
// This is a NEW automated customer-facing send, so it is gated behind
// `customer.no_supply.immediate_notice` (default OFF). Flag-off behaviour is
// exactly the pre-audit silence.
//
// Idempotency: one notice per job request, enforced with an AuditLog sentinel
// (action customer.no_supply_notice.sent) so cron re-dispatch attempts do not
// spam the customer. No schema change required.

import { db } from '@/lib/db'
import { isEnabled } from '@/lib/flags'
import { recordAuditLog } from '@/lib/audit'
import { addToServiceAreaWaitlist } from '@/lib/service-area-guard'

export const NO_SUPPLY_IMMEDIATE_NOTICE_FLAG = 'customer.no_supply.immediate_notice'
export const NO_SUPPLY_NOTICE_AUDIT_ACTION = 'customer.no_supply_notice.sent'

export type NoSupplyNoticeOutcome =
  | { sent: true }
  | {
      sent: false
      reason:
        | 'FLAG_OFF'
        | 'ALREADY_SENT'
        | 'REQUEST_NOT_FOUND'
        | 'REQUEST_NOT_ACTIVE'
        | 'NO_CUSTOMER_PHONE'
        | 'SEND_FAILED'
    }

function firstName(name: string | null | undefined): string {
  return (name ?? 'there').trim().split(/\s+/)[0] || 'there'
}

export function buildNoSupplyNoticeMessage(params: {
  customerName: string | null
  serviceName: string
  area: string | null
}): string {
  const name = firstName(params.customerName)
  const areaPart = params.area ? ` in *${params.area}*` : ' in your area'
  return (
    `😔 *Hi ${name}*, being honest with you:\n\n` +
    `There are no *${params.serviceName}* providers available${areaPart} right now.\n\n` +
    `Your request stays open and we will keep searching — the moment a provider becomes available we'll message you immediately.\n\n` +
    `We've also added you to the waitlist for your area, so you'll be first to know as new providers come on board.\n\n` +
    `Reply *STATUS* anytime to check on your request.`
  )
}

export async function sendNoSupplyImmediateNotice(params: {
  jobRequestId: string
  failureClass: string
}): Promise<NoSupplyNoticeOutcome> {
  const flagOn = await isEnabled(NO_SUPPLY_IMMEDIATE_NOTICE_FLAG).catch(() => false)
  if (!flagOn) return { sent: false, reason: 'FLAG_OFF' }

  // Idempotency sentinel — one notice per job request, ever.
  const existing = await db.auditLog.findFirst({
    where: {
      action: NO_SUPPLY_NOTICE_AUDIT_ACTION,
      entityType: 'JobRequest',
      entityId: params.jobRequestId,
    },
    select: { id: true },
  })
  if (existing) return { sent: false, reason: 'ALREADY_SENT' }

  const jobRequest = await db.jobRequest.findUnique({
    where: { id: params.jobRequestId },
    select: {
      id: true,
      status: true,
      category: true,
      title: true,
      customer: { select: { name: true, phone: true } },
      address: { select: { suburb: true, city: true, province: true } },
    },
  })
  if (!jobRequest) return { sent: false, reason: 'REQUEST_NOT_FOUND' }
  // Only speak to requests still live in the funnel; terminal requests get the
  // normal expiry/cancellation messaging instead.
  if (!['OPEN', 'MATCHING', 'PENDING_VALIDATION'].includes(jobRequest.status)) {
    return { sent: false, reason: 'REQUEST_NOT_ACTIVE' }
  }
  const phone = jobRequest.customer?.phone
  if (!phone) return { sent: false, reason: 'NO_CUSTOMER_PHONE' }

  const serviceName = jobRequest.title?.trim() || jobRequest.category
  const area = jobRequest.address?.suburb || jobRequest.address?.city || null

  // Waitlist capture — reuses the existing idempotent upsert (unique on
  // phone+city). Best-effort: a waitlist failure must not block the honest
  // notice itself.
  if (jobRequest.address?.city || jobRequest.address?.suburb) {
    await addToServiceAreaWaitlist({
      phone,
      name: jobRequest.customer?.name ?? null,
      category: jobRequest.category,
      suburb: jobRequest.address?.suburb ?? null,
      city: jobRequest.address?.city ?? jobRequest.address?.suburb ?? '',
      province: jobRequest.address?.province ?? null,
      source: 'whatsapp',
    }).catch((err) => {
      console.error('[no-supply-notice] waitlist capture failed (continuing)', {
        jobRequestId: jobRequest.id,
        err,
      })
    })
  }

  const message = buildNoSupplyNoticeMessage({
    customerName: jobRequest.customer?.name ?? null,
    serviceName,
    area,
  })

  try {
    const { sendText } = await import('@/lib/whatsapp-interactive')
    await sendText(phone, message, {
      templateName: 'interactive:job_request_no_supply_notice',
      metadata: {
        jobRequestId: jobRequest.id,
        failureClass: params.failureClass,
      },
    })
  } catch (err) {
    console.error('[no-supply-notice] send failed', { jobRequestId: jobRequest.id, err })
    return { sent: false, reason: 'SEND_FAILED' }
  }

  // Arm the sentinel only after a successful send so a failed send can retry
  // on the next NO_MATCH evaluation.
  await recordAuditLog({
    actorId: 'system',
    actorRole: 'system',
    action: NO_SUPPLY_NOTICE_AUDIT_ACTION,
    entityType: 'JobRequest',
    entityId: jobRequest.id,
    after: { failureClass: params.failureClass },
  }).catch((err) => {
    console.error('[no-supply-notice] failed to record sentinel audit log', {
      jobRequestId: jobRequest.id,
      err,
    })
  })

  return { sent: true }
}
