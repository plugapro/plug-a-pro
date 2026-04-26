// GET  /api/quotes/[token]  — fetch quote details for the approval page
// PATCH /api/quotes/[token] — body: { action: 'approve' | 'decline' }
//   approve: creates Booking + Job in a transaction, notifies both parties
//   decline: marks quote declined, notifies provider

import { type NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { processQuoteDecision } from '@/lib/quotes'
import { getPublicQuoteDecisionError } from '@/lib/route-action-errors'

type Params = { params: Promise<{ token: string }> }

export async function GET(_req: NextRequest, { params }: Params) {
  const reqId = crypto.randomUUID().slice(0, 8)
  const { token } = await params
  const quote = await db.quote.findUnique({
    where: { approvalToken: token },
    include: {
      match: {
        include: {
          provider: { select: { name: true } },
          jobRequest: {
            include: { address: true },
          },
        },
      },
    },
  })

  if (!quote) {
    console.warn(`[quotes:${reqId}] GET not found`)
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  console.info(`[quotes:${reqId}] GET quote=${quote.id} status=${quote.status}`)
  return NextResponse.json({
    id: quote.id,
    status: quote.status,
    providerName: quote.match.provider.name,
    labourCost: Number(quote.labourCost),
    materialsCost: Number(quote.materialsCost),
    totalAmount: Number(quote.amount),
    description: quote.description,
    estimatedHours: quote.estimatedHours,
    validUntil: quote.validUntil?.toISOString() ?? null,
    preferredDate: quote.preferredDate?.toISOString() ?? null,
    category: quote.match.jobRequest.category,
    area: quote.match.jobRequest.address?.suburb ?? null,
    expired: quote.validUntil ? new Date() > quote.validUntil : false,
  })
}

export async function PATCH(request: NextRequest, { params }: Params) {
  const reqId = crypto.randomUUID().slice(0, 8)
  const { token } = await params
  const body = await request.json().catch(() => ({})) as { action?: string; feedback?: string }

  if (body.action !== 'approve' && body.action !== 'decline') {
    return NextResponse.json({ error: 'Invalid action' }, { status: 400 })
  }

  // Resolve quoteId from approval token
  const quoteRow = await db.quote.findUnique({
    where: { approvalToken: token },
    select: { id: true },
  })
  if (!quoteRow) {
    const response = getPublicQuoteDecisionError({ code: 'NOT_FOUND' })
    return NextResponse.json({ error: response.message }, { status: response.status })
  }

  const result = await processQuoteDecision(quoteRow.id, body.action as 'approve' | 'decline', {
    customerFeedback: body.action === 'decline' ? body.feedback ?? null : null,
  })

  if ('error' in result) {
    console.warn(`[quotes:${reqId}] Decision error: ${result.error}`)
    const response = getPublicQuoteDecisionError({ code: result.error })
    return NextResponse.json({ error: response.message }, { status: response.status })
  }

  console.info(`[quotes:${reqId}] Quote ${result.quoteId} ${result.action}`)

  // Notify both parties asynchronously (fire-and-forget)
  notifyAfterDecision(result).catch(() => {})

  return NextResponse.json({
    status: result.action,
    scheduledDate: result.action === 'approved' ? result.scheduledDate.toISOString() : null,
  })
}

async function notifyAfterDecision(result: {
  action: 'approved' | 'declined'
  bookingId?: string
  provider: { phone: string; name: string }
  customer: { phone: string; name: string }
  category: string
  scheduledDate?: Date
  feedback?: string | null
}) {
  const { sendText, sendCtaUrl } = await import('@/lib/whatsapp-interactive')
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? ''
  const providerPhone = result.provider.phone
  const customerPhone = result.customer.phone
  const category = result.category

  if (result.action === 'approved' && result.scheduledDate && result.bookingId) {
    const dateStr = result.scheduledDate.toLocaleDateString('en-ZA', {
      weekday: 'short', day: 'numeric', month: 'short',
    })
    await sendCtaUrl(
      providerPhone,
      `✅ *Quote Approved!*\n\n${category} job arrangement is confirmed for ${dateStr}.\n\nOpen the app to view full details:`,
      'View Job',
      `${appUrl}/provider`,
      { footer: 'Navigate and update job status from the app' }
    ).catch(() => {})
    const { sendBookingConfirmation } = await import('@/lib/whatsapp')
    await sendBookingConfirmation({
      bookingId: result.bookingId,
      customerName: result.customer.name,
      customerPhone,
      serviceName: category,
      scheduledWindow: dateStr,
      bookingUrl: `${appUrl}/bookings/${result.bookingId}`,
    }).catch(() => {})
  } else {
    await sendText(
      providerPhone,
      `❌ The customer requested a quote revision for the ${category} job.${result.feedback ? `\n\nCustomer feedback:\n${result.feedback}` : ''}\n\nReview the scope and submit a revised quote through the app when ready.`
    ).catch(() => {})
  }
}
