# Migration Guide — Lifting the scaffold into the real repo

Read this before touching any files. Order matters.

## Step 0 — Read the conventions doc

`docs/admin-crud.md`. It's one page. It defines the four rules that the rest of this guide assumes you've internalised.

## Step 1 — Stabilisation (WS-A) BEFORE anything else

The live admin currently crashes on `/admin/providers/[id]` and `/admin/bookings/[id]` (Error ID 3811911274). Fix that first.

1. Find the server component that renders provider-detail. List every Prisma field it reads.
2. Diff against current `prisma/schema.prisma`. Look for referenced fields that were renamed/removed recently.
3. Patch the referenced fields OR guard against null relations, whichever has the smaller blast radius. Don't change schema in the stabilisation PR.
4. Copy `src/app/admin/error.tsx` (and the per-route `error.tsx` examples) into the real repo at the same paths. These are route-level error boundaries that render a graceful fallback instead of the white-screen crash.
5. Copy `tests/smoke.spec.ts` into the repo's Playwright suite. Wire it into CI. Any admin route returning non-2xx should fail the build.
6. Ship WS-A as its own PR before touching anything else.

## Step 2 — Database migrations (additive only)

Apply `prisma/schema.prisma` model additions as a single additive migration:

- **New models:** `AdminAuditEvent`, `AdminUser`, `FeatureFlag`, `ProviderCertification`, `ProviderEquipment`, `CustomerNote`, `ProviderNote`.
- **New fields on existing models:**
  - `Customer`: `address`, `isBlocked`, `blockedReason`, `suspendedUntil`, `internalFlags`, `archivedAt`, `archiveReason`.
  - `Provider`: `kycStatus`, `payoutVerifiedAt`, `suspendedUntil`, `suspendedReason`, `strikes`, `archivedAt`, `archiveReason`.
- **No renames.** No drops. If the real models differ in naming, adjust mine to match theirs, not the other way around.
- Backfill defaults in the same migration (`isBlocked: false`, `strikes: 0`, etc.) so no nulls in required fields.

Run `prisma migrate dev` in staging. Verify existing queries still work (they will — it's additive).

## Step 3 — Lift the core library

Copy file-for-file. These are self-contained:

- `src/lib/db.ts` — only if you don't already have a Prisma singleton.
- `src/lib/flags.ts` — adapt if you have an existing flag system.
- `src/lib/auth.ts` — **adapt heavily**. Replace `getSession()` with your real session reader.
- `src/lib/crud-action.ts` — copy as-is.
- `src/lib/audit.ts` — copy as-is.
- `src/lib/reason-codes.ts` — copy as-is.
- `src/lib/sla.ts` — merge with any existing SLA registry.

Ship this as a PR of its own. It adds capability without touching any user-facing surface.

## Step 4 — Lift the kit components

Copy file-for-file:

- `src/components/admin/crud/table.tsx`
- `src/components/admin/crud/form.tsx`
- `src/components/admin/crud/confirm.tsx`
- `src/components/admin/crud/index.ts`

If you use a UI primitive library other than shadcn, rewrite the primitive imports at the top of each file. Logic stays identical.

## Step 5 — Refactor Locations to use the kit

This is the **proof of pattern** step. Do not skip it.

Copy `src/app/admin/locations/*` into the real repo, adapting to the real Prisma model for locations. This refactors the existing Locations module to run on the new kit.

Acceptance: Locations behaves exactly as before (same list, same Add node, same inline edit, same Deactivate, same Delete), but now every mutation writes an `AdminAuditEvent` row.

Flip flag `admin.crud.locations` on. Soak for 48 hours. If stable, everything below is the same pattern copy-pasted.

## Step 6 — Customers CRUD

Copy `src/app/admin/customers/*`. Flag: `admin.crud.customers`. Ship, flip for ops only, soak, flip global.

## Step 7 — Providers CRUD

Copy `src/app/admin/providers/*`. Flag: `admin.crud.providers`. Ship.

**Important:** update the matcher's `MISSING_REQUIRED_CERTIFICATION` / `MISSING_REQUIRED_EQUIPMENT` filters to read from the new `ProviderCertification` / `ProviderEquipment` tables. Otherwise fixing a provider's data in the UI doesn't actually make them eligible.

## Step 8 — Admin users & roles

Copy `src/app/admin/team/*` and `scripts/backfill-admin-users.ts`. Flag: `admin.users.v2`.

1. Run the backfill script to populate `AdminUser` from however admins are provisioned today (env var, hardcoded list, whatever).
2. Verify every currently-active admin has an `AdminUser` row with role `ADMIN`.
3. Flip the flag for `OWNER` first — have one person verify they can invite a new user.
4. Flip globally.
5. **Then** rip out the old admin provisioning path (the env-var list or whatever it is). This is the step that moves admin management from "dev ticket" to "owner self-service."

## Step 9 — Feature-flag cleanup

Once every flag has been "on 100%" for 30 days, remove the flag checks from the code. Keep the flag records in the DB for future use.

## Step 10 — Audit log viewer

Not included in this scaffold but follows from the `AdminAuditEvent` table: `/admin/audit` page with filters (entity type, actor, date range, action). ~1 day to build, invaluable for compliance and debugging. Do this when you need it.

## Things that are deliberately out of scope of this scaffold

- Service requests, quotes, bookings, payments, disputes, categories, platform config CRUD — all follow the Customers/Providers pattern. Replicate once the P0 slice is live.
- Search, bulk, export (cross-cutting WS-L) — build after entity CRUD is stable.

## When you're done

You'll have:

- Zero crashes on detail pages (error boundaries catch; smoke tests prevent regressions).
- A consistent CRUD kit every future entity uses.
- Full create/read/update/delete for customers and providers.
- Admin user and role management from the UI.
- Every mutation audited, by construction.
- A pattern your team can apply to every remaining entity without reinventing anything.

That's the P0 slice. The rest of the plan (WS-F through WS-L) is mechanical application of this pattern.
