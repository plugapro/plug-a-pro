# Plug A Pro — Platform Audit Report

**Date:** 2026-07-06
**Scope:** full platform — customer, provider, and admin journeys; SRE/reliability; observability/traceability; architecture; security; testing.
**Method:** code inspection with file:line evidence (7 parallel domain reviews), repo checks actually run (lint, typecheck, Prisma validate, 5,164 unit tests, production build), and read-only live-production spot checks. No code was changed, no messages sent, no payments processed, no data touched.

**Companion documents:**
[FINDINGS_REGISTER.md](./FINDINGS_REGISTER.md) · [JOURNEY_MAPS.md](./JOURNEY_MAPS.md) · [TRACEABILITY_MATRIX.md](./TRACEABILITY_MATRIX.md) · [SRE_READINESS_SCORECARD.md](./SRE_READINESS_SCORECARD.md) · [ARCHITECTURE_REVIEW.md](./ARCHITECTURE_REVIEW.md) · [BACKLOG_RECOMMENDATIONS.md](./BACKLOG_RECOMMENDATIONS.md)

---

## Executive Summary

Plug A Pro is a genuinely substantial platform: 153 pages, 110 API routes, 102 database models, 5,164 passing tests, and a WhatsApp bot that carries a complete customer request flow. The engineering quality is bimodal. Where effort was recently invested — webhook security, KYC, credit deduction, job state transitions, deployment safety — the work is at or above production grade. The KYC pipeline in particular is the reference implementation the rest of the platform should copy.

The problem is not that flows are missing. It is that **the platform goes silent at the edges of every flow**. The happy path works; the moment anything deviates — a customer outside the WhatsApp 24h window, a quote that expires, a job the customer never signs off, a provider whose service area was never provisioned, a payment webhook that arrives out of order — the system knows and nobody is told. Of the 105 findings in the register, the large majority are variants of exactly this pattern. This matches the operational history: the matched-not-told client, the 100% mid-funnel drop, the 88%-read-0%-completion nudge wave were all silence-at-the-edge incidents.

Three headline discoveries change current assumptions:

1. **Approved providers can be silently unmatchable** (PJ-01, Critical). Approval never creates the service-area rows matching filters on. Approved ≠ matchable, and neither the provider nor ops is told.
2. **The ratings loop is dead** (CJ-02, Critical). Matching ranks on `averageRating`, which nothing ever recomputes from submitted reviews. The marketplace's trust signal is fiction.
3. **In checkout mode, customers cannot pay** (CJ-01, Critical). Payment links are generated and then discarded — no code path delivers them. Today's `bypass` default masks this and three further payment-webhook defects (SRE-01/02/04) that become live the day online payment turns on.

A fourth theme: **production observability is nearly blind.** Sentry is configured but client-side reporting is almost certainly dead (Turbopack + CSP wiring gaps), error boundaries swallow errors into `console.error`, all human alerting is one best-effort WhatsApp message to an env var that silently no-ops if unset, and 21 cron jobs — including the one that runs the entire matching engine — have no failure detection whatsoever.

Security is in better shape than the rest of the SRE picture: webhook signatures, RLS, session handling, RBAC guards, upload validation, and IDOR protections all verified sound. The two real security items are plaintext SA ID numbers (past its own in-schema POPIA deadline) and public-blob customer media.

## Overall Readiness Rating

**2.6 / 5 — Conditionally ready for a *supervised* pilot; not ready for scaled client acquisition.**

| Dimension | Rating |
|---|---|
| Functional completeness (happy path) | 4 / 5 |
| Edge/failure-path completeness | 2 / 5 |
| Customer journey | 2.5 / 5 |
| Provider journey | 2.5 / 5 |
| Admin console | 4 / 5 |
| SRE maturity | 2.6 / 5 (see scorecard) |
| Observability/traceability | 2 / 5 |
| Architecture | 3.5 / 5 |
| Security | 4 / 5 |
| Testing | 4 / 5 |

The admin console deserves specific praise: the control-tower dashboard, dispatch console with force-assign and activity feed, unified audit log, and OWNER-guarded team management are well beyond typical MVP quality. Ops can run the business day-to-day — what they cannot do is *detect* problems the system doesn't surface.

## Customer Journey Findings (summary — details in register CJ-01…28)

**Works:** WhatsApp request flow end-to-end (category→address→photos→submit) with strong validation, dedup, service-area re-checks, and resumable conversation state; quote approval with atomic claim + phone binding; ticket self-service page with hardened 72h tokens; job status updates messaging the customer on the main transitions.

**Broken/missing:** payment link delivery (CJ-01); ratings recomputation (CJ-02); post-match notification outside the 24h window (CJ-03); WhatsApp customer support routing — dispute keywords go to a provider-only flow and the "we'll follow up in 2 hours" promise is wired to nothing (CJ-04); booking cancellation from WhatsApp (CJ-05); reschedule is a logged promise that evaporates if `ADMIN_WHATSAPP_NUMBER` is unset (CJ-06); R0 stub quotes rendered as actionable (CJ-07); three JobRequest statuses strand with no nudge or expiry (CJ-08); no-supply silence (CJ-09); four silent job transitions (CJ-10); jobs hang forever pending customer sign-off (CJ-11).

**Drop-off risk concentrates at handoffs:** request→matching-mode choice, match→first message, quote→approval, completion→sign-off. Every one of these has a documented silence gap.

## Provider / Technician Journey Findings (summary — PJ-01…16)

**Works:** registration flows are thorough on WhatsApp (validation, evidence, edit menus); resume tokens hashed and single-use; the accept transaction (identity gate → credit debit → lock → contact reveal) is exemplary; insufficient-credit handling is honest; wrong-state job commands fail friendly.

**Broken/missing:** approval doesn't provision matchability (PJ-01); post-cutoff KYC unmatchables get no nudge — the nudge cron only targets the legacy cohort (PJ-02); certification-gated matching queries tables that nothing writes (PJ-03) and only 1 of 9 high-risk categories even defines required certs (PJ-04); PWA drafts have zero re-engagement (PJ-05); the recovery classifier gives the deepest-funnel drop-offs cold-start copy (PJ-06); completion sign-off is a dead-end on silent customers (PJ-07); providers who top up lose the lead that prompted it (PJ-08); the earnings page reads a table nothing writes (PJ-09); suspension/ban happens with zero notification (PJ-10).

## Admin / Operations Findings (summary — AD-01…13)

**Works:** control-tower dashboard with SLA queues and matching health; full-function dispatch/validation/applications/payments/disputes/team surfaces; unified audit-log viewer; `crudAction` discipline broadly adopted; last-OWNER and self-guards present (the Session-0 doc claiming otherwise is stale); both previously suspected application-review bugs are already fixed (AD-02).

**Broken/missing:** the message Retry button is a no-op — nothing consumes QUEUED events, and retry hides the failure (AD-01, High); "paid but no booking" is not diagnosable from the payments page (AD-03); messages page caps at the last 100 events with no search (AD-08); linear role floors let TRUST issue refunds (AD-04); a handful of unaudited mutation paths (AD-05/06/07); no feature-flag UI — every kill-switch requires DB access (AD-09).

## SRE / Reliability Findings (summary — SRE-01…10)

The seven scenario questions from the audit brief, answered:

| Scenario | Answer |
|---|---|
| "I paid but my booking isn't confirmed" — traceable? | Mostly yes (Payment + BookingStatusEvent + ops follow-up queue); but if the *confirmation send* failed, nothing records it (SRE-02) |
| WhatsApp message fails — detected and retried? | Detected (MessageEvent FAILED). Retried only on sentinel-tracked paths; core sends have zero retry; admin retry is a no-op (AD-01) |
| Provider accepts, credit deduction fails? | Safe — single transaction, typed errors, no money lost. Exemplary. |
| Payment success, webhook delayed? | Booking waits in pre-payment state; reconciles on arrival. Pay@ has active recovery; **Peach has no reconciliation poll** — a fully lost webhook never reconciles |
| Upload fails mid-onboarding? | Not silently stuck: structured retryable errors + recovery cron. Orphaned blobs possible (cost only) |
| Two users grab the same slot? | Same quote/match: atomic claim + unique constraint. **Same provider, different jobs, same window: nothing prevents double-booking** (SRE-08) |
| Technician updates job status — stored/visible? | `transitionJob`: state-machine validated, JobStatusEvent + AuditLog in one transaction, admin-visible. Textbook. |

Top reliability defects: late `payment.failed` clobbers PAID (SRE-01); confirmation permanently lost on post-PAID send failure (SRE-02); failed inbound WhatsApp dead-lettered with the dedup row *blocking* Meta redelivery (SRE-03); PSP checkout created before the Payment row (SRE-04); no timeout/retry on Meta/Peach fetches while the Didit client does it correctly (SRE-06).

## Observability / Traceability Findings (summary — OBS-01…12)

- Sentry: server-side configured with PII redaction; client-side almost certainly dead (no `instrumentation-client.ts` under Turbopack; CSP blocks the ingest host); no `onRequestError`; 8 captureException calls total (OBS-01/02, ARC-03).
- WorkflowEvent funnel ends at CLIENT_NOTIFIED — ten defined lifecycle events (booking, job start/complete, payment, invoice, review) are never emitted (OBS-03). The funnel is blind exactly where the business breaks.
- No logger abstraction (~745 console.* sites); correlation IDs exist in 3 routes and are never persisted; support `reference_id` is random and untraceable (OBS-04, ARC-04).
- Alerting is one best-effort WhatsApp number with silent no-op on missing env; 21 crons with zero failure detection (OBS-09).
- Bright spot: the KYC chain (signed webhook → persisted redacted payload → guarded transition → event row → notification → Sentry with searchable tags) is production-grade and should be the template.
- The DB join chain JobRequest→Match→Quote→Booking→Payment→Job→events is fully reconstructable — the data model supports forensics even where the logging doesn't.

## Architecture / Engineering Findings (summary — ARC-01…17)

Right-shaped modular monolith with strong bones: additive-only migrations with CI-enforced migration-before-deploy ordering, strong index coverage, shared services across WhatsApp/web channels, real mobile-first implementation. The two structural debts: **no state machine for Lead (16 states, 13 writer files) and JobRequest (9 states, ~20 writer files)** — the proven `lib/jobs.ts` pattern was simply never extended to the two riskiest entities (ARC-01); and a 4,909-line `whatsapp-bot.ts` god-module (ARC-09). Three error-envelope shapes coexist with the house standard adopted by a minority of routes (ARC-02). N+1 query patterns in matching hot paths will bite at roughly 10× volume (ARC-08).

## Security / Data Protection Findings (summary — SEC-01…09)

Verified sound: webhook HMAC + timingSafeEqual everywhere (one edge: Peach fails open on *missing* secret — config-dependent), RLS across tables with server-side-only data access, HttpOnly/SameSite/Secure session cookie with 24h cap, DB-backed admin gate with OWNER guards, MIME+magic-byte upload validation, KYC documents in a private bucket, parameterized queries throughout, no hardcoded secrets, prod-blocked debug routes.

Real items: plaintext `idNumber` past its own POPIA deadline (SEC-01, High); customer/job media on public Blob with raw URLs in circulation (SEC-03); OTP availability hard-depends on Upstash env presence (SEC-09).

## Testing Findings

Run on audit day, all passing: ESLint · `prisma validate` · `tsc --noEmit` (clean after regenerating the stale local Prisma client — TST-02) · **5,164 unit tests / 511 files** in 43s · production build · live prod smoke (8 public routes 200, admin domain correctly gated).

Gaps: Playwright smoke (18 tests) never runs on PRs (push + env-gated only); zero smoke coverage of the five customer token surfaces; invoice (2 files) and voucher (6) test depth thin against their business criticality; money-path coverage (wallet 60 / ledger 33 / webhooks 33 files) is excellent.

## Highest-Risk Defects (Top 10)

| # | Finding | Why it tops the list |
|---|---|---|
| 1 | PJ-01 approved-but-unmatchable providers | Silently wastes provider acquisition AND starves customer matching |
| 2 | CJ-03 post-match silence outside 24h window | Reproduces the worst known client incident, still open |
| 3 | CJ-02 dead ratings loop | Core marketplace trust signal is fabricated |
| 4 | SRE-01 `payment.failed` clobbers PAID | Corrupts payment truth + messages paying customers "failed" |
| 5 | SRE-03 inbound WhatsApp dead-letter | Customer replies can vanish; dedup blocks redelivery |
| 6 | CJ-01 payment links never delivered | Checkout mode is structurally unusable |
| 7 | OBS-09 zero cron failure detection | A dead match-leads cron = silent full-marketplace outage |
| 8 | OBS-01/ARC-03 client error tracking dead | Whole class of failures invisible (the "verify UI" pattern) |
| 9 | CJ-04 support dead-end on WhatsApp | Unhappy customers promised follow-up wired to nothing |
| 10 | SEC-01 plaintext ID numbers | Regulatory exposure, self-imposed deadline passed |

## Recommended Fix Roadmap

See [BACKLOG_RECOMMENDATIONS.md](./BACKLOG_RECOMMENDATIONS.md) for full acceptance criteria. Shape:

- **P0 (before wider client acquisition), ~2–3 focused weeks:** truth-at-every-state-change bundle (templates + nudge crons + cancel/reschedule routing); payment webhook hardening; payment-link delivery; inbound dead-letter re-drive + working retry; Sentry client wiring + cron heartbeats; approval-time service-area sync; idNumber encryption; stub-quote guard; ratings recomputation.
- **P1 (before scaling provider onboarding):** provider recovery lanes; certification pipeline; Lead/JobRequest state machines; job-completion closure; ops diagnosis surfaces (payments search, messages pagination, token-page smoke); funnel event completion + payment payload persistence; external-call timeouts + env validation.
- **P2 (pilot hardening):** error-envelope migration, flag UI, crudAction consolidation, roleExact on finance, bot split, N+1 batching, schema integrity items.
- **P3:** payout story, slot selection, invoice push, dependency pruning, polish.

## Quick Wins (high leverage, ≤1 day each)

1. Fail closed on empty `PEACH_WEBHOOK_SECRET` (one guard clause) — and verify the prod env var today.
2. Guarded `updateMany` in `handlePaymentFailed` (SRE-01).
3. `instrumentation-client.ts` + CSP entry — turns client Sentry on (OBS-01).
4. `Sentry.captureException` in every existing `error.tsx` (ARC-03).
5. Route WhatsApp cancel to `cancelBookingLifecycle` when a booking exists (CJ-05).
6. Stub-quote guard on `/quotes/[token]` (CJ-07).
7. Recompute `averageRating` on review submit (CJ-02, first half).
8. Make the admin message Retry button actually re-send (AD-01).
9. Invalid-token smoke tests for the five customer token pages (CJ-25).
10. Refresh CLAUDE.md — it materially misdescribes the current system (AD-10).

## Scale Readiness Assessment

- **Current pilot volume (~dozens of jobs/week):** operable, because ops manually compensates for silence gaps via a genuinely good admin console. Manual compensation is the current scaling bottleneck.
- **10× clients:** blocked by the silence gaps (P0-1), missing payment rails (P0-2/3), and observability blindness (P0-5). At 10× volume the messages page (100-event cap), matching N+1s, and manual funnel reports also start failing.
- **10× providers:** blocked by PJ-01/02/03 (silent unmatchability, no nudges, dead cert pipeline) — onboarding spend would be wasted at approval time.
- **Data model & infra:** ready for far more than current volume; Postgres + additive migrations + CI ordering will comfortably carry 100×. The constraint is not capacity, it is truth-telling and telemetry.

## Final Recommendation

**Do not scale paid client acquisition yet.** The platform is roughly 2–3 focused weeks of P0 work away from being defensible at wider volume. The work is unusually well-defined: almost every P0 item is a localized fix with the pattern already proven elsewhere in this same codebase (sentinel + cron re-drive, transition maps, the KYC observability stack, `timingSafeEqual` guards). Nothing found requires re-architecture.

Sequence: run the P0 bundle now (parallelisable across payments / messaging / matching / platform), flip checkout mode only after P0-2 and P0-3 land with tests, and gate the "scale ads" decision on two proofs: (1) a full traced funnel — request → match → notify → quote → book → complete → review — visible in WorkflowEvents for real traffic, and (2) one induced failure of each class (failed send, failed webhook, dead cron) detected by telemetry rather than by a human noticing.
