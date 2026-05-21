'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { randomUUID } from 'crypto'
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
import { notifyProviderPayatTopUpInitiated as notifyProviderPayatTopUpInitiatedCore } from '@/lib/provider-wallet-notifications'

const ACTIVE_PAYAT_STATUSES = ['PENDING_PAYMENT', 'ITN_RECEIVED'] as const

const ESTIMATED_CREDITS_PER_LEAD_UNLOCK = 1
const LEDGER_LIMIT = 20

function resolvePayatEnvironment(): 'sandbox' | 'live' | 'unknown' {
  const explicit = process.env.PAYAT_ENV?.trim().toLowerCase()
  if (explicit === 'sandbox' || explicit === 'test') return 'sandbox'
  if (explicit === 'live' || explicit === 'production') return 'live'

  const apiBase = process.env.PAYAT_API_BASE?.trim().toLowerCase()
  if (apiBase?.includes('sandbox')) return 'sandbox'
  if (apiBase?.startsWith('https://')) return 'live'
  return 'unknown'
}

function payatPackageIdForAmount(amountCents: number) {
  return `payat_${amountCents}`
}

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

export type ProviderWallet = {
  credits: number
  starter: number
  pendingIntents: ProviderWalletPendingIntent[]
  recentActivity: ProviderWalletRecentActivityItem[]
}

export type ProviderWalletPendingIntent = {
  id: string
  amountCents: number
  creditsToIssue: number
  paymentReference: string
  status: string
  createdAt: string
  expiresAt: string | null
  paymentLink: string | null
}

export type ProviderWalletRecentActivityItem = {
  id: string
  title: string
  ref: string
  when: string
  delta: number
  entryType: string
}

export type PaymentIntentStatusResult =
  | {
      ok: true
      status: string
      creditsIssued?: number
      paidAt: string | null
      creditedAt: string | null
      expiresAt: string | null
      reference: string
      paymentLink: string | null
      amountCents: number
      creditsToIssue: number
    }
  | {
      ok: false
      code: 'NOT_FOUND' | 'FORBIDDEN' | 'UNSUPPORTED_INTENT'
      message: string
    }

export type NotifyPayatTopUpResult =
  | {
      ok: true
    }
  | {
      ok: false
      code: 'NOT_FOUND' | 'INVALID_STATUS' | 'MISSING_LINK'
      message: string
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

  // Some legacy provider records still have null phone values while the current
  // auth session includes a normalized E.164 phone. Prefer the provider row,
  // then fall back to the authenticated session to keep Pay@ creation reliable.
  return {
    id: provider.id,
    phone: provider.phone ?? session.phone ?? null,
  }
}

function ledgerLabel(entryType: WalletLedgerEntryType) {
  switch (entryType) {
    case 'TOPUP_CREDIT':
      return 'Credits purchased'
    case 'PROMO_CREDIT':
      return 'Starter credits added'
    case 'VOUCHER_REDEMPTION':
      return 'Voucher redeemed'
    case 'LEAD_UNLOCK_DEBIT':
      return 'Lead accepted'
    case 'LEAD_REFUND_CREDIT':
      return 'Lead refund'
    case 'ADMIN_ADJUSTMENT':
      return 'Wallet adjustment'
    case 'PROMO_EXPIRY':
      return 'Starter credits expired'
    case 'PAYMENT_REVERSAL':
      return 'Payment reversal'
    case 'WALLET_SUSPENDED':
      return 'Wallet suspended'
    case 'WALLET_REACTIVATED':
      return 'Wallet reactivated'
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

function asText(value: unknown) {
  return typeof value === 'string' && value.trim().length > 0 ? value : null
}

function asDateString(value: unknown) {
  return value instanceof Date ? value.toISOString() : typeof value === 'string' ? value : null
}

function readMetadataPaymentLink(metadata: unknown): string | null {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return null
  const candidate = asText((metadata as Record<string, unknown>).paymentLink)
  return candidate && /^https?:\/\//.test(candidate) ? candidate : null
}

function mergePayatDisplayMetadata(
  metadata: unknown,
  payat: { reference: string; paymentLink: string },
) {
  const base = metadata && typeof metadata === 'object' && !Array.isArray(metadata)
    ? metadata as Record<string, unknown>
    : {}

  return {
    ...base,
    payatReference: payat.reference,
    paymentLink: payat.paymentLink,
  }
}

function summarizeActivityLabel(entryType: WalletLedgerEntryType) {
  switch (entryType) {
    case 'TOPUP_CREDIT':
      return 'Credits purchased'
    case 'PAYMENT_REVERSAL':
      return 'Payment reversal'
    case 'LEAD_REFUND_CREDIT':
      return 'Lead refund'
    case 'PROMO_CREDIT':
      return 'Starter credits added'
    case 'ADMIN_ADJUSTMENT':
      return 'Credit adjustment'
    case 'PROMO_EXPIRY':
      return 'Starter credits expired'
    case 'LEAD_UNLOCK_DEBIT':
      return 'Lead accepted'
    case 'VOUCHER_REDEMPTION':
      return 'Voucher redeemed'
    default:
      return 'Credit activity'
  }
}

function buildRecentActivityRef(
  entryType: WalletLedgerEntryType,
  referenceType: string,
  referenceId: string,
  metadata: unknown,
): string {
  const meta =
    metadata && typeof metadata === 'object' && !Array.isArray(metadata)
      ? (metadata as Record<string, unknown>)
      : {}
  const short = referenceId
    .trim()
    .replace(/[^A-Za-z0-9-]/g, '')
    .slice(-8)
    .toUpperCase()

  switch (entryType) {
    case 'LEAD_UNLOCK_DEBIT':
    case 'LEAD_REFUND_CREDIT': {
      const category = typeof meta.jobCategory === 'string' ? meta.jobCategory : null
      return category ? `${category} · JOB-${short}` : `JOB-${short}`
    }
    case 'VOUCHER_REDEMPTION': {
      const campaign = typeof meta.campaignCode === 'string' ? meta.campaignCode : null
      return campaign ? `${campaign} · REF-${short}` : `REF-${short}`
    }
    case 'TOPUP_CREDIT':
      return referenceType === 'payment_intent' ? `PAT-${short}` : `PAP-${short}`
    case 'PROMO_CREDIT': {
      const awardType = typeof meta.awardType === 'string' ? meta.awardType : null
      return awardType === 'MOBILE_VERIFIED' ? 'Welcome allocation' : 'PROMO'
    }
    default:
      return `REF-${short}`
  }
}

function summarizeActivityRef(referenceType: string, referenceId: string) {
  const short = referenceId.trim().replace(/[^A-Za-z0-9-]/g, '').slice(-8).toUpperCase()
  switch (referenceType) {
    case 'lead':
    case 'lead_refund':
      return `JOB-${short}`
    case 'payment_intent':
      return `PAT-${short}`
    case 'manual_eft':
      return `PAP-${short}`
    case 'promo_campaign':
      return 'PROMO'
    default:
      return `REF-${short}`
  }
}

function normalizeWhenString(iso: string) {
  const now = new Date()
  const then = new Date(iso)
  const mins = Math.floor((now.getTime() - then.getTime()) / 60_000)
  if (Number.isNaN(mins) || mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h ago`
  return `${Math.floor(hours / 24)}d ago`
}

function traceId() {
  return `provider-wallet-topup-${randomUUID()}`
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

export async function getProviderWallet(): Promise<ProviderWallet> {
  const provider = await getAuthenticatedProvider()

  const [balance, pendingIntents, walletEntries] = await Promise.all([
    getProviderWalletBalance(provider.id),
    getProviderPendingIntents(),
    getProviderWalletLedgerEntries(provider.id, { limit: LEDGER_LIMIT }),
  ])

  return {
    credits: balance.totalCreditBalance,
    starter: balance.promoCreditBalance,
    pendingIntents,
    recentActivity: walletEntries.map((entry) => {
      const signedAmount = isDebit(entry.entryType) ? -entry.amountCredits : entry.amountCredits

      return {
        id: entry.id,
        title: summarizeActivityLabel(entry.entryType),
        ref: buildRecentActivityRef(entry.entryType, entry.referenceType, entry.referenceId, entry.metadata),
        when: normalizeWhenString(entry.createdAt.toISOString()),
        delta: signedAmount,
        entryType: entry.entryType,
      }
    }),
  }
}

export async function getProviderPendingIntents(): Promise<ProviderWalletPendingIntent[]> {
  const provider = await getAuthenticatedProvider()
  const pendingIntents = await db.paymentIntent.findMany({
    where: {
      providerId: provider.id,
      paymentMethod: 'PAYAT',
      status: { in: [...ACTIVE_PAYAT_STATUSES] },
    },
    select: {
      id: true,
      amountCents: true,
      creditsToIssue: true,
      paymentReference: true,
      status: true,
      createdAt: true,
      expiresAt: true,
      metadata: true,
    },
    orderBy: { createdAt: 'asc' },
  })

  return pendingIntents.map((intent) => ({
    id: intent.id,
    amountCents: intent.amountCents,
    creditsToIssue: intent.creditsToIssue,
    paymentReference: intent.paymentReference,
    status: intent.status,
    createdAt: intent.createdAt.toISOString(),
    expiresAt: intent.expiresAt?.toISOString() ?? null,
    paymentLink: readMetadataPaymentLink(intent.metadata),
  }))
}

export async function getPaymentIntentStatus(intentId: string): Promise<PaymentIntentStatusResult> {
  const startedAt = Date.now()
  const actor = await getAuthenticatedProvider().catch(() => null)
  if (!actor) {
    return {
      ok: false,
      code: 'FORBIDDEN',
      message: 'You are not authorized to view this payment intent.',
    }
  }

  const intent = await db.paymentIntent.findFirst({
    where: {
      id: intentId,
      providerId: actor.id,
    },
    select: {
      status: true,
      paidAt: true,
      creditedAt: true,
      amountCents: true,
      paymentReference: true,
      creditsToIssue: true,
      expiresAt: true,
      paymentMethod: true,
      metadata: true,
    },
  })

  if (!intent) {
    console.warn('[payat] intent_status_not_found', {
      providerId: actor.id,
      intentId,
      elapsedMs: Date.now() - startedAt,
    })
    return {
      ok: false,
      code: 'NOT_FOUND',
      message: 'Payment intent was not found.',
    }
  }

  if (intent.paymentMethod !== 'PAYAT') {
    console.warn('[payat] intent_status_unsupported', {
      providerId: actor.id,
      intentId,
      paymentMethod: intent.paymentMethod,
      elapsedMs: Date.now() - startedAt,
    })
    return {
      ok: false,
      code: 'UNSUPPORTED_INTENT',
      message: 'The selected intent is not a Pay@ top-up intent.',
    }
  }

  console.info('[payat] intent_status_read', {
    providerId: actor.id,
    intentId,
    status: intent.status,
    elapsedMs: Date.now() - startedAt,
  })

  return {
    ok: true,
    status: intent.status,
    creditsIssued: intent.status === 'CREDITED' ? intent.creditsToIssue : undefined,
      paidAt: asDateString(intent.paidAt),
      creditedAt: asDateString(intent.creditedAt),
      expiresAt: asDateString(intent.expiresAt),
      reference: intent.paymentReference,
      paymentLink: readMetadataPaymentLink(intent.metadata),
      amountCents: intent.amountCents,
      creditsToIssue: intent.creditsToIssue,
    }
}

export async function notifyProviderPayatTopUpInitiated(
  intentId: string,
): Promise<NotifyPayatTopUpResult> {
  const startedAt = Date.now()
  const actor = await getAuthenticatedProvider().catch(() => null)
  if (!actor) {
    return {
      ok: false,
      code: 'INVALID_STATUS',
      message: 'You are not authorized to notify this top-up intent.',
    }
  }

  const intent = await db.paymentIntent.findFirst({
    where: {
      id: intentId,
      providerId: actor.id,
    },
    select: {
      id: true,
      paymentMethod: true,
      status: true,
      metadata: true,
      amountCents: true,
    },
  })

  if (!intent) {
    return {
      ok: false,
      code: 'NOT_FOUND',
      message: 'Payment intent was not found.',
    }
  }

  if (intent.paymentMethod !== 'PAYAT') {
    return {
      ok: false,
      code: 'INVALID_STATUS',
      message: 'WhatsApp notifications are only available for Pay@ top-up links.',
    }
  }

  if (intent.status !== 'PENDING_PAYMENT') {
    return {
      ok: false,
      code: 'INVALID_STATUS',
      message: 'This top-up link is no longer in a pending state.',
    }
  }

  const paymentLink = readMetadataPaymentLink(intent.metadata)
  if (!paymentLink) {
    return {
      ok: false,
      code: 'MISSING_LINK',
      message: 'Payment link is not available yet for this intent.',
    }
  }

  const requestId = traceId()
  console.info('[payat] notify_intent_link_button', {
    requestId,
    providerId: actor.id,
    intentId,
    amountCents: intent.amountCents,
  })

  try {
    await notifyProviderPayatTopUpInitiatedCore(intentId, paymentLink)
    console.info('[payat] notify_intent_link_button_sent', {
      requestId,
      providerId: actor.id,
      intentId,
      elapsedMs: Date.now() - startedAt,
    })
    return { ok: true }
  } catch (error) {
    console.error('[payat] notify_intent_link_button_failed', {
      requestId,
      providerId: actor.id,
      intentId,
      elapsedMs: Date.now() - startedAt,
      error: error instanceof Error ? error.message : String(error),
    })
    return {
      ok: false,
      code: 'INVALID_STATUS',
      message: 'Could not send WhatsApp link at the moment.',
    }
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

// Re-exported for backward compat - earlier callers imported the types from here.
export type { PayatTopUpFailureCode, ProviderPayatTopUpResponse } from '@/lib/provider-credit-payment-intents'

export async function createProviderPayatTopUpIntent(
  amountCents: number,
): Promise<ProviderPayatTopUpResponse> {
  const startedAt = Date.now()
  const payatEnvironment = resolvePayatEnvironment()
  const packageId = payatPackageIdForAmount(amountCents)
  let providerId: string | null = null
  let walletId: string | null = null
  let intentId: string | undefined
  let internalReference: string | undefined
  try {
    const provider = await getAuthenticatedProvider()
    providerId = provider.id
    const wallet = await db.providerWallet.upsert({
      where: { providerId: provider.id },
      update: {},
      create: { providerId: provider.id },
      select: { id: true },
    })
    walletId = wallet.id
    const activeIntentCount = await db.paymentIntent.count({
      where: {
        providerId: provider.id,
        paymentMethod: 'PAYAT',
        status: { in: [...ACTIVE_PAYAT_STATUSES] },
      },
    })
    if (activeIntentCount >= 3) {
      console.warn('[payat] checkout_blocked: too_many_pending', {
        providerId: provider.id,
        walletId,
        packageId,
        amountCents,
        activeIntentCount,
        status: 'blocked',
        environment: payatEnvironment,
        elapsedMs: Date.now() - startedAt,
      })
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
    internalReference = result.intent.paymentReference
    await db.paymentIntent.update({
      where: { id: result.intent.id },
      data: {
        metadata: mergePayatDisplayMetadata(result.intent.metadata, result.payat),
      },
    })

    revalidatePath('/provider/credits')
    console.info('[payat] checkout_created', {
      providerId: provider.id,
      walletId,
      packageId,
      intentId,
      internalReference,
      amountCents,
      creditsToIssue: result.intent.creditsToIssue,
      payatReference: result.payat.reference,
      status: 'pending_payment',
      environment: payatEnvironment,
      elapsedMs: Date.now() - startedAt,
    })
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
      console.warn('[payat] checkout_blocked: payment_intent_error', {
        providerId,
        walletId,
        packageId,
        amountCents,
        code: err.code,
        message: err.message,
        status: 'blocked',
        environment: payatEnvironment,
        elapsedMs: Date.now() - startedAt,
      })
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
    const baseFailureLog = {
      providerId,
      walletId,
      packageId,
      amountCents,
      intentId,
      internalReference,
      status: 'failed',
      environment: payatEnvironment,
      elapsedMs: Date.now() - startedAt,
    }
    if (err instanceof PayatConfigError) {
      console.error('[payat] checkout_failed: config', {
        ...baseFailureLog,
        failureReason: err.name,
        code: 'PAYAT_CONFIG_MISSING',
        detail: err.message,
      })
      return {
        ok: false,
        code: 'PAYAT_CONFIG_MISSING' as const,
        userMessage: 'Pay@ is temporarily unavailable right now. Please try again shortly.',
      }
    }
    if (err instanceof PayatTokenError) {
      console.error('[payat] checkout_failed: token', {
        ...baseFailureLog,
        failureReason: err.name,
        code: 'PAYAT_TOKEN_FAILED',
        stage: err.stage,
        httpStatus: err.status ?? null,
        detail: err.message,
      })
      return {
        ok: false,
        code: 'PAYAT_TOKEN_FAILED' as const,
        userMessage: 'We could not reach Pay@ right now. Please try again in a minute.',
      }
    }
    if (err instanceof PayatApiError) {
      console.error('[payat] checkout_failed: api', {
        ...baseFailureLog,
        failureReason: err.name,
        code: 'PAYAT_API_FAILED',
        stage: err.stage,
        httpStatus: err.status ?? null,
        detail: err.message,
      })
      return {
        ok: false,
        code: 'PAYAT_API_FAILED' as const,
        userMessage: 'We couldn’t create your Pay@ reference. Please try again.',
      }
    }
    const message = err instanceof Error ? err.message : String(err)
    console.error('[payat] checkout_failed: unknown', {
      ...baseFailureLog,
      failureReason: 'UNKNOWN',
      error: message,
    })
    return {
      ok: false,
      code: 'UNKNOWN' as const,
      userMessage: 'We couldn’t create your Pay@ reference. Please try again.',
    }
  }
}

/**
 * Create a Payfast checkout intent for the authenticated provider.
 * The caller must POST the provider's browser to `result.checkout.action`
 * with `result.checkout.fields`.
 *
 * IMPORTANT: the Payfast return URL is UI-only - wallet crediting only
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

export type ProviderWalletTransactionDetail = {
  id: string
  occurredAt: string
  title: string
  description: string | null
  entryType: string
  creditType: string
  signedAmountCredits: number
  amountCredits: number
  balanceBeforePaidCredits: number | null
  balanceBeforePromoCredits: number | null
  balanceAfterPaidCredits: number
  balanceAfterPromoCredits: number
  referenceType: string
  displayRef: string
  source: string | null
  relatedJobCategory: string | null
  relatedJobTitle: string | null
  relatedJobRef: string | null
  relatedVoucherCampaign: string | null
  relatedVoucherBatchName: string | null
  relatedPaymentRef: string | null
}

function readMeta(metadata: unknown): Record<string, unknown> {
  return metadata && typeof metadata === 'object' && !Array.isArray(metadata)
    ? (metadata as Record<string, unknown>)
    : {}
}

function metaStr(meta: Record<string, unknown>, key: string): string | null {
  const v = meta[key]
  return typeof v === 'string' && v.trim().length > 0 ? v : null
}

function metaNum(meta: Record<string, unknown>, key: string): number | null {
  const v = meta[key]
  return typeof v === 'number' ? v : null
}

export async function getProviderWalletLedgerEntry(
  id: string,
): Promise<ProviderWalletTransactionDetail | null> {
  const provider = await getAuthenticatedProvider()
  const entry = await db.walletLedgerEntry.findFirst({
    where: { id, providerId: provider.id },
  })
  if (!entry) return null

  const meta = readMeta(entry.metadata)
  const debit = isDebit(entry.entryType)
  const short = entry.referenceId
    .replace(/[^A-Za-z0-9-]/g, '')
    .slice(-8)
    .toUpperCase()

  return {
    id: entry.id,
    occurredAt: entry.createdAt.toISOString(),
    title: ledgerLabel(entry.entryType),
    description: entry.description ?? null,
    entryType: entry.entryType,
    creditType: entry.creditType,
    signedAmountCredits: debit ? -entry.amountCredits : entry.amountCredits,
    amountCredits: entry.amountCredits,
    balanceBeforePaidCredits: metaNum(meta, 'balanceBeforePaidCredits'),
    balanceBeforePromoCredits: metaNum(meta, 'balanceBeforePromoCredits'),
    balanceAfterPaidCredits: entry.balanceAfterPaidCredits,
    balanceAfterPromoCredits: entry.balanceAfterPromoCredits,
    referenceType: entry.referenceType,
    displayRef: `REF-${short}`,
    source: entry.source ?? null,
    relatedJobCategory: metaStr(meta, 'jobCategory'),
    relatedJobTitle: metaStr(meta, 'jobTitle'),
    relatedJobRef: metaStr(meta, 'leadRef'),
    relatedVoucherCampaign: metaStr(meta, 'campaignCode'),
    relatedVoucherBatchName: metaStr(meta, 'batchName'),
    relatedPaymentRef: metaStr(meta, 'paymentReference') ?? metaStr(meta, 'payatReference'),
  }
}

export type ProviderWalletLedgerPageResult = {
  items: ProviderWalletRecentActivityItem[]
  nextCursor: string | null
}

const HISTORY_PAGE_SIZE = 25

const DEBIT_ENTRY_TYPES = [
  'LEAD_UNLOCK_DEBIT',
  'PROMO_EXPIRY',
  'PAYMENT_REVERSAL',
] as const

const CREDIT_ENTRY_TYPES = [
  'TOPUP_CREDIT',
  'PROMO_CREDIT',
  'VOUCHER_REDEMPTION',
  'LEAD_REFUND_CREDIT',
  'ADMIN_ADJUSTMENT',
] as const

export async function getProviderWalletLedgerPage(opts: {
  cursor?: string
  filter?: 'all' | 'added' | 'used'
}): Promise<ProviderWalletLedgerPageResult> {
  const provider = await getAuthenticatedProvider()

  const entryTypeFilter =
    opts.filter === 'added'
      ? { entryType: { in: [...CREDIT_ENTRY_TYPES] } }
      : opts.filter === 'used'
        ? { entryType: { in: [...DEBIT_ENTRY_TYPES] } }
        : {}

  const entries = await db.walletLedgerEntry.findMany({
    where: { providerId: provider.id, ...entryTypeFilter },
    orderBy: { createdAt: 'desc' },
    take: HISTORY_PAGE_SIZE + 1,
    ...(opts.cursor ? { cursor: { id: opts.cursor }, skip: 1 } : {}),
  })

  const hasMore = entries.length > HISTORY_PAGE_SIZE
  const page = hasMore ? entries.slice(0, HISTORY_PAGE_SIZE) : entries
  const nextCursor = hasMore ? (page[page.length - 1]?.id ?? null) : null

  const items: ProviderWalletRecentActivityItem[] = page.map((entry) => {
    const debit = isDebit(entry.entryType)
    const signedAmount = debit ? -entry.amountCredits : entry.amountCredits
    return {
      id: entry.id,
      title: summarizeActivityLabel(entry.entryType),
      ref: buildRecentActivityRef(entry.entryType, entry.referenceType, entry.referenceId, entry.metadata),
      when: normalizeWhenString(entry.createdAt.toISOString()),
      delta: signedAmount,
      entryType: entry.entryType,
    }
  })

  return { items, nextCursor }
}

export async function createProviderCreditTopUpIntentAction(formData: FormData) {
  return createProviderTopUpIntentFormAction(formData)
}
