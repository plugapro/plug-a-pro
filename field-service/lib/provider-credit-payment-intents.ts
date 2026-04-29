import { randomBytes, randomInt } from 'crypto'
import { Prisma, type PaymentIntent } from '@prisma/client'
import { db } from './db'
import { PLUG_A_PRO_CREDIT_VALUE_CENTS } from './provider-wallet'

export const MIN_PROVIDER_CREDIT_TOPUP_CENTS = 10_000
export const MANUAL_EFT_REFERENCE_ATTEMPTS = 10

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
      'Minimum provider credit top-up is R100.',
    )
  }

  if (amountCents % PLUG_A_PRO_CREDIT_VALUE_CENTS !== 0) {
    throw new ProviderCreditPaymentIntentError(
      'INVALID_AMOUNT',
      'Top-up amount must convert cleanly into whole Plug-A-Pro Credits.',
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
