import { db } from '../lib/db'

async function main() {
  const [
    providers,
    providerApplications,
    jobRequests,
    leads,
    leadUnlocks,
    wallets,
  ] = await Promise.all([
    db.provider.count(),
    db.providerApplication.count(),
    db.jobRequest.count(),
    db.lead.count(),
    db.leadUnlock.count(),
    db.providerWallet.count(),
  ])

  const activeSequentialLeads = await db.lead.count({
    where: { status: { in: ['SENT', 'VIEWED'] } },
  })

  const acceptedLeadUnlocks = await db.leadUnlock.count({
    where: { lead: { status: 'ACCEPTED' } },
  })

  console.log(JSON.stringify({
    checkedAt: new Date().toISOString(),
    counts: {
      providers,
      providerApplications,
      jobRequests,
      leads,
      leadUnlocks,
      wallets,
      activeSequentialLeads,
      acceptedLeadUnlocks,
    },
    migrationPlan: [
      'Backfill JobRequest.requestRef from id suffix before exposing customer-facing references.',
      'Backfill Lead.matchScore and Lead.rankingPosition from MatchAttempt when present.',
      'Create ProviderCategory rows from Provider.skills and TechnicianSkill.',
      'Create ProviderRate rows only after rate capture ships; no safe legacy source exists.',
      'Keep existing LeadUnlock rows as historical paid lead unlocks; do not rewrite ledger entries.',
    ],
  }, null, 2))
}

main()
  .catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
  .finally(async () => {
    await db.$disconnect()
  })
