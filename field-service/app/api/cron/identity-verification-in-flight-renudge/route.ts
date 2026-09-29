// ─── Cron: In-flight identity-verification re-nudge ─────────────────────────
// Re-nudges providers who started verification and stalled 20-28h ago in a
// mid-flow status (CONSENTED, AWAITING_* incl. AWAITING_LIVENESS,
// RETRY_REQUIRED). Sends one of three step-specific WhatsApp templates with a
// fresh signed verify URL.
//
// Operator overrides (only read AFTER the CRON_SECRET check passes; with none
// of them present the route behaves exactly as the scheduled cron). Unknown
// parameter names (case-sensitive, e.g. dryrun, dry_run) are rejected with 400.
//   ?dryRun=1|true       select candidates, send nothing, write nothing;
//                        returns { dryRun: true, candidates, byStatus, ... }.
//                        0|false behaves exactly like an absent parameter; any
//                        other value is rejected with 400 (fail closed — a
//                        typo must never fall through into live sends).
//   ?windowStartHours=N  integer hours >= 20 (the default lower bound); lower
//                        values are rejected with 400 so a sweep can never
//                        reach applicants who are still mid-flow
//   ?windowEndHours=N    integer hours; replaces the default 28h upper bound,
//                        capped at WINDOW_END_HOURS_MAX (120 days) so a typo
//                        cannot sweep years of rows
// Used for a deliberate one-off backlog sweep (e.g. the AWAITING_LIVENESS
// cohort the cron never covered):
//   ?dryRun=1&windowStartHours=20&windowEndHours=2160
// Politeness caps are unchanged by overrides.
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
import { issueProviderApplicationVerificationLink } from '@/lib/identity-verification/application-link'
import {
  IN_FLIGHT_NUDGE_WINDOW_END_HOURS,
  IN_FLIGHT_NUDGE_WINDOW_START_HOURS,
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

// 120 days. An override beyond this is clamped, never honoured as typed.
const WINDOW_END_HOURS_MAX = 24 * 120

type WindowOverride = { windowStartHours?: number; windowEndHours?: number }

// Parses ?windowStartHours / ?windowEndHours. Returns {} when neither is
// present so the default call shape is untouched. Values must be
// non-negative integers; the effective start must be below the effective end.
function parseWindowOverride(
  params: URLSearchParams,
): { ok: true; override: WindowOverride } | { ok: false; error: string } {
  const rawStart = params.get('windowStartHours')
  const rawEnd = params.get('windowEndHours')
  const override: WindowOverride = {}
  if (rawStart !== null) {
    if (!/^\d+$/.test(rawStart)) return { ok: false, error: 'windowStartHours must be a non-negative integer' }
    const start = Number.parseInt(rawStart, 10)
    // Rows younger than the default lower bound may be mid-flow right now;
    // never nudge them. Reject rather than clamp so the operator sees it.
    if (start < IN_FLIGHT_NUDGE_WINDOW_START_HOURS) {
      return { ok: false, error: `windowStartHours must be at least ${IN_FLIGHT_NUDGE_WINDOW_START_HOURS}` }
    }
    override.windowStartHours = start
  }
  if (rawEnd !== null) {
    if (!/^\d+$/.test(rawEnd)) return { ok: false, error: 'windowEndHours must be a non-negative integer' }
    override.windowEndHours = Math.min(Number.parseInt(rawEnd, 10), WINDOW_END_HOURS_MAX)
  }
  const start = override.windowStartHours ?? IN_FLIGHT_NUDGE_WINDOW_START_HOURS
  const end = override.windowEndHours ?? IN_FLIGHT_NUDGE_WINDOW_END_HOURS
  if (start >= end) return { ok: false, error: 'windowStartHours must be less than windowEndHours' }
  return { ok: true, override }
}

const ALLOWED_QUERY_PARAMS = new Set(['dryRun', 'windowStartHours', 'windowEndHours'])

// Fail closed: a misspelled parameter NAME (dryrun, dry_run, …) would otherwise
// be ignored and, with the send flag ON, turn a read-only sweep into live sends.
function findUnknownQueryParam(params: URLSearchParams): string | null {
  for (const name of params.keys()) {
    if (!ALLOWED_QUERY_PARAMS.has(name)) return name
  }
  return null
}

// Fail closed: an unrecognised dryRun value must never be read as "absent"
// (which, with the send flag ON, would mean live sends).
function parseDryRun(params: URLSearchParams): { ok: true; dryRun: boolean } | { ok: false; error: string } {
  const raw = params.get('dryRun')
  if (raw === null || raw === '0' || raw === 'false') return { ok: true, dryRun: false }
  if (raw === '1' || raw === 'true') return { ok: true, dryRun: true }
  return { ok: false, error: 'dryRun must be 1, true, 0 or false' }
}

export async function GET(request: Request) {
  const authHeader = request.headers.get('authorization')
  if (!process.env.CRON_SECRET || authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return new NextResponse('Unauthorized', { status: 401 })
  }

  const searchParams = new URL(request.url).searchParams
  const unknownParam = findUnknownQueryParam(searchParams)
  if (unknownParam !== null) {
    return NextResponse.json({ ok: false, error: `unknown query parameter: ${unknownParam}` }, { status: 400 })
  }
  const parsedDryRun = parseDryRun(searchParams)
  if (!parsedDryRun.ok) {
    return NextResponse.json({ ok: false, error: parsedDryRun.error }, { status: 400 })
  }
  const dryRun = parsedDryRun.dryRun
  const parsedWindow = parseWindowOverride(searchParams)
  if (!parsedWindow.ok) {
    return NextResponse.json({ ok: false, error: parsedWindow.error }, { status: 400 })
  }
  const windowOverride = parsedWindow.override
  const hasWindowOverride = Object.keys(windowOverride).length > 0
  const effectiveWindow = {
    startHours: windowOverride.windowStartHours ?? IN_FLIGHT_NUDGE_WINDOW_START_HOURS,
    endHours: windowOverride.windowEndHours ?? IN_FLIGHT_NUDGE_WINDOW_END_HOURS,
  }

  const cronStart = Date.now()
  const cronName = 'identity-verification-in-flight-renudge'
  console.log(JSON.stringify({ event: 'cron_start', cron: cronName, timestamp: new Date().toISOString() }))

  try {
    const now = new Date()

    // Dry run: read-only candidate selection, independent of the flag. No
    // link issuance, no MessageEvent writes, no sends.
    if (dryRun) {
      const rows = await listInFlightRenudgeCandidates(db, { now, ...windowOverride })
      const summary = summarizeInFlightRenudgeRows(rows)
      const byStatus: Record<string, number> = {}
      const eligibleByStatus: Record<string, number> = {}
      for (const row of rows) {
        byStatus[row.status] = (byStatus[row.status] ?? 0) + 1
        if (row.eligibleNow) eligibleByStatus[row.status] = (eligibleByStatus[row.status] ?? 0) + 1
      }
      const durationMs = Date.now() - cronStart
      console.log(JSON.stringify({
        event: 'cron_complete',
        cron: cronName,
        mode: 'dry_run',
        durationMs,
        window: effectiveWindow,
        ...summary,
        byStatus,
        eligibleByStatus,
        timestamp: new Date().toISOString(),
      }))
      return NextResponse.json({
        ok: true,
        mode: 'dry_run',
        dryRun: true,
        durationMs,
        window: effectiveWindow,
        ...summary,
        byStatus,
        eligibleByStatus,
      })
    }

    // Default-off safety gate. State-changing sends only run when an operator
    // has explicitly enabled the flag — keep OFF until all three
    // provider_verification_resume_* Meta templates are APPROVED. Report-only
    // mode lets ops watch the queue size without sending any messages.
    const renudgeEnabled = await isEnabled(FLAG_KEY)
    if (!renudgeEnabled) {
      const rows = await listInFlightRenudgeCandidates(db, { now, ...windowOverride })
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
        ...(hasWindowOverride ? { window: effectiveWindow } : {}),
        timestamp: new Date().toISOString(),
      }))
      return NextResponse.json({
        ok: true,
        mode: 'report_only',
        durationMs,
        sent: 0,
        skipped: 0,
        errors: 0,
        ...summary,
        ...(hasWindowOverride ? { window: effectiveWindow } : {}),
      })
    }

    const batchCap = resolveBatchCap(process.env.IDENTITY_RENUDGE_BATCH_CAP)
    const result = await sendInFlightRenudges(db, {
      now,
      ...windowOverride,
      batchCap,
      deps: {
        // Fix D: route link issuance based on whether the candidate is provider-
        // anchored or draft-anchored (PWA gate-ON applicants have no Provider row yet).
        issueLink: ({ providerId, draftId, verificationId }) =>
          providerId
            ? issueProviderIdentityVerificationLink({ providerId, verificationId, channel: 'WHATSAPP' })
            : draftId
              ? issueProviderApplicationVerificationLink({ providerApplicationDraftId: draftId, channel: 'PWA' })
              : Promise.resolve({ verificationUrl: null }),
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
      ...(hasWindowOverride ? { window: effectiveWindow } : {}),
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
      ...(hasWindowOverride ? { window: effectiveWindow } : {}),
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
