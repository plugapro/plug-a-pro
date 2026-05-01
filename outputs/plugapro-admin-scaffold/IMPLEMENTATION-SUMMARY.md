# Scaffold — What was built and what to do next

## What's in this scaffold (44 files)

**Configuration & meta**
- `README.md`, `package.json`, `tsconfig.json`
- `docs/admin-crud.md` — one-page conventions every engineer must internalise
- `docs/MIGRATION-GUIDE.md` — step-by-step for lifting files into the real repo

**Data model (WS-B, WS-C, WS-D, WS-E)**
- `prisma/schema.prisma` — `AdminUser`, `Role`, `AdminAuditEvent`, `FeatureFlag`, `CustomerNote`, `ProviderCertification`, `ProviderEquipment`, `ProviderNote`, plus additive field extensions on `Customer` and `Provider`

**Core library (WS-B)**
- `src/lib/db.ts` — Prisma singleton
- `src/lib/flags.ts` — feature flag primitive, DB + env sources, typed keys
- `src/lib/auth.ts` — session + role guards (replace `getSession()` with your real one)
- `src/lib/crud-action.ts` — the wrapper that enforces auth + role + flag + validation + audit on every mutation
- `src/lib/audit.ts` — audit writer + shallow diff helper
- `src/lib/reason-codes.ts` — reason-code registry for close-outs, blocks, refunds, etc.
- `src/lib/sla.ts` — SLA registry with breach detection
- `src/lib/utils.ts` — `cn`, date/money formatters, CSV export

**CRUD kit (WS-B)**
- `src/components/admin/crud/table.tsx` — `<CRUDTable>` with inline edit, row actions, bulk select
- `src/components/admin/crud/form.tsx` — `<CRUDForm>` with Zod + react-hook-form + server action handling
- `src/components/admin/crud/confirm.tsx` — `<ConfirmDialog>` + `<DestructiveConfirmDialog>` (typed-name confirmation)
- `src/components/admin/crud/index.ts` — barrel

**Stabilisation (WS-A)**
- `src/app/admin/error.tsx` — route-level error boundary
- `tests/smoke.spec.ts` — Playwright smoke covering every admin list route + one detail per entity

**Locations refactor (WS-B proof)**
- `src/app/admin/locations/page.tsx`, `client.tsx`, `actions.ts`, `schema.ts` — the existing gold-standard module rebuilt on the kit

**Customers CRUD (WS-C)**
- `src/app/admin/customers/page.tsx` — list with search, channel filter, blocked filter, archived toggle, bulk select, CSV export
- `src/app/admin/customers/list-client.tsx`
- `src/app/admin/customers/new/page.tsx` + `form-client.tsx` — manual concierge create
- `src/app/admin/customers/[id]/page.tsx` + `detail-client.tsx` — profile/notes/audit/bookings tabs, Edit, Block, Suspend, Archive, Delete (OWNER), Merge
- `src/app/admin/customers/actions.ts` + `schema.ts` — every action via `crudAction`

**Providers CRUD (WS-D)**
- `src/app/admin/providers/page.tsx` — list with status/KYC filters
- `src/app/admin/providers/list-client.tsx`
- `src/app/admin/providers/new/page.tsx` + `form-client.tsx` — admin-create
- `src/app/admin/providers/[id]/page.tsx` + `detail-client.tsx` — tabbed Profile / Certifications / Equipment / Notes / Audit, KYC editor, Suspend, Reactivate, Deactivate
- `src/app/admin/providers/actions.ts` + `schema.ts` — every action via `crudAction`

**Admin users & roles (WS-E)**
- `src/app/admin/team/page.tsx` — list of admins (owner-only)
- `src/app/admin/team/team-client.tsx` — Invite, edit roles, deactivate, reactivate, revoke
- `src/app/admin/team/permissions/page.tsx` — role/permission matrix reference
- `src/app/admin/team/actions.ts` + `schema.ts`
- `scripts/backfill-admin-users.ts` — idempotent one-time migration from env-var admins to DB

## What the scaffold does NOT include

- A running Next.js app with `node_modules`. This is source only.
- An actual email/WhatsApp provider integration for admin invites. The `sendInviteEmail` in `team/actions.ts` is a stub with a `console.info`. Wire to your real provider.
- The fix for Error ID 3811911274 on provider/booking detail pages. The scaffold provides the error boundary + smoke test PATTERN; your dev still needs to look at server logs and find the specific query that's breaking.
- Payments, Disputes, Service Requests, Quotes, Bookings, Categories CRUD. All follow the Customers/Providers pattern — replicate using the kit once the P0 slice is live.

## How to actually ship this

In order:

1. **Read `docs/MIGRATION-GUIDE.md`.** It's the canonical ship order.
2. **Fix the detail-page crash first** (WS-A). Use server logs to find the breaking query, patch it, apply the error boundary + smoke test.
3. **Apply `prisma/schema.prisma` additions** as a single additive migration.
4. **Lift `src/lib/*` and `src/components/admin/crud/*`** into the real repo.
5. **Refactor existing Locations** to use the kit (proof of pattern). Verify the Locations module still behaves the same; verify `AdminAuditEvent` rows appear.
6. **Lift Customers CRUD** behind `admin.crud.customers` flag. Enable for ops user only → soak → global.
7. **Lift Providers CRUD** behind `admin.crud.providers`. Critical step: update the matcher's `MISSING_REQUIRED_CERTIFICATION` / `MISSING_REQUIRED_EQUIPMENT` checks to read from the new tables.
8. **Lift Admin users & roles** behind `admin.users.v2`. Run `backfill-admin-users.ts`. Verify. Then rip out the old env-var provisioning.

## Three invariants the scaffold enforces by construction

1. **Every mutation writes an `AdminAuditEvent` row.** Not by discipline — by the `crudAction` wrapper. If a PR adds a mutation without going through the wrapper, the audit gap is discoverable in review.
2. **Every mutation checks role.** Same wrapper. The `requiredRole` field is not optional.
3. **Every destructive action uses `<DestructiveConfirmDialog>`.** Not a convention — it's the only destructive action component in the kit. Search results make deviation visible.

## Things your dev will need to adapt

- **Import paths.** Scaffold uses `@/...` aliases assuming `tsconfig paths` is set up. Match your config.
- **`getSession()` in `src/lib/auth.ts`.** Currently a cookie-based stub. Replace with NextAuth / Clerk / Supabase / whatever you use.
- **Prisma model names and fields.** I used names that match what I observed on the live admin (`Customer`, `Provider`, `Booking`, `Category`, `Location`). If the real repo uses different names, rename the scaffold's references.
- **UI primitives.** `<Input>`, `<Button>`, etc. are Tailwind + assumed shadcn shape. Swap if you use a different library.
- **`sendInviteEmail` in `team/actions.ts`.** Stub. Wire to your real email/WhatsApp magic-link.

## Effort estimate

With Claude Code doing the typing and a dev reviewing:

- **Day 1** — Stabilisation (WS-A): fix the crash + error boundary + smoke test.
- **Days 2–3** — CRUD kit (WS-B): lift library + components, refactor Locations, verify audit appears.
- **Day 4** — Admin users & roles (WS-E): lift, backfill, verify owner self-service.
- **Days 5–8** — Customers CRUD (WS-C).
- **Days 9–14** — Providers CRUD (WS-D), including matcher integration with new cert/equipment tables.

Roughly **2–3 weeks of focused single-dev work** to ship the P0 slice end-to-end. Everything after is replication of the pattern.

## What this unlocks

Once this slice is merged, your ops / admin / owner users can:

- Create, read, update, and delete customers from the UI.
- Create, read, update, and delete providers from the UI, including certifications and equipment (which fixes the matcher's filter mystery).
- Invite, re-role, deactivate, and revoke admin teammates without a developer.
- See an audit trail on every record.
- Hit soft-delete (archive) by default; hard-delete is gated to OWNER only.

That's the definition of "this platform can be administered by a non-engineering ops team." Everything else in the original plan (Categories, Payments, Disputes, Bookings, Requests, Search, Bulk, Export, Audit log viewer, Platform config editor) is the same pattern applied to the remaining entities.

## Files worth lifting first, in order

1. `prisma/schema.prisma` additions
2. `src/lib/db.ts`, `flags.ts`, `auth.ts`, `audit.ts`, `crud-action.ts`, `reason-codes.ts`, `sla.ts`, `utils.ts`
3. `src/components/admin/crud/*`
4. `src/app/admin/error.tsx`
5. `tests/smoke.spec.ts`
6. `src/app/admin/locations/*`  ← proof of pattern; validate before going further
7. `src/app/admin/team/*` + `scripts/backfill-admin-users.ts`
8. `src/app/admin/customers/*`
9. `src/app/admin/providers/*`

Same order that `MIGRATION-GUIDE.md` uses.
