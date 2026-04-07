// GET  /api/quotes/[token]  — fetch quote details for the approval page
// PATCH /api/quotes/[token] — body: { action: 'approve' | 'decline' }
//   approve: creates Booking + Job in a transaction, notifies both parties
//   decline: marks quote declined, notifies provider

import { type NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { processQuoteDecision } from '@/lib/quotes'

type Params = { params: Promise<{ token: string }> }

export async function GET(_req: NextRequest, { params }: Params) {
  const reqId = crypto.randomUUID().slice(0, 8)
  const { token } = await params
  console.info(`[quotes:${reqId}] GET token=${token}`)
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
    console.warn(`[quotes:${reqId}] GET not found: token=${token}`)
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
  const body = await request.json().catch(() => ({})) as { action?: string }

  if (body.action !== 'approve' && body.action !== 'decline') {
    return NextResponse.json({ error: 'Invalid action' }, { status: 400 })
  }

  // Resolve quoteId from approval token
  const quoteRow = await db.quote.findUnique({
    where: { approvalToken: token },
    select: { id: true },
  })
  if (!quoteRow) {
    return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 })
  }

  const result = await processQuoteDecision(quoteRow.id, body.action as 'approve' | 'decline')

  if ('error' in result) {
    console.warn(`[quotes:${reqId}] Decision error: ${result.error} token=${token}`)
    const status =
      result.error === 'NOT_FOUND' ? 404 :
      result.error === 'ALREADY_ACTIONED' ? 409 :
      result.error === 'EXPIRED' ? 410 : 422
    return NextResponse.json({ error: result.error }, { status })
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
  action: string
  quote: {
    match: {
      provider: { phone: string; name: string }
      jobRequest: { customer: { phone: string; name: string }; category: string }
    }
  }
  booking?: { scheduledDate: Date }
}) {
  const { sendText, sendCtaUrl } = await import('@/lib/whatsapp-interactive')
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? ''
  const providerPhone = result.quote.match.provider.phone
  const customerPhone = result.quote.match.jobRequest.customer.phone
  const category = result.quote.match.jobRequest.category

  if (result.action === 'approved' && result.booking) {
    const dateStr = result.booking.scheduledDate.toLocaleDateString('en-ZA', {
      weekday: 'short', day: 'numeric', month: 'short',
    })
    await sendCtaUrl(
      providerPhone,
      `✅ *Quote Approved!*\n\n${category} job is confirmed for ${dateStr}.\n\nOpen the app to view full details:`,
      'View Job',
      `${appUrl}/technician`,
      { footer: 'Navigate and update job status from the app' }
    ).catch(() => {})
    await sendText(
      customerPhone,
      `✅ *Booking Confirmed!*\n\n${result.quote.match.provider.name} will arrive on ${dateStr}.\n\nYou'll receive a reminder the day before.`
    ).catch(() => {})
  } else {
    await sendText(
      providerPhone,
      `❌ The customer declined your quote for the ${category} job. The lead has been returned to the queue.`
    ).catch(() => {})
  }
}
