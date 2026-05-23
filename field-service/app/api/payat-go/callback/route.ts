import { type NextRequest, NextResponse } from 'next/server'
import { timingSafeEqual } from 'crypto'
import {
  mapPayAtGoErrorToHttpStatus,
  refreshPayAtGoBookingPaymentStatusByClientAccountNumber,
  mapPayAtGoErrorToUserMessage,
} from '@/lib/payat-go'
import { checkPayAtGoLimit } from '@/lib/rate-limit'

type PayAtGoCallbackPayload = {
  accountNumber?: unknown
  clientAccountNumber?: unknown
  referenceNumber?: unknown
  amountPaid?: unknown
}

function getConfiguredCallbackSecret(): string | null {
  const explicit = process.env.PAYAT_GO_CALLBACK_SECRET?.trim()
  if (explicit) return explicit
  const webhook = process.env.PAYAT_GO_WEBHOOK_SECRET?.trim()
  return webhook || null
}

function hasValidCallbackSecret(request: NextRequest, expected: string): boolean {
  const secretHeader = request.headers.get('x-payat-go-secret')
    ?? request.headers.get('x-callback-secret')

  if (secretHeader && safeSecretEquals(secretHeader, expected)) return true

  return false
}

function safeSecretEquals(received: string, expected: string): boolean {
  const receivedBuffer = Buffer.from(received, 'utf8')
  const expectedBuffer = Buffer.from(expected, 'utf8')
  if (receivedBuffer.length !== expectedBuffer.length) return false
  return timingSafeEqual(receivedBuffer, expectedBuffer)
}

function extractClientAccountNumber(payload: PayAtGoCallbackPayload): string | null {
  if (typeof payload.accountNumber === 'string' && /^\d{1,14}$/.test(payload.accountNumber)) {
    return payload.accountNumber
  }
  if (typeof payload.clientAccountNumber === 'string' && /^\d{1,14}$/.test(payload.clientAccountNumber)) {
    return payload.clientAccountNumber
  }
  return null
}

export async function POST(request: NextRequest) {
  const callbackSecret = getConfiguredCallbackSecret()
  if (!callbackSecret) {
    console.error(JSON.stringify({
      event: 'payat_go.callback_rejected',
      reason: 'missing_callback_secret',
    }))
    return NextResponse.json({ error: 'Callback secret is not configured.' }, { status: 503 })
  }

  if (!hasValidCallbackSecret(request, callbackSecret)) {
    console.warn(JSON.stringify({
      event: 'payat_go.callback_rejected',
      reason: 'invalid_secret',
    }))
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const rawBody = await request.text()
  let payload: PayAtGoCallbackPayload
  try {
    payload = JSON.parse(rawBody) as PayAtGoCallbackPayload
  } catch {
    return NextResponse.json({ error: 'Invalid JSON payload.' }, { status: 400 })
  }

  const clientAccountNumber = extractClientAccountNumber(payload)
  if (!clientAccountNumber) {
    return NextResponse.json(
      { error: 'Callback payload is missing accountNumber/clientAccountNumber.' },
      { status: 400 },
    )
  }

  const callbackLimit = await checkPayAtGoLimit({
    operation: 'callback',
    identifier: `client_account_number:${clientAccountNumber}`,
  })
  if (!callbackLimit.ok) {
    const retryAfterSeconds = Math.max(1, Math.ceil(callbackLimit.retryAfterMs / 1000))
    return NextResponse.json(
      {
        error:
          callbackLimit.code === 'limiter_unavailable'
            ? 'Service temporarily unavailable.'
            : 'Too many requests.',
      },
      {
        status: callbackLimit.code === 'limiter_unavailable' ? 503 : 429,
        headers: { 'Retry-After': String(retryAfterSeconds) },
      },
    )
  }

  try {
    const result = await refreshPayAtGoBookingPaymentStatusByClientAccountNumber(
      clientAccountNumber,
      rawBody,
    )

    if (!result) {
      console.warn(JSON.stringify({
        event: 'payat_go.callback_ignored_unknown_reference',
        providerClientAccountNumber: clientAccountNumber,
      }))
      return NextResponse.json({ received: true, ignored: 'unknown_reference' })
    }

    console.info(JSON.stringify({
      event: 'payat_go.callback_processed',
      bookingId: result.bookingId,
      paymentId: result.paymentId,
      status: result.status,
      rawProviderStatus: result.rawProviderStatus,
      providerClientAccountNumber: result.providerClientAccountNumber,
    }))

    return NextResponse.json({ received: true })
  } catch (error) {
    console.error(JSON.stringify({
      event: 'payat_go.callback_processing_failed',
      providerClientAccountNumber: clientAccountNumber,
      errorName: error instanceof Error ? error.name : 'UnknownError',
    }))
    return NextResponse.json(
      { error: mapPayAtGoErrorToUserMessage(error) },
      { status: mapPayAtGoErrorToHttpStatus(error) },
    )
  }
}
