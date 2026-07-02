/**
 * CTWA cold-lead recovery campaign.
 *
 * Re-engages provider prospects who arrived from a Click-to-WhatsApp ad and
 * went cold before submitting an application. Two segments:
 *
 *   idle          Phones whose inbound messages carry a provider-recruitment
 *                 `referral` payload but whose conversation never left
 *                 flow=idle (they saw the welcome menu and tapped nothing).
 *                 The standing recovery queue excludes these BY DESIGN
 *                 (hasProviderRegistrationIntent) because without the ad
 *                 referral it can't tell providers from customers — the
 *                 referral classification is what makes this segment safe.
 *   registration  Phones stuck mid-registration. Delegates to the existing
 *                 sendProviderOnboardingRecoveryFollowUps pipeline with a
 *                 campaign-wide lookback (the cron only scans 24h).
 *
 * Safety:
 *   - DRY-RUN by default; pass --commit to send.
 *   - Respects conversation.recoveryClaimedAt (never double-nudges a phone
 *     the recovery layer already claimed).
 *   - Skips phones with an application or provider record, test sessions,
 *     and customers who opted out of WhatsApp messages.
 *   - Sends the Meta-approved UTILITY template provider_recovery_welcome_idle
 *     (outside the 24h session window, freeform text would fail anyway).
 *   - Gated on the whatsapp.recovery.template_send flag.
 *   - --limit caps sends per run (default 50); ~1.1s between sends.
 *   - Backfills Conversation.data.ctwaReferral from the historical webhook
 *     payload so a resumed registration attributes to the originating ad.
 *
 * Usage:
 *   pnpm tsx --env-file=.env.local scripts/ctwa-cold-provider-recovery.ts                # dry-run, both segments
 *   pnpm tsx --env-file=.env.local scripts/ctwa-cold-provider-recovery.ts --segment idle
 *   pnpm tsx --env-file=.env.local scripts/ctwa-cold-provider-recovery.ts --commit --limit 25
 */

import { db } from '../lib/db'
import { isEnabled } from '../lib/flags'
import { sendTemplate } from '../lib/whatsapp'
import { normalizePhone } from '../lib/utils'
import {
  listProviderOnboardingRecoveryRows,
  sendProviderOnboardingRecoveryFollowUps,
  recordProviderOnboardingRecoveryOutcome,
  safeRefForPhone,
  summarizeProviderOnboardingRecoveryRows,
} from '../lib/provider-onboarding-recovery'
import { buildRecoveryTemplateComponents } from '../lib/provider-onboarding-recovery-template-config'
import { classifyReferralAudience, toReferralAttribution, type CtwaReferral } from '../lib/whatsapp-referral'

const DEFAULT_LOOKBACK_DAYS = 45
const DEFAULT_LIMIT = 50
const SEND_SPACING_MS = 1100

function argValue(name: string) {
  const index = process.argv.indexOf(name)
  if (index === -1) return null
  return process.argv[index + 1] ?? null
}

function hasArg(name: string) {
  return process.argv.includes(name)
}

function maskPhone(phone: string) {
  return phone.length > 6 ? `${phone.slice(0, 5)}…${phone.slice(-2)}` : '…'
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

type IdleCandidate = {
  phone: string // E.164
  conversationId: string
  referral: CtwaReferral
  firstSeenAt: Date
}

async function collectIdleCandidates(since: Date): Promise<{
  candidates: IdleCandidate[]
  skipped: Record<string, number>
}> {
  const skipped: Record<string, number> = {
    not_provider_ad: 0,
    no_idle_conversation: 0,
    already_claimed: 0,
    has_application_or_provider: 0,
    opted_out: 0,
    test_session: 0,
  }

  // 1. Ad-attributed phones: inbound messages whose payload carries a referral.
  const inbound = await db.inboundWhatsAppMessage.findMany({
    where: { firstSeenAt: { gte: since } },
    select: { phone: true, payload: true, firstSeenAt: true },
    orderBy: { firstSeenAt: 'asc' },
  })

  const referralByPhone = new Map<string, { referral: CtwaReferral; firstSeenAt: Date }>()
  for (const row of inbound) {
    const payload = row.payload as { referral?: CtwaReferral } | null
    const referral = payload?.referral
    if (!referral) continue
    const phone = normalizePhone(row.phone)
    if (referralByPhone.has(phone)) continue // keep first touch
    if (classifyReferralAudience(referral) !== 'provider_recruitment') {
      skipped.not_provider_ad += 1
      continue
    }
    referralByPhone.set(phone, { referral, firstSeenAt: row.firstSeenAt })
  }

  if (referralByPhone.size === 0) return { candidates: [], skipped }
  const phones = [...referralByPhone.keys()]

  // 2. Cross-reference conversations, applications, providers, opt-outs.
  const [conversations, applications, providers, customers] = await Promise.all([
    db.conversation.findMany({
      where: { phone: { in: phones } },
      select: { id: true, phone: true, flow: true, isTestSession: true, recoveryClaimedAt: true },
    }),
    db.providerApplication.findMany({
      where: { phone: { in: phones } },
      select: { phone: true },
    }),
    db.provider.findMany({
      where: { phone: { in: phones } },
      select: { phone: true },
    }),
    db.customer.findMany({
      where: { phone: { in: phones } },
      select: { phone: true, whatsappServiceOptIn: true, whatsappMarketingOptIn: true, isBlocked: true },
    }),
  ])

  const conversationByPhone = new Map(conversations.map((c) => [c.phone, c]))
  const applicationPhones = new Set(applications.map((a) => normalizePhone(a.phone)))
  const providerPhones = new Set(providers.map((p) => normalizePhone(p.phone)))
  const optedOutPhones = new Set(
    customers
      .filter((c) => c.isBlocked || (!c.whatsappServiceOptIn && !c.whatsappMarketingOptIn))
      .map((c) => normalizePhone(c.phone)),
  )

  const candidates: IdleCandidate[] = []
  for (const [phone, { referral, firstSeenAt }] of referralByPhone) {
    if (applicationPhones.has(phone) || providerPhones.has(phone)) {
      skipped.has_application_or_provider += 1
      continue
    }
    if (optedOutPhones.has(phone)) {
      skipped.opted_out += 1
      continue
    }
    const conversation = conversationByPhone.get(phone)
    // Only the idle/welcome segment here — mid-registration phones belong to
    // the standing recovery queue (registration segment below).
    if (!conversation || conversation.flow !== 'idle') {
      skipped.no_idle_conversation += 1
      continue
    }
    if (conversation.isTestSession) {
      skipped.test_session += 1
      continue
    }
    if (conversation.recoveryClaimedAt) {
      skipped.already_claimed += 1
      continue
    }
    candidates.push({ phone, conversationId: conversation.id, referral, firstSeenAt })
  }

  return { candidates, skipped }
}

async function runIdleSegment(options: { since: Date; limit: number; commit: boolean }) {
  const { candidates, skipped } = await collectIdleCandidates(options.since)

  console.log('\n=== Segment: idle (ad-attributed welcome-menu dropouts) ===')
  console.log(`Candidates: ${candidates.length} | Skips: ${JSON.stringify(skipped)}`)

  const batch = candidates.slice(0, options.limit)
  if (candidates.length > batch.length) {
    console.log(`Limiting to first ${batch.length} of ${candidates.length} (--limit).`)
  }

  if (!options.commit) {
    for (const c of batch) {
      console.log(
        `DRY-RUN would send provider_recovery_welcome_idle → ${maskPhone(c.phone)} ` +
        `(ad ${c.referral.source_id ?? '?'}, first seen ${c.firstSeenAt.toISOString().slice(0, 10)})`,
      )
    }
    return { sent: 0, errors: 0, planned: batch.length }
  }

  let sent = 0
  let errors = 0
  for (const c of batch) {
    // Claim the conversation first — same one-shot semantics as the recovery
    // layer's lock: only proceed if nobody else claimed it since we listed.
    const claim = await db.conversation.updateMany({
      where: { id: c.conversationId, recoveryClaimedAt: null },
      data: { recoveryClaimedAt: new Date() },
    })
    if (claim.count === 0) {
      console.log(`skip (claimed concurrently): ${maskPhone(c.phone)}`)
      continue
    }

    try {
      await sendTemplate({
        to: c.phone,
        template: 'provider_recovery_welcome_idle',
        components: buildRecoveryTemplateComponents({ providerName: null }),
        metadata: {
          campaign: 'ctwa-cold-provider-recovery',
          ctwaSourceId: c.referral.source_id ?? null,
        },
      })

      // Backfill attribution so a resumed registration attributes to the ad.
      const attribution = toReferralAttribution(c.referral)
      if (attribution) {
        const conversation = await db.conversation.findUnique({
          where: { id: c.conversationId },
          select: { data: true },
        })
        const data = (conversation?.data as Record<string, unknown>) ?? {}
        await db.conversation.update({
          where: { id: c.conversationId },
          data: { data: { ...data, ctwaReferral: attribution } as never },
        })
      }

      await recordProviderOnboardingRecoveryOutcome(db, {
        safeUserRef: safeRefForPhone(c.phone),
        phoneMasked: maskPhone(c.phone),
        recoveryStage: 'welcome_idle',
        messageTemplateKey: 'welcome_idle',
        outcomeStatus: 'message_sent',
        notes: `ctwa-cold-provider-recovery campaign (ad ${c.referral.source_id ?? 'unknown'})`,
        actorId: 'operator:ctwa-cold-campaign',
        via: 'template',
      })
      sent += 1
      console.log(`sent: ${maskPhone(c.phone)}`)
    } catch (error) {
      errors += 1
      // Release the claim so a retry run can pick this phone up again.
      await db.conversation.updateMany({
        where: { id: c.conversationId },
        data: { recoveryClaimedAt: null },
      }).catch(() => {})
      console.error(`error: ${maskPhone(c.phone)}`, error instanceof Error ? error.message : error)
    }

    await sleep(SEND_SPACING_MS)
  }

  return { sent, errors, planned: batch.length }
}

async function runRegistrationSegment(options: { since: Date; limit: number; commit: boolean }) {
  console.log('\n=== Segment: registration (mid-flow dropouts, standing queue with campaign lookback) ===')

  if (!options.commit) {
    const rows = await listProviderOnboardingRecoveryRows(db, { since: options.since, take: 1000 })
    const summary = summarizeProviderOnboardingRecoveryRows(rows)
    console.log(`Queue rows: ${summary.total} | due follow-ups: ${summary.dueFollowUps}`)
    for (const row of rows.filter((r) => r.followUpStatus === 'due').slice(0, options.limit)) {
      console.log(`DRY-RUN due → ${row.phoneMasked} | ${row.stage} | template ${row.messageTemplateKey}`)
    }
    return { sent: 0, errors: 0, planned: Math.min(summary.dueFollowUps, options.limit) }
  }

  const templateFlagEnabled = await isEnabled('whatsapp.recovery.template_send')
  const result = await sendProviderOnboardingRecoveryFollowUps(db, {
    since: options.since,
    take: options.limit,
    templateFlagEnabled,
    actorId: 'operator:ctwa-cold-campaign',
  })
  console.log(
    `Registration segment: total=${result.total} due=${result.due} sent=${result.sent} ` +
    `skipped=${result.skipped} errors=${result.errors}`,
  )
  return { sent: result.sent, errors: result.errors, planned: result.due }
}

async function main() {
  const commit = hasArg('--commit')
  const limit = Number(argValue('--limit') ?? DEFAULT_LIMIT)
  const segment = argValue('--segment') ?? 'both'
  const sinceRaw = argValue('--since')
  const since = sinceRaw
    ? new Date(sinceRaw)
    : new Date(Date.now() - DEFAULT_LOOKBACK_DAYS * 24 * 60 * 60_000)
  if (Number.isNaN(since.getTime())) throw new Error('--since must be a valid date')
  if (!Number.isInteger(limit) || limit <= 0) throw new Error('--limit must be a positive integer')
  if (!['both', 'idle', 'registration'].includes(segment)) {
    throw new Error('--segment must be one of: both, idle, registration')
  }

  console.log(`CTWA cold provider recovery — ${commit ? 'COMMIT' : 'DRY-RUN'}`)
  console.log(`since=${since.toISOString()} limit=${limit} segment=${segment}`)

  if (commit && !(await isEnabled('whatsapp.recovery.template_send'))) {
    throw new Error(
      'whatsapp.recovery.template_send flag is OFF — outside-window template sends are frozen. ' +
      'Flip the flag before running with --commit.',
    )
  }

  const totals = { sent: 0, errors: 0, planned: 0 }
  if (segment === 'idle' || segment === 'both') {
    const r = await runIdleSegment({ since, limit, commit })
    totals.sent += r.sent; totals.errors += r.errors; totals.planned += r.planned
  }
  if (segment === 'registration' || segment === 'both') {
    const r = await runRegistrationSegment({ since, limit, commit })
    totals.sent += r.sent; totals.errors += r.errors; totals.planned += r.planned
  }

  console.log(`\nDone. planned=${totals.planned} sent=${totals.sent} errors=${totals.errors}`)
}

main()
  .catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
  .finally(() => db.$disconnect())
