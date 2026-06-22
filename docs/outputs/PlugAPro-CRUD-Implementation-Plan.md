# Plug A Pro Admin — CRUD Implementation Plan

**Goal:** Make the admin surface (`admin.plugapro.co.za`) fully CRUD-capable for every primary entity, plus admin user management, categories, and platform config.  
**Source of findings:** `PlugAPro-CRUD-Capability-Audit.md` (same folder).  
**Complements (does not replace):** `PlugAPro-Ops-Implementation-Plan.md` — that one handles case workflow (close-out, notes, audit, filters, overrides). This one handles entity editing. Run them in parallel or sequentially — ideally in parallel since they touch different files.  
**How to read:** Each Workstream → several PRs → each PR is a single Claude Code session using the task brief template at the bottom.

---

## Framing — why this plan looks the way it does

The good news: you already have the pattern.

**Locations is the gold standard in this codebase.** It has an Add form with field validation and parent linking, inline "label" textboxes on every row, a Deactivate toggle (soft delete), a Delete button (hard delete), and a sensible parent-hierarchy model. Everything in this plan is essentially: **"extract the Locations pattern into a reusable kit, then apply it to every other entity, behind feature flags, one PR at a time."**

That matters for two reasons:

1. **Less invention, more replication.** Claude Code is excellent at "mirror the pattern from file X into file Y." That's exactly the shape of this work.
2. **Lower risk.** The Locations module has been running against real data with no reported issues. Following its conventions means the new CRUD surfaces inherit whatever patience the existing app already has.

Before any entity work starts, two things must happen: **stabilise the detail pages that are currently crashing** (blocker), and **extract a reusable CRUD kit** from Locations (so we don't copy-paste 8 times and end up with 8 slightly-different dialogs).

---

## One-page summary — what gets built

| Workstream | Scope | Priority | Blocks |
|---|---|---|---|
| **WS-A** Stabilisation & observability | Fix the Provider/Booking detail crashes (Error 3811911274), add error boundaries, add a smoke test after deploy. | **P0 blocker** | Everything else |
| **WS-B** Reusable CRUD kit | Extract `<CRUDTable>`, `<CRUDForm>`, `<ConfirmDialog>`, `<DeactivateToggle>` from Locations. Shared server-action helper `crudAction()`. Shared validation with Zod. | **P0** | All entity CRUD PRs |
| **WS-C** Customers CRUD | Create customer, edit contact details/address, block/suspend (temporary), unblock, delete with protections, merge duplicates. Internal notes + flags. | **P0** | — |
| **WS-D** Providers CRUD | Create provider, edit all fields (skills, service areas, certifications, equipment, availability, contact), suspend (temp), reactivate, delete. | **P0** | WS-B |
| **WS-E** Admin users & roles | Invite admin, edit name/role, deactivate/reactivate, revoke, role matrix (Ops / Finance / Trust / Admin / Owner). | **P0** | WS-B |
| **WS-F** Categories CRUD | Add / edit / deactivate / reorder, subcategories. Required-skills + required-equipment tied to category. | **P1** | WS-B |
| **WS-G** Service requests & Quotes CRUD | Concierge-create on behalf of customer. Edit address / description / category. Cancel with reason. Create quote manually, edit, void, extend expiry. | **P1** | WS-B |
| **WS-H** Bookings management | Reschedule, cancel (with reason), change assigned provider, trigger refund flow, add trust flag. | **P1** | WS-B, WS-G |
| **WS-I** Payments CRUD | Manually record a payment, retry failed, refund, write-off with reason, reconcile PSP. | **P1** | WS-B |
| **WS-J** Disputes CRUD | Create dispute on behalf of a party, attach evidence, resolve with outcome + reason, escalate, reopen. | **P2** | WS-B |
| **WS-K** Platform config & SLA editor | Turn Settings page from read-only into editable config: SLA targets, mode, timezone, currency, app URL, feature toggles. | **P2** | WS-B, WS-E |
| **WS-L** Cross-cutting: search, bulk, export, audit | Global search, bulk select/act on every list, CSV export on every list, audit log viewer. | **P1** | WS-B |

**Rough sequencing (single-developer happy path):** WS-A → WS-B → WS-E → WS-C → WS-D → WS-F → WS-L → WS-G → WS-H → WS-I → WS-J → WS-K.

Expect the full set to take **6–10 focused weeks** with Claude Code doing the typing and a developer reviewing. The first three workstreams (A, B, E) unblock everything else and should be done in the first 5–7 working days.

---

## WS-A — Stabilisation (run FIRST, blocks everything)

### Task A.1 — Root-cause the detail page crash
Error ID `3811911274` appears on both `/admin/providers/[id]` and `/admin/bookings/[id]` in the live environment. The same ID on two different routes suggests a shared dependency — likely a Prisma include that references a model field that was renamed or removed, or a server action throwing on a null relation.

*Claude Code brief:*
```
Reproduce the 500 at /admin/providers/prov000000000000002 and
/admin/bookings/book000000000000001.

Check:
1. Server logs for the Error ID 3811911274 equivalent (Sentry, Vercel logs,
   server console).
2. The Prisma queries inside the provider detail and booking detail server
   components. Look for .include/.select chains and verify every referenced
   field still exists in the current prisma/schema.prisma.
3. Whether either page reads from a model field that was deleted or renamed
   in a recent migration.

Fix:
- Make the provider detail and booking detail pages render successfully
  for the seed data.
- Wrap each detail page's data fetch in a typed try/catch that returns a
  'partial record' object instead of throwing.
- Add a simple route-level error boundary (error.tsx) under
  /admin/providers/[id]/ and /admin/bookings/[id]/ that renders a friendly
  error surface AND includes a request id the dev can trace, without hiding
  the underlying issue.

Tests:
- Playwright smoke: log in, visit Providers list, click first row, expect
  200 and visible profile. Repeat for Bookings.
- Unit test: snapshot the shape of the Prisma query so a schema rename
  trips CI.

Acceptance:
- Both detail pages render for all seed records.
- Route-level error boundary captures unexpected errors without bringing
  down the whole admin shell.
- Smoke tests run on CI.
```

### Task A.2 — Route-level error boundaries everywhere
Add `error.tsx` to every `/admin/*` route group so a single broken page doesn't make the whole admin feel on fire. Graceful, minimal: error message + request id + "Go back / Retry" button + a link to report to `#admin-alerts` Slack.

### Task A.3 — Post-deploy smoke test
A Playwright suite that hits every admin route once (list pages) plus one detail record per entity type. Runs in CI on PR merge to main and in a separate Vercel cron once an hour. Any non-2xx pages an alert. This is what would have caught the current regression before users saw it.

---

## WS-B — Reusable CRUD kit (run BEFORE any entity PR)

This workstream turns the **Locations pattern** into reusable components + server-action helpers. Every subsequent workstream just *uses* this kit.

### Task B.1 — Extract a `<CRUDTable>` component
`src/components/admin/crud/table.tsx`. Takes `columns`, `data`, `rowActions` (array of `{label, action, confirm?, destructive?}`), `onInlineEdit?`, `bulkActions?`. Renders a standard admin table with optional inline edit (like Locations' label textbox), row-level action buttons, and an optional bulk-select column.

### Task B.2 — Extract a `<CRUDForm>` component
`src/components/admin/crud/form.tsx`. Takes a `zodSchema`, a `defaultValues` object, and a `serverAction`. Renders labelled fields, inline validation errors, submit/cancel. Used for both "Add new" dialogs and "Edit" dialogs. Consistent keyboard handling (Esc to cancel, ⌘+Enter to submit).

### Task B.3 — Extract `<ConfirmDialog>` + `<DestructiveConfirmDialog>`
For delete/block/suspend. The destructive variant requires typing the entity name to confirm (same pattern GitHub uses for repo deletion).

### Task B.4 — Server-action helper `crudAction()`
`src/lib/crud-action.ts`. Wraps server actions with: auth check, role check, Zod validation, Prisma call, audit-event write, typed result. Every entity action uses this one helper so audit is consistent and no one forgets to log.

```ts
export const crudAction = <Input, Output>(opts: {
  name: string;              // e.g. 'customer.update'
  schema: ZodSchema<Input>;
  requiredRole: Role[];
  run: (input: Input, ctx: Ctx) => Promise<Output>;
  auditPayload?: (input: Input, out: Output) => Record<string, unknown>;
}) => async (input: unknown) => { /* ... */ };
```

### Task B.5 — Entity-audit table
Reuse the `CaseEvent` idea from the ops plan, but at the entity level:

```prisma
model AdminAuditEvent {
  id          String   @id @default(cuid())
  entityType  String   // 'Customer' | 'Provider' | 'JobRequest' | ...
  entityId    String
  action      String   // 'create' | 'update' | 'deactivate' | 'delete' | 'merge' | 'custom:block'
  payload     Json     // { before: {...}, after: {...} } or {reason: '...'}
  actorUserId String
  createdAt   DateTime @default(now())

  @@index([entityType, entityId, createdAt])
  @@index([actorUserId, createdAt])
}
```

`crudAction()` writes one of these on every successful action. WS-L.4 renders it on each entity's profile.

### Task B.6 — Optimistic-UI convention doc
A tiny conventions file (`docs/admin-crud.md`) that says: "use server actions with `revalidatePath`, show inline success toasts, show inline error toasts, put destructive actions behind `<DestructiveConfirmDialog>`." Keeps every entity PR consistent without re-arguing style.

**Acceptance for WS-B:** The Locations module is refactored to use `<CRUDTable>` and `<CRUDForm>` and still passes smoke tests. This is the proof-of-pattern — once Locations works on the kit, every other entity becomes a "drop the kit in" exercise.

---

## WS-C — Customers CRUD

### Task C.1 — Prisma + server actions for customer CRUD
Add fields the profile needs but doesn't have: `address`, `isBlocked`, `blockedReason`, `suspendedUntil`, `internalFlags` (enum array: `VIP`, `HIGH_RISK`, `DO_NOT_CONTACT_AFTER_18`, `PAYMENT_RISK`). All nullable/backward-compatible.

Server actions (all via `crudAction`):
- `createCustomer(input)` — name, phone, email?, channel, address?.
- `updateCustomer(id, input)` — partial.
- `blockCustomer(id, reason)` — sets `isBlocked=true`, keeps historical records.
- `unblockCustomer(id, reason)`.
- `suspendCustomer(id, until, reason)`.
- `deleteCustomer(id)` — soft-delete (archive). Hard-delete only available to `OWNER` role and only when `isBlocked === false && openCases === 0`.
- `mergeCustomers(sourceId, targetId, mergeMap)` — moves bookings, cases, notes to target; soft-deletes source.
- `addCustomerNote(id, body)` / `removeCustomerNote(noteId)`.

### Task C.2 — Customer list: Add + search + filters + export
- "Add customer" button opens `<CRUDForm>` dialog.
- Text search: name, phone, email.
- Filters: channel, blocked?, suspended?, has-open-cases?, last-booking-age.
- Export: CSV of filtered list.

### Task C.3 — Customer detail: Edit + Block/Suspend + Notes + Audit
- Replace the single "Opt in" button with a real action toolbar: **Edit, Block / Unblock, Suspend, Merge duplicate, Delete**.
- Inline editable fields via `<CRUDForm>` in a Sheet/side-panel.
- Notes timeline (reuses case-note primitive from the ops plan if built, or a fresh `CustomerNote` model).
- Activity timeline reads from `AdminAuditEvent`.
- Cross-references: **Open cases** (link to Dispatch/etc), **Booking history** (fixes the "(1) / No bookings yet" inconsistency).

### Task C.4 — Duplicate detection & merge
Offline cron that flags candidate duplicates (phone match, email match, fuzzy name+phone). `/admin/customers/duplicates` queue with side-by-side diff and a merge action.

**Acceptance for WS-C:** An ops user can create a customer from the admin, edit all visible fields, block a customer with reason, see the block in the audit log, unblock, and merge two customers — all behind the `admin.crud.customers` flag, all logged.

---

## WS-D — Providers CRUD

### Task D.1 — Prisma: certifications, equipment, KYC state
Add if not present:
```prisma
model ProviderCertification {
  id           String   @id @default(cuid())
  providerId   String
  type         String
  number       String?
  issuedAt     DateTime?
  expiresAt    DateTime?
  attachmentId String?
  Provider     Provider @relation(fields: [providerId], references: [id])
}

model ProviderEquipment {
  id         String   @id @default(cuid())
  providerId String
  type       String
  notes      String?
  verifiedAt DateTime?
  Provider   Provider @relation(fields: [providerId], references: [id])
}
```

Add `kycStatus`, `payoutVerifiedAt`, `suspendedUntil`, `suspendedReason`, `strikes` counter.

### Task D.2 — Provider server actions
- `createProvider(input)` — bypass the WhatsApp-only onboarding for admin-initiated creation (useful when onboarding a vetted provider in person).
- `updateProviderProfile(id, input)` — name, phone, skills, availability.
- `updateProviderServiceAreas(id, areas[])`.
- `addCertification(id, cert)` / `updateCertification` / `deleteCertification`.
- `addEquipment` / `updateEquipment` / `deleteEquipment`.
- `suspendProvider(id, until, reason)` / `reactivateProvider(id, reason)`.
- `deactivateProvider(id, reason)` (permanent) / `restoreProvider(id)` (only by OWNER).
- `addStrike(id, reason)` / `removeStrike(strikeId, reason)`.

### Task D.3 — Provider list
- "Add provider" button.
- Search: name, phone, skill, region.
- Filters: status, KYC state, expiring certs (next 30d), has strikes, service-area.
- Export CSV.

### Task D.4 — Provider detail: editable everything
Replace the current thin view with tabbed sections, all editable:
- **Profile** (name, phone, contact, KYC state)
- **Skills & Service Areas** (multi-select from Categories, multi-select from Locations)
- **Certifications** (list with edit/delete/add)
- **Equipment** (list with edit/delete/add)
- **Availability** (weekly schedule editor)
- **Trust** (strikes, notes)
- **Leads & Jobs** (read-only, from related queries)
- **Audit**

Most important wiring: **the matcher's `MISSING_REQUIRED_CERTIFICATION` and `MISSING_REQUIRED_EQUIPMENT` filter reasons must read from these new tables.** Otherwise fixing a provider's data in the admin doesn't actually make them eligible.

**Acceptance for WS-D:** Admin can create a provider, add an "Electrician — COC certified" certification + "Multimeter" equipment, extend Kagiso Sithole's service area to include Claremont, and that change immediately makes him an eligible candidate for the stuck Cape Town request.

---

## WS-E — Admin users & roles

This one is overdue. Right now admin accounts live in env vars or direct DB. An owner should never need a developer to grant or revoke admin access.

### Task E.1 — Prisma: AdminUser, Role, Permission
```prisma
model AdminUser {
  id           String   @id @default(cuid())
  email        String   @unique
  name         String
  roles        Role[]
  isActive     Boolean  @default(true)
  invitedBy    String?
  invitedAt    DateTime @default(now())
  lastLoginAt  DateTime?
}

enum Role {
  OPS
  FINANCE
  TRUST
  ADMIN
  OWNER
}
```

### Task E.2 — Auth & role checks
Middleware (or wherever auth lives today) reads `roles` from DB. Every server action inside `crudAction` declares `requiredRole` and is rejected if the caller doesn't have it. One place to enforce, audited on every call.

### Task E.3 — `/admin/team` page
- List of admins with email, roles, active, last-seen.
- **Invite admin** button (email + role picker + optional name). Sends a magic-link invite via the existing email/WhatsApp flow.
- **Edit roles**: multi-select.
- **Deactivate / Reactivate**.
- **Revoke access** (permanent) — OWNER only.
- Audit trail per user action.

### Task E.4 — Permission matrix UI
Simple table: rows = actions (e.g. "Edit customer", "Issue refund", "Delete provider", "Approve application"), columns = roles, cells = tick/cross. Read-only v1. This page is for the owner to understand what each role actually can do — documentation rendered from the `requiredRole` metadata on every `crudAction`.

### Task E.5 — Migrate existing admins
Script that reads the current env-var admin list (or whatever exists) and creates `AdminUser` rows with role `ADMIN`. Announce to the team, ask them to sign in once, confirm `lastLoginAt` populates.

**Acceptance for WS-E:** Owner can invite a new ops user from the UI, assign them OPS role, see them appear in the team list, and revoke their access — all without a developer.

---

## WS-F — Categories CRUD

### Task F.1 — Prisma: Category + CategorySkill + CategoryEquipment
Move from hardcoded list to DB:
```prisma
model Category {
  id                 String   @id @default(cuid())
  label              String
  slug               String   @unique
  description        String?
  parentId           String?
  isActive           Boolean  @default(true)
  sortOrder          Int      @default(0)
  requiredSkills     CategorySkill[]
  requiredEquipment  CategoryEquipment[]
  parent             Category? @relation("CategoryHierarchy", fields: [parentId], references: [id])
  children           Category[] @relation("CategoryHierarchy")
}
```

Backfill the existing 8 categories. Update every reference in the matcher, PWA, WhatsApp bot to read from the DB.

### Task F.2 — `/admin/categories` page
Same Locations pattern: Add node, inline edit, parent picker (for subcategories), Deactivate, Delete, drag-to-reorder. Plus tabs inside a category for required skills and required equipment.

### Task F.3 — Category-to-matching wiring
The matcher filter "MISSING_REQUIRED_SKILL" and "MISSING_REQUIRED_EQUIPMENT" must read from `Category.requiredSkills` / `Category.requiredEquipment`. Same principle as Provider CRUD — the filter becomes editable rather than mystery.

---

## WS-G — Service requests & Quotes CRUD

### Task G.1 — Create on behalf of customer
`/admin/requests/new` (or a dialog from customer detail): pick customer → category → address → description → photos?. Creates a JobRequest identical to one created via WhatsApp. Sends the customer a confirmation via their preferred channel.

### Task G.2 — Edit request
On a request detail (reuse the Dispatch `?request=` view or a dedicated `/admin/requests/[id]`): edit category, address (with Location picker), description, photos. Every change writes to audit.

### Task G.3 — Cancel request with reason
Action on the detail: cancel with reason code (from the reason-code registry built in the ops plan). Closes any attached Case with `CUSTOMER_CANCELLED` or `OPS_CANCELLED`.

### Task G.4 — Quote CRUD
Action on a match or request: **Create quote manually** (labour/materials/notes), **Edit quote** (before customer decision only), **Void quote** with reason, **Extend expiry** with reason. All changes visible in quote history (which already exists — extend it with ops-initiated quotes).

---

## WS-H — Bookings management

### Task H.1 — Fill the empty "Actions" block on booking detail
Actions for a booking:
- **Reschedule** (pick new date/time, notifies customer + provider).
- **Cancel** (with reason, triggers refund flow if paid).
- **Change provider** (force-reassign outside matcher, audit the override).
- **Mark disputed** (opens a Trust case).
- **Edit address** (if customer requests before arrival).
- **Add internal note**.

### Task H.2 — Refund trigger (not CRUD on money, just the ticket)
"Issue refund" opens the Payments flow in WS-I. The booking record shows refund status.

### Task H.3 — Booking list filters
Add date range, provider, customer, region, category, has-refund filters. Add bulk select + bulk cancel (rare but useful for testing / operational errors).

---

## WS-I — Payments CRUD

### Task I.1 — Manual record (cash / bank transfer / off-platform)
Action: **Record payment** with amount, currency, method, PSP ref (optional), notes. Used when money arrived outside the PSP flow.

### Task I.2 — Retry failed
Button on a failed payment: retries via PSP webhook contract. Logs attempt.

### Task I.3 — Refund
Full or partial, with reason code (REFUND_GOODWILL, REFUND_POLICY, REFUND_DUPLICATE, REFUND_DISPUTE_UPHELD). Integrates with the PSP refund API. Writes to audit.

### Task I.4 — Write-off
Action: mark a payment as "written off" (uncollectable), reason required. No money moves; this is accounting cleanup.

### Task I.5 — Reconcile PSP webhook
Ops-only action: manually re-process a PSP webhook that was lost/missed. Dev-heavy feature; wire carefully.

**Permission:** all payment actions require `FINANCE` or `OWNER` role.

---

## WS-J — Disputes CRUD

### Task J.1 — Open dispute on behalf
From booking detail or directly at `/admin/disputes/new`: pick booking → party raising → category → description → evidence upload.

### Task J.2 — Resolve
Action on a dispute: outcome (`UPHELD_CUSTOMER`, `UPHELD_PROVIDER`, `PARTIAL_REFUND`, `NO_ACTION`, `ESCALATED_LEGAL`), reason code, internal note, customer-facing note, attachments.

### Task J.3 — Escalate / Reopen
Same pattern as WS-B destructive-confirm.

---

## WS-K — Platform config & SLA editor

### Task K.1 — Turn Settings into editable config
Split Settings into tabs:
- **Platform** — mode, timezone, currency, app URL (editable, OWNER-only).
- **SLA targets** — per-queue targets with unit selector. The values currently hardcoded in the SLA registry become DB-backed.
- **Feature flags** — a read/write UI for the flag system (built in the ops plan WS0.2). OWNER only.
- **Job categories** — link to WS-F page.
- **Integrations** — move out of "env var only." At minimum, show the connection status and allow a test-ping action. Secrets stay in env vars; admin UI shows status not secrets.

### Task K.2 — Change-auditing on platform config
Every config change writes to `AdminAuditEvent` with before/after snapshot. Viewable from a "Platform config history" page.

---

## WS-L — Cross-cutting concerns

### Task L.1 — Global search
Admin top bar: search box that resolves customers, providers, requests, bookings, payments, disputes. Backed by Postgres full-text or Meilisearch if already in the stack. Keyboard shortcut `⌘K`.

### Task L.2 — Bulk actions on every list
Checkbox column + bulk bar. Allowed actions depend on the entity. Cap at 50 per operation. Bulk reason required for destructive bulk actions.

### Task L.3 — CSV export on every list
Every list gets an "Export" button. Exports the **currently filtered** view. OWNER can export the full table unfiltered. Record export events in audit (who exported what, when).

### Task L.4 — Audit log viewer
New page `/admin/audit`. Filter by entity type, actor, date range, action. Every row expandable to show before/after JSON. Used for compliance and debugging.

### Task L.5 — Impersonate mode (proper support feature)
OWNER-only. Lets support view the platform as a specific customer or provider. Banner is always visible ("Viewing as X — [Stop]"). Every action in impersonate mode is double-audited (the real actor + the impersonated user).

---

## Rollout strategy

Ship everything behind feature flags. Flip per-user in staging, then per-team in prod, then global.

Suggested flags:
- `admin.crud.customers`
- `admin.crud.providers`
- `admin.users.v2`
- `admin.categories.v2`
- `admin.requests.crud`
- `admin.bookings.crud`
- `admin.payments.crud`
- `admin.disputes.crud`
- `admin.search.global`
- `admin.bulk.v1`
- `admin.export.csv`

Gate role-sensitive actions with BOTH flag AND role check inside `crudAction`. Belt and braces.

---

## Migration & safety rails (non-negotiable)

- Every Prisma migration is **additive only** in the first pass. No column drops, no renames. Squash later once v2 is 100% live.
- Every new server action goes through `crudAction` so audit is guaranteed and permissions are guaranteed.
- Every destructive action uses `<DestructiveConfirmDialog>`.
- Every new list has feature-flag + role check on the server, even when the client sidebar is still rendering the link.
- Every PR includes a Playwright test that exercises the happy path of the new action.
- No hard deletes without OWNER role. Soft delete (archive) by default.

---

## Effort & priority summary

| Workstream | Priority | Rough effort (Claude Code + dev reviewer) |
|---|---|---|
| WS-A Stabilisation | P0 blocker | 1–2 days |
| WS-B CRUD kit | P0 | 3–5 days |
| WS-C Customers | P0 | 4–6 days |
| WS-D Providers | P0 | 5–8 days (cert/equipment data is the heavy part) |
| WS-E Admin users & roles | P0 | 4–6 days |
| WS-F Categories | P1 | 2–3 days |
| WS-G Requests & Quotes | P1 | 4–6 days |
| WS-H Bookings | P1 | 3–5 days |
| WS-I Payments | P1 | 4–6 days (PSP integration is the wildcard) |
| WS-J Disputes | P2 | 2–4 days |
| WS-K Platform config | P2 | 2–3 days |
| WS-L Search / bulk / export / audit | P1 (in parallel) | 5–7 days |

**Total:** roughly 6–10 focused weeks of single-developer work with Claude Code. Cut in half by doing WS-L tasks in parallel with entity workstreams.

---

## Claude Code task brief template

Drop one per session. Do not stack two tasks.

```
## Context
Workstream <X>, Task <X.Y> from PlugAPro-CRUD-Implementation-Plan.md.
Background: PlugAPro-CRUD-Capability-Audit.md.
Stack: Next.js App Router, Prisma/Postgres, Tailwind/shadcn, server actions,
Vercel cron, WhatsApp + PSP webhooks. Admin routes under /admin.

## Pre-reads
1. CLAUDE.md at repo root (generated in ops-plan WS0.1 or refresh now).
2. The Locations module — copy its pattern wherever reasonable:
   - src/app/admin/locations/page.tsx
   - the server actions it calls
   - the inline-edit + Add node pattern

## Goal
<One-line objective from the plan>

## Scope
DO:
- <specific deliverables from the plan>
- Server actions via crudAction() helper from WS-B.4
- Write AdminAuditEvent rows for every mutation.
- Gate UI behind flag <flag key from the plan>.
- Add Playwright happy-path test.

DO NOT:
- Touch files outside the listed paths.
- Drop or rename existing schema fields.
- Bypass the audit helper.

## Safety
- Migrations must be additive and reversible.
- Role check enforced server-side in crudAction({ requiredRole: [...] }).
- Destructive actions behind <DestructiveConfirmDialog>.

## Acceptance
- Feature flag off: no change to existing behaviour.
- Feature flag on: <what the user can now do>.
- Audit rows appear in AdminAuditEvent for every mutation.
- Test passes in CI.
- Role check rejects unauthorised callers (test in CI).

## Output
One PR against main targeting branch admin-crud/<short-slug>. PR
description follows the repo's convention.
```

---

## First three prompts — copy-paste ready

### Prompt 1 — WS-A.1 Stabilise the detail-page crash

```
Fix the 500 error on /admin/providers/[id] and /admin/bookings/[id]
(Error ID 3811911274 observed on both).

Steps:
1. Look at the server code powering those routes. List every Prisma
   query the page runs and every field it references.
2. Compare against prisma/schema.prisma. Identify any field referenced
   by the page that no longer exists or was renamed. Report the diff.
3. Pick the fix with the smallest blast radius:
   - If a field was renamed, update the page reference.
   - If a related record may be null, add guards.
   - Do not change schema in this PR.
4. Add route-level error.tsx to both routes (graceful fallback + retry).
5. Add Playwright smoke: navigate from /admin/providers to the first
   provider and expect 200. Same for bookings. Run in CI.

Do not touch any unrelated admin pages in this PR.
Acceptance: both detail routes render for all seed records; smoke tests
pass; error.tsx visible if the page ever throws again.
```

### Prompt 2 — WS-B.1–B.4 CRUD kit

```
Extract a reusable admin CRUD kit following the pattern already used
in src/app/admin/locations.

Build:
1. src/components/admin/crud/table.tsx — <CRUDTable> with columns,
   data, rowActions, optional inline editable cells (start with string
   + number), optional bulkActions. Uses existing Tailwind/shadcn.
2. src/components/admin/crud/form.tsx — <CRUDForm> wrapping a Zod
   schema and a server action. Inline field errors, submit via
   useFormState, success/error toasts.
3. src/components/admin/crud/confirm.tsx — <ConfirmDialog> and
   <DestructiveConfirmDialog> (latter requires typing the entity name
   to confirm).
4. src/lib/crud-action.ts — crudAction({ name, schema, requiredRole,
   run, auditPayload? }) server-action factory. Enforces auth, role,
   validation, writes AdminAuditEvent on success, returns typed result.
5. prisma/schema.prisma — new AdminAuditEvent model
   (entityType, entityId, action, payload Json, actorUserId, createdAt)
   with appropriate indexes. Idempotent migration.
6. docs/admin-crud.md — the conventions doc (one page).

Refactor Locations to use <CRUDTable> and <CRUDForm>. Existing
functionality must be unchanged; smoke tests must pass.

Acceptance:
- Locations renders, Add node works, inline edit works, Deactivate
  works, Delete works, all via the new kit.
- Every Locations mutation writes an AdminAuditEvent row.
- Unit tests cover: auth failure, role failure, schema validation
  failure, happy path.
```

### Prompt 3 — WS-E.1–E.3 Admin users & roles

```
Build an admin team management surface at /admin/team.

Schema (prisma/schema.prisma):
- model AdminUser { id, email @unique, name, roles Role[],
  isActive Boolean @default(true), invitedBy String?, invitedAt
  DateTime @default(now()), lastLoginAt DateTime? }
- enum Role { OPS, FINANCE, TRUST, ADMIN, OWNER }

Backfill:
- scripts/backfill-admin-users.ts reads whatever mechanism provisions
  admins today (env var list, direct DB) and creates AdminUser rows
  with role ADMIN for existing admins. Idempotent.

Auth integration:
- Middleware / session reads roles from AdminUser on every admin
  request. Update crudAction to check requiredRole against the caller.

UI:
- /admin/team list (email, name, roles, active, last-seen).
- "Invite admin" button → <CRUDForm> (email, name, roles).
  Sends an email invite with a magic link (reuse the platform's
  existing email integration; if unclear, stub the send and log).
- Edit roles action per row.
- Deactivate / Reactivate action per row.
- Revoke (permanent) action — OWNER only.
- Read-only permission matrix page at /admin/team/permissions,
  generated from crudAction requiredRole metadata.

Flag: admin.users.v2. OFF by default. Gate the page AND the server
actions behind it.

Acceptance:
- Signed-in admin with OWNER role can invite a new admin, assign OPS
  role, see them in the list.
- OPS-role user cannot reach /admin/team (server rejects with 403).
- Every team action writes AdminAuditEvent.
- Smoke tests cover invite + deactivate paths.
```

---

## What *not* to build (yet)

A few tempting features that should wait:

- **Customer-facing portals from admin** (e.g. admin chat with a customer). Out of scope.
- **Native mobile admin app.** Web admin is enough for v2.
- **Complex approval workflows** (e.g. four-eyes approval on refunds). Wait until the single-approver flow is in use for ≥ 60 days and you have data on mistakes.
- **Fancy dashboarding.** Reports stays minimal. Once ops can *do*, we can worry about *analyse*.
- **Predictive matching tweaks.** Entity CRUD first; matching algorithm later.

Build the boring things. Keep the shiny things for when there's evidence they'd change a metric.

---

## Final reminder

Every one of these workstreams is a "make the admin behave like the Locations module" exercise. You've already got the pattern. This plan is about scaling it. Keep PRs small, keep the CRUD kit consistent, audit every write, and flag everything — and you'll be able to run Plug A Pro from this admin without a dev on speed-dial.
