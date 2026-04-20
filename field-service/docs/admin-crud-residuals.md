# Admin CRUD Residuals

This note captures the remaining blocked or intentionally deferred work after the current admin hardening pass. It is meant to leave zero untriaged material issues in repo-local scope.

## Scope closed in this pass

- Admin access now resolves only through active `AdminUser` rows.
- The legacy Supabase metadata fallback is removed from runtime authorization.
- Customer lifecycle now has additive archive, merge, and purge infrastructure.
- Provider notes now support immutable strike-ledger semantics through `reasonCode` and `strikeDelta`.
- Category requirements now have additive DB-backed tables plus a read/write admin surface.
- The matcher now reads provider certification and equipment data and emits specific missing-requirement reason codes.
- The following operational admin pages now route their mutations through `crudAction()` and dedicated flags:
  - `/admin/bookings/[id]`
  - `/admin/payments`
  - `/admin/disputes`
  - `/admin/applications`
  - `/admin/quotes`
  - `/admin/dispatch`
  - `/admin/validation`
  - `/admin/field-exceptions`
- Queue claim and release mutations now execute through the transaction handle passed into `crudAction()`, so queue ownership writes and audit writes are atomic.
- The provider detail page no longer bypasses the audit contract when toggling `active`.

## Verification status

Verified locally in `field-service/`:

- `pnpm test`
- `pnpm build`
- `pnpm lint`

Known verification noise:

- `components/admin/crud/form.tsx` still emits one React Compiler warning for `form.watch()`. This is pre-existing and does not fail build or lint.
- The new Prisma migration is authored locally, but it could not be applied in this environment because the configured Postgres host was unreachable during `prisma migrate dev`.

## Remaining blocked residuals

These are not hidden defects. They remain because they depend on environment access, data policy, or larger product work not safely finishable from the local workspace alone.

### 1. Prisma migration application and environment backfills still require a reachable staging or production database

Current state:

- The additive schema changes are in the repo.
- The migration exists at `prisma/migrations/20260420173000_category_customer_lifecycle/migration.sql`.
- The environment-dependent scripts exist:
  - `scripts/backfill-categories.ts`
  - `scripts/audit-admin-cutover.ts`

Blocked by:

- The configured Postgres host was unreachable from this environment during migration application.

Required next step:

- Apply the new migration in staging and production.
- Run `scripts/backfill-categories.ts`.
- Run `scripts/audit-admin-cutover.ts`.
- Backfill any missing `AdminUser` rows before final rollout.

### 2. Customer “true purge” is still policy-blocked when immutable request history exists

Current state:

- Archive now schedules purge after 30 days.
- Merge reparents customer-owned records to a canonical target.
- Purge succeeds only when required references have already been moved or cleared.

Blocked by:

- `JobRequest.customerId` is still required and represents historical service records that should not be silently broken.

Required next step:

- Confirm one of these product policies for archived customers with request history:
  - hard delete is disallowed and the system falls back to PII redaction
  - historical requests are reassigned to an archival owner model
  - request history itself becomes redactable

Until that is chosen, “archive then true purge after 30 days” can only be fully honored for customers whose required history has already been detached or merged away.

### 3. Full Playwright mutation coverage is still environment-blocked

Current state:

- Playwright smoke coverage exists and the route inventory is current.
- Repo-local build, test, and lint are green.

Blocked by:

- No committed deterministic admin fixture contract for:
  - seeded `OWNER`, `ADMIN`, and `OPS` accounts
  - stable customer, provider, booking, and queue records
  - idempotent cleanup rules for create/archive flows
- No usable local `E2E_BASE_URL`, `E2E_ADMIN_EMAIL`, and `E2E_ADMIN_PASSWORD` in this implementation environment.

Required next step:

- Define a seeded admin E2E contract.
- Add CRUD-path Playwright specs once those inputs exist.

### 4. The full 14-PR prompt-pack is still not complete

This repo-local pass closes the accessible hardening and migration work, but the overall plan still has deferred workstreams.

Still not complete:

- Full CRUD migrations for the later entity modules described in the prompt pack, especially where the current app still exposes operational or read-only pages instead of full kit-based CRUD surfaces.
- A platform-config editor for `/admin/settings`.
- An audit log viewer with global search/export.
- GitHub follow-up issue creation for WS-F through WS-L.
- Staging and production flag rollout execution.

These are now explicit project work items, not untriaged defects in the current codebase.
