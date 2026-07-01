// ─── Cron: In-flight identity-verification re-nudge ─────────────────────────
// Re-nudges providers who started verification and stalled 20-28h ago in a
// mid-flow status (CONSENTED, AWAITING_*, RETRY_REQUIRED). Sends one of three
// step-specific WhatsApp templates with a fresh signed verify URL.
//
// Report-only unless provider.identity.verification.in_flight_renudge is ON.
// Politeness invariants are enforced by lib/identity-verification/in-flight-renudge.ts
// (24h dedup window per phone across all in-flight templates plus
// provider_kyc_nudge, lifetime cap of IN_FLIGHT_NUDGE_MAX_PER_VERIFICATION
// sends per verification row, attempt-first MessageEvent logging with FAILED
// flip on confirmed send failure).
//
// Distinct from /api/cron/kyc-drive-nudge — kyc-drive targets the legacy
// pre-cutoff cohort who never STARTED verification; this targets the
// engaged-but-stalled mid-loop cohort.

import { NextResponse } from 'next/server'

import { db } from '@/lib/db'
import { isEnabled } from '@/lib/flags'
import { issueProviderIdentityVerificationLink } from '@/lib/identity-verification/link'
import {
  listInFlightRenudgeCandidates,
  resolveBatchCap,
  sendInFlightRenudges,
  summarizeInFlightRenudgeRows,
} from '@/lib/identity-verification/in-flight-renudge'
import { logOutboundMessage, markOutboundMessageFailed } from '@/lib/message-events'
import {
  sendProviderVerificationResumeConsent,
  sendProviderVerificationResumeDocument,
  sendProviderVerificationResumeSelfie,
} from '@/lib/whatsapp'

const FLAG_KEY = 'provider.identity.verification.in_flight_renudge'

export async function GET(request: Request) {
  const authHeader = request.headers.get('authorization')
  if (!process.env.CRON_SECRET || authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return new NextResponse('Unauthorized', { status: 401 })
  }

  const cronStart = Date.now()
  const cronName = 'identity-verification-in-flight-renudge'
  console.log(JSON.stringify({ event: 'cron_start', cron: cronName, timestamp: new Date().toISOString() }))

  try {
    const now = new Date()

    // Default-off safety gate. State-changing sends only run when an operator
    // has explicitly enabled the flag — keep OFF until all three
    // provider_verification_resume_* Meta templates are APPROVED. Report-only
    // mode lets ops watch the queue size without sending any messages.
    const renudgeEnabled = await isEnabled(FLAG_KEY)
    if (!renudgeEnabled) {
      const rows = await listInFlightRenudgeCandidates(db, { now })
      const summary = summarizeInFlightRenudgeRows(rows)
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

    const batchCap = resolveBatchCap(process.env.IDENTITY_RENUDGE_BATCH_CAP)
    const result = await sendInFlightRenudges(db, {
      now,
      batchCap,
      deps: {
        issueLink: ({ providerId, verificationId }) =>
          issueProviderIdentityVerificationLink({ providerId, verificationId, channel: 'WHATSAPP' }),
        recordAttempt: ({ to, templateName, metadata }) =>
          logOutboundMessage({ to, templateName, metadata }),
        markAttemptFailed: ({ eventId, failureReason }) =>
          markOutboundMessageFailed({ eventId, failureReason }),
        sendConsentResume: sendProviderVerificationResumeConsent,
        sendDocumentResume: sendProviderVerificationResumeDocument,
        sendSelfieResume: sendProviderVerificationResumeSelfie,
      },
    })
    const summary = summarizeInFlightRenudgeRows(result.rows)
    const durationMs = Date.now() - cronStart
    console.log(JSON.stringify({
      event: 'cron_complete',
      cron: cronName,
      mode: 'auto_nudge',
      durationMs,
      sent: result.sent,
      skipped: result.skipped,
      errors: result.errors,
      aborted: result.aborted,
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
      aborted: result.aborted,
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
