import { type WalletLedgerEntry } from '@prisma/client'
import { db } from './db'

export type ProviderCreditReconciliationIssueCode =
  | 'PROVIDER_NOT_FOUND'
  | 'WALLET_MISSING'
  | 'WALLET_BALANCE_MISMATCH'
  | 'LEDGER_SNAPSHOT_MISMATCH'
  | 'CREDITED_PAYMENT_WITHOUT_LEDGER'
  | 'PAYFAST_PAYMENT_WITHOUT_LEDGER_LINK'
  | 'PROMO_AWARD_WITHOUT_LEDGER'
  | 'LEAD_UNLOCK_WITHOUT_DEBIT'
  | 'LEAD_UNLOCK_DEBIT_AMOUNT_MISMATCH'
  | 'TEST_LEDGER_FLAG_MISMATCH'
  | 'TEST_LEDGER_COHORT_MISSING'

export type ProviderCreditReconciliationIssue = {
  code: ProviderCreditReconciliationIssueCode
  severity: 'warning' | 'error'
  message: string
  referenceType?: string
  referenceId?: string
}

export type ProviderCreditReconciliationReport = {
  providerId: string
  ok: boolean
  wallet: {
    exists: boolean
    paidCreditBalance: number
    promoCreditBalance: number
    status: string | null
  }
  replayedBalance: {
    paidCreditBalance: number
    promoCreditBalance: number
  }
  counts: {
    ledgerEntries: number
    creditedPaymentIntents: number
    promoAwards: number
    leadUnlocks: number
    issues: number
  }
  issues: ProviderCreditReconciliationIssue[]
}

function ledgerDirection(entryType: string, amountCredits: number) {
  switch (entryType) {
    case 'TOPUP_CREDIT':
    case 'PROMO_CREDIT':
    case 'LEAD_REFUND_CREDIT':
      return amountCredits
    case 'LEAD_UNLOCK_DEBIT':
    case 'PROMO_EXPIRY':
    case 'PAYMENT_REVERSAL':
      return -amountCredits
    case 'ADMIN_ADJUSTMENT':
      return amountCredits
    default:
      return 0
  }
}

function addIssue(
  issues: ProviderCreditReconciliationIssue[],
  issue: ProviderCreditReconciliationIssue,
) {
  issues.push(issue)
}

function replayLedger(
  ledgerEntries: WalletLedgerEntry[],
  issues: ProviderCreditReconciliationIssue[],
) {
  let paidCreditBalance = 0
  let promoCreditBalance = 0

  for (const entry of ledgerEntries) {
    const movement = ledgerDirection(entry.entryType, entry.amountCredits)
    if (entry.creditType === 'PAID') {
      paidCreditBalance += movement
    } else {
      promoCreditBalance += movement
    }

    if (
      entry.balanceAfterPaidCredits !== paidCreditBalance ||
      entry.balanceAfterPromoCredits !== promoCreditBalance
    ) {
      addIssue(issues, {
        code: 'LEDGER_SNAPSHOT_MISMATCH',
        severity: 'error',
        message: `Ledger entry ${entry.id} balance snapshot does not match replayed wallet balance.`,
        referenceType: 'wallet_ledger_entry',
        referenceId: entry.id,
      })
    }
  }

  return { paidCreditBalance, promoCreditBalance }
}

export async function buildProviderCreditReconciliationReport(
  providerId: string,
): Promise<ProviderCreditReconciliationReport> {
  const provider = await db.provider.findUnique({
    where: { id: providerId },
    include: {
      wallet: true,
      walletLedgerEntries: { orderBy: { createdAt: 'asc' } },
      paymentIntents: true,
      promoAwards: true,
      leadUnlocks: true,
    },
  })

  if (!provider) {
    return {
      providerId,
      ok: false,
      wallet: {
        exists: false,
        paidCreditBalance: 0,
        promoCreditBalance: 0,
        status: null,
      },
      replayedBalance: {
        paidCreditBalance: 0,
        promoCreditBalance: 0,
      },
      counts: {
        ledgerEntries: 0,
        creditedPaymentIntents: 0,
        promoAwards: 0,
        leadUnlocks: 0,
        issues: 1,
      },
      issues: [{
        code: 'PROVIDER_NOT_FOUND',
        severity: 'error',
        message: `Provider ${providerId} was not found.`,
        referenceType: 'provider',
        referenceId: providerId,
      }],
    }
  }

  const issues: ProviderCreditReconciliationIssue[] = []
  const ledgerEntries = provider.walletLedgerEntries
  const replayedBalance = replayLedger(ledgerEntries, issues)

  if (!provider.wallet && ledgerEntries.length > 0) {
    addIssue(issues, {
      code: 'WALLET_MISSING',
      severity: 'error',
      message: 'Provider has ledger entries but no ProviderWallet row.',
      referenceType: 'provider',
      referenceId: provider.id,
    })
  }

  if (
    provider.wallet &&
    (
      provider.wallet.paidCreditBalance !== replayedBalance.paidCreditBalance ||
      provider.wallet.promoCreditBalance !== replayedBalance.promoCreditBalance
    )
  ) {
    addIssue(issues, {
      code: 'WALLET_BALANCE_MISMATCH',
      severity: 'error',
      message: 'ProviderWallet cached balance does not match replayed ledger balance.',
      referenceType: 'provider_wallet',
      referenceId: provider.wallet.id,
    })
  }

  const ledgerByReference = new Map<string, WalletLedgerEntry[]>()
  for (const entry of ledgerEntries) {
    const key = `${entry.referenceType}:${entry.referenceId}`
    ledgerByReference.set(key, [...(ledgerByReference.get(key) ?? []), entry])

    if (entry.isTestTransaction !== provider.isTestUser) {
      addIssue(issues, {
        code: 'TEST_LEDGER_FLAG_MISMATCH',
        severity: 'warning',
        message: `Ledger entry ${entry.id} test flag does not match provider cohort.`,
        referenceType: 'wallet_ledger_entry',
        referenceId: entry.id,
      })
    }

    if (entry.isTestTransaction && !entry.cohortName) {
      addIssue(issues, {
        code: 'TEST_LEDGER_COHORT_MISSING',
        severity: 'warning',
        message: `Ledger entry ${entry.id} is marked test but has no cohort name.`,
        referenceType: 'wallet_ledger_entry',
        referenceId: entry.id,
      })
    }
  }

  const creditedPaymentIntents = provider.paymentIntents.filter((intent) => (
    intent.status === 'CREDITED' && intent.creditedAt
  ))
  for (const intent of creditedPaymentIntents) {
    const topUpEntries = ledgerByReference.get(`payment_intent:${intent.id}`)?.filter((entry) => (
      entry.entryType === 'TOPUP_CREDIT'
    )) ?? []

    if (topUpEntries.length === 0) {
      addIssue(issues, {
        code: 'CREDITED_PAYMENT_WITHOUT_LEDGER',
        severity: 'error',
        message: `Credited payment intent ${intent.id} has no TOPUP_CREDIT ledger entry.`,
        referenceType: 'payment_intent',
        referenceId: intent.id,
      })
    }

    if (
      intent.paymentMethod.startsWith('PAYFAST_') &&
      intent.creditedLedgerEntryId &&
      !topUpEntries.some((entry) => entry.id === intent.creditedLedgerEntryId)
    ) {
      addIssue(issues, {
        code: 'PAYFAST_PAYMENT_WITHOUT_LEDGER_LINK',
        severity: 'error',
        message: `PayFast payment intent ${intent.id} points to a missing credited ledger entry.`,
        referenceType: 'payment_intent',
        referenceId: intent.id,
      })
    }
  }

  for (const award of provider.promoAwards.filter((candidate) => candidate.status === 'AWARDED')) {
    const awardEntries = ledgerByReference.get(`provider_promo_award:${award.id}`)?.filter((entry) => (
      entry.entryType === 'PROMO_CREDIT'
    )) ?? []
    if (awardEntries.length === 0) {
      addIssue(issues, {
        code: 'PROMO_AWARD_WITHOUT_LEDGER',
        severity: 'error',
        message: `Promo award ${award.id} has no PROMO_CREDIT ledger entry.`,
        referenceType: 'provider_promo_award',
        referenceId: award.id,
      })
    }
  }

  for (const unlock of provider.leadUnlocks) {
    const debitEntries = [
      ...(ledgerByReference.get(`lead_unlock:${unlock.id}`) ?? []),
      ...(ledgerByReference.get(`test_lead_unlock:${unlock.id}`) ?? []),
    ].filter((entry) => entry.entryType === 'LEAD_UNLOCK_DEBIT')

    if (debitEntries.length === 0) {
      addIssue(issues, {
        code: 'LEAD_UNLOCK_WITHOUT_DEBIT',
        severity: 'error',
        message: `Lead unlock ${unlock.id} has no LEAD_UNLOCK_DEBIT ledger entry.`,
        referenceType: 'lead_unlock',
        referenceId: unlock.id,
      })
      continue
    }

    const totalDebited = debitEntries.reduce((sum, entry) => sum + entry.amountCredits, 0)
    if (totalDebited !== unlock.creditsCharged) {
      addIssue(issues, {
        code: 'LEAD_UNLOCK_DEBIT_AMOUNT_MISMATCH',
        severity: 'error',
        message: `Lead unlock ${unlock.id} charged ${unlock.creditsCharged} credits but ledger debits total ${totalDebited}.`,
        referenceType: 'lead_unlock',
        referenceId: unlock.id,
      })
    }
  }

  return {
    providerId,
    ok: issues.length === 0,
    wallet: {
      exists: Boolean(provider.wallet),
      paidCreditBalance: provider.wallet?.paidCreditBalance ?? 0,
      promoCreditBalance: provider.wallet?.promoCreditBalance ?? 0,
      status: provider.wallet?.status ?? null,
    },
    replayedBalance,
    counts: {
      ledgerEntries: ledgerEntries.length,
      creditedPaymentIntents: creditedPaymentIntents.length,
      promoAwards: provider.promoAwards.length,
      leadUnlocks: provider.leadUnlocks.length,
      issues: issues.length,
    },
    issues,
  }
}
