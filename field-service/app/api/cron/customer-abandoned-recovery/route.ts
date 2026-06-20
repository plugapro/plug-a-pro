// ─── Cron: Nudge customers who started a job_request flow but didn't finish ───
// Customer-side funnel-recovery — finds WhatsApp conversations where the
// customer entered the job_request flow and abandoned mid-way (browse_categories,
// addr_confirm, collect_issue_description, etc.) without ever submitting. Sends
// the `customer_abandoned_recovery` UTILITY template so it delivers outside the
// 24h window. Dedup via message_events lookup so a phone gets at most one nudge
// per stuck conversation per 14 days.
//
// Secured by CRON_SECRET header (Authorization: Bearer <secret>).
// Flag-gated by `customer.abandoned_recovery.cron` — when disabled, the route
// returns immediately with skipped=0.

import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { isEnabled } from '@/lib/flags'
import { hasSuccessfulMessageForRecipient } from '@/lib/message-events'
import { sendCustomerAbandonedRecovery } from '@/lib/whatsapp'

const FLAG = 'customer.abandoned_recovery.cron'

// When to nudge: conversation last touched between 4h and 7 days ago.
// 4h lower bound = give the customer a chance to come back on their own and
// avoid pinging mid-session. 7d upper bound = don't pester long-cold leads.
const MIN_AGE_HOURS = 4
const MAX_AGE_DAYS = 7

// Dedup window: a phone gets at most one abandoned-recovery nudge in this window.
const DEDUP_DAYS = 14

// Steps that count as "abandoned mid-flow" — past the welcome menu but before
// the request has been submitted. Reaching `job_request_submitted` means the
// customer DID finish, so the step set is everything except submission.
const STUCK_STEPS = [
  'browse_categories',
  'collect_name',
  'collect_address',
  'collect_address_street',
  'addr_select_province',
  'addr_select_city',
  'addr_select_region',
  'addr_select_suburb',
  'addr_confirm',
  'collect_issue_description',
  'collect_availability',
  'collect_photos',
  'confirm_job_request',
]

interface ConversationData {
  category?: string
  selectedCategory?: string
  name?: string
  firstName?: string
}

function firstName(name: string | null | undefined): string {
  return (name ?? '').trim().split(/\s+/)[0] || 'there'
}

function pickCategory(data: ConversationData | null | undefined): string | null {
  if (!data) return null
  const raw = (data.category ?? data.selectedCategory ?? '').trim()
  if (!raw) return null
  // Convert 'Handyman'/'handyman'/'Garden & Landscaping' → human-friendly lowercase service phrase
  return raw.toLowerCase()
}

export async function GET(request: Request) {
  const authHeader = request.headers.get('authorization')
  if (!process.env.CRON_SECRET || authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return new NextResponse('Unauthorized', { status: 401 })
  }

  const cronStart = Date.now()
  const cronName = 'customer-abandoned-recovery'
  console.log(JSON.stringify({ event: 'cron_start', cron: cronName, timestamp: new Date().toISOString() }))

  const enabled = await isEnabled(FLAG)
  if (!enabled) {
    console.log(JSON.stringify({ event: 'cron_skipped', cron: cronName, reason: 'flag_disabled', flag: FLAG }))
    return NextResponse.json({ skipped: 0, reason: 'flag_disabled' })
  }

  try {
    const reqId = crypto.randomUUID().slice(0, 8)
    const now = new Date()
    const upper = new Date(now.getTime() - MIN_AGE_HOURS * 60 * 60 * 1000)
    const lower = new Date(now.getTime() - MAX_AGE_DAYS * 24 * 60 * 60 * 1000)
    const dedupSince = new Date(now.getTime() - DEDUP_DAYS * 24 * 60 * 60 * 1000)
    const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'https://app.plugapro.co.za'

    const conversations = await db.conversation.findMany({
      where: {
        flow: 'job_request',
        step: { in: STUCK_STEPS },
        isTestSession: false,
        updatedAt: { gte: lower, lte: upper },
      },
      select: { id: true, phone: true, step: true, data: true, updatedAt: true },
      take: 100,
    })

    let sent = 0
    let skippedNoCategory = 0
    let skippedDeduped = 0
    let skippedTemplateNotApproved = 0
    let failed = 0

    for (const conv of conversations) {
      if (!conv.phone) continue
      try {
        const data = (conv.data ?? null) as ConversationData | null
        const category = pickCategory(data)
        if (!category) {
          skippedNoCategory++
          console.info(`[cron/${cronName}:${reqId}] no_category, skipping conv ${conv.id}`)
          continue
        }

        const alreadyNudged = await hasSuccessfulMessageForRecipient({
          to: conv.phone,
          templateName: 'customer_abandoned_recovery',
          since: dedupSince,
        })
        if (alreadyNudged) {
          skippedDeduped++
          console.info(`[cron/${cronName}:${reqId}] deduped, skipping conv ${conv.id}`)
          continue
        }

        // Customer record may not exist yet — the user abandoned before submit.
        // Pull the name from conversation.data when we have it, else fall back.
        const customer = await db.customer.findUnique({
          where: { phone: conv.phone },
          select: { name: true },
        })
        const displayName = firstName(customer?.name ?? data?.name ?? data?.firstName)

        await sendCustomerAbandonedRecovery({
          customerPhone: conv.phone,
          customerName: displayName,
          serviceCategory: category,
          pickupUrl: appUrl,
          conversationId: conv.id,
        })
        sent++
        console.log(`[cron/${cronName}:${reqId}] nudged conv ${conv.id} step=${conv.step}`)
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        if (msg.includes('[TEMPLATE_NOT_APPROVED]')) {
          skippedTemplateNotApproved++
          console.warn(`[cron/${cronName}:${reqId}] template_not_approved, conv ${conv.id} — Meta approval pending`)
        } else {
          failed++
          console.error(`[cron/${cronName}:${reqId}] failed conv ${conv.id}:`, msg)
        }
      }
    }

    const duration = Date.now() - cronStart
    console.log(JSON.stringify({
      event: 'cron_complete',
      cron: cronName,
      durationMs: duration,
      sent,
      skippedNoCategory,
      skippedDeduped,
      skippedTemplateNotApproved,
      failed,
      considered: conversations.length,
      timestamp: new Date().toISOString(),
    }))
    return NextResponse.json({
      sent,
      skippedNoCategory,
      skippedDeduped,
      skippedTemplateNotApproved,
      failed,
      considered: conversations.length,
      durationMs: duration,
    })
  } catch (err) {
    const duration = Date.now() - cronStart
    console.error(JSON.stringify({
      event: 'cron_error',
      cron: cronName,
      durationMs: duration,
      error: err instanceof Error ? err.message : String(err),
      timestamp: new Date().toISOString(),
    }))
    throw err
  }
}
