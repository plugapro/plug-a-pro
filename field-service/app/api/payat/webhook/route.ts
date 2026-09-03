import { createHmac, timingSafeEqual } from 'crypto'
import { type NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { creditProviderWalletFromPayatWebhook } from '@/lib/provider-credit-gateway-itn'
import { isEnabled } from '@/lib/flags'
import { reconcilePayatIntent } from '@/lib/payat/reconcile'
import { resolveExpectedPayatAmountCents } from '@/lib/payat/expected-amount'

type PayatWebhookPayload = {
  reference?: unknown
  clientReferenceNumber?: unknown
  sourceReference?: unknown
  status?: unknown
  amount?: unknown
  transactionId?: unknown
  paymentId?: unknown
  // Fields from Pay@'s documented IntegratorPaymentNotificationDetailsModel -
  // the shape real notifications (and the portal's Test button) actually send:
  // accountNumber is our stored clientAccountNumber, referenceNumber is the
  // clientReferenceNumber we set at RTP creation (the PaymentIntent id).
  accountNumber?: unknown
  referenceNumber?: unknown
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

// Doorbell mode resolves the intent by primary key only. These two skip reasons
// mean the read-back path could not find the intent at all - NOT that there was
// nothing to credit:
//   - 'intent not found'      Pay@ sent reference/sourceReference instead of
//                             clientReferenceNumber; the legacy path resolves
//                             that by paymentReference.
//   - 'no clientAccountNumber' the intent predates clientAccountNumber
//                             persistence, so it can never be read back - but
//                             the legacy path credits it today.
// Acking these with a 200 would drop a real payment and Pay@ would never retry.
// Fall through to the legacy path instead. Every other skip reason (already
// credited, and the concurrent-race loser) is benign and still acks.
const DOORBELL_FALLTHROUGH_SKIP_REASONS = new Set([
  'intent not found',
  'no clientAccountNumber',
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

function payloadString(value: unknown): string {
  if (typeof value === 'string') return value.trim()
  if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  return ''
}

// An unsigned request may only point at an intent - reconcilePayatIntent asks
// Pay@ directly and is the sole authority on crediting. The payload-trusting
// legacy paths (amount comparison, FAILED marking on claimed statuses) are
// unreachable from here: a forged request can at worst trigger a verified read.
async function handleUnsignedDoorbell(rawBody: string): Promise<NextResponse> {
  let parsed: PayatWebhookPayload
  try {
    parsed = JSON.parse(rawBody) as PayatWebhookPayload
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const reference =
    payloadString(parsed.clientReferenceNumber) ||
    payloadString(parsed.reference) ||
    payloadString(parsed.sourceReference) ||
    payloadString(parsed.referenceNumber)
  const accountNumber = payloadString(parsed.accountNumber)

  let intentId: string | null = null
  if (reference) {
    const byId = await db.paymentIntent.findUnique({
      where: { id: reference },
      select: { id: true },
    })
    if (byId) {
      intentId = byId.id
    } else {
      const byPaymentReference = await db.paymentIntent.findFirst({
        where: { paymentReference: reference, paymentMethod: 'PAYAT' },
        select: { id: true },
      })
      if (byPaymentReference) intentId = byPaymentReference.id
    }
  }
  if (!intentId && accountNumber) {
    const byAccount = await db.paymentIntent.findFirst({
      where: { clientAccountNumber: accountNumber, paymentMethod: 'PAYAT' },
      select: { id: true },
    })
    if (byAccount) intentId = byAccount.id
  }

  if (!intentId) {
    // Includes the merchant portal's Test button, whose mock payload never
    // matches a real intent. Ack it - retrying junk helps nobody - but log so
    // a rising count of unmatchable real notifications stays visible.
    console.warn(JSON.stringify({ event: 'payat.webhook_unsigned_unmatched' }))
    return NextResponse.json({ received: true, ignored: 'no_matching_intent' })
  }

  let outcome: Awaited<ReturnType<typeof reconcilePayatIntent>>
  try {
    outcome = await reconcilePayatIntent(intentId)
  } catch (error) {
    // Same contract as the signed doorbell: a Pay@ read failure must surface
    // as a 5xx so Pay@ retries - acking an unverified payment would drop it.
    // Log the error *name* only; message/stack can carry Pay@ response content.
    console.error(JSON.stringify({
      event: 'payat.webhook_reconcile_failed',
      intentId,
      errorName: error instanceof Error ? error.name : 'UnknownError',
    }))
    throw error
  }

  if (outcome.action === 'skipped' && outcome.reason === 'no clientAccountNumber') {
    // A pre-migration intent the read-back can never verify. The legacy path
    // would credit it from the payload - but an unsigned request must never
    // reach payload-trusting code, so this stays a manual portal reconciliation.
    console.warn(JSON.stringify({ event: 'payat.webhook_unsigned_unverifiable', intentId }))
    return NextResponse.json({ received: true, ignored: 'unverifiable_intent' })
  }

  console.info(JSON.stringify({
    event: 'payat.webhook_reconciled',
    intentId,
    action: outcome.action,
    signed: false,
  }))
  return NextResponse.json({ received: true })
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
    // Pay@'s merchant-portal webhook registration takes only a URL - production
    // notifications arrive with no signature header at all (their spec's webhook
    // auth options are NO_AUTH/BASIC/OAUTH2/API_KEY; an HMAC is not one of them).
    // The unsigned doorbell accepts them without trusting a single byte.
    if (await isEnabled('payments.payat.webhook_unsigned_doorbell')) {
      return handleUnsignedDoorbell(rawBody)
    }
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

  // Doorbell mode: the signed webhook tells us WHICH intent moved, never
  // WHETHER it was paid or for how much. Pay@ is asked directly. This is the
  // only path that is safe when the webhook is unreliable — which, on this
  // account, it demonstrably is (0 of 3 ITNs delivered as of 2026-07-28).
  if (await isEnabled('payments.payat.readback_verification')) {
    if (!payload.reference) {
      return NextResponse.json({ received: true, ignored: 'no_reference' })
    }

    let outcome: Awaited<ReturnType<typeof reconcilePayatIntent>>
    try {
      outcome = await reconcilePayatIntent(payload.reference)
    } catch (error) {
      // reconcilePayatIntent throws on any Pay@ read failure (network,
      // non-2xx, a missing rtp:read scope, bad JSON). Let it propagate so the
      // route returns a 5xx and Pay@ retries the notification - swallowing it
      // here would ack a real payment we never actually verified. Log only
      // the error *name*: the message/stack can carry Pay@ response content,
      // and never log the merchant identifier or provider PII.
      console.error(JSON.stringify({
        event: 'payat.webhook_reconcile_failed',
        intentId: payload.reference,
        errorName: error instanceof Error ? error.name : 'UnknownError',
      }))
      throw error
    }

    if (outcome.action === 'skipped' && DOORBELL_FALLTHROUGH_SKIP_REASONS.has(outcome.reason)) {
      // The read-back could not identify the intent. Do NOT ack - hand this
      // notification to the legacy path below, which resolves the alternate
      // reference form and can still credit pre-migration intents. Logged
      // distinctly so a rising count is visible during rollout.
      console.warn(JSON.stringify({
        event: 'payat.webhook_readback_fallthrough',
        intentId: payload.reference,
        reason: outcome.reason,
      }))
    } else {
      console.info(JSON.stringify({
        event: 'payat.webhook_reconciled',
        intentId: payload.reference,
        action: outcome.action,
        // Recorded so a webhook that consistently disagrees with the read is
        // visible in logs rather than silently tolerated.
        webhookClaimedStatus: payload.status,
      }))

      return NextResponse.json({ received: true })
    }
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
  // Shared with the read-back reconcile path so the two cannot diverge.
  const expectedAmountCents = resolveExpectedPayatAmountCents(intent.metadata, intent.amountCents)

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
