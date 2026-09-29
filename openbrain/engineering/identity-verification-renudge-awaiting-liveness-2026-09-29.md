# fix — identity-verification re-nudge covers AWAITING_LIVENESS (2026-09-29)

## Root cause

The in-flight identity-verification re-nudge cron (`/api/cron/identity-verification-in-flight-renudge`)
was written before Didit became the KYC vendor. Its `IN_FLIGHT_STATUSES` list covered only the
pre-Didit PWA steps (`CONSENTED`, `AWAITING_IDENTIFIER`, `RETRY_REQUIRED`, `AWAITING_DOCUMENT`,
`AWAITING_SELFIE`), and `templateForStatus()` returned `null` for anything else.

Every PWA applicant who passes the quality gates today is sent to Didit's hosted flow and is parked in
`AWAITING_LIVENESS`. Applicants who dropped out there were never selected, so none of them ever got a
resume message. Production had 50 such rows: PWA channel, draft-anchored (`providerId` null,
`providerApplicationDraftId` set), `expiresAt` null, `livenessSessionExpiresAt` in the past, created
2026-07-14 to 2026-09-24. No resume template was ever sent to those phones.

## The clues that pointed here

- `IN_FLIGHT_STATUSES` in `field-service/lib/identity-verification/in-flight-renudge.ts` had no Didit-era status.
- The orchestrator moves hosted-vendor rows `SUBMITTED` → `AWAITING_LIVENESS` (`orchestrator.ts`), a status this cron never learned about.
- None of the 50 stalled phones had a `provider_verification_resume_*` MessageEvent.

## Fix applied

1. `AWAITING_LIVENESS` added to `IN_FLIGHT_STATUSES`.
2. `templateForStatus('AWAITING_LIVENESS')` returns `provider_verification_resume_selfie`. Its body is
   "one quick selfie left to complete your Plug A Pro identity verification", which fits Didit's
   face-match step. The template is already APPROVED at Meta, so no new template was needed.
3. The cron route has two new query-param overrides. They are read only after the `CRON_SECRET` check passes:
   - `?dryRun=1` (or `true`): selects candidates and does nothing else. It issues no links, writes no MessageEvents
     and sends nothing, whatever the flag state. It returns
     `{ ok, mode: 'dry_run', dryRun: true, window, candidates, eligibleNow, exhausted, byStatus, eligibleByStatus }`.
     `dryRun=0` and `dryRun=false` behave exactly like an absent parameter. Any other value (`True`, `yes`, `tru`,
     empty) returns 400 `dryRun must be 1, true, 0 or false` before any database read. This fails closed, so a typo
     can never fall through into live sends.
   - `?windowStartHours=N&windowEndHours=N`: both must be non-negative integers, and start must be less than end
     (otherwise the route returns 400). `windowStartHours` below 20 (the default lower bound) is rejected with 400
     `windowStartHours must be at least 20`, not clamped, so a sweep never reaches applicants who are still
     mid-flow. `windowEndHours` is capped at `24*120` (120 days). The override applies in report-only mode, in
     send mode, and in a dry run.
   - With no params, the route makes the same library calls with the same arguments and returns the same
     response keys as before. A test checks this, and the default-path tests also pass against the old route.
4. Caps, dedup and expiry are unchanged: the 24h per-phone dedup, 2 sends per verification, 6 per phone,
   and `expiresAt` exclusion.

## Why sending the nudge does not create a Didit session

- The draft-anchored link comes from `issueProviderApplicationVerificationLink`. It reuses the existing
  non-terminal row, which includes `AWAITING_LIVENESS`, and mints a new access token. It makes no vendor call.
- Opening the link shows the "Complete face-match" button (`app/provider/verify/[token]/page.tsx:432-445`).
- That button leads to `/liveness`. If the session has expired, the route redirects to `/liveness/expired`
  (`liveness/route.ts:14-19`).
- On that page, "Request new link" calls `submitVerificationForAutomation(..., { refreshExpiredLiveness: true })`
  (`liveness/expired/page.tsx:15-23`).
- The orchestrator then moves the row `AWAITING_LIVENESS` → `RETRY_REQUIRED` and clears the vendor
  references (`orchestrator.ts:105-121`). It re-submits and creates a fresh Didit session
  (`orchestrator.ts:175`).
- So a vendor session is only ever created when the applicant taps through.

## Backlog sweep (NOT run — needs owner approval)

The feature flag `provider.identity.verification.in_flight_renudge` must be ON for sends. Steps for the sweep:

1. `GET /api/cron/identity-verification-in-flight-renudge?dryRun=1&windowStartHours=20&windowEndHours=2160`
   with the cron bearer. Check that `byStatus.AWAITING_LIVENESS` ≈ 50. Every backlog row is weeks old, so the
   20h lower bound loses nothing.
2. After the owner approves, run the same URL without `dryRun`. The batch cap
   (`IDENTITY_RENUDGE_BATCH_CAP`, default 100) and all politeness caps still apply.

## Result

- Library and route tests: 73 passing across the two re-nudge test files, and 494 passing (1 skipped)
  across the identity-verification, cron and abandonment-nudge suites.
- The new tests evaluate the real Prisma `where` against fixture rows. Before the fix, 5 of them failed
  against the old library.
- `pnpm lint` is clean. `tsc --noEmit` reports no errors in the touched files.
- No messages sent, no flags flipped, no production queries.

## 2026-09-29 fix round 1 (Codex review on PR #210)

1. **`dryRun` now fails closed.** Before, `isDryRun` treated any value other than `1` or `true` as absent. With
   the send flag ON, `dryRun=True` or `dryRun=yes` would have sent live messages. Now only `1`, `true`, `0` and
   `false` are accepted; anything else returns 400 before any database read.
2. **`windowStartHours` has a floor of 20.** A value of 0 would have selected applicants who updated seconds ago
   and are still mid-flow. Anything below 20 now returns 400, and the documented sweep uses
   `windowStartHours=20`.
3. Route tests cover each case: bad `dryRun` values, `dryRun=0`/`false` matching no parameter (flag OFF and ON),
   `windowStartHours` of 0 and 19 rejected, and `20` with `2160` accepted.

