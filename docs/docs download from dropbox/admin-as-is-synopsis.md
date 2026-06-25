# Admin Platform — As-Is Synopsis
**Audit date:** 2026-05-06  
**Branch:** `migration/from-vdp`  
**Scope:** `field-service/` — Next.js 16 App Router, Prisma 6 / Supabase PostgreSQL, Vercel deployment

---

## 1. Executive Summary

`admin.plugapro.co.za` is operational but structurally fragile. The route surface is broad (35+ pages), the UI framework (shadcn/Radix + Tailwind v4) is solid, and the business logic in `lib/` is largely correct after recent cron fixes. However, four systemic risks make this platform unfit for production at meaningful scale:

1. **No Supabase RLS** — the database is exposed to any authenticated user via the anon key.
2. **No CI** — the `.github/workflows/` directory does not exist; linting and tests never run on PRs.
3. **No observability** — error boundaries log only to `console.error`; there is zero alerting on production failures.
4. **Auth privilege-escalation surface** — `proxy.ts:209-214` falls back to `user_metadata.role` (client-mutable) when no `AdminUser` row exists.

Beyond security, **zero database indexes** exist on the 8 highest-traffic Prisma models, and **35/35 admin pages** are `force-dynamic` with no caching. Every page load executes 2–7 sequential database round-trips against unindexed tables.

**Verdict: Partial rebuild required.** The route surface, design system, and `lib/` business logic are reusable. The auth model, observability layer, database index strategy, and ~6 of the highest-churn pages need targeted hardening work before this platform can operate reliably under ops load.

---

## 2. Static Evidence

### 2a. Build

| Check | Result | Notes |
|-------|--------|-------|
| `pnpm build` | **FAIL** (exit 1) | Sole error: `tmp-check-lovemore.ts:25` — orphan scratch file (`providerApplications` not on `ProviderSelect`). Not a real codebase error. |
| `pnpm tsc --noEmit` (scratch file removed) | **PASS** (0 errors) | Real codebase is type-correct. |
| `pnpm lint` | **PASS** (0 errors, 3 warnings) | `no-img-element` warning in one page; one unused disable directive; one incompatible library warning. None are blocking. |
| `pnpm test --run` | **PASS** (1498 tests, 0 failed) | Unit + integration suite fully green. |

### 2b. CI

`.github/workflows/` **does not exist**. The `CLAUDE.md` references a `field-service CI` workflow, but no workflow files are present in the repository. The smoke spec (`e2e/smoke.spec.ts`) and Vitest suite are both dormant from a CI perspective. All quality gates are bypassed on every PR.

### 2c. Lint warnings (full text)

```
app/(admin)/admin/reports/page.tsx:64:25  warning  Compilation Skipped: Use of incompatible library
app/(admin)/admin/reports/page.tsx:56:5   warning  Unused eslint-disable directive
app/(admin)/admin/reports/page.tsx:58:5   warning  no-img-element  <img> used — consider next/image
```

---

## 3. Route Inventory and Page Health

**Browser sweep status:** Not completed — admin credentials not yet provided. All pages classified as GREY (not runtime-tested). Runtime classification will be updated after sweep.

**Classification key:**
- GREEN — renders cleanly, no console errors, no hydration warnings
- AMBER — renders but has non-blocking console errors or slow load
- RED — error boundary triggered, blank render, or 500
- GREY — not tested

| Route | File | Error Boundary? | DB Awaits | force-dynamic | Smoke | Status |
|-------|------|----------------|-----------|--------------|-------|--------|
| `/admin` | `admin/page.tsx` | Yes (group) | ~3 | Yes | Yes | GREY |
| `/admin/validation` | `admin/validation/page.tsx` | Yes (group) | 3 | Yes | Yes | GREY |
| `/admin/dispatch` | `admin/dispatch/page.tsx` (875 ln) | Yes (group) | 7+ | Yes | Yes | GREY |
| `/admin/client-requests` | `admin/client-requests/page.tsx` | Yes (group) | — | Yes | No | GREY |
| `/admin/shortlists` | `admin/shortlists/page.tsx` | Yes (group) | — | Yes | No | GREY |
| `/admin/field-exceptions` | `admin/field-exceptions/page.tsx` | Yes (group) | — | Yes | Yes | GREY |
| `/admin/quotes` | `admin/quotes/page.tsx` | Yes (group) | — | Yes | Yes | GREY |
| `/admin/bookings` | `admin/bookings/page.tsx` | Yes (group) | — | Yes | Yes | GREY |
| `/admin/bookings/[id]` | `admin/bookings/[id]/page.tsx` | **Yes (own)** | — | Yes | Yes (detail) | GREY |
| `/admin/jobs` | `admin/jobs/page.tsx` | Yes (group) | — | Yes | No | GREY |
| `/admin/matches` | `admin/matches/page.tsx` | Yes (group) | — | Yes | Yes | GREY |
| `/admin/applications` | `admin/applications/page.tsx` (692 ln) | Yes (group) | 4 | Yes | Yes | GREY |
| `/admin/providers` | `admin/providers/page.tsx` (alias) | Yes (group) | — | Yes | Yes | GREY |
| `/admin/providers/[id]` | `admin/providers/[id]/page.tsx` (alias) | **Yes (own)** | — | Yes | Yes (detail) | GREY |
| `/admin/providers/new` | `admin/providers/new/page.tsx` | Yes (group) | — | Yes | No | GREY |
| `/admin/technicians` | `admin/technicians/page.tsx` | Yes (group) | — | Yes | No | GREY |
| `/admin/technicians/[id]` | `admin/technicians/[id]/page.tsx` (1268 ln) | **No own boundary** | 4 | Yes | No | GREY |
| `/admin/customers` | `admin/customers/page.tsx` | Yes (group) | — | Yes | Yes | GREY |
| `/admin/customers/[id]` | `admin/customers/[id]/page.tsx` | **Yes (own)** | — | Yes | Yes (detail) | GREY |
| `/admin/customers/new` | `admin/customers/new/page.tsx` | Yes (group) | — | Yes | No | GREY |
| `/admin/categories` | `admin/categories/page.tsx` | Yes (group) | — | Yes | Yes | GREY |
| `/admin/locations` | `admin/locations/page.tsx` | Yes (group) | — | Yes | Yes | GREY |
| `/admin/disputes` | `admin/disputes/page.tsx` | Yes (group) | — | Yes | Yes | GREY |
| `/admin/payments` | `admin/payments/page.tsx` | Yes (group) | 3 | Yes | Yes | GREY |
| `/admin/provider-credit-payments` | `admin/provider-credit-payments/page.tsx` | Yes (group) | — | Yes | No | GREY |
| `/admin/provider-credit-payments/[id]` | `admin/provider-credit-payments/[id]/page.tsx` | Yes (group) | — | Yes | No | GREY |
| `/admin/provider-wallets` | `admin/provider-wallets/page.tsx` | Yes (group) | — | Yes | No | GREY |
| `/admin/provider-wallets/[providerId]` | `admin/provider-wallets/[providerId]/page.tsx` | Yes (group) | — | Yes | No | GREY |
| `/admin/lead-unlock-disputes` | `admin/lead-unlock-disputes/page.tsx` | Yes (group) | — | Yes | No | GREY |
| `/admin/reports` | `admin/reports/page.tsx` | Yes (group) | 1 | Yes | Yes | GREY |
| `/admin/messages` | `admin/messages/page.tsx` | Yes (group) | 1 | Yes | Yes | GREY |
| `/admin/scheduler` | `admin/scheduler/page.tsx` | Yes (group) | — | Yes | No | GREY |
| `/admin/audit-log` | **NO FOLDER** | N/A | N/A | N/A | No | **RED (nav dead link)** |
| `/admin/team` | `admin/team/page.tsx` | Yes (group) | 1 | Yes | No | GREY |
| `/admin/team/permissions` | **NO FOLDER** | N/A | N/A | N/A | No | GREY (missing) |
| `/admin/settings` | `admin/settings/page.tsx` | Yes (group) | 0 | Yes | Yes | GREY |
| `/admin/flows` | `admin/flows/page.tsx` | Yes (group) | — | Yes | Yes | GREY |
| `/admin/breached` | `admin/breached/page.tsx` | Yes (group) | — | Yes | No | GREY |
| `/admin/services` | `admin/services/page.tsx` | Yes (group) | — | Yes | Yes | GREY |

**Summary:** 37 routable pages; 1 confirmed dead link (`/admin/audit-log`); 1 pending creation (`/admin/team/permissions`). 5 error boundaries: 2 group-level + 3 page-level on detail routes. `technicians/[id]` (1268 lines) has no dedicated boundary.

---

## 4. Error Inventory

### Build errors
| File | Error | Severity |
|------|-------|----------|
| `tmp-check-lovemore.ts:25` | `Object literal may only specify known properties — 'providerApplications' does not exist in type ProviderSelect` | LOW — scratch file; delete to resolve |

### Lint warnings
| File | Warning | Severity |
|------|---------|----------|
| `app/(admin)/admin/reports/page.tsx:58` | `<img>` tag instead of `next/image` | LOW |
| `app/(admin)/admin/reports/page.tsx:56` | Unused eslint-disable directive | LOW |
| `app/(admin)/admin/reports/page.tsx:64` | Incompatible library compilation skipped | LOW |

### Runtime errors (static inference — not yet browser-confirmed)
| Area | Likely error | Source | Risk |
|------|-------------|--------|------|
| `/admin/audit-log` nav link | 404 on click | `app/(admin)/layout.tsx:33` | MEDIUM — broken nav |
| `handlePaymentFailed` | Silent dead-end after PSP FAILED event | `lib/payments.ts:490-498` | HIGH — no ops alert |
| WhatsApp send failures | Silently swallowed `.catch(() => {})` | `lib/whatsapp.ts:203,931,1017,1071` | HIGH — no retry/alert |
| `(tx as any).providerCategory` | Optional-chain on typed Prisma client | `admin/applications/page.tsx:201` | MEDIUM — masks missing model |

---

## 5. Performance Diagnosis

### Database indexes

**Critical gap:** 8 models that back the most-queried admin pages have **zero `@@index` declarations**:

| Model | Admin pages that query it | Most common filter pattern |
|-------|--------------------------|---------------------------|
| `Booking` | `/admin/bookings`, `/admin/bookings/[id]` | `status IN [...]`, `createdAt DESC` |
| `Job` | `/admin/jobs`, `/admin/dispatch`, `/admin/technicians/[id]` | `status IN [...]`, `providerId + status` |
| `Quote` | `/admin/quotes` | `status`, `matchId` |
| `Payment` | `/admin/payments` | `status`, `bookingId` |
| `Invoice` | detail pages | `bookingId` |
| `Dispute` | `/admin/disputes` | `status`, `createdAt` |
| `Match` | `/admin/matches`, `/admin/dispatch` | `jobRequestId`, `status` |
| `ProviderPayout` | `/admin/payments`, `/admin/reports` | `status`, `createdAt` |

Every `findMany({ where: { status: ... }, orderBy: { createdAt: 'asc' } })` on these tables is a full sequential scan. At any non-trivial data volume this will cause page-load times measured in seconds.

### Sequential data fetching

Pages that execute sequential (non-Promise.all) DB round-trips at render time:

| Page | Sequential awaits | Estimated cold load |
|------|------------------|-------------------|
| `dispatch/page.tsx` | 7+ (requests → assignments → selectedRequest → case → rankCandidates → history → leads → messages → audit) | 1–3 s |
| `technicians/[id]/page.tsx` | 4 (provider → auditEvents → latestApplication → completedTotal count) | 0.8–1.5 s |
| `applications/page.tsx` | 4 (applications + queue + conflict checks + actions) | 0.5–1 s |
| `payments/page.tsx` | 3 | 0.4–0.8 s |
| `validation/page.tsx` | 3 | 0.4–0.8 s |

### Caching

- `export const dynamic = 'force-dynamic'` on **all 35** admin `page.tsx` files. No route segment caching, no `unstable_cache`, no `React.cache` on shared fetches.
- The single group-level `loading.tsx` shows a generic 6-card skeleton regardless of the page shape, creating a confusing flash before content appears on detail pages and the dispatch panel.

---

## 6. Functional Gaps

| Gap | Location | Impact |
|-----|----------|--------|
| `handlePaymentFailed` does not alert or retry | `lib/payments.ts:490-498` | Failed bookings silently dead-end; ops never notified |
| WhatsApp send failures are swallowed | `lib/whatsapp.ts:203,931,1017,1071,1386` | Provider/customer notifications silently lost |
| `/admin/audit-log` nav link goes nowhere | `app/(admin)/layout.tsx:33` | Every click triggers a 404 |
| `/admin/team/permissions` route missing | — | Role permission management UI absent |
| `tmp-check-lovemore.ts` blocks `pnpm build` | repo root | CI build would always fail (if CI existed) |
| Smoke spec covers only 19/37 routes | `e2e/smoke.spec.ts:33-53` | 18 routes never regression-tested post-deploy |
| Smoke references `/admin/breached` and `/admin/supply` in plan but only `/admin/breached` exists; `/admin/supply` has no route | — | Plan/route misalignment |
| `(tx as any).providerCategory` optional chain | `admin/applications/page.tsx:201`, `lib/provider-auto-approve.ts:116` | Runtime no-op if `ProviderCategory` schema has not been applied; silently skips category writes |
| No "last OWNER" guard in team actions | `admin/team/actions.ts` | All OWNER accounts can be deactivated, locking ops out entirely |
| No self-deactivate guard in team actions | `admin/team/actions.ts` | Admin can lock themselves out |
| Inline `'use server'` actions mixed with co-located `actions.ts` | Multiple pages | No consistent audit trail unless crudAction() used |

---

## 7. Architecture Concerns

### Page size and decomposition

Three pages are architectural monoliths:

| File | Lines | Problem |
|------|-------|---------|
| `app/(admin)/admin/technicians/[id]/page.tsx` | **1268** | Server component + 11 inline form wrappers + 40+ UI sections; no page-level error boundary |
| `app/(admin)/admin/dispatch/page.tsx` | **875** | 7+ data fetches + 8 inline server actions + full 2-panel UI |
| `app/(admin)/admin/applications/page.tsx` | **692** | 5 inline server actions + full table UI |

### Status enums and state machines

| Model | Status count | Problem |
|-------|-------------|---------|
| `Job` | 11 (`ASSIGNED`, `EN_ROUTE`, `ARRIVED`, `STARTED`, `PAUSED`, `AWAITING_APPROVAL`, `COMPLETED`, `FAILED`, `CALLBACK_REQUIRED` + 2 more) | No central transition guard; status updates scattered across lib/ |
| `Booking` | 6 (`PENDING_PAYMENT`, `CONFIRMED`, `SCHEDULED`, `RESCHEDULED`, `CANCELLED`, `COMPLETED`) | No central guard |
| `Match` | Multiple | `MatchStatus` and `QuoteStatus` share overlapping terminal states |
| Dispatch | 3 parallel enums (`DispatchStatus`, `MatchStatus`, assignment hold state) | Ops cannot reason about canonical dispatch state |

### Auth convention inconsistency

- `proxy.ts:199–205`: Checks `AdminUser` DB row first (correct). Falls back to `user_metadata.role` at `proxy.ts:209-213` for legacy accounts that predate the `AdminUser` table. Since `user_metadata.role` is set by the client SDK and not server-authoritative, any Supabase user could self-escalate to `admin` or `owner` access by calling `supabase.auth.updateUser({ data: { role: 'admin' } })` before a `AdminUser` row is created for them.
- The `backfill-admin-users.ts` script exists but has not been run to completion in production (inferred from the fact that the fallback is still active).
- `crudAction()` in `lib/crud-action.ts` independently re-validates from the DB, which provides a second security layer for mutations. Read-only pages that call `requireAdmin()` directly do not have this second layer.

### Mixed server action convention

- **New pattern**: co-located `actions.ts` files with `crudAction()` (locations, customers, providers, team)
- **Old pattern**: inline `async function foo(formData: FormData) { 'use server' ... }` inside `page.tsx` (dispatch, applications, technicians/[id])
- Inline actions in dispatch and applications do not use `crudAction()` consistently; some call `crudAction()`, some bypass it (`overrideAssignment`, `redispatchAction`, `escalateToSupplyAction`)

---

## 8. Security Findings

| ID | Severity | Finding | Location |
|----|----------|---------|----------|
| C1 | **CRITICAL** | Zero Supabase RLS policies. `supabase/migrations/20260327141019_init.sql` contains no `CREATE POLICY` or `ENABLE ROW LEVEL SECURITY` statements. The anon key bypasses all row-level isolation. Any authenticated user (customer, provider) can read/write any table via the Supabase REST API. | `supabase/migrations/20260327141019_init.sql` |
| C2 | **CRITICAL** | No CI pipeline. `.github/workflows/` directory does not exist. `pnpm lint`, `pnpm test`, and `pnpm build` never run on PRs. Broken code ships unchecked. | `.github/` (absent) |
| C3 | **CRITICAL** | No observability. `instrumentation.ts` sets timezone only — no Sentry, Datadog, OTel, or pino. Error boundaries call `console.error()` and stop. Production exceptions are invisible. | `instrumentation.ts` |
| C4 | **HIGH** | Privilege escalation via `user_metadata.role`. When no `AdminUser` row exists, `proxy.ts:209-213` grants admin access based on the `role` field in Supabase `user_metadata`, which any user can self-modify via the Supabase client SDK. | `proxy.ts:206-214` |
| C5 | **HIGH** | No "last OWNER" guard. All OWNER accounts could be deactivated simultaneously, permanently locking ops out. | `app/(admin)/admin/team/actions.ts` |
| C6 | **MEDIUM** | `handlePaymentFailed` silently records failure with no downstream alert or retry. PSP-declined payments become orphaned bookings. | `lib/payments.ts:490-498` |
| C7 | **MEDIUM** | WhatsApp failures silently swallowed. Provider and customer notifications fail with no retry, no dead-letter queue, no ops alert. | `lib/whatsapp.ts:203,931,1017` |

---

## 9. Overall Verdict

**Partial rebuild — foundational gaps must be fixed before scaling ops.**

The case for "partial rebuild" rather than "full rebuild":
- The 35-page route surface is functional and maps correctly to the ops workflow.
- The `lib/` business logic is largely correct (post-cron fix). `crudAction()`, `AuditLog`, `AdminAuditEvent`, and the CRUD kit primitives are solid building blocks.
- The design system (shadcn + Tailwind v4) is in place and consistent.
- The Prisma schema is detailed and accurate.

The case for urgency:
- C1 (RLS) is a data breach risk in its current form.
- C2 (no CI) means every deploy is a production gamble.
- C3 (no observability) means failures are invisible.
- C4 (user_metadata escalation) is an auth bypass that affects every admin route.
- The index gap will cause exponential degradation as booking/job volume grows.

The recommended execution order is: **P0 security → P0 build fix → P1 indexes → P1 observability → P2 CI → P2 functional gaps → P3 page decomposition**.
