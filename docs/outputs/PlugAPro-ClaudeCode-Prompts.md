# Plug A Pro Admin — Claude Code Prompt Pack

**Purpose:** a set of copy-paste-ready prompts for Claude Code. One prompt per session, one session per PR, one PR per session. Do not stack prompts.

**Companion files (reference, in order of importance):**

1. `PlugAPro-CRUD-Implementation-Plan.md` — the plan.
2. `plugapro-admin-scaffold/` — working reference code (the pattern to mirror).
3. `PlugAPro-CRUD-Capability-Audit.md` — why this work is being done.

Put the scaffold folder somewhere your Claude Code session can read it. Two options:

- **(A) Drop the scaffold into the repo as `reference/plugapro-admin-scaffold/`.** Add to `.gitignore` or commit it — either is fine; it's an internal reference. Recommended.
- **(B) Keep the scaffold as a sibling folder next to your repo.** In that case, prefix scaffold paths in the prompts with `../plugapro-admin-scaffold/`.

All prompts below assume option A. Adjust if you went with B.

---

## How to use this pack

1. Start with **Session 0**. Don't skip it — it builds the `CLAUDE.md` that every subsequent session depends on.
2. Run sessions **in the order listed**. Each session's acceptance criteria is the next session's pre-read.
3. **One session = one PR.** When Claude Code says "done," review the PR, merge, start the next session fresh.
4. **If a prompt fails** or Claude Code gets stuck, don't retry the same prompt without new information. Give it the error message and ask it to diagnose — not to re-attempt.
5. **Flip flags only after merge.** Every PR ships dark (flag off). You enable the flag in a separate, tiny, reversible change.

---

## Pre-flight checklist

Before running Session 1, confirm:

- [ ] The scaffold lives at `reference/plugapro-admin-scaffold/` in your repo (or adjust paths).
- [ ] Your dev has run Claude Code against this repo before (so auth is set up).
- [ ] You have access to server logs (Vercel / Sentry / whatever) — Session 1 needs them.
- [ ] You have a staging environment or at minimum a preview branch Vercel deploys from.
- [ ] You know which model is currently provisioning admins (env var? hardcoded list? legacy table?). Note it down — WS-E needs it.

---

## Session 0 — Repo audit and CLAUDE.md

**Why it exists:** Claude Code writes better code when it knows the repo's conventions. Five minutes here saves hours of rework later.

```
Do a repo audit and generate a CLAUDE.md at the root. Do NOT modify source
code in this session — this is recon only.

The audit must capture:

1. Next.js structure
   - Version and App Router vs Pages Router.
   - The full list of routes under /admin with their file paths.
   - Where server actions live and the naming convention used
     (src/app/**/actions.ts? actions/ folder? something else?).

2. Prisma
   - prisma/schema.prisma path.
   - Current fields on: Customer, Provider, Booking, JobRequest, Match,
     Quote, Payment, Dispute, Application, Location, Category.
   - Any existing audit/event/history model (search: "Event", "Audit",
     "History", "Log"). Report whether it exists and its shape.
   - Whether a FeatureFlag table already exists.
   - Whether AdminUser / Role already exist, or whether admins live in
     env vars / hardcoded lists.

3. Auth
   - What session/auth mechanism is in use (NextAuth, Clerk, Supabase,
     custom). Where the session is read. Where roles (if any) are
     enforced.

4. UI primitives
   - Tailwind config.
   - Whether shadcn or a different primitive library is used. If shadcn,
     which components are already installed.
   - How icons are used (lucide-react? Heroicons?).

5. Forms & validation
   - Is react-hook-form + zod already used? If not, what is?

6. Tests
   - Unit test framework (vitest/jest).
   - E2E framework (Playwright/Cypress/none).
   - How tests are run in CI.

7. Feature flags
   - Any existing flag system in the codebase. If yes, document it
     (where flags live, how they're read, how they're enabled per-user).

8. Integrations
   - Email/SMS/WhatsApp provider used for transactional messaging.
   - PSP integration name.
   - Storage backend for attachments (Vercel Blob? S3?).

At the end, write CLAUDE.md with:
- A "Conventions" section listing the points above.
- A "What's already in place that WS-A/B/C/D/E can build on" subsection.
- A "What's missing that we'll introduce" subsection.

REPORT ONLY. NO CODE CHANGES.
```

**Expected output:** `CLAUDE.md` at repo root. No other diffs.

---

## Session 1 — WS-A.1 Stabilise the detail-page crash

**Why now:** `/admin/providers/[id]` and `/admin/bookings/[id]` both return "Error ID 3811911274." Fix before building anything else on top — no point adding CRUD to pages that can't render.

```
Reproduce and fix the 500 error on /admin/providers/[id] and
/admin/bookings/[id]. Observed Error ID in the prod environment:
3811911274.

Pre-reads:
- CLAUDE.md at repo root.
- reference/plugapro-admin-scaffold/docs/MIGRATION-GUIDE.md §"Step 1 —
  Stabilisation (WS-A) BEFORE anything else".

Steps:
1. Read the provider-detail server component and list every Prisma
   field and relation it references.
2. Read the booking-detail server component; same exercise.
3. Diff those references against the current prisma/schema.prisma.
4. Look for: (a) referenced fields that were renamed or removed, (b)
   related records that may now be null but aren't guarded, (c)
   includes that reference relations that no longer exist.
5. Search server logs / Sentry for Error ID 3811911274 — paste any
   stack trace you find into your reasoning.
6. Apply the smallest fix:
   - Prefer guards over schema changes in this PR.
   - If a rename is needed, do it.
   - Do NOT add or remove schema fields in this PR.

Safety:
- Additive only.
- Do not touch any route other than the two above.
- Do not bypass Prisma type errors with `as any` unless explicitly
  unavoidable — if used, leave a TODO comment.

Acceptance:
- /admin/providers/[id] and /admin/bookings/[id] both return 200 for
  every seed record.
- Unit test covering the specific null-guard you added.
- PR description explains the root cause in one paragraph.

DO NOT copy the error boundary or smoke test in this PR — those come
in Session 2.
```

---

## Session 2 — WS-A.2 and WS-A.3: Error boundaries + smoke test

```
Add route-level error boundaries across /admin, and a Playwright smoke
test suite that runs post-deploy.

Pre-reads:
- reference/plugapro-admin-scaffold/src/app/admin/error.tsx (copy-of-pattern)
- reference/plugapro-admin-scaffold/tests/smoke.spec.ts (copy-of-pattern)

Scope:
1. Copy reference/plugapro-admin-scaffold/src/app/admin/error.tsx into
   src/app/admin/error.tsx. Adapt styling to match the repo's
   conventions (Tailwind classes already in use). Replace the
   placeholder "Go back" link target if the repo uses a different
   home route.
2. Copy the same pattern to per-route error boundaries for:
   - src/app/admin/providers/[id]/error.tsx
   - src/app/admin/bookings/[id]/error.tsx
   - src/app/admin/customers/[id]/error.tsx
3. Copy tests/smoke.spec.ts into the repo's Playwright test folder.
   Adjust the sign-in step to match the repo's actual auth form
   (selectors, redirect). Wire the test into the CI step that runs
   on every deploy to main.

Safety:
- Error boundaries must NOT hide errors from dev — they must log via
  whatever observability path the repo uses (Sentry captureException,
  console.error, etc.). Preserve `error.digest` on display.
- Smoke test must NOT require running against prod unless
  E2E_BASE_URL is set. Default to preview/staging.

Acceptance:
- Throwing from a server component under /admin renders the boundary,
  not the white Next error shell.
- Smoke test suite passes on a clean preview deploy.
- CI fails if any admin list route returns non-2xx or shows the
  boundary in its rendered HTML.
```

---

## Session 3 — WS-B.1: Prisma schema additions

**Why first inside WS-B:** everything else depends on the models existing. Additive-only.

```
Add the model additions for the CRUD slice to prisma/schema.prisma.

Pre-reads:
- reference/plugapro-admin-scaffold/prisma/schema.prisma — the full set
  of additions.
- CLAUDE.md — whatever your audit found on existing related models.

Scope:
1. Add (do not replace existing models):
   - enum Role { OPS, FINANCE, TRUST, ADMIN, OWNER }
   - enum CustomerInternalFlag { ... }
   - enum CustomerChannel { ... }     — skip if already present
   - enum KycStatus { ... }
   - enum ProviderStatus { ... }
   - model AdminUser
   - model AdminAuditEvent
   - model FeatureFlag
   - model CustomerNote
   - model ProviderNote
   - model ProviderCertification
   - model ProviderEquipment

2. Extend existing models with NEW fields only (all nullable / with
   sensible defaults):
   - Customer: address, isBlocked (default false), blockedReason,
     blockedAt, suspendedUntil, suspendedReason, internalFlags,
     marketingOptIn, serviceOptIn, archivedAt, archiveReason
   - Provider: status (default APPLICATION_PENDING), kycStatus
     (default NOT_STARTED), payoutVerifiedAt, suspendedUntil,
     suspendedReason, strikes (default 0), archivedAt, archiveReason

3. Add indexes listed in the scaffold schema.

4. Generate a migration named `ws_b_crud_base`. Do NOT squash or
   rename any existing migration. Run prisma migrate in dev and
   verify it applies.

Safety:
- No renames.
- No drops.
- Every new field has a default or is nullable.
- Migration must apply cleanly against a clone of prod data.

Acceptance:
- Migration applies in staging without errors.
- `prisma generate` produces types that include the new models.
- No existing query in the app breaks (run full test suite).
- PR description lists every added model/field so reviewers can
  spot-check.

Deferred to later PRs:
- Writing code that USES these models. Just create them here.
```

---

## Session 4 — WS-B.2: Core library

```
Lift the core library from the scaffold into src/lib/.

Pre-reads:
- reference/plugapro-admin-scaffold/src/lib/{db,flags,auth,audit,
  crud-action,reason-codes,sla,utils}.ts

Scope:
1. Copy each file into src/lib/, adapting imports and paths to match
   CLAUDE.md conventions.
2. `src/lib/db.ts`: only add if the repo does not already have a
   Prisma singleton. If it does, keep the existing one and adjust
   every scaffold import to use it.
3. `src/lib/auth.ts`: REWRITE `getSession()` to use the repo's actual
   auth mechanism (NextAuth / Clerk / Supabase — see CLAUDE.md).
   The function signature and error classes must match the scaffold
   so downstream callers are unaffected.
4. `src/lib/flags.ts`: If the repo has an existing flag system, either
   reuse it under the scaffold's `isEnabled()` signature, or keep both
   systems and migrate in a later PR. Document the choice in
   CLAUDE.md.
5. `src/lib/crud-action.ts`: copy as-is (this is the invariant-enforcing
   helper). Verify it compiles against the actual Prisma client type
   produced in Session 3.
6. `src/lib/audit.ts`, `src/lib/reason-codes.ts`, `src/lib/sla.ts`,
   `src/lib/utils.ts`: copy with minor import-path adjustments.

Tests:
- Unit test for crudAction: unauthenticated → UNAUTHENTICATED, wrong
  role → UNAUTHORIZED, flag off → FLAG_DISABLED, bad input →
  VALIDATION, happy path → { ok: true }.
- Unit test for isEnabled: default false, env override, DB row,
  per-user DB row.

Safety:
- No user-facing change. Library only.
- crudAction MUST write the audit row inside the same transaction as
  the run function.

Acceptance:
- CI green.
- A follow-up grep for `db.$transaction` inside `crudAction` confirms
  atomicity.
- No module in the repo is using the library yet except the tests.
```

---

## Session 5 — WS-B.3: CRUD kit components

```
Lift the CRUD kit components into src/components/admin/crud/.

Pre-reads:
- reference/plugapro-admin-scaffold/src/components/admin/crud/
  {table,form,confirm,index}.tsx
- reference/plugapro-admin-scaffold/docs/admin-crud.md

Scope:
1. Copy table.tsx, form.tsx, confirm.tsx, index.ts.
2. If the repo uses a UI primitive library other than raw HTML +
   Tailwind (shadcn, Radix, HeadlessUI, Chakra…), replace the bare
   <button>, <input>, <select>, <dialog> elements with the repo's
   equivalent primitives. Keep behaviour identical.
3. Copy docs/admin-crud.md into the repo's docs/ folder. This is the
   canonical engineering reference.

Tests:
- Component tests for CRUDTable: renders columns, inline edit calls
  the onSave, row actions fire, bulk select caps at maxSelect.
- Component test for DestructiveConfirmDialog: confirm button is
  disabled until the confirmText is typed verbatim.

Safety:
- No existing admin pages use the kit yet — confirm with a grep.

Acceptance:
- CI green.
- Storybook (if the repo uses it) renders every component.
- docs/admin-crud.md is referenced from the repo's main docs index.
```

---

## Session 6 — WS-B.4: Refactor existing Locations onto the kit

**This is the proof-of-pattern PR.** If the Locations module works on the kit, every other module is mechanical replication.

```
Refactor the existing Locations admin module to use the CRUD kit.

Pre-reads:
- reference/plugapro-admin-scaffold/src/app/admin/locations/
  {page,client,actions,schema}.tsx
- docs/admin-crud.md (in the repo after Session 5)

Scope:
1. Read the existing /admin/locations page and its server actions.
2. Rewrite the page + client using CRUDTable and CRUDForm:
   - Add node form uses CRUDForm with the scaffold's Zod schema.
   - Label inline edit uses CRUDTable's inlineEdit.
   - Deactivate/Delete use the kit's ConfirmDialog and
     DestructiveConfirmDialog.
3. Route every mutation through crudAction() with:
   - entity: 'Location'
   - requiredRole: [Role.ADMIN, Role.OWNER]  (OWNER-only for delete)
   - requiredFlag: 'admin.crud.locations'
4. Add a FeatureFlag row for 'admin.crud.locations' via the backfill
   script in scripts/seed-flags.ts (create this file). Default
   enabled=true ONLY in dev/staging; prod stays false until the flag
   is flipped in a follow-up.

Tests:
- Existing Locations Playwright tests must still pass.
- Add a test that verifies an AdminAuditEvent row is written after
  each successful mutation.

Safety:
- Behaviour must be IDENTICAL to the current Locations module. If
  users see a visual change they didn't ask for, something is wrong.
- Feature flag OFF in prod on merge.

Acceptance:
- /admin/locations renders, Add/Edit/Deactivate/Delete work.
- Each mutation writes an AdminAuditEvent row.
- Flag off in prod = behaviour identical to pre-merge (but with audit
  rows).
- PR description links to the Storybook / screenshot before/after.

Post-merge:
- Flip admin.crud.locations ON in staging. Soak 48h. Then prod.
- Only THEN proceed to Session 7.
```

---

## Session 7 — WS-E: Admin users & roles

```
Build the /admin/team surface and wire role checks.

Pre-reads:
- reference/plugapro-admin-scaffold/src/app/admin/team/ (all files)
- reference/plugapro-admin-scaffold/scripts/backfill-admin-users.ts
- CLAUDE.md §"Auth" and §"How admins are currently provisioned"

Scope:
1. Copy src/app/admin/team/{page,team-client,actions,schema}.tsx and
   src/app/admin/team/permissions/page.tsx. Adapt UI primitive imports.
2. Replace the stub sendInviteEmail() in team/actions.ts with a real
   call to the repo's transactional email / WhatsApp magic-link
   provider. Keep the function server-only.
3. Wire middleware (or the auth layer) to read `roles` from AdminUser
   on every admin request. requireRole() from src/lib/auth.ts must
   enforce against those roles.
4. Copy and adapt scripts/backfill-admin-users.ts to read from
   whatever currently provisions admins (per CLAUDE.md). Run it
   locally. Verify every known admin has an AdminUser row with
   role ADMIN.
5. Create FeatureFlag row 'admin.users.v2' in seed-flags.ts. OFF in
   prod by default; enabled for the OWNER account only via
   enabledForUsers.

Tests:
- Playwright: signed-in OWNER can invite a new admin, edit roles,
  deactivate, reactivate, revoke.
- Playwright: signed-in OPS-role user attempting to visit /admin/team
  gets a 403 (not a 500).
- Unit: updateAdminRoles refuses to remove the last OWNER role.
- Unit: deactivateAdmin / revokeAdmin refuse to target the caller.

Safety:
- The "last OWNER" guard is non-negotiable.
- Self-deactivate and self-revoke are non-negotiable.
- Every invite must write an AdminAuditEvent.

Acceptance:
- Owner self-service works end-to-end.
- OPS-role user cannot reach /admin/team.
- Permission matrix page renders at /admin/team/permissions.
- Backfill script is idempotent.
- Flag off in prod = nothing changes for non-owners.

Post-merge:
- Flip admin.users.v2 ON for OWNER account. Test inviting a
  throwaway user. Delete them. Flip on globally.
- DO NOT rip out the old env-var admin provisioning yet — that
  comes in a follow-up cleanup PR.
```

---

## Session 8 — WS-C (part 1): Customers — schema, actions, list, create

```
Build the Customers CRUD list and create flow.

Pre-reads:
- reference/plugapro-admin-scaffold/src/app/admin/customers/
  {schema,actions,list-client,page}.tsx
- reference/plugapro-admin-scaffold/src/app/admin/customers/new/
  {page,form-client}.tsx
- docs/admin-crud.md

Scope:
1. Copy src/app/admin/customers/schema.ts — Zod schemas.
2. Copy src/app/admin/customers/actions.ts — all server actions.
   Adapt field names to match the actual Customer model in this repo
   (some might differ from the scaffold's assumed shape).
3. Copy src/app/admin/customers/page.tsx + list-client.tsx. Adapt UI
   primitive imports.
4. Copy src/app/admin/customers/new/page.tsx + form-client.tsx.
5. Seed FeatureFlag 'admin.crud.customers' (OFF in prod).

Tests:
- Playwright: create a customer, see them in the list, search for
  them, filter to blocked (should be empty), export selected CSV.
- Unit: createCustomer refuses duplicate phone.
- Unit: search query uses Prisma safely (no injection).

Safety:
- Flag OFF in prod on merge.
- Existing /admin/customers route must still work if the flag is
  off — gate new behaviour on the flag, don't remove the old.
- Don't touch the customer detail page — that's Session 9.

Acceptance:
- Flag off → existing behaviour unchanged.
- Flag on → full new list + add flow works for OPS role and above.
- Every mutation writes AdminAuditEvent.
```

---

## Session 9 — WS-C (part 2): Customers — detail page

```
Build the Customer detail page with full action surface.

Pre-reads:
- reference/plugapro-admin-scaffold/src/app/admin/customers/[id]/
  {page,detail-client}.tsx
- Session 8's schemas and actions (already in the repo).

Scope:
1. Copy src/app/admin/customers/[id]/page.tsx (server component).
2. Copy src/app/admin/customers/[id]/detail-client.tsx.
3. Adapt UI primitives and any model field names.
4. Ensure the booking cross-reference query uses the actual Booking
   model field names (see CLAUDE.md).
5. Fix the pre-existing visual bug: the header says "Booking history
   (N)" but the body reads "No bookings yet" — make them agree.

Tests:
- Playwright: load a customer, edit name, see the change.
- Playwright: block a customer, see the banner, unblock.
- Playwright: suspend with a future datetime, see the banner.
- Playwright: add a note, see it in the timeline.
- Playwright: as OWNER, archive then hard-delete; as ADMIN, archive
  only.
- Unit: deleteCustomer refuses when open bookings exist.

Safety:
- Flag gating: admin.crud.customers (same flag as Session 8).
- All destructive actions via DestructiveConfirmDialog.
- All audit rows contain reasonCode when applicable.

Acceptance:
- Every action in the detail-client works.
- Tabs (Profile, Notes, Audit, Bookings) all render without error.
- Audit tab shows prior actions on this customer.
```

---

## Session 10 — WS-D (part 1): Providers — schema, actions, list, create

```
Build the Providers CRUD list and create flow.

Pre-reads:
- reference/plugapro-admin-scaffold/src/app/admin/providers/
  {schema,actions,list-client,page}.tsx
- reference/plugapro-admin-scaffold/src/app/admin/providers/new/
  {page,form-client}.tsx

Scope:
1. Copy schema.ts. Adapt skill/area types to whatever your Provider
   model uses (string array? relation?).
2. Copy actions.ts — adapt Prisma calls.
3. Copy list page + list-client. The list uses counts of
   certifications and equipment — verify those relations exist after
   Session 3's migration.
4. Copy new/page.tsx + form-client.tsx. The create form pulls
   skills from Category and service areas from Location — both must
   be queried on the server.
5. Seed FeatureFlag 'admin.crud.providers'.

Tests:
- Playwright: create a provider, see in list, filter by KYC status.
- Unit: createProvider refuses duplicate phone.

Safety:
- Flag OFF in prod on merge.
- Detail page is handled in Session 11 — do not touch it in this PR.

Acceptance:
- Flag off = existing providers list behaviour.
- Flag on = new list with filters, + Add provider, + export.
```

---

## Session 11 — WS-D (part 2): Providers — tabbed detail

```
Build the Provider detail page with Profile/Certs/Equipment/Notes/Audit tabs.

Pre-reads:
- reference/plugapro-admin-scaffold/src/app/admin/providers/[id]/
  {page,detail-client}.tsx

Scope:
1. Copy page.tsx and detail-client.tsx.
2. Adapt UI primitives.
3. Verify the skill/area editing form works against the repo's
   actual Provider fields.

Tests:
- Playwright: edit profile, see change.
- Playwright: add a certification, edit it, delete it.
- Playwright: add equipment, delete it.
- Playwright: add a strike note, see strikes counter increment.
- Playwright: as TRUST, change KYC status.
- Playwright: suspend with future date, see banner.

Safety:
- Flag: admin.crud.providers.
- Deactivate uses DestructiveConfirmDialog.

Acceptance:
- Every tab renders.
- Every action writes an AdminAuditEvent (entityType varies:
  Provider / ProviderCertification / ProviderEquipment / ProviderNote).
- Page does NOT crash for any seed provider (smoke test must pass).
```

---

## Session 12 — WS-D (part 3): Wire matcher to read certs & equipment

**This is the non-obvious but critical step.** The scaffold's data isn't useful unless the matcher USES it.

```
Make the dispatch matcher read from ProviderCertification and
ProviderEquipment so admin edits actually change eligibility.

Pre-reads:
- The current matcher code. Search: "MISSING_REQUIRED_CERTIFICATION",
  "MISSING_REQUIRED_EQUIPMENT", "FILTERED_OUT", and the dispatch
  engine entry point.
- Category model in prisma/schema.prisma — any existing
  required-skill/equipment mapping.

Scope:
1. If Category does not yet have requiredSkills / requiredEquipment
   relations, add them (new models: CategoryRequiredCertification,
   CategoryRequiredEquipment), additive migration, additive data —
   seed defaults that mirror the current hardcoded logic.
2. Update the matcher's eligibility check to:
   - Look up the JobRequest's Category's requiredCertifications.
   - For each requirement, verify the provider has a matching
     ProviderCertification row that is not expired.
   - Same for equipment.
3. Keep the old hardcoded logic as a fallback ONLY if a category
   has no requirements configured — log a warning in that case.
4. Update the NO_MATCH reason strings to include which specific
   certification or equipment was missing (e.g.
   MISSING_REQUIRED_CERTIFICATION:electrical_coc) so the dispatch
   audit log is actionable.

Tests:
- Unit: a provider with an expired Electrical COC is filtered out
  with reason MISSING_REQUIRED_CERTIFICATION:electrical_coc.
- Unit: a provider with all requirements valid is eligible.
- Integration: a full dispatch run against a request where only one
  provider has the required cert returns that provider as the top
  candidate.

Safety:
- Do not change the outer matcher API.
- If the category has no requirements configured and the provider
  has no certifications, default to eligible (backward-compatible).

Acceptance:
- Existing matcher tests pass.
- The two stuck Cape Town / Durban / Pretoria dispatch cases in the
  seed data can be made eligible by adding a provider with the
  right certification + service area.
```

---

## Session 13 — Wrap-up: rollout checklist, flag flip plan, cleanup

```
Wrap the P0 slice with a rollout document and cleanup tasks.

Pre-reads:
- Every prior session's PR description.
- reference/plugapro-admin-scaffold/docs/MIGRATION-GUIDE.md §"Step 9 —
  Feature-flag cleanup" and §"Step 10 — Audit log viewer".

Scope:
1. Create docs/admin-crud-rollout.md with:
   - Flag flip order: admin.crud.locations → admin.users.v2 →
     admin.crud.customers → admin.crud.providers.
   - Per-flag: internal test steps, soak duration, fallback
     procedure (flip off).
   - Dashboard/Sentry alerts to watch during each flip.
2. Remove any scaffold cruft:
   - If reference/plugapro-admin-scaffold/ is committed, add it to
     .gitignore now OR move it to a permanent docs/ location.
   - Delete any scaffold files that were copied verbatim and remain
     unused.
3. Create follow-up issue drafts in GitHub for:
   - WS-F Categories CRUD
   - WS-G Requests & Quotes CRUD
   - WS-H Bookings management
   - WS-I Payments CRUD
   - WS-J Disputes CRUD
   - WS-K Platform config editor
   - WS-L Audit log viewer + global search + export
   Each issue has a link to this prompt pack and the relevant
   scaffold files.
4. Confirm the old env-var admin provisioning can be removed. If yes,
   open a final cleanup PR that removes it; if no, document why not
   and set a follow-up reminder.

Acceptance:
- Rollout doc merged.
- Follow-up issues created.
- Cleanup PR (if applicable) merged.
- Every P0 flag is at 100% in prod.
```

---

## Generic template — for future workstreams (WS-F through WS-L)

Every remaining entity (Categories, Requests, Quotes, Bookings, Payments, Disputes, Platform config, Audit viewer) follows the same pattern. Use this template to generate the prompt for each.

```
Build CRUD for the <ENTITY> module.

Pre-reads:
- CLAUDE.md
- docs/admin-crud.md
- Existing Customers and Providers modules at src/app/admin/customers
  and src/app/admin/providers — they ARE the pattern.
- reference/plugapro-admin-scaffold/prisma/schema.prisma for any
  additional fields the scaffold suggested.

Scope:
1. Add any missing Prisma fields additively.
2. Create src/app/admin/<entity>/schema.ts with Zod schemas.
3. Create src/app/admin/<entity>/actions.ts with crudAction-wrapped
   server actions for every mutation listed in the plan
   (PlugAPro-CRUD-Implementation-Plan.md §WS-<X>).
4. Create src/app/admin/<entity>/page.tsx (list) and list-client.tsx
   with search + filter + export + bulk select.
5. Create src/app/admin/<entity>/new/page.tsx + form-client.tsx if
   "create" is in scope for this entity.
6. Create src/app/admin/<entity>/[id]/page.tsx + detail-client.tsx
   with all mutations from the plan + notes + audit tabs.
7. Add feature flag 'admin.crud.<entity>' to seed-flags.ts.

Tests:
- Playwright happy path for every action.
- Unit test for any custom server-side guard.

Safety:
- Flag OFF in prod on merge.
- Every mutation via crudAction.
- All destructive actions via DestructiveConfirmDialog.
- All reason codes come from src/lib/reason-codes.ts.

Acceptance:
- Flag off = no user-visible change.
- Flag on = full CRUD per the plan.
- Every mutation writes AdminAuditEvent.
- Smoke test covers list + detail.
```

---

## Ground rules Claude Code should never violate

Keep these in `CLAUDE.md` under a "House rules" heading. Any PR that breaks them should fail review, no exceptions.

1. **Every mutation goes through `crudAction()`.** Grep for `'use server'` — any server action not wrapped is a bug.
2. **No schema drops or renames in any PR.** Additive only. Squash later.
3. **No hard deletes without OWNER role.** Soft delete (archive) by default.
4. **Every destructive action uses `<DestructiveConfirmDialog>`.**
5. **Every PR ships behind a flag.** Flags flip separately, reversibly.
6. **Every PR has a Playwright smoke for the happy path.**
7. **No `as any` without a TODO comment explaining the constraint.**
8. **Detail pages must not crash.** If a related record might be null, guard it — don't let the error boundary be the only defence.

---

## If things go wrong

Common failure modes and how to recover:

- **Claude Code wrote the feature but forgot `crudAction`.** Reject the PR, not retry. Paste this instruction: "Refactor every server action in this PR to go through crudAction() from src/lib/crud-action.ts. Keep behaviour identical. Add a test that asserts an AdminAuditEvent is written after a successful call."
- **Migration fails on staging.** Do not force-push. Open a follow-up PR that either (a) makes the migration conditional (e.g. `IF NOT EXISTS`), or (b) adds a pre-migration data backfill. Never destructive-migrate to "fix" a bad migration.
- **Feature flag works in dev but not prod.** Check: is `FEATURE_FLAGS` env var set in Vercel? Is the `FeatureFlag` row present in the prod DB? Is the caller's userId included in `enabledForUsers`? The three resolution sources are listed at the top of `src/lib/flags.ts`.
- **Role check rejects a legitimate caller.** The caller's `AdminUser.roles` is probably empty because their account wasn't backfilled. Check `scripts/backfill-admin-users.ts` output; re-run if needed.
- **Provider detail still crashes after Session 1.** Session 1's fix was too narrow. Open a follow-up with the new stack trace and run the audit again — the previously-hidden second problem is now visible.

---

## What you should see in the PR list when all 13 sessions are done

1. chore: CLAUDE.md + repo audit
2. fix: stabilise provider and booking detail pages (Error 3811911274)
3. chore: admin error boundaries + smoke test suite
4. feat(db): admin CRUD base schema (AdminUser, AuditEvent, FeatureFlag, Customer/Provider extensions)
5. feat(lib): crudAction, audit, flags, auth, reason codes, SLA registry
6. feat(ui): CRUD kit (Table, Form, Confirm dialogs)
7. refactor: Locations onto the CRUD kit (proof-of-pattern)
8. feat(admin): team — admin users & roles
9. feat(admin): customers — list + create
10. feat(admin): customers — detail + actions
11. feat(admin): providers — list + create
12. feat(admin): providers — detail + actions
13. feat(matcher): read required certifications & equipment from provider tables
14. docs: rollout plan, flag flip order, WS-F-L follow-up issues

Fourteen merged PRs. Two to three focused weeks. Then every other entity (payments, disputes, categories, platform config) uses the generic template and goes in at roughly one PR per day.

That's the plan. Pattern over invention. Small PRs over heroic ones. Audit by construction, not by discipline.
