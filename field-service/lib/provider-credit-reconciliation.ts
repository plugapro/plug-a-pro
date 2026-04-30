import { Prisma, type PaymentIntent } from '@prisma/client'
import { db } from './db'
import { creditPaidCreditsInTransaction } from './provider-wallet'
import { awardFirstTopUpPromoCreditsInTransaction } from './provider-promo-awards'

const CREDITABLE_STATUSES = [
  'PENDING_PAYMENT',
  'PROOF_UPLOADED',
  'MATCHED_ON_STATEMENT',
  // ITN_RECEIVED: Payfast confirmed payment but wallet crediting failed (rare).
  // Admin can manually trigger the credit as a recovery mechanism.
  'ITN_RECEIVED',
] as const
// CREATED is reserved for future gateway-initiated intents. Manual EFT intents
// currently start at PENDING_PAYMENT.
const MATCHABLE_STATUSES = ['CREATED', 'PENDING_PAYMENT', 'PROOF_UPLOADED', 'MATCHED_ON_STATEMENT'] as const

type ReconciliationErrorCode =
  | 'NOT_FOUND'
  | 'INVALID_STATUS'
  | 'ALREADY_CREDITED'
  | 'AMOUNT_MISMATCH'
  | 'INVALID_REFERENCE'

export class ProviderCreditReconciliationError extends Error {
  constructor(
    public readonly code: ReconciliationErrorCode,
    message: string,
  ) {
    super(message)
    this.name = 'ProviderCreditReconciliationError'
  }
}

export type ReconcilePaymentIntentOptions = {
  statementAmountCents?: number
  adminNote?: string | null
}

export type CreditPaymentIntentOptions = {
  adminNote?: string | null
}

type ReconciliationTx = Prisma.TransactionClient

function assertBankStatementReference(bankStatementReference: string) {
  if (!bankStatementReference.trim()) {
    throw new ProviderCreditReconciliationError(
      'INVALID_REFERENCE',
      'Bank statement reference is required.',
    )
  }
}

function assertStatementAmount(intent: PaymentIntent, statementAmountCents?: number) {
  if (statementAmountCents == null) return

  if (!Number.isInteger(statementAmountCents) || statementAmountCents !== intent.amountCents) {
    throw new ProviderCreditReconciliationError(
      'AMOUNT_MISMATCH',
      'Confirmed bank amount does not match the provider top-up intent.',
    )
  }
}

function assertMatchableStatus(intent: PaymentIntent) {
  if (intent.status === 'CREDITED') {
    throw new ProviderCreditReconciliationError(
      'ALREADY_CREDITED',
      'This payment intent has already been credited.',
    )
  }

  if (!MATCHABLE_STATUSES.includes(intent.status as (typeof MATCHABLE_STATUSES)[number])) {
    throw new ProviderCreditReconciliationError(
      'INVALID_STATUS',
      `Cannot match a ${intent.status.toLowerCase()} payment intent.`,
    )
  }
}

function assertCreditableStatus(intent: PaymentIntent) {
  if (intent.status === 'CREDITED' || intent.creditedAt) {
    throw new ProviderCreditReconciliationError(
      'ALREADY_CREDITED',
      'This payment intent has already been credited.',
    )
  }

  if (!CREDITABLE_STATUSES.includes(intent.status as (typeof CREDITABLE_STATUSES)[number])) {
    throw new ProviderCreditReconciliationError(
      'INVALID_STATUS',
      `Cannot credit a ${intent.status.toLowerCase()} payment intent.`,
    )
  }

  if (intent.expiresAt && intent.expiresAt.getTime() < Date.now()) {
    throw new ProviderCreditReconciliationError(
      'INVALID_STATUS',
      'This payment intent has expired.',
    )
  }
}

function assertCreditHasReconciliationTrail(intent: PaymentIntent, adminNote?: string | null) {
  // Payfast gateway intents carry the ITN as their reconciliation trail.
  if (intent.itnReceivedAt) return
  if (intent.bankStatementReference?.trim() || adminNote?.trim()) return

  throw new ProviderCreditReconciliationError(
    'INVALID_REFERENCE',
    'Crediting requires a bank statement reference or admin note.',
  )
}

function appendAdminNote(existing: string | null, next?: string | null) {
  const cleanNext = next?.trim()
  if (!cleanNext) return existing
  return existing ? `${existing}\n${cleanNext}` : cleanNext
}

async function getPaymentIntentForUpdate(tx: ReconciliationTx, paymentIntentId: string) {
  const intent = await tx.paymentIntent.findUnique({
    where: { id: paymentIntentId },
  })

  if (!intent) {
    throw new ProviderCreditReconciliationError(
      'NOT_FOUND',
      `Payment intent ${paymentIntentId} not found.`,
    )
  }

  return intent
}

export async function reconcilePaymentIntent(
  paymentIntentId: string,
  adminUserId: string,
  bankStatementReference: string,
  options: ReconcilePaymentIntentOptions = {},
) {
  assertBankStatementReference(bankStatementReference)

  return db.$transaction(async (tx) => (
    reconcilePaymentIntentInTransaction(
      tx,
      paymentIntentId,
      adminUserId,
      bankStatementReference,
      options,
    )
  ))
}

export async function reconcilePaymentIntentInTransaction(
  tx: ReconciliationTx,
  paymentIntentId: string,
  adminUserId: string,
  bankStatementReference: string,
  options: ReconcilePaymentIntentOptions = {},
) {
  const intent = await getPaymentIntentForUpdate(tx, paymentIntentId)
  assertMatchableStatus(intent)
  assertStatementAmount(intent, options.statementAmountCents)

  const updated = await tx.paymentIntent.update({
    where: { id: intent.id },
    data: {
      status: 'MATCHED_ON_STATEMENT',
      bankStatementReference: bankStatementReference.trim(),
      paidAt: intent.paidAt ?? new Date(),
      adminNote: appendAdminNote(intent.adminNote, options.adminNote),
      metadata: {
        ...(typeof intent.metadata === 'object' && intent.metadata && !Array.isArray(intent.metadata)
          ? intent.metadata
          : {}),
        lastMatchedBy: adminUserId,
        lastMatchedAt: new Date().toISOString(),
      },
    },
  })

  return { intent: updated }
}

export async function creditPaymentIntent(
  paymentIntentId: string,
  adminUserId: string,
  options: CreditPaymentIntentOptions = {},
) {
  return db.$transaction(async (tx) => (
    creditPaymentIntentInTransaction(tx, paymentIntentId, adminUserId, options)
  ))
}

export async function creditPaymentIntentInTransaction(
  tx: ReconciliationTx,
  paymentIntentId: string,
  adminUserId: string,
  options: CreditPaymentIntentOptions = {},
) {
  const intent = await getPaymentIntentForUpdate(tx, paymentIntentId)
  const provider = await tx.provider.findUnique({
    where: { id: intent.providerId },
    select: { isTestUser: true, cohortName: true },
  })
  assertCreditableStatus(intent)
  assertCreditHasReconciliationTrail(intent, options.adminNote)

  // Move to CREDITED before touching the wallet. The status predicate makes
  // concurrent duplicate credit attempts update zero rows and roll back safely.
  const credited = await tx.paymentIntent.updateMany({
    where: {
      id: intent.id,
      status: { in: [...CREDITABLE_STATUSES] },
      creditedAt: null,
    },
    data: {
      status: 'CREDITED',
      creditedAt: new Date(),
      paidAt: intent.paidAt ?? new Date(),
      adminNote: appendAdminNote(intent.adminNote, options.adminNote),
      metadata: {
        ...(typeof intent.metadata === 'object' && intent.metadata && !Array.isArray(intent.metadata)
          ? intent.metadata
          : {}),
        creditedBy: adminUserId,
        creditedAt: new Date().toISOString(),
      },
    },
  })

  if (credited.count !== 1) {
    throw new ProviderCreditReconciliationError(
      'ALREADY_CREDITED',
      'This payment intent has already been credited.',
    )
  }

  const walletResult = await creditPaidCreditsInTransaction(
    tx,
    intent.providerId,
    intent.creditsToIssue,
    {
      referenceType: 'payment_intent',
      referenceId: intent.id,
      description: intent.paymentMethod.startsWith('PAYFAST_')
        ? `Payfast gateway top-up ${intent.paymentReference} — admin credit`
        : `Manual EFT top-up ${intent.paymentReference}`,
      metadata: {
        paymentReference: intent.paymentReference,
        bankStatementReference: intent.bankStatementReference,
        amountCents: intent.amountCents,
      },
      createdBy: adminUserId,
      isTestTransaction: provider?.isTestUser ?? false,
      cohortName: provider?.cohortName ?? null,
    },
  )

  const promoAwardResult = await awardFirstTopUpPromoCreditsInTransaction(
    tx,
    intent.providerId,
    intent.id,
    adminUserId,
  )

  const updatedIntent = await tx.paymentIntent.findUniqueOrThrow({
    where: { id: intent.id },
  })

  return {
    intent: updatedIntent,
    wallet: promoAwardResult.wallet ?? walletResult.wallet,
    ledgerEntries: [
      ...walletResult.ledgerEntries,
      ...promoAwardResult.ledgerEntries,
    ],
    promoAward: promoAwardResult.award,
  }
}
