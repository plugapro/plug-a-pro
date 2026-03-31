// POST /api/technician/quotes
// Body: { matchId, labourCost, materialsCost?, description, estimatedHours?, validFor, preferredDate?, postInspection? }
// Creates a Quote linked to the Match and sends WhatsApp notification to the client.

import { randomBytes } from 'crypto'
import { type NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { db } from '@/lib/db'
import { sendQuoteToClient } from '@/lib/whatsapp-bot'

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

  // Idempotent — return existing quote before status guard to avoid double-submission window
  const existing = await db.quote.findFirst({ where: { matchId } })
  if (existing) {
    return NextResponse.json({ quoteId: existing.id, alreadySubmitted: true })
  }

  if (!['MATCHED', 'INSPECTION_SCHEDULED', 'INSPECTION_COMPLETE'].includes(match.status)) {
    return NextResponse.json({ error: 'Quote already submitted for this match' }, { status: 409 })
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
      preferredDate: preferredDate ? new Date(preferredDate) : null,
      postInspection,
      approvalToken,
      status: 'PENDING',
    },
  })

  await db.match.update({
    where: { id: matchId },
    data: { status: 'QUOTED' },
  })

  const customerPhone = match.jobRequest.customer.phone
  if (customerPhone) {
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
      console.error('[quotes] Failed to send WhatsApp quote notification:', err)
    })
  }

  return NextResponse.json({ quoteId: quote.id })
}
