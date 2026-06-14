# Codex 2026-06-14 re-scan triage + 6 post-sweep fixes (2026-06-14)

## Context

A new Codex security export (`codex-security-findings-2026-06-14T10-21-38.059Z.csv`,
59 findings, all `status: new`) was handed over to action. The export keys each
finding to its **introducing commit**, so already-remediated issues still show as
"new". Joined it against the prior remediation tracker
(`codex-security-findings-status-2026-06-10.csv`, the 152-finding sweep closed via
PRs #68–#103).

## Triage (authoritative, via join on finding id)

- **51 / 59** already `MERGED & VERIFIED / verified_on_main=yes` — no action.
- **1 / 59** `PLANNED — not started`: "Internal test phone number exposed in
  source" (ca4b71d2 / PR #99 held) — still blocked on the user setting
  `INTERNAL_TEST_PHONE_NUMBERS` in Vercel + a 19-file scrub. Unchanged.
- **7 / 59** NOT in the prior tracker = genuinely new (introduced in post-sweep
  commits 2026-06-06→13). All 7 verified STILL VALID on HEAD (#110) before fixing.

## Fixes implemented (6 of the 7)

1. **[HIGH] KYC grace admits rejected/expired providers** (70d922b9). `isKycGrandfathered()`
   was purely date-based. Added a terminal-status exclusion so REJECTED/EXPIRED
   legacy providers are never grandfathered — at the **lead-unlock PII boundary**
   (`provider-lead-eligibility.ts`) and in the **matching SQL** (`matching/filter.ts`).
   Grace still bridges NOT_STARTED/IN_PROGRESS/SUBMITTED. `lib/matching/kyc-grace.ts`.
2. **[HIGH] Global Meta Pixel leaks magic-link tokens** (910005fb). MetaPixel was
   mounted in the root layout and fired `PageView` (incl. `window.location`) on
   tokenized routes (`/quotes/<t>`, `/leads/access/<t>`, `/provider/verify/<t>`, …),
   shipping bearer tokens to Facebook. Added `lib/sensitive-token-routes.ts`
   denylist; `components/meta-pixel.tsx` now suppresses both the bootstrap and
   per-route PageView on those prefixes.
3. **[MED] Notify-interest IP rate-limit bypass** (7c95b963). `checkNotifyInterestLimit`
   skipped the IP bucket when `trustedClientIp` returned null, so phone rotation
   bypassed the per-source cap. Coalesced null IP to a shared `'unknown'` bucket
   (matching the `otpReportByIp` precedent). `lib/rate-limit.ts`.
4. **[MED] PayFast IP allowlist trusts spoofable headers** (c2796cee). Fix written
   (drop the client-spoofable `cf-connecting-ip` branch; trust only the
   platform-injected `x-vercel-forwarded-for`, then x-forwarded-for/x-real-ip
   fallback) but **HELD from this push** at the owner's request — kept local/
   uncommitted in `app/api/webhooks/payfast/route.ts` pending a separate payments
   review. Related owner intent (2026-06-14): **remove Pay@ / PayAt as a payment
   provider** (`lib/payat/*`) — a distinct, larger task to be scoped separately.
5. **[MED] Handover token over-exposes attachments** (4adb580b). The attachment
   route authorized handover access with a signature-only `verify*` (no lifecycle
   check) and didn't require `safeForPreview`. Swapped to `resolveCustomerProviderHandoverToken`
   (enforces lead ACCEPTED + request not cancelled/expired + match still assigned)
   and added the `safeForPreview !== false` guard, matching the ticket/lead paths.
   Also filtered the handover page render. `app/api/attachments/[id]/route.ts`,
   `lib/customer-provider-handover-access.ts`, `app/requests/handover/[token]/page.tsx`.
6. **[MED] CSV formula injection** (8193cef6). `escapeCell` now prefixes a single
   quote (and quotes) any cell starting with `= + - @` / tab / CR, neutralizing
   provider-controlled spreadsheet-formula payloads in the nudge export. `lib/nudges/csv.ts`.

## NOT fixed — decision required (1 of 7)

**[MED] OTP failure telemetry unreachable for public verify flow** (ff474810).
The endpoint was *deliberately* locked down (no longer public + session/CRON gate)
to fix **d3930a40** — an unauthenticated attacker spamming `verify-failed` for a
victim's phone during their active login challenge can exhaust the per-phone
verify bucket and lock the victim out. "Fixing" ff474810 by re-opening the
endpoint re-introduces that DoS. This is a genuine tradeoff (telemetry vs
lockout-DoS), not a clean bug, so it was left as-is pending an owner decision.
Recommendation: keep the lockdown (accept the public-flow telemetry gap) or
record failures via a post-auth path instead of a public endpoint.

## Tests

- `kyc-grace.test.ts` — REJECTED/EXPIRED never grandfathered (+ unlock boundary).
- `sensitive-token-routes.test.ts` — denylist covers all token routes, no substring false-positives.
- `rate-limit.test.ts` — null IP still consumes the shared per-IP bucket.
- `nudges/csv.test.ts` — formula-injection payloads neutralized.
- `attachments-authz.test.ts` — new handover suite: safeForPreview=false denied, stale token denied, safe attachment allowed (previously zero handover coverage).

## Validation

- `eslint` (changed files) — 0 errors. `tsc --noEmit` — 0 errors.
- Affected suites: 76/76 pass. Full suite: 12 failures, ALL re-run green in
  isolation (148/148) — parallel-load 5s-timeout flakiness in files unrelated to
  this change, not regressions.
- Not done: PayFast `getRemoteIp` lacks a dedicated unit test (the webhook harness
  runs sandbox mode which skips IP validation); the change is a strict
  trust-narrowing and the existing payfast-webhook suite passes.
