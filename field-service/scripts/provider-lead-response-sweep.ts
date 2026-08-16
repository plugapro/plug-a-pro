/**
 * provider-lead-response-sweep.ts
 *
 * Automated provider lead-response comms. Scans active providers' lead history
 * and, per the policy in classifyLeadResponseCohort:
 *   - WARNS providers who received leads but never responded (below threshold), and
 *   - DEACTIVATES + notifies providers at/over the no-show threshold, inviting
 *     them to reply on WhatsApp with a motivation to be reactivated.
 *
 * A decline counts as engagement — decliners are never warned or deactivated.
 * Internal test accounts are always skipped.
 *
 * Dry-run by default (prints the plan, touches nothing). `--apply` performs
 * the changes, but ONLY if the `provider.comms.lead_response` flag is ON — so
 * we never deactivate a provider without also sending them the notice.
 *
 * Usage:
 *   npx tsx scripts/provider-lead-response-sweep.ts            # DRY RUN
 *   npx tsx scripts/provider-lead-response-sweep.ts --apply    # act (flag must be ON)
 *
 * Requires: DATABASE_URL, and (for --apply) WHATSAPP_ACCESS_TOKEN + WHATSAPP_PHONE_NUMBER_ID.
 */

import 'dotenv/config'
import { db } from '../lib/db'
import { isEnabled } from '../lib/flags'
import { isInternalTestPhone } from '../lib/internal-test-cohort'
import {
  classifyLeadResponseCohort,
  sendLeadResponseWarning,
  sendDeactivationNotice,
  PROVIDER_LEAD_RESPONSE_COMMS_FLAG,
  type LeadResponseCohort,
} from '../lib/provider-lead-response-comms'

const DEACTIVATION_REASON =
  'no_show_of_interest: received leads, never responded (reactivate on WhatsApp motivation)'

type Row = {
  id: string
  name: string | null
  phone: string | null
  cohort: LeadResponseCohort
  received: number
  accepted: number
  declined: number
}

async function main() {
  const apply = process.argv.includes('--apply')
  console.log(`Mode: ${apply ? 'APPLY' : 'DRY RUN'}\n`)

  const providers = await db.provider.findMany({
    where: { active: true },
    select: {
      id: true,
      name: true,
      phone: true,
      leads: {
        where: { isTestLead: false },
        select: { providerAcceptedAt: true, declinedAt: true },
      },
    },
  })

  const rows: Row[] = providers.map((p) => {
    const received = p.leads.length
    const accepted = p.leads.filter((l) => l.providerAcceptedAt != null).length
    const declined = p.leads.filter((l) => l.declinedAt != null).length
    const cohort = classifyLeadResponseCohort({
      leadsReceived: received,
      leadsAccepted: accepted,
      leadsDeclined: declined,
      isInternalTestPhone: isInternalTestPhone(p.phone),
    })
    return { id: p.id, name: p.name, phone: p.phone, cohort, received, accepted, declined }
  })

  const toDeactivate = rows.filter((r) => r.cohort === 'deactivate')
  const toWarn = rows.filter((r) => r.cohort === 'warn')

  const fmt = (r: Row) =>
    `  ${(r.name ?? '(no name)').slice(0, 24).padEnd(24)} ${r.phone ?? '(no phone)'}  ` +
    `leads=${r.received} accepted=${r.accepted} declined=${r.declined}`

  console.log(`DEACTIVATE + notify (${toDeactivate.length}):`)
  toDeactivate.forEach((r) => console.log(fmt(r)))
  console.log(`\nWARN (${toWarn.length}):`)
  toWarn.forEach((r) => console.log(fmt(r)))

  if (!apply) {
    console.log('\nDRY RUN complete. Re-run with --apply (requires the flag ON) to act.')
    return
  }

  const flagOn = await isEnabled(PROVIDER_LEAD_RESPONSE_COMMS_FLAG).catch(() => false)
  if (!flagOn) {
    console.error(
      `\nREFUSING to apply: flag '${PROVIDER_LEAD_RESPONSE_COMMS_FLAG}' is OFF. ` +
        `Enable it first so deactivations are always paired with a WhatsApp notice.`,
    )
    process.exit(2)
  }

  console.log('\nAPPLYING…\n')
  let deactivated = 0
  let warned = 0

  for (const r of toDeactivate) {
    // Notify first; only deactivate if the provider is actually reachable, so
    // nobody is paused silently.
    const notice = await sendDeactivationNotice(r.id)
    if (!notice.sent && notice.reason !== 'duplicate') {
      console.log(`  SKIP deactivate ${r.name}: notice not sent (${notice.reason})`)
      continue
    }
    const before = await db.provider.findUnique({
      where: { id: r.id },
      select: { active: true, suspendedReason: true },
    })
    await db.$transaction([
      db.provider.update({
        where: { id: r.id },
        data: { active: false, suspendedReason: DEACTIVATION_REASON },
      }),
      db.auditLog.create({
        data: {
          actorId: 'system:provider-lead-response-sweep',
          actorRole: 'OWNER',
          action: 'PROVIDER_DEACTIVATED_NO_SHOW',
          entityType: 'Provider',
          entityId: r.id,
          before: { active: before?.active ?? null, suspendedReason: before?.suspendedReason ?? null },
          after: { active: false, suspendedReason: DEACTIVATION_REASON },
        },
      }),
    ])
    deactivated += 1
    console.log(`  DEACTIVATED + notified ${r.name}`)
  }

  for (const r of toWarn) {
    const res = await sendLeadResponseWarning(r.id)
    if (res.sent) {
      warned += 1
      console.log(`  WARNED ${r.name}`)
    } else {
      console.log(`  warn not sent ${r.name} (${res.reason})`)
    }
  }

  console.log(`\nDone. Deactivated ${deactivated}, warned ${warned}.`)
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(() => db.$disconnect())
