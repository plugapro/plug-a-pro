import { Prisma, type LeadUnlock, type WalletLedgerEntry } from '@prisma/client'
import { db } from './db'
import {
  ProviderWalletError,
  debitCreditsForLeadUnlockInTransaction,
} from './provider-wallet'

export const LEAD_UNLOCK_COST_CREDITS = 1

type LeadUnlockErrorCode =
  | 'NOT_FOUND'
  | 'FORBIDDEN'
  | 'KYC_REQUIRED'
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

  if (!['SENT', 'VIEWED', 'ACCEPTED'].includes(lead.status)) {
    throw new LeadUnlockError('LEAD_NOT_AVAILABLE', 'This lead cannot be unlocked.')
  }

  if (lead.status !== 'ACCEPTED' && lead.expiresAt && lead.expiresAt < new Date()) {
    throw new LeadUnlockError('LEAD_NOT_AVAILABLE', 'This lead has expired.')
  }
}

function mapWalletError(error: unknown): never {
  if (error instanceof ProviderWalletError && error.code === 'INSUFFICIENT_FUNDS') {
    throw new LeadUnlockError(
      'INSUFFICIENT_CREDITS',
      'You need at least 1 Plug-A-Pro Credit to unlock this lead.',
    )
  }

  if (error instanceof ProviderWalletError && error.code === 'CONCURRENT_MUTATION') {
    throw new LeadUnlockError(
      'CONCURRENT_UNLOCK',
      'Your credit balance changed while unlocking this lead. Please try again.',
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

  try {
    const result = await db.$transaction(async (tx) => {
      const lead = await tx.lead.findUnique({
        where: { id: leadId },
        include: {
          provider: {
            select: {
              id: true,
              kycStatus: true,
              isTestUser: true,
            },
          },
          jobRequest: {
            select: {
              id: true,
              status: true,
              isTestRequest: true,
              cohortName: true,
              match: { select: { id: true, providerId: true } },
            },
          },
        },
      })

      if (!lead) throw new LeadUnlockError('NOT_FOUND', 'Lead not found.')
      if (lead.providerId !== providerId) {
        throw new LeadUnlockError('FORBIDDEN', 'This lead belongs to another provider.')
      }
      if (lead.provider.kycStatus !== 'VERIFIED') {
        throw new LeadUnlockError(
          'KYC_REQUIRED',
          'KYC must be approved before unlocking full customer details.',
        )
      }
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
      if (currentCreditBalance < LEAD_UNLOCK_COST_CREDITS) {
        throw new LeadUnlockError(
          'INSUFFICIENT_CREDITS',
          'You need at least 1 Plug-A-Pro Credit to unlock this lead.',
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

      let debitResult
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
              jobRequestId: lead.jobRequestId,
              ...(lead.jobRequest.cohortName ? { testCohort: lead.jobRequest.cohortName } : {}),
            },
            createdBy: providerId,
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

  const lead = await tx.lead.findUnique({
    where: { id: leadId },
    include: {
      provider: {
        select: {
          id: true,
          kycStatus: true,
          isTestUser: true,
        },
      },
      jobRequest: {
        select: {
          id: true,
          status: true,
          isTestRequest: true,
          cohortName: true,
          match: { select: { id: true, providerId: true } },
        },
      },
    },
  })

  if (!lead) throw new LeadUnlockError('NOT_FOUND', 'Lead not found.')
  if (lead.providerId !== providerId) {
    throw new LeadUnlockError('FORBIDDEN', 'This lead belongs to another provider.')
  }
  if (lead.provider.kycStatus !== 'VERIFIED') {
    throw new LeadUnlockError(
      'KYC_REQUIRED',
      'KYC must be approved before unlocking full customer details.',
    )
  }
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
  if (currentCreditBalance < LEAD_UNLOCK_COST_CREDITS) {
    throw new LeadUnlockError(
      'INSUFFICIENT_CREDITS',
      'You need at least 1 Plug-A-Pro Credit to unlock this lead.',
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

  let debitResult
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
          jobRequestId: lead.jobRequestId,
          ...(lead.jobRequest.cohortName ? { testCohort: lead.jobRequest.cohortName } : {}),
        },
        createdBy: providerId,
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

  return {
    unlock: updatedUnlock,
    ledgerEntries: debitResult.ledgerEntries,
    alreadyUnlocked: false,
  }
}
