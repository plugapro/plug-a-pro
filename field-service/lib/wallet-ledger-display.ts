import { type WalletLedgerEntry } from '@prisma/client'

type WalletLedgerMetadata = Record<string, unknown>

export type WalletLedgerDisplay = {
  title: string
  details: string[]
  referenceHint: string
  referenceType: string
  referenceTypeLabel: string
  paymentIntentHref?: string
}

export type WalletLedgerSignedAmountInput = {
  entryType: string
  amountCredits: number
}

// Single source of truth for which entry types reduce the wallet balance.
// ledgerEntryDelta (drift replay), the provider activity UI and the history
// filters all derive from this list — add new debit types here only.
export const WALLET_DEBIT_ENTRY_TYPES = [
  'LEAD_UNLOCK_DEBIT',
  'PROMO_EXPIRY',
  'PAYMENT_REVERSAL',
  'FIRST_TOPUP_KYC_DEDUCTION',
] as const

export function isDebitWalletEntryType(entryType: string): boolean {
  return (WALLET_DEBIT_ENTRY_TYPES as readonly string[]).includes(entryType)
}

export function walletLedgerSignedAmount(entry: WalletLedgerSignedAmountInput): number {
  return isDebitWalletEntryType(entry.entryType)
    ? -Math.abs(entry.amountCredits)
    : entry.amountCredits
}

function cleanStatus(status: string) {
  return status.replaceAll('_', ' ').toLowerCase()
}

function toMetadataRecord(metadata: unknown): WalletLedgerMetadata {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) {
    return {}
  }
  return metadata as WalletLedgerMetadata
}

function formatReferenceHint(referenceId: string) {
  const trim = referenceId.trim()
  return trim.length <= 10 ? trim : `${trim.slice(0, 6)}…${trim.slice(-4)}`
}

function formatCurrencyFromCents(value: unknown) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null
  return new Intl.NumberFormat('en-ZA', {
    style: 'currency',
    currency: 'ZAR',
  }).format(value / 100)
}

function readString(meta: WalletLedgerMetadata, key: string) {
  const value = meta[key]
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function withActorPrefix(actor: string | null) {
  if (!actor) return null
  const trimmed = actor.trim()
  if (!trimmed) return null
  return trimmed.startsWith('by ') ? trimmed : `by ${trimmed}`
}

function pushIf(values: string[], value: string | null) {
  if (value) values.push(value)
}

export function summarizeWalletLedgerEntry(entry: WalletLedgerEntry): WalletLedgerDisplay {
  const metadata = toMetadataRecord(entry.metadata)
  const details: string[] = []

  const paymentReference = readString(metadata, 'paymentReference')
  const leadRef = readString(metadata, 'leadRef')
  const leadId = readString(metadata, 'leadId')
  const jobTitle = readString(metadata, 'jobTitle')
  const jobCategory = readString(metadata, 'jobCategory')
  const awardType = readString(metadata, 'awardType')
  const reason = readString(metadata, 'reason')
  const campaignCode = readString(metadata, 'campaignCode')
  const batchName = readString(metadata, 'batchName')
  const bankReference = readString(metadata, 'bankStatementReference')
  const source = entry.source || readString(metadata, 'source') || entry.createdBy
  const actorId = withActorPrefix(
    (
    readString(metadata, 'adjustedBy')
    || readString(metadata, 'suspendedBy')
    || readString(metadata, 'reactivatedBy')
    || readString(metadata, 'createdBy')
    || (entry.createdBy && `by ${entry.createdBy}`)
    )
  )

  let title = entry.description?.trim() || `${cleanStatus(entry.referenceType)} ${cleanStatus(entry.entryType)}`

  if (entry.entryType === 'FIRST_TOPUP_KYC_DEDUCTION') {
    // Shares referenceType 'payment_intent' with top-up credits, so this
    // branch must run before the generic payment_intent title.
    title = 'ID verification fee settled from first top-up'
    const outstanding = formatCurrencyFromCents(metadata.outstandingCents)
    pushIf(details, outstanding && `Fee ${outstanding}`)
  } else if (entry.referenceType === 'payment_intent') {
    const amount = formatCurrencyFromCents(metadata.amountCents)
    title = `Top-up from payment ${paymentReference ?? formatReferenceHint(entry.referenceId)}`
    pushIf(details, amount && `Amount ${amount}`)
    pushIf(details, bankReference && `Bank reference ${bankReference}`)
    pushIf(details, source && `Source ${source}`)
  } else if (entry.referenceType === 'lead_unlock' || entry.referenceType === 'test_lead_unlock') {
    const leadLabel = leadRef ?? (leadId ? `lead ${leadId.slice(-8).toUpperCase()}` : null)
    title = `Lead unlock deduction${leadLabel ? ` for ${leadLabel}` : ''}`
    pushIf(details, jobTitle)
    pushIf(details, jobCategory)
  } else if (entry.referenceType === 'selected_lead_credit_application' || entry.referenceType === 'test_selected_lead_credit_application') {
    const leadLabel = leadRef ?? (leadId ? `lead ${leadId.slice(-8).toUpperCase()}` : null)
    title = `Credit application ${leadLabel ? `for ${leadLabel}` : ''}`
    pushIf(details, jobTitle)
    pushIf(details, jobCategory)
  } else if (entry.referenceType === 'admin_adjustment') {
    title = 'Manual admin adjustment'
    pushIf(details, reason && `Reason: ${reason}`)
  } else if (entry.referenceType === 'lead_unlock_dispute') {
    title = 'Lead unlock refund'
    pushIf(details, reason && `Reason: ${reason}`)
  } else if (entry.referenceType === 'provider_promo_award') {
    title = `Promo award${awardType ? ` (${awardType})` : ''}`
    pushIf(details, readString(metadata, 'milestoneReferenceType'))
    pushIf(
      details,
      readString(metadata, 'milestoneReferenceId')?.slice(-8).toUpperCase() || null,
    )
  } else if (entry.referenceType === 'voucher') {
    title = 'Voucher redemption'
    pushIf(details, campaignCode && `Campaign ${campaignCode}`)
    pushIf(details, batchName)
  } else if (entry.referenceType === 'wallet_status') {
    title = entry.description?.trim() || 'Wallet status change'
  } else if (entry.entryType === 'PAYMENT_REVERSAL') {
    title = 'Payment reversal'
  } else if (entry.entryType === 'PROMO_EXPIRY') {
    title = 'Promo expiry'
  }

  pushIf(details, readString(metadata, 'action'))
  pushIf(details, actorId)

  return {
    title,
    details,
    referenceHint: formatReferenceHint(entry.referenceId),
    referenceType: entry.referenceType,
    referenceTypeLabel: cleanStatus(entry.referenceType),
    ...(entry.referenceType === 'payment_intent' ? { paymentIntentHref: `/admin/provider-credit-payments/${entry.referenceId}` } : {}),
  }
}
