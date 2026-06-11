/**
 * Repair leads stuck in PROVIDER_ACCEPTED / CREDIT_REQUIRED with no LeadUnlock,
 * no LEAD_UNLOCK_DEBIT ledger entry, and no Match. These are the broken rows
 * produced by the pre-fix acceptSelectedProviderJob flow that moved leads out
 * of CUSTOMER_SELECTED before checking credits.
 *
 * Dry-run by default. Pass --apply to mutate.
 *
 *   pnpm tsx scripts/repair-stuck-credit-required-leads.ts                # dry-run
 *   pnpm tsx scripts/repair-stuck-credit-required-leads.ts --apply        # execute
 *
 * Optional flags:
 *   --provider <providerId>   Restrict to a single provider
 *   --lead <leadId>           Restrict to one lead (additive with --provider)
 *
 * Repair, per lead, in a single transaction:
 *   1. Lead.status: PROVIDER_ACCEPTED | CREDIT_REQUIRED -> CUSTOMER_SELECTED
 *      (only if there is no LeadUnlock and no LEAD_UNLOCK_DEBIT ledger entry
 *       and no Match)
 *   2. Lead.providerAcceptedAt -> null, Lead.respondedAt -> null
 *   3. JobRequest stays at PROVIDER_CONFIRMATION_PENDING with selectedProviderId
 *      and selectedLeadInviteId unchanged (so the customer can see the same
 *      shortlist state and the provider can retry after top-up).
 *   4. Append an AuditLog row documenting the repair (actor: system).
 *
 * Idempotent: rows that no longer match the predicate are skipped.
 */
import { Prisma } from '@prisma/client'
import { db } from '../lib/db'

type Args = {
  apply: boolean
  providerId?: string
  leadId?: string
}

function parseArgs(): Args {
  const args = process.argv.slice(2)
  const out: Args = { apply: false }
  for (let i = 0; i < args.length; i += 1) {
    const a = args[i]
    if (a === '--apply') out.apply = true
    if (a === '--provider') out.providerId = args[i + 1]
    if (a === '--lead') out.leadId = args[i + 1]
  }
  return out
}

async function main() {
  const { apply, providerId, leadId } = parseArgs()

  const stuckLeads = await db.lead.findMany({
    where: {
      status: { in: ['PROVIDER_ACCEPTED', 'CREDIT_REQUIRED'] },
      ...(providerId ? { providerId } : {}),
      ...(leadId ? { id: leadId } : {}),
    },
    select: {
      id: true,
      status: true,
      providerId: true,
      jobRequestId: true,
      unlock: { select: { id: true } },
      jobRequest: {
        select: {
          status: true,
          selectedProviderId: true,
          selectedLeadInviteId: true,
          match: { select: { id: true } },
        },
      },
    },
  })

  const candidates: Array<{
    leadId: string
    providerId: string
    fromStatus: string
    jobRequestId: string
  }> = []

  for (const lead of stuckLeads) {
    const debit = await db.walletLedgerEntry.findFirst({
      where: {
        providerId: lead.providerId,
        entryType: 'LEAD_UNLOCK_DEBIT',
        referenceId: lead.id,
      },
      select: { id: true },
    })

    const isJobRequestStillSelectingThisLead =
      lead.jobRequest.status === 'PROVIDER_CONFIRMATION_PENDING' &&
      lead.jobRequest.selectedProviderId === lead.providerId &&
      lead.jobRequest.selectedLeadInviteId === lead.id

    const safe =
      !lead.unlock &&
      !debit &&
      !lead.jobRequest.match &&
      isJobRequestStillSelectingThisLead

    if (safe) {
      candidates.push({
        leadId: lead.id,
        providerId: lead.providerId,
        fromStatus: lead.status,
        jobRequestId: lead.jobRequestId,
      })
    }
  }

  console.log(`Found ${candidates.length} safe-to-roll-back lead(s).`)
  if (candidates.length === 0) {
    return
  }

  console.table(candidates)

  if (!apply) {
    console.log('\nDRY RUN. Re-run with --apply to execute.')
    return
  }

  let rolledBack = 0
  for (const candidate of candidates) {
    await db.$transaction(async (tx) => {
      const update = await tx.lead.updateMany({
        where: {
          id: candidate.leadId,
          status: { in: ['PROVIDER_ACCEPTED', 'CREDIT_REQUIRED'] },
          unlock: { is: null },
        },
        data: {
          status: 'CUSTOMER_SELECTED',
          providerAcceptedAt: null,
          respondedAt: null,
        },
      })

      if (update.count === 0) {
        return
      }

      await tx.auditLog.create({
        data: {
          actorId: candidate.providerId,
          actorRole: 'system',
          action: 'lead.stuck_credit_required_rollback',
          entityType: 'Lead',
          entityId: candidate.leadId,
          before: { status: candidate.fromStatus } as Prisma.InputJsonValue,
          after: {
            status: 'CUSTOMER_SELECTED',
            reason: 'pre-fix acceptance recorded without credits',
          } as Prisma.InputJsonValue,
        },
      })

      rolledBack += 1
    })
  }

  console.log(`Rolled back ${rolledBack} lead(s) to CUSTOMER_SELECTED.`)
}

main()
  .catch((error) => {
    console.error(error)
    process.exit(1)
  })
  .finally(async () => {
    await db.$disconnect()
  })
