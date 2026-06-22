# TASK-029 — Supabase REST RLS Spike (provider onboarding platform)

## Date

2026-05-06

## Objective

Prepare a production-safe plan for enabling Row-Level Security on Supabase tables consumed from the admin and customer-facing apps.  
This is a spike (design + mapping + test plan) and must be completed before any RLS policy rollout to production.

## Current baseline from codebase inspection

- API routes and page/server handlers currently connect through Prisma most of the time for writes and privileged reads.
- A number of reads still go through direct Supabase REST clients (anon key path), especially in auth session resolution and OAuth/callback helpers.
- The current `supabase/migrations/20260327141019_init.sql` file has no project-wide RLS policy grant statements.
- Admin authorization is already enforced for Next routes via `requireAdmin()` and `proxy.ts`, but that does not protect direct Supabase REST paths.
- Admin user role is now resolved from `admin_users` in DB, not from mutable auth metadata, so auth privilege cannot be downgraded there.
- A secure design target is needed before writing policies:
  - keep privileged admin pages functional,
  - keep provider/customer app paths unchanged,
  - preserve anonymous OTP and signup flows,
  - avoid blocking internal jobs that rely on service role key.

## 1) REST call map inventory

### A. `field-service/lib/auth.ts` (session resolution)
- `createServerClient` and `createServiceClient` instantiate Supabase with `NEXT_PUBLIC_SUPABASE_ANON_KEY` or `SUPABASE_SERVICE_ROLE_KEY`.
- `getSession()` calls `supabase.auth.getUser(token)` via anon client.
- `checkWorkerPortalAccess` and provider lookups call Prisma (`db.provider.findFirst`), not Supabase REST.
- Impact: auth route remains anon-key read of auth context and should be allowed for authenticated users only.

### B. `field-service/app/api/auth/session/route.ts`
- This endpoint reads auth token from cookie and validates session before returning user metadata.
- Uses anon client and does not hit application tables directly.
- Impact: RLS should allow session refresh for any signed-in subject tied to the provided token.

### C. Admin service actions and API routes under `field-service/app/api/**`  
Most write operations are Prisma server-side and should continue to bypass browser RLS using service role or direct DB.
- Any Supabase client usage found in API routes should be listed by direct code scan before implementation.
- Impact: these routes should remain non-blocked by RLS since Prisma handles isolation.

### D. UI pages using Supabase direct read/write
- Most admin and customer pages use Prisma reads (`db.*`) and therefore are not impacted by RLS for confidentiality.
- Direct REST reads should be cataloged in the implementation ticket before policy edits.

## 2) Role model and policy draft basis

## Role levels (DB authoritative)
- `OWNER` (highest)
- `ADMIN`
- `FINANCE`
- `TRUST`
- `OPS`
- `null` for non-admin authenticated users

## Policy scope (first version)

Tables flagged for policy coverage in this spike:
1. `customers`
2. `providers`
3. `bookings`
4. `payments`
5. `provider_applications`
6. `admin_users` (strict admin-only, no anon access)
7. `audit_logs`
8. `admin_audit_events`

## Draft policy intent

### `admin_users`
- SELECT/INSERT/UPDATE/DELETE only for service role.
- All anon/anon-like requests denied.

### `customers`
- `SELECT`:  
  - Admin roles: all if session corresponds to active admin in `admin_users`  
  - Providers/Customers: limited by ownership where necessary (provider/customer matching keys)
- `INSERT/UPDATE`: service-role + trusted backend jobs only.

### `providers`
- `SELECT`:  
  - Admin roles: all  
  - Provider owners: own row by `userId` / linked phone  
  - Public: denied
- `UPDATE`:  
  - service-role and owner operations.

### `bookings`
- `SELECT`:  
  - Admin roles: all  
  - Provider user: only assigned or owned bookings  
  - Customer user: own bookings by customer id/phone bridge
- `INSERT/UPDATE`: service-role only for now.

### `payments`
- `SELECT`:  
  - Admin roles + Finance roles via role map  
  - Customer/provider own rows only if that view exists
- `INSERT/UPDATE`: service-role only.

### `provider_applications`
- `SELECT`:  
  - Admin roles only
- `INSERT`: service-role only
- `UPDATE`: service-role only.

## 3) Policy SQL skeleton (for follow-up, not applied yet)

```sql
-- 1) Admin-only read for audit tables
create policy if not exists "admin_audit_events_read_admins"
  on public.admin_audit_events
  for select using (
    exists (
      select 1 from public.admin_users au
      where au.id = auth.uid()
      and au.active = true
      and au.role in ('ADMIN','OWNER')
    )
  );

-- 2) Providers: admin read, owner write
create policy if not exists "providers_read_admins"
  on public.providers
  for select using (
    exists (
      select 1 from public.admin_users au
      where au.user_id = auth.uid()
      and au.active = true
    )
    or (auth.jwt() ->> 'sub') = user_id
  );

-- 3) Bookings: owner/admin reads
create policy if not exists "bookings_read_actors"
  on public.bookings
  for select using (
    exists (
      select 1 from public.admin_users au
      where au.user_id = auth.uid()
      and au.active = true
    )
    or (auth.jwt() ->> 'sub') = customerId
  );
```

> Note: The real implementation must be production-safe and will use real column names from the target tables; this is only a scaffold.

## 4) Staging test plan (required before prod)

1. Apply policies only in a dedicated staging branch/project and verify Prisma migrations still run.
2. Validate CRUD surfaces:
   - Admin pages render with active admin row and no regressions.
   - Customer flows still work with anonymous and OTP-authenticated users.
   - Provider flows still load assigned jobs and own details.
3. Run negative tests:
   - Inactive admin cannot read protected admin tables.
   - Anonymous token cannot read `customers`, `providers`, `bookings`, `payments`, `provider_applications`.
   - Service-role background jobs can still operate.
4. Capture and document all policy exceptions that must remain in service-role context.
5. Add a follow-up ticket to migrate from static policies to per-route role checks where policy complexity rises.

## 5) Risks and mitigations

- **Risk:** blocking admin pages that still rely on anon-key list reads before policy map complete.  
  - *Mitigation:* keep RLS off until full call map and endpoint categorization is finished.
- **Risk:** policy logic drift from actual Prisma joins.  
  - *Mitigation:* pair each policy with explicit endpoint path in this document and maintain a smoke test matrix.
- **Risk:** production outage by introducing policy on `audit_logs` with large joins.  
  - *Mitigation:* pilot only on read tables first, then enable selective writes.

## 6) Open questions

1. Can we rely on service role calls exclusively for Prisma + admin dashboards in phase 1?
2. Should `customer` and `provider` reads remain Prisma-only indefinitely to avoid REST policy complexity?
3. Do we require separate supabase projects for staging and production policy tests to fully isolate policy bugs?

## 7) Deliverables from this spike

- Complete endpoint-to-table mapping (to be attached in follow-up).
- Signed policy set for staged rollout.
- Rollout checklist with rollback command.
- Incident drillbook for accidental lockouts during rollout.
