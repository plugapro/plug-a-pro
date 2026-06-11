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

// Statuses that represent a completed payment and trigger wallet crediting.
const PAYMENT_COMPLETE_STATUSES = new Set(['PAID', 'COMPLETED'])

// These statuses mean the payment was cancelled or reversed - close the intent
// so a stale PAID retry cannot double-credit after a reversal.
const TERMINAL_NEGATIVE_STATUSES = new Set(['CANCELLED', 'REVERSED', 'REFUNDED'])

// These reasons from creditProviderWalletFromPayatWebhook are expected under
// normal operation (e.g. Pay@ retrying an already-credited webhook).
const BENIGN_NOT_CREDITED_REASONS = new Set([
  'already credited',
  'already credited (concurrent call)',
])

function requireWebhookSecret(): string {
  // Webhook verification is fail-closed because this route credits paid wallet balance.
  const value = process.env.PAYAT_WEBHOOK_SECRET?.trim()
  if (!value) throw new Error('PAYAT_WEBHOOK_SECRET must be set')
  return value
}

function isValidSignature(rawBody: string, signature: string, secret: string) {
  const expected = createHmac('sha256', secret).update(rawBody).digest('hex')
  const received = signature.trim().replace(/^sha256=/i, '')

  if (!received) return false

  const expectedBuffer = Buffer.from(expected, 'hex')
  const receivedBuffer = decodeSignature(received)
  if (!receivedBuffer) {
    console.warn('[payat-webhook] signature decode failed')
    return false
  }
  if (expectedBuffer.length !== receivedBuffer.length) {
    // Length mismatch usually means the signature was base64-encoded rather than
    // hex-encoded. Check Pay@ merchant portal → webhook settings if this fires.
    console.warn('[payat-webhook] signature length mismatch - possible encoding difference', {
      expectedLen: expectedBuffer.length,
      receivedLen: receivedBuffer.length,
    })
    return false
  }

  return timingSafeEqual(expectedBuffer, receivedBuffer)
}

function decodeSignature(signature: string) {
  if (/^[0-9a-f]+$/i.test(signature) && signature.length % 2 === 0) {
    return Buffer.from(signature, 'hex')
  }

  try {
    const base64 = Buffer.from(signature, 'base64')
    // A SHA-256 HMAC is always 32 bytes. Reject anything that decodes to a
    // different length - it is either garbage or a wrong encoding.
    if (base64.length === 32) return base64
  } catch {
    return null
  }

  return null
}

function normalisePayload(payload: PayatWebhookPayload) {
  // clientReferenceNumber is set to the PaymentIntent UUID in the RTP create call.
  // reference / sourceReference are gateway-specific aliases - used as fallback.
  const reference =
    typeof payload.clientReferenceNumber === 'string' ? payload.clientReferenceNumber.trim() :
    typeof payload.reference === 'string' ? payload.reference.trim() :
    typeof payload.sourceReference === 'string' ? payload.sourceReference.trim() : ''
  const usedClientRef = typeof payload.clientReferenceNumber === 'string'

  const status = typeof payload.status === 'string' ? payload.status.trim().toUpperCase() : ''

  // The Pay@ integrator endpoint always reports amounts in cents - the same unit
  // we send and store on PaymentIntent. We deliberately do NOT apply any
  // cent/rand heuristic here: a heuristic that multiplied small values by 100
  // would let an R1/R2/R5 underpayment (cents 100/200/500) satisfy an
  // R100/R200/R500 intent. The amount is compared exactly downstream; if Pay@
  // ever reports rands, the conversion must be made in one dedicated, explicit
  // place rather than guessed from the magnitude.
  const rawAmount = typeof payload.amount === 'number'
    ? payload.amount
    : typeof payload.amount === 'string'
      ? parseFloat(payload.amount)
      : Number.NaN
  const amount: number = Number.isFinite(rawAmount) ? Math.round(rawAmount) : Number.NaN

  const gatewayReference = typeof payload.transactionId === 'string'
    ? payload.transactionId
    : typeof payload.paymentId === 'string'
      ? payload.paymentId
      : null

  return { reference, usedClientRef, status, amount, gatewayReference }
}

export async function POST(request: NextRequest) {
  // Validate configuration before reading the body - fail with a structured log
  // rather than an unhandled exception that obscures the root cause.
  let secret: string
  try {
    secret = requireWebhookSecret()
  } catch {
    console.error('[payat-webhook] misconfiguration: PAYAT_WEBHOOK_SECRET not set')
    return NextResponse.json({ error: 'Webhook not configured' }, { status: 503 })
  }

  const rawBody = await request.text()
  const signature = request.headers.get('x-payat-signature') ?? ''

  if (!isValidSignature(rawBody, signature, secret)) {
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

  // Handle terminal negative statuses - mark the intent FAILED so any future
  // stale PAID retry (e.g. after a REVERSED) cannot credit the wallet.
  if (TERMINAL_NEGATIVE_STATUSES.has(payload.status)) {
    if (payload.reference) {
      await db.paymentIntent.updateMany({
        where: {
          OR: [
            { id: payload.reference },
            { paymentReference: payload.reference, paymentMethod: 'PAYAT' },
          ],
          status: { notIn: ['CREDITED', 'FAILED'] },
        },
        data: {
          status: 'FAILED',
          itnReceivedAt: new Date(),
          itnPaymentStatus: payload.status,
          gatewayReference: payload.gatewayReference,
        },
      })
    }
    return NextResponse.json({ received: true })
  }

  if (!PAYMENT_COMPLETE_STATUSES.has(payload.status)) {
    return NextResponse.json({ received: true })
  }

  // Primary lookup: clientReferenceNumber is our intent UUID primary key.
  let intent = await db.paymentIntent.findUnique({
    where: { id: payload.reference },
    select: {
      id: true,
      amountCents: true,
      providerId: true,
      status: true,
      creditedAt: true,
      paymentMethod: true,
      metadata: true,
    },
  })

  // Secondary lookup: if Pay@ used reference/sourceReference (e.g. "PAT-ABCDEF"),
  // match by the human-readable paymentReference field instead.
  if (!intent && !payload.usedClientRef && payload.reference) {
    intent = await db.paymentIntent.findFirst({
      where: { paymentReference: payload.reference, paymentMethod: 'PAYAT' },
      select: {
        id: true,
        amountCents: true,
        providerId: true,
        status: true,
        creditedAt: true,
        paymentMethod: true,
        metadata: true,
      },
    })
  }

  if (!intent) {
    console.warn('[payat-webhook] notification for unknown payment intent', {
      reference: payload.reference,
    })
    return NextResponse.json({ received: true })
  }

  // Guard CREDITED, FAILED and any creditedAt so a stale PAID webhook arriving
  // after a REVERSED/CANCELLED closure cannot re-open and double-credit the intent.
  if (intent.status === 'CREDITED' || intent.status === 'FAILED' || intent.creditedAt) {
    return NextResponse.json({ received: true })
  }

  if (intent.paymentMethod !== 'PAYAT') {
    console.warn('[payat-webhook] notification for non-Pay@ payment intent', {
      intentId: intent.id,
      paymentMethod: intent.paymentMethod,
    })
    return NextResponse.json({ received: true })
  }

  // If payAtAmountCents was stored in metadata at intent creation (fee-inclusive amount
  // sent to Pay@), compare against that. Fallback to amountCents for pre-fee intents.
  const rawMeta = intent.metadata
  const storedPayAtCents =
    typeof rawMeta === 'object' && rawMeta !== null && !Array.isArray(rawMeta) &&
    typeof (rawMeta as Record<string, unknown>).payAtAmountCents === 'number' &&
    Number.isFinite((rawMeta as Record<string, unknown>).payAtAmountCents as number)
      ? (rawMeta as Record<string, unknown>).payAtAmountCents as number
      : null
  const expectedAmountCents = storedPayAtCents ?? intent.amountCents

  if (!Number.isFinite(payload.amount) || payload.amount !== expectedAmountCents) {
    console.error('[payat-webhook] amount mismatch; marking intent failed', {
      alert: true,
      intentId: intent.id,
      providerId: intent.providerId,
      expectedCents: expectedAmountCents,
      receivedCents: payload.amount,
      gatewayStatus: payload.status,
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

  // H-1: Use updateMany with a status predicate so only the first concurrent
  // webhook transitions to ITN_RECEIVED. Subsequent calls are no-ops and cannot
  // overwrite itnReceivedAt/paidAt with a later timestamp.
  await db.paymentIntent.updateMany({
    where: { id: intent.id, status: 'PENDING_PAYMENT' },
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
      const isNonBenign = !BENIGN_NOT_CREDITED_REASONS.has(result.reason)
      if (isNonBenign) {
        // Payment received but credits not issued - requires manual recovery.
        console.error('[payat-webhook] wallet not credited after ITN - manual recovery required', {
          alert: true,
          intentId: intent.id,
          providerId: intent.providerId,
          amountCents: intent.amountCents,
          reason: result.reason,
        })
      } else {
        console.warn('[payat-webhook] wallet not credited (benign duplicate)', {
          intentId: intent.id,
          reason: result.reason,
        })
      }
    }
  } catch (error) {
    // Return 200 so Pay@ stops retrying - the intent is in ITN_RECEIVED with
    // creditedAt=null. The recovery cron finds these and retries crediting.
    console.error('[payat-webhook] wallet crediting threw - deferred to recovery cron', {
      alert: true,
      intentId: intent.id,
      providerId: intent.providerId,
      amountCents: intent.amountCents,
      error,
    })
    return NextResponse.json({ received: true, creditingDeferred: true })
  }

  return NextResponse.json({ received: true })
}
