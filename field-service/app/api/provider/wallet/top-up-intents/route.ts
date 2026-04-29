import { type NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { db } from '@/lib/db'
import {
  ProviderCreditPaymentIntentError,
  createManualEftTopUpIntent,
} from '@/lib/provider-credit-payment-intents'

type CreateTopUpIntentBody = {
  amountCents?: unknown
  amountRand?: unknown
  metadata?: unknown
}

function parseAmountCents(body: CreateTopUpIntentBody) {
  if (typeof body.amountCents === 'number') return body.amountCents
  if (typeof body.amountRand === 'number') return body.amountRand * 100
  return Number.NaN
}

function parseMetadata(body: CreateTopUpIntentBody) {
  if (!body.metadata || typeof body.metadata !== 'object' || Array.isArray(body.metadata)) {
    return undefined
  }
  return body.metadata as Record<string, unknown>
}

export async function POST(request: NextRequest) {
  const session = await getSession()
  if (!session || session.role !== 'provider') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const provider = await db.provider.findUnique({
    where: { userId: session.id },
    select: { id: true, phone: true },
  })
  if (!provider) {
    return NextResponse.json({ error: 'Provider not found' }, { status: 403 })
  }

  const body = await request.json().catch(() => ({})) as CreateTopUpIntentBody

  try {
    const result = await createManualEftTopUpIntent({
      providerId: provider.id,
      amountCents: parseAmountCents(body),
      providerCellphone: session.phone ?? provider.phone,
      metadata: parseMetadata(body),
    })

    return NextResponse.json(result, { status: 201 })
  } catch (error) {
    if (error instanceof ProviderCreditPaymentIntentError) {
      const status = error.code === 'PROVIDER_NOT_FOUND' ? 403 : 400
      return NextResponse.json({ error: error.message, code: error.code }, { status })
    }

    console.error('[provider/wallet/top-up-intents] Failed to create payment intent:', error)
    return NextResponse.json({ error: 'Could not create top-up payment intent' }, { status: 500 })
  }
}
