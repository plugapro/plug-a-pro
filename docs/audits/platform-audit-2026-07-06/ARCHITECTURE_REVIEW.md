# Architecture Review — Plug A Pro Platform Audit (2026-07-06)

Part of the [platform audit](./PLATFORM_AUDIT_REPORT.md). Evidence-based: every claim cites a file, a grep count, or a check that was actually run.

---

## 1. Current Architecture

**Shape:** Vercel-deployed monorepo. `field-service/` is a Next.js 16 App Router **modular monolith** carrying five surfaces in one app:

| Surface | Location |
|---|---|
| Admin console | `field-service/app/(admin)` (27 routes, incl. aliases) |
| Customer PWA | `field-service/app/(client)`, `app/(customer)` |
| Provider PWA | `field-service/app/(provider)`, `app/provider` |
| API layer | `field-service/app/api` — **110 route files** |
| WhatsApp conversational bot | `lib/whatsapp-bot.ts` (4,909 lines) + `lib/whatsapp-flows/` (9 flow handlers) |

`marketing/` is a small separate Next.js app (3 API routes: chat, leads, health).

**Scale (measured 2026-07-06):** 153 pages, 110 API routes, 102 Prisma models, 78 enums, 3,408-line schema, 146 migrations, 345 TS files in `lib/` (218 top-level entries), 511 unit-test files (5,164 tests), 12 Playwright specs.

**Infrastructure:**
- Single Prisma/Postgres datastore (Supabase), Prisma singleton at `lib/db.ts`
- Supabase Auth (HttpOnly `sb-access-token` cookie; `proxy.ts` route protection — admin role now resolved from the `AdminUser` DB row with metadata fallback, `proxy.ts:275-285`)
- Vercel Blob storage (`lib/storage.ts`)
- Meta WhatsApp Cloud API (`lib/whatsapp.ts`, `lib/whatsapp-interactive.ts`)
- PSPs: Peach (default), PayFast, Pay@ (`lib/payments.ts`)
- Didit KYC (live since GA 2026-07-04; Smile ID legacy still in dependencies)
- Upstash rate limiting (`lib/rate-limit.ts`), Sentry configured (but see §4)

**Deployment safety:** `.github/workflows/migrate-deploy.yml` applies Prisma migrations on main-branch pushes and Vercel's ignored-build-step waits for it on the same SHA — schema is always at least as far ahead as deployed code. Concurrency-locked to prevent racing `migrate deploy` runs. This closed a real 2026-05-26 drift incident.

**Layering reality:** business logic predominantly lives in `lib/` services; server actions and API routes are mostly thin callers — but they also call `db` directly (no repository boundary). Cross-channel duplication is lower than feared: both WhatsApp and web share core services (e.g. `lib/job-requests/create-job-request.ts` used by `lib/whatsapp-flows/job-request.ts:18` and web `lib/server/client.ts`). Duplication risk concentrates in the `whatsapp-bot.ts` god-module and the `lib/provider-registration/pwa-flow.ts` (896 lines) vs `whatsapp-flows/registration.ts` pair.

---

## 2. State Machines — actual vs ideal

The codebase **proves it knows the right pattern** (Job, Booking, and identity-verification sessions all have central transition maps). It simply wasn't extended to the two highest-cardinality, money-adjacent machines — **Lead (16 states)** and **JobRequest (9 states)** — where correctness currently rests on per-callsite discipline.

| Entity | States | Enforcement | Verdict |
|---|---|---|---|
| **Job** | SCHEDULED→EN_ROUTE→ARRIVED→STARTED→PAUSED/AWAITING_APPROVAL→PENDING_COMPLETION_CONFIRMATION→COMPLETED; CANCELLED/FAILED/CALLBACK_REQUIRED | Central and correct: `VALID_TRANSITIONS` map + `transitionJob` (`lib/jobs.ts:17,37`) — validates the map, compare-and-set `updateMany` on from-status (`:72`), appends `JobStatusEvent` (`:80`) + AuditLog in one `$transaction`, cascades Booking→COMPLETED | **Ideal — use as the template** |
| **Booking** | SCHEDULED→RESCHEDULED→COMPLETED/CANCELLED | Central: `VALID_BOOKING_TRANSITIONS` + `transitionBooking` (`lib/bookings.ts:7,15`), CAS + `BookingStatusEvent`. **One bypass: `lib/payments.ts:492`** transitions Booking and writes the event manually, skipping the map | Near-ideal, 1 bypass |
| **Quote** | PENDING→APPROVED/DECLINED/EXPIRED/REVISED | Partially central: `processQuoteDecision` (`lib/quotes.ts:139`) atomic-claims `updateMany({where:{status:'PENDING'}})` → `ALREADY_ACTIONED` (`:184,214`); no transitions map | Good enough |
| **JobRequest** | PENDING_VALIDATION→OPEN→MATCHING→SHORTLIST_READY→PROVIDER_CONFIRMATION_PENDING→ACCEPTED_LOCKED / MATCHED; EXPIRED/CANCELLED | **Scattered across ~20 files** (matching/service.ts, customer-shortlists.ts, matching-engine.ts, provider-accepted-lock.ts, whatsapp-bot.ts, cron routes, admin pages). No map. Blind writes at `lib/matching/service.ts:2861` (→MATCHED), `:3406` (→OPEN), `lib/customer-shortlists.ts:825,278`, `lib/matching/reservation.ts:164` | **Worst gap** |
| **Lead** | 16 states: SEND_PENDING→SEND_FAILED/SENT→VIEWED→INTERESTED→SHORTLISTED→CUSTOMER_SELECTED→PROVIDER_ACCEPTED→CREDIT_REQUIRED/CREDIT_APPLIED→ACCEPTED_LOCKED; SUPERSEDED/ACCEPTED/DECLINED/EXPIRED/CANCELLED | **Scattered across ~13 files.** Many sites CAS-guarded (`lib/selected-provider-acceptance.ts:236`, `lib/provider-accepted-lock.ts:481`, `lib/provider-credit-check.ts:324,412`, `lib/matching/service.ts:3483`) but several blind: `lib/matching/service.ts:2707,2735,2770,3353`, `lib/matching-engine.ts:256`, `lib/lead-unlocks.ts:337,541` | **Second-worst; 16 states, no validator** |
| **Match** | MATCHED→INSPECTION_SCHEDULED→INSPECTION_COMPLETE→QUOTED→QUOTE_APPROVED/QUOTE_DECLINED; CANCELLED | Scattered, 6 files; `lib/quotes.ts:191,223` writes Match status unguarded (protected only transitively by the quote claim) | Gap |
| **Payment** | PENDING→AUTHORISED→PAID→REFUNDED/PARTIALLY_REFUNDED; FAILED | 4 files, no map; webhook path idempotent (early-return if already PAID, `app/api/webhooks/payments/route.ts:73-77`); Pay@ PaymentIntent uses CAS `updateMany` on PENDING_PAYMENT (`app/api/payat/webhook/route.ts:256-266`) | Acceptable for MVP volume |
| **Provider.status** | APPLICATION_PENDING/UNDER_REVIEW/ACTIVE/SUSPENDED/ARCHIVED/BANNED | **Scattered, 14 files, no machine.** Admin `setProviderStatus` accepts any target enum with no from-state check (`app/(admin)/admin/providers/actions.ts:335`); creation locus `lib/provider-record.ts:289` | Gap |
| **Provider.kycStatus** | NOT_STARTED→IN_PROGRESS→SUBMITTED→VERIFIED/REJECTED/EXPIRED | Mostly central: derived from the identity-verification session machine (`lib/identity-verification/orchestrator.ts:442,471` — `applyTransition` throws INVALID_TRANSITION), plus a direct admin override outside the machine (`providers/actions.ts:486`) | Mostly good |

**Recommendation:** extend the `lib/jobs.ts` pattern — `VALID_LEAD_TRANSITIONS` / `VALID_JOB_REQUEST_TRANSITIONS` + single `transitionLead()` / `transitionJobRequest()` with CAS — and migrate the ~33 writer files. This is the single highest-leverage architecture fix in the codebase.

---

## 3. Strengths

- **Webhook idempotency is excellent everywhere it matters:** WhatsApp WAMID unique constraint + P2002 catch (`app/api/webhooks/whatsapp/route.ts:81-118`); verification vendor `ProviderVerificationWebhookEvent.idempotencyKey` + redelivery guard; Pay@ CAS crediting; PSP amount-tolerance + already-PAID early return.
- **Job/Booking transition functions are textbook** — map + CAS + event + audit in one transaction.
- **Strong index coverage on hot paths:** unique phones (Customer, Provider, Conversation), status+createdAt composites on every queue entity, `MessageEvent.idempotencyKey` indexed.
- **Deep money-path unit coverage:** wallet 60 test files, ledger 33, ITN/webhook 33, Pay@ 29; 12 e2e specs including 4 mobile and `payment-and-invoice`.
- **Mobile-first is real:** `max-w-md` containers, fixed bottom nav with safe-area insets (`app/(client)/layout.tsx:8-9`).
- **Admin lists paginated/capped** (take 30–500); no unbounded cross-tenant admin list found.
- **Cross-channel logic shared** through lib services rather than duplicated per channel.
- **Migration discipline additive-only** (matches house rule); drift incidents repaired with documented idempotent migrations; migrate-deploy CI ordering guarantees.
- **No hardcoded secrets found** (single grep hit is a comment in `lib/supabase-hook-auth.ts:66`); a `security:secrets` script exists.
- **All checks green on audit day:** lint, `prisma validate`, `tsc --noEmit` (after client regen), 5,164 unit tests, production build.

## 4. Weaknesses

- **Three competing API error shapes** — the house envelope (`code/category/reference_id/...`) is a minority path (~10–18 of 110 routes); 426 raw `NextResponse.json` calls; minimal envelope in `lib/api-auth.ts:22-36` coexists with `lib/api-response.ts` and `lib/route-action-errors.ts`.
- **Sentry configured but effectively unused:** every `error.tsx` boundary only `console.error`s (`app/error.tsx:20`, `app/(customer)/bookings/[id]/error.tsx:15`); 8 `Sentry.captureException` calls in the whole app. Client-side crashes are invisible in production.
- **Support `reference_id` is random, not correlated:** `lib/api-response.ts:31-35` never imports `lib/correlation.ts`; the richer `application-error-service.ts` (traceId, publicRef, DB persistence) is used in only 2 files. A support ID cannot be joined to logs.
- **`lib/` flat namespace of 218 entries** — discoverability and ownership erode at this size (domain folders `matching/`, `identity-verification/` prove the better pattern).
- **No env validation module:** 193 raw `process.env` reads in `lib/` alone; misconfiguration is discovered at call time with inconsistent fail-open/fail-closed behaviour.
- **API input validation is mostly manual `typeof` checks** (~8 of 110 route files use zod), despite zod being standard in server actions.
- **Mixed server-action conventions persist:** 35 co-located `actions.ts` files vs 61 files with inline `'use server'`; `crudAction()` adopted in 31 files.

## 5. Anti-patterns

1. **God-module:** `lib/whatsapp-bot.ts` at 4,909 lines, with an in-file circular-dependency workaround admitted at `lib/whatsapp-flows/job-request.ts:77`.
2. **Blind status writes** (`update({data:{status}})` without from-state guard) on Lead/JobRequest in race-prone matching paths.
3. **Uncorrelated support IDs** — random `reference_id` that can't be traced.
4. **Error boundaries as console sinks** while a configured Sentry sits unused.

---

## 6. Data model concerns

- `Dispute.jobId` is a bare string — no Prisma relation/FK to Job; `raisedByRole` is a string, not an enum (`prisma/schema.prisma:1867-1883`). Orphan disputes possible on a trust-critical table.
- **Migration hygiene scars:** production drift from a DB restore required idempotent repair migrations (~7 `repair_*`/`force_reapply` migrations, e.g. `20260606115900_repair_production_schema_drift`); some DB-level indexes exist only in raw SQL and are absent from `schema.prisma` (`idx_job_requests_customerId` in `20260421040000_add_missing_fk_indexes:21`; partial unique on `provider_applications.phone` in `20260412090000`). `prisma migrate diff` will permanently report drift; `schema.prisma` is not the full truth.
- Category remains string-typed (`JobRequest.category: String`, `Provider.skills: String[]`) — no `Category` model; requirement tables (`CategoryRequiredCertification` etc.) don't exist.
- `AdminUser` is single-role; multi-role RBAC would require additive migration.

## 7. API design concerns

- 110 routes with three error envelopes and mostly manual validation (§4).
- Public-surface hardening gaps: `auth/phone-exists` is a user-enumeration surface with no in-route rate limit; `customer/notify-interest` is an unvalidated public POST; `provider/payment-intent/[intentId]/status` relies solely on in-action ownership checks.
- Recommendation: a standard `parseBody(schema)` helper returning the house envelope, plus a lint rule banning raw `NextResponse.json` error bodies under `app/api`.

## 8. Security boundary concerns (architecture-level)

- Two-layer admin gate (proxy + `crudAction`) is sound, but the `crudAction` house rule is not mechanically enforced — inline `'use server'` mutations can and do bypass it.
- No last-OWNER guard or self-deactivate guard in team actions (per Session 0 audit; still true).
- Detailed security findings live in the [findings register](./FINDINGS_REGISTER.md) (SEC-*).

## 9. Performance risks

- **N+1 in matching hot paths:** per-item awaited DB calls in loops — `lib/matching/customer-recontact.ts:621-627` (3+ queries per job), `lib/matching/orchestrator.ts:316-330`, `lib/matching/service.ts:1871,1889,1903`. Matching/recontact latency grows linearly with volume; cron overruns at 10× volume.
- Heaviest admin query: bookings list `take:200` with 4-level nested include (`app/(admin)/admin/bookings/page.tsx:46,64`).
- Bundle weight: `mermaid`, `@react-pdf/renderer`, `motion` as static prod deps; duplicate Radix (meta `radix-ui` + 8 individual `@radix-ui/*` packages); legacy `smile-identity-core` still shipped.

---

## 10. Suggested target architecture

### For MVP (now → pilot hardening)
Keep the modular monolith — it is the right shape at this scale. Fix within it:
1. Central transition functions for Lead + JobRequest (template: `lib/jobs.ts`).
2. One error envelope + correlated reference IDs; Sentry wired into boundaries and `apiError()` 5xx.
3. Zod-validated `lib/env.ts` loaded at instrumentation time.
4. `parseBody(schema)` on all public POST routes; rate limiting on enumeration surfaces.
5. Split `whatsapp-bot.ts` into router + per-flow modules (target structure already exists in `lib/whatsapp-flows/`).

### After pilot (scaling phase)
1. Domain folders in `lib/` (`payments/`, `providers/`, `messaging/`, `bookings/`) with clear ownership; consider extracting the WhatsApp bot into its own deployable if Meta traffic grows.
2. Queue-backed outbound messaging (durable retry) instead of request-time sends.
3. Batch/streaming matching engine (fix N+1s, then consider precomputed candidate sets).
4. Read-model or reporting DB for admin/funnel queries as row counts grow.
5. Category as a managed Prisma model with requirement tables.

### Refactoring priorities (ordered)
1. **ARC-01** Lead/JobRequest state machines — correctness, race windows (blocks scale).
2. **ARC-03** Sentry in error boundaries — production blindness (blocks scale).
3. **ARC-08** matching N+1 batching (blocks scale at ~10×).
4. **ARC-02/04** error envelope + correlated reference IDs (blocks support scale).
5. **ARC-05** payments.ts booking-transition bypass.
6. **ARC-09** whatsapp-bot split + lib domain folders (ongoing tax, not urgent).

---

## 11. Not verifiable from code alone

- Live DB drift state — whether the raw-SQL-only indexes actually exist in production today post-restore; needs `pnpm db:probe-migrations` / `prisma migrate diff` against prod.
- Ownership check inside `getPaymentIntentStatus` (route delegates auth to the action; action body not traced to the assertion).
- Actual query latency / N+1 impact — needs prod query logs or `pg_stat_statements`.
- Which public routes are actually wrapped by `lib/rate-limit.ts` (Upstash present, coverage not exhaustively mapped).
- Bundle impact of mermaid/@react-pdf/motion — needs a build with analyzer.
- Whether `exceljs` (devDependency) is imported by any runtime path.
