import { type NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { db } from '@/lib/db'
import {
  ProviderCreditPaymentIntentError,
  createPayatTopUpIntent,
  createManualEftTopUpIntent,
  createPayfastTopUpIntent,
  type PayfastTopUpMethod,
} from '@/lib/provider-credit-payment-intents'
import { verifyRequestOrigin } from '@/lib/csrf'
import { apiError } from '@/lib/api-response'

type CreateTopUpIntentBody = {
  amountCents?: unknown
  /** Backward-compatible JSON client path; normalized then validated as cents. */
  amountRand?: unknown
  /** Optional payment method: "PAYAT" (default) | "MANUAL_EFT" | "PAYFAST_CARD" | "PAYFAST_EFT" | "PAYFAST_SCODE" */
  paymentMethod?: unknown
  metadata?: unknown
}

const PAYFAST_METHODS = new Set<string>(['PAYFAST_CARD', 'PAYFAST_EFT', 'PAYFAST_SCODE'])

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
  if (!verifyRequestOrigin(request, [])) {
    return apiError('FORBIDDEN', 'Origin not allowed', 403)
  }

  const session = await getSession()
  if (!session || session.role !== 'provider') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const provider = await db.provider.findUnique({
    where: { userId: session.id },
    select: { id: true, phone: true, name: true, email: true },
  })
  if (!provider) {
    return NextResponse.json({ error: 'Provider not found' }, { status: 403 })
  }

  const body = await request.json().catch(() => ({})) as CreateTopUpIntentBody
  const amountCents = parseAmountCents(body)
  const paymentMethod = typeof body.paymentMethod === 'string' ? body.paymentMethod : 'PAYAT'

  try {
    if (PAYFAST_METHODS.has(paymentMethod)) {
      const result = await createPayfastTopUpIntent({
        providerId: provider.id,
        amountCents,
        paymentMethod: paymentMethod as PayfastTopUpMethod,
        providerName: provider.name,
        providerEmail: provider.email,
        providerCellphone: session.phone ?? provider.phone,
        metadata: parseMetadata(body),
      })
      return NextResponse.json(result, { status: 201 })
    }

    if (paymentMethod === 'MANUAL_EFT') {
      const result = await createManualEftTopUpIntent({
        providerId: provider.id,
        amountCents,
        providerCellphone: session.phone ?? provider.phone,
        metadata: parseMetadata(body),
      })
      return NextResponse.json(result, { status: 201 })
    }

    // Default: Pay@ retail cash, QR, and hosted payment link.
    if (paymentMethod !== 'PAYAT') {
      return NextResponse.json({ error: 'Unsupported payment method' }, { status: 400 })
    }

    const result = await createPayatTopUpIntent({
      providerId: provider.id,
      amountCents,
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
