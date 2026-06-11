# Category Risk Grading — Design Spec
**Date:** 2026-05-22
**Status:** Approved — ready for implementation planning

---

## Context

During a no-match incident (a customer requesting Plumbing in a Roodepoort suburb), investigation revealed that `provider_categories` rows default to `PENDING_REVIEW`, blocking matching eligibility for every category until ops manually approves each one per provider. For low-risk service categories (cleaning, garden, DIY), this creates unnecessary ops queue volume with no meaningful safety benefit.

This feature introduces a `riskTier` field on a new `Category` model. When a provider is approved, all their LOW-risk categories are auto-approved in the same transaction. When an already-active provider adds a LOW-risk category later, the row is written as APPROVED directly.

---

## Architecture Decision

**Service-layer hooks — not a Postgres trigger.**

The project pattern across all engineering decisions is: logic lives in the application layer, is testable, and emits structured logs. A DB trigger cannot write to `AdminAuditEvent`, cannot be tested in Vitest, and splits business logic between TypeScript and SQL. This decision is recorded in OpenBrain under PlugAPro.

---

## Schema

### New enum

```prisma
enum CategoryRiskTier {
  LOW
  STANDARD
}
```

### Additive field on existing model

`Category` already exists at `schema.prisma:2161` with `id @id @default(cuid())`, `slug @unique`, and relations to `ProviderCategory`, `CategoryRequiredCertification`, `CategoryRequiredEquipment`, `CategoryRequiredVehicleType`, and `ProviderRate`. Do NOT redefine this model. Add one field via an additive migration:

```prisma
// Inside existing Category model — additive only
riskTier  CategoryRiskTier  @default(STANDARD)
```

`ProviderCategory` already has a `categoryId String?` FK to `Category.id` (nullable, set-null on delete) and a separate `categorySlug String` denormalized field. The risk-tier lookup uses `categorySlug` → `Category.slug` (which is `@unique`), not the FK, to preserve compatibility with rows where `categoryId` is null.

**Slug immutability constraint:** `categorySlug` is the join key between `provider_categories` and `categories`. The existing `updateCategory` admin action (`categories/actions.ts:157`) permits slug changes today. This must be locked: after a `Category` row is created, its `slug` is immutable. The `updateCategory` action must reject any change to `slug` if `provider_categories` rows exist for it. This is enforced in the service layer, not via a DB constraint.

`riskTier` defaults to `STANDARD`. Any category slug not in the seed list is STANDARD until ops sets it explicitly.

---

## Service Layer

New module: `lib/provider-categories.ts`

### `autoApproveLowRiskCategories(providerId: string): Promise<void>`

Called inside the provider approval action, after the status transition to `ACTIVE` commits.

1. Query all `provider_categories` rows for this provider where `approvalStatus = PENDING_REVIEW`.
2. For each row, look up `categories.riskTier` by `categorySlug`.
3. Batch-update any LOW-risk rows to `APPROVED`.
4. For each updated row, write an `AuditLog` entry (not `AdminAuditEvent` — system events have no real `adminId` FK):
   ```
   actorId:    'system'
   actorRole:  'SYSTEM'
   action:     'provider_category.auto_approved'
   entityType: 'ProviderCategory'
   entityId:   row.id
   after:      { approvalStatus: 'APPROVED', reason: 'LOW_RISK_CATEGORY', categorySlug }
   ```
5. Emit structured log:
   ```
   console.log('[provider-categories] auto-approved', { providerId, count, slugs })
   ```

### `resolveInitialApprovalStatus(providerId: string, categorySlug: string): Promise<'APPROVED' | 'PENDING_REVIEW'>`

Called before any `provider_categories` upsert.

1. Look up `provider.status`.
2. Look up `category.riskTier` by `categorySlug`. If no `Category` row exists, treat as `STANDARD`.
3. If `provider.status = ACTIVE` and `riskTier = LOW` → return `'APPROVED'` and emit:
   ```
   console.log('[provider-categories] auto-approved on upsert', { providerId, categorySlug })
   ```
4. Otherwise → return `'PENDING_REVIEW'`.

### `autoApproveProvidersForCategory(categorySlug: string): Promise<number>`

Called inside `updateCategoryRiskTierAction` when ops changes a category from STANDARD → LOW. Operates across providers, not per-provider.

1. Find all `provider_categories` rows where `categorySlug = slug` and `approvalStatus = PENDING_REVIEW` and `provider.status = ACTIVE`.
2. Batch-update those rows to `APPROVED`.
3. For each updated row, write an `AuditLog` entry:
   ```
   actorId:    'system'
   actorRole:  'SYSTEM'
   action:     'provider_category.auto_approved'
   entityType: 'ProviderCategory'
   entityId:   row.id
   after:      { approvalStatus: 'APPROVED', reason: 'CATEGORY_RISK_TIER_CHANGED_TO_LOW', categorySlug, providerId: row.providerId }
   ```
4. Emit structured log:
   ```
   console.log('[provider-categories] bulk auto-approved on tier change', { categorySlug, count })
   ```
5. Return count of rows updated.

This is intentionally separate from `autoApproveLowRiskCategories` — it operates on one slug across many providers, not all LOW-risk slugs for one provider.

### Call sites

All three `resolveInitialApprovalStatus` call sites must route through the centralised function — no inline PENDING_REVIEW defaults may remain after this feature ships.

| Location | Function called |
|---|---|
| `app/(admin)/admin/providers/actions.ts` — approval action | `autoApproveLowRiskCategories` after status update |
| `lib/whatsapp-flows/registration.ts:2422` — provider self-registration | `resolveInitialApprovalStatus` — result passed as `approvalStatus` |
| `lib/provider-applications.ts:105` — application processing | `resolveInitialApprovalStatus` — result passed as `approvalStatus` |
| `app/(admin)/admin/applications/page.tsx:281` — admin application approval | `resolveInitialApprovalStatus` — result passed as `approvalStatus` |
| `updateCategoryRiskTierAction` — STANDARD → LOW change | `autoApproveProvidersForCategory(slug)` |

---

## Admin UI

**Route:** `/admin/categories` (existing page, upgraded)

### Table columns
Label | Slug | Risk Tier | Active

### Risk Tier cell
Inline `<Select>` with options `STANDARD` and `LOW`. Saves via server action on change.

**STANDARD → LOW**: Triggers the destructive confirmation pattern before saving. Modal text: *"Changing this category to LOW risk will auto-approve it for all currently active providers awaiting review. This takes effect immediately."*

**LOW → STANDARD**: No confirmation required. Does not retroactively change already-APPROVED rows.

### Server action: `updateCategoryRiskTierAction(slug, riskTier)`

1. Fetch current `category.riskTier` (for audit before/after).
2. Update the row.
3. Write `AdminAuditEvent` via `crudAction()`:
   ```
   metadata: { before: oldTier, after: newTier }
   ```
4. **If changing STANDARD → LOW**: call `autoApproveProvidersForCategory(slug)`.

**Access gate:** OWNER role only.

### Feature flag
`admin.categories.risk_tier` — gates the riskTier column and inline select in the UI. Must be registered in `lib/feature-flags-registry.ts` under the `Admin CRUD surfaces` section before use. The service-layer auto-approval logic is not gated; it activates as soon as `Category` rows with `LOW` tiers exist in the DB.

```ts
// lib/feature-flags-registry.ts — add to Admin CRUD surfaces section
'admin.categories.risk_tier': {
  description: 'Enable riskTier column and inline LOW/STANDARD selector on the Categories admin page.',
  owner: 'ops',
  defaultValue: false,
},
```

---

## Seed Data

Migration uses `upsert` by slug — idempotent, safe to re-run.

| Slug | Label | Risk Tier |
|---|---|---|
| `cleaning` | Cleaning | LOW |
| `garden` | Garden & Landscaping | LOW |
| `diy` | DIY & Assembly | LOW |
| `moving` | Moving & Packing | LOW |
| `painting` | Painting | LOW |
| `plumbing` | Plumbing | STANDARD |
| `electrical` | Electrical | STANDARD |
| `hvac` | HVAC | STANDARD |
| `pest-control` | Pest Control | STANDARD |

Ops can adjust any tier via the admin UI after seeding. Any slug introduced after this migration defaults to STANDARD until explicitly set.

---

## Audit Trail

| Event | Table | Actor |
|---|---|---|
| Auto-approval on provider approval | `AuditLog` | `actorId: 'system', actorRole: 'SYSTEM'` |
| Auto-approval on late category upsert | `AuditLog` | `actorId: 'system', actorRole: 'SYSTEM'` |
| Bulk auto-approval on tier change | `AuditLog` | `actorId: 'system', actorRole: 'SYSTEM'` |
| Ops changes riskTier via admin UI | `AdminAuditEvent` (via `crudAction()`) | real `adminId` FK |

`AdminAuditEvent` requires a non-nullable `adminId` FK to `AdminUser` and cannot be used for system-triggered writes. `AuditLog` has `actorId String` and `actorRole String` with no FK constraint — it is the correct table for all system-initiated events. Both tables emit a structured `console.log` for log aggregation.

---

## Testing Requirements

- `autoApproveLowRiskCategories` — unit tests in Vitest with mocked DB:
  - Approves only LOW-risk rows; leaves STANDARD rows as PENDING_REVIEW
  - Writes one `AdminAuditEvent` per approved row
  - Emits structured log with count and slugs
  - No-ops cleanly if provider has no PENDING_REVIEW rows

- `resolveInitialApprovalStatus` — unit tests:
  - Returns APPROVED for ACTIVE provider + LOW category
  - Returns PENDING_REVIEW for ACTIVE provider + STANDARD category
  - Returns PENDING_REVIEW for non-ACTIVE provider + LOW category
  - Returns PENDING_REVIEW when no `Category` row exists (missing = STANDARD)

- `autoApproveProvidersForCategory` — unit tests:
  - Approves all ACTIVE providers' PENDING_REVIEW rows for the given slug
  - Skips INACTIVE providers
  - Skips rows already APPROVED
  - Writes one `AdminAuditEvent` per approved row with `reason: CATEGORY_RISK_TIER_CHANGED_TO_LOW`
  - Returns correct count

- `updateCategoryRiskTierAction` — integration test:
  - STANDARD → LOW calls `autoApproveProvidersForCategory(slug)`, not `autoApproveLowRiskCategories`
  - `AdminAuditEvent.metadata` contains both before and after values

---

## Out of Scope

- FK constraint from `ProviderCategory.categorySlug` → `Category.slug` (deferred; existing data needs cleanup first)
- Multi-tier queues (HIGH, CRITICAL) — 2-tier model is sufficient for now
- Automatic LOW → STANDARD downgrade on complaint threshold — future ops workflow, not this feature
