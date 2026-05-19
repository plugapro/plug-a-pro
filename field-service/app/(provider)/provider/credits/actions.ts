'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { type WalletCreditType, type WalletLedgerEntryType } from '@prisma/client'
import { db } from '@/lib/db'
import { requireProvider } from '@/lib/auth'
import {
  getProviderWalletBalance,
  getProviderWalletLedgerEntries,
} from '@/lib/provider-wallet'
import {
  createPayatTopUpIntent,
  createManualEftTopUpIntent,
  createPayfastTopUpIntent,
  getManualEftBankAccountInstructions,
  ProviderCreditPaymentIntentError,
  type PayfastTopUpMethod,
  type PayatTopUpFailureCode,
  type ProviderPayatTopUpResponse,
} from '@/lib/provider-credit-payment-intents'
import { PayatConfigError, PayatApiError, PayatTokenError } from '@/lib/payat'

const ESTIMATED_CREDITS_PER_LEAD_UNLOCK = 1
const LEDGER_LIMIT = 20

type ProviderWalletActor = {
  id: string
  phone: string | null
}

export type ProviderWalletSummary = {
  totalAvailableCredits: number
  paidCredits: number
  promoCredits: number
  estimatedLeadsUnlockable: number
}

export type ProviderWalletLedgerItem = {
  id: string
  occurredAt: string
  label: string
  detail: string
  creditType: WalletCreditType
  amountCredits: number
  signedAmountCredits: number
  balanceAfterPaidCredits: number
  balanceAfterPromoCredits: number
}

export type ProviderTopUpIntentInstructions = {
  intentId: string
  status: string
  amountCents: number
  amountFormatted: string
  currency: string
  creditsToIssue: number
  paymentReference: string
  expiresAt: string | null
  bankAccount: {
    accountName: string
    bankName: string
    accountNumber: string
    branchCode: string
    accountType: string
  }
}

async function getAuthenticatedProvider(): Promise<ProviderWalletActor> {
  const session = await requireProvider()
  const provider = await db.provider.findUnique({
    where: { userId: session.id },
    select: { id: true, phone: true },
  })

  if (!provider) {
    throw new Error('Provider account not found.')
  }

  return provider
}

function ledgerLabel(entryType: WalletLedgerEntryType) {
  switch (entryType) {
    case 'TOPUP_CREDIT':
      return 'Credit top-up'
    case 'PROMO_CREDIT':
      return 'Starter/onboarding credits added'
    case 'LEAD_UNLOCK_DEBIT':
      return 'Lead unlock charge'
    case 'LEAD_REFUND_CREDIT':
      return 'Lead unlock refund'
    case 'ADMIN_ADJUSTMENT':
      return 'Wallet adjustment'
    case 'PROMO_EXPIRY':
      // Forward-compatible display label. Promo expiry is not fired until the
      // expiry job is implemented.
      return 'Starter/onboarding credits expired'
    case 'PAYMENT_REVERSAL':
      // Forward-compatible display label. Payment reversals are not fired until
      // bank/gateway reversal handling is implemented.
      return 'Payment reversal'
    default:
      return String(entryType)
        .split('_')
        .map((part) => part.charAt(0) + part.slice(1).toLowerCase())
        .join(' ')
  }
}

function isDebit(entryType: WalletLedgerEntryType) {
  return entryType === 'LEAD_UNLOCK_DEBIT' ||
    entryType === 'PROMO_EXPIRY' ||
    entryType === 'PAYMENT_REVERSAL'
}

function providerSafeDetail(referenceType: string, referenceId: string) {
  const ref = referenceId.slice(-8).toUpperCase()
  switch (referenceType) {
    case 'lead':
    case 'lead_refund':
      return `Lead ref ${ref}`
    case 'manual_eft':
    case 'payment_intent':
      return `Payment ref ${ref}`
    case 'promo_campaign':
      return 'Promotion'
    default:
      return `Ref ${ref}`
  }
}

function serializeTopUpInstructions(
  result: Awaited<ReturnType<typeof createManualEftTopUpIntent>>,
): ProviderTopUpIntentInstructions {
  return {
    intentId: result.intent.id,
    status: result.intent.status,
    amountCents: result.instructions.amountCents,
    amountFormatted: result.instructions.amountFormatted,
    currency: result.instructions.currency,
    creditsToIssue: result.instructions.creditsToIssue,
    paymentReference: result.instructions.paymentReference,
    expiresAt: result.instructions.expiresAt?.toISOString() ?? null,
    bankAccount: result.instructions.bankAccount,
  }
}

export async function getProviderWalletSummary(): Promise<ProviderWalletSummary> {
  const provider = await getAuthenticatedProvider()
  const balance = await getProviderWalletBalance(provider.id)

  return {
    totalAvailableCredits: balance.totalCreditBalance,
    paidCredits: balance.paidCreditBalance,
    promoCredits: balance.promoCreditBalance,
    estimatedLeadsUnlockable: Math.floor(
      balance.totalCreditBalance / ESTIMATED_CREDITS_PER_LEAD_UNLOCK,
    ),
  }
}

export async function getProviderWalletLedger(): Promise<ProviderWalletLedgerItem[]> {
  const provider = await getAuthenticatedProvider()
  const entries = await getProviderWalletLedgerEntries(provider.id, { limit: LEDGER_LIMIT })

  return entries.map((entry) => {
    const signedAmountCredits = isDebit(entry.entryType)
      ? -entry.amountCredits
      : entry.amountCredits

    return {
      id: entry.id,
      occurredAt: entry.createdAt.toISOString(),
      label: ledgerLabel(entry.entryType),
      detail: providerSafeDetail(entry.referenceType, entry.referenceId),
      creditType: entry.creditType,
      amountCredits: entry.amountCredits,
      signedAmountCredits,
      balanceAfterPaidCredits: entry.balanceAfterPaidCredits,
      balanceAfterPromoCredits: entry.balanceAfterPromoCredits,
    }
  })
}

export async function getProviderTopUpIntentInstructions(
  intentId: string,
): Promise<ProviderTopUpIntentInstructions | null> {
  const provider = await getAuthenticatedProvider()
  const intent = await db.paymentIntent.findFirst({
    where: {
      id: intentId,
      providerId: provider.id,
      paymentMethod: 'MANUAL_EFT',
    },
  })

  if (!intent) return null

  return {
    intentId: intent.id,
    status: intent.status,
    amountCents: intent.amountCents,
    amountFormatted: new Intl.NumberFormat('en-ZA', {
      style: 'currency',
      currency: intent.currency,
    }).format(intent.amountCents / 100),
    currency: intent.currency,
    creditsToIssue: intent.creditsToIssue,
    paymentReference: intent.paymentReference,
    expiresAt: intent.expiresAt?.toISOString() ?? null,
    bankAccount: getManualEftBankAccountInstructions(),
  }
}

export async function createProviderTopUpIntent(
  amountCents: number,
): Promise<ProviderTopUpIntentInstructions> {
  // The form-action wrapper at line 384 falls back to Number.NaN when the
  // amountCents field is missing or non-numeric. Without this guard the call
  // would reach Prisma and surface as a generic 500 in production.
  if (!Number.isFinite(amountCents)) {
    throw new Error('Top-up amount must be a number.')
  }
  const provider = await getAuthenticatedProvider()
  const result = await createManualEftTopUpIntent({
    providerId: provider.id,
    amountCents,
    providerCellphone: provider.phone,
  })

  revalidatePath('/provider/credits')
  return serializeTopUpInstructions(result)
}

export type ProviderPayfastCheckoutResult =
  | { ok: true; intentId: string; checkout: import('@/lib/payfast').PayfastCheckoutPayload }
  | { ok: false; code: string; userMessage: string }

export type ProviderPayatTopUpResult = {
  intentId: string
  amountCents: number
  creditsToIssue: number
  reference: string
  paymentLink: string
}

// Server actions can't surface real error messages to the client in production
// (Next.js redacts thrown errors). The discriminated-union response type lives
// in lib/provider-credit-payment-intents.ts so it's reusable by any caller.

// Re-exported for backward compat — earlier callers imported the types from here.
export type { PayatTopUpFailureCode, ProviderPayatTopUpResponse } from '@/lib/provider-credit-payment-intents'

export async function createProviderPayatTopUpIntent(
  amountCents: number,
): Promise<ProviderPayatTopUpResponse> {
  let providerId: string | null = null
  let intentId: string | undefined
  try {
    const provider = await getAuthenticatedProvider()
    providerId = provider.id
    const activeIntentCount = await db.paymentIntent.count({
      where: { providerId: provider.id, status: 'PENDING_PAYMENT' },
    })
    if (activeIntentCount >= 3) {
      console.warn('[payat] checkout_blocked: too_many_pending', { providerId: provider.id, amountCents, activeIntentCount })
      return {
        ok: false,
        code: 'TOO_MANY_PENDING',
        userMessage: 'You already have 3 pending payments. Complete or cancel one before starting a new top-up.',
      }
    }
    const result = await createPayatTopUpIntent({
      providerId: provider.id,
      amountCents,
      providerCellphone: provider.phone,
    })
    intentId = result.intent.id

    revalidatePath('/provider/credits')
    return {
      ok: true,
      data: {
        intentId: result.intent.id,
        amountCents: result.intent.amountCents,
        creditsToIssue: result.intent.creditsToIssue,
        reference: result.payat.reference,
        paymentLink: result.payat.paymentLink,
      },
    }
  } catch (err) {
    if (err instanceof ProviderCreditPaymentIntentError) {
      console.warn('[payat] checkout_blocked: payment_intent_error', { providerId, amountCents, code: err.code, message: err.message })
      switch (err.code) {
        case 'DUPLICATE_INTENT':
          return {
            ok: false,
            code: 'DUPLICATE_INTENT',
            userMessage: "You already have a pending Pay@ top-up for this amount. Open it from your active payments, or wait for it to expire.",
          }
        case 'INVALID_AMOUNT':
          return {
            ok: false,
            code: 'INVALID_AMOUNT',
            userMessage: 'That top-up amount is not available. Please pick R100, R200 or R500.',
          }
        case 'PROVIDER_NOT_FOUND':
          return {
            ok: false,
            code: 'PROVIDER_NOT_FOUND',
            userMessage: 'We could not load your provider profile. Sign in again and retry.',
          }
        case 'REFERENCE_GENERATION_FAILED':
          return {
            ok: false,
            code: 'REFERENCE_GENERATION_FAILED',
            userMessage: 'Could not generate a payment reference. Please try again.',
          }
      }
    }
    const message = err instanceof Error ? err.message : String(err)
    console.error('[payat] checkout_failed', { providerId, amountCents, intentId, error: message })
    // Match on typed error classes instead of message strings — Pay@ may
    // reword the underlying HTTP error copy without notice. PayatTokenError
    // and PayatApiError carry a `stage` discriminator + HTTP status so future
    // observability work can split metrics per failure mode.
    if (err instanceof PayatConfigError) {
      return {
        ok: false,
        code: 'PAYAT_CONFIG_MISSING' as const,
        userMessage: 'Pay@ is temporarily unavailable. Please use Payfast or Manual EFT, or contact support.',
      }
    }
    if (err instanceof PayatTokenError) {
      return {
        ok: false,
        code: 'PAYAT_TOKEN_FAILED' as const,
        userMessage: 'Could not authenticate with Pay@. Please try again in a minute, or use Payfast.',
      }
    }
    if (err instanceof PayatApiError) {
      return {
        ok: false,
        code: 'PAYAT_API_FAILED' as const,
        userMessage: 'Pay@ rejected the request. Please try Payfast or Manual EFT, or contact support.',
      }
    }
    return {
      ok: false,
      code: 'UNKNOWN' as const,
      userMessage: 'Could not start Pay@ checkout. Please try again or use Payfast.',
    }
  }
}

/**
 * Create a Payfast checkout intent for the authenticated provider.
 * The caller must POST the provider's browser to `result.checkout.action`
 * with `result.checkout.fields`.
 *
 * IMPORTANT: the Payfast return URL is UI-only — wallet crediting only
 * happens after Payfast sends a verified ITN to /api/webhooks/payfast.
 */
export async function createProviderPayfastTopUpIntent(
  amountCents: number,
  paymentMethod: PayfastTopUpMethod = 'PAYFAST_CARD',
): Promise<ProviderPayfastCheckoutResult> {
  let providerId: string | null = null
  let intentId: string | undefined
  try {
    const provider = await getAuthenticatedProvider()
    providerId = provider.id
    const activeIntentCount = await db.paymentIntent.count({
      where: { providerId: provider.id, status: 'PENDING_PAYMENT' },
    })
    if (activeIntentCount >= 3) {
      // Mirror the Pay@ checkout_blocked log shape so log-based alerts can match
      // a single prefix family across both PSPs.
      console.warn('[payfast] checkout_blocked: too_many_pending', {
        providerId: provider.id,
        amountCents,
        activeIntentCount,
      })
      return {
        ok: false,
        code: 'TOO_MANY_PENDING',
        userMessage: 'You already have 3 pending payments. Complete or cancel one before starting a new top-up.',
      }
    }
    const result = await createPayfastTopUpIntent({
      providerId: provider.id,
      amountCents,
      paymentMethod,
      providerCellphone: provider.phone,
    })
    intentId = result.intent.id

    revalidatePath('/provider/credits')
    return { ok: true, intentId: result.intent.id, checkout: result.checkout }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('[payfast] checkout_failed', { providerId, amountCents, intentId, error: message })
    if (err instanceof ProviderCreditPaymentIntentError) {
      switch (err.code) {
        case 'INVALID_AMOUNT':
          return {
            ok: false,
            code: 'INVALID_AMOUNT',
            userMessage: 'That top-up amount is not available. Please pick R100, R200 or R500.',
          }
        case 'PROVIDER_NOT_FOUND':
          return {
            ok: false,
            code: 'PROVIDER_NOT_FOUND',
            userMessage: 'We could not load your provider profile. Sign in again and retry.',
          }
        default:
          break
      }
    }
    return {
      ok: false,
      code: 'UNKNOWN',
      userMessage: 'Could not start Payfast checkout. Please try again.',
    }
  }
}

export async function createProviderTopUpIntentFormAction(formData: FormData) {
  const rawAmountCents = formData.get('amountCents')
  const amountCents = typeof rawAmountCents === 'string'
    ? Number.parseInt(rawAmountCents, 10)
    : Number.NaN
  const instructions = await createProviderTopUpIntent(amountCents)

  redirect(`/provider/credits?intent=${encodeURIComponent(instructions.intentId)}`)
}

export async function createProviderCreditTopUpIntentAction(formData: FormData) {
  return createProviderTopUpIntentFormAction(formData)
}
