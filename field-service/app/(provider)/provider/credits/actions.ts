'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { randomUUID } from 'crypto'
import { type KycStatus, type WalletCreditType, type WalletLedgerEntryType } from '@prisma/client'
import { db } from '@/lib/db'
import { requireProvider } from '@/lib/auth'
import {
  getProviderWalletBalance,
  getProviderWalletLedgerEntries,
} from '@/lib/provider-wallet'
import {
  createPayatTopUpIntent,
  createManualEftTopUpIntent,
  getManualEftBankAccountInstructions,
  logBlockedProviderCreditTopUpAttempt,
  ProviderCreditPaymentIntentError,
  type PayatTopUpFailureCode,
  type ProviderPayatTopUpResponse,
} from '@/lib/provider-credit-payment-intents'
import { PayatConfigError, PayatApiError, PayatTokenError } from '@/lib/payat'
import { notifyProviderPayatTopUpInitiated as notifyProviderPayatTopUpInitiatedCore } from '@/lib/provider-wallet-notifications'
import { issueProviderIdentityVerificationLink } from '@/lib/identity-verification/link'
import { isProviderEligibleForCredits } from '@/lib/identity-verification/credit-gate'
import {
  providerCreditGateStatus,
  providerIdentityVerificationStatus,
  type ProviderCreditGateStatus,
  type ProviderIdentityVerificationStatus,
} from '@/lib/provider-identity-status'

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
  userId: string
  phone: string | null
  kycStatus: KycStatus
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
  /**
   * True when the provider is not eligible for paid credit purchases.
   * The wallet balance remains visible, but payment creation and active
   * payment-link surfaces stay locked until verification is complete.
   */
  creditPurchaseLocked: boolean
  identityVerificationStatus: ProviderIdentityVerificationStatus
  creditGateStatus: ProviderCreditGateStatus
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
  sourceReference: string | null
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
      sourceReference: string | null
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
      code: 'NOT_FOUND' | 'INVALID_STATUS' | 'MISSING_LINK' | 'FORBIDDEN' | 'NOTIFY_FAILED'
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
    select: { id: true, phone: true, kycStatus: true },
  })

  if (!provider) {
    throw new Error('Provider account not found.')
  }

  // Some legacy provider records still have null phone values while the current
  // auth session includes a normalized E.164 phone. Prefer the provider row,
  // then fall back to the authenticated session to keep Pay@ creation reliable.
  return {
    id: provider.id,
    userId: session.id,
    phone: provider.phone ?? session.phone ?? null,
    kycStatus: provider.kycStatus,
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
      return 'Credit adjustment'
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
    case 'WALLET_SUSPENDED':
      return 'Wallet suspended'
    case 'WALLET_REACTIVATED':
      return 'Wallet reactivated'
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

// Ledger entry types whose `description` is built from raw admin-supplied reason
// text (fraud notes, complaint detail, internal workflow notes, PII). These must
// NOT be surfaced to the provider - we show a generic provider-safe title instead.
const ADMIN_REASON_ENTRY_TYPES = new Set<WalletLedgerEntryType>([
  'ADMIN_ADJUSTMENT',
  'WALLET_SUSPENDED',
  'WALLET_REACTIVATED',
])

// Returns a provider-safe description for a ledger entry. For admin-originated
// entries we deliberately drop the internal `description` (which may contain
// internal rationale/PII) and return a neutral label.
function providerSafeLedgerDescription(
  entryType: WalletLedgerEntryType,
  description: string | null,
): string | null {
  if (ADMIN_REASON_ENTRY_TYPES.has(entryType)) {
    return ledgerLabel(entryType)
  }
  return description ?? null
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

  const [balance, walletEntries, eligible] = await Promise.all([
    getProviderWalletBalance(provider.id),
    getProviderWalletLedgerEntries(provider.id, { limit: LEDGER_LIMIT }),
    isProviderEligibleForCredits(provider.id),
  ])
  const creditPurchaseLocked = !eligible
  const identityVerificationStatus = providerIdentityVerificationStatus(provider.kycStatus)
  // `provider` is already authenticated here and eligibility was just resolved
  // above, so we use the private helper directly (no second eligibility round-trip
  // and, critically, no caller-supplied providerId — see finding 138058c2).
  const pendingIntents = creditPurchaseLocked
    ? []
    : await loadProviderPendingIntents({ actor: provider, checkEligibility: false })

  return {
    credits: balance.totalCreditBalance,
    starter: balance.promoCreditBalance,
    pendingIntents,
    creditPurchaseLocked,
    identityVerificationStatus,
    creditGateStatus: providerCreditGateStatus(identityVerificationStatus, creditPurchaseLocked),
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

export async function getProviderCreditPurchaseGate(): Promise<Pick<
  ProviderWallet,
  'creditPurchaseLocked' | 'identityVerificationStatus' | 'creditGateStatus'
>> {
  const provider = await getAuthenticatedProvider()
  const eligible = await isProviderEligibleForCredits(provider.id)
  const creditPurchaseLocked = !eligible
  const identityVerificationStatus = providerIdentityVerificationStatus(provider.kycStatus)

  return {
    creditPurchaseLocked,
    identityVerificationStatus,
    creditGateStatus: providerCreditGateStatus(identityVerificationStatus, creditPurchaseLocked),
  }
}

// SECURITY (finding 138058c2): the EXPORTED server action must always resolve the
// provider from the authenticated session. It previously accepted an optional
// caller-supplied `providerId` and, when present, skipped authentication and
// ownership checks — an IDOR that let any caller read another provider's pending
// Pay@ payment references, amounts, expiry times and payment links. The internal
// `getProviderWallet` optimisation (which already authenticated and just wanted to
// avoid a second auth round-trip) now uses the PRIVATE helper below with an actor
// it has already authenticated; the public action never trusts a caller-supplied
// ID.
export async function getProviderPendingIntents(): Promise<ProviderWalletPendingIntent[]> {
  const actor = await getAuthenticatedProvider()
  return loadProviderPendingIntents({ actor, checkEligibility: true })
}

// Private helper. Callers MUST pass an already-authenticated actor; this function
// never accepts an untrusted providerId from the client.
async function loadProviderPendingIntents(params: {
  actor: ProviderWalletActor
  checkEligibility: boolean
}): Promise<ProviderWalletPendingIntent[]> {
  const { actor, checkEligibility } = params

  if (checkEligibility && !(await isProviderEligibleForCredits(actor.id))) {
    logBlockedProviderCreditTopUpAttempt({
      providerId: actor.id,
      userId: actor.userId,
      verificationStatus: actor.kycStatus,
      attemptedAction: 'provider_payat_pending_links_read',
    })
    return []
  }

  const pendingIntents = await db.paymentIntent.findMany({
    where: {
      providerId: actor.id,
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
      sourceReference: true,
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
    sourceReference: intent.sourceReference ?? null,
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
      sourceReference: true,
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

  if (!(await isProviderEligibleForCredits(actor.id))) {
    logBlockedProviderCreditTopUpAttempt({
      providerId: actor.id,
      userId: actor.userId,
      verificationStatus: actor.kycStatus,
      attemptedAction: 'provider_payat_payment_instructions_read',
    })
    return {
      ok: false,
      code: 'FORBIDDEN',
      message: 'Top-ups are available after your identity has been verified.',
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
    sourceReference: intent.sourceReference ?? null,
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
      code: 'FORBIDDEN',
      message: 'You are not authorized to notify this top-up intent.',
    }
  }

  if (!(await isProviderEligibleForCredits(actor.id))) {
    logBlockedProviderCreditTopUpAttempt({
      providerId: actor.id,
      userId: actor.userId,
      verificationStatus: actor.kycStatus,
      attemptedAction: 'provider_payat_link_whatsapp_send',
    })
    return {
      ok: false,
      code: 'FORBIDDEN',
      message: 'Top-ups are available after your identity has been verified.',
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
      code: 'NOTIFY_FAILED',
      message: 'Could not send WhatsApp link at the moment.',
    }
  }
}

type CancelPayatTopUpResult =
  | { ok: true }
  | { ok: false; code: 'FORBIDDEN' | 'NOT_CANCELLABLE'; message: string }

export async function cancelProviderPayatTopUpIntent(
  intentId: string,
): Promise<CancelPayatTopUpResult> {
  const actor = await getAuthenticatedProvider().catch(() => null)
  if (!actor) {
    return { ok: false, code: 'FORBIDDEN', message: 'Not authorized.' }
  }

  const cancelled = await db.$transaction(async (tx) => {
    // Read metadata first only so we can preserve it; the authoritative state
    // transition below is an atomic updateMany guarded by the full predicate set.
    const intent = await tx.paymentIntent.findFirst({
      where: {
        id: intentId,
        providerId: actor.id,
        paymentMethod: 'PAYAT',
        status: 'PENDING_PAYMENT',
        creditedAt: null,
      },
      select: { metadata: true },
    })
    if (!intent) return false

    const existingMeta =
      typeof intent.metadata === 'object' &&
      intent.metadata !== null &&
      !Array.isArray(intent.metadata)
        ? (intent.metadata as Record<string, unknown>)
        : {}

    // Atomic, predicate-guarded transition. A concurrent Pay@ webhook may move
    // this intent to ITN_RECEIVED / CREDITED / FAILED between the read above and
    // this write. Constraining the WHERE to PENDING_PAYMENT + creditedAt:null
    // ensures count===0 (failure) instead of overwriting a newer terminal state
    // back to CANCELLED - which, since CANCELLED is gateway-creditable, could
    // otherwise reopen a reversed/failed intent for crediting.
    const updated = await tx.paymentIntent.updateMany({
      where: {
        id: intentId,
        providerId: actor.id,
        paymentMethod: 'PAYAT',
        status: 'PENDING_PAYMENT',
        creditedAt: null,
      },
      data: {
        status: 'CANCELLED',
        metadata: {
          ...existingMeta,
          cancelledAt: new Date().toISOString(),
          cancelledBy: 'provider',
        },
      },
    })

    return updated.count === 1
  })

  if (!cancelled) {
    return {
      ok: false,
      code: 'NOT_CANCELLABLE',
      message: 'This link cannot be cancelled - it may have already been paid, expired or cancelled.',
    }
  }

  revalidatePath('/provider/credits')
  revalidatePath('/provider/credits/pending')

  console.info('[payat] intent_cancelled_by_provider', {
    providerId: actor.id,
    intentId,
  })

  return { ok: true }
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

  if (!(await isProviderEligibleForCredits(provider.id))) {
    logBlockedProviderCreditTopUpAttempt({
      providerId: provider.id,
      userId: provider.userId,
      verificationStatus: provider.kycStatus,
      attemptedAction: 'manual_eft_top_up_instructions_read',
    })
    return null
  }

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
    actorUserId: provider.userId,
  })

  revalidatePath('/provider/credits')
  return serializeTopUpInstructions(result)
}

export type ProviderPayatTopUpResult = {
  intentId: string
  amountCents: number
  creditsToIssue: number
  reference: string
  paymentLink: string
}

async function issueCreditVerificationUrl(providerId: string | null): Promise<string | null> {
  if (!providerId) return null
  try {
    const link = await issueProviderIdentityVerificationLink({
      providerId,
      channel: 'PWA',
      purpose: 'CREDIT_TOP_UP',
    })
    return link.verificationUrl
  } catch (error) {
    console.error('[provider/credits] identity verification link issue failed', {
      providerId,
      error: error instanceof Error ? error.message : String(error),
    })
    return null
  }
}

/** Public action: issue a verification link URL for the authenticated provider.
 *  Called by the "Verify my ID" button on the credits page when top-ups are locked.
 *  Returns { url } on success or { url: null } if link issuance fails (caller toasts). */
export async function requestCreditVerificationUrl(): Promise<{ url: string | null }> {
  const provider = await getAuthenticatedProvider()
  const url = await issueCreditVerificationUrl(provider.id)
  return { url }
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
    if (!(await isProviderEligibleForCredits(provider.id))) {
      logBlockedProviderCreditTopUpAttempt({
        providerId: provider.id,
        userId: provider.userId,
        verificationStatus: provider.kycStatus,
        attemptedAction: 'payat_top_up_intent_create',
      })
      throw new ProviderCreditPaymentIntentError(
        'IDENTITY_NOT_VERIFIED',
        'Top-ups are available after your identity has been verified.',
      )
    }

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
      actorUserId: provider.userId,
    })
    intentId = result.intent.id
    internalReference = result.intent.paymentReference

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
        sourceReference: result.payat.sourceReference,
        requestToPayId: result.payat.requestToPayId,
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
            userMessage: "You already have a pending Pay@ top-up for this amount. Open it from your active payments or wait for it to expire.",
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
        case 'PROVIDER_PHONE_MISSING':
          return {
            ok: false,
            code: 'PROVIDER_PHONE_MISSING',
            userMessage: 'Your provider profile is missing a mobile number. Please update your profile and try again.',
          }
        case 'IDENTITY_NOT_VERIFIED':
          return {
            ok: false,
            code: 'IDENTITY_NOT_VERIFIED',
            userMessage: 'Identity verification is required before purchasing credits. Verify your identity first.',
            verificationUrl: await issueCreditVerificationUrl(providerId),
          }
        case 'REFERENCE_GENERATION_FAILED':
          return {
            ok: false,
            code: 'REFERENCE_GENERATION_FAILED',
            userMessage: 'Could not generate a payment reference. Please try again.',
          }
        default:
          console.error('[payat] checkout_blocked: unclassified_intent_error', {
            providerId,
            walletId,
            packageId,
            amountCents,
            code: err.code,
            status: 'blocked',
            environment: payatEnvironment,
            elapsedMs: Date.now() - startedAt,
          })
          return {
            ok: false,
            code: 'UNKNOWN' as const,
            userMessage: "We couldn't create your Pay@ reference. Please try again.",
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

export async function createProviderTopUpIntentFormAction(formData: FormData) {
  const rawAmountCents = formData.get('amountCents')
  const amountCents = typeof rawAmountCents === 'string'
    ? Number.parseInt(rawAmountCents, 10)
    : Number.NaN

  let intentId: string
  try {
    const instructions = await createProviderTopUpIntent(amountCents)
    intentId = instructions.intentId
  } catch (error) {
    if (error instanceof ProviderCreditPaymentIntentError && error.code === 'IDENTITY_NOT_VERIFIED') {
      redirect('/provider/credits?error=identity_not_verified')
    }
    console.error('[credits] top-up intent creation failed', {
      error: error instanceof ProviderCreditPaymentIntentError ? error.code : error instanceof Error ? error.message : String(error),
    })
    redirect('/provider/credits?error=topup_failed')
  }

  redirect(`/provider/credits?intent=${encodeURIComponent(intentId!)}`)
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
    description: providerSafeLedgerDescription(entry.entryType, entry.description),
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
