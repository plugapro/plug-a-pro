import { createHash } from 'crypto'
import { Prisma, type Payment } from '@prisma/client'
import { db } from '@/lib/db'
import { handlePaymentFailed, handlePaymentSuccess } from '@/lib/payments'
import { formatCurrency } from '@/lib/payments'
import { normalizePayAtGoMobile, maskPhone } from './mobile'
import {
  cancelPayAtGoSingleRtp,
  createPayAtGoSingleRtp,
  readPayAtGoSingleRtp,
  setPayAtGoMockStatus,
} from './client'
import {
  PayAtGoAuthError,
  PayAtGoConfigurationError,
  PayAtGoNetworkError,
  PayAtGoProviderError,
  PayAtGoValidationError,
} from './errors'
import {
  type InternalPayAtGoStatus,
  mapPayAtGoAccountStateToInternalStatus,
} from './status'

type PayAtGoPaymentMetadata = {
  provider?: 'PAYAT_GO'
  providerPaymentRequestId?: number | null
  providerClientAccountNumber?: string | null
  providerSourceReference?: string | null
  providerPaymentLink?: string | null
  providerQrCodeValue?: string | null
  providerStatus?: string | null
  providerInternalStatus?: InternalPayAtGoStatus | null
  providerLastCheckedAt?: string | null
  providerPaidAt?: string | null
  providerCancelledAt?: string | null
  providerExpiredAt?: string | null
  providerFailedAt?: string | null
  providerFailureReason?: string | null
  customerMobile?: string | null
  webhookLastEventHash?: string | null
  events?: Array<Record<string, unknown>>
  lastProviderPayload?: Record<string, unknown>
}

type CreateBookingPaymentInput = {
  bookingId: string
  amountCents: number
  currency: string
  customerName: string
  customerMobile?: string | null
  customerEmail?: string | null
  description: string
}

type CreateBookingPaymentResult = {
  paymentId: string
  bookingId: string
  status: InternalPayAtGoStatus
  paymentLink: string | null
  payAtReference: string | null
  providerPaymentRequestId: number | null
  providerClientAccountNumber: string
  expiresAt: Date | null
  amountCents: number
  currency: string
  whatsappMessage: string
  reusedExisting: boolean
}

type RefreshBookingPaymentOptions = {
  mockStatus?: InternalPayAtGoStatus
}

type RefreshBookingPaymentResult = {
  paymentId: string
  bookingId: string
  status: InternalPayAtGoStatus
  rawProviderStatus: string
  paidAt: Date | null
  expiresAt: Date | null
  amountPaidCents: number | null
  providerClientAccountNumber: string
}

type CancelBookingPaymentResult = {
  paymentId: string
  bookingId: string
  status: InternalPayAtGoStatus
  rawProviderStatus: string
  cancelledAt: Date
  providerClientAccountNumber: string
}

const ACTIVE_INTERNAL_STATUSES = new Set<InternalPayAtGoStatus>(['PENDING', 'SENT'])

function isPayAtGoEnabled() {
  return process.env.PAYAT_GO_ENABLED?.trim().toLowerCase() === 'true'
}

function assertEnabled() {
  if (!isPayAtGoEnabled()) {
    throw new PayAtGoConfigurationError(
      'PAYAT_GO_ENABLED',
      'Pay@Go is disabled. Set PAYAT_GO_ENABLED=true to use this payment provider.',
    )
  }
}

function assertAmountAndCurrency(amountCents: number, currency: string) {
  if (!Number.isInteger(amountCents) || amountCents <= 0) {
    throw new PayAtGoValidationError('Amount must be a positive integer in cents.')
  }
  if (currency !== 'ZAR') {
    throw new PayAtGoValidationError('Only ZAR payments are currently supported by this Pay@Go integration.')
  }
}

function amountToDecimal(amountCents: number): Prisma.Decimal {
  return new Prisma.Decimal(amountCents).dividedBy(100)
}

function readMetadata(raw: Prisma.JsonValue | null): PayAtGoPaymentMetadata {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return {}
  }
  return raw as PayAtGoPaymentMetadata
}

function appendProviderEvent(
  metadata: PayAtGoPaymentMetadata,
  event: Record<string, unknown>,
): PayAtGoPaymentMetadata {
  const previous = Array.isArray(metadata.events) ? metadata.events : []
  const events = [...previous, event].slice(-50)
  return { ...metadata, events }
}

function toJsonValue(metadata: PayAtGoPaymentMetadata): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(metadata)) as Prisma.InputJsonValue
}

function toInternalStatusFromPayment(payment: Payment): InternalPayAtGoStatus {
  if (payment.status === 'PAID') return 'PAID'
  if (payment.status === 'FAILED') {
    const metadata = readMetadata(payment.metadata)
    if (metadata.providerInternalStatus === 'CANCELLED') return 'CANCELLED'
    if (metadata.providerInternalStatus === 'EXPIRED') return 'EXPIRED'
    return 'FAILED'
  }

  const metadata = readMetadata(payment.metadata)
  if (metadata.providerInternalStatus) return metadata.providerInternalStatus
  return 'UNKNOWN'
}

function buildWhatsAppPaymentMessage(params: {
  bookingReference: string
  amountCents: number
  currency: string
  payAtReference: string | null
  paymentLink: string | null
  expiresAt: Date | null
}): string {
  const lines = [
    `Booking: ${params.bookingReference}`,
    `Amount: ${formatCurrency(params.amountCents / 100, params.currency)}`,
    params.payAtReference ? `Pay@ reference: ${params.payAtReference}` : null,
    params.paymentLink ? `Pay now: ${params.paymentLink}` : 'Pay now link will be shared shortly.',
    params.expiresAt ? `Expires: ${params.expiresAt.toLocaleString('en-ZA')}` : null,
    'Please complete payment to confirm your booking.',
  ].filter(Boolean)

  return lines.join('\n')
}

function statusToPaymentFailureReason(status: InternalPayAtGoStatus): string | null {
  switch (status) {
    case 'CANCELLED':
      return 'This payment request was cancelled.'
    case 'EXPIRED':
      return 'This payment request has expired. Please create a new one.'
    case 'FAILED':
      return 'We could not start the payment request. Please try again.'
    default:
      return null
  }
}

function hashCallbackPayload(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}

function isTerminalSuccessPaymentStatus(status: Payment['status']): boolean {
  return status === 'PAID' || status === 'REFUNDED' || status === 'PARTIALLY_REFUNDED'
}

function isPaymentAmountMismatch(payment: Payment, providerAmountCents: number | null): boolean {
  if (!Number.isInteger(providerAmountCents) || providerAmountCents == null) return false
  const expectedAmountCents = Math.round(Number(payment.amount) * 100)
  return providerAmountCents !== expectedAmountCents
}

async function loadBookingPaymentContext(bookingId: string) {
  const booking = await db.booking.findUnique({
    where: { id: bookingId },
    select: {
      id: true,
      payment: true,
      match: {
        select: {
          jobRequest: {
            select: {
              category: true,
              customer: {
                select: {
                  name: true,
                  phone: true,
                },
              },
            },
          },
        },
      },
    },
  })

  if (!booking) {
    throw new PayAtGoValidationError('Booking not found.')
  }

  return booking
}

export async function createPayAtGoBookingPaymentRequest(
  input: CreateBookingPaymentInput,
): Promise<CreateBookingPaymentResult> {
  assertEnabled()
  assertAmountAndCurrency(input.amountCents, input.currency)

  const booking = await loadBookingPaymentContext(input.bookingId)
  const existing = booking.payment

  if (existing && isTerminalSuccessPaymentStatus(existing.status)) {
    throw new PayAtGoValidationError('This booking payment has already been settled.')
  }

  if (existing && existing.pspProvider === 'payat_go') {
    const existingStatus = toInternalStatusFromPayment(existing)
    const existingMetadata = readMetadata(existing.metadata)

    if (ACTIVE_INTERNAL_STATUSES.has(existingStatus) && existing.checkoutUrl) {
      const expiresAt = existingMetadata.providerExpiredAt
        ? new Date(existingMetadata.providerExpiredAt)
        : null

      return {
        paymentId: existing.id,
        bookingId: input.bookingId,
        status: existingStatus,
        paymentLink: existing.checkoutUrl,
        payAtReference: existingMetadata.providerSourceReference ?? null,
        providerPaymentRequestId: existingMetadata.providerPaymentRequestId ?? null,
        providerClientAccountNumber: existing.pspCheckoutId ?? '',
        expiresAt,
        amountCents: Math.round(Number(existing.amount) * 100),
        currency: existing.currency,
        whatsappMessage: buildWhatsAppPaymentMessage({
          bookingReference: input.bookingId.slice(-8).toUpperCase(),
          amountCents: Math.round(Number(existing.amount) * 100),
          currency: existing.currency,
          payAtReference: existingMetadata.providerSourceReference ?? null,
          paymentLink: existing.checkoutUrl,
          expiresAt,
        }),
        reusedExisting: true,
      }
    }
  }

  const normalizedMobile = input.customerMobile ? normalizePayAtGoMobile(input.customerMobile) : undefined

  const created = await createPayAtGoSingleRtp({
    clientReferenceNumber: `BOOKING-${input.bookingId.slice(-18).toUpperCase()}`,
    amountCents: input.amountCents,
    customerNameSurname: input.customerName,
    customerMobileNumber: normalizedMobile,
    customerEmail: input.customerEmail ?? undefined,
    description: input.description,
    notificationNumber: normalizedMobile,
    merchantDisplayName: 'Plug A Pro',
    daysValid: 3,
  })

  const now = new Date()
  const expiresAt = new Date(now.getTime() + 3 * 24 * 60 * 60 * 1000)
  const providerStatus = 'PAYMENT_OUTSTANDING'
  const internalStatus = mapPayAtGoAccountStateToInternalStatus(providerStatus)

  const existingMetadata = existing ? readMetadata(existing.metadata) : {}
  let metadata: PayAtGoPaymentMetadata = {
    ...existingMetadata,
    provider: 'PAYAT_GO',
    providerPaymentRequestId: created.requestToPayId,
    providerClientAccountNumber: created.clientAccountNumber,
    providerSourceReference: created.sourceReference,
    providerPaymentLink: created.paymentLink,
    providerQrCodeValue: created.paymentLink,
    providerStatus,
    providerInternalStatus: internalStatus,
    providerLastCheckedAt: now.toISOString(),
    providerExpiredAt: expiresAt.toISOString(),
    providerFailureReason: null,
    customerMobile: normalizedMobile ?? null,
    lastProviderPayload: created.raw,
  }

  metadata = appendProviderEvent(metadata, {
    at: now.toISOString(),
    action: 'PAYMENT_REQUEST_CREATED',
    internalStatus,
    providerStatus,
    providerClientAccountNumber: created.clientAccountNumber,
    providerPaymentRequestId: created.requestToPayId,
  })

  const payment = await db.payment.upsert({
    where: { bookingId: input.bookingId },
    create: {
      bookingId: input.bookingId,
      status: 'PENDING',
      collectionMode: 'PLATFORM_CHECKOUT',
      amount: amountToDecimal(input.amountCents),
      currency: input.currency,
      pspProvider: 'payat_go',
      pspCheckoutId: created.clientAccountNumber,
      pspReference: created.requestToPayId ? String(created.requestToPayId) : null,
      checkoutUrl: created.paymentLink,
      metadata: toJsonValue(metadata),
    },
    update: {
      status: 'PENDING',
      collectionMode: 'PLATFORM_CHECKOUT',
      amount: amountToDecimal(input.amountCents),
      currency: input.currency,
      pspProvider: 'payat_go',
      pspCheckoutId: created.clientAccountNumber,
      pspReference: created.requestToPayId ? String(created.requestToPayId) : null,
      checkoutUrl: created.paymentLink,
      failureReason: null,
      metadata: toJsonValue(metadata),
    },
  })

  console.info(JSON.stringify({
    event: 'payat_go.payment_request_created',
    bookingId: input.bookingId,
    paymentId: payment.id,
    providerClientAccountNumber: created.clientAccountNumber,
    providerPaymentRequestId: created.requestToPayId,
    amountCents: input.amountCents,
    customerPhone: maskPhone(normalizedMobile),
  }))

  return {
    paymentId: payment.id,
    bookingId: input.bookingId,
    status: internalStatus,
    paymentLink: created.paymentLink,
    payAtReference: created.sourceReference,
    providerPaymentRequestId: created.requestToPayId,
    providerClientAccountNumber: created.clientAccountNumber,
    expiresAt,
    amountCents: input.amountCents,
    currency: input.currency,
    whatsappMessage: buildWhatsAppPaymentMessage({
      bookingReference: input.bookingId.slice(-8).toUpperCase(),
      amountCents: input.amountCents,
      currency: input.currency,
      payAtReference: created.sourceReference,
      paymentLink: created.paymentLink,
      expiresAt,
    }),
    reusedExisting: false,
  }
}

export async function refreshPayAtGoBookingPaymentStatus(
  bookingId: string,
  options: RefreshBookingPaymentOptions = {},
): Promise<RefreshBookingPaymentResult> {
  assertEnabled()

  const payment = await db.payment.findUnique({ where: { bookingId } })
  if (!payment || payment.pspProvider !== 'payat_go' || !payment.pspCheckoutId) {
    throw new PayAtGoValidationError('Pay@Go payment request was not found for this booking.')
  }

  if (options.mockStatus) {
    setPayAtGoMockStatus(payment.pspCheckoutId, options.mockStatus)
  }

  const provider = await readPayAtGoSingleRtp(payment.pspCheckoutId)
  return applyProviderStatusToPayment(payment, provider, 'manual_refresh')
}

export async function refreshPayAtGoBookingPaymentStatusByClientAccountNumber(
  clientAccountNumber: string,
  callbackRawBody?: string,
): Promise<RefreshBookingPaymentResult | null> {
  assertEnabled()

  const payment = await db.payment.findFirst({
    where: {
      pspProvider: 'payat_go',
      pspCheckoutId: clientAccountNumber,
    },
  })

  if (!payment) {
    console.warn(JSON.stringify({
      event: 'payat_go.callback_unknown_reference',
      providerClientAccountNumber: clientAccountNumber,
    }))
    return null
  }

  const metadata = readMetadata(payment.metadata)
  if (callbackRawBody) {
    const webhookHash = hashCallbackPayload(callbackRawBody)
    if (metadata.webhookLastEventHash === webhookHash) {
      console.info(JSON.stringify({
        event: 'payat_go.callback_duplicate_ignored',
        bookingId: payment.bookingId,
        paymentId: payment.id,
        providerClientAccountNumber: clientAccountNumber,
      }))

      return {
        paymentId: payment.id,
        bookingId: payment.bookingId,
        status: toInternalStatusFromPayment(payment),
        rawProviderStatus: metadata.providerStatus ?? 'UNKNOWN',
        paidAt: payment.paidAt,
        expiresAt: metadata.providerExpiredAt ? new Date(metadata.providerExpiredAt) : null,
        amountPaidCents: Math.round(Number(payment.amount) * 100),
        providerClientAccountNumber: clientAccountNumber,
      }
    }
  }

  const provider = await readPayAtGoSingleRtp(clientAccountNumber)
  const result = await applyProviderStatusToPayment(payment, provider, 'callback')

  if (callbackRawBody) {
    const updated = await db.payment.findUnique({ where: { id: payment.id } })
    if (updated) {
      const updatedMetadata = readMetadata(updated.metadata)
      const withHash = {
        ...updatedMetadata,
        webhookLastEventHash: hashCallbackPayload(callbackRawBody),
      }
      await db.payment.update({
        where: { id: updated.id },
        data: { metadata: toJsonValue(withHash) },
      })
    }
  }

  return result
}

async function applyProviderStatusToPayment(
  payment: Payment,
  provider: Awaited<ReturnType<typeof readPayAtGoSingleRtp>>,
  source: 'manual_refresh' | 'callback' | 'polling',
): Promise<RefreshBookingPaymentResult> {
  const now = new Date()
  const paymentId = payment.id
  const bookingId = payment.bookingId
  const metadata = readMetadata(payment.metadata)

  const nextMetadataBase: PayAtGoPaymentMetadata = {
    ...metadata,
    provider: 'PAYAT_GO',
    providerPaymentRequestId: provider.requestToPayId,
    providerClientAccountNumber: provider.clientAccountNumber,
    providerSourceReference: provider.sourceReference,
    providerPaymentLink: provider.paymentLink,
    providerQrCodeValue: provider.paymentLink,
    providerStatus: provider.accountState,
    providerInternalStatus: provider.internalStatus,
    providerLastCheckedAt: now.toISOString(),
    providerPaidAt: provider.paidAt ? provider.paidAt.toISOString() : metadata.providerPaidAt ?? null,
    providerExpiredAt: provider.expiresAt ? provider.expiresAt.toISOString() : metadata.providerExpiredAt ?? null,
    lastProviderPayload: provider.raw,
  }

  let nextMetadata = appendProviderEvent(nextMetadataBase, {
    at: now.toISOString(),
    action: 'STATUS_REFRESHED',
    source,
    internalStatus: provider.internalStatus,
    providerStatus: provider.accountState,
  })

  const currentInternalStatus = metadata.providerInternalStatus ?? toInternalStatusFromPayment(payment)

  if (provider.internalStatus === 'PAID') {
    const effectivePaidAmountCents = provider.amountPaidCents ?? provider.amountCents
    if (isPaymentAmountMismatch(payment, effectivePaidAmountCents)) {
      const expectedAmountCents = Math.round(Number(payment.amount) * 100)
      const reason = 'Paid amount does not match the expected booking amount.'
      nextMetadata = {
        ...nextMetadata,
        providerInternalStatus: 'FAILED',
        providerFailureReason: reason,
      }
      nextMetadata = appendProviderEvent(nextMetadata, {
        at: now.toISOString(),
        action: 'PAYMENT_AMOUNT_MISMATCH',
        source,
        expectedAmountCents,
        providerAmountCents: effectivePaidAmountCents,
        providerStatus: provider.accountState,
      })

      await db.payment.update({
        where: { id: paymentId },
        data: {
          status: 'FAILED',
          failureReason: reason,
          metadata: toJsonValue(nextMetadata),
        },
      })

      console.warn(JSON.stringify({
        event: 'payat_go.payment_amount_mismatch',
        bookingId,
        paymentId,
        providerClientAccountNumber: provider.clientAccountNumber,
        expectedAmountCents,
        providerAmountCents: effectivePaidAmountCents,
      }))
      const latest = await db.payment.findUniqueOrThrow({ where: { id: paymentId } })
      const latestMetadata = readMetadata(latest.metadata)
      return {
        paymentId,
        bookingId,
        status: latestMetadata.providerInternalStatus ?? toInternalStatusFromPayment(latest),
        rawProviderStatus: latestMetadata.providerStatus ?? provider.accountState,
        paidAt: latest.paidAt,
        expiresAt: latestMetadata.providerExpiredAt ? new Date(latestMetadata.providerExpiredAt) : provider.expiresAt,
        amountPaidCents: provider.amountPaidCents,
        providerClientAccountNumber: provider.clientAccountNumber,
      }
    }

    if (payment.status !== 'PAID' && currentInternalStatus !== 'PAID') {
      await handlePaymentSuccess({
        type: 'payment.success',
        bookingId,
        pspReference: provider.requestToPayId ? String(provider.requestToPayId) : provider.clientAccountNumber,
        amount: provider.amountPaidCents ?? provider.amountCents ?? Math.round(Number(payment.amount) * 100),
        currency: payment.currency,
        raw: provider.raw,
      })

      nextMetadata = appendProviderEvent(nextMetadata, {
        at: now.toISOString(),
        action: 'PAYMENT_MARKED_PAID',
        source,
        providerStatus: provider.accountState,
      })
    } else {
      nextMetadata = appendProviderEvent(nextMetadata, {
        at: now.toISOString(),
        action: 'PAYMENT_PAID_DUPLICATE_IGNORED',
        source,
        providerStatus: provider.accountState,
      })
    }

    await db.payment.update({
      where: { id: paymentId },
      data: {
        status: 'PAID',
        paidAt: provider.paidAt ?? now,
        pspReference: provider.requestToPayId ? String(provider.requestToPayId) : payment.pspReference,
        failureReason: null,
        checkoutUrl: provider.paymentLink ?? payment.checkoutUrl,
        metadata: toJsonValue(nextMetadata),
      },
    })

    console.info(JSON.stringify({
      event: 'payat_go.payment_marked_paid',
      bookingId,
      paymentId,
      providerClientAccountNumber: provider.clientAccountNumber,
      providerPaymentRequestId: provider.requestToPayId,
    }))
  } else if (
    provider.internalStatus === 'FAILED' ||
    provider.internalStatus === 'CANCELLED' ||
    provider.internalStatus === 'EXPIRED'
  ) {
    if (isTerminalSuccessPaymentStatus(payment.status) || currentInternalStatus === 'PAID') {
      nextMetadata = {
        ...nextMetadata,
        providerInternalStatus: currentInternalStatus,
      }
      nextMetadata = appendProviderEvent(nextMetadata, {
        at: now.toISOString(),
        action: 'PAYMENT_TERMINAL_SUCCESS_PRESERVED',
        source,
        internalStatus: provider.internalStatus,
        providerStatus: provider.accountState,
      })

      await db.payment.update({
        where: { id: paymentId },
        data: {
          metadata: toJsonValue(nextMetadata),
        },
      })

      const latest = await db.payment.findUniqueOrThrow({ where: { id: paymentId } })
      const latestMetadata = readMetadata(latest.metadata)
      return {
        paymentId,
        bookingId,
        status: latestMetadata.providerInternalStatus ?? toInternalStatusFromPayment(latest),
        rawProviderStatus: latestMetadata.providerStatus ?? provider.accountState,
        paidAt: latest.paidAt,
        expiresAt: latestMetadata.providerExpiredAt ? new Date(latestMetadata.providerExpiredAt) : provider.expiresAt,
        amountPaidCents: provider.amountPaidCents,
        providerClientAccountNumber: provider.clientAccountNumber,
      }
    }

    const reason = statusToPaymentFailureReason(provider.internalStatus)
    const shouldTriggerFailureSideEffects = payment.status !== 'FAILED'
    nextMetadata = {
      ...nextMetadata,
      providerFailureReason: reason,
      providerCancelledAt:
        provider.internalStatus === 'CANCELLED'
          ? now.toISOString()
          : nextMetadata.providerCancelledAt ?? null,
      providerFailedAt:
        provider.internalStatus === 'FAILED'
          ? now.toISOString()
          : nextMetadata.providerFailedAt ?? null,
    }

    nextMetadata = appendProviderEvent(nextMetadata, {
      at: now.toISOString(),
      action: shouldTriggerFailureSideEffects
        ? 'PAYMENT_MARKED_FAILED'
        : 'PAYMENT_FAILED_DUPLICATE_IGNORED',
      source,
      internalStatus: provider.internalStatus,
      providerStatus: provider.accountState,
      reason,
    })

    if (shouldTriggerFailureSideEffects) {
      await handlePaymentFailed({
        type: 'payment.failed',
        bookingId,
        pspReference: provider.requestToPayId ? String(provider.requestToPayId) : provider.clientAccountNumber,
        amount: provider.amountCents ?? Math.round(Number(payment.amount) * 100),
        currency: payment.currency,
        raw: provider.raw,
      }).catch(() => {
        // Some booking flows may not have full customer notification context at this stage.
      })
    }

    await db.payment.update({
      where: { id: paymentId },
      data: {
        status: 'FAILED',
        failureReason: reason,
        checkoutUrl: provider.paymentLink ?? payment.checkoutUrl,
        metadata: toJsonValue(nextMetadata),
      },
    })

    console.warn(JSON.stringify({
      event: 'payat_go.payment_marked_non_paid',
      bookingId,
      paymentId,
      providerClientAccountNumber: provider.clientAccountNumber,
      internalStatus: provider.internalStatus,
      providerStatus: provider.accountState,
    }))
  } else {
    await db.payment.update({
      where: { id: paymentId },
      data: {
        checkoutUrl: provider.paymentLink ?? payment.checkoutUrl,
        metadata: toJsonValue(nextMetadata),
      },
    })

    console.info(JSON.stringify({
      event: 'payat_go.status_refreshed',
      bookingId,
      paymentId,
      providerClientAccountNumber: provider.clientAccountNumber,
      internalStatus: provider.internalStatus,
      providerStatus: provider.accountState,
    }))
  }

  const latest = await db.payment.findUniqueOrThrow({ where: { id: paymentId } })
  const latestMetadata = readMetadata(latest.metadata)

  return {
    paymentId,
    bookingId,
    status: latestMetadata.providerInternalStatus ?? toInternalStatusFromPayment(latest),
    rawProviderStatus: latestMetadata.providerStatus ?? provider.accountState,
    paidAt: latest.paidAt,
    expiresAt: latestMetadata.providerExpiredAt ? new Date(latestMetadata.providerExpiredAt) : provider.expiresAt,
    amountPaidCents: provider.amountPaidCents,
    providerClientAccountNumber: provider.clientAccountNumber,
  }
}

export async function cancelPayAtGoBookingPaymentRequest(
  bookingId: string,
): Promise<CancelBookingPaymentResult> {
  assertEnabled()

  const payment = await db.payment.findUnique({ where: { bookingId } })
  if (!payment || payment.pspProvider !== 'payat_go' || !payment.pspCheckoutId) {
    throw new PayAtGoValidationError('Pay@Go payment request was not found for this booking.')
  }

  const currentStatus = toInternalStatusFromPayment(payment)
  const isActivePayment =
    payment.status === 'PENDING' ||
    payment.status === 'AUTHORISED' ||
    ACTIVE_INTERNAL_STATUSES.has(currentStatus)
  if (!isActivePayment) {
    throw new PayAtGoValidationError('Only pending Pay@Go payment requests can be cancelled.')
  }

  const cancelled = await cancelPayAtGoSingleRtp(payment.pspCheckoutId)
  const now = new Date()
  const metadata = readMetadata(payment.metadata)

  const nextMetadata = appendProviderEvent(
    {
      ...metadata,
      providerStatus: cancelled.rawProviderStatus,
      providerInternalStatus: cancelled.internalStatus,
      providerLastCheckedAt: now.toISOString(),
      providerCancelledAt: now.toISOString(),
      providerFailureReason: 'This payment request was cancelled.',
      lastProviderPayload: cancelled.raw,
    },
    {
      at: now.toISOString(),
      action: 'PAYMENT_REQUEST_CANCELLED',
      internalStatus: cancelled.internalStatus,
      providerStatus: cancelled.rawProviderStatus,
    },
  )

  await db.payment.update({
    where: { id: payment.id },
    data: {
      status: 'FAILED',
      failureReason: 'This payment request was cancelled.',
      metadata: toJsonValue(nextMetadata),
    },
  })

  console.info(JSON.stringify({
    event: 'payat_go.payment_request_cancelled',
    bookingId,
    paymentId: payment.id,
    providerClientAccountNumber: cancelled.clientAccountNumber,
  }))

  return {
    paymentId: payment.id,
    bookingId,
    status: 'CANCELLED',
    rawProviderStatus: cancelled.rawProviderStatus,
    cancelledAt: now,
    providerClientAccountNumber: cancelled.clientAccountNumber,
  }
}

export async function pollPayAtGoBookingPaymentStatus(
  bookingId: string,
): Promise<RefreshBookingPaymentResult> {
  assertEnabled()

  const payment = await db.payment.findUnique({ where: { bookingId } })
  if (!payment || payment.pspProvider !== 'payat_go' || !payment.pspCheckoutId) {
    throw new PayAtGoValidationError('Pay@Go payment request was not found for this booking.')
  }

  const provider = await readPayAtGoSingleRtp(payment.pspCheckoutId)
  return applyProviderStatusToPayment(payment, provider, 'polling')
}

export function mapProviderStatusForDisplay(rawStatus: string | null | undefined): InternalPayAtGoStatus {
  return mapPayAtGoAccountStateToInternalStatus(rawStatus)
}

export function mapPayAtGoErrorToUserMessage(error: unknown): string {
  if (error instanceof PayAtGoValidationError) {
    return error.message
  }
  if (error instanceof PayAtGoProviderError && error.status === 404) {
    return 'This payment request has expired. Please create a new one.'
  }
  if (error instanceof PayAtGoProviderError || error instanceof PayAtGoConfigurationError) {
    return 'We could not start the payment request. Please try again.'
  }
  return 'We could not start the payment request. Please try again.'
}

export function mapPayAtGoErrorToHttpStatus(error: unknown): number {
  if (error instanceof PayAtGoValidationError) {
    if (error.message.toLowerCase().includes('not found')) return 404
    return 400
  }
  if (error instanceof PayAtGoConfigurationError) return 503
  if (error instanceof PayAtGoNetworkError) return 503
  if (error instanceof PayAtGoAuthError) return 502
  if (error instanceof PayAtGoProviderError) {
    if (error.status === 404) return 409
    if (error.status && error.status >= 500) return 502
    return 502
  }
  return 502
}
