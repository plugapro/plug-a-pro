# Plug A Pro Admin CRUD — Reference Scaffold

This is a **pattern-setting reference scaffold** for making the Plug A Pro admin app (`admin.plugapro.co.za`) fully CRUD-capable. It is **not a runnable application on its own** — it's a toolkit of files your developer lifts into the actual Plug A Pro admin repo, adapting paths and imports as needed.

## What's in here

The scaffold implements the five P0 workstreams from `PlugAPro-CRUD-Implementation-Plan.md`:

| Workstream | What you'll find |
|---|---|
| **WS-A** Stabilisation | `src/app/admin/error.tsx`, per-route `error.tsx` examples, `tests/smoke.spec.ts` |
| **WS-B** Reusable CRUD kit | `src/components/admin/crud/*`, `src/lib/crud-action.ts`, `src/lib/audit.ts`, Prisma `AdminAuditEvent` model |
| **WS-C** Customers CRUD | `src/app/admin/customers/*`, Prisma customer extensions |
| **WS-D** Providers CRUD | `src/app/admin/providers/*`, Prisma provider extensions + certifications + equipment |
| **WS-E** Admin users & roles | `src/app/admin/team/*`, Prisma `AdminUser` + `Role` enum, backfill script |

## Assumptions the scaffold makes

- Next.js 14+ App Router (matches what I observed on the live site).
- Prisma over Postgres (matches the Journey Flows page).
- Tailwind + shadcn-style primitives (`@/components/ui/*`). If you don't have shadcn installed, either install it or replace the primitive imports with your equivalent.
- `react-hook-form` + `zod` for forms/validation.
- Server Actions for mutations (no REST layer).
- An existing session/auth mechanism — the scaffold shows where to plug it in (`src/lib/auth.ts`). Replace the stub `getSession()` with your real session reader.

## How to use this

1. Read `docs/MIGRATION-GUIDE.md` first — it walks the dev through lifting files in safe order.
2. Start with `prisma/schema.prisma` — apply the model additions as an **additive** migration.
3. Copy `src/lib/*` and `src/components/admin/crud/*` as-is.
4. Copy `src/app/admin/locations/*` as the **proof of pattern** — refactors your existing Locations module onto the kit.
5. Copy `src/app/admin/customers/*`, `src/app/admin/providers/*`, `src/app/admin/team/*` — adapt to any existing route layout.
6. Run `scripts/backfill-admin-users.ts` once to populate `AdminUser` from whatever provisions admins today.
7. Every new page and action is behind a feature flag (`admin.crud.customers`, `admin.crud.providers`, `admin.users.v2`). Ship behind flags, flip in staging, then prod.

## What's deliberately NOT in here

- Payments, Disputes, Service Requests, Quotes, Bookings CRUD (WS-G / WS-H / WS-I / WS-J) — they follow the same pattern as Customers; replicate once the P0 slice is live.
- Categories (WS-F), Platform config (WS-K), Search/bulk/export (WS-L) — same story.
- `node_modules`, lockfile, CI config — not useful in a scaffold you're lifting.

## What will almost certainly need adapting per-file

- **Import paths.** I've used `@/...` aliases consistent with Next.js defaults. Your tsconfig may differ.
- **UI primitive names.** I assume shadcn (`<Button>`, `<Dialog>`, `<Input>`, `<Select>`, etc.). Swap for your library.
- **Auth integration.** `getSession()` in `src/lib/auth.ts` is a stub. Replace with the real session reader (NextAuth, Clerk, Supabase Auth, whatever you're using).
- **Prisma model names.** I've used names that match what I observed on the live site (`Customer`, `Provider`, `Booking`, etc.). If your real models differ, rename.
- **Feature-flag backend.** `flags.ts` reads from env var first; adapt to match any flag system you already have.

## Design principles baked in

Every mutation goes through `crudAction()` → auth check → role check → Zod validation → Prisma write → `AdminAuditEvent` write → typed result. You cannot accidentally ship a server action without audit or role enforcement. That invariant is the whole value of the kit.

Destructive actions always require `<DestructiveConfirmDialog>` — typing the entity name to proceed. Again: by construction, not by discipline.

Soft delete by default. Hard delete is `OWNER`-only. Every list query filters out archived records unless explicitly requested.
