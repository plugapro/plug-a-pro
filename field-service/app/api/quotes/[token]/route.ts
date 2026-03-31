// GET  /api/quotes/[token]  — fetch quote details for the approval page
// PATCH /api/quotes/[token] — body: { action: 'approve' | 'decline' }
//   approve: creates Booking + Job in a transaction, notifies both parties
//   decline: marks quote declined, notifies provider

import { type NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'

type Params = { params: Promise<{ token: string }> }

export async function GET(_req: NextRequest, { params }: Params) {
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

  if (!quote) return NextResponse.json({ error: 'Not found' }, { status: 404 })

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
  const { token } = await params
  const body = await request.json().catch(() => ({})) as { action?: string }

  if (body.action !== 'approve' && body.action !== 'decline') {
    return NextResponse.json({ error: 'Invalid action' }, { status: 400 })
  }

  const result = await db.$transaction(async (tx) => {
    const quote = await tx.quote.findUnique({
      where: { approvalToken: token },
      include: {
        match: {
          include: {
            provider: { select: { id: true, phone: true, name: true } },
            jobRequest: {
              include: {
                customer: { select: { id: true, phone: true, name: true } },
                address: true,
              },
            },
          },
        },
      },
    })

    if (!quote) throw new Error('NOT_FOUND')
    if (quote.status !== 'PENDING') throw new Error('ALREADY_ACTIONED')
    if (quote.validUntil && new Date() > quote.validUntil) throw new Error('EXPIRED')

    if (body.action === 'decline') {
      await tx.quote.update({
        where: { id: quote.id },
        data: { status: 'DECLINED', declinedAt: new Date() },
      })
      await tx.match.update({
        where: { id: quote.matchId },
        data: { status: 'QUOTE_DECLINED' },
      })
      return { action: 'declined', quote }
    }

    // Approve: update quote + match, create Booking + Job
    await tx.quote.update({
      where: { id: quote.id },
      data: { status: 'APPROVED', approvedAt: new Date() },
    })
    await tx.match.update({
      where: { id: quote.matchId },
      data: { status: 'QUOTE_APPROVED' },
    })

    const scheduledDate = quote.preferredDate ?? new Date(Date.now() + 48 * 60 * 60 * 1000)

    const booking = await tx.booking.create({
      data: {
        matchId: quote.matchId,
        quoteId: quote.id,
        status: 'SCHEDULED',
        scheduledDate,
      },
    })

    await tx.job.create({
      data: {
        bookingId: booking.id,
        providerId: quote.match.provider.id,
        status: 'SCHEDULED',
      },
    })

    return { action: 'approved', quote, booking }
  }).catch((err: unknown) => {
    const msg = err instanceof Error ? err.message : 'UNKNOWN'
    return { error: msg }
  })

  if ('error' in result) {
    const status =
      result.error === 'NOT_FOUND' ? 404 :
      result.error === 'ALREADY_ACTIONED' ? 409 :
      result.error === 'EXPIRED' ? 410 : 422
    return NextResponse.json({ error: result.error }, { status })
  }

  // Notify both parties asynchronously (fire-and-forget)
  notifyAfterDecision(result).catch(() => {})

  return NextResponse.json({ status: result.action })
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
