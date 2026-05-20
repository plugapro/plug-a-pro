// GET  /api/quotes/[token]  - fetch quote details for the approval page
// PATCH /api/quotes/[token] - body: { action: 'approve' | 'decline' }
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
  provider: { id: string; phone: string; name: string }
  customer: { phone: string; name: string }
  category: string
  scheduledDate?: Date
  feedback?: string | null
  jobRequestId?: string
}) {
  const { sendText, sendCtaUrl } = await import('@/lib/whatsapp-interactive')
  const { ctaLabelFor } = await import('@/lib/whatsapp-copy')
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? ''
  const providerPhone = result.provider.phone
  const customerPhone = result.customer.phone
  const category = result.category

  if (result.action === 'approved' && result.scheduledDate && result.bookingId) {
    const dateStr = result.scheduledDate.toLocaleDateString('en-ZA', {
      weekday: 'short', day: 'numeric', month: 'short',
    })

    // Resolve a signed no-login job handover link for the provider.
    // Falls back to the generic portal if the lead or env is missing.
    let jobUrl: string | null = null
    if (result.jobRequestId && result.provider.id) {
      try {
        const [{ getProviderSignedJobHandoverUrl }, { db }] = await Promise.all([
          import('@/lib/provider-lead-access'),
          import('@/lib/db'),
        ])
        const lead = await db.lead.findFirst({
          where: {
            jobRequestId: result.jobRequestId,
            providerId: result.provider.id,
            status: 'ACCEPTED',
          },
          select: { id: true },
        })
        if (lead) {
          jobUrl = await getProviderSignedJobHandoverUrl({
            leadId: lead.id,
            providerId: result.provider.id,
            jobRequestId: result.jobRequestId,
          })
        }
      } catch {
        // Non-fatal - fall through to generic URL
      }
    }

    await sendCtaUrl(
      providerPhone,
      `✅ *Quote Approved!*\n\n${category} job confirmed for ${dateStr}.\n\nOpen the job to view full details and update your status:`,
      ctaLabelFor('view_job'),
      jobUrl ?? `${appUrl}/provider`,
      {
        footer: jobUrl
          ? 'Secure link for this job · no login needed'
          : 'Navigate and update job status from the app',
      }
    ).catch(() => {})
    const [{ sendBookingConfirmation }, { getJobRequestAccessUrl }] = await Promise.all([
      import('@/lib/whatsapp'),
      import('@/lib/job-request-access'),
    ])
    const ticketUrl = result.jobRequestId
      ? await getJobRequestAccessUrl(result.jobRequestId).catch(() => null)
      : null
    await sendBookingConfirmation({
      bookingId: result.bookingId,
      customerName: result.customer.name,
      customerPhone,
      serviceName: category,
      scheduledWindow: dateStr,
      bookingUrl: ticketUrl ?? appUrl,
    }).catch(() => {})
  } else {
    await sendText(
      providerPhone,
      `❌ The customer requested a quote revision for the ${category} job.${result.feedback ? `\n\nCustomer feedback:\n${result.feedback}` : ''}\n\nReview the scope and submit a revised quote through the app when ready.`
    ).catch(() => {})
  }
}
