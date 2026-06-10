/**
 * Daily Provider Acquisition & Onboarding Funnel Report
 *
 * Usage:
 *   pnpm tsx scripts/daily-provider-funnel-report.ts
 *   pnpm tsx scripts/daily-provider-funnel-report.ts --ad-spend 617
 *   pnpm tsx scripts/daily-provider-funnel-report.ts --json          # machine-readable output
 *   pnpm tsx scripts/daily-provider-funnel-report.ts --log-openbrain # persist to OpenBrain
 *
 * Flags:
 *   --ad-spend <rands>    Meta ad spend in ZAR (ex VAT) — enables full cost calc
 *   --json                Emit raw JSON (pipe to generate_report_docx.py)
 *   --log-openbrain       Write report to OpenBrain knowledge base after generating
 */

import { db } from '../lib/db'
import { spawnSync } from 'child_process'

// ── Infrastructure cost constants ─────────────────────────────────────────────
const COSTS = {
  vercelMonthlyZAR:              365,   // Vercel Pro $20/month at ~R18.25/USD
  supabaseMonthlyZAR:            456,   // Supabase Pro $25/month
  whatsappPerConvUSD:            0.042, // Meta WA utility template rate, SA
  usdToZAR:                      18.25,
  vercelOnboardingAllocation:    0.40,
  supabaseOnboardingAllocation:  0.40,
  diditPerVerificationUSD:       1.50,
}

const REGISTRATION_STAGES = [
  { step: 'reg_collect_name',          label: 'Name entry' },
  { step: 'reg_collect_id',            label: 'ID verification start' },
  { step: 'reg_verify_enter_id',       label: 'ID number entry' },
  { step: 'reg_verify_upload_doc',     label: 'ID document upload' },
  { step: 'reg_collect_skills',        label: 'Skills selection' },
  { step: 'reg_collect_skills_more',   label: 'Skills confirmation' },
  { step: 'reg_collect_region',        label: 'Region selection' },
  { step: 'reg_collect_city',          label: 'City selection' },
  { step: 'reg_collect_suburb_select', label: 'Suburb selection' },
  { step: 'reg_collect_rates',         label: 'Rate setting' },
  { step: 'reg_collect_availability',  label: 'Availability' },
  { step: 'reg_collect_bio',           label: 'Bio entry' },
  { step: 'reg_collect_experience',    label: 'Experience' },
  { step: 'reg_collect_hourly_rate',   label: 'Hourly rate' },
  { step: 'reg_collect_profile_photo', label: 'Profile photo' },
  { step: 'reg_collect_evidence',      label: 'Evidence upload' },
  { step: 'reg_collect_reference1',    label: 'Reference entry' },
  { step: 'reg_edit_field',            label: 'Field edit' },
  { step: 'reg_pending',               label: 'Submitted, pending review' },
]

const POST_APPROVAL_STAGES = [
  { step: 'pj_toggle_available',            label: 'Toggle available (not yet live)' },
  { step: 'pj_redeem_voucher_awaiting_code', label: 'Voucher code entry' },
  { step: 'pj_credits',                      label: 'Credits step' },
]

function parseArgs() {
  const args = process.argv.slice(2)
  const adSpendIdx = args.indexOf('--ad-spend')
  return {
    adSpendZAR:   adSpendIdx >= 0 && args[adSpendIdx + 1] ? parseFloat(args[adSpendIdx + 1]) : null,
    logOpenBrain: args.includes('--log-openbrain'),
    json:         args.includes('--json'),
  }
}

function pad(s: string | number, w: number) { return String(s).padStart(w) }
function pct(n: number, d: number) { return d === 0 ? '—' : (n / d * 100).toFixed(1) + '%' }

async function main() {
  const args = parseArgs()
  const today = new Date().toISOString().split('T')[0]

  const [
    totalProviders, approvedActive, testUsers,
    appApproved, appPending, appMoreInfo, appRejected, totalApps,
    kycBreakdown, convByFlowStep,
    uniquePhones, uniqueWaSenders, totalMsgEvents, totalInboundWa,
    availabilityStates, kycVerifiedCount,
  ] = await Promise.all([
    db.provider.count({ where: { isTestUser: false } }),
    db.provider.count({ where: { isTestUser: false, status: 'ACTIVE', verified: true } }),
    db.provider.count({ where: { isTestUser: true } }),
    db.providerApplication.count({ where: { isTestUser: false, status: 'APPROVED' } }),
    db.providerApplication.count({ where: { isTestUser: false, status: 'PENDING' } }),
    db.providerApplication.count({ where: { isTestUser: false, status: 'MORE_INFO_REQUIRED' } }),
    db.providerApplication.count({ where: { isTestUser: false, status: { in: ['REJECTED', 'CANCELLED'] } } }),
    db.providerApplication.count({ where: { isTestUser: false } }),
    db.provider.groupBy({ by: ['kycStatus'], where: { isTestUser: false }, _count: { id: true } }),
    db.$queryRaw<Array<{ flow: string; step: string; cnt: number }>>`
      SELECT flow, step, COUNT(*)::int as cnt
      FROM conversations
      WHERE "isTestSession" = false OR "isTestSession" IS NULL
      GROUP BY flow, step ORDER BY cnt DESC
    `,
    db.$queryRaw<Array<{ cnt: number }>>`
      SELECT COUNT(DISTINCT phone)::int as cnt FROM conversations
      WHERE "isTestSession" = false OR "isTestSession" IS NULL
    `,
    db.$queryRaw<Array<{ cnt: number }>>`SELECT COUNT(DISTINCT phone)::int as cnt FROM inbound_whatsapp_messages`,
    db.messageEvent.count(),
    db.$queryRaw<Array<{ cnt: number }>>`SELECT COUNT(*)::int as cnt FROM inbound_whatsapp_messages`,
    db.technicianAvailability.groupBy({
      by: ['availabilityState'], _count: { id: true },
      where: { provider: { isTestUser: false } },
    }),
    db.provider.count({ where: { isTestUser: false, kycStatus: 'VERIFIED' } }),
  ])

  // ── Derived values ─────────────────────────────────────────────────────────
  const engaged   = uniquePhones[0]?.cnt ?? 0
  const totalWaSenders = uniqueWaSenders[0]?.cnt ?? 0
  const inboundMsgCount = totalInboundWa[0]?.cnt ?? 0

  const convMap = new Map<string, number>()
  let idleCount = 0, registrationStuck = 0, postApprovalStuck = 0

  for (const row of convByFlowStep) {
    convMap.set(`${row.flow}::${row.step}`, row.cnt)
    if (row.flow === 'idle')             idleCount          += row.cnt
    if (row.flow === 'registration')     registrationStuck  += row.cnt
    if (row.flow === 'provider_journey') postApprovalStuck  += row.cnt
  }

  const submitted   = totalApps
  const progressed  = registrationStuck + submitted

  // ── Cost ──────────────────────────────────────────────────────────────────
  const waCostZAR    = engaged * COSTS.whatsappPerConvUSD * COSTS.usdToZAR
  const vercelZAR    = COSTS.vercelMonthlyZAR  * COSTS.vercelOnboardingAllocation
  const supabaseZAR  = COSTS.supabaseMonthlyZAR * COSTS.supabaseOnboardingAllocation
  const diditZAR     = kycVerifiedCount * COSTS.diditPerVerificationUSD * COSTS.usdToZAR
  const infraTotal   = waCostZAR + vercelZAR + supabaseZAR + diditZAR
  const infraPerProv = approvedActive > 0 ? infraTotal / approvedActive : 0
  const adSpend      = args.adSpendZAR
  const adPerProv    = adSpend !== null && approvedActive > 0 ? adSpend / approvedActive : null
  const totalPerProv = adPerProv !== null ? infraPerProv + adPerProv : null

  // ── Stage breakdowns ──────────────────────────────────────────────────────
  const regStages = REGISTRATION_STAGES
    .map(s => ({ ...s, count: convMap.get(`registration::${s.step}`) ?? 0 }))
    .filter(s => s.count > 0)

  const postApprStages = POST_APPROVAL_STAGES
    .map(s => ({ ...s, count: convMap.get(`provider_journey::${s.step}`) ?? 0 }))
    .filter(s => s.count > 0)

  const availMap = Object.fromEntries(availabilityStates.map(a => [a.availabilityState, a._count.id]))
  const kycMap   = Object.fromEntries(kycBreakdown.map(k => [k.kycStatus ?? 'null', k._count.id]))

  // ── JSON output ───────────────────────────────────────────────────────────
  if (args.json) {
    const data = {
      date: today,
      funnel: { engaged, progressed, submitted, approved: appApproved, active: approvedActive, fullyAvailable: availMap['AVAILABLE'] ?? 0 },
      registrationDropOff: {
        idle: idleCount,
        stages: regStages,
        completed: submitted,
        totalStuck: registrationStuck,
      },
      postApprovalStuck: { total: postApprovalStuck, stages: postApprStages },
      applications: { approved: appApproved, moreInfo: appMoreInfo, pending: appPending, rejected: appRejected, total: submitted },
      kyc: { verified: kycVerifiedCount, total: approvedActive, breakdown: kycMap },
      availability: availMap,
      platform: { conversations: engaged, uniqueWaSenders: totalWaSenders, inboundMessages: inboundMsgCount, messageEvents: totalMsgEvents },
      costs: {
        whatsappZAR: parseFloat(waCostZAR.toFixed(2)),
        vercelZAR:   parseFloat(vercelZAR.toFixed(2)),
        supabaseZAR: parseFloat(supabaseZAR.toFixed(2)),
        diditZAR:    parseFloat(diditZAR.toFixed(2)),
        infraTotal:  parseFloat(infraTotal.toFixed(2)),
        infraPerProvider: parseFloat(infraPerProv.toFixed(2)),
        adSpend,
        adPerProvider: adPerProv !== null ? parseFloat(adPerProv.toFixed(2)) : null,
        totalPerProvider: totalPerProv !== null ? parseFloat(totalPerProv.toFixed(2)) : null,
      },
      testUsersExcluded: testUsers,
    }
    console.log(JSON.stringify(data, null, 2))
    return data
  }

  // ── Formatted text output ─────────────────────────────────────────────────
  const sep = '─'.repeat(60)
  const lines: string[] = [
    '',
    '╔══════════════════════════════════════════════════════════╗',
    '║  PLUG A PRO — PROVIDER ACQUISITION & ONBOARDING REPORT  ║',
    `║  Generated: ${today.padEnd(46)}║`,
    '╚══════════════════════════════════════════════════════════╝',
    '',
    '── ACQUISITION FUNNEL ──────────────────────────────────────',
    '',
    `  ${'Stage'.padEnd(36)} ${'Count'.padStart(7)}  ${'Conv %'.padStart(8)}`,
    `  ${'─'.repeat(36)} ${'─'.repeat(7)}  ${'─'.repeat(8)}`,
    `  ${'Unique WA numbers engaged'.padEnd(36)} ${pad(engaged, 7)}  ${'100%'.padStart(8)}`,
    `  ${'Progressed past welcome'.padEnd(36)} ${pad(progressed, 7)}  ${pad(pct(progressed, engaged), 8)}`,
    `  ${'Submitted application'.padEnd(36)} ${pad(submitted, 7)}  ${pad(pct(submitted, progressed), 8)}`,
    `  ${'Approved'.padEnd(36)} ${pad(appApproved, 7)}  ${pad(pct(appApproved, submitted), 8)}`,
    `  ${'Active + verified'.padEnd(36)} ${pad(approvedActive, 7)}  ${pad(pct(approvedActive, appApproved), 8)}`,
    `  ${'Fully available (live for leads)'.padEnd(36)} ${pad(availMap['AVAILABLE'] ?? 0, 7)}  ${pad(pct(availMap['AVAILABLE'] ?? 0, approvedActive), 8)}`,
    '',
    '── REGISTRATION DROP-OFF ───────────────────────────────────',
    '',
    `  ${'Stage'.padEnd(36)} ${'Stuck'.padStart(7)}  ${'% engaged'.padStart(10)}`,
    `  ${'─'.repeat(36)} ${'─'.repeat(7)}  ${'─'.repeat(10)}`,
    `  ${'Idle / welcome (never started)'.padEnd(36)} ${pad(idleCount, 7)}  ${pad(pct(idleCount, engaged), 10)}`,
  ]

  for (const s of regStages) {
    lines.push(`  ${s.label.padEnd(36)} ${pad(s.count, 7)}  ${pad(pct(s.count, engaged), 10)}`)
  }

  lines.push(
    `  ${'Completed registration'.padEnd(36)} ${pad(submitted, 7)}  ${pad(pct(submitted, engaged), 10)}`,
    '',
    '── APPLICATION OUTCOMES ────────────────────────────────────',
    '',
    `  ${'Approved'.padEnd(30)} ${pad(appApproved, 7)}  ${pad(pct(appApproved, submitted), 12)}`,
    `  ${'More info required'.padEnd(30)} ${pad(appMoreInfo, 7)}  ${pad(pct(appMoreInfo, submitted), 12)}`,
    `  ${'Pending review'.padEnd(30)} ${pad(appPending, 7)}  ${pad(pct(appPending, submitted), 12)}`,
    `  ${'Rejected / Cancelled'.padEnd(30)} ${pad(appRejected, 7)}  ${pad(pct(appRejected, submitted), 12)}`,
    '',
    '── POST-APPROVAL ACTIVATION ────────────────────────────────',
    '',
    `  ${'Fully available'.padEnd(36)} ${pad(availMap['AVAILABLE'] ?? 0, 7)}  ${pad(pct(availMap['AVAILABLE'] ?? 0, approvedActive), 11)}`,
  )

  for (const s of postApprStages) {
    lines.push(`  ${'↳ ' + s.label.padEnd(34)} ${pad(s.count, 7)}  ${pad(pct(s.count, approvedActive), 11)}`)
  }

  lines.push(
    '',
    '── COST PER PROVIDER ───────────────────────────────────────',
    '',
    `  ${'WhatsApp API'.padEnd(38)} ${pad('R' + waCostZAR.toFixed(0), 10)}  ${pad('R' + infraPerProv.toFixed(2), 12)}`,
    `  ${'Vercel Pro (40%)'.padEnd(38)} ${pad('R' + vercelZAR.toFixed(0), 10)}  —`,
    `  ${'Supabase Pro (40%)'.padEnd(38)} ${pad('R' + supabaseZAR.toFixed(0), 10)}  —`,
    `  ${'Didit KYC'.padEnd(38)} ${pad('R' + diditZAR.toFixed(0), 10)}  —`,
    `  ${'Infrastructure subtotal'.padEnd(38)} ${pad('R' + infraTotal.toFixed(0), 10)}  ${pad('R' + infraPerProv.toFixed(2), 12)}`,
    `  ${'Meta ad spend'.padEnd(38)} ${pad(adSpend !== null ? 'R' + adSpend : '⚠ not set', 10)}  ${pad(adPerProv !== null ? 'R' + adPerProv.toFixed(2) : '—', 12)}`,
    `  ${'TOTAL'.padEnd(38)} ${pad('', 10)}  ${totalPerProv !== null ? pad('R' + totalPerProv.toFixed(2), 12) : '⚠ add --ad-spend'}`,
    '',
    sep,
    '',
  )

  const report = lines.join('\n')
  console.log(report)

  if (args.logOpenBrain) {
    const obPath = '/Users/shimane/Library/CloudStorage/Dropbox/KgolaEntle Holdings/Solutions/Projects/MobileApps/OpenBrain/backend'
    const title  = `report — provider acquisition funnel + onboarding cost analysis (${today})`
    const result = spawnSync(
      'pnpm',
      ['brain', '--', 'knowledge', 'add',
        '--project', 'PlugAPro', '--domain', 'engineering',
        '--title', title,
        '--tags', 'provider-acquisition,funnel,cost-analysis,daily-report,domain:engineering',
        '--content', report,
      ],
      { cwd: obPath, stdio: 'inherit', encoding: 'utf8' }
    )
    if (result.status !== 0) console.error('⚠ OpenBrain log failed')
    else console.log('✓ Logged to OpenBrain')
  }
}

main()
  .catch(e => { console.error(e); process.exit(1) })
  .finally(() => db.$disconnect())
