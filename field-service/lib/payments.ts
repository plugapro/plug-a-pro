// ─── PSP abstraction layer ────────────────────────────────────────────────────
// Swap the provider implementation without changing call sites.
// Default: Peach Payments (South Africa)
// Alternatives: Yoco, PayFast, PayGate, Ozow, Stripe
//
// To add a new provider:
// 1. Implement the PspProvider interface below
// 2. Add a case to getProvider()
// 3. Set PSP_PROVIDER env var

// Server-only poison pill: this module pulls in Prisma, audit, PSP config and
// other server-only dependencies. Importing it from a client component must fail
// the build. Browser-safe helpers (e.g. formatCurrency) live in '@/lib/currency'
// and must be imported from there, not from here.
import 'server-only'

import { db } from './db'
import { recordAuditLog } from './audit'
import { checkPilotGate, resolveAreaScopeByNodeId } from './customer-serviceability'
import { CategoryGatedByPilotError } from './launch/errors'
import { OPS_QUEUE_TYPES, claimOpsQueueItem } from './ops-queue'
import { notifyCustomerPaymentFailed } from './client-pwa-submission-notifications'
import { createPayAtGoBookingPaymentRequest } from './payat-go'
import { emitServerConversion } from './marketing/server-events'
export { formatCurrency } from './currency'

export type PaymentCollectionMode = 'bypass' | 'checkout'

export interface BookingPaymentSetup {
  mode: PaymentCollectionMode
  status: 'PENDING'
  checkoutUrl: string | null
}

// ─── Interface ────────────────────────────────────────────────────────────────

export interface CheckoutParams {
  bookingId: string
  amount: number // cents (e.g. 45000 = R 450.00)
  currency: string
  customerEmail?: string
  customerPhone?: string
  description: string
  successUrl: string
  cancelUrl: string
  notifyUrl: string // webhook URL
  metadata?: Record<string, string>
}

export interface CheckoutSession {
  id: string
  url: string // redirect customer here to complete payment
  expiresAt?: Date
}

export interface PaymentEvent {
  type: 'payment.success' | 'payment.failed' | 'payment.refunded'
  bookingId: string
  pspReference: string
  amount: number
  currency: string
  raw: unknown
}

export interface RefundResult {
  success: boolean
  refundReference: string
}

interface PspProvider {
  createCheckout(params: CheckoutParams): Promise<CheckoutSession>
  verifyWebhook(rawBody: string, signature: string): boolean
  parseWebhookEvent(rawBody: string): PaymentEvent
  createRefund(pspReference: string, amountCents: number): Promise<RefundResult>
}

export function getPaymentCollectionMode(): PaymentCollectionMode {
  return process.env.PAYMENT_COLLECTION_MODE === 'checkout' ? 'checkout' : 'bypass'
}

function readPaymentEnv(name: string): string {
  return globalThis.process?.env?.[name]?.trim() ?? ''
}

function resolvePspProviderName(): string {
  // PayFast has been removed as a PSP. A stale `PSP_PROVIDER=payfast` (still set in
  // some environments) maps to the default so getProvider() never throws on it.
  const configured = readPaymentEnv('PSP_PROVIDER')
  if (!configured || configured === 'payfast') return 'peach'
  return configured
}

// ─── Provider: Peach Payments (South Africa) ─────────────────────────────────
// Docs: https://developer.peachpayments.com/

class PeachPaymentsProvider implements PspProvider {
  private baseUrl: string
  private entityId: string
  private accessToken: string
  private webhookSecret: string

  constructor() {
    const testMode = process.env.PEACH_TEST_MODE === 'true'
    this.baseUrl = testMode
      ? 'https://testsecure.peachpayments.com/api'
      : 'https://secure.peachpayments.com/api'
    this.entityId = testMode
      ? (process.env.PEACH_TEST_ENTITY_ID ?? process.env.PEACH_ENTITY_ID ?? '')
      : (process.env.PEACH_ENTITY_ID ?? '')
    this.accessToken = process.env.PEACH_ACCESS_TOKEN ?? ''
    this.webhookSecret = process.env.PEACH_WEBHOOK_SECRET ?? ''

    if (!this.entityId || !this.accessToken) {
      throw new Error('Missing Peach Payments credentials')
    }
  }

  async createCheckout(params: CheckoutParams): Promise<CheckoutSession> {
    const response = await fetch(`${this.baseUrl}/v1/checkouts`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        authentication: { entityId: this.entityId },
        amount: (params.amount / 100).toFixed(2),
        currency: params.currency,
        paymentType: 'DB',
        merchantTransactionId: params.bookingId,
        shopperResultUrl: params.successUrl,
        notificationUrl: params.notifyUrl,
        customer: {
          email: params.customerEmail,
          phone: params.customerPhone,
        },
        customParameters: params.metadata,
      }),
    })

    if (!response.ok) {
      const err = await response.json()
      throw new Error(`Peach checkout failed: ${JSON.stringify(err)}`)
    }

    const data = await response.json()
    return {
      id: data.id,
      url: `${this.baseUrl}/v1/paymentWidgets.js?checkoutId=${data.id}`,
      expiresAt: data.timestamp
        ? new Date(Date.parse(data.timestamp) + 30 * 60 * 1000)
        : undefined,
    }
  }

  verifyWebhook(rawBody: string, signature: string): boolean {
    // Peach uses HMAC-SHA256 signature verification
    // Implementation: compare computed HMAC of rawBody against signature header
    // Reference: https://developer.peachpayments.com/docs/webhooks
    const crypto = require('crypto')
    const computed = crypto
      .createHmac('sha256', this.webhookSecret)
      .update(rawBody)
      .digest('hex')
    try {
      const a = Buffer.from(computed, 'hex')
      const b = Buffer.from(signature, 'hex')
      if (a.length !== b.length) return false
      return crypto.timingSafeEqual(a, b)
    } catch {
      return false
    }
  }

  parseWebhookEvent(rawBody: string): PaymentEvent {
    const data = JSON.parse(rawBody)
    const resultCode = data.result?.code ?? ''
    const success = /^(000\.000\.|000\.100\.1|000\.[36])/.test(resultCode)
    const isRefund = data.paymentType === 'RF'

    return {
      type: isRefund
        ? 'payment.refunded'
        : success
        ? 'payment.success'
        : 'payment.failed',
      bookingId: data.merchantTransactionId,
      pspReference: data.id,
      amount: Math.round(parseFloat(data.amount ?? '0') * 100),
      currency: data.currency ?? 'ZAR',
      raw: data,
    }
  }

  async createRefund(pspReference: string, amountCents: number): Promise<RefundResult> {
    const response = await fetch(`${this.baseUrl}/v1/payments/${pspReference}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.accessToken}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        'authentication.entityId': this.entityId,
        amount: (amountCents / 100).toFixed(2),
        currency: 'ZAR',
        paymentType: 'RF',
      }),
    })

    const data = await response.json()
    return {
      success: response.ok,
      refundReference: data.id ?? '',
    }
  }
}

// ─── Provider: Pay@Go RTP (South Africa) ────────────────────────────────────
// OpenAPI: https://go.payat.co.za/yapi/swagger-ui/index.html
// This provider creates RTP links and stores provider references in Payment.

class PayAtGoProvider implements PspProvider {
  async createCheckout(params: CheckoutParams): Promise<CheckoutSession> {
    const booking = await db.booking.findUnique({
      where: { id: params.bookingId },
      select: {
        match: {
          select: {
            jobRequest: {
              select: {
                customer: { select: { name: true, phone: true } },
              },
            },
          },
        },
      },
    })

    const customerName = booking?.match?.jobRequest.customer.name ?? 'Customer'
    const customerPhone = params.customerPhone ?? booking?.match?.jobRequest.customer.phone

    const request = await createPayAtGoBookingPaymentRequest({
      bookingId: params.bookingId,
      amountCents: params.amount,
      currency: params.currency,
      customerName,
      customerMobile: customerPhone,
      customerEmail: params.customerEmail,
      description: params.description,
    })

    if (!request.paymentLink) {
      throw new Error('Pay@Go did not return a payment link for this request.')
    }

    return {
      id: request.providerClientAccountNumber,
      url: request.paymentLink,
      expiresAt: request.expiresAt ?? undefined,
    }
  }

  verifyWebhook(_rawBody: string, _signature: string): boolean {
    // Pay@Go callbacks are handled by /api/payat-go/callback, not this generic PSP webhook route.
    return false
  }

  parseWebhookEvent(_rawBody: string): PaymentEvent {
    throw new Error('Pay@Go webhook parsing is not supported on /api/webhooks/payments.')
  }

  async createRefund(pspReference: string, _amountCents: number): Promise<RefundResult> {
    // Pay@Go RTP cancellation is supported before payment completes; post-settlement
    // refunds are handled operationally outside this API integration for now.
    return {
      success: false,
      refundReference: pspReference,
    }
  }
}

// ─── Provider factory ─────────────────────────────────────────────────────────

function getProvider(): PspProvider {
  const provider = resolvePspProviderName()
  switch (provider) {
    case 'peach':
      return new PeachPaymentsProvider()
    case 'payat_go':
      return new PayAtGoProvider()
    default:
      throw new Error(`Unknown PSP provider: ${provider}. Set PSP_PROVIDER env var.`)
  }
}

// ─── Public API ───────────────────────────────────────────────────────────────

export async function createCheckout(params: CheckoutParams): Promise<CheckoutSession> {
  const providerName = resolvePspProviderName()
  const session = await getProvider().createCheckout(params)

  // Persist checkout session to DB
  await db.payment.upsert({
    where: { bookingId: params.bookingId },
    create: {
      bookingId: params.bookingId,
      status: 'PENDING',
      collectionMode: 'PLATFORM_CHECKOUT',
      amount: params.amount / 100,
      currency: params.currency,
      pspProvider: providerName,
      pspCheckoutId: session.id,
      checkoutUrl: session.url,
    },
    update: {
      collectionMode: 'PLATFORM_CHECKOUT',
      pspProvider: providerName,
      pspCheckoutId: session.id,
      checkoutUrl: session.url,
      status: 'PENDING',
    },
  })

  return session
}

export async function initializeBookingPayment(params: {
  bookingId: string
  amountRand: number
  customerEmail?: string | null
  customerPhone?: string | null
  description: string
}): Promise<BookingPaymentSetup> {
  // West Rand pilot gate. Look up the booking's category + suburb so we never
  // open a payable session for a category the pilot is suppressing (e.g. an
  // electrical job created before the gate flipped on). When the master flag
  // is OFF, checkPilotGate is a no-op.
  const bookingForGate = await db.booking.findUnique({
    where: { id: params.bookingId },
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
  const jobRequestForGate = bookingForGate?.match?.jobRequest
  const locationNodeIdForGate = jobRequestForGate?.address?.locationNodeId ?? null
  const areaScopeForGate = locationNodeIdForGate
    ? await resolveAreaScopeByNodeId(locationNodeIdForGate).catch(() => null)
    : null
  const pilotGate = await checkPilotGate({
    suburbSlug: areaScopeForGate?.node.slug ?? null,
    rawCategory: jobRequestForGate?.category ?? null,
  })
  if (!pilotGate.ok) {
    await recordAuditLog({
      actorId: 'system',
      actorRole: 'system',
      action: 'pilot.payment.blocked',
      entityType: 'Booking',
      entityId: params.bookingId,
      after: {
        category: jobRequestForGate?.category ?? null,
        suburbSlug: areaScopeForGate?.node.slug ?? null,
        gateCode: pilotGate.code,
      },
    }).catch(() => undefined)
    throw new CategoryGatedByPilotError(jobRequestForGate?.category ?? 'unknown')
  }

  const mode = getPaymentCollectionMode()

  if (mode === 'bypass') {
    // Launch-mode bypass keeps a payment record for traceability, but no online
    // payment has been collected or guaranteed by the platform at this stage.
    await db.payment.upsert({
      where: { bookingId: params.bookingId },
      create: {
        bookingId: params.bookingId,
        status: 'PENDING',
        collectionMode: 'OFFLINE_RECORDED',
        amount: params.amountRand,
        currency: 'ZAR',
        pspProvider: null,
        metadata: {
          collectionMode: 'bypass',
          note: 'Online collection suppressed during adoption phase',
        },
      },
      update: {
        status: 'PENDING',
        collectionMode: 'OFFLINE_RECORDED',
        pspProvider: null,
        metadata: {
          collectionMode: 'bypass',
          note: 'Online collection suppressed during adoption phase',
        },
      },
    })

    return {
      mode,
      status: 'PENDING',
      checkoutUrl: null,
    }
  }

  const appUrl = (process.env.NEXT_PUBLIC_APP_URL ?? '').trim()
  const session = await createCheckout({
    bookingId: params.bookingId,
    amount: Math.round(params.amountRand * 100),
    currency: 'ZAR',
    customerEmail: params.customerEmail ?? undefined,
    customerPhone: params.customerPhone ?? undefined,
    description: params.description,
    successUrl: `${appUrl}/bookings/${params.bookingId}`,
    cancelUrl: `${appUrl}/quotes`,
    notifyUrl: `${appUrl}/api/webhooks/payments`,
    metadata: {
      bookingId: params.bookingId,
    },
  })

  return {
    mode,
    status: 'PENDING',
    checkoutUrl: session.url,
  }
}

export function verifyWebhookSignature(rawBody: string, signature: string): boolean {
  try {
    return getProvider().verifyWebhook(rawBody, signature)
  } catch {
    return false
  }
}

export function parseWebhookEvent(rawBody: string): PaymentEvent {
  return getProvider().parseWebhookEvent(rawBody)
}

export async function handlePaymentSuccess(event: PaymentEvent): Promise<void> {
  // Return shape captures both follow-up state and the (post-commit-safe)
  // conversion payload. Returning from the transaction callback keeps TS's
  // flow analysis honest — assigning a `let` from inside the closure narrows
  // the outer binding to `never` after `await`.
  const result = await db.$transaction(async (tx) => {
    const payment = await tx.payment.findUnique({
      where: { bookingId: event.bookingId },
      select: { status: true, amount: true, currency: true, booking: { select: { status: true } } },
    })
    if (
      payment?.status === 'PAID' ||
      payment?.status === 'REFUNDED' ||
      payment?.status === 'PARTIALLY_REFUNDED'
    ) {
      return { requiresManualFollowUp: false, firstTransitionPayment: null }
    }

    const fromStatus = payment?.booking?.status ?? null
    const firstTransitionPayment = payment
      ? { amount: Number(payment.amount), currency: payment.currency }
      : null

    await tx.payment.update({
      where: { bookingId: event.bookingId },
      data: {
        status: 'PAID',
        pspReference: event.pspReference,
        paidAt: new Date(),
      },
    })

    if (fromStatus === 'CANCELLED' || fromStatus === 'COMPLETED') {
      return { requiresManualFollowUp: true, firstTransitionPayment }
    }

    await tx.booking.update({
      where: { id: event.bookingId },
      data: { status: 'SCHEDULED' },
    })

    await tx.bookingStatusEvent.create({
      data: {
        bookingId: event.bookingId,
        fromStatus: fromStatus ?? undefined,
        toStatus: 'SCHEDULED',
        actorId: event.pspReference,
        actorRole: 'system',
        notes: `Payment confirmed (${event.pspReference})`,
      },
    })
    return { requiresManualFollowUp: false, firstTransitionPayment }
  })

  // Server-side conversion event — fires only on the first non-PAID → PAID
  // transition (idempotent against webhook retries via the guard inside the
  // transaction). Fire-and-forget: tracker failure must never block payment
  // confirmation. Meta CAPI dedupes against any client Pixel sibling via
  // eventId('payment_success', bookingId).
  if (result.firstTransitionPayment) {
    void emitServerConversion({
      name: 'payment_success',
      entityId: event.bookingId,
      value: result.firstTransitionPayment.amount,
      currency: result.firstTransitionPayment.currency,
    })
  }

  if (!result.requiresManualFollowUp) return

  console.warn('[payments] payment succeeded after terminal booking state; queued follow-up', {
    bookingId: event.bookingId,
    pspReference: event.pspReference,
  })
  await claimOpsQueueItem(db, {
    queueType: OPS_QUEUE_TYPES.PAYMENT_FOLLOW_UP,
    entityId: event.bookingId,
    claimedById: 'system:payment-success-late',
    claimedByRole: 'system',
    claimedByLabel: 'System (late payment)',
  }).catch((err: unknown) => {
    console.error('[payments] failed to enqueue late-payment follow-up', {
      bookingId: event.bookingId,
      error: err,
    })
  })
}

export async function handlePaymentFailed(event: PaymentEvent): Promise<void> {
  await db.payment.update({
    where: { bookingId: event.bookingId },
    data: {
      status: 'FAILED',
      pspReference: event.pspReference,
      failureReason: 'Payment declined',
    },
  })
  console.error('[payments] payment failed - ops follow-up required', {
    bookingId: event.bookingId,
    pspReference: event.pspReference,
  })

  // Server-side conversion event. PSP webhook may retry; Meta CAPI and GA4 MP
  // both dedupe by eventId('payment_failed', bookingId), so re-emission on
  // retry is safe.
  void emitServerConversion({
    name: 'payment_failed',
    entityId: event.bookingId,
  })

  const booking = await db.booking.findUnique({
    where: { id: event.bookingId },
    select: {
      match: {
        select: {
          jobRequest: {
            select: {
              category: true,
              customer: { select: { phone: true } },
            },
          },
        },
      },
    },
  }).catch(() => null)

  if (booking?.match.jobRequest) {
    const { category, customer } = booking.match.jobRequest
    notifyCustomerPaymentFailed({
      customerPhone: customer.phone,
      category: category.replaceAll('_', ' '),
      bookingRef: event.bookingId.slice(-8).toUpperCase(),
    }).catch(() => {})
  }

  await claimOpsQueueItem(db, {
    queueType: OPS_QUEUE_TYPES.PAYMENT_FOLLOW_UP,
    entityId: event.bookingId,
    claimedById: 'system:payment-failed',
    claimedByRole: 'system',
    claimedByLabel: 'System (payment failure)',
  }).catch((err: unknown) => {
    console.error('[payments] failed to enqueue PAYMENT_FOLLOW_UP ops item', {
      bookingId: event.bookingId,
      error: err,
    })
  })
}

export async function issueRefund(params: {
  bookingId: string
  amountCents: number
}): Promise<RefundResult> {
  const payment = await db.payment.findUnique({
    where: { bookingId: params.bookingId },
  })

  if (!payment?.pspReference) {
    throw new Error('No PSP reference found for this booking')
  }

  const result = await getProvider().createRefund(payment.pspReference, params.amountCents)

  if (result.success) {
    await db.payment.update({
      where: { bookingId: params.bookingId },
      data: {
        status:
          params.amountCents >= Number(payment.amount) * 100
            ? 'REFUNDED'
            : 'PARTIALLY_REFUNDED',
        refundedAmount: params.amountCents / 100,
        refundedAt: new Date(),
      },
    })
  }

  return result
}
