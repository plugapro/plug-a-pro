// ─── PSP abstraction layer ────────────────────────────────────────────────────
// Swap the provider implementation without changing call sites.
// Default: Peach Payments (South Africa)
// Alternatives: Yoco, PayFast, PayGate, Ozow, Stripe
//
// To add a new provider:
// 1. Implement the PspProvider interface below
// 2. Add a case to getProvider()
// 3. Set PSP_PROVIDER env var

import { db } from './db'
import { OPS_QUEUE_TYPES, claimOpsQueueItem } from './ops-queue'
import { notifyCustomerPaymentFailed } from './client-pwa-submission-notifications'
import { createPayAtGoBookingPaymentRequest } from './payat-go'
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

// ─── Provider: PayFast (South Africa) ────────────────────────────────────────
// Docs: https://developers.payfast.co.za/docs

class PayFastProvider implements PspProvider {
  private baseUrl: string
  private merchantId: string
  private merchantKey: string
  private passphrase: string

  constructor() {
    const sandbox = process.env.PAYFAST_SANDBOX === 'true'
    this.baseUrl = sandbox
      ? 'https://sandbox.payfast.co.za/eng/process'
      : 'https://www.payfast.co.za/eng/process'
    this.merchantId = process.env.PAYFAST_MERCHANT_ID ?? ''
    this.merchantKey = process.env.PAYFAST_MERCHANT_KEY ?? ''
    this.passphrase = process.env.PAYFAST_PASSPHRASE ?? ''

    if (!this.merchantId || !this.merchantKey) {
      throw new Error('Missing PayFast credentials (PAYFAST_MERCHANT_ID, PAYFAST_MERCHANT_KEY)')
    }
  }

  private buildSignature(params: Record<string, string>): string {
    const crypto = require('crypto')
    // Sort keys alphabetically, build query string
    const query = Object.keys(params)
      .sort()
      .filter((k) => params[k] !== '')
      .map((k) => `${k}=${encodeURIComponent(params[k]).replace(/%20/g, '+')}`)
      .join('&')

    const withPassphrase = this.passphrase ? `${query}&passphrase=${encodeURIComponent(this.passphrase).replace(/%20/g, '+')}` : query
    return crypto.createHash('md5').update(withPassphrase).digest('hex')
  }

  async createCheckout(params: CheckoutParams): Promise<CheckoutSession> {
    const amountFormatted = (params.amount / 100).toFixed(2)

    const pfParams: Record<string, string> = {
      merchant_id: this.merchantId,
      merchant_key: this.merchantKey,
      return_url: params.successUrl,
      cancel_url: params.cancelUrl,
      notify_url: params.notifyUrl,
      m_payment_id: params.bookingId,
      amount: amountFormatted,
      item_name: params.description,
    }

    if (params.customerEmail) pfParams.email_address = params.customerEmail
    if (params.customerPhone) pfParams.cell_number = params.customerPhone.replace(/\D/g, '')
    if (params.metadata) {
      // PayFast allows custom_str1–5 for metadata
      Object.entries(params.metadata).slice(0, 5).forEach(([, v], i) => {
        pfParams[`custom_str${i + 1}`] = v
      })
    }

    pfParams.signature = this.buildSignature(pfParams)

    const query = Object.entries(pfParams)
      .map(([k, v]) => `${k}=${encodeURIComponent(v)}`)
      .join('&')

    return {
      id: params.bookingId,
      url: `${this.baseUrl}?${query}`,
    }
  }

  verifyWebhook(rawBody: string, _signature: string): boolean {
    // PayFast sends ITN data as a POST body (application/x-www-form-urlencoded)
    // Signature is included as a field in the body itself, not a header
    const params = Object.fromEntries(new URLSearchParams(rawBody))
    const { signature, ...rest } = params

    const computed = this.buildSignature(rest as Record<string, string>)
    const crypto = require('crypto')
    try {
      return crypto.timingSafeEqual(Buffer.from(computed), Buffer.from(signature ?? ''))
    } catch {
      return false
    }
  }

  parseWebhookEvent(rawBody: string): PaymentEvent {
    const params = Object.fromEntries(new URLSearchParams(rawBody))
    const status = params.payment_status ?? ''
    const amount = Math.round(parseFloat(params.amount_gross ?? '0') * 100)

    return {
      type:
        status === 'COMPLETE'
          ? 'payment.success'
          : status === 'REFUNDED'
          ? 'payment.refunded'
          : 'payment.failed',
      bookingId: params.m_payment_id,
      pspReference: params.pf_payment_id,
      amount,
      currency: 'ZAR',
      raw: params,
    }
  }

  async createRefund(pspReference: string, amountCents: number): Promise<RefundResult> {
    // PayFast refunds via their API — requires bearer token auth
    // Docs: https://developers.payfast.co.za/api#tag/Refunds
    const timestamp = new Date().toISOString().replace('T', ' ').split('.')[0]
    const version = 'v1'
    const merchantId = this.merchantId
    const isSandbox = process.env.PAYFAST_SANDBOX === 'true'
    const apiBase = isSandbox ? 'https://api.sandbox.payfast.co.za' : 'https://api.payfast.co.za'

    const headerParams: Record<string, string> = {
      merchant_id: merchantId,
      passphrase: this.passphrase,
      timestamp,
      version,
    }
    const crypto = require('crypto')
    const headerSig = crypto
      .createHash('md5')
      .update(
        Object.keys(headerParams)
          .sort()
          .map((k) => `${k}=${encodeURIComponent(headerParams[k]).replace(/%20/g, '+')}`)
          .join('&')
      )
      .digest('hex')

    const response = await fetch(`${apiBase}/refunds/${pspReference}`, {
      method: 'POST',
      headers: {
        'merchant-id': merchantId,
        timestamp,
        version,
        signature: headerSig,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ amount: (amountCents / 100).toFixed(2) }),
    })

    const data = await response.json().catch(() => ({}))
    return {
      success: response.ok,
      refundReference: data?.data?.uuid ?? pspReference,
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
  const provider = process.env.PSP_PROVIDER ?? 'payfast'
  switch (provider) {
    case 'payfast':
      return new PayFastProvider()
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
      pspProvider: process.env.PSP_PROVIDER ?? 'peach',
      pspCheckoutId: session.id,
      checkoutUrl: session.url,
    },
    update: {
      collectionMode: 'PLATFORM_CHECKOUT',
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
  let requiresManualFollowUp = false

  await db.$transaction(async (tx) => {
    const payment = await tx.payment.findUnique({
      where: { bookingId: event.bookingId },
      select: { status: true, booking: { select: { status: true } } },
    })
    if (
      payment?.status === 'PAID' ||
      payment?.status === 'REFUNDED' ||
      payment?.status === 'PARTIALLY_REFUNDED'
    ) return

    const fromStatus = payment?.booking?.status ?? null

    await tx.payment.update({
      where: { bookingId: event.bookingId },
      data: {
        status: 'PAID',
        pspReference: event.pspReference,
        paidAt: new Date(),
      },
    })

    if (fromStatus === 'CANCELLED' || fromStatus === 'COMPLETED') {
      requiresManualFollowUp = true
      return
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
  })

  if (!requiresManualFollowUp) return

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
  console.error('[payments] payment failed — ops follow-up required', {
    bookingId: event.bookingId,
    pspReference: event.pspReference,
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
