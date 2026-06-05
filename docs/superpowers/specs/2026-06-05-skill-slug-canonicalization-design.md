# Skill Slug Canonicalization Cleanup — Design Spec
**Date:** 2026-06-05
**Status:** Approved — ready for implementation planning

---

## Context

The canonical slug list in `lib/service-categories.ts:12-24` defines lowercase tags (`plumbing`, `painting`, `garden`, `handyman`, `appliances`, `electrical`, `diy`, `roofing`, `cleaning`, `tiling`, `plastering`, `rhinoliting`, `pest_control`, `carpentry`, `waterproofing`, `air_conditioning`, `other`). The runtime helpers `resolveServiceCategoryTag()` and `normalizeServiceCategorySelections()` exist for exactly this purpose.

Production data has drifted from this canonical form. A read-only inventory against the prod database on 2026-06-05 found:

| Field | Rows affected | Examples |
|---|---|---|
| `ProviderApplication.skills` | 20 / 20 rows | `Plumbing`, `DIY & Assembly`, `Garden & Landscaping` |
| `Provider.skills` | 20 / 20 rows | same |
| `JobRequest.category` | 2 / 2 rows | `Plumbing`, `Appliances` |
| `ServiceAreaWaitlist.category` | 3 / 3 rows | `Handyman`, `Appliances` |

Every Prisma query of the form `{ skills: { has: 'plumbing' } }` silently returns zero against this data. Four readers are silently broken in production:

- `app/(customer)/providers/page.tsx:129` — customer "find a provider" filter.
- `app/(customer)/book/[serviceId]/page.tsx:104` — preferred-provider validation.
- `app/api/customer/bookings/route.ts:250` — preferred-provider validation (API path).
- `lib/matching/candidate-pool.ts:142` — matching engine direct-scan fallback.

The system has not failed visibly because matching engine v2 prefers the `TechnicianSkill` junction table (`skillTag` is canonical), and admin approval (`app/(admin)/admin/applications/page.tsx:298`) normalizes via `resolveServiceCategoryTag` when writing downstream `ProviderCategory` rows. The dirty string-array columns are a latent correctness bug, not yet a production incident.

### Root cause

`lib/whatsapp-flows/registration.ts:1008` pushes `option.label` into the in-flight skills list (Title-Case display string), then writes those values raw to `ProviderApplication.skills` at `registration.ts:2510` without passing through `normalizeServiceCategorySelections`. `Provider.skills` is post-normalized via `syncProviderSkills` after commit, but `ProviderApplication.skills` is never normalized and remains Title-Case forever. `prisma/seed.ts:196,209` also writes Title-Case literals deliberately, propagating drift into dev/test fixtures.

The `JobRequest.category` and `ServiceAreaWaitlist.category` drift has the same shape but the upstream writer site will be confirmed during implementation (likely a WhatsApp job-request flow node mirroring the registration bug; `lib/job-requests/create-job-request.ts:383` is the persistence point but the caller passes raw values through).

---

## Architecture Decision

**Normalize on write, backfill once, add a Prisma client extension as a safety net.**

The smaller alternative (fix writers only, leave 45 dirty rows in place) was rejected: the four broken readers stay silently broken for legacy data, and the queue of "ones that pass" vs "ones that don't" becomes invisible mental overhead. The larger alternative (deprecate `Provider.skills` as a string array in favor of the `TechnicianSkill` junction) was rejected as out of scope for a cleanup pass; it's a real refactor and deserves its own design.

Source of truth for canonical slugs remains `lib/service-categories.ts`. The `Category` Prisma model now exists at `schema.prisma:2696` but its `slug` column is not yet load-bearing for the normalize path. This spec deliberately does not migrate the source of truth to the DB; that's a separate decision.

---

## Scope

**In scope (this spec):**

1. Writer fix at `registration.ts:1008` and surrounding submit path.
2. Writer fix at `create-job-request.ts:383` (and confirm caller).
3. Seed fix at `prisma/seed.ts:196,209`.
4. Prisma client extension intercepting writes to `Provider.skills`, `ProviderApplication.skills`, `JobRequest.category`, `ServiceAreaWaitlist.category`.
5. Idempotent backfill script with dry-run mode and audit trail.
6. Regression tests for the extension and the registration submit path.
7. Verification via the existing `scripts/inventory-skill-drift.ts` showing zero drift after backfill.

**Explicitly out of scope:**

- Migrating `Provider.skills` / `ProviderApplication.skills` to junction-table-only.
- Changing the matching engine's read path to bypass the string array column.
- Promoting the `Category` DB model into the canonical-slug authority.
- Equipment / vehicle / serviceArea normalization (different data, no drift seen — `serviceAreas` holds neighborhood names; `equipmentTags` and `vehicleTypes` are empty in prod).

---

## Components

### 1. Writer fix

| File:line | Change | Notes |
|---|---|---|
| `lib/whatsapp-flows/registration.ts:1008` | `validSkills.push(option.label)` → `validSkills.push(option.tag)` | Root cause site. Stores canonical tag from the start. |
| `lib/whatsapp-flows/registration.ts:2489, 2510` | No code change — covered by the Prisma extension below. Add an assertion in the registration-flow test confirming canonical output. | The extension is THE safety net; duplicating the normalize call at every write site is noise. |
| `lib/whatsapp-flows/registration.ts:235` | Confirm `resolveServiceCategoryTag` validation still passes for canonical inputs | No code change expected; verify via test. |
| `lib/job-requests/create-job-request.ts:383` | No code change at the Prisma write — extension handles it. Add a `BadRequestError('invalid_category')` thrown earlier in the function so callers get a clean 400 instead of `SkillNormalizationError` bubbling from the extension. | Better UX for API consumers; same end state. |
| Upstream caller(s) of `createJobRequest` | Found and patched during implementation. Two prod rows of dirty data imply at least one writer exists outside the URL-slug path. | Implementation step, not design step. |
| `prisma/seed.ts:196, 209` | Literal `'Plumbing'` → `'plumbing'` (and equivalents for every entry) | Keep dev/test data canonical so local matching queries return expected results. Seeds would still work with Title-Case (the extension normalizes), but having the literals match the schema's canonical form is the readable intent. |

### 2. Safety net — Prisma client extension

New file `field-service/lib/skills-normalize-extension.ts`. Exports a pure function `normalizeWriteArgs(model, action, args)` and a Prisma `$extends` definition that wraps it for each affected model × action.

```ts
// Conceptual shape
const SKILL_ARRAY_MODELS = ['provider', 'providerApplication'] as const
const CATEGORY_SCALAR_MODELS = ['jobRequest', 'serviceAreaWaitlist'] as const
const WRITE_ACTIONS = ['create', 'createMany', 'update', 'updateMany', 'upsert'] as const

export function normalizeWriteArgs(
  model: string,
  action: typeof WRITE_ACTIONS[number],
  args: Prisma.Args<unknown, typeof WRITE_ACTIONS[number]>,
): typeof args
```

`normalizeWriteArgs` handles every shape a write can take:

- **Array field, create / createMany:** `{ data: { skills: [...] } }` and `{ data: [ { skills: [...] }, ... ] }`.
- **Array field, update / updateMany:** `{ data: { skills: [...] } }`, `{ data: { skills: { set: [...] } } }`, `{ data: { skills: { push: ... } } }`.
- **Array field, upsert:** both `create` and `update` branches.
- **Scalar field, all shapes:** `{ data: { category: '...' } }` and update wrappers.

Behavior:

- For array fields, each input value passes through `resolveServiceCategoryTag`. If any value returns `null`, the extension throws `SkillNormalizationError('unresolved_skill', { model, action, value })`. The extension does not silently drop unknown values — drift fails loud at the write boundary.
- For scalar fields, the single value passes through `resolveServiceCategoryTag` with the same throw-on-null behavior.
- Normalization is idempotent: a write of `['plumbing']` produces `['plumbing']` with no diff.

Wired into the existing Prisma singleton at `field-service/lib/db.ts`:

```ts
export const db = (globalForPrisma.prisma ?? new PrismaClient({ ... }))
  .$extends(skillsNormalizeExtension)
```

The extension is unit-tested via direct calls to `normalizeWriteArgs` without a DB. Integration coverage piggybacks on existing registration-flow tests that round-trip through the extended client.

### 3. Backfill script

New file `field-service/scripts/backfill-canonical-skills.ts`. Behavior:

- Required flag: `--apply`. Without it, runs in dry-run mode and writes nothing.
- For each of the four affected fields:
  1. Fetch all rows where the field is non-empty.
  2. Compute the normalized value via the same `normalizeServiceCategorySelections` / `resolveServiceCategoryTag` helpers as the extension.
  3. If new ≠ old, emit a diff line.
  4. In `--apply` mode, run the update inside a single transaction per table.
- Hard-fails on any value the normalizer cannot resolve (rather than skipping). Operator must intervene manually for unknown values — likely indicates a new label that needs adding to `lib/service-categories.ts`.
- Writes one `AuditLog` row per changed row, with:
  - `actorId = 'system:backfill-canonical-skills'`
  - `actorRole = 'SYSTEM'`
  - `action = 'BACKFILL_SKILL_CANONICALIZATION'`
  - `entityType = 'Provider' | 'ProviderApplication' | 'JobRequest' | 'ServiceAreaWaitlist'`
  - `entityId = <row id>`
  - `before = { field: '<name>', value: <old> }`
  - `after = { field: '<name>', value: <new> }`
- Idempotent: a second run produces zero diffs and no writes.

Operator workflow:

```
pnpm tsx scripts/backfill-canonical-skills.ts            # dry-run
pnpm tsx scripts/backfill-canonical-skills.ts --apply    # commits
pnpm tsx scripts/inventory-skill-drift.ts                # verify
```

### 4. Regression tests

New file `field-service/__tests__/lib/skill-canonicalization.test.ts`:

- `normalizeWriteArgs` accepts canonical tags unchanged (idempotent identity for `['plumbing']`).
- Title-Case label inputs are normalized to canonical tags (`['Plumbing']` → `['plumbing']`).
- `'Garden & Landscaping'` and `'DIY & Assembly'` resolve to `'garden'` and `'diy'`.
- Each of the five Prisma actions (`create`, `createMany`, `update`, `updateMany`, `upsert`) is exercised.
- Update flavors (`{ set: ... }`, `{ push: ... }`, bare array) are all handled.
- Unknown values (`'NotARealSkill'`) throw `SkillNormalizationError`.
- Scalar category field on `jobRequest` and `serviceAreaWaitlist` is normalized.
- Empty arrays / null scalars pass through unchanged.

Extension to existing registration-flow tests:

- Add an assertion at the end of the submit-path test that `ProviderApplication.skills` written by `handleConfirm` contains only canonical tags. This guards against future regressions where someone wires a write path around the extension (e.g., raw SQL).

### 5. Existing artifact cleanup

- Update `field-service/scripts/list-pending-plumber-applications.ts` to use canonical `'plumbing'` instead of the hardcoded Title-Case `'Plumbing'` workaround.
- Remove the temporary `scripts/inventory-skill-drift.ts` after the cleanup ships, or keep as a recurring sanity check (decided during implementation).

---

## Data Migration

**Method:** Application-layer backfill script, not a Prisma SQL migration.

Rationale: the transformation lookup table (label → tag) lives in TypeScript (`lib/service-categories.ts`), including the special-case aliases `'Garden & Landscaping' → 'garden'` and `'DIY & Assembly' → 'diy'`. Encoding these in a Postgres `UPDATE` statement duplicates logic and is brittle when new aliases are added. The script reuses the same normalizer the extension uses, so backfill and runtime are guaranteed consistent.

**Reversibility:** Each backfill writes `AuditLog.before` containing the original Title-Case value. A rollback script can be derived from the audit trail if needed. Backfill is not destructive of metadata — only the canonical form replaces the display form. Display labels are recoverable at render time via `getServiceCategoryLabel(tag)`.

**Affected row count (snapshot 2026-06-05):**
- `Provider.skills`: 20 rows.
- `ProviderApplication.skills`: 20 rows.
- `JobRequest.category`: 2 rows.
- `ServiceAreaWaitlist.category`: 3 rows.

Total: 45 row mutations, 45 audit log inserts.

---

## Rollout

Single PR, no feature flag. This is a correctness fix, not a behavior change.

Order of operations:

1. PR lands → writer fix, extension, seed fix, backfill script all deploy together.
2. From the moment of deploy, every new write is canonical (writer fix + extension belt-and-suspenders).
3. Operator runs `scripts/backfill-canonical-skills.ts` (dry-run) against prod, reviews the diff.
4. Operator runs `scripts/backfill-canonical-skills.ts --apply` against prod.
5. Operator runs `scripts/inventory-skill-drift.ts` against prod and confirms zero drift across all four fields.

If step 3's diff contains unexpected values (e.g., values not seen in the 2026-06-05 inventory), the script will hard-fail before reaching step 4. Operator must add the new label as an alias to `lib/service-categories.ts` and ship a follow-up PR before re-running.

---

## Risks and Mitigations

| Risk | Mitigation |
|---|---|
| Extension changes Prisma write semantics for an unexpected call site and breaks a test or admin action. | Wired into the existing singleton — every existing call goes through it on day one. CI test suite + Playwright smoke run before merge. |
| Backfill runs against the wrong DB. | Required `--apply` flag, dry-run by default, prints connection target before any write. |
| A new label appears in production between writing this spec and shipping the fix. | The dry-run hard-fails on unresolved values, surfacing it before any write. Operator updates `service-categories.ts` aliases and re-runs. |
| Display labels (Title-Case) leak into UI from the now-canonical data. | UI already uses `getServiceCategoryLabel(tag)` (e.g., `provider-journey.ts:796`); raw `.join(', ')` callers should be audited during implementation but are display-only and harmless if missed. |
| Extension hot path adds latency to every write. | Normalizer is a `Map` lookup. Performance impact is negligible. |
| Race during backfill — a row is written by the registration flow while the script is mid-transaction. | Per-table transaction wraps the read + write. Concurrent writes go through the (now-canonical) extension and are themselves canonical, so re-running the script for new rows is a no-op. |

---

## Verification

After deploy + backfill:

```
pnpm tsx scripts/inventory-skill-drift.ts
```

Expected output: every distinct value across all four fields is classified `canonical`; zero `titlecase-label` rows.

Manual spot-check:

```
pnpm prisma studio          # eyeball five Provider rows, five Application rows
```

Direct Prisma query that used to fail:

```ts
await prisma.provider.count({ where: { skills: { has: 'plumbing' } } })
// expected: > 0 (was 0 before backfill)
```

---

## Open Questions Resolved

- **Backfill via SQL migration or tsx script?** Script. Keeps the normalizer single-sourced in TypeScript.
- **Should the safety net throw on null or silently drop?** Throw. Drift must fail loud.
- **Move source of truth to the `Category` DB model?** No — separate decision, out of scope here.
- **Run behind a feature flag?** No — pure correctness fix; flagging adds risk without benefit.
- **Equipment / vehicle / service-area arrays?** Not in scope — no drift observed in production data.
