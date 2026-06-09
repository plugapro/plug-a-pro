// GET  /api/quotes/[token]  - fetch quote details for the approval page
// PATCH /api/quotes/[token] - body: { action: 'approve' | 'decline' }
//   approve: creates Booking + Job in a transaction, notifies both parties
//   decline: marks quote declined, notifies provider

import { type NextRequest, NextResponse } from 'next/server'
import { createHash } from 'crypto'
import { apiError } from '@/lib/api-response'
import { checkPilotGate, resolveAreaScopeByNodeId } from '@/lib/customer-serviceability'
import { db } from '@/lib/db'
import { processQuoteDecision } from '@/lib/quotes'
import { getPublicQuoteDecisionError } from '@/lib/route-action-errors'

type Params = { params: Promise<{ token: string }> }
const QUOTE_DEEP_LINK_ROUTE = '/api/quotes/[token]'

function hashQuoteToken(token: string) {
  return createHash('sha256').update(token).digest('base64url').slice(0, 24)
}

export async function GET(_req: NextRequest, { params }: Params) {
  const reqId = crypto.randomUUID().slice(0, 8)
  const { token } = await params
  const tokenHash = hashQuoteToken(token)
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
    console.warn('[quotes/deep-link] quote link validation failed', {
      req_id: reqId,
      route: QUOTE_DEEP_LINK_ROUTE,
      token_hash: tokenHash,
      link_type: 'quote_approval',
      target_id: null,
      viewer_type: 'customer',
      validation_result: 'invalid',
      action_attempted: 'view_quote',
      action_result: 'denied',
      failure_reason: 'QUOTE_NOT_FOUND',
    })
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  console.info('[quotes/deep-link] quote link opened', {
    req_id: reqId,
    route: QUOTE_DEEP_LINK_ROUTE,
    token_hash: tokenHash,
    link_type: 'quote_approval',
    target_id: quote.id,
    viewer_type: 'customer',
    validation_result: 'active',
    action_attempted: 'view_quote',
    action_result: 'allowed',
    quote_status: quote.status,
  })
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
  const tokenHash = hashQuoteToken(token)
  const body = await request.json().catch(() => ({})) as { action?: string; feedback?: string }
  const attemptedAction = body.action === 'approve' || body.action === 'decline'
    ? body.action
    : 'invalid'

  if (body.action !== 'approve' && body.action !== 'decline') {
    console.warn('[quotes/deep-link] quote decision rejected', {
      req_id: reqId,
      route: QUOTE_DEEP_LINK_ROUTE,
      token_hash: tokenHash,
      link_type: 'quote_approval',
      target_id: null,
      viewer_type: 'customer',
      validation_result: 'invalid',
      action_attempted: attemptedAction,
      action_result: 'denied',
      failure_reason: 'INVALID_ACTION',
    })
    return NextResponse.json({ error: 'Invalid action' }, { status: 400 })
  }

  // Resolve quoteId from approval token. On approve, also pull category and
  // suburb node so we can re-check the West Rand pilot gate — a quote may have
  // been issued before the gate flipped on, and we must not approve a booking
  // for a category that is no longer pilot-allowed.
  const quoteRow = await db.quote.findUnique({
    where: { approvalToken: token },
    select: {
      id: true,
      match: {
        select: {
          jobRequest: {
            select: {
              category: true,
              address: { select: { locationNodeId: true } },
            },
          },
        },
      },
    },
  })
  if (!quoteRow) {
    console.warn('[quotes/deep-link] quote decision rejected', {
      req_id: reqId,
      route: QUOTE_DEEP_LINK_ROUTE,
      token_hash: tokenHash,
      link_type: 'quote_approval',
      target_id: null,
      viewer_type: 'customer',
      validation_result: 'invalid',
      action_attempted: body.action,
      action_result: 'denied',
      failure_reason: 'QUOTE_NOT_FOUND',
    })
    const response = getPublicQuoteDecisionError({ code: 'NOT_FOUND' })
    return NextResponse.json({ error: response.message }, { status: response.status })
  }

  // West Rand pilot re-check: only on approve. If the category fell off the
  // pilot allowlist between quote issue and approval, return 409 so the
  // customer sees a clear conflict rather than a silent failure.
  if (body.action === 'approve') {
    const jobRequest = quoteRow.match?.jobRequest
    const candidateLocationNodeId = jobRequest?.address?.locationNodeId ?? null
    const areaScope = candidateLocationNodeId
      ? await resolveAreaScopeByNodeId(candidateLocationNodeId).catch(() => null)
      : null
    const pilotGate = await checkPilotGate({
      suburbSlug: areaScope?.node.slug ?? null,
      rawCategory: jobRequest?.category ?? null,
    })
    if (!pilotGate.ok) {
      return apiError(
        'pilot.category_no_longer_supported',
        'This category is no longer available in the West Rand pilot. Please contact support.',
        409,
        undefined,
        {
          category: 'conflict',
          retryable: false,
          suggestedActions: ['contact_support'],
          context: { quoteId: quoteRow.id, category: jobRequest?.category ?? null },
        },
      )
    }
  }

  const result = await processQuoteDecision(quoteRow.id, body.action as 'approve' | 'decline', {
    customerFeedback: body.action === 'decline' ? body.feedback ?? null : null,
  })

  if ('error' in result) {
    console.warn('[quotes/deep-link] quote decision blocked', {
      req_id: reqId,
      route: QUOTE_DEEP_LINK_ROUTE,
      token_hash: tokenHash,
      link_type: 'quote_approval',
      target_id: quoteRow.id,
      viewer_type: 'customer',
      validation_result: 'active',
      action_attempted: body.action,
      action_result: 'denied',
      failure_reason: result.error,
    })
    const response = getPublicQuoteDecisionError({ code: result.error })
    return NextResponse.json({ error: response.message }, { status: response.status })
  }

  console.info('[quotes/deep-link] quote decision applied', {
    req_id: reqId,
    route: QUOTE_DEEP_LINK_ROUTE,
    token_hash: tokenHash,
    link_type: 'quote_approval',
    target_id: result.quoteId,
    viewer_type: 'customer',
    validation_result: 'active',
    action_attempted: body.action,
    action_result: result.action,
  })

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
    let jobUrl: string | null = null
    if (result.jobRequestId && result.provider.id) {
      try {
        const { getProviderSignedJobHandoverUrlForJobRequest } = await import('@/lib/provider-lead-access')
        jobUrl = await getProviderSignedJobHandoverUrlForJobRequest({
          jobRequestId: result.jobRequestId,
          providerId: result.provider.id,
          providerPhone: result.provider.phone,
        })
      } catch {
        // Non-fatal - fall through to text-only fallback
      }
    }

    if (jobUrl) {
      await sendCtaUrl(
        providerPhone,
        `✅ *Quote Approved!*\n\n${category} job confirmed for ${dateStr}.\n\nOpen your secure job link to view full details and update your status.`,
        ctaLabelFor('view_job'),
        jobUrl,
        { footer: 'Secure link for this accepted job only.' }
      ).catch(() => {})
    } else {
      await sendText(
        providerPhone,
        `✅ *Quote Approved!*\n\n${category} job confirmed for ${dateStr}.\n\nReply *menu* in WhatsApp to continue and request your secure job link.`
      ).catch(() => {})
    }
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
