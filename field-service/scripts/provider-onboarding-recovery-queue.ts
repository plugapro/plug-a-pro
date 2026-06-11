import { db } from '../lib/db'
import {
  listProviderOnboardingRecoveryRows,
  providerOnboardingStageLabel,
  recordProviderOnboardingRecoveryOutcome,
  summarizeProviderOnboardingRecoveryRows,
  type ProviderOnboardingRecoveryOutcomeStatus,
} from '../lib/provider-onboarding-recovery'

const DEFAULT_LOOKBACK_MS = 24 * 60 * 60_000

function argValue(name: string) {
  const index = process.argv.indexOf(name)
  if (index === -1) return null
  return process.argv[index + 1] ?? null
}

function hasArg(name: string) {
  return process.argv.includes(name)
}

function parseDateArg(name: string) {
  const raw = argValue(name)
  if (!raw) return null
  const date = new Date(raw)
  if (Number.isNaN(date.getTime())) throw new Error(`${name} must be a valid date/time`)
  return date
}

function assertOutcomeStatus(raw: string | null): ProviderOnboardingRecoveryOutcomeStatus {
  const allowed = [
    'not_contacted',
    'message_sent',
    'replied',
    'completed_registration',
    'submitted_application',
    'approved',
    'not_interested',
    'wrong_audience',
    'needs_help',
    'technical_issue',
    'no_response',
    'duplicate_or_invalid',
    'skipped',
  ] as const
  if (allowed.includes(raw as ProviderOnboardingRecoveryOutcomeStatus)) {
    return raw as ProviderOnboardingRecoveryOutcomeStatus
  }
  throw new Error(`--status must be one of: ${allowed.join(', ')}`)
}

function formatDateTime(date: Date | null) {
  if (!date) return '-'
  return date.toLocaleString('en-ZA', {
    timeZone: 'Africa/Johannesburg',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function printQueue(rows: Awaited<ReturnType<typeof listProviderOnboardingRecoveryRows>>) {
  const summary = summarizeProviderOnboardingRecoveryRows(rows)

  console.log('# Provider Onboarding Recovery Queue')
  console.log(`Generated: ${formatDateTime(new Date())}`)
  console.log(`Total users: ${summary.total}`)
  console.log(`Due follow-ups: ${summary.dueFollowUps}`)
  console.log(`Submitted: ${summary.submitted} | Pending: ${summary.pending} | Approved: ${summary.approved}`)
  console.log('')

  for (const row of rows) {
    console.log(`P${row.priority} ${row.priorityLabel} | ${row.safeUserRef} | ${row.phoneMasked}`)
    console.log(`Stage: ${providerOnboardingStageLabel(row.stage)} | ${row.flow ?? row.source}/${row.step ?? '-'}`)
    console.log(`Last seen: ${formatDateTime(row.lastInteractionAt)} | Follow-up: ${row.followUpStatus} | Due: ${formatDateTime(row.followUpDueAt)}`)
    console.log(`Captured: ${row.providerName ?? '-'} | ${row.serviceCategory ?? 'service not captured'} | ${row.area ?? 'area not captured'} | app ${row.applicationStatus ?? '-'}`)
    console.log(`Outcome: ${row.lastOutcomeStatus}${row.operatorNotes ? ` | Notes: ${row.operatorNotes}` : ''}`)
    console.log(`Action: ${row.recommendedAction}`)
    console.log('Message:')
    console.log(row.followUpMessage)
    console.log('---')
  }
}

async function main() {
  const now = parseDateArg('--now') ?? new Date()
  const since = parseDateArg('--since')
    ?? (process.env.PROVIDER_RECOVERY_SINCE
      ? new Date(process.env.PROVIDER_RECOVERY_SINCE)
      : new Date(now.getTime() - DEFAULT_LOOKBACK_MS))
  if (Number.isNaN(since.getTime())) throw new Error('PROVIDER_RECOVERY_SINCE must be a valid date/time')
  const rows = await listProviderOnboardingRecoveryRows(db, { now, since })

  if (hasArg('--log-outcome')) {
    const safeRef = argValue('--ref')
    if (!safeRef) throw new Error('--ref is required with --log-outcome')
    const row = rows.find((candidate) => candidate.safeUserRef === safeRef)
    if (!row) throw new Error(`No current recovery row found for ${safeRef}`)
    const nextFollowUpAt = parseDateArg('--next-follow-up')

    await recordProviderOnboardingRecoveryOutcome(db, {
      safeUserRef: row.safeUserRef,
      phoneMasked: row.phoneMasked,
      recoveryStage: row.stage,
      messageTemplateKey: row.messageTemplateKey,
      outcomeStatus: assertOutcomeStatus(argValue('--status')),
      notes: argValue('--notes'),
      nextFollowUpAt,
      actorId: argValue('--actor') ?? 'operator:manual',
    })
    console.log(`Logged outcome for ${row.safeUserRef} (${row.phoneMasked})`)
    return
  }

  if (hasArg('--json')) {
    console.log(JSON.stringify({
      generatedAt: now.toISOString(),
      since: since.toISOString(),
      summary: summarizeProviderOnboardingRecoveryRows(rows),
      rows,
    }, null, 2))
    return
  }

  printQueue(rows)
}

main()
  .then(() => db.$disconnect())
  .catch(async (error) => {
    console.error(error instanceof Error ? error.message : String(error))
    await db.$disconnect()
    process.exit(1)
  })
