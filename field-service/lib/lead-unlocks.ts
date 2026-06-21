import { Prisma, type LeadUnlock, type WalletLedgerEntry } from '@prisma/client'
import { db } from './db'
import {
  ProviderWalletError,
  debitCreditsForLeadUnlockInTransaction,
  type WalletMutationResult,
} from './provider-wallet'
import { checkProviderCanUnlockLead } from './provider-lead-eligibility'
import { isEnabled } from './flags'
import { KYC_GRACE_FLAG } from './matching/kyc-grace'

export const LEAD_UNLOCK_COST_CREDITS = 1

type LeadUnlockErrorCode =
  | 'NOT_FOUND'
  | 'FORBIDDEN'
  | 'PROVIDER_NOT_APPROVED'
  | 'PROVIDER_NOT_ACTIVE'
  | 'KYC_REQUIRED'
  | 'CONFIRMATION_REQUIRED'
  | 'LEAD_NOT_AVAILABLE'
  | 'INSUFFICIENT_CREDITS'
  | 'WALLET_SUSPENDED'
  | 'CONCURRENT_UNLOCK'

export class LeadUnlockError extends Error {
  constructor(
    public readonly code: LeadUnlockErrorCode,
    message: string,
    public readonly currentCreditBalance?: number,
  ) {
    super(message)
    this.name = 'LeadUnlockError'
  }
}

export type UnlockLeadForProviderResult = {
  unlock: LeadUnlock
  ledgerEntries: WalletLedgerEntry[]
  alreadyUnlocked: boolean
}

type LeadUnlockContext = {
  source?: 'whatsapp' | 'pwa' | 'api'
  traceId?: string
  idempotencyKey?: string
  // Explicit provider confirmation that they intend to spend a credit to unlock.
  // A lead magic-link token by itself must NOT spend credits: anyone holding a
  // forwarded/shared WhatsApp lead URL could otherwise drain the provider's
  // balance on the first page load. Callers must surface a "Confirm unlock
  // (1 credit will be deducted)" step and only then call with confirmed: true.
  confirmed?: boolean
}

function assertUnlockConfirmed(context: LeadUnlockContext) {
  if (!context.confirmed) {
    throw new LeadUnlockError(
      'CONFIRMATION_REQUIRED',
      'Please confirm you want to spend 1 Plug A Pro provider credit to unlock this lead.',
    )
  }
}

function creditBreakdown(ledgerEntries: WalletLedgerEntry[]) {
  return ledgerEntries.reduce(
    (breakdown, entry) => ({
      ...breakdown,
      [entry.creditType.toLowerCase()]: entry.amountCredits,
    }),
    {} as Record<string, number>,
  )
}

function toJson(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue
}

function assertLeadAvailable(lead: {
  status: string
  expiresAt: Date | null
  jobRequest: { status: string }
}) {
  if (lead.jobRequest.status === 'CANCELLED' || lead.jobRequest.status === 'EXPIRED') {
    throw new LeadUnlockError('LEAD_NOT_AVAILABLE', 'This lead is no longer available.')
  }

  if (!['SENT', 'VIEWED', 'PROVIDER_ACCEPTED', 'CREDIT_REQUIRED', 'ACCEPTED', 'ACCEPTED_LOCKED'].includes(lead.status)) {
    throw new LeadUnlockError('LEAD_NOT_AVAILABLE', 'This lead cannot be unlocked.')
  }

  if (!['ACCEPTED', 'ACCEPTED_LOCKED'].includes(lead.status) && lead.expiresAt && lead.expiresAt < new Date()) {
    throw new LeadUnlockError('LEAD_NOT_AVAILABLE', 'This lead has expired.')
  }
}

function assertProviderCanUnlock(
  provider: {
    active: boolean
    verified: boolean
    status: string
    kycStatus: string
    createdAt?: Date | null
    // F2: optional admin override flag. When set the TRUST+ operator has
    // explicitly cleared this provider via setProviderKycOverrideAction;
    // checkProviderCanUnlockLead now honours it (same semantics as
    // checkCanBeApproved). Optional so callers that omit it keep their
    // current (override-absent) behaviour.
    kycOverriddenAt?: Date | null
  },
  kycGraceEnabled = false,
) {
  const eligibility = checkProviderCanUnlockLead(provider, kycGraceEnabled)
  if (eligibility.ok) return

  if (eligibility.code === 'PROVIDER_NOT_ACTIVE') {
    throw new LeadUnlockError(
      'PROVIDER_NOT_ACTIVE',
      'Your provider profile is not active, so you cannot unlock leads right now.',
    )
  }

  if (eligibility.code === 'KYC_REQUIRED') {
    throw new LeadUnlockError(
      'KYC_REQUIRED',
      'Verify your identity before you can unlock leads. This protects customers by confirming who is being sent their contact details.',
    )
  }

  throw new LeadUnlockError(
    'PROVIDER_NOT_APPROVED',
    'Your provider application must be approved before you can unlock leads.',
  )
}

function mapWalletError(error: unknown): never {
  if (error instanceof ProviderWalletError && error.code === 'INSUFFICIENT_FUNDS') {
    throw new LeadUnlockError(
      'INSUFFICIENT_CREDITS',
      'You need at least 1 Plug A Pro provider credit to accept this customer-selected job.',
    )
  }

  if (error instanceof ProviderWalletError && error.code === 'CONCURRENT_MUTATION') {
    throw new LeadUnlockError(
      'CONCURRENT_UNLOCK',
      'Your credits balance changed while accepting this customer-selected job. Please try again.',
    )
  }

  if (error instanceof ProviderWalletError && error.code === 'WALLET_NOT_ACTIVE') {
    throw new LeadUnlockError(
      'WALLET_SUSPENDED',
      'This provider wallet is not active.',
    )
  }

  throw error
}

export async function unlockLeadForProvider(
  leadId: string,
  providerId: string,
  context: LeadUnlockContext = {},
): Promise<UnlockLeadForProviderResult> {
  const existingUnlock = await db.leadUnlock.findUnique({
    where: { leadId },
  })

  if (existingUnlock) {
    if (existingUnlock.providerId !== providerId) {
      throw new LeadUnlockError('FORBIDDEN', 'This lead belongs to another provider.')
    }

    return {
      unlock: existingUnlock,
      ledgerEntries: [],
      alreadyUnlocked: true,
    }
  }

  // No prior unlock exists: this call will spend a credit, so require an explicit
  // provider confirmation. A bare magic-link token must not auto-spend credits.
  assertUnlockConfirmed(context)

  try {
    const result = await db.$transaction(async (tx) => {
      const lead = await tx.lead.findUnique({
        where: { id: leadId },
        include: {
          provider: {
            select: {
              id: true,
              active: true,
              verified: true,
              status: true,
              kycStatus: true,
              createdAt: true,
              // F2: read kycOverriddenAt so a TRUST+ admin override actually
              // unblocks the credit-spend step. Without it the matching-time
              // gate may pass while the unlock-time gate still rejects.
              kycOverriddenAt: true,
              isTestUser: true,
            },
          },
          jobRequest: {
            select: {
              id: true,
              status: true,
              isTestRequest: true,
              cohortName: true,
              category: true,
              title: true,
              match: { select: { id: true, providerId: true } },
            },
          },
        },
      })

      if (!lead) throw new LeadUnlockError('NOT_FOUND', 'Lead not found.')
      if (lead.providerId !== providerId) {
        throw new LeadUnlockError('FORBIDDEN', 'This lead belongs to another provider.')
      }
      assertProviderCanUnlock(lead.provider, await isEnabled(KYC_GRACE_FLAG))
      if (
        lead.jobRequest.match &&
        lead.jobRequest.match.providerId !== providerId
      ) {
        throw new LeadUnlockError('LEAD_NOT_AVAILABLE', 'This lead has already been matched.')
      }

      assertLeadAvailable(lead)

      const wallet = await tx.providerWallet.findUnique({
        where: { providerId },
        select: { paidCreditBalance: true, promoCreditBalance: true },
      })
      const currentCreditBalance = (wallet?.paidCreditBalance ?? 0) + (wallet?.promoCreditBalance ?? 0)
      const traceId = context.traceId ?? `unlock_${lead.id}_${Date.now().toString(36)}`
      console.info('[lead-unlocks] lead unlock attempt', {
        trace_id: traceId,
        provider_id: providerId,
        provider_status: lead.provider.status,
        provider_credit_balance: currentCreditBalance,
        lead_id: lead.id,
        lead_ref: lead.id.slice(-8).toUpperCase(),
        lead_status: lead.status,
        already_unlocked: false,
        source: context.source ?? 'api',
        result: currentCreditBalance >= LEAD_UNLOCK_COST_CREDITS ? 'VALIDATED' : 'INSUFFICIENT_CREDITS',
        error_code: currentCreditBalance >= LEAD_UNLOCK_COST_CREDITS ? null : 'INSUFFICIENT_CREDITS',
      })
      if (currentCreditBalance < LEAD_UNLOCK_COST_CREDITS) {
        throw new LeadUnlockError(
          'INSUFFICIENT_CREDITS',
          'You need at least 1 Plug A Pro provider credit to accept this customer-selected job.',
          currentCreditBalance,
        )
      }

      // Create the unlock marker before debiting. The unique leadId constraint
      // prevents double-tap races from charging the same lead twice.
      const unlock = await tx.leadUnlock.create({
        data: {
          leadId: lead.id,
          providerId,
          matchId: lead.jobRequest.match?.id ?? null,
          creditsCharged: LEAD_UNLOCK_COST_CREDITS,
          creditTypeBreakdown: {},
          isTestUnlock: lead.jobRequest.isTestRequest || lead.provider.isTestUser,
          cohortName: lead.jobRequest.cohortName,
          status: 'UNLOCKED',
        },
      })

      let debitResult: WalletMutationResult
      try {
        debitResult = await debitCreditsForLeadUnlockInTransaction(
          tx,
          providerId,
          LEAD_UNLOCK_COST_CREDITS,
          {
            referenceType: lead.jobRequest.isTestRequest || lead.provider.isTestUser
              ? 'test_lead_unlock'
              : 'lead_unlock',
            referenceId: unlock.id,
            description: `${lead.jobRequest.isTestRequest || lead.provider.isTestUser ? 'Test lead unlock' : 'Lead unlock'} ${lead.id.slice(-8).toUpperCase()}`,
            metadata: {
              leadId: lead.id,
              leadRef: lead.id.slice(-8).toUpperCase(),
              jobRequestId: lead.jobRequestId,
              jobCategory: lead.jobRequest.category ?? null,
              jobTitle: lead.jobRequest.title ?? null,
              source: context.source ?? 'api',
              ...(context.traceId ? { traceId: context.traceId } : {}),
              ...(context.idempotencyKey ? { idempotencyKey: context.idempotencyKey } : {}),
              ...(lead.jobRequest.cohortName ? { testCohort: lead.jobRequest.cohortName } : {}),
            },
            createdBy: providerId,
            isTestTransaction: lead.jobRequest.isTestRequest || lead.provider.isTestUser,
            cohortName: lead.jobRequest.cohortName,
          },
        )
      } catch (error) {
        mapWalletError(error)
      }

      const updatedUnlock = await tx.leadUnlock.update({
        where: { id: unlock.id },
        data: {
          creditTypeBreakdown: toJson(creditBreakdown(debitResult.ledgerEntries)),
        },
      })

      if (lead.status === 'SENT') {
        await tx.lead.update({
          where: { id: lead.id },
          data: { status: 'VIEWED' },
        })
      }

      console.info('[lead-unlocks] lead unlock committed', {
        trace_id: traceId,
        provider_id: providerId,
        provider_status: lead.provider.status,
        provider_credit_balance: debitResult.wallet.paidCreditBalance + debitResult.wallet.promoCreditBalance,
        lead_id: lead.id,
        lead_ref: lead.id.slice(-8).toUpperCase(),
        lead_status: lead.status,
        already_unlocked: false,
        source: context.source ?? 'api',
        result: 'UNLOCKED',
        error_code: null,
        credit_transaction_id: debitResult.ledgerEntries.at(-1)?.id ?? null,
      })

      return {
        unlock: updatedUnlock,
        ledgerEntries: debitResult.ledgerEntries,
        alreadyUnlocked: false,
      }
    })

    const { notifyLeadUnlocked, notifyProviderLowBalance } = await import('./provider-wallet-notifications')
    notifyLeadUnlocked(result.unlock.id).catch((error: unknown) => {
      console.error('[lead-unlocks] lead unlocked WhatsApp notification failed', {
        leadUnlockId: result.unlock.id,
        leadId,
        error,
      })
    })
    notifyProviderLowBalance(providerId, result.ledgerEntries.at(-1)?.id ?? result.unlock.id).catch((error: unknown) => {
      console.error('[lead-unlocks] low balance WhatsApp notification failed', {
        providerId,
        leadUnlockId: result.unlock.id,
        error,
      })
    })

    return result
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      const unlock = await db.leadUnlock.findUnique({ where: { leadId } })
      if (unlock && unlock.providerId === providerId) {
        return { unlock, ledgerEntries: [], alreadyUnlocked: true }
      }
    }

    throw error
  }
}

export async function unlockLeadForProviderInTransaction(
  tx: Prisma.TransactionClient,
  leadId: string,
  providerId: string,
  context: LeadUnlockContext = {},
): Promise<UnlockLeadForProviderResult> {
  const existingUnlock = await tx.leadUnlock.findUnique({
    where: { leadId },
  })

  if (existingUnlock) {
    if (existingUnlock.providerId !== providerId) {
      throw new LeadUnlockError('FORBIDDEN', 'This lead belongs to another provider.')
    }

    return {
      unlock: existingUnlock,
      ledgerEntries: [],
      alreadyUnlocked: true,
    }
  }

  // No prior unlock exists: this call will spend a credit, so require an explicit
  // provider confirmation. A bare magic-link token must not auto-spend credits.
  assertUnlockConfirmed(context)

  const lead = await tx.lead.findUnique({
    where: { id: leadId },
    include: {
      provider: {
        select: {
          id: true,
          active: true,
          verified: true,
          status: true,
          kycStatus: true,
          createdAt: true,
          isTestUser: true,
        },
      },
      jobRequest: {
        select: {
          id: true,
          status: true,
          isTestRequest: true,
          cohortName: true,
          category: true,
          title: true,
          match: { select: { id: true, providerId: true } },
        },
      },
    },
  })

  if (!lead) throw new LeadUnlockError('NOT_FOUND', 'Lead not found.')
  if (lead.providerId !== providerId) {
    throw new LeadUnlockError('FORBIDDEN', 'This lead belongs to another provider.')
  }
  assertProviderCanUnlock(lead.provider, await isEnabled(KYC_GRACE_FLAG))
  if (
    lead.jobRequest.match &&
    lead.jobRequest.match.providerId !== providerId
  ) {
    throw new LeadUnlockError('LEAD_NOT_AVAILABLE', 'This lead has already been matched.')
  }

  assertLeadAvailable(lead)

  const isTestUnlock = lead.jobRequest.isTestRequest || lead.provider.isTestUser
  const wallet = await tx.providerWallet.findUnique({
    where: { providerId },
    select: { paidCreditBalance: true, promoCreditBalance: true },
  })
  const currentCreditBalance = (wallet?.paidCreditBalance ?? 0) + (wallet?.promoCreditBalance ?? 0)
  const traceId = context.traceId ?? `unlock_${lead.id}_${Date.now().toString(36)}`
  console.info('[lead-unlocks] lead unlock attempt', {
    trace_id: traceId,
    provider_id: providerId,
    provider_status: lead.provider.status,
    provider_credit_balance: currentCreditBalance,
    lead_id: lead.id,
    lead_ref: lead.id.slice(-8).toUpperCase(),
    lead_status: lead.status,
    already_unlocked: false,
    source: context.source ?? 'api',
    result: currentCreditBalance >= LEAD_UNLOCK_COST_CREDITS ? 'VALIDATED' : 'INSUFFICIENT_CREDITS',
    error_code: currentCreditBalance >= LEAD_UNLOCK_COST_CREDITS ? null : 'INSUFFICIENT_CREDITS',
  })
  if (currentCreditBalance < LEAD_UNLOCK_COST_CREDITS) {
    throw new LeadUnlockError(
      'INSUFFICIENT_CREDITS',
      'You need at least 1 Plug A Pro provider credit to accept this customer-selected job.',
      currentCreditBalance,
    )
  }

  const unlock = await tx.leadUnlock.create({
    data: {
      leadId: lead.id,
      providerId,
      matchId: lead.jobRequest.match?.id ?? null,
      creditsCharged: LEAD_UNLOCK_COST_CREDITS,
      creditTypeBreakdown: {},
      isTestUnlock,
      cohortName: lead.jobRequest.cohortName,
      status: 'UNLOCKED',
    },
  })

  let debitResult: WalletMutationResult
  try {
    debitResult = await debitCreditsForLeadUnlockInTransaction(
      tx,
      providerId,
      LEAD_UNLOCK_COST_CREDITS,
      {
        referenceType: isTestUnlock ? 'test_lead_unlock' : 'lead_unlock',
        referenceId: unlock.id,
        description: `${isTestUnlock ? 'Test lead unlock' : 'Lead unlock'} ${lead.id.slice(-8).toUpperCase()}`,
        metadata: {
          leadId: lead.id,
          leadRef: lead.id.slice(-8).toUpperCase(),
          jobRequestId: lead.jobRequestId,
          jobCategory: lead.jobRequest.category ?? null,
          jobTitle: lead.jobRequest.title ?? null,
          source: context.source ?? 'api',
          ...(context.traceId ? { traceId: context.traceId } : {}),
          ...(context.idempotencyKey ? { idempotencyKey: context.idempotencyKey } : {}),
          ...(lead.jobRequest.cohortName ? { testCohort: lead.jobRequest.cohortName } : {}),
        },
        createdBy: providerId,
        isTestTransaction: isTestUnlock,
        cohortName: lead.jobRequest.cohortName,
      },
    )
  } catch (error) {
    mapWalletError(error)
  }

  const updatedUnlock = await tx.leadUnlock.update({
    where: { id: unlock.id },
    data: {
      creditTypeBreakdown: toJson(creditBreakdown(debitResult.ledgerEntries)),
    },
  })

  if (lead.status === 'SENT') {
    await tx.lead.update({
      where: { id: lead.id },
      data: { status: 'VIEWED' },
    })
  }

  console.info('[lead-unlocks] lead unlock committed', {
    trace_id: traceId,
    provider_id: providerId,
    provider_status: lead.provider.status,
    provider_credit_balance: debitResult.wallet.paidCreditBalance + debitResult.wallet.promoCreditBalance,
    lead_id: lead.id,
    lead_ref: lead.id.slice(-8).toUpperCase(),
    lead_status: lead.status,
    already_unlocked: false,
    source: context.source ?? 'api',
    result: 'UNLOCKED',
    error_code: null,
    credit_transaction_id: debitResult.ledgerEntries.at(-1)?.id ?? null,
  })

  return {
    unlock: updatedUnlock,
    ledgerEntries: debitResult.ledgerEntries,
    alreadyUnlocked: false,
  }
}
