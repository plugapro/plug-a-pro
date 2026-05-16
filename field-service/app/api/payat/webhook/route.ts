import { createHmac, timingSafeEqual } from 'crypto'
import { type NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { creditProviderWalletFromPayatWebhook } from '@/lib/provider-credit-gateway-itn'

type PayatWebhookPayload = {
  reference?: unknown
  clientReferenceNumber?: unknown
  sourceReference?: unknown
  status?: unknown
  amount?: unknown
  transactionId?: unknown
  paymentId?: unknown
}

function requireWebhookSecret() {
  // Webhook verification is fail-closed because this route credits paid wallet balance.
  const value = process.env.PAYAT_WEBHOOK_SECRET?.trim()
  if (!value) throw new Error('PAYAT_WEBHOOK_SECRET must be set')
  return value
}

function isValidSignature(rawBody: string, signature: string) {
  const expected = createHmac('sha256', requireWebhookSecret()).update(rawBody).digest('hex')
  const received = signature.trim()

  if (!received) return false

  const expectedBuffer = Buffer.from(expected, 'hex')
  const receivedBuffer = Buffer.from(received, 'hex')
  if (expectedBuffer.length !== receivedBuffer.length) return false

  return timingSafeEqual(expectedBuffer, receivedBuffer)
}

// Minimum package is R100 = 10000 cents. Amounts below this threshold are
// assumed to be in rands (Pay@ gateway variants differ) and converted.
const MIN_PACKAGE_CENTS = 10_000

function normalisePayload(payload: PayatWebhookPayload) {
  // Pay@ notifications are treated as authoritative only after signature validation.
  // clientReferenceNumber is set to the PaymentIntent UUID in the RTP create call.
  // reference / sourceReference are gateway-specific aliases and may carry a different
  // value — they are used only as a fallback.
  const reference =
    typeof payload.clientReferenceNumber === 'string' ? payload.clientReferenceNumber.trim() :
    typeof payload.reference === 'string' ? payload.reference.trim() :
    typeof payload.sourceReference === 'string' ? payload.sourceReference.trim() : ''
  const usedClientRef = typeof payload.clientReferenceNumber === 'string'

  const status = typeof payload.status === 'string' ? payload.status.trim().toUpperCase() : ''

  // Pay@ gateway variants differ on amount units (rands vs cents). Parse as float
  // and normalise to cents: values below the minimum package are treated as rands.
  const rawAmount = typeof payload.amount === 'number'
    ? payload.amount
    : typeof payload.amount === 'string'
      ? parseFloat(payload.amount)
      : Number.NaN
  const amount = Number.isFinite(rawAmount)
    ? rawAmount < MIN_PACKAGE_CENTS ? Math.round(rawAmount * 100) : Math.round(rawAmount)
    : Number.NaN

  const gatewayReference = typeof payload.transactionId === 'string'
    ? payload.transactionId
    : typeof payload.paymentId === 'string'
      ? payload.paymentId
      : null

  return { reference, usedClientRef, status, amount, gatewayReference }
}

export async function POST(request: NextRequest) {
  const rawBody = await request.text()
  const signature = request.headers.get('x-payat-signature') ?? ''

  if (!isValidSignature(rawBody, signature)) {
    console.warn('[payat-webhook] rejected notification with invalid signature')
    return NextResponse.json({ error: 'Invalid signature' }, { status: 401 })
  }

  let parsed: PayatWebhookPayload
  try {
    parsed = JSON.parse(rawBody) as PayatWebhookPayload
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const payload = normalisePayload(parsed)

  if (payload.status !== 'PAID' && payload.status !== 'COMPLETED') {
    return NextResponse.json({ received: true })
  }

  // Primary lookup: clientReferenceNumber is our intent UUID primary key.
  let intent = await db.paymentIntent.findUnique({
    where: { id: payload.reference },
    select: {
      id: true,
      amountCents: true,
      status: true,
      creditedAt: true,
      paymentMethod: true,
    },
  })

  // Secondary lookup: if Pay@ fell back to reference/sourceReference (which may
  // carry the human-readable paymentReference e.g. "PAT-ABCDEF"), try matching
  // by paymentReference instead.
  if (!intent && !payload.usedClientRef && payload.reference) {
    intent = await db.paymentIntent.findFirst({
      where: { paymentReference: payload.reference, paymentMethod: 'PAYAT' },
      select: {
        id: true,
        amountCents: true,
        status: true,
        creditedAt: true,
        paymentMethod: true,
      },
    })
  }

  if (!intent) {
    console.warn('[payat-webhook] notification for unknown payment intent', {
      reference: payload.reference,
    })
    return NextResponse.json({ received: true })
  }

  if (intent.status === 'CREDITED' || intent.creditedAt) {
    return NextResponse.json({ received: true })
  }

  if (intent.paymentMethod !== 'PAYAT') {
    console.warn('[payat-webhook] notification for non-Pay@ payment intent', {
      intentId: intent.id,
      paymentMethod: intent.paymentMethod,
    })
    return NextResponse.json({ received: true })
  }

  if (!Number.isFinite(payload.amount) || payload.amount !== intent.amountCents) {
    console.error('[payat-webhook] amount mismatch; marking intent failed', {
      intentId: intent.id,
      expected: intent.amountCents,
      received: payload.amount,
    })
    await db.paymentIntent.update({
      where: { id: intent.id },
      data: {
        status: 'FAILED',
        itnReceivedAt: new Date(),
        itnPaymentStatus: payload.status,
        itnAmountCents: Number.isFinite(payload.amount) ? payload.amount : null,
        gatewayReference: payload.gatewayReference,
      },
    })
    return NextResponse.json({ received: true, rejected: 'amount_mismatch' })
  }

  await db.paymentIntent.update({
    where: { id: intent.id },
    data: {
      status: 'ITN_RECEIVED',
      itnReceivedAt: new Date(),
      itnPaymentStatus: payload.status,
      itnAmountCents: payload.amount,
      gatewayReference: payload.gatewayReference,
      paidAt: new Date(),
    },
  })

  try {
    const result = await creditProviderWalletFromPayatWebhook(intent.id)
    if (!result.credited) {
      console.warn('[payat-webhook] wallet was not credited', {
        intentId: intent.id,
        reason: result.reason,
      })
    }
  } catch (error) {
    console.error('[payat-webhook] wallet crediting failed', {
      intentId: intent.id,
      error,
    })
    return NextResponse.json({ error: 'DB error' }, { status: 500 })
  }

  return NextResponse.json({ received: true })
}
