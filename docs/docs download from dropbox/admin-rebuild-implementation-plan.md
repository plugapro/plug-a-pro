# Admin Platform — Rebuild Implementation Plan
**Generated:** 2026-05-06  
**Based on:** `docs/admin-as-is-synopsis.md`  
**Approach:** Incremental hardening — keep URL surface, reuse existing primitives, harden in phases

---

## 1. Information Architecture (Target)

The current nav has 27 items. URL stability is a hard constraint — no route renames. The proposed changes are grouping and dead-link removal only.

### Proposed nav grouping

```
Operations
  ├── Overview            /admin
  ├── Validation          /admin/validation
  ├── Dispatch            /admin/dispatch
  ├── Breached Cases      /admin/breached
  └── Scheduler           /admin/scheduler

Service Requests
  ├── Client Requests     /admin/client-requests
  ├── Shortlists          /admin/shortlists
  ├── Quotes              /admin/quotes
  ├── Bookings            /admin/bookings
  ├── Matches             /admin/matches
  ├── Jobs                /admin/jobs
  └── Field Exceptions    /admin/field-exceptions

People
  ├── Providers           /admin/providers      (canonical — technicians/* are aliases, kept)
  ├── Applications        /admin/applications
  ├── Customers           /admin/customers
  └── Team                /admin/team

Finance
  ├── Payments            /admin/payments
  ├── Credit Top-ups      /admin/provider-credit-payments
  ├── Provider Wallets    /admin/provider-wallets
  └── Lead Refunds        /admin/lead-unlock-disputes

Config & Audit
  ├── Categories          /admin/categories
  ├── Locations           /admin/locations
  ├── Services            /admin/services
  ├── Settings            /admin/settings
  ├── Journey Flows       /admin/flows
  ├── Disputes            /admin/disputes
  ├── Messages            /admin/messages
  ├── Reports             /admin/reports
  └── Audit Log           /admin/audit-log      ← needs route created
```

### Removals from nav
- `/admin/audit-log` dead link → removed until route is created (P0 fix)
- Duplicate `providers` / `technicians` entries consolidated to `Providers` only

---

## 2. Target Architecture

### Request path (current vs target)

| Layer | Current state | Target state |
|-------|--------------|-------------|
| Route guard | `proxy.ts` checks `AdminUser` then falls back to `user_metadata.role` | `proxy.ts` checks `AdminUser` only; no metadata fallback |
| Data fetching | Sequential `await db.*` calls at render time | `Promise.all()` for independent queries; React `cache()` for cross-component re-use |
| Caching | `force-dynamic` everywhere | `force-dynamic` on real-time ops pages (dispatch, validation); `revalidate=60` on static-ish pages (reports, scheduler, settings) |
| Error handling | Group-level error boundary only | Per-route `error.tsx` on all detail pages + top-5 list pages |
| Loading states | Generic 6-card skeleton for all routes | Per-route `loading.tsx` matching page shape |
| Observability | None | Sentry (or equivalent) in `instrumentation.ts`; structured `pino` logs via `lib/logger.ts` |
| Server actions | Mixed inline / co-located | All mutations via co-located `actions.ts` using `crudAction()` |

### Reusable existing utilities (must not replace)

| Utility | Location | Role |
|---------|---------|------|
| `crudAction()` | `lib/crud-action.ts` | Mutations with `AuditLog` + `AdminAuditEvent` in one tx |
| CRUD kit | `components/admin/crud/*` | Table / form / confirm primitives |
| `isEnabled()` | `lib/flags.ts` | Feature flag resolution |
| shadcn/Radix | `components/ui/*` | All UI primitives |
| Group skeleton | `app/(admin)/loading.tsx` | Base loading pattern — page-level loading.tsx files extend it |

---

## 3. Target Data-Model Improvements

### Required: indexes on all status-filtered models

```prisma
model Booking {
  @@index([status, createdAt])
  @@index([matchId])
}
model Job {
  @@index([status, createdAt])
  @@index([providerId, status])
  @@index([bookingId])
}
model Quote {
  @@index([status, createdAt])
  @@index([matchId])
}
model Match {
  @@index([jobRequestId])
  @@index([providerId, status])
  @@index([status, createdAt])
}
model Payment {
  @@index([status, createdAt])
  @@index([bookingId])
}
model Invoice {
  @@index([bookingId])
  @@index([status, createdAt])
}
model Dispute {
  @@index([status, createdAt])
  @@index([jobId])
}
model ProviderPayout {
  @@index([status, createdAt])
  @@index([providerId, createdAt])
}
```

### Recommended: admin audit model

`AuditLog` exists. `AdminAuditEvent` exists. Both write correctly via `crudAction()`. No schema changes needed here — only consistent usage enforcement.

### Recommended: payment retry tracking

`Payment.failureReason` exists. Add `Payment.retryCount Int @default(0)` and `Payment.lastRetryAt DateTime?` to enable idempotent retry logic without a new table.

### Optional future: state machine helper

A `lib/state-machine.ts` helper that validates `Job` and `Booking` status transitions at the library layer would prevent invalid writes from scattered `update({ data: { status: ... } })` calls. Not required for P0 but should accompany any dispatch refactor.

---

## 4. Backlog

### P0 — Must fix before next meaningful ops session

| ID | Task | Effort | Affected files |
|----|------|--------|---------------|
| P0-1 | Delete `tmp-check-lovemore.ts` and re-run `pnpm build` to confirm clean build | S | `tmp-check-lovemore.ts` |
| P0-2 | Remove dead `/admin/audit-log` nav link from sidebar | S | `app/(admin)/layout.tsx:33` |
| P0-3 | Harden `proxy.ts` — remove `user_metadata.role` fallback; require `AdminUser` row for all admin access; log a structured warning for legacy accounts and redirect them to an "account setup required" page | M | `proxy.ts:206-214`, `app/(admin)/admin-account-setup/page.tsx` (new) |
| P0-4 | Add Sentry (or Axiom/OTel) to `instrumentation.ts`; add `NEXT_PUBLIC_SENTRY_DSN` env var; wrap error boundaries to call `Sentry.captureException()` | M | `instrumentation.ts`, all `error.tsx` files |
| P0-5 | Add `.github/workflows/ci.yml` with steps: `pnpm install → pnpm lint → pnpm tsc --noEmit → pnpm test --run`; gate PRs on green | M | `.github/workflows/ci.yml` (new) |
| P0-6 | Add "last OWNER" guard to team deactivate action | S | `app/(admin)/admin/team/actions.ts` |
| P0-7 | Add self-deactivate guard to team actions | S | `app/(admin)/admin/team/actions.ts` |

### P1 — High-value, low-risk improvements

| ID | Task | Effort | Affected files |
|----|------|--------|---------------|
| P1-1 | Add `@@index` declarations to Booking, Job, Quote, Match, Payment, Invoice, Dispute, ProviderPayout | M | `prisma/schema.prisma`, new Prisma migration |
| P1-2 | Parallelise sequential DB fetches in `dispatch/page.tsx` with `Promise.all()` | M | `app/(admin)/admin/dispatch/page.tsx` |
| P1-3 | Parallelise sequential DB fetches in `technicians/[id]/page.tsx` | M | `app/(admin)/admin/technicians/[id]/page.tsx` |
| P1-4 | Add per-route `loading.tsx` to dispatch, applications, technicians/[id] with shape-matching skeletons | M | 3 new `loading.tsx` files |
| P1-5 | Add per-route `error.tsx` to technicians/[id] and any other detail pages missing one | S | `app/(admin)/admin/technicians/[id]/error.tsx` (new) |
| P1-6 | Fix `handlePaymentFailed` — send ops alert (WhatsApp/Slack) and write a `OpsQueueAssignment` for `PAYMENT_FOLLOW_UP` | M | `lib/payments.ts:490-498` |
| P1-7 | Fix WhatsApp send failures — replace `.catch(() => {})` with structured error log + optional retry flag on `MessageEvent` | M | `lib/whatsapp.ts:203,931,1017,1071,1386` |
| P1-8 | Create `/admin/audit-log` route showing `AuditLog` and `AdminAuditEvent` entries with filter/search | L | `app/(admin)/admin/audit-log/page.tsx` (new) |

### P2 — Code quality and consistency

| ID | Task | Effort | Affected files |
|----|------|--------|---------------|
| P2-1 | Migrate dispatch inline actions to co-located `actions.ts` using `crudAction()` | L | `app/(admin)/admin/dispatch/page.tsx`, `actions.ts` (new) |
| P2-2 | Migrate applications inline actions to co-located `actions.ts` | M | `app/(admin)/admin/applications/page.tsx`, `actions.ts` (new) |
| P2-3 | Decompose `technicians/[id]/page.tsx` (1268 lines) into sub-components | L | `app/(admin)/admin/technicians/[id]/page.tsx`, new `_components/` |
| P2-4 | Align smoke spec with current route inventory — add 18 missing routes | S | `e2e/smoke.spec.ts` |
| P2-5 | Switch reports page `<img>` to `next/image` (resolves lint warning) | S | `app/(admin)/admin/reports/page.tsx:58` |
| P2-6 | Apply `revalidate=60` to static-ish pages: settings, scheduler, reports, services | S | 4 `page.tsx` files |
| P2-7 | Replace `(tx as any).providerCategory?.createMany?.(...)` with a properly typed call once `ProviderCategory` model availability is confirmed | S | `admin/applications/page.tsx:201`, `lib/provider-auto-approve.ts:116` |
| P2-8 | Add `Payment.retryCount` and `Payment.lastRetryAt` fields | S | `prisma/schema.prisma`, new migration |
| P2-9 | Create `lib/logger.ts` pino wrapper and standardise all `console.error` calls in admin pages | M | `lib/logger.ts` (new), 35 page files |

### P3 — Long-term quality

| ID | Task | Effort | Affected files |
|----|------|--------|---------------|
| P3-1 | Create `lib/state-machine.ts` for Job and Booking status transitions | L | New file, `lib/jobs.ts`, `lib/bookings.ts` |
| P3-2 | Implement `/admin/team/permissions` route for role capability management | L | New route + actions |
| P3-3 | Add Supabase RLS policies (requires separate spike — see risks) | XL | `supabase/migrations/` |
| P3-4 | Enable `E2E_BASE_URL` + `E2E_ADMIN_EMAIL` + `E2E_ADMIN_PASSWORD` secrets in GitHub Actions to activate smoke suite on deploy | S | `.github/workflows/ci.yml` |
| P3-5 | Run `scripts/backfill-admin-users.ts` against production to eliminate all legacy `user_metadata.role` admin accounts | S | Script (exists), Supabase production |

---

## 5. Acceptance Criteria (P0)

| Task | Acceptance |
|------|-----------|
| P0-1 | `pnpm build` exits 0 from `field-service/` with no errors or warnings in output |
| P0-2 | `/admin` sidebar renders without an "Audit Log" link until P1-8 is delivered |
| P0-3 | A Supabase user without an `AdminUser` row is redirected to an account setup page, not the admin dashboard |
| P0-4 | A thrown exception in any admin error boundary appears in the error tracking dashboard within 60 seconds |
| P0-5 | Every PR to `migration/from-vdp` shows a CI check that fails on lint error, type error, or test failure |
| P0-6 | Attempting to deactivate the last OWNER returns a validation error with code `LAST_OWNER_PROTECTED` |
| P0-7 | An admin cannot deactivate their own account |

---

## 6. Information Architecture — Navigation Changes

| Change | Justification |
|--------|--------------|
| Remove `/admin/audit-log` from nav until route exists | Dead link degrades trust in the platform |
| Group nav into 5 sections (Operations / Service Requests / People / Finance / Config) | Current flat 27-item list is hard to scan; grouping matches ops workflow |
| Keep `/admin/technicians` and `/admin/providers` as dual aliases | Existing bookmark links must not break |
| Add `/admin/breached` to nav under Operations | Breached cases page exists but is not in the nav |

---

## 7. Risk Register

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|-----------|
| RLS migration breaks existing queries | HIGH | HIGH | Spike: audit all Supabase REST usages before writing policies; run behind feature flag; test on staging |
| Removing `user_metadata.role` fallback locks out legacy admins | MEDIUM | HIGH | Run `backfill-admin-users.ts` against production before deploying P0-3; verify all admins have rows |
| Index migration on large tables causes downtime | LOW | HIGH | Use `CREATE INDEX CONCURRENTLY` in migration; schedule during off-peak |
| Parallel fetch refactor introduces race conditions | LOW | MEDIUM | Only parallelise truly independent queries; keep sequential where response B depends on response A |
| Sentry captures PII in error metadata | MEDIUM | HIGH | Configure `beforeSend` hook to scrub phone numbers and names from error payloads |

---

## 8. Phase Summary

| Phase | Scope | Prerequisites |
|-------|-------|--------------|
| Phase 0 | Build fix + dead link + CI setup + last-OWNER guard | None |
| Phase 1 | Indexes + observability + auth hardening + payment/WA failure handling | Phase 0 complete; admin backfill run in prod |
| Phase 2 | Parallel fetches + loading skeletons + error boundaries + smoke alignment | Phase 1 complete |
| Phase 3 | Action convention migration + page decomposition + state machine | Phase 2 complete |
| Phase 4 | RLS spike + implementation | Full staging environment with RLS test coverage |
| Phase 5 | `/admin/team/permissions` + `/admin/audit-log` route | Phase 3 complete |
| Phase 6 | Performance review + ISR for static pages + bundle optimisation | Phase 2 complete |
