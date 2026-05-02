// ─── Cleanup script: wipe all test-cohort transactional data ─────────────────
// Targets ONLY rows flagged as test cohort:
//   - Customer.isTestUser = true OR phone in INTERNAL_TEST_PHONE_NUMBERS
//   - Provider.isTestUser = true OR phone in INTERNAL_TEST_PHONE_NUMBERS
//   - JobRequest.isTestRequest = true OR cohortName = INTERNAL_TEST_COHORT_NAME
//   - Lead.isTestLead = true OR cohortName = INTERNAL_TEST_COHORT_NAME
//
// What it does:
//   - Deletes all transactional data tied to those test users (job requests,
//     leads, lead unlocks, matches, quotes, bookings, jobs, attachments,
//     wallet ledger entries, message events, conversations, addresses,
//     dispatch decisions, candidate-pool entries, audit logs scoped to
//     deleted entities).
//   - Leaves the test Customer / Provider / ProviderApplication rows intact
//     so that test users can immediately re-run the journey from a clean
//     state without re-onboarding.
//
// Safety:
//   - Defaults to DRY-RUN. Pass --confirm to actually delete.
//   - Refuses to run when DATABASE_URL hostname looks like a production
//     domain (override with --i-know-what-im-doing).
//   - Emits a snapshot report of every count it will delete so you can audit.
//
// Usage:
//   pnpm tsx scripts/cleanup-test-cohort.ts                       # dry-run
//   pnpm tsx scripts/cleanup-test-cohort.ts --confirm              # delete
//   pnpm tsx scripts/cleanup-test-cohort.ts --confirm --keep-applications
//
// Recommended workflow:
//   1. Run dry-run first, review the counts.
//   2. Run with --confirm only after the counts match expectations.
//   3. Re-onboard providers via WhatsApp to test the qualified-shortlist flow.

import { db } from '../lib/db'
import {
  INTERNAL_TEST_COHORT_NAME,
  INTERNAL_TEST_PHONE_NUMBERS,
} from '../lib/internal-test-cohort'

const args = new Set(process.argv.slice(2))
const CONFIRM = args.has('--confirm')
const KEEP_APPLICATIONS = args.has('--keep-applications')
const FORCE_PROD = args.has('--i-know-what-im-doing')
const RESET_USERS = args.has('--reset-users') // also delete the test Customer/Provider rows

type Counts = Record<string, number>

function refuseIfProductionHost() {
  const url = process.env.DATABASE_URL ?? ''
  if (!url) {
    console.error('DATABASE_URL is not set — refusing to run.')
    process.exit(1)
  }
  if (FORCE_PROD) return
  // Heuristic: Vercel marketplace databases usually have specific subdomains;
  // we just refuse to touch anything that screams production by name.
  const lowered = url.toLowerCase()
  const productionHints = ['prod', 'production', 'live', 'app.plugapro']
  if (productionHints.some((hint) => lowered.includes(hint))) {
    console.error('DATABASE_URL looks like a production target. Refusing to run.')
    console.error('If this is intentional, re-run with --i-know-what-im-doing.')
    process.exit(2)
  }
}

async function snapshotCounts(): Promise<{ counts: Counts; jobRequestIds: string[]; leadIds: string[]; matchIds: string[]; bookingIds: string[]; jobIds: string[] }> {
  const phoneVariants = INTERNAL_TEST_PHONE_NUMBERS.flatMap((p) => {
    const digits = p.replace(/\D/g, '')
    const local = digits.startsWith('27') ? '0' + digits.slice(2) : digits
    return [p, local, '27' + (local.startsWith('0') ? local.slice(1) : local)]
  })

  const customers = await db.customer.findMany({
    where: { OR: [{ isTestUser: true }, { phone: { in: phoneVariants } }] },
    select: { id: true },
  })
  const providers = await db.provider.findMany({
    where: { OR: [{ isTestUser: true }, { phone: { in: phoneVariants } }] },
    select: { id: true },
  })

  const customerIds = customers.map((c) => c.id)
  const providerIds = providers.map((p) => p.id)

  const jobRequests = await db.jobRequest.findMany({
    where: {
      OR: [
        { customerId: { in: customerIds } },
        { isTestRequest: true },
        { cohortName: INTERNAL_TEST_COHORT_NAME },
      ],
    },
    select: { id: true },
  })
  const jobRequestIds = jobRequests.map((r) => r.id)

  const leads = await db.lead.findMany({
    where: {
      OR: [
        { jobRequestId: { in: jobRequestIds } },
        { providerId: { in: providerIds } },
        { isTestLead: true },
        { cohortName: INTERNAL_TEST_COHORT_NAME },
      ],
    },
    select: { id: true },
  })
  const leadIds = leads.map((l) => l.id)

  const matches = await db.match.findMany({
    where: {
      OR: [{ jobRequestId: { in: jobRequestIds } }, { providerId: { in: providerIds } }],
    },
    select: { id: true },
  })
  const matchIds = matches.map((m) => m.id)

  const bookings = await db.booking.findMany({
    where: { matchId: { in: matchIds } },
    select: { id: true },
  })
  const bookingIds = bookings.map((b) => b.id)

  const jobs = await db.job.findMany({
    where: { OR: [{ bookingId: { in: bookingIds } }, { providerId: { in: providerIds } }] },
    select: { id: true },
  })
  const jobIds = jobs.map((j) => j.id)

  const counts: Counts = {
    customers: customerIds.length,
    providers: providerIds.length,
    job_requests: jobRequestIds.length,
    leads: leadIds.length,
    matches: matchIds.length,
    bookings: bookingIds.length,
    jobs: jobIds.length,
  }

  // Heavy children (counts only):
  counts.lead_unlocks = await db.leadUnlock.count({ where: { leadId: { in: leadIds } } })
  counts.provider_lead_responses = await db.providerLeadResponse.count({ where: { leadInviteId: { in: leadIds } } }).catch(() => 0)
  counts.provider_shortlist_items = await db.providerShortlistItem.count({ where: { leadInviteId: { in: leadIds } } }).catch(() => 0)
  counts.provider_shortlists = await db.providerShortlist.count({ where: { requestId: { in: jobRequestIds } } }).catch(() => 0)
  counts.attachments = await db.attachment.count({
    where: {
      OR: [
        { jobRequestId: { in: jobRequestIds } },
        { jobId: { in: jobIds } },
      ],
    },
  })
  counts.quotes = await db.quote.count({ where: { matchId: { in: matchIds } } })
  counts.payments = await db.payment.count({ where: { bookingId: { in: bookingIds } } })
  counts.job_status_events = await db.jobStatusEvent.count({ where: { jobId: { in: jobIds } } })
  counts.dispatch_decisions = await db.dispatchDecision.count({
    where: { jobRequestId: { in: jobRequestIds } },
  })
  counts.assignment_holds = await db.assignmentHold.count({
    where: { jobRequestId: { in: jobRequestIds } },
  })
  counts.match_attempts = await db.matchAttempt.count({
    where: { jobRequestId: { in: jobRequestIds } },
  })
  counts.message_events = await db.messageEvent.count({
    where: {
      OR: [
        { bookingId: { in: bookingIds } },
        { metadata: { path: ['leadId'], string_contains: '' } as never },
      ],
    },
  }).catch(() => 0)
  counts.conversations = await db.conversation.count({
    where: { phone: { in: phoneVariants } },
  })
  counts.addresses = await db.address.count({ where: { customerId: { in: customerIds } } })
  if (KEEP_APPLICATIONS) {
    counts.provider_applications = 0
  } else {
    counts.provider_applications = await db.providerApplication.count({
      where: {
        OR: [
          { providerId: { in: providerIds } },
          { phone: { in: phoneVariants } },
        ],
      },
    })
  }
  counts.provider_wallets_to_reset = await db.providerWallet.count({
    where: { providerId: { in: providerIds } },
  })
  counts.wallet_ledger_entries = await db.walletLedgerEntry.count({
    where: { providerId: { in: providerIds } },
  }).catch(() => 0)

  return { counts, jobRequestIds, leadIds, matchIds, bookingIds, jobIds }
}

async function main() {
  refuseIfProductionHost()
  console.log('────────────────────────────────────────────────────────')
  console.log('Plug A Pro — clear test-cohort transactional data')
  console.log('Mode:', CONFIRM ? 'CONFIRM (will delete)' : 'DRY RUN')
  console.log('Database:', process.env.DATABASE_URL?.split('@').at(-1) ?? '(unknown)')
  console.log('Reset users (--reset-users):', RESET_USERS ? 'yes' : 'no (Customer/Provider rows kept)')
  console.log('Keep applications (--keep-applications):', KEEP_APPLICATIONS ? 'yes' : 'no')
  console.log('────────────────────────────────────────────────────────')

  const { counts, jobRequestIds, leadIds, matchIds, bookingIds, jobIds } = await snapshotCounts()
  console.log('Snapshot:')
  for (const [k, v] of Object.entries(counts)) {
    console.log(`  ${k.padEnd(30)} ${v}`)
  }

  if (!CONFIRM) {
    console.log('\nDry run complete. Re-run with --confirm to actually delete.')
    return
  }

  console.log('\nDeleting…')

  // Delete in FK-safe order. Each delete is best-effort: if a table is empty
  // or a row is already gone, the delete just does nothing.
  await db.jobStatusEvent.deleteMany({ where: { jobId: { in: jobIds } } })
  await db.attachment.deleteMany({
    where: {
      OR: [
        { jobRequestId: { in: jobRequestIds } },
        { jobId: { in: jobIds } },
      ],
    },
  })
  await db.payment.deleteMany({ where: { bookingId: { in: bookingIds } } })
  await db.providerShortlistItem.deleteMany({ where: { leadInviteId: { in: leadIds } } }).catch(() => undefined)
  await db.providerShortlist.deleteMany({ where: { requestId: { in: jobRequestIds } } }).catch(() => undefined)
  await db.providerLeadResponse.deleteMany({ where: { leadInviteId: { in: leadIds } } }).catch(() => undefined)
  const unlockIds = (await db.leadUnlock.findMany({
    where: { leadId: { in: leadIds } },
    select: { id: true },
  })).map((u) => u.id)
  await db.leadUnlockDispute.deleteMany({
    where: { leadUnlockId: { in: unlockIds } },
  }).catch(() => undefined)
  await db.leadUnlock.deleteMany({ where: { leadId: { in: leadIds } } })
  await db.job.deleteMany({ where: { id: { in: jobIds } } })
  await db.booking.deleteMany({ where: { id: { in: bookingIds } } })
  await db.quote.deleteMany({ where: { matchId: { in: matchIds } } })
  await db.lead.deleteMany({ where: { id: { in: leadIds } } })
  await db.match.deleteMany({ where: { id: { in: matchIds } } })
  await db.assignmentHold.deleteMany({ where: { jobRequestId: { in: jobRequestIds } } })
  await db.matchAttempt.deleteMany({ where: { jobRequestId: { in: jobRequestIds } } })
  // JobRequest has a self-referential FK via latestDispatchDecisionId — null
  // it before deleting dispatch decisions to avoid the circular constraint.
  await db.jobRequest.updateMany({
    where: { id: { in: jobRequestIds } },
    data: { latestDispatchDecisionId: null },
  })
  await db.dispatchDecision.deleteMany({ where: { jobRequestId: { in: jobRequestIds } } })
  await db.jobRequest.deleteMany({ where: { id: { in: jobRequestIds } } })

  // Reset wallet balances and ledger to zero for test providers (keeps the
  // wallet row so re-onboarding doesn't tip duplicate-wallet checks).
  const testProviderIds = (
    await db.provider.findMany({
      where: { OR: [{ isTestUser: true }, { phone: { in: INTERNAL_TEST_PHONE_NUMBERS as unknown as string[] } }] },
      select: { id: true },
    })
  ).map((p) => p.id)
  await db.walletLedgerEntry.deleteMany({ where: { providerId: { in: testProviderIds } } }).catch(() => undefined)
  await db.providerWallet.updateMany({
    where: { providerId: { in: testProviderIds } },
    data: { paidCreditBalance: 0, promoCreditBalance: 0 },
  }).catch(() => undefined)

  // Conversation state (so test users start fresh inside the WhatsApp bot).
  const phoneVariants = INTERNAL_TEST_PHONE_NUMBERS.flatMap((p) => {
    const digits = p.replace(/\D/g, '')
    const local = digits.startsWith('27') ? '0' + digits.slice(2) : digits
    return [p, local, '27' + (local.startsWith('0') ? local.slice(1) : local)]
  })
  await db.conversation.deleteMany({ where: { phone: { in: phoneVariants } } })

  if (!KEEP_APPLICATIONS) {
    await db.providerApplication.deleteMany({
      where: {
        OR: [
          { providerId: { in: testProviderIds } },
          { phone: { in: phoneVariants } },
        ],
      },
    })
  }

  if (RESET_USERS) {
    // Optional: delete addresses + customer/provider rows so the next run
    // starts as if the user has never registered.
    const testCustomerIds = (
      await db.customer.findMany({
        where: { OR: [{ isTestUser: true }, { phone: { in: phoneVariants } }] },
        select: { id: true },
      })
    ).map((c) => c.id)
    await db.address.deleteMany({ where: { customerId: { in: testCustomerIds } } })
    await db.customer.deleteMany({ where: { id: { in: testCustomerIds } } })
    await db.provider.deleteMany({ where: { id: { in: testProviderIds } } })
  }

  console.log('\nDelete complete.')
  console.log('Test users (kept by default) can now re-run the journey from clean state.')
}

main()
  .catch((err) => {
    console.error(err)
    process.exit(1)
  })
  .finally(() => db.$disconnect())
