/**
 * Payfast ITN (Instant Transaction Notification) webhook handler.
 *
 * Payfast POSTs application/x-www-form-urlencoded to this endpoint after every
 * payment event. The handler must ALWAYS return HTTP 200 - non-200 responses
 * cause Payfast to retry, creating duplicate-ITN storms that are harder to
 * reason about than idempotent processing.
 *
 * Validation sequence (fail-closed):
 *   1. Parse the urlencoded body, preserving field order for signature verification.
 *   2. Validate source IP against the Payfast notify IP allowlist.
 *   3. Verify the MD5 signature over received parameters.
 *   4. Confirm payment_status === "COMPLETE".  (verifyItn covers 2-4.)
 *   5. Look up the PaymentIntent by m_payment_id.
 *   6. Check intent is in a creditable state (idempotency).
 *   7. Validate amount_gross matches the intent's amountCents.
 *   8. Store ITN fields on the intent (itnReceivedAt, itnPaymentStatus,
 *      itnAmountCents, gatewayReference).
 *   9. Delegate to creditProviderWalletFromGatewayItn.
 *  10. Return 200.
 *
 * IMPORTANT: the Payfast return_url is UI-only. No wallet mutation occurs there.
 */

import { type NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import {
  verifyItn,
  parseItnAmountCents,
  getPayfastConfig,
  type PayfastItnPayload,
} from '@/lib/payfast'
import { creditProviderWalletFromGatewayItn } from '@/lib/provider-credit-gateway-itn'
import { createTraceId } from '@/lib/support-diagnostics'
import { getCorrelationId } from '@/lib/correlation'

// ─── Remote IP extraction ─────────────────────────────────────────────────────

function getRemoteIp(request: NextRequest): string | null {
  // Prefer the platform-injected single-hop header. x-forwarded-for is a
  // client-spoofable chain (an attacker can prepend any leftmost value), so
  // it is only a last-resort fallback. lib/payfast.ts documents this same
  // preference for ITN source-IP validation.
  const vercelForwarded = request.headers.get('x-vercel-forwarded-for')?.trim()
  if (vercelForwarded) return vercelForwarded

  const cfConnectingIp = request.headers.get('cf-connecting-ip')?.trim()
  if (cfConnectingIp) return cfConnectingIp

  const forwarded = request.headers.get('x-forwarded-for')
  if (forwarded) return forwarded.split(',')[0].trim()
  return request.headers.get('x-real-ip')?.trim() ?? null
}

// ─── ITN body parsing ─────────────────────────────────────────────────────────

async function parseItnBody(request: NextRequest): Promise<PayfastItnPayload | null> {
  try {
    const text = await request.text()
    const params = new URLSearchParams(text)
    // Preserve insertion order - Payfast signature depends on field order.
    const payload: Record<string, string> = {}
    for (const [key, value] of params.entries()) {
      payload[key] = value
    }
    return payload as PayfastItnPayload
  } catch {
    return null
  }
}

// ─── ITN processing ──────────────────────────────────────────────────────────

async function processItn(payload: PayfastItnPayload, remoteIp: string | null): Promise<void> {
  const traceId = createTraceId('itn')
  const config = getPayfastConfig()

  // Steps 2-4: IP + signature + payment_status validation.
  const verification = verifyItn(payload, remoteIp, config)
  if (!verification.valid) {
    console.warn('[payfast-itn] ITN rejected by adapter verification', {
      traceId,
      reason: verification.reason,
      remoteIp,
      m_payment_id: payload.m_payment_id,
      payment_status: payload.payment_status,
    })
    return
  }

  const mPaymentId = payload.m_payment_id?.trim()
  if (!mPaymentId) {
    console.warn('[payfast-itn] ITN missing m_payment_id', { traceId })
    return
  }

  // Step 5: look up the intent.
  const intent = await db.paymentIntent.findUnique({
    where: { id: mPaymentId },
    select: {
      id: true,
      amountCents: true,
      status: true,
      creditedAt: true,
      paymentMethod: true,
    },
  })

  if (!intent) {
    console.warn('[payfast-itn] ITN for unknown m_payment_id', { traceId, m_payment_id: mPaymentId })
    return
  }

  // Step 6: idempotency - already credited intents are silently ignored.
  if (intent.status === 'CREDITED' || intent.creditedAt) {
    console.info('[payfast-itn] duplicate ITN received for already-credited intent, ignoring', {
      traceId,
      intentId: intent.id,
      error_code: 'CREDIT_TOPUP_DUPLICATE_CALLBACK',
    })
    return
  }

  // Non-creditable terminal statuses - log and return.
  if (intent.status === 'CANCELLED' || intent.status === 'FAILED' || intent.status === 'EXPIRED') {
    console.warn('[payfast-itn] ITN received for terminal intent status', {
      traceId,
      intentId: intent.id,
      status: intent.status,
      error_code: 'CREDIT_TOPUP_PAYMENT_FAILED',
    })
    return
  }

  // Step 7: amount validation.
  // Tolerance: ±1 cent, matching the generic PSP webhook
  // (app/api/webhooks/payments/route.ts). A floating-point rounding in
  // amount_gross (e.g. "100.001") must NOT permanently FAIL a legitimate
  // top-up. Do not loosen beyond ±1 cent.
  const itnAmountCents = parseItnAmountCents(payload.amount_gross)
  const AMOUNT_TOLERANCE_CENTS = 1
  if (
    Number.isNaN(itnAmountCents) ||
    Math.abs(itnAmountCents - intent.amountCents) > AMOUNT_TOLERANCE_CENTS
  ) {
    console.error('[payfast-itn] amount_gross mismatch - marking intent FAILED', {
      traceId,
      intentId: intent.id,
      expected: intent.amountCents,
      received: itnAmountCents,
      rawAmountGross: payload.amount_gross,
      error_code: 'CREDIT_TOPUP_PAYMENT_FAILED',
    })
    await db.paymentIntent.update({
      where: { id: intent.id },
      data: {
        status: 'FAILED',
        itnReceivedAt: new Date(),
        itnPaymentStatus: payload.payment_status,
        itnAmountCents: Number.isNaN(itnAmountCents) ? null : itnAmountCents,
        gatewayReference: payload.pf_payment_id ?? null,
      },
    })
    return
  }

  // Step 8: store ITN fields and advance status to ITN_RECEIVED.
  await db.paymentIntent.update({
    where: { id: intent.id },
    data: {
      status: 'ITN_RECEIVED',
      itnReceivedAt: new Date(),
      itnPaymentStatus: payload.payment_status,
      itnAmountCents,
      gatewayReference: payload.pf_payment_id ?? null,
      paidAt: new Date(),
    },
  })

  // Step 9: delegate wallet crediting.
  const result = await creditProviderWalletFromGatewayItn(intent.id)

  if (result.credited) {
    console.info('[payfast-itn] wallet credited successfully', {
      traceId,
      intentId: intent.id,
      ledgerEntryId: result.ledgerEntryId,
    })
  } else {
    // Crediting returned false without throwing - log for ops visibility.
    console.warn('[payfast-itn] wallet not credited', {
      traceId,
      intentId: intent.id,
      reason: result.reason,
      error_code: 'CREDIT_LEDGER_WRITE_FAILED',
    })
  }
}

// ─── Route handler ────────────────────────────────────────────────────────────

export async function POST(request: NextRequest) {
  const correlationId = await getCorrelationId()
  console.log(JSON.stringify({ timestamp: new Date().toISOString(), correlationId, event: 'webhook_received', path: request.url }))

  const remoteIp = getRemoteIp(request)
  const payload = await parseItnBody(request)

  if (!payload) {
    // Even a malformed body returns 200 - Payfast retries on non-200.
    console.warn('[payfast-itn] could not parse ITN body')
    return new NextResponse('OK', { status: 200 })
  }

  try {
    await processItn(payload, remoteIp)
  } catch (error) {
    // Any unhandled error must still return 200. Log the full error internally
    // - the response body must not leak internal details.
    console.error('[payfast-itn] unhandled error during ITN processing', {
      error,
      m_payment_id: payload.m_payment_id,
    })
  }

  return new NextResponse('OK', { status: 200 })
}
