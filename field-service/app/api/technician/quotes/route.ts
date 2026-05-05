// POST /api/technician/quotes
// Body: { matchId, labourCost, materialsCost?, description, estimatedHours?, validFor, preferredDate, postInspection? }
// Creates a Quote linked to the Match and sends WhatsApp notification to the client.

import { randomBytes } from 'crypto'
import { type NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { db } from '@/lib/db'
import { sendQuoteToClient } from '@/lib/whatsapp-bot'
import { sendQuoteReady, sendCustomerQuoteReadyNotification } from '@/lib/whatsapp'
import { openCase } from '@/lib/cases'

const VALID_FOR_OPTIONS: Record<string, number> = {
  '24h': 24, '48h': 48, '72h': 72, '1w': 168,
}

export async function POST(request: NextRequest) {
  const session = await getSession()
  if (!session || session.role !== 'provider') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const provider = await db.provider.findUnique({ where: { userId: session.id } })
  if (!provider) {
    return NextResponse.json({ error: 'Provider not found' }, { status: 403 })
  }

  const body = await request.json().catch(() => ({})) as {
    matchId?: string
    labourCost?: number
    materialsCost?: number
    description?: string
    estimatedHours?: number
    validFor?: string
    preferredDate?: string
    postInspection?: boolean
  }

  const {
    matchId,
    labourCost,
    materialsCost = 0,
    description,
    estimatedHours,
    validFor = '48h',
    preferredDate,
    postInspection = false,
  } = body

  if (!matchId || !labourCost || labourCost <= 0 || !description || description.length < 10) {
    return NextResponse.json({ error: 'Invalid input' }, { status: 400 })
  }

  if (!preferredDate) {
    return NextResponse.json({ error: 'Preferred job date is required' }, { status: 400 })
  }

  const preferredDateValue = new Date(preferredDate)
  if (Number.isNaN(preferredDateValue.getTime())) {
    return NextResponse.json({ error: 'Preferred job date is invalid' }, { status: 400 })
  }

  const startOfToday = new Date()
  startOfToday.setHours(0, 0, 0, 0)
  if (preferredDateValue < startOfToday) {
    return NextResponse.json({ error: 'Preferred job date must be today or later' }, { status: 400 })
  }

  const hours = VALID_FOR_OPTIONS[validFor] ?? 48
  const validUntil = new Date(Date.now() + hours * 60 * 60 * 1000)

  const match = await db.match.findUnique({
    where: { id: matchId },
    include: {
      jobRequest: {
        include: {
          customer: { select: { phone: true, name: true } },
        },
      },
    },
  })

  if (!match || match.providerId !== provider.id) {
    return NextResponse.json({ error: 'Match not found' }, { status: 404 })
  }

  // One live quote at a time. Declined / expired quotes can be revised by creating
  // a new quote version on the same match.
  const existing = await db.quote.findFirst({
    where: { matchId },
    orderBy: { createdAt: 'desc' },
  })
  if (existing) {
    if (existing.status === 'PENDING') {
      const isExpired = existing.validUntil ? new Date() > existing.validUntil : false
      if (!isExpired) {
        return NextResponse.json({ quoteId: existing.id, alreadySubmitted: true, status: existing.status })
      }

      await db.quote.update({
        where: { id: existing.id },
        data: { status: 'EXPIRED' },
      })
    } else if (existing.status === 'APPROVED') {
      return NextResponse.json({ error: 'This quote has already been approved' }, { status: 409 })
    }
  }

  const expectedStatuses = match.inspectionNeeded
    ? ['INSPECTION_COMPLETE', 'QUOTE_DECLINED']
    : ['MATCHED', 'QUOTE_DECLINED']

  if (!expectedStatuses.includes(match.status)) {
    const error = match.inspectionNeeded
      ? 'Complete the inspection before submitting a quote'
      : 'Quote already submitted for this match'
    return NextResponse.json({ error }, { status: 409 })
  }

  if (match.inspectionNeeded && !postInspection) {
    return NextResponse.json(
      { error: 'Inspection jobs must be submitted as post-inspection quotes' },
      { status: 400 },
    )
  }

  const totalAmount = labourCost + materialsCost
  const approvalToken = randomBytes(24).toString('hex')

  const quote = await db.quote.create({
    data: {
      matchId,
      amount: totalAmount,
      labourCost,
      materialsCost,
      estimatedHours: estimatedHours ?? null,
      description,
      validUntil,
      preferredDate: preferredDateValue,
      postInspection,
      approvalToken,
      status: 'PENDING',
    },
  })

  await db.match.update({
    where: { id: matchId },
    data: { status: 'QUOTED' },
  })

  openCase({ queueType: 'QUOTE_APPROVAL', entityType: 'QUOTE', entityId: quote.id })
    .catch((err) => console.error(`[quotes] openCase QUOTE_APPROVAL failed for ${quote.id}:`, err))

  const customerPhone = match.jobRequest.customer.phone
  const customerName = match.jobRequest.customer.name ?? 'there'
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? ''

  if (customerPhone) {
    // Interactive message — works when customer is in an active 24h session
    sendQuoteToClient({
      customerPhone,
      providerName: provider.name,
      quoteId: quote.id,
      labourCost,
      materialsCost,
      totalAmount,
      description,
      estimatedHours: estimatedHours ?? null,
      validUntil,
      approvalToken,
    }).catch((err: unknown) => {
      console.error('[quotes] Failed to send WhatsApp interactive quote notification:', err)
    })

    // Template fallback — delivers even when customer is outside the 24h session window
    sendQuoteReady({
      bookingId: matchId,
      customerName,
      customerPhone,
      serviceName: match.jobRequest.category,
      quotedPrice: `R ${totalAmount.toFixed(2)}`,
      quoteUrl: `${appUrl}/quotes/${approvalToken}`,
    }).catch((err: unknown) => {
      console.error('[quotes] Failed to send WhatsApp quote_ready template:', err)
    })

    // CW3 — idempotent quote-ready notification (customer_quote_ready template)
    sendCustomerQuoteReadyNotification({
      customerPhone,
      customerName,
      providerName: provider.name,
      serviceName: match.jobRequest.category,
      amount: totalAmount,
      estimatedHours: estimatedHours ?? undefined,
      shortDescription: description,
      validUntil,
      quoteId: quote.id,
      jobRequestId: match.jobRequestId,
    }).catch((err: unknown) => {
      console.error('[quotes] Failed to send CW3 quote-ready notification:', err)
    })
  }

  return NextResponse.json({ quoteId: quote.id })
}
