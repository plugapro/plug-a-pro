import { randomBytes, randomInt } from 'crypto'
import { KycStatus, Prisma, ProviderStatus, type PaymentIntent } from '@prisma/client'
import { db } from './db'
import {
  IdentityCreditGateError,
  type IdentityVerificationLookupClient,
  assertIdentityVerifiedForCredits as assertHighAssuranceIdentityVerifiedForCredits,
  providerCreditProfileBlockReason,
} from './identity-verification/credit-gate'
import { PLUG_A_PRO_CREDIT_VALUE_CENTS } from './provider-wallet'
import {
  buildCheckoutPayload,
  getPayfastConfig,
  type PayfastCheckoutPayload,
} from './payfast'
import {
  createPayatPaymentRequest,
  PAYAT_ALLOWED_AMOUNTS_CENTS,
  type PayatPaymentResponse,
} from './payat'

export const MIN_PROVIDER_CREDIT_TOPUP_CENTS = 10_000
export const MANUAL_EFT_REFERENCE_ATTEMPTS = 10

// ─── Gateway-allowed top-up package amounts ───────────────────────────────────
// Pay@, Payfast and manual EFT all restrict to the approved R100/R200/R500 packages.
export const PAYFAST_ALLOWED_AMOUNTS_CENTS = new Set([10_000, 20_000, 50_000])
export const MANUAL_EFT_ALLOWED_AMOUNTS_CENTS = new Set([10_000, 20_000, 50_000])

type PaymentIntentErrorCode =
  | 'INVALID_AMOUNT'
  | 'PROVIDER_NOT_FOUND'
  | 'PROVIDER_PHONE_MISSING'
  | 'REFERENCE_GENERATION_FAILED'
  | 'DUPLICATE_INTENT'
  | 'IDENTITY_NOT_VERIFIED'

export class ProviderCreditPaymentIntentError extends Error {
  constructor(
    public readonly code: PaymentIntentErrorCode,
    message: string,
  ) {
    super(message)
    this.name = 'ProviderCreditPaymentIntentError'
  }
}

export type ManualEftBankAccountInstructions = {
  accountName: string
  bankName: string
  accountNumber: string
  branchCode: string
  accountType: string
}

export type ManualEftTopUpInstructions = {
  amountCents: number
  amountFormatted: string
  currency: string
  creditsToIssue: number
  paymentReference: string
  expiresAt: Date | null
  bankAccount: ManualEftBankAccountInstructions
}

export type CreateManualEftTopUpIntentInput = {
  providerId: string
  amountCents: number
  providerCellphone?: string | null
  actorUserId?: string | null
  metadata?: Record<string, unknown>
  now?: Date
  referenceGenerator?: () => string
}

export type CreateManualEftTopUpIntentResult = {
  intent: PaymentIntent
  instructions: ManualEftTopUpInstructions
}

type PaymentIntentTx = Prisma.TransactionClient

function assertValidTopUpAmount(amountCents: number) {
  if (!Number.isInteger(amountCents)) {
    throw new ProviderCreditPaymentIntentError(
      'INVALID_AMOUNT',
      'Top-up amount must be provided in whole cents.',
    )
  }

  if (amountCents < MIN_PROVIDER_CREDIT_TOPUP_CENTS) {
    throw new ProviderCreditPaymentIntentError(
      'INVALID_AMOUNT',
      'Minimum provider credits top-up is R100.',
    )
  }

  if (amountCents % PLUG_A_PRO_CREDIT_VALUE_CENTS !== 0) {
    throw new ProviderCreditPaymentIntentError(
      'INVALID_AMOUNT',
      'Top-up amount must convert cleanly into whole Plug A Pro provider credits.',
    )
  }
}

function creditsForAmount(amountCents: number) {
  assertValidTopUpAmount(amountCents)
  return amountCents / PLUG_A_PRO_CREDIT_VALUE_CENTS
}

type PaidTopUpProvider = {
  id: string
  active: boolean
  verified: boolean
  status: ProviderStatus
  kycStatus: KycStatus
  suspendedUntil: Date | null
}

type BlockedTopUpLogInput = {
  providerId: string | null
  userId?: string | null
  verificationStatus?: KycStatus | string | null
  providerStatus?: ProviderStatus | string | null
  attemptedAction: string
}

export function logBlockedProviderCreditTopUpAttempt(input: BlockedTopUpLogInput) {
  console.warn('[provider-wallet] topup_blocked_identity_not_verified', {
    provider_id: input.providerId,
    user_id: input.userId ?? null,
    verification_status: input.verificationStatus ?? null,
    provider_status: input.providerStatus ?? null,
    attempted_action: input.attemptedAction,
    timestamp: new Date().toISOString(),
  })
}

async function assertProviderVerifiedForPaidTopUp(
  provider: PaidTopUpProvider,
  client: IdentityVerificationLookupClient = db,
  opts: { actorUserId?: string | null; attemptedAction: string },
) {
  const profileBlockReason = providerCreditProfileBlockReason(provider)
  if (profileBlockReason) {
    logBlockedProviderCreditTopUpAttempt({
      providerId: provider.id,
      userId: opts.actorUserId,
      verificationStatus: provider.kycStatus,
      providerStatus: provider.status,
      attemptedAction: opts.attemptedAction,
    })
    throw new ProviderCreditPaymentIntentError(
      'IDENTITY_NOT_VERIFIED',
      `Identity verification is required before creating a paid top-up. Reason: ${profileBlockReason}.`,
    )
  }
  try {
    await assertHighAssuranceIdentityVerifiedForCredits(provider.id, client)
  } catch (err) {
    if (err instanceof IdentityCreditGateError) {
      logBlockedProviderCreditTopUpAttempt({
        providerId: provider.id,
        userId: opts.actorUserId,
        verificationStatus: provider.kycStatus,
        providerStatus: provider.status,
        attemptedAction: opts.attemptedAction,
      })
      throw new ProviderCreditPaymentIntentError(
        'IDENTITY_NOT_VERIFIED',
        err.message,
      )
    }
    throw err
  }
}

export async function assertIdentityVerifiedForCredits(providerId: string): Promise<{ id: string }> {
  const provider = await db.provider.findUnique({
    where: { id: providerId },
    select: {
      id: true,
      active: true,
      verified: true,
      status: true,
      kycStatus: true,
      suspendedUntil: true,
    },
  })
  if (!provider) {
    throw new ProviderCreditPaymentIntentError(
      'PROVIDER_NOT_FOUND',
      'Provider account not found.',
    )
  }
  await assertProviderVerifiedForPaidTopUp(provider, db, {
    actorUserId: null,
    attemptedAction: 'credit_top_up_identity_assertion',
  })
  return { id: provider.id }
}

function toJson(metadata: CreateManualEftTopUpIntentInput['metadata']): Prisma.InputJsonValue {
  // Prisma JSON inputs cannot contain undefined values; serializing keeps
  // payment intent metadata deterministic and safe for later admin review.
  return JSON.parse(JSON.stringify(metadata ?? {})) as Prisma.InputJsonValue
}

function formatZar(amountCents: number) {
  return new Intl.NumberFormat('en-ZA', {
    style: 'currency',
    currency: 'ZAR',
  }).format(amountCents / 100)
}

function requireEnv(name: string) {
  const value = process.env[name]?.trim()
  if (!value) {
    throw new Error(`Missing required manual EFT bank account configuration: ${name}`)
  }
  return value
}

export function getManualEftBankAccountInstructions(): ManualEftBankAccountInstructions {
  return {
    accountName: requireEnv('PROVIDER_CREDIT_EFT_ACCOUNT_NAME'),
    bankName: requireEnv('PROVIDER_CREDIT_EFT_BANK_NAME'),
    accountNumber: requireEnv('PROVIDER_CREDIT_EFT_ACCOUNT_NUMBER'),
    branchCode: requireEnv('PROVIDER_CREDIT_EFT_BRANCH_CODE'),
    accountType: requireEnv('PROVIDER_CREDIT_EFT_ACCOUNT_TYPE'),
  }
}

function getManualEftExpiresAt(now: Date) {
  const rawDays = process.env.PROVIDER_CREDIT_EFT_INTENT_EXPIRY_DAYS ?? '7'
  const expiryDays = Number.parseInt(rawDays, 10)
  if (!Number.isFinite(expiryDays) || expiryDays <= 0) return null

  const expiresAt = new Date(now)
  expiresAt.setDate(expiresAt.getDate() + expiryDays)
  return expiresAt
}

// Payfast hosted-checkout sessions are short-lived (~30min). Default to 2 hours
// so a provider who paused mid-checkout still has time to return; after that,
// the cron at /api/cron/expire-payment-intents flips the intent to EXPIRED and
// the duplicate-intent guard stops blocking new attempts.
function getPayfastExpiresAt(now: Date) {
  const rawHours = process.env.PROVIDER_CREDIT_PAYFAST_INTENT_EXPIRY_HOURS ?? '2'
  const expiryHours = Number.parseFloat(rawHours)
  if (!Number.isFinite(expiryHours) || expiryHours <= 0) return null

  return new Date(now.getTime() + expiryHours * 60 * 60 * 1000)
}

export function generateManualEftPaymentReference() {
  const numericPart = randomInt(1_000, 10_000)
  const suffix = randomBytes(2).toString('hex').toUpperCase()
  return `PAP-${numericPart}-${suffix}`
}

async function createUniquePaymentReference(
  tx: PaymentIntentTx,
  referenceGenerator: () => string,
) {
  // Bank deposits are matched primarily by reference, so avoid collisions before
  // insert and still rely on the database unique index as the final guarantee.
  for (let attempt = 0; attempt < MANUAL_EFT_REFERENCE_ATTEMPTS; attempt += 1) {
    const paymentReference = referenceGenerator()
    const existing = await tx.paymentIntent.findUnique({
      where: { paymentReference },
      select: { id: true },
    })
    if (!existing) return paymentReference
  }

  throw new ProviderCreditPaymentIntentError(
    'REFERENCE_GENERATION_FAILED',
    'Could not generate a unique payment reference.',
  )
}

function buildManualEftInstructions(
  intent: PaymentIntent,
  bankAccount = getManualEftBankAccountInstructions(),
): ManualEftTopUpInstructions {
  return {
    amountCents: intent.amountCents,
    amountFormatted: formatZar(intent.amountCents),
    currency: intent.currency,
    creditsToIssue: intent.creditsToIssue,
    paymentReference: intent.paymentReference,
    expiresAt: intent.expiresAt,
    bankAccount,
  }
}

export async function createManualEftTopUpIntent(
  input: CreateManualEftTopUpIntentInput,
): Promise<CreateManualEftTopUpIntentResult> {
  if (!MANUAL_EFT_ALLOWED_AMOUNTS_CENTS.has(input.amountCents)) {
    throw new ProviderCreditPaymentIntentError(
      'INVALID_AMOUNT',
      'Top-up amount must be one of the approved credits packages: R100, R200 or R500.',
    )
  }

  const creditsToIssue = creditsForAmount(input.amountCents)
  const referenceGenerator = input.referenceGenerator ?? generateManualEftPaymentReference
  const now = input.now ?? new Date()
  const bankAccount = getManualEftBankAccountInstructions()

  const result = await db.$transaction(async (tx) => {
    const provider = await tx.provider.findUnique({
      where: { id: input.providerId },
      select: {
        id: true,
        phone: true,
        active: true,
        verified: true,
        status: true,
        kycStatus: true,
        suspendedUntil: true,
      },
    })

    if (!provider) {
      throw new ProviderCreditPaymentIntentError(
        'PROVIDER_NOT_FOUND',
        'Provider account not found.',
      )
    }
    await assertProviderVerifiedForPaidTopUp(provider, tx, {
      actorUserId: input.actorUserId,
      attemptedAction: 'manual_eft_top_up_intent_create',
    })

    const paymentReference = await createUniquePaymentReference(tx, referenceGenerator)

    // Creating an intent only records an expected payment. Admin reconciliation
    // is responsible for confirming funds and crediting the provider wallet.
    const intent = await tx.paymentIntent.create({
      data: {
        providerId: provider.id,
        amountCents: input.amountCents,
        currency: 'ZAR',
        creditsToIssue,
        paymentMethod: 'MANUAL_EFT',
        paymentReference,
        status: 'PENDING_PAYMENT',
        providerCellphone: input.providerCellphone ?? provider.phone,
        expiresAt: getManualEftExpiresAt(now),
        metadata: toJson(input.metadata),
      },
    })

    return {
      intent,
      instructions: buildManualEftInstructions(intent, bankAccount),
    }
  })

  const { notifyProviderPaymentIntentCreated } = await import('./provider-wallet-notifications')
  notifyProviderPaymentIntentCreated(result.intent.id).catch((error: unknown) => {
    console.error('[provider-credit-payment-intents] payment intent WhatsApp notification failed', {
      paymentIntentId: result.intent.id,
      error,
    })
  })

  return result
}

// ─── Payfast checkout intent ───────────────────────────────────────────────────

// Discriminated-union failure shape for the Pay@ checkout server action.
// Co-located here so any future caller (e.g. WhatsApp top-up flow) can import
// the same vocabulary instead of redeclaring it in app/(provider)/.../actions.ts.
export type PayatTopUpFailureCode =
  | 'DUPLICATE_INTENT'
  | 'TOO_MANY_PENDING'
  | 'INVALID_AMOUNT'
  | 'PROVIDER_NOT_FOUND'
  | 'PROVIDER_PHONE_MISSING'
  | 'IDENTITY_NOT_VERIFIED'
  | 'REFERENCE_GENERATION_FAILED'
  | 'PAYAT_TOKEN_FAILED'
  | 'PAYAT_API_FAILED'
  | 'PAYAT_CONFIG_MISSING'
  | 'UNKNOWN'

export type PayatTopUpResultData = {
  intentId: string
  amountCents: number
  creditsToIssue: number
  reference: string
  paymentLink: string
  sourceReference?: string | null
  requestToPayId?: number | null
}

export type ProviderPayatTopUpResponse =
  | { ok: true; data: PayatTopUpResultData }
  | { ok: false; code: PayatTopUpFailureCode; userMessage: string; verificationUrl?: string | null }

export type PayfastTopUpMethod = 'PAYFAST_CARD' | 'PAYFAST_EFT' | 'PAYFAST_SCODE'

export type CreatePayfastTopUpIntentInput = {
  providerId: string
  amountCents: number
  paymentMethod?: PayfastTopUpMethod
  providerName?: string | null
  providerEmail?: string | null
  providerCellphone?: string | null
  actorUserId?: string | null
  metadata?: Record<string, unknown>
  /** Injectable for deterministic tests. Defaults to `new Date()`. */
  now?: Date
}

export type CreatePayfastTopUpIntentResult = {
  intent: PaymentIntent
  checkout: PayfastCheckoutPayload
}

export type CreatePayatTopUpIntentInput = {
  providerId: string
  amountCents: number
  /** Counter service fee to add on top of the credit amount for the Pay@ barcode. */
  feeAmountCents?: number
  providerCellphone?: string | null
  actorUserId?: string | null
  metadata?: Record<string, unknown>
  /** Injectable clock for deterministic tests. Defaults to `new Date()`. */
  now?: Date
}

export type CreatePayatTopUpIntentResult = {
  intent: PaymentIntent
  payat: PayatPaymentResponse
  /** Total amount the provider must pay at the counter (amountCents + feeAmountCents). */
  payAtAmountCents: number
}

// ─── Pay@ payment request intent ─────────────────────────────────────────────

export async function createPayatTopUpIntent(
  input: CreatePayatTopUpIntentInput,
): Promise<CreatePayatTopUpIntentResult> {
  const traceId = randomBytes(4).toString('hex')

  console.info(JSON.stringify({
    event: 'payat.intent_create_start',
    traceId,
    providerId: input.providerId,
    amountCents: input.amountCents,
    feeAmountCents: input.feeAmountCents ?? 0,
    hasCellphoneFallback: Boolean(input.providerCellphone?.trim()),
  }))

  if (!PAYAT_ALLOWED_AMOUNTS_CENTS.has(input.amountCents)) {
    console.warn(JSON.stringify({
      event: 'payat.intent_create_blocked',
      traceId,
      reason: 'INVALID_AMOUNT',
      amountCents: input.amountCents,
    }))
    throw new ProviderCreditPaymentIntentError(
      'INVALID_AMOUNT',
      'Top-up amount must be one of the approved credits packages: R100, R200 or R500.',
    )
  }

  const creditsToIssue = creditsForAmount(input.amountCents)
  // payAtAmountCents is what the provider pays at the counter - credit value plus
  // any service fee that Plug A Pro passes through to cover gateway costs.
  // NOTE: PAYAT_MERCHANT_FEE_FIXED_CENTS exists in env but is not yet read here;
  // callers must pass feeAmountCents explicitly until fee auto-wiring is added.
  const payAtAmountCents = input.amountCents + (input.feeAmountCents ?? 0)

  const { intent, provider, resolvedPhone } = await db.$transaction(async (tx) => {
    const provider = await tx.provider.findUnique({
      where: { id: input.providerId },
      select: {
        id: true,
        phone: true,
        name: true,
        email: true,
        active: true,
        verified: true,
        status: true,
        kycStatus: true,
        suspendedUntil: true,
      },
    })

    if (!provider) {
      console.warn(JSON.stringify({
        event: 'payat.intent_create_blocked',
        traceId,
        reason: 'PROVIDER_NOT_FOUND',
        providerId: input.providerId,
      }))
      throw new ProviderCreditPaymentIntentError(
        'PROVIDER_NOT_FOUND',
        'Provider account not found.',
      )
    }
    await assertProviderVerifiedForPaidTopUp(provider, tx, {
      actorUserId: input.actorUserId,
      attemptedAction: 'payat_top_up_intent_create',
    })

    console.info(JSON.stringify({
      event: 'payat.provider_resolved',
      traceId,
      providerId: provider.id,
      hasPhone: Boolean(provider.phone?.trim()),
      hasEmail: Boolean(provider.email?.trim()),
      phoneSource: provider.phone?.trim() ? 'profile' : input.providerCellphone?.trim() ? 'caller' : 'none',
    }))

    // Pay@ requires a non-empty mobile number for the RTP request (used as
    // notificationNumber and customerMobileNumber). Validate before creating the
    // intent so the duplicate-intent guard is not triggered on a request that
    // would fail at the gateway anyway.
    const resolvedPhone = provider.phone?.trim() || input.providerCellphone?.trim() || ''
    if (!resolvedPhone) {
      console.warn(JSON.stringify({
        event: 'payat.intent_create_blocked',
        traceId,
        reason: 'PROVIDER_PHONE_MISSING',
        providerId: provider.id,
      }))
      throw new ProviderCreditPaymentIntentError(
        'PROVIDER_PHONE_MISSING',
        'A mobile number is required on your provider profile to create a Pay@ payment link.',
      )
    }

    // H-4: Prevent duplicate active Pay@ intents for the same provider+amount.
    // A provider clicking "pay" multiple times must not create concurrent RTP links.
    const existingIntent = await tx.paymentIntent.findFirst({
      where: {
        providerId: input.providerId,
        amountCents: input.amountCents,
        paymentMethod: 'PAYAT',
        status: 'PENDING_PAYMENT',
        expiresAt: { gt: new Date() },
      },
      select: { id: true },
    })
    if (existingIntent) {
      console.warn(JSON.stringify({
        event: 'payat.intent_create_blocked',
        traceId,
        reason: 'DUPLICATE_INTENT',
        existingIntentId: existingIntent.id,
        providerId: provider.id,
        amountCents: input.amountCents,
      }))
      throw new ProviderCreditPaymentIntentError(
        'DUPLICATE_INTENT',
        'A pending Pay@ top-up for this amount is already active.',
      )
    }

    const paymentReference = await createUniquePaymentReference(
      tx,
      () => `PAT-${randomBytes(6).toString('hex').toUpperCase()}`,
    )

    // H-2: expiresAt matches the Pay@ RTP daysValid:1 so the intent does not
    // stay PENDING_PAYMENT indefinitely after the payment link expires.
    const payatExpiresAt = new Date((input.now ?? new Date()).getTime() + 24 * 60 * 60 * 1000)

    // The PaymentIntent is created before Pay@ is called so webhook references
    // can use the immutable intent ID and remain idempotent under retries.
    // payAtAmountCents is stored in metadata so the webhook can compare the
    // fee-inclusive amount (what Pay@ will report) instead of the credit amount.
    const intent = await tx.paymentIntent.create({
      data: {
        providerId: provider.id,
        amountCents: input.amountCents,
        currency: 'ZAR',
        creditsToIssue,
        paymentMethod: 'PAYAT',
        paymentReference,
        status: 'PENDING_PAYMENT',
        providerCellphone: resolvedPhone,
        expiresAt: payatExpiresAt,
        metadata: toJson({ ...(input.metadata ?? {}), payAtAmountCents }),
      },
    })

    console.info(JSON.stringify({
      event: 'payat.intent_db_created',
      traceId,
      intentId: intent.id,
      providerId: provider.id,
      amountCents: input.amountCents,
      payAtAmountCents,
      creditsToIssue,
    }))

    return { intent, provider, resolvedPhone }
  })

  // C-2: If the Pay@ API call fails the intent is already committed as
  // PENDING_PAYMENT. Without cleanup, the DUPLICATE_INTENT guard would block
  // retries for the full 24-hour expiresAt window. Mark it FAILED before throwing.
  let payat: PayatPaymentResponse
  try {
    console.info(JSON.stringify({
      event: 'payat.rtp_call_start',
      traceId,
      intentId: intent.id,
      payAtAmountCents,
    }))
    payat = await createPayatPaymentRequest({
      topupId: intent.id,
      amountCents: payAtAmountCents,
      description: `Plug A Pro wallet top-up R${Math.round(payAtAmountCents / 100)}`,
      providerName: provider.name ?? 'Provider',
      providerPhone: resolvedPhone,
      providerEmail: provider.email ?? '',
    })
    console.info(JSON.stringify({
      event: 'payat.rtp_call_ok',
      traceId,
      intentId: intent.id,
      hasPaymentLink: Boolean(payat.paymentLink),
      hasSourceReference: Boolean(payat.sourceReference),
    }))
  } catch (err) {
    // Structured log lets ops correlate a provider complaint ("my Pay@ link
    // never appeared") to the specific intent that was abandoned.
    console.error(JSON.stringify({
      event: 'payat.rtp_call_failed',
      traceId,
      intentId: intent.id,
      providerId: provider.id,
      amountCents: payAtAmountCents,
      errorName: err instanceof Error ? err.name : 'unknown',
      errorMsg: err instanceof Error ? err.message : String(err),
    }))
    await db.paymentIntent.update({
      where: { id: intent.id },
      data: { status: 'FAILED' },
    }).catch((dbErr) => {
      // Intent stays PENDING_PAYMENT - duplicate-intent guard will block retries
      // for the full 3-day window. Requires manual recovery in admin.
      console.error(JSON.stringify({
        event: 'payat.intent_cleanup_failed',
        alert: true,
        traceId,
        intentId: intent.id,
        error: dbErr instanceof Error ? dbErr.message : String(dbErr),
      }))
    })
    throw err
  }

  try {
    await db.paymentIntent.update({
      where: { id: intent.id },
      data: {
        sourceReference: payat.sourceReference,
        requestToPayId: payat.requestToPayId,
        metadata: toJson({
          ...(typeof intent.metadata === 'object' && intent.metadata && !Array.isArray(intent.metadata)
            ? intent.metadata
            : {}),
          payatReference: payat.reference,
          sourceReference: payat.sourceReference,
          paymentLink: payat.paymentLink ?? null,
        }),
      },
    })
    console.info(JSON.stringify({
      event: 'payat.intent_metadata_updated',
      traceId,
      intentId: intent.id,
    }))
  } catch (updateErr) {
    // Non-fatal: intent is PENDING_PAYMENT and Pay@ has issued the reference.
    // The webhook will still credit the wallet on payment confirmation.
    console.error(JSON.stringify({
      event: 'payat.intent_metadata_update_failed',
      traceId,
      intentId: intent.id,
      providerId: provider.id,
      error: updateErr instanceof Error ? updateErr.message : String(updateErr),
    }))
  }

  const { notifyProviderPayatTopUpInitiated } = await import('./provider-wallet-notifications')
  notifyProviderPayatTopUpInitiated(intent.id, payat.paymentLink).catch((error: unknown) => {
    console.error(JSON.stringify({
      event: 'payat.whatsapp_notify_failed',
      traceId,
      intentId: intent.id,
      error: error instanceof Error ? error.message : String(error),
    }))
  })

  console.info(JSON.stringify({
    event: 'payat.intent_create_complete',
    traceId,
    intentId: intent.id,
    providerId: provider.id,
    amountCents: input.amountCents,
    payAtAmountCents,
  }))

  return { intent, payat, payAtAmountCents }
}

/**
 * Create a PaymentIntent for a Payfast gateway top-up and return the Payfast
 * checkout payload. Wallet balance is NOT modified here - crediting happens
 * only after a verified Payfast ITN with payment_status === "COMPLETE".
 *
 * The caller must redirect or POST the provider's browser to
 * `result.checkout.action` with `result.checkout.fields`.
 *
 * IMPORTANT: the Payfast return URL is UI-only - never credit the wallet there.
 */
export async function createPayfastTopUpIntent(
  input: CreatePayfastTopUpIntentInput,
): Promise<CreatePayfastTopUpIntentResult> {
  if (!PAYFAST_ALLOWED_AMOUNTS_CENTS.has(input.amountCents)) {
    throw new ProviderCreditPaymentIntentError(
      'INVALID_AMOUNT',
      'Top-up amount must be one of the approved credits packages: R100, R200 or R500.',
    )
  }

  const creditsToIssue = creditsForAmount(input.amountCents)
  const paymentMethod = input.paymentMethod ?? 'PAYFAST_CARD'
  const config = getPayfastConfig()

  const intent = await db.$transaction(async (tx) => {
    const provider = await tx.provider.findUnique({
      where: { id: input.providerId },
      select: {
        id: true,
        phone: true,
        name: true,
        email: true,
        active: true,
        verified: true,
        status: true,
        kycStatus: true,
        suspendedUntil: true,
      },
    })

    if (!provider) {
      throw new ProviderCreditPaymentIntentError(
        'PROVIDER_NOT_FOUND',
        'Provider account not found.',
      )
    }
    await assertProviderVerifiedForPaidTopUp(provider, tx, {
      actorUserId: input.actorUserId,
      attemptedAction: 'payfast_top_up_intent_create',
    })

    // Use the intent ID as the Payfast m_payment_id and as the internal
    // payment reference. For Payfast there is no human-readable bank
    // reference - the gateway provides its own payment ID in the ITN.
    const paymentReference = await createUniquePaymentReference(
      tx,
      // Prefix with "PF-" to distinguish Payfast intents from manual EFT
      // references in admin tooling.
      () => `PF-${randomBytes(6).toString('hex').toUpperCase()}`,
    )

    return tx.paymentIntent.create({
      data: {
        providerId: provider.id,
        amountCents: input.amountCents,
        currency: 'ZAR',
        creditsToIssue,
        paymentMethod,
        paymentReference,
        status: 'PENDING_PAYMENT',
        providerCellphone: input.providerCellphone ?? provider.phone,
        metadata: toJson(input.metadata),
        expiresAt: getPayfastExpiresAt(input.now ?? new Date()),
      },
    })
  })

  // Build the Payfast checkout payload outside the transaction - if this fails
  // the intent stays in PENDING_PAYMENT and will expire naturally via the
  // /api/cron/expire-payment-intents hourly cron once expiresAt has passed.
  const providerProfile = {
    name: input.providerName ?? undefined,
    email: input.providerEmail ?? undefined,
    phone: input.providerCellphone ?? undefined,
  }

  const checkout = buildCheckoutPayload(
    {
      id: intent.id,
      amountCents: intent.amountCents,
      creditsToIssue: intent.creditsToIssue,
      paymentMethod: intent.paymentMethod,
    },
    providerProfile,
    config,
  )

  // Non-blocking WhatsApp notification - failure must not prevent the
  // provider from reaching the Payfast checkout page.
  const { notifyProviderPayfastTopUpInitiated } = await import('./provider-wallet-notifications')
  notifyProviderPayfastTopUpInitiated(intent.id).catch((error: unknown) => {
    console.error('[provider-credit-payment-intents] Payfast topup initiated WhatsApp notification failed', {
      intentId: intent.id,
      error,
    })
  })

  return { intent, checkout }
}
