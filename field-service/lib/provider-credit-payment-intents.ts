import { randomBytes, randomInt } from 'crypto'
import { Prisma, type PaymentIntent } from '@prisma/client'
import { db } from './db'
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
// Pay@ and Payfast both expose the approved R100/R200/R500 packages.
export const PAYFAST_ALLOWED_AMOUNTS_CENTS = new Set([10_000, 20_000, 50_000])

type PaymentIntentErrorCode =
  | 'INVALID_AMOUNT'
  | 'PROVIDER_NOT_FOUND'
  | 'REFERENCE_GENERATION_FAILED'

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
  const creditsToIssue = creditsForAmount(input.amountCents)
  const referenceGenerator = input.referenceGenerator ?? generateManualEftPaymentReference
  const now = input.now ?? new Date()
  const bankAccount = getManualEftBankAccountInstructions()

  const result = await db.$transaction(async (tx) => {
    const provider = await tx.provider.findUnique({
      where: { id: input.providerId },
      select: { id: true, phone: true },
    })

    if (!provider) {
      throw new ProviderCreditPaymentIntentError(
        'PROVIDER_NOT_FOUND',
        'Provider account not found.',
      )
    }

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

export type PayfastTopUpMethod = 'PAYFAST_CARD' | 'PAYFAST_EFT' | 'PAYFAST_SCODE'

export type CreatePayfastTopUpIntentInput = {
  providerId: string
  amountCents: number
  paymentMethod?: PayfastTopUpMethod
  providerName?: string | null
  providerEmail?: string | null
  providerCellphone?: string | null
  metadata?: Record<string, unknown>
}

export type CreatePayfastTopUpIntentResult = {
  intent: PaymentIntent
  checkout: PayfastCheckoutPayload
}

export type CreatePayatTopUpIntentInput = {
  providerId: string
  amountCents: number
  providerCellphone?: string | null
  metadata?: Record<string, unknown>
}

export type CreatePayatTopUpIntentResult = {
  intent: PaymentIntent
  payat: PayatPaymentResponse
}

// ─── Pay@ payment request intent ─────────────────────────────────────────────

export async function createPayatTopUpIntent(
  input: CreatePayatTopUpIntentInput,
): Promise<CreatePayatTopUpIntentResult> {
  if (!PAYAT_ALLOWED_AMOUNTS_CENTS.has(input.amountCents)) {
    throw new ProviderCreditPaymentIntentError(
      'INVALID_AMOUNT',
      'Top-up amount must be one of the approved credits packages: R100, R200, or R500.',
    )
  }

  const creditsToIssue = creditsForAmount(input.amountCents)

  const intent = await db.$transaction(async (tx) => {
    const provider = await tx.provider.findUnique({
      where: { id: input.providerId },
      select: { id: true, phone: true },
    })

    if (!provider) {
      throw new ProviderCreditPaymentIntentError(
        'PROVIDER_NOT_FOUND',
        'Provider account not found.',
      )
    }

    const paymentReference = await createUniquePaymentReference(
      tx,
      () => `PAT-${randomBytes(6).toString('hex').toUpperCase()}`,
    )

    // The PaymentIntent is created before Pay@ is called so webhook references
    // can use the immutable intent ID and remain idempotent under retries.
    return tx.paymentIntent.create({
      data: {
        providerId: provider.id,
        amountCents: input.amountCents,
        currency: 'ZAR',
        creditsToIssue,
        paymentMethod: 'PAYAT',
        paymentReference,
        status: 'PENDING_PAYMENT',
        providerCellphone: input.providerCellphone ?? provider.phone,
        metadata: toJson(input.metadata),
      },
    })
  })

  const payat = await createPayatPaymentRequest({
    topupId: intent.id,
    amountCents: intent.amountCents,
    description: `Plug A Pro wallet top-up R${Math.round(intent.amountCents / 100)}`,
  })

  const { notifyProviderPayatTopUpInitiated } = await import('./provider-wallet-notifications')
  notifyProviderPayatTopUpInitiated(intent.id, payat.paymentLink).catch((error: unknown) => {
    console.error('[provider-credit-payment-intents] Pay@ topup initiated WhatsApp notification failed', {
      intentId: intent.id,
      error,
    })
  })

  return { intent, payat }
}

/**
 * Create a PaymentIntent for a Payfast gateway top-up and return the Payfast
 * checkout payload. Wallet balance is NOT modified here — crediting happens
 * only after a verified Payfast ITN with payment_status === "COMPLETE".
 *
 * The caller must redirect or POST the provider's browser to
 * `result.checkout.action` with `result.checkout.fields`.
 *
 * IMPORTANT: the Payfast return URL is UI-only — never credit the wallet there.
 */
export async function createPayfastTopUpIntent(
  input: CreatePayfastTopUpIntentInput,
): Promise<CreatePayfastTopUpIntentResult> {
  if (!PAYFAST_ALLOWED_AMOUNTS_CENTS.has(input.amountCents)) {
    throw new ProviderCreditPaymentIntentError(
      'INVALID_AMOUNT',
      'Top-up amount must be one of the approved credits packages: R100, R200, or R500.',
    )
  }

  const creditsToIssue = creditsForAmount(input.amountCents)
  const paymentMethod = input.paymentMethod ?? 'PAYFAST_CARD'
  const config = getPayfastConfig()

  const intent = await db.$transaction(async (tx) => {
    const provider = await tx.provider.findUnique({
      where: { id: input.providerId },
      select: { id: true, phone: true, name: true, email: true },
    })

    if (!provider) {
      throw new ProviderCreditPaymentIntentError(
        'PROVIDER_NOT_FOUND',
        'Provider account not found.',
      )
    }

    // Use the intent ID as the Payfast m_payment_id and as the internal
    // payment reference. For Payfast there is no human-readable bank
    // reference — the gateway provides its own payment ID in the ITN.
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
      },
    })
  })

  // Build the Payfast checkout payload outside the transaction — if this fails
  // the intent stays in PENDING_PAYMENT and will expire naturally.
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

  // Non-blocking WhatsApp notification — failure must not prevent the
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
