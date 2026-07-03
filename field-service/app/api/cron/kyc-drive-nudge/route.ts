// ─── Cron: KYC drive provider nudges ─────────────────────────────────────────
// Nudges legacy (pre-grace-cutoff) providers to complete identity verification
// via the provider_kyc_nudge template, so matching.kyc_grace_legacy_providers
// can eventually be retired. Report-only unless kyc_drive.auto_nudge is ON.

import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { isEnabled } from '@/lib/flags'
import { issueProviderIdentityVerificationLink } from '@/lib/identity-verification/link'
import {
  KYC_DRIVE_TEMPLATE,
  listKycNudgeCandidates,
  sendKycDriveNudges,
  summarizeKycNudgeRows,
} from '@/lib/kyc-drive/nudge'
import { resolveBatchCap } from '@/lib/identity-verification/nudge-shared'
import { logOutboundMessage, markOutboundMessageFailed } from '@/lib/message-events'
import { sendProviderKycNudge } from '@/lib/whatsapp'

const DEFAULT_BATCH_CAP = 25

export async function GET(request: Request) {
  const authHeader = request.headers.get('authorization')
  if (!process.env.CRON_SECRET || authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return new NextResponse('Unauthorized', { status: 401 })
  }

  const cronStart = Date.now()
  const cronName = 'kyc-drive-nudge'
  console.log(JSON.stringify({ event: 'cron_start', cron: cronName, timestamp: new Date().toISOString() }))

  try {
    const now = new Date()

    // Default-off safety gate. State-changing auto-nudges only run when an
    // operator has explicitly enabled kyc_drive.auto_nudge. When disabled the
    // cron is read-only: it reports the queue but never sends WhatsApp messages.
    const autoNudgeEnabled = await isEnabled('kyc_drive.auto_nudge')
    if (!autoNudgeEnabled) {
      const rows = await listKycNudgeCandidates(db, { now })
      const summary = summarizeKycNudgeRows(rows)
      const durationMs = Date.now() - cronStart
      console.log(JSON.stringify({
        event: 'cron_complete',
        cron: cronName,
        mode: 'report_only',
        durationMs,
        sent: 0,
        skipped: 0,
        errors: 0,
        ...summary,
        timestamp: new Date().toISOString(),
      }))
      return NextResponse.json({ ok: true, mode: 'report_only', durationMs, sent: 0, skipped: 0, errors: 0, ...summary })
    }

    // The template's {{2}} is the campaign deadline. No deadline configured =
    // no sends: fail closed rather than message providers with broken copy.
    const deadline = process.env.KYC_DRIVE_NUDGE_DEADLINE?.trim()
    if (!deadline) {
      const rows = await listKycNudgeCandidates(db, { now })
      const summary = summarizeKycNudgeRows(rows)
      const durationMs = Date.now() - cronStart
      console.error(JSON.stringify({
        event: 'cron_complete',
        cron: cronName,
        mode: 'missing_deadline',
        durationMs,
        ...summary,
        timestamp: new Date().toISOString(),
      }))
      return NextResponse.json(
        { ok: false, mode: 'missing_deadline', durationMs, sent: 0, skipped: 0, errors: 0, ...summary },
        { status: 500 },
      )
    }

    const batchCap = resolveBatchCap(process.env.KYC_DRIVE_NUDGE_BATCH_CAP, DEFAULT_BATCH_CAP)
    const result = await sendKycDriveNudges(db, {
      now,
      deadline,
      batchCap,
      deps: {
        issueLink: ({ providerId }) => issueProviderIdentityVerificationLink({ providerId, channel: 'WHATSAPP' }),
        recordAttempt: ({ to, metadata }) =>
          logOutboundMessage({ to, templateName: KYC_DRIVE_TEMPLATE, metadata }),
        markAttemptFailed: ({ eventId, failureReason }) =>
          markOutboundMessageFailed({ eventId, failureReason }),
        send: sendProviderKycNudge,
      },
    })
    const summary = summarizeKycNudgeRows(result.rows)
    const durationMs = Date.now() - cronStart
    console.log(JSON.stringify({
      event: 'cron_complete',
      cron: cronName,
      mode: 'auto_nudge',
      durationMs,
      sent: result.sent,
      skipped: result.skipped,
      errors: result.errors,
      ...summary,
      timestamp: new Date().toISOString(),
    }))
    return NextResponse.json({
      ok: true,
      mode: 'auto_nudge',
      durationMs,
      sent: result.sent,
      skipped: result.skipped,
      errors: result.errors,
      ...summary,
    })
  } catch (error) {
    const durationMs = Date.now() - cronStart
    console.error(JSON.stringify({
      event: 'cron_error',
      cron: cronName,
      durationMs,
      error: error instanceof Error ? error.message : String(error),
      timestamp: new Date().toISOString(),
    }))
    throw error
  }
}
