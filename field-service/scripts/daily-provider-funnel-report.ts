// Daily Provider Acquisition & Onboarding Funnel Report
// Tracks the full funnel from application submission → approval → account creation → KYC → live for leads.
//
// Usage:
//   pnpm tsx scripts/daily-provider-funnel-report.ts
//   pnpm tsx scripts/daily-provider-funnel-report.ts --json

import { db } from '../lib/db'

const JSON_OUTPUT = process.argv.includes('--json')

// Infrastructure cost estimate (ZAR/month). Override via env var.
const MONTHLY_INFRA_ZAR = Number(process.env.MONTHLY_INFRA_COST_ZAR ?? 1800)

async function main() {
  const today = new Date()
  const thirtyDaysAgo = new Date(today.getTime() - 30 * 24 * 60 * 60_000)

  // ── Applications ──────────────────────────────────────────────────────────
  const [appTotal, appPending, appApproved, appRejected, appCancelled, appMoreInfo, appLast30] =
    await Promise.all([
      db.providerApplication.count({ where: { isTestUser: false } }),
      db.providerApplication.count({ where: { isTestUser: false, status: 'PENDING' } }),
      db.providerApplication.count({ where: { isTestUser: false, status: 'APPROVED' } }),
      db.providerApplication.count({ where: { isTestUser: false, status: 'REJECTED' } }),
      db.providerApplication.count({ where: { isTestUser: false, status: 'CANCELLED' } }),
      db.providerApplication.count({ where: { isTestUser: false, status: 'MORE_INFO_REQUIRED' } }),
      db.providerApplication.count({
        where: { isTestUser: false, submittedAt: { gte: thirtyDaysAgo } },
      }),
    ])

  // ── Providers (post-approval onboarding) ─────────────────────────────────
  const [
    providerTotal,
    providerWithAccount,
    providerVerified,
    providerFullyAvailable,
    kycNotStarted,
    kycInProgress,
    kycSubmitted,
    kycVerified,
    kycRejected,
  ] = await Promise.all([
    db.provider.count({ where: { isTestUser: false } }),
    db.provider.count({ where: { isTestUser: false, userId: { not: null } } }),
    db.provider.count({ where: { isTestUser: false, verified: true } }),
    db.provider.count({
      where: {
        isTestUser: false,
        active: true,
        verified: true,
        availableNow: true,
        status: 'ACTIVE',
        archivedAt: null,
      },
    }),
    db.provider.count({ where: { isTestUser: false, kycStatus: 'NOT_STARTED' } }),
    db.provider.count({ where: { isTestUser: false, kycStatus: 'IN_PROGRESS' } }),
    db.provider.count({ where: { isTestUser: false, kycStatus: 'SUBMITTED' } }),
    db.provider.count({ where: { isTestUser: false, kycStatus: 'VERIFIED' } }),
    db.provider.count({ where: { isTestUser: false, kycStatus: 'REJECTED' } }),
  ])

  // Post-approval stuck: have a Provider record but aren't fully live
  const postApprovalTotal = providerTotal
  const noAccount = providerTotal - providerWithAccount
  const accountButKycNotStarted = await db.provider.count({
    where: { isTestUser: false, userId: { not: null }, kycStatus: 'NOT_STARTED' },
  })
  const kycInProgressOrSubmitted = kycInProgress + kycSubmitted
  const kycDoneNotVerified = await db.provider.count({
    where: {
      isTestUser: false,
      kycStatus: { in: ['VERIFIED'] },
      verified: false,
    },
  })
  const postApprovalStuckTotal = postApprovalTotal - providerFullyAvailable

  // Biggest drop-off stage
  const dropOffStages = [
    { stage: 'no_account_created', count: noAccount },
    { stage: 'account_no_kyc', count: accountButKycNotStarted },
    { stage: 'kyc_in_progress', count: kycInProgressOrSubmitted },
    { stage: 'kyc_done_not_verified', count: kycDoneNotVerified },
  ]
  const biggestDropOff = dropOffStages.reduce((max, s) => (s.count > max.count ? s : max), {
    stage: 'none',
    count: 0,
  })

  // ── Costs ─────────────────────────────────────────────────────────────────
  const infraPerProvider =
    providerFullyAvailable > 0
      ? Math.round((MONTHLY_INFRA_ZAR / providerFullyAvailable) * 100) / 100
      : null

  // ── Build report ──────────────────────────────────────────────────────────
  const report = {
    generatedAt: today.toISOString(),
    reportDate: today.toISOString().slice(0, 10),
    applications: {
      total: appTotal,
      last30Days: appLast30,
      pending: appPending,
      approved: appApproved,
      rejected: appRejected,
      cancelled: appCancelled,
      moreInfoRequired: appMoreInfo,
      approvalRate: appTotal > 0 ? Math.round((appApproved / appTotal) * 10000) / 100 : 0,
    },
    providers: {
      total: providerTotal,
      withAccount: providerWithAccount,
      verified: providerVerified,
    },
    fullyAvailable: providerFullyAvailable,
    kyc: {
      notStarted: kycNotStarted,
      inProgress: kycInProgress,
      submitted: kycSubmitted,
      verified: kycVerified,
      rejected: kycRejected,
      total: providerTotal,
    },
    postApprovalStuck: {
      total: postApprovalStuckTotal,
      noAccount,
      accountButKycNotStarted,
      kycInProgressOrSubmitted,
      kycDoneNotVerified,
      biggestDropOff,
    },
    costs: {
      monthlyInfraZAR: MONTHLY_INFRA_ZAR,
      infraPerProvider,
    },
  }

  if (JSON_OUTPUT) {
    console.log(JSON.stringify(report, null, 2))
    return
  }

  const pct = (n: number, d: number) => (d > 0 ? ((n / d) * 100).toFixed(1) + '%' : 'n/a')

  console.log('Provider Acquisition & Onboarding Funnel Report')
  console.log(`Generated: ${today.toLocaleString('en-ZA', { timeZone: 'Africa/Johannesburg' })}`)
  console.log('')
  console.log('── Applications ──')
  console.log(`  Total all-time:     ${appTotal}`)
  console.log(`  Last 30 days:       ${appLast30}`)
  console.log(`  Pending review:     ${appPending}`)
  console.log(`  Approved:           ${appApproved} (${pct(appApproved, appTotal)})`)
  console.log(`  Rejected:           ${appRejected}`)
  console.log(`  Cancelled:          ${appCancelled}`)
  console.log(`  More info required: ${appMoreInfo}`)
  console.log('')
  console.log('── Provider Onboarding ──')
  console.log(`  Total providers:    ${providerTotal}`)
  console.log(`  Account created:    ${providerWithAccount}`)
  console.log(`  KYC verified:       ${kycVerified} of ${providerTotal}`)
  console.log(`  Verified for leads: ${providerVerified}`)
  console.log(`  Fully live:         ${providerFullyAvailable}`)
  console.log('')
  console.log('── Post-Approval Stuck ──')
  console.log(`  Total stuck:              ${postApprovalStuckTotal}`)
  console.log(`  No account created:       ${noAccount}`)
  console.log(`  Account, KYC not started: ${accountButKycNotStarted}`)
  console.log(`  KYC in progress/submitted:${kycInProgressOrSubmitted}`)
  console.log(`  KYC done, not verified:   ${kycDoneNotVerified}`)
  console.log(`  Biggest drop-off:         ${biggestDropOff.stage} (${biggestDropOff.count})`)
  console.log('')
  console.log('── Costs ──')
  console.log(`  Monthly infra (ZAR):      R${MONTHLY_INFRA_ZAR}`)
  console.log(
    `  Infra per live provider:  ${infraPerProvider != null ? 'R' + infraPerProvider : 'n/a'}`,
  )
}

main()
  .catch((err) => {
    console.error('Provider funnel report failed:', err)
    process.exit(1)
  })
  .finally(() => db.$disconnect())
