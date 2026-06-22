# Admin Platform — Execution Task List
**Generated:** 2026-05-06  
**Source:** `docs/admin-rebuild-implementation-plan.md`  
**Format per task:** name / what to execute / why / files / what good looks like / acceptance / risks

---

## Phase 0 — Critical Blockers

---

### TASK-001: Delete orphan scratch file

**Execute:** Delete `field-service/tmp-check-lovemore.ts`. Run `pnpm build` from `field-service/` to confirm exit 0.

**Why:** The scratch file contains a Prisma query using a relation that does not exist on the `Provider` model (`providerApplications`). It causes `pnpm build` to fail with exit code 1, which would cause any CI build job to fail on every run.

**Files to change:**
- `field-service/tmp-check-lovemore.ts` — delete

**What good looks like:** `pnpm build` completes with `✓ Compiled successfully` and no type errors.

**Acceptance:** `pnpm build` exits 0 from `field-service/`; `pnpm tsc --noEmit` exits 0.

**Risks:** None. The file is a one-off investigation script with no imports from the application.

---

### TASK-002: Remove dead audit-log nav link

**Execute:** In `field-service/app/(admin)/layout.tsx`, remove the `{ href: '/admin/audit-log', label: 'Audit Log', icon: 'workflow' }` entry from `NAV_ITEMS` (line 33). The link will be re-added when TASK-030 creates the route.

**Why:** Every click on "Audit Log" in the sidebar navigates to a route with no folder, producing a 404. This erodes trust in the admin platform.

**Files to change:**
- `field-service/app/(admin)/layout.tsx:33`

**What good looks like:** The sidebar renders 26 items instead of 27; no "Audit Log" link is visible.

**Acceptance:** Navigate to `/admin` — no "Audit Log" link in sidebar; `app/(admin)/layout.tsx` has no `audit-log` href.

**Risks:** None. The route does not exist so removing the link causes no regressions.

---

### TASK-003: Add CI workflow

**Execute:** Create `.github/workflows/ci.yml` in the repo root (not inside `field-service/`). The workflow should:
1. Trigger on `push` and `pull_request` to all branches.
2. Run `pnpm install --frozen-lockfile` from repo root.
3. `cd field-service && pnpm lint`
4. `cd field-service && pnpm tsc --noEmit`
5. `cd field-service && pnpm test --run`
6. Optional build step gated on repo variable `CI_BUILD_ENABLED == 'true'`: `cd field-service && pnpm build`

**Why:** The `.github/workflows/` directory does not exist. No quality gates run on any PR. This is the second-highest production risk after RLS — broken code ships unchecked.

**Files to change:**
- `.github/workflows/ci.yml` (new)

**What good looks like:** The workflow appears in GitHub Actions; every PR shows a `ci / lint-type-test` check that must pass before merge.

**Acceptance:** Open a test PR — GitHub shows a green or red CI status check on the PR; `pnpm lint` failure causes the check to fail.

**Risks:** Existing PRs will suddenly show a failing check if they have lint/type errors. Communicate to the team before enabling.

---

### TASK-004: Harden proxy.ts admin auth — remove user_metadata fallback

**Execute:** In `field-service/proxy.ts:206-214`, remove the `user_metadata.role` fallback branch for admin route protection. When `db.adminUser.findFirst()` returns null, redirect to `/admin-sign-in` (same as an inactive account). Add a structured log message so ops can identify legacy accounts still using metadata-only auth.

The updated block:
```ts
if (adminUser) {
  if (!adminUser.active) return redirectToSignIn(request, pathname, isAdminDomain)
  effectiveRole = adminUser.role.toLowerCase()
} else {
  // No AdminUser row — legacy account. Block access; run backfill-admin-users.ts.
  console.warn('[proxy] admin access blocked: no AdminUser row', { userId: user.id, email: user.email })
  return redirectToSignIn(request, pathname, isAdminDomain)
}
```

**Why:** `user_metadata.role` is client-mutable via `supabase.auth.updateUser({ data: { role: 'admin' } })`. Any authenticated Supabase user can self-escalate to admin access. The `AdminUser` DB table is the authoritative source — the fallback bypasses it.

**Files to change:**
- `field-service/proxy.ts:191-215`

**What good looks like:** A Supabase user with no `AdminUser` row is redirected to the sign-in page when accessing `/admin`.

**Acceptance:** Create a test Supabase user with `user_metadata.role = 'admin'` but no `AdminUser` row; attempt to access `/admin` — should redirect to sign-in, not load the admin shell. **Run `field-service/scripts/backfill-admin-users.ts` against production before deploying this task.**

**Risks:** **HIGH** — Any production admin account that was using metadata-only auth will be locked out immediately. The backfill script must be confirmed to have run successfully before this task is deployed.

---

### TASK-005: Add observability — Sentry integration

**Execute:**
1. Install `@sentry/nextjs` in `field-service/`.
2. Run `npx @sentry/wizard@latest -i nextjs` to generate `sentry.client.config.ts`, `sentry.server.config.ts`, `sentry.edge.config.ts`.
3. Update `field-service/instrumentation.ts` to call `Sentry.init()` with `dsn: process.env.SENTRY_DSN` and `environment: process.env.VERCEL_ENV ?? 'development'`.
4. Add a `beforeSend` hook that scrubs phone numbers from error payloads: replace `/\+?27\d{9}/g` and any `phone` property with `[REDACTED]`.
5. Update all 5 `error.tsx` files to call `Sentry.captureException(error)` before rendering.
6. Add `SENTRY_DSN` and `NEXT_PUBLIC_SENTRY_DSN` to Vercel environment variables.

**Why:** No production exceptions reach any dashboard. Ops has no visibility into errors unless a user manually reports them. This is the third-highest production risk.

**Files to change:**
- `field-service/instrumentation.ts`
- `field-service/sentry.client.config.ts` (new)
- `field-service/sentry.server.config.ts` (new)
- `field-service/sentry.edge.config.ts` (new)
- `field-service/app/(admin)/admin/error.tsx`
- `field-service/app/(admin)/error.tsx`
- `field-service/app/(admin)/admin/bookings/[id]/error.tsx`
- `field-service/app/(admin)/admin/customers/[id]/error.tsx`
- `field-service/app/(admin)/admin/providers/[id]/error.tsx`

**What good looks like:** Throw a test error in an admin page; it appears in the Sentry dashboard within 60 seconds with no PII in the payload.

**Acceptance:** Sentry dashboard shows event; phone number fields in error metadata are `[REDACTED]`; `SENTRY_DSN` env var is set in Vercel.

**Risks:** Sentry may capture PII in error `extra` or `context` fields. The `beforeSend` scrub hook must be tested against a synthetic error containing a real phone number before production deployment.

---

### TASK-006: Add last-OWNER guard to team actions

**Execute:** In `field-service/app/(admin)/admin/team/actions.ts`, before any deactivate or role-change action that would affect the last OWNER:
1. Count `db.adminUser.count({ where: { role: 'OWNER', active: true } })`.
2. If the count would drop to 0, throw a `CrudActionError` with code `LAST_OWNER_PROTECTED`.
3. Add a self-deactivation guard: if `actorId === targetUserId`, throw `SELF_DEACTIVATION_BLOCKED`.

**Why:** If all OWNER accounts are deactivated, no one can re-activate them. The admin platform becomes permanently inaccessible.

**Files to change:**
- `field-service/app/(admin)/admin/team/actions.ts`

**What good looks like:** Attempting to deactivate the last active OWNER returns a user-visible error in the UI.

**Acceptance:** With one active OWNER, deactivating that OWNER shows "This action would remove all platform owners — operation blocked". An admin cannot deactivate their own account.

**Risks:** Low. Pure validation logic — no schema changes.

---

## Phase 1 — High Value / Low Risk

---

### TASK-007: Add Prisma indexes — Booking

**Execute:** Add to `model Booking` in `prisma/schema.prisma`:
```prisma
@@index([status, createdAt])
@@index([matchId])
```
Run `pnpm prisma migrate dev --name add_booking_indexes` from `field-service/`.

**Why:** The bookings list page does `findMany({ where: { status: ... }, orderBy: { createdAt: ... } })` against a table with zero indexes. This is a sequential scan.

**Files to change:** `field-service/prisma/schema.prisma`, new migration file

**Acceptance:** `EXPLAIN ANALYSE SELECT * FROM bookings WHERE status='CONFIRMED' ORDER BY "createdAt" DESC LIMIT 50;` shows `Index Scan` not `Seq Scan`.

**Risks:** Migration modifies a live production table. Use `CREATE INDEX CONCURRENTLY` in the migration SQL to avoid table locks. Verify Prisma generates `CONCURRENTLY` or patch the migration SQL manually.

---

### TASK-008: Add Prisma indexes — Job

**Execute:** Add to `model Job`:
```prisma
@@index([status, createdAt])
@@index([providerId, status])
@@index([bookingId])
```
Migrate.

**Why:** Zero indexes; every jobs-list query and every dispatch page load is a full scan.

**Files:** `prisma/schema.prisma`, migration

**Acceptance:** `EXPLAIN ANALYSE` on `WHERE status IN (...)` shows index scan.

**Risks:** Same as TASK-007 — use CONCURRENTLY.

---

### TASK-009: Add Prisma indexes — Quote, Match, Payment, Invoice, Dispute, ProviderPayout

**Execute:** Add indexes to these 6 models in a single migration:
- `Quote`: `@@index([status, createdAt])`, `@@index([matchId])`
- `Match`: `@@index([jobRequestId])`, `@@index([providerId, status])`, `@@index([status, createdAt])`
- `Payment`: `@@index([status, createdAt])`, `@@index([bookingId])`
- `Invoice`: `@@index([bookingId])`, `@@index([status, createdAt])`
- `Dispute`: `@@index([status, createdAt])`, `@@index([jobId])`
- `ProviderPayout`: `@@index([status, createdAt])`, `@@index([providerId, createdAt])`

**Why:** All 6 models appear in admin list pages with status-filter/order-by queries and have zero indexes.

**Files:** `prisma/schema.prisma`, migration

**Acceptance:** Each model's primary list query uses an index scan per `EXPLAIN ANALYSE`.

**Risks:** Same CONCURRENTLY caveat. Batch into one migration to reduce migration count.

---

### TASK-010: Fix handlePaymentFailed — add ops alert

**Execute:** Update `lib/payments.ts:490-498`:
1. Write a `OpsQueueAssignment` for `PAYMENT_FOLLOW_UP` queue with the booking ID as `entityId`.
2. Send an ops WhatsApp notification (or Slack via webhook) with booking ID and failure reason.
3. Update `Payment.failureReason` with the actual PSP error message from `event.failureReason` (not the hardcoded string `'Payment declined'`).

```ts
export async function handlePaymentFailed(event: PaymentEvent): Promise<void> {
  await db.$transaction(async (tx) => {
    await tx.payment.update({
      where: { bookingId: event.bookingId },
      data: {
        status: 'FAILED',
        pspReference: event.pspReference,
        failureReason: event.failureReason ?? 'Payment declined',
      },
    })
    await tx.opsQueueAssignment.upsert({
      where: { queueType_entityId: { queueType: OPS_QUEUE_TYPES.PAYMENT_FOLLOW_UP, entityId: event.bookingId } },
      create: { queueType: OPS_QUEUE_TYPES.PAYMENT_FOLLOW_UP, entityId: event.bookingId },
      update: {},
    })
  })
}
```

**Why:** Failed payments currently dead-end silently — no ops alert, no queue entry, no retry. The booking remains in an undefined state.

**Files:** `field-service/lib/payments.ts:490-498`

**Acceptance:** Simulate a PSP FAILED webhook; confirm `OpsQueueAssignment` row is written for the booking; confirm `/admin/payments` shows the booking in the PAYMENT_FOLLOW_UP queue.

**Risks:** The `OPS_QUEUE_TYPES.PAYMENT_FOLLOW_UP` enum value must exist — confirm before writing.

---

### TASK-011: Fix WhatsApp failure handling — structured logs

**Execute:** In `lib/whatsapp.ts`, replace the 5 `.catch(() => {})` patterns at lines 203, 931, 1017, 1071, 1386 with:
```ts
.catch((err) => {
  console.error('[whatsapp] send failed', { template: '<template-name>', phone: maskPhone(phone), error: err instanceof Error ? err.message : String(err) })
})
```
This does not add retry logic (that is a P3 task) but ensures failures are visible in logs and Sentry.

**Why:** WhatsApp failures are silently swallowed. There is no way to know if a provider was never notified of their approval, or if a customer never received a booking confirmation.

**Files:** `field-service/lib/whatsapp.ts:203,931,1017,1071,1386`

**Acceptance:** Force a WhatsApp API failure (invalid token in dev); confirm Sentry receives an event; confirm the log line appears in Vercel function logs.

**Risks:** Low. Adds logging only — no behavior change.

---

### TASK-012: Add per-route error boundary for technicians/[id]

**Execute:** Create `field-service/app/(admin)/admin/technicians/[id]/error.tsx` modelled on `app/(admin)/admin/providers/[id]/error.tsx`.

**Why:** `technicians/[id]/page.tsx` is 1268 lines with 4 sequential DB calls and no dedicated error boundary. When any of those calls throws, the user gets the generic group-level error message with no useful context.

**Files:**
- `field-service/app/(admin)/admin/technicians/[id]/error.tsx` (new)

**Acceptance:** Throw a test error in `technicians/[id]/page.tsx`; the error boundary renders a "Could not load provider profile" message with a retry button, not the generic group error.

**Risks:** None.

---

### TASK-013: Parallelise dispatch page DB fetches

**Execute:** In `app/(admin)/admin/dispatch/page.tsx`, wrap the two independent top-level fetches in `Promise.all()`:
```ts
const [requests, assignments] = await Promise.all([
  db.jobRequest.findMany({ ... }).catch(...),
  listOpsQueueAssignments(db, ...).catch(...),
])
```
For the `selectedRequest` block (which runs only when `request` param is set), also parallelise:
```ts
const [dispCase, candidates, history, leads, messages] = await Promise.all([
  getCaseByEntity(...).catch(() => null),
  rankCandidatesForJobRequest(...).catch(...),
  getDispatchHistory(...).catch(...),
  db.lead.findMany({ ... }),
  db.messageEvent.findMany({ ... }),
])
```

**Why:** The current 7+ sequential awaits add 500–1500 ms of latency to every dispatch page load. These queries are independent and can run concurrently.

**Files:** `field-service/app/(admin)/admin/dispatch/page.tsx:65-530`

**Acceptance:** Dispatch page cold load < 600 ms (measured with `browser_evaluate` timing). No functional regressions.

**Risks:** Ensure the combined `Promise.all` does not include queries that depend on each other's results. The `inbound` messages query at line 471 depends on `selectedRequest.id` which must exist before the second `Promise.all`.

---

### TASK-014: Parallelise technicians/[id] DB fetches

**Execute:** Combine 4 sequential awaits into 2 parallel batches:
```ts
const [provider, auditEvents, latestApplication] = await Promise.all([
  db.provider.findFirst({ where: { id }, include: { ... } }),
  db.adminAuditEvent.findMany({ where: { ... } }),
  db.providerApplication.findFirst({ where: { phone }, ... }),
])
if (!provider) notFound()
const completedTotal = await db.job.count({ where: { providerId: id, status: 'COMPLETED' } })
```
Note: `auditEvents` references `provider.providerNotes` in its `where`, so it cannot be parallelised with `provider`. Move to two-step parallel approach.

**Why:** 4 sequential DB round-trips at page load; each adds 50–200 ms.

**Files:** `field-service/app/(admin)/admin/technicians/[id]/page.tsx:106-254`

**Acceptance:** Provider detail page cold load time reduces by ≥ 30% vs baseline.

**Risks:** `auditEvents` query includes an OR over `provider.providerNotes` IDs. Run the parallelism only for the main `provider` + `latestApplication` pair; run `auditEvents` + `completedTotal` in a second Promise.all after provider is confirmed.

---

### TASK-015: Add shape-matching loading.tsx for dispatch

**Execute:** Create `app/(admin)/admin/dispatch/loading.tsx` with a 2-column layout skeleton (left: list of job request cards, right: detail panel placeholder).

**Why:** The current group-level skeleton shows 6 equal-size cards, which is misleading on the dispatch page that has a 2-panel layout.

**Files:** `field-service/app/(admin)/admin/dispatch/loading.tsx` (new)

**Acceptance:** Navigating to `/admin/dispatch` shows a 2-panel skeleton matching the page shape, not a card grid.

**Risks:** None.

---

### TASK-016: Add shape-matching loading.tsx for applications

**Execute:** Create `app/(admin)/admin/applications/loading.tsx` with a table skeleton (header row + 8 ghost rows).

**Files:** `field-service/app/(admin)/admin/applications/loading.tsx` (new)

**Acceptance:** Table skeleton appears during navigation to `/admin/applications`.

**Risks:** None.

---

### TASK-017: Add shape-matching loading.tsx for technicians/[id]

**Execute:** Create `app/(admin)/admin/technicians/[id]/loading.tsx` with a vertical profile skeleton (header stats row + section cards).

**Files:** `field-service/app/(admin)/admin/technicians/[id]/loading.tsx` (new)

**Acceptance:** Profile skeleton appears during navigation from the providers list to a provider detail page.

**Risks:** None.

---

## Phase 2 — Code Quality and Consistency

---

### TASK-018: Migrate applications page actions to co-located actions.ts

**Execute:**
1. Create `app/(admin)/admin/applications/actions.ts`.
2. Extract `approveApplication`, `rejectApplication`, `requestMoreInfo` from `applications/page.tsx` into the new file. Each must use `crudAction()` if not already.
3. Import and use in `page.tsx` via form `action` props.

**Why:** Inline `'use server'` actions in a 692-line page make the file hard to test, read, and maintain. `approveApplication` currently calls `crudAction()` correctly; `requestMoreInfo` and `rejectApplication` may not.

**Files:** `app/(admin)/admin/applications/page.tsx`, `actions.ts` (new)

**Acceptance:** `applications/page.tsx` no longer contains any `'use server'` directives; all mutations pass through `actions.ts`; test coverage in `__tests__/` for the extracted actions.

**Risks:** Move must preserve the `crudAction()` wrapping and all existing `AuditLog` writes.

---

### TASK-019: Migrate dispatch page actions to co-located actions.ts

**Execute:**
1. Create `app/(admin)/admin/dispatch/actions.ts`.
2. Extract `runAutoAssign`, `rerankForReview`, `overrideAssignment`, `redispatchAction`, `escalateToSupplyAction`, `claimDispatch`, `releaseDispatch` from `dispatch/page.tsx`.
3. Ensure `overrideAssignment`, `redispatchAction`, and `escalateToSupplyAction` use `crudAction()` (currently some bypass it).

**Why:** Dispatch page has 8 inline server actions that bypass `crudAction()` inconsistently — some write `AuditLog`, some do not.

**Files:** `app/(admin)/admin/dispatch/page.tsx`, `actions.ts` (new)

**Acceptance:** `dispatch/page.tsx` has no `'use server'` directives; all 8 actions use `crudAction()`; audit log has entries for `dispatch.override_assignment`, `dispatch.escalate`, etc.

**Risks:** The `crudAction()` wrapping adds a DB write in a transaction path that may be time-sensitive for dispatch. Test that transaction timeouts are not hit under load.

---

### TASK-020: Decompose technicians/[id] into sub-components

**Execute:** Extract the following sections from `technicians/[id]/page.tsx` into `_components/`:
1. `ProviderStatsHeader` — avatar, name, status badge, completion rate
2. `ProviderScheduleSection` — weekly schedule grid
3. `ProviderNotesSection` — note list + add note form
4. `ProviderCertificationsSection` — cert list + add/verify form
5. `ProviderEquipmentSection` — equipment list + add/delete form
6. `ProviderAuditTrail` — audit event list

The page component passes fetched data as props; sub-components handle rendering only.

**Why:** 1268-line page is unmaintainable. Even experienced engineers cannot hold the full mental model of this page in working memory.

**Files:** `app/(admin)/admin/technicians/[id]/page.tsx`, 6 new component files in `app/(admin)/admin/technicians/[id]/_components/`

**Acceptance:** Page file ≤ 300 lines; each sub-component is independently testable; no functional regressions.

**Risks:** The 11 inline server action wrappers near the top of the file (`toggleActive`, `submitProviderStatus`, etc.) must remain in `page.tsx` or be moved to `actions.ts` first (see TASK-019 pattern).

---

### TASK-021: Align smoke spec with current route inventory

**Execute:** Update `e2e/smoke.spec.ts` to add the 18 routes missing from `ADMIN_LIST_ROUTES`:
```
/admin/client-requests
/admin/shortlists
/admin/breached
/admin/jobs
/admin/lead-unlock-disputes
/admin/provider-credit-payments
/admin/provider-wallets
/admin/scheduler
/admin/team
/admin/technicians
/admin/messages  (already present)
```
Also add detail-page smoke tests for:
- `/admin/technicians/[id]` — navigate from list, assert no error
- `/admin/provider-credit-payments/[id]` — navigate from list

**Why:** 18 routes are never regression-tested after deploy. Breakages are invisible until an ops user reports them.

**Files:** `field-service/e2e/smoke.spec.ts`

**Acceptance:** All smoke tests pass on staging with valid `E2E_ADMIN_EMAIL` and `E2E_ADMIN_PASSWORD`.

**Risks:** Some pages (e.g. `/admin/breached`) may legitimately render empty when there are no breached cases. Assert `response?.status() < 400` not specific content.

---

### TASK-022: Fix reports page — use next/image

**Execute:** In `app/(admin)/admin/reports/page.tsx:58`, replace `<img>` with `<Image>` from `next/image`. Remove the `eslint-disable` comment at line 56.

**Why:** Resolves 2 of 3 lint warnings; prevents LCP regression from unoptimised images.

**Files:** `app/(admin)/admin/reports/page.tsx:56-64`

**Acceptance:** `pnpm lint` shows 1 warning (incompatible library) instead of 3.

**Risks:** None.

---

### TASK-023: Apply ISR to static-ish admin pages

**Execute:** In `app/(admin)/admin/settings/page.tsx`, `app/(admin)/admin/scheduler/page.tsx`, `app/(admin)/admin/services/page.tsx`, and `app/(admin)/admin/reports/page.tsx`, replace `export const dynamic = 'force-dynamic'` with:
```ts
export const revalidate = 60
```

**Why:** These pages show relatively stable data (settings, cron schedule metadata, service catalog, aggregate reports). `force-dynamic` forces a full database round-trip on every page load from every admin user.

**Files:** 4 `page.tsx` files

**Acceptance:** Navigating to `/admin/reports` in rapid succession makes only one DB call per 60 seconds (verify with DB query log).

**Risks:** Reports show slightly stale data (up to 60 s). Acceptable for aggregate dashboards; document the TTL in the page header.

---

### TASK-024: Add Payment retry fields to Prisma schema

**Execute:**
1. Add to `model Payment` in `prisma/schema.prisma`:
   ```prisma
   retryCount   Int       @default(0)
   lastRetryAt  DateTime?
   ```
2. Generate and run migration.

**Why:** Enables idempotent retry logic for failed payments without a separate retry table. Referenced by the P1-6 payments fix.

**Files:** `prisma/schema.prisma`, new migration

**Acceptance:** `Payment` model has `retryCount` and `lastRetryAt` fields; migration applies cleanly.

**Risks:** Non-breaking additive change; existing rows get default values.

---

### TASK-025: Add nav grouping to admin sidebar

**Execute:** Update `app/(admin)/layout.tsx` to group `NAV_ITEMS` into sections using the IA from `docs/admin-rebuild-implementation-plan.md` section 1. Add visual section headers (small caps labels) between groups. Keep all hrefs unchanged.

**Why:** 27 flat nav items are hard to scan. Grouped sections map to the ops workflow and reduce cognitive load.

**Files:** `app/(admin)/layout.tsx`

**Acceptance:** Sidebar renders 5 labelled sections; all existing hrefs are preserved; no new routes added or removed (except `/admin/audit-log` which was removed in TASK-002).

**Risks:** Visual change only. Snapshot test if one exists.

---

### TASK-026: Replace (tx as any).providerCategory optional chains

**Execute:** In `admin/applications/page.tsx:201-211` and `lib/provider-auto-approve.ts:116-127`, confirm `ProviderCategory` is in the Prisma schema. If confirmed, replace `(tx as any).providerCategory?.createMany?.(...)` with typed `tx.providerCategory.createMany(...)`.

**Why:** The optional-chain pattern silently skips category writes if the model doesn't exist on the transaction client. This is a masked type error.

**Files:**
- `app/(admin)/admin/applications/page.tsx:201`
- `lib/provider-auto-approve.ts:116`

**Acceptance:** TypeScript accepts the call without `as any`; `pnpm tsc --noEmit` passes.

**Risks:** Grep confirms `ProviderCategory` exists in schema (line 681) so this is safe.

---

## Phase 3 — Long-term Quality

---

### TASK-027: Create lib/logger.ts and standardise console.error calls

**Execute:**
1. Create `field-service/lib/logger.ts` wrapping `pino` with structured JSON output.
2. Replace the ~40 `console.error('[admin/...]', ...)` calls in admin page files with `logger.error(...)`.
3. Configure `pino` to include `requestId` from the Next.js request headers.

**Why:** All production error logging currently goes to `console.error` with no structure, no request correlation, and no log level. Vercel logs are hard to search. Structured logs enable Vercel Log Drains to Datadog/Axiom.

**Files:** `lib/logger.ts` (new), ~40 page and lib files

**Acceptance:** A test error in an admin page produces a JSON log line with `level`, `msg`, `requestId`, and relevant context fields visible in Vercel function logs.

**Risks:** `pino` adds ~15 KB to the server bundle. Use dynamic import or ensure tree-shaking is working.

---

### TASK-028: Create /admin/team/permissions route

**Execute:** Create `app/(admin)/admin/team/permissions/page.tsx` showing a matrix of admin roles (OPS, FINANCE, TRUST, ADMIN, OWNER) vs capabilities derived from `lib/ops-dashboard/permissions.ts`. Display as a read-only table for now; add edit capability behind a flag in a follow-up.

**Why:** Documented as a missing page in `CLAUDE.md`. Ops needs to understand what each role can do.

**Files:** `app/(admin)/admin/team/permissions/page.tsx` (new), `app/(admin)/layout.tsx` (add to nav under Team)

**Acceptance:** `/admin/team/permissions` renders a readable role-capability matrix with no errors.

**Risks:** If `rolesForCapability` from `lib/ops-dashboard/permissions.ts` covers all capabilities, the page can be static — no DB required.

---

### TASK-029: Add Supabase RLS policies spike

**Execute (spike only — not implementation):**
1. Identify every Supabase REST API call in the codebase (anon key usage).
2. Document which tables are read/written by which user roles via the REST API (not Prisma server-side).
3. Draft RLS policy SQL for the top 5 highest-risk tables (`customers`, `providers`, `bookings`, `payments`, `provider_applications`).
4. Test on a staging Supabase branch.

**Why:** Zero RLS policies means any authenticated Supabase user can query any table via `https://<project>.supabase.co/rest/v1/<table>`. This is the highest-severity security finding.

**Files:** New `docs/rls-spike.md`; `supabase/migrations/` (staging only during spike)

**Acceptance:** Spike produces a written policy set that can be reviewed and applied. Full implementation requires a separate PR after review.

**Risks:** RLS migration is high-risk. The spike must identify all code paths that rely on service-role vs anon-role access before policies are written.

---

### TASK-030: Create /admin/audit-log route

**Execute:**
1. Create `app/(admin)/admin/audit-log/page.tsx`.
2. Fetch from `AuditLog` and `AdminAuditEvent` with pagination (50 per page), filter by `entityType`, `action`, and date range.
3. Re-add the "Audit Log" entry to `NAV_ITEMS` in `layout.tsx` (removed in TASK-002).

**Why:** The audit log is critical for ops investigation but the nav link has been dead since the platform was built.

**Files:**
- `app/(admin)/admin/audit-log/page.tsx` (new)
- `app/(admin)/layout.tsx` (re-add nav item)

**Acceptance:** `/admin/audit-log` renders a paginated table of `AuditLog` + `AdminAuditEvent` entries; filter by entity type works; nav link is restored.

**Risks:** `AuditLog` may contain sensitive `before`/`after` JSON. Ensure the page is OWNER-gated for full field display; OPS role sees only `action` + `entityType` + `timestamp`.

---

### TASK-031: Activate smoke spec in CI

**Execute:** Add a smoke job to `.github/workflows/ci.yml` that runs when `E2E_BASE_URL`, `E2E_ADMIN_EMAIL`, and `E2E_ADMIN_PASSWORD` are set as GitHub repository secrets. The job should run `pnpm playwright test` from `field-service/` after each successful deploy.

**Why:** The smoke spec exists and covers 20 routes but never runs because there is no CI and no deploy hook. Post-deploy regressions are only caught by ops users.

**Files:** `.github/workflows/ci.yml`

**Acceptance:** After deploying a branch, the smoke job runs and reports pass/fail in GitHub Actions.

**Risks:** Requires admin test account credentials as GitHub secrets. Ensure the test account is a non-production account with read-only access to production-safe test data.

---

### TASK-032: State machine for Job status transitions

**Execute:**
1. Create `lib/job-state-machine.ts` with a typed transition map for `JobStatus` (11 states).
2. Add a `validateJobTransition(from: JobStatus, to: JobStatus): void` function that throws for invalid transitions.
3. Wrap all `db.job.update({ data: { status: ... } })` calls in `lib/jobs.ts` and `lib/matching/` with the validator.

**Why:** 11 job statuses are modified from scattered locations without validation. Invalid state transitions (e.g. COMPLETED → STARTED) can occur silently.

**Files:** `lib/job-state-machine.ts` (new), `lib/jobs.ts`, `lib/matching/service.ts`

**Acceptance:** An attempt to transition a COMPLETED job to EN_ROUTE throws `InvalidJobTransition`; unit tests cover all valid and invalid transitions.

**Risks:** May expose existing invalid transitions in production data. Run `SELECT status, COUNT(*) FROM jobs GROUP BY status` before deploying to understand the current state distribution.

---

### TASK-033: Run backfill-admin-users.ts against production

**Execute:** This is a pre-requisite for TASK-004.
1. Dry-run: `pnpm tsx scripts/backfill-admin-users.ts --dry-run` against production DB.
2. Review output — every admin account that currently uses `user_metadata.role` should appear.
3. Full run: `pnpm tsx scripts/backfill-admin-users.ts` after review.
4. Verify: `SELECT id, email, role FROM admin_users` should have an entry for every active admin.

**Why:** TASK-004 (remove metadata fallback) will lock out any admin without an `AdminUser` row. This backfill must complete successfully before TASK-004 is deployed.

**Files:** `field-service/scripts/backfill-admin-users.ts` (already exists)

**Acceptance:** Every production admin account appears in `admin_users`; zero accounts rely solely on `user_metadata.role`.

**Risks:** The backfill script creates new `AdminUser` rows. Verify it correctly maps `user_metadata.role = 'owner'` to `Role.OWNER` and `'admin'` to `Role.ADMIN`.

---

## Summary Table

| Task | Phase | Effort | Priority |
|------|-------|--------|---------|
| TASK-001: Delete scratch file | 0 | S | P0 |
| TASK-002: Remove dead nav link | 0 | S | P0 |
| TASK-003: Add CI workflow | 0 | M | P0 |
| TASK-004: Harden proxy.ts auth | 0 | M | P0 |
| TASK-005: Add Sentry | 0 | M | P0 |
| TASK-006: Last-OWNER guard | 0 | S | P0 |
| TASK-007: Booking indexes | 1 | M | P1 |
| TASK-008: Job indexes | 1 | M | P1 |
| TASK-009: Quote/Match/Payment/etc indexes | 1 | M | P1 |
| TASK-010: Fix handlePaymentFailed | 1 | M | P1 |
| TASK-011: Fix WhatsApp failures | 1 | M | P1 |
| TASK-012: error.tsx for technicians/[id] | 1 | S | P1 |
| TASK-013: Parallelise dispatch fetches | 1 | M | P1 |
| TASK-014: Parallelise technicians/[id] fetches | 1 | M | P1 |
| TASK-015: loading.tsx for dispatch | 1 | S | P1 |
| TASK-016: loading.tsx for applications | 1 | S | P1 |
| TASK-017: loading.tsx for technicians/[id] | 1 | S | P1 |
| TASK-018: Migrate applications actions | 2 | M | P2 |
| TASK-019: Migrate dispatch actions | 2 | L | P2 |
| TASK-020: Decompose technicians/[id] | 2 | L | P2 |
| TASK-021: Align smoke spec | 2 | S | P2 |
| TASK-022: Fix reports <img> | 2 | S | P2 |
| TASK-023: ISR for static pages | 2 | S | P2 |
| TASK-024: Payment retry fields | 2 | S | P2 |
| TASK-025: Nav grouping | 2 | M | P2 |
| TASK-026: Fix providerCategory optional chain | 2 | S | P2 |
| TASK-027: lib/logger.ts | 3 | M | P3 |
| TASK-028: /admin/team/permissions route | 3 | L | P3 |
| TASK-029: RLS spike | 3 | XL | P3 |
| TASK-030: /admin/audit-log route | 3 | M | P3 |
| TASK-031: Smoke spec in CI | 3 | S | P3 |
| TASK-032: Job state machine | 3 | L | P3 |
| TASK-033: Backfill admin users | pre-P0-4 | S | P0 blocker |
