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
import { PayatApiError, PayatConfigError, PayatTokenError } from '@/lib/payat'
import { verifyRequestOrigin } from '@/lib/csrf'
import { apiError } from '@/lib/api-response'
import { issueProviderIdentityVerificationLink } from '@/lib/identity-verification/link'

type CreateTopUpIntentBody = {
  amountCents?: unknown
  /** Backward-compatible JSON client path; normalized then validated as cents. */
  amountRand?: unknown
  /** Optional payment method: "PAYAT" (default) | "MANUAL_EFT" | "PAYFAST_CARD" | "PAYFAST_EFT" | "PAYFAST_SCODE" */
  paymentMethod?: unknown
  metadata?: unknown
}

const PAYFAST_METHODS = new Set<string>(['PAYFAST_CARD', 'PAYFAST_EFT', 'PAYFAST_SCODE'])

function mapProviderIntentError(error: ProviderCreditPaymentIntentError) {
  switch (error.code) {
    case 'PROVIDER_NOT_FOUND':
      return { status: 403, error: 'Provider not found', code: error.code }
    case 'INVALID_AMOUNT':
      return { status: 400, error: 'Top-up amount must be R100, R200 or R500.', code: error.code }
    case 'PROVIDER_PHONE_MISSING':
      return {
        status: 400,
        error: 'A mobile number is required on your provider profile to create a Pay@ link.',
        code: error.code,
      }
    case 'DUPLICATE_INTENT':
      return {
        status: 409,
        error: 'A pending Pay@ top-up already exists for this amount. Use your active link or wait for it to expire.',
        code: error.code,
      }
    case 'REFERENCE_GENERATION_FAILED':
      return { status: 500, error: 'Could not generate a payment reference right now. Please try again.', code: error.code }
    case 'IDENTITY_NOT_VERIFIED':
      return {
        status: 403,
        error: 'Identity verification is required before buying credits.',
        code: error.code,
      }
    default:
      return { status: 400, error: 'Could not create top-up payment intent.', code: error.code }
  }
}

function parseAmountCents(body: CreateTopUpIntentBody) {
  if (typeof body.amountCents === 'number' && Number.isFinite(body.amountCents)) {
    return body.amountCents
  }
  if (typeof body.amountCents === 'string') {
    const parsed = Number.parseFloat(body.amountCents)
    if (Number.isFinite(parsed)) return parsed
  }
  if (typeof body.amountRand === 'number' && Number.isFinite(body.amountRand)) {
    return body.amountRand * 100
  }
  if (typeof body.amountRand === 'string') {
    const parsed = Number.parseFloat(body.amountRand)
    if (Number.isFinite(parsed)) return parsed * 100
  }
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

    // Default: Pay@ retail cash, QR and hosted payment link.
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
      const mapped = mapProviderIntentError(error)
      const verificationUrl = mapped.code === 'IDENTITY_NOT_VERIFIED'
        ? await issueVerificationLink(provider.id)
        : null
      return NextResponse.json(
        {
          error: mapped.error,
          code: mapped.code,
          ...(verificationUrl ? { verificationUrl } : {}),
        },
        { status: mapped.status },
      )
    }

    if (error instanceof PayatConfigError) {
      console.error('[provider/wallet/top-up-intents] payat_config_missing', {
        detail: error.message,
      })
      return NextResponse.json(
        { error: 'Pay@ is temporarily unavailable. Please try again shortly.', code: 'PAYAT_CONFIG_MISSING' },
        { status: 503 },
      )
    }

    if (error instanceof PayatTokenError) {
      console.error('[provider/wallet/top-up-intents] payat_token_failed', {
        stage: error.stage,
        status: error.status ?? null,
        detail: error.message,
      })
      return NextResponse.json(
        { error: 'Could not reach Pay@ authentication right now. Please retry shortly.', code: 'PAYAT_TOKEN_FAILED' },
        { status: 502 },
      )
    }

    if (error instanceof PayatApiError) {
      console.error('[provider/wallet/top-up-intents] payat_api_failed', {
        stage: error.stage,
        status: error.status ?? null,
        detail: error.message,
      })
      return NextResponse.json(
        { error: 'Could not create your Pay@ payment link right now. Please retry.', code: 'PAYAT_API_FAILED' },
        { status: 502 },
      )
    }

    console.error('[provider/wallet/top-up-intents] Failed to create payment intent:', error)
    return NextResponse.json({ error: 'Could not create top-up payment intent' }, { status: 500 })
  }
}

async function issueVerificationLink(providerId: string): Promise<string | null> {
  try {
    const link = await issueProviderIdentityVerificationLink({
      providerId,
      channel: 'PWA',
      purpose: 'CREDIT_TOP_UP',
    })
    return link.verificationUrl
  } catch (error) {
    console.error('[provider/wallet/top-up-intents] identity verification link issue failed', {
      providerId,
      error: error instanceof Error ? error.message : String(error),
    })
    return null
  }
}
