/**
 * Dry-run diagnostic for leads stuck in PROVIDER_ACCEPTED / CREDIT_REQUIRED
 * with no LeadUnlock and no LEAD_UNLOCK_DEBIT ledger entry. These are the
 * "broken acceptance" rows produced by the pre-fix selected-provider-acceptance
 * flow that moved the lead out of CUSTOMER_SELECTED before checking credits.
 *
 * Read-only. Run with:
 *   pnpm tsx scripts/diagnose-stuck-credit-required-leads.ts
 *
 * Optional flags:
 *   --provider <providerId>   Restrict the scan to a single provider
 *   --since <ISO>             Only inspect rows respondedAt >= this timestamp
 *
 * Output is a structured report:
 *   - Per-lead row: providerId, leadId, jobRequestId, current statuses, balances,
 *     whether a Match/Quote already exists, whether the customer was notified.
 *   - Remediation suggestion per lead, based on observed state.
 *
 * This script DOES NOT mutate any production data. Any repair must be approved
 * explicitly via a separate, idempotent migration (see prisma/migrations).
 */
import { db } from '../lib/db'

type Args = {
  providerId?: string
  since?: Date
}

function parseArgs(): Args {
  const args = process.argv.slice(2)
  const out: Args = {}
  for (let i = 0; i < args.length; i += 1) {
    const a = args[i]
    if (a === '--provider') out.providerId = args[i + 1]
    if (a === '--since') {
      const v = new Date(args[i + 1])
      if (!Number.isNaN(v.getTime())) out.since = v
    }
  }
  return out
}

async function main() {
  const { providerId, since } = parseArgs()

  const stuckLeads = await db.lead.findMany({
    where: {
      status: { in: ['PROVIDER_ACCEPTED', 'CREDIT_REQUIRED'] },
      ...(providerId ? { providerId } : {}),
      ...(since ? { respondedAt: { gte: since } } : {}),
    },
    select: {
      id: true,
      status: true,
      providerId: true,
      jobRequestId: true,
      providerAcceptedAt: true,
      respondedAt: true,
      expiresAt: true,
      cancelledAt: true,
      unlock: { select: { id: true } },
      provider: { select: { name: true, phone: true } },
      jobRequest: {
        select: {
          status: true,
          selectedProviderId: true,
          selectedLeadInviteId: true,
          customer: { select: { name: true, phone: true } },
          match: { select: { id: true } },
        },
      },
    },
    orderBy: { respondedAt: 'desc' },
    take: 500,
  })

  if (stuckLeads.length === 0) {
    console.log('No stuck PROVIDER_ACCEPTED / CREDIT_REQUIRED leads found.')
    return
  }

  console.log(`Found ${stuckLeads.length} candidate lead(s) in PROVIDER_ACCEPTED / CREDIT_REQUIRED:`)

  const summary: Array<{
    leadId: string
    providerId: string
    providerName: string | null
    providerPhone: string | null
    leadStatus: string
    jobRequestId: string
    jobRequestStatus: string
    customerName: string | null
    customerPhone: string | null
    hasLeadUnlock: boolean
    hasLedgerDebit: boolean
    hasMatch: boolean
    notifiedCustomer: boolean
    recommendation: string
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

    const customerLockMsg = await db.messageEvent.findFirst({
      where: {
        templateName: 'mvp1_accepted_lock_customer_confirmation',
        status: { in: ['QUEUED', 'SENT', 'DELIVERED', 'READ'] },
        metadata: {
          path: ['leadId'],
          equals: lead.id,
        },
      },
      select: { id: true },
    }).catch(() => null)

    const hasLeadUnlock = Boolean(lead.unlock)
    const hasLedgerDebit = Boolean(debit)
    const hasMatch = Boolean(lead.jobRequest.match)
    const notifiedCustomer = Boolean(customerLockMsg)

    let recommendation = 'INVESTIGATE'
    if (!hasLeadUnlock && !hasLedgerDebit && !hasMatch && !notifiedCustomer) {
      recommendation =
        lead.jobRequest.status === 'PROVIDER_CONFIRMATION_PENDING' &&
        lead.jobRequest.selectedProviderId === lead.providerId &&
        lead.jobRequest.selectedLeadInviteId === lead.id
          ? 'SAFE_TO_ROLL_BACK_TO_CUSTOMER_SELECTED'
          : 'INVESTIGATE'
    } else if (hasLeadUnlock && hasLedgerDebit) {
      recommendation = 'CREDIT_ALREADY_APPLIED_RESUME_LOCK'
    } else if (hasLedgerDebit && !hasLeadUnlock) {
      recommendation = 'LEDGER_WITHOUT_UNLOCK_INVESTIGATE'
    }

    summary.push({
      leadId: lead.id,
      providerId: lead.providerId,
      providerName: lead.provider?.name ?? null,
      providerPhone: lead.provider?.phone ?? null,
      leadStatus: lead.status,
      jobRequestId: lead.jobRequestId,
      jobRequestStatus: lead.jobRequest.status,
      customerName: lead.jobRequest.customer?.name ?? null,
      customerPhone: lead.jobRequest.customer?.phone ?? null,
      hasLeadUnlock,
      hasLedgerDebit,
      hasMatch,
      notifiedCustomer,
      recommendation,
    })
  }

  console.table(summary)

  const safeToRollback = summary.filter((s) => s.recommendation === 'SAFE_TO_ROLL_BACK_TO_CUSTOMER_SELECTED')
  console.log(`\nSafe-to-roll-back candidates: ${safeToRollback.length}`)
  if (safeToRollback.length > 0) {
    console.log(JSON.stringify(safeToRollback.map((s) => s.leadId), null, 2))
  }

  const investigate = summary.filter((s) => s.recommendation !== 'SAFE_TO_ROLL_BACK_TO_CUSTOMER_SELECTED')
  if (investigate.length > 0) {
    console.log(`\nManual investigation required for ${investigate.length} lead(s):`)
    for (const row of investigate) {
      console.log(` - leadId=${row.leadId} reason=${row.recommendation}`)
    }
  }
}

main()
  .catch((error) => {
    console.error(error)
    process.exit(1)
  })
  .finally(async () => {
    await db.$disconnect()
  })
